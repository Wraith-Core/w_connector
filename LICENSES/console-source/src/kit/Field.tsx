/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · kit/Field.tsx
 *   <Field label="السبب" help="help.drawer.reason" hint="…" error={err}>
 *     <TextInput value={v} onChange={setV} />        ← a control inside a Field inherits its label,
 *   </Field>                                             id and help (no second "؟")
 *
 *   <SettingRow label help description control meta={{ range, def }} dirty onReset />
 *     one row of a settings form: label + "؟" + one-line description | control + "allowed · default · restore"
 * ════════════════════════════════════════════════════════════════════════════ */

import { createContext, useContext, useId } from 'react';
import type { ReactNode } from 'react';
import HelpTip from '../help/HelpTip';
import type { HelpFacts, HelpProp } from '../help/types';
import { useI18n } from '../i18n';
import type { Area } from '../types';
import { cls, fmtNum } from './format';
import { useLock } from './Gate';

export interface FieldCtxValue { id: string; describedBy?: string; invalid: boolean; label: string; locked: boolean }
const FieldCtx = createContext<FieldCtxValue | null>(null);
/** The enclosing Field (id, aria-describedby, invalid, label), or null */
export const useField = () => useContext(FieldCtx);

export interface FieldProps {
  label: string;
  help: HelpProp;
  children: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  area?: Area;
  facts?: HelpFacts;
  /** 'stack' (label above, default) or 'inline' (label beside) */
  layout?: 'stack' | 'inline';
  /** something at the end of the label row (a small link, a counter) */
  aside?: ReactNode;
  className?: string;
}

export function Field({ label, help, children, hint, error, required, area, facts, layout = 'stack', aside, className }: FieldProps) {
  const id = useId();
  const lock = useLock(area);
  const hintId = `${id}-hint`;
  const describedBy = error || hint ? hintId : undefined;
  return (
    <div className={cls('k-field', `k-field--${layout}`, error && 'is-invalid', lock.locked && 'is-locked', className)}>
      <div className="k-field-head">
        <label className="k-field-label" htmlFor={id}>
          {label}
          {required && <span className="k-field-req" aria-hidden="true"> *</span>}
        </label>
        <HelpTip help={help} label={label} facts={area ? { ...facts, area } : facts} size="sm" />
        {aside && <span className="k-field-aside">{aside}</span>}
      </div>
      <div className="k-field-control">
        <FieldCtx.Provider value={{ id, describedBy, invalid: !!error, label, locked: lock.locked }}>{children}</FieldCtx.Provider>
      </div>
      {error ? <p className="k-field-error" id={hintId} role="alert">{error}</p>
        : hint ? <p className="k-field-hint" id={hintId}>{hint}</p> : null}
    </div>
  );
}

export interface SettingMeta {
  range?: { min?: number; max?: number };
  unit?: string;
  def?: string | number | boolean | null;
  /** 'Needs a restart' */
  restart?: boolean;
  /** 'Last change: Wraith · 3 hours ago' */
  changed?: string;
}

export interface SettingRowProps {
  label: string;
  help: HelpProp;
  description?: ReactNode;
  control: ReactNode;
  meta?: SettingMeta;
  dirty?: boolean;
  /** shows "restore" when the value differs from the default */
  onReset?: () => void;
  /** a calculated preview line ("hunger empties in about 2 h 30 min") */
  preview?: ReactNode;
  area?: Area;
  facts?: HelpFacts;
  danger?: boolean;
  className?: string;
}

export function SettingRow({ label, help, description, control, meta, dirty, onReset, preview, area, facts, danger, className }: SettingRowProps) {
  const { t } = useI18n();
  const id = useId();
  const lock = useLock(area);
  const def = meta?.def;
  const defText = def === undefined || def === null ? null
    : typeof def === 'boolean' ? t(def ? 'label.common.on' : 'label.common.off') : typeof def === 'number' ? fmtNum(def, 3) : def;
  const range = meta?.range;
  const allFacts: HelpFacts = {
    ...facts,
    area: area ?? facts?.area,
    range: range ? { ...range, unit: meta?.unit } : facts?.range,
    def: def ?? facts?.def,
  };
  return (
    <div className={cls('k-setrow', dirty && 'is-dirty', lock.locked && 'is-locked', className)}>
      <div className="k-setrow-l">
        <div className="k-setrow-head">
          <label className="k-setrow-label" htmlFor={id}>{label}</label>
          <HelpTip help={help} label={label} facts={allFacts} danger={danger} size="sm" />
          {dirty && <span className="k-setrow-dirty">{t('label.common.dirty')}</span>}
          {meta?.restart && <span className="k-setrow-restart">{t('label.common.restartNeeded')}</span>}
        </div>
        {description && <p className="k-setrow-desc">{description}</p>}
        {meta?.changed && <p className="k-setrow-changed">{meta.changed}</p>}
      </div>
      <div className="k-setrow-r">
        <FieldCtx.Provider value={{ id, describedBy: undefined, invalid: false, label, locked: lock.locked }}>{control}</FieldCtx.Provider>
        {(range || defText !== null || onReset) && (
          <div className="k-setrow-meta">
            {range && (range.min !== undefined || range.max !== undefined) && (
              <span>{t('label.common.allowed')} <b className="k-num">{t('label.common.range', fmtNum(range.min ?? NaN, 3), fmtNum(range.max ?? NaN, 3))}</b>{meta?.unit ? ` ${meta.unit}` : ''}</span>
            )}
            {defText !== null && <span>{t('label.common.default')} <b className="k-num">{defText}</b></span>}
            {onReset && dirty !== undefined && (
              <span className="k-setrow-reset">
                <button type="button" className="k-linkbtn" onClick={onReset} disabled={lock.locked}>{t('label.common.reset')}</button>
                <HelpTip help="help.common.resetDefault" size="sm" />
              </span>
            )}
          </div>
        )}
        {preview && <div className="k-setrow-preview">{preview}</div>}
      </div>
    </div>
  );
}
