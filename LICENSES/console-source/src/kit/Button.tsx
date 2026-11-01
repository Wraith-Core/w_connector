/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · kit/Button.tsx
 *   <Button help="help.drawer.kick" kind="danger" area="kick" onClick={…}>طرد</Button>
 *   <IconButton icon="close" aria-label={t('label.common.close')} help={false} onClick={…} />
 * kind: primary (the paper band, one per view) · secondary (default) · ghost · danger (a red underline
 * under the label; the band under the cursor, never a red slab) · link. Every button is the paper band
 * under the cursor (styles/kit.css). The "؟" sits after the button, never inside it.
 * area: the button is shown disabled with a lock when the admin's level is too low.
 * ════════════════════════════════════════════════════════════════════════════ */

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useApp } from '../ctx';
import { actionReason } from '../nui';
import HelpTip from '../help/HelpTip';
import type { HelpFacts, HelpProp } from '../help/types';
import { useI18n } from '../i18n';
import type { Area } from '../types';
import { cls } from './format';
import { useLock } from './Gate';
import Glyph from './Glyph';
import type { GlyphName } from './Glyph';

export type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'children'> {
  actionName?: string;
  help: HelpProp;
  children?: ReactNode;
  kind?: ButtonKind;
  size?: 'sm' | 'md' | 'lg';
  icon?: GlyphName;
  busy?: boolean;
  block?: boolean;
  /** the permission area; locked → disabled with a lock and the level in the note */
  area?: Area;
  facts?: HelpFacts;
  /** the note title when the children are not plain text */
  helpLabel?: string;
  /** the destructive confirm of a confirm dialog (an outline on the paper note with the red underline) */
  filled?: boolean;
  submit?: boolean;
  /** keyboard shortcut shown at the end (e.g. 'Esc', 'PgUp') */
  kbd?: string;
  /** the "؟" shows only in help mode (busy chrome such as the top bar) */
  helpQuiet?: boolean;
  /** the note's danger variant ("cannot be undone"); default: kind === 'danger'. A danger button that
   *  CAN be undone (kick, ban: lifted from the Bans page) passes false. */
  helpDanger?: boolean;
  /** locked for another reason than the admin's level (the script's own permission): disabled with
   *  a lock, like an area lock; `lockReason` is the tooltip */
  locked?: boolean;
  lockReason?: string;
}

/** A label that already ends with an ellipsis does not get a second one while busy */
const endsWithDots = (c: ReactNode) => typeof c === 'string' && /(…|\.\.\.)\s*$/.test(c);

export function Button({
  help, children, kind = 'secondary', size = 'md', icon, busy, block, area, facts, helpLabel, filled, submit, kbd, helpQuiet,
  helpDanger, locked, lockReason, actionName, className, disabled, title, ...rest
}: ButtonProps) {
  const { t } = useI18n();
  const app = useApp();
  if (actionName && !app.canAction(actionName)) { locked = true; lockReason = actionReason(actionName); }
  const lock = useLock(area);
  const isLocked = lock.locked || !!locked;
  const label = helpLabel ?? (typeof children === 'string' ? children : undefined);
  const lockTitle = lock.locked ? (lock.level ? t('label.common.lockedNeeds', t(`label.common.level.${lock.level}`)) : t('label.common.locked'))
    : locked ? (lockReason ?? t('label.common.locked')) : undefined;
  return (
    <span className={cls('k-btnwrap', block && 'is-block')}>
      <button
        type={submit ? 'submit' : 'button'}
        className={cls('k-btn', `k-btn--${kind}`, `k-btn--${size}`, filled && 'is-filled', busy && 'is-busy', busy && !endsWithDots(children) && 'is-busy-dots', isLocked && 'is-locked', block && 'is-block', className)}
        disabled={disabled || busy || isLocked}
        aria-busy={busy || undefined}
        title={lockTitle ?? title}
        {...rest}
      >
        {icon && <Glyph name={icon} />}
        {children !== undefined && <span className="k-btn-label">{children}</span>}
        {kbd && <kbd>{kbd}</kbd>}
        {isLocked && <Glyph name="lock" className="k-btn-lock" />}
      </button>
      <HelpTip help={help} label={label} facts={area || lock.area ? { ...facts, area: area ?? lock.area } : facts} danger={helpDanger ?? kind === 'danger'} size="sm" className={helpQuiet ? 'k-help--quiet' : undefined} />
    </span>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'children'> {
  icon: GlyphName;
  'aria-label': string;
  help: HelpProp;
  kind?: 'ghost' | 'secondary' | 'danger';
  size?: 'sm' | 'md';
  area?: Area;
  pressed?: boolean;
  helpQuiet?: boolean;
}

export function IconButton({ icon, help, kind = 'ghost', size = 'md', area, pressed, helpQuiet, className, disabled, ...rest }: IconButtonProps) {
  const lock = useLock(area);
  return (
    <span className="k-btnwrap">
      <button
        type="button"
        className={cls('k-iconbtn', `k-iconbtn--${kind}`, `k-iconbtn--${size}`, lock.locked && 'is-locked', className)}
        disabled={disabled || lock.locked}
        aria-pressed={pressed}
        title={rest['aria-label']}
        {...rest}
      >
        <Glyph name={icon} />
      </button>
      <HelpTip help={help} label={rest['aria-label']} facts={area ? { area } : undefined} danger={kind === 'danger'} size="sm" className={helpQuiet ? 'k-help--quiet' : undefined} />
    </span>
  );
}

/** A row of buttons that wraps */
export function ButtonRow({ children, end, className }: { children: ReactNode; end?: boolean; className?: string }) {
  return <div className={cls('k-btnrow', end && 'is-end', className)}>{children}</div>;
}
