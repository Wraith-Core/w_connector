/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/news/NewsPage.tsx
 * The pause menu's news ("أخبار البلدة", w_pausemenu), edited here and shown at once in every pause menu:
 *   the list      in carousel order: plate, title, date, the start of the text · move up / down · edit ·
 *                 delete (the red underline, then a confirm) · add · back to the default list (confirm)
 *   the editor    title / text / date line in Arabic and English (English may stay empty: the Arabic
 *                 shows), the plate (a bundled one or a typed nui:// / https://cfx-nui-<res>/ path), the
 *                 live byte counters of the pause menu's limits
 *   the preview   the pause menu's own card, at its size, in the language picked beside it
 * Every change sends the WHOLE ordered list: post('news', { action: 'newsSave', list, rev }) → the server
 * checks it again (server/sv_news.lua), hands it to w_pausemenu's SetNews and logs what changed.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PageProps } from '../../app/pages';
import { useApp } from '../../ctx';
import { useI18n } from '../../i18n';
import {
  Button, EmptyState, Field, HelpTip, IconButton, InlineAlert, Loading, PageActions, ReadyLine, Section, Segmented, Tag, TextArea,
  TextInput, cls, fmtNum,
} from '../../kit';
import type { SegmentOption } from '../../kit';
import { post } from '../../nui';
import type { Lang, Result } from '../../types';
import NewsCard from './NewsCard';
import { FIELD_OF, checkDraft, draftOf, imageUrl, itemOf, pick, sameDraft, toState } from './model';
import type { Draft, DraftKey, NewsItem, NewsState } from './model';

interface LoadError { key: string; text: string }
interface Editing { id: string | null; base: NewsItem | null; start: Draft; draft: Draft }

/** The bundled plates by name (label.news.plate.<name>); another plate shows its file name */
const PLATE_NAME: Record<string, string> = { 'news/saloon.webp': 'saloon', 'news/wagons.webp': 'wagons', 'news/frontier.webp': 'frontier' };

/** Only what the server reads (an empty text stays out) */
const wire = (n: NewsItem) => ({
  id: n.id,
  title: n.title,
  text: n.text && Object.keys(n.text).length ? n.text : undefined,
  date: n.date && Object.keys(n.date).length ? n.date : undefined,
  image: n.image || undefined,
});

export default function NewsPage(_: PageProps) {
  const app = useApp();
  const { t, lang } = useI18n();
  const [st, setSt] = useState<NewsState | null>(null);
  const [err, setErr] = useState<LoadError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState<Editing | null>(null);
  const [sel, setSel] = useState(0);
  const [pvLang, setPvLang] = useState<Lang>(lang);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const top = useRef<HTMLDivElement>(null);

  const apply = (r: Result<unknown>): NewsState | null => {
    const s = toState(r.data);
    if (s) setSt(s);
    return s;
  };

  const load = useCallback(async () => {
    setLoading(true);
    const r = await post('news', { action: 'newsList' });
    const s = r.ok ? toState(r.data) : null;
    if (s) { setSt(s); setErr(null); } else setErr({ key: r.errorKey ?? r.error ?? 'ui_failed', text: r.error ?? '' });
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const count = st?.list.length ?? 0;
  const max = st?.limits.items ?? 12;
  const full = count >= max;
  const locked = !!busy;

  /** Sends the whole ordered list; the answer (or the fresh list of a conflict) replaces the page's */
  const save = async (list: NewsItem[], what: string): Promise<boolean> => {
    if (!st) return false;
    setBusy(what);
    setSaveErr(null);
    const r = await app.act('news', { action: 'newsSave', list: list.map(wire), rev: st.rev });
    setBusy(null);
    if (r.ok) { apply(r); return true; }
    if (r.errorKey === 'err_news_changed') apply(r);
    else if (r.errorKey === 'err_news_missing') setErr({ key: r.errorKey, text: r.error ?? '' });
    else setSaveErr(r.error ?? t('ui_failed'));
    return false;
  };

  /* ── the list ──────────────────────────────────────────────────────────── */

  const move = async (i: number, d: -1 | 1) => {
    if (!st) return;
    const j = i + d;
    if (j < 0 || j >= st.list.length) return;
    const list = [...st.list];
    [list[i], list[j]] = [list[j], list[i]];
    if (await save(list, `move:${i}`)) setSel(j);
  };

  const askDelete = (i: number) => {
    if (!st) return;
    const n = st.list[i];
    const title = pick(n.title, lang) || t('label.news.card.noTitle');
    app.confirm({
      title: t('label.news.deleteTitle', title),
      help: 'help.news.confirmDelete',
      danger: true,
      undoable: false,
      text: <p>{t('label.news.deleteText')}</p>,
      confirmLabel: t('label.news.deleteConfirm'),
      onConfirm: async () => {
        const list = st.list.filter((_, k) => k !== i);
        if (await save(list, `delete:${i}`)) {
          if (edit && edit.id === n.id) setEdit(null);
          setSel(0);
        }
      },
    });
  };

  const askReset = () => {
    if (!st) return;
    app.confirm({
      title: t('label.news.resetTitle'),
      help: 'help.news.confirmReset',
      danger: true,
      undoable: false,
      text: <p>{t('label.news.resetText', fmtNum(st.list.length))}</p>,
      confirmLabel: t('label.news.resetConfirm'),
      onConfirm: async () => {
        setBusy('reset');
        const r = await app.act('news', { action: 'newsReset', rev: st.rev });
        setBusy(null);
        if (r.ok || r.errorKey === 'err_news_changed') apply(r);
        if (r.errorKey === 'err_news_missing') setErr({ key: r.errorKey, text: r.error ?? '' });
        if (r.ok) { setEdit(null); setSel(0); }
      },
    });
  };

  /* ── the editor ────────────────────────────────────────────────────────── */

  const openEditor = (i: number | null) => {
    if (!st) return;
    const go = () => {
      const base = i === null ? null : st.list[i];
      const d = draftOf(base, i === null ? st.list.length : i, st.plates);
      setEdit({ id: base?.id ?? null, base, start: d, draft: d });
      setSaveErr(null);
      if (i !== null) setSel(i);
      top.current?.scrollIntoView({ block: 'start' });
    };
    if (edit && !sameDraft(edit.draft, edit.start)) {
      app.confirm({
        title: t('label.news.discardTitle'),
        help: 'help.news.discard',
        text: <p>{t('label.news.discardText')}</p>,
        confirmLabel: t('label.news.discardConfirm'),
        onConfirm: go,
      });
    } else go();
  };

  /** Cancel: unsaved changes are asked about first */
  const closeEditor = () => {
    const done = () => { setEdit(null); setSaveErr(null); };
    if (edit && !sameDraft(edit.draft, edit.start)) {
      app.confirm({
        title: t('label.news.discardTitle'),
        help: 'help.news.discard',
        text: <p>{t('label.news.discardText')}</p>,
        confirmLabel: t('label.news.discardConfirm'),
        onConfirm: done,
      });
    } else done();
  };

  const setField = (k: keyof Draft, v: string) => setEdit((e) => (e ? { ...e, draft: { ...e.draft, [k]: v } } : e));

  const saveItem = async () => {
    if (!st || !edit) return;
    const item = itemOf(edit.draft, edit.base);
    let list: NewsItem[];
    let at = 0;
    if (edit.id === null) {
      list = [item, ...st.list];
    } else {
      at = st.list.findIndex((n) => n.id === edit.id);
      if (at < 0) { setSaveErr(t('label.news.gone')); return; }
      list = st.list.map((n, k) => (k === at ? item : n));
    }
    if (await save(list, 'item')) { setEdit(null); setSel(at); }
  };

  /* ── drawing ───────────────────────────────────────────────────────────── */

  const plateName = (p: string) => (PLATE_NAME[p] ? t(`label.news.plate.${PLATE_NAME[p]}`) : p.replace(/^.*\//, ''));

  const header = (
    <PageActions>
      <Button help="help.common.refresh" icon="refresh" kind="ghost" disabled={locked} onClick={() => { void load(); }}>{t('label.news.refresh')}</Button>
      {st && !err && (
        <Button help="help.news.reset" kind="danger" area="news" disabled={locked} busy={busy === 'reset'} onClick={askReset}>{t('label.news.reset')}</Button>
      )}
    </PageActions>
  );

  if (err) {
    const missing = err.key === 'err_news_missing';
    return (
      <div className="nw-page">
        {header}
        <InlineAlert
          tone={missing ? 'warn' : 'danger'}
          title={t(missing ? 'label.news.missingTitle' : 'label.news.loadFailed')}
          help={missing ? 'help.news.missing' : 'help.news.loadFailed'}
          actions={(
            <>
              {missing && (
                <Button help="help.news.openResources" area="resources" onClick={() => app.navigate('resources')}>{t('label.news.openResources')}</Button>
              )}
              <Button help="help.news.retry" kind="ghost" icon="refresh" busy={loading} onClick={() => { void load(); }}>{t('label.news.retry')}</Button>
            </>
          )}
        >
          <p>{err.text || t(err.key)}</p>
        </InlineAlert>
      </div>
    );
  }

  if (!st) {
    return <div className="nw-page">{header}<Loading /></div>;
  }

  /* what the preview draws: the draft while editing, else the row under the cursor */
  const editAt = edit ? (edit.id === null ? 0 : Math.max(0, st.list.findIndex((n) => n.id === edit.id))) : 0;
  const check = edit ? checkDraft(edit.draft, st.limits) : null;
  const pvItem: NewsItem | null = edit ? itemOf(edit.draft, edit.base) : st.list[Math.min(sel, count - 1)] ?? null;
  /* a path the server would refuse is never loaded (an outside address would reach the web from the game) */
  const pvBlank = !!check?.image;
  const pvIndex = edit ? editAt : Math.min(sel, Math.max(0, count - 1));
  const pvCount = edit && edit.id === null ? count + 1 : count;

  const preview = (
    <Section
      title={t('label.news.preview')}
      help="help.news.preview"
      className="nw-pvsec"
      actions={(
        <Segmented
          value={pvLang}
          onChange={setPvLang}
          size="sm"
          label={t('label.news.previewLang')}
          help="help.news.previewLang"
          options={[{ value: 'ar', label: t('label.news.lang.ar') }, { value: 'en', label: t('label.news.lang.en') }]}
        />
      )}
    >
      <div className="nw-pv">
        <NewsCard item={pvItem} index={pvIndex} count={pvCount} lang={pvLang} resource={st.resource} blank={pvBlank} />
        <p className="nw-pv-note">
          {edit ? t('label.news.previewDraft') : count ? t('label.news.previewRow', fmtNum(pvIndex + 1), fmtNum(count)) : t('label.news.previewEmpty')}
        </p>
      </div>
    </Section>
  );

  let body;
  if (edit) {
    const c = check ?? checkDraft(edit.draft, st.limits);
    const dirty = !sameDraft(edit.draft, edit.start);
    const counter = (k: DraftKey) => {
      const lim = st.limits[FIELD_OF[k]];
      return <span className={cls('k-num nw-count', c.over[k] && 'is-over')}>{fmtNum(c.used[k])} / {fmtNum(lim)}</span>;
    };
    const tooLong = (k: DraftKey) => (c.over[k] ? t('label.news.tooLong', fmtNum(st.limits[FIELD_OF[k]])) : null);
    /* the readiness line: the same checks that enable «حفظ», all at once and in words */
    const missing = [
      ...(c.noTitle ? [t('label.news.need.title')] : []),
      ...(Object.keys(c.over).length ? [t('label.news.need.shorter')] : []),
      ...(c.image ? [t('label.news.need.image')] : []),
    ];
    const plateOpts: SegmentOption<string>[] = [
      ...st.plates.map((p) => ({
        value: p,
        label: (
          <span className="nw-opt">
            <img className="nw-opt-img" src={imageUrl(p, 0, st.resource)} alt="" />
            <span className="nw-opt-name">{plateName(p)}</span>
          </span>
        ),
      })),
      {
        value: 'custom',
        label: (
          <span className="nw-opt">
            <span className="nw-opt-img nw-opt-own" aria-hidden="true">nui://</span>
            <span className="nw-opt-name">{t('label.news.plateCustom')}</span>
          </span>
        ),
        help: 'help.news.plateCustom',
      },
    ];
    body = (
      <Section
        title={t(edit.id === null ? 'label.news.newTitle' : 'label.news.editTitle')}
        help={edit.id === null ? 'help.news.newItem' : 'help.news.editItem'}
        className="nw-editor"
        actions={dirty ? <Tag tone="faint">{t('label.news.unsaved')}</Tag> : undefined}
      >
        <div className="nw-form">
          <div className="nw-pair">
            <Field className="nw-f-titleAr" label={t('label.news.titleAr')} help="help.news.titleAr" required aside={counter('titleAr')} error={tooLong('titleAr')}>
              <TextInput value={edit.draft.titleAr} onChange={(v) => setField('titleAr', v)} dir="rtl" placeholder={t('label.news.titleArPh')} invalid={!!c.over.titleAr} />
            </Field>
            <Field className="nw-f-titleEn" label={t('label.news.titleEn')} help="help.news.titleEn" aside={counter('titleEn')} error={tooLong('titleEn')}>
              <TextInput value={edit.draft.titleEn} onChange={(v) => setField('titleEn', v)} dir="ltr" placeholder={t('label.news.enEmpty')} invalid={!!c.over.titleEn} />
            </Field>
          </div>
          <div className="nw-pair">
            <Field className="nw-f-textAr" label={t('label.news.textAr')} help="help.news.textAr" aside={counter('textAr')} error={tooLong('textAr')}>
              <TextArea value={edit.draft.textAr} onChange={(v) => setField('textAr', v)} dir="rtl" rows={4} placeholder={t('label.news.textArPh')} invalid={!!c.over.textAr} />
            </Field>
            <Field className="nw-f-textEn" label={t('label.news.textEn')} help="help.news.textEn" aside={counter('textEn')} error={tooLong('textEn')}>
              <TextArea value={edit.draft.textEn} onChange={(v) => setField('textEn', v)} dir="ltr" rows={4} placeholder={t('label.news.enEmpty')} invalid={!!c.over.textEn} />
            </Field>
          </div>
          <div className="nw-pair">
            <Field className="nw-f-dateAr" label={t('label.news.dateAr')} help="help.news.dateAr" aside={counter('dateAr')} error={tooLong('dateAr')}>
              <TextInput value={edit.draft.dateAr} onChange={(v) => setField('dateAr', v)} dir="rtl" placeholder={t('label.news.dateArPh')} invalid={!!c.over.dateAr} />
            </Field>
            <Field className="nw-f-dateEn" label={t('label.news.dateEn')} help="help.news.dateEn" aside={counter('dateEn')} error={tooLong('dateEn')}>
              <TextInput value={edit.draft.dateEn} onChange={(v) => setField('dateEn', v)} dir="ltr" placeholder={t('label.news.enEmpty')} invalid={!!c.over.dateEn} />
            </Field>
          </div>
          <Field className="nw-f-image" label={t('label.news.image')} help="help.news.image">
            <Segmented value={edit.draft.plate} onChange={(v) => setField('plate', v)} options={plateOpts} className="nw-plates" />
          </Field>
          {edit.draft.plate === 'custom' && (
            <Field
              className="nw-f-path"
              label={t('label.news.path')}
              help="help.news.path"
              required
              error={c.image === 'shape' ? t('label.news.pathBad') : c.image === 'long' ? t('label.news.tooLong', fmtNum(st.limits.image)) : null}
              hint={c.image === 'empty' ? t('label.news.pathHint') : null}
            >
              <TextInput value={edit.draft.path} onChange={(v) => setField('path', v)} dir="ltr" mono placeholder="nui://my_resource/images/poster.webp" invalid={c.image === 'shape' || c.image === 'long'} />
            </Field>
          )}
          {saveErr && <InlineAlert tone="danger" title={saveErr} help="help.news.saveFailed" />}
          <ReadyLine missing={missing} />
          <div className="nw-apply">
            <Button help="help.news.save" kind="primary" area="news" busy={busy === 'item'} disabled={!c.ok || (!dirty && edit.id !== null) || (edit.id === null && full) || locked} onClick={() => { void saveItem(); }}>
              {t(edit.id === null ? 'label.news.saveNew' : 'label.news.saveEdit')}
            </Button>
            <Button help="help.news.cancel" kind="ghost" disabled={locked} onClick={closeEditor}>{t('label.news.cancel')}</Button>
          </div>
        </div>
      </Section>
    );
  } else {
    body = (
      <Section
        title={t('label.news.list')}
        help="help.news.list"
        lead={t('label.news.lead')}
        className="nw-listsec"
        actions={(
          <span className="nw-listacts">
            <span className="nw-countline">
              <span>{t('label.news.count', fmtNum(count), fmtNum(max))}</span>
              <HelpTip help="help.news.count" size="sm" />
            </span>
            <Button help="help.news.add" kind="primary" icon="plus" area="news" disabled={full || locked} onClick={() => openEditor(null)}>{t('label.news.add')}</Button>
          </span>
        )}
      >
        {count === 0 ? (
          <EmptyState text={t('label.news.empty')} />
        ) : (
          <ol className="nw-list">
            {st.list.map((n, i) => {
              const title = pick(n.title, lang);
              const date = pick(n.date, lang);
              const text = pick(n.text, lang);
              return (
                <li
                  key={n.id ?? i}
                  className={cls('nw-row', i === pvIndex && 'is-sel')}
                  onMouseEnter={() => setSel(i)}
                  onFocusCapture={() => setSel(i)}
                >
                  <span className="nw-pos k-num" aria-hidden="true">{fmtNum(i + 1)}</span>
                  <span className="nw-thumb" style={{ backgroundImage: `url("${imageUrl(n.image, i, st.resource)}")` }} aria-hidden="true" />
                  <span className="nw-main">
                    <span className="nw-rtitle" dir="auto">{title || <span className="k-faint">{t('label.news.card.noTitle')}</span>}</span>
                    {date && <span className="nw-rdate" dir="auto">{date}</span>}
                    {text && <span className="nw-rtext" dir="auto">{text}</span>}
                    <span className="nw-tags">
                      {!n.title.en && <Tag tone="faint">{t('label.news.noEnglish')}</Tag>}
                      {!n.image && <Tag tone="faint">{t('label.news.autoPlate')}</Tag>}
                    </span>
                  </span>
                  <span className="nw-acts">
                    <IconButton icon="chevronUp" aria-label={t('label.news.up')} help="help.news.up" helpQuiet area="news" disabled={i === 0 || locked} onClick={() => { void move(i, -1); }} />
                    <IconButton icon="chevronDown" aria-label={t('label.news.down')} help="help.news.down" helpQuiet area="news" disabled={i === count - 1 || locked} onClick={() => { void move(i, 1); }} />
                    <Button help="help.news.edit" helpQuiet kind="ghost" size="sm" area="news" disabled={locked} onClick={() => openEditor(i)}>{t('label.news.edit')}</Button>
                    <Button help="help.news.delete" helpQuiet kind="danger" size="sm" area="news" disabled={locked} busy={busy === `delete:${i}`} onClick={() => askDelete(i)}>{t('label.news.delete')}</Button>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        {full && <p className="nw-full">{t('label.news.full', fmtNum(max))}</p>}
      </Section>
    );
  }

  return (
    <div className="nw-page" ref={top}>
      {header}
      <div className="nw-grid">
        <div className="nw-col">{body}</div>
        <div className="nw-side">{preview}</div>
      </div>
    </div>
  );
}
