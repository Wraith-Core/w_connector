/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/hub/food/FoodEditor.tsx
 * The Food & drink editor (X1), plugged into the Scripts hub's settings page for w_hud › food through
 * pages/hub/extend.ts. The hub page owns the shared draft, the SaveBar, the review dialog and the
 * apply (compare-and-set); this editor only writes edits into the draft:
 *   search · family chips + "changed" · essential / all columns · inline edit with the value it
 *   replaces · the original of a saved change · per-row restore · bulk edit (× + =) on what is shown ·
 *   the "what this means" line for the cell in focus · drift (the code default moved after an edit)
 * One exception writes at once: "keep mine" on a drift notice re-saves the SAME value (nothing changes
 * for players; it only records the new default as the reference) and asks for the group again.
 * ════════════════════════════════════════════════════════════════════════════ */

import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useApp } from '../../../ctx';
import { useI18n } from '../../../i18n';
import {
  Button, ButtonRow, DataTable, EmptyState, FilterChips, HelpTip, InlineAlert, Segmented, TextInput, Toolbar, cls, fmtAgo, inlineHelp,
} from '../../../kit';
import type { ChipItem, Column } from '../../../kit';
import { post } from '../../../nui';
import type { SettingValue, SettingsField, SettingsRow, SettingsValues } from '../../../types';
import { useCell, useDraftVersion } from '../draft';
import type { DraftStore } from '../draft';
import type { GroupEditorProps } from '../extend';
import FieldControl from '../FieldControl';
import { fmtValue } from '../model';
import { openBulk } from './BulkDialog';
import { cellKey, driftOf, hintFor, same, tableSpec } from './model';
import type { DriftItem, TableSpec } from './model';
import './food.css';

const norm = (s: string) => s.toLocaleLowerCase().normalize('NFKD').replace(/[ً-ٰٟ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه');

/** The value of one key of the draft (a hook that re-renders only when that value changes) */
function useValue(store: DraftStore, key: string | null): SettingValue | undefined {
  return useSyncExternalStore(store.subscribe, () => (key ? store.valueOf(key) : undefined));
}

/* ── one cell: the control + one short line under it ─────────────────────── */

interface CellProps { store: DraftStore; table: string; row: SettingsRow; col: SettingsField; readOnly: boolean; onFocus(row: string, col: string): void }

const FoodCell = memo(function FoodCell({ store, table, row, col, readOnly, onFocus }: CellProps) {
  const { t, lt } = useI18n();
  const key = cellKey(table, row.id, col.key);
  const cell = useCell(store, key);
  const depKey = col.key === 'buffAmount' ? cellKey(table, row.id, 'buffType') : col.key === 'fxTime' ? cellKey(table, row.id, 'fx') : null;
  const dep = useValue(store, depKey);
  if (row.locked) return <span className="fd-dash" aria-hidden="true">—</span>;
  const dependentOff = depKey !== null && (dep === 'none' || dep === undefined);
  const isReset = cell.entry?.reset === true;
  const isDraft = !!cell.entry && !isReset;
  const isOver = row.overridden.includes(col.key) && !cell.entry;
  const base = cell.base;
  return (
    <span
      className={cls('fd-cell', isDraft && 'is-draft', isReset && 'is-reset', isOver && 'is-over', cell.invalid && 'is-rejected', dependentOff && 'is-dependent')}
      onFocusCapture={() => onFocus(row.id, col.key)}
    >
      <FieldControl store={store} cellKey={key} field={col} compact label={`${lt(row.label)} · ${lt(col.label)}`} disabled={readOnly || dependentOff} />
      {cell.invalid ? <small className="fd-note fd-note--bad">{t(`label.food.invalid.${cell.invalid}`)}</small>
        : isDraft && base ? <small className="fd-note">{t('label.food.was', fmtValue(col, base.value, t, lt))}</small>
          : isReset && base ? <small className="fd-note">{t('label.food.restoreQueued', fmtValue(col, base.def, t, lt))}</small>
            : isOver && base ? <small className="fd-note fd-note--faint">{t('label.food.original', fmtValue(col, base.def, t, lt))}</small>
              : null}
    </span>
  );
});

/** "Restore" for one row: shown while the row differs from its original (saved or not) */
function RowRestore({ store, keys, row, readOnly }: { store: DraftStore; keys: string[]; row: SettingsRow; readOnly: boolean }) {
  const { t, lt } = useI18n();
  const differs = useSyncExternalStore(store.subscribe, () => keys.some((k) => {
    const b = store.baseOf(k);
    return !!store.entryOf(k) || (b ? !same(b.value, b.def) : false);
  }));
  if (!differs || readOnly || row.locked) return null;
  return (
    <Button kind="ghost" size="sm" icon="reset" help={false} aria-label={`${t('label.food.restore')}: ${lt(row.label)}`}
      onClick={() => { for (const k of keys) store.reset(k); }}>
      {t('label.food.restore')}
    </Button>
  );
}

/* ── the editor ──────────────────────────────────────────────────────────── */

export default function FoodEditor({ resource, group, values, draft, readOnly, reload }: GroupEditorProps) {
  const app = useApp();
  const { t, lt, lang } = useI18n();
  const version = useDraftVersion(draft);
  const spec: TableSpec | null = useMemo(() => tableSpec(group), [group]);
  /* an empty Lua table reaches the page as [] or {}: a row's `overridden` is always a list here */
  const rows = useMemo(() => (values.rows ?? []).map((r) => (Array.isArray(r.overridden) ? r : { ...r, overridden: [] })), [values]);
  const [search, setSearch] = useState('');
  const [chip, setChip] = useState('all');
  const [mode, setMode] = useState<'essential' | 'detail'>('essential');
  const [focus, setFocus] = useState<{ row: string; col: string } | null>(null);
  const [ctx, setCtx] = useState<Record<string, SettingValue>>({});
  const [showDrift, setShowDrift] = useState(true);

  /* the script's form values (buff pulse, gilding time, poison) for the "what this means" line */
  useEffect(() => {
    let alive = true;
    void post<SettingsValues>('settings', { action: 'values', resource }).then((r) => { if (alive && r.ok && r.data) setCtx(r.data.values ?? {}); });
    return () => { alive = false; };
  }, [resource, values]);

  const table = spec?.key ?? group.id;
  const cols = useMemo(() => spec?.columns ?? [], [spec]);
  const onFocus = useCallback((row: string, col: string) => setFocus((f) => (f && f.row === row && f.col === col ? f : { row, col })), []);
  const familyLabel = useCallback((id?: string) => {
    const f = spec?.families.find((x) => x.id === id);
    return f ? lt(f.label) : '';
  }, [spec, lt]);

  /* a row that differs from its original, saved or not (the "changed" chip follows the draft) */
  const rowDiffers = useCallback((r: SettingsRow) => r.overridden.length > 0 || cols.some((c) => !!draft.entryOf(cellKey(table, r.id, c.key))), [cols, draft, table]);

  const filtered = useMemo(() => {
    const q = norm(search.trim());
    return rows.filter((r) => {
      if (chip === 'changed' && !rowDiffers(r)) return false;
      if (chip !== 'all' && chip !== 'changed' && r.family !== chip) return false;
      if (!q) return true;
      return norm(`${r.label.ar} ${r.label.en} ${r.id} ${familyLabel(r.family)}`).includes(q);
    });
    // version: "changed" follows the draft
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, chip, search, familyLabel, rowDiffers, chip === 'changed' ? version : 0]);

  const chips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.family ?? '', (counts.get(r.family ?? '') ?? 0) + 1);
    const items: ChipItem[] = [{ id: 'all', label: t('label.food.all'), count: rows.length, help: 'help.food.chipAll' }];
    for (const f of spec?.families ?? []) {
      const n = counts.get(f.id) ?? 0;
      if (n > 0) items.push({ id: f.id, label: lt(f.label), count: n, help: 'help.food.chipFamily' });
    }
    items.push({ id: 'changed', label: t('label.food.changed'), count: rows.filter(rowDiffers).length, help: 'help.food.chipChanged' });
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, spec, t, lt, rowDiffers, version]);

  const columns: Column<SettingsRow>[] = useMemo(() => {
    const list: Column<SettingsRow>[] = [{
      key: '__item',
      label: t('label.food.item'),
      help: 'help.food.item',
      sort: true,
      value: (r) => lt(r.label),
      width: '16.5rem',
      render: (r) => {
        let by: string | undefined; let at: number | undefined;
        for (const c of r.overridden) {
          const o = values.overridden?.[cellKey(table, r.id, c)];
          if (o && (at === undefined || o.at > at)) { at = o.at; by = o.by; }
        }
        return (
          <span className={cls('fd-item', r.locked && 'is-locked')}>
            <span className="fd-img" aria-hidden="true">
              {r.image && <img src={r.image} alt="" loading="lazy" onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />}
            </span>
            <span className="fd-name">
              <b className="k-ellipsis">{lt(r.label)}</b>
              <small>{r.locked ? lt(r.locked) : familyLabel(r.family)} · <span dir="ltr" className="fd-id">{r.id}</span></small>
              {at ? <small className="fd-edited">{t('label.food.lastEdit', by || '—', fmtAgo(t, lang, at))}</small> : null}
            </span>
          </span>
        );
      },
    }];
    for (const col of cols) {
      list.push({
        key: col.key,
        label: col.unit ? `${lt(col.label)} (${lt(col.unit)})` : lt(col.label),
        help: inlineHelp(col.help, { example: col.example, warn: col.danger, undo: t('label.food.cellUndo') }),
        /* the column's note says what a cell accepts ("allowed −50 to 100") */
        facts: col.type === 'number' && (col.min !== undefined || col.max !== undefined)
          ? { range: { min: col.min, max: col.max, unit: col.unit ? lt(col.unit) : undefined } }
          : undefined,
        priority: col.advanced ? 'detail' : 'essential',
        sort: true,
        value: (r) => {
          const v = draft.valueOf(cellKey(table, r.id, col.key));
          return typeof v === 'number' ? v : String(v ?? '');
        },
        render: (r) => <FoodCell store={draft} table={table} row={r} col={col} readOnly={readOnly} onFocus={onFocus} />,
      });
    }
    list.push({
      key: '__restore',
      label: t('label.food.restore'),
      help: 'help.food.restoreRow',
      width: '7.5rem',
      render: (r) => <RowRestore store={draft} keys={cols.map((c) => cellKey(table, r.id, c.key))} row={r} readOnly={readOnly} />,
    });
    return list;
  }, [cols, table, draft, readOnly, onFocus, values, t, lt, lang, familyLabel]);

  /* drift: the code default changed after an admin's edit */
  const drift = useMemo(() => (spec ? driftOf(spec, values) : []), [spec, values]);
  const keepMine = async (d: DriftItem) => {
    const r = await app.act('settings', { action: 'apply', resource, changes: [{ key: d.key, from: d.mine, to: d.mine }] }, { okText: t('label.food.kept') });
    if (r.ok) reload();
  };
  const takeNew = (d: DriftItem) => {
    draft.reset(d.key);
    app.toast('inform', t('label.food.takeNewQueued', lt(d.row.label)));
  };

  const bulk = () => {
    if (!spec) return;
    openBulk({
      app, t, lt, spec, mode,
      rows: filtered,
      valueOf: (k) => draft.valueOf(k),
      scope: chip === 'all' ? t('label.food.all') : chip === 'changed' ? t('label.food.changed') : familyLabel(chip),
      onApply: (plan) => { for (const p of plan) draft.set(p.key, p.to); },
    });
  };

  /* the "what this means" line (follows the draft as the admin types) */
  const preview = useMemo(() => {
    if (!focus) return null;
    const row = rows.find((r) => r.id === focus.row);
    const col = cols.find((c) => c.key === focus.col);
    if (!row || !col || row.locked) return null;
    const k = cellKey(table, row.id, col.key);
    const optionOf = (c: string, v: SettingValue | undefined) => fmtValue(cols.find((x) => x.key === c) ?? col, v ?? null, t, lt);
    const h = hintFor(group.id, col, draft.valueOf(k), draft.baseOf(k)?.value, ctx, lt(row.label), optionOf, (c) => draft.valueOf(cellKey(table, row.id, c)));
    return t(h.key, ...h.args);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, rows, cols, table, group.id, ctx, t, lt, draft, version]);

  if (!spec) return <EmptyState text={t('label.food.noTable')} />;

  return (
    <div className="fd-editor">
      {drift.length > 0 && showDrift && (
        <InlineAlert tone="warn" title={t('label.food.driftTitle', drift.length)} help="help.food.drift" onDismiss={() => setShowDrift(false)}>
          <ul className="fd-drift">
            {drift.slice(0, 4).map((d) => (
              <li key={d.key}>
                <span>{t('label.food.driftLine', lt(d.row.label), lt(d.col.label), fmtValue(d.col, d.base, t, lt), fmtValue(d.col, d.now, t, lt), fmtValue(d.col, d.mine, t, lt))}</span>
                <ButtonRow>
                  <Button size="sm" help="help.food.keepMine" disabled={readOnly} onClick={() => void keepMine(d)}>{t('label.food.keepMine')}</Button>
                  <Button size="sm" kind="ghost" help="help.food.takeNew" disabled={readOnly} onClick={() => takeNew(d)}>{t('label.food.takeNew')}</Button>
                </ButtonRow>
              </li>
            ))}
          </ul>
          {drift.length > 4 && <p className="fd-more">{t('label.food.driftMore', drift.length - 4)}</p>}
        </InlineAlert>
      )}

      <Toolbar className="fd-toolbar">
        <TextInput
          value={search} onChange={setSearch} placeholder={t('label.food.search')} icon="search" clearable
          label={t('label.food.searchLabel')} help="help.food.search" className="fd-search"
        />
        <Segmented
          value={mode} onChange={setMode} size="sm" label={t('label.food.columns')} help="help.food.columns"
          options={[{ value: 'essential', label: t('label.food.colsEssential') }, { value: 'detail', label: t('label.food.colsAll') }]}
        />
        <span className="fd-toolbar-end">
          <span className="fd-count k-num">{t('label.food.shown', filtered.length, rows.length)}</span>
          <Button help="help.food.bulk" icon="sliders" onClick={bulk} disabled={readOnly || filtered.length === 0}>{t('label.food.bulk')}</Button>
        </span>
      </Toolbar>
      <FilterChips items={chips} value={chip} onChange={setChip} label={t('label.food.families')} className="fd-chips" />

      <div className="fd-table">
        <DataTable<SettingsRow>
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          label={lt(group.label)}
          mode={mode}
          density={app.prefs.density}
          selectedKey={focus?.row ?? null}
          onSelect={(r) => setFocus((f) => ({ row: r.id, col: f?.col ?? cols[0]?.key ?? '' }))}
          rowClass={(r) => cls(r.locked && 'is-locked', rowDiffers(r) && 'is-changed')}
          empty={<EmptyState text={t('label.food.empty')} next={search ? <Button help="help.food.clearSearch" onClick={() => setSearch('')}>{t('label.food.clearSearch')}</Button> : undefined} />}
        />
      </div>

      <div className="fd-preview" role="status" aria-live="polite">
        <span className="fd-preview-label">
          {t('label.food.previewLabel')}
          <HelpTip help="help.food.preview" label={t('label.food.previewLabel')} size="sm" />
        </span>
        <span className="fd-preview-text">{preview ?? t('label.food.previewIdle')}</span>
      </div>
    </div>
  );
}
