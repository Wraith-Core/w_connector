/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/ranks/StaffView.tsx
 * The Staff tab:
 *   Give a rank   an online player (STATE.online: name · #id · citizen id) or an identifier
 *                 (license: / steam:, with an optional name for someone offline), then the rank
 *   the members   name + identifier, online state, their ranks as coloured chips (× takes one away,
 *                 a lock when the server config holds it), and a compact "give" per row
 * A rank with a dangerous permission (or the master rank) asks before it is given.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../ctx';
import { useI18n } from '../../i18n';
import {
  Button, Combobox, DataTable, EmptyState, Field, FilterChips, Glyph, HelpTip, IconButton, Section, Segmented, Select, SplitView,
  StatusChip, TextInput, Toolbar, cls, fmtNum,
} from '../../kit';
import type { ChipItem, Column, Option } from '../../kit';
import type { Send } from './RanksPage';
import { IDENT_RE, isPowerful, nodeIndex, safeColor } from './model';
import type { MemberRow, RankRow, RanksState } from './model';

type Source = 'online' | 'identifier';
type Filter = 'all' | 'online' | 'offline';
type Target = { source: number } | { identifier: string; name?: string };

export default function StaffView({ st, send, pick }: { st: RanksState; send: Send; pick: { player: string } | null }) {
  const app = useApp();
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [source, setSource] = useState<Source>('online');
  const [pid, setPid] = useState(pick?.player ?? '');
  const [ident, setIdent] = useState('');
  const [idName, setIdName] = useState('');
  const [rank, setRank] = useState('');
  const [rowRank, setRowRank] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  /* the player file links here with { player: <server id> } */
  useEffect(() => {
    if (!pick) return;
    setSource('online');
    setPid(pick.player);
  }, [pick]);

  const nodes = useMemo(() => nodeIndex(st.catalog), [st.catalog]);
  const byName = useMemo(() => new Map(st.ranks.map((r) => [r.name, r])), [st.ranks]);
  const rankName = (n: string) => byName.get(n)?.label || n;

  /* ── giving ────────────────────────────────────────────────────────────── */

  const assign = async (rk: string, target: Target, key: string): Promise<boolean> => {
    setBusy(key);
    const r = await send({ action: 'assign', rank: rk, target });
    setBusy(null);
    return r.ok;
  };

  /** Gives at once, or asks first when the rank is powerful */
  const give = (rk: string, target: Target, who: string, key: string, after: () => void) => {
    const row = byName.get(rk);
    if (!isPowerful(row, nodes)) {
      void assign(rk, target, key).then((ok) => { if (ok) after(); });
      return;
    }
    app.confirm({
      title: t('label.ranks.staff.giveTitle', rankName(rk), who),
      help: 'help.ranks.staff.confirmGive',
      danger: true,
      undoable: true,
      text: <p>{t('label.ranks.staff.giveText')}</p>,
      confirmLabel: t('label.ranks.staff.giveConfirm'),
      onConfirm: async () => {
        if (!(await assign(rk, target, key))) return false;
        after();
        return undefined;
      },
    });
  };

  const askRevoke = (m: MemberRow, rk: string) => app.confirm({
    title: t('label.ranks.staff.revokeTitle', rankName(rk), m.name || m.identifier),
    help: 'help.ranks.staff.confirmRevoke',
    text: <p>{t('label.ranks.staff.revokeText')}</p>,
    confirmLabel: t('label.ranks.staff.revokeConfirm'),
    onConfirm: async () => {
      setBusy(`revoke:${m.identifier}`);
      const r = await send({ action: 'revoke', rank: rk, identifier: m.identifier });
      setBusy(null);
      return r.ok ? undefined : false;
    },
  });

  /* ── the "give a rank" form ────────────────────────────────────────────── */

  const chosen = source === 'online' ? st.online.find((p) => String(p.id) === pid) ?? null : null;
  const typedId = ident.trim();
  const identErr = typedId && !IDENT_RE.test(typedId) ? t('label.ranks.staff.identifierBad') : null;
  const known = source === 'identifier' && typedId ? st.members.find((m) => m.identifier === typedId) ?? null : null;
  const holds = source === 'online' ? chosen?.ranks ?? [] : known?.ranks ?? [];
  const already = !!rank && holds.includes(rank);
  const ready = !!rank && !already && !busy && (source === 'online' ? !!chosen : !!typedId && !identErr);

  const submit = () => {
    if (!ready) return;
    if (source === 'online' && chosen) {
      give(rank, { source: chosen.id }, chosen.name || `#${chosen.id}`, 'give', () => setRank(''));
    } else if (source === 'identifier') {
      const name = idName.trim();
      give(rank, name ? { identifier: typedId, name } : { identifier: typedId }, name || typedId, 'give', () => { setIdent(''); setIdName(''); setRank(''); });
    }
  };

  const playerOpts: Option[] = st.online.map((p) => ({
    value: String(p.id),
    label: p.name || `#${p.id}`,
    sub: t('label.ranks.staff.playerSub', String(p.id), p.citizenid || '—'),
  }));
  const rankOpts = (except: string[] = []): Option[] => st.ranks
    .filter((r) => !except.includes(r.name))
    .map((r) => ({ value: r.name, label: r.label || r.name, sub: r.name }));

  /* ── the members ───────────────────────────────────────────────────────── */

  const counts = useMemo(() => {
    const on = st.members.filter((m) => m.online !== false).length;
    return { all: st.members.length, online: on, offline: st.members.length - on };
  }, [st.members]);

  const needle = q.trim().toLowerCase();
  const rows = st.members.filter((m) => {
    if (filter === 'online' && m.online === false) return false;
    if (filter === 'offline' && m.online !== false) return false;
    if (!needle) return true;
    return [m.name, m.identifier, ...m.ranks, ...m.ranks.map(rankName)].some((s) => s.toLowerCase().includes(needle));
  });

  const giveRow = (m: MemberRow) => {
    const rk = rowRank[m.identifier];
    if (!rk) return;
    const target: Target = m.online !== false ? { source: m.online } : { identifier: m.identifier, name: m.name || undefined };
    give(rk, target, m.name || m.identifier, `row:${m.identifier}`, () => setRowRank((x) => ({ ...x, [m.identifier]: '' })));
  };

  const columns: Column<MemberRow>[] = [
    {
      key: 'name', label: t('label.ranks.staff.col.name'), help: 'help.ranks.staff.col.name', sort: true, value: (m) => m.name.toLowerCase(),
      render: (m) => (
        <>
          <span className="k-cell-main" dir="auto">{m.name || '—'}</span>
          <span className="k-cell-sub rk-ident">{m.identifier}</span>
        </>
      ),
    },
    {
      key: 'online', label: t('label.ranks.staff.col.online'), help: 'help.ranks.staff.col.online', sort: true, width: '9rem',
      value: (m) => (m.online === false ? 0 : 1),
      render: (m) => (m.online !== false
        ? <StatusChip status="online" label={t('label.ranks.staff.online', String(m.online))} />
        : <StatusChip status="offline" />),
    },
    {
      key: 'ranks', label: t('label.ranks.staff.col.ranks'), help: 'help.ranks.staff.col.ranks', className: 'rk-wrap',
      render: (m) => (
        <span className="rk-chips">
          {m.ranks.map((rk) => (
            <RankChip
              key={rk}
              row={byName.get(rk)}
              name={rk}
              locked={m.locked.includes(rk)}
              disabled={!!busy}
              onRevoke={() => askRevoke(m, rk)}
            />
          ))}
        </span>
      ),
    },
    {
      key: 'give', label: t('label.ranks.staff.col.give'), help: 'help.ranks.staff.col.give', className: 'rk-givecell', width: '1%',
      render: (m) => {
        const opts = rankOpts(m.ranks);
        return (
          <span className="rk-rowgive">
            <Select
              value={rowRank[m.identifier] ?? ''}
              onChange={(v) => setRowRank((x) => ({ ...x, [m.identifier]: v }))}
              options={opts}
              placeholder={t('label.ranks.staff.pick')}
              label={t('label.ranks.staff.col.give')}
              help={false}
              size="sm"
              disabled={opts.length === 0 || !!busy}
              className="rk-rowselect"
            />
            <Button
              help="help.ranks.staff.giveBtn"
              helpQuiet
              size="sm"
              kind="ghost"
              disabled={!rowRank[m.identifier] || !!busy}
              busy={busy === `row:${m.identifier}`}
              onClick={() => giveRow(m)}
            >
              {t('label.ranks.staff.rowGive')}
            </Button>
          </span>
        );
      },
    },
  ];

  const chips: ChipItem<Filter>[] = [
    { id: 'all', label: t('label.ranks.staff.filter.all'), count: counts.all, help: 'help.ranks.staff.filter.all' },
    { id: 'online', label: t('label.ranks.staff.filter.online'), count: counts.online, help: 'help.ranks.staff.filter.online' },
    { id: 'offline', label: t('label.ranks.staff.filter.offline'), count: counts.offline, help: 'help.ranks.staff.filter.offline' },
  ];

  const empty = st.members.length === 0
    ? <EmptyState text={t('label.ranks.staff.none')} next={<span className="k-faint">{t('label.ranks.staff.noneNext')}</span>} />
    : (
      <EmptyState
        text={t('label.ranks.staff.noMatch')}
        next={(needle || filter !== 'all') && <Button help="help.common.search" size="sm" onClick={() => { setQ(''); setFilter('all'); }}>{t('label.ranks.staff.clear')}</Button>}
      />
    );

  const list = (
    <>
      <Section title={t('label.ranks.staff.give')} help="help.ranks.staff.give" className="rk-give">
        <div className="rk-give-grid">
          <Field label={t('label.ranks.staff.sourceLabel')} help="help.ranks.staff.source">
            <Segmented
              value={source}
              onChange={setSource}
              options={[
                { value: 'online', label: t('label.ranks.staff.from.online') },
                { value: 'identifier', label: t('label.ranks.staff.from.identifier') },
              ]}
            />
          </Field>
          {source === 'online' ? (
            <Field
              label={t('label.ranks.staff.player')}
              help="help.ranks.staff.player"
              required
              hint={chosen ? <RanksLine names={chosen.ranks} byName={byName} /> : undefined}
            >
              <Combobox
                value={chosen ? pid : ''}
                onChange={setPid}
                options={playerOpts}
                placeholder={st.online.length ? t('label.ranks.staff.playerPh') : t('label.ranks.staff.noOnline')}
                disabled={st.online.length === 0}
              />
            </Field>
          ) : (
            <>
              <Field
                label={t('label.ranks.staff.identifier')}
                help="help.ranks.staff.identifier"
                required
                error={identErr}
                hint={known ? <RanksLine names={known.ranks} byName={byName} /> : undefined}
              >
                <TextInput value={ident} onChange={setIdent} dir="ltr" mono maxLength={80} placeholder="123456789012345678" invalid={!!identErr} />
              </Field>
            </>
          )}
          <Field label={t('label.ranks.staff.rank')} help="help.ranks.staff.rank" required hint={already ? t('label.ranks.staff.already') : undefined}>
            <Select value={rank} onChange={setRank} options={rankOpts()} placeholder={t('label.ranks.staff.rankPh')} />
          </Field>
          <div className="rk-give-go">
            <Button help="help.ranks.staff.giveBtn" kind="primary" icon="plus" disabled={!ready} busy={busy === 'give'} onClick={submit}>
              {t('label.ranks.staff.giveBtn')}
            </Button>
          </div>
        </div>
      </Section>

      <Toolbar className="rk-toolbar rk-stafftools">
        <TextInput
          value={q}
          onChange={setQ}
          icon="search"
          clearable
          placeholder={t('label.ranks.staff.search')}
          label={t('label.ranks.staff.search')}
          help="help.ranks.staff.search"
          className="rk-search"
        />
        <FilterChips label={t('label.ranks.staff.filters')} value={filter} onChange={setFilter} items={chips} />
        <span className="rk-count k-push">{t('label.ranks.staff.showing', fmtNum(rows.length), fmtNum(st.members.length))}</span>
      </Toolbar>
      <DataTable
        label={t('label.ranks.staff.listLabel')}
        columns={columns}
        rows={rows}
        rowKey={(m) => m.identifier}
        mode="detail"
        density={app.prefs.density}
        empty={empty}
        rowClass={(m) => (m.online === false ? 'rk-row-off' : undefined)}
      />
    </>
  );

  return <SplitView className="rk-split rk-split--staff" list={list} />;
}

/* ── pieces ──────────────────────────────────────────────────────────────── */

function RankChip({ row, name, locked, disabled, onRevoke }: { row: RankRow | undefined; name: string; locked: boolean; disabled: boolean; onRevoke(): void }) {
  const { t } = useI18n();
  const label = row?.label || name;
  return (
    <span className={cls('rk-chip', locked && 'is-locked')}>
      <i className="rk-dot" style={{ background: safeColor(row?.color ?? '') }} aria-hidden="true" />
      <span className="rk-chip-name" dir="auto">{label}</span>
      {locked ? (
        <>
          <span className="rk-chip-lock" title={t('label.ranks.staff.locked')}><Glyph name="lock" /></span>
          <HelpTip help="help.ranks.staff.locked" label={t('label.ranks.staff.locked')} size="sm" className="k-help--quiet" />
        </>
      ) : (
        <IconButton icon="close" size="sm" aria-label={t('label.ranks.staff.revoke', label)} help="help.ranks.staff.revoke" helpQuiet disabled={disabled} onClick={onRevoke} />
      )}
    </span>
  );
}

function RanksLine({ names, byName }: { names: string[]; byName: Map<string, RankRow> }) {
  const { t } = useI18n();
  if (names.length === 0) return <span>{t('label.ranks.staff.noRanks')}</span>;
  return (
    <span className="rk-hasranks">
      <span>{t('label.ranks.staff.hasRanks')}</span>
      {names.map((n) => (
        <span key={n} className="rk-mini">
          <i className="rk-dot" style={{ background: safeColor(byName.get(n)?.color ?? '') }} aria-hidden="true" />
          <span dir="auto">{byName.get(n)?.label || n}</span>
        </span>
      ))}
    </span>
  );
}
