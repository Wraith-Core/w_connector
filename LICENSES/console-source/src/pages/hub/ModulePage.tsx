/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/hub/ModulePage.tsx
 * One script's settings (route: hub?resource=w_hud&group=needs), drawn from its w_settings schema:
 *   header    the script's name + "؟", one plain line, [All scripts] [Open its own panel] [Reload]
 *   sections  one per group (a dot when it holds unsaved edits, the number of changed values),
 *             + "One player's needs" for w_hud, + "Change history"
 *   body      a form (SettingRow per field) or a table (one row per item), or a plugged editor
 *             (pages/hub/<folder>/index.tsx, see extend.ts)
 *   SaveBar   "You have 3 unsaved changes [Discard] [Save and apply to everyone]" → a review dialog in
 *             plain sentences (+ "I understand" for heavy groups) → apply (compare-and-set)
 * w_hud without the protocol yet uses the built-in adapter (hudAdapter.ts) over the old save path.
 * The draft of each script is kept while the panel is open, so leaving a page never loses edits.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useApp } from '../../ctx';
import { useI18n } from '../../i18n';
import { isMock } from '../../nui';
import {
  Button, DataTable, EmptyState, HelpTip, InlineAlert, LockLine, PageHeader, SaveBar, Section, SettingsLayout, Skeleton, Switch, Tag,
  fmtAgo, fmtDate, inlineHelp,
} from '../../kit';
import type { Column, SettingsNavItem } from '../../kit';
import type {
  HudCfg, ModuleDescriptor, SettingsApplyResult, SettingsAudit, SettingsChange, SettingsGroup, SettingsSchema, SettingsValues,
} from '../../types';
import { fetchHistory, fetchSchema, fetchValues } from './api';
import { DraftStore, useDraftVersion } from './draft';
import type { DraftBase } from './draft';
import { editorFor } from './extend';
import { HUD, hudApply, hudSchema, hudValues } from './hudAdapter';
import { fmtValue, groupOfKey, isTableGroup, levelOk, rankOf } from './model';
import { maxLevel } from './access';
import PlayerNeeds from './PlayerNeeds';
import SettingsForm from './SettingsForm';
import SettingsTable from './SettingsTable';

const DRAFTS = new Map<string, DraftStore>();
const draftOf = (resource: string) => {
  let d = DRAFTS.get(resource);
  if (!d) { d = new DraftStore(); DRAFTS.set(resource, d); }
  return d;
};

type Source = 'loading' | 'remote' | 'builtin' | 'none';
const PLAYER = 'player';
const HISTORY = 'history';

function basesOf(group: SettingsGroup, v: SettingsValues): [string, DraftBase][] {
  const out: [string, DraftBase][] = [];
  for (const f of group.fields) {
    if (f.type === 'table') {
      for (const row of v.rows ?? []) {
        for (const col of f.columns ?? []) {
          out.push([`${f.key}.${row.id}.${col.key}`, {
            value: row.cells[col.key] ?? null, def: row.defaults[col.key] ?? null, field: col, group: group.id,
            row: row.id, rowLabel: row.label, locked: !!row.locked,
          }]);
        }
      }
    } else {
      out.push([f.key, { value: v.values[f.key] ?? null, def: v.defaults[f.key] ?? null, field: f, group: group.id }]);
    }
  }
  return out;
}

/* ── the review dialog body ──────────────────────────────────────────────── */

interface ReviewLine { key: string; group: string; where: string; from: string; to: string }

function Review({ lines, warnings, heavy, value, set }: { lines: ReviewLine[]; warnings: string[]; heavy: boolean; value: boolean; set(v: boolean): void }) {
  const { t, rtl } = useI18n();
  const arrow = rtl ? '←' : '→';
  return (
    <div className="hub-review">
      <p className="hub-review-lead">{t('label.hub.review.lead')}</p>
      <ul className="hub-review-list">
        {lines.map((l) => (
          <li key={l.key}>
            <span className="hub-review-where"><span className="k-faint">{l.group} › </span>{l.where}</span>
            <span className="hub-review-change"><span className="k-dim">{l.from}</span> <span aria-hidden="true">{arrow}</span> <b>{l.to}</b></span>
          </li>
        ))}
      </ul>
      {warnings.map((w) => <p className="hub-review-warn" key={w}>{w}</p>)}
      {heavy && (
        <div className="hub-review-ok">
          <Switch checked={value} onChange={set} label={t('label.hub.review.understand')} help="help.hub.module.understand" onText={t('label.common.yes')} offText={t('label.common.no')} />
          <span>{t('label.hub.review.understand')}</span>
        </div>
      )}
    </div>
  );
}

/* ── the history section ─────────────────────────────────────────────────── */

function History({ resource, schema, store }: { resource: string; schema: SettingsSchema; store: DraftStore }) {
  const { t, lt, lang } = useI18n();
  const [list, setList] = useState<SettingsAudit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    const r = await fetchHistory(resource);
    if (r.ok) setList(Array.isArray(r.data) ? [...r.data].sort((a, b) => b.at - a.at) : []);
    else { setList([]); setError(t(r.error ?? 'label.common.loadError')); }
  }, [resource, t]);
  useEffect(() => { void load(); }, [load]);

  const fieldOf = (key: string) => {
    const g = groupOfKey(schema, key);
    if (!g) return undefined;
    const direct = g.fields.find((f) => f.key === key);
    if (direct) return { g, f: direct, row: '' };
    const table = g.fields.find((f) => f.type === 'table');
    const col = table?.columns?.find((c) => key.endsWith(`.${c.key}`));
    const row = table && col ? key.slice((table.key.length + 1), key.length - col.key.length - 1) : '';
    return col ? { g, f: col, row } : undefined;
  };

  const columns = useMemo<Column<SettingsAudit>[]>(() => [
    { key: 'when', label: t('label.hub.history.when'), help: 'help.hub.history.when', width: '12rem', sort: true, value: (a) => a.at,
      render: (a) => <span className="k-stack k-stack--tight"><span className="k-num">{fmtDate(a.at)}</span><span className="k-cell-sub">{fmtAgo(t, lang, a.at)}</span></span> },
    { key: 'who', label: t('label.hub.history.who'), help: 'help.hub.history.who', width: '10rem', sort: true, value: (a) => a.by,
      render: (a) => <span>{a.by}{a.cid ? <span className="k-cell-sub k-num">{a.cid}</span> : null}</span> },
    { key: 'key', label: t('label.hub.history.key'), help: 'help.hub.history.key',
      render: (a) => {
        const x = fieldOf(a.key);
        const rowLabel = store.baseOf(a.key)?.rowLabel;
        const row = x?.row ? `${rowLabel ? lt(rowLabel) : x.row} · ` : '';
        return <span><span className="k-cell-main">{x ? `${lt(x.g.label)} › ${row}${lt(x.f.label)}` : a.key}</span><span className="k-cell-sub k-mono">{a.key}</span></span>;
      } },
    { key: 'change', label: t('label.hub.history.change'), help: 'help.hub.history.change',
      render: (a) => {
        const f = fieldOf(a.key)?.f;
        const to = a.new === undefined || a.new === null ? t('label.hub.history.original') : fmtValue(f, a.new, t, lt);
        return <span className="hub-review-change"><span className="k-dim">{fmtValue(f, a.old ?? null, t, lt)}</span> <span aria-hidden="true">{lang === 'ar' ? '←' : '→'}</span> <b>{to}</b></span>;
      } },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, lt, lang, schema]);

  return (
    <Section title={t('label.hub.module.history')} help="help.hub.module.history" tone="plain" className="hub-history">
      {error && <InlineAlert tone="warn" title={t('label.common.loadError')}>{error}</InlineAlert>}
      <DataTable
        label={t('label.hub.module.history')}
        columns={columns}
        rows={list ?? []}
        rowKey={(a) => `${a.batch}:${a.key}:${a.at}`}
        loading={list === null}
        empty={<EmptyState text={t('label.hub.history.empty')} />}
      />
    </Section>
  );
}

/* ── the page ────────────────────────────────────────────────────────────── */

export interface ModulePageProps {
  resource: string;
  mod: ModuleDescriptor | undefined;
  /** the module list is still arriving */
  listLoading: boolean;
  group?: string;
  onBack(): void;
  onGroup(group: string): void;
  onOpen(resource: string, link?: string): void;
  opening: string | null;
}

export default function ModulePage({ resource, mod, listLoading, group: groupParam, onBack, onGroup, onOpen, opening }: ModulePageProps) {
  const app = useApp();
  const { t, lt } = useI18n();
  const rank = rankOf(app);
  const isHud = resource === HUD;
  /* browser mock only: ?via=builtin shows the built-in w_hud adapter even though the mock has a schema */
  const forceBuiltin = isHud && isMock() && app.route.params.via === 'builtin';
  const store = useMemo(() => draftOf(resource), [resource]);
  useDraftVersion(store);

  const [source, setSource] = useState<Source>('loading');
  const [schema, setSchema] = useState<SettingsSchema | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, SettingsValues>>({});
  const [groupError, setGroupError] = useState<Record<string, string>>({});
  const [rejected, setRejected] = useState<SettingsApplyResult['rejected']>([]);
  const [saving, setSaving] = useState(false);

  /* the schema: the script's own (w_settings), else the built-in w_hud adapter */
  useEffect(() => {
    let alive = true;
    setSource('loading'); setSchema(null); setValues({}); setLoadError(null); setRejected([]);
    /* w_hud's source depends on its descriptor (settings or not): wait for the list */
    if (listLoading && isHud && !forceBuiltin) return () => { alive = false; };
    (async () => {
      const wantRemote = !forceBuiltin && (!!mod?.settings || !isHud);
      if (wantRemote) {
        const r = await fetchSchema(resource);
        if (!alive) return;
        if (r.ok && r.data && Array.isArray(r.data.groups)) { setSchema(r.data); setSource('remote'); return; }
        if (!isHud) { setLoadError(r.error ? t(r.error) : null); setSource('none'); return; }
      }
      if (isHud) { setSchema(hudSchema()); setSource('builtin'); app.refresh('hud'); return; }
      setSource('none');
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource, !!mod?.settings, listLoading, forceBuiltin]);

  /* the sections: the schema's groups, then w_hud's player needs, then the history */
  const nav = useMemo(() => {
    const out: { id: string; group?: SettingsGroup }[] = (schema?.groups ?? []).map((g) => ({ id: g.id, group: g }));
    if (isHud && app.can('needs')) out.push({ id: PLAYER });
    if (source === 'remote') out.push({ id: HISTORY });
    return out;
  }, [schema, isHud, source, app]);
  const active = nav.find((n) => n.id === groupParam) ?? nav[0];
  const activeGroup = active?.group;

  /* a group's values: fetched once per visit (remote) or read from the live blob (built-in) */
  const loadGroup = useCallback(async (g: SettingsGroup, force = false) => {
    if (source !== 'remote') return;
    if (!force && values[g.id]) return;
    const r = await fetchValues(resource, g.id);
    if (r.ok && r.data) {
      const v = r.data;
      setValues((m) => ({ ...m, [g.id]: v }));
      setGroupError((m) => { const n = { ...m }; delete n[g.id]; return n; });
      store.load(basesOf(g, v));
    } else {
      setGroupError((m) => ({ ...m, [g.id]: r.error ? t(r.error) : t('label.common.loadError') }));
    }
  }, [source, values, resource, store, t]);

  useEffect(() => {
    if (activeGroup && source === 'remote') void loadGroup(activeGroup);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup?.id, source]);

  const hudCfg = app.hudCfg as HudCfg | null;
  const builtinValues = useMemo(() => {
    if (source !== 'builtin' || !schema) return {};
    const out: Record<string, SettingsValues> = {};
    for (const g of schema.groups) out[g.id] = hudValues(hudCfg, g.id);
    return out;
  }, [source, schema, hudCfg]);
  useEffect(() => {
    if (source !== 'builtin' || !schema || !hudCfg) return;
    store.load(schema.groups.flatMap((g) => basesOf(g, builtinValues[g.id])));
  }, [source, schema, hudCfg, builtinValues, store]);

  const valuesOf = (g: SettingsGroup | undefined): SettingsValues | undefined => (g ? (source === 'builtin' ? (hudCfg ? builtinValues[g.id] : undefined) : values[g.id]) : undefined);

  /* permissions: the page (area), then each group's level */
  const pageArea = source === 'builtin' ? 'hud' : 'settings';
  const canPage = app.can(pageArea);
  const levelOfGroup = (g: SettingsGroup | undefined) => maxLevel(schema?.level, g?.level);
  const readOnlyOf = (g: SettingsGroup | undefined) => !canPage || !levelOk(rank, levelOfGroup(g)) || (source === 'builtin' && !hudCfg);

  /* ── save ──────────────────────────────────────────────────────────────── */
  const count = store.size;
  const invalid = count > 0 ? store.invalid() : [];

  const apply = async (changes: SettingsChange[]) => {
    setSaving(true);
    try {
      if (source === 'builtin') {
        const edits = changes.map((c) => ({ key: c.key, value: c.reset ? store.baseOf(c.key)?.def ?? null : c.to ?? null }));
        const r = await app.act<{ cfg?: HudCfg }>('hud', { action: 'save', cfg: hudApply(hudCfg, edits) }, { okText: t('label.hub.saved') });
        if (r.ok) {
          const saved = r.data?.cfg ?? hudApply(hudCfg, edits);
          store.load((schema?.groups ?? []).flatMap((g) => basesOf(g, hudValues(saved, g.id))));
          store.clearAll();
          setRejected([]);
        }
        return;
      }
      const r = await app.act<SettingsApplyResult>('settings', { action: 'apply', resource, changes }, { okText: t('label.hub.saved') });
      const touched = new Set(changes.map((c) => store.baseOf(c.key)?.group).filter((x): x is string => !!x));
      if (r.ok) {
        const applied = r.data?.applied ?? [];
        /* the values in effect now: what the script answered, or what was sent */
        const next: [string, DraftBase][] = [];
        for (const c of changes) {
          const b = store.baseOf(c.key);
          if (!b) continue;
          const got = applied.find((a) => a.key === c.key);
          next.push([c.key, { ...b, value: got ? got.value : c.reset ? b.def : c.to ?? null }]);
        }
        store.load(next);
        store.clearAll();
        setRejected([]);
      } else {
        setRejected(r.data?.rejected ?? []);
      }
      /* fresh values (who changed it, the drift bases, a stale value) for every touched group */
      setValues((m) => { const n = { ...m }; for (const g of touched) delete n[g]; return n; });
      for (const g of schema?.groups ?? []) if (touched.has(g.id) && g.id === activeGroup?.id) void loadGroup(g, true);
    } finally {
      setSaving(false);
    }
  };

  const review = () => {
    if (!schema) return;
    if (invalid.length) { app.toast('error', t('label.hub.module.invalid', invalid.length)); return; }
    const changes = store.changes();
    const lines: ReviewLine[] = [];
    const warnings = new Set<string>();
    for (const c of changes) {
      const b = store.baseOf(c.key);
      if (!b) continue;
      const g = schema.groups.find((x) => x.id === b.group);
      if (g?.confirm) warnings.add(lt(g.confirm));
      if (b.field.confirm) warnings.add(lt(b.field.confirm));
      if (b.field.danger) warnings.add(lt(b.field.danger));
      lines.push({
        key: c.key,
        group: g ? lt(g.label) : '',
        where: b.rowLabel ? `${lt(b.rowLabel)} · ${lt(b.field.label)}` : lt(b.field.label),
        from: fmtValue(b.field, c.from, t, lt),
        to: c.reset ? t('label.hub.review.reset', fmtValue(b.field, b.def, t, lt)) : fmtValue(b.field, c.to ?? null, t, lt),
      });
    }
    const heavy = warnings.size > 0;
    app.confirm<boolean>({
      title: t('label.hub.review.title'),
      help: 'help.hub.module.review',
      initial: false,
      render: ({ value, set }) => <Review lines={lines} warnings={Array.from(warnings)} heavy={heavy} value={value} set={set} />,
      canConfirm: (v) => !heavy || v === true,
      confirmLabel: t('label.hub.review.save'),
      onConfirm: () => { void apply(changes); },
    });
  };

  /* ── header ────────────────────────────────────────────────────────────── */
  const title = schema ? lt(schema.title) : mod ? lt(mod.label) : resource;
  const links = schema?.links ?? [];
  const headActions: ReactNode = (
    <>
      <Button help="help.hub.module.back" kind="ghost" icon="arrow" className="hub-back" onClick={onBack}>{t('label.hub.module.back')}</Button>
      {links.map((l) => (
        <Button
          key={l.id}
          help={inlineHelp(l.help, { undo: undefined })}
          icon="external"
          area="scripts"
          disabled={!levelOk(rank, l.level) || !!mod?.panel?.locked}
          busy={opening === `${resource}:${l.id}` || (source === 'builtin' && opening === resource)}
          /* the built-in w_hud link is the script's own panel route (/hudmenu): no link id needed */
          onClick={() => (source === 'builtin' ? onOpen(resource) : onOpen(resource, l.id))}
        >
          {lt(l.label)}
        </Button>
      ))}
      {links.length === 0 && mod?.panel && (
        <Button help="help.hub.open" icon="external" area="scripts" disabled={!!mod.panel.locked} busy={opening === resource} onClick={() => onOpen(resource)}>{t('label.hub.open')}</Button>
      )}
      {activeGroup && source !== 'loading' && (app.can(source === 'builtin' ? 'hud' : 'settings') || (isHud && app.can('needs'))) && (
        <Button
          help="help.hub.module.reload"
          kind="ghost"
          icon="refresh"
          onClick={() => { if (source === 'builtin') app.refresh('hud'); else void loadGroup(activeGroup, true); }}
        >
          {t('label.hub.module.reload')}
        </Button>
      )}
    </>
  );
  const header = (
    <PageHeader
      title={title}
      help={mod ? inlineHelp(mod.help) : schema ? inlineHelp(schema.description) : 'help.shell.page.hub'}
      description={schema ? lt(schema.description) : mod ? lt(mod.description) : undefined}
      actions={headActions}
      className="hub-head"
    />
  );

  if (source === 'loading') {
    return <div className="hub-root">{header}<div className="hub-pad"><Skeleton rows={8} /><p className="k-faint">{t('label.hub.module.loading')}</p></div></div>;
  }
  if (source === 'none' || !schema) {
    return (
      <div className="hub-root">
        {header}
        <div className="hub-pad">
          <EmptyState
            text={loadError ?? t('label.hub.module.notFound')}
            next={<Button help="help.hub.module.back" onClick={onBack}>{t('label.hub.module.back')}</Button>}
          />
        </div>
      </div>
    );
  }
  if (!canPage && !(isHud && app.can('needs'))) {
    return (
      <div className="hub-root">
        {header}
        <div className="hub-pad">
          <EmptyState
            text={<LockLine level={app.levelOf(pageArea)} />}
            next={<Button help="help.hub.module.back" onClick={onBack}>{t('label.hub.module.back')}</Button>}
          />
        </div>
      </div>
    );
  }

  /* ── sections ──────────────────────────────────────────────────────────── */
  const navItems: SettingsNavItem[] = nav.map((n) => {
    if (n.id === PLAYER) return { id: n.id, label: t('label.hud.group.player'), help: 'help.hud.group.player', area: 'needs' };
    if (n.id === HISTORY) return { id: n.id, label: t('label.hub.module.history'), help: 'help.hub.module.history' };
    const g = n.group as SettingsGroup;
    const dirty = store.countIn(g.id);
    const over = values[g.id] ? Object.keys(values[g.id].overridden ?? {}).length : 0;
    return {
      id: g.id,
      label: lt(g.label),
      help: inlineHelp(g.help),
      dirty: dirty > 0,
      badge: dirty > 0 ? dirty : over > 0 ? over : null,
    };
  });

  let body: ReactNode;
  if (active?.id === PLAYER) body = <PlayerNeeds />;
  else if (active?.id === HISTORY) body = <History resource={resource} schema={schema} store={store} />;
  else if (activeGroup) {
    const v = valuesOf(activeGroup);
    const ro = readOnlyOf(activeGroup);
    const Editor = editorFor(resource, activeGroup.id)?.component;
    const err = groupError[activeGroup.id];
    body = (
      <div className="hub-group">
        <Section
          title={lt(activeGroup.label)}
          help={inlineHelp(activeGroup.help)}
          lead={lt(activeGroup.help)}
          tone="plain"
          className="hub-group-head"
          actions={(
            <span className="hub-group-tags">
              {ro && canPage && <Tag>{t('label.hub.module.readOnly')}</Tag>}
              {levelOfGroup(activeGroup) && <Tag tone="faint">{t('label.common.orHigher', t(`label.common.level.${levelOfGroup(activeGroup)}`))}</Tag>}
            </span>
          )}
        />
        {ro && canPage && !levelOk(rank, levelOfGroup(activeGroup)) && (
          <InlineAlert tone="info" title={t('label.hub.module.readOnly')} help="help.hub.module.readOnly">
            <LockLine level={levelOfGroup(activeGroup)} />
          </InlineAlert>
        )}
        {source === 'builtin' && <p className="hub-note">{t('label.hub.module.builtinNote')}</p>}
        {rejected.length > 0 && (
          <InlineAlert tone="danger" title={t('label.hub.reject.other')} help="help.hub.module.rejected" onDismiss={() => setRejected([])}>
            <ul className="hub-rejects">
              {rejected.map((x) => {
                const b = store.baseOf(x.key);
                const where = b ? (b.rowLabel ? `${lt(b.rowLabel)} · ${lt(b.field.label)}` : lt(b.field.label)) : x.key;
                const reason = t(`label.hub.reject.${x.reason}`);
                return <li key={x.key}><b>{where}</b>: {reason.startsWith('label.') ? t('label.hub.reject.other') : reason}</li>;
              })}
            </ul>
          </InlineAlert>
        )}
        {v?.orphans && v.orphans.length > 0 && (
          <InlineAlert tone="info" title={t('label.hub.module.orphans')} help="help.hub.module.orphans">
            <span className="k-mono">{v.orphans.join('  ·  ')}</span>
          </InlineAlert>
        )}
        {err && (
          <InlineAlert tone="warn" title={t('label.common.loadError')} actions={<Button help="help.common.retry" size="sm" onClick={() => void loadGroup(activeGroup, true)}>{t('label.common.retry')}</Button>}>
            {err}
          </InlineAlert>
        )}
        {source === 'builtin' && !hudCfg && (
          <InlineAlert tone="warn" title={t('label.hub.module.noHudCfg')} actions={<Button help="help.hub.module.reload" size="sm" onClick={() => app.refresh('hud')}>{t('label.hub.module.reload')}</Button>} />
        )}
        {!v && !err && !(source === 'builtin' && !hudCfg) && <Skeleton rows={6} />}
        {v && (Editor
          ? <Editor resource={resource} schema={schema} group={activeGroup} values={v} draft={store} readOnly={ro} reload={() => void loadGroup(activeGroup, true)} />
          : isTableGroup(activeGroup)
            ? <SettingsTable group={activeGroup} values={v} store={store} readOnly={ro} />
            : <SettingsForm group={activeGroup} values={v} store={store} readOnly={ro} level={levelOfGroup(activeGroup)} />)}
      </div>
    );
  }

  return (
    <div className="hub-root">
      {header}
      <SettingsLayout
        nav={navItems}
        value={active?.id ?? ''}
        onChange={onGroup}
        navTitle={t('label.hub.module.nav')}
        className="hub-settings"
        footer={(
          <SaveBar
            count={count}
            onDiscard={() => { store.clearAll(); setRejected([]); }}
            onSave={review}
            saving={saving}
            saveLabel={t('label.hub.review.save')}
            saveHelp="help.hub.module.save"
            area={pageArea}
            note={invalid.length > 0 ? <span className="hub-hintline"><span className="hub-invalid">{t('label.hub.module.invalid', invalid.length)}</span><HelpTip help="help.hub.module.invalid" size="sm" /></span> : undefined}
          />
        )}
      >
        {body}
      </SettingsLayout>
    </div>
  );
}
