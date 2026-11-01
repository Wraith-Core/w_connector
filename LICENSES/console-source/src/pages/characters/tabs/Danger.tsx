/* Delete the character for good (type-to-confirm with its citizen id). First what would happen to its
   data in plain words, then the refusal of the last try (the resource, its reason, what stands in the
   way), then the button. Deleting again after a refusal is safe: w_core repeats nothing. */

import { useMemo } from 'react';
import { useApp } from '../../../ctx';
import { useI18n } from '../../../i18n';
import { Button, ButtonRow, Gate, HelpTip, InlineAlert, Section, fmtCash, fmtGold, fmtNum } from '../../../kit';
import { splitList } from '../model';
import { iso, ltr } from '../shared';
import type { TabProps } from '../shared';
import { groupDeps } from './Links';

export default function Danger({ detail, flows }: TabProps) {
  const { t } = useI18n();
  const { confirm } = useApp();
  const cid = detail.citizenid;
  const refusal = flows.refusal && flows.refusal.citizenid === cid ? flows.refusal : null;
  const waiting = flows.deleting === cid;

  const lines = useMemo(() => {
    const out: string[] = [];
    for (const g of groupDeps(detail.dependencies)) {
      if (g.kind === 'core') out.push(t('label.characters.sumCore'));
      else if (g.kind === 'data') out.push(t('label.characters.sumData', fmtNum(g.rows)));
      else if (g.kind === 'asset') out.push(t('label.characters.sumAsset', fmtNum(g.rows)));
      else if (g.kind === 'history') out.push(t('label.characters.sumHistory', fmtNum(g.rows)));
      else out.push(t('label.characters.sumOther', fmtNum(g.rows)));
    }
    let usd = 0; let gold = 0;
    for (const m of detail.money) {
      if (String(m.currency).toUpperCase() === 'GOLD') gold += Number(m.balance) || 0; else usd += Number(m.balance) || 0;
    }
    const money = [usd ? fmtCash(usd) : '', gold ? fmtGold(t, gold) : ''].filter(Boolean).join(' + ');
    if (money) out.push(t('label.characters.sumMoney', ltr(money)));
    return out;
  }, [detail.dependencies, detail.money, t]);

  const askDelete = () => confirm({
    title: t('ui_ch_delete'),
    help: 'help.characters.delete',
    danger: true,
    phrase: cid,
    text: t('ui_ch_delete_ask', iso(detail.name), cid),
    render: () => <p className="ch-dialog-line">{t('ui_ch_delete_note')}</p>,
    confirmLabel: t('ui_ch_delete'),
    // resolves when the first call answered: a late answer is awaited while the tab shows the note
    onConfirm: async () => { await flows.remove({ citizenid: cid, name: detail.name }); },
  });

  return (
    <div className="ch-tab">
      <Section title={t('ui_ch_delete')} help="help.characters.delete" area="charDelete" tone="danger" lead={t('ui_ch_delete_note')}>
        <Gate area="charDelete">
          {lines.length > 0 && (
            <div className="ch-summary">
              <p className="ch-summary-head">
                <span>{t('label.characters.deleteSummary')}</span>
                <HelpTip help="help.characters.deleteSummary" label={t('label.characters.deleteSummary')} size="sm" />
              </p>
              <ul>{lines.map((l) => <li key={l}>{l}</li>)}</ul>
            </div>
          )}

          {refusal && (
            <InlineAlert tone="danger" title={t('ui_ch_refused_title')} help="help.characters.refusal" onDismiss={() => flows.setRefusal(null)}>
              {refusal.resource && <p>{t('ui_ch_refused_by', refusal.resource)}</p>}
              <p dir="auto">{refusal.text}</p>
              {refusal.detail && (
                <>
                  <p>{t('ui_ch_refused_detail')}</p>
                  <ul className="ch-blockers" dir="ltr">{splitList(refusal.detail).map((x, i) => <li key={i}>{x}</li>)}</ul>
                </>
              )}
              <p className="ch-muted">{t('ui_ch_refused_note')}</p>
            </InlineAlert>
          )}

          {waiting && <InlineAlert tone="info" title={t('ui_ch_delete_running')} />}

          <ButtonRow end>
            <Button kind="danger" help="help.characters.deleteStart" area="charDelete" disabled={waiting || !!flows.busy.delete} onClick={askDelete}>
              {t('label.characters.deleteStart')}
            </Button>
          </ButtonRow>
        </Gate>
      </Section>
    </div>
  );
}
