/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · ctx.tsx
 * What every page needs from the shell: the live data Lua pushes, the permissions (booleans and the
 * levels map), the route, and the verbs:
 *   act      → POST with a toast on the answer
 *   confirm  → the in-page dialog (ConfirmSpec: stateful body, type-to-confirm, danger)
 *   toast    → a message
 *   refresh  → ask Lua for a push
 *   navigate → open a page (params are strings: { cid: '12' }, { sel: '7' })
 * Every page reads this one object (src/pages/<id>).
 * ════════════════════════════════════════════════════════════════════════════ */

import { createContext, useContext } from 'react';
import type { ConfirmSpec } from './kit/dialog';
import type {
  AccessData, ActionAreas, AdminPlayer, AdminSelf, Area, BanEntry, BlockEntry, Catalog, HudCfg, Level, LevelsMap, LogEntry, MapCfg, MapData,
  MapPlayerRow, ModuleDescriptor, Perms, Rank, RefreshWhat, Result, SelfState, ServerInfo, ToastType,
} from './types';

export type { RefreshWhat };

export interface ActOptions {
  /** Toast text on success (already translated); omit for silent success */
  okText?: string;
  /** No error toast either (the caller shows its own) */
  silent?: boolean;
}

export type RouteParams = Record<string, string>;
export interface Route { page: string; params: RouteParams }

/** The console settings of this viewer (localStorage; the settings page edits them).
 *  Help mode is not here: useHelp().setHelpMode(on, true) remembers it. */
export interface Prefs {
  density: 'comfortable' | 'compact';
  reducedMotion: boolean;
  /** the column set of EVERY list (Players, Characters, the settings sample): one choice for all */
  tableMode: 'essential' | 'detail';
}

export interface AppCtx {
  admin: AdminSelf | null;
  serverName: string;
  selfId: number;
  perms: Perms;
  /** true when the admin may use this area (the server re-checks everything) */
  can(key: Area): boolean;
  canAction(name: string): boolean;

  /* L1 contracts (empty until Lua sends them) */
  levels: LevelsMap;
  rank: Rank | null;
  actions: ActionAreas;
  commands: Record<string, Level>;
  protectedResources: string[];
  banDurations: number[];
  /** the minimum level of an area, or null when unknown */
  levelOf(area: Area): Level | null;

  players: AdminPlayer[];
  playersSeen: boolean;
  serverInfo: ServerInfo | null;
  hudCfg: HudCfg | null;
  bans: BanEntry[] | null;
  catalog: Catalog | null;
  mapCfg: MapCfg | null;
  mapPlayers: MapPlayerRow[];
  mapPlayersSeen: boolean;
  mapData: MapData;
  self: SelfState | null;
  /** the Scripts hub list (null until asked) */
  modules: ModuleDescriptor[] | null;
  /** the newest admin-log lines pushed while open (newest first, at most 50) */
  recentLogs: LogEntry[];
  /** character blocks (the 'blocks' push; null until asked) */
  blocks: BlockEntry[] | null;
  /** 2.3.1 · the admin's own access as the website models it (the 'access' push; null until asked) */
  access: AccessData | null;

  act<T = unknown>(name: string, data: unknown, opts?: ActOptions): Promise<Result<T>>;
  confirm<V = unknown>(spec: ConfirmSpec<V>): void;
  toast(type: ToastType, text: string): void;
  refresh(what: RefreshWhat): void;

  /** the selected online player (server id); the players page, the map and the quick menu share it */
  selectedId: number | null;
  select(id: number | null): void;

  route: Route;
  navigate(page: string, params?: RouteParams): void;
  openPalette(query?: string): void;

  mode: 'full' | 'quick';
  setMode(mode: 'full' | 'quick'): void;
  close(): void;

  prefs: Prefs;
  setPrefs(patch: Partial<Prefs>): void;
}

export const DEFAULT_PREFS: Prefs = { density: 'comfortable', reducedMotion: false, tableMode: 'essential' };

const noopAsync = async () => ({ ok: false });

export const Ctx = createContext<AppCtx>({
  admin: null, serverName: '', selfId: 0, perms: {}, can: () => false, canAction: () => false,
  levels: {}, rank: null, actions: {}, commands: {}, protectedResources: [], banDurations: [], levelOf: () => null,
  players: [], playersSeen: false, serverInfo: null, hudCfg: null, bans: null, catalog: null, mapCfg: null,
  mapPlayers: [], mapPlayersSeen: false, mapData: { places: [], labels: [], markers: [] }, self: null,
  modules: null, recentLogs: [], blocks: null, access: null,
  act: noopAsync as AppCtx['act'], confirm: () => {}, toast: () => {}, refresh: () => {},
  selectedId: null, select: () => {},
  route: { page: 'dashboard', params: {} }, navigate: () => {}, openPalette: () => {},
  mode: 'full', setMode: () => {}, close: () => {},
  prefs: DEFAULT_PREFS, setPrefs: () => {},
});

export const useApp = () => useContext(Ctx);
