/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/perms/model.ts  (2.3.1)
 * The 'access' push (ops/console.lua C.access) read defensively, then laid out the way the website's
 * roles page shows access: the base role and the custom roles, the website permissions in the website's
 * order with its names, and the script permissions one script at a time.
 * Pure (type imports only): tests/test_perms_model.py runs it under Node.
 * ════════════════════════════════════════════════════════════════════════════ */

import type { AccessData, AccessRole, LangText, ScriptGroup, WebPermission } from '../../types';

export type BaseRole = 'owner' | 'admin' | 'moderator' | 'viewer' | 'custom';
export type Filter = 'all' | 'mine' | 'locked';

export interface PermRow {
  id: string;
  /** null: a permission the names list does not carry (shown by its id) */
  label: LangText | null;
  description: LangText | null;
  mine: boolean;
  ownerOnly: boolean;
  danger: boolean;
}
export interface PermGroup { id: string; label: LangText | null; rows: PermRow[] }

export interface PermsView {
  role: BaseRole | null;
  roles: AccessRole[];
  web: PermRow[];
  /** false: an older website sent no names (rows are his own permissions, by id) */
  webNamed: boolean;
  scripts: PermGroup[];
  scriptsFrom: 'website' | 'server';
  /** script permissions he holds that this server's catalogue does not list */
  scriptsUnknown: string[];
  manage: { url: string; where: LangText | null } | null;
  counts: { web: number; webTotal: number; scripts: number; scriptsTotal: number };
}

const BASE: readonly BaseRole[] = ['owner', 'admin', 'moderator', 'viewer', 'custom'];

const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
/** FXServer sends an empty Lua table as {} or [] */
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const strs = (v: unknown): string[] => list(v).filter((x): x is string => typeof x === 'string' && x !== '');
function text(v: unknown): LangText | null {
  const r = rec(v);
  return r && typeof r.ar === 'string' && typeof r.en === 'string' ? { ar: r.ar, en: r.en } : null;
}

/** The push as Lua sent it, or null when it is not one */
export function toAccess(raw: unknown): AccessData | null {
  const r = rec(raw);
  if (!r) return null;
  const web = rec(r.web) ?? {};
  const scripts = rec(r.scripts) ?? {};
  const manage = rec(r.manage);
  const catalog = Array.isArray(web.catalog) || rec(web.catalog)
    ? list(web.catalog).flatMap((p): WebPermission[] => {
      const x = rec(p); const id = x && str(x.id); const label = x && text(x.label); const description = x && text(x.description);
      return x && id && label && description ? [{ id, label, description, ...(x.ownerOnly === true ? { ownerOnly: true } : {}) }] : [];
    })
    : null;
  const groups = list(scripts.groups).flatMap((g): ScriptGroup[] => {
    const x = rec(g); const id = x && str(x.id); const label = x && text(x.label);
    if (!x || !id || !label) return [];
    const permissions = list(x.permissions).flatMap((p) => {
      const y = rec(p); const pid = y && str(y.id); const pl = y && text(y.label); const pd = y && text(y.description);
      return y && pid && pl && pd ? [{ id: pid, node: str(y.node) ?? pid, label: pl, description: pd, danger: y.danger === true }] : [];
    });
    return [{ id, label, permissions }];
  });
  const roles = list(r.roles).flatMap((x): AccessRole[] => {
    const y = rec(x); const name = y && str(y.name);
    if (!y || !name) return [];
    return [{ name, ...(typeof y.direct === 'boolean' ? { direct: y.direct } : {}), ...(typeof y.discord === 'boolean' ? { discord: y.discord } : {}) }];
  });
  const url = manage && str(manage.url);
  return {
    rev: typeof r.rev === 'number' ? r.rev : 0,
    role: str(r.role),
    roles,
    web: { held: strs(web.held), catalog },
    scripts: { held: strs(scripts.held), from: scripts.from === 'server' ? 'server' : 'website', groups },
    manage: url && /^https?:\/\//.test(url) ? { url, where: text(manage!.where) } : null,
  };
}

/** The page's rows and counts */
export function buildView(a: AccessData): PermsView {
  const role = (BASE as readonly string[]).includes(a.role ?? '') ? (a.role as BaseRole) : null;
  const held = new Set(a.web.held);
  let web: PermRow[];
  if (a.web.catalog) {
    const known = new Set(a.web.catalog.map((p) => p.id));
    web = a.web.catalog.map((p) => ({
      id: p.id, label: p.label, description: p.description, mine: held.has(p.id), ownerOnly: p.ownerOnly === true, danger: false,
    }));
    /* a permission newer than the names this connector holds */
    for (const id of a.web.held) if (!known.has(id)) web.push({ id, label: null, description: null, mine: true, ownerOnly: false, danger: false });
  } else {
    web = a.web.held.map((id) => ({ id, label: null, description: null, mine: true, ownerOnly: false, danger: false }));
  }
  const scriptsHeld = new Set(a.scripts.held);
  const listed = new Set<string>();
  const scripts: PermGroup[] = a.scripts.groups.map((g) => ({
    id: g.id,
    label: g.label,
    rows: g.permissions.map((p) => {
      listed.add(p.id);
      return { id: p.id, label: p.label, description: p.description, mine: scriptsHeld.has(p.id), ownerOnly: false, danger: p.danger === true };
    }),
  })).filter((g) => g.rows.length > 0);
  const all = scripts.flatMap((g) => g.rows);
  return {
    role,
    roles: a.roles,
    web,
    webNamed: a.web.catalog !== null,
    scripts,
    scriptsFrom: a.scripts.from,
    scriptsUnknown: a.scripts.held.filter((id) => !listed.has(id)),
    manage: a.manage,
    counts: {
      web: web.filter((r) => r.mine).length, webTotal: web.length,
      scripts: all.filter((r) => r.mine).length, scriptsTotal: all.length,
    },
  };
}

const pick = (v: LangText | null, lang: 'ar' | 'en'): string => (v ? v[lang] || v[lang === 'ar' ? 'en' : 'ar'] : '');

/** The filter chips and the search box (either language's name, the description or the id) */
export function matches(row: PermRow, filter: Filter, needle: string, lang: 'ar' | 'en'): boolean {
  if (filter === 'mine' && !row.mine) return false;
  if (filter === 'locked' && row.mine) return false;
  const q = needle.trim().toLowerCase();
  if (!q) return true;
  return [pick(row.label, lang), pick(row.label, lang === 'ar' ? 'en' : 'ar'), pick(row.description, lang), row.id]
    .some((v) => v.toLowerCase().includes(q));
}
