/* Travel: go to the player, bring them (their old spot is saved), send them back, or move them to
   typed coordinates (Z left empty = the server finds the ground). */

import { useState } from 'react';
import { useApp } from '../../../ctx';
import { useI18n } from '../../../i18n';
import { Button, ButtonRow, CoordsInput, Field, Gate, Section } from '../../../kit';
import type { CoordsValue } from '../../../kit';
import { selfBlocked } from '../shared';
import type { TabProps } from './types';

const round1 = (n: number) => Math.round(n * 10) / 10;

export default function TravelTab({ p, run, busy }: TabProps) {
  const app = useApp();
  const { t } = useI18n();
  const [coords, setCoords] = useState<CoordsValue>({ x: null, y: null, z: null });
  const ready = coords.x !== null && coords.y !== null;
  const noReturn = !p.canReturn;

  return (
    <Gate area="teleport">
      <Section title={t('label.drawer.sec.quick')} help="help.drawer.sec.quick" area="teleport">
        <ButtonRow>
          <Button actionName="player.teleportTo" help="help.drawer.goto" area="teleport" disabled={selfBlocked(p, app.selfId, 'teleportTo')} busy={busy === 'goto'} onClick={() => void run('goto', 'teleportTo')}>
            {t('label.drawer.goto')}
          </Button>
          <Button actionName="player.bring" help="help.drawer.bring" area="teleport" disabled={selfBlocked(p, app.selfId, 'bring')} busy={busy === 'bring'} onClick={() => void run('bring', 'bring')}>
            {t('label.drawer.bring')}
          </Button>
          <Button actionName="player.bringBack" help="help.drawer.bringBack" area="teleport" disabled={noReturn || selfBlocked(p, app.selfId, 'bringBack')} busy={busy === 'bringBack'} onClick={() => void run('bringBack', 'bringBack')}>
            {t('label.drawer.bringBack')}
          </Button>
        </ButtonRow>
        {noReturn && <p className="pl-note">{t('label.drawer.noReturn')}</p>}
      </Section>

      <Section
        title={t('label.drawer.sec.coords')}
        help="help.drawer.sec.coords"
        area="teleport"
        actions={p.coords && (
          <Button help="help.drawer.fillTheirs" kind="link" size="sm" onClick={() => setCoords({ x: round1(p.coords.x), y: round1(p.coords.y), z: round1(p.coords.z) })}>
            {t('label.drawer.fillTheirs')}
          </Button>
        )}
      >
        <Field label={t('label.drawer.coords')} help="help.common.coords">
          <CoordsInput value={coords} onChange={setCoords} />
        </Field>
        <ButtonRow>
          <Button actionName="player.tpCoords"
            help="help.drawer.tpCoords"
            area="teleport"
            disabled={!ready}
            busy={busy === 'tpCoords'}
            onClick={() => void run('tpCoords', 'tpCoords', { x: coords.x, y: coords.y, ...(coords.z !== null ? { z: coords.z } : {}) })}
          >
            {t('label.drawer.tpCoords')}
          </Button>
        </ButtonRow>
      </Section>
    </Gate>
  );
}
