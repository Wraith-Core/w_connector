/* Block / unblock the character: its player cannot play it ("contact the administration"); the account's
   other characters stay available. A blocked character in play is kicked (w_core C.Block). */

import { useState } from 'react';
import { useApp } from '../../../ctx';
import { useI18n } from '../../../i18n';
import { Button, ButtonRow, Field, Gate, InlineAlert, ReasonField, Section, fmtAgo, fmtDate } from '../../../kit';
import { blockSeconds, iso } from '../shared';
import type { TabProps } from '../shared';

export default function Access({ detail, flows, run, after }: TabProps) {
  const { t, lang } = useI18n();
  const { confirm } = useApp();
  const [reason, setReason] = useState('');
  const b = detail.block;
  const at = blockSeconds(b?.blocked_at);

  const askBlock = () => {
    const why = reason.trim();
    confirm({
      title: t('label.characters.blockAsk', iso(detail.name)),
      help: 'help.characters.block',
      danger: true,
      text: t('label.characters.blockAskText'),
      render: () => <p className="ch-dialog-line">{t('label.characters.reasonLine', iso(why || t('label.characters.noReason')))}</p>,
      confirmLabel: t('ui_ch_block'),
      onConfirm: async () => { await after(await run('block', { reason: why }, t('toast_char_blocked'))); },
    });
  };

  return (
    <div className="ch-tab">
      <Section title={b ? t('ui_ch_unblock') : t('ui_ch_block')} help="help.characters.access" area="characters" lead={t('ui_ch_block_note')}>
        <Gate area="characters">
          {b ? (
            <>
              <InlineAlert tone="warn" title={t('ui_ch_blocked')} help="help.characters.blocked">
                <p>{t('label.characters.reasonLine', iso(b.reason || t('label.characters.noReason')))}</p>
                <p className="ch-muted">
                  {t('label.characters.blockedBy', iso(b.blocked_by || '—'))}
                  {at ? <> · <span className="k-num">{fmtDate(at)}</span> ({fmtAgo(t, lang, at)})</> : null}
                </p>
              </InlineAlert>
              <ButtonRow end>
                <Button help="help.characters.unblock" area="characters" busy={flows.busy.unblock}
                  onClick={async () => after(await run('unblock', {}, t('toast_char_unblocked')))}>{t('ui_ch_unblock')}</Button>
              </ButtonRow>
            </>
          ) : (
            <>
              <Field label={t('ui_ch_block_reason')} help="help.characters.blockReason">
                <ReasonField
                  value={reason}
                  onChange={setReason}
                  maxLength={255}
                  templates={[t('label.characters.reasons.cheat'), t('label.characters.reasons.request'), t('label.characters.reasons.rules')]}
                />
              </Field>
              <ButtonRow end>
                <Button help="help.characters.block" kind="danger" area="characters" busy={flows.busy.block} onClick={askBlock}>{t('ui_ch_block')}</Button>
              </ButtonRow>
            </>
          )}
        </Gate>
      </Section>
    </div>
  );
}
