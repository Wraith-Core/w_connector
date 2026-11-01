/* The answers of the last deletion and the last number transfer, kept over the list until dismissed
   (a deletion is never reported as a failure, a half-done transfer is never lost). */

import { useI18n } from '../../i18n';
import type { TFn } from '../../i18n';
import { Button, InlineAlert, fmtCash, fmtGold, fmtNum } from '../../kit';
import type { Deleted, Money, Moved, TabId } from './model';
import { splitList } from './model';
import { iso, ltr } from './shared';

/** '$1,250.50 + 3.25 ذهب' (what went back to the reserve: never a count) */
const moneyText = (t: TFn, m?: Money) => ltr([
  m?.USD ? fmtCash(m.USD) : '',
  m?.GOLD ? fmtGold(t, m.GOLD) : '',
].filter(Boolean).join(' + '));

export function DeletedReport({ deleted, onDismiss }: { deleted: Deleted; onDismiss(): void }) {
  const { t } = useI18n();
  const cid = deleted.citizenid;
  return (
    <InlineAlert tone={deleted.clean ? 'info' : 'danger'} title={t('ui_ch_report_title', cid)} help="help.characters.reportDelete" onDismiss={onDismiss} className="ch-report">
      <p className="ch-report-kv"><span className="ch-muted">{t('ui_ch_col_name')}</span> <b>{deleted.name}</b></p>
      {deleted.missing ? <p>{t('ui_ch_report_nodata')}</p>
        : deleted.report.length === 0 ? <p>{t('ui_ch_report_empty')}</p> : (
          <>
            <p>{t('ui_ch_report_total', fmtNum(deleted.total), deleted.report.length)}</p>
            <ul className="ch-report-list">
              {deleted.report.map((e) => (
                <li key={e.resource}>
                  <span className="k-mono ch-report-res">{e.resource}</span>
                  {/* records, the money it returned and its own notes apart: an amount is never a count */}
                  <span className="ch-report-what">
                    {e.items.length > 0 && <span dir="ltr" className="k-num">{e.items.map((i) => `${i.name} ${fmtNum(i.count)}`).join(' · ')}</span>}
                    {e.money && <span>{t('ui_ch_report_money')}: <span className="k-num">{moneyText(t, e.money)}</span></span>}
                    {e.notes && <span className="ch-muted" dir="auto">{e.notes}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      {deleted.money && (deleted.money.USD || deleted.money.GOLD) ? (
        <p className="ch-report-kv"><span className="ch-muted">{t('ui_ch_report_money')}</span> <b className="k-num">{moneyText(t, deleted.money)}</b></p>
      ) : null}
      {deleted.tombstone && <p className="ch-report-kv"><span className="ch-muted">{t('ui_ch_report_tombstone')}</span> <b className="k-mono">{deleted.tombstone}</b></p>}
      {deleted.clean ? <p className="ch-report-ok">{t('ui_ch_report_free', cid)}</p> : (
        <div role="alert">
          <p><b>{t('ui_ch_report_leftovers', cid)}</b></p>
          {deleted.leftovers && <ul className="ch-blockers" dir="ltr">{splitList(deleted.leftovers).map((x, i) => <li key={i}>{x}</li>)}</ul>}
          <p className="ch-muted">{t('ui_ch_report_leftovers_hint', cid)}</p>
        </div>
      )}
    </InlineAlert>
  );
}

export function MovedReport({ moved, onDismiss, open }: { moved: Moved; onDismiss(): void; open(cid: string, view?: TabId): void }) {
  const { t } = useI18n();
  return (
    <InlineAlert
      tone={moved.done ? 'info' : 'danger'}
      title={t('ui_ch_transfer_title', moved.number)}
      help="help.characters.reportTransfer"
      onDismiss={onDismiss}
      className="ch-report"
      actions={(
        <>
          {moved.done
            ? <Button size="sm" kind="ghost" help="help.characters.openReported" helpLabel={moved.bName} onClick={() => open(moved.number)}>{`${t('label.characters.open')} ${iso(moved.bName)} (${moved.number})`}</Button>
            : <Button size="sm" kind="ghost" help="help.characters.openReported" helpLabel={moved.bName} onClick={() => open(moved.target, 'identity')}>{`${t('label.characters.open')} ${iso(moved.bName)} (${moved.target})`}</Button>}
          {moved.movedTo && (
            <Button size="sm" kind="ghost" help="help.characters.openReported" helpLabel={moved.aName} onClick={() => open(moved.movedTo as string)}>{`${t('label.characters.open')} ${iso(moved.aName)} (${moved.movedTo})`}</Button>
          )}
        </>
      )}
    >
      {moved.done ? (
        <p>{t('ui_ch_transfer_done', moved.number, iso(moved.bName), iso(moved.aName), moved.movedTo ?? '?', moved.target)}</p>
      ) : (
        <div role="alert">
          <p><b>{t('ui_ch_transfer_partial', iso(moved.aName), moved.movedTo ?? '?', iso(moved.bName), moved.number, moved.target)}</b></p>
          {moved.text && <p dir="auto">{t('ui_ch_transfer_reason')}: {moved.text}</p>}
          {moved.detail && <ul className="ch-blockers" dir="ltr">{splitList(moved.detail).map((x, i) => <li key={i}>{x}</li>)}</ul>}
          <p className="ch-muted">{t('ui_ch_transfer_partial_hint', moved.number, iso(moved.bName))}</p>
        </div>
      )}
    </InlineAlert>
  );
}
