/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/dashboard/recent.ts
 * The newest admin-log lines for a small panel (the dashboard's "recent actions", the World page's
 * "latest world changes"): one post('logs', LogQuery) when it opens, then the lines Lua pushes live
 * ('logEntry' → app.recentLogs) are merged on top. Nothing is asked without the 'logs' area.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../ctx';
import { useI18n } from '../../i18n';
import { post } from '../../nui';
import type { LogEntry, LogPage, LogQuery } from '../../types';

export interface RecentOptions {
  limit: number;
  /** the runner kind ('server', 'player', …) */
  kind?: string;
  /** keep only these lines (e.g. weather / time / announce) */
  match?(e: LogEntry): boolean;
}

export function useRecentLogs({ limit, kind, match }: RecentOptions) {
  const app = useApp();
  const { t } = useI18n();
  const allowed = app.can('logs');
  const [list, setList] = useState<LogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const matchRef = useRef(match);
  matchRef.current = match;

  const load = useCallback(async () => {
    if (!allowed) return;
    setError(null);
    /* ask for more than shown: a filter may drop some */
    const q: LogQuery = { kind, limit: match ? limit * 4 : limit };
    const r = await post<LogPage>('logs', q);
    if (r.ok && r.data && Array.isArray(r.data.list)) setList(r.data.list);
    else { setList((l) => l ?? []); setError(t(r.error ?? 'ui_failed')); }
  }, [allowed, kind, limit, t]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => {
    if (list === null) return null;
    const seen = new Set<number>();
    const out: LogEntry[] = [];
    for (const e of [...app.recentLogs, ...list]) {
      if (!e || typeof e.id !== 'number' || seen.has(e.id)) continue;
      seen.add(e.id);
      if (kind && e.kind !== kind) continue;
      if (matchRef.current && !matchRef.current(e)) continue;
      out.push(e);
    }
    return out.sort((a, b) => b.at - a.at || b.id - a.id).slice(0, limit);
  }, [list, app.recentLogs, kind, limit]);

  return { rows, error, reload: load, allowed };
}
