/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/perms/PermsPage.tsx  (read only)
 * Who can do what, in plain words:
 *   your level + the level ladder (mod → admin → god, and the server owner)
 *   one table per group of areas: area · what it allows · which levels have it (a lit track) · you
 *   the chat commands with their lowest level
 * Data: levels (Config.PagePerms), actions (Config.ActionPerms), commands (Config.CommandPerms),
 * rank and the perms booleans (the server's own answer for "you"). Nothing here posts anything.
 * An area the server marks 'master' (ranks) sits above god: only the panel's master has it.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useApp } from '../../ctx';
import { useI18n } from '../../i18n';
import type { TFn } from '../../i18n';
import {
  Button, DataTable, EmptyState, FilterChips, Glyph, HelpTip, InlineAlert, Section, Switch, Tag, TextInput, Toolbar, cls, fmtNum,
} from '../../kit';
import type { ChipItem, Column, HelpKey } from '../../kit';
import { LEVELS } from '../../types';
import type { Area, Level, Rank } from '../../types';
import { actionLabel } from '../log/labels';

type GroupId = 'people' | 'player' | 'tools' | 'world' | 'scripts' | 'system' | 'other';
type Filter = 'all' | 'mine' | 'locked';
/** A level as the server may send it: mod · admin · god, or 'master' (above every level: the ranks page) */
type MinLevel = Level | 'master';

/** Every area the panel knows, in reading order, by group */
const GROUPS: { id: Exclude<GroupId, 'other'>; areas: Area[] }[] = [
  { id: 'people', areas: ['players', 'kick', 'ban', 'bans', 'characters', 'citizenId', 'charDelete'] },
  { id: 'player', areas: ['teleport', 'revive', 'needs', 'job', 'money', 'items'] },
  { id: 'tools', areas: ['spawn', 'vehicle', 'entities', 'dev'] },
  { id: 'world', areas: ['server', 'map', 'news'] },
  { id: 'scripts', areas: ['scripts', 'scriptsRun', 'scriptsConsole', 'settings', 'settingsImport', 'hud'] },
  { id: 'system', areas: ['resources', 'logs', 'perms', 'ranks'] },
];
const KNOWN = new Set<string>(GROUPS.flatMap((g) => g.areas));

/** Chat commands that exist for everyone (not in Config.CommandPerms) */
const PUBLIC_COMMANDS = ['report'];

interface Row { area: Area; group: GroupId; min: MinLevel | null; mine: boolean; actions: string[] }
interface CmdRow { key: string; min: Level | null; mine: boolean }

/* the server may call its top rank 'master' (the ranks system): read it as the owner, the top of the ladder */
const isTop = (r: string | null | undefined): boolean => r === 'owner' || r === 'master';
const rankIndex = (r: Rank | null): number => (isTop(r) ? LEVELS.length : r ? LEVELS.indexOf(r as Level) : -1);

/** The levels map value of an area: a known level, 'master', or null */
function minOf(v: string | undefined): MinLevel | null {
  if (v === 'master' || v === 'owner') return 'master';
  return (LEVELS as readonly string[]).includes(v ?? '') ? (v as Level) : null;
}

function known(t: TFn, key: string, fallback: string) {
  const v = t(key);
  return v === key ? fallback : v;
}

export default function PermsPage() {
  const app = useApp();
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [details, setDetails] = useState(false);

  const rank: Rank | null = app.rank ?? (LEVELS.includes(app.admin?.group as Level) ? (app.admin?.group as Level) : null);
  const hasLevels = Object.keys(app.levels).length > 0;

  const areaName = (a: string) => known(t, `label.perms.area.${a}`, a);
  const areaAllows = (a: string) => known(t, `label.perms.allows.${a}`, '');
  const levelName = (lv: Level) => t(`label.perms.levelShort.${lv}`);

  /* area → the "kind.action" ids that need it (Config.ActionPerms) */
  const actionsByArea = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const [kind, map] of Object.entries(app.actions)) {
      for (const [action, area] of Object.entries(map ?? {})) {
        const l = m.get(area) ?? [];
        l.push(`${kind}.${action}`);
        m.set(area, l);
      }
    }
    return m;
  }, [app.actions]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const push = (area: Area, group: GroupId) => out.push({
      area, group, min: minOf((app.levels as Record<string, string | undefined>)[area]), mine: app.can(area), actions: actionsByArea.get(area) ?? [],
    });
    for (const g of GROUPS) for (const a of g.areas) if (!hasLevels || a in app.levels || a in app.perms) push(a, g.id);
    /* areas a newer server sends that this page does not know yet */
    for (const a of Object.keys({ ...app.levels, ...app.perms })) if (!KNOWN.has(a)) push(a as Area, 'other');
    return out;
  }, [app.levels, app.perms, app.can, actionsByArea, hasLevels]);

  const needle = q.trim().toLowerCase();
  const match = (r: Row) => {
    if (filter === 'mine' && !r.mine) return false;
    if (filter === 'locked' && r.mine) return false;
    if (!needle) return true;
    return [areaName(r.area), areaAllows(r.area), r.area, ...r.actions.map((x) => actionLabel(t, x.split('.')[1] ?? x))]
      .some((v) => v.toLowerCase().includes(needle));
  };
  const visible = rows.filter(match);
  const mineCount = rows.filter((r) => r.mine).length;

  const commands = useMemo<CmdRow[]>(() => {
    const ri = rankIndex(rank);
    const list: CmdRow[] = Object.entries(app.commands).map(([key, min]) => ({ key, min, mine: ri >= LEVELS.indexOf(min) }));
    list.sort((a, b) => LEVELS.indexOf(a.min as Level) - LEVELS.indexOf(b.min as Level) || a.key.localeCompare(b.key));
    for (const k of PUBLIC_COMMANDS) if (!(k in app.commands)) list.push({ key: k, min: null, mine: true });
    return list;
  }, [app.commands, rank]);

  const plainActions = (r: Row): ReactNode => {
    if (r.actions.length === 0) return null;
    const names = Array.from(new Set(r.actions.map((x) => actionLabel(t, x.split('.')[1] ?? x))));
    const shown = names.slice(0, 8);
    return (
      <span className="pm-actions">
        <span className="pm-actions-k">{t('label.perms.buttons')}</span>
        <span>{shown.join(' · ')}{names.length > shown.length ? ` ${t('label.perms.more', fmtNum(names.length - shown.length))}` : ''}</span>
      </span>
    );
  };

  const columns: Column<Row>[] = [
    {
      key: 'area', label: t('label.perms.col.area'), help: 'help.perms.col.area', width: '15rem', className: 'pm-areacol',
      render: (r) => (
        <span className="pm-area">
          <span className="k-cell-main">{areaName(r.area)}</span>
          <HelpTip help={`help.perms.area.${r.area}` as HelpKey} label={areaName(r.area)} facts={{ area: r.area }} size="sm" />
          {details && <span className="k-cell-sub pm-key">{r.area}</span>}
        </span>
      ),
    },
    {
      key: 'allows', label: t('label.perms.col.allows'), help: 'help.perms.col.allows', className: 'pm-wrap',
      render: (r) => (
        <>
          <span className="pm-allows">{areaAllows(r.area) || '—'}</span>
          {details && plainActions(r)}
          {details && r.actions.length > 0 && <span className="pm-rawkeys">{r.actions.join('  ')}</span>}
        </>
      ),
    },
    {
      key: 'levels', label: t('label.perms.col.levels'), help: 'help.perms.col.levels', width: '17rem',
      render: (r) => <LevelTrack min={r.min} />,
    },
    {
      key: 'you', label: t('label.perms.col.you'), help: 'help.perms.col.you', width: '10rem',
      render: (r) => <You mine={r.mine} min={r.min} />,
    },
  ];

  const cmdColumns: Column<CmdRow>[] = [
    {
      key: 'command', label: t('label.perms.cmd.command'), help: 'help.perms.cmd.command', width: '11rem',
      render: (c) => <span className="pm-cmd">/{c.key === 'menu' ? 'admin' : c.key}</span>,
    },
    {
      key: 'does', label: t('label.perms.cmd.does'), help: 'help.perms.cmd.does', className: 'pm-wrap',
      render: (c) => known(t, `label.perms.cmd.${c.key}`, '—'),
    },
    {
      key: 'level', label: t('label.perms.cmd.level'), help: 'help.perms.cmd.level', width: '17rem',
      render: (c) => (c.min ? <LevelTrack min={c.min} /> : <Tag>{t('label.perms.cmd.everyone')}</Tag>),
    },
    {
      key: 'you', label: t('label.perms.cmd.you'), help: 'help.perms.cmd.you', width: '10rem',
      render: (c) => <You mine={c.mine} min={c.min} />,
    },
  ];

  const chips: ChipItem<Filter>[] = [
    { id: 'all', label: t('label.perms.filter.all'), count: rows.length, help: 'help.perms.filter.all' },
    { id: 'mine', label: t('label.perms.filter.mine'), count: mineCount, help: 'help.perms.filter.mine' },
    { id: 'locked', label: t('label.perms.filter.locked'), count: rows.length - mineCount, help: 'help.perms.filter.locked' },
  ];

  const sections = [...GROUPS.map((g) => g.id), 'other' as const]
    .map((id) => ({ id, rows: visible.filter((r) => r.group === id) }))
    .filter((s) => s.rows.length > 0);

  const groupHelp = (id: GroupId): HelpKey => (id === 'other' ? 'help.perms.col.area' : (`help.perms.group.${id}` as HelpKey));

  return (
    <div className="pm-page">
      <div className="pm-top">
        <YouCard rank={rank} label={!hasLevels ? app.admin?.group : undefined} mine={mineCount} total={rows.length} />
        {hasLevels && <Ladder rank={rank} />}
      </div>

      <InlineAlert tone="info" title={t('label.perms.readOnlyTitle')} help="help.perms.readOnly">
        {t('label.perms.readOnly')}
      </InlineAlert>
      {!hasLevels && <InlineAlert tone="info">{t('label.perms.noLevels')}</InlineAlert>}

      <Toolbar className="pm-toolbar">
        <TextInput
          value={q}
          onChange={setQ}
          icon="search"
          clearable
          placeholder={t('label.perms.search')}
          label={t('label.perms.search')}
          help="help.perms.search"
          className="pm-search"
        />
        <FilterChips label={t('label.perms.filters')} value={filter} onChange={setFilter} items={chips} />
        <span className="k-push pm-switch">
          <span className="pm-switch-label" aria-hidden="true">{t('label.perms.details')}</span>
          <Switch checked={details} onChange={setDetails} label={t('label.perms.details')} help="help.perms.details" size="sm" />
        </span>
      </Toolbar>

      {sections.length === 0 && (
        <EmptyState
          text={t('label.perms.none')}
          next={<Button help="help.common.search" size="sm" onClick={() => { setQ(''); setFilter('all'); }}>{t('label.perms.clear')}</Button>}
        />
      )}

      {sections.map((s) => (
        <Section key={s.id} className="pm-group" title={t(`label.perms.group.${s.id}`)} help={groupHelp(s.id)}>
          <DataTable label={t(`label.perms.group.${s.id}`)} columns={hasLevels ? columns : columns.filter((c) => c.key !== 'levels')} rows={s.rows} rowKey={(r) => r.area} rowClass={(r) => (r.mine ? undefined : 'pm-row-locked')} />
        </Section>
      ))}

      {commands.length > 0 && (
        <Section className="pm-group" title={t('label.perms.commands')} help="help.perms.commands">
          <DataTable label={t('label.perms.commands')} columns={hasLevels ? cmdColumns : cmdColumns.filter((c) => c.key !== 'level')} rows={commands} rowKey={(c) => c.key} rowClass={(c) => (c.mine ? undefined : 'pm-row-locked')} />
        </Section>
      )}
    </div>
  );
}

/* ── pieces ──────────────────────────────────────────────────────────────── */

/** mod · admin · god, lit from the minimum level up: text + shape, never colour alone.
 *  'master' (above god) is one cell: only the panel's master. */
function LevelTrack({ min }: { min: MinLevel | null }) {
  const { t } = useI18n();
  if (min === 'master') {
    return (
      <span className="pm-track pm-track--top" role="img" aria-label={t('label.perms.masterOnly')}>
        <span className="pm-seg is-on is-min">{t('label.perms.masterOnly')}</span>
      </span>
    );
  }
  const i = min ? LEVELS.indexOf(min) : -1;
  const aria = min ? t('label.perms.minLevel', t(`label.common.level.${min}`)) : t('label.perms.unknownRank');
  return (
    <span className="pm-track" role="img" aria-label={aria}>
      {LEVELS.map((lv, j) => (
        <span key={lv} className={cls('pm-seg', i >= 0 && j >= i && 'is-on', j === i && 'is-min')}>
          {t(`label.perms.levelShort.${lv}`)}
        </span>
      ))}
    </span>
  );
}

function You({ mine, min }: { mine: boolean; min: MinLevel | null }) {
  const { t } = useI18n();
  if (mine) {
    return (
      <span className="pm-you is-yes">
        <i className="k-shape-sq" aria-hidden="true" />
        <span>{t('label.perms.allowed')}</span>
      </span>
    );
  }
  return (
    <span className="pm-you is-no">
      <Glyph name="lock" />
      <span>{min ? t('label.perms.needs', t(`label.perms.levelShort.${min}`)) : t('label.perms.locked')}</span>
    </span>
  );
}

function YouCard({ rank, label, mine, total }: { rank: Rank | null; label?: string; mine: number; total: number }) {
  const { t } = useI18n();
  return (
    <div className="pm-you-card">
      <div className="pm-you-head">
        <span className="pm-cap">{t('label.perms.you')}</span>
        <HelpTip help="help.perms.you" label={t('label.perms.you')} size="sm" />
      </div>
      <div className="pm-you-level">{label || (rank ? t(`label.common.level.${rank}`) : t('label.perms.unknownRank'))}</div>
      <div className="pm-you-count">
        {isTop(rank) ? t('label.perms.ownerAll') : t('label.perms.youCount', fmtNum(mine), fmtNum(total))}
      </div>
      <div className="pm-you-bar" aria-hidden="true"><span style={{ width: `${total ? Math.round((mine / total) * 100) : 0}%` }} /></div>
    </div>
  );
}

function Ladder({ rank }: { rank: Rank | null }) {
  const { t } = useI18n();
  const steps: Rank[] = [...LEVELS, 'owner'];
  return (
    <div className="pm-ladder">
      <div className="pm-you-head">
        <span className="pm-cap">{t('label.perms.ladder')}</span>
        <HelpTip help="help.common.level" label={t('label.perms.ladder')} size="sm" />
      </div>
      <ol className="pm-steps">
        {steps.map((lv, i) => {
          const here = rank === lv || (lv === 'owner' && isTop(rank));
          const reached = rankIndex(rank) >= i;
          return (
            <li key={lv} className={cls('pm-step', here && 'is-here', reached && 'is-reached', lv === 'owner' && 'is-owner')}>
              <span className="pm-step-top">
                <span className="pm-step-name">{t(`label.common.level.${lv}`)}</span>
                <HelpTip help={`help.perms.level.${lv}` as HelpKey} label={t(`label.common.level.${lv}`)} size="sm" />
              </span>
              <span className="pm-step-line">{lv === 'owner' ? t('label.perms.ownerAll') : t(`label.perms.levelLine.${lv}`)}</span>
              {here && <span className="pm-here">{t('label.perms.youHere')}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
