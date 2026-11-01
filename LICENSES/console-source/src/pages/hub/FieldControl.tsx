/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/hub/FieldControl.tsx
 * The control of one settings field, bound to one key of the draft:
 *   number → NumberInput (unit, range; out of range is marked, never clamped) · bool → Switch (On / Off
 *   as text) · enum → Select · text → TextInput · list → one item per line.
 * Inside a SettingRow the control takes the row's label and "؟"; in a table cell it passes its own
 * label (row · column) and help={false}.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useI18n } from '../../i18n';
import { NumberInput, Select, Switch, TextArea, TextInput } from '../../kit';
import type { SettingValue, SettingsField } from '../../types';
import { useCell } from './draft';
import type { DraftStore } from './draft';
import { toShown, toStored } from './model';

export interface FieldControlProps {
  store: DraftStore;
  /** the stored key ('needs.hungerRate' or 'food.apple.hunger') */
  cellKey: string;
  field: SettingsField;
  disabled?: boolean;
  /** table cells: small, their own aria label, no "؟" */
  compact?: boolean;
  label?: string;
}

export default function FieldControl({ store, cellKey, field: f, disabled, compact, label }: FieldControlProps) {
  const { t, lt } = useI18n();
  const cell = useCell(store, cellKey);
  const set = (v: SettingValue) => store.set(cellKey, v);
  const off = disabled || !cell.base || !!cell.base.locked;
  const size = compact ? 'sm' : 'md';
  const own = compact ? { label: label ?? lt(f.label), help: false as const } : {};

  if (f.type === 'bool') {
    /* a table cell says yes / no (short); a form row says on / off */
    return <Switch checked={cell.value === true} onChange={set} disabled={off} size={size} onText={t(compact ? 'label.common.yes' : 'label.hub.value.on')} offText={t(compact ? 'label.common.no' : 'label.hub.value.off')} {...own} />;
  }
  if (f.type === 'enum') {
    const options = (f.options ?? []).map((o) => ({ value: String(o.value), label: lt(o.label) }));
    return (
      <Select
        value={cell.value === null || cell.value === undefined ? '' : String(cell.value)}
        onChange={(v) => {
          const o = (f.options ?? []).find((x) => String(x.value) === v);
          set(o ? o.value : v);
        }}
        options={options}
        disabled={off}
        size={size}
        {...own}
      />
    );
  }
  if (f.type === 'number') {
    const v = typeof cell.value === 'number' ? toShown(f, cell.value) : null;
    const min = f.min === undefined ? undefined : toShown(f, f.min);
    const max = f.max === undefined ? undefined : toShown(f, f.max);
    return (
      <NumberInput
        value={v}
        onChange={(n) => set(n === null ? null : toStored(f, n))}
        min={min}
        max={max}
        step={f.step ? toShown(f, f.step) : undefined}
        integer={f.integer}
        unit={compact ? undefined : f.unit ? lt(f.unit) : undefined}
        invalid={!!cell.invalid}
        disabled={off}
        size={size}
        className={compact ? 'hub-cellnum' : undefined}
        {...own}
      />
    );
  }
  if (f.type === 'list') {
    const lines = Array.isArray(cell.value) ? cell.value.map(String).join('\n') : '';
    return (
      <TextArea
        value={lines}
        onChange={(s) => set(s.split('\n').map((x) => x.trim()).filter(Boolean))}
        rows={Math.min(8, Math.max(3, (f.maxItems ?? 4)))}
        invalid={!!cell.invalid}
        disabled={off}
        {...own}
      />
    );
  }
  /* text */
  const text = typeof cell.value === 'string' ? cell.value : '';
  if (f.multiline) {
    return <TextArea value={text} onChange={set} maxLength={f.maxLength} counter={!!f.maxLength} invalid={!!cell.invalid} disabled={off} {...own} />;
  }
  return (
    <TextInput
      value={text}
      onChange={set}
      invalid={!!cell.invalid}
      disabled={off}
      size={size}
      dir={f.pattern ? 'ltr' : 'auto'}
      suffix={f.maxLength ? <span className="k-num k-faint">{`${text.length}/${f.maxLength}`}</span> : undefined}
      {...own}
    />
  );
}
