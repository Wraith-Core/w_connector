/* Items: give an item (searchable list + count), open the satchel (the console closes first),
   the wardrobe on the player's screen, and clearing the satchel behind a type-to-confirm (the
   citizen id). Everything here is area items. */

import { useEffect, useState } from 'react';
import { useApp } from '../../../ctx';
import { useI18n } from '../../../i18n';
import { Button, ButtonRow, Combobox, Field, Gate, NumberInput, Section } from '../../../kit';
import { displayName } from '../shared';
import type { TabProps } from './types';

export default function ItemsTab({ p, run, busy }: TabProps) {
  const app = useApp();
  const { t } = useI18n();
  const items = app.catalog?.items ?? [];
  useEffect(() => { if (!app.catalog) app.refresh('catalog'); }, [app.catalog, app.refresh]);
  const [item, setItem] = useState('');
  const [count, setCount] = useState<number | null>(1);
  const countOk = count !== null && Number.isInteger(count) && count >= 1 && count <= 1000;

  const clear = () => app.confirm({
    title: t('label.drawer.clearTitle', displayName(p)),
    text: t('label.drawer.clearText'),
    help: 'help.drawer.clearInventory',
    danger: true,
    phrase: p.citizenid || String(p.id),
    confirmLabel: t('label.drawer.clearInventory'),
    onConfirm: async () => { await run('clearInventory', 'clearInventory'); },
  });

  return (
    <Gate area="items">
      <Section title={t('label.drawer.sec.give')} help="help.drawer.sec.give" area="items">
        <div className="pl-grid-item">
          <Field label={t('label.drawer.item')} help="help.drawer.item">
            <Combobox
              value={item}
              onChange={setItem}
              options={items.map((i) => ({ value: i.name, label: i.label || i.name, sub: i.name }))}
              placeholder={t('label.drawer.itemSearch')}
            />
          </Field>
          <Field label={t('label.drawer.count')} help="help.drawer.count">
            <NumberInput value={count} onChange={setCount} min={1} max={1000} integer step={1} />
          </Field>
        </div>
        <ButtonRow>
          <Button actionName="player.giveItem" help="help.drawer.giveItem" area="items" kind="primary" disabled={!item || !countOk} busy={busy === 'giveItem'}
            onClick={() => void run('giveItem', 'giveItem', { item, count })}>
            {countOk && (count ?? 1) > 1 ? t('label.drawer.giveN', count ?? 1) : t('label.drawer.giveItem')}
          </Button>
        </ButtonRow>
      </Section>

      <Section title={t('label.drawer.sec.bag')} help="help.drawer.sec.bag" area="items">
        <ButtonRow>
          <Button actionName="player.openInventory" help="help.drawer.openInventory" area="items" busy={busy === 'openInventory'} onClick={() => void run('openInventory', 'openInventory')}>
            {t('label.drawer.openInventory')}
          </Button>
          <Button actionName="player.wardrobe" help="help.drawer.wardrobe" area="items" busy={busy === 'wardrobe'} onClick={() => void run('wardrobe', 'wardrobe')}>
            {t('label.drawer.wardrobe')}
          </Button>
        </ButtonRow>
      </Section>

      <Section title={t('label.drawer.sec.danger')} help="help.drawer.sec.danger" tone="danger" area="items">
        <ButtonRow>
          <Button actionName="player.clearInventory" help="help.drawer.clearInventory" area="items" kind="danger" className="pl-clear-btn" busy={busy === 'clearInventory'} onClick={clear}>
            {t('label.drawer.clearInventory')}
          </Button>
        </ButtonRow>
      </Section>
    </Gate>
  );
}
