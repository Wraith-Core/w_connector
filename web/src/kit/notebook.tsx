/* ════════════════════════════════════════════════════════════════════════════
 * w_connector · kit/notebook.tsx  (the builders' notebook look, same as w_lib 4.5.0)
 *   <Fold>        «خيارات متقدمة»: closed by default; what is inside keeps its values while folded
 *   <ReadyLine>   «ينقصه: …» + «أصلحه» (or «جاهز»), the same checks the action itself makes
 *   <Where>       a place line: a pin glyph + «فالنتاين · 1.2 كم منك»
 * ════════════════════════════════════════════════════════════════════════════ */

import { useState } from 'react';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import Glyph from './Glyph';
import { cls } from './format';
import { missingLine } from './where';

export function Fold({ children, label, count, open: start = false, className }: {
  children: ReactNode; label?: string; count?: number; open?: boolean; className?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(start);
  return (
    <div className={cls('k-fold', open && 'is-open', className)}>
      <button type="button" className="k-fold-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Glyph name={open ? 'chevronUp' : 'chevronDown'} className="k-fold-chev" />
        <span className="k-fold-label">{label ?? t('label.place.advanced')}</span>
        {count !== undefined && count > 0 && <span className="k-fold-count k-num">{count}</span>}
      </button>
      {/* folded = hidden, not unmounted: the fields keep what was typed */}
      <div className="k-fold-body" hidden={!open}>{children}</div>
    </div>
  );
}

export function ReadyLine({ missing, onFix, className }: { missing: string[]; onFix?(): void; className?: string }) {
  const { t } = useI18n();
  const ok = missing.length === 0;
  return (
    <div className={cls('k-ready', ok ? 'is-ok' : 'is-missing', className)} role="status">
      <i className="k-ready-dot" aria-hidden="true" />
      <span className="k-ready-text">{ok ? t('label.place.ready') : missingLine(t, missing)}</span>
      {!ok && onFix && <button type="button" className="k-ready-fix" onClick={onFix}>{t('label.place.fix')}</button>}
    </div>
  );
}

export function Where({ text, miss, className }: { text: string; miss?: boolean; className?: string }) {
  if (!text) return null;
  return (
    <span className={cls('k-where', miss && 'is-miss', className)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M12 21c-3.6-4.3-5.6-7.4-5.6-10.1a5.6 5.6 0 0 1 11.2 0c0 2.7-2 5.8-5.6 10.1z" />
        <circle cx="12" cy="10.6" r="1.9" />
      </svg>
      <span>{text}</span>
    </span>
  );
}
