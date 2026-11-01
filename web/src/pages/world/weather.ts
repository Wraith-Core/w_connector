/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/world/weather.ts
 * The weather types of w_weathersync (Config.AvailableWeatherTypes, sent in the catalog) grouped the
 * way a person thinks about the sky, their localized names (weather_<code> in locales/*.json), the
 * time-of-day presets, and the in-game clock rule (w_weathersync: one in-game minute = 2 real seconds).
 * ════════════════════════════════════════════════════════════════════════════ */

import type { TFn } from '../../i18n';

export type WeatherGroup = 'clear' | 'clouds' | 'rain' | 'snow' | 'other';
export const WEATHER_GROUPS: readonly WeatherGroup[] = ['clear', 'clouds', 'rain', 'snow', 'other'];

/** Every type w_weathersync ships, in the order each group lists them (mildest first) */
const ORDER: Record<WeatherGroup, string[]> = {
  clear: ['SUNNY', 'HIGHPRESSURE'],
  clouds: ['CLOUDS', 'OVERCAST', 'OVERCASTDARK', 'MISTY', 'FOG'],
  rain: ['DRIZZLE', 'SHOWER', 'RAIN', 'THUNDER', 'THUNDERSTORM', 'HAIL'],
  snow: ['SNOWLIGHT', 'SLEET', 'SNOW', 'GROUNDBLIZZARD', 'BLIZZARD', 'WHITEOUT'],
  other: ['SANDSTORM', 'HURRICANE'],
};

/** Used when the catalog has not arrived (or w_weathersync sent none) */
export const FALLBACK_WEATHERS: string[] = WEATHER_GROUPS.flatMap((g) => ORDER[g]);

export function weatherGroup(code: string): WeatherGroup {
  const up = code.toUpperCase();
  for (const g of WEATHER_GROUPS) if (ORDER[g].includes(up)) return g;
  return 'other';
}

/** 'RAIN' → 'مطر' / 'Rain' (weather_rain); an unknown type shows its code */
export function weatherLabel(t: TFn, code: string | null | undefined): string {
  if (!code) return '';
  const key = `weather_${code.toLowerCase()}`;
  const s = t(key);
  return s === key ? code : s;
}

/** The server's list, grouped and ordered; unknown types land in 'other' */
export function groupWeathers(list: string[]): { group: WeatherGroup; codes: string[] }[] {
  const have = new Set(list.map((w) => w.toUpperCase()));
  const out: { group: WeatherGroup; codes: string[] }[] = [];
  for (const g of WEATHER_GROUPS) {
    const known = ORDER[g].filter((c) => have.has(c));
    const extra = g === 'other' ? [...have].filter((c) => !FALLBACK_WEATHERS.includes(c)).sort() : [];
    const codes = [...known, ...extra];
    if (codes.length) out.push({ group: g, codes });
  }
  return out;
}

/* ── time of day ─────────────────────────────────────────────────────────── */

export type PresetId = 'dawn' | 'morning' | 'noon' | 'afternoon' | 'sunset' | 'night';
export const TIME_PRESETS: { id: PresetId; hour: number; minute: number }[] = [
  { id: 'dawn', hour: 5, minute: 30 },
  { id: 'morning', hour: 8, minute: 0 },
  { id: 'noon', hour: 12, minute: 0 },
  { id: 'afternoon', hour: 16, minute: 0 },
  { id: 'sunset', hour: 19, minute: 0 },
  { id: 'night', hour: 23, minute: 0 },
];

export type DayPart = 'dawn' | 'day' | 'evening' | 'night';
/** What the sky looks like at that hour (for the "after this it will be 22:00 (night)" line) */
export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 7) return 'dawn';
  if (hour >= 7 && hour < 18) return 'day';
  if (hour >= 18 && hour < 21) return 'evening';
  return 'night';
}

export const pad2 = (n: number) => String(Math.max(0, Math.floor(n))).padStart(2, '0');
export const clockText = (hour: number, minute: number) => `${pad2(hour)}:${pad2(minute)}`;

/** w_weathersync: baseTime = os.time() / 2, so one in-game minute passes every 2 real seconds */
export const REAL_MS_PER_GAME_MINUTE = 2000;
