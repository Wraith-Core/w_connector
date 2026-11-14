/* Moderation: private message, freeze / spectate / seat on a horse (area players), kick with its
   own reason (area kick), the admin jail = reason + length, or the early release (area kick, 2.8.0),
   ban = reason + length (area ban), and a link to the player's staff ranks
   (the Ranks page, area ranks: shown only to those who may open it). */

import { useState } from 'react';
import { useApp } from '../../../ctx';
import { useI18n } from '../../../i18n';
import {
  Button, ButtonRow, DurationPicker, Field, Gate, ReasonField, Section, TextInput, fmtDuration, fmtMinutes,
} from '../../../kit';
import { displayName, selfBlocked } from '../shared';
import type { TabProps } from './types';

/** the jail lengths offered, in minutes (the website takes 1 minute to 7 days) */
const JAIL_PRESETS = [10, 30, 60, 120, 360, 1440];
const JAIL_MAX = 10080;

export default function ModerationTab({ p, run, busy, isMe }: TabProps) {
  const app = useApp();
  const { t, lang } = useI18n();
  const name = displayName(p);
  const [msg, setMsg] = useState('');
  const [kickReason, setKickReason] = useState('');
  const [banReason, setBanReason] = useState('');
  const [duration, setDuration] = useState(1440);
  const [jailReason, setJailReason] = useState('');
  const [jailMinutes, setJailMinutes] = useState(30);
  const spectating = !!app.self?.spectating && app.self.spectating === p.id;
  const frozen = p.frozen === true;

  const send = async () => {
    const text = msg.trim();
    if (!text) return;
    const r = await run('notify', 'notify', { text });
    if (r.ok) setMsg('');
  };

  const kickTpl = ['a', 'b', 'c', 'd'].map((k) => t(`label.drawer.kickTpl.${k}`));
  const jailTpl = ['a', 'b', 'c', 'd'].map((k) => t(`label.drawer.jailTpl.${k}`));
  const jailed = p.jail && p.jail.left > 0 ? p.jail : null;

  const askJail = () => {
    const reason = jailReason.trim();
    if (!reason) return;
    const minutes = Math.min(JAIL_MAX, Math.max(1, Math.round(jailMinutes)));
    app.confirm({
      title: t('label.drawer.jailTitle', name),
      text: t('label.drawer.jailText', fmtMinutes(t, lang, minutes), reason),
      help: 'help.drawer.jail',
      danger: true,
      confirmLabel: t('label.drawer.jail'),
      onConfirm: async () => { const r = await run('jail', 'jail', { reason, minutes }); if (r.ok) setJailReason(''); },
    });
  };
  const setPlace = (kind: 'jail' | 'release') => {
    void app.act('jail', { action: 'setPlace', kind }, { okText: t(kind === 'jail' ? 'label.drawer.jailPlaceSaved' : 'label.drawer.releasePlaceSaved') });
  };
  const banTpl = ['a', 'b', 'c', 'd'].map((k) => t(`label.drawer.banTpl.${k}`));

  const askKick = () => {
    const reason = kickReason.trim();
    if (!reason) return;
    app.confirm({
      title: t('label.drawer.kickTitle', name),
      text: t('label.drawer.kickText', reason),
      help: 'help.drawer.kick',
      danger: true,
      confirmLabel: t('label.drawer.kick'),
      onConfirm: async () => { const r = await run('kick', 'kick', { reason }); if (r.ok) app.select(null); },
    });
  };

  const askBan = () => {
    const reason = banReason.trim();
    if (!reason) return;
    const minutes = Math.max(0, Math.round(duration));
    app.confirm({
      title: t('label.drawer.banTitle', name),
      text: <><p>{t('label.drawer.banText', fmtMinutes(t, lang, minutes), reason)}</p><p className="pl-dialog-sub">{t('label.drawer.banWhat')}</p></>,
      help: 'help.drawer.ban',
      danger: true,
      confirmLabel: t('label.drawer.ban'),
      onConfirm: async () => { const r = await run('ban', 'ban', { reason, duration: minutes }); if (r.ok) app.select(null); },
    });
  };

  return (
    <>
      <Gate area="players">
        <Section title={t('label.drawer.sec.message')} help="help.drawer.sec.message" area="players">
          <Field label={t('label.drawer.message')} help="help.drawer.message">
            <TextInput value={msg} onChange={setMsg} maxLength={300} placeholder={t('label.drawer.messagePh')} onEnter={() => void send()} />
          </Field>
          <ButtonRow>
            <Button actionName="player.notify" help="help.drawer.send" area="players" disabled={!msg.trim()} busy={busy === 'notify'} onClick={() => void send()}>{t('label.drawer.send')}</Button>
          </ButtonRow>
        </Section>

        <Section title={t('label.drawer.sec.control')} help="help.drawer.sec.control" area="players">
          <ButtonRow>
            <Button actionName="player.freeze"
              help={frozen ? 'help.drawer.unfreeze' : 'help.drawer.freeze'}
              area="players"
              kind={frozen ? 'primary' : 'secondary'}
              disabled={selfBlocked(p, app.selfId, 'freeze')}
              busy={busy === 'freeze'}
              onClick={() => void run('freeze', 'freeze', { state: !frozen })}
            >
              {frozen ? t('label.drawer.unfreeze') : t('label.drawer.freeze')}
            </Button>
            <Button actionName="player.spectate"
              help={spectating ? 'help.drawer.unspectate' : 'help.drawer.spectate'}
              area="players"
              kind={spectating ? 'primary' : 'secondary'}
              disabled={selfBlocked(p, app.selfId, 'spectate')}
              busy={busy === 'spectate'}
              onClick={() => void run('spectate', 'spectate', { state: !spectating })}
            >
              {spectating ? t('label.drawer.unspectate') : t('label.drawer.spectate')}
            </Button>
            <Button actionName="player.sitOnMount" help="help.drawer.sitOnMount" area="players" busy={busy === 'sitOnMount'} onClick={() => void run('sitOnMount', 'sitOnMount')}>
              {t('label.drawer.sitOnMount')}
            </Button>
          </ButtonRow>
        </Section>
      </Gate>

      <Gate area="kick">
        <Section title={t('label.drawer.sec.kick')} help="help.drawer.sec.kick" area="kick">
          <Field label={t('label.drawer.kickReason')} help="help.drawer.kickReason" required>
            <ReasonField className="pl-kick-reason" value={kickReason} onChange={setKickReason} templates={kickTpl} maxLength={200} disabled={isMe} />
          </Field>
          <ButtonRow>
            <Button actionName="player.kick" help="help.drawer.kick" area="kick" kind="danger" helpDanger={false} className="pl-kick-btn" disabled={isMe || !kickReason.trim()} busy={busy === 'kick'} onClick={askKick}>
              {t('label.drawer.kick')}
            </Button>
            {!isMe && !kickReason.trim() && <span className="pl-note">{t('label.drawer.reasonNeeded')}</span>}
          </ButtonRow>
        </Section>
      </Gate>

      <Gate area="kick">
        <Section title={t('label.drawer.sec.jail')} help="help.drawer.sec.jail" area="kick">
          {jailed ? (
            <>
              <p className="pl-note">{t('label.drawer.jailNow', fmtDuration(t, lang, jailed.left, 2), jailed.reason || '—')}</p>
              <ButtonRow>
                <Button actionName="player.unjail" help="help.drawer.unjail" area="kick" kind="primary" busy={busy === 'unjail'} onClick={() => void run('unjail', 'unjail')}>
                  {t('label.drawer.unjail')}
                </Button>
              </ButtonRow>
            </>
          ) : (
            <>
              <Field label={t('label.drawer.jailReason')} help="help.drawer.jailReason" required>
                <ReasonField className="pl-jail-reason" value={jailReason} onChange={setJailReason} templates={jailTpl} maxLength={200} />
              </Field>
              <Field label={t('label.drawer.jailDuration')} help="help.drawer.jailDuration">
                <DurationPicker value={jailMinutes} onChange={setJailMinutes} presets={JAIL_PRESETS} permanent={false} />
              </Field>
              <ButtonRow>
                <Button actionName="player.jail" help="help.drawer.jail" area="kick" kind="danger" helpDanger={false} disabled={!jailReason.trim()} busy={busy === 'jail'} onClick={askJail}>
                  {t('label.drawer.jail')}
                </Button>
                {!jailReason.trim() && <span className="pl-note">{t('label.drawer.reasonNeeded')}</span>}
              </ButtonRow>
            </>
          )}
          {app.canAction('jail.setPlace') && (
            <ButtonRow>
              <Button actionName="jail.setPlace" help="help.drawer.jailPlace" size="sm" onClick={() => setPlace('jail')}>{t('label.drawer.jailPlace')}</Button>
              <Button actionName="jail.setPlace" help="help.drawer.releasePlace" size="sm" onClick={() => setPlace('release')}>{t('label.drawer.releasePlace')}</Button>
            </ButtonRow>
          )}
        </Section>
      </Gate>

      <Gate area="ban">
        <Section title={t('label.drawer.sec.ban')} help="help.drawer.sec.ban" area="ban">
          <Field label={t('label.drawer.banReason')} help="help.drawer.banReason" required>
            <ReasonField className="pl-ban-reason" value={banReason} onChange={setBanReason} templates={banTpl} maxLength={200} disabled={isMe} />
          </Field>
          <Field label={t('label.drawer.banDuration')} help="help.drawer.banDuration">
            <DurationPicker value={duration} onChange={setDuration} disabled={isMe} />
          </Field>
          <ButtonRow>
            <Button actionName="player.ban" help="help.drawer.ban" area="ban" kind="danger" helpDanger={false} className="pl-ban-btn" disabled={isMe || !banReason.trim()} busy={busy === 'ban'} onClick={askBan}>
              {t('label.drawer.ban')}
            </Button>
            {!isMe && !banReason.trim() && <span className="pl-note">{t('label.drawer.reasonNeeded')}</span>}
          </ButtonRow>
        </Section>
      </Gate>

      {/* staff rights come from w_core ranks now: the Ranks page gives and takes them */}
      {app.can('ranks') && (
        <Section title={t('label.drawer.sec.level')} help="help.drawer.sec.level" lead={t('label.drawer.ranksLead')}>
          <ButtonRow>
            <Button help="help.drawer.openRanks" icon="arrow" onClick={() => app.navigate('ranks', { player: String(p.id) })}>
              {t('label.drawer.openRanks')}
            </Button>
          </ButtonRow>
        </Section>
      )}
    </>
  );
}
