/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/hub/food/BulkDialog.tsx
 * Bulk edit: one column, for every row shown now (the chip and the search decide), multiplied, added
 * to or set. The result is rounded to the column's step and kept inside its range, then lands in the
 * page's drafts: nothing is saved until the admin reviews and saves.
 *   "اضرب شبع كل الأكل × 1.2" · "multiply all food satiety × 1.2"
 * ════════════════════════════════════════════════════════════════════════════ */

import type { AppCtx } from '../../../ctx';
import type { LtFn, TFn } from '../../../i18n';
import { Field, NumberInput, Segmented, Select, fmtNum } from '../../../kit';
import type { SettingValue, SettingsRow } from '../../../types';
import { bulkPlan } from './model';
import type { BulkOp, BulkResult, TableSpec } from './model';

interface BulkState { col: string; op: BulkOp; value: number | null }

export interface OpenBulkArgs {
  app: AppCtx;
  t: TFn;
  lt: LtFn;
  spec: TableSpec;
  /** the rows shown now (the chip and the search decide) */
  rows: SettingsRow[];
  /** the value a cell shows now (the draft, else the value in effect) */
  valueOf(key: string): SettingValue | undefined;
  mode: 'essential' | 'detail';
  /** the name of what is shown ("Fruit and vegetables", "All") */
  scope: string;
  onApply(plan: BulkResult[]): void;
}

export function openBulk({ app, t, lt, spec, rows, valueOf, mode, scope, onApply }: OpenBulkArgs) {
  const numeric = spec.columns.filter((c) => c.type === 'number' && (mode === 'detail' || !c.advanced));
  if (numeric.length === 0) return;
  const planOf = (s: BulkState): BulkResult[] => {
    const col = numeric.find((c) => c.key === s.col);
    if (!col || s.value === null) return [];
    return bulkPlan(rows, spec.key, col, s.op, s.value, valueOf);
  };
  app.confirm<BulkState>({
    title: t('label.food.bulkTitle'),
    help: 'help.food.bulk',
    initial: { col: numeric[0].key, op: 'mul', value: 1.2 },
    confirmLabel: t('label.food.bulkApply'),
    canConfirm: (s) => planOf(s).length > 0,
    render: ({ value: s, set }) => {
      const plan = planOf(s);
      const col = numeric.find((c) => c.key === s.col) ?? numeric[0];
      const editable = rows.filter((r) => !r.locked).length;
      const clamped = plan.filter((p) => p.clamped).length;
      return (
        <div className="fd-bulk">
          <p className="fd-bulk-scope">{t('label.food.bulkScope', editable, scope)}</p>
          <Field label={t('label.food.bulkColumn')} help="help.food.bulkColumn">
            <Select
              value={s.col}
              onChange={(v) => set({ ...s, col: v })}
              options={numeric.map((c) => ({ value: c.key, label: lt(c.label) }))}
            />
          </Field>
          <Field label={t('label.food.bulkOp')} help="help.food.bulkOp">
            <Segmented<BulkOp>
              value={s.op}
              onChange={(v) => set({ ...s, op: v, value: v === 'mul' ? 1.2 : v === 'add' ? 5 : (typeof col.min === 'number' && col.min > 0 ? col.min : 0) })}
              options={[
                { value: 'mul', label: t('label.food.opMul') },
                { value: 'add', label: t('label.food.opAdd') },
                { value: 'set', label: t('label.food.opSet') },
              ]}
            />
          </Field>
          <Field label={t('label.food.bulkValue')} help="help.food.bulkValue">
            <NumberInput value={s.value} onChange={(v) => set({ ...s, value: v })} step={s.op === 'mul' ? 0.05 : col.step ?? 1} />
          </Field>
          <div className="fd-bulk-plan" aria-live="polite">
            {plan.length === 0 ? (
              <p>{t('label.food.bulkNone')}</p>
            ) : (
              <>
                <p><b>{t('label.food.bulkCount', plan.length)}</b>{clamped > 0 ? ` · ${t('label.food.bulkClamped', clamped)}` : ''}</p>
                <ul>
                  {plan.slice(0, 5).map((p) => (
                    <li key={p.key}>{t('label.food.bulkLine', lt(p.row.label), fmtNum(p.from, 2), fmtNum(p.to, 2))}</li>
                  ))}
                </ul>
                {plan.length > 5 && <p className="fd-more">{t('label.food.bulkMore', plan.length - 5)}</p>}
              </>
            )}
          </div>
        </div>
      );
    },
    onConfirm: (s) => {
      const plan = planOf(s);
      if (plan.length === 0) return false;
      onApply(plan);
      app.toast('inform', t('label.food.bulkDone', plan.length));
      return true;
    },
  });
}
