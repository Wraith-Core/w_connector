/* The character's file: its ids, state, account, job, balances and the account's other characters (read only) */

import type { HelpKey } from '../../../help/types';
import { useI18n } from '../../../i18n';
import { useApp } from '../../../ctx';
import { Button, Fold, InlineAlert, KeyValue, KeyValueList, Section, Where, useWhere } from '../../../kit';
import { accountKind } from '../model';
import { OnlineChip, fmtBalance, fmtSeen } from '../shared';
import type { TabProps } from '../shared';

const KNOWN_ACCOUNTS = ['cash', 'bank', 'gold'];
/* every balance row carries its own "؟" */
const ACCOUNT_HELP: Record<string, HelpKey> = {
  cash: 'help.players.col.cash',
  gold: 'help.players.col.gold',
  bank: 'help.drawer.bank',
};

export default function Overview({ detail, open }: TabProps) {
  const { t } = useI18n();
  const app = useApp();
  const cid = detail.citizenid;
  const live = detail.online ? app.players.find((p) => p.id === detail.online) ?? null : null;
  const where = useWhere([live?.coords]);
  const name = detail.name || cid;
  let say = detail.job ? t('label.characters.say.job', name, detail.job) : t('label.characters.say.noJob', name);
  if (detail.gang) say += t('label.characters.say.gang', detail.gang);
  say += detail.online ? t('label.characters.say.online') : t('label.characters.say.seen', fmtSeen(detail.lastSeen));
  return (
    <div className="ch-tab">
      <div className="k-story">
        <p className="k-story-say" dir="auto">{say}</p>
        {live && <p className="k-story-line">{t('label.characters.say.now')} <Where text={where(live.coords)} /></p>}
      </div>
      {!detail.online && <InlineAlert tone="info" title={t('ui_ch_offline_note')} help="help.characters.offline" />}

      <Section title={t('ui_ch_details')} help="help.characters.tabOverview">
        <KeyValueList>
          <KeyValue label={t('ui_ch_col_id')} help="help.characters.kvCitizenId" value={cid} copy={cid} ltr />
          <KeyValue label={t('ui_ch_col_state')} help="help.characters.kvState" value={<OnlineChip online={detail.online} />} />
          <KeyValue label={t('ui_ch_col_job')} help="help.characters.colJob" value={detail.job} />
          <KeyValue label={t('ui_ch_gang')} help="help.characters.kvGang" value={detail.gang} />
        </KeyValueList>
        <Fold>
          <KeyValueList>
            {detail.online ? (
              <KeyValue label={t('label.characters.serverId')} help="help.common.serverId" value={`#${detail.online}`} copy={`#${detail.online}`} ltr />
            ) : null}
            <KeyValue label={t('ui_ch_col_account')} help="help.characters.kvAccount" value={detail.account} />
            <KeyValue label={t('ui_ch_license')} help="help.characters.colLicense" value={detail.license ? <span className="k-mono ch-license">{detail.license}</span> : null} copy={detail.license || undefined} />
            <KeyValue label={t('ui_ch_slot')} help="help.characters.colSlot" value={detail.slot ?? null} ltr />
            <KeyValue label={t('ui_ch_col_last')} help="help.characters.colLast" value={fmtSeen(detail.lastSeen)} ltr />
          </KeyValueList>
        </Fold>
      </Section>

      <Section title={t('ui_ch_money')} help="help.characters.balances">
        {detail.money.length === 0 ? <p className="ch-muted">{t('label.characters.noBalances')}</p> : (
          <KeyValueList>
            {detail.money.map((m) => {
              const kind = accountKind(m.id, cid);
              const known = KNOWN_ACCOUNTS.includes(kind);
              return (
                <KeyValue
                  key={m.id}
                  label={known ? t(`label.characters.acc.${kind}`) : kind}
                  help={ACCOUNT_HELP[kind] ?? 'help.characters.balances'}
                  value={fmtBalance(t, m.balance, m.currency)}
                  ltr
                />
              );
            })}
          </KeyValueList>
        )}
      </Section>

      {detail.siblings.length > 0 && (
        <Section title={t('ui_ch_siblings')} help="help.characters.siblings">
          <div className="ch-siblings">
            {detail.siblings.map((s) => (
              <Button key={s.citizenid} kind="ghost" size="sm" help="help.characters.siblings" helpLabel={s.name || s.citizenid} onClick={() => open(s.citizenid)}>
                <span className="k-num">{s.citizenid}</span>
                <span className="ch-sibling-name">{s.name || '—'}</span>
              </Button>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
