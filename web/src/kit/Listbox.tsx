/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · kit/Listbox.tsx
 *   <Select value options onChange />        a short fixed list (a styled listbox, not the CEF native popup)
 *   <Combobox value options onChange />      a searchable list: items, jobs, models (replaces giant selects)
 * Keyboard: ↓ / Enter / Space open · ↑ ↓ move · Enter picks · Esc closes (without closing the console)
 * · typing searches (Combobox) or jumps to the first match (Select).
 * ════════════════════════════════════════════════════════════════════════════ */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import HelpTip from '../help/HelpTip';
import type { HelpFacts, HelpProp } from '../help/types';
import { useI18n } from '../i18n';
import type { Area } from '../types';
import { useField } from './Field';
import { cls } from './format';
import { useLock } from './Gate';
import Glyph from './Glyph';

export interface Option<V extends string = string> {
  value: V;
  label: string;
  /** a second, dimmer line (a model name, a grade) */
  sub?: string;
  disabled?: boolean;
}

interface ListboxBase<V extends string> {
  value: V | '';
  onChange(v: V): void;
  options: Option<V>[];
  placeholder?: string;
  help?: HelpProp;
  label?: string;
  facts?: HelpFacts;
  area?: Area;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  id?: string;
}

export interface SelectProps<V extends string = string> extends ListboxBase<V> {}
export interface ComboboxProps<V extends string = string> extends ListboxBase<V> {
  searchPlaceholder?: string;
  emptyText?: string;
  /** at most this many rows are drawn (default 200) */
  limit?: number;
  renderOption?(o: Option<V>): ReactNode;
}

const norm = (s: string) => s.toLocaleLowerCase().normalize('NFKD').replace(/[ً-ٰٟ]/g, '');

function usePosition(anchor: HTMLElement | null, open: boolean) {
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxH: number; up: boolean } | null>(null);
  useLayoutEffect(() => {
    if (!open || !anchor) { setPos(null); return; }
    const calc = () => {
      const r = anchor.getBoundingClientRect();
      const vh = window.innerHeight;
      const below = vh - r.bottom - 12;
      const above = r.top - 12;
      const up = below < 220 && above > below;
      const maxH = Math.max(140, Math.min(360, up ? above : below));
      setPos({ top: up ? r.top - 4 : r.bottom + 4, left: r.left, width: Math.max(r.width, 200), maxH, up });
    };
    calc();
    window.addEventListener('resize', calc);
    window.addEventListener('scroll', calc, true);
    return () => { window.removeEventListener('resize', calc); window.removeEventListener('scroll', calc, true); };
  }, [open, anchor]);
  return pos;
}

function ListPopup<V extends string>({
  anchor, open, options, value, active, setActive, onPick, onClose, search, onSearch, searchPlaceholder, emptyText, renderOption, listId,
}: {
  anchor: HTMLElement | null; open: boolean; options: Option<V>[]; value: V | ''; active: number; setActive(i: number): void;
  onPick(o: Option<V>): void; onClose(): void; search?: string; onSearch?(s: string): void; searchPlaceholder?: string;
  emptyText: string; renderOption?(o: Option<V>): ReactNode; listId: string;
}) {
  const pos = usePosition(anchor, open);
  const listRef = useRef<HTMLDivElement>(null);
  const { rtl } = useI18n();
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchor?.contains(t) || listRef.current?.parentElement?.contains(t)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [open, anchor, onClose]);
  if (!open || !pos) return null;
  const style = {
    position: 'fixed' as const,
    top: pos.up ? undefined : pos.top,
    bottom: pos.up ? window.innerHeight - pos.top : undefined,
    left: rtl ? undefined : pos.left,
    right: rtl && anchor ? window.innerWidth - anchor.getBoundingClientRect().right : undefined,
    width: pos.width,
  };
  return createPortal(
    <div className="k-pop k-layer" style={style} dir={rtl ? 'rtl' : 'ltr'}>
      {onSearch && (
        <div className="k-pop-search">
          <Glyph name="search" />
          <input
            autoFocus
            value={search}
            placeholder={searchPlaceholder}
            onChange={(e) => onSearch(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            aria-controls={listId}
          />
        </div>
      )}
      <div ref={listRef} className="k-pop-list" role="listbox" id={listId} style={{ maxHeight: pos.maxH }}>
        {options.length === 0 && <div className="k-pop-empty">{emptyText}</div>}
        {options.map((o, i) => (
          <div
            key={o.value}
            data-i={i}
            role="option"
            aria-selected={o.value === value}
            aria-disabled={o.disabled || undefined}
            className={cls('k-pop-opt', i === active && 'is-active', o.value === value && 'is-selected', o.disabled && 'is-disabled')}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => { e.preventDefault(); if (!o.disabled) onPick(o); }}
          >
            {renderOption ? renderOption(o) : (
              <>
                <span className="k-pop-label">{o.label}</span>
                {o.sub && <span className="k-pop-sub">{o.sub}</span>}
              </>
            )}
            {o.value === value && <Glyph name="check" className="k-pop-check" />}
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

function useListbox<V extends string>(p: ListboxBase<V>, searchable: boolean, limit = 200) {
  const field = useField();
  const lock = useLock(p.area);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const filtered = useMemo(() => {
    if (!searchable || !search.trim()) return p.options.slice(0, limit);
    const q = norm(search.trim());
    const out: Option<V>[] = [];
    for (const o of p.options) {
      if (norm(o.label).includes(q) || norm(o.value).includes(q) || (o.sub && norm(o.sub).includes(q))) out.push(o);
      if (out.length >= limit) break;
    }
    return out;
  }, [p.options, search, searchable, limit]);
  const openList = () => {
    if (p.disabled || lock.locked || field?.locked) return;
    const i = filtered.findIndex((o) => o.value === p.value);
    setActive(i < 0 ? 0 : i);
    setOpen(true);
  };
  const close = () => { setOpen(false); setSearch(''); btn.current?.focus(); };
  const pick = (o: Option<V>) => { p.onChange(o.value); close(); };
  const typeahead = useRef({ s: '', at: 0 });
  const onKey = (e: KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openList(); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(filtered.length - 1, a + 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); return; }
    if (e.key === 'Home') { e.preventDefault(); setActive(0); return; }
    if (e.key === 'End') { e.preventDefault(); setActive(filtered.length - 1); return; }
    if (e.key === 'Enter') { e.preventDefault(); const o = filtered[active]; if (o && !o.disabled) pick(o); return; }
    if (e.key === 'Tab') { setOpen(false); setSearch(''); return; }
    if (!searchable && e.key.length === 1) {
      const now = Date.now();
      typeahead.current.s = now - typeahead.current.at > 700 ? e.key : typeahead.current.s + e.key;
      typeahead.current.at = now;
      const q = norm(typeahead.current.s);
      const i = filtered.findIndex((o) => norm(o.label).startsWith(q));
      if (i >= 0) setActive(i);
    }
  };
  useEffect(() => { setActive(0); }, [search]);
  return { field, lock, open, setOpen, search, setSearch, active, setActive, btn, filtered, openList, close, pick, onKey };
}

function Trigger<V extends string>({ p, lb, listId, showPlaceholder }: { p: ListboxBase<V>; lb: ReturnType<typeof useListbox<V>>; listId: string; showPlaceholder: string }) {
  const sel = p.options.find((o) => o.value === p.value);
  const disabled = p.disabled || lb.lock.locked || !!lb.field?.locked;
  return (
    <button
      ref={lb.btn}
      id={p.id ?? lb.field?.id}
      type="button"
      className={cls('k-select', `k-select--${p.size ?? 'md'}`, lb.open && 'is-open', !sel && 'is-empty', lb.field?.invalid && 'is-invalid')}
      aria-haspopup="listbox"
      aria-expanded={lb.open}
      aria-controls={listId}
      aria-label={lb.field ? undefined : p.label}
      aria-describedby={lb.field?.describedBy}
      disabled={disabled}
      onClick={() => (lb.open ? lb.close() : lb.openList())}
      onKeyDown={lb.onKey}
    >
      <span className="k-select-value">{sel ? sel.label : showPlaceholder}</span>
      {sel?.sub && <span className="k-select-sub">{sel.sub}</span>}
      <Glyph name="chevronDown" className="k-select-caret" />
    </button>
  );
}

export function Select<V extends string = string>(p: SelectProps<V>) {
  const { t } = useI18n();
  const lb = useListbox(p, false);
  const listId = `${p.id ?? lb.field?.id ?? 'sel'}-list`;
  return (
    <span className={cls('k-ctlwrap', p.className)}>
      <Trigger p={p} lb={lb} listId={listId} showPlaceholder={p.placeholder ?? t('label.common.chooseOne')} />
      <ListPopup
        anchor={lb.btn.current} open={lb.open} options={lb.filtered} value={p.value} active={lb.active} setActive={lb.setActive}
        onPick={lb.pick} onClose={() => lb.setOpen(false)} emptyText={t('label.common.empty')} listId={listId}
      />
      {!lb.field && p.help !== undefined && p.help !== false && <HelpTip help={p.help} label={p.label} facts={p.area ? { ...p.facts, area: p.area } : p.facts} size="sm" />}
    </span>
  );
}

export function Combobox<V extends string = string>(p: ComboboxProps<V>) {
  const { t } = useI18n();
  const lb = useListbox(p, true, p.limit);
  const listId = `${p.id ?? lb.field?.id ?? 'cmb'}-list`;
  return (
    /* the search box lives in a portal; its keys bubble here through the React tree */
    <span className={cls('k-ctlwrap', p.className)} onKeyDown={lb.open ? (e) => { if (e.target !== lb.btn.current) lb.onKey(e); } : undefined}>
      <Trigger p={p} lb={lb} listId={listId} showPlaceholder={p.placeholder ?? t('label.common.chooseOne')} />
      <ListPopup
        anchor={lb.btn.current} open={lb.open} options={lb.filtered} value={p.value} active={lb.active} setActive={lb.setActive}
        onPick={lb.pick} onClose={() => { lb.setOpen(false); lb.setSearch(''); }} search={lb.search} onSearch={lb.setSearch}
        searchPlaceholder={p.searchPlaceholder ?? t('label.common.search')} emptyText={p.emptyText ?? t('label.common.noMatch')}
        renderOption={p.renderOption} listId={listId}
      />
      {!lb.field && p.help !== undefined && p.help !== false && <HelpTip help={p.help} label={p.label} facts={p.area ? { ...p.facts, area: p.area } : p.facts} size="sm" />}
    </span>
  );
}
