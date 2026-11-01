/* Health: revive / heal (area revive) and the needs sliders with apply and fill-all (area needs).
   Without w_hud the player has no hunger / thirst: only stamina can be set then. */

import { useState } from 'react';
import { useI18n } from '../../../i18n';
import { Button, ButtonRow, Field, Gate, InlineAlert, Section, SliderNumber, fmtNum } from '../../../kit';
import { staminaOf } from '../shared';
import type { TabProps } from './types';

const clamp100 = (n: number | null | undefined, d = 100) => Math.round(Math.max(0, Math.min(100, typeof n === 'number' && Number.isFinite(n) ? n : d)));

export default function HealthTab({ p, run, busy }: TabProps) {
  const { t } = useI18n();
  const [hunger, setHunger] = useState(() => clamp100(p.needs?.hunger));
  const [thirst, setThirst] = useState(() => clamp100(p.needs?.thirst));
  const [stamina, setStamina] = useState(() => clamp100(staminaOf(p)));
  const full = () => { setHunger(100); setThirst(100); setStamina(100); };
  const now = (v: number | null | undefined) => t('label.drawer.now', typeof v === 'number' ? fmtNum(v) : '—');

  const apply = () => void run('needs', 'needs', p.needs ? { hunger, thirst, stamina } : { stamina });
  const refill = async () => {
    const r = await run('refill', 'needs', p.needs ? { hunger: 100, thirst: 100, stamina: 100 } : { stamina: 100 });
    if (r.ok) full();
  };

  return (
    <>
      <Gate area="revive">
        <Section title={t('label.drawer.sec.restore')} help="help.drawer.sec.restore" area="revive">
          <ButtonRow>
            <Button actionName="player.revive" help="help.drawer.revive" area="revive" kind={p.dead ? 'primary' : 'secondary'} busy={busy === 'revive'}
              onClick={async () => { const r = await run('revive', 'revive'); if (r.ok) full(); }}>
              {t('label.drawer.revive')}
            </Button>
            <Button actionName="player.heal" help="help.drawer.heal" area="revive" busy={busy === 'heal'}
              onClick={async () => { const r = await run('heal', 'heal'); if (r.ok) full(); }}>
              {t('label.drawer.heal')}
            </Button>
          </ButtonRow>
        </Section>
      </Gate>

      <Gate area="needs">
        <Section title={t('label.drawer.sec.needs')} help="help.drawer.sec.needs" area="needs">
          {!p.needs && <InlineAlert tone="info">{t('label.drawer.noNeeds')}</InlineAlert>}
          {p.needs && (
            <>
              <Field label={t('label.drawer.hunger')} help="help.drawer.hunger" hint={now(p.needs.hunger)}>
                <SliderNumber value={hunger} onChange={setHunger} min={0} max={100} unit="%" />
              </Field>
              <Field label={t('label.drawer.thirst')} help="help.drawer.thirst" hint={now(p.needs.thirst)}>
                <SliderNumber value={thirst} onChange={setThirst} min={0} max={100} unit="%" />
              </Field>
            </>
          )}
          <Field label={t('label.drawer.stamina')} help="help.drawer.stamina" hint={now(staminaOf(p))}>
            <SliderNumber value={stamina} onChange={setStamina} min={0} max={100} unit="%" />
          </Field>
          <ButtonRow>
            <Button actionName="player.needs" help="help.drawer.applyNeeds" area="needs" kind="primary" busy={busy === 'needs'} onClick={apply}>{t('label.drawer.applyNeeds')}</Button>
            <Button actionName="player.needs" help="help.drawer.refill" area="needs" busy={busy === 'refill'} onClick={() => void refill()}>{t('label.drawer.refill')}</Button>
          </ButtonRow>
        </Section>
      </Gate>
    </>
  );
}
