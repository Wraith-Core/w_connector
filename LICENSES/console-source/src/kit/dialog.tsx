/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · kit/dialog.tsx
 * The confirm dialog: an aged-paper card on a real dimming backdrop (B10). It owns its state, so a
 * reason box or a type-to-confirm input inside it works (B11).
 *
 *   app.confirm({ title, text, danger: true, onConfirm })
 *   app.confirm<string>({ title, initial: '', render: ({ value, set }) => <ReasonField …/>,
 *                          canConfirm: (v) => v.trim() !== '', onConfirm: (v) => kick(v) })
 *   app.confirm({ title, danger: true, phrase: '14', onConfirm })   ← type-to-confirm
 *
 * Enter confirms (not inside a text area), Esc cancels without closing the console.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import HelpTip from '../help/HelpTip';
import type { HelpProp } from '../help/types';
import { useI18n } from '../i18n';
import { Button } from './Button';
import { cls } from './format';
import { TextInput } from './inputs';

export interface ConfirmSpec<V = unknown> {
  title: string;
  text?: ReactNode;
  /** the "؟" next to the title */
  help?: HelpProp;
  danger?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  /** legacy: a ReactNode captured when opened (the old tabs pass one) */
  body?: ReactNode;
  /** the starting value of the dialog's own state */
  initial?: V;
  /** a stateful body: the dialog owns `value` and hands it to onConfirm */
  render?(api: { value: V; set(v: V): void }): ReactNode;
  /** the confirm button stays disabled until this is true */
  canConfirm?(value: V): boolean;
  /** type-to-confirm: the exact text to type (a citizen id, a resource name) */
  phrase?: string;
  /** false shows the "cannot be undone" band (default: danger with a phrase) */
  undoable?: boolean;
  /** return false to keep the dialog open (validation failed) */
  onConfirm(value: V): boolean | void | Promise<boolean | void>;
  onCancel?(): void;
}

export function ConfirmDialog<V>({ spec, onClose }: { spec: ConfirmSpec<V>; onClose(): void }) {
  const { t, rtl } = useI18n();
  const [value, setValue] = useState<V>(spec.initial as V);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLDivElement>(null);
  const phraseOk = spec.phrase === undefined || typed.trim() === spec.phrase;
  const valueOk = spec.canConfirm ? spec.canConfirm(value) : true;
  const ready = phraseOk && valueOk && !busy;
  const noUndo = spec.undoable === false || (spec.undoable === undefined && !!spec.danger && spec.phrase !== undefined);

  const cancel = () => { if (busy) return; spec.onCancel?.(); onClose(); };
  const confirm = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      const r = await spec.onConfirm(value);
      if (r === false) { setBusy(false); return; }
      onClose();
    } catch {
      setBusy(false);
    }
  };
  const latest = useRef({ cancel, confirm });
  latest.current = { cancel, confirm };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); latest.current.cancel(); return; }
      if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) {
        const inPop = e.target instanceof Element && e.target.closest('.k-pop');
        if (inPop) return;
        e.preventDefault(); e.stopPropagation(); void latest.current.confirm();
      }
    };
    /* capture: the console's own Esc (close) must not fire underneath */
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  useEffect(() => {
    const first = card.current?.querySelector<HTMLElement>('input, textarea');
    if (first) first.focus();
    else if (spec.danger) cancelRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    else card.current?.querySelector<HTMLButtonElement>('.k-dialog-actions .k-btn--primary')?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="k-dialog-veil k-layer" dir={rtl ? 'rtl' : 'ltr'} onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}>
      <div ref={card} className={cls('k-dialog k-onpaper', spec.danger && 'is-danger')} role="alertdialog" aria-modal="true" aria-label={spec.title}>
        <header className="k-dialog-head">
          <h2 className="k-dialog-title">
            <span>{spec.title}</span>
            {spec.help !== undefined && spec.help !== false && <HelpTip help={spec.help} label={spec.title} danger={spec.danger} size="md" />}
          </h2>
        </header>
        {spec.text !== undefined && <div className="k-dialog-text">{spec.text}</div>}
        {spec.body && <div className="k-dialog-body">{spec.body}</div>}
        {spec.render && <div className="k-dialog-body">{spec.render({ value, set: setValue })}</div>}
        {spec.phrase !== undefined && (
          <div className="k-dialog-phrase">
            <label className="k-dialog-phrase-label" htmlFor="k-dialog-phrase">
              {t('label.common.typeToConfirm', '')}<b className="k-ltr">{spec.phrase}</b>
            </label>
            <TextInput
              id="k-dialog-phrase"
              value={typed}
              onChange={setTyped}
              dir="ltr"
              placeholder={spec.phrase}
              label={t('label.common.typeToConfirm', spec.phrase)}
              help="help.common.typeToConfirm"
              invalid={typed !== '' && !phraseOk}
            />
          </div>
        )}
        {noUndo && <p className="k-dialog-noundo">{t('label.common.cannotUndo')}</p>}
        <footer className="k-dialog-actions">
          <Button help="help.common.confirm" kind={spec.danger ? 'danger' : 'primary'} filled={!!spec.danger} size="lg" disabled={!ready} busy={busy} onClick={() => void confirm()}>
            {spec.confirmLabel ?? t('label.common.confirm')}
          </Button>
          <div ref={cancelRef} className="k-dialog-cancel">
            <Button help="help.common.cancel" kind="ghost" size="lg" onClick={cancel} disabled={busy}>
              {spec.cancelLabel ?? t('label.common.cancel')}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/** The dialog host the shell mounts once; app.confirm(spec) opens it */
export function DialogHost({ spec, onClose }: { spec: ConfirmSpec<unknown> | null; onClose(): void }) {
  if (!spec) return null;
  return <ConfirmDialog key={spec.title + String(spec.phrase ?? '')} spec={spec} onClose={onClose} />;
}

export interface TypeToConfirmDialogProps {
  open: boolean;
  title: string;
  text?: ReactNode;
  phrase: string;
  help?: HelpProp;
  confirmLabel?: string;
  onConfirm(): boolean | void | Promise<boolean | void>;
  onCancel(): void;
}

/** A standalone type-to-confirm dialog (the same card; app.confirm({ phrase }) is the short form) */
export function TypeToConfirmDialog({ open, title, text, phrase, help, confirmLabel, onConfirm, onCancel }: TypeToConfirmDialogProps) {
  if (!open) return null;
  return (
    <ConfirmDialog
      spec={{ title, text, phrase, help, danger: true, undoable: false, confirmLabel, onConfirm: () => onConfirm(), onCancel }}
      onClose={onCancel}
    />
  );
}
