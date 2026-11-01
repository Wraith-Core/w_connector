/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/world/state.ts
 * What the world controls share wherever they are drawn (the World page, the dashboard card, the
 * quick menu):
 *   useWorldActions()   weather / time / announce / cycle through post('server', { action, args })
 *   useGameClock()      the in-game clock, ticking locally between pushes (1 game minute = 2 s)
 *   useAnnounceDraft()  one announcement draft for every place it is typed (survives page switches)
 *   worldCycleOf()      w_weathersync's cycle state (serverInfo.world: an L1 request, optional)
 * ════════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useApp } from '../../ctx';
import { useI18n } from '../../i18n';
import type { Result, ServerInfo } from '../../types';
import { REAL_MS_PER_GAME_MINUTE } from './weather';

/* ── the cycle state (L1 request) ────────────────────────────────────────── */

/**
 * serverInfo.world, once L1 sends it (w_weathersync exports getTimeFreezeState, getDynamicWeather,
 * getBlackoutState). Until then the cycle section stays hidden in the game.
 */
export interface WorldCycle { timeFrozen?: boolean; dynamicWeather?: boolean; blackout?: boolean }
type InfoWithWorld = ServerInfo & { world?: WorldCycle | null };

export function worldCycleOf(info: ServerInfo | null): WorldCycle | null {
  const w = (info as InfoWithWorld | null)?.world;
  return w && typeof w === 'object' ? w : null;
}

export type CycleAction = 'freezeTime' | 'dynamicWeather' | 'blackout';
export const CYCLE_FIELD: Record<CycleAction, keyof WorldCycle> = {
  freezeTime: 'timeFrozen', dynamicWeather: 'dynamicWeather', blackout: 'blackout',
};

/* ── actions ─────────────────────────────────────────────────────────────── */

export type WorldBusy = 'weather' | 'time' | 'announce' | 'announceClear' | CycleAction | null;

/**
 * The server runner (sv_console.lua serverActions) reads:
 *   weather  { type }            time  { hour, minute }            announce  { text, seconds } (at most 300; 3-1800 s)
 *   announceClear  {}  (3.1.0: takes the running announcement off every screen)
 *   L1: freezeTime / dynamicWeather / blackout  { state }
 * Every one needs area 'server'; the answer's message is the translated toast.
 */
export function useWorldActions() {
  const app = useApp();
  const { t } = useI18n();
  const [busy, setBusy] = useState<WorldBusy>(null);
  const run = useCallback(async (key: Exclude<WorldBusy, null>, args: Record<string, unknown>, okKey: string): Promise<Result> => {
    setBusy(key);
    try {
      const r = await app.act('server', { action: key, args }, { okText: t(okKey) });
      if (r.ok) app.refresh('server');
      return r;
    } finally {
      setBusy(null);
    }
  }, [app, t]);
  return {
    busy,
    setWeather: (type: string) => run('weather', { type }, 'toast_weather_set'),
    setTime: (hour: number, minute: number) => run('time', { hour: Math.round(hour), minute: Math.round(minute) }, 'toast_time_set'),
    announce: (text: string, seconds: number) => run('announce', { text: text.trim(), seconds: Math.round(seconds) }, 'toast_announced'),
    announceClear: () => run('announceClear', {}, 'toast_announce_cleared'),
    setCycle: (action: CycleAction, state: boolean) => run(action, { state }, 'ui_done'),
  };
}

/* ── the live clock ──────────────────────────────────────────────────────── */

/** The in-game clock: the pushed time plus the real time since the push (stopped while frozen) */
export function useGameClock(info: ServerInfo | null, frozen: boolean): { hour: number; minute: number } | null {
  const time = info?.time ?? null;
  /* a new push (a new serverInfo object) restarts the count */
  const at = useMemo(() => Date.now(), [info]); // eslint-disable-line react-hooks/exhaustive-deps
  const [, tick] = useState(0);
  useEffect(() => {
    if (!time || frozen) return undefined;
    const id = window.setInterval(() => tick((n) => n + 1), REAL_MS_PER_GAME_MINUTE);
    return () => window.clearInterval(id);
  }, [time, frozen]);
  if (!time) return null;
  const passed = frozen ? 0 : Math.floor((Date.now() - at) / REAL_MS_PER_GAME_MINUTE);
  const total = ((time.hour * 60 + time.minute + passed) % 1440 + 1440) % 1440;
  return { hour: Math.floor(total / 60), minute: total % 60 };
}

/** Server uptime in seconds, ticking locally between pushes */
export function useUptime(info: ServerInfo | null, everyMs = 15000): number | null {
  const at = useMemo(() => Date.now(), [info]); // eslint-disable-line react-hooks/exhaustive-deps
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  if (!info || !Number.isFinite(info.uptime)) return null;
  return info.uptime + Math.floor((Date.now() - at) / 1000);
}

/* ── the announcement draft ──────────────────────────────────────────────── */

export const ANNOUNCE_MAX = 300;
/* 3.1.0: how long it stays on screen (w_hud's shard under the compass); the server refuses outside this */
export const ANNOUNCE_MIN_S = 3;
export const ANNOUNCE_MAX_S = 1800;
export type AnnounceUnit = 'seconds' | 'minutes';
export interface AnnounceDuration { amount: number | null; unit: AnnounceUnit }
/** The duration in whole seconds, or null when it is empty or outside 3 s - 30 min */
export function announceSeconds(d: AnnounceDuration): number | null {
  if (d.amount === null || !Number.isFinite(d.amount)) return null;
  const s = Math.round(d.amount * (d.unit === 'minutes' ? 60 : 1));
  return s >= ANNOUNCE_MIN_S && s <= ANNOUNCE_MAX_S ? s : null;
}
let draft = '';
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const setDraft = (v: string) => { draft = v.slice(0, ANNOUNCE_MAX); listeners.forEach((fn) => fn()); };

/** One draft for every place the announcement is typed: a page switch keeps what you wrote */
export function useAnnounceDraft(): [string, (v: string) => void] {
  const v = useSyncExternalStore(subscribe, () => draft, () => draft);
  return [v, setDraft];
}

/* the duration is kept beside the draft, for the same reason (10 seconds until changed) */
let duration: AnnounceDuration = { amount: 10, unit: 'seconds' };
const setDuration = (v: AnnounceDuration) => { duration = v; listeners.forEach((fn) => fn()); };
export function useAnnounceDuration(): [AnnounceDuration, (v: AnnounceDuration) => void] {
  const v = useSyncExternalStore(subscribe, () => duration, () => duration);
  return [v, setDuration];
}
