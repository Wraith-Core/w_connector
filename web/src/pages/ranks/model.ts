/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/ranks/model.ts
 * The shapes of post('ranks', …) and the rules the server enforces, mirrored as hints:
 *   { action: 'state' }                                              → STATE
 *   { action: 'save', rank: { name, label, color, sort, permissions } } → STATE   (create or edit)
 *   { action: 'delete', name }                                       → STATE
 *   { action: 'assign', rank, target: { source } | { identifier, name? } } → STATE
 *   { action: 'revoke', rank, identifier }                           → STATE
 * Every answer's data is the whole STATE; errors arrive translated (ok:false, error).
 * ════════════════════════════════════════════════════════════════════════════ */

import type { LocalText } from '../../types';

export interface RankRow {
  name: string;
  label: string;
  color: string;
  sort: number;
  /** the master rank: never editable or deletable here */
  protected: boolean;
  /** ['*'] for the master rank */
  permissions: string[];
  members: number;
}

export interface MemberRow {
  identifier: string;
  name: string;
  /** the server id while online */
  online: number | false;
  ranks: string[];
  /** ranks the panel cannot take (masters from the server config) */
  locked: string[];
}

export interface CatalogNode { node: string; label: LocalText; desc: LocalText; danger: boolean }
export interface CatalogGroup { id: string; label: LocalText; nodes: CatalogNode[] }
export interface OnlineRow { id: number; name: string; citizenid: string; identifier: string; ranks: string[] }

export interface RanksState {
  ranks: RankRow[];
  members: MemberRow[];
  catalog: CatalogGroup[];
  online: OnlineRow[];
}

/* ── reading the answer (a newer or older server may leave a field out) ──── */

const arr = <T>(v: unknown, map: (x: Record<string, unknown>) => T | null): T[] => {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const x of v) if (x && typeof x === 'object') { const m = map(x as Record<string, unknown>); if (m) out.push(m); }
  return out;
};
const str = (v: unknown, def = ''): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : def);
const num = (v: unknown, def = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : def);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const text = (v: unknown): LocalText => {
  if (typeof v === 'string') return { ar: v, en: v };
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return { ar: str(o.ar), en: str(o.en) };
};

export function toState(v: unknown): RanksState | null {
  if (!v || typeof v !== 'object') return null;
  const d = v as Record<string, unknown>;
  if (!Array.isArray(d.ranks)) return null;
  return {
    ranks: arr(d.ranks, (r) => (typeof r.name === 'string' ? {
      name: r.name, label: str(r.label, r.name), color: str(r.color, '#888888'), sort: num(r.sort),
      protected: r.protected === true, permissions: strs(r.permissions), members: num(r.members),
    } : null)),
    members: arr(d.members, (m) => (typeof m.identifier === 'string' ? {
      identifier: m.identifier, name: str(m.name), online: typeof m.online === 'number' ? m.online : false,
      ranks: strs(m.ranks), locked: strs(m.locked),
    } : null)),
    catalog: arr(d.catalog, (g) => ({
      id: str(g.id), label: text(g.label),
      nodes: arr(g.nodes, (n) => (typeof n.node === 'string' ? { node: n.node, label: text(n.label), desc: text(n.desc), danger: n.danger === true } : null)),
    })),
    online: arr(d.online, (p) => (typeof p.id === 'number' ? {
      id: p.id, name: str(p.name), citizenid: str(p.citizenid), identifier: str(p.identifier), ranks: strs(p.ranks),
    } : null)),
  };
}

/* ── the server's rules, as hints ──────────────────────────────────────── */

export const NAME_RE = /^[a-z][a-z0-9_]*$/;
export const NODE_RE = /^[A-Za-z0-9_:.-]+$/;
export const IDENT_RE = /^(?:discord:)?\d{15,21}$/;
export const MAX_PERMS = 1024;

export const nameOk = (s: string) => s.length >= 2 && s.length <= 32 && NAME_RE.test(s);
export const labelOk = (s: string) => s.trim().length >= 1 && s.trim().length <= 60;
export const colorOk = (s: string) => /^#[0-9a-fA-F]{6}$/.test(s);
export const sortOk = (n: number | null) => n !== null && Number.isInteger(n) && n >= 0 && n <= 999;

export type NodeProblem = 'shape' | 'reserved' | null;
export function nodeProblem(s: string): NodeProblem {
  if (!s || s.length > 146 || !NODE_RE.test(s)) return 'shape';
  if (/^wranks?\./i.test(s)) return 'reserved';
  return null;
}

/** A colour the page can paint (a bad value from the server draws grey) */
export const safeColor = (c: string) => (colorOk(c) ? c : '#888888');

/** The ready colours of the editor: label.ranks.colors.<id> */
export const PRESETS: { id: string; hex: string }[] = [
  { id: 'red', hex: '#c0392b' },
  { id: 'orange', hex: '#d35400' },
  { id: 'gold', hex: '#d4a017' },
  { id: 'green', hex: '#27ae60' },
  { id: 'teal', hex: '#16a085' },
  { id: 'blue', hex: '#2980b9' },
  { id: 'purple', hex: '#8e44ad' },
  { id: 'pink', hex: '#d63384' },
  { id: 'brown', hex: '#8d6e63' },
  { id: 'grey', hex: '#95a5a6' },
];

/* ── the editor's draft ────────────────────────────────────────────────── */

export interface Draft { name: string; label: string; color: string; sort: number | null; perms: string[] }

export const draftOf = (r: RankRow | null): Draft => (r
  ? { name: r.name, label: r.label, color: r.color, sort: r.sort, perms: [...r.permissions] }
  : { name: '', label: '', color: PRESETS[5].hex, sort: 10, perms: [] });

export function sameDraft(a: Draft, b: Draft): boolean {
  if (a.name !== b.name || a.label !== b.label || a.color.toLowerCase() !== b.color.toLowerCase() || a.sort !== b.sort) return false;
  if (a.perms.length !== b.perms.length) return false;
  const s = new Set(a.perms);
  return b.perms.every((p) => s.has(p));
}

/** Every node of the catalogue, by key */
export function nodeIndex(catalog: CatalogGroup[]): Map<string, CatalogNode> {
  const m = new Map<string, CatalogNode>();
  for (const g of catalog) for (const n of g.nodes) m.set(n.node, n);
  return m;
}

/** A rank that gives a danger node (or is the master): giving it asks first */
export function isPowerful(r: RankRow | undefined, nodes: Map<string, CatalogNode>): boolean {
  if (!r) return false;
  return r.protected || r.permissions.some((p) => p === '*' || nodes.get(p)?.danger);
}
