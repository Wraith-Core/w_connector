/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · help/HelpProvider.tsx
 * The toggletip behind every "؟" (Inclusive Components pattern):
 *   hover / focus   → a preview after 350 ms, closed 150 ms after leaving
 *   click / Enter / Space → pinned; stays until Esc (captured: the console does not close), a click
 *                    outside, or another "؟". One note at a time.
 *   help mode       → "؟ وضع الشرح" in the top bar or F1: every "؟" stands out, a banner explains.
 *                    On by default the first time this viewer opens the console, then off.
 * One set of delegated listeners serves every "؟" on screen (the player list refreshes every 2 s),
 * and only this provider re-renders when a note opens.
 * The note is a role="status" live region; focus stays on the "؟".
 * ════════════════════════════════════════════════════════════════════════════ */

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject, ReactNode } from 'react';
import { useI18n } from '../i18n';
import type { LevelsMap } from '../types';
import HelpNote from './HelpNote';
import type { NoteModel } from './HelpNote';
import { placeNote } from './place';
import { resolveHelp } from './texts';
import type { TipSpec } from './types';

const OPEN_DELAY = 350;
const CLOSE_DELAY = 150;
export const HELP_NOTE_ID = 'k-help-note';
const LS_SEEN = 'w_admin:helpSeen';
const LS_MODE = 'w_admin:helpMode';

type SpecRef = MutableRefObject<TipSpec>;

export interface HelpApi {
  /** called by HelpTip: links its button to its (live) spec */
  register(el: HTMLElement, spec: SpecRef): () => void;
  helpMode: boolean;
  /** persist = remember as this viewer's preference (the console settings page) */
  setHelpMode(on: boolean, persist?: boolean): void;
  toggleHelpMode(): void;
  /** opens the note of a "؟" element programmatically (pinned) */
  openTip(el: HTMLElement): void;
  closeNote(): void;
}

const noop = () => () => {};
const HelpContext = createContext<HelpApi>({
  register: noop, helpMode: false, setHelpMode: () => {}, toggleHelpMode: () => {}, openTip: () => {}, closeNote: () => {},
});
export const useHelp = () => useContext(HelpContext);

/* Esc and F1 are caught by one window listener installed at import time, so it runs before any
   window listener a dialog or the shell adds later (capture phase, first registered, first run). */
let keyHandler: ((e: KeyboardEvent) => void) | null = null;
if (typeof window !== 'undefined') window.addEventListener('keydown', (e) => keyHandler?.(e), true);
let noteOpen = false;
/** True while a help note is on screen (other Esc handlers may check it) */
export const isHelpNoteOpen = () => noteOpen;

function readInitialMode(): boolean {
  try {
    const pref = localStorage.getItem(LS_MODE);
    if (pref === '1' || pref === '0') return pref === '1';
    const seen = localStorage.getItem(LS_SEEN);
    localStorage.setItem(LS_SEEN, '1');
    return !seen;
  } catch {
    return false;
  }
}

interface Open { el: HTMLElement; spec: TipSpec; pinned: boolean }

export function HelpProvider({ levels, children }: { levels: LevelsMap; children: ReactNode }) {
  const { lang, rtl } = useI18n();
  const registry = useRef(new WeakMap<Element, SpecRef>());
  const [open, setOpen] = useState<Open | null>(null);
  const openRef = useRef<Open | null>(null);
  openRef.current = open;
  const noteEl = useRef<HTMLDivElement>(null);
  const timers = useRef<{ open?: number; close?: number }>({});
  const [helpMode, setMode] = useState<boolean>(readInitialMode);

  const clearTimers = () => {
    window.clearTimeout(timers.current.open);
    window.clearTimeout(timers.current.close);
    timers.current = {};
  };

  const markEl = (el: HTMLElement | undefined, expanded: boolean, pinned: boolean) => {
    if (!el) return;
    el.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    el.classList.toggle('is-open', expanded);
    el.classList.toggle('is-pinned', expanded && pinned);
  };

  const show = useCallback((el: HTMLElement, pinned: boolean) => {
    const spec = registry.current.get(el);
    if (!spec) return;
    clearTimers();
    const prev = openRef.current;
    if (prev && prev.el !== el) markEl(prev.el, false, false);
    markEl(el, true, pinned);
    setOpen({ el, spec: { ...spec.current }, pinned });
  }, []);

  const hide = useCallback(() => {
    clearTimers();
    const prev = openRef.current;
    if (prev) markEl(prev.el, false, false);
    setOpen(null);
  }, []);

  noteOpen = !!open;

  /* ── delegated pointer / focus / click handling ───────────────────────── */
  useEffect(() => {
    const tipOf = (t: EventTarget | null): HTMLElement | null =>
      t instanceof Element ? (t.closest('[data-k-help]') as HTMLElement | null) : null;
    const inNote = (t: EventTarget | null) => !!(t instanceof Node && noteEl.current?.contains(t));

    const scheduleOpen = (el: HTMLElement) => {
      if (openRef.current?.pinned) return;
      window.clearTimeout(timers.current.close);
      window.clearTimeout(timers.current.open);
      timers.current.open = window.setTimeout(() => { if (el.isConnected && !openRef.current?.pinned) show(el, false); }, OPEN_DELAY);
    };
    const scheduleClose = () => {
      window.clearTimeout(timers.current.open);
      if (!openRef.current || openRef.current.pinned) return;
      window.clearTimeout(timers.current.close);
      timers.current.close = window.setTimeout(() => { if (openRef.current && !openRef.current.pinned) hide(); }, CLOSE_DELAY);
    };

    const onOver = (e: MouseEvent) => {
      const tip = tipOf(e.target);
      if (tip) { scheduleOpen(tip); return; }
      if (inNote(e.target)) window.clearTimeout(timers.current.close);
    };
    const onOut = (e: MouseEvent) => {
      const from = tipOf(e.target) ?? (inNote(e.target) ? noteEl.current : null);
      if (!from) return;
      const to = e.relatedTarget;
      if (to instanceof Node && (from.contains(to) || inNote(to) || (openRef.current && openRef.current.el.contains(to)))) return;
      if (!openRef.current) { window.clearTimeout(timers.current.open); return; }
      scheduleClose();
    };
    const onFocusIn = (e: FocusEvent) => { const tip = tipOf(e.target); if (tip) scheduleOpen(tip); };
    const onFocusOut = (e: FocusEvent) => { if (tipOf(e.target)) scheduleClose(); };
    const onClick = (e: MouseEvent) => {
      const tip = tipOf(e.target);
      if (tip) {
        /* a "؟" never triggers what it sits next to */
        e.preventDefault();
        e.stopPropagation();
        const cur = openRef.current;
        if (cur && cur.el === tip && cur.pinned) hide();
        else show(tip, true);
        return;
      }
      if (openRef.current && !inNote(e.target)) hide();
    };

    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout', onOut);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseout', onOut);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('click', onClick, true);
      clearTimers();
    };
  }, [show, hide]);

  /* ── keys: Esc closes the note (and nothing else), F1 toggles help mode ─ */
  const persistMode = (on: boolean, persist?: boolean) => {
    setMode(on);
    if (persist) { try { localStorage.setItem(LS_MODE, on ? '1' : '0'); } catch { /* optional */ } }
  };
  useEffect(() => {
    keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openRef.current) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        hide();
        return;
      }
      if (e.key === 'F1' && !e.repeat) {
        e.preventDefault();
        setMode((m) => !m);
      }
    };
    return () => { keyHandler = null; };
  }, [hide]);

  useEffect(() => {
    document.documentElement.classList.toggle('k-help-mode', helpMode);
  }, [helpMode]);

  /* ── placement: after every open, and on scroll / resize while open ───── */
  const placeNow = useCallback(() => {
    const cur = openRef.current;
    const note = noteEl.current;
    if (!cur || !note) return;
    if (!cur.el.isConnected) { hide(); return; }
    const a = cur.el.getBoundingClientRect();
    const p = placeNote(a, note.offsetWidth, note.offsetHeight, rtl, window.innerWidth, window.innerHeight);
    note.style.top = `${p.top}px`;
    note.style.left = `${p.left}px`;
    note.style.setProperty('--arrow-x', `${p.arrowX}px`);
    note.dataset.side = p.side;
  }, [rtl, hide]);

  useLayoutEffect(() => { if (open) placeNow(); }, [open, placeNow, lang]);
  useEffect(() => {
    if (!open) return;
    const onMove = () => placeNow();
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    /* the anchor may vanish (a row left, a tab changed): check a few times a second */
    const iv = window.setInterval(() => { if (openRef.current && !openRef.current.el.isConnected) hide(); }, 400);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
      window.clearInterval(iv);
    };
  }, [open, placeNow, hide]);

  const api = useMemo<HelpApi>(() => ({
    register(el, spec) {
      registry.current.set(el, spec);
      return () => {
        registry.current.delete(el);
        if (openRef.current?.el === el) hide();
      };
    },
    helpMode,
    setHelpMode: persistMode,
    toggleHelpMode: () => setMode((m) => !m),
    openTip: (el) => show(el, true),
    closeNote: hide,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [helpMode, show, hide]);

  const model: NoteModel | null = open ? { entry: resolveHelp(open.spec.help, lang), spec: open.spec, pinned: open.pinned } : null;

  return (
    <HelpContext.Provider value={api}>
      {children}
      <div
        ref={noteEl}
        id={HELP_NOTE_ID}
        role="status"
        aria-live="polite"
        className={model ? 'k-note k-layer is-open' : 'k-note k-layer'}
        dir={rtl ? 'rtl' : 'ltr'}
      >
        {model && <HelpNote model={model} levels={levels} />}
      </div>
    </HelpContext.Provider>
  );
}
