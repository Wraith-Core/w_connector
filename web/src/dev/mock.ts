/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · dev/mock.ts: a stand-in for Lua in the browser. Never part of the resource build.
 * Used by dev.html (vite dev server) and by `vite build --mode mock --outDir <scratch>` (screenshots).
 * It opens the console with sample data and answers every callback the way client/*.lua does,
 * including the L1 contracts (levels, citizen, characters incl. blocks, logs, scripts, settings).
 *
 *   ?lang=en            English (default Arabic)
 *   ?perms=mod|admin    a lower rank (default god: everything)
 *   ?open=0             stay closed (press O)
 *   ?mode=quick         open the quick menu
 *   ?page=<id>          land on a page (?tab=<old id> still works); ?sel=<server id>; ?cid=<citizen id>; any other param reaches route.params
 *   ?help=1|0           force help mode on or off; ?fresh=1 clears this viewer's saved preferences first
 *   ?click=css1|css2    click elements in turn (500 ms apart) after opening; 'scroll:css' scrolls it (?frac=0.5),
 *                       'type:css::text' types into an input, 'key:Escape' sends a key
 *   ?type=css::text     type into an input first
 *   ?bg=0               no backdrop (the page is transparent like in the game)
 *   ?motion=1           keep animations (they are off by default: headless screenshots freeze them)
 *   ?fail=logs,bans     those callbacks answer an error (error states); ?hang=characters never answers (loading states)
 * Keys: L switch language · O reopen · T sample toast
 * ════════════════════════════════════════════════════════════════════════════ */

import ar from '../../../locales/ar.json';
import en from '../../../locales/en.json';
import connectorContract from '../../../core/console_contract.json';
import hubModules from './modules/hub.json';
import wHud from './modules/w_hud.json';
import wStore from './modules/w_store.json';
import type {
  AdminPlayer, Area, BanEntry, BlockEntry, CharacterDetail, CharacterRow, CitizenPreview, Level, LevelsMap, LogEntry,
  LogQuery, ModuleDescriptor, SettingsApplyResult, SettingsChange, SettingsField, SettingsRow, SettingsSchema,
  SettingsSummary, SettingsValues, SettingValue,
} from '../types';

type Lang = 'ar' | 'en';
const STRINGS: Record<Lang, Record<string, string>> = { ar: ar as Record<string, string>, en: en as Record<string, string> };

const params = new URLSearchParams(location.search);
let lang: Lang = params.get('lang') === 'en' ? 'en' : 'ar';
const rankParam = params.get('perms');
const RANK: Level = rankParam === 'mod' || rankParam === 'min' ? 'mod' : rankParam === 'admin' ? 'admin' : 'god';
const SELF_ID = 1;
const L = (a: string, e: string) => (lang === 'ar' ? a : e);

if (params.get('fresh') === '1') {
  try { Object.keys(localStorage).filter((k) => k.startsWith('w_admin:')).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
}
if (params.get('help') === '1' || params.get('help') === '0') {
  try { localStorage.setItem('w_admin:helpMode', params.get('help') === '1' ? '1' : '0'); localStorage.setItem('w_admin:helpSeen', '1'); } catch { /* ignore */ }
}

const send = (action: string, data: unknown = {}) => window.postMessage({ action, data }, '*');
const localeBlock = () => ({ locale: lang, dir: lang === 'ar' ? 'rtl' : 'ltr', strings: STRINGS[lang] });
const now = () => Math.floor(Date.now() / 1000);

/* ── permissions: Config.PagePerms (+ the L1 areas) ──────────────────────── */
const LEVELS: LevelsMap = {
  players: 'mod', teleport: 'admin', revive: 'admin', needs: 'admin', job: 'admin', money: 'admin', items: 'admin',
  kick: 'mod', ban: 'admin', server: 'admin', hud: 'admin', dev: 'god', map: 'mod', bans: 'admin', resources: 'god',
  spawn: 'admin', vehicle: 'admin', entities: 'god', characters: 'admin', citizenId: 'god', charDelete: 'god',
  scripts: 'mod', scriptsRun: 'admin', scriptsConsole: 'god', settings: 'admin', settingsImport: 'god', logs: 'admin', perms: 'mod',
  news: 'admin', ranks: 'god', reports: 'mod',
};
const ORDER: Level[] = ['mod', 'admin', 'god'];
const atLeast = (need: Level) => ORDER.indexOf(RANK) >= ORDER.indexOf(need);
const perms = Object.fromEntries(Object.entries(LEVELS).map(([a, lv]) => [a, atLeast(lv as Level)])) as Record<Area, boolean>;
const ACTIONS = {
  player: { teleportTo: 'teleport', bring: 'teleport', bringBack: 'teleport', tpCoords: 'teleport', revive: 'revive', heal: 'revive', needs: 'needs', setJob: 'job', setGang: 'job', setGroup: 'job', money: 'money', giveItem: 'items', clearInventory: 'items', openInventory: 'items', kick: 'kick', ban: 'ban', freeze: 'players', spectate: 'players', notify: 'players', sitOnMount: 'players', wardrobe: 'items' },
  server: { announce: 'server', announceClear: 'server', weather: 'server', time: 'server', freezeTime: 'server', dynamicWeather: 'server', blackout: 'server', restartResource: 'resources', stopResource: 'resources', startResource: 'resources' },
  hud: { save: 'hud', setNeed: 'needs' }, bans: { unban: 'bans' }, map: { teleport: 'teleport', players: 'map', setTheme: 'server' },
  characters: { search: 'characters', get: 'characters', block: 'characters', unblock: 'characters', blocks: 'characters', reassign: 'citizenId', transfer: 'citizenId', transferStatus: 'citizenId', delete: 'charDelete', deleteStatus: 'charDelete', money: 'money', giveItem: 'items', setJob: 'job', setGang: 'job' },
  scripts: { list: 'scripts', open: 'scripts', run: 'scriptsRun', start: 'resources' },
  settings: { list: 'settings', schema: 'settings', values: 'settings', apply: 'settings', reset: 'settings', history: 'settings', export: 'settings', openPanel: 'settings', import: 'settingsImport', presets: 'settingsImport' },
  logs: { query: 'logs' },
  news: { newsList: 'news', newsSave: 'news', newsReset: 'news' },
  reports: { list: 'reports', stats: 'reports', claim: 'reports', resolve: 'reports', reopen: 'reports', message: 'reports' },
};
const COMMANDS: Record<string, Level> = { menu: 'mod', staffchat: 'mod', noclip: 'admin', announce: 'admin', warn: 'admin', bring: 'admin', bringback: 'admin', goto: 'admin', reportr: 'admin', vector3: 'god', vector4: 'god', heading: 'god' };
const PROTECTED = ['w_admin', 'w_lib', 'w_core', 'oxmysql', 'monitor', 'txAdmin', 'hardcap', 'rdr3_universal', 'sessionmanager', 'sessionmanager-rdr3', 'webpack', 'yarn'];

/* ── players ─────────────────────────────────────────────────────────────── */
const JOBS = () => [
  { name: 'unemployed', label: L('عاطل', 'Unemployed'), grades: [{ grade: 0, name: 'Drifter' }] },
  { name: 'police', label: L('الشريف', 'Sheriff'), grades: [{ grade: 0, name: 'Deputy' }, { grade: 1, name: 'Sergeant' }, { grade: 2, name: 'Sheriff' }] },
  { name: 'doctor', label: L('طبيب', 'Doctor'), grades: [{ grade: 0, name: 'Nurse' }, { grade: 1, name: 'Doctor' }] },
  { name: 'rancher', label: L('مزارع', 'Rancher'), grades: [{ grade: 0, name: 'Hand' }, { grade: 1, name: 'Foreman' }] },
  { name: 'blacksmith', label: L('حداد', 'Blacksmith'), grades: [{ grade: 0, name: 'Apprentice' }, { grade: 1, name: 'Master' }] },
];
const GANGS = [
  { name: 'none', label: 'No Gang', grades: [{ grade: 0, name: 'None' }] },
  { name: 'vanderlinde', label: 'Van der Linde', grades: [{ grade: 0, name: 'Recruit' }, { grade: 1, name: 'Member' }, { grade: 2, name: 'Lieutenant' }, { grade: 3, name: 'Leader' }] },
  { name: 'odriscoll', label: "O'Driscoll Boys", grades: [{ grade: 0, name: 'Recruit' }, { grade: 1, name: 'Member' }, { grade: 2, name: 'Leader' }] },
];

function mk(id: number, cid: string, name: string, first: string, last: string, job: number, jg: number, gang: number, gg: number, cash: number, gold: number, x: number, y: number, extra: Partial<AdminPlayer> = {}): AdminPlayer {
  const J = JOBS();
  return {
    id, name, citizenid: cid, firstname: first, lastname: last,
    job: { name: J[job].name, label: J[job].label, grade: jg, gradeName: J[job].grades[jg].name, onDuty: job !== 0 && id % 2 === 0 },
    gang: { name: GANGS[gang].name, label: GANGS[gang].label, grade: gg, gradeName: GANGS[gang].grades[gg].name },
    money: { cash, gold, bank: 5000 }, ping: 30 + ((id * 37) % 140), health: 600 - ((id * 53) % 400), maxHealth: 600, dead: false,
    stamina: 100 - ((id * 13) % 70), needs: { hunger: 100 - ((id * 17) % 90), thirst: 100 - ((id * 29) % 95) },
    coords: { x, y, z: 110 + (id % 7) * 12, heading: (id * 41) % 360 }, group: 'user', ...extra,
  };
}
const makePlayers = (): AdminPlayer[] => [
  mk(1, '1', 'Wraith', 'John', 'Marston', 1, 2, 0, 0, 12450, 32.5, -175.3, 626.8, { group: 'god', discord: '112233445566' }),
  mk(2, '5', 'أبو فهد', 'سالم', 'الحربي', 4, 1, 1, 2, 3210, 4.25, 2500.1, -1300.4),
  mk(3, '6', 'Dutch_VDL', 'Dutch', 'van der Linde', 0, 0, 1, 3, 780, 0, -1800.2, -400.7, { group: 'mod' }),
  mk(4, '7', 'ريم', 'ريم', 'العنزي', 2, 1, 0, 0, 5600, 12, 1330.6, -1290.3),
  mk(5, '8', 'Arthur', 'Arthur', 'Morgan', 3, 0, 1, 1, 145, 1.5, -300.5, 800.2, { dead: true, health: 0 }),
  mk(6, '9', 'خالد_٩٩', 'خالد', 'القحطاني', 1, 0, 0, 0, 990, 0.75, -1400.9, 2400.1, { needs: { hunger: 12, thirst: 8 } }),
  mk(7, '10', 'Sadie', 'Sadie', 'Adler', 0, 0, 2, 2, 4400, 6, 2900.8, 1300.5, { frozen: true }),
  mk(8, '11', 'محمد الشمري', 'محمد', 'الشمري', 4, 0, 0, 0, 65, 0, -200.4, -1100.2, { needs: null }),
  mk(9, '12', 'Micah', 'Micah', 'Bell', 0, 0, 2, 0, 0, 0, -2600.7, 800.3, { ping: 240 }),
  mk(10, '13', 'نورة', 'نورة', 'السبيعي', 2, 0, 0, 0, 2100, 3.1, 1200.3, 1900.9),
];
let players = makePlayers();

/* ── server ──────────────────────────────────────────────────────────────── */
const RESOURCES = ['w_lib', 'w_core', 'w_admin', 'w_hud', 'w_map', 'w_inventory', 'w_pausemenu', 'w_loading', 'oxmysql', 'monitor', 'w_banking', 'w_stables', 'w_pets', 'w_store', 'w_legal', 'w_crafting', 'w_logs', 'w_level', 'w_tribes', 'w_baloot', 'w_centralbank', 'hardcap', 'sessionmanager-rdr3', 'bp_mdt', 'redm-map-blips'];
const resState: Record<string, string> = Object.fromEntries(RESOURCES.map((r) => [r, r === 'w_banking' ? 'stopped' : 'started']));
let weather = 'SUNNY';
let time = { hour: 14, minute: 30 };
const world = { timeFrozen: false, dynamicWeather: true, blackout: false };
const startedAt = Date.now() - 3600 * 1000 * 29.4;

let bans: BanEntry[] = [
  { id: 13, name: 'سعود', license: 'license:8be1c0d2f3a4b5c6d7e8', reason: 'إساءة للإدارة', expire: now() + 86400 * 2, bannedby: 'أبو فهد', created: null },
  { id: 12, name: 'Cheater_01', license: 'license:3f9a2c1d7e4b58a0aa11', reason: 'Aimbot', expire: 2147483647, bannedby: 'Wraith', created: null },
  { id: 9, name: 'Toxic', license: 'license:11aa22bb33cc44dd5566', reason: 'Racism in chat', expire: now() - 3600, bannedby: 'Wraith', created: null },
];

const hudCfg = {
  name: 'Wraith Studio', logo: { url: '', width: 30, height: 0 }, identity: { x: 98.2, y: 2, scale: 1, opacity: 1 },
  needs: { hungerRate: 1, thirstRate: 1.4, interval: 90 },
  damage: { enabled: true, hungerAt: 15, thirstAt: 15, amount: 2, interval: 20, canKill: true },
  features: { health: true, stamina: true, hunger: true, thirst: true, voice: true, horse: true, buffs: true, ammo: true, money: true, identity: true, compass: true, location: true, playerImages: false, playerPanel: true },
};

const selfState = { spectating: 0, canGoBack: true, noclipSpeed: 1, boost: false, stamina: true, laser: false, spawnedCount: 2, noclip: false, invisible: true, godmode: false, names: false, showCoords: false, hashes: false, coords: { x: -175.3, y: 626.8, z: 113.2, heading: 92.4 } };

const catalog = () => ({
  jobs: JOBS(), gangs: GANGS,
  items: ['bread', 'water', 'whiskey', 'bandage', 'lockpick', 'revolver_ammo', 'apple', 'coffee', 'rope', 'lantern', 'gold_nugget', 'medkit', 'tobacco', 'canned_beans', 'horse_brush']
    .map((n) => ({ name: n, label: n.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) })),
  weathers: ['SUNNY', 'CLOUDS', 'OVERCAST', 'FOG', 'RAIN', 'THUNDERSTORM', 'SNOW', 'BLIZZARD', 'SANDSTORM'],
  horses: [{ model: 'A_C_Horse_Arabian_White', label: 'Arabian (White)' }, { model: 'A_C_Horse_Turkoman_Gold', label: 'Turkoman (Gold)' }],
  wagons: [{ model: 'wagon02x', label: 'Supply wagon' }, { model: 'coach3', label: 'Stagecoach' }],
  animals: [{ model: 'a_c_wolf', label: L('ذئب', 'Wolf') }, { model: 'a_c_deer_01', label: L('غزال', 'Deer') }],
  peds: [{ model: 'a_m_m_valtownfolk_01', label: 'a_m_m_valtownfolk_01' }],
  groups: ['user', 'mod', 'admin', 'god'],
});

const serverInfo = () => ({
  uptime: Math.floor((Date.now() - startedAt) / 1000), playersOnline: players.length, maxPlayers: 64, version: 'WraithCore 1.4.2',
  weather, time, world: { ...world }, bansCount: bans.filter((b) => !b.expire || b.expire > now()).length, blocksCount: blocks.length,
  resources: RESOURCES.map((name) => ({ name, state: resState[name], version: name.startsWith('w_') ? '1.0.0' : undefined })),
});

declare const __DEV_MAP_TILES__: string;
const mapCfg = () => ({
  tilesBase: import.meta.env.DEV ? __DEV_MAP_TILES__ : `${location.origin}/tiles`, theme: params.get('maptheme') || 'dark', projection: {}, tiles: { size: 512, minZoom: 2, maxZoom: 7 },
  themes: [{ id: 'dark', label: { ar: 'داكن', en: 'Dark' } }, { id: 'light', label: { ar: 'فاتح', en: 'Light' } }, { id: 'paper', label: { ar: 'ورق قديم', en: 'Old paper' } }],
});
const mapData = () => ({
  places: [{ id: 'bank', name: 'Valentine Bank', x: -308, y: 775 }, { id: 'stable', name: 'Valentine Stables', x: -365, y: 787 }, { id: 'doctor', name: 'Saint Denis Doctor', x: 2725, y: -1231 }],
  labels: [{ key: 'valentine', en: 'Valentine', ar: 'فالنتاين', x: -308, y: 775, h: 45 }, { key: 'saint-denis', en: 'Saint Denis', ar: 'سان دوني', x: 2650, y: -1210, h: 48 }],
  markers: [], waypoint: null,
});
const mapPlayers = () => ({ list: players.map((p) => ({ id: p.id, name: p.name, citizenid: p.citizenid, x: p.coords.x, y: p.coords.y, z: p.coords.z, job: p.job.label, dead: p.dead })) });

/* ── characters (sv_characters.lua shapes) ───────────────────────────────── */
const chars: CharacterRow[] = [
  { citizenid: '1', name: 'John Marston', account: 'Wraith', license: 'license:aa11bb22cc33dd44ee55', slot: 1, lastSeen: '2026-09-25 04:12', job: L('الشريف', 'Sheriff'), online: 1 },
  { citizenid: '2', name: 'Abigail Roberts', account: 'Wraith', license: 'license:aa11bb22cc33dd44ee55', slot: 2, lastSeen: '2026-09-21 22:40', job: L('عاطل', 'Unemployed'), online: null },
  { citizenid: '5', name: 'سالم الحربي', account: 'أبو فهد', license: 'license:77ffee0011223344aabb', slot: 1, lastSeen: '2026-09-25 03:58', job: L('حداد', 'Blacksmith'), online: 2 },
  { citizenid: '6', name: 'Dutch van der Linde', account: 'Dutch_VDL', license: 'license:99cc88bb77aa66551234', slot: 1, lastSeen: '2026-09-25 04:01', job: L('عاطل', 'Unemployed'), online: 3 },
  { citizenid: '14', name: 'فهد العتيبي', account: 'fahad', license: 'license:1234abcd5678efab9012', slot: 1, lastSeen: '2026-09-18 19:02', job: L('مزارع', 'Rancher'), online: null, blocked: 'تحقيق في غش' },
  { citizenid: '21', name: 'Javier Escuella', account: 'javi', license: 'license:5566778899aabbccdd00', slot: 1, lastSeen: '2026-09-22 16:10', job: L('عاطل', 'Unemployed'), online: null, blocked: 'Duping money' },
  { citizenid: '777', name: 'Hosea Matthews', account: 'hosea', license: 'license:0f0f0f0f0f0f0f0f0f0f', slot: 1, lastSeen: '2026-09-10 11:30', job: L('طبيب', 'Doctor'), online: null },
  { citizenid: 'OMG95204', name: 'Old Timer', account: 'legacy', license: 'license:abababababababababab', slot: 2, lastSeen: '2026-08-30 08:00', job: L('عاطل', 'Unemployed'), online: null },
];
let blocks: BlockEntry[] = chars.filter((c) => c.blocked).map((c, i) => ({
  citizenid: c.citizenid, name: c.name, reason: typeof c.blocked === 'string' ? c.blocked : '', blocked_by: 'Wraith', blocked_at: now() - 3600 * (5 + i * 30), online: c.online,
}));
function charDetail(cid: string): CharacterDetail | null {
  const r = chars.find((c) => c.citizenid === String(cid).toUpperCase() || c.citizenid === String(cid));
  if (!r) return null;
  const b = blocks.find((x) => x.citizenid === r.citizenid);
  return {
    ...r, gang: 'Van der Linde',
    block: b ? { reason: b.reason, blocked_by: b.blocked_by, blocked_at: b.blocked_at } : null,
    dependencies: [
      { table: 'players', column: 'citizenid', kind: 'core', rows: 1 },
      { table: 'playerskins', column: 'citizenid', kind: 'data', rows: 1 },
      { table: 'w_inventory_stash', column: 'owner', kind: 'data', rows: 3 },
      { table: 'w_stables_horses', column: 'citizenid', kind: 'asset', rows: 2 },
      { table: 'w_housing', column: 'owner', kind: 'asset', rows: 1 },
      { table: 'cb_ledger', column: 'actor', kind: 'history', rows: 58 },
    ],
    money: [{ id: `cash:${cid}`, balance: 1250.5, currency: 'USD' }, { id: `gold:${cid}`, balance: 3.25, currency: 'GOLD' }],
    siblings: chars.filter((c) => c.license === r.license && c.citizenid !== r.citizenid).map((c) => ({ citizenid: c.citizenid, name: c.name })),
  };
}

/* ── citizen id preview (w.citizen.resolve) ──────────────────────────────── */
function resolveCitizen(input: string): { ok: boolean; data?: CitizenPreview; error?: string; errorKey?: string } {
  const s = String(input ?? '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).trim();
  const bad = (k: 'invalid_id' | 'not_found') => ({ ok: false, errorKey: `citizen.${k}`, error: k === 'invalid_id' ? L('رقم المواطن غير صحيح', 'Invalid citizen ID') : L('لا يوجد لاعب بهذا الرقم', 'No player with this ID') });
  const server = /^#\s*(\d{1,5})$/.exec(s);
  if (server) {
    const p = players.find((x) => x.id === Number(server[1]));
    return p ? { ok: true, data: { citizenid: p.citizenid, name: `${p.firstname} ${p.lastname}`, online: true, source: p.id } } : bad('not_found');
  }
  let id: string | null = null;
  if (/^\d{1,9}$/.test(s)) id = s.replace(/^0+/, '') || null;
  else if (/^[A-Za-z]{3}\d{5}$/.test(s)) id = s.toUpperCase();
  if (!id) return bad('invalid_id');
  const p = players.find((x) => x.citizenid === id);
  if (p) return { ok: true, data: { citizenid: id, name: `${p.firstname} ${p.lastname}`, online: true, source: p.id } };
  const c = chars.find((x) => x.citizenid === id);
  return c ? { ok: true, data: { citizenid: id, name: c.name, online: false } } : bad('not_found');
}

/* ── admin log (ring buffer) ─────────────────────────────────────────────── */
let logSeq = 0;
const logs: LogEntry[] = [];
function addLog(kind: string, action: string, text: string, target?: LogEntry['target'], data?: Record<string, unknown>, at = now()): LogEntry {
  const e: LogEntry = { id: ++logSeq, at, admin: { name: 'Wraith', citizenid: '1', source: SELF_ID }, kind, action, target, text, ok: true, data };
  logs.unshift(e);
  if (logs.length > 500) logs.pop();
  return e;
}
(() => {
  const t0 = now();
  const rows: [string, string, string, LogEntry['target']?, Record<string, unknown>?][] = [
    ['player', 'revive', 'Wraith revived Arthur Morgan (8)', { citizenid: '8', name: 'Arthur Morgan', source: 5 }],
    ['player', 'bring', 'Wraith brought سالم الحربي (5)', { citizenid: '5', name: 'سالم الحربي', source: 2 }],
    ['settings', 'apply', 'Wraith changed w_hud needs.hungerRate 1 → 1.2', undefined, { resource: 'w_hud', key: 'needs.hungerRate', old: 1, new: 1.2 }],
    ['characters', 'block', 'Wraith blocked Javier Escuella (21): Duping money', { citizenid: '21', name: 'Javier Escuella' }, { reason: 'Duping money' }],
    ['player', 'kick', 'Wraith kicked Micah Bell (12): spawn killing', { citizenid: '12', name: 'Micah Bell', source: 9 }, { reason: 'spawn killing' }],
    ['server', 'weather', 'Wraith set the weather to RAIN'],
    ['player', 'money', 'Wraith gave $500 cash to ريم العنزي (7)', { citizenid: '7', name: 'ريم العنزي', source: 4 }, { type: 'cash', op: 'add', amount: 500 }],
    ['bans', 'unban', 'Wraith lifted the ban of Toxic'],
    ['scripts', 'open', 'Wraith opened the w_stables panel', undefined, { resource: 'w_stables' }],
    ['player', 'setJob', 'Wraith set نورة السبيعي (13) job to doctor 0', { citizenid: '13', name: 'نورة السبيعي', source: 10 }],
    ['server', 'announce', 'Wraith announced: Server restart at 06:00'],
    ['characters', 'reassign', 'Wraith gave character 23 the citizen id 777', { citizenid: '777', name: 'Hosea Matthews' }],
  ];
  /* oldest first, so the ids grow with time as in the server's ring buffer */
  rows.map((r, i) => [r, i] as const).reverse().forEach(([r, i]) => addLog(r[0], r[1], r[2], r[3], r[4], t0 - 60 * (7 + i * 23)));
})();

/* ── scripts hub + live settings ─────────────────────────────────────────── */
const SCHEMAS: Record<string, SettingsSchema> = { w_hud: wHud as SettingsSchema, w_store: wStore as SettingsSchema };
/* a script's own lock ("full admins only") is the server's probe of THIS viewer: an admin or god passes it */
const passes = (lock: { level?: Level } | undefined): boolean => !!lock?.level && ORDER.indexOf(RANK) >= ORDER.indexOf(lock.level);
const modules = (): ModuleDescriptor[] => (hubModules as ModuleDescriptor[]).map((m) => ({
  ...m,
  state: resState[m.resource] ?? m.state,
  ...(m.panel && passes(m.panel.locked as { level?: Level } | undefined) ? { panel: { ...m.panel, locked: undefined } } : {}),
}));

const FOOD_ROWS: { id: string; ar: string; en: string; family: string; kind: string; cells: Record<string, SettingValue>; locked?: { ar: string; en: string } }[] = [
  { id: 'consumable_bread_roll', ar: 'خبز', en: 'Bread roll', family: 'bread', kind: 'food', cells: { hunger: 25, thirst: -5, stamina: 10, outerStamina: 0, innerHealth: 5, outerHealth: 0, buffType: 'none', buffAmount: 0, poison: 0, curesPoison: false, heal: false } },
  { id: 'consumable_apple', ar: 'تفاحة', en: 'Apple', family: 'fruit', kind: 'food', cells: { hunger: 20, thirst: 15, stamina: 15, outerStamina: 0, innerHealth: 10, outerHealth: 0, buffType: 'vegan', buffAmount: 25, poison: 0, curesPoison: false, heal: false } },
  { id: 'consumable_carrot', ar: 'جزرة', en: 'Carrot', family: 'fruit', kind: 'food', cells: { hunger: 20, thirst: 15, stamina: 15, outerStamina: 0, innerHealth: 10, outerHealth: 0, buffType: 'vegan', buffAmount: 25, poison: 0, curesPoison: false, heal: false } },
  { id: 'consumable_meat_cooked', ar: 'لحم مطبوخ', en: 'Cooked meat', family: 'meat', kind: 'food', cells: { hunger: 55, thirst: -5, stamina: 20, outerStamina: 0, innerHealth: 30, outerHealth: 30, buffType: 'vigor', buffAmount: 40, poison: 0, curesPoison: false, heal: false } },
  { id: 'consumable_jerky', ar: 'لحم مجفف', en: 'Jerky', family: 'meat', kind: 'food', cells: { hunger: 30, thirst: -10, stamina: 10, outerStamina: 0, innerHealth: 10, outerHealth: 0, buffType: 'none', buffAmount: 0, poison: 0, curesPoison: false, heal: false } },
  { id: 'consumable_beans', ar: 'فاصوليا معلّبة', en: 'Canned beans', family: 'canned', kind: 'food', cells: { hunger: 40, thirst: -5, stamina: 15, outerStamina: 0, innerHealth: 15, outerHealth: 0, buffType: 'none', buffAmount: 0, poison: 0, curesPoison: false, heal: false } },
  { id: 'consumable_water', ar: 'ماء', en: 'Water', family: 'drinks', kind: 'drink', cells: { hunger: 0, thirst: 40, stamina: 5, outerStamina: 0, innerHealth: 0, outerHealth: 0, buffType: 'vegan', buffAmount: 10, poison: 0, curesPoison: false, heal: false } },
  { id: 'consumable_coffee', ar: 'قهوة', en: 'Coffee', family: 'drinks', kind: 'drink', cells: { hunger: 0, thirst: 15, stamina: 20, outerStamina: 25, innerHealth: 0, outerHealth: 0, buffType: 'energy', buffAmount: 30, poison: 0, curesPoison: false, heal: false } },
  { id: 'consumable_saloon_beer', ar: 'بيرة الصالون', en: 'Saloon beer', family: 'alcohol', kind: 'alcohol', cells: { hunger: 5, thirst: 20, stamina: 10, outerStamina: 0, innerHealth: -5, outerHealth: 0, buffType: 'none', buffAmount: 0, poison: 0, curesPoison: false, heal: false } },
  { id: 'consumable_tonic', ar: 'منشّط', en: 'Tonic', family: 'tonic', kind: 'medicine', cells: { hunger: 0, thirst: 0, stamina: 60, outerStamina: 50, innerHealth: 0, outerHealth: 0, buffType: 'energy', buffAmount: 50, poison: 0, curesPoison: false, heal: false } },
  { id: 'consumable_antidote', ar: 'ترياق', en: 'Antidote', family: 'medicine', kind: 'medicine', cells: { hunger: 0, thirst: 0, stamina: 0, outerStamina: 0, innerHealth: 40, outerHealth: 60, buffType: 'health', buffAmount: 30, poison: 0, curesPoison: true, heal: false } },
  { id: 'consumable_bandage', ar: 'ضمادة', en: 'Bandage', family: 'medicine', kind: 'medicine', cells: { hunger: 0, thirst: 0, stamina: 0, outerStamina: 0, innerHealth: 10, outerHealth: 120, buffType: 'health', buffAmount: 20, poison: 0, curesPoison: false, heal: true } },
  { id: 'cigarette_pack', ar: 'علبة سجائر', en: 'Cigarette pack', family: 'tonic', kind: 'pack', cells: { hunger: 0, thirst: 0, stamina: 0, outerStamina: 0, innerHealth: -5, outerHealth: 0, buffType: 'none', buffAmount: 0, poison: 0, curesPoison: false, heal: false }, locked: { ar: 'علبة: تطلع 20 سيجارة', en: 'A pack: it gives 20 cigarettes' } },
];
const SATCHEL_ROWS = [
  { id: 'satchel_small', ar: 'حقيبة صغيرة', en: 'Small satchel', bonus: 10 },
  { id: 'satchel_medium', ar: 'حقيبة متوسطة', en: 'Medium satchel', bonus: 20 },
  { id: 'satchel_large', ar: 'حقيبة كبيرة', en: 'Large satchel', bonus: 35 },
  { id: 'satchel_legend', ar: 'حقيبة الأسطورة', en: 'Legend satchel', bonus: 60 },
];
const DEFAULTS: Record<string, SettingValue> = {
  'needs.hungerRate': 1, 'needs.thirstRate': 1.4, 'needs.interval': 90,
  'damage.enabled': true, 'damage.hungerAt': 15, 'damage.thirstAt': 15, 'damage.amount': 2, 'damage.interval': 20, 'damage.canKill': true,
  'features.health': true, 'features.stamina': true, 'features.hunger': true, 'features.thirst': true, 'features.voice': true, 'features.compass': true,
  name: 'Wraith Studio', 'logo.url': '',
  'buffs.health.amount': 10, 'buffs.vegan.amount': 2, 'buffs.energy.amount': 5, 'buffs.vigor.amount': 3, 'buffs.tick': 2000,
  'poison.enabled': true, 'poison.damage': 12, 'poison.minHealth': 60, 'gold.duration': 30,
  'Money.govSellMarkup': 20, 'Money.govBuyDiscount': 40, 'Law.fine': 150, 'Law.officerShare': 30,
};
for (const r of FOOD_ROWS) for (const [c, v] of Object.entries(r.cells)) DEFAULTS[`food.${r.id}.${c}`] = v;
for (const r of SATCHEL_ROWS) DEFAULTS[`satchels.${r.id}.bonus`] = r.bonus;
const current: Record<string, SettingValue> = { ...DEFAULTS, 'needs.hungerRate': 1.2, 'damage.interval': 25, 'food.consumable_apple.hunger': 30 };
const overridden: Record<string, { by: string; at: number; base?: SettingValue }> = {
  'needs.hungerRate': { by: 'Wraith', at: now() - 3600 * 3, base: 1 },
  'damage.interval': { by: 'Dutch_VDL', at: now() - 86400, base: 20 },
  'food.consumable_apple.hunger': { by: 'Wraith', at: now() - 7200, base: 20 },
};
const resourceOfKey = (res: string, key: string) => SCHEMAS[res]?.groups.some((g) => key === g.id || key.startsWith(`${g.id}.`) || g.fields.some((f) => f.key === key));

function valuesOf(res: string, group: string): SettingsValues | null {
  const schema = SCHEMAS[res];
  const g = schema?.groups.find((x) => x.id === group);
  if (!g) return null;
  const values: Record<string, SettingValue> = {};
  const defaults: Record<string, SettingValue> = {};
  const ov: SettingsValues['overridden'] = {};
  for (const f of g.fields) {
    if (f.type === 'table') continue;
    values[f.key] = current[f.key] ?? null;
    defaults[f.key] = DEFAULTS[f.key] ?? null;
    if (overridden[f.key]) ov[f.key] = overridden[f.key];
  }
  let rows: SettingsRow[] | undefined;
  if (group === 'food' || group === 'satchels') {
    const table = g.fields.find((f) => f.type === 'table') as SettingsField;
    const cols = (table.columns ?? []).map((c) => c.key);
    const src = group === 'food'
      ? FOOD_ROWS.map((r) => ({ id: r.id, label: { ar: r.ar, en: r.en }, family: r.family, locked: r.locked, image: `nui://w_inventory/web/images/${r.id}.png` }))
      : SATCHEL_ROWS.map((r) => ({ id: r.id, label: { ar: r.ar, en: r.en }, family: undefined, locked: undefined, image: undefined }));
    rows = src.map((r) => {
      const cells: Record<string, SettingValue> = {};
      const defs: Record<string, SettingValue> = {};
      const over: string[] = [];
      for (const c of cols) {
        const k = `${group}.${r.id}.${c}`;
        cells[c] = current[k] ?? null;
        defs[c] = DEFAULTS[k] ?? null;
        if (overridden[k]) { over.push(c); ov[k] = overridden[k]; }
      }
      return { id: r.id, label: r.label, image: r.image, family: r.family, locked: r.locked, cells, defaults: defs, overridden: over };
    });
  }
  return { values, defaults, overridden: ov, rows, orphans: group === 'food' ? ['food.consumable_old_stew.hunger'] : [] };
}

function applySettings(res: string, changes: SettingsChange[]): SettingsApplyResult {
  const rejected: SettingsApplyResult['rejected'] = [];
  const schema = SCHEMAS[res];
  if (!schema) return { ok: false, applied: [], rejected: changes.map((c) => ({ key: c.key, reason: 'unknown_key' })) };
  for (const c of changes) {
    if (!(c.key in DEFAULTS) || !resourceOfKey(res, c.key)) { rejected.push({ key: c.key, reason: 'unknown_key' }); continue; }
    if (JSON.stringify(current[c.key]) !== JSON.stringify(c.from)) { rejected.push({ key: c.key, reason: 'stale' }); continue; }
    const g = schema.groups.find((x) => c.key.startsWith(`${x.id}.`) || x.fields.some((f) => f.key === c.key));
    if (g?.level && !atLeast(g.level)) { rejected.push({ key: c.key, reason: 'no_access' }); continue; }
  }
  if (rejected.length) return { ok: false, applied: [], rejected };
  const applied: SettingsApplyResult['applied'] = [];
  for (const c of changes) {
    const v = c.reset ? DEFAULTS[c.key] : (c.to ?? null);
    const old = current[c.key];
    current[c.key] = v;
    if (c.reset || JSON.stringify(v) === JSON.stringify(DEFAULTS[c.key])) delete overridden[c.key];
    else overridden[c.key] = { by: 'Wraith', at: now(), base: DEFAULTS[c.key] };
    applied.push({ key: c.key, value: v });
    const e = addLog('settings', 'apply', `Wraith changed ${res} ${c.key} ${JSON.stringify(old)} → ${JSON.stringify(v)}`, undefined, { resource: res, key: c.key, old, new: v });
    send('logEntry', e);
  }
  return { ok: true, applied, rejected: [] };
}

const summaries = (): SettingsSummary[] => Object.values(SCHEMAS).map((s) => ({
  resource: s.resource, title: s.title, description: s.description, state: resState[s.resource] ?? 'started', level: s.level ?? 'admin',
  groups: s.groups.map((g) => ({ id: g.id, label: g.label, level: g.level ?? s.level ?? 'admin', overridden: Object.keys(overridden).filter((k) => k.startsWith(`${g.id}.`)).length })),
}));

/* ── the pause menu's news (server/sv_news.lua over w_pausemenu's board) ─────
   ?pm=0 w_pausemenu is stopped (err_news_missing) · ?news=0 no news · ?news=12 a full list */
type MockNews = { id: string; title: Record<string, string>; text?: Record<string, string>; date?: Record<string, string>; image?: string };
const NEWS_SEED: MockNews[] = [
  { id: 'saloon', image: 'news/saloon.webp', title: { ar: 'ليلة الصالون', en: 'Saloon Night' },
    text: { ar: 'بيانو وورق لعب وسباق خيول على ضفّة النهر. الدعوة عامّة، والسلاح يبقى عند الباب.', en: 'A piano, a deck of cards and a horse race down by the river. All are welcome; guns stay at the door.' },
    date: { ar: 'كلّ سبت · 9 مساءً', en: 'Saturdays · 9 PM' } },
  { id: 'wagons', image: 'news/wagons.webp', title: { ar: 'سوق العربات', en: 'The Wagon Fair' },
    text: { ar: 'عرباتٌ وسروج وعُدّة جرّ في الإسطبلات. أحضِر عربتك القديمة وخُذ ثمنها.', en: 'Wagons, buggies and harness at the stables. Bring your old wagon and trade it in.' },
    date: { ar: 'هذا الأسبوع', en: 'This week' } },
  { id: 'frontier', image: 'news/frontier.webp', title: { ar: 'أهلًا بك في الحدود', en: 'Welcome to the Frontier' },
    text: { ar: 'اقرأ القوانين، وابحث عن عملٍ في البلدة، وأبقِ مسدّسك في غمده بين البيوت.', en: 'Read the rules, find work in town, and keep your gun holstered between the houses.' } },
];
const newsCount = Number(params.get('news') ?? NaN);
let news: MockNews[] = Number.isFinite(newsCount)
  ? Array.from({ length: Math.min(12, Math.max(0, newsCount)) }, (_, i) => ({ ...NEWS_SEED[i % 3], id: `n${i + 1}` }))
  : NEWS_SEED.map((n) => ({ ...n }));
let newsRev = 1;
const newsState = () => ({
  list: news, rev: `r${newsRev}`, plates: ['news/saloon.webp', 'news/wagons.webp', 'news/frontier.webp'],
  limits: { title: 80, text: 400, date: 60, image: 300, id: 40, items: 12 }, resource: 'w_pausemenu',
});
const utf8 = (s: string) => new TextEncoder().encode(s).length;
const newsFail = (key: string, data?: unknown) => ({ ok: false, error: STRINGS[lang][key] ?? key, errorKey: key, data });
function newsCallback(data: Record<string, unknown>): unknown {
  if (params.get('pm') === '0') return newsFail('err_news_missing');
  if (data.action === 'newsList') return ok(undefined, newsState());
  if (data.rev !== `r${newsRev}`) return newsFail('err_news_changed', newsState());
  if (data.action === 'newsReset') {
    news = NEWS_SEED.map((n) => ({ ...n }));
    newsRev += 1;
    send('logEntry', addLog('news', 'newsReset', `news reset to the default list (${news.length} items)`, undefined, { count: news.length }));
    return ok(STRINGS[lang].toast_news_reset, newsState());
  }
  const list = Array.isArray(data.list) ? (data.list as MockNews[]) : null;
  if (!list) return newsFail('err_invalid_value');
  if (list.length > 12) return newsFail('err_news_full');
  const before = news;
  const next: MockNews[] = [];
  for (let i = 0; i < list.length; i++) {
    const n = list[i];
    if (!n.title || !Object.values(n.title).some(Boolean)) return newsFail('err_news_title', { index: i + 1, field: 'title' });
    for (const [f, max] of [['title', 80], ['text', 400], ['date', 60]] as const) {
      if (Object.values(n[f] ?? {}).some((s) => utf8(String(s)) > max)) return newsFail('err_news_too_long', { index: i + 1, field: f });
    }
    next.push({ ...n, id: n.id ?? `n${Date.now()}${i}` });
  }
  news = next;
  newsRev += 1;
  const titleOf = (n: MockNews) => n.title.ar ?? n.title.en ?? n.id;
  for (const n of news) if (!before.some((b) => b.id === n.id)) send('logEntry', addLog('news', 'newsAdd', `news added: ${titleOf(n)}`, undefined, { title: titleOf(n), id: n.id }));
  for (const b of before) if (!news.some((n) => n.id === b.id)) send('logEntry', addLog('news', 'newsRemove', `news removed: ${titleOf(b)}`, undefined, { title: titleOf(b), id: b.id }));
  return ok(STRINGS[lang].toast_news_saved, newsState());
}

/* ── ranks (w_core ranks over server/sv_ranks.lua): every answer is the whole state ──
   the real server sends levels.ranks = 'master'; the mock keeps 'god' so ?perms=admin hides the page */
interface MockRank { name: string; label: string; color: string; sort: number; protected: boolean; permissions: string[] }
interface MockMember { identifier: string; name: string; ranks: string[]; locked: string[] }
const RANK_CATALOG = [
  { id: 'core', label: { ar: 'صلاحيات عامة', en: 'General' }, nodes: [
    { node: 'admin', label: { ar: 'كل صلاحيات السكربتات', en: 'Every script permission' }, desc: { ar: 'يمرّ من فحص الصلاحية في كل سكربت.', en: 'Passes the permission check of every script.' }, danger: true },
    { node: 'command', label: { ar: 'كل الأوامر', en: 'Every command' }, desc: { ar: 'يقدر يستخدم أي أمر في السيرفر.', en: 'May use any command on the server.' }, danger: true },
  ] },
  { id: 'panel', label: { ar: 'لوحة الإدارة', en: 'Admin panel' }, nodes: [
    { node: 'w_admin.open', label: { ar: 'فتح اللوحة', en: 'Open the panel' }, desc: { ar: 'يفتح لوحة الإدارة بأمر /admin.', en: 'Opens the admin panel with /admin.' }, danger: false },
    { node: 'w_admin.kick', label: { ar: 'الطرد', en: 'Kick' }, desc: { ar: 'يطرد لاعبًا مع سبب.', en: 'Kicks a player with a reason.' }, danger: false },
    { node: 'w_admin.ban', label: { ar: 'الحظر', en: 'Ban' }, desc: { ar: 'يحظر لاعبًا لمدة أو للأبد.', en: 'Bans a player for a while or for good.' }, danger: false },
    { node: 'w_admin.money', label: { ar: 'المال', en: 'Money' }, desc: { ar: 'يعطي النقد والذهب أو يسحبه.', en: 'Gives or takes cash and gold.' }, danger: false },
  ] },
  { id: 'groups', label: { ar: 'المجموعات', en: 'Groups' }, nodes: [
    { node: 'group.mod', label: { ar: 'مجموعة المشرفين', en: 'Moderators group' }, desc: { ar: 'ينضم لمجموعة mod.', en: 'Joins the mod group.' }, danger: false },
    { node: 'group.admin', label: { ar: 'مجموعة الإداريين', en: 'Admins group' }, desc: { ar: 'ينضم لمجموعة admin.', en: 'Joins the admin group.' }, danger: false },
  ] },
];
let mockRanks: MockRank[] = [
  { name: 'master', label: 'Master', color: '#c0392b', sort: 999, protected: true, permissions: ['*'] },
  { name: 'admin', label: L('إداري', 'Admin'), color: '#d4a017', sort: 50, protected: false, permissions: ['w_admin.open', 'w_admin.kick', 'w_admin.ban', 'w_admin.money', 'group.admin'] },
  { name: 'mod', label: L('مشرف', 'Moderator'), color: '#2980b9', sort: 20, protected: false, permissions: ['w_admin.open', 'w_admin.kick', 'group.mod', 'w_stables.view'] },
];
let mockMembers: MockMember[] = [
  { identifier: 'license:aa11bb22cc33dd44ee55ff6600112233', name: 'Wraith', ranks: ['master'], locked: ['master'] },
  { identifier: 'license:3f9a2c1d7e4b58a0aa11', name: 'Dutch_VDL', ranks: ['mod'], locked: [] },
  { identifier: 'steam:110000112345678', name: 'Hosea', ranks: ['admin', 'mod'], locked: [] },
];
const licenseOf = (p: AdminPlayer) => (p.id === SELF_ID ? mockMembers[0].identifier : p.id === 3 ? mockMembers[1].identifier : `license:${p.citizenid}0${p.id}abcdef0123456789`);
const ranksState = () => {
  const memberOnline = (m: MockMember) => players.find((p) => licenseOf(p) === m.identifier)?.id ?? false;
  return {
    ranks: [...mockRanks].sort((a, b) => b.sort - a.sort).map((r) => ({ ...r, members: mockMembers.filter((m) => m.ranks.includes(r.name)).length })),
    members: mockMembers.filter((m) => m.ranks.length > 0).map((m) => ({ ...m, online: memberOnline(m) })),
    catalog: RANK_CATALOG,
    online: players.map((p) => ({ id: p.id, name: p.name, citizenid: p.citizenid, identifier: licenseOf(p), ranks: mockMembers.find((m) => m.identifier === licenseOf(p))?.ranks ?? [] })),
  };
};
function ranksCallback(data: Record<string, unknown>): unknown {
  const a = String(data.action);
  const bad = (key: string) => fail(STRINGS[lang][key] ?? key, key);
  const saved = () => ok(STRINGS[lang].toast_ranks_saved, ranksState());
  if (a === 'state') return ok(undefined, ranksState());
  if (a === 'save') {
    const r = (data.rank ?? {}) as Partial<MockRank>;
    const name = String(r.name ?? '');
    if (!/^[a-z][a-z0-9_]*$/.test(name) || name.length < 2 || name.length > 32) return bad('err_rank_name');
    if (mockRanks.find((x) => x.name === name)?.protected) return bad('err_rank_protected');
    const label = String(r.label ?? '').trim();
    if (!label || label.length > 64) return bad('err_rank_label');
    const perms = Array.isArray(r.permissions) ? r.permissions.map(String) : [];
    if (perms.length > 200) return bad('err_rank_too_many');
    if (perms.some((x) => !/^[A-Za-z0-9_.-]+$/.test(x) || x.length > 64 || /^wranks?\./i.test(x))) return bad('err_rank_node');
    const color = /^#[0-9a-f]{6}$/i.test(String(r.color)) ? String(r.color) : '#888888';
    const row: MockRank = { name, label, color, sort: Math.max(0, Math.min(999, Math.round(Number(r.sort) || 0))), protected: false, permissions: perms };
    mockRanks = [...mockRanks.filter((x) => x.name !== name), row];
    send('logEntry', addLog('ranks', 'rankSave', `Wraith saved the rank ${name}`, undefined, { rank: name }));
    return saved();
  }
  if (a === 'delete') {
    const name = String(data.name ?? '');
    const r = mockRanks.find((x) => x.name === name);
    if (!r) return bad('err_rank_unknown');
    if (r.protected) return bad('err_rank_protected');
    mockRanks = mockRanks.filter((x) => x.name !== name);
    mockMembers = mockMembers.map((m) => ({ ...m, ranks: m.ranks.filter((x) => x !== name) }));
    send('logEntry', addLog('ranks', 'rankDelete', `Wraith deleted the rank ${name}`, undefined, { rank: name }));
    return saved();
  }
  if (a === 'assign') {
    const rank = String(data.rank ?? '');
    if (!mockRanks.some((x) => x.name === rank)) return bad('err_rank_unknown');
    const target = (data.target ?? {}) as { source?: number; identifier?: string; name?: string };
    let identifier = '';
    let name = '';
    if (typeof target.source === 'number') {
      const p = find(target.source);
      if (!p) return fail(L('اللاعب غير متصل الآن', 'The player is not online right now'), 'not_online');
      identifier = licenseOf(p);
      name = p.name;
    } else {
      identifier = String(target.identifier ?? '');
      if (!/^(license2?|steam):[A-Za-z0-9]+$/.test(identifier)) return bad('err_rank_identifier');
      name = String(target.name ?? '') || identifier;
    }
    const m = mockMembers.find((x) => x.identifier === identifier);
    if (m) { if (!m.ranks.includes(rank)) m.ranks = [...m.ranks, rank]; } else mockMembers.push({ identifier, name, ranks: [rank], locked: [] });
    send('logEntry', addLog('ranks', 'rankAssign', `Wraith gave ${name} the rank ${rank}`, undefined, { rank, identifier }));
    return saved();
  }
  if (a === 'revoke') {
    const rank = String(data.rank ?? '');
    const m = mockMembers.find((x) => x.identifier === String(data.identifier ?? ''));
    if (!m || !m.ranks.includes(rank)) return bad('err_rank_not_held');
    if (m.locked.includes(rank)) return bad('err_rank_locked');
    m.ranks = m.ranks.filter((x) => x !== rank);
    send('logEntry', addLog('ranks', 'rankRevoke', `Wraith took the rank ${rank} from ${m.name}`, undefined, { rank, identifier: m.identifier }));
    return saved();
  }
  return fail('err_unknown_action');
}

/* ── open / callbacks ────────────────────────────────────────────────────── */
const connectorFixture = () => {
  if (params.get('connector') !== '1') return {};
  const game = params.get('game') === 'fivem' ? 'gta5' : 'rdr3';
  const native = (name: string) => name.startsWith('settings.') || name.startsWith('news.') || name.startsWith('hud.')
    || ['player.wardrobe', 'player.sitOnMount', 'characters.blocks', 'characters.money', 'characters.giveItem',
      'characters.setJob', 'characters.setGang', 'scripts.open', 'scripts.run'].includes(name);
  const unavailable = Object.fromEntries(Object.keys(connectorContract).filter((name) => native(name)
    || game === 'gta5' && ['self.spawnHorse', 'self.healMount'].includes(name)).map((name) => [name, 'capability_missing']));
  const actions = Object.entries(connectorContract).filter(([name, def]) => !unavailable[name] && perms[def.area as Area]).map(([name]) => name);
  return { levels: undefined, admin: { id: SELF_ID, name: 'Wraith', group: L('إداري الموقع', 'Website administrator') },
    connector: { actions, unavailable, game } };
};
const openMsg = () => ({
  ...localeBlock(),
  mode: params.get('mode') === 'quick' ? 'quick' : 'full',
  admin: { id: SELF_ID, name: 'Wraith', group: RANK, citizenid: '1', rank: RANK },
  perms, levels: LEVELS, actions: ACTIONS, commands: COMMANDS, protectedResources: PROTECTED, banDurations: [60, 360, 1440, 4320, 10080, 43200, 0],
  serverName: 'Wraith Studio', selfId: SELF_ID,
  ...connectorFixture(),
});

let isOpen = false;
function doOpen() {
  isOpen = true;
  send('open', openMsg());
  send('self', selfState);
  send('players', { list: players });
  send('serverInfo', serverInfo());
  send('catalog', catalog());
  send('hudCfg', { cfg: hudCfg });
  send('bans', { list: bans });
  send('mapCfg', mapCfg());
  send('mapData', mapData());
  runScript();
}

const find = (id: unknown) => players.find((p) => p.id === Number(id));
const ok = (message?: string, data?: unknown) => ({ ok: true, message, data });
const fail = (error: string, errorKey?: string) => ({ ok: false, error, errorKey: errorKey ?? error });

/* ?fail=logs,bans  those callbacks answer an error (the error states);
   ?hang=characters those never answer (the loading states) */
const FAIL = new Set((params.get('fail') ?? '').split(',').filter(Boolean));
const HANG = new Set((params.get('hang') ?? '').split(',').filter(Boolean));

/* the players' reports (the website's list through w_connector) */
const mockReports = [
  { id: 14, title: 'لاعب يرمي الناس من الجسر', description: 'لاعب يرمي الناس من الجسر في فالنتاين', status: 'open', reporter_username: 'سعد الحربي', created_at: Date.now() - 600000, messages: [{ sender_name: 'سعد الحربي', sender_type: 'player', message: 'لاعب يرمي الناس من الجسر في فالنتاين', timestamp: Date.now() - 600000 }] },
  { id: 13, title: 'علقت داخل البيت', description: 'علقت داخل البيت ولا أستطيع الخروج', status: 'claimed', reporter_username: 'فهد', claimed_by: 'Admin1', created_at: Date.now() - 3600000, messages: [{ sender_name: 'فهد', sender_type: 'player', message: 'علقت داخل البيت ولا أستطيع الخروج', timestamp: Date.now() - 3600000 }, { sender_name: 'Admin1', sender_type: 'admin', message: 'جاي لك الحين', timestamp: Date.now() - 3500000 }] },
  { id: 12, title: 'سؤال عن المزرعة', status: 'resolved', reporter_username: 'نورة', claimed_by: 'Admin2', admin_notes: 'شرحت لها', created_at: Date.now() - 86400000, messages: [] },
];
function reportsCallback(data: Record<string, unknown>) {
  if (data.action === 'list') return ok(undefined, { reports: mockReports, totalReports: mockReports.length, totalPages: 1 });
  const r = mockReports.find((x) => x.id === data.reportId);
  if (!r) return fail('report_not_found');
  if (data.action === 'claim') { r.status = 'claimed'; (r as { claimed_by?: string }).claimed_by = 'Mock Admin'; return ok(STRINGS[lang].toast_report_claimed); }
  if (data.action === 'resolve') { r.status = 'resolved'; return ok(STRINGS[lang].toast_report_resolved); }
  if (data.action === 'reopen') { r.status = 'open'; return ok(STRINGS[lang].toast_report_reopened); }
  if (data.action === 'message') { (r.messages as unknown[]).push({ sender_name: 'Mock Admin', sender_type: 'admin', message: String(data.message), timestamp: Date.now() }); return ok(STRINGS[lang].toast_report_sent); }
  return fail('err_unknown_action');
}

async function callback(name: string, data: Record<string, unknown>): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 40));
  if (HANG.has(name)) return new Promise(() => undefined);
  if (FAIL.has(name)) return fail('ui_failed');
  switch (name) {
    case 'ready': if (params.get('open') !== '0') doOpen(); return { ok: true };
    case 'close': isOpen = false; return { ok: true };
    case 'mode': send('mode', data); return { ok: true };
    case 'refresh':
      if (data.what === 'server') send('serverInfo', serverInfo());
      if (data.what === 'players') send('players', { list: players });
      if (data.what === 'bans') send('bans', { list: bans });
      if (data.what === 'hud') send('hudCfg', { cfg: hudCfg });
      if (data.what === 'catalog') send('catalog', catalog());
      if (data.what === 'modules') send('modules', { list: modules() });
      if (data.what === 'blocks') send('blocks', { list: blocks });
      return { ok: true };
    case 'catalog': send('catalog', catalog()); return { ok: true };
    case 'citizen': return resolveCitizen(String(data.input ?? ''));
    case 'player': {
      const p = data.citizenid ? players.find((x) => x.citizenid === String(data.citizenid)) : find(data.id);
      if (!p) return fail(L('اللاعب غير متصل الآن', 'The player is not online right now'), 'not_online');
      const a = String(data.action);
      if (a === 'kick' || a === 'ban') { players = players.filter((x) => x.id !== p.id); send('players', { list: players }); }
      if (a === 'revive') { p.dead = false; p.health = p.maxHealth; send('players', { list: players }); }
      if (a === 'freeze') { p.frozen = !p.frozen; send('players', { list: players }); }
      send('logEntry', addLog('player', a, `Wraith ${a} ${p.firstname} ${p.lastname} (${p.citizenid})`, { citizenid: p.citizenid, name: `${p.firstname} ${p.lastname}`, source: p.id }));
      return ok(L('تم', 'Done'));
    }
    case 'self': {
      const a = String(data.action);
      if (a in selfState && typeof (selfState as Record<string, unknown>)[a] === 'boolean') {
        (selfState as Record<string, unknown>)[a] = !(selfState as Record<string, unknown>)[a];
        send('self', selfState);
      }
      return { ok: true };
    }
    case 'server': {
      const a = String(data.action);
      const args = (data.args ?? {}) as Record<string, unknown>;
      /* sv_console.lua reads both spellings: { type } / { weather }, { name } / { resource } */
      const w = typeof args.type === 'string' ? args.type : typeof args.weather === 'string' ? args.weather : null;
      if (a === 'weather' && w) weather = w;
      if (a === 'time') time = { hour: Number(args.hour) || 0, minute: Number(args.minute) || 0 };
      if (a === 'freezeTime') world.timeFrozen = args.state === true;
      if (a === 'dynamicWeather') world.dynamicWeather = args.state === true;
      if (a === 'blackout') world.blackout = args.state === true;
      const res = typeof args.name === 'string' ? args.name : typeof args.resource === 'string' ? args.resource : null;
      if (/Resource$/.test(a) && res) {
        if (PROTECTED.includes(res) && a !== 'startResource') return fail(L('هذا السكربت محمي', 'This script is protected'), 'err_protected');
        resState[res] = a === 'stopResource' ? 'stopped' : 'started';
      }
      send('serverInfo', serverInfo());
      send('logEntry', addLog('server', a, `Wraith ${a}`));
      return ok(L('تم', 'Done'));
    }
    case 'locale':
      if (data.action === 'set' && (data.locale === 'ar' || data.locale === 'en')) { lang = data.locale; send('locale', localeBlock()); send('catalog', catalog()); return { ok: true }; }
      if (data.action === 'dialog') return { ok: true };
      return fail('err_unknown_action');
    case 'bans':
      if (data.action === 'unban') { bans = bans.filter((b) => b.id !== Number(data.id)); send('bans', { list: bans }); return ok(L('رُفع الحظر', 'Ban lifted')); }
      return { ok: true };
    case 'characters': {
      const a = String(data.action);
      if (a === 'search') {
        const q = String(data.q ?? '').toLowerCase();
        return ok(undefined, chars.filter((c) => !q || `${c.citizenid} ${c.name} ${c.account} ${c.license}`.toLowerCase().includes(q)));
      }
      if (a === 'get') { const d = charDetail(String(data.citizenid)); return d ? ok(undefined, d) : fail(L('لا توجد شخصية بهذا الرقم', 'No character with this ID'), 'err_char_not_found'); }
      if (a === 'blocks') return ok(undefined, blocks);
      if (a === 'block') {
        const c = chars.find((x) => x.citizenid === String(data.citizenid));
        if (!c) return fail('err_char_not_found');
        blocks = [...blocks.filter((b) => b.citizenid !== c.citizenid), { citizenid: c.citizenid, name: c.name, reason: String(data.reason ?? ''), blocked_by: 'Wraith', blocked_at: now(), online: c.online }];
        c.blocked = String(data.reason ?? '') || true;
        send('blocks', { list: blocks });
        return ok(L('أُوقفت الشخصية', 'Character blocked'));
      }
      if (a === 'unblock') {
        blocks = blocks.filter((b) => b.citizenid !== String(data.citizenid));
        const c = chars.find((x) => x.citizenid === String(data.citizenid)); if (c) delete c.blocked;
        send('blocks', { list: blocks });
        return ok(L('رُفع الإيقاف', 'Block lifted'));
      }
      if (a === 'deleteStatus' || a === 'transferStatus') return ok(undefined, { done: false });
      return ok(L('تم', 'Done'));
    }
    case 'logs': {
      const q = data as LogQuery;
      const s = String(q.q ?? '').toLowerCase();
      const tgt = q.target ? resolveCitizen(String(q.target)) : null;
      const tcid = tgt && tgt.ok && tgt.data ? tgt.data.citizenid : q.target ? '\u0000' : null;
      const list = logs.filter((e) => (!q.kind || e.kind === q.kind) && (!q.admin || e.admin.name === q.admin) && (!q.since || e.at >= q.since) && (!q.before || e.id < q.before)
        && (!tcid || e.target?.citizenid === tcid)
        && (!s || `${e.text} ${e.target?.citizenid ?? ''} ${e.target?.name ?? ''}`.toLowerCase().includes(s)));
      return ok(undefined, { list: list.slice(0, q.limit ?? 100), total: list.length, persisted: true });
    }
    case 'scripts': {
      const a = String(data.action);
      if (a === 'list') { const list = modules(); send('modules', { list }); return ok(undefined, list); }
      if (a === 'open') { send('logEntry', addLog('scripts', 'open', `Wraith opened the ${String(data.resource)} panel`, undefined, { resource: data.resource })); return ok(L('فُتحت واجهة السكربت', 'Opened the script interface')); }
      if (a === 'run') return ok(L('نُفّذ الأمر', 'Command run'), { output: `${String(data.command)} ok` });
      if (a === 'start') { resState[String(data.resource)] = 'started'; send('modules', { list: modules() }); return ok(L('شُغّل السكربت', 'Script started')); }
      return { ok: true };
    }
    case 'settings': {
      const a = String(data.action);
      const res = String(data.resource ?? '');
      if (a === 'list') return ok(undefined, summaries());
      if (a === 'schema') return SCHEMAS[res] ? ok(undefined, SCHEMAS[res]) : fail(L('السكربت ما يدعم الإعدادات', 'The script has no settings'), 'err_no_settings');
      if (a === 'values') { const v = valuesOf(res, String(data.group ?? '')); return v ? ok(undefined, v) : fail('err_unknown_group'); }
      if (a === 'apply') {
        const r = applySettings(res, (data.changes ?? []) as SettingsChange[]);
        return r.ok ? ok(L('حُفظت الإعدادات وطُبّقت على الكل', 'Settings saved and applied to everyone'), r) : { ok: false, error: L('ما انحفظ شيء: في قيمة تغيّرت أو غير مسموحة', 'Nothing was saved: a value changed meanwhile or is not allowed'), errorKey: 'err_settings_rejected', data: r };
      }
      if (a === 'history') {
        return ok(undefined, Object.entries(overridden).filter(([k]) => resourceOfKey(res, k)).map(([k, o], i) => ({ batch: `b${i}`, resource: res, key: k, old: o.base, new: current[k], by: o.by, at: o.at, via: 'w_admin' })));
      }
      return { ok: true };
    }
    case 'map':
      if (data.action === 'players') send('mapPlayers', mapPlayers());
      return { ok: true };
    case 'hud':
      if (data.action === 'save') return ok(L('حُفظت إعدادات الواجهة', 'HUD settings saved'));
      return { ok: true };
    case 'news': return newsCallback(data);
    case 'reports': return reportsCallback(data);
    case 'ranks': return ranksCallback(data);
    default:
      return { ok: true };
  }
}

(window as unknown as { __waMock: unknown }).__waMock = { callback: (name: string, data: unknown) => callback(name, (data ?? {}) as Record<string, unknown>) };

/* ── the scripted driver for screenshots ─────────────────────────────────── */
function typeInto(css: string, text: string) {
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(css);
  if (!input) { console.warn('[mock] no input for', css); return; }
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function runScript() {
  const typeSpec = params.get('type');
  const clicks = (params.get('click') ?? '').split('|').filter(Boolean);
  let i = 0;
  const next = () => {
    if (i >= clicks.length) return;
    let sel = clicks[i++];
    if (sel.startsWith('type:')) {
      const [css, text] = sel.slice(5).split('::');
      typeInto(css, text ?? '');
      setTimeout(next, 500);
      return;
    }
    if (sel.startsWith('key:')) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: sel.slice(4), bubbles: true }));
      setTimeout(next, 500);
      return;
    }
    const scroll = sel.startsWith('scroll:');
    if (scroll) sel = sel.slice(7);
    const el = document.querySelector<HTMLElement>(sel);
    if (el && scroll) el.scrollTop = el.scrollHeight * (Number(params.get('frac')) || 1);
    else if (el) el.click();
    // eslint-disable-next-line no-console
    else console.warn('[mock] no element for', sel);
    setTimeout(next, 500);
  };
  setTimeout(() => {
    if (typeSpec) {
      const [sel, text] = typeSpec.split('::');
      typeInto(sel, text ?? '');
    }
    next();
  }, 900);
}

window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  if (e.key === 'l' || e.key === 'L') { lang = lang === 'ar' ? 'en' : 'ar'; send('locale', localeBlock()); send('catalog', catalog()); }
  if ((e.key === 'o' || e.key === 'O') && !isOpen) doOpen();
  if (e.key === 't' || e.key === 'T') send('toast', { type: 'success', text: L('رسالة تجريبية', 'A sample message') });
});

/* headless screenshots freeze animations at their first frame: draw everything static unless ?motion=1 */
if (params.get('motion') !== '1') document.documentElement.classList.add('k-static');

if (params.get('bg') !== '0') {
  const paint = () => {
    document.body.style.setProperty('background', 'radial-gradient(ellipse at 60% 40%, #4a4a4a 0%, #222222 55%, #0d0c0b 100%)', 'important');
    document.documentElement.style.setProperty('background', '#111', 'important');
  };
  if (document.body) paint(); else document.addEventListener('DOMContentLoaded', paint);
}

export {};
