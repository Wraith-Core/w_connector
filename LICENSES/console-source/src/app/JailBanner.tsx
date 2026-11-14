/* ════════════════════════════════════════════════════════════════════════════
 * w_connector · app/JailBanner.tsx  (2.8.0, the admin jail on the jailed player's screen)
 * Not part of the admin pages: every player has this page loaded (ui_page), so a jailed player sees a small
 * note at the top of his screen: «سجن إداري», the time left (counted down here every second) and the reason.
 * Lua: client/cl_jail.lua sends { action: 'jail', data: { left (seconds), reason } }; left 0 hides it
 * (freed: true shows «انتهى سجنك» for a few seconds). The server holds him (ops/jail.lua); this only shows it.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react';
import { FALLBACK, format } from '../i18n';
import type { Lang } from '../types';
import './jail.css';

const lang = (): Lang => (document.documentElement.lang === 'en' ? 'en' : 'ar');
const tx = (key: string, ...args: (string | number)[]) => {
  const l = lang();
  return format(FALLBACK[l][key] ?? FALLBACK.ar[key] ?? key, args);
};

/** 3725 -> 1:02:05, 125 -> 2:05 */
const clock = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
};

export default function JailBanner() {
  const [left, setLeft] = useState(0);
  const [reason, setReason] = useState('');
  const [freed, setFreed] = useState(false);
  const ends = useRef(0);

  useEffect(() => {
    let freedTimer = 0;
    const onMsg = (e: MessageEvent) => {
      const m = (e.data || {}) as { action?: string; data?: { left?: number; reason?: string; freed?: boolean } };
      if (m.action !== 'jail') return;
      const d = m.data ?? {};
      const secs = Math.max(0, Math.floor(Number(d.left) || 0));
      ends.current = secs > 0 ? Date.now() + secs * 1000 : 0;
      setLeft(secs);
      if (typeof d.reason === 'string') setReason(d.reason);
      if (secs > 0) { setFreed(false); return; }
      if (d.freed) {
        setFreed(true);
        window.clearTimeout(freedTimer);
        freedTimer = window.setTimeout(() => setFreed(false), 6000);
      }
    };
    window.addEventListener('message', onMsg);
    const tick = window.setInterval(() => {
      if (ends.current > 0) setLeft(Math.max(0, Math.ceil((ends.current - Date.now()) / 1000)));
    }, 1000);
    return () => { window.removeEventListener('message', onMsg); window.clearInterval(tick); window.clearTimeout(freedTimer); };
  }, []);

  if (left <= 0 && !freed) return null;
  const rtl = lang() === 'ar';
  return (
    <div className="jail-banner" dir={rtl ? 'rtl' : 'ltr'} role="status" aria-live="polite">
      {left > 0 ? (
        <>
          <span className="jail-title">{tx('label.jail.title')}</span>
          <span className="jail-left">{tx('label.jail.left', clock(left))}</span>
          {reason && <span className="jail-reason">{tx('label.jail.reason', reason)}</span>}
          <span className="jail-hint">{tx('label.jail.hint')}</span>
        </>
      ) : (
        <span className="jail-title">{tx('label.jail.freed')}</span>
      )}
    </div>
  );
}
