/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/hub/model.ts
 * Plain helpers of the Scripts hub: rank checks, script states, filters, the value formatting and
 * validation of settings fields (a mirror of w_lib w.settings.validate), and the calculated hints
 * ("hunger empties in about 2 hours 30 minutes"). No React here.
 * ════════════════════════════════════════════════════════════════════════════ */

import type { TFn } from '../../i18n';
import type { CitizenState } from '../../kit';
import { countOf, pluralForm } from '../../i18n';
import { fmtNum, sameCitizen as kitSameCitizen } from '../../kit';
import type { AppCtx } from '../../ctx';
import type {
  Lang, Level, LocalText, ModuleDescriptor, ModuleGroup, ModuleLock, QuickArg, QuickCommand, Rank, SettingValue, SettingsField, SettingsGroup, SettingsSchema,
} from '../../types';

/* ── ranks ───────────────────────────────────────────────────────────────── */

const RANKS: Rank[] = ['mod', 'admin', 'god', 'owner'];

/** The admin's rank: the L1 `rank`, else the w_core group when it is a level name, else null (unknown) */
export function rankOf(app: Pick<AppCtx, 'rank' | 'admin'>): Rank | null {
  if (app.rank) return app.rank;
  const g = app.admin?.group;
  return g === 'mod' || g === 'admin' || g === 'god' ? g : null;
}

/** True when the rank covers the level. An unknown rank passes: the server re-checks everything. */
export function levelOk(rank: Rank | null, need: Level | undefined | null): boolean {
  if (!need || !rank) return true;
  return RANKS.indexOf(rank) >= RANKS.indexOf(need);
}

/* ── scripts ─────────────────────────────────────────────────────────────── */

export const GROUP_ORDER: (ModuleGroup | 'other')[] = ['economy', 'animals', 'world', 'tribes', 'player', 'fun', 'system', 'other'];
export const groupOf = (m: ModuleDescriptor): ModuleGroup | 'other' => (GROUP_ORDER.includes(m.group) ? m.group : 'other');

export type StateKind = 'started' | 'stopped' | 'missing' | 'starting' | 'stopping' | 'unknown';
export function stateOf(m: ModuleDescriptor): StateKind {
  const s = String(m.state ?? '');
  if (s === 'started' || s === 'stopped' || s === 'missing' || s === 'starting' || s === 'stopping') return s;
  return 'unknown';
}
export const isRunning = (m: ModuleDescriptor) => stateOf(m) === 'started';
export const isDown = (m: ModuleDescriptor) => { const s = stateOf(m); return s === 'stopped' || s === 'missing'; };

export type FilterId = 'all' | 'panel' | 'commands' | 'settings' | 'stopped';
export const FILTERS: FilterId[] = ['all', 'panel', 'commands', 'settings', 'stopped'];

export function matchesFilter(m: ModuleDescriptor, f: FilterId, hasSettings: (m: ModuleDescriptor) => boolean): boolean {
  if (f === 'panel') return !!m.panel;
  if (f === 'commands') return (m.commands?.length ?? 0) > 0;
  if (f === 'settings') return hasSettings(m);
  if (f === 'stopped') return isDown(m);
  return true;
}

const norm = (s: string) => s.toLocaleLowerCase().normalize('NFKD').replace(/[ً-ٰٟـ]/g, '');

export function matchesSearch(m: ModuleDescriptor, q: string): boolean {
  const s = norm(q.trim());
  if (!s) return true;
  const hay = [m.resource, m.label?.ar, m.label?.en, m.description?.ar, m.description?.en].filter(Boolean).join(' ');
  return norm(hay).includes(s);
}

/** A lock in words the admin can act on: the script's own reason, else the level or permission it needs */
export function lockText(t: TFn, lt: (x: LocalText | string | null | undefined) => string, lock: ModuleLock | undefined): string | null {
  if (!lock) return null;
  if (lock.text) return lt(lock.text);
  if (lock.level) return t('label.hub.lockedLevel', t(`label.common.level.${lock.level}`));
  if (lock.ace) return t('label.hub.lockedAce', lock.ace);
  return t('label.common.locked');
}

/* ── citizen previews ────────────────────────────────────────────────────── */

/** Two previews that say the same thing (the kit's CitizenIdInput now hands a stable state; the
 *  comparison stays as a cheap guard for the per-argument map) */
export const sameCitizen = (a: CitizenState | undefined, b: CitizenState | undefined): boolean => kitSameCitizen(a, b);

/* ── Lua tables as they arrive ───────────────────────────────────────────── */

/** An empty Lua table reaches the page as [] or {}; a list may also arrive as an object keyed 1..n */
export function asList<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === 'object') return Object.values(v as Record<string, T>);
  return [];
}

/** Every list inside a descriptor made safe to .map() (commands, their args, the select options) */
export function normalizeModule(m: ModuleDescriptor): ModuleDescriptor {
  const commands = m.commands === undefined || m.commands === null ? undefined
    : asList<QuickCommand>(m.commands).map((c) => ({
      ...c,
      args: asList<QuickArg>(c.args).map((a): QuickArg => (a.options === undefined ? a : { ...a, options: asList<NonNullable<QuickArg['options']>[number]>(a.options) })),
    }));
  return commands === undefined ? m : { ...m, commands };
}

export function normalizeModules(list: ModuleDescriptor[] | null | undefined): ModuleDescriptor[] | null {
  if (list === null || list === undefined) return null;
  return asList<ModuleDescriptor>(list).filter((m) => m && typeof m === 'object' && typeof m.resource === 'string').map(normalizeModule);
}

/* ── settings values ─────────────────────────────────────────────────────── */

export function sameValue(a: SettingValue | undefined, b: SettingValue | undefined): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** display = stored × scale (ms shown as s) */
export const toShown = (f: SettingsField, v: number) => (f.scale ? v * f.scale : v);
export const toStored = (f: SettingsField, v: number) => (f.scale ? v / f.scale : v);

export type Invalid = 'empty' | 'range' | 'integer' | 'length' | 'pattern' | 'option' | 'type';

/** The same checks w.settings.validate runs (out of range is refused, never clamped) */
export function validate(f: SettingsField, v: SettingValue | undefined): Invalid | null {
  if (f.type === 'number') {
    if (v === null || v === undefined) return 'empty';
    if (typeof v !== 'number' || !Number.isFinite(v)) return 'type';
    if ((f.min !== undefined && v < f.min - 1e-9) || (f.max !== undefined && v > f.max + 1e-9)) return 'range';
    if (f.integer && Math.abs(v - Math.round(v)) > 1e-9) return 'integer';
    return null;
  }
  if (f.type === 'bool') return typeof v === 'boolean' ? null : 'type';
  if (f.type === 'enum') return (f.options ?? []).some((o) => String(o.value) === String(v)) ? null : 'option';
  if (f.type === 'text') {
    if (typeof v !== 'string') return 'type';
    if (f.maxLength !== undefined && v.length > f.maxLength) return 'length';
    if (v !== '' && f.pattern) {
      try { if (!new RegExp(f.pattern).test(v)) return 'pattern'; } catch { /* a bad pattern is the script's problem */ }
    }
    return null;
  }
  if (f.type === 'list') {
    if (!Array.isArray(v)) return 'type';
    if (f.maxItems !== undefined && v.length > f.maxItems) return 'length';
    return null;
  }
  return null;
}

/** A value in words: On / Off, the option label, the number with its unit, "text" */
export function fmtValue(f: SettingsField | undefined, v: SettingValue | undefined, t: TFn, lt: (x: LocalText | string | null | undefined) => string): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return t(v ? 'label.hub.value.on' : 'label.hub.value.off');
  if (f?.type === 'enum') {
    const o = (f.options ?? []).find((x) => String(x.value) === String(v));
    if (o) return lt(o.label);
  }
  if (typeof v === 'number') {
    const n = f ? toShown(f, v) : v;
    const unit = f?.unit ? lt(f.unit) : '';
    return `${fmtNum(n, 3)}${unit ? ` ${unit}` : ''}`;
  }
  if (typeof v === 'string') return v === '' ? t('label.hub.value.empty') : `«${v}»`;
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

/* ── schema walking ──────────────────────────────────────────────────────── */

/** The table field of a table group (food, satchels), if any */
export const tableOf = (g: SettingsGroup): SettingsField | undefined => g.fields.find((f) => f.type === 'table');
export const isTableGroup = (g: SettingsGroup) => g.type === 'table' || !!tableOf(g);

/** The group a stored key belongs to ('needs.hungerRate' → needs; 'food.apple.hunger' → food) */
export function groupOfKey(schema: SettingsSchema, key: string): SettingsGroup | undefined {
  return schema.groups.find((g) => g.fields.some((f) => f.key === key && f.type !== 'table'))
    ?? schema.groups.find((g) => isTableGroup(g) && key.startsWith(`${(tableOf(g)?.key ?? g.id)}.`))
    ?? schema.groups.find((g) => key.startsWith(`${g.id}.`));
}

/** The first sentence of a help text, used as the one-line description under a setting's label */
export function firstSentence(text: string): string {
  const m = /^(.+?[.!؟?])(\s|$)/.exec(text.trim());
  return (m ? m[1] : text).trim();
}

/* ── calculated hints ────────────────────────────────────────────────────── */

type Unit = 'day' | 'hour' | 'minute' | 'second';
/** Arabic says "ساعة" and "ساعتان" without a number; everything else "5 ساعات" / "2 hours" */
function count(t: TFn, lang: Lang, n: number, unit: Unit): string {
  if (lang === 'ar' && (n === 1 || n === 2)) return t(`label.common.unit.${unit}.${pluralForm(n, lang)}`);
  return countOf(t, lang, n, unit);
}

/** seconds → "ساعتان و5 دقائق" / "2 hours and 5 minutes" (the two largest parts) */
export function fmtSpan(t: TFn, lang: Lang, seconds: number): string {
  let s = Math.max(0, Math.round(seconds));
  if (s < 60) return count(t, lang, s, 'second');
  s = Math.round(s / 60) * 60;
  const parts: [number, Unit][] = [[Math.floor(s / 86400), 'day'], [Math.floor((s % 86400) / 3600), 'hour'], [Math.floor((s % 3600) / 60), 'minute']];
  const first = parts.findIndex(([n]) => n > 0);
  const out = parts.slice(first, first + 2).filter(([n]) => n > 0).map(([n, u]) => count(t, lang, n, u));
  return out.join(lang === 'ar' ? ' و' : ' and ');
}

export type Getter = (key: string) => SettingValue | undefined;

const numOf = (v: SettingValue | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** "With these numbers the bar empties in about 2 hours · 30 minutes" and friends; null when not computable */
export function derivedHint(f: SettingsField, get: Getter, t: TFn, lang: Lang, rowValue?: SettingValue): string | null {
  const d = f.derived;
  if (!d) return null;
  const args = (d.args ?? {}) as Record<string, unknown>;
  const ref = (name: string, fallback?: string): number | null => {
    const k = typeof args[name] === 'string' ? (args[name] as string) : fallback;
    return k ? numOf(get(k)) : null;
  };
  if (d.kind === 'drainTime') {
    const rate = ref('rate', f.key);
    const interval = ref('interval');
    if (rate === null || interval === null) return null;
    if (rate <= 0) return t('label.hub.derived.never');
    return t('label.hub.derived.drain', fmtSpan(t, lang, (100 / rate) * interval));
  }
  if (d.kind === 'deathTime') {
    const amount = ref('amount');
    const interval = ref('interval', f.key);
    const prefix = f.key.includes('.') ? f.key.slice(0, f.key.lastIndexOf('.') + 1) : '';
    if (get(`${prefix}enabled`) === false) return t('label.hub.derived.off');
    if (amount === null || interval === null || amount <= 0) return null;
    const line = t('label.hub.derived.death', fmtSpan(t, lang, (100 / amount) * interval));
    return get(`${prefix}canKill`) === false ? `${line}${lang === 'ar' ? '، ' : ', '}${t('label.hub.derived.noKill')}` : line;
  }
  if (d.kind === 'kg') {
    const v = numOf(rowValue ?? get(f.key));
    if (v === null) return null;
    const base = typeof args.base === 'number' ? args.base : 30;
    return t('label.hub.derived.kg', fmtNum(base + v, 1));
  }
  return null;
}
