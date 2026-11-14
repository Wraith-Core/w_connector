/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/players/shared.ts
 * What the list and the drawer share: names, status, the drawer tabs, and the one way every drawer
 * action reaches Lua (post('player', { citizenid, action, args })).
 *
 * The target is named by CITIZEN ID: sv_console runPlayer resolves it with w.citizen.requireOnline,
 * so an action never lands on whoever took over a session number in the meantime. The session
 * number is added only where the client needs it (the own-wardrobe handoff in cl_main.lua) or when
 * a character has no citizen id yet.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useCallback, useState } from 'react';
import { useApp } from '../../ctx';
import type { HelpKey } from '../../help/types';
import { useI18n } from '../../i18n';
import type { TFn } from '../../i18n';
import type { Status } from '../../kit';
import type { AdminPlayer, Area, Coords, Level, Rank, Result } from '../../types';
import { LEVELS } from '../../types';

export const LOW = 20;

export const fullName = (p: AdminPlayer): string => `${p.firstname ?? ''} ${p.lastname ?? ''}`.trim();
/** the character name, else the account name */
export const displayName = (p: AdminPlayer): string => fullName(p) || p.name || `#${p.id}`;

export const staminaOf = (p: AdminPlayer): number | null => {
  const s = p.stamina ?? p.needs?.stamina;
  return typeof s === 'number' && Number.isFinite(s) ? s : null;
};

export const healthPct = (p: AdminPlayer): number | null =>
  p.maxHealth > 0 && Number.isFinite(p.health) ? Math.max(0, Math.min(100, (p.health / p.maxHealth) * 100)) : null;

export const needsLow = (p: AdminPlayer): boolean => !!p.needs && (p.needs.hunger < LOW || p.needs.thirst < LOW);

/** One word for the state column: dead beats low needs beats frozen */
export function statusOf(p: AdminPlayer): Status {
  if (p.dead) return 'dead';
  if (needsLow(p)) return 'low';
  if (p.frozen) return 'frozen';
  return 'ok';
}

export const needsHelp = (p: AdminPlayer): boolean => p.dead || needsLow(p);
export const isStaff = (p: AdminPlayer): boolean => !!p.group && p.group !== 'user';

/** 'مشرف (mod)' for a level, 'لاعب' for user, the raw name otherwise */
export function groupLabel(t: TFn, group: string | undefined, long = false): string {
  if (!group || group === 'user') return t(long ? 'label.drawer.groupUser' : 'label.players.groupUser');
  if ((LEVELS as readonly string[]).includes(group)) return t(`label.common.level.${group}`);
  return group;
}

/** The rank order of a group ('user' = 0, mod 1, admin 2, god 3) */
export const rankOf = (g: string | null | undefined): number => {
  if (!g) return 0;
  if (g === 'owner') return LEVELS.length + 1;
  const i = (LEVELS as readonly string[]).indexOf(g);
  return i < 0 ? 0 : i + 1;
};

export const sameCoords = (a: Coords | undefined, b: Coords | undefined) => !!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z;

/* ── the drawer tabs ─────────────────────────────────────────────────────── */

export type DrawerTab = 'profile' | 'travel' | 'health' | 'money' | 'items' | 'moderation';
export const DRAWER_TABS: readonly DrawerTab[] = ['profile', 'travel', 'health', 'money', 'items', 'moderation'];
export const isDrawerTab = (v: unknown): v is DrawerTab => typeof v === 'string' && (DRAWER_TABS as readonly string[]).includes(v);

export const TAB_HELP: Record<DrawerTab, HelpKey> = {
  profile: 'help.drawer.tab.profile',
  travel: 'help.drawer.tab.travel',
  health: 'help.drawer.tab.health',
  money: 'help.drawer.tab.money',
  items: 'help.drawer.tab.items',
  moderation: 'help.drawer.tab.moderation',
};

/** The areas a tab's actions need (all locked → the tab shows a lock) */
export const TAB_AREAS: Record<DrawerTab, Area[]> = {
  profile: [],
  travel: ['teleport'],
  health: ['revive', 'needs'],
  money: ['job', 'money'],
  items: ['items'],
  moderation: ['players', 'kick', 'ban', 'ranks'],
};

/* ── actions ─────────────────────────────────────────────────────────────── */

/** Actions the server refuses on the admin himself (sv_console NO_SELF) */
export const NO_SELF = new Set(['teleportTo', 'bring', 'bringBack', 'kick', 'ban', 'spectate', 'freeze', 'setGroup']);

export type PlayerAction =
  | 'teleportTo' | 'bring' | 'bringBack' | 'tpCoords' | 'revive' | 'heal' | 'needs' | 'setJob' | 'setGang' | 'setGroup'
  | 'money' | 'giveItem' | 'clearInventory' | 'openInventory' | 'kick' | 'ban' | 'freeze' | 'spectate' | 'notify'
  | 'sitOnMount' | 'wardrobe' | 'jail' | 'unjail';

/** The body of post('player', …) for this player */
export function playerPayload(p: AdminPlayer, selfId: number, action: PlayerAction, args: Record<string, unknown> = {}) {
  const cid = (p.citizenid ?? '').trim();
  const needId = !cid || (action === 'wardrobe' && p.id === selfId);
  return { citizenid: cid || undefined, id: needId ? p.id : undefined, action, args };
}

/** run(key, action, args) → Result, with the key of the running action for the busy state */
export function usePlayerAction(p: AdminPlayer) {
  const app = useApp();
  const { t } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(async (key: string, action: PlayerAction, args: Record<string, unknown> = {}): Promise<Result> => {
    setBusy(key);
    try {
      return await app.act('player', playerPayload(p, app.selfId, action, args), { okText: t('label.drawer.done') });
    } finally {
      setBusy(null);
    }
  }, [app, p, t]);
  return { run, busy };
}

/** true when the admin may not act on this player with this action because it is himself */
export const selfBlocked = (p: AdminPlayer, selfId: number, action: PlayerAction) => p.id === selfId && NO_SELF.has(action);

/** The admin's own rank for the level rules ('owner' passes everything; null = unknown → no client check) */
export function myRank(rank: Rank | null, groupOfMe: string | undefined): number | null {
  if (rank) return rankOf(rank);
  if (groupOfMe) return rankOf(groupOfMe);
  return null;
}

export type { Level };
