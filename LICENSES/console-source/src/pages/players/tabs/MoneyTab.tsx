/* Money & job: job and gang with their grade (area job), and money type × operation × amount with a
   "has X now, becomes Y" line (area money). Setting a balance outright asks first: it wipes the old
   number. Gold takes decimals (B1); cash and bank are whole numbers. Money that is ADDED (add, or a set
   above the balance) leaves the central reserve: it needs a reason, and the server caps one press below
   the master (3.1.12, Config.MoneyGrant). */

import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../../ctx';
import { useI18n } from '../../../i18n';
import { Button, ButtonRow, Combobox, Field, Gate, NumberInput, ReasonField, Section, Segmented, Select, fmtCash, fmtGold } from '../../../kit';
import type { CatalogJob } from '../../../types';
import { displayName } from '../shared';
import type { TabProps } from './types';

type MoneyType = 'cash' | 'gold' | 'bank';
type MoneyOp = 'add' | 'remove' | 'set';
const MAX_AMOUNT = 1000000000;

function lowestGrade(list: CatalogJob[], name: string): string {
  const g = list.find((j) => j.name === name)?.grades ?? [];
  return g.length ? String(Math.min(...g.map((x) => x.grade))) : '0';
}

function JobPicker({ kind, list, current, currentGrade, currentLabel, busy, onSet }: {
  kind: 'job' | 'gang';
  list: CatalogJob[];
  current: string;
  currentGrade: number;
  currentLabel: string;
  busy: boolean;
  onSet(name: string, grade: number): void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(current);
  const [grade, setGrade] = useState(String(currentGrade));
  const grades = useMemo(() => list.find((j) => j.name === name)?.grades ?? [], [list, name]);
  const same = name === current && Number(grade) === currentGrade;
  const isJob = kind === 'job';
  return (
    <Section
      title={t(isJob ? 'label.drawer.sec.job' : 'label.drawer.sec.gang')}
      help={isJob ? 'help.drawer.sec.job' : 'help.drawer.sec.gang'}
      lead={t('label.drawer.current', currentLabel)}
      area="job"
    >
      <div className="pl-grid-pick">
        <Field label={t(isJob ? 'label.drawer.job' : 'label.drawer.gang')} help={isJob ? 'help.drawer.job' : 'help.drawer.gang'}>
          <Combobox
            value={name}
            onChange={(v) => { setName(v); setGrade(lowestGrade(list, v)); }}
            options={list.map((j) => ({ value: j.name, label: j.label || j.name, sub: j.name }))}
          />
        </Field>
        <Field label={t('label.drawer.grade')} help={isJob ? 'help.drawer.jobGrade' : 'help.drawer.gangGrade'}>
          <Select value={grade} onChange={setGrade} options={grades.map((g) => ({ value: String(g.grade), label: `${g.grade} · ${g.name}` }))} />
        </Field>
      </div>
      <ButtonRow>
        <Button help={isJob ? 'help.drawer.setJob' : 'help.drawer.setGang'} area="job" disabled={!name || same} busy={busy} onClick={() => onSet(name, Number(grade) || 0)}>
          {t(isJob ? 'label.drawer.setJob' : 'label.drawer.setGang')}
        </Button>
      </ButtonRow>
    </Section>
  );
}

export default function MoneyTab({ p, run, busy }: TabProps) {
  const app = useApp();
  const { t } = useI18n();
  const jobs = app.catalog?.jobs ?? [];
  const gangs = app.catalog?.gangs ?? [];
  useEffect(() => { if (!app.catalog) app.refresh('catalog'); }, [app.catalog, app.refresh]);

  const [type, setType] = useState<MoneyType>('cash');
  const [op, setOp] = useState<MoneyOp>('add');
  const [amount, setAmount] = useState<number | null>(100);
  const [reason, setReason] = useState('');
  const reasonTpl = ['a', 'b', 'c'].map((k) => t(`label.drawer.moneyTpl.${k}`));

  const balance: number | undefined = type === 'cash' ? p.money?.cash : type === 'gold' ? p.money?.gold : p.money?.bank;
  /* dollars are isolated left-to-right inside the sentence, so "$3,210" never reads "3,210$" in Arabic */
  const fmt = (n: number | undefined) => (n === undefined ? '—' : type === 'gold' ? fmtGold(t, n) : `⁦${fmtCash(n)}⁩`);
  const whole = type !== 'gold';
  const valid = amount !== null && Number.isFinite(amount) && amount >= 0 && amount <= MAX_AMOUNT
    && (op === 'set' || amount > 0) && (!whole || Number.isInteger(amount));
  const sent = amount === null ? 0 : whole ? amount : Math.round(amount * 100) / 100;
  const after = balance === undefined || !valid ? undefined : op === 'add' ? balance + sent : op === 'remove' ? balance - sent : sent;
  const short = op === 'remove' && balance !== undefined && valid && sent > balance;
  /* an add, or a set above what he holds: the server asks for a reason (it decides; this only mirrors it) */
  const grants = op === 'add' || (op === 'set' && (balance === undefined || sent > balance));
  const needReason = grants && reason.trim().length < 3;
  const hint = !valid ? undefined
    : short ? t('label.drawer.previewShort', fmt(balance))
      : t('label.drawer.preview', fmt(balance), fmt(after));

  const applyMoney = () => {
    const args = { type, op, amount: sent, reason: reason.trim() };
    if (op !== 'set') { void run('money', 'money', args); return; }
    app.confirm({
      title: t('label.drawer.setMoneyTitle', displayName(p)),
      text: t('label.drawer.setMoneyText', fmt(balance), fmt(sent)),
      help: 'help.drawer.opSet',
      confirmLabel: t('label.drawer.applyMoney'),
      onConfirm: async () => { await run('money', 'money', args); },
    });
  };

  const jobLabel = p.job?.label ? `${p.job.label}${p.job.gradeName ? ` · ${p.job.gradeName}` : ''}` : '—';
  const gangLabel = p.gang?.name && p.gang.name !== 'none' ? `${p.gang.label}${p.gang.gradeName ? ` · ${p.gang.gradeName}` : ''}` : t('label.players.noGang');

  return (
    <>
      <Gate area="job">
        <JobPicker kind="job" list={jobs} current={p.job?.name ?? ''} currentGrade={p.job?.grade ?? 0} currentLabel={jobLabel}
          busy={busy === 'setJob'} onSet={(name, grade) => void run('setJob', 'setJob', { name, grade })} />
        <JobPicker kind="gang" list={gangs} current={p.gang?.name ?? ''} currentGrade={p.gang?.grade ?? 0} currentLabel={gangLabel}
          busy={busy === 'setGang'} onSet={(name, grade) => void run('setGang', 'setGang', { name, grade })} />
      </Gate>

      <Gate area="money">
        <Section title={t('label.drawer.sec.cash')} help="help.drawer.sec.cash" area="money">
          <div className="pl-grid-2">
            <Field label={t('label.drawer.moneyType')} help="help.drawer.moneyType">
              <Segmented<MoneyType>
                className="pl-seg"
                value={type}
                onChange={setType}
                options={[
                  { value: 'cash', label: t('label.drawer.typeCash'), help: 'help.drawer.typeCash' },
                  ...(p.money?.gold !== undefined ? [{ value: 'gold' as const, label: t('label.drawer.typeGold'), help: 'help.drawer.typeGold' as const }] : []),
                  ...(p.money?.bank !== undefined ? [{ value: 'bank' as const, label: t('label.drawer.typeBank'), help: 'help.drawer.typeBank' as const }] : []),
                ]}
                size="sm"
              />
            </Field>
            <Field label={t('label.drawer.moneyOp')} help="help.drawer.moneyOp">
              <Segmented<MoneyOp>
                className="pl-seg"
                value={op}
                onChange={setOp}
                options={[
                  { value: 'add', label: t('label.drawer.opAdd'), help: 'help.drawer.opAdd' },
                  { value: 'remove', label: t('label.drawer.opRemove'), help: 'help.drawer.opRemove' },
                  { value: 'set', label: t('label.drawer.opSet'), help: 'help.drawer.opSet' },
                ]}
                size="sm"
              />
            </Field>
          </div>
          <Field label={t('label.drawer.amount')} help="help.drawer.amount" hint={hint}>
            <NumberInput
              value={amount}
              onChange={setAmount}
              min={0}
              max={MAX_AMOUNT}
              step={whole ? 1 : 0.01}
              integer={whole}
              unit={type === 'gold' ? t('label.common.gold') : '$'}
              onEnter={() => { if (valid && !short && !needReason) applyMoney(); }}
            />
          </Field>
          {grants && (
            <Field label={t('label.drawer.moneyReason')} help="help.drawer.moneyReason" required>
              <ReasonField value={reason} onChange={setReason} templates={reasonTpl} maxLength={200} rows={1} />
            </Field>
          )}
          <ButtonRow>
            <Button actionName="player.money" help="help.drawer.applyMoney" area="money" kind="primary" disabled={!valid || short || needReason} busy={busy === 'money'} onClick={applyMoney}>
              {t('label.drawer.applyMoney')}
            </Button>
            {valid && needReason && <span className="pl-note">{t('label.drawer.reasonNeeded')}</span>}
          </ButtonRow>
        </Section>
      </Gate>
    </>
  );
}
