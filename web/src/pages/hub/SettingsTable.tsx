/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/hub/SettingsTable.tsx
 * A table group (one row per item: satchels, horse food, and food until its own editor lands):
 * search, family chips, "changed only", one editable cell per column (each cell re-renders on its
 * own), the value in effect vs the original, a locked row with its reason, and "restore the row".
 * ════════════════════════════════════════════════════════════════════════════ */

import { useMemo, useState } from 'react';
import { useApp } from '../../ctx';
import { useI18n } from '../../i18n';
import { DataTable, EmptyState, FilterChips, IconButton, TextInput, Toolbar, cls, inlineHelp } from '../../kit';
import type { Column } from '../../kit';
import type { SettingsField, SettingsGroup, SettingsRow, SettingsValues } from '../../types';
import { useCell, useDraftVersion } from './draft';
import type { DraftStore } from './draft';
import FieldControl from './FieldControl';
import { derivedHint, fmtValue, sameValue, tableOf } from './model';

const cellKey = (table: string, row: string, col: string) => `${table}.${row}.${col}`;

function Cell({ store, k, col, row, label, readOnly }: { store: DraftStore; k: string; col: SettingsField; row: SettingsRow; label: string; readOnly: boolean }) {
  const { t, lt, lang } = useI18n();
  const cell = useCell(store, k);
  const def = cell.base?.def;
  const changed = !sameValue(cell.value, def);
  const hint = col.derived ? derivedHint(col, () => undefined, t, lang, cell.value) : null;
  return (
    <span className={cls('hub-cell', cell.dirty && 'is-dirty', changed && 'is-changed', cell.invalid && 'is-invalid')}>
      <FieldControl store={store} cellKey={k} field={col} compact label={label} disabled={readOnly || !!row.locked} />
      {changed && def !== undefined && <span className="hub-cell-def">{t('label.hub.table.orig', fmtValue(col, def, t, lt))}</span>}
      {hint && <span className="hub-cell-hint">{hint}</span>}
    </span>
  );
}

function RowReset({ store, keys, label, readOnly }: { store: DraftStore; keys: string[]; label: string; readOnly: boolean }) {
  const { t } = useI18n();
  useDraftVersion(store);
  const differs = keys.some((k) => !sameValue(store.valueOf(k), store.baseOf(k)?.def));
  if (!differs || readOnly) return null;
  return (
    <IconButton
      icon="reset"
      size="sm"
      aria-label={`${t('label.hub.table.rowReset')}: ${label}`}
      help="help.hub.table.rowReset"
      onClick={() => { for (const k of keys) store.reset(k); }}
    />
  );
}

export default function SettingsTable({ group, values, store, readOnly }: { group: SettingsGroup; values: SettingsValues; store: DraftStore; readOnly: boolean }) {
  const { t, lt } = useI18n();
  const app = useApp();
  const table = tableOf(group);
  const tkey = table?.key ?? group.id;
  const cols = useMemo(() => (table?.columns ?? []), [table]);
  const [q, setQ] = useState('');
  const [fam, setFam] = useState('all');
  const version = useDraftVersion(store);
  const rows = values.rows ?? [];

  const families = table?.families ?? [];
  const famItems = useMemo(() => {
    const count = (id: string) => rows.filter((r) => r.family === id).length;
    return [
      { id: 'all', label: t('label.hub.table.all'), count: rows.length, help: 'help.hub.table.all' as const },
      ...families.filter((f) => count(f.id) > 0).map((f) => ({ id: f.id, label: lt(f.label), count: count(f.id), help: 'help.hub.table.family' as const })),
      { id: 'changed', label: t('label.hub.table.changed'), help: 'help.hub.table.changed' as const },
    ];
  }, [rows, families, t, lt]);

  const shown = useMemo(() => {
    const s = q.trim().toLocaleLowerCase();
    return rows.filter((r) => {
      if (fam === 'changed') {
        if (!cols.some((c) => { const k = cellKey(tkey, r.id, c.key); return !!store.entryOf(k) || !sameValue(store.valueOf(k), store.baseOf(k)?.def); })) return false;
      } else if (fam !== 'all' && r.family !== fam) return false;
      if (!s) return true;
      return `${r.id} ${r.label.ar} ${r.label.en}`.toLocaleLowerCase().includes(s);
    });
    // version: "changed only" follows the draft
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, fam, cols, tkey, fam === 'changed' ? version : 0]);

  const columns = useMemo<Column<SettingsRow>[]>(() => [
    {
      key: 'item', label: t('label.hub.table.item'), help: 'help.hub.table.item', sort: true, value: (r) => lt(r.label), width: '15rem',
      render: (r) => (
        <span className="hub-item">
          <span className="hub-item-text">
            <span className="k-cell-main">{lt(r.label)}</span>
            <span className="k-cell-sub k-mono">{r.id}</span>
            {r.locked && <span className="hub-item-lock">{lt(r.locked)}</span>}
          </span>
          <RowReset store={store} keys={cols.map((c) => cellKey(tkey, r.id, c.key))} label={lt(r.label)} readOnly={readOnly || !!r.locked} />
        </span>
      ),
    },
    ...(table?.readOnly ?? []).map((ro) => ({
      key: `ro:${ro.key}`, label: lt(ro.label), help: 'help.hub.table.readOnly' as const,
      render: (r: SettingsRow) => {
        const v = r.cells[ro.key];
        const fam = families.find((f) => f.id === r.family);
        return <span className="k-dim">{v !== undefined && v !== null ? String(v) : fam ? lt(fam.label) : '—'}</span>;
      },
    })),
    ...cols.map((c) => ({
      key: c.key, label: `${lt(c.label)}${c.unit ? ` (${lt(c.unit)})` : ''}`, help: inlineHelp(c.help, { example: c.example, warn: c.danger }),
      facts: c.type === 'number' && (c.min !== undefined || c.max !== undefined)
        ? { range: { min: c.min, max: c.max, unit: c.unit ? lt(c.unit) : undefined } }
        : undefined,
      className: 'hub-col',
      render: (r: SettingsRow) => (
        <Cell store={store} k={cellKey(tkey, r.id, c.key)} col={c} row={r} label={`${lt(r.label)} · ${lt(c.label)}`} readOnly={readOnly} />
      ),
    })),
  ], [cols, table, tkey, store, readOnly, families, t, lt]);

  return (
    <div className="hub-table">
      <Toolbar>
        <TextInput value={q} onChange={setQ} icon="search" clearable placeholder={t('label.hub.table.search')} label={t('label.hub.table.search')} help="help.hub.table.search" className="hub-search" />
        {famItems.length > 2 || rows.length > 8 ? <FilterChips label={t('label.hub.table.families')} value={fam} onChange={setFam} items={famItems} /> : null}
        <span className="k-push k-faint">{t('label.hub.table.rows', shown.length)}</span>
      </Toolbar>
      <DataTable
        label={lt(group.label)}
        columns={columns}
        rows={shown}
        rowKey={(r) => r.id}
        rowClass={(r) => (r.locked ? 'hub-row-locked' : undefined)}
        density={app.prefs.density}
        mode="detail"
        defaultSort={undefined}
        empty={<EmptyState text={t('label.hub.table.empty')} />}
      />
    </div>
  );
}
