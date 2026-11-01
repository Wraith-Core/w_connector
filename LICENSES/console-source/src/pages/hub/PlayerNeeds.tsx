/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/hub/PlayerNeeds.tsx
 * w_hud › one player's needs (the old HUD tab's editor, now by CITIZEN ID): type the id (online →
 * its session automatically, '#5' = a session number), see the live hunger and thirst, set either
 * one, or fill both to 100. The server resolves the id again (w.citizen) and re-checks area 'needs'.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useEffect, useState } from 'react';
import { useApp } from '../../ctx';
import { useI18n } from '../../i18n';
import { Button, ButtonRow, CitizenIdInput, EmptyState, Field, HelpTip, InlineAlert, Meter, Section, SliderNumber } from '../../kit';
import type { CitizenState } from '../../kit';
import { sameCitizen } from './model';

export default function PlayerNeeds() {
  const app = useApp();
  const { t } = useI18n();
  const [input, setInput] = useState('');
  const [state, setState] = useState<CitizenState>({ kind: 'empty' });
  const [hunger, setHunger] = useState(100);
  const [thirst, setThirst] = useState(100);
  const [busy, setBusy] = useState<string | null>(null);

  const source = state.kind === 'found' && state.preview.online ? state.preview.source ?? null : null;
  const live = source !== null ? app.players.find((p) => p.id === source) ?? null : null;

  /* a newly picked player starts from their live values */
  useEffect(() => {
    if (live?.needs) { setHunger(Math.round(live.needs.hunger)); setThirst(Math.round(live.needs.thirst)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const ready = source !== null;
  const send = async (need: 'hunger' | 'thirst', value: number, tag: string, quiet = false) => {
    if (!ready) return false;
    setBusy(tag);
    try {
      /* the citizen id as typed ('12', '#5'): the server resolves it again with w.citizen */
      const r = await app.act('hud', { action: 'setNeed', citizenid: input.trim(), need, value: Math.round(value) }, quiet ? { silent: false } : { okText: t('label.hud.player.done') });
      return r.ok;
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="hub-needs">
      <Section title={t('label.hud.group.player')} help="help.hud.group.player" area="needs">
        <Field label={t('label.hud.player.target')} help="help.hud.player.target" area="needs">
          <CitizenIdInput value={input} onChange={setInput} onResolved={(s) => setState((prev) => (sameCitizen(prev, s) ? prev : s))} needsOnline area="needs" autoFocus />
        </Field>

        {!input.trim() && <EmptyState text={t('label.hud.player.pick')} className="hub-needs-empty" />}

        {ready && live && !live.needs && <InlineAlert tone="info">{t('label.hud.player.noNeeds')}</InlineAlert>}

        {ready && live?.needs && (
          <div className="hub-needs-grid">
            <div className="hub-needs-now">
              <span className="hub-needs-nowtitle">
                <span>{t('label.hud.player.now')}</span>
                <HelpTip help="help.hud.player.now" label={t('label.hud.player.now')} size="sm" />
              </span>
              <span className="hub-needs-meter"><span>{t('label.hud.player.hunger')}</span><Meter value={live.needs.hunger} label={t('label.hud.player.hunger')} /></span>
              <span className="hub-needs-meter"><span>{t('label.hud.player.thirst')}</span><Meter value={live.needs.thirst} label={t('label.hud.player.thirst')} /></span>
            </div>
            <Field label={t('label.hud.player.hunger')} help="help.hud.player.hunger" area="needs">
              <SliderNumber value={hunger} onChange={setHunger} min={0} max={100} step={1} />
            </Field>
            <Field label={t('label.hud.player.thirst')} help="help.hud.player.thirst" area="needs">
              <SliderNumber value={thirst} onChange={setThirst} min={0} max={100} step={1} />
            </Field>
            <ButtonRow>
              <Button help="help.hud.player.applyHunger" area="needs" busy={busy === 'h'} onClick={() => void send('hunger', hunger, 'h')}>{t('label.hud.player.applyHunger')}</Button>
              <Button help="help.hud.player.applyThirst" area="needs" busy={busy === 't'} onClick={() => void send('thirst', thirst, 't')}>{t('label.hud.player.applyThirst')}</Button>
              <Button
                help="help.hud.player.refill"
                area="needs"
                kind="primary"
                busy={busy === 'f'}
                onClick={async () => {
                  setHunger(100); setThirst(100);
                  if (await send('hunger', 100, 'f', true)) await send('thirst', 100, 'f');
                }}
              >
                {t('label.hud.player.refill')}
              </Button>
            </ButtonRow>
          </div>
        )}
      </Section>
    </div>
  );
}
