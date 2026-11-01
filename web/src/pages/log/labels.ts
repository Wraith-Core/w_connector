/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/log/labels.ts
 * Plain words for the runner kinds and the action names (Config.ActionPerms keys, chat commands).
 * Shared by the Admin log (what happened) and the Permissions page (what an area opens).
 * An unknown name falls back to itself, so a new action never shows an empty cell.
 * ════════════════════════════════════════════════════════════════════════════ */

import type { TFn } from '../../i18n';

/** The kinds the log filter offers, in this order */
export const LOG_KINDS = ['player', 'characters', 'server', 'news', 'bans', 'map', 'self', 'scripts', 'settings', 'hud', 'command', 'site'] as const;

function known(t: TFn, key: string, fallback: string): string {
  const v = t(key);
  return v === key ? fallback : v;
}

/** 'bring' → 'إحضار لاعب' / 'Brought a player' */
export const actionLabel = (t: TFn, action: string): string => known(t, `label.log.action.${action}`, action);

/** 'player' → 'اللاعبون' / 'Players' */
export const kindLabel = (t: TFn, kind: string): string => known(t, `label.log.kind.${kind}`, kind);

/** A detail key of LogEntry.data ('reason', 'old', 'new') in plain words */
export const fieldLabel = (t: TFn, key: string): string => known(t, `label.log.field.${key}`, key);
