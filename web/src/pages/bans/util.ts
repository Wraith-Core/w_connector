/* w_admin · pages/bans/util.ts: ban state (B2: 0 or the far-future stamp = permanent) and a ticking clock */

import { useEffect, useState } from 'react';
import { isPermanentBan } from '../../kit';
import type { BanEntry } from '../../types';

export type BanState = 'permanent' | 'temporary' | 'expired';

export const nowSec = (): number => Math.floor(Date.now() / 1000);

export function banState(b: BanEntry, now: number): BanState {
  if (isPermanentBan(b.expire)) return 'permanent';
  return b.expire > now ? 'temporary' : 'expired';
}

/** Unix seconds, re-read every `ms` so "in 2 hours" and "ended" stay right while the page is open */
export function useNow(ms = 30000): number {
  const [now, setNow] = useState(nowSec);
  useEffect(() => {
    const id = window.setInterval(() => setNow(nowSec()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/** 'license:3f9a2c1d7e4b58a0aa11' → 'license:3f9a…aa11' (the full value is in the drawer, with copy) */
export function shortLicense(v: string | null | undefined): string {
  if (!v) return '—';
  const i = v.indexOf(':');
  const head = i >= 0 ? v.slice(0, i + 1) : '';
  const body = i >= 0 ? v.slice(i + 1) : v;
  return body.length > 12 ? `${head}${body.slice(0, 6)}…${body.slice(-4)}` : v;
}
