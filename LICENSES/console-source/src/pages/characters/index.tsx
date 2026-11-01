/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/characters: every character of the server by CITIZEN ID, online or not
 * (server/sv_characters.lua). The list at the reading start, the picked character's file at the end,
 * each scrolling on its own. The file has six tabs:
 *   Profile    ids, state, account, job, balances, the account's other characters
 *   Links      where its data lives, in plain groups by what a deletion does (raw tables behind a toggle)
 *   Money & job  money / item / job / gang: live when online, on the saved data when not
 *   Access     block (with a reason the player sees) / unblock
 *   Citizen ID change the number (offline only) · hand the number to another character in one step
 *   Delete     what a deletion would do, the last refusal, type-to-confirm
 * The answers of the last deletion and transfer stay over the list until dismissed (Reports.tsx).
 * Route params: { cid } opens a character (the command palette, the players page), { view } a tab.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { definePage } from '../../app/pages';
import type { PageProps } from '../../app/pages';
import { useApp } from '../../ctx';
import { useI18n } from '../../i18n';
import {
  Button, DataTable, Drawer, EmptyState, FilterChips, Segmented, Skeleton, SplitView, StatusChip, TextInput, Toolbar, parseCitizen,
} from '../../kit';
import type { ChipItem, Column, TabItem } from '../../kit';
import type { Result } from '../../types';
import { useCharacterFlows } from './flows';
import { isTab, list, normalizeDetail } from './model';
import type { CharDetail, CharRow, Filter, TabId } from './model';
import { DeletedReport, MovedReport } from './Reports';
import { OnlineChip, fmtSeen } from './shared';
import type { TabProps } from './shared';
import Access from './tabs/Access';
import Danger from './tabs/Danger';
import Economy from './tabs/Economy';
import Identity from './tabs/Identity';
import Links from './tabs/Links';
import Overview from './tabs/Overview';
import './characters.css';

/** Numbers first in numeric order (2 before 10), then the old ids (OMG95204) */
const byId = (a: CharRow, b: CharRow) => {
  const na = /^\d+$/.test(a.citizenid) ? Number(a.citizenid) : Number.MAX_SAFE_INTEGER;
  const nb = /^\d+$/.test(b.citizenid) ? Number(b.citizenid) : Number.MAX_SAFE_INTEGER;
  return na - nb || a.citizenid.localeCompare(b.citizenid);
};

const rowOf = (r: CharRow): CharRow => ({ ...r, citizenid: String(r.citizenid), name: r.name || String(r.citizenid) });

function CharactersPage({ route }: PageProps) {
  const { t } = useI18n();
  const { act, toast, navigate, prefs, setPrefs } = useApp();

  /* ── the list ──────────────────────────────────────────────────────── */
  const [q, setQ] = useState(() => route.params.q ?? '');
  const [rows, setRows] = useState<CharRow[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const qRef = useRef(q);
  qRef.current = q;
  const searchSeq = useRef(0);

  const search = useCallback(async (needle?: string) => {
    const my = ++searchSeq.current;
    const r = await act<CharRow[]>('characters', { action: 'search', q: (needle ?? qRef.current).trim() }, { silent: true });
    if (my !== searchSeq.current) return;
    setRows(r.ok ? list<CharRow>(r.data).map(rowOf) : []);
    setListError(r.ok ? null : (r.error ?? t('ui_failed')));
  }, [act, t]);
  // the list follows the search box (a short pause after typing)
  useEffect(() => { const h = window.setTimeout(() => void search(q), 250); return () => window.clearTimeout(h); }, [q, search]);

  /* ── the drawer ────────────────────────────────────────────────────── */
  const [picked, setPicked] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('overview');
  const [detail, setDetail] = useState<CharDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const pickedRef = useRef(picked);
  pickedRef.current = picked;
  const loadSeq = useRef(0);

  const load = useCallback(async (citizenid: string) => {
    const my = ++loadSeq.current;
    setLoading(true);
    const r = await act<CharDetail>('characters', { action: 'get', citizenid });
    if (my !== loadSeq.current) return;
    setLoading(false);
    if (r.ok && r.data) setDetail(normalizeDetail(r.data as CharDetail));
    else setDetail(null);
  }, [act]);

  const open = useCallback((citizenid: string, view?: TabId) => {
    const id = String(citizenid);
    setTab(view ?? 'overview');
    if (id === pickedRef.current) { void load(id); return; }
    setPicked(id);
  }, [load]);
  const close = useCallback(() => { loadSeq.current++; setPicked(null); setDetail(null); setLoading(false); }, []);

  useEffect(() => {
    setDetail(null);
    if (picked) void load(picked);
  }, [picked, load]);

  /* the route: { q } fills the search (a ban's "this account's characters") */
  useEffect(() => {
    if (route.params.q !== undefined) setQ(route.params.q);
  }, [route.params.q]);

  /* the route: { cid } opens a character (palette, players page), { view } one of its tabs */
  useEffect(() => {
    const raw = route.params.cid;
    if (!raw) return;
    const parsed = parseCitizen(raw);
    open(parsed && parsed.kind === 'citizen' ? parsed.id : raw.trim().toUpperCase(), isTab(route.params.view) ? route.params.view : undefined);
  }, [route.params.cid, route.params.view, open]);

  /* ── the long jobs and the reports ─────────────────────────────────── */
  const flows = useCharacterFlows({
    act, toast, t, search: () => search(), load, open, current: () => pickedRef.current, close,
  });

  const run = useCallback(async (action: string, data: Record<string, unknown>, okText?: string): Promise<Result<Record<string, unknown>> | null> => {
    const id = pickedRef.current;
    if (!id) return null;
    flows.mark(action, true);
    try {
      return await act<Record<string, unknown>>('characters', { action, citizenid: id, ...data }, { okText });
    } finally { flows.mark(action, false); }
  }, [act, flows.mark]); // eslint-disable-line react-hooks/exhaustive-deps

  const after = useCallback(async (r: { ok: boolean } | null, citizenid?: string) => {
    const id = citizenid ?? pickedRef.current;
    if (!r?.ok || !id) return;
    await search();
    if (pickedRef.current === id) await load(id);
  }, [search, load]);

  /* ── list view ─────────────────────────────────────────────────────── */
  const counts = useMemo(() => {
    const all = rows ?? [];
    return {
      all: all.length,
      online: all.filter((r) => !!r.online).length,
      offline: all.filter((r) => !r.online).length,
      blocked: all.filter((r) => !!r.blocked).length,
    };
  }, [rows]);
  const shown = useMemo(() => (rows ?? []).filter((r) =>
    filter === 'all' || (filter === 'online' && !!r.online) || (filter === 'offline' && !r.online) || (filter === 'blocked' && !!r.blocked)), [rows, filter]);

  const chips: ChipItem<Filter>[] = [
    { id: 'all', label: t('label.characters.filter.all'), count: counts.all, help: 'help.characters.filterAll' },
    { id: 'online', label: t('label.characters.filter.online'), count: counts.online, help: 'help.characters.filterOnline' },
    { id: 'offline', label: t('label.characters.filter.offline'), count: counts.offline, help: 'help.characters.filterOffline' },
    { id: 'blocked', label: t('label.characters.filter.blocked'), count: counts.blocked, help: 'help.characters.filterBlocked' },
  ];

  const columns = useMemo<Column<CharRow>[]>(() => [
    {
      key: 'cid', label: t('ui_ch_col_id'), help: 'help.characters.colId', sort: byId, width: '8.5rem',
      render: (r) => (
        <span className="ch-idcell">
          <b className="k-num">{r.citizenid}</b>
          {r.online ? <span className="k-num ch-sid">#{r.online}</span> : null}
        </span>
      ),
    },
    {
      key: 'name', label: t('ui_ch_col_name'), help: 'help.characters.colName', sort: true, value: (r) => r.name,
      render: (r) => <><span className="k-cell-main">{r.name}</span><span className="k-cell-sub">{r.account || ''}</span></>,
    },
    { key: 'job', label: t('ui_ch_col_job'), help: 'help.characters.colJob', sort: true, value: (r) => r.job ?? '', render: (r) => r.job || '—' },
    {
      key: 'state', label: t('ui_ch_col_state'), help: 'help.characters.colState',
      render: (r) => (
        <span className="ch-state">
          <OnlineChip online={r.online} />
          {r.blocked ? <StatusChip status="blocked" label={t('ui_ch_blocked')} /> : null}
        </span>
      ),
    },
    {
      key: 'last', label: t('ui_ch_col_last'), help: 'help.characters.colLast', sort: true, value: (r) => r.lastSeen ?? '',
      render: (r) => <span className="k-num">{fmtSeen(r.lastSeen)}</span>,
    },
    { key: 'license', priority: 'detail', label: t('ui_ch_license'), help: 'help.characters.colLicense', render: (r) => <span className="k-mono ch-license">{r.license || '—'}</span> },
    { key: 'slot', priority: 'detail', num: true, label: t('ui_ch_slot'), help: 'help.characters.colSlot', render: (r) => <span className="k-num">{r.slot ?? '—'}</span> },
  ], [t]);

  const listPane = (
    <>
      <Toolbar className="ch-toolbar">
        <TextInput
          value={q}
          onChange={setQ}
          placeholder={t('ui_ch_search')}
          icon="search"
          clearable
          label={t('label.common.search')}
          help="help.characters.search"
          className="ch-search"
        />
        <Button help="help.common.refresh" kind="ghost" size="sm" icon="refresh" onClick={() => void search()}>{t('ui_refresh')}</Button>
      </Toolbar>
      <Toolbar className="ch-toolbar ch-toolbar--sub">
        <FilterChips label={t('label.characters.filter.label')} value={filter} onChange={setFilter} items={chips} />
        <span className="k-push ch-count">{t('ui_ch_count', shown.length)}</span>
        <Segmented
          value={prefs.tableMode}
          onChange={(v) => setPrefs({ tableMode: v })}
          options={[{ value: 'essential', label: t('label.common.essential') }, { value: 'detail', label: t('label.common.detail') }]}
          size="sm"
          label={`${t('label.common.essential')} / ${t('label.common.detail')}`}
          help="help.common.density"
        />
      </Toolbar>

      {(flows.deleted || flows.moved) && (
        <div className="ch-reports">
          {flows.deleted && <DeletedReport deleted={flows.deleted} onDismiss={() => flows.setDeleted(null)} />}
          {flows.moved && <MovedReport moved={flows.moved} onDismiss={() => flows.setMoved(null)} open={open} />}
        </div>
      )}

      <DataTable
        className="ch-table"
        label={t('label.characters.table')}
        columns={columns}
        rows={shown}
        rowKey={(r) => r.citizenid}
        selectedKey={picked}
        onSelect={(r) => open(r.citizenid)}
        mode={prefs.tableMode}
        density={prefs.density}
        loading={rows === null && !listError}
        error={listError}
        onRetry={() => void search()}
        empty={(
          <EmptyState
            text={t('ui_ch_none')}
            next={q || filter !== 'all' ? (
              <Button help="help.characters.clearSearch" size="sm" onClick={() => { setQ(''); setFilter('all'); }}>{t('label.characters.clearSearch')}</Button>
            ) : undefined}
          />
        )}
      />
    </>
  );

  /* ── the drawer ────────────────────────────────────────────────────── */
  const tabs: TabItem<TabId>[] = [
    { id: 'overview', label: t('label.characters.tab.overview'), help: 'help.characters.tabOverview' },
    { id: 'links', label: t('label.characters.tab.links'), help: 'help.characters.tabLinks' },
    { id: 'economy', label: t('label.characters.tab.economy'), help: 'help.characters.tabEconomy' },
    { id: 'access', label: t('label.characters.tab.access'), help: 'help.characters.tabAccess' },
    { id: 'identity', label: t('label.characters.tab.identity'), help: 'help.characters.tabIdentity' },
    { id: 'danger', label: t('label.characters.tab.danger'), help: 'help.characters.tabDanger' },
  ];

  let drawer: JSX.Element | null = null;
  if (detail && detail.citizenid === picked) {
    const props: TabProps = { detail, flows, run, after, open, search: () => search() };
    const body = tab === 'links' ? <Links {...props} />
      : tab === 'economy' ? <Economy {...props} />
      : tab === 'access' ? <Access {...props} />
      : tab === 'identity' ? <Identity {...props} />
      : tab === 'danger' ? <Danger {...props} />
      : <Overview {...props} />;
    drawer = (
      <Drawer<TabId>
        className="ch-drawer"
        title={detail.name}
        help="help.characters.drawer"
        sub={(
          <>
            <span>{t('ui_ch_col_id')} <b className="k-num">{detail.citizenid}</b></span>
            {detail.online ? <span className="k-num">#{detail.online}</span> : null}
            {detail.account ? <span>{detail.account}</span> : null}
          </>
        )}
        chips={(
          <>
            <OnlineChip online={detail.online} />
            {detail.block ? <StatusChip status="blocked" label={t('ui_ch_blocked')} /> : null}
          </>
        )}
        tabs={tabs}
        tab={tab}
        onTab={setTab}
        tabsLabel={t('label.characters.tabs')}
        onClose={close}
        footer={(
          <>
            <Button help="help.characters.openPlayer" area="players" icon="people" disabled={!detail.online}
              onClick={() => { if (detail.online) navigate('players', { sel: String(detail.online) }); }}>
              {t('label.characters.openPlayer')}
            </Button>
            <Button help="help.characters.reload" kind="ghost" icon="refresh" busy={loading} onClick={() => void load(detail.citizenid)}>
              {t('label.characters.reload')}
            </Button>
          </>
        )}
      >
        {/* keyed by the character: a form never carries over to another one */}
        <div key={`${detail.citizenid}:${tab}`} className="ch-body">{body}</div>
      </Drawer>
    );
  } else if (picked) {
    drawer = (
      <Drawer className="ch-drawer" title={picked} help="help.characters.drawer" onClose={close}>
        {loading ? <Skeleton rows={8} /> : <EmptyState text={t('err_char_not_found')} />}
      </Drawer>
    );
  }

  return <SplitView className="ch-page" list={listPane} drawer={drawer} />;
}

export const page = definePage({
  id: 'characters',
  section: 'people',
  order: 20,
  glyph: 'card',
  area: 'characters',
  layout: 'fill',
  component: CharactersPage,
  refresh: ['catalog'],
});
