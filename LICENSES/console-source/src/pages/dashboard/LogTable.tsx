/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/dashboard/LogTable.tsx
 * A short admin-log table (when · who · what). A line opens its target: the online player on the
 * Players page, otherwise the character (by citizen id) on the Characters page.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useApp } from '../../ctx';
import type { AppCtx } from '../../ctx';
import { useI18n } from '../../i18n';
import { DataTable, EmptyState, cls, fmtAgo, fmtDate } from '../../kit';
import type { Column } from '../../kit';
import type { LogEntry } from '../../types';
import { actionLabel } from '../log/labels';
import ServerLine from '../log/ServerLine';

/** Where a log line leads, or null when it has no player / character */
export function logTarget(app: AppCtx, e: LogEntry): (() => void) | null {
  const tg = e.target;
  if (!tg) return null;
  if (typeof tg.source === 'number' && app.can('players') && app.players.some((p) => p.id === tg.source)) {
    const sel = tg.source;
    return () => app.navigate('players', { sel: String(sel) });
  }
  if (tg.citizenid && app.can('characters')) {
    const cid = tg.citizenid;
    return () => app.navigate('characters', { cid });
  }
  return null;
}

export default function LogTable({ rows, label, empty, error, className }: {
  rows: LogEntry[] | null;
  label: string;
  empty: ReactNode;
  error?: string | null;
  className?: string;
}) {
  const app = useApp();
  const { t, lang } = useI18n();
  const cols = useMemo<Column<LogEntry>[]>(() => [
    {
      key: 'when', label: t('label.dashboard.col.when'), help: 'help.dashboard.col.when', width: '9.5rem',
      render: (e) => <span className="k-dim" title={fmtDate(e.at)}>{fmtAgo(t, lang, e.at)}</span>,
    },
    {
      key: 'admin', label: t('label.dashboard.col.admin'), help: 'help.dashboard.col.admin', width: '9rem',
      render: (e) => <span className="k-strong">{e.admin?.name || '—'}</span>,
    },
    {
      key: 'what', label: t('label.dashboard.col.what'), help: 'help.dashboard.col.what', className: 'dsh-col-what',
      /* the page's language first (what, to whom), then the line as the server wrote it (its language) */
      render: (e) => {
        const who = e.target?.name || e.target?.citizenid;
        return (
          <>
            <span className={cls('k-cell-main dsh-what', e.ok === false && 'is-failed')}>
              {actionLabel(t, e.action)}
              {who ? <> · <bdi>{who}</bdi></> : null}
              {e.target?.citizenid && e.target.name ? <span className="dsh-cid"> · {t('label.log.cid', e.target.citizenid)}</span> : null}
            </span>
            {e.text && <ServerLine className="k-cell-sub dsh-what dsh-raw" text={e.text} />}
          </>
        );
      },
    },
  ], [t, lang]);
  return (
    <DataTable<LogEntry>
      columns={cols}
      rows={rows ?? []}
      rowKey={(e) => e.id}
      label={label}
      loading={rows === null && !error}
      /* a failed load shows the error, not "nothing yet" (it only yields to lines that arrived live) */
      error={rows && rows.length > 0 ? null : error ?? null}
      onSelect={(e) => { const go = logTarget(app, e); if (go) go(); }}
      density="comfortable"
      rowClass={(e) => (logTarget(app, e) ? undefined : 'dsh-row-plain')}
      empty={<EmptyState text={empty} />}
      className={className}
    />
  );
}
