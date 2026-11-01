/* ════════════════════════════════════════════════════════════════════════════
 * Characters: every character of the server by CITIZEN ID, online or not (server/sv_characters.lua).
 * The table on one side, the picked character's panel on the other: its details, where it is linked
 * in the database (grouped: identity, own data, assets, history, each with what a deletion does to
 * it), and the actions -- suspend, change the citizen ID, delete, money / item / job / gang (live when
 * online, on the saved data when not).
 * Delete: w_core purges EVERY resource (own data deleted, assets released back to the game, money to
 * the reserve, history relabelled 'deleted-<id>-<time>'); the page then shows the report it returned
 * (records, money and notes apart; a warning when something is still under the number), or the
 * resource that refused, its reason and what stands in the way. A purge can outlast the panel's 30 s
 * call (an online character's logout, every resource): the page then asks for the answer
 * ('deleteStatus') instead of reporting a failure.
 * Transfer ("give this ID to another character"): staff previews the character that takes the
 * picked character's number and types the number to confirm; w_core moves the holder to a fresh
 * number with everything it has, then the other character onto the number with everything it has.
 * A half-done transfer (the holder moved, the other did not) is shown over the list, never lost.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../ctx';
import { useT } from '../i18n';
import type { Result } from '../types';
import { Button, Empty, Field, Input, Loading, NumberInput, Section, Select, Tag } from '../ui/controls';
import { cls, fmtNum } from '../ui/util';

interface CharRow {
  citizenid: string; name: string; account?: string; license?: string; slot?: number; lastSeen?: string
  job?: string; online?: number | null; blocked?: string | boolean | null
}
/** kind: core | data | asset | history today; w_core may grow others, shown under 'other' */
interface Dep { table: string; column: string; kind: string; rows: number; shaped?: boolean }
interface CharDetail extends CharRow {
  gang?: string; block?: { reason?: string; blocked_by?: string; blocked_at?: number } | null
  dependencies: Dep[]; money: { id: string; balance: number; currency: string }[]; siblings: { citizenid: string; name: string }[]
}
/** Money a deletion returned to the reserve, in dollars / gold */
interface Money { USD?: number; GOLD?: number }
/** One resource's part of a deletion (sv_characters.lua reportList): records removed, money, its own notes */
interface ReportEntry { resource: string; total: number; items: { name: string; count: number }[]; money?: Money; notes?: string }
interface DeleteAnswer {
  citizenid?: string; report?: ReportEntry[]; total?: number; tombstone?: string; money?: Money
  /** false: something is still filed under the number (leftovers says what); w_core retries once by itself */
  clean?: boolean; leftovers?: string
  // a refusal: the resource that refused ('w_core' for its own reasons), its words, the locale key when
  // known, and what stands in the way (the assets not released, the accounts still funded)
  resource?: string; reason?: string; reasonKey?: string; detail?: string
  /** the panel's call gave up (30 s) while the server still deletes: the answer is asked for again */
  timedOut?: boolean
}
/** A server answer as 'deleteStatus' / 'transferStatus' keeps it (locale keys, not texts) */
interface RawAnswer<T> { ok: boolean; error?: string; data?: T }
/** The last deletion, shown over the list until dismissed. missing: deleted, but the answer never came back */
interface Deleted {
  citizenid: string; name: string; report: ReportEntry[]; total: number; money?: Money; tombstone?: string
  clean: boolean; leftovers?: string; missing?: boolean
}
/** A number transfer's answer (sv_characters.lua transfer); movedTo on a refusal: half done */
interface TransferAnswer {
  number?: string; movedTo?: string; freed?: string; aName?: string; bName?: string; target?: string
  reason?: string; reasonKey?: string; detail?: string; timedOut?: boolean
}
/** The last transfer, shown over the list until dismissed. done false: the holder moved, the other did not */
interface Moved {
  number: string; aName: string; bName: string; target: string; movedTo?: string
  done: boolean; text?: string; detail?: string
}
/** How long the page keeps asking for a deletion's answer after its call timed out */
const STATUS_TRIES = 40;
const STATUS_EVERY_MS = 3000;
/** The page's call gave up while the server may still work on it: the answer is asked for again.
 *  timedOut: w_lib's 30 s callback limit; ui_net_error: the page's own request to the game failed. */
const lateAnswer = (r: { ok: boolean; error?: string; data?: unknown }) =>
  !r.ok && (((r.data as { timedOut?: boolean } | undefined)?.timedOut === true) || r.error === 'ui_net_error');
const newToken = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
/** A sequential citizen id (w_core C.IsNumeric): the only kind of id a transfer hands on */
const NUMERIC_ID = /^[1-9]\d{0,8}$/;

const KINDS = ['core', 'data', 'asset', 'history'];
const KIND_TONE: Record<string, 'plain' | 'bad' | 'dim'> = { core: 'bad', data: 'bad', asset: 'plain', history: 'dim' };
const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export default function CharactersTab() {
  const t = useT();
  const { act, confirm, toast, can, catalog, refresh } = useApp();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<CharRow[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [detail, setDetail] = useState<CharDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<Deleted | null>(null);
  const [refusal, setRefusal] = useState<{ resource?: string; text: string; detail?: string } | null>(null);
  const [waiting, setWaiting] = useState(false);

  // forms
  const [reason, setReason] = useState('');
  const [newId, setNewId] = useState('');
  const [moneyType, setMoneyType] = useState<'cash' | 'gold'>('cash');
  const [moneyOp, setMoneyOp] = useState<'add' | 'remove'>('add');
  const [amount, setAmount] = useState(100);
  const [item, setItem] = useState('');
  const [count, setCount] = useState(1);
  const [job, setJob] = useState('');
  const [jobGrade, setJobGrade] = useState('0');
  const [gang, setGang] = useState('');
  const [gangGrade, setGangGrade] = useState('0');
  const [typed, setTyped] = useState('');
  // the transfer form: the character that takes the number, its preview, the typed confirmation
  const [target, setTarget] = useState('');
  const [targetInfo, setTargetInfo] = useState<CharDetail | null>(null);
  const [transferTyped, setTransferTyped] = useState('');
  const [moved, setMoved] = useState<Moved | null>(null);
  const [transferWaiting, setTransferWaiting] = useState(false);

  useEffect(() => { if (!catalog) refresh('catalog'); }, []);

  const search = async (needle = q) => {
    const r = await act<CharRow[]>('characters', { action: 'search', q: needle.trim() }, { silent: true });
    setRows(r.ok ? list<CharRow>(r.data) : []);
  };
  // the list follows the search box (a short pause after typing)
  useEffect(() => { const h = window.setTimeout(() => void search(q), 250); return () => window.clearTimeout(h); }, [q]);

  const load = async (citizenid: string) => {
    const r = await act<CharDetail>('characters', { action: 'get', citizenid });
    if (r.ok && r.data) {
      const d = r.data as CharDetail
      setDetail({ ...d, dependencies: list<Dep>(d.dependencies), money: list(d.money), siblings: list(d.siblings) });
      setReason(typeof d.block?.reason === 'string' ? d.block.reason : '');
    } else setDetail(null);
  };
  useEffect(() => {
    setDetail(null); setNewId(''); setTyped(''); setRefusal(null);
    setTarget(''); setTargetInfo(null); setTransferTyped('');
    if (picked) void load(picked);
  }, [picked]);

  const run = async (action: string, data: Record<string, unknown>, okText?: string) => {
    if (!detail) return null;
    setBusy(action);
    try {
      const r = await act<Record<string, unknown>>('characters', { action, citizenid: detail.citizenid, ...data }, { okText });
      return r;
    } finally { setBusy(null); }
  };
  const after = async (r: { ok: boolean } | null, id = detail?.citizenid) => {
    if (!r?.ok || !id) return;
    await search();
    await load(id);
  };

  const byKind = useMemo(() => {
    const out: Record<string, Dep[]> = {};
    for (const d of detail?.dependencies ?? []) {
      const kind = KINDS.includes(d.kind) ? d.kind : 'other';
      (out[kind] = out[kind] || []).push(d);
    }
    return out;
  }, [detail]);
  const jobs = catalog?.jobs ?? [];
  const gangs = catalog?.gangs ?? [];
  const jobDef = jobs.find((j) => j.name === job);
  const gangDef = gangs.find((g) => g.name === gang);
  const items = useMemo(() => (catalog?.items ?? []).map((i) => ({ value: i.name, label: `${i.label} (${i.name})` })), [catalog]);

  /** The answer of a deletion (or a transfer) whose call timed out: the server keeps it under the page's token */
  const awaitAnswer = async <T,>(token: string, status: 'deleteStatus' | 'transferStatus' = 'deleteStatus'): Promise<Result<T> | null> => {
    for (let i = 0; i < STATUS_TRIES; i++) {
      await new Promise((resolve) => window.setTimeout(resolve, STATUS_EVERY_MS));
      const s = await act<{ done?: boolean; result?: RawAnswer<T> }>('characters', { action: status, token }, { silent: true });
      const raw = s.ok && s.data?.done ? s.data.result : undefined;
      if (raw) return { ok: raw.ok === true, error: raw.error ? t(raw.error) : undefined, errorKey: raw.error, data: raw.data };
    }
    return null;
  };

  const remove = async (target: { citizenid: string; name: string }) => {
    setBusy('delete');
    setRefusal(null);
    try {
      // silent: the answer is worded here (a report, or who refused and why), not by act's generic toast
      const token = newToken();
      let r = await act<DeleteAnswer>('characters', { action: 'delete', citizenid: target.citizenid, token }, { silent: true });
      if (lateAnswer(r)) {
        // the purge outlasted the panel's call (30 s), or the call itself was lost: the purge may
        // still run on the server, so ask for its answer instead of reporting a failure
        toast('inform', t('toast_char_delete_running'));
        setWaiting(true);
        const late = await awaitAnswer<DeleteAnswer>(token);
        setWaiting(false);
        if (!late) {
          // still nothing: look before saying anything, so a finished deletion is not reported as a failure
          const again = await act('characters', { action: 'get', citizenid: target.citizenid }, { silent: true });
          if (!again.ok && again.errorKey === 'err_char_not_found') {
            setDeleted({ ...target, report: [], total: 0, clean: true, missing: true });
            toast('success', t('toast_char_deleted'));
            setPicked(null);
            await search();
          } else toast('inform', t('toast_char_delete_unknown'));
          return;
        }
        r = late;
      }
      const d: DeleteAnswer = r.data && typeof r.data === 'object' ? r.data : {};
      if (r.ok) {
        const report = list<ReportEntry>(d.report).map((e) => ({ ...e, total: Number(e.total) || 0, items: list<ReportEntry['items'][number]>(e.items) }));
        const total = typeof d.total === 'number' ? d.total : report.reduce((s, e) => s + e.total, 0);
        const clean = d.clean !== false;
        setDeleted({
          ...target, report, total, money: d.money, tombstone: typeof d.tombstone === 'string' ? d.tombstone : undefined,
          clean, leftovers: typeof d.leftovers === 'string' ? d.leftovers : undefined,
        });
        // not clean: never the "free now" answer, the number cannot be given to anyone yet
        toast(clean ? 'success' : 'error', clean ? t('toast_char_deleted_report', target.citizenid, fmtNum(total), report.length) : t('toast_char_deleted_unclean'));
        setPicked(null);
        await search();
        return;
      }
      if (d.resource || d.reason) {
        // a known reason has a key; a resource's own reason is its text, shown as it came
        const own = !d.resource || d.resource === 'w_core';
        const text = d.reasonKey ? t(d.reasonKey) : own ? `${r.error ?? t('ui_failed')}: ${d.reason ?? ''}` : String(d.reason ?? r.error ?? '');
        setRefusal({ resource: d.resource, text, detail: typeof d.detail === 'string' && d.detail ? d.detail : undefined });
        toast('error', own ? text : t('toast_char_refused', d.resource ?? '', text));
        // the panel shows the character as it is now: a deletion that stopped half way holds (blocks)
        // it, and its links and balances changed
        await load(target.citizenid);
        return;
      }
      toast('error', r.error ?? t('ui_failed'));
    } finally { setBusy(null); setWaiting(false); }
  };

  const moneyText = (m?: Money) => [
    m?.USD ? `$${fmtNum(m.USD, 2)}` : '',
    m?.GOLD ? `${fmtNum(m.GOLD, 2)} ${t('ui_ch_gold')}` : '',
  ].filter(Boolean).join(' + ');

  const askDelete = () => detail && confirm({
    title: t('ui_ch_delete'),
    text: t('ui_ch_delete_ask', detail.name, detail.citizenid),
    body: <div className="wa-note">{t('ui_ch_delete_note')}</div>,
    confirmLabel: t('ui_ch_delete'),
    danger: true,
    // awaited: the dialog stays busy while w_core kicks, waits for the logout save and purges
    onConfirm: async () => { await remove({ citizenid: detail.citizenid, name: detail.name }); },
  });

  /** The character that would take the number: its details, before anything is asked */
  const preview = async () => {
    const id = target.trim();
    setTargetInfo(null);
    if (!id || !detail) return;
    if (id === detail.citizenid) { toast('error', t('err_char_transfer_same')); return; }
    const r = await act<CharDetail>('characters', { action: 'get', citizenid: id }, { silent: true });
    if (r.ok && r.data) setTargetInfo(r.data as CharDetail);
    else toast('error', r.errorKey === 'err_char_not_found' ? t('err_char_target_not_found') : (r.error ?? t('ui_failed')));
  };

  const transfer = async (holder: { citizenid: string; name: string }, taker: { citizenid: string; name: string }) => {
    setBusy('transfer');
    try {
      const token = newToken();
      let r = await act<TransferAnswer>('characters', { action: 'transfer', citizenid: holder.citizenid, target: taker.citizenid, token }, { silent: true });
      if (lateAnswer(r)) {
        // two logouts and two moves can outlast the panel's call: the server keeps the answer
        toast('inform', t('toast_char_transfer_running'));
        setTransferWaiting(true);
        const late = await awaitAnswer<TransferAnswer>(token, 'transferStatus');
        setTransferWaiting(false);
        if (!late) { toast('inform', t('toast_char_transfer_unknown')); await search(); return; }
        r = late;
      }
      const d: TransferAnswer = r.data && typeof r.data === 'object' ? r.data : {};
      const aName = d.aName || holder.name;
      const bName = d.bName || taker.name;
      if (r.ok) {
        setMoved({ number: holder.citizenid, aName, bName, target: taker.citizenid, movedTo: d.movedTo, done: true });
        toast('success', t('toast_char_transferred', holder.citizenid, bName, aName, d.movedTo ?? '?'));
        setTarget(''); setTargetInfo(null); setTransferTyped('');
        await search();
        // the number now holds the character that took it
        await load(holder.citizenid);
        return;
      }
      const why = d.reasonKey ? t(d.reasonKey) : d.reason ? `${r.error ?? t('ui_failed')}: ${d.reason}` : (r.error ?? t('ui_failed'));
      if (d.movedTo) {
        // half done: kept over the list until dismissed, the number has no holder now
        setMoved({ number: holder.citizenid, aName, bName, target: taker.citizenid, movedTo: d.movedTo, done: false,
          text: why, detail: typeof d.detail === 'string' && d.detail ? d.detail : undefined });
        toast('error', t('err_char_transfer_partial'));
        await search();
        setPicked(d.movedTo);
        return;
      }
      toast('error', d.detail ? `${why} (${d.detail})` : why);
    } finally { setBusy(null); setTransferWaiting(false); }
  };

  const askTransfer = () => detail && targetInfo && confirm({
    title: t('ui_ch_transfer'),
    text: t('ui_ch_transfer_ask', detail.citizenid, targetInfo.name, detail.name),
    body: <div className="wa-note">{t('ui_ch_transfer_note')}</div>,
    confirmLabel: t('ui_ch_transfer'),
    danger: true,
    // awaited: the dialog stays busy while w_core kicks both and moves them
    onConfirm: async () => {
      await transfer({ citizenid: detail.citizenid, name: detail.name }, { citizenid: targetInfo.citizenid, name: targetInfo.name });
    },
  });

  return (
    <div className={cls('wa-players', detail && 'has-panel')}>
      <div className="wa-players-list">
        <div className="wa-toolbar">
          <Input glyph="search" value={q} onChange={setQ} placeholder={t('ui_ch_search')} className="wa-toolbar-search" />
          <span className="wa-toolbar-count">{t('ui_ch_count', rows?.length ?? 0)}</span>
          <Button size="sm" kind="ghost" glyph="refresh" onClick={() => void search()}>{t('ui_refresh')}</Button>
        </div>
        {deleted && (
          <Section className="wa-ch-report" title={t('ui_ch_report_title', deleted.citizenid)}
            aside={<Button size="sm" kind="ghost" glyph="close" onClick={() => setDeleted(null)}>{t('ui_close')}</Button>}>
            <div className="wa-ch-kv"><span>{t('ui_ch_col_name')}</span><b>{deleted.name}</b></div>
            {deleted.missing ? <div className="wa-note">{t('ui_ch_report_nodata')}</div>
              : deleted.report.length === 0 ? <div className="wa-note">{t('ui_ch_report_empty')}</div> : (
                <>
                  <div className="wa-note">{t('ui_ch_report_total', fmtNum(deleted.total), deleted.report.length)}</div>
                  {deleted.report.map((e) => (
                    <div key={e.resource} className="wa-ch-kv">
                      <span dir="ltr">{e.resource}</span>
                      {/* records, the money it returned and its own notes apart: an amount is never a count */}
                      <b className="wa-ch-report-items">
                        {e.items.length > 0 && <span dir="ltr">{e.items.map((i) => `${i.name} ${fmtNum(i.count)}`).join(' · ')}</span>}
                        {e.money && <span>{t('ui_ch_report_money')}: <span dir="ltr">{moneyText(e.money)}</span></span>}
                        {e.notes && <span className="wa-ch-report-note" dir="auto">{e.notes}</span>}
                      </b>
                    </div>
                  ))}
                </>
              )}
            {deleted.money && (deleted.money.USD || deleted.money.GOLD) ? (
              <div className="wa-ch-kv"><span>{t('ui_ch_report_money')}</span><b dir="ltr">{moneyText(deleted.money)}</b></div>
            ) : null}
            {deleted.tombstone && <div className="wa-ch-kv"><span>{t('ui_ch_report_tombstone')}</span><b dir="ltr">{deleted.tombstone}</b></div>}
            {deleted.clean ? <div className="wa-note">{t('ui_ch_report_free', deleted.citizenid)}</div> : (
              <div className="wa-ch-refusal" role="alert">
                <b>{t('ui_ch_report_leftovers', deleted.citizenid)}</b>
                {deleted.leftovers && (
                  <ul className="wa-ch-blockers" dir="ltr">{deleted.leftovers.split(', ').map((x, i) => <li key={i}>{x}</li>)}</ul>
                )}
                <span className="wa-ch-refusal-note">{t('ui_ch_report_leftovers_hint', deleted.citizenid)}</span>
              </div>
            )}
          </Section>
        )}
        {moved && (
          <Section className="wa-ch-report" title={t('ui_ch_transfer_title', moved.number)}
            aside={<Button size="sm" kind="ghost" glyph="close" onClick={() => setMoved(null)}>{t('ui_close')}</Button>}>
            {moved.done ? (
              <div className="wa-note">{t('ui_ch_transfer_done', moved.number, moved.bName, moved.aName, moved.movedTo ?? '?', moved.target)}</div>
            ) : (
              <div className="wa-ch-refusal" role="alert">
                <b>{t('ui_ch_transfer_partial', moved.aName, moved.movedTo ?? '?', moved.bName, moved.number, moved.target)}</b>
                {moved.text && <span dir="auto">{t('ui_ch_transfer_reason')}: {moved.text}</span>}
                {moved.detail && (
                  <ul className="wa-ch-blockers" dir="ltr">{moved.detail.split(', ').map((x, i) => <li key={i}>{x}</li>)}</ul>
                )}
                <span className="wa-ch-refusal-note">{t('ui_ch_transfer_partial_hint', moved.number, moved.bName)}</span>
              </div>
            )}
          </Section>
        )}
        {rows === null ? <Loading text={t('ui_loading')} /> : rows.length === 0 ? <Empty text={t('ui_ch_none')} glyph="players" /> : (
          <div className="wa-table-wrap">
            <table className="wa-table">
              <thead>
                <tr>
                  <th className="is-num">{t('ui_ch_col_id')}</th>
                  <th>{t('ui_ch_col_name')}</th>
                  <th>{t('ui_ch_col_job')}</th>
                  <th>{t('ui_ch_col_state')}</th>
                  <th>{t('ui_ch_col_last')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.citizenid} className={cls('is-clickable', picked === r.citizenid && 'is-selected')} onClick={() => setPicked(r.citizenid)}>
                    <td className="is-num"><b dir="ltr">{r.citizenid}</b></td>
                    <td className="wa-td-name">
                      <span className="wa-td-name-main">{r.name}</span>
                      <span className="wa-td-name-sub">{r.account || ''}</span>
                    </td>
                    <td>{r.job || '—'}</td>
                    <td>
                      {r.online ? <Tag tone="ok">{t('ui_ch_online', r.online)}</Tag> : <Tag tone="dim">{t('ui_ch_offline')}</Tag>}
                      {r.blocked ? <> <Tag tone="bad">{t('ui_ch_blocked')}</Tag></> : null}
                    </td>
                    <td dir="ltr">{r.lastSeen ? r.lastSeen.replace('T', ' ').slice(0, 16) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detail && (
        <aside className="wa-panel">
          <div className="wa-panel-head">
            <div className="wa-panel-title">
              <span className="wa-panel-name">{detail.name}</span>
              <span className="wa-td-name-sub" dir="ltr">#{detail.citizenid}</span>
            </div>
            <Button size="sm" kind="ghost" glyph="close" onClick={() => setPicked(null)}>{t('ui_close')}</Button>
          </div>

          <Section title={t('ui_ch_details')}>
            <div className="wa-ch-kv"><span>{t('ui_ch_col_id')}</span><b dir="ltr">{detail.citizenid}</b></div>
            <div className="wa-ch-kv"><span>{t('ui_ch_col_state')}</span><b>{detail.online ? t('ui_ch_online', detail.online) : t('ui_ch_offline')}{detail.block ? ` · ${t('ui_ch_blocked')}` : ''}</b></div>
            <div className="wa-ch-kv"><span>{t('ui_ch_col_account')}</span><b>{detail.account || '—'}</b></div>
            <div className="wa-ch-kv"><span>{t('ui_ch_license')}</span><b dir="ltr" className="wa-td-wrap">{detail.license || '—'}</b></div>
            <div className="wa-ch-kv"><span>{t('ui_ch_slot')}</span><b dir="ltr">{detail.slot ?? '—'}</b></div>
            <div className="wa-ch-kv"><span>{t('ui_ch_col_job')}</span><b>{detail.job || '—'}</b></div>
            <div className="wa-ch-kv"><span>{t('ui_ch_gang')}</span><b>{detail.gang || '—'}</b></div>
            {detail.money.length > 0 && (
              <div className="wa-ch-kv"><span>{t('ui_ch_money')}</span>
                <b dir="ltr">{detail.money.map((m) => `${m.id.split(':').pop()}: ${m.currency === 'GOLD' ? '' : '$'}${fmtNum(m.balance, 2)}`).join(' · ')}</b>
              </div>
            )}
            {detail.siblings.length > 0 && (
              <div className="wa-ch-kv"><span>{t('ui_ch_siblings')}</span>
                <b>{detail.siblings.map((s) => (
                  <button key={s.citizenid} type="button" className="wa-link" onClick={() => setPicked(s.citizenid)}>#{s.citizenid} {s.name}</button>
                ))}</b>
              </div>
            )}
          </Section>

          {/* each kind says what a deletion does to it: nothing here blocks the delete any more */}
          <Section title={t('ui_ch_links')}>
            {[...KINDS, 'other'].filter((k) => byKind[k]?.length).map((k) => (
              <div key={k} className="wa-ch-links">
                <div className="wa-ch-kind"><Tag tone={KIND_TONE[k] ?? 'plain'}>{t('ui_ch_kind_' + k)}</Tag></div>
                <div className="wa-note wa-ch-what">{t('ui_ch_what_' + k)}</div>
                {byKind[k].map((d) => (
                  <div key={`${d.table}.${d.column}.${d.kind}`} className="wa-ch-kv"><span dir="ltr">{d.table}.{d.column}</span><b>{t('ui_ch_rows', d.rows)}</b></div>
                ))}
              </div>
            ))}
            <div className="wa-note wa-ch-what">{t('ui_ch_what_money')}</div>
          </Section>

          {!detail.online && <div className="wa-note">{t('ui_ch_offline_note')}</div>}

          {can('money') && (
            <Section title={t('ui_ch_give_money')}>
              <div className="wa-form-row">
                <Select value={moneyType} onChange={(v) => setMoneyType(v as 'cash' | 'gold')} options={[{ value: 'cash', label: t('ui_ch_cash') }, { value: 'gold', label: t('ui_ch_gold') }]} />
                <Select value={moneyOp} onChange={(v) => setMoneyOp(v as 'add' | 'remove')} options={[{ value: 'add', label: t('ui_ch_add') }, { value: 'remove', label: t('ui_ch_remove') }]} />
                <NumberInput value={amount} onChange={setAmount} min={1} max={1000000000} />
                <Button size="sm" busy={busy === 'money'} onClick={async () => after(await run('money', { type: moneyType, op: moneyOp, amount }, t('ui_done')))}>{t('ui_ch_apply')}</Button>
              </div>
            </Section>
          )}

          {can('items') && (
            <Section title={t('ui_ch_give_item')}>
              <div className="wa-form-row">
                <Select value={item} onChange={setItem} options={items} placeholder={t('ui_ch_item')} />
                <NumberInput value={count} onChange={setCount} min={1} max={1000} />
                <Button size="sm" disabled={!item} busy={busy === 'giveItem'} onClick={async () => after(await run('giveItem', { item, count }, t('ui_done')))}>{t('ui_ch_apply')}</Button>
              </div>
            </Section>
          )}

          {can('job') && (
            <Section title={t('ui_ch_set_job')}>
              <div className="wa-form-row">
                <Select value={job} onChange={(v) => { setJob(v); setJobGrade('0'); }} options={jobs.map((j) => ({ value: j.name, label: j.label }))} placeholder={t('ui_ch_name')} />
                <Select value={jobGrade} onChange={setJobGrade} options={(jobDef?.grades ?? []).map((g) => ({ value: String(g.grade), label: `${g.grade} · ${g.name}` }))} placeholder={t('ui_ch_grade')} />
                <Button size="sm" disabled={!job} busy={busy === 'setJob'} onClick={async () => after(await run('setJob', { name: job, grade: Number(jobGrade) }, t('ui_done')))}>{t('ui_ch_apply')}</Button>
              </div>
              <div className="wa-form-row">
                <Select value={gang} onChange={(v) => { setGang(v); setGangGrade('0'); }} options={gangs.map((g) => ({ value: g.name, label: g.label }))} placeholder={t('ui_ch_set_gang')} />
                <Select value={gangGrade} onChange={setGangGrade} options={(gangDef?.grades ?? []).map((g) => ({ value: String(g.grade), label: `${g.grade} · ${g.name}` }))} placeholder={t('ui_ch_grade')} />
                <Button size="sm" disabled={!gang} busy={busy === 'setGang'} onClick={async () => after(await run('setGang', { name: gang, grade: Number(gangGrade) }, t('ui_done')))}>{t('ui_ch_apply')}</Button>
              </div>
            </Section>
          )}

          <Section title={detail.block ? t('ui_ch_unblock') : t('ui_ch_block')}>
            <div className="wa-note">{t('ui_ch_block_note')}</div>
            {detail.block ? (
              <div className="wa-form-row">
                <span className="wa-td-wrap">{detail.block.reason || '—'}{detail.block.blocked_by ? ` · ${detail.block.blocked_by}` : ''}</span>
                <Button size="sm" busy={busy === 'unblock'} onClick={async () => after(await run('unblock', {}, t('toast_char_unblocked')))}>{t('ui_ch_unblock')}</Button>
              </div>
            ) : (
              <div className="wa-form-row">
                <Input value={reason} onChange={setReason} placeholder={t('ui_ch_block_reason')} maxLength={255} />
                <Button size="sm" kind="danger" busy={busy === 'block'} onClick={async () => after(await run('block', { reason }, t('toast_char_blocked')))}>{t('ui_ch_block')}</Button>
              </div>
            )}
          </Section>

          {can('citizenId') && (
            <Section title={t('ui_ch_reassign')}>
              <div className="wa-note">{t('ui_ch_reassign_note')}</div>
              <div className="wa-form-row">
                <Field label={t('ui_ch_new_id')}><Input value={newId} onChange={(v) => setNewId(v.replace(/[^0-9]/g, ''))} placeholder="777" maxLength={9} /></Field>
                <Button size="sm" disabled={!newId || !!detail.online} busy={busy === 'reassign'}
                  onClick={async () => {
                    const r = await run('reassign', { newId }, t('toast_char_reassigned'));
                    if (r?.ok) { setPicked(newId); await search(); }
                  }}>{t('ui_ch_apply')}</Button>
              </div>
            </Section>
          )}

          {/* only a number is handed on (w_core refuses an old random id as `n`); the character that
              takes it may still carry an old id (ABC12345), so the target field keeps letters */}
          {can('citizenId') && NUMERIC_ID.test(detail.citizenid) && (
            <Section title={t('ui_ch_transfer')}>
              <div className="wa-note">{t('ui_ch_transfer_note')}</div>
              <div className="wa-form-row">
                <Field label={t('ui_ch_transfer_target')}>
                  <Input value={target} onChange={(v) => { setTarget(v.replace(/[^0-9A-Za-z]/g, '').toUpperCase()); setTargetInfo(null); setTransferTyped(''); }} placeholder="12" maxLength={9} />
                </Field>
                <Button size="sm" kind="ghost" disabled={!target} onClick={() => void preview()}>{t('ui_ch_transfer_preview')}</Button>
              </div>
              {targetInfo && (
                <>
                  {/* both sides before anything is asked: who moves where, and who gets kicked */}
                  <div className="wa-ch-kv">
                    <span dir="ltr">#{detail.citizenid}</span>
                    <b>{t('ui_ch_transfer_holder', detail.name, detail.citizenid)}{detail.online ? <> <Tag tone="ok">{t('ui_ch_online', detail.online)}</Tag></> : null}</b>
                  </div>
                  <div className="wa-ch-kv">
                    <span dir="ltr">#{targetInfo.citizenid}</span>
                    <b>{t('ui_ch_transfer_taker', targetInfo.name, targetInfo.citizenid, detail.citizenid)}{targetInfo.online ? <> <Tag tone="ok">{t('ui_ch_online', targetInfo.online)}</Tag></> : null}</b>
                  </div>
                  <div className="wa-form-row">
                    <Field label={t('ui_ch_transfer_confirm', detail.citizenid)}><Input value={transferTyped} onChange={setTransferTyped} placeholder={detail.citizenid} /></Field>
                    <Button kind="danger" disabled={transferTyped.trim() !== detail.citizenid} busy={busy === 'transfer'} onClick={askTransfer}>{t('ui_ch_transfer')}</Button>
                  </div>
                </>
              )}
              {transferWaiting && <div className="wa-note">{t('ui_ch_transfer_running')}</div>}
            </Section>
          )}

          {can('charDelete') && (
            <Section title={t('ui_ch_delete')}>
              <div className="wa-note">{t('ui_ch_delete_note')}</div>
              {refusal && (
                <div className="wa-ch-refusal" role="alert">
                  <b>{t('ui_ch_refused_title')}</b>
                  {refusal.resource && <span>{t('ui_ch_refused_by', refusal.resource)}</span>}
                  <span dir="auto">{refusal.text}</span>
                  {refusal.detail && (
                    <>
                      <span>{t('ui_ch_refused_detail')}</span>
                      <ul className="wa-ch-blockers" dir="ltr">{refusal.detail.split(', ').map((x, i) => <li key={i}>{x}</li>)}</ul>
                    </>
                  )}
                  <span className="wa-ch-refusal-note">{t('ui_ch_refused_note')}</span>
                </div>
              )}
              {waiting && <div className="wa-note">{t('ui_ch_delete_running')}</div>}
              <div className="wa-form-row">
                <Field label={t('ui_ch_delete_confirm')}><Input value={typed} onChange={setTyped} placeholder={detail.citizenid} /></Field>
                <Button kind="danger" disabled={typed.trim() !== detail.citizenid} busy={busy === 'delete'} onClick={askDelete}>{t('ui_ch_delete')}</Button>
              </div>
            </Section>
          )}
        </aside>
      )}
    </div>
  );
}
