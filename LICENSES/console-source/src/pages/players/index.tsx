/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/players  (اللاعبون · Players)
 * Everyone in the server now: the list at the reading start, the selected player's file at the end,
 * each scrolling on its own. The selection is the shell's selectedId (the palette and the map share
 * it); it is also pinned to the citizen id, so a session number that changes hands closes the file.
 *
 * Route params: sel=<session number> (the shell), cid=<citizen id> (selects him when online),
 * view=<profile|travel|health|money|items|moderation> (the file's section).
 * ════════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react';
import { definePage } from '../../app/pages';
import type { PageProps } from '../../app/pages';
import { useApp } from '../../ctx';
import { SplitView } from '../../kit';
import type { AdminPlayer } from '../../types';
import PlayerDrawer from './PlayerDrawer';
import PlayerList from './PlayerList';
import { isDrawerTab } from './shared';
import type { DrawerTab } from './shared';
import './players.css';

const LS_TAB = 'w_admin:players.tab';

function loadTab(): DrawerTab {
  try {
    const v = localStorage.getItem(LS_TAB);
    return isDrawerTab(v) ? v : 'profile';
  } catch {
    return 'profile';
  }
}

function PlayersPage({ route }: PageProps) {
  const app = useApp();
  const [tab, setTabState] = useState<DrawerTab>(() => (isDrawerTab(route.params.view) ? route.params.view : loadTab()));
  const setTab = (v: DrawerTab) => {
    setTabState(v);
    try { localStorage.setItem(LS_TAB, v); } catch { /* optional */ }
  };

  /* ?view= and ?cid= from navigate() (the palette, the dashboard, the characters page) */
  useEffect(() => { if (isDrawerTab(route.params.view)) setTabState(route.params.view); }, [route.params.view]);
  const wantCid = route.params.cid;
  useEffect(() => {
    if (!wantCid) return;
    const p = app.players.find((x) => (x.citizenid || '').toUpperCase() === wantCid.toUpperCase());
    if (p && p.id !== app.selectedId) app.select(p.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantCid, app.playersSeen]);

  const selected = app.selectedId !== null ? app.players.find((p) => p.id === app.selectedId) ?? null : null;

  /* the file follows the character, not the session number */
  const pinned = useRef<{ id: number; cid: string } | null>(null);
  const swapped = !!selected && !!pinned.current && pinned.current.id === selected.id && pinned.current.cid !== (selected.citizenid || '');
  useEffect(() => {
    if (!selected) { pinned.current = null; return; }
    if (swapped) { pinned.current = null; app.select(null); return; }
    pinned.current = { id: selected.id, cid: selected.citizenid || '' };
  }, [selected, swapped, app]);

  const onSelect = (p: AdminPlayer) => app.select(p.id);
  const shown = selected && !swapped ? selected : null;

  return (
    <SplitView
      className="pl-page"
      list={<PlayerList selectedId={shown ? shown.id : null} onSelect={onSelect} />}
      drawer={shown && (
        <PlayerDrawer
          key={`${shown.id}:${shown.citizenid}`}
          player={shown}
          tab={tab}
          onTab={setTab}
          onClose={() => app.select(null)}
        />
      )}
    />
  );
}

export const page = definePage({
  id: 'players',
  section: 'people',
  order: 10,
  glyph: 'people',
  area: 'players',
  layout: 'fill',
  refresh: ['players'],
  component: PlayersPage,
  badge: (app) => app.players.length || null,
});
