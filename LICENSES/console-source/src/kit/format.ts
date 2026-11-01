/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · kit/format.ts
 * Numbers stay Latin digits in both languages (tabular), money is plain text ("$" or the word gold),
 * durations are written out ("1 day · 5 hours · 24 minutes").
 * ════════════════════════════════════════════════════════════════════════════ */

import { countOf } from '../i18n';
import type { TFn } from '../i18n';
import type { Coords, Lang } from '../types';
import { PERMANENT_BAN } from '../types';

export const cls = (...parts: (string | false | null | undefined | 0)[]) => parts.filter(Boolean).join(' ');

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export const fmtNum = (n: number | null | undefined, digits = 0): string => {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
};

/** '$1,250.50' */
export const fmtCash = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(n) ? '—' : `$${n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: n % 1 ? 2 : 0 })}`;

/** '4.25 ذهب' / '4.25 gold' */
export const fmtGold = (t: TFn, n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(n) ? '—' : `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${t('label.common.gold')}`;

/** seconds → '1 يوم · 5 ساعات · 24 دقيقة' (the largest two or three parts) */
export function fmtDuration(t: TFn, lang: Lang, seconds: number, parts = 3): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const out: string[] = [];
  if (d) out.push(countOf(t, lang, d, 'day'));
  if (h) out.push(countOf(t, lang, h, 'hour'));
  if (m || out.length === 0) out.push(countOf(t, lang, m, 'minute'));
  return out.slice(0, parts).join(' · ');
}

/** minutes → '3 أيام' / 'Permanent' (0) */
export function fmtMinutes(t: TFn, lang: Lang, minutes: number): string {
  if (!minutes) return t('label.common.duration.permanent');
  return fmtDuration(t, lang, minutes * 60, 2);
}

/** unix seconds → 'قبل 3 ساعات' / '3 hours ago' */
export function fmtAgo(t: TFn, lang: Lang, unix: number, now = Date.now() / 1000): string {
  const diff = Math.max(0, now - unix);
  if (diff < 45) return t('label.common.justNow');
  return t('label.common.ago', fmtDuration(t, lang, diff, 1));
}

export const pad2 = (n: number) => String(Math.max(0, Math.floor(n))).padStart(2, '0');

/** unix seconds or an ISO / MySQL date string → 'YYYY-MM-DD HH:MM' */
export const fmtDate = (v: number | string | null | undefined): string => {
  if (v === null || v === undefined || v === 0 || v === '') return '—';
  const d = typeof v === 'number' ? new Date(v * 1000) : new Date(String(v).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(v);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/** B2: a ban is permanent when expire is 0 or the server's far-future stamp */
export const isPermanentBan = (expire: number | null | undefined) => !expire || expire >= PERMANENT_BAN;

export const distance = (a: Coords | undefined | null, b: Coords | undefined | null): number | null => {
  if (!a || !b) return null;
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

export const fmtDist = (m: number | null): string => {
  if (m === null) return '—';
  if (m < 1000) return `${fmtNum(m)} m`;
  return `${fmtNum(m / 1000, 1)} km`;
};

export const fmtCoords = (c: Coords | undefined | null, digits = 1): string =>
  c ? `${c.x.toFixed(digits)}, ${c.y.toFixed(digits)}, ${c.z.toFixed(digits)}` : '—';

/** vector3(x, y, z) text for copying */
export const vec3 = (c: Coords, digits = 2) => `vector3(${c.x.toFixed(digits)}, ${c.y.toFixed(digits)}, ${c.z.toFixed(digits)})`;
export const vec4 = (c: Coords, digits = 2) => `vector4(${c.x.toFixed(digits)}, ${c.y.toFixed(digits)}, ${c.z.toFixed(digits)}, ${c.heading.toFixed(digits)})`;

export const isTypingTarget = (el: EventTarget | null): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
};

/** Copies text inside CEF, where navigator.clipboard is often missing: a hidden textarea + execCommand */
export function copyText(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) return true;
  } catch { /* fall through */ }
  try {
    void navigator.clipboard?.writeText(text);
    return true;
  } catch {
    return false;
  }
}

let seq = 0;
/** A stable unique id for aria links (useId exists too; this one works outside React) */
export const uid = (p = 'k') => `${p}-${++seq}`;

/* ── citizen id (mirror of w_lib w.citizen.parse, so a field can refuse a malformed id before asking) ── */

const DIGITS: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '＃': '#',
};

export type CitizenParse = { kind: 'citizen'; id: string } | { kind: 'server'; id: number } | { kind: 'self' } | null;

/** '12' | ' 012 ' | '١٢' → citizen '12'; 'omg95204' → 'OMG95204'; '#7' → server 7; 'me' → self; else null */
export function parseCitizen(input: string): CitizenParse {
  if (typeof input !== 'string') return null;
  let s = input.replace(/[​-‏‪-‮⁦-⁩﻿ ]/g, ' ');
  s = s.replace(/[٠-٩۰-۹＃]/g, (c) => DIGITS[c] ?? c).trim();
  if (!s) return null;
  if (s.toLowerCase() === 'me') return { kind: 'self' };
  const server = /^#\s*(\d{1,5})$/.exec(s);
  if (server) {
    const n = parseInt(server[1], 10);
    return n >= 1 && n <= 65535 ? { kind: 'server', id: n } : null;
  }
  if (/^\d{1,9}$/.test(s)) {
    const n = s.replace(/^0+/, '');
    return n ? { kind: 'citizen', id: n } : null;
  }
  if (/^[A-Za-z]{3}\d{5}$/.test(s)) return { kind: 'citizen', id: s.toUpperCase() };
  if (/^[A-Za-z0-9:_-]{1,64}$/.test(s)) return { kind: 'citizen', id: s };
  return null;
}
