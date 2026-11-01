/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/hub/food/model.ts
 * The Food & drink editor's helpers: the table of a group, bulk edit, drift, and the plain-words
 * "what this means" line computed from the values.
 * Everything a script says comes from its schema (w_lib w.settings); nothing here knows w_hud except
 * the derived-hint kinds the schema names (needAfter, healthPercent, buffTime, kg) and the w_hud
 * values a hint needs (buffs.*, gold.duration, poison.*), which arrive as data.
 * ════════════════════════════════════════════════════════════════════════════ */

import type { LocalText, SettingValue, SettingsField, SettingsGroup, SettingsRow, SettingsValues } from '../../../types';

export const cellKey = (table: string, row: string, col: string) => `${table}.${row}.${col}`;

export interface TableSpec {
  group: SettingsGroup;
  /** the table field's key: the prefix of every cell key ('food') */
  key: string;
  columns: SettingsField[];
  families: { id: string; label: LocalText }[];
}

/** The table of a group (a table group has exactly one field of type 'table') */
export function tableSpec(group: SettingsGroup): TableSpec | null {
  const field = group.fields.find((f) => f.type === 'table');
  if (!field) return null;
  return { group, key: field.key || group.id, columns: field.columns ?? [], families: field.families ?? [] };
}

export const same = (a: SettingValue | undefined, b: SettingValue | undefined): boolean => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
};

/* ── bulk edit ───────────────────────────────────────────────────────────── */

export type BulkOp = 'mul' | 'add' | 'set';

/** Rounds to the column's step and keeps it inside the range; says whether it had to */
export function fitNumber(col: SettingsField, v: number): { value: number; clamped: boolean } {
  let out = v;
  const step = col.step && col.step > 0 ? col.step : col.integer ? 1 : 0;
  if (step) {
    const base = col.min ?? 0;
    out = base + Math.round((out - base) / step) * step;
    out = Math.round(out * 1e6) / 1e6;
  }
  let clamped = false;
  if (col.min !== undefined && out < col.min) { out = col.min; clamped = true; }
  if (col.max !== undefined && out > col.max) { out = col.max; clamped = true; }
  return { value: out, clamped };
}

export interface BulkResult { key: string; row: SettingsRow; from: number; to: number; clamped: boolean }

/** What a bulk edit would change on the rows shown (locked rows never change) */
export function bulkPlan(rows: SettingsRow[], table: string, col: SettingsField, op: BulkOp, n: number, valueOf: (key: string) => SettingValue | undefined): BulkResult[] {
  const out: BulkResult[] = [];
  if (col.type !== 'number' || !Number.isFinite(n)) return out;
  for (const r of rows) {
    if (r.locked) continue;
    const key = cellKey(table, r.id, col.key);
    const cur = valueOf(key);
    if (typeof cur !== 'number') continue;
    const raw = op === 'mul' ? cur * n : op === 'add' ? cur + n : n;
    const { value, clamped } = fitNumber(col, raw);
    if (same(value, cur)) continue;
    out.push({ key, row: r, from: cur, to: value, clamped });
  }
  return out;
}

/* ── drift: the code default moved after an admin's edit ─────────────────── */

export interface DriftItem { key: string; row: SettingsRow; col: SettingsField; base: SettingValue; now: SettingValue; mine: SettingValue }

export function driftOf(spec: TableSpec, values: SettingsValues): DriftItem[] {
  const out: DriftItem[] = [];
  for (const row of values.rows ?? []) {
    for (const c of Array.isArray(row.overridden) ? row.overridden : []) {
      const key = cellKey(spec.key, row.id, c);
      const o = values.overridden[key];
      const col = spec.columns.find((x) => x.key === c);
      if (!o || !col || o.base === undefined || o.base === null) continue;
      const now = Object.prototype.hasOwnProperty.call(row.defaults ?? {}, c) ? row.defaults[c] : row.cells[c];
      if (!same(o.base, now)) out.push({ key, row, col, base: o.base, now, mine: row.cells[c] });
    }
  }
  return out;
}

/* ── "what this means" ───────────────────────────────────────────────────── */

const num = (v: SettingValue | undefined, fb = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
const round = (v: number) => Math.round(v);

export interface Hint { key: string; args: (string | number)[] }

/**
 * The plain sentence for one cell: a label key under label.food.preview.* and its arguments.
 *   ctx      the script's form values (buffs.*, gold.duration, poison.*) for the hints that need them
 *   name     the row's label in the viewer's language
 *   optionOf an enum value in words · cellOf another column of the same row (as shown now)
 */
export function hintFor(
  groupId: string, col: SettingsField, value: SettingValue | undefined, before: SettingValue | undefined,
  ctx: Record<string, SettingValue>, name: string,
  optionOf: (col: string, v: SettingValue | undefined) => string, cellOf: (col: string) => SettingValue | undefined,
): Hint {
  const kind = col.derived?.kind;
  const args = (col.derived?.args ?? {}) as Record<string, unknown>;
  const v = num(value);
  const b = num(before);
  if (groupId === 'horse' && col.type === 'number') {
    if (col.key === 'hunger' || col.key === 'stamina' || col.key === 'health') return { key: `label.food.preview.horse_${col.key}`, args: [v, name] };
    return { key: 'label.food.preview.generic', args: [v, b] };
  }
  if (kind === 'needAfter') {
    const start = num(args.start as number, 20);
    const after = Math.max(0, Math.min(100, start + v));
    const was = Math.max(0, Math.min(100, start + b));
    const need = args.need === 'thirst' ? 'thirst' : 'hunger';
    if (!same(value, before)) return { key: `label.food.preview.${need}Was`, args: [start, name, after, was] };
    return { key: `label.food.preview.${need}`, args: [start, name, after] };
  }
  if (kind === 'healthPercent') {
    const max = num(args.max as number, 600);
    if (v < 0) return { key: 'label.food.preview.hurt', args: [Math.abs(v), round((Math.abs(v) / max) * 100)] };
    return { key: 'label.food.preview.healNow', args: [v, round((v / max) * 100)] };
  }
  if (col.key === 'buffType' || col.key === 'buffAmount') {
    const type = String((col.key === 'buffType' ? value : cellOf('buffType')) ?? 'none');
    const amount = num(col.key === 'buffAmount' ? value : cellOf('buffAmount'));
    if (!type || type === 'none') return { key: 'label.food.preview.noBuff', args: [] };
    const drain = num(ctx[`buffs.${type}.drain`], 1) || 1;
    const tick = num(ctx['buffs.tick'], 2000) / 1000;
    const seconds = Math.round((amount / drain) * tick);
    const label = optionOf('buffType', type);
    if (type === 'vegan') {
      const per = num(ctx['buffs.vegan.amount'], 2);
      const total = Math.round((amount / drain) * per);
      return { key: 'label.food.preview.buffVegan', args: [label, seconds, total, total] };
    }
    return { key: 'label.food.preview.buff', args: [label, seconds] };
  }
  if (kind === 'kg') {
    const base = num(args.base as number, 30);
    return { key: 'label.food.preview.kg', args: [base + v, base, v] };
  }
  switch (col.key) {
    case 'stamina': return v < 0 ? { key: 'label.food.preview.staminaDown', args: [Math.abs(v)] } : { key: 'label.food.preview.stamina', args: [v] };
    case 'innerHealth': return v < 0 ? { key: 'label.food.preview.coreDown', args: [Math.abs(v)] } : { key: 'label.food.preview.core', args: [v] };
    case 'outerStamina': return { key: 'label.food.preview.run', args: [v] };
    case 'goldHealth':
    case 'goldStamina': {
      if (value === 'none') return { key: 'label.food.preview.noGold', args: [] };
      const secs = num(ctx['gold.duration'], 30);
      return { key: col.key === 'goldHealth' ? 'label.food.preview.goldHealth' : 'label.food.preview.goldStamina', args: [secs, optionOf(col.key, value)] };
    }
    case 'fx':
    case 'fxTime': {
      const fx = String((col.key === 'fx' ? value : cellOf('fx')) ?? 'none');
      const minutes = num(col.key === 'fxTime' ? value : cellOf('fxTime'));
      if (!fx || fx === 'none') return { key: 'label.food.preview.noFx', args: [] };
      return { key: 'label.food.preview.fx', args: [minutes, optionOf('fx', fx)] };
    }
    case 'poison': {
      if (v <= 0) return { key: 'label.food.preview.noPoison', args: [] };
      const dmg = num(ctx['poison.damage'], 12);
      const tick = num(ctx['poison.tick'], 2000) / 1000;
      const floor = num(ctx['poison.minHealth'], 60);
      return { key: 'label.food.preview.poison', args: [v, Math.round((v / tick) * dmg), floor] };
    }
    case 'curesPoison': return { key: value === true ? 'label.food.preview.cures' : 'label.food.preview.noCure', args: [] };
    case 'heal': return { key: value === true ? 'label.food.preview.heals' : 'label.food.preview.noHeal', args: [] };
    default: break;
  }
  if (col.type === 'number') return { key: 'label.food.preview.generic', args: [v, b] };
  return { key: 'label.food.preview.genericText', args: [optionOf(col.key, value), optionOf(col.key, before)] };
}
