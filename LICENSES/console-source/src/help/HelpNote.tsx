/* The aged-paper note: the "ما هذا؟" caption, the title, the text, an example, a warning, and the
   facts block filled from data (level, undo, allowed range, default). */

import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import type { Level, LevelsMap } from '../types';
import type { HelpEntry, TipSpec } from './types';

/* In an Arabic line a signed number ("−10"), a session number ("#5") or a Latin command
   ("/w_lib", "vector3(1.0, 2.0, 3.0)") would have its sign or slash moved to the wrong side by the
   bidi algorithm. Each such run becomes its own left-to-right island, so it reads as typed.
   An island never swallows what surrounds it: a bracket is kept only when it closes inside the run
   ("vector3(1.0, 2.0)"), never a lone one ("مشرف (mod) أو أعلى" stays "(mod)"), and a sentence's
   full stop or comma stays outside ("مثل 12. لرقم", "w_hud، ثم"). */
const RUN = /(#\d+|[/@]?[A-Za-z][A-Za-z0-9_]*(?:[./:+-]+[A-Za-z0-9_]+)*(?:\([^()]*\))?(?:[ ,]+[A-Za-z0-9_]+(?:[./:+-]+[A-Za-z0-9_]+)*(?:\([^()]*\))?)*|[−+-]?\d+(?:[.,:]\d+)*[%×]?)/g;

export function mixed(text: string, rtl: boolean): ReactNode {
  if (!rtl || !text) return text;
  const parts = text.split(RUN);
  if (parts.length === 1) return text;
  return parts.map((p, i) => (i % 2 === 1 ? <span key={i} className="k-ltr">{p}</span> : <Fragment key={i}>{p}</Fragment>));
}

export interface NoteModel { entry: HelpEntry | null; spec: TipSpec; pinned: boolean }

function fmtBound(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '…';
  return n.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

export default function HelpNote({ model, levels }: { model: NoteModel; levels: LevelsMap }) {
  const { t, rtl } = useI18n();
  const { entry, spec, pinned } = model;
  const f = spec.facts ?? {};
  const level: Level | undefined = f.level ?? (f.area ? levels[f.area] : undefined);
  const undoText = typeof f.undo === 'string' ? f.undo : entry?.undo;
  const danger = !!spec.danger || f.undo === false;
  const title = entry?.title ?? spec.label;

  const facts: { k: string; v: string }[] = [];
  if (level) facts.push({ k: t('label.common.needsLevel'), v: t('label.common.orHigher', t(`label.common.level.${level}`)) });
  if (f.range && (f.range.min !== undefined || f.range.max !== undefined)) {
    const unit = f.range.unit ? ` ${f.range.unit}` : '';
    facts.push({ k: t('label.common.allowed'), v: `${t('label.common.range', fmtBound(f.range.min), fmtBound(f.range.max))}${unit}` });
  }
  if (f.def !== undefined && f.def !== null) {
    const d = typeof f.def === 'boolean' ? t(f.def ? 'label.common.on' : 'label.common.off') : String(f.def);
    facts.push({ k: t('label.common.default'), v: d });
  }
  if (f.appliesTo) facts.push({ k: t('label.common.appliesTo'), v: f.appliesTo });
  if (undoText && !danger) facts.push({ k: t('label.common.canUndo'), v: undoText });
  else if (f.undo === true) facts.push({ k: t('label.common.canUndo'), v: t('label.common.yes') });
  for (const x of f.extra ?? []) facts.push({ k: x.label, v: x.value });

  return (
    <div className={danger ? 'k-note-card is-danger' : 'k-note-card'}>
      <div className="k-note-cap">
        <span className="k-note-hand">{t('label.common.whatIsThis')}</span>
        {pinned && <small className="k-note-pin">{t('label.common.pinned')}</small>}
      </div>
      {title && <h4 className="k-note-title">{title}</h4>}
      {entry
        ? <p className="k-note-text">{mixed(entry.text, rtl)}</p>
        : <p className="k-note-text k-note-missing">{t('label.common.noHelp')}</p>}
      {entry?.example && <p className="k-note-example"><b>{t('label.common.example')}:</b> {mixed(entry.example, rtl)}</p>}
      {entry?.warn && <p className="k-note-warn">{mixed(entry.warn, rtl)}</p>}
      {danger && <p className="k-note-noundo">{t('label.common.noUndo')}{undoText ? <> · {mixed(undoText, rtl)}</> : null}</p>}
      {facts.length > 0 && (
        <dl className="k-note-facts">
          {facts.map((x) => (
            <div className="k-note-fact" key={x.k}>
              <dt>{x.k}</dt>
              <dd>{mixed(x.v, rtl)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
