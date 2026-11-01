/* Money, an item, the job and the gang: live when the character is online (the players page's own
   actions), on its saved data when it is not (sv_characters.lua: w_lib offline money / items, w_core's
   offline player). Each block is locked with its level when the admin's rank is too low. */

import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../../ctx';
import { useI18n } from '../../../i18n';
import { Button, ButtonRow, Combobox, Field, Gate, InlineAlert, NumberInput, ReasonField, Section, Segmented, Select, fmtCash, fmtGold } from '../../../kit';
import { iso, ltr } from '../shared';
import type { TabProps } from '../shared';

const MAX_AMOUNT = 1000000000;
const MAX_COUNT = 1000;
const whole = (v: number | null, max: number) => v !== null && Number.isInteger(v) && v >= 1 && v <= max;
/** money: 0.01 to a billion, cents at most (the server rounds to the cent: B1, gold 2.5 is fine) */
const cents = (v: number | null) => v !== null && Number.isFinite(v) && v >= 0.01 && v <= MAX_AMOUNT && Math.abs(Math.round(v * 100) - v * 100) < 1e-6;

export default function Economy({ detail, flows, run, after }: TabProps) {
  const { t } = useI18n();
  const { catalog, refresh } = useApp();
  const busy = flows.busy;
  useEffect(() => { if (!catalog) refresh('catalog'); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [moneyType, setMoneyType] = useState<'cash' | 'gold'>('cash');
  const [moneyOp, setMoneyOp] = useState<'add' | 'remove'>('add');
  const [amount, setAmount] = useState<number | null>(100);
  /* 3.1.12: an add leaves the central reserve, so it needs a reason (the server checks it, and caps one press) */
  const [reason, setReason] = useState('');
  const [item, setItem] = useState('');
  const [count, setCount] = useState<number | null>(1);
  const [job, setJob] = useState('');
  const [jobGrade, setJobGrade] = useState('0');
  const [gang, setGang] = useState('');
  const [gangGrade, setGangGrade] = useState('0');

  const jobs = catalog?.jobs ?? [];
  const gangs = catalog?.gangs ?? [];
  const jobDef = jobs.find((j) => j.name === job);
  const gangDef = gangs.find((g) => g.name === gang);
  const items = useMemo(() => (catalog?.items ?? []).map((i) => ({ value: i.name, label: i.label || i.name, sub: i.name })), [catalog]);
  const jobOpts = useMemo(() => jobs.map((j) => ({ value: j.name, label: j.label || j.name, sub: j.name })), [jobs]);
  const gangOpts = useMemo(() => gangs.map((g) => ({ value: g.name, label: g.label || g.name, sub: g.name })), [gangs]);
  const gradesOf = (def?: { grades: { grade: number; name: string }[] }) =>
    (def?.grades ?? []).map((g) => ({ value: String(g.grade), label: `${g.grade} · ${g.name}` }));

  const amountOk = cents(amount);
  const needReason = moneyOp === 'add' && reason.trim().length < 3;
  const reasonTpl = ['a', 'b', 'c'].map((k) => t(`label.drawer.moneyTpl.${k}`));
  const countOk = whole(count, MAX_COUNT);
  const shown = moneyType === 'cash' ? fmtCash(amount) : fmtGold(t, amount);

  const applyMoney = async () => {
    if (!amountOk || needReason) return;
    await after(await run('money', { type: moneyType, op: moneyOp, amount, reason: reason.trim() }, t('ui_done')));
  };
  const giveItem = async () => {
    if (!item || !countOk) return;
    await after(await run('giveItem', { item, count }, t('ui_done')));
  };

  return (
    <div className="ch-tab">
      {!detail.online && <InlineAlert tone="info" title={t('ui_ch_offline_note')} help="help.characters.offline" />}

      <Section title={t('ui_ch_give_money')} help="help.characters.money" area="money">
        <Gate area="money">
          <div className="k-grid-2">
            <Field label={t('label.characters.moneyType')} help="help.characters.moneyType">
              <Segmented value={moneyType} onChange={setMoneyType} options={[{ value: 'cash', label: t('ui_ch_cash') }, { value: 'gold', label: t('ui_ch_gold') }]} />
            </Field>
            <Field label={t('label.characters.moneyOp')} help="help.characters.moneyOp">
              <Segmented value={moneyOp} onChange={setMoneyOp} options={[{ value: 'add', label: t('ui_ch_add') }, { value: 'remove', label: t('ui_ch_remove') }]} />
            </Field>
          </div>
          <Field label={t('ui_ch_amount')} help="help.characters.amount">
            <NumberInput value={amount} onChange={setAmount} min={0.01} max={MAX_AMOUNT} step={1} invalid={amount !== null && !amountOk} unit={moneyType === 'cash' ? '$' : t('ui_ch_gold')} onEnter={() => void applyMoney()} />
          </Field>
          {moneyOp === 'add' && (
            <Field label={t('label.characters.moneyReason')} help="help.characters.moneyReason" required>
              <ReasonField value={reason} onChange={setReason} templates={reasonTpl} maxLength={200} rows={1} />
            </Field>
          )}
          <div className="ch-actline">
            <p className="ch-preview" aria-live="polite">
              {amountOk ? t(moneyOp === 'add' ? 'label.characters.moneyAdd' : 'label.characters.moneyRemove', ltr(shown), iso(detail.name)) : ''}
              {amountOk && !detail.online ? <span className="ch-muted"> · {t('label.characters.toSaved')}</span> : null}
            </p>
            <Button actionName="characters.money" help="help.characters.moneyApply" area="money" disabled={!amountOk || needReason} busy={busy.money} onClick={() => void applyMoney()}>{t('ui_ch_apply')}</Button>
          </div>
        </Gate>
      </Section>

      <Section title={t('ui_ch_give_item')} help="help.characters.item" area="items">
        <Gate area="items">
          <div className="ch-grid-wide">
            <Field label={t('ui_ch_item')} help="help.characters.itemPick">
              <Combobox value={item} onChange={setItem} options={items} placeholder={t('label.characters.pickItem')} />
            </Field>
            <Field label={t('ui_ch_count_n')} help="help.characters.itemCount">
              <NumberInput value={count} onChange={setCount} min={1} max={MAX_COUNT} integer onEnter={() => void giveItem()} />
            </Field>
          </div>
          <ButtonRow end>
            <Button actionName="characters.giveItem" help="help.characters.itemGive" area="items" disabled={!item || !countOk} busy={busy.giveItem} onClick={() => void giveItem()}>{t('label.characters.give')}</Button>
          </ButtonRow>
        </Gate>
      </Section>

      <Section title={t('ui_ch_set_job')} help="help.characters.job" area="job">
        <Gate area="job">
          <div className="ch-grid-wide">
            <Field label={t('label.characters.newJob')} help="help.characters.jobPick">
              <Combobox value={job} onChange={(v) => { setJob(v); setJobGrade('0'); }} options={jobOpts} placeholder={t('label.characters.pickJob')} />
            </Field>
            <Field label={t('ui_ch_grade')} help="help.characters.grade">
              <Select value={jobGrade} onChange={setJobGrade} options={gradesOf(jobDef)} placeholder={t('label.characters.pickGrade')} disabled={!job} />
            </Field>
          </div>
          <ButtonRow end>
            <Button actionName="characters.setJob" help="help.characters.jobApply" area="job" disabled={!job} busy={busy.setJob}
              onClick={async () => after(await run('setJob', { name: job, grade: Number(jobGrade) }, t('ui_done')))}>{t('ui_ch_apply')}</Button>
          </ButtonRow>
        </Gate>
      </Section>

      <Section title={t('ui_ch_set_gang')} help="help.characters.gang" area="job">
        <Gate area="job">
          <div className="ch-grid-wide">
            <Field label={t('label.characters.newGang')} help="help.characters.gangPick">
              <Combobox value={gang} onChange={(v) => { setGang(v); setGangGrade('0'); }} options={gangOpts} placeholder={t('label.characters.pickGang')} />
            </Field>
            <Field label={t('ui_ch_grade')} help="help.characters.grade">
              <Select value={gangGrade} onChange={setGangGrade} options={gradesOf(gangDef)} placeholder={t('label.characters.pickGrade')} disabled={!gang} />
            </Field>
          </div>
          <ButtonRow end>
            <Button actionName="characters.setGang" help="help.characters.gangApply" area="job" disabled={!gang} busy={busy.setGang}
              onClick={async () => after(await run('setGang', { name: gang, grade: Number(gangGrade) }, t('ui_done')))}>{t('ui_ch_apply')}</Button>
          </ButtonRow>
        </Gate>
      </Section>
    </div>
  );
}
