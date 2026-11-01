/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/log/LogPage.tsx
 * Everything staff did from the panel (the server's ring buffer, last 500):
 *   filters   text · kind · staff member · player (citizen id: '12', '#5', an old id) · period
 *   table     when · staff · action · on whom · details · result
 *   drawer    every field + links: open the player (online) · open the character · same staff ·
 *             same player · the script's settings (settings changes)
 *   live      'logEntry' pushes (app.recentLogs) that match the filters appear at the top
 *   paging    "Load older" asks again with before = the oldest id shown
 * post('logs', { q, kind, admin, since, before, limit, target }) → Result<LogPage>
 * `target` (a resolved citizen id) is new: until the server filters by it, the page filters too.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../ctx';
import { useI18n } from '../../i18n';
import {
  Button, ButtonRow, CitizenIdInput, DataTable, Drawer, EmptyState, Field, HelpTip, KeyValue, KeyValueList, PageActions, Section,
  Segmented, Select, SplitView, Tag, TextInput, copyText, fmtAgo, fmtDate, parseCitizen,
} from '../../kit';
import type { CitizenState, Column, Option } from '../../kit';
import { post } from '../../nui';
import type { LogEntry, LogPage, LogQuery } from '../../types';
import { LOG_KINDS, actionLabel, fieldLabel, kindLabel } from './labels';
import ServerLine from './ServerLine';

type Since = 'hour' | 'day' | 'week' | 'all';
const SINCE_SECONDS: Record<Since, number> = { hour: 3600, day: 86400, week: 604800, all: 0 };
const PAGE = 100;

interface Filters { q: string; kind: string; admin: string; target: string; since: Since }
const EMPTY: Filters = { q: '', kind: 'all', admin: 'all', target: '', since: 'all' };

const nowSec = () => Math.floor(Date.now() / 1000);

function useNow(ms = 30000) {
  const [now, setNow] = useState(nowSec);
  useEffect(() => { const id = window.setInterval(() => setNow(nowSec()), ms); return () => window.clearInterval(id); }, [ms]);
  return now;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const id = window.setTimeout(() => setV(value), ms); return () => window.clearTimeout(id); }, [value, ms]);
  return v;
}

/** One detail value as text: numbers stay Latin, objects become short JSON */
function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}

export default function LogPageView() {
  const app = useApp();
  const { t, lang } = useI18n();
  const now = useNow();
  const [f, setF] = useState<Filters>(EMPTY);
  const [targetCid, setTargetCid] = useState<string | null>(null);
  const [list, setList] = useState<LogEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [persisted, setPersisted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  /* hasMore: the last answer was a full page · exact: the server's total is the shown list's total
     (false while the page itself drops lines for the player filter) */
  const [hasMore, setHasMore] = useState(false);
  const [exact, setExact] = useState(true);
  const [selId, setSelId] = useState<number | null>(null);
  const seq = useRef(0);

  const q = useDebounced(f.q, 300);
  const set = (patch: Partial<Filters>) => setF((x) => ({ ...x, ...patch }));

  /* the player filter: a resolved preview, or a typed citizen id the preview could not find (a deleted character) */
  const onTarget = useCallback((s: CitizenState) => {
    const typed = parseCitizen(f.target);
    const id = s.kind === 'found' ? s.preview.citizenid : typed && typed.kind === 'citizen' ? typed.id : null;
    setTargetCid((cur) => (cur === id ? cur : id));
  }, [f.target]);
  useEffect(() => { if (!f.target.trim()) setTargetCid(null); }, [f.target]);

  const query = useMemo((): LogQuery & { target?: string } => {
    const out: LogQuery & { target?: string } = { limit: PAGE };
    if (q.trim()) out.q = q.trim();
    if (f.kind !== 'all') out.kind = f.kind;
    if (f.admin !== 'all') out.admin = f.admin;
    if (f.since !== 'all') out.since = nowSec() - SINCE_SECONDS[f.since];
    if (targetCid) out.target = targetCid;
    return out;
  }, [q, f.kind, f.admin, f.since, targetCid]);

  /* the player filter, checked here too until the server filters by `target` */
  const matchesTarget = useCallback((e: LogEntry) => (
    !query.target || String(e.target?.citizenid ?? '').toUpperCase() === query.target.toUpperCase()
  ), [query.target]);

  /* every filter, for the live pushes (the server already filtered what it answered) */
  const matches = useCallback((e: LogEntry) => {
    if (query.kind && e.kind !== query.kind) return false;
    if (query.admin && e.admin?.name !== query.admin) return false;
    if (query.since && e.at < query.since) return false;
    if (!matchesTarget(e)) return false;
    if (query.q) {
      const s = query.q.toLowerCase();
      const hay = `${e.text} ${e.admin?.name ?? ''} ${e.target?.name ?? ''} ${e.target?.citizenid ?? ''} ${actionLabel(t, e.action)}`.toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  }, [query, matchesTarget, t]);

  const load = useCallback(async (more: boolean) => {
    const my = ++seq.current;
    if (more) setLoadingMore(true); else setError(null);
    const oldest = more && list && list.length ? list[list.length - 1].id : undefined;
    const r = await post<LogPage>('logs', oldest ? { ...query, before: oldest } : query);
    if (my !== seq.current) return;
    setLoadingMore(false);
    if (!r.ok || !r.data || !Array.isArray(r.data.list)) {
      const msg = t(r.error ?? 'ui_failed');
      if (more) app.toast('error', msg);
      else { setError(msg); setList([]); }
      return;
    }
    const raw = r.data.list;
    const got = raw.filter(matchesTarget);
    const cut = got.length !== raw.length;
    setHasMore(raw.length >= (query.limit ?? PAGE));
    setExact((prev) => (more ? prev && !cut : !cut));
    setTotal(typeof r.data.total === 'number' ? r.data.total : got.length);
    setPersisted(!!r.data.persisted);
    setList((cur) => {
      if (!more || !cur) return got;
      const ids = new Set(cur.map((e) => e.id));
      return [...cur, ...got.filter((e) => !ids.has(e.id))];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, matchesTarget, t, list]);

  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => { void loadRef.current(false); }, [query]);

  /* live: new lines pushed while open */
  useEffect(() => {
    if (!list || app.recentLogs.length === 0) return;
    const newest = list.length ? list[0].id : 0;
    const fresh = app.recentLogs.filter((e) => e.id > newest && matches(e));
    if (fresh.length === 0) return;
    setList((cur) => {
      const ids = new Set((cur ?? []).map((e) => e.id));
      const add = fresh.filter((e) => !ids.has(e.id)).sort((a, b) => b.id - a.id);
      return add.length ? [...add, ...(cur ?? [])] : cur;
    });
    setTotal((n) => n + fresh.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.recentLogs]);

  const admins = useMemo(() => {
    const names = new Set<string>();
    for (const e of [...(list ?? []), ...app.recentLogs]) if (e.admin?.name) names.add(e.admin.name);
    if (f.admin !== 'all') names.add(f.admin);
    const opts: Option[] = [{ value: 'all', label: t('label.log.adminAll') }];
    for (const n of Array.from(names).sort((a, b) => a.localeCompare(b))) opts.push({ value: n, label: n });
    return opts;
  }, [list, app.recentLogs, f.admin, t]);

  const kinds = useMemo<Option[]>(() => {
    const extra = new Set<string>();
    for (const e of list ?? []) if (!(LOG_KINDS as readonly string[]).includes(e.kind)) extra.add(e.kind);
    return [
      { value: 'all', label: t('label.log.kind.all') },
      ...[...LOG_KINDS, ...Array.from(extra)].map((k) => ({ value: k, label: kindLabel(t, k) })),
    ];
  }, [list, t]);

  const onlineId = (e: LogEntry): number | null => {
    const cid = e.target?.citizenid;
    if (cid) {
      const p = app.players.find((x) => (x.citizenid || '').toUpperCase() === String(cid).toUpperCase());
      if (p) return p.id;
      return null;
    }
    return null;
  };

  const columns: Column<LogEntry>[] = [
    {
      key: 'when', label: t('label.log.col.when'), help: 'help.log.col.when', width: '9.5rem', sort: true, value: (e) => e.at,
      render: (e) => (
        <>
          <span className="k-cell-main lg-ago">{fmtAgo(t, lang, e.at, now)}</span>
          <span className="k-cell-sub k-num">{fmtDate(e.at)}</span>
        </>
      ),
    },
    {
      key: 'admin', label: t('label.log.col.admin'), help: 'help.log.col.admin', sort: true, value: (e) => e.admin?.name ?? '',
      render: (e) => (
        <>
          <span className="k-cell-main">{e.admin?.name || '—'}</span>
          {e.admin?.citizenid && <span className="k-cell-sub">{t('label.log.cid', e.admin.citizenid)}</span>}
        </>
      ),
    },
    {
      key: 'action', label: t('label.log.col.action'), help: 'help.log.col.action', sort: true, value: (e) => actionLabel(t, e.action),
      render: (e) => (
        <>
          <span className="k-cell-main">{actionLabel(t, e.action)}</span>
          <span className="k-cell-sub">{kindLabel(t, e.kind)}</span>
        </>
      ),
    },
    {
      key: 'target', label: t('label.log.col.target'), help: 'help.log.col.target',
      render: (e) => {
        if (!e.target || (!e.target.citizenid && !e.target.name)) return <span className="k-faint">{t('label.log.serverWide')}</span>;
        const sid = onlineId(e);
        return (
          <>
            <span className="k-cell-main">{e.target.name || e.target.citizenid}</span>
            {e.target.citizenid && (
              <span className="k-cell-sub lg-ids">
                <span>{t('label.log.cid', e.target.citizenid)}</span>
                {sid !== null && <span className="k-num lg-sid">#{sid}</span>}
              </span>
            )}
          </>
        );
      },
    },
    {
      key: 'details', label: t('label.log.col.details'), help: 'help.log.col.details', className: 'lg-wrap', priority: 'detail',
      /* the server writes the line in its own language: dir=auto keeps "Wraith revived سالم (5)" in order */
      render: (e) => <ServerLine className="lg-clamp" text={e.text || '—'} />,
    },
    {
      key: 'result', label: t('label.log.col.result'), help: 'help.log.col.result', width: '6rem', priority: 'detail',
      render: (e) => (e.ok === false ? <Tag tone="danger">{t('label.log.failed')}</Tag> : e.ok === true ? <span className="k-dim">{t('label.log.ok')}</span> : <span className="k-faint">—</span>),
    },
  ];

  const selected = selId === null ? null : (list ?? []).find((e) => e.id === selId) ?? null;
  const filtered = f.q !== '' || f.kind !== 'all' || f.admin !== 'all' || f.target !== '' || f.since !== 'all';
  const clear = () => { setF(EMPTY); setTargetCid(null); };

  const empty = filtered
    ? <EmptyState text={t('label.log.none')} next={<Button help="help.log.clear" size="sm" onClick={clear}>{t('label.log.clear')}</Button>} />
    : <EmptyState text={t('label.log.empty')} />;

  return (
    <SplitView
      className="lg-split"
      list={(
        <>
          <PageActions>
            <Button help="help.common.refresh" icon="refresh" kind="ghost" onClick={() => void load(false)}>{t('label.log.refresh')}</Button>
          </PageActions>
          <div className="lg-filters">
            <Field label={t('label.log.searchLabel')} help="help.log.search" className="lg-f-q">
              <TextInput value={f.q} onChange={(v) => set({ q: v })} icon="search" clearable placeholder={t('label.log.search')} />
            </Field>
            <Field label={t('label.log.kindLabel')} help="help.log.kind" className="lg-f-kind">
              <Select value={f.kind} onChange={(v) => set({ kind: v })} options={kinds} />
            </Field>
            <Field label={t('label.log.adminLabel')} help="help.log.admin" className="lg-f-admin">
              <Select value={f.admin} onChange={(v) => set({ admin: v })} options={admins} />
            </Field>
            <Field label={t('label.log.targetLabel')} help="help.log.target" className="lg-f-target">
              <CitizenIdInput value={f.target} onChange={(v) => set({ target: v })} onResolved={onTarget} placeholder={t('label.log.targetPh')} />
            </Field>
            <Field label={t('label.log.sinceLabel')} help="help.log.since" className="lg-f-since">
              <Segmented
                value={f.since}
                onChange={(v) => set({ since: v })}
                options={(['hour', 'day', 'week', 'all'] as Since[]).map((s) => ({ value: s, label: t(`label.log.since.${s}`) }))}
              />
            </Field>
            {filtered && (
              <span className="lg-f-clear">
                <Button help="help.log.clear" kind="ghost" onClick={clear}>{t('label.log.clear')}</Button>
              </span>
            )}
          </div>
          <div className="lg-meta">
            <span className="lg-live" role="status">
              <i aria-hidden="true" />
              <span>{t('label.log.live')}</span>
              <HelpTip help="help.log.live" label={t('label.log.live')} size="sm" />
            </span>
            {list && <span>{exact ? t('label.log.shownOf', list.length, Math.max(total, list.length)) : t('label.log.count', list.length)}</span>}
            <span className="lg-kept">
              <span>{persisted ? t('label.log.persisted') : t('label.log.kept')}</span>
              <HelpTip help="help.log.kept" label={t('label.log.kept')} size="sm" />
            </span>
          </div>
          <DataTable
            label={t('label.log.listLabel')}
            columns={columns}
            rows={list ?? []}
            rowKey={(e) => e.id}
            selectedKey={selId}
            onSelect={(e) => setSelId(e.id)}
            /* with the drawer open the details live there: the table keeps the columns that fit */
            mode={selected ? 'essential' : 'detail'}
            loading={list === null}
            error={list !== null && list.length === 0 ? error : null}
            onRetry={() => void load(false)}
            empty={empty}
          />
          {list && list.length > 0 && hasMore && (!exact || list.length < total) && (
            <div className="lg-more">
              <Button help="help.log.older" busy={loadingMore} onClick={() => void load(true)}>{t('label.log.older')}</Button>
            </div>
          )}
        </>
      )}
      drawer={selected && (
        <LogDrawer
          e={selected}
          sessionId={onlineId(selected)}
          onClose={() => setSelId(null)}
          onSameAdmin={(name) => set({ admin: name })}
          onSamePlayer={(cid) => { set({ target: cid }); setTargetCid(cid); }}
        />
      )}
    />
  );
}

/* ── drawer ──────────────────────────────────────────────────────────────── */

function LogDrawer({ e, sessionId, onClose, onSameAdmin, onSamePlayer }: {
  e: LogEntry; sessionId: number | null; onClose(): void; onSameAdmin(name: string): void; onSamePlayer(cid: string): void;
}) {
  const app = useApp();
  const { t, lang } = useI18n();
  const cid = e.target?.citizenid ? String(e.target.citizenid) : null;
  const data = e.data && typeof e.data === 'object' ? Object.entries(e.data) : [];
  const hasOldNew = data.some(([k]) => k === 'old') || data.some(([k]) => k === 'new');
  const resource = typeof e.data?.resource === 'string' ? e.data.resource : null;
  return (
    <Drawer
      title={actionLabel(t, e.action)}
      help="help.log.drawer"
      sub={(
        <>
          <span>{kindLabel(t, e.kind)}</span>
          <span className="k-num">{fmtDate(e.at)}</span>
          <span>{fmtAgo(t, lang, e.at)}</span>
        </>
      )}
      chips={e.ok === false ? <Tag tone="danger">{t('label.log.failed')}</Tag> : e.ok === true ? <Tag>{t('label.log.ok')}</Tag> : undefined}
      onClose={onClose}
      footer={sessionId === null && !cid ? undefined : (
        <>
          {sessionId !== null && (
            <Button help="help.log.openPlayer" kind="primary" area="players" onClick={() => app.navigate('players', { sel: String(sessionId) })}>{t('label.log.openPlayer')}</Button>
          )}
          {cid && (
            <Button help="help.log.openCharacter" kind={sessionId === null ? 'primary' : 'secondary'} area="characters" onClick={() => app.navigate('characters', { cid })}>
              {t('label.log.openCharacter')}
            </Button>
          )}
        </>
      )}
    >
      <KeyValueList>
        <KeyValue
          label={t('label.log.d.admin')}
          help="help.log.col.admin"
          value={(
            <span className="lg-kvids">
              <span>{e.admin?.name || '—'}</span>
              {e.admin?.citizenid && <span className="k-dim">{t('label.log.cid', e.admin.citizenid)}</span>}
            </span>
          )}
        />
        <KeyValue
          label={t('label.log.d.target')}
          help="help.log.col.target"
          value={e.target ? (
            <span className="lg-kvids">
              <span>{e.target.name || '—'}</span>
              {cid && <span className="k-dim">{t('label.log.cid', cid)}</span>}
              {sessionId !== null && <span className="k-num k-dim">#{sessionId}</span>}
            </span>
          ) : t('label.log.serverWide')}
          copy={cid ?? undefined}
        />
        <KeyValue label={t('label.log.d.result')} help="help.log.col.result" value={e.ok === false ? t('label.log.failed') : e.ok === true ? t('label.log.ok') : '—'} />
        <KeyValue label={t('label.log.d.id')} help="help.log.col.when" value={String(e.id)} ltr />
      </KeyValueList>

      <Section title={t('label.log.d.text')} help="help.log.col.details" tone="plain" actions={<LineCopy text={e.text} />}>
        <p className="lg-line"><ServerLine text={e.text || '—'} /></p>
      </Section>

      {data.length > 0 && (
        <Section title={t('label.log.d.data')} help="help.log.data" tone="plain">
          {hasOldNew && (
            <p className="lg-change">
              <span className="k-num">{show(e.data?.old)}</span>
              <span aria-hidden="true" className="lg-arrow">{lang === 'ar' ? '←' : '→'}</span>
              <span className="k-num lg-new">{show(e.data?.new)}</span>
            </p>
          )}
          <dl className="lg-data">
            {data.filter(([k]) => k !== 'old' && k !== 'new').map(([k, v]) => (
              <div key={k} className="lg-data-row">
                <dt>{fieldLabel(t, k)}</dt>
                <dd className={typeof v === 'number' ? 'k-num' : undefined}>{show(v)}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}

      <ButtonRow className="lg-links">
        {e.admin?.name && <Button help="help.log.sameAdmin" kind="ghost" size="sm" onClick={() => onSameAdmin(e.admin.name)}>{t('label.log.sameAdmin')}</Button>}
        {cid && <Button help="help.log.samePlayer" kind="ghost" size="sm" onClick={() => onSamePlayer(cid)}>{t('label.log.samePlayer')}</Button>}
        {e.kind === 'settings' && resource && (
          <Button help="help.log.openSettings" kind="ghost" size="sm" area="settings" onClick={() => app.navigate('hub', { resource })}>{t('label.log.openSettings')}</Button>
        )}
      </ButtonRow>
    </Drawer>
  );
}

function LineCopy({ text }: { text: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  if (!text) return null;
  return (
    <Button
      help="help.common.copy"
      kind="ghost"
      size="sm"
      icon={done ? 'check' : 'copy'}
      onClick={() => { if (copyText(text)) { setDone(true); window.setTimeout(() => setDone(false), 1400); } }}
    >
      {done ? t('label.common.copied') : t('label.common.copy')}
    </Button>
  );
}
