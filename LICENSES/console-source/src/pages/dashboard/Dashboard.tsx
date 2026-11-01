/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/dashboard/Dashboard.tsx
 * The landing page: the server right now.
 *   KPIs            online / room · uptime (written out) · active bans · blocked characters · scripts running
 *   Needs attention dead · badly hurt · hunger or thirst under 20 · frozen · weak connection, each with its
 *                   one-press fix (revive / heal / refill / unfreeze) and a way into the player's file
 *   World now       the shared world controls (weather, time, announcement), never collapsed
 *   Recent actions  the admin log, live
 *   Shortcuts       the pages this admin may open
 * Every player action targets the CITIZEN ID (the server resolves it to the live session).
 * ════════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useState } from 'react';
import type { PageProps } from '../../app/pages';
import { allowed, descKeyOf, helpKeyOf, labelKeyOf, pageById } from '../../app/registry';
import { useApp } from '../../ctx';
import type { AppCtx } from '../../ctx';
import { useI18n } from '../../i18n';
import {
  Button, DataTable, EmptyState, FilterChips, Gate, PageActions, Section, StatTile, StatusChip, fmtDate, fmtDuration, fmtNum,
} from '../../kit';
import type { ChipItem, Column, HelpKey, Status } from '../../kit';
import type { AdminPlayer, Area } from '../../types';
import { useUptime } from '../world/state';
import { WorldControls } from '../world/WorldControls';
import LogTable from './LogTable';
import { useRecentLogs } from './recent';
import './dashboard.css';

const LOW = 20;
const PING_HIGH = 200;
const SERVER_POLL_MS = 30000;

/** keeps a number with its unit (or a date) in one left-to-right run inside Arabic text */
const ltr = (s: string) => `⁦${s}⁩`;

const pageOk = (app: AppCtx, id: string) => {
  const def = pageById(id);
  return !!def && allowed(def, app);
};

/* ── KPIs ────────────────────────────────────────────────────────────────── */

function Kpis() {
  const app = useApp();
  const { t, lang } = useI18n();
  const info = app.serverInfo;
  const up = useUptime(info);
  const online = info ? info.playersOnline : app.players.length;
  const startedAt = up !== null ? Date.now() / 1000 - up : null;
  const longUp = up !== null && up > 20 * 3600;
  const startText = startedAt === null ? '' : longUp ? fmtDate(startedAt) : fmtDate(startedAt).slice(11);
  const blocks = typeof info?.blocksCount === 'number' ? info.blocksCount : app.blocks ? app.blocks.length : null;
  const canScripts = app.can('resources');
  const running = info ? info.resources.filter((r) => r.state === 'started').length : 0;
  const total = info ? info.resources.length : 0;
  const lockText = (area: Area) => {
    const lv = app.levelOf(area);
    return lv ? t('label.common.lockedNeeds', t(`label.common.level.${lv}`)) : t('label.common.locked');
  };
  const go = (id: string, params?: Record<string, string>) => (pageOk(app, id) ? () => app.navigate(id, params) : undefined);

  return (
    <div className="dsh-kpis">
      <StatTile
        label={t('label.dashboard.kpi.online')}
        help="help.dashboard.kpi.online"
        value={info ? `${fmtNum(online)} / ${fmtNum(info.maxPlayers)}` : fmtNum(online)}
        sub={info ? t('label.dashboard.kpi.onlineSub', fmtNum(info.maxPlayers)) : undefined}
        onClick={go('players')}
      />
      <StatTile
        label={t('label.dashboard.kpi.uptime')}
        help="help.dashboard.kpi.uptime"
        value={up !== null ? fmtDuration(t, lang, up, 2) : '—'}
        sub={startText ? t(longUp ? 'label.dashboard.kpi.uptimeSubDate' : 'label.dashboard.kpi.uptimeSub', ltr(startText)) : undefined}
        numeric={false}
      />
      <StatTile
        label={t('label.dashboard.kpi.bans')}
        help="help.dashboard.kpi.bans"
        value={info ? fmtNum(info.bansCount) : '—'}
        sub={t('label.dashboard.kpi.bansSub')}
        onClick={go('bans')}
      />
      <StatTile
        label={t('label.dashboard.kpi.blocks')}
        help="help.dashboard.kpi.blocks"
        value={blocks === null ? '—' : fmtNum(blocks)}
        sub={blocks === null && !app.can('characters') ? lockText('characters') : t('label.dashboard.kpi.blocksSub')}
        onClick={go('bans', { view: 'blocks' })}
      />
      <StatTile
        label={t('label.dashboard.kpi.scripts')}
        help="help.dashboard.kpi.scripts"
        value={canScripts && info ? `${fmtNum(running)} / ${fmtNum(total)}` : '—'}
        sub={!canScripts ? lockText('resources')
          : total - running > 0 ? t('label.dashboard.kpi.scriptsStopped', fmtNum(total - running)) : t('label.dashboard.kpi.scriptsAll')}
        onClick={canScripts ? go('resources') : undefined}
      />
    </div>
  );
}

/* ── needs attention ─────────────────────────────────────────────────────── */

type Reason = 'dead' | 'hurt' | 'low' | 'frozen' | 'ping';
const REASONS: Reason[] = ['dead', 'hurt', 'low', 'frozen', 'ping'];
const STATUS: Record<Reason, Status> = { dead: 'dead', hurt: 'low', low: 'low', frozen: 'frozen', ping: 'offline' };

interface Fix { key: 'revive' | 'heal' | 'refill' | 'unfreeze'; action: string; args: Record<string, unknown>; area: Area }
const FIX: Record<Reason, Fix | null> = {
  dead: { key: 'revive', action: 'revive', args: {}, area: 'revive' },
  hurt: { key: 'heal', action: 'heal', args: {}, area: 'revive' },
  low: { key: 'refill', action: 'needs', args: { hunger: 100, thirst: 100 }, area: 'needs' },
  frozen: { key: 'unfreeze', action: 'freeze', args: { state: false }, area: 'players' },
  ping: null,
};

interface Row { p: AdminPlayer; reasons: Reason[] }

function reasonsOf(p: AdminPlayer): Reason[] {
  const out: Reason[] = [];
  if (p.dead) out.push('dead');
  else if (p.maxHealth > 0 && p.health >= 0 && p.health / p.maxHealth < 0.2) out.push('hurt');
  if (p.needs && (p.needs.hunger < LOW || p.needs.thirst < LOW)) out.push('low');
  if (p.frozen) out.push('frozen');
  if (Number.isFinite(p.ping) && p.ping >= PING_HIGH) out.push('ping');
  return out;
}

const charName = (p: AdminPlayer) => `${p.firstname ?? ''} ${p.lastname ?? ''}`.trim() || p.name;

function ActionCell({ row }: { row: Row }) {
  const app = useApp();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const fix = FIX[row.reasons[0]];
  const target = row.p.citizenid ? { citizenid: row.p.citizenid } : { id: row.p.id };
  return (
    <span className="dsh-actions">
      {fix && (
        <Button
          help={`help.dashboard.${fix.key}` as HelpKey}
          helpQuiet
          size="sm"
          area={fix.area}
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try { await app.act('player', { ...target, action: fix.action, args: fix.args }, { okText: t('ui_done') }); } finally { setBusy(false); }
          }}
        >
          {t(`label.dashboard.act.${fix.key}`)}
        </Button>
      )}
      <Button help="help.dashboard.open" helpQuiet kind="ghost" size="sm" area="players" onClick={() => app.navigate('players', { sel: String(row.p.id) })}>
        {t('label.dashboard.act.open')}
      </Button>
    </span>
  );
}

function Attention() {
  const app = useApp();
  const { t } = useI18n();
  const [filter, setFilter] = useState<'all' | Reason>('all');
  const rows = useMemo<Row[]>(() => app.players
    .map((p) => ({ p, reasons: reasonsOf(p) }))
    .filter((r) => r.reasons.length > 0)
    .sort((a, b) => REASONS.indexOf(a.reasons[0]) - REASONS.indexOf(b.reasons[0]) || charName(a.p).localeCompare(charName(b.p))), [app.players]);
  const counts = useMemo(() => {
    const c: Record<Reason, number> = { dead: 0, hurt: 0, low: 0, frozen: 0, ping: 0 };
    for (const r of rows) for (const x of r.reasons) c[x]++;
    return c;
  }, [rows]);
  const shown = filter === 'all' ? rows : rows.filter((r) => r.reasons.includes(filter));

  const reasonText = (x: Reason, p: AdminPlayer) => {
    if (x === 'low') return t('label.dashboard.reason.low', fmtNum(p.needs?.hunger), fmtNum(p.needs?.thirst));
    if (x === 'hurt') return t('label.dashboard.reason.hurt', ltr(`${fmtNum(p.maxHealth > 0 ? (p.health / p.maxHealth) * 100 : 0)}%`));
    if (x === 'ping') return t('label.dashboard.reason.ping', ltr(`${fmtNum(p.ping)} ms`));
    return t(`label.dashboard.reason.${x}`);
  };

  const cols = useMemo<Column<Row>[]>(() => [
    {
      key: 'player', label: t('label.dashboard.col.player'), help: 'help.dashboard.col.player',
      render: (r) => (
        <>
          <span className="k-cell-main">{charName(r.p)}</span>
          <span className="k-cell-sub dsh-ids">
            <span>{t('label.common.citizen.label')} <b className="k-num">{r.p.citizenid || '—'}</b></span>
            <span className="k-num">#{r.p.id}</span>
          </span>
        </>
      ),
    },
    {
      key: 'reason', label: t('label.dashboard.col.reason'), help: 'help.dashboard.col.reason',
      render: (r) => (
        <span className="dsh-reasons">
          {r.reasons.map((x) => <StatusChip key={x} status={STATUS[x]} label={reasonText(x, r.p)} />)}
        </span>
      ),
    },
    { key: 'action', label: t('label.dashboard.col.action'), help: 'help.dashboard.col.action', className: 'dsh-col-action', render: (r) => <ActionCell row={r} /> },
  ], [t]); // eslint-disable-line react-hooks/exhaustive-deps

  const chips: ChipItem<'all' | Reason>[] = [
    { id: 'all', label: t('label.dashboard.filter.all'), count: rows.length, help: 'help.dashboard.filter.all' },
    ...REASONS.map((x) => ({ id: x, label: t(`label.dashboard.filter.${x}`), count: counts[x], help: `help.dashboard.filter.${x}` as HelpKey })),
  ];

  return (
    <Section title={t('label.dashboard.attention')} help="help.dashboard.attention" area="players" className="dsh-attn">
      <Gate area="players">
        <FilterChips items={chips} value={filter} onChange={setFilter} label={t('label.dashboard.filter.label')} />
        <DataTable<Row>
          columns={cols}
          rows={shown}
          rowKey={(r) => r.p.id}
          label={t('label.dashboard.attention')}
          onSelect={(r) => app.navigate('players', { sel: String(r.p.id) })}
          loading={!app.playersSeen && app.can('players')}
          empty={(
            <EmptyState
              text={rows.length === 0 ? t('label.dashboard.allClear') : t('label.dashboard.noneHere')}
              next={pageOk(app, 'players') ? (
                <Button help="help.shell.page.players" kind="ghost" size="sm" onClick={() => app.navigate('players')}>{t('label.dashboard.openPlayers')}</Button>
              ) : undefined}
            />
          )}
          className="dsh-attn-table"
        />
      </Gate>
    </Section>
  );
}

/* ── world card ──────────────────────────────────────────────────────────── */

function WorldCard() {
  const app = useApp();
  const { t } = useI18n();
  return (
    <Section
      title={t('label.dashboard.world')}
      help="help.dashboard.world"
      area="server"
      className="dsh-world"
      actions={pageOk(app, 'world') ? (
        <Button help="help.dashboard.openWorld" kind="link" size="sm" onClick={() => app.navigate('world')}>{t('label.dashboard.openWorld')}</Button>
      ) : undefined}
    >
      <WorldControls variant="card" />
    </Section>
  );
}

/* ── recent admin actions ────────────────────────────────────────────────── */

function RecentBody() {
  const { t } = useI18n();
  const { rows, error } = useRecentLogs({ limit: 8 });
  return <LogTable rows={rows} error={error} label={t('label.dashboard.recent')} empty={t('label.dashboard.recentEmpty')} className="dsh-recent-table" />;
}

function Recent() {
  const app = useApp();
  const { t } = useI18n();
  return (
    <Section
      title={t('label.dashboard.recent')}
      help="help.dashboard.recent"
      area="logs"
      className="dsh-recent"
      actions={pageOk(app, 'log') ? (
        <Button help="help.dashboard.openLog" kind="link" size="sm" onClick={() => app.navigate('log')}>{t('label.dashboard.openLog')}</Button>
      ) : undefined}
    >
      <Gate area="logs">{app.can('logs') && <RecentBody />}</Gate>
    </Section>
  );
}

/* ── shortcuts ───────────────────────────────────────────────────────────── */

const SHORTCUTS = ['players', 'characters', 'map', 'tools', 'hub', 'bans', 'log', 'perms', 'resources'];

function Shortcuts() {
  const app = useApp();
  const { t } = useI18n();
  const defs = SHORTCUTS.map((id) => pageById(id)).filter((d): d is NonNullable<typeof d> => !!d && allowed(d, app));
  return (
    <Section title={t('label.dashboard.shortcuts')} help="help.dashboard.shortcuts" className="dsh-shortcuts">
      <div className="dsh-shorts">
        {defs.map((d) => {
          const label = t(labelKeyOf(d));
          return (
            <Button key={d.id} help={helpKeyOf(d)} helpLabel={label} className="dsh-short" onClick={() => app.navigate(d.id)}>
              <span className="dsh-short-title">{label}</span>
              <span className="dsh-short-desc">{t(descKeyOf(d))}</span>
            </Button>
          );
        })}
        <Button help="help.shell.palette" helpLabel={t('label.dashboard.palette')} className="dsh-short" kbd="Ctrl K" onClick={() => app.openPalette()}>
          <span className="dsh-short-title">{t('label.dashboard.palette')}</span>
          <span className="dsh-short-desc">{t('label.shell.palette.placeholder')}</span>
        </Button>
      </div>
    </Section>
  );
}

/* ── page ────────────────────────────────────────────────────────────────── */

export default function DashboardPage(_: PageProps) {
  const app = useApp();
  const { t } = useI18n();
  const { refresh } = app;
  /* the numbers stay fresh while the dashboard is open */
  useEffect(() => {
    const id = window.setInterval(() => refresh('server'), SERVER_POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);
  return (
    <div className="dsh">
      <PageActions>
        <Button help="help.common.refresh" icon="refresh" onClick={() => { refresh('server'); refresh('players'); }}>{t('label.dashboard.refresh')}</Button>
      </PageActions>
      <Kpis />
      <div className="dsh-grid">
        <div className="dsh-col">
          <Attention />
          <Recent />
        </div>
        <div className="dsh-col">
          <WorldCard />
          <Shortcuts />
        </div>
      </div>
    </div>
  );
}
