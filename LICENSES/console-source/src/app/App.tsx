/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · app/App.tsx
 * The console: listens to Lua ({ action, data } on window 'message'), holds every piece of live data,
 * owns the route, the dialog, the toasts and the viewer's preferences, and draws the shell (full mode)
 * or the quick menu (quick mode).
 *
 * Lua → page:  open · close · mode · permissions · locale · players · serverInfo · hudCfg · bans · catalog
 *              · mapCfg · mapPlayers · mapData · self · toast · modules · logEntry · blocks · access (2.3.1)
 * page → Lua:  ready · close · mode · refresh · player · self · server · hud · bans · map · catalog
 *              · characters · citizen · logs · scripts · settings
 * ════════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_PREFS, Ctx } from '../ctx';
import type { ActOptions, AppCtx, Prefs, Route, RouteParams } from '../ctx';
import { HelpProvider } from '../help';
import { I18nProvider, applyDocumentLocale, makeT } from '../i18n';
import { DialogHost } from '../kit/dialog';
import type { ConfirmSpec } from '../kit/dialog';
import Toasts from '../kit/Toasts';
import { actionAvailable, isMock, post, useConsoleCapabilities } from '../nui';
import type {
  ActionAreas, AdminPlayer, AdminSelf, Area, BanEntry, BlockEntry, Catalog, Dir, HudCfg, Lang, Level, LevelsMap,
  LocaleData, LogEntry, MapCfg, MapData, MapPlayerRow, ModuleDescriptor, OpenData, Perms, Rank, RefreshWhat, Result,
  SelfState, ServerInfo, Strings, Toast, ToastType,
} from '../types';
import AppShell from './AppShell';
import QuickSlot from './quick';
import { copyText } from '../kit/format';
import { allowed, pageById, visiblePages } from './registry';
import { toAccess } from '../pages/perms/model';
import type { AccessData } from '../types';

const TOAST_MS = 4200;
/* the old console's tab ids (?tab= links in the browser mock) → the page ids */
const OLD_TABS: Record<string, string> = {
  dashboard: 'dashboard', players: 'players', characters: 'characters', map: 'map', hud: 'hub', self: 'tools', bans: 'bans', resources: 'resources',
};
const LS_PREFS = 'w_connector:console:prefs';
const EMPTY_MAP: MapData = { places: [], labels: [], markers: [] };

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(LS_PREFS);
    if (!raw) return DEFAULT_PREFS;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return { ...DEFAULT_PREFS, ...p };
  } catch {
    return DEFAULT_PREFS;
  }
}

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const obj = <T,>(v: unknown): T | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : undefined);

export default function App() {
  const capabilities = useConsoleCapabilities();
  const canAction = useCallback((name: string) => actionAvailable(name), [capabilities]);
  const [open, setOpen] = useState(false);
  const [mode, setModeState] = useState<'full' | 'quick'>('full');
  const [lang, setLang] = useState<Lang>('ar');
  const [dir, setDir] = useState<Dir>('rtl');
  const [strings, setStrings] = useState<Strings>({});
  const [admin, setAdmin] = useState<AdminSelf | null>(null);
  const [perms, setPerms] = useState<Perms>({});
  const [levels, setLevels] = useState<LevelsMap>({});
  const [rank, setRank] = useState<Rank | null>(null);
  const [actions, setActions] = useState<ActionAreas>({});
  const [commands, setCommands] = useState<Record<string, Level>>({});
  const [protectedResources, setProtected] = useState<string[]>([]);
  const [banDurations, setBanDurations] = useState<number[]>([]);
  const [serverName, setServerName] = useState('');
  const [selfId, setSelfId] = useState(0);

  const [players, setPlayers] = useState<AdminPlayer[]>([]);
  const [playersSeen, setPlayersSeen] = useState(false);
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [hudCfg, setHudCfg] = useState<HudCfg | null>(null);
  const [bans, setBans] = useState<BanEntry[] | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [mapCfg, setMapCfg] = useState<MapCfg | null>(null);
  const [mapPlayers, setMapPlayers] = useState<MapPlayerRow[]>([]);
  const [mapPlayersSeen, setMapPlayersSeen] = useState(false);
  const [mapData, setMapData] = useState<MapData>(EMPTY_MAP);
  const [self, setSelf] = useState<SelfState | null>(null);
  const [modules, setModules] = useState<ModuleDescriptor[] | null>(null);
  const [recentLogs, setRecentLogs] = useState<LogEntry[]>([]);
  const [blocks, setBlocks] = useState<BlockEntry[] | null>(null);
  const [access, setAccess] = useState<AccessData | null>(null);

  const [route, setRoute] = useState<Route>({ page: 'dashboard', params: {} });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [dialog, setDialog] = useState<ConfirmSpec<unknown> | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [palette, setPalette] = useState<{ open: boolean; q: string }>({ open: false, q: '' });
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);

  const toastSeq = useRef(0);
  const openedAt = useRef(0);
  /* 2.6.1: the key that opened the page (Page Up quick, F10 full) may still be held down when the page takes the
     focus. The game's browser reports its auto-repeats with repeat=false, so after the 150 ms guard the first repeat
     closed the page again ("it opens and shuts at once"). That key is ignored until it is let go, or until a second
     has passed with no repeat of it (it was let go before the page had the focus). */
  const heldKey = useRef<{ key: string; seen: boolean } | null>(null);
  const stringsRef = useRef<Strings>({});
  stringsRef.current = strings;
  const t = useMemo(() => makeT(strings, lang), [strings, lang]);

  /* ── toasts ──────────────────────────────────────────────────────────── */
  const toast = useCallback((type: ToastType, text: string) => {
    const id = ++toastSeq.current;
    setToasts((l) => [...l.slice(-4), { id, type, text }]);
    window.setTimeout(() => setToasts((l) => l.filter((x) => x.id !== id)), TOAST_MS);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((l) => l.filter((x) => x.id !== id)), []);

  /* ── messages from Lua ───────────────────────────────────────────────── */
  useEffect(() => {
    const applyLocale = (l0: unknown, d0: unknown) => {
      const l: Lang = l0 === 'en' ? 'en' : 'ar';
      const dr: Dir = d0 === 'ltr' ? 'ltr' : d0 === 'rtl' ? 'rtl' : l === 'ar' ? 'rtl' : 'ltr';
      setLang(l); setDir(dr); applyDocumentLocale(l, dr);
    };
    const onMsg = (e: MessageEvent) => {
      const m = (e.data || {}) as { action?: string; data?: unknown };
      const d = (m.data ?? {}) as Record<string, unknown>;
      switch (m.action) {
        case 'connectorClipboard': {
          if (typeof d.text === 'string') copyText(d.text);
          break;
        }
        case 'connectorProtected': { setProtected(arr<string>(d.list)); break; }
        case 'open': {
          const o = d as unknown as OpenData;
          applyLocale(o.locale, o.dir);
          setStrings(obj<Strings>(o.strings) ?? {});
          setAdmin(o.admin ?? null);
          setPerms(obj<Perms>(o.perms) ?? {});
          setLevels(obj<LevelsMap>(o.levels) ?? {});
          setRank((o.admin && o.admin.rank) || null);
          setActions(obj<ActionAreas>(o.actions) ?? {});
          setCommands(obj<Record<string, Level>>(o.commands) ?? {});
          setProtected(arr<string>(o.protectedResources));
          setBanDurations(arr<number>(o.banDurations));
          setServerName(typeof o.serverName === 'string' ? o.serverName : '');
          setSelfId(typeof o.selfId === 'number' ? o.selfId : 0);
          setSelectedId(null);
          setPlayers([]); setPlayersSeen(false); setServerInfo(null); setHudCfg(null); setBans(null); setCatalog(null);
          setModules(null); setRecentLogs([]); setBlocks(null); setMapCfg(null); setMapData(EMPTY_MAP); setSelf(null); setAccess(null);
          setRoute({ page: o.initialPage && pageById(o.initialPage) ? o.initialPage : 'dashboard', params: {} });
          setModeState(o.mode === 'quick' ? 'quick' : 'full');
          setMapPlayers([]); setMapPlayersSeen(false);
          setDialog(null);
          setPalette({ open: false, q: '' });
          openedAt.current = performance.now();
          heldKey.current = { key: o.mode === 'quick' ? 'PageUp' : 'F10', seen: false };
          /* browser mock only: ?page=players&sel=2 (or the old ?tab=) lands on a page, for screenshots */
          if (isMock()) {
            const q = new URLSearchParams(location.search);
            const pg = q.get('page') ?? (q.get('tab') ? OLD_TABS[q.get('tab') as string] ?? null : null);
            const params: RouteParams = {};
            q.forEach((v, k) => { if (!['page', 'tab', 'lang', 'perms', 'open', 'mode', 'click', 'type', 'frac', 'bg', 'help', 'fresh', 'W', 'H'].includes(k)) params[k] = v; });
            if (pg) setRoute({ page: pg, params });
            const sel = Number(q.get('sel'));
            if (Number.isFinite(sel) && sel > 0) setSelectedId(sel);
          }
          setOpen(true);
          return;
        }
        case 'close':
          setOpen(false); setDialog(null); setPalette({ open: false, q: '' });
          return;
        case 'mode': setModeState(d.mode === 'quick' ? 'quick' : 'full'); return;
        case 'permissions': {
          if (d.perms && typeof d.perms === 'object') {
            setPerms(d.perms as Perms);
            if (obj<ActionAreas>(d.actions)) setActions(d.actions as ActionAreas);
            if (obj<LevelsMap>(d.levels)) setLevels(d.levels as LevelsMap);
            if (typeof d.rank === 'string') setRank(d.rank as Rank);
          } else setPerms(d as Perms);
          return;
        }
        case 'locale': {
          const o = d as unknown as LocaleData;
          applyLocale(o.locale, o.dir);
          if (obj<Strings>(o.strings)) setStrings(o.strings);
          return;
        }
        case 'players':
          if (Array.isArray(d.list)) { setPlayers(d.list as AdminPlayer[]); setPlayersSeen(true); }
          return;
        case 'serverInfo': setServerInfo(d as unknown as ServerInfo); return;
        case 'hudCfg': setHudCfg(obj<HudCfg>(d.cfg) ?? null); return;
        case 'bans': setBans(arr<BanEntry>(d.list)); return;
        case 'catalog':
          setCatalog({
            jobs: arr(d.jobs), gangs: arr(d.gangs), items: arr(d.items), weathers: arr(d.weathers), horses: arr(d.horses),
            wagons: arr(d.wagons), animals: arr(d.animals), peds: arr(d.peds), groups: arr(d.groups),
          });
          return;
        case 'mapCfg': setMapCfg(d && typeof d.tilesBase === 'string' ? (d as unknown as MapCfg) : null); return;
        case 'mapPlayers':
          if (Array.isArray(d.list)) { setMapPlayers(d.list as MapPlayerRow[]); setMapPlayersSeen(true); }
          return;
        case 'mapData':
          setMapData({
            places: arr(d.places), labels: arr(d.labels), markers: arr(d.markers),
            waypoint: obj<{ x: number; y: number }>(d.waypoint) ?? null,
          });
          return;
        case 'self': setSelf(d as unknown as SelfState); return;
        case 'modules': setModules(arr<ModuleDescriptor>(d.list)); return;
        case 'logEntry': if (typeof d.id === 'number') setRecentLogs((l) => [d as unknown as LogEntry, ...l.filter((x) => x.id !== d.id)].slice(0, 50)); return;
        case 'blocks': setBlocks(arr<BlockEntry>(d.list)); return;
        case 'access': setAccess(toAccess(d)); return;
        case 'toast': {
          const type = d.type === 'success' || d.type === 'error' ? d.type : 'inform';
          const text = typeof d.text === 'string' ? d.text : '';
          if (text) toast(type, stringsRef.current[text] ?? text);
          return;
        }
        default:
      }
    };
    window.addEventListener('message', onMsg);
    void post('ready');
    return () => window.removeEventListener('message', onMsg);
  }, [toast]);

  /* ── the verbs ───────────────────────────────────────────────────────── */
  const act = useCallback(async <T,>(name: string, data: unknown, opts?: ActOptions): Promise<Result<T>> => {
    const r = await post<T>(name, data);
    if (r.ok) {
      const message = r.message ?? opts?.okText;
      if (message && !opts?.silent) toast('success', message);
    } else if (!opts?.silent) {
      toast('error', t(r.error ?? 'ui_failed'));
    }
    return r;
  }, [toast, t]);

  const refresh = useCallback((what: RefreshWhat) => { void post('refresh', { what }); }, []);
  const confirm = useCallback(<V,>(spec: ConfirmSpec<V>) => setDialog(spec as unknown as ConfirmSpec<unknown>), []);
  const closeDialog = useCallback(() => setDialog(null), []);
  const can = useCallback((key: Area) => perms[key] === true, [perms]);
  const levelOf = useCallback((area: Area): Level | null => levels[area] ?? null, [levels]);

  const close = useCallback(() => { void post('close'); setOpen(false); setDialog(null); setPalette({ open: false, q: '' }); }, []);
  const setMode = useCallback((m: 'full' | 'quick') => { setModeState(m); void post('mode', { mode: m }); }, []);
  const navigate = useCallback((page: string, params: RouteParams = {}) => {
    setRoute({ page, params });
    if (params.sel && Number.isFinite(Number(params.sel))) setSelectedId(Number(params.sel));
  }, []);
  const openPalette = useCallback((q = '') => setPalette({ open: true, q }), []);
  const setPrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      try { localStorage.setItem(LS_PREFS, JSON.stringify(next)); } catch { /* optional */ }
      return next;
    });
  }, []);

  useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle('k-compact', prefs.density === 'compact');
    el.classList.toggle('k-reduced-motion', prefs.reducedMotion);
  }, [prefs.density, prefs.reducedMotion]);

  /* ── keyboard: Esc closes, F10 / PgUp switch full ⇄ quick, Ctrl+K opens the palette ─ */
  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;
  const paletteRef = useRef(palette.open);
  paletteRef.current = palette.open;
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        if (mode !== 'full') return;
        e.preventDefault();
        setPalette((p) => ({ open: !p.open, q: '' }));
        return;
      }
      if (!['Escape', 'PageUp', 'F10'].includes(e.key)) return;
      if (dialogRef.current || paletteRef.current) return;
      if (performance.now() - openedAt.current < 150) return;
      const held = heldKey.current;
      if (held && held.key === e.key) {
        if (held.seen || performance.now() - openedAt.current < 1000) { held.seen = true; e.preventDefault(); return; }
        heldKey.current = null;
      }
      e.preventDefault();
      // Page Up is the quick menu's key, F10 the console's (2.4.1, owner 2026-11-03): the other mode's key switches, the
      // open mode's own key closes
      if ((e.key === 'F10' && mode === 'quick') || (e.key === 'PageUp' && mode === 'full')) setMode(mode === 'quick' ? 'full' : 'quick');
      else close();
    };
    const onKeyUp = (e: KeyboardEvent) => { if (heldKey.current && heldKey.current.key === e.key) heldKey.current = null; };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); };
  }, [open, mode, close, setMode]);

  /* ── page enter: its pushes and its own hook ─────────────────────────── */
  const ctxRef = useRef<AppCtx | null>(null);
  useEffect(() => {
    if (!open || mode === 'quick') return undefined;
    const def = pageById(route.page);
    if (!def) return undefined;
    for (const w of def.refresh ?? []) refresh(w);
    const cleanup = def.onEnter && ctxRef.current ? def.onEnter(ctxRef.current) : undefined;
    return () => { if (typeof cleanup === 'function') cleanup(); };
  }, [open, mode, route.page, refresh]);

  useEffect(() => {
    if (!open) return;
    refresh('server');
    void post('catalog');
  }, [open, refresh]);

  /* a player that left drops the selection */
  useEffect(() => {
    if (selectedId !== null && playersSeen && !players.some((p) => p.id === selectedId)) setSelectedId(null);
  }, [players, playersSeen, selectedId]);

  const ctx = useMemo<AppCtx>(() => ({
    admin, serverName, selfId, perms, can, canAction,
    levels, rank, actions, commands, protectedResources, banDurations, levelOf,
    players, playersSeen, serverInfo, hudCfg, bans, catalog, mapCfg, mapPlayers, mapPlayersSeen, mapData, self,
    modules, recentLogs, blocks, access,
    act, confirm, toast, refresh,
    selectedId, select: setSelectedId,
    route, navigate, openPalette,
    mode, setMode, close,
    prefs, setPrefs,
  }), [admin, serverName, selfId, perms, can, canAction, levels, rank, actions, commands, protectedResources, banDurations, levelOf,
    players, playersSeen, serverInfo, hudCfg, bans, catalog, mapCfg, mapPlayers, mapPlayersSeen, mapData, self,
    modules, recentLogs, blocks, access, act, confirm, toast, refresh, selectedId, route, navigate, openPalette, mode, setMode, close, prefs, setPrefs]);
  ctxRef.current = ctx;

  /* a page that is not allowed (or vanished with a permission change) falls back to the first allowed one */
  useEffect(() => {
    if (!open) return;
    const def = pageById(route.page);
    if (def && allowed(def, ctx)) return;
    const first = visiblePages(ctx)[0];
    if (first && first.id !== route.page) setRoute({ page: first.id, params: {} });
  }, [open, route.page, ctx]);

  if (!open) return null;

  return (
    <I18nProvider strings={strings} lang={lang} dir={dir}>
      <Ctx.Provider value={ctx}>
        <HelpProvider levels={levels}>
          {mode === 'quick'
            ? <QuickSlot onClose={close} onFull={() => setMode('full')} />
            : <AppShell palette={palette} setPalette={setPalette} />}
          <DialogHost spec={dialog} onClose={closeDialog} />
          <Toasts list={toasts} onDismiss={dismissToast} />
        </HelpProvider>
      </Ctx.Provider>
    </I18nProvider>
  );
}
