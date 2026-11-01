/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · app/CommandPalette.tsx  (Ctrl+K)
 * Finds, in this order: online players (name, citizen id, '#session'), a citizen id that is not online
 * (opens it in Characters, with the name when the server knows it), pages, and the tools the pages
 * list (PageDef.palette). Only what the admin may open is offered.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useApp } from '../ctx';
import { useI18n } from '../i18n';
import { cls, parseCitizen } from '../kit/format';
import Glyph from '../kit/Glyph';
import { useCitizenPreview } from '../kit/special';
import type { AdminPlayer } from '../types';
import type { PaletteItem } from './pages';
import { labelKeyOf, visiblePages } from './registry';

interface Hit { key: string; group: string; label: string; sub?: string; right?: string; run(): void }

const norm = (s: string) => s.toLocaleLowerCase().normalize('NFKD').replace(/[ً-ٰٟ]/g, '');
const fullName = (p: AdminPlayer) => `${p.firstname ?? ''} ${p.lastname ?? ''}`.trim();

export default function CommandPalette({ initial, onClose }: { initial: string; onClose(): void }) {
  const app = useApp();
  const { t, lang, rtl } = useI18n();
  const [q, setQ] = useState(initial);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const parsed = useMemo(() => parseCitizen(q), [q]);
  const citizenOnly = parsed && parsed.kind === 'citizen' && !app.players.some((p) => (p.citizenid || '').toUpperCase() === parsed.id);
  const preview = useCitizenPreview(citizenOnly && app.can('characters') ? q : '', true);

  const hits = useMemo<Hit[]>(() => {
    const out: Hit[] = [];
    const s = norm(q.trim());
    const gPlayers = t('label.shell.palette.players');
    const openPlayer = (p: AdminPlayer) => () => { app.select(p.id); app.navigate('players', { sel: String(p.id) }); onClose(); };
    if (app.can('players')) {
      let list: AdminPlayer[] = [];
      if (parsed?.kind === 'server') list = app.players.filter((p) => p.id === parsed.id);
      else if (parsed?.kind === 'citizen') list = app.players.filter((p) => (p.citizenid || '').toUpperCase() === parsed.id);
      if (s && list.length === 0) list = app.players.filter((p) => norm(`${p.name} ${fullName(p)} ${p.citizenid}`).includes(s));
      if (!s) list = app.players.slice(0, 5);
      for (const p of list.slice(0, 8)) {
        out.push({
          key: `p${p.id}`, group: gPlayers, label: fullName(p) || p.name,
          sub: `${p.name} · ${t('label.common.citizen.label')} ${p.citizenid}`, right: `#${p.id}`, run: openPlayer(p),
        });
      }
    }
    if (citizenOnly && parsed?.kind === 'citizen' && app.can('characters')) {
      const found = preview.kind === 'found' ? preview.preview : null;
      out.push({
        key: `c${parsed.id}`, group: t('label.shell.palette.character'),
        label: found ? (found.name || parsed.id) : `${t('label.common.citizen.label')} ${parsed.id}`,
        sub: preview.kind === 'checking' ? t('label.shell.palette.checking')
          : preview.kind === 'notFound' ? t('label.common.citizen.notFound') : t('label.shell.palette.offline'),
        right: parsed.id,
        run: () => { app.navigate('characters', { cid: parsed.id }); onClose(); },
      });
    }
    const pages = visiblePages(app).filter((p) => !p.hidden);
    const gPages = t('label.shell.palette.pages');
    for (const p of pages) {
      const label = t(labelKeyOf(p));
      if (!s || norm(`${label} ${p.id} ${t(`label.shell.section.${p.section}`)}`).includes(s)) {
        out.push({ key: `g${p.id}`, group: gPages, label, sub: t(`label.shell.section.${p.section}`), run: () => { app.navigate(p.id); onClose(); } });
      }
    }
    const tools: PaletteItem[] = pages.flatMap((p) => p.palette?.(app, { t, lang }) ?? []);
    for (const it of tools) {
      if (it.area && !app.can(it.area)) continue;
      if (s && !norm(`${it.label} ${it.sub ?? ''} ${it.keywords ?? ''}`).includes(s)) continue;
      out.push({ key: `t${it.id}`, group: it.group, label: it.label, sub: it.sub, run: () => { it.run(app); onClose(); } });
    }
    return out.slice(0, 40);
  }, [q, parsed, citizenOnly, preview, app, t, lang, onClose]);

  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); return; }
    if (e.key === 'Enter') { e.preventDefault(); hits[active]?.run(); }
  };

  let lastGroup = '';
  return (
    <div className="sh-pal-veil k-layer" dir={rtl ? 'rtl' : 'ltr'} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sh-pal" role="dialog" aria-modal="true" aria-label={t('label.shell.palette.open')}>
        <div className="sh-pal-input">
          <Glyph name="search" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder={t('label.shell.palette.placeholder')}
            spellCheck={false}
            autoComplete="off"
            aria-controls="sh-pal-list"
            aria-activedescendant={hits[active] ? `sh-pal-${hits[active].key}` : undefined}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="sh-pal-list" id="sh-pal-list" role="listbox" ref={listRef}>
          {hits.length === 0 && <p className="sh-pal-empty">{t('label.shell.palette.empty')}</p>}
          {hits.map((h, i) => {
            const head = h.group !== lastGroup ? h.group : null;
            lastGroup = h.group;
            return (
              <div key={h.key}>
                {head && <div className="sh-pal-group">{head}</div>}
                <div
                  id={`sh-pal-${h.key}`}
                  data-i={i}
                  role="option"
                  aria-selected={i === active}
                  className={cls('sh-pal-item', i === active && 'is-active')}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => { e.preventDefault(); h.run(); }}
                >
                  <span className="sh-pal-main">
                    <span className="sh-pal-label">{h.label}</span>
                    {h.sub && <span className="sh-pal-sub">{h.sub}</span>}
                  </span>
                  {h.right && <span className="sh-pal-right k-num">{h.right}</span>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="sh-pal-hint">{t('label.shell.palette.hint')}</div>
      </div>
    </div>
  );
}
