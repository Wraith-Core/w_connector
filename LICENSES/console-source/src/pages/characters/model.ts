/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/characters/model.ts
 * The shapes server/sv_characters.lua answers with (loose: a nil field arrives missing), the answers
 * of a deletion / a number transfer, and the small helpers the page shares.
 * ════════════════════════════════════════════════════════════════════════════ */

import type { CharacterBlock } from '../../types';

/** One row of 'search' (every field but the id and the name may be missing) */
export interface CharRow {
  citizenid: string;
  name: string;
  account?: string;
  license?: string;
  slot?: number;
  lastSeen?: string | null;
  job?: string;
  /** the server id while online */
  online?: number | null;
  /** the block reason ('' → true) */
  blocked?: string | boolean | null;
}

/** kind: core | data | asset | history today; w_core may grow others, shown under 'other' */
export interface Dep { table: string; column: string; kind: string; rows: number; shaped?: boolean }

export interface CharDetail extends CharRow {
  gang?: string;
  block?: Partial<CharacterBlock> | null;
  dependencies: Dep[];
  money: { id: string; balance: number; currency: string }[];
  siblings: { citizenid: string; name: string }[];
}

/** Money a deletion returned to the reserve, in dollars / gold */
export interface Money { USD?: number; GOLD?: number }

/** One resource's part of a deletion (sv_characters.lua reportList): records removed, money, its own notes */
export interface ReportEntry { resource: string; total: number; items: { name: string; count: number }[]; money?: Money; notes?: string }

export interface DeleteAnswer {
  citizenid?: string; report?: ReportEntry[]; total?: number; tombstone?: string; money?: Money;
  /** false: something is still filed under the number (leftovers says what); w_core retries once by itself */
  clean?: boolean; leftovers?: string;
  /* a refusal: the resource that refused ('w_core' for its own reasons), its words, the locale key when
     known, and what stands in the way (the assets not released, the accounts still funded) */
  resource?: string; reason?: string; reasonKey?: string; detail?: string;
  /** the panel's call gave up (30 s) while the server still deletes: the answer is asked for again */
  timedOut?: boolean;
}

/** A server answer as 'deleteStatus' / 'transferStatus' keeps it (locale keys, not texts) */
export interface RawAnswer<T> { ok: boolean; error?: string; data?: T }

/** The last deletion, shown over the list until dismissed. missing: deleted, but the answer never came back */
export interface Deleted {
  citizenid: string; name: string; report: ReportEntry[]; total: number; money?: Money; tombstone?: string;
  clean: boolean; leftovers?: string; missing?: boolean;
}

/** A refused deletion, shown in the Delete tab of that character until the next try */
export interface Refusal { citizenid: string; resource?: string; text: string; detail?: string }

/** A number transfer's answer (sv_characters.lua transfer); movedTo on a refusal: half done */
export interface TransferAnswer {
  number?: string; movedTo?: string; freed?: string; aName?: string; bName?: string; target?: string;
  reason?: string; reasonKey?: string; detail?: string; timedOut?: boolean;
}

/** The last transfer, shown over the list until dismissed. done false: the holder moved, the other did not */
export interface Moved {
  number: string; aName: string; bName: string; target: string; movedTo?: string;
  done: boolean; text?: string; detail?: string;
}

/** How long the page keeps asking for a late answer after its call timed out */
export const STATUS_TRIES = 40;
export const STATUS_EVERY_MS = 3000;

/** The page's call gave up while the server may still work on it: the answer is asked for again.
 *  timedOut: w_lib's 30 s callback limit; ui_net_error: the page's own request to the game failed. */
export const lateAnswer = (r: { ok: boolean; error?: string; errorKey?: string; data?: unknown }) =>
  !r.ok && (((r.data as { timedOut?: boolean } | undefined)?.timedOut === true) || r.error === 'ui_net_error' || r.errorKey === 'ui_net_error');

export const newToken = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** A sequential citizen id (w_core C.IsNumeric): the only kind of id a transfer hands on */
export const NUMERIC_ID = /^[1-9]\d{0,8}$/;

export const KINDS = ['core', 'data', 'asset', 'history'] as const;
export type DepKind = typeof KINDS[number] | 'other';
export const kindOf = (k: string): DepKind => ((KINDS as readonly string[]).includes(k) ? (k as DepKind) : 'other');

export const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** A detail as it arrived, with every list made safe */
export function normalizeDetail(d: CharDetail): CharDetail {
  return {
    ...d,
    citizenid: String(d.citizenid),
    dependencies: list<Dep>(d.dependencies).map((x) => ({ ...x, rows: Number(x.rows) || 0 })),
    money: list<CharDetail['money'][number]>(d.money),
    siblings: list<CharDetail['siblings'][number]>(d.siblings),
  };
}

/** A deletion's report entries with their numbers made safe */
export function normalizeReport(v: unknown): ReportEntry[] {
  return list<ReportEntry>(v).map((e) => ({ ...e, total: Number(e.total) || 0, items: list<ReportEntry['items'][number]>(e.items) }));
}

/** cb_accounts id → its kind: 'player:14:cash' / 'cash:14' → 'cash' (the part that is not the id) */
export function accountKind(id: string, citizenid: string): string {
  const parts = String(id).split(':').filter((p) => p && p !== citizenid && p !== 'player' && p !== 'char');
  return (parts.pop() ?? String(id)).toLowerCase();
}

/** 'a, b, c' (the server's joined lists) → ['a', 'b', 'c'] */
export const splitList = (s: string | undefined): string[] => (s ? s.split(', ').map((x) => x.trim()).filter(Boolean) : []);

/** The drawer's tabs, in order */
export const TABS = ['overview', 'links', 'economy', 'access', 'identity', 'danger'] as const;
export type TabId = typeof TABS[number];
export const isTab = (v: string | undefined): v is TabId => !!v && (TABS as readonly string[]).includes(v);

/** The list filter chips */
export type Filter = 'all' | 'online' | 'offline' | 'blocked';
