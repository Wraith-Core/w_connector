/* The citizen id: give the character a number of your choice (it must be offline), or hand its number to
   another character in one step (type the target, check both sides, type the number in the dialog).
   Only a sequential number is handed on (w_core refuses an old random id as `n`); the character that
   takes it may still carry an old id (ABC12345), so the target field accepts those. */

import { useState } from 'react';
import { useApp } from '../../../ctx';
import { useI18n } from '../../../i18n';
import { Button, ButtonRow, CitizenIdInput, Field, Gate, InlineAlert, Section, TextInput, useCitizenPreview } from '../../../kit';
import type { CitizenState } from '../../../kit';
import { NUMERIC_ID } from '../model';
import { Sides, iso } from '../shared';
import type { TabProps } from '../shared';

/** The same preview (useCitizenPreview answers a fresh { kind: 'empty' } on every render: keeping the old
    object stops a render loop between CitizenIdInput's onResolved and this state) */
const samePreview = (a: CitizenState, b: CitizenState) => {
  if (a.kind !== b.kind) return false;
  if (a.kind !== 'found' || b.kind !== 'found') return true;
  const p = a.preview; const q = b.preview;
  return p.citizenid === q.citizenid && p.name === q.name && p.online === q.online && p.source === q.source;
};

/** Arabic-Indic digits typed on an Arabic keyboard count as digits; anything else (and a leading zero) is dropped */
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const digitsOnly = (v: string) => v
  .replace(/[٠-٩]/g, (c) => String(AR_DIGITS.indexOf(c)))
  .replace(/[۰-۹]/g, (c) => String(FA_DIGITS.indexOf(c)))
  .replace(/[^0-9]/g, '')
  .replace(/^0+/, '')
  .slice(0, 9);

export default function Identity({ detail, flows, run, open, search }: TabProps) {
  const { t } = useI18n();
  const { confirm } = useApp();
  const cid = detail.citizenid;
  const online = !!detail.online;

  /* ── reassign ── */
  const [newId, setNewId] = useState('');
  const holder = useCitizenPreview(NUMERIC_ID.test(newId) ? newId : '', true);
  const takenBy = holder.kind === 'found' && holder.preview.citizenid !== cid ? holder.preview : null;
  const newIdOk = NUMERIC_ID.test(newId) && newId !== cid && !takenBy && holder.kind !== 'checking';

  const askReassign = () => {
    if (!newIdOk) return;
    const to = newId;
    confirm({
      title: t('label.characters.reassignAsk', iso(detail.name)),
      help: 'help.characters.reassignApply',
      text: t('label.characters.reassignAskText', cid, to, cid),
      confirmLabel: t('ui_ch_reassign'),
      onConfirm: async () => {
        const r = await run('reassign', { newId: to }, t('toast_char_reassigned'));
        if (r?.ok) {
          const id = typeof (r.data as { citizenid?: unknown } | undefined)?.citizenid === 'string' ? String((r.data as { citizenid: string }).citizenid) : to;
          setNewId('');
          open(id, 'identity');
          await search();
        }
      },
    });
  };

  /* ── transfer ── */
  const [target, setTarget] = useState('');
  const [taker, setTaker] = useState<CitizenState>({ kind: 'empty' });
  const numeric = NUMERIC_ID.test(cid);
  const same = taker.kind === 'found' && taker.preview.citizenid === cid;
  const takerOk = taker.kind === 'found' && !same ? taker.preview : null;
  const waiting = flows.transferring === cid;

  const askTransfer = () => {
    if (!takerOk) return;
    const h = { citizenid: cid, name: detail.name, online: detail.online };
    const k = { citizenid: takerOk.citizenid, name: takerOk.name || takerOk.citizenid, online: takerOk.online, source: takerOk.source };
    confirm({
      title: t('ui_ch_transfer'),
      help: 'help.characters.transferApply',
      danger: true,
      phrase: cid,
      text: t('ui_ch_transfer_ask', cid, iso(k.name), iso(detail.name)),
      render: () => (
        <div className="ch-dialog-body">
          <Sides holder={h} taker={k} />
          <p className="ch-dialog-line">{t('ui_ch_transfer_note')}</p>
        </div>
      ),
      confirmLabel: t('ui_ch_transfer'),
      // resolves when the first call answered: a late answer is awaited while the tab shows the note
      onConfirm: async () => {
        const done = await flows.transfer({ citizenid: h.citizenid, name: h.name }, { citizenid: k.citizenid, name: k.name });
        if (done) setTarget('');
      },
    });
  };

  return (
    <div className="ch-tab">
      <Section title={t('ui_ch_reassign')} help="help.characters.reassign" area="citizenId" lead={t('ui_ch_reassign_note')}>
        <Gate area="citizenId">
          {online && <InlineAlert tone="warn" title={t('err_char_online')} />}
          <Field label={t('ui_ch_new_id')} help="help.characters.newId">
            <TextInput value={newId} onChange={(v) => setNewId(digitsOnly(v))} placeholder="777" maxLength={9} dir="ltr" disabled={online} invalid={!!takenBy} onEnter={askReassign} />
          </Field>
          {takenBy && (
            <InlineAlert
              tone="warn"
              title={t('label.characters.newIdTaken', newId, iso(takenBy.name || takenBy.citizenid))}
              help="help.characters.newIdTaken"
              actions={(
                <Button kind="ghost" size="sm" help="help.characters.openHolder" onClick={() => open(takenBy.citizenid, 'identity')}>
                  {t('label.characters.openHolder')}
                </Button>
              )}
            />
          )}
          <ButtonRow end>
            <Button help="help.characters.reassignApply" area="citizenId" disabled={!newIdOk || online} busy={flows.busy.reassign} onClick={askReassign}>
              {t('ui_ch_apply')}
            </Button>
          </ButtonRow>
        </Gate>
      </Section>

      <Section title={t('ui_ch_transfer')} help="help.characters.transfer" area="citizenId" lead={t('ui_ch_transfer_note')}>
        <Gate area="citizenId">
          {!numeric ? (
            <InlineAlert tone="info" title={t('label.characters.transferOldTitle')} help="help.characters.transferNumeric">
              {t('label.characters.transferOldText')}
            </InlineAlert>
          ) : (
            <>
              <Field label={t('ui_ch_transfer_target')} help="help.characters.transferTarget" error={same ? t('err_char_transfer_same') : null}>
                <CitizenIdInput value={target} onChange={setTarget} onResolved={(s) => setTaker((prev) => (samePreview(prev, s) ? prev : s))} placeholder="12" onEnter={askTransfer} />
              </Field>
              {takerOk && <Sides holder={{ citizenid: cid, name: detail.name, online: detail.online }} taker={{ citizenid: takerOk.citizenid, name: takerOk.name, online: takerOk.online, source: takerOk.source }} />}
              {waiting && <InlineAlert tone="info" title={t('ui_ch_transfer_running')} />}
              <ButtonRow end>
                <Button kind="danger" help="help.characters.transferApply" area="citizenId" disabled={!takerOk || waiting || !!flows.busy.transfer} onClick={askTransfer}>
                  {t('label.characters.transferStart')}
                </Button>
              </ButtonRow>
            </>
          )}
        </Gate>
      </Section>
    </div>
  );
}
