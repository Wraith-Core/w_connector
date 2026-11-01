/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/characters/flows.ts
 * The two long server jobs of the page, with the same answers and messages as before:
 *
 *   remove(target)            delete a character. w_core purges EVERY resource (own data deleted,
 *                             assets released back to the game, money to the reserve, history
 *                             relabelled 'deleted-<id>-<time>'). The answer is a report (shown over
 *                             the list until dismissed; a warning when something is still under the
 *                             number) or the resource that refused, its reason and what stands in the
 *                             way (shown in that character's Delete tab).
 *   transfer(holder, taker)   hand the holder's number to another character in one step: w_core moves
 *                             the holder to a fresh number with everything it has, then the other
 *                             character onto the number with everything it has. A half-done transfer
 *                             (the holder moved, the other did not) is shown over the list, never lost.
 *
 * Either can outlast the panel's 30 s call (logouts, every resource, registry scans). The page then
 * asks 'deleteStatus' / 'transferStatus' with its token until the answer is in. The confirm dialog
 * closes as soon as the first call returns; the waiting note shows in the tab meanwhile.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useCallback, useRef, useState } from 'react';
import type { AppCtx } from '../../ctx';
import type { TFn } from '../../i18n';
import { fmtNum } from '../../kit';
import type { Result } from '../../types';
import type { DeleteAnswer, Deleted, Moved, RawAnswer, Refusal, TabId, TransferAnswer } from './model';
import { STATUS_EVERY_MS, STATUS_TRIES, lateAnswer, newToken, normalizeReport } from './model';

/** a name inside a sentence keeps its own direction (FSI … PDI) */
const iso = (s: string): string => `\u2068${s}\u2069`;

export interface FlowDeps {
  act: AppCtx['act'];
  toast: AppCtx['toast'];
  t: TFn;
  /** reloads the list */
  search(): Promise<void>;
  /** reloads the drawer's character */
  load(citizenid: string): Promise<void>;
  /** opens a character in the drawer */
  open(citizenid: string, view?: TabId): void;
  /** the character open in the drawer now */
  current(): string | null;
  /** closes the drawer */
  close(): void;
}

export interface Who { citizenid: string; name: string }

const sleep = (ms: number) => new Promise<void>((resolve) => { window.setTimeout(resolve, ms); });

export function useCharacterFlows(deps: FlowDeps) {
  const ref = useRef(deps);
  ref.current = deps;

  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const mark = useCallback((key: string, on: boolean) => setBusy((b) => (b[key] === on ? b : { ...b, [key]: on })), []);
  const [deleted, setDeleted] = useState<Deleted | null>(null);
  const [moved, setMoved] = useState<Moved | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  /** the citizen id whose deletion / transfer is still being asked for */
  const [deleting, setDeleting] = useState<string | null>(null);
  const [transferring, setTransferring] = useState<string | null>(null);

  /** The answer of a job whose call timed out: the server keeps it under the page's token */
  const awaitAnswer = useCallback(async <T,>(token: string, status: 'deleteStatus' | 'transferStatus'): Promise<Result<T> | null> => {
    for (let i = 0; i < STATUS_TRIES; i++) {
      await sleep(STATUS_EVERY_MS);
      const { act, t } = ref.current;
      const s = await act<{ done?: boolean; result?: RawAnswer<T> }>('characters', { action: status, token }, { silent: true });
      const raw = s.ok && s.data?.done ? s.data.result : undefined;
      if (raw) return { ok: raw.ok === true, error: raw.error ? t(raw.error) : undefined, errorKey: raw.error, data: raw.data };
    }
    return null;
  }, []);

  /* ── delete ──────────────────────────────────────────────────────────── */

  const finishDelete = useCallback(async (target: Who, r: Result<DeleteAnswer>) => {
    const { t, toast, search, load, open, current, close } = ref.current;
    const d: DeleteAnswer = r.data && typeof r.data === 'object' ? r.data : {};
    if (r.ok) {
      const report = normalizeReport(d.report);
      const total = typeof d.total === 'number' ? d.total : report.reduce((s, e) => s + e.total, 0);
      const clean = d.clean !== false;
      setDeleted({
        ...target, report, total, money: d.money, tombstone: typeof d.tombstone === 'string' ? d.tombstone : undefined,
        clean, leftovers: typeof d.leftovers === 'string' ? d.leftovers : undefined,
      });
      // not clean: never the "free now" answer, the number cannot be given to anyone yet
      toast(clean ? 'success' : 'error', clean ? t('toast_char_deleted_report', target.citizenid, fmtNum(total), report.length) : t('toast_char_deleted_unclean'));
      if (current() === target.citizenid) close();
      await search();
      return;
    }
    if (d.resource || d.reason) {
      // a known reason has a key; a resource's own reason is its text, shown as it came
      const own = !d.resource || d.resource === 'w_core';
      const text = d.reasonKey ? t(d.reasonKey) : own ? `${r.error ?? t('ui_failed')}: ${d.reason ?? ''}` : String(d.reason ?? r.error ?? '');
      setRefusal({ citizenid: target.citizenid, resource: d.resource, text, detail: typeof d.detail === 'string' && d.detail ? d.detail : undefined });
      toast('error', own ? text : t('toast_char_refused', d.resource ?? '', text));
      // the drawer shows the character as it is now: a deletion that stopped half way holds (blocks)
      // it, and its links and balances changed
      if (current() === target.citizenid) await load(target.citizenid);
      else open(target.citizenid, 'danger');
      return;
    }
    toast('error', r.error ?? t('ui_failed'));
  }, []);

  /** Resolves once the first call answered (the dialog then closes); a late answer is awaited in the background */
  const remove = useCallback(async (target: Who): Promise<void> => {
    const { act, t, toast } = ref.current;
    mark('delete', true);
    setRefusal((f) => (f && f.citizenid === target.citizenid ? null : f));
    const token = newToken();
    // silent: the answer is worded here (a report, or who refused and why), not by act's generic toast
    let r: Result<DeleteAnswer>;
    try {
      r = await act<DeleteAnswer>('characters', { action: 'delete', citizenid: target.citizenid, token }, { silent: true });
    } catch {
      mark('delete', false);
      toast('error', t('ui_failed'));
      return;
    }
    if (lateAnswer(r)) {
      // the purge outlasted the panel's call (30 s), or the call itself was lost: the purge may still
      // run on the server, so ask for its answer instead of reporting a failure
      toast('inform', t('toast_char_delete_running'));
      setDeleting(target.citizenid);
      void (async () => {
        try {
          const late = await awaitAnswer<DeleteAnswer>(token, 'deleteStatus');
          if (late) { await finishDelete(target, late); return; }
          // still nothing: look before saying anything, so a finished deletion is not reported as a failure
          const cur = ref.current;
          const again = await cur.act('characters', { action: 'get', citizenid: target.citizenid }, { silent: true });
          if (!again.ok && again.errorKey === 'err_char_not_found') {
            setDeleted({ ...target, report: [], total: 0, clean: true, missing: true });
            cur.toast('success', cur.t('toast_char_deleted'));
            if (cur.current() === target.citizenid) cur.close();
            await cur.search();
          } else cur.toast('inform', cur.t('toast_char_delete_unknown'));
        } finally {
          setDeleting(null);
          mark('delete', false);
        }
      })();
      return;
    }
    try { await finishDelete(target, r); } finally { mark('delete', false); }
  }, [awaitAnswer, finishDelete, mark]);

  /* ── transfer ────────────────────────────────────────────────────────── */

  const finishTransfer = useCallback(async (holder: Who, taker: Who, r: Result<TransferAnswer>): Promise<boolean> => {
    const { t, toast, search, load, open, current } = ref.current;
    const d: TransferAnswer = r.data && typeof r.data === 'object' ? r.data : {};
    const aName = d.aName || holder.name;
    const bName = d.bName || taker.name;
    if (r.ok) {
      setMoved({ number: holder.citizenid, aName, bName, target: taker.citizenid, movedTo: d.movedTo, done: true });
      toast('success', t('toast_char_transferred', holder.citizenid, iso(bName), iso(aName), d.movedTo ?? '?'));
      await search();
      // the number now holds the character that took it
      if (current() === holder.citizenid) await load(holder.citizenid);
      return true;
    }
    const why = d.reasonKey ? t(d.reasonKey) : d.reason ? `${r.error ?? t('ui_failed')}: ${d.reason}` : (r.error ?? t('ui_failed'));
    if (d.movedTo) {
      // half done: kept over the list until dismissed, the number has no holder now
      setMoved({
        number: holder.citizenid, aName, bName, target: taker.citizenid, movedTo: d.movedTo, done: false,
        text: why, detail: typeof d.detail === 'string' && d.detail ? d.detail : undefined,
      });
      toast('error', t('err_char_transfer_partial'));
      await search();
      open(d.movedTo);
      return false;
    }
    toast('error', d.detail ? `${why} (${d.detail})` : why);
    return false;
  }, []);

  /** true when the number changed hands right away (the form may be cleared) */
  const transfer = useCallback(async (holder: Who, taker: Who): Promise<boolean> => {
    const { act, t, toast } = ref.current;
    mark('transfer', true);
    const token = newToken();
    let r: Result<TransferAnswer>;
    try {
      r = await act<TransferAnswer>('characters', { action: 'transfer', citizenid: holder.citizenid, target: taker.citizenid, token }, { silent: true });
    } catch {
      mark('transfer', false);
      toast('error', t('ui_failed'));
      return false;
    }
    if (lateAnswer(r)) {
      // two logouts and two moves can outlast the panel's call: the server keeps the answer
      toast('inform', t('toast_char_transfer_running'));
      setTransferring(holder.citizenid);
      void (async () => {
        try {
          const late = await awaitAnswer<TransferAnswer>(token, 'transferStatus');
          if (!late) {
            const cur = ref.current;
            cur.toast('inform', cur.t('toast_char_transfer_unknown'));
            await cur.search();
            return;
          }
          await finishTransfer(holder, taker, late);
        } finally {
          setTransferring(null);
          mark('transfer', false);
        }
      })();
      return false;
    }
    try { return await finishTransfer(holder, taker, r); } finally { mark('transfer', false); }
  }, [awaitAnswer, finishTransfer, mark]);

  return { busy, mark, deleted, setDeleted, moved, setMoved, refusal, setRefusal, deleting, transferring, remove, transfer };
}

export type CharacterFlows = ReturnType<typeof useCharacterFlows>;
