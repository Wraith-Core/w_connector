/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · kit/special.tsx
 *   CitizenIdInput  every player target: '12' (citizen id), '#5' (session number), 'OMG95204' (old id).
 *                   SENDS THE TEXT AS TYPED (w_lib w.citizen resolves it on the server). Shows a preview
 *                   chip: online players from the live list, others through post('citizen', { input }).
 *   CoordsInput     X / Y / Z (/ heading); pasting vector3(...) / vector4(...) fills every box
 *   DurationPicker  minutes, 0 = permanent; presets + a custom length
 *   ReasonField     ready reasons + free text
 * ════════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent } from 'react';
import { useApp } from '../ctx';
import HelpTip from '../help/HelpTip';
import type { HelpFacts, HelpProp } from '../help/types';
import { useI18n } from '../i18n';
import { post } from '../nui';
import type { AdminPlayer, Area, CitizenPreview } from '../types';
import { useField } from './Field';
import { cls, fmtMinutes, parseCitizen } from './format';
import type { CitizenParse } from './format';
import { NumberInput, Segmented, TextArea, TextInput } from './inputs';
import { Select } from './Listbox';

interface Standalone { help?: HelpProp; label?: string; facts?: HelpFacts; area?: Area }

function OwnHelp({ help, label, facts, area }: Standalone) {
  const field = useField();
  if (field || help === undefined || help === false) return null;
  return <HelpTip help={help} label={label} facts={area ? { ...facts, area } : facts} size="sm" />;
}

/* ── CitizenIdInput ──────────────────────────────────────────────────────── */

export type CitizenState =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'checking' }
  | { kind: 'notFound' }
  | { kind: 'found'; preview: CitizenPreview };

const cache = new Map<string, { at: number; r: CitizenState }>();
const CACHE_MS = 30000;

/* The states without data are constants: a parent that stores the preview (onResolved → setState)
   must never receive a fresh object for the same answer, or it would render forever. */
const EMPTY: CitizenState = { kind: 'empty' };
const INVALID: CitizenState = { kind: 'invalid' };
const CHECKING: CitizenState = { kind: 'checking' };
const NOT_FOUND: CitizenState = { kind: 'notFound' };

/** Two previews that say the same thing (kind, citizen id, online, session, name) */
export function sameCitizen(a: CitizenState | undefined | null, b: CitizenState | undefined | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind !== 'found' || b.kind !== 'found') return true;
  const x = a.preview; const y = b.preview;
  return x.citizenid === y.citizenid && x.online === y.online && x.source === y.source && x.name === y.name;
}

/** What the live player list already knows about a typed id */
export function citizenFromPlayers(parsed: CitizenParse, players: AdminPlayer[], selfId: number): CitizenState | null {
  if (!parsed) return INVALID;
  const toPreview = (p: AdminPlayer): CitizenState => ({
    kind: 'found',
    preview: { citizenid: p.citizenid, name: `${p.firstname ?? ''} ${p.lastname ?? ''}`.trim() || p.name, online: true, source: p.id },
  });
  if (parsed.kind === 'server') {
    const p = players.find((x) => x.id === parsed.id);
    return p ? toPreview(p) : NOT_FOUND;
  }
  if (parsed.kind === 'self') {
    const p = players.find((x) => x.id === selfId);
    return p ? toPreview(p) : null;
  }
  const p = players.find((x) => (x.citizenid || '') === parsed.id || (/^[A-Z]{3}\d{5}$/.test(parsed.id) && (x.citizenid || '').toUpperCase() === parsed.id));
  return p ? toPreview(p) : null;
}

/** Resolves a typed id the way the page previews it (live list first, then the server).
 *  The answer is referentially stable: the same state object until what it says changes (the live
 *  list is pushed every 2 s; an unchanged player keeps the previous object). */
export function useCitizenPreview(value: string, lookup = true): CitizenState {
  const { players, selfId } = useApp();
  const parsed = useMemo(() => parseCitizen(value), [value]);
  const local = useMemo(() => (value.trim() ? citizenFromPlayers(parsed, players, selfId) : EMPTY), [value, parsed, players, selfId]);
  const [remote, setRemote] = useState<CitizenState>(EMPTY);
  const seq = useRef(0);
  const localIsNull = local === null;
  useEffect(() => {
    if (!localIsNull || !lookup || !parsed) { setRemote(EMPTY); return undefined; }
    const key = parsed.kind === 'citizen' ? parsed.id : value.trim();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) { setRemote(hit.r); return undefined; }
    setRemote(CHECKING);
    const my = ++seq.current;
    const timer = window.setTimeout(async () => {
      const r = await post<CitizenPreview>('citizen', { input: value });
      if (my !== seq.current) return;
      const state: CitizenState = r.ok && r.data ? { kind: 'found', preview: r.data }
        : r.errorKey === 'citizen.invalid_id' ? INVALID : NOT_FOUND;
      cache.set(key, { at: Date.now(), r: state });
      setRemote(state);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [value, localIsNull, lookup, parsed]);
  const next: CitizenState = !value.trim() ? EMPTY : local ?? (lookup ? remote : NOT_FOUND);
  const last = useRef<CitizenState>(next);
  if (!sameCitizen(last.current, next)) last.current = next;
  return last.current;
}

export function CitizenChip({ state, needsOnline }: { state: CitizenState; needsOnline?: boolean }) {
  const { t } = useI18n();
  if (state.kind === 'empty') return null;
  if (state.kind === 'checking') return <span className="k-cchip is-checking" role="status">{t('label.common.citizen.checking')}</span>;
  if (state.kind === 'invalid') return <span className="k-cchip is-bad" role="status">{t('label.common.citizen.invalid')}</span>;
  if (state.kind === 'notFound') return <span className="k-cchip is-bad" role="status">{t('label.common.citizen.notFound')}</span>;
  const p = state.preview;
  return (
    <span className={cls('k-cchip', p.online ? 'is-online' : 'is-offline', needsOnline && !p.online && 'is-bad')} role="status">
      <span className="k-cchip-name">{p.name || p.citizenid}</span>
      <span className="k-cchip-meta">
        <span>{t('label.common.citizen.label')} <b className="k-num">{p.citizenid}</b></span>
        <span className="k-cchip-state">
          <i aria-hidden="true" className={p.online ? 'k-shape-sq' : 'k-shape-hollow'} />
          {/* "#3" is its own left-to-right island, so Arabic never shows it as "3#" */}
          {p.online ? <>{t('label.common.status.online')}{p.source ? <> · <span className="k-num">#{p.source}</span></> : null}</> : t('label.common.citizen.offline')}
        </span>
      </span>
    </span>
  );
}

export interface CitizenIdInputProps extends Standalone {
  value: string;
  onChange(v: string): void;
  /** the preview as it changes (e.g. to enable a button only when the player exists) */
  onResolved?(state: CitizenState): void;
  /** ask the server about ids that are not online (default true) */
  lookup?: boolean;
  /** the action needs the player in the game: an offline preview reads as a problem */
  needsOnline?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  onEnter?(): void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  /** hide the chip (the caller shows it elsewhere) */
  noChip?: boolean;
  className?: string;
}

export function CitizenIdInput(p: CitizenIdInputProps) {
  const { t } = useI18n();
  const state = useCitizenPreview(p.value, p.lookup !== false);
  const onResolved = useRef(p.onResolved);
  onResolved.current = p.onResolved;
  /* the state is stable (see useCitizenPreview): this fires once per real change */
  useEffect(() => { onResolved.current?.(state); }, [state]);
  return (
    <span className={cls('k-citizen', p.className)}>
      <span className="k-citizen-row">
        <TextInput
          value={p.value}
          onChange={p.onChange}
          placeholder={p.placeholder ?? t('label.common.citizen.placeholder')}
          autoFocus={p.autoFocus}
          onEnter={p.onEnter}
          disabled={p.disabled}
          area={p.area}
          /* empty: the Arabic placeholder ("مثال: 12 أو #5") keeps the page's direction, or its "#5"
             would read "5#"; typed: the id reads left to right */
          dir={p.value ? 'ltr' : undefined}
          size={p.size}
          label={p.label ?? t('label.common.citizen.label')}
          invalid={state.kind === 'invalid'}
        />
        <OwnHelp help={p.help} label={p.label ?? t('label.common.citizen.label')} facts={p.facts} area={p.area} />
      </span>
      {!p.noChip && <CitizenChip state={state} needsOnline={p.needsOnline} />}
    </span>
  );
}

/* ── CoordsInput ─────────────────────────────────────────────────────────── */

export interface CoordsValue { x: number | null; y: number | null; z: number | null; h?: number | null }

/** vector3(1, 2, 3) · vector4(1, 2, 3, 90) · '1, 2, 3' · '{x=1, y=2, z=3}' → numbers */
export function parseCoords(text: string): CoordsValue | null {
  const nums = (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (nums.length < 3) return null;
  return { x: nums[0], y: nums[1], z: nums[2], h: nums.length >= 4 ? nums[3] : null };
}

export interface CoordsInputProps extends Standalone {
  value: CoordsValue;
  onChange(v: CoordsValue): void;
  heading?: boolean;
  disabled?: boolean;
  className?: string;
}

export function CoordsInput(p: CoordsInputProps) {
  const { t } = useI18n();
  const onPaste = (e: ClipboardEvent) => {
    const text = e.clipboardData.getData('text');
    const c = parseCoords(text);
    if (!c) return;
    e.preventDefault();
    p.onChange({ ...c, h: p.heading ? c.h ?? p.value.h ?? null : undefined });
  };
  const set = (k: keyof CoordsValue) => (v: number | null) => p.onChange({ ...p.value, [k]: v });
  return (
    <span className={cls('k-coords', p.className)} onPaste={onPaste}>
      <span className="k-coords-row">
        {(['x', 'y', 'z'] as const).map((k) => (
          <span className="k-coords-cell" key={k}>
            <span className="k-coords-axis">{t(`label.common.coords.${k}`)}</span>
            <NumberInput value={p.value[k]} onChange={set(k)} step={0.1} size="sm" disabled={p.disabled} label={t(`label.common.coords.${k}`)} help={false} />
          </span>
        ))}
        {p.heading && (
          <span className="k-coords-cell">
            <span className="k-coords-axis">{t('label.common.coords.h')}</span>
            <NumberInput value={p.value.h ?? null} onChange={set('h')} min={0} max={360} step={1} size="sm" disabled={p.disabled} label={t('label.common.coords.h')} help={false} />
          </span>
        )}
        <OwnHelp help={p.help ?? 'help.common.coords'} label={p.label} facts={p.facts} area={p.area} />
      </span>
      <span className="k-coords-hint">{t('label.common.coords.paste')}</span>
    </span>
  );
}

/* ── DurationPicker ──────────────────────────────────────────────────────── */

export interface DurationPickerProps extends Standalone {
  /** minutes; 0 = permanent */
  value: number;
  onChange(v: number): void;
  /** preset lengths in minutes (defaults to Config.BanDurations from the open message) */
  presets?: number[];
  /** allow 0 (permanent) */
  permanent?: boolean;
  disabled?: boolean;
  className?: string;
}

const DEFAULT_PRESETS = [60, 360, 1440, 4320, 10080, 43200, 0];

export function DurationPicker(p: DurationPickerProps) {
  const { t, lang } = useI18n();
  const app = useApp();
  const presets = (p.presets ?? (app.banDurations.length ? app.banDurations : DEFAULT_PRESETS)).filter((m) => p.permanent !== false || m !== 0);
  const isPreset = presets.includes(p.value);
  const [custom, setCustom] = useState(!isPreset);
  const [unit, setUnit] = useState<'m' | 'h' | 'd'>('d');
  const mult = unit === 'm' ? 1 : unit === 'h' ? 60 : 1440;
  const opts = [
    ...presets.map((m) => ({ value: String(m), label: fmtMinutes(t, lang, m) })),
    { value: 'custom', label: t('label.common.duration.custom') },
  ];
  return (
    <span className={cls('k-duration', p.className)}>
      <span className="k-duration-row">
        <Segmented
          value={custom ? 'custom' : String(p.value)}
          onChange={(v) => { if (v === 'custom') setCustom(true); else { setCustom(false); p.onChange(Number(v)); } }}
          options={opts}
          size="sm"
          disabled={p.disabled}
          label={p.label}
        />
        <OwnHelp help={p.help ?? 'help.common.duration'} label={p.label} facts={p.facts} area={p.area} />
      </span>
      {custom && (
        <span className="k-duration-custom">
          <NumberInput
            value={p.value ? Math.round((p.value / mult) * 100) / 100 : null}
            onChange={(v) => p.onChange(v && v > 0 ? Math.round(v * mult) : 0)}
            min={1}
            size="sm"
            disabled={p.disabled}
            label={t('label.common.duration.custom')}
            help={false}
          />
          <Select
            value={unit}
            onChange={(u) => setUnit(u as 'm' | 'h' | 'd')}
            options={[
              { value: 'm', label: t('label.common.duration.unitMinutes') },
              { value: 'h', label: t('label.common.duration.unitHours') },
              { value: 'd', label: t('label.common.duration.unitDays') },
            ]}
            size="sm"
            disabled={p.disabled}
            label={t('label.common.duration.custom')}
            help={false}
          />
        </span>
      )}
    </span>
  );
}

/* ── ReasonField ─────────────────────────────────────────────────────────── */

export interface ReasonFieldProps extends Standalone {
  value: string;
  onChange(v: string): void;
  /** ready reasons (already translated) */
  templates?: string[];
  maxLength?: number;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  className?: string;
}

export function ReasonField(p: ReasonFieldProps) {
  const { t } = useI18n();
  const max = p.maxLength ?? 200;
  return (
    <span className={cls('k-reason', p.className)}>
      {p.templates && p.templates.length > 0 && (
        <span className="k-reason-tpl" aria-label={t('label.common.reason.templates')}>
          {p.templates.map((x) => (
            <button key={x} type="button" className={cls('k-chip', p.value === x && 'is-on')} disabled={p.disabled} onClick={() => p.onChange(x)}>{x}</button>
          ))}
        </span>
      )}
      <span className="k-reason-row">
        <TextArea value={p.value} onChange={(v) => p.onChange(v.slice(0, max))} rows={p.rows ?? 2} maxLength={max} counter placeholder={p.placeholder ?? t('label.common.reason.placeholder')} disabled={p.disabled} label={p.label} />
        <OwnHelp help={p.help ?? 'help.common.reason'} label={p.label} facts={p.facts} area={p.area} />
      </span>
    </span>
  );
}
