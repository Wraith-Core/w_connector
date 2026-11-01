/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · app/AppShell.tsx
 * The frame: sidebar (wordmark, sections, pages, who you are; collapsible to a rail, remembered),
 * top bar (breadcrumb, command palette, online count, help mode, quick menu, close), the help-mode
 * banner, and the page frame (header from the page definition + body + an error boundary so one
 * broken page never takes the console down).
 * The chrome's "؟" are quiet (shown in help mode); the page's own "؟" are always visible.
 * ════════════════════════════════════════════════════════════════════════════ */

import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ErrorInfo, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useApp } from '../ctx';
import { HelpTip, useHelp } from '../help';
import { useI18n } from '../i18n';
import { Button, IconButton } from '../kit/Button';
import { EmptyState, InlineAlert, Loading } from '../kit/data';
import { cls, fmtNum, isTypingTarget } from '../kit/format';
import Glyph from '../kit/Glyph';
import { PageActionsSlotProvider, PageHeader } from '../kit/layout';
import CommandPalette from './CommandPalette';
import type { PageDef } from './pages';
import { descKeyOf, helpKeyOf, labelKeyOf, pageById, sectionsOf, visiblePages, allowed } from './registry';

const LS_RAIL = 'w_admin:navRail';

/* ── Sidebar ─────────────────────────────────────────────────────────────── */

function NavItem({ def, active, rail }: { def: PageDef; active: boolean; rail: boolean }) {
  const app = useApp();
  const { t, lang } = useI18n();
  const label = t(labelKeyOf(def));
  const badge = def.badge?.(app) ?? null;
  const sub = def.subnav?.(app, { t, lang }) ?? [];
  /* a pinned sub-item that is open carries the marker alone */
  const subOpen = active && !!app.route.params.sub && sub.some((s) => s.id === app.route.params.sub);
  return (
    <>
      <span className={cls('sh-nav-item', active && 'is-active', subOpen && 'is-parent')}>
        <button
          type="button"
          className="sh-nav-btn"
          data-page={def.id}
          aria-current={active && !app.route.params.sub ? 'page' : undefined}
          title={rail ? label : undefined}
          onClick={() => app.navigate(def.id)}
        >
          <Glyph name={def.glyph} className="sh-nav-glyph" />
          <span className="sh-nav-label k-ellipsis">{label}</span>
          {badge !== null && badge !== 0 && <span className="k-nav-badge k-num">{typeof badge === 'number' ? fmtNum(badge) : badge}</span>}
        </button>
        <HelpTip help={helpKeyOf(def)} label={label} size="sm" className="k-help--quiet sh-nav-help" />
      </span>
      {!rail && sub.map((s) => {
        const on = active && app.route.params.sub === s.id;
        return (
          <span className={cls('sh-nav-item sh-nav-sub', on && 'is-active')} key={s.id}>
            <button type="button" className="sh-nav-btn" aria-current={on ? 'page' : undefined} onClick={() => app.navigate(def.id, { ...s.params, sub: s.id })}>
              <span className="sh-nav-label k-ellipsis">{s.label}</span>
              {s.badge !== undefined && s.badge !== null && <span className="k-nav-badge k-num">{s.badge}</span>}
            </button>
            <HelpTip help={s.help} label={s.label} size="sm" className="k-help--quiet sh-nav-help" />
          </span>
        );
      })}
    </>
  );
}

function Sidebar({ rail }: { rail: boolean }) {
  const app = useApp();
  const { t } = useI18n();
  const groups = useMemo(() => sectionsOf(visiblePages(app)), [app]);
  const navRef = useRef<HTMLElement>(null);

  /* ↑ ↓ move between pages while the focus is in the menu */
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const btns = Array.from(navRef.current?.querySelectorAll<HTMLButtonElement>('.sh-nav-btn') ?? []);
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus();
  };

  const who = app.admin;
  const rank = app.rank ?? (who?.group as string | undefined);
  return (
    <aside className="sh-side" id="sh-side">
      <div className="sh-brand">
        {!rail && <div className="sh-mark">WRAITH</div>}
        {!rail && <div className="sh-brand-ar">{t('label.shell.brand')}</div>}
        {!rail && app.serverName && <div className="sh-server k-ellipsis">{app.serverName}</div>}
      </div>
      <nav className="sh-nav" ref={navRef} aria-label={t('label.shell.brand')} onKeyDown={onKey}>
        <span className="sh-nav-helprow"><HelpTip help="help.shell.nav" size="sm" className="k-help--quiet" /></span>
        {groups.length === 0 && <p className="sh-nav-empty">{t('label.shell.noPages')}</p>}
        {groups.map((g) => (
          <div className="sh-navsec" key={g.section}>
            <h6 className="sh-navsec-title">{t(`label.shell.section.${g.section}`)}</h6>
            {g.pages.map((p) => <NavItem key={p.id} def={p} active={app.route.page === p.id} rail={rail} />)}
          </div>
        ))}
      </nav>
      {who && (
        <div className="sh-who">
          <div className="sh-who-name k-ellipsis">
            <span>{who.name}</span>
            <HelpTip help="help.shell.whoami" label={who.name} size="sm" className="k-help--quiet" />
          </div>
          {!rail && (
            <div className="sh-who-meta">
              <span>{t('label.shell.whoLevel')}: <b className="k-ltr">{rank ?? '—'}</b></span>
              {who.citizenid && <span> · {t('label.shell.whoCid')} <b className="k-num">{who.citizenid}</b></span>}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

/* ── Top bar ─────────────────────────────────────────────────────────────── */

function TopBar({ rail, onRail, def }: { rail: boolean; onRail(): void; def: PageDef | undefined }) {
  const app = useApp();
  const { t, rtl } = useI18n();
  const help = useHelp();
  const online = app.serverInfo ? `${fmtNum(app.serverInfo.playersOnline)} / ${fmtNum(app.serverInfo.maxPlayers)}` : fmtNum(app.players.length);
  return (
    <header className="sh-top">
      <IconButton
        icon="menu"
        aria-label={t(rail ? 'label.shell.navExpand' : 'label.shell.navCollapse')}
        aria-expanded={!rail}
        aria-controls="sh-side"
        help="help.shell.navCollapse"
        helpQuiet
        onClick={onRail}
      />
      <nav className="sh-crumb k-ellipsis" aria-label="breadcrumb">
        <span>{t('label.shell.crumbRoot')}</span>
        {def && <><span className="sh-crumb-sep">/</span><span>{t(`label.shell.section.${def.section}`)}</span></>}
        {def && <><span className="sh-crumb-sep">/</span><span className="sh-crumb-here">{t(labelKeyOf(def))}</span></>}
      </nav>
      <span className="sh-cmdwrap">
        <button type="button" className="sh-cmd" onClick={() => app.openPalette()} aria-haspopup="dialog">
          <Glyph name="search" />
          <span className="k-ellipsis">{t('label.shell.palette.open')}</span>
          <kbd>Ctrl K</kbd>
        </button>
        <HelpTip help="help.shell.palette" size="sm" className="k-help--quiet" />
      </span>
      <span className="sh-pillwrap">
        <span className="sh-pill" role="status">
          <span>{t('label.shell.online')}</span>
          <b className="k-num">{online}</b>
        </span>
        <HelpTip help="help.shell.online" size="sm" className="k-help--quiet" />
      </span>
      <span className="sh-pillwrap">
        <button type="button" className={cls('sh-pill sh-helpbtn', help.helpMode && 'is-on')} aria-pressed={help.helpMode} onClick={help.toggleHelpMode}>
          <span className="sh-q" aria-hidden="true">{rtl ? '؟' : '?'}</span>
          <span>{t('label.shell.helpMode')}</span>
          <kbd>F1</kbd>
        </button>
        <HelpTip help="help.shell.helpMode" size="sm" className="k-help--quiet" />
      </span>
      <Button help="help.shell.quick" helpQuiet kind="ghost" size="sm" kbd="F10" className="sh-pill" onClick={() => app.setMode('quick')}>{t('label.shell.quick')}</Button>
      <Button help="help.shell.close" helpQuiet kind="ghost" size="sm" kbd="Esc" className="sh-pill" onClick={app.close}>{t('label.shell.close')}</Button>
    </header>
  );
}

function HelpBanner() {
  const help = useHelp();
  const { t, rtl } = useI18n();
  if (!help.helpMode) return null;
  return (
    <div className="sh-banner" role="status">
      <span className="sh-q" aria-hidden="true">{rtl ? '؟' : '?'}</span>
      <span>{t('label.shell.helpBanner')}</span>
      <Button help="help.shell.helpMode" helpQuiet kind="link" size="sm" onClick={() => help.setHelpMode(false)}>{t('label.shell.helpBannerOff')}</Button>
    </div>
  );
}

/* ── Page frame ──────────────────────────────────────────────────────────── */

class PageBoundary extends Component<{ children: ReactNode; title: string; retry: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[w_admin] page crashed', error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="sh-crash">
        <InlineAlert tone="danger" title={this.props.title}>
          <span className="k-mono">{String(this.state.error.message || this.state.error)}</span>
        </InlineAlert>
      </div>
    );
  }
}

function PageFrame({ def }: { def: PageDef | undefined }) {
  const app = useApp();
  const { t } = useI18n();
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const slotRef = useCallback((el: HTMLDivElement | null) => setSlot(el), []);
  if (!def) return <div className="sh-page"><EmptyState text={t('label.shell.noPages')} /></div>;
  const C = def.component;
  return (
    <section className="sh-page" aria-label={t(labelKeyOf(def))}>
      {def.header !== false && (
        <PageHeader title={t(labelKeyOf(def))} help={helpKeyOf(def)} description={t(descKeyOf(def))} slotRef={slotRef} />
      )}
      <PageActionsSlotProvider value={slot}>
        <div className={cls('sh-body', def.layout === 'fill' ? 'is-fill' : 'is-scroll', def.header === false && 'is-noheader')}>
          <PageBoundary key={def.id} title={t('label.common.loadError')} retry={t('label.common.retry')}>
            <Suspense fallback={<Loading />}>
              <C route={app.route} />
            </Suspense>
          </PageBoundary>
        </div>
      </PageActionsSlotProvider>
    </section>
  );
}

/* ── Shell ───────────────────────────────────────────────────────────────── */

export default function AppShell({ palette, setPalette }: { palette: { open: boolean; q: string }; setPalette(p: { open: boolean; q: string }): void }) {
  const app = useApp();
  const { rtl } = useI18n();
  const [rail, setRail] = useState(() => {
    try { return localStorage.getItem(LS_RAIL) === '1'; } catch { return false; }
  });
  const toggleRail = () => setRail((v) => {
    try { localStorage.setItem(LS_RAIL, v ? '0' : '1'); } catch { /* optional */ }
    return !v;
  });
  const found = pageById(app.route.page);
  const def = found && allowed(found, app) ? found : undefined;

  /* Alt+↑ / Alt+↓ move between pages from anywhere (not while typing) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || isTypingTarget(e.target)) return;
      const list = visiblePages(app).filter((p) => !p.hidden);
      const i = list.findIndex((p) => p.id === app.route.page);
      const next = list[((i < 0 ? 0 : i) + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length];
      if (next) { e.preventDefault(); app.navigate(next.id); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app]);

  return (
    <div className={cls('k-app sh-root', rail && 'is-rail')} dir={rtl ? 'rtl' : 'ltr'}>
      <Sidebar rail={rail} />
      <main className="sh-main">
        <TopBar rail={rail} onRail={toggleRail} def={def} />
        <HelpBanner />
        <PageFrame def={def} />
      </main>
      {palette.open && <CommandPalette initial={palette.q} onClose={() => setPalette({ open: false, q: '' })} />}
    </div>
  );
}
