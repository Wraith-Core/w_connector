/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · quick  (the PgUp quick menu)
 * A narrow ink panel at the side of the screen, so the admin keeps the game in view. The same tools
 * as the "My tools" page (pages/tools/tools.ts), grouped in sections; the players section targets a
 * citizen id; the world section is the shared WorldControls (pages/world, variant 'compact').
 * No emblem: the wordmark "WRAITH" and the title are the only brand.
 *   ↑ ↓ move between the rows · Enter runs · Esc / PgUp close · F10 the full panel (App.tsx)
 * 2.3.0 the board look (w_housing / w_pets): the masthead over a torn card and an actions strip; 1-7 open the
 * sections, a "recent" row keeps the last tools (and the pinned ones first) one click or Alt+number away.
 * Recent and pinned live in this viewer's localStorage only (w_admin:quick.recent / w_admin:quick.pins).
 * ════════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { QuickProps } from '../app/quick';
import { useApp } from '../ctx';
import type { HelpKey } from '../help/types';
import { useI18n } from '../i18n';
import { Button, Glyph, HelpTip, IconButton, Tabs, TextInput, cls, isTypingTarget } from '../kit';
import { ClearAreaForm, CoordsJump, NoclipSpeed, SpawnForm } from '../pages/tools/forms';
import {
  TOOLS, activeTools, bundledT, canTool, isOn, toolById, toolHint, toolLabel, useToolRunner,
} from '../pages/tools/tools';
import type { ToolDef, ToolRunner, ToolSection } from '../pages/tools/tools';
import { WorldControls } from '../pages/world/WorldControls';
import type { AppCtx } from '../ctx';
import QuickPlayers from './QuickPlayers';
import './quick.css';

type QuickGroup = 'self' | 'travel' | 'players' | 'spawn' | 'vehicle' | 'dev' | 'world';

const GROUPS: { id: QuickGroup; help: HelpKey; visible(app: AppCtx): boolean }[] = [
  { id: 'self', help: 'help.quick.group.self', visible: (a) => TOOLS.some((tool) => (tool.section === 'me' || tool.section === 'health') && canTool(a, tool)) },
  { id: 'travel', help: 'help.quick.group.travel', visible: (a) => a.can('teleport') },
  { id: 'players', help: 'help.quick.group.players', visible: (a) => a.can('players') },
  { id: 'spawn', help: 'help.quick.group.spawn', visible: (a) => a.can('spawn') },
  { id: 'vehicle', help: 'help.quick.group.vehicle', visible: (a) => a.can('vehicle') || a.can('entities') },
  { id: 'dev', help: 'help.quick.group.dev', visible: (a) => a.can('dev') || a.can('entities') },
  { id: 'world', help: 'help.quick.group.world', visible: (a) => a.can('server') },
];

const groupOf = (s: ToolSection): QuickGroup => (s === 'me' || s === 'health' ? 'self' : s);

const norm = (s: string) => s.toLocaleLowerCase().normalize('NFKD').replace(/[ً-ٰٟ]/g, '');

/* ── 2.3.0 recent and pinned tools (this viewer only) ─────────────────────── */
const LS_RECENT = 'w_admin:quick.recent';
const LS_PINS = 'w_admin:quick.pins';
const ROW_MAX = 6;
const readIds = (key: string): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!toolById(x)).slice(0, ROW_MAX) : [];
  } catch { return []; }
};
const writeIds = (key: string, ids: string[]) => { try { localStorage.setItem(key, JSON.stringify(ids)); } catch { /* optional */ } };

function useToolMemory() {
  const [recent, setRecent] = useState<string[]>(() => readIds(LS_RECENT));
  const [pins, setPins] = useState<string[]>(() => readIds(LS_PINS));
  const remember = useCallback((id: string) => setRecent((l) => {
    const next = [id, ...l.filter((x) => x !== id)].slice(0, ROW_MAX);
    writeIds(LS_RECENT, next);
    return next;
  }), []);
  const togglePin = useCallback((id: string) => setPins((l) => {
    const next = l.includes(id) ? l.filter((x) => x !== id) : [...l, id].slice(-ROW_MAX);
    writeIds(LS_PINS, next);
    return next;
  }), []);
  return { recent, pins, remember, togglePin };
}

/** One tool as a full-width row: name + one line, and "مفعّل / متوقف" (toggles) or an arrow (actions) */
function QuickTool({ tool, runner, onOpen, onRun, pinned, onPin }: {
  tool: ToolDef; runner: ToolRunner; onOpen?: () => void; onRun?(tool: ToolDef): void; pinned?: boolean; onPin?(id: string): void;
}) {
  const app = useApp();
  const { t } = useI18n();
  const on = isOn(tool, app.self);
  const toggle = tool.kind === 'toggle';
  const unavailable = tool.unavailable?.(app.self) ?? false;
  const label = toolLabel(t, tool.id);
  const hint = unavailable ? t('label.tools.unavailableBack') : toolHint(t, tool.id);
  const working = runner.busy === tool.id;
  return (
    <div className={cls('q-toolrow', pinned && 'is-pinned')}>
    <Button
      help={tool.help}
      helpLabel={label}
      area={tool.area}
      kind="ghost"
      block
      className={cls('q-tool', on && 'is-on', tool.confirm === 'danger' && 'is-danger')}
      aria-pressed={toggle ? on : undefined}
      disabled={unavailable || (!!runner.busy && !working)}
      onClick={() => (onOpen ? onOpen() : onRun ? onRun(tool) : runner.run(tool))}
    >
      <span className="q-tool-text">
        <span className="q-tool-label">{label}</span>
        {hint && <span className="q-tool-hint">{hint}</span>}
      </span>
      <span className="q-tool-state">
        {working ? '…'
          : toggle ? <span className={cls('q-state', on && 'is-on')}>{t(on ? 'label.common.on' : 'label.common.off')}</span>
            : <Glyph name="chevron" className="q-chev" />}
      </span>
    </Button>
    {onPin && tool.kind !== 'form' && (
      <IconButton
        icon="pin"
        size="sm"
        aria-label={t(pinned ? 'label.quick.unpin' : 'label.quick.pin')}
        help="help.quick.pin"
        helpQuiet
        pressed={!!pinned}
        className="q-pin"
        onClick={() => onPin(tool.id)}
      />
    )}
    </div>
  );
}

export default function QuickMenu({ onClose, onFull }: QuickProps) {
  const app = useApp();
  const { t, rtl, lang } = useI18n();
  const runner = useToolRunner();
  const memory = useToolMemory();
  const [group, setGroup] = useState<QuickGroup>('self');
  const [search, setSearch] = useState('');
  const root = useRef<HTMLDivElement>(null);

  const groups = GROUPS.filter((g) => g.visible(app));
  const groupIds = groups.map((g) => g.id).join(' ');
  /* a permission change (the 10 s re-check) can take the open section away */
  useEffect(() => {
    if (!groupIds.split(' ').includes(group) && groups.length) setGroup(groups[0].id);
  }, [groupIds, group]);

  const allowed = (x: ToolDef) => canTool(app, x);
  const inGroup = (g: QuickGroup) => TOOLS.filter((x) => groupOf(x.section) === g && allowed(x) && x.kind !== 'form');
  const has = (id: string) => TOOLS.some((x) => x.id === id && allowed(x));

  /* the search looks in both languages, the id and the extra words */
  const other = useMemo(() => bundledT(lang === 'ar' ? 'en' : 'ar'), [lang]);
  const needle = norm(search.trim());
  const matches = useMemo(() => (!needle || group === 'players' ? [] : TOOLS.filter((x) => allowed(x)
    && norm(`${toolLabel(t, x.id)} ${toolHint(t, x.id)} ${toolLabel(other, x.id)} ${x.id} ${x.keywords ?? ''}`).includes(needle))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [needle, group, app.perms, t, other]);

  const active = activeTools(app.self);
  const spectating = app.self?.spectating ?? 0;

  /* the recent row: pinned first, then the last used, only the tools this admin may run */
  const runTool = useCallback((x: ToolDef) => { memory.remember(x.id); runner.run(x); }, [memory, runner]);
  const rowIds = [...memory.pins, ...memory.recent.filter((id) => !memory.pins.includes(id))].slice(0, ROW_MAX);
  const rowTools = rowIds.map((id) => toolById(id)).filter((x): x is ToolDef => !!x && x.kind !== 'form' && allowed(x));

  /* 1-7 open the sections, Alt+1-6 run a tool of the recent row (never while typing) */
  const keysRef = useRef({ groups, rowTools, runTool });
  keysRef.current = { groups, rowTools, runTool };
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (!m || isTypingTarget(e.target) || document.querySelector('.k-dialog-veil, .k-pop')) return;
      const n = Number(m[1]) - 1;
      const k = keysRef.current;
      if (e.altKey) {
        const x = k.rowTools[n];
        if (!x) return;
        e.preventDefault();
        k.runTool(x);
        return;
      }
      const g = k.groups[n];
      if (!g) return;
      e.preventDefault();
      setGroup(g.id);
      setSearch('');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ↑ ↓ walk the rows (not inside a text box or a list popup) */
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const el = e.target as HTMLElement;
    if (el.closest('input, textarea, [role="radiogroup"], [role="tablist"], .k-pop, [aria-haspopup="listbox"]')) return;
    const rows = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('.q-body .k-btn:not(:disabled)') ?? []);
    if (!rows.length) return;
    const i = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = i < 0 ? 0 : (i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
    e.preventDefault();
    rows[next].focus();
    rows[next].scrollIntoView({ block: 'nearest' });
  };

  const list = (tools: ToolDef[]) => tools.map((x) => (
    <QuickTool key={x.id} tool={x} runner={runner} onRun={runTool} pinned={memory.pins.includes(x.id)} onPin={memory.togglePin} />
  ));

  let body;
  if (needle && group !== 'players') {
    body = (
      <div className="q-list">
        {matches.map((x) => (
          <QuickTool
            key={x.id}
            tool={x}
            runner={runner}
            onRun={runTool}
            pinned={memory.pins.includes(x.id)}
            onPin={memory.togglePin}
            onOpen={x.kind === 'form' ? () => { setGroup(groupOf(x.section)); setSearch(''); } : undefined}
          />
        ))}
        {matches.length === 0 && <p className="q-empty">{t('label.quick.noResults')}</p>}
      </div>
    );
  } else if (group === 'self') {
    body = (
      <div className="q-list">
        {list(inGroup('self'))}
        {has('noclipSpeed') && <div className="q-form"><NoclipSpeed runner={runner} stacked /></div>}
      </div>
    );
  } else if (group === 'travel') {
    body = (
      <div className="q-list">
        {list(inGroup('travel'))}
        {has('tpCoords') && <div className="q-form"><CoordsJump runner={runner} /></div>}
      </div>
    );
  } else if (group === 'players') {
    body = <QuickPlayers search={search} />;
  } else if (group === 'spawn') {
    body = <div className="q-form"><SpawnForm runner={runner} compact /></div>;
  } else if (group === 'vehicle') {
    body = <div className="q-list">{list(inGroup('vehicle'))}</div>;
  } else if (group === 'dev') {
    body = (
      <div className="q-list">
        {list(inGroup('dev'))}
        {has('clearArea') && <div className="q-form"><ClearAreaForm runner={runner} /></div>}
      </div>
    );
  } else {
    body = <div className="q-world"><WorldControls variant="compact" /></div>;
  }

  const rank = [app.admin?.rank, app.admin?.group].find((r) => r === 'mod' || r === 'admin' || r === 'god' || r === 'owner');
  return (
    <div className="k-app q-panel" dir={rtl ? 'rtl' : 'ltr'} role="dialog" aria-label={t('label.quick.title')} ref={root} onKeyDown={onKey}>
      <div className="q-scrim" aria-hidden="true" />
      <header className="q-head">
        <div className="q-brand">
          <span className="q-mark">{t('label.quick.brand')}</span>
          <h2 className="q-title">
            <span>{t('label.quick.title')}</span>
            <HelpTip help="help.quick.panel" label={t('label.quick.title')} size="md" />
          </h2>
          <span className="q-who">
            <b>{app.admin?.name ?? ''}</b>
            {rank && <span> · {t(`label.common.level.${rank}`)}</span>}
            {app.admin?.citizenid && <span> · {t('label.common.citizen.label')} <b className="k-num">{app.admin.citizenid}</b></span>}
          </span>
        </div>
        <IconButton icon="close" aria-label={t('label.common.close')} help="help.quick.close" onClick={onClose} className="q-close" />
      </header>

      <div className="q-wrap">
      <span className="q-tick" aria-hidden="true" />
      <div className="q-card">
      <div className="q-search">
        <TextInput
          icon="search"
          value={search}
          onChange={setSearch}
          clearable
          placeholder={t(group === 'players' ? 'label.quick.searchPlayers' : 'label.quick.search')}
          label={t(group === 'players' ? 'label.quick.searchPlayers' : 'label.quick.search')}
          help="help.quick.search"
        />
      </div>

      <div className="q-recent" role="group" aria-label={t('label.quick.recent')}>
        <span className="q-recent-head">
          <span>{t('label.quick.recent')}</span>
          <HelpTip help="help.quick.recent" label={t('label.quick.recent')} size="sm" />
        </span>
        <div className="q-recent-row">
          {rowTools.map((x, i) => {
            const on = isOn(x, app.self);
            return (
              <Button
                key={x.id}
                help={x.help}
                helpQuiet
                helpLabel={toolLabel(t, x.id)}
                area={x.area}
                size="sm"
                kind={x.kind === 'toggle' && on ? 'primary' : 'secondary'}
                kbd={`Alt ${i + 1}`}
                className={cls('q-chip', memory.pins.includes(x.id) && 'is-pinned')}
                aria-pressed={x.kind === 'toggle' ? on : undefined}
                busy={runner.busy === x.id}
                disabled={!!runner.busy && runner.busy !== x.id}
                onClick={() => runTool(x)}
              >
                {toolLabel(t, x.id)}
              </Button>
            );
          })}
          {rowTools.length === 0 && <span className="q-recent-empty">{t('label.quick.recentEmpty')}</span>}
        </div>
      </div>

      <Tabs
        items={groups.map((g, i) => ({ id: g.id, label: t(`label.quick.group.${g.id}`), help: g.help, badge: i < 9 ? String(i + 1) : undefined }))}
        value={group}
        onChange={(v) => { setGroup(v); setSearch(''); }}
        label={t('label.quick.groups')}
        className="q-tabs"
      />

      {spectating > 0 && (
        <div className="q-watch" role="status">
          <span>{t('label.tools.watching', `#${spectating}`)}</span>
          <Button help="help.tools.stopSpectate" size="sm" area="players" busy={runner.busy === 'stopSpectate'} onClick={() => { void runner.self('stopSpectate', 'stopSpectate'); }}>
            {t('label.tools.do.stopSpectate')}
          </Button>
        </div>
      )}

      <div className="q-body">{body}</div>
      </div>
      </div>

      <footer className="q-foot">
        <div className="q-status">
          <span className={cls('q-dot', active.length > 0 && 'is-on')} aria-hidden="true" />
          <span className="q-status-text" title={active.map((x) => toolLabel(t, x.id)).join(rtl ? '، ' : ', ')}>
            {active.length === 0 ? t('label.quick.activeNone') : active.length === 1 ? t('label.quick.activeOne') : t('label.quick.active', active.length)}
          </span>
          <HelpTip help="help.quick.active" label={t('label.quick.activeNone')} size="sm" />
        </div>
        <Button help="help.quick.full" kind="primary" block kbd="PgUp" onClick={onFull}>{t('label.quick.full')}</Button>
        <div className="q-keys">
          <span><kbd>1</kbd>–<kbd>{Math.min(9, groups.length)}</kbd> {t('label.quick.keys.groups')}</span>
          <span><kbd>↑</kbd><kbd>↓</kbd> {t('label.quick.keys.move')}</span>
          <span><kbd>Enter</kbd> {t('label.quick.keys.pick')}</span>
          <span><kbd>Esc</kbd> {t('label.quick.keys.close')}</span>
        </div>
      </footer>
    </div>
  );
}
