/* ════════════════════════════════════════════════════════════════════════════
 * The in-page confirmation: a parchment plate on a darkened ground, Yes / No as in the pause menu.
 * Enter confirms, Escape cancels, ← → / Tab move between the two answers.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useT } from '../i18n';
import { Button } from './controls';
import Glyph from './Glyph';
import CraftingFrame from './CraftingFrame';
import { cls, isTypingTarget } from './util';

export interface DialogSpec {
  title: string;
  text?: ReactNode;
  danger?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Extra content between the text and the buttons (a reason box, a duration picker) */
  body?: ReactNode;
  /** Returns false to keep the dialog open (validation failed) */
  onConfirm(): boolean | void | Promise<boolean | void>;
  onCancel?(): void;
}

export default function Dialog({ spec, onClose }: { spec: DialogSpec; onClose(): void }) {
  const t = useT();
  const [focus, setFocus] = useState<0 | 1>(spec.danger ? 1 : 0); // 0 = confirm, 1 = cancel
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const cancel = () => { spec.onCancel?.(); onClose(); };
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await spec.onConfirm();
      if (r === false) { setBusy(false); return; }
      onClose();
    } catch {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); return; }
      if (isTypingTarget(e.target) && e.key !== 'Enter') return;
      switch (e.key) {
        case 'Enter': e.preventDefault(); e.stopPropagation(); if (focus === 0) void confirm(); else cancel(); break;
        case 'ArrowLeft': case 'ArrowRight': case 'Tab':
          e.preventDefault(); e.stopPropagation(); setFocus((f) => (f === 0 ? 1 : 0)); break;
        default:
      }
    };
    /* Capture so the shell's ESC (close the console) does not fire underneath */
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, busy, spec]);

  useEffect(() => {
    const first = rootRef.current?.querySelector<HTMLElement>('input, textarea, select');
    if (first) first.focus();
  }, []);

  return (
    <div className="wa-dialog-veil" onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}>
      <div ref={rootRef} className={cls('wa-dialog wst-root wst-panel', spec.danger && 'wa-dialog--danger')} role="dialog" aria-modal="true">
        <CraftingFrame />
        <div className="wa-dialog-band wst-header">
          <Glyph name={spec.danger ? 'warn' : 'info'} />
          <h2 className="wa-dialog-title wst-title">{spec.title}</h2>
        </div>
        {spec.text !== undefined && <p className="wa-dialog-text">{spec.text}</p>}
        {spec.body && <div className="wa-dialog-body">{spec.body}</div>}
        <div className="wa-dialog-actions">
          <Button
            kind={spec.danger ? 'danger' : 'plate'}
            size="lg"
            className={cls(focus === 0 && 'is-focus')}
            onMouseEnter={() => setFocus(0)}
            onClick={() => void confirm()}
            busy={busy}
          >
            {spec.confirmLabel ?? t('ui_confirm')}
          </Button>
          <Button
            kind="ghost"
            size="lg"
            className={cls(focus === 1 && 'is-focus')}
            onMouseEnter={() => setFocus(1)}
            onClick={cancel}
          >
            {spec.cancelLabel ?? t('ui_cancel')}
          </Button>
        </div>
      </div>
    </div>
  );
}
