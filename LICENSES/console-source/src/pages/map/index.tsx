/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/map  ("الخريطة" / Map)
 * While the page is open Lua pushes the map players every second (post('map', { action: 'players' })
 * starts the loop and sends mapCfg; 'stopPlayers' ends it when the page closes).
 * ════════════════════════════════════════════════════════════════════════════ */

import { definePage } from '../../app/pages';
import { post } from '../../nui';
import MapPage from './MapPage';

export const page = definePage({
  id: 'map',
  section: 'world',
  order: 10,
  glyph: 'map',
  area: 'map',
  layout: 'fill',
  component: MapPage,
  onEnter: () => {
    void post('map', { action: 'players' });
    return () => { void post('map', { action: 'stopPlayers' }); };
  },
});
