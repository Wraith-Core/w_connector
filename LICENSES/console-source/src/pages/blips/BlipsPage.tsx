/* ════════════════════════════════════════════════════════════════════════════
 * w_connector · pages/blips/BlipsPage.tsx (2.4.0)
 * Blips on the game's own map (RedM), for every player, kept by the server (ops/native_blips.lua):
 *   the list     icon, colour, name, position · search · go there (self.tpCoords) · edit · delete (confirm)
 *   the editor   name · the game's icon (searchable) · colour (none or the 32 modifiers) · size · position
 *                (typed, pasted vector3, «where I am», «waypoint»)
 * Every change is one call: post('blips', { action: 'save' | 'delete', ... }) → the website checks
 * world.control and logs it → the server checks every value again, saves and pushes it to every client.
 * The page exists only while w_map is stopped (the area 'blips' comes and goes with it, AppShell hides it).
 * ════════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PageProps } from '../../app/pages';
import { useApp } from '../../ctx';
import { useI18n } from '../../i18n';
import {
  Button, Combobox, CoordsInput, EmptyState, Field, HelpTip, InlineAlert, Loading, PageActions, Section, SliderNumber, Tag, TextInput,
  cls, fmtNum,
} from '../../kit';
import type { CoordsValue, Option } from '../../kit';
import { post, useLuaMessage } from '../../nui';
import type { Result } from '../../types';
import { COLORS, SPRITES, checkDraft, cleanName, colorOf, draftOf, sameDraft, spriteLabel, spriteStyle, toState, wireOf } from './model';
import type { Blip, BlipsState, Draft } from './model';

interface Editing { id: string | null; start: Draft; draft: Draft }

function Icon({ sprite, color, size }: { sprite: string; color?: string; size: number }) {
  const c = colorOf(color);
  return (
    <span className="bl-icon" style={{ width: size, height: size }} aria-hidden="true">
      <span className="bl-icon-img" style={spriteStyle(sprite, size)} />
      {c && <span className="bl-icon-dot" style={{ background: c.hex }} />}
    </span>
  );
}

export default function BlipsPage(_: PageProps) {
  const app = useApp();
  const { t } = useI18n();
  const [st, setSt] = useState<BlipsState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState<Editing | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const apply = (r: Result<unknown>) => { const s = toState(r.data); if (s) setSt(s); return s; };

  const load = useCallback(async () => {
    setLoading(true);
    const r = await post('blips', { action: 'list' });
    const s = r.ok ? toState(r.data) : null;
    if (s) { setSt(s); setErr(null); } else setErr(r.error ?? t('ui_failed'));
    setLoading(false);
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  /* another admin changed the list (client/cl_blips.lua): read it again unless this page made the change */
  useLuaMessage<{ rev?: number }>('blipsRev', (d) => { if (!busy && st && d.rev !== st.rev) void load(); });

  const sprites = useMemo<Option[]>(() => SPRITES.map((n) => ({ value: n, label: spriteLabel(n) })), []);
  const colors = useMemo<Option[]>(() => [
    { value: '', label: t('label.blips.colorNone') },
    ...COLORS.map((c) => ({ value: c.id, label: t(`label.blips.colors.c${c.n}`), sub: `MP_COLOR_${c.n}` })),
  ], [t]);

  const count = st?.list.length ?? 0;
  const max = st?.max ?? 200;
  const full = count >= max;
  const locked = !!busy;
  const canGo = app.canAction('self.tpCoords');

  const list = useMemo(() => {
    const all = st?.list ?? [];
    const s = q.trim().toLowerCase();
    if (!s) return all;
    return all.filter((b) => b.name.toLowerCase().includes(s) || b.sprite.includes(s) || spriteLabel(b.sprite).includes(s));
  }, [st, q]);

  /* ── the list ──────────────────────────────────────────────────────────── */

  const askDelete = (b: Blip) => {
    app.confirm({
      title: t('label.blips.deleteTitle', b.name),
      help: 'help.blips.confirmDelete',
      danger: true,
      undoable: false,
      text: <p>{t('label.blips.deleteText')}</p>,
      confirmLabel: t('label.blips.deleteConfirm'),
      onConfirm: async () => {
        setBusy(`delete:${b.id}`);
        const r = await app.act('blips', { action: 'delete', id: b.id });
        setBusy(null);
        if (r.ok || r.errorKey === 'err_blip_gone') apply(r);
        if (r.ok && edit?.id === b.id) setEdit(null);
      },
    });
  };

  const go = (b: Blip) => {
    void app.act('self', { action: 'tpCoords', args: { x: b.x, y: b.y, ...(b.z !== undefined ? { z: b.z } : {}) } });
  };

  /* ── the editor ────────────────────────────────────────────────────────── */

  const guard = (fn: () => void) => {
    if (edit && !sameDraft(edit.draft, edit.start)) {
      app.confirm({
        title: t('label.blips.discardTitle'),
        help: 'help.blips.discard',
        text: <p>{t('label.blips.discardText')}</p>,
        confirmLabel: t('label.blips.discardConfirm'),
        onConfirm: fn,
      });
    } else fn();
  };
  const openEditor = (b: Blip | null) => guard(() => {
    const d = draftOf(b);
    setEdit({ id: b?.id ?? null, start: d, draft: d });
    setSaveErr(null);
  });
  const closeEditor = () => guard(() => { setEdit(null); setSaveErr(null); });
  const set = (patch: Partial<Draft>) => setEdit((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));

  const where = async (what: 'me' | 'waypoint') => {
    const r = await post<{ x: number; y: number; z?: number }>('blipsWhere', { what });
    if (r.ok && r.data) {
      const round = (v: number) => Math.round(v * 100) / 100;
      set({ x: round(r.data.x), y: round(r.data.y), z: typeof r.data.z === 'number' ? round(r.data.z) : null });
    } else app.toast('error', t(r.errorKey ?? r.error ?? 'ui_failed'));
  };

  const save = async () => {
    if (!st || !edit) return;
    setBusy('save');
    setSaveErr(null);
    const r = await app.act('blips', { action: 'save', ...wireOf(edit.draft, edit.id) }, { silent: true });
    setBusy(null);
    if (r.ok) { apply(r); setEdit(null); app.toast('success', t('label.blips.saved')); return; }
    if (r.errorKey === 'err_blip_gone' || r.errorKey === 'err_blip_full') apply(r);
    setSaveErr(r.error ?? t('ui_failed'));
  };

  /* ── drawing ───────────────────────────────────────────────────────────── */

  const header = (
    <PageActions>
      <Button help="help.common.refresh" icon="refresh" kind="ghost" disabled={locked} onClick={() => { void load(); }}>{t('label.blips.refresh')}</Button>
    </PageActions>
  );

  if (err) {
    return (
      <div className="bl-page">
        {header}
        <InlineAlert
          tone="danger"
          title={t('label.blips.loadFailed')}
          help="help.blips.loadFailed"
          actions={<Button help="help.blips.retry" kind="ghost" icon="refresh" busy={loading} onClick={() => { void load(); }}>{t('label.blips.retry')}</Button>}
        >
          <p>{err}</p>
        </InlineAlert>
      </div>
    );
  }
  if (!st) return <div className="bl-page">{header}<Loading /></div>;

  const listSection = (
    <Section
      title={t('label.blips.list')}
      help="help.blips.list"
      lead={t('label.blips.lead')}
      className="bl-listsec"
      actions={(
        <span className="bl-listacts">
          <span className="bl-countline">
            <span>{t('label.blips.count', fmtNum(count), fmtNum(max))}</span>
            <HelpTip help="help.blips.count" size="sm" />
          </span>
          <Button help="help.blips.add" kind="primary" icon="plus" area="blips" disabled={full || locked} onClick={() => openEditor(null)}>{t('label.blips.add')}</Button>
        </span>
      )}
    >
      {count > 0 && (
        <TextInput className="bl-search" value={q} onChange={setQ} icon="search" clearable placeholder={t('label.blips.search')} help="help.blips.search" />
      )}
      {count === 0 ? <EmptyState text={t('label.blips.empty')} />
        : list.length === 0 ? <EmptyState text={t('label.blips.noMatch')} />
          : (
            <ul className="bl-list">
              {list.map((b) => (
                <li key={b.id} className={cls('bl-row', edit?.id === b.id && 'is-sel')}>
                  <Icon sprite={b.sprite} color={b.color} size={32} />
                  <span className="bl-main">
                    <span className="bl-name"><bdi>{b.name}</bdi></span>
                    <span className="bl-sub">
                      <span className="bl-sprite">{spriteLabel(b.sprite)}</span>
                      <span className="k-num bl-xy" dir="ltr">{b.x.toFixed(1)}, {b.y.toFixed(1)}{b.z !== undefined ? `, ${b.z.toFixed(1)}` : ''}</span>
                    </span>
                    {b.by && <span className="bl-by">{t('label.blips.by', b.by)}</span>}
                  </span>
                  <span className="bl-acts">
                    {canGo && <Button help="help.blips.teleport" helpQuiet kind="ghost" size="sm" disabled={locked} onClick={() => go(b)}>{t('label.blips.teleport')}</Button>}
                    <Button help="help.blips.edit" helpQuiet kind="ghost" size="sm" area="blips" disabled={locked} onClick={() => openEditor(b)}>{t('label.blips.edit')}</Button>
                    <Button help="help.blips.delete" helpQuiet kind="danger" size="sm" area="blips" disabled={locked} busy={busy === `delete:${b.id}`} onClick={() => askDelete(b)}>{t('label.blips.delete')}</Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
      {full && <p className="bl-full">{t('label.blips.full', fmtNum(max))}</p>}
    </Section>
  );

  let editor = null;
  if (edit) {
    const c = checkDraft(edit.draft, st.limits);
    const dirty = !sameDraft(edit.draft, edit.start);
    const why = c.name === 'empty' ? t('label.blips.needName') : c.name === 'long' ? t('label.blips.needLonger')
      : !c.sprite ? t('label.blips.needSprite') : !c.pos ? t('label.blips.needPos') : null;
    const coords: CoordsValue = { x: edit.draft.x, y: edit.draft.y, z: edit.draft.z };
    const pvName = cleanName(edit.draft.name);
    editor = (
      <Section
        title={t(edit.id === null ? 'label.blips.newTitle' : 'label.blips.editTitle')}
        help={edit.id === null ? 'help.blips.add' : 'help.blips.edit'}
        className="bl-editor"
        actions={dirty ? <Tag tone="faint">{t('label.blips.unsaved')}</Tag> : undefined}
      >
        <div className="bl-form">
          <Field
            label={t('label.blips.name')} help="help.blips.name" required
            aside={<span className={cls('k-num bl-count', c.name === 'long' && 'is-over')}>{t('label.blips.nameCount', fmtNum(c.letters), fmtNum(st.limits.name))}</span>}
          >
            <TextInput value={edit.draft.name} onChange={(v) => set({ name: v })} dir="auto" placeholder={t('label.blips.namePh')} invalid={c.name === 'long'} />
          </Field>
          <div className="bl-pair">
            <Field label={t('label.blips.sprite')} help="help.blips.sprite" required>
              <Combobox
                value={edit.draft.sprite} onChange={(v) => set({ sprite: v })} options={sprites} limit={700}
                placeholder={t('label.blips.spritePh')} searchPlaceholder={t('label.blips.spriteSearch')} emptyText={t('label.blips.spriteNone')}
                renderOption={(o) => (
                  <span className="bl-opt">
                    <span className="bl-opt-img" style={spriteStyle(o.value, 24)} aria-hidden="true" />
                    <span className="k-pop-label">{o.label}</span>
                  </span>
                )}
              />
            </Field>
            <Field label={t('label.blips.color')} help="help.blips.color">
              <Combobox
                value={edit.draft.color} onChange={(v) => set({ color: v })} options={colors}
                placeholder={t('label.blips.colorNone')} searchPlaceholder={t('label.blips.colorSearch')}
                renderOption={(o) => (
                  <span className="bl-opt">
                    <span className={cls('bl-swatch', !o.value && 'is-none')} style={o.value ? { background: colorOf(o.value)?.hex } : undefined} aria-hidden="true" />
                    <span className="k-pop-label">{o.label}</span>
                  </span>
                )}
              />
            </Field>
          </div>
          <Field label={t('label.blips.scale')} help="help.blips.scale">
            <SliderNumber value={edit.draft.scale} onChange={(v) => set({ scale: v })} min={st.limits.scaleMin} max={st.limits.scaleMax} step={0.05} />
          </Field>
          <Field
            label={t('label.blips.position')} help="help.blips.position" required
            aside={(
              <span className="bl-where">
                <Button help="help.blips.here" kind="ghost" size="sm" onClick={() => { void where('me'); }}>{t('label.blips.here')}</Button>
                <Button help="help.blips.waypoint" kind="ghost" size="sm" onClick={() => { void where('waypoint'); }}>{t('label.blips.waypoint')}</Button>
              </span>
            )}
          >
            <CoordsInput value={coords} onChange={(v) => set({ x: v.x, y: v.y, z: v.z })} />
          </Field>
          {saveErr && <InlineAlert tone="danger" title={saveErr} help="help.blips.saveFailed" />}
          <div className="bl-apply">
            <Button help="help.blips.save" kind="primary" area="blips" busy={busy === 'save'} disabled={!c.ok || (!dirty && edit.id !== null) || (edit.id === null && full) || locked} onClick={() => { void save(); }}>
              {t(edit.id === null ? 'label.blips.save' : 'label.blips.saveEdit')}
            </Button>
            <Button help="help.blips.cancel" kind="ghost" disabled={locked} onClick={closeEditor}>{t('label.blips.cancel')}</Button>
            {why && <span className="bl-why">{why}</span>}
          </div>
        </div>
        <div className="bl-pv">
          <div className="bl-pv-head">
            <span>{t('label.blips.preview')}</span>
            <HelpTip help="help.blips.preview" size="sm" />
          </div>
          <div className="bl-pv-map">
            {edit.draft.sprite
              ? <Icon sprite={edit.draft.sprite} color={edit.draft.color || undefined} size={Math.round(32 * edit.draft.scale)} />
              : <span className="bl-pv-none" />}
            {pvName && <span className="bl-pv-name"><bdi>{pvName}</bdi></span>}
          </div>
        </div>
      </Section>
    );
  }

  return (
    <div className="bl-page">
      {header}
      <div className={cls('bl-grid', editor && 'has-editor')}>
        <div className="bl-col">{listSection}</div>
        {editor && <div className="bl-side">{editor}</div>}
      </div>
    </div>
  );
}
