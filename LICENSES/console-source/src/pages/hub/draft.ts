/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/hub/draft.ts
 * The unsaved edits of one script's settings page, shared by every group, the SaveBar, the review
 * dialog and any group editor another task plugs in (pages/hub/<folder>/index.tsx, see extend.ts).
 *
 *   store.set(key, value)   an edit (setting it back to the value in effect drops it)
 *   store.reset(key)        back to the script's default (sent as { reset: true })
 *   store.clear(key)        forget the edit
 *   useCell(store, key)     a component re-renders only when ITS key changes (a 150-row food table
 *                           stays fast while the admin types)
 *
 * Keys are the schema's stored keys: 'needs.hungerRate', and '<group>.<row>.<column>' for table cells.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useSyncExternalStore } from 'react';
import type { LocalText, SettingValue, SettingsChange, SettingsField } from '../../types';
import { sameValue, validate } from './model';
import type { Invalid } from './model';

export type DraftEntry = { to: SettingValue; reset?: undefined } | { reset: true; to?: undefined };

/** What the page knows about one key: the value in effect, the default, its field and where it sits */
export interface DraftBase {
  value: SettingValue;
  def: SettingValue;
  field: SettingsField;
  group: string;
  /** table cells: the row id and its label (for the review sentence) */
  row?: string;
  rowLabel?: LocalText;
  /** a locked table row: never editable */
  locked?: boolean;
}

export class DraftStore {
  private entries = new Map<string, DraftEntry>();
  private bases = new Map<string, DraftBase>();
  private listeners = new Set<() => void>();
  /** grows on every change: the snapshot of useDraftVersion */
  version = 0;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  private emit() {
    this.version++;
    for (const fn of Array.from(this.listeners)) fn();
  }

  /** Registers the values now in effect (after a load or a save). An edit that now equals its base is dropped. */
  load(list: [string, DraftBase][]) {
    for (const [k, b] of list) {
      this.bases.set(k, b);
      const e = this.entries.get(k);
      if (e && !e.reset && sameValue(e.to, b.value)) this.entries.delete(k);
      if (e && e.reset && sameValue(b.value, b.def)) this.entries.delete(k);
    }
    this.emit();
  }

  baseOf(key: string): DraftBase | undefined { return this.bases.get(key); }
  entryOf(key: string): DraftEntry | undefined { return this.entries.get(key); }

  /** The value the admin sees: the edit, the default when reset, else the value in effect */
  valueOf(key: string): SettingValue | undefined {
    const e = this.entries.get(key);
    const b = this.bases.get(key);
    if (e?.reset) return b?.def;
    if (e) return e.to;
    return b?.value;
  }

  set(key: string, value: SettingValue) {
    const b = this.bases.get(key);
    if (!b || b.locked) return;
    if (sameValue(value, b.value)) this.entries.delete(key);
    else if (sameValue(value, b.def)) this.entries.set(key, { reset: true });
    else this.entries.set(key, { to: value });
    this.emit();
  }

  reset(key: string) {
    const b = this.bases.get(key);
    if (!b || b.locked) return;
    if (sameValue(b.value, b.def)) this.entries.delete(key);
    else this.entries.set(key, { reset: true });
    this.emit();
  }

  clear(key: string) {
    if (this.entries.delete(key)) this.emit();
  }

  clearAll() {
    if (this.entries.size === 0) return;
    this.entries.clear();
    this.emit();
  }

  /** Drops edits that belong to one group (after that group was saved or reloaded elsewhere) */
  clearWhere(pred: (key: string, base: DraftBase | undefined) => boolean) {
    let hit = false;
    for (const k of Array.from(this.entries.keys())) if (pred(k, this.bases.get(k))) { this.entries.delete(k); hit = true; }
    if (hit) this.emit();
  }

  get size(): number { return this.entries.size; }
  keys(): string[] { return Array.from(this.entries.keys()); }

  /** Edits whose value the field refuses (empty, out of range, too long) */
  invalid(): { key: string; why: Invalid }[] {
    const out: { key: string; why: Invalid }[] = [];
    for (const [k, e] of this.entries) {
      if (e.reset) continue;
      const b = this.bases.get(k);
      if (!b) continue;
      const why = validate(b.field, e.to);
      if (why) out.push({ key: k, why });
    }
    return out;
  }

  /** The apply payload: compare-and-set against the value in effect ('from') */
  changes(): SettingsChange[] {
    const out: SettingsChange[] = [];
    for (const [k, e] of this.entries) {
      const b = this.bases.get(k);
      const from = b ? b.value : null;
      out.push(e.reset ? { key: k, from, reset: true } : { key: k, from, to: e.to });
    }
    return out;
  }

  /** How many edits sit in one group (the dirty dot and badge in the section list) */
  countIn(group: string): number {
    let n = 0;
    for (const k of this.entries.keys()) if (this.bases.get(k)?.group === group) n++;
    return n;
  }
}

/** Re-renders on every draft change (the SaveBar, the section list) */
export function useDraftVersion(store: DraftStore): number {
  return useSyncExternalStore(store.subscribe, () => store.version);
}

export interface Cell {
  /** the value shown */
  value: SettingValue | undefined;
  entry: DraftEntry | undefined;
  base: DraftBase | undefined;
  dirty: boolean;
  invalid: Invalid | null;
}

/** One key of the draft; the component re-renders only when this key's edit or base changes */
export function useCell(store: DraftStore, key: string): Cell {
  const entry = useSyncExternalStore(store.subscribe, () => store.entryOf(key));
  const base = useSyncExternalStore(store.subscribe, () => store.baseOf(key));
  const value = entry?.reset ? base?.def : entry ? entry.to : base?.value;
  const invalid = entry && !entry.reset && base ? validate(base.field, entry.to) : null;
  return { value, entry, base, dirty: !!entry, invalid };
}
