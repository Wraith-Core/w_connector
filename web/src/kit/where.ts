/* ════════════════════════════════════════════════════════════════════════════
 * w_connector · kit/where.ts  (the notebook look)
 * A place in words instead of coordinates: «فالنتاين · 1.2 كم منك».
 *   useWhere(points)  → (c) => text     asks Lua ('where', client/cl_console.lua) for the town / district key of
 *                                        each point once per 8 m cell, then words it from label.place.*
 *   placeName(t, zone) / placeFar(t, meters) / placeText(t, zone, meters)
 * The distance is counted from the admin's own position (app.self.coords). Without RedM (or before Lua answers)
 * the text is the distance alone; the exact numbers stay under «خيارات متقدمة» where a page needs them.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../ctx';
import { useI18n } from '../i18n';
import { post } from '../nui';
import type { Coords } from '../types';

type T = (key: string, ...args: (string | number)[]) => string;
type Point = { x: number; y: number; z?: number } | null | undefined;

const cellOf = (c: { x: number; y: number }) => `${Math.floor(c.x / 8)}:${Math.floor(c.y / 8)}`;

/* one cache for the page: cell → zone key ('' while asked, false = no zone) */
const zones = new Map<string, string | false>();
const waiting = new Set<() => void>();
let queue: { cell: string; x: number; y: number; z?: number }[] = [];
let timer = 0;

function flush() {
  timer = 0;
  const batch = queue.splice(0, 64);
  if (!batch.length) return;
  void post<(string | false)[]>('where', { list: batch.map(({ x, y, z }) => ({ x, y, z })) }).then((r) => {
    batch.forEach((b, i) => zones.set(b.cell, (r.ok && Array.isArray(r.data) ? r.data[i] : false) || false));
    waiting.forEach((fn) => fn());
    if (queue.length && !timer) timer = window.setTimeout(flush, 30);
  });
  if (queue.length) timer = window.setTimeout(flush, 30);
}

function ask(c: { x: number; y: number; z?: number }) {
  const cell = cellOf(c);
  if (zones.has(cell)) return;
  zones.set(cell, '');
  queue.push({ cell, x: c.x, y: c.y, z: c.z });
  if (!timer) timer = window.setTimeout(flush, 30);
}

export const zoneOf = (c: Point): string | false | undefined => {
  if (!c || typeof c.x !== 'number' || typeof c.y !== 'number') return undefined;
  const z = zones.get(cellOf(c));
  return z === '' ? undefined : z;
};

export function placeName(t: T, zone: string | false | undefined): string {
  if (!zone) return '';
  if (zone === 'wild') return t('label.place.wild');
  const key = `label.place.zone.${zone}`;
  const word = t(key);
  return word === key ? zone : word;
}

export function placeFar(t: T, meters: number): string {
  if (meters < 3) return t('label.place.here');
  const n = meters < 1000
    ? t('label.place.m', meters < 100 ? Math.round(meters) : Math.round(meters / 10) * 10)
    : t('label.place.km', (meters / 1000).toFixed(1).replace(/\.0$/, ''));
  return t('label.place.away', n);
}

export function placeText(t: T, zone: string | false | undefined, meters: number | null): string {
  const name = placeName(t, zone);
  const far = meters === null ? '' : placeFar(t, meters);
  return name && far ? `${name}${t('label.place.sep')}${far}` : name || far;
}

const flat = (a: Point, b: Point) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null);

/** Words for the given points; re-renders when Lua answers. The returned function words any point (asked or not). */
export function useWhere(points: Point[]): (c: Point) => string {
  const app = useApp();
  const { t } = useI18n();
  const [ver, bump] = useState(0);
  const key = points.map((c) => (c ? cellOf(c) : '-')).join(',');
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    waiting.add(fn);
    return () => { waiting.delete(fn); };
  }, []);
  useEffect(() => {
    points.forEach((c) => { if (c && typeof c.x === 'number' && typeof c.y === 'number') ask(c); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const me: Coords | undefined = app.self?.coords;
  return useMemo(() => (c: Point) => {
    if (!c || typeof c.x !== 'number' || typeof c.y !== 'number') return t('label.place.unknown');
    ask(c);
    return placeText(t, zoneOf(c), flat(c, me));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, me?.x, me?.y, key, ver]);
}

/** «ينقصه: الاسم و المكان» or '' when nothing is missing */
export function missingLine(t: T, missing: string[]): string {
  if (!missing.length) return '';
  const and = t('label.place.and');
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(t("label.place.comma"))}${and}${missing[missing.length - 1]}`;
  return t('label.place.missing', list);
}
