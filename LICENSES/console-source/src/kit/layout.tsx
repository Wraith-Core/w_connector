/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · kit/layout.tsx
 *   PageHeader (title + "؟" + one plain line + actions) · PageActions (a page puts buttons in the header)
 *   Section · Tabs · FilterChips · Toolbar
 *   SplitView (list at the reading start, drawer at the end, EACH scrolls on its own: B7)
 *   Drawer (sticky header, sticky tabs, sticky footer with the 3 most used actions)
 *   SettingsLayout (category list + form) · SaveBar ("You have 2 unsaved changes [Discard] [Save]")
 * ════════════════════════════════════════════════════════════════════════════ */

import { createContext, useContext, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import HelpTip from '../help/HelpTip';
import type { HelpFacts, HelpProp } from '../help/types';
import { pluralForm, useI18n } from '../i18n';
import type { Area, Level } from '../types';
import { Button, IconButton } from './Button';
import { cls, fmtNum } from './format';
import { useLock } from './Gate';
import Glyph from './Glyph';

/* ── PageHeader / PageActions ────────────────────────────────────────────── */

const ActionsSlot = createContext<HTMLElement | null>(null);
export const PageActionsSlotProvider = ActionsSlot.Provider;

export interface PageHeaderProps {
  title: string;
  help: HelpProp;
  description?: ReactNode;
  actions?: ReactNode;
  /** the element the page's <PageActions> portal into (the shell passes it) */
  slotRef?: (el: HTMLDivElement | null) => void;
  className?: string;
}

export function PageHeader({ title, help, description, actions, slotRef, className }: PageHeaderProps) {
  return (
    <header className={cls('k-pagehead', className)}>
      <div className="k-pagehead-main">
        <h1 className="k-pagehead-title">
          <span>{title}</span>
          <HelpTip help={help} label={title} size="lg" />
        </h1>
        {description && <p className="k-pagehead-desc">{description}</p>}
      </div>
      <div className="k-pagehead-actions" ref={slotRef}>{actions}</div>
    </header>
  );
}

/** Puts its children into the page header's action area (the header is drawn by the shell) */
export function PageActions({ children }: { children: ReactNode }) {
  const slot = useContext(ActionsSlot);
  if (!slot) return null;
  return createPortal(children, slot);
}

/* ── Section ─────────────────────────────────────────────────────────────── */

export interface SectionProps {
  title: string;
  help: HelpProp;
  lead?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  /** danger: a red rule at the start (the danger zone) */
  tone?: 'default' | 'danger' | 'plain';
  area?: Area;
  facts?: HelpFacts;
  className?: string;
  id?: string;
}

export function Section({ title, help, lead, actions, children, tone = 'default', area, facts, className, id }: SectionProps) {
  return (
    <section className={cls('k-section', `k-section--${tone}`, className)} id={id} aria-label={title}>
      <header className="k-section-head">
        <h3 className="k-section-title">
          <span>{title}</span>
          <HelpTip help={help} label={title} facts={area ? { ...facts, area } : facts} danger={tone === 'danger'} size="sm" />
        </h3>
        {actions && <div className="k-section-actions">{actions}</div>}
      </header>
      {lead && <p className="k-section-lead">{lead}</p>}
      {children !== undefined && <div className="k-section-body">{children}</div>}
    </section>
  );
}

/* ── Tabs ────────────────────────────────────────────────────────────────── */

export interface TabItem<V extends string = string> {
  id: V;
  label: string;
  help: HelpProp;
  badge?: ReactNode;
  disabled?: boolean;
  area?: Area;
  /** locked for a reason `area` cannot say (a tab that needs one of several areas): disabled with a lock */
  locked?: boolean;
  /** the level named in the lock's tooltip and the note's facts */
  lockLevel?: Level | null;
}

export interface TabsProps<V extends string = string> {
  items: TabItem<NoInfer<V>>[];
  value: V;
  onChange(v: NoInfer<V>): void;
  /** aria-label of the tab list */
  label: string;
  variant?: 'line' | 'box';
  /** narrow strips (a 560 px drawer with six tabs): each "؟" sits inside its tab's end padding, so a
   *  hidden one takes no room and the strip stays on one row */
  compact?: boolean;
  className?: string;
  /** id prefix for aria-controls (the panel is `${idBase}-panel`) */
  idBase?: string;
}

/** The "؟" of the active tab is always shown; the others show in help mode, on hover and on focus */
export function Tabs<V extends string = string>({ items, value, onChange, label, variant = 'line', compact, className, idBase }: TabsProps<V>) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (d: number) => {
    const enabled = items.filter((x) => !x.disabled && !x.locked);
    const i = enabled.findIndex((x) => x.id === value);
    const next = enabled[((i < 0 ? 0 : i) + d + enabled.length) % enabled.length];
    if (!next) return;
    onChange(next.id);
    ref.current?.querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`)?.focus();
  };
  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={label}
      className={cls('k-tabs', `k-tabs--${variant}`, compact && 'k-tabs--compact', className)}
      onKeyDown={(e) => {
        const rtl = document.documentElement.dir === 'rtl';
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); move((e.key === 'ArrowRight') !== rtl ? 1 : -1); }
        else if (e.key === 'Home') { e.preventDefault(); const f = items.find((x) => !x.disabled); if (f) onChange(f.id); }
        else if (e.key === 'End') { e.preventDefault(); const l = [...items].reverse().find((x) => !x.disabled); if (l) onChange(l.id); }
      }}
    >
      {items.map((it) => <TabButton key={it.id} it={it} active={it.id === value} onChange={onChange} idBase={idBase} />)}
    </div>
  );
}

function TabButton<V extends string>({ it, active, onChange, idBase }: { it: TabItem<V>; active: boolean; onChange(v: V): void; idBase?: string }) {
  const { t } = useI18n();
  const lock = useLock(it.area);
  const locked = lock.locked || !!it.locked;
  const level = lock.locked ? lock.level : it.lockLevel;
  const facts = it.area ? { area: it.area } : it.locked && it.lockLevel ? { level: it.lockLevel } : undefined;
  return (
    <span className={cls('k-tab-wrap', active && 'is-active', locked && 'is-locked')}>
      <button
        type="button"
        role="tab"
        data-tab={it.id}
        aria-selected={active}
        aria-controls={idBase ? `${idBase}-panel` : undefined}
        tabIndex={active ? 0 : -1}
        disabled={it.disabled || locked}
        title={locked ? (level ? t('label.common.lockedNeeds', t(`label.common.level.${level}`)) : t('label.common.locked')) : undefined}
        className={cls('k-tab', active && 'is-active')}
        onClick={() => onChange(it.id)}
      >
        <span>{it.label}</span>
        {it.badge !== undefined && it.badge !== null && <span className="k-tab-badge k-num">{it.badge}</span>}
        {locked && <Glyph name="lock" className="k-tab-lock" />}
      </button>
      <HelpTip help={it.help} label={it.label} facts={facts} size="sm" className="k-tab-help" />
    </span>
  );
}

/* ── FilterChips ─────────────────────────────────────────────────────────── */

export interface ChipItem<V extends string = string> { id: V; label: string; count?: number; help: HelpProp }

export function FilterChips<V extends string = string>({ items, value, onChange, label, className }: { items: ChipItem<NoInfer<V>>[]; value: V; onChange(v: NoInfer<V>): void; label: string; className?: string }) {
  return (
    <div className={cls('k-chips', className)} role="radiogroup" aria-label={label}>
      {items.map((c) => (
        <span className="k-chip-wrap" key={c.id}>
          <button type="button" role="radio" aria-checked={c.id === value} className={cls('k-chip', c.id === value && 'is-on')} onClick={() => onChange(c.id)}>
            {c.count !== undefined && <i className="k-num">{fmtNum(c.count)}</i>}
            <span>{c.label}</span>
          </button>
          <HelpTip help={c.help} label={c.label} size="sm" className="k-chip-help" />
        </span>
      ))}
    </div>
  );
}

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cls('k-toolbar', className)}>{children}</div>;
}

/* ── SplitView ───────────────────────────────────────────────────────────── */

export function SplitView({ list, drawer, className }: { list: ReactNode; drawer?: ReactNode | null; className?: string }) {
  return (
    <div className={cls('k-split', drawer ? 'has-drawer' : '', className)}>
      <div className="k-split-list">{list}</div>
      {drawer && <div className="k-split-drawer">{drawer}</div>}
    </div>
  );
}

/* ── Drawer ──────────────────────────────────────────────────────────────── */

export interface DrawerProps<V extends string = string> {
  title: ReactNode;
  help: HelpProp;
  /** the note title when title is not plain text */
  helpLabel?: string;
  /** the ids line under the title (citizen id, #server id) */
  sub?: ReactNode;
  /** status chips */
  chips?: ReactNode;
  tabs?: TabItem<NoInfer<V>>[];
  tab?: V;
  onTab?(v: NoInfer<V>): void;
  tabsLabel?: string;
  /** the tab strip's compact form (see Tabs `compact`) */
  tabsCompact?: boolean;
  /** the sticky footer: the 3 most-used actions */
  footer?: ReactNode;
  footerNote?: ReactNode;
  onClose?(): void;
  children: ReactNode;
  className?: string;
}

export function Drawer<V extends string = string>({ title, help, helpLabel, sub, chips, tabs, tab, onTab, tabsLabel, tabsCompact, footer, footerNote, onClose, children, className }: DrawerProps<V>) {
  const { t } = useI18n();
  const label = helpLabel ?? (typeof title === 'string' ? title : undefined);
  return (
    <aside className={cls('k-drawer', className)} aria-label={label}>
      <header className="k-drawer-head">
        <div className="k-drawer-row">
          <div className="k-drawer-titles">
            <h2 className="k-drawer-title">
              <span>{title}</span>
              <HelpTip help={help} label={label} size="md" />
            </h2>
            {sub && <div className="k-drawer-sub">{sub}</div>}
          </div>
          {onClose && <IconButton icon="close" aria-label={t('label.common.close')} help="help.common.close" helpQuiet onClick={onClose} className="k-drawer-close" />}
        </div>
        {chips && <div className="k-drawer-chips">{chips}</div>}
        {tabs && tab !== undefined && onTab && (
          <Tabs items={tabs} value={tab} onChange={onTab} label={tabsLabel ?? label ?? ''} idBase="k-drawer" compact={tabsCompact} className="k-drawer-tabs" />
        )}
      </header>
      <div className="k-drawer-body" id={tabs ? 'k-drawer-panel' : undefined} role={tabs ? 'tabpanel' : undefined}>{children}</div>
      {footer && (
        <footer className="k-drawer-foot">
          <div className="k-drawer-foot-actions">{footer}</div>
          {footerNote && <span className="k-drawer-foot-note">{footerNote}</span>}
        </footer>
      )}
    </aside>
  );
}

/* ── SettingsLayout / SaveBar ────────────────────────────────────────────── */

export interface SettingsNavItem<V extends string = string> { id: V; label: string; help: HelpProp; badge?: ReactNode; dirty?: boolean; area?: Area }

export interface SettingsLayoutProps<V extends string = string> {
  nav: SettingsNavItem<NoInfer<V>>[];
  value: V;
  onChange(v: NoInfer<V>): void;
  navTitle?: string;
  children: ReactNode;
  /** the SaveBar (sticky at the bottom of the form) */
  footer?: ReactNode;
  /** something above the form (search, chips) */
  toolbar?: ReactNode;
  className?: string;
}

export function SettingsLayout<V extends string = string>({ nav, value, onChange, navTitle, children, footer, toolbar, className }: SettingsLayoutProps<V>) {
  return (
    <div className={cls('k-settings', className)}>
      <nav className="k-settings-nav" aria-label={navTitle}>
        {navTitle && <h6 className="k-settings-navtitle">{navTitle}</h6>}
        {nav.map((n) => (
          <span className={cls('k-settings-item', n.id === value && 'is-active')} key={n.id}>
            <button type="button" className="k-settings-btn" aria-current={n.id === value ? 'page' : undefined} onClick={() => onChange(n.id)}>
              <span className="k-ellipsis">{n.label}</span>
              {n.dirty && <i className="k-settings-dirty" aria-hidden="true" />}
              {n.badge !== undefined && n.badge !== null && <span className="k-nav-badge k-num">{n.badge}</span>}
            </button>
            <HelpTip help={n.help} label={n.label} facts={n.area ? { area: n.area } : undefined} size="sm" className="k-settings-help" />
          </span>
        ))}
      </nav>
      <div className="k-settings-main">
        {toolbar && <div className="k-settings-toolbar">{toolbar}</div>}
        <div className="k-settings-form">{children}</div>
        {footer}
      </div>
    </div>
  );
}

export interface SaveBarProps {
  count: number;
  onDiscard(): void;
  onSave(): void;
  saving?: boolean;
  /** replaces "Save and apply to everyone" */
  saveLabel?: string;
  saveHelp?: HelpProp;
  note?: ReactNode;
  area?: Area;
}

export function SaveBar({ count, onDiscard, onSave, saving, saveLabel, saveHelp, note, area }: SaveBarProps) {
  const { t, lang } = useI18n();
  if (count <= 0) return null;
  /* "لديك تعديل واحد…" / "لديك تعديلان…" / "لديك 3 تعديلات…" / "You have 1 unsaved change" */
  const msg = t(`label.common.unsavedN.${pluralForm(count, lang)}`, count);
  return (
    <div className="k-savebar" role="region" aria-label={msg}>
      <span className="k-savebar-msg">
        {msg}
        <HelpTip help="help.common.unsaved" size="sm" />
      </span>
      {note && <span className="k-savebar-note">{note}</span>}
      <span className="k-savebar-btns">
        <Button help="help.common.discard" kind="ghost" onClick={onDiscard} disabled={saving}>{t('label.common.discard')}</Button>
        <Button help={saveHelp ?? 'help.common.save'} kind="primary" onClick={onSave} busy={saving} area={area}>{saving ? t('label.common.saving') : saveLabel ?? t('label.common.save')}</Button>
      </span>
    </div>
  );
}
