/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/hub/access.ts
 * Who may open a script's settings page and who may change it, in words:
 *   hard  the page cannot open (no 'settings' area, or the server locked it) → the button is locked
 *   soft  the page opens read-only (the script's level is above the admin's) → a line says so
 * ════════════════════════════════════════════════════════════════════════════ */

import type { AppCtx } from '../../ctx';
import type { TFn } from '../../i18n';
import type { Level, LocalText, ModuleDescriptor } from '../../types';
import { HUD } from './hudAdapter';
import { levelOk, lockText, rankOf } from './model';

const ORDER: Level[] = ['mod', 'admin', 'god'];
/** The higher of two levels (a group asks at least its script's level) */
export function maxLevel(a: Level | undefined | null, b: Level | undefined | null): Level | undefined {
  if (!a) return b ?? undefined;
  if (!b) return a;
  return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
}

type Lt = (x: LocalText | string | null | undefined) => string;

export function settingsAccess(app: Pick<AppCtx, 'can' | 'levelOf' | 'rank' | 'admin'>, mod: ModuleDescriptor, t: TFn, lt: Lt): { hard: string | null; soft: string | null } {
  const builtin = mod.resource === HUD && !mod.settings;
  const area = builtin ? 'hud' : 'settings';
  const needsOnly = mod.resource === HUD && app.can('needs');
  if (mod.settings?.locked) return { hard: lockText(t, lt, mod.settings.locked), soft: null };
  if (!app.can(area) && !needsOnly) {
    const lv = app.levelOf(area) ?? 'admin';
    return { hard: t('label.hub.lockedLevel', t(`label.common.level.${lv}`)), soft: null };
  }
  const level = mod.settings?.level;
  if (level && !levelOk(rankOf(app), level)) return { hard: null, soft: t('label.hub.editNeeds', t(`label.common.level.${level}`)) };
  return { hard: null, soft: null };
}
