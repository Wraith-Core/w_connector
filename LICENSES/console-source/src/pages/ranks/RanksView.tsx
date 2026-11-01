/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/ranks/RanksView.tsx
 * The Ranks tab: the list (colour dot, label, fixed name, members, a lock on the master rank) and the
 * editor in the drawer:
 *   name (only while creating) · label · colour (+ ready colours) · order
 *   the catalogue: one Section per group, a Switch per node (its key, its words, "Dangerous")
 *   extra permissions typed by hand (any valid node the catalogue does not list), removable tags
 *   Save / Discard / Delete (type the name when it has members)
 * The master rank (protected) is shown read only: it holds every permission.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../ctx';
import { useI18n } from '../../i18n';
import {
  Button, DataTable, Drawer, EmptyState, Field, Glyph, HelpTip, IconButton, InlineAlert, KeyValue, KeyValueList, NumberInput,
  Section, Select, SplitView, Switch, Tag, TextInput, Toolbar, cls, fmtNum,
} from '../../kit';
import type { Column, HelpProp } from '../../kit';
import type { Send } from './RanksPage';
import {
  MAX_PERMS, PRESETS, colorOk, draftOf, labelOk, nameOk, nodeIndex, nodeProblem, safeColor, sameDraft, sortOk, toState,
} from './model';
import type { CatalogNode, Draft, RankRow, RanksState } from './model';

/** The key of the "new rank" editor (a rank name can never hold a NUL) */
const NEW = '\u0000new';

interface Editing { key: string; base: Draft; draft: Draft }

const editingOf = (r: RankRow | null | undefined): Editing | null => {
  if (!r) return null;
  const d = draftOf(r);
  return { key: r.name, base: d, draft: d };
};

export default function RanksView({ st, send }: { st: RanksState; send: Send }) {
  const app = useApp();
  const { t, lt, lang } = useI18n();
  const [edit, setEdit] = useState<Editing | null>(() => editingOf(st.ranks[0]));
  const [busy, setBusy] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [custom, setCustom] = useState('');

  const nodes = useMemo(() => nodeIndex(st.catalog), [st.catalog]);

  /* a new state: follow the server's copy of the open rank unless the admin changed it here */
  useEffect(() => {
    setEdit((e) => {
      if (!e || e.key === NEW) return e;
      const r = st.ranks.find((x) => x.name === e.key);
      if (!r) return editingOf(st.ranks[0]);
      const fresh = draftOf(r);
      if (sameDraft(fresh, e.base)) return e;
      return sameDraft(e.draft, e.base) ? { key: e.key, base: fresh, draft: fresh } : { ...e, base: fresh };
    });
  }, [st]);

  const dirty = !!edit && !sameDraft(edit.draft, edit.base);

  const open = (key: string | null) => {
    if (key === NEW) { const d = draftOf(null); setEdit({ key: NEW, base: d, draft: d }); }
    else setEdit(editingOf(st.ranks.find((r) => r.name === key)));
    setSaveErr(null);
    setQ('');
    setCustom('');
  };

  /** Leaving a changed draft asks first */
  const guard = (go: () => void) => {
    if (!dirty) { go(); return; }
    app.confirm({
      title: t('label.ranks.discardTitle'),
      help: 'help.ranks.discardChanges',
      text: <p>{t('label.ranks.discardText')}</p>,
      confirmLabel: t('label.ranks.discardConfirm'),
      onConfirm: go,
    });
  };

  const set = (patch: Partial<Draft>) => setEdit((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));
  const setPerm = (node: string, on: boolean) => setEdit((e) => {
    if (!e) return e;
    const has = e.draft.perms.includes(node);
    if (on === has) return e;
    return { ...e, draft: { ...e.draft, perms: on ? [...e.draft.perms, node] : e.draft.perms.filter((p) => p !== node) } };
  });

  /* ── the list ──────────────────────────────────────────────────────────── */

  const columns: Column<RankRow>[] = [
    {
      key: 'rank', label: t('label.ranks.col.rank'), help: 'help.ranks.col.rank',
      render: (r) => (
        <span className="rk-rankcell">
          <i className="rk-dot" style={{ background: safeColor(r.color) }} aria-hidden="true" />
          <span className="rk-rankcell-text">
            <span className="k-cell-main" dir="auto">{r.label || r.name}</span>
            <span className="k-cell-sub k-mono">{r.name}</span>
          </span>
          {r.protected && <Tag tone="strong" className="rk-locktag"><Glyph name="lock" />{t('label.ranks.protected')}</Tag>}
        </span>
      ),
    },
    {
      key: 'members', label: t('label.ranks.col.members'), help: 'help.ranks.col.members', num: true, width: '6.5rem',
      render: (r) => <span className="k-num">{fmtNum(r.members)}</span>,
    },
  ];

  const list = (
    <>
      <Toolbar className="rk-toolbar">
        <Button help="help.ranks.new" icon="plus" kind="primary" disabled={!!busy} onClick={() => guard(() => open(NEW))}>{t('label.ranks.new')}</Button>
        <span className="rk-count k-push">
          <span>{t('label.ranks.count', fmtNum(st.ranks.length))}</span>
          <HelpTip help="help.ranks.list" label={t('label.ranks.listLabel')} size="sm" />
        </span>
      </Toolbar>
      <DataTable
        label={t('label.ranks.listLabel')}
        columns={columns}
        rows={st.ranks}
        rowKey={(r) => r.name}
        selectedKey={edit && edit.key !== NEW ? edit.key : null}
        onSelect={(r) => { if (edit?.key !== r.name) guard(() => open(r.name)); }}
        empty={<EmptyState text={t('label.ranks.none')} />}
      />
      {!edit && st.ranks.length > 0 && <p className="rk-hint">{t('label.ranks.pickRank')}</p>}
    </>
  );

  /* ── the editor ────────────────────────────────────────────────────────── */

  let drawer = null;
  const row = edit && edit.key !== NEW ? st.ranks.find((r) => r.name === edit.key) ?? null : null;

  if (edit && row?.protected) {
    drawer = (
      <Drawer
        key={row.name}
        title={<RankTitle color={row.color} text={row.label || row.name} />}
        helpLabel={row.label || row.name}
        help="help.ranks.editor"
        sub={<><span className="k-mono">{row.name}</span><span>{t('label.ranks.members', fmtNum(row.members))}</span></>}
        chips={<Tag tone="strong" className="rk-locktag"><Glyph name="lock" />{t('label.ranks.protected')}</Tag>}
        onClose={() => setEdit(null)}
      >
        <InlineAlert tone="info" title={t('label.ranks.masterTitle')} help="help.ranks.master">
          <p>{t('label.ranks.masterText')}</p>
        </InlineAlert>
        <KeyValueList>
          <KeyValue label={t('label.ranks.name')} help="help.ranks.name" value={row.name} ltr />
          <KeyValue label={t('label.ranks.label')} help="help.ranks.label" value={row.label} />
          <KeyValue label={t('label.ranks.color')} help="help.ranks.color" value={<span className="rk-colorval"><i className="rk-dot" style={{ background: safeColor(row.color) }} aria-hidden="true" />{row.color}</span>} ltr />
          <KeyValue label={t('label.ranks.sort')} help="help.ranks.sort" value={fmtNum(row.sort)} ltr />
          <KeyValue label={t('label.ranks.col.members')} help="help.ranks.col.members" value={fmtNum(row.members)} ltr />
        </KeyValueList>
        <Section title={t('label.ranks.perms')} help="help.ranks.perms" tone="plain">
          <Tag tone="strong">{t('label.ranks.everything')}</Tag>
        </Section>
      </Drawer>
    );
  } else if (edit) {
    const d = edit.draft;
    const isNew = edit.key === NEW;
    const taken = isNew && st.ranks.some((r) => r.name === d.name);
    const nameErr = isNew && d.name !== '' ? (!nameOk(d.name) ? t('label.ranks.nameBad') : taken ? t('label.ranks.nameTaken') : null) : null;
    const labelErr = d.label !== '' && !labelOk(d.label) ? t('label.ranks.labelBad') : null;
    const colorErr = !colorOk(d.color) ? t('label.ranks.colorBad') : null;
    const sortErr = !sortOk(d.sort) ? t('label.ranks.sortBad') : null;
    const tooMany = d.perms.length > MAX_PERMS;
    const valid = (!isNew || (nameOk(d.name) && !taken)) && labelOk(d.label) && !colorErr && !sortErr && !tooMany;

    const save = async () => {
      if (!valid) return;
      setBusy('save');
      setSaveErr(null);
      const rank = { name: d.name, label: d.label.trim(), color: d.color.toLowerCase(), sort: d.sort, permissions: d.perms };
      const r = await send({ action: 'save', rank });
      setBusy(null);
      if (!r.ok) { setSaveErr(t(r.error ?? 'ui_failed')); return; }
      /* the answer is the new state (RanksPage stored it too): reopen the saved rank as the server keeps it */
      const saved = toState(r.data)?.ranks.find((x) => x.name === d.name);
      const fresh = saved ? draftOf(saved) : { ...d, label: rank.label, color: rank.color };
      setEdit({ key: d.name, base: fresh, draft: fresh });
    };

    const askDelete = (r: RankRow) => app.confirm({
      title: t('label.ranks.deleteTitle', r.label || r.name),
      help: 'help.ranks.confirmDelete',
      danger: true,
      undoable: false,
      phrase: r.members > 0 ? r.name : undefined,
      text: (
        <>
          <p>{t('label.ranks.deleteText')}</p>
          {r.members > 0 && <p>{t('label.ranks.deleteMembers', fmtNum(r.members))}</p>}
        </>
      ),
      confirmLabel: t('label.ranks.deleteConfirm'),
      onConfirm: async () => {
        setBusy('delete');
        const res = await send({ action: 'delete', name: r.name });
        setBusy(null);
        return res.ok ? undefined : false;
      },
    });

    /* the catalogue, filtered by the search box */
    const needle = q.trim().toLowerCase();
    const matches = (n: CatalogNode) => !needle || [n.node, n.label.ar, n.label.en, n.desc.ar, n.desc.en].some((s) => s.toLowerCase().includes(needle));
    const groups = st.catalog.map((g) => ({ g, shown: g.nodes.filter(matches) })).filter((x) => x.shown.length > 0);
    const catalogCount = nodes.size;
    const onCount = d.perms.filter((p) => nodes.has(p)).length;
    const dangerOn = d.perms.map((p) => nodes.get(p)).filter((n): n is CatalogNode => !!n && n.danger);
    const customs = d.perms.filter((p) => !nodes.has(p));

    const typed = custom.trim();
    const customProblem = !typed ? null
      : nodeProblem(typed) === 'shape' ? t('label.ranks.customBad')
        : nodeProblem(typed) === 'reserved' ? t('label.ranks.customReserved')
          : d.perms.includes(typed) ? t('label.ranks.customHave')
            : d.perms.length >= MAX_PERMS ? t('label.ranks.tooMany') : null;
    const addCustom = () => {
      if (!typed || customProblem) return;
      setPerm(typed, true);
      setCustom('');
    };

    const nodeHelp = (n: CatalogNode): HelpProp => (n.desc.ar || n.desc.en ? { text: n.desc, title: n.label.ar || n.label.en ? n.label : undefined } : 'help.ranks.node');
    const preset = PRESETS.find((p) => p.hex === d.color.toLowerCase())?.hex ?? '';
    const title = d.label.trim() || (isNew ? t('label.ranks.newTitle') : d.name);

    drawer = (
      <Drawer
        key={edit.key}
        className="rk-editor"
        title={<RankTitle color={d.color} text={title} />}
        helpLabel={title}
        help={isNew ? 'help.ranks.editorNew' : 'help.ranks.editor'}
        sub={!isNew && row ? <><span className="k-mono">{row.name}</span><span>{t('label.ranks.members', fmtNum(row.members))}</span></> : undefined}
        chips={dirty ? <Tag tone="faint">{t('label.ranks.unsaved')}</Tag> : undefined}
        onClose={() => guard(() => setEdit(null))}
        footer={(
          <>
            <Button help="help.ranks.save" kind="primary" busy={busy === 'save'} disabled={!valid || (!dirty && !isNew) || (!!busy && busy !== 'save')} onClick={() => { void save(); }}>
              {isNew ? t('label.ranks.create') : t('label.ranks.save')}
            </Button>
            {isNew
              ? <Button help="help.ranks.cancelNew" kind="ghost" disabled={!!busy} onClick={() => guard(() => open(st.ranks[0]?.name ?? null))}>{t('label.ranks.cancel')}</Button>
              : <Button help="help.ranks.discard" kind="ghost" disabled={!dirty || !!busy} onClick={() => { setEdit({ ...edit, draft: edit.base }); setSaveErr(null); }}>{t('label.ranks.discard')}</Button>}
            {!isNew && row && (
              <Button help="help.ranks.delete" kind="danger" busy={busy === 'delete'} disabled={!!busy && busy !== 'delete'} onClick={() => askDelete(row)}>{t('label.ranks.delete')}</Button>
            )}
          </>
        )}
        footerNote={dirty && !valid ? t('label.ranks.needFix') : undefined}
      >
        {saveErr && <InlineAlert tone="danger" title={saveErr} help="help.ranks.saveFailed" onDismiss={() => setSaveErr(null)} />}

        <div className="rk-form">
          <Field
            label={t('label.ranks.name')}
            help="help.ranks.name"
            required={isNew}
            error={nameErr}
            hint={isNew ? t('label.ranks.nameHint') : undefined}
          >
            <TextInput value={d.name} onChange={(v) => set({ name: v.toLowerCase() })} dir="ltr" mono maxLength={32} placeholder={t('label.ranks.namePh')} disabled={!isNew} invalid={!!nameErr} />
          </Field>
          <Field label={t('label.ranks.label')} help="help.ranks.label" required error={labelErr}>
            <TextInput value={d.label} onChange={(v) => set({ label: v })} dir="auto" maxLength={60} placeholder={t('label.ranks.labelPh')} invalid={!!labelErr} />
          </Field>
          <div className="rk-colorrow">
            <Field label={t('label.ranks.color')} help="help.ranks.color" required error={colorErr} className="rk-colorfield">
              <TextInput
                value={d.color}
                onChange={(v) => set({ color: v.trim() })}
                dir="ltr"
                mono
                maxLength={7}
                placeholder="#rrggbb"
                invalid={!!colorErr}
                suffix={<i className="rk-swatch" style={{ background: safeColor(d.color) }} aria-hidden="true" />}
              />
            </Field>
            <Select
              value={preset}
              onChange={(v) => set({ color: v })}
              options={PRESETS.map((p) => ({ value: p.hex, label: t(`label.ranks.colors.${p.id}`), sub: p.hex }))}
              placeholder={t('label.ranks.colorPreset')}
              label={t('label.ranks.colorPreset')}
              help="help.ranks.colorPreset"
              className="rk-preset"
            />
          </div>
          <Field label={t('label.ranks.sort')} help="help.ranks.sort" required error={sortErr}>
            <NumberInput value={d.sort} onChange={(v) => set({ sort: v })} min={0} max={999} integer />
          </Field>
        </div>

        {dangerOn.length > 0 && (
          <InlineAlert tone="warn" title={t('label.ranks.dangerTitle')} help="help.ranks.danger">
            <p>{t('label.ranks.dangerText', dangerOn.map((n) => lt(n.label) || n.node).join(lang === 'ar' ? '، ' : ', '))}</p>
          </InlineAlert>
        )}

        <Section
          title={t('label.ranks.perms')}
          help="help.ranks.perms"
          tone="plain"
          className="rk-permhead"
          actions={catalogCount > 0 ? <span className="rk-permcount k-num">{t('label.ranks.permsOn', fmtNum(onCount), fmtNum(catalogCount))}</span> : undefined}
        >
          {catalogCount > 0 ? (
            <TextInput
              value={q}
              onChange={setQ}
              icon="search"
              clearable
              placeholder={t('label.ranks.permSearch')}
              label={t('label.ranks.permSearch')}
              help="help.ranks.permSearch"
              className="rk-permsearch"
            />
          ) : <p className="rk-hint">{t('label.ranks.noCatalog')}</p>}
          {tooMany && <p className="rk-err">{t('label.ranks.tooMany')}</p>}
        </Section>

        {catalogCount > 0 && groups.length === 0 && (
          <EmptyState text={t('label.ranks.noMatch')} next={<Button help="help.common.search" size="sm" onClick={() => setQ('')}>{t('label.ranks.staff.clear')}</Button>} />
        )}

        {groups.map(({ g, shown }) => {
          const on = g.nodes.filter((n) => d.perms.includes(n.node)).length;
          return (
            <Section
              key={g.id || lt(g.label)}
              title={lt(g.label) || g.id}
              help="help.ranks.group"
              className="rk-group"
              actions={<span className="rk-permcount k-num">{fmtNum(on)} / {fmtNum(g.nodes.length)}</span>}
            >
              <ul className="rk-nodes">
                {shown.map((n) => {
                  const checked = d.perms.includes(n.node);
                  const name = lt(n.label) || n.node;
                  const desc = lt(n.desc);
                  return (
                    <li key={n.node} className={cls('rk-node', checked && 'is-on', n.danger && 'is-danger')}>
                      <span className="rk-node-text">
                        <span className="rk-node-top">
                          <span className="rk-node-label" dir="auto">{name}</span>
                          {n.danger && <Tag tone="danger">{t('label.ranks.danger')}</Tag>}
                        </span>
                        <span className="rk-node-key k-mono">{n.node}</span>
                        {desc && <span className="rk-node-desc" dir="auto">{desc}</span>}
                      </span>
                      <Switch checked={checked} onChange={(v) => setPerm(n.node, v)} label={name} help={nodeHelp(n)} size="sm" disabled={!!busy || (!checked && d.perms.length >= MAX_PERMS)} />
                    </li>
                  );
                })}
              </ul>
            </Section>
          );
        })}

        <Section title={t('label.ranks.custom')} help="help.ranks.custom" className="rk-group">
          <div className="rk-custom-add">
            <TextInput
              value={custom}
              onChange={setCustom}
              dir="ltr"
              mono
              maxLength={64}
              placeholder={t('label.ranks.customPh')}
              label={t('label.ranks.custom')}
              help="help.ranks.customInput"
              invalid={!!customProblem}
              onEnter={addCustom}
              className="rk-custom-input"
            />
            <Button help="help.ranks.customAdd" icon="plus" disabled={!typed || !!customProblem || !!busy} onClick={addCustom}>{t('label.ranks.customAdd')}</Button>
          </div>
          {customProblem && <p className="rk-err">{customProblem}</p>}
          {customs.length > 0 ? (
            <div className="rk-ctags">
              {customs.map((p) => (
                <span className="rk-ctag" key={p}>
                  <span className="k-mono">{p}</span>
                  {p.startsWith('group.') && p.length > 6 && <span className="rk-ctag-sub">{t('label.ranks.customGroup', p.slice(6))}</span>}
                  <IconButton icon="close" size="sm" aria-label={t('label.ranks.remove', p)} help="help.ranks.customRemove" helpQuiet disabled={!!busy} onClick={() => setPerm(p, false)} />
                </span>
              ))}
            </div>
          ) : <p className="rk-hint">{t('label.ranks.customNone')}</p>}
        </Section>
      </Drawer>
    );
  }

  return <SplitView className="rk-split" list={list} drawer={drawer} />;
}

function RankTitle({ color, text }: { color: string; text: string }) {
  return (
    <span className="rk-title">
      <i className="rk-dot rk-dot--lg" style={{ background: safeColor(color) }} aria-hidden="true" />
      <span dir="auto">{text}</span>
    </span>
  );
}
