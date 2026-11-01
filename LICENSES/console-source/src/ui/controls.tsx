/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · ui/controls.tsx
 * The RDR-style controls: parchment-plate buttons, ruled inputs, square toggles, thin sliders.
 * No rounded web widgets, no shadows, no gradients that the game's own screens do not have.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useId } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { cls, clamp, toFloat } from './util';
import Glyph from './Glyph';
import type { GlyphName } from './Glyph';

/* ── Buttons ─────────────────────────────────────────────────────────────── */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  kind?: 'plate' | 'danger' | 'ghost' | 'text';
  size?: 'sm' | 'md' | 'lg';
  glyph?: GlyphName;
  busy?: boolean;
  block?: boolean;
}
export function Button({ kind = 'plate', size = 'md', glyph, busy, block, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={cls('wa-btn wst-button', kind === 'plate' && 'primary', kind === 'danger' && 'danger', `wa-btn--${kind}`, `wa-btn--${size}`, block && 'wa-btn--block', busy && 'is-busy', className)}
      disabled={disabled || busy}
      {...rest}
    >
      {glyph && <Glyph name={glyph} />}
      <span className="wa-btn-label">{children}</span>
    </button>
  );
}

/* ── Labelled field wrapper ──────────────────────────────────────────────── */
export function Field({ label, hint, children, className, inline }: { label?: ReactNode; hint?: ReactNode; children: ReactNode; className?: string; inline?: boolean }) {
  return (
    <label className={cls('wa-field', inline && 'wa-field--inline', className)}>
      {label !== undefined && <span className="wa-field-label">{label}</span>}
      {children}
      {hint !== undefined && <span className="wa-field-hint">{hint}</span>}
    </label>
  );
}

/* ── Text / number inputs ────────────────────────────────────────────────── */
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: string;
  onChange(v: string): void;
  glyph?: GlyphName;
}
export function Input({ value, onChange, glyph, className, ...rest }: InputProps) {
  return (
    <span className={cls('wa-input-wrap wst-field', glyph && 'has-glyph', className)}>
      {glyph && <Glyph name={glyph} className="wa-input-glyph" />}
      <input className="wa-input wst-input" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} autoComplete="off" {...rest} />
    </span>
  );
}

export interface NumberInputProps {
  value: number;
  onChange(v: number): void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}
/** Numbers are typed LTR with Latin digits even in Arabic; the value is clamped on blur, not on every key */
export function NumberInput({ value, onChange, min, max, step, className, placeholder, disabled }: NumberInputProps) {
  return (
    <input
      type="number"
      dir="ltr"
      className={cls('wa-input wst-input', 'wa-input--num', className)}
      value={Number.isFinite(value) ? value : ''}
      min={min}
      max={max}
      step={step ?? 1}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(toFloat(e.target.value, 0))}
      onBlur={(e) => {
        const n = toFloat(e.target.value, 0);
        const lo = min ?? -Infinity;
        const hi = max ?? Infinity;
        const c = clamp(n, lo, hi);
        if (c !== n) onChange(c);
      }}
    />
  );
}

export function TextArea({ value, onChange, rows = 3, ...rest }: { value: string; onChange(v: string): void; rows?: number; placeholder?: string; maxLength?: number; disabled?: boolean }) {
  return <textarea className="wa-input wst-input wa-input--area" value={value} rows={rows} onChange={(e) => onChange(e.target.value)} spellCheck={false} {...rest} />;
}

/* ── Select ──────────────────────────────────────────────────────────────── */
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> {
  value: string;
  onChange(v: string): void;
  options: { value: string; label: string }[];
  placeholder?: string;
}
export function Select({ value, onChange, options, placeholder, className, ...rest }: SelectProps) {
  return (
    <span className={cls('wa-select-wrap wst-field', className)}>
      <select className="wa-select wst-input" value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <Glyph name="sortDown" className="wa-select-caret" />
    </span>
  );
}

/* ── Toggle (the pause menu's ON / OFF switch) ───────────────────────────── */
export function Toggle({ on, onChange, labelOn, labelOff, disabled, className }: { on: boolean; onChange(v: boolean): void; labelOn: string; labelOff: string; disabled?: boolean; className?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={cls('wa-switch', className)}
      data-on={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <span>{on ? labelOn : labelOff}</span>
    </button>
  );
}

/** A full row: label on one side, the switch on the other */
export function ToggleRow({ label, on, onChange, labelOn, labelOff, disabled, glyph }: { label: ReactNode; on: boolean; onChange(v: boolean): void; labelOn: string; labelOff: string; disabled?: boolean; glyph?: GlyphName }) {
  return (
    <div className={cls('wa-toggle-row wst-row', on && 'is-on', disabled && 'is-disabled')}>
      <span className="wa-toggle-row-label">{glyph && <Glyph name={glyph} />}{label}</span>
      <Toggle on={on} onChange={onChange} labelOn={labelOn} labelOff={labelOff} disabled={disabled} />
    </div>
  );
}

/* ── Slider ──────────────────────────────────────────────────────────────── */
export function Slider({ value, onChange, min = 0, max = 100, step = 1, label, unit, disabled }: { value: number; onChange(v: number): void; min?: number; max?: number; step?: number; label?: ReactNode; unit?: string; disabled?: boolean }) {
  const id = useId();
  const pct = max > min ? ((clamp(value, min, max) - min) / (max - min)) * 100 : 0;
  return (
    <div className={cls('wa-slider', disabled && 'is-disabled')}>
      {label !== undefined && (
        <div className="wa-slider-head">
          <label htmlFor={id}>{label}</label>
          <b dir="ltr">{Math.round(value)}{unit ?? ''}</b>
        </div>
      )}
      <div className="wa-slider-track" style={{ ['--pct' as string]: `${pct}%` }}>
        <input id={id} type="range" dir="ltr" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
      </div>
    </div>
  );
}

/* ── Meter (health / stamina / hunger / thirst bars in the table) ────────── */
export function Meter({ value, max = 100, tone = 'plain', title }: { value: number; max?: number; tone?: 'plain' | 'health' | 'stamina' | 'hunger' | 'thirst'; title?: string }) {
  const pct = max > 0 ? clamp((value / max) * 100, 0, 100) : 0;
  return (
    <span className={cls('wa-meter', `wa-meter--${tone}`, pct <= 20 && 'is-low')} title={title}>
      <span className="wa-meter-bar"><span className="wa-meter-fill" style={{ width: `${pct}%` }} /></span>
      <b dir="ltr">{Math.round(value)}</b>
    </span>
  );
}

/* ── Section / group heading ─────────────────────────────────────────────── */
export function Section({ title, children, aside, className }: { title: ReactNode; children: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <section className={cls('wa-section wst-plate', className)}>
      <header className="wa-section-head">
        <h3 className="wa-section-title">{title}</h3>
        {aside && <div className="wa-section-aside">{aside}</div>}
      </header>
      <div className="wa-section-body">{children}</div>
    </section>
  );
}

export function Empty({ text, glyph = 'info' }: { text: string; glyph?: GlyphName }) {
  return (
    <div className="wa-empty">
      <Glyph name={glyph} />
      <p>{text}</p>
    </div>
  );
}

export function Loading({ text }: { text: string }) {
  return (
    <div className="wa-empty wa-empty--loading">
      <span className="wa-spinner" aria-hidden="true" />
      <p>{text}</p>
    </div>
  );
}

export function Tag({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'ok' | 'bad' | 'dim' }) {
  return <span className={cls('wa-tag', `wa-tag--${tone}`)}>{children}</span>;
}
