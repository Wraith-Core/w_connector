/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/hub/api.ts
 * The hub's reads (types.ts is the contract; writes go through app.act so they toast):
 *   post('scripts',  { action: 'list' })                          → ModuleDescriptor[]  (also pushed as 'modules')
 *   post('settings', { action: 'schema',  resource })             → SettingsSchema
 *   post('settings', { action: 'values',  resource, group })      → SettingsValues
 *   post('settings', { action: 'history', resource, limit })      → SettingsAudit[]
 * Writes (from the components):
 *   act('scripts',  { action: 'open',  resource, link? })          Lua closes the console, then opens it
 *   act('scripts',  { action: 'run',   resource, command, args })  → { output? }
 *   act('scripts',  { action: 'start', resource })
 *   act('settings', { action: 'apply', resource, changes })        → SettingsApplyResult
 *   act('hud',      { action: 'save', cfg } | { action: 'setNeed', citizenid, id?, need, value })   (built-in w_hud)
 * ════════════════════════════════════════════════════════════════════════════ */

import { post } from '../../nui';
import type { ModuleDescriptor, Result, SettingsAudit, SettingsField, SettingsGroup, SettingsRow, SettingsSchema, SettingsValues } from '../../types';
import { asList } from './model';

/* An empty Lua table reaches the page as [] or {}: every list and map below is made the right shape
   once, here, so no component meets an object where it expects an array (or the reverse). */
const asMap = <T,>(v: unknown): Record<string, T> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, T>) : {});

function normField(f: SettingsField): SettingsField {
  const out: SettingsField = { ...f };
  if (f.options !== undefined) out.options = asList(f.options);
  if (f.columns !== undefined) out.columns = asList<SettingsField>(f.columns).map(normField);
  return out;
}

export function normSchema(s: SettingsSchema): SettingsSchema {
  const withLinks = s as SettingsSchema & { links?: unknown };
  const out = { ...s, groups: asList<SettingsGroup>(s.groups).map((g) => ({ ...g, fields: asList<SettingsField>(g.fields).map(normField) })) };
  if (withLinks.links !== undefined) (out as typeof withLinks).links = asList(withLinks.links);
  return out;
}

export function normValues(v: SettingsValues): SettingsValues {
  return {
    ...v,
    values: asMap(v.values),
    defaults: asMap(v.defaults),
    overridden: asMap(v.overridden),
    rows: v.rows === undefined || v.rows === null ? v.rows
      : asList<SettingsRow>(v.rows).map((r) => ({ ...r, cells: asMap(r.cells), defaults: asMap(r.defaults), overridden: asList<string>(r.overridden) })),
    orphans: v.orphans === undefined || v.orphans === null ? v.orphans : asList<string>(v.orphans),
  };
}

/** Schemas already fetched, per resource (the sidebar reads it to pin "food and drink" under the hub) */
export const schemaCache = new Map<string, SettingsSchema>();

export function listModules(): Promise<Result<ModuleDescriptor[]>> {
  return post<ModuleDescriptor[]>('scripts', { action: 'list' });
}

export async function fetchSchema(resource: string): Promise<Result<SettingsSchema>> {
  const r = await post<SettingsSchema>('settings', { action: 'schema', resource });
  if (r.ok && r.data && r.data.groups) {
    const schema = normSchema(r.data);
    schemaCache.set(resource, schema);
    return { ...r, data: schema };
  }
  return r;
}

export async function fetchValues(resource: string, group: string): Promise<Result<SettingsValues>> {
  const r = await post<SettingsValues>('settings', { action: 'values', resource, group });
  return r.ok && r.data ? { ...r, data: normValues(r.data) } : r;
}

export async function fetchHistory(resource: string): Promise<Result<SettingsAudit[]>> {
  const r = await post<SettingsAudit[]>('settings', { action: 'history', resource, limit: 200 });
  return r.ok ? { ...r, data: asList<SettingsAudit>(r.data) } : r;
}
