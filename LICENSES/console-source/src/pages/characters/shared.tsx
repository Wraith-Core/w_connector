/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/characters/shared.tsx
 * What every drawer tab receives, and the small pieces two tabs (or a tab and a dialog) share.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useI18n } from '../../i18n';
import type { TFn } from '../../i18n';
import { HelpTip, StatusChip, fmtCash, fmtGold } from '../../kit';
import type { Result } from '../../types';
import type { CharacterFlows, Who } from './flows';
import type { CharDetail, TabId } from './model';

export interface TabProps {
  detail: CharDetail;
  flows: CharacterFlows;
  /** runs a 'characters' action on the open character (busy follows the action name) */
  run(action: string, data: Record<string, unknown>, okText?: string): Promise<Result<Record<string, unknown>> | null>;
  /** after a successful action: the list and the character again */
  after(r: { ok: boolean } | null, citizenid?: string): Promise<void>;
  open(citizenid: string, view?: TabId): void;
  search(): Promise<void>;
}

/** A name inside a sentence keeps its own direction (an Arabic name in an English line, a Latin one in
 *  an Arabic line): FSI … PDI. Without it "فهد (#14)" turns into "(14#) فهد" in an English sentence. */
export const iso = (s: string | number): string => `\u2068${s}\u2069`;
/** Left-to-right inside an Arabic line: '$1,250.50', '#5' (LRI … PDI) */
export const ltr = (s: string | number): string => `\u2066${s}\u2069`;

/** 'YYYY-MM-DD HH:MM' from what sv_characters.lua sends */
export const fmtSeen = (v: string | null | undefined): string => (v ? String(v).replace('T', ' ').slice(0, 16) : '—');

/** A block time in unix seconds (a TIMESTAMP column may arrive in milliseconds) */
export const blockSeconds = (v: number | undefined | null): number | null => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? Math.floor(n / 1000) : n;
};

/** '$1,250.50' or '3.25 ذهب' for one account */
export const fmtBalance = (t: TFn, balance: number, currency: string): string =>
  (String(currency).toUpperCase() === 'GOLD' ? fmtGold(t, balance) : fmtCash(balance));

/** Online / offline as text and shape (a character is feminine in Arabic: "متصلة") */
export function OnlineChip({ online }: { online?: number | null }) {
  const { t } = useI18n();
  if (!online) return <StatusChip status="offline" label={t('label.characters.filter.offline')} />;
  return (
    <span className="ch-online">
      <StatusChip status="online" label={t('label.characters.filter.online')} />
      <span className="k-num ch-sid">#{online}</span>
    </span>
  );
}

export interface SideWho extends Who { online?: number | null | boolean; source?: number }

/** Both sides of a number transfer: who moves to a fresh number, who takes this one, who gets kicked */
export function Sides({ holder, taker }: { holder: SideWho; taker: SideWho }) {
  const { t } = useI18n();
  const hOnline = typeof holder.online === 'number' ? holder.online : holder.online ? holder.source : null;
  const tOnline = typeof taker.online === 'number' ? taker.online : taker.online ? taker.source : null;
  return (
    <div className="ch-sides">
      <p className="ch-sides-head">
        <span>{t('label.characters.transferSides')}</span>
        <HelpTip help="help.characters.transferSides" label={t('label.characters.transferSides')} size="sm" />
      </p>
      <div className="ch-side">
        <span className="ch-side-tag">{t('label.characters.sidesHolder')}</span>
        <span className="ch-side-text">{t('ui_ch_transfer_holder', iso(holder.name || holder.citizenid), holder.citizenid)}</span>
        {hOnline ? <OnlineChip online={hOnline} /> : null}
      </div>
      <div className="ch-side">
        <span className="ch-side-tag">{t('label.characters.sidesTaker')}</span>
        <span className="ch-side-text">{t('ui_ch_transfer_taker', iso(taker.name || taker.citizenid), taker.citizenid, holder.citizenid)}</span>
        {tOnline ? <OnlineChip online={tOnline} /> : null}
      </div>
      {(hOnline || tOnline) ? <p className="ch-sides-kick">{t('label.characters.transferKick')}</p> : null}
    </div>
  );
}
