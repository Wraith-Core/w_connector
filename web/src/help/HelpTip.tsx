/* The "؟" button. It is always a sibling of the control it explains, never inside it, so pressing it
   never triggers the action. All behaviour lives in HelpProvider (one delegated listener set). */

import { useEffect, useRef } from 'react';
import { useI18n } from '../i18n';
import type { Area } from '../types';
import { HELP_NOTE_ID, useHelp } from './HelpProvider';
import { hasHelp, pickText } from './texts';
import type { HelpFacts, HelpProp, TipSpec } from './types';

export interface HelpTipProps {
  help: HelpProp;
  /** the visible label of the control (note title fallback, aria-label) */
  label?: string;
  facts?: HelpFacts;
  /** shortcut for facts.area */
  area?: Area;
  /** the danger variant: red rule, "cannot be undone" */
  danger?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export default function HelpTip({ help, label, facts, area, danger, size = 'md', className }: HelpTipProps) {
  const { register } = useHelp();
  const { t, lang, rtl } = useI18n();
  const ref = useRef<HTMLButtonElement>(null);
  const spec = useRef<TipSpec>({ help: 'help.common.level' });
  if (help !== false) spec.current = { help, label, facts: area ? { ...facts, area } : facts, danger };

  useEffect(() => {
    if (!ref.current) return undefined;
    return register(ref.current, spec);
  }, [register, help === false]);

  if (help === false) return null;
  const missing = !hasHelp(help, lang);
  const title = label ?? (typeof help === 'string' ? '' : pickText(help.title, lang) ?? '');
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={['k-help', `k-help--${size}`, danger ? 'k-help--danger' : '', missing ? 'is-missing' : '', className ?? ''].filter(Boolean).join(' ')}
        data-k-help=""
        data-help-key={typeof help === 'string' ? help : undefined}
        aria-label={t('label.common.helpFor', title)}
        aria-expanded={false}
        aria-controls={HELP_NOTE_ID}
      >
        <span aria-hidden="true">{rtl ? '؟' : '?'}</span>
      </button>
      {missing && <span className="k-help-missing">{t('label.common.noHelp')}</span>}
    </>
  );
}
