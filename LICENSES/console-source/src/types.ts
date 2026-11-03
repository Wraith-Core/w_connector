/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · types.ts
 * The NUI contract between client/*.lua and this page. Both sides implement exactly these shapes.
 *
 *   Lua → page   SendNUIMessage({ action, data })      see LuaMessage at the end
 *   page → Lua   fetch('https://w_admin/<name>', data)  every callback answers Result<T>
 *
 * Fields marked "L1" are new in the redesign: Lua sends them once the L1 task lands. Until then
 * they are optional and the page falls back (a missing levels map hides the level facts only).
 * ════════════════════════════════════════════════════════════════════════════ */

export type Lang = 'ar' | 'en';
export type Dir = 'rtl' | 'ltr';
export type Strings = Record<string, string>;

/** A text another resource sends in both languages (module descriptors, settings schemas) */
export interface LocalText { ar: string; en: string }

/* ── Permission levels and areas ─────────────────────────────────────────── */

/** Config.Levels, lowest to highest. A level covers every level below it. */
export type Level = 'mod' | 'admin' | 'god';
export const LEVELS: readonly Level[] = ['mod', 'admin', 'god'];
/** The admin's own rank: a level, or 'owner' for the server console / the `command` ACE (passes everything) */
export type Rank = Level | 'owner';

/** Every key of Config.PagePerms. The first 21 exist today; the rest are added by L1. */
export type Area =
  | 'players' | 'teleport' | 'revive' | 'needs' | 'job' | 'money' | 'items' | 'kick' | 'ban'
  | 'server' | 'hud' | 'dev' | 'map' | 'bans' | 'resources' | 'spawn' | 'vehicle' | 'entities'
  | 'characters' | 'citizenId' | 'charDelete'
  /* L1 */
  | 'scripts'          // the Scripts hub: see every script, open its own interface (mod)
  | 'scriptsRun'       // quick commands of other scripts (admin)
  | 'scriptsConsole'   // server-console lines of other scripts (god)
  | 'settings'         // live settings of other scripts: read + apply (admin; a group may ask more)
  | 'settingsImport'   // settings import / presets (god)
  | 'logs'             // the admin log page (admin)
  | 'perms'            // the read-only permissions matrix (mod)
  | 'news'             // the pause menu's news (w_pausemenu): add, edit, order, delete (admin)
  | 'reports'          // the players' reports, the website's list (w_connector): claim, answer, close (mod)
  | 'ranks';           // the ranks page (w_core ranks): edit ranks, give / take them (the server sends level 'master')
/** @deprecated the old name of Area */
export type PermKey = Area;
/** Area → allowed, as permsFor() sends it */
export type Perms = Partial<Record<Area, boolean>>;
/** L1 · Config.PagePerms as sent: area → minimum level */
export type LevelsMap = Partial<Record<Area, Level>>;

/** The runner kinds of w_admin:server:action (Config.ActionPerms keys) */
export type ActionKind = 'player' | 'self' | 'server' | 'hud' | 'bans' | 'map' | 'characters' | 'scripts' | 'settings' | 'logs' | 'news';
/** L1 · Config.ActionPerms as sent: kind → action → area */
export type ActionAreas = Partial<Record<ActionKind, Record<string, Area>>>;

/* ── open / locale / permissions ─────────────────────────────────────────── */

export interface AdminSelf {
  id: number;
  name: string;
  /** the w_core group ('user' | 'mod' | 'admin' | 'god') */
  group: string;
  /** L1 · the admin's own citizen id */
  citizenid?: string;
  /** L1 · the admin's rank for the level facts ('owner' = console ACE) */
  rank?: Rank;
}

export interface OpenData {
  initialPage?: string;
  connector?: { actions: string[]; unavailable?: Record<string, string>; game?: string };
  mode?: 'full' | 'quick';
  admin: AdminSelf;
  locale: Lang;
  dir: Dir;
  strings: Strings;
  perms: Perms;
  serverName: string;
  selfId: number;
  /** L1 · Config.PagePerms (area → level) */
  levels?: LevelsMap;
  /** L1 · Config.ActionPerms (kind → action → area) */
  actions?: ActionAreas;
  /** L1 · Config.CommandPerms (chat command → level), for the permissions page */
  commands?: Record<string, Level>;
  /** L1 · the keys of Config.ProtectedResources (never stop / restart these) */
  protectedResources?: string[];
  /** L1 · Config.BanDurations in minutes (0 = permanent) */
  banDurations?: number[];
}

export interface LocaleData { locale: Lang; dir: Dir; strings: Strings }

/** 'permissions' push: today a bare Perms map; L1 sends the object form (the page accepts both) */
export type PermissionsPush = Perms | { perms: Perms; levels?: LevelsMap; rank?: Rank };

/* ── 2.3.1 · 'access' push: the admin's own access as the website models it (pages/perms) ───── */

export interface LangText { ar: string; en: string }
/** One website permission with the website's own names (the session's permissionCatalog) */
export interface WebPermission { id: string; label: LangText; description: LangText; ownerOnly?: boolean }
/** One script permission from this server's catalogue (core/script_catalog.lua) */
export interface ScriptPermission { id: string; node: string; label: LangText; description: LangText; danger?: boolean }
export interface ScriptGroup { id: string; label: LangText; permissions: ScriptPermission[] }
/** A custom role and how it is held (direct / discord are missing when an older website sends names only) */
export interface AccessRole { name: string; direct?: boolean; discord?: boolean }
export interface AccessData {
  /** changes whenever any of it changes */
  rev: number;
  /** the website base role: owner · admin · moderator · viewer · custom */
  role: string | null;
  roles: AccessRole[];
  /** held: the website permissions he has · catalog: every website permission (null from an older website) */
  web: { held: string[]; catalog: WebPermission[] | null };
  /** held: the script permissions he has · from 'server' when the website did not send them */
  scripts: { held: string[]; from: 'website' | 'server'; groups: ScriptGroup[] };
  /** where roles are managed on the website */
  manage: { url: string; where: LangText | null } | null;
}

/* ── Players ─────────────────────────────────────────────────────────────── */

export interface JobInfo { name: string; label: string; grade: number; gradeName: string; onDuty: boolean }
export interface GangInfo { name: string; label: string; grade: number; gradeName: string }
export interface Coords { x: number; y: number; z: number; heading: number }

export interface AdminPlayer {
  /** server id (the session number, shown as #id) */
  id: number;
  /** account name */
  name: string;
  citizenid: string;
  firstname: string;
  lastname: string;
  job: JobInfo;
  gang: GangInfo;
  money: { cash: number; gold: number; bank?: number };
  ping: number;
  health: number;
  maxHealth: number;
  dead: boolean;
  needs: { hunger: number; thirst: number; stamina?: number } | null;
  stamina?: number;
  coords: Coords;
  group: string;
  discord?: string;
  frozen?: boolean;
  canReturn?: boolean;
}

/**
 * L1 · 'citizen' callback: the preview chip of CitizenIdInput and the command palette.
 * page → Lua: post('citizen', { input })   input = the text as typed ('12', '#7', 'OMG95204')
 * answers Result<CitizenPreview>; a failure carries errorKey 'citizen.invalid_id' | 'citizen.not_found'
 * (the w.citizen reason keys) and error = the translated text.
 */
export interface CitizenPreview {
  citizenid: string;
  /** character first + last name ('' when none) */
  name: string;
  online: boolean;
  /** server id while online */
  source?: number;
}

/* ── Server ──────────────────────────────────────────────────────────────── */

export type ResourceState = 'started' | 'starting' | 'stopped' | 'stopping' | 'missing' | 'uninitialized' | 'unknown';

export interface ResourceInfo {
  name: string;
  state: ResourceState | string;
  /** L1 · GetResourceMetadata(name, 'version') */
  version?: string;
  /** L1 · GetResourceMetadata(name, 'description') */
  description?: string;
}

export interface ServerInfo {
  /** seconds */
  uptime: number;
  playersOnline: number;
  maxPlayers: number;
  version: string;
  weather: string | null;
  time: { hour: number; minute: number } | null;
  bansCount: number;
  /** L1 · active character blocks */
  blocksCount?: number;
  resources: ResourceInfo[];
  /** L1 · w_weathersync's cycle (getTimeFreezeState / getDynamicWeather / getBlackoutState); absent
   *  when w_weathersync is not running. Changed by server actions freezeTime / dynamicWeather /
   *  blackout with args { state } (area server). */
  world?: { timeFrozen?: boolean; dynamicWeather?: boolean; blackout?: boolean } | null;
}

/** The w_hud server settings blob exactly as exports.w_hud:GetServerHudCfg() returns it (legacy HUD tab) */
export type HudCfg = Record<string, unknown>;

/* ── Bans and blocks ─────────────────────────────────────────────────────── */

/** The expire value the server writes for a permanent ban (sv_console.lua) */
export const PERMANENT_BAN = 2147483647;

export interface BanEntry {
  id: number;
  name: string;
  license: string;
  reason: string;
  /** unix seconds; 0 or >= PERMANENT_BAN = permanent */
  expire: number;
  bannedby: string;
  /** not stored today (always null / '') */
  created: number | string | null;
}

/** w_core GetCharacterBlock(citizenid) */
export interface CharacterBlock { reason: string; blocked_by: string; blocked_at: number }

/** L1 · post('characters', { action: 'blocks' }) → Result<BlockEntry[]> */
export interface BlockEntry extends CharacterBlock {
  citizenid: string;
  name: string;
  /** server id while online */
  online?: number | null;
}

/* ── Characters (sv_characters.lua) ──────────────────────────────────────── */

/** post('characters', { action: 'search', q }) → Result<CharacterRow[]> */
export interface CharacterRow {
  citizenid: string;
  name: string;
  /** account name */
  account: string;
  license: string;
  slot: number;
  /** 'YYYY-MM-DD HH:MM' */
  lastSeen: string | null;
  job: string;
  /** server id while online */
  online: number | null;
  /** block reason ('' → true) */
  blocked?: string | true;
}

export type DependencyKind = 'core' | 'data' | 'asset' | 'history';
export interface CharacterDependency { table: string; column: string; kind: DependencyKind | string; rows: number }

/** post('characters', { action: 'get', citizenid }) → Result<CharacterDetail> */
export interface CharacterDetail extends CharacterRow {
  gang: string;
  block: CharacterBlock | null;
  dependencies: CharacterDependency[];
  money: { id: string; balance: number; currency: string }[];
  siblings: { citizenid: string; name: string }[];
}

/* ── Catalog ─────────────────────────────────────────────────────────────── */

export interface CatalogGrade { grade: number; name: string }
export interface CatalogJob { name: string; label: string; grades: CatalogGrade[] }
export interface CatalogItem { name: string; label: string }
export interface CatalogModel { model: string; label: string }
export interface Catalog {
  jobs: CatalogJob[];
  gangs: CatalogJob[];
  items: CatalogItem[];
  weathers: string[];
  horses: CatalogModel[];
  wagons: CatalogModel[];
  animals: CatalogModel[];
  peds: CatalogModel[];
  groups: string[];
}

/* ── Map (the shapes MapView.tsx reads; the canonical copy lives here) ───── */

export interface MapCfg {
  tilesBase: string;
  theme: string;
  projection: Record<string, unknown>;
  tiles: Record<string, unknown>;
  /** L1 · the themes w_map offers (B13); the page used to hard-code them */
  themes?: { id: string; label: LocalText }[];
}
export interface MapPlace { id: string | number; x: number; y: number; z?: number; name: string; res?: string; sprite?: string; desc?: string }
export interface MapLabel { key?: string; x: number; y: number; en: string; ar?: string; kind?: string; h?: number; hidden?: boolean }
export interface MapData { places: MapPlace[]; labels: MapLabel[]; markers: MapPlace[]; waypoint?: { x: number; y: number } | null }
export interface MapPlayerRow {
  id: number; name: string; x: number; y: number; z: number; job: string; dead: boolean;
  /** L1 · the character's citizen id (the page falls back to the 'players' push) */
  citizenid?: string;
}

/* ── Self (the admin's own tools) ────────────────────────────────────────── */

export interface SelfState {
  noclip: boolean;
  invisible: boolean;
  godmode: boolean;
  names: boolean;
  showCoords?: boolean;
  hashes?: boolean;
  boost?: boolean;
  stamina?: boolean;
  laser?: boolean;
  spawnedCount?: number;
  canGoBack?: boolean;
  spectating?: number;
  noclipSpeed?: number;
  coords: Coords;
}

/* ── Admin log (L1) ──────────────────────────────────────────────────────── */

/**
 * One line of the server's ring buffer (last 500, optionally persisted to w_admin_log).
 * Filled by logAction / log in sv_console.lua and sv_characters.lua, and by the settings audit.
 */
export interface LogEntry {
  /** ring-buffer sequence, grows by one per entry */
  id: number;
  /** unix seconds */
  at: number;
  admin: { name: string; citizenid?: string; source?: number };
  /** the runner kind ('player' | 'self' | 'server' | 'characters' | 'settings' | 'scripts' | 'bans' | 'map' | 'hud') or 'command' */
  kind: ActionKind | 'command' | string;
  /** the action name ('kick', 'setJob', 'apply', ...) */
  action: string;
  target?: { citizenid?: string; name?: string; source?: number };
  /** the log line as written today (plain text, in the server's language) */
  text: string;
  ok?: boolean;
  /** details: reason, amount, old → new values */
  data?: Record<string, unknown>;
}
/** post('logs', LogQuery) → Result<LogPage> */
export interface LogQuery {
  q?: string; admin?: string; kind?: string; since?: number; before?: number; limit?: number;
  /** L1 · one player: the text as typed ('12', '#5'); the server resolves it with w.citizen */
  target?: string;
}

/**
 * post('locale', LocaleRequest) → Result   (L1, client/cl_main.lua)
 *   { action: 'set', locale }  switches this session's language (w_lib's own switch; the console answers 'locale')
 *   { action: 'dialog' }       closes the console and opens w_lib's settings dialog (/w_lib), which saves it for good
 */
export type LocaleRequest = { action: 'set'; locale: Lang } | { action: 'dialog' };
export interface LogPage { list: LogEntry[]; total: number; persisted: boolean }

/* ── Scripts hub (L1 + P6) ───────────────────────────────────────────────── */

export type ModuleGroup = 'economy' | 'animals' | 'world' | 'tribes' | 'player' | 'fun' | 'system';

/** Why a hub button is locked, in words the admin can act on */
export interface ModuleLock {
  /** the w_admin level it needs */
  level?: Level;
  /** the script's own permission it checks (shown as-is, e.g. 'w_stables.admin') */
  ace?: string;
  /** free text (e.g. "the script only accepts full admins") */
  text?: LocalText;
}

export interface QuickArg {
  key: string;
  /** 'citizen' = a CitizenIdInput; the server converts it (online only when the command needsOnline) */
  type: 'citizen' | 'int' | 'number' | 'text' | 'select' | 'bool';
  label: LocalText;
  help: LocalText;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  options?: { value: string; label: LocalText }[];
  default?: string | number | boolean;
}

export interface QuickCommand {
  id: string;
  label: LocalText;
  help: LocalText;
  level: Level;
  /** a destructive command: red two-press confirm */
  danger?: boolean;
  /** the target must be in the game */
  needsOnline?: boolean;
  args: QuickArg[];
  locked?: ModuleLock;
}

/**
 * post('scripts', { action: 'list' }) → Result<ModuleDescriptor[]>   (also pushed as 'modules')
 * post('scripts', { action: 'open', resource })                       → Result  (Lua closes the console first)
 * post('scripts', { action: 'run', resource, command, args })         → Result<{ output?: string }>
 * post('scripts', { action: 'start', resource })                      → Result  (area resources)
 */
export interface ModuleDescriptor {
  resource: string;
  label: LocalText;
  /** one plain line under the name */
  description: LocalText;
  /** the "؟" text: what it does and when you need it */
  help: LocalText;
  group: ModuleGroup;
  state: ResourceState | string;
  /** '' / undefined when the manifest has none */
  version?: string;
  /** present when the script has its own interface ("open its own interface") */
  panel?: {
    /** how a regular player / staff member opens it in the game (e.g. "/stables") */
    how: LocalText;
    locked?: ModuleLock;
    note?: LocalText;
  };
  commands?: QuickCommand[];
  /** present when the resource opts in with the manifest line w_settings 'yes' */
  settings?: { level: Level; groups: number; overridden?: number; locked?: ModuleLock };
  /** pinned under Scripts in the sidebar */
  pinned?: boolean;
}

/* ── Live settings of other scripts (w_lib w.settings; L1 + P6) ──────────── */

export type SettingValue = number | boolean | string | (string | number)[] | null;

export type SettingsFieldType = 'number' | 'bool' | 'enum' | 'text' | 'list' | 'table';

export interface SettingsField {
  key: string;
  type: SettingsFieldType;
  label: LocalText;
  help: LocalText;
  example?: LocalText;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  unit?: LocalText;
  /** display = stored × scale (e.g. ms shown as s) */
  scale?: number;
  options?: { value: string | number; label: LocalText; help?: LocalText }[];
  maxLength?: number;
  multiline?: boolean;
  pattern?: string;
  item?: SettingsField;
  maxItems?: number;
  requiresRestart?: boolean;
  /** a warning shown before saving this field */
  danger?: LocalText;
  /** a confirmation the admin must accept before this change applies (e.g. satchels) */
  confirm?: LocalText;
  advanced?: boolean;
  /** a calculated hint ("hunger empties in 2 h 30 min") */
  derived?: { kind: 'drainTime' | 'deathTime' | 'buffTime' | 'kg' | string; args?: Record<string, unknown> };
  /* table only */
  columns?: SettingsField[];
  families?: { id: string; label: LocalText }[];
  readOnly?: { key: string; label: LocalText }[];
}

export interface SettingsGroup {
  id: string;
  label: LocalText;
  help: LocalText;
  /** 'own' = the resource's existing store; 'central' = w_admin_settings */
  store: 'own' | 'central';
  clientVisible?: boolean;
  /** 'form' (default) or 'table' (one row per item: food, horse food, satchels) */
  type?: 'form' | 'table';
  /** the level this group needs (economy groups = 'god'); defaults to the resource's level */
  level?: Level;
  /** a confirmation for any change in this group */
  confirm?: LocalText;
  fields: SettingsField[];
}

export interface SettingsSchema {
  resource: string;
  version: number;
  title: LocalText;
  description: LocalText;
  /** Config.SettingsPerms[resource] or default */
  level?: Level;
  groups: SettingsGroup[];
  /** "open its own interface" links inside the settings page */
  links?: { id: string; label: LocalText; help: LocalText; command: string; level?: Level }[];
}

export interface SettingsOverride { by: string; at: number; base?: SettingValue }

export interface SettingsRow {
  id: string;
  label: LocalText;
  image?: string;
  family?: string;
  /** why the row cannot be edited */
  locked?: LocalText;
  cells: Record<string, SettingValue>;
  defaults: Record<string, SettingValue>;
  /** column keys that hold an override */
  overridden: string[];
}

/** post('settings', { action: 'values', resource, group }) → Result<SettingsValues> */
export interface SettingsValues {
  values: Record<string, SettingValue>;
  defaults: Record<string, SettingValue>;
  overridden: Record<string, SettingsOverride>;
  /** table groups: one row per item; a cell's key is '<group>.<row>.<col>' */
  rows?: SettingsRow[];
  /** stored keys whose field no longer exists (listed, never applied or deleted) */
  orphans?: string[];
}

/** One change of post('settings', { action: 'apply', resource, changes }) (at most 500) */
export interface SettingsChange {
  key: string;
  /** the value the admin saw (compare-and-set: a different current value → 'stale') */
  from: SettingValue;
  to?: SettingValue;
  reset?: boolean;
}

export type SettingsRejectReason = 'unknown_key' | 'out_of_range' | 'bad_type' | 'locked_row' | 'stale' | 'no_access';
export interface SettingsApplyResult {
  ok: boolean;
  applied: { key: string; value: SettingValue }[];
  rejected: { key: string; reason: SettingsRejectReason | string }[];
}

/** post('settings', { action: 'list' }) → Result<SettingsSummary[]> */
export interface SettingsSummary {
  resource: string;
  title: LocalText;
  description: LocalText;
  state: ResourceState | string;
  level: Level;
  groups: { id: string; label: LocalText; level: Level; overridden: number }[];
}

/** post('settings', { action: 'history', resource, key?, limit? }) → Result<SettingsAudit[]> */
export interface SettingsAudit {
  batch: string;
  resource: string;
  key: string;
  old: SettingValue | undefined;
  new: SettingValue | undefined;
  by: string;
  cid?: string;
  at: number;
  via: string;
}

/* ── Toasts and results ──────────────────────────────────────────────────── */

export type ToastType = 'success' | 'error' | 'inform';
export interface Toast { id: number; type: ToastType; text: string }

/** Every callback answers this. error: already translated by Lua; errorKey: the locale key it came from. */
export interface Result<T = unknown> { ok: boolean; error?: string; errorKey?: string; message?: string; data?: T }

/** The legacy tab ids (the old Shell); the new routes are PageId in app/pages.ts */
export type TabId = 'dashboard' | 'players' | 'characters' | 'map' | 'hud' | 'self' | 'bans' | 'resources';

/* ── Every message Lua sends ─────────────────────────────────────────────── */

export type LuaMessage =
  | { action: 'open'; data: OpenData }
  | { action: 'close'; data?: unknown }
  | { action: 'mode'; data: { mode: 'full' | 'quick' } }
  | { action: 'permissions'; data: PermissionsPush }
  | { action: 'locale'; data: LocaleData }
  | { action: 'players'; data: { list: AdminPlayer[] } }
  | { action: 'serverInfo'; data: ServerInfo }
  | { action: 'hudCfg'; data: { cfg: HudCfg | null } }
  | { action: 'bans'; data: { list: BanEntry[] } }
  | { action: 'catalog'; data: Catalog }
  | { action: 'mapCfg'; data: MapCfg }
  | { action: 'mapPlayers'; data: { list: MapPlayerRow[] } }
  | { action: 'mapData'; data: MapData }
  | { action: 'self'; data: SelfState }
  | { action: 'toast'; data: { type: ToastType; text: string } }
  /* L1 */
  | { action: 'modules'; data: { list: ModuleDescriptor[] } }
  | { action: 'logEntry'; data: LogEntry }
  | { action: 'blocks'; data: { list: BlockEntry[] } }
  /* 2.3.1 */
  | { action: 'access'; data: AccessData };

/** What refresh(what) may ask for (post('refresh', { what })) */
export type RefreshWhat = 'players' | 'server' | 'bans' | 'hud' | 'catalog' | 'map' | 'self' | 'modules' | 'blocks' | 'logs' | 'access';
