/* Small helpers shared by the tabs */

import type { Coords } from '../types';

export const cls = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/** Numbers stay Latin digits in both languages (the numerals font has no Arabic-Indic set) */
export const fmtNum = (n: number, digits = 0): string => {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
};

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export const pad2 = (n: number) => String(Math.max(0, Math.floor(n))).padStart(2, '0');

export const distance = (a: Coords | undefined, b: Coords | undefined): number | null => {
  if (!a || !b) return null;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

export const fmtDist = (m: number | null): string => {
  if (m === null) return '—';
  if (m < 1000) return `${fmtNum(m)} m`;
  return `${fmtNum(m / 1000, 1)} km`;
};

export const fmtCoords = (c: Coords | undefined, digits = 1): string =>
  c ? `${c.x.toFixed(digits)}, ${c.y.toFixed(digits)}, ${c.z.toFixed(digits)}` : '—';

/** unix seconds or an ISO/MySQL date string → a short local date */
export const fmtDate = (v: number | string | null | undefined): string => {
  if (v === null || v === undefined || v === 0 || v === '') return '—';
  const d = typeof v === 'number' ? new Date(v * 1000) : new Date(String(v).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(v);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

export const nowSec = () => Math.floor(Date.now() / 1000);

export const toInt = (v: string | number, fallback = 0): number => {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

export const toFloat = (v: string | number, fallback = 0): number => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

export const isTypingTarget = (el: EventTarget | null): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
};
