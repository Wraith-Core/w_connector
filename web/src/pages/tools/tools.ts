/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/tools/tools.ts
 * Every staff tool of the admin HIMSELF, defined once. The "My tools" page, the PgUp quick menu and
 * the command palette all read this list, so a tool has one label, one explanation and one
 * permission everywhere.
 *
 *   kind 'toggle'  a mode (noclip, invisible …)   post('self', { action, args: { state } });
 *                  its on / off comes back in the 'self' push (SelfState[state])
 *   kind 'action'  a one-shot (heal, repair …)     post('self', { action, args })
 *   kind 'form'    needs input first (coordinates, a model, a radius): drawn by forms.tsx
 *
 *   texts   label.tools.tool.<id> (name) · label.tools.hint.<id> (one line) · label.tools.do.<id> (verb)
 *   help    help.tools.<id>
 *   area    Config.ActionPerms.self[action]: the page shows the tool locked, the server re-checks it
 * ════════════════════════════════════════════════════════════════════════════ */

import { useCallback, useRef, useState } from 'react';
import type { AppCtx } from '../../ctx';
import { useApp } from '../../ctx';
import type { HelpKey } from '../../help/types';
import { makeT, useI18n } from '../../i18n';
import type { TFn } from '../../i18n';
import type { Area, Lang, Result, SelfState } from '../../types';

/** The page sections (the quick menu folds 'me' and 'health' into its 'self' group) */
export type ToolSection = 'me' | 'health' | 'travel' | 'spawn' | 'vehicle' | 'dev';
export const TOOL_SECTIONS: readonly ToolSection[] = ['me', 'health', 'travel', 'spawn', 'vehicle', 'dev'];

export const SECTION_HELP: Record<ToolSection, HelpKey> = {
  me: 'help.tools.section.me',
  health: 'help.tools.section.health',
  travel: 'help.tools.section.travel',
  spawn: 'help.tools.section.spawn',
  vehicle: 'help.tools.section.vehicle',
  dev: 'help.tools.section.dev',
};

type Bool = { [K in keyof SelfState]-?: SelfState[K] extends boolean | undefined ? K : never }[keyof SelfState];

export interface ToolDef {
  id: string;
  section: ToolSection;
  kind: 'toggle' | 'action' | 'form';
  /** Config.ActionPerms.self[action] */
  area: Area;
  help: HelpKey;
  /** the 'self' action (default: id) */
  action?: string;
  /** toggles: the SelfState field that says on / off */
  state?: Bool;
  args?: Record<string, unknown>;
  /** 'refill' is a player action on the admin himself (post('player', …)) */
  endpoint?: 'self' | 'selfNeeds';
  /** ask first: 'danger' (red, cannot be undone) or 'plain' */
  confirm?: 'danger' | 'plain';
  /** the console closes after it succeeds ('on' = only when switching on) */
  closes?: 'always' | 'on';
  /** a copy tool: its success toast says "copied" */
  copies?: boolean;
  /** greyed out right now (tpBack before any jump) */
  unavailable?(self: SelfState | null): boolean;
  /** words that also find it in the command palette (the other language is added automatically) */
  keywords?: string;
}

export const TOOLS: ToolDef[] = [
  /* movement and protection */
  { id: 'noclip', section: 'me', kind: 'toggle', area: 'teleport', state: 'noclip', help: 'help.tools.noclip', closes: 'on', keywords: 'fly flight' },
  { id: 'invisible', section: 'me', kind: 'toggle', area: 'players', state: 'invisible', help: 'help.tools.invisible', keywords: 'hide' },
  { id: 'godmode', section: 'me', kind: 'toggle', area: 'revive', state: 'godmode', help: 'help.tools.godmode', keywords: 'god' },
  { id: 'names', section: 'me', kind: 'toggle', area: 'players', state: 'names', help: 'help.tools.names', keywords: 'ids tags' },
  { id: 'boost', section: 'me', kind: 'toggle', area: 'revive', state: 'boost', help: 'help.tools.boost', keywords: 'speed run' },
  { id: 'stamina', section: 'me', kind: 'toggle', area: 'revive', state: 'stamina', help: 'help.tools.stamina' },
  { id: 'noclipSpeed', section: 'me', kind: 'form', area: 'teleport', help: 'help.tools.noclipSpeed' },
  /* health */
  { id: 'heal', section: 'health', kind: 'action', area: 'revive', help: 'help.tools.heal' },
  { id: 'revive', section: 'health', kind: 'action', area: 'revive', help: 'help.tools.revive' },
  { id: 'cleanPed', section: 'health', kind: 'action', area: 'revive', help: 'help.tools.cleanPed', keywords: 'blood wet' },
  { id: 'refill', section: 'health', kind: 'action', area: 'needs', help: 'help.tools.refill', endpoint: 'selfNeeds', keywords: 'hunger thirst food water' },
  /* travel */
  { id: 'tpWaypoint', section: 'travel', kind: 'action', area: 'teleport', help: 'help.tools.tpWaypoint', closes: 'always', keywords: 'teleport tp marker' },
  { id: 'tpBack', section: 'travel', kind: 'action', area: 'teleport', help: 'help.tools.tpBack', closes: 'always', unavailable: (s) => !s?.canGoBack, keywords: 'teleport tp return' },
  { id: 'tpForward', section: 'travel', kind: 'action', area: 'teleport', help: 'help.tools.tpForward', closes: 'always', keywords: 'teleport tp' },
  { id: 'tpCoords', section: 'travel', kind: 'form', area: 'teleport', help: 'help.tools.tpCoords', closes: 'always', keywords: 'teleport tp vector3' },
  /* spawn */
  { id: 'spawn', section: 'spawn', kind: 'form', area: 'spawn', help: 'help.tools.spawn', keywords: 'horse wagon animal ped npc' },
  { id: 'cleanupSpawned', section: 'spawn', kind: 'action', area: 'spawn', help: 'help.tools.cleanupSpawned', confirm: 'plain' },
  /* wagon and horse */
  { id: 'repairVehicle', section: 'vehicle', kind: 'action', area: 'vehicle', help: 'help.tools.repairVehicle', keywords: 'wagon fix' },
  { id: 'flipVehicle', section: 'vehicle', kind: 'action', area: 'vehicle', help: 'help.tools.flipVehicle', keywords: 'wagon' },
  { id: 'vehicleBoost', section: 'vehicle', kind: 'action', area: 'vehicle', help: 'help.tools.vehicleBoost', keywords: 'wagon speed' },
  { id: 'healMount', section: 'vehicle', kind: 'action', area: 'vehicle', help: 'help.tools.healMount', keywords: 'horse' },
  { id: 'deleteVehicle', section: 'vehicle', kind: 'action', area: 'entities', help: 'help.tools.deleteVehicle', confirm: 'danger', keywords: 'wagon remove' },
  /* developer */
  { id: 'laser', section: 'dev', kind: 'toggle', area: 'entities', state: 'laser', help: 'help.tools.laser', closes: 'on', keywords: 'entity delete' },
  { id: 'showCoords', section: 'dev', kind: 'toggle', area: 'dev', state: 'showCoords', help: 'help.tools.showCoords', keywords: 'position' },
  { id: 'hashes', section: 'dev', kind: 'toggle', area: 'dev', state: 'hashes', help: 'help.tools.hashes', keywords: 'model' },
  { id: 'copyCoords3', section: 'dev', kind: 'action', area: 'dev', action: 'copyCoords', args: { type: 'coords3' }, help: 'help.tools.copyCoords3', copies: true, keywords: 'vector3 position' },
  { id: 'copyCoords4', section: 'dev', kind: 'action', area: 'dev', action: 'copyCoords', args: { type: 'coords4' }, help: 'help.tools.copyCoords4', copies: true, keywords: 'vector4 position' },
  { id: 'copyHeading', section: 'dev', kind: 'action', area: 'dev', action: 'copyCoords', args: { type: 'heading' }, help: 'help.tools.copyHeading', copies: true },
  { id: 'clearArea', section: 'dev', kind: 'form', area: 'entities', help: 'help.tools.clearArea', confirm: 'danger', keywords: 'delete cleanup' },
];

export const toolById = (id: string): ToolDef | undefined => TOOLS.find((x) => x.id === id);
export function canTool(app: Pick<AppCtx, 'can' | 'canAction'>, tool: ToolDef): boolean {
  if (!app.can(tool.area)) return false;
  if (tool.endpoint === 'selfNeeds') return app.canAction('player.needs');
  if (tool.id === 'spawn') return ['Horse', 'Wagon', 'Animal', 'Ped'].some((kind) => app.canAction(`self.spawn${kind}`));
  return app.canAction(`self.${tool.action ?? tool.id}`);
}

/* ── texts ───────────────────────────────────────────────────────────────── */

export const toolLabel = (t: TFn, id: string) => t(`label.tools.tool.${id}`);
export const toolHint = (t: TFn, id: string) => {
  const k = `label.tools.hint.${id}`;
  const s = t(k);
  return s === k ? '' : s;
};
export const toolVerb = (t: TFn, id: string) => t(`label.tools.do.${id}`);

/** The page's language when no hook is at hand (palette entries are built outside React) */
export const docLang = (): Lang => (document.documentElement.lang === 'en' ? 'en' : 'ar');
/** A translator over the bundled texts (every label.tools.* lives in the help fragments, never in Lua's dictionary) */
export const bundledT = (lang: Lang = docLang()): TFn => makeT({}, lang);

/* ── state ───────────────────────────────────────────────────────────────── */

export const isOn = (tool: ToolDef, self: SelfState | null): boolean => !!(tool.state && self && self[tool.state] === true);

/** The modes that are on right now, in list order */
export const activeTools = (self: SelfState | null): ToolDef[] => TOOLS.filter((x) => x.kind === 'toggle' && isOn(x, self));

/** 'spawn' is four server actions, one per kind */
export type SpawnKind = 'horses' | 'wagons' | 'animals' | 'peds';
export const SPAWN_KINDS: readonly SpawnKind[] = ['horses', 'wagons', 'animals', 'peds'];
export const SPAWN_ACTION: Record<SpawnKind, string> = { horses: 'spawnHorse', wagons: 'spawnWagon', animals: 'spawnAnimal', peds: 'spawnPed' };
/** Config.ToolLimits.spawnLimit (the server refuses past it with its own message) */
export const SPAWN_LIMIT = 25;
export const NOCLIP_SPEEDS: readonly number[] = [0.25, 0.5, 1, 2, 5, 10];

/* ── running a tool ──────────────────────────────────────────────────────── */

export interface RunOptions {
  /** extra args (merged over the tool's own) */
  args?: Record<string, unknown>;
  /** the confirm text, when the tool asks first (the page fills %s) */
  confirmText?: string;
  /** skip the confirm (already confirmed) */
  confirmed?: boolean;
}

/** The raw call, without confirm or busy handling */
export function callTool(app: Pick<AppCtx, 'act' | 'self' | 'selfId'>, tool: ToolDef, t: TFn, opts: RunOptions = {}): Promise<Result> {
  if (tool.endpoint === 'selfNeeds') {
    return app.act('player', { id: app.selfId, action: 'needs', args: { hunger: 100, thirst: 100 } }, { okText: t('label.tools.done') });
  }
  const action = tool.action ?? tool.id;
  const args: Record<string, unknown> = { ...(tool.args ?? {}), ...(opts.args ?? {}) };
  if (tool.kind === 'toggle') args.state = !isOn(tool, app.self);
  /* a toggle confirms itself: its switch flips when the 'self' push arrives, no toast needed */
  const okText = tool.kind === 'toggle' ? undefined : t(tool.copies ? 'label.tools.copied' : 'label.tools.done');
  return app.act('self', { action, args }, { okText });
}

const CONFIRM_TEXT: Record<string, { text: string; yes: string }> = {
  cleanupSpawned: { text: 'label.tools.confirm.cleanup', yes: 'label.tools.confirm.cleanupYes' },
  deleteVehicle: { text: 'label.tools.confirm.deleteVehicle', yes: 'label.tools.confirm.deleteYes' },
  clearArea: { text: 'label.tools.confirm.clearArea', yes: 'label.tools.confirm.clearYes' },
};

/**
 * Runs a tool, through the confirm dialog when it asks first. `exec` wraps the call (the runner's
 * one-at-a-time lock); the command palette passes none.
 */
export function startTool(
  app: Pick<AppCtx, 'act' | 'self' | 'selfId' | 'confirm'>, tool: ToolDef, t: TFn, opts: RunOptions = {},
  exec: (key: string, fn: () => Promise<Result>) => Promise<Result> = (_k, fn) => fn(),
): void {
  const go = () => exec(tool.id, () => callTool(app, tool, t, opts));
  if (tool.confirm && !opts.confirmed) {
    const danger = tool.confirm === 'danger';
    const c = CONFIRM_TEXT[tool.id];
    app.confirm({
      title: toolLabel(t, tool.id),
      text: opts.confirmText ?? (c ? t(c.text) : undefined),
      help: tool.help,
      danger,
      undoable: danger ? false : undefined,
      confirmLabel: c ? t(c.yes) : undefined,
      onConfirm: async () => (await go()).ok,
    });
    return;
  }
  void go();
}

/**
 * The page and the quick menu run tools through this: one call at a time (the client refuses a
 * second one while the first runs), the confirm dialog for the tools that ask first.
 */
export function useToolRunner() {
  const app = useApp();
  const { t } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef<string | null>(null);

  const exec = useCallback(async (key: string, fn: () => Promise<Result>): Promise<Result> => {
    if (busyRef.current) return { ok: false };
    busyRef.current = key;
    setBusy(key);
    try { return await fn(); } finally { busyRef.current = null; setBusy(null); }
  }, []);

  const run = useCallback((tool: ToolDef, opts: RunOptions = {}): void => startTool(app, tool, t, opts, exec), [app, exec, t]);

  /** any other self call (spawn, tpCoords, noclipSpeed, stopSpectate) with the same one-at-a-time rule */
  const self = useCallback((key: string, action: string, args: Record<string, unknown> = {}, okText?: string) =>
    exec(key, () => app.act('self', { action, args }, { okText })), [app, exec]);

  return { busy, run, self, exec };
}

export type ToolRunner = ReturnType<typeof useToolRunner>;
