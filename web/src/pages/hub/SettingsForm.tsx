/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/hub/SettingsForm.tsx
 * A form group of a script's settings: one SettingRow per field (label + "؟" + one plain line |
 * control + allowed range + default + restore), the calculated hint under it, "last change: who ·
 * when", a warning when the developer changed the default after an admin's edit, and the rarely
 * needed fields behind "advanced".
 * ════════════════════════════════════════════════════════════════════════════ */

import { useState } from 'react';
import { useI18n } from '../../i18n';
import { Button, InlineAlert, SettingRow, fmtAgo, inlineHelp } from '../../kit';
import type { Level, SettingsField, SettingsGroup, SettingsValues } from '../../types';
import { useCell, useDraftVersion } from './draft';
import type { DraftStore } from './draft';
import FieldControl from './FieldControl';
import { derivedHint, firstSentence, fmtValue, sameValue } from './model';

function Row({ store, field: f, values, readOnly, level }: { store: DraftStore; field: SettingsField; values: SettingsValues; readOnly: boolean; level?: Level }) {
  const { t, lt, lang } = useI18n();
  const cell = useCell(store, f.key);
  useDraftVersion(store); /* the calculated hint reads other keys (rate × interval) */
  const [driftSeen, setDriftSeen] = useState(false);
  const def = cell.base?.def ?? values.defaults[f.key];
  const over = values.overridden[f.key];
  const help = inlineHelp(f.help, { example: f.example, warn: f.danger });
  const helpText = lt(f.help);
  const hint = derivedHint(f, (k) => store.valueOf(k) ?? values.values[k], t, lang);
  const drift = !driftSeen && over && over.base !== undefined && !sameValue(over.base, def) && !cell.dirty;
  const differs = !sameValue(cell.value, def);
  const unit = f.unit ? lt(f.unit) : undefined;

  return (
    <SettingRow
      label={lt(f.label)}
      help={help}
      description={helpText ? firstSentence(helpText) : undefined}
      control={<FieldControl store={store} cellKey={f.key} field={f} disabled={readOnly} />}
      meta={{
        range: f.type === 'number' ? { min: f.min, max: f.max } : undefined,
        unit,
        def: f.type === 'number' || f.type === 'bool' ? (def as number | boolean | null) : def === '' ? t('label.hub.value.empty') : typeof def === 'string' ? def : fmtValue(f, def, t, lt),
        restart: f.requiresRestart,
        changed: over && over.by ? t('label.hub.module.changedBy', over.by, fmtAgo(t, lang, over.at)) : undefined,
      }}
      dirty={cell.dirty}
      onReset={readOnly || !differs ? undefined : () => store.reset(f.key)}
      preview={(hint || drift || cell.invalid) ? (
        <>
          {hint && <span className="hub-hint">{hint}</span>}
          {cell.invalid && <span className="hub-invalid" role="alert">{t(`label.hub.invalid.${cell.invalid}`)}</span>}
          {drift && over && (
            <InlineAlert
              tone="warn"
              title={t('label.hub.module.drift', fmtValue(f, over.base, t, lt), fmtValue(f, def, t, lt))}
              help="help.hub.module.drift"
              className="hub-drift"
              actions={(
                <>
                  <Button help="help.hub.module.keepMine" size="sm" kind="ghost" onClick={() => setDriftSeen(true)}>{t('label.hub.module.keepMine')}</Button>
                  <Button help="help.hub.module.takeNew" size="sm" disabled={readOnly} onClick={() => store.reset(f.key)}>{t('label.hub.module.takeNew')}</Button>
                </>
              )}
            />
          )}
        </>
      ) : undefined}
      facts={{ level, undo: true, appliesTo: t(f.requiresRestart ? 'label.hub.appliesRestart' : 'label.hub.appliesAll') }}
      danger={!!f.danger}
      className={readOnly ? 'is-readonly' : undefined}
    />
  );
}

export default function SettingsForm({ group, values, store, readOnly, level }: { group: SettingsGroup; values: SettingsValues; store: DraftStore; readOnly: boolean; level?: Level }) {
  const { t } = useI18n();
  const [showAdv, setShowAdv] = useState(false);
  const fields = group.fields.filter((f) => f.type !== 'table');
  const plain = fields.filter((f) => !f.advanced);
  const adv = fields.filter((f) => f.advanced);
  return (
    <div className="hub-form">
      {plain.map((f) => <Row key={f.key} store={store} field={f} values={values} readOnly={readOnly} level={level} />)}
      {adv.length > 0 && (
        <div className="hub-adv">
          <Button help="help.hub.module.advanced" kind="link" size="sm" icon={showAdv ? 'minus' : 'plus'} onClick={() => setShowAdv((v) => !v)} aria-expanded={showAdv}>
            {showAdv ? t('label.hub.module.hideAdvanced') : t('label.hub.module.advanced', adv.length)}
          </Button>
          {showAdv && adv.map((f) => <Row key={f.key} store={store} field={f} values={values} readOnly={readOnly} level={level} />)}
        </div>
      )}
    </div>
  );
}
