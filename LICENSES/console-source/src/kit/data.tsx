/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · kit/data.tsx
 *   DataTable   columns { key, label, help, priority 'essential' | 'detail', num, sort, render }
 *               sticky header · working essential / detailed modes (B5) · comfortable / compact rows ·
 *               ↑ ↓ keyboard selection · ONE delegated click handler (the player list refreshes every 2 s)
 *               · empty / loading / error states
 *   KeyValue / KeyValueList (ids are LTR with a copy button) · CopyButton
 *   StatTile · Meter (monochrome, red under 20 %) · StatusChip (text + shape, never colour alone) · Tag
 *   EmptyState (always offers the next step) · Skeleton · Loading · InlineAlert
 * ════════════════════════════════════════════════════════════════════════════ */

import { memo, useCallback, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import HelpTip from '../help/HelpTip';
import type { HelpFacts, HelpProp } from '../help/types';
import { useI18n } from '../i18n';
import { Button, IconButton } from './Button';
import { clamp, cls, copyText, fmtNum } from './format';

/* ── DataTable ───────────────────────────────────────────────────────────── */

export interface Column<T> {
  key: string;
  label: string;
  help: HelpProp;
  /** 'detail' columns show only in the detailed mode */
  priority?: 'essential' | 'detail';
  /** numbers: aligned to the end, Latin digits, LTR */
  num?: boolean;
  /** a comparator, or true to sort by value() */
  sort?: ((a: T, b: T) => number) | true;
  /** the sort key when sort === true */
  value?(row: T): string | number;
  width?: string;
  render(row: T): ReactNode;
  className?: string;
  /** the facts block of the column's note ("allowed −50 to 100", "default 0", the level) */
  facts?: HelpFacts;
}

export interface SortState { key: string; dir: 'asc' | 'desc' }

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey(row: T): string | number;
  /** aria-label of the table */
  label: string;
  selectedKey?: string | number | null;
  onSelect?(row: T): void;
  mode?: 'essential' | 'detail';
  density?: 'comfortable' | 'compact';
  /** controlled sort (omit for internal) */
  sort?: SortState | null;
  onSort?(s: SortState | null): void;
  defaultSort?: SortState;
  loading?: boolean;
  error?: string | null;
  onRetry?(): void;
  /** shown when rows is empty (use <EmptyState text next />) */
  empty?: ReactNode;
  rowClass?(row: T): string | undefined;
  className?: string;
}

interface RowProps<T> { row: T; cols: Column<T>[]; k: string; selected: boolean; extra?: string }
function RowImpl<T>({ row, cols, k, selected, extra }: RowProps<T>) {
  return (
    <tr data-k={k} className={cls(selected && 'is-selected', extra)} aria-selected={selected}>
      {cols.map((c) => <td key={c.key} className={cls(c.num && 'is-num', c.className)}>{c.render(row)}</td>)}
    </tr>
  );
}
const Row = memo(RowImpl) as typeof RowImpl;

export function DataTable<T>(p: DataTableProps<T>) {
  const { t } = useI18n();
  const [innerSort, setInnerSort] = useState<SortState | null>(p.defaultSort ?? null);
  const sort = p.sort !== undefined ? p.sort : innerSort;
  const setSort = (s: SortState | null) => { if (p.onSort) p.onSort(s); else setInnerSort(s); };
  const cols = useMemo(() => p.columns.filter((c) => (p.mode ?? 'essential') === 'detail' || c.priority !== 'detail'), [p.columns, p.mode]);
  const sorted = useMemo(() => {
    if (!sort) return p.rows;
    const col = p.columns.find((c) => c.key === sort.key);
    if (!col || !col.sort) return p.rows;
    const cmp = col.sort === true
      ? (a: T, b: T) => {
        const va = col.value ? col.value(a) : ''; const vb = col.value ? col.value(b) : '';
        return typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      }
      : col.sort;
    const out = [...p.rows].sort(cmp);
    return sort.dir === 'desc' ? out.reverse() : out;
  }, [p.rows, p.columns, sort]);
  const byKey = useMemo(() => {
    const m = new Map<string, T>();
    for (const r of sorted) m.set(String(p.rowKey(r)), r);
    return m;
  }, [sorted, p.rowKey]);
  const wrap = useRef<HTMLDivElement>(null);

  const onClick = useCallback((e: MouseEvent<HTMLTableSectionElement>) => {
    const tr = (e.target as HTMLElement).closest('tr[data-k]') as HTMLElement | null;
    if (!tr || !p.onSelect) return;
    if ((e.target as HTMLElement).closest('button, a, input, [role="switch"]')) return;
    const row = byKey.get(tr.dataset.k ?? '');
    if (row) p.onSelect(row);
  }, [byKey, p.onSelect]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!p.onSelect || sorted.length === 0) return;
    if (e.target !== wrap.current) return;
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const i = sorted.findIndex((r) => p.rowKey(r) === p.selectedKey);
    let j = i;
    if (e.key === 'ArrowDown') j = i < 0 ? 0 : clamp(i + 1, 0, sorted.length - 1);
    if (e.key === 'ArrowUp') j = i < 0 ? 0 : clamp(i - 1, 0, sorted.length - 1);
    if (e.key === 'Home') j = 0;
    if (e.key === 'End') j = sorted.length - 1;
    p.onSelect(sorted[j]);
    wrap.current?.querySelector(`tr[data-k="${CSS.escape(String(p.rowKey(sorted[j])))}"]`)?.scrollIntoView({ block: 'nearest' });
  };

  return (
    <div
      ref={wrap}
      className={cls('k-table-wrap', `k-table--${p.density ?? 'comfortable'}`, p.className)}
      tabIndex={p.onSelect ? 0 : undefined}
      onKeyDown={onKey}
      aria-label={p.label}
    >
      <table className="k-table" aria-label={p.label}>
        <thead>
          <tr>
            {cols.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th key={c.key} className={cls(c.num && 'is-num', c.className)} style={c.width ? { width: c.width } : undefined} aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  <span className="k-th">
                    {c.sort ? (
                      <button type="button" className={cls('k-th-sort', active && 'is-active')} onClick={() => setSort(active && sort!.dir === 'desc' ? null : { key: c.key, dir: active ? 'desc' : 'asc' })}>
                        {c.label}
                        <span className="k-th-arrow" aria-hidden="true">{active ? (sort!.dir === 'asc' ? '▲' : '▼') : ''}</span>
                      </button>
                    ) : <span>{c.label}</span>}
                    <HelpTip help={c.help} label={c.label} facts={c.facts} size="sm" />
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody onClick={onClick}>
          {!p.loading && !p.error && sorted.map((r) => {
            const k = String(p.rowKey(r));
            return <Row key={k} row={r} cols={cols} k={k} selected={p.selectedKey !== undefined && p.selectedKey !== null && String(p.selectedKey) === k} extra={p.rowClass?.(r)} />;
          })}
        </tbody>
      </table>
      {p.loading && <Skeleton rows={6} />}
      {!p.loading && p.error && (
        <InlineAlert tone="warn" title={t('label.common.loadError')} actions={p.onRetry && <Button help="help.common.retry" size="sm" onClick={p.onRetry}>{t('label.common.retry')}</Button>}>
          {p.error}
        </InlineAlert>
      )}
      {!p.loading && !p.error && sorted.length === 0 && (p.empty ?? <EmptyState text={t('label.common.empty')} />)}
    </div>
  );
}

/* ── KeyValue ────────────────────────────────────────────────────────────── */

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <IconButton
      icon={done ? 'check' : 'copy'}
      aria-label={done ? t('label.common.copied') : `${t('label.common.copy')}${label ? `: ${label}` : ''}`}
      help={false}
      size="sm"
      onClick={() => { if (copyText(value)) { setDone(true); window.setTimeout(() => setDone(false), 1400); } }}
    />
  );
}

export interface KeyValueProps {
  label: string;
  help: HelpProp;
  value: ReactNode;
  /** the text the copy button copies */
  copy?: string;
  /** Latin ids: left-to-right, tabular */
  ltr?: boolean;
  facts?: HelpFacts;
}

export function KeyValue({ label, help, value, copy, ltr, facts }: KeyValueProps) {
  return (
    <div className="k-kv">
      <dt className="k-kv-k">
        <span>{label}</span>
        <HelpTip help={help} label={label} facts={facts} size="sm" />
      </dt>
      <dd className="k-kv-v">
        <span className={cls(ltr && 'k-ltr k-num')}>{value === null || value === undefined || value === '' ? '—' : value}</span>
        {copy && <CopyButton value={copy} label={label} />}
      </dd>
    </div>
  );
}

export function KeyValueList({ children, columns = 1, className }: { children: ReactNode; columns?: 1 | 2 | 3; className?: string }) {
  return <dl className={cls('k-kvlist', `k-kvlist--${columns}`, className)}>{children}</dl>;
}

/* ── StatTile / Meter / StatusChip / Tag ─────────────────────────────────── */

export interface StatTileProps {
  label: string;
  help: HelpProp;
  value: ReactNode;
  sub?: ReactNode;
  onClick?(): void;
  /** the value is a number: set in RDR Catalogue (KPIs only) */
  numeric?: boolean;
  critical?: boolean;
}

export function StatTile({ label, help, value, sub, onClick, numeric = true, critical }: StatTileProps) {
  const body = (
    <>
      <span className="k-stat-label">{label}</span>
      <span className={cls('k-stat-value', numeric && 'is-kpi', critical && 'is-critical')}>{value}</span>
      {sub && <span className="k-stat-sub">{sub}</span>}
    </>
  );
  return (
    <div className={cls('k-stat', onClick && 'is-link')}>
      {onClick ? <button type="button" className="k-stat-btn" onClick={onClick}>{body}</button> : <div className="k-stat-btn">{body}</div>}
      <HelpTip help={help} label={label} size="sm" className="k-stat-help" />
    </div>
  );
}

export function Meter({ value, max = 100, label, showValue = true, className }: { value: number | null | undefined; max?: number; label?: string; showValue?: boolean; className?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className={cls('k-meter is-none', className)}>—</span>;
  const pct = max > 0 ? clamp((value / max) * 100, 0, 100) : 0;
  return (
    <span className={cls('k-meter', pct < 20 && 'is-low', className)} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(value)} aria-label={label}>
      <span className="k-meter-bar"><span className="k-meter-fill" style={{ width: `${pct}%` }} /></span>
      {showValue && <b className="k-num">{fmtNum(value)}</b>}
    </span>
  );
}

export type Status = 'ok' | 'low' | 'dead' | 'frozen' | 'blocked' | 'offline' | 'online' | 'stopped' | 'running';

/** Text + shape: well ■ · low needs □ · dead ◆ (red) · frozen ◇ · blocked ⊘ · stopped ◆ (red) */
/** label: a text, or a node (a number with direction marks: "240 ms", "15%") */
export function StatusChip({ status, label, className }: { status: Status; label?: ReactNode; className?: string }) {
  const { t } = useI18n();
  return (
    <span className={cls('k-status', `k-status--${status}`, className)}>
      <i className="k-status-shape" aria-hidden="true" />
      <span>{label ?? t(`label.common.status.${status}`)}</span>
    </span>
  );
}

export function Tag({ children, tone = 'plain', className }: { children: ReactNode; tone?: 'plain' | 'strong' | 'danger' | 'faint'; className?: string }) {
  return <span className={cls('k-tag', `k-tag--${tone}`, className)}>{children}</span>;
}

/* ── states ──────────────────────────────────────────────────────────────── */

export function EmptyState({ text, next, className }: { text: ReactNode; next?: ReactNode; className?: string }) {
  return (
    <div className={cls('k-empty', className)}>
      <p>{text}</p>
      {next && <div className="k-empty-next">{next}</div>}
    </div>
  );
}

export function Skeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cls('k-skeleton', className)} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => <span key={i} style={{ width: `${88 - ((i * 17) % 40)}%` }} />)}
    </div>
  );
}

export function Loading({ text, className }: { text?: string; className?: string }) {
  const { t } = useI18n();
  return (
    <div className={cls('k-loading', className)} role="status">
      <span className="k-spinner" aria-hidden="true" />
      <span>{text ?? t('label.common.loading')}</span>
    </div>
  );
}

export interface InlineAlertProps {
  tone?: 'info' | 'warn' | 'danger';
  title?: ReactNode;
  children?: ReactNode;
  onDismiss?(): void;
  actions?: ReactNode;
  help?: HelpProp;
  className?: string;
}

export function InlineAlert({ tone = 'info', title, children, onDismiss, actions, help, className }: InlineAlertProps) {
  const { t } = useI18n();
  return (
    <div className={cls('k-alert', `k-alert--${tone}`, className)} role={tone === 'info' ? 'status' : 'alert'}>
      <div className="k-alert-body">
        {title && (
          <p className="k-alert-title">
            <span>{title}</span>
            {help !== undefined && help !== false && <HelpTip help={help} label={typeof title === 'string' ? title : undefined} size="sm" />}
          </p>
        )}
        {children && <div className="k-alert-text">{children}</div>}
        {actions && <div className="k-alert-actions">{actions}</div>}
      </div>
      {onDismiss && <IconButton icon="close" aria-label={t('label.common.close')} help="help.common.dismiss" size="sm" onClick={onDismiss} />}
    </div>
  );
}
