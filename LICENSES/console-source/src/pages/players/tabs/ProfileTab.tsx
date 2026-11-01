/* Profile: who the player is, their work, money, condition and location. View only; ids and
   coordinates carry a copy button, and the character opens on the Characters page. */

import { useApp } from '../../../ctx';
import { useI18n } from '../../../i18n';
import {
  Button, KeyValue, KeyValueList, Meter, Section, distance, fmtCash, fmtCoords, fmtDist, fmtGold, fmtNum, vec3, vec4,
} from '../../../kit';
import { fullName, groupLabel, healthPct, staminaOf } from '../shared';
import type { TabProps } from './types';

export default function ProfileTab({ p, isMe }: TabProps) {
  const app = useApp();
  const { t } = useI18n();
  const me = app.players.find((x) => x.id === app.selfId)?.coords ?? app.self?.coords ?? null;
  const dist = isMe ? null : distance(me, p.coords);
  const hasGang = !!p.gang?.name && p.gang.name !== 'none';
  const job = p.job?.label ? `${p.job.label}${p.job.gradeName ? ` · ${p.job.gradeName}` : ''}` : '—';
  const gang = hasGang ? `${p.gang.label}${p.gang.gradeName ? ` · ${p.gang.gradeName}` : ''}` : t('label.players.noGang');

  return (
    <>
      <Section
        title={t('label.drawer.sec.identity')}
        help="help.drawer.sec.identity"
        actions={p.citizenid && (
          <Button help="help.drawer.openCharacter" kind="link" size="sm" area="characters" onClick={() => app.navigate('characters', { cid: p.citizenid })}>
            {t('label.drawer.openCharacter')}
          </Button>
        )}
      >
        <KeyValueList>
          <KeyValue label={t('label.drawer.cid')} help="help.common.citizenId" value={p.citizenid} copy={p.citizenid || undefined} ltr />
          <KeyValue label={t('label.drawer.session')} help="help.common.serverId" value={`#${p.id}`} copy={String(p.id)} ltr />
          <KeyValue label={t('label.drawer.character')} help="help.drawer.character" value={fullName(p)} />
          <KeyValue label={t('label.drawer.account')} help="help.drawer.account" value={p.name} />
          {p.discord && <KeyValue label={t('label.drawer.discord')} help="help.drawer.discord" value={p.discord} copy={p.discord} ltr />}
          <KeyValue label={t('label.players.col.group')} help="help.players.col.group" value={groupLabel(t, p.group, true)} />
        </KeyValueList>
      </Section>

      <Section title={t('label.drawer.sec.work')} help="help.drawer.sec.work">
        <KeyValueList>
          <KeyValue label={t('label.players.col.job')} help="help.players.col.job" value={job} />
          <KeyValue label={t('label.drawer.duty')} help="help.drawer.duty" value={p.job?.onDuty ? t('label.players.onDuty') : t('label.players.offDuty')} />
          <KeyValue label={t('label.players.col.gang')} help="help.players.col.gang" value={gang} />
        </KeyValueList>
      </Section>

      <Section title={t('label.drawer.sec.money')} help="help.drawer.sec.money">
        <KeyValueList columns={p.money?.bank !== undefined ? 3 : 2}>
          <KeyValue label={t('label.players.col.cash')} help="help.players.col.cash" value={fmtCash(p.money?.cash ?? 0)} ltr />
          <KeyValue label={t('label.players.col.gold')} help="help.players.col.gold" value={fmtGold(t, p.money?.gold ?? 0)} />
          {p.money?.bank !== undefined && <KeyValue label={t('label.drawer.bank')} help="help.drawer.bank" value={fmtCash(p.money.bank)} ltr />}
        </KeyValueList>
      </Section>

      <Section title={t('label.drawer.sec.condition')} help="help.drawer.sec.condition">
        <KeyValueList columns={2}>
          <KeyValue label={t('label.players.col.health')} help="help.players.col.health" value={<Meter value={healthPct(p)} label={t('label.players.col.health')} />} />
          <KeyValue label={t('label.players.col.stamina')} help="help.players.col.stamina" value={<Meter value={staminaOf(p)} label={t('label.players.col.stamina')} />} />
          <KeyValue label={t('label.players.col.hunger')} help="help.players.col.hunger" value={<Meter value={p.needs?.hunger} label={t('label.players.col.hunger')} />} />
          <KeyValue label={t('label.players.col.thirst')} help="help.players.col.thirst" value={<Meter value={p.needs?.thirst} label={t('label.players.col.thirst')} />} />
          <KeyValue label={t('label.players.col.ping')} help="help.players.col.ping" value={`${fmtNum(p.ping ?? 0)} ms`} ltr />
        </KeyValueList>
      </Section>

      <Section title={t('label.drawer.sec.location')} help="help.drawer.sec.location">
        <KeyValueList>
          <KeyValue label={t('label.drawer.coords')} help="help.drawer.coords" value={fmtCoords(p.coords)} copy={p.coords ? vec3(p.coords) : undefined} ltr />
          <KeyValue label={t('label.drawer.heading')} help="help.drawer.heading" value={p.coords ? `${fmtNum(p.coords.heading)}°` : '—'} copy={p.coords ? vec4(p.coords) : undefined} ltr />
          <KeyValue label={t('label.players.col.distance')} help="help.players.col.distance" value={isMe ? '—' : fmtDist(dist)} ltr />
        </KeyValueList>
      </Section>
    </>
  );
}
