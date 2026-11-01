/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · app/legacy.tsx  (TEMPORARY)
 * Mounts the old tabs (src/tabs/*) inside the new shell until their page folders land. A real page
 * with the same id (src/pages/<id>/index.tsx) replaces the legacy one automatically; the Integrate
 * step deletes this file, src/tabs, src/ui, src/QuickMenu.tsx and the old CSS.
 *
 * The old CSS is written in rem at the old root size (about 6.4 px at 1080p). vite.config.ts rewrites
 * its rem to calc(n * var(--lrem)) and drops its html font-size, so it keeps its old proportions while
 * the new root is 16 px.
 * ════════════════════════════════════════════════════════════════════════════ */

import type { ComponentType } from 'react';
import '../admin.css';
import '../quick.css';
import '../store-adapter.css';
import { useApp } from '../ctx';
import { useI18n } from '../i18n';
import BansTab from '../tabs/BansTab';
import CharactersTab from '../tabs/CharactersTab';
import Dashboard from '../tabs/Dashboard';
import HudTab from '../tabs/HudTab';
import MapTab from '../tabs/MapTab';
import Players from '../tabs/Players';
import ResourcesTab from '../tabs/ResourcesTab';
import SelfTab from '../tabs/SelfTab';
import { post } from '../nui';
import type { TabId } from '../types';
import type { PageDef, PageProps } from './pages';

const TAB_TO_PAGE: Record<TabId, string> = {
  dashboard: 'dashboard', players: 'players', characters: 'characters', map: 'map',
  hud: 'hud', self: 'tools', bans: 'bans', resources: 'resources',
};

function frame(tab: TabId, Body: ComponentType) {
  function LegacyPage(_: PageProps) {
    const { rtl } = useI18n();
    return (
      <div className={rtl ? 'k-legacy wst-root is-rtl' : 'k-legacy wst-root'}>
        <div className={`wa-body wa-body--${tab}`}>
          <Body />
        </div>
      </div>
    );
  }
  LegacyPage.displayName = `Legacy(${tab})`;
  return LegacyPage;
}

function LegacyDashboardBody() {
  const app = useApp();
  return <Dashboard onTab={(id) => app.navigate(TAB_TO_PAGE[id] ?? 'dashboard')} />;
}

export const LEGACY_PAGES: PageDef[] = [
  { id: 'dashboard', section: 'overview', order: 10, glyph: 'home', component: frame('dashboard', LegacyDashboardBody), refresh: ['server'], legacy: true },
  { id: 'players', section: 'people', order: 10, glyph: 'people', area: 'players', layout: 'fill', component: frame('players', Players), refresh: ['players'], legacy: true,
    badge: (app) => app.players.length || null },
  { id: 'characters', section: 'people', order: 20, glyph: 'card', area: 'characters', layout: 'fill', component: frame('characters', CharactersTab), legacy: true },
  { id: 'bans', section: 'people', order: 30, glyph: 'ban', area: 'bans', component: frame('bans', BansTab), refresh: ['bans'], legacy: true },
  { id: 'map', section: 'world', order: 10, glyph: 'map', area: 'map', layout: 'fill', component: frame('map', MapTab), legacy: true,
    onEnter: () => { void post('map', { action: 'players' }); return () => { void post('map', { action: 'stopPlayers' }); }; } },
  { id: 'tools', section: 'world', order: 30, glyph: 'tool', component: frame('self', SelfTab), legacy: true },
  { id: 'hud', section: 'scripts', order: 20, glyph: 'sliders', area: 'hud', component: frame('hud', HudTab), refresh: ['hud'], legacy: true, replacedBy: ['hub'] },
  { id: 'resources', section: 'system', order: 10, glyph: 'stack', area: 'resources', component: frame('resources', ResourcesTab), refresh: ['server'], legacy: true },
];

export const legacyTabToPage = (tab: string): string | null => (TAB_TO_PAGE as Record<string, string>)[tab] ?? null;
