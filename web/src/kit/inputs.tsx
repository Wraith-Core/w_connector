/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · kit/inputs.tsx
 * Controlled inputs. Inside a <Field> they take its id, label and "؟"; alone they need their own
 * `help` (and `label`, used as the aria-label and the note title).
 *   TextInput · TextArea · NumberInput (unit, range, never silently clamped) · Switch (on / off as TEXT)
 *   Segmented · SliderNumber
 * ════════════════════════════════════════════════════════════════════════════ */

import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode, Ref } from 'react';
import HelpTip from '../help/HelpTip';
import type { HelpFacts, HelpProp } from '../help/types';
import { useI18n } from '../i18n';
import type { Area } from '../types';
import { useField } from './Field';
import { clamp, cls, fmtNum } from './format';
import { useLock } from './Gate';
import Glyph from './Glyph';
import type { GlyphName } from './Glyph';

interface Standalone {
  /** required outside a <Field> (the lint checks it) */
  help?: HelpProp;
  /** aria-label and note title when there is no <Field> */
  label?: string;
  facts?: HelpFacts;
  area?: Area;
  /** an explicit element id (defaults to the Field's) */
  id?: string;
}

/** The "؟" of a control that stands alone (none inside a Field) */
function OwnHelp({ help, label, facts, area }: Standalone) {
  const field = useField();
  if (field || help === undefined || help === false) return null;
  return <HelpTip help={help} label={label} facts={area ? { ...facts, area } : facts} size="sm" />;
}

function useControl(p: Standalone & { disabled?: boolean; invalid?: boolean; id?: string }) {
  const field = useField();
  const lock = useLock(p.area);
  const own = useId();
  return {
    id: p.id ?? field?.id ?? own,
    describedBy: field?.describedBy,
    invalid: !!(p.invalid || field?.invalid),
    disabled: !!(p.disabled || lock.locked || field?.locked),
    ariaLabel: field ? undefined : p.label,
  };
}

/* ── TextInput ───────────────────────────────────────────────────────────── */

export interface TextInputProps extends Standalone {
  value: string;
  onChange(v: string): void;
  placeholder?: string;
  icon?: GlyphName;
  /** a × that empties the field */
  clearable?: boolean;
  onEnter?(): void;
  onKeyDown?(e: KeyboardEvent<HTMLInputElement>): void;
  onBlur?(): void;
  onFocus?(): void;
  autoFocus?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  maxLength?: number;
  dir?: 'ltr' | 'rtl' | 'auto';
  mono?: boolean;
  size?: 'sm' | 'md';
  suffix?: ReactNode;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
}

export function TextInput(p: TextInputProps) {
  const c = useControl(p);
  const { t } = useI18n();
  return (
    <span className={cls('k-ctlwrap', p.className)}>
      <span className={cls('k-input', `k-input--${p.size ?? 'md'}`, p.icon && 'has-icon', c.invalid && 'is-invalid', c.disabled && 'is-disabled')}>
        {p.icon && <Glyph name={p.icon} className="k-input-icon" />}
        <input
          ref={p.inputRef}
          id={c.id}
          type="text"
          value={p.value}
          placeholder={p.placeholder}
          disabled={c.disabled}
          maxLength={p.maxLength}
          dir={p.dir}
          className={cls(p.mono && 'k-mono')}
          aria-label={c.ariaLabel}
          aria-invalid={c.invalid || undefined}
          aria-describedby={c.describedBy}
          autoFocus={p.autoFocus}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => p.onChange(e.target.value)}
          onKeyDown={(e) => {
            p.onKeyDown?.(e);
            if (e.defaultPrevented) return;
            if (e.key === 'Enter' && p.onEnter) { e.preventDefault(); p.onEnter(); }
          }}
          onBlur={p.onBlur}
          onFocus={p.onFocus}
        />
        {p.suffix && <span className="k-input-suffix">{p.suffix}</span>}
        {p.clearable && p.value && !c.disabled && (
          <button type="button" className="k-input-clear" aria-label={t('label.common.close')} onClick={() => p.onChange('')}>
            <Glyph name="close" />
          </button>
        )}
      </span>
      <OwnHelp {...p} />
    </span>
  );
}

/* ── TextArea ────────────────────────────────────────────────────────────── */

export interface TextAreaProps extends Standalone {
  value: string;
  onChange(v: string): void;
  rows?: number;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  /** shows "12 / 200" under the box */
  counter?: boolean;
  /** the writing direction (an English text inside the Arabic page: 'ltr') */
  dir?: 'ltr' | 'rtl' | 'auto';
  className?: string;
}

export function TextArea(p: TextAreaProps) {
  const c = useControl(p);
  return (
    <span className={cls('k-ctlwrap k-ctlwrap--block', p.className)}>
      <span className={cls('k-textarea', c.invalid && 'is-invalid', c.disabled && 'is-disabled')}>
        <textarea
          id={c.id}
          value={p.value}
          rows={p.rows ?? 3}
          placeholder={p.placeholder}
          maxLength={p.maxLength}
          disabled={c.disabled}
          dir={p.dir}
          aria-label={c.ariaLabel}
          aria-invalid={c.invalid || undefined}
          aria-describedby={c.describedBy}
          autoFocus={p.autoFocus}
          spellCheck={false}
          onChange={(e) => p.onChange(e.target.value)}
        />
        {p.counter && p.maxLength && <span className="k-textarea-count k-num">{p.value.length} / {p.maxLength}</span>}
      </span>
      <OwnHelp {...p} />
    </span>
  );
}

/* ── NumberInput ─────────────────────────────────────────────────────────── */

export interface NumberInputProps extends Standalone {
  value: number | null;
  onChange(v: number | null): void;
  min?: number;
  max?: number;
  step?: number;
  /** only whole numbers */
  integer?: boolean;
  unit?: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  /** clamp into [min, max] on blur instead of marking it invalid (the settings pages never clamp) */
  clampOnBlur?: boolean;
  /** a line under the box: "allowed 0 to 25" */
  showRange?: boolean;
  onEnter?(): void;
  size?: 'sm' | 'md';
  className?: string;
  autoFocus?: boolean;
}

const parseNum = (s: string): number | null => {
  const n = parseFloat(s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/** Typed LTR with Latin digits in both languages. Out-of-range values are shown as invalid, not changed. */
export function NumberInput(p: NumberInputProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string>(p.value === null || p.value === undefined ? '' : String(p.value));
  const last = useRef(p.value);
  useEffect(() => {
    if (p.value !== last.current) {
      last.current = p.value;
      const cur = parseNum(draft);
      if (cur !== p.value) setDraft(p.value === null || p.value === undefined ? '' : String(p.value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.value]);
  const n = parseNum(draft);
  const outOfRange = n !== null && ((p.min !== undefined && n < p.min) || (p.max !== undefined && n > p.max));
  const notInt = n !== null && p.integer && n % 1 !== 0;
  const c = useControl({ ...p, invalid: p.invalid || outOfRange || notInt });
  const range = p.min !== undefined || p.max !== undefined;
  const facts: HelpFacts = { ...p.facts, range: range ? { min: p.min, max: p.max, unit: p.unit } : undefined };
  return (
    <span className={cls('k-ctlwrap k-ctlwrap--num', p.className)}>
      <span className="k-numwrap">
        <span className={cls('k-input', 'k-input--num', `k-input--${p.size ?? 'md'}`, c.invalid && 'is-invalid', c.disabled && 'is-disabled')}>
          <input
            id={c.id}
            type="text"
            inputMode="decimal"
            dir="ltr"
            value={draft}
            placeholder={p.placeholder}
            disabled={c.disabled}
            aria-label={c.ariaLabel}
            aria-invalid={c.invalid || undefined}
            aria-describedby={c.describedBy}
            aria-valuemin={p.min}
            aria-valuemax={p.max}
            autoFocus={p.autoFocus}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              const s = e.target.value;
              setDraft(s);
              const v = parseNum(s);
              last.current = v;
              p.onChange(v);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && p.onEnter) { e.preventDefault(); p.onEnter(); return; }
              if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
              e.preventDefault();
              const step = p.step ?? 1;
              let v = (n ?? 0) + (e.key === 'ArrowUp' ? step : -step);
              v = clamp(v, p.min ?? -Infinity, p.max ?? Infinity);
              v = Math.round(v * 1e6) / 1e6;
              setDraft(String(v)); last.current = v; p.onChange(v);
            }}
            onBlur={() => {
              if (n === null) return;
              if (p.clampOnBlur) {
                let v = clamp(n, p.min ?? -Infinity, p.max ?? Infinity);
                if (p.integer) v = Math.round(v);
                if (v !== n) { setDraft(String(v)); last.current = v; p.onChange(v); }
              }
            }}
          />
          {p.unit && <span className="k-input-unit">{p.unit}</span>}
        </span>
        <OwnHelp {...p} facts={facts} />
      </span>
      {(p.showRange || outOfRange) && range && (
        <span className={cls('k-numrange', outOfRange && 'is-invalid')}>
          {t('label.common.allowed')} <b className="k-num">{t('label.common.range', fmtNum(p.min ?? NaN, 3), fmtNum(p.max ?? NaN, 3))}</b>
        </span>
      )}
    </span>
  );
}

/* ── Switch ──────────────────────────────────────────────────────────────── */

export interface SwitchProps extends Standalone {
  checked: boolean;
  onChange(v: boolean): void;
  onText?: string;
  offText?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

/** On / off written as text ("مفعّل / متوقف"), never a colour alone */
export function Switch(p: SwitchProps) {
  const { t } = useI18n();
  const c = useControl(p);
  return (
    <span className={cls('k-ctlwrap', p.className)}>
      <button
        id={c.id}
        type="button"
        role="switch"
        aria-checked={p.checked}
        aria-label={c.ariaLabel}
        aria-describedby={c.describedBy}
        disabled={c.disabled}
        className={cls('k-switch', `k-switch--${p.size ?? 'md'}`, p.checked && 'is-on')}
        onClick={() => p.onChange(!p.checked)}
      >
        <span className={cls('k-switch-opt', p.checked && 'is-active')}>{p.onText ?? t('label.common.on')}</span>
        <span className={cls('k-switch-opt', !p.checked && 'is-active')}>{p.offText ?? t('label.common.off')}</span>
      </button>
      <OwnHelp {...p} />
    </span>
  );
}

/* ── Segmented ───────────────────────────────────────────────────────────── */

export interface SegmentOption<V extends string | number> { value: V; label: ReactNode; help?: HelpProp; disabled?: boolean }

export interface SegmentedProps<V extends string | number> extends Standalone {
  value: V;
  /* NoInfer: V comes from `value`, so a useState setter of a literal union fits */
  onChange(v: NoInfer<V>): void;
  options: SegmentOption<NoInfer<V>>[];
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
}

export function Segmented<V extends string | number>(p: SegmentedProps<V>) {
  const c = useControl(p);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = p.options.findIndex((o) => o.value === p.value);
  const move = (d: number) => {
    const n = p.options.length;
    for (let i = 1; i <= n; i++) {
      const j = (((idx < 0 ? 0 : idx) + d * i) % n + n) % n;
      if (!p.options[j].disabled) { p.onChange(p.options[j].value); refs.current[j]?.focus(); return; }
    }
  };
  return (
    <span className={cls('k-ctlwrap', p.className)}>
      <span
        role="radiogroup"
        aria-label={c.ariaLabel}
        aria-describedby={c.describedBy}
        className={cls('k-seg', `k-seg--${p.size ?? 'md'}`)}
        onKeyDown={(e) => {
          const rtl = document.documentElement.dir === 'rtl';
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            move((e.key === 'ArrowRight') !== rtl ? 1 : -1);
          }
        }}
      >
        {p.options.map((o, i) => (
          <span className="k-seg-item" key={String(o.value)}>
            <button
              ref={(el) => { refs.current[i] = el; }}
              type="button"
              role="radio"
              aria-checked={o.value === p.value}
              tabIndex={o.value === p.value || (idx < 0 && i === 0) ? 0 : -1}
              disabled={c.disabled || o.disabled}
              className={cls('k-seg-btn', o.value === p.value && 'is-on')}
              onClick={() => p.onChange(o.value)}
            >
              {o.label}
            </button>
            {o.help !== undefined && o.help !== false && <HelpTip help={o.help} label={typeof o.label === 'string' ? o.label : undefined} size="sm" className="k-seg-help" />}
          </span>
        ))}
      </span>
      <OwnHelp {...p} />
    </span>
  );
}

/* ── SliderNumber ────────────────────────────────────────────────────────── */

export interface SliderNumberProps extends Standalone {
  value: number;
  onChange(v: number): void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  className?: string;
}

/** A thin slider with the exact number beside it (monochrome; the fill turns red only under 20 %) */
export function SliderNumber(p: SliderNumberProps) {
  const c = useControl(p);
  const pct = p.max > p.min ? ((clamp(p.value, p.min, p.max) - p.min) / (p.max - p.min)) * 100 : 0;
  return (
    <span className={cls('k-ctlwrap k-ctlwrap--block', p.className)}>
      <span className={cls('k-slider', c.disabled && 'is-disabled', pct < 20 && 'is-low')}>
        <span className="k-slider-track" style={{ ['--pct' as string]: `${pct}%` }}>
          <input
            id={c.id}
            type="range"
            dir="ltr"
            min={p.min}
            max={p.max}
            step={p.step ?? 1}
            value={p.value}
            disabled={c.disabled}
            aria-label={c.ariaLabel}
            aria-describedby={c.describedBy}
            onChange={(e) => p.onChange(Number(e.target.value))}
          />
        </span>
        <NumberInput id={`${c.id}-num`} value={p.value} onChange={(v) => v !== null && p.onChange(v)} min={p.min} max={p.max} step={p.step} unit={p.unit} size="sm" disabled={c.disabled} clampOnBlur label={p.label} help={false} />
      </span>
      <OwnHelp {...p} facts={{ ...p.facts, range: { min: p.min, max: p.max, unit: p.unit } }} />
    </span>
  );
}
