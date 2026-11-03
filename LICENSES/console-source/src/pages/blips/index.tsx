/* ════════════════════════════════════════════════════════════════════════════
 * w_connector · pages/blips  ("العلامات" / Blips) · 2.4.0
 * Blips on the game's own map for every player (ops/native_blips.lua). Area blips: the website's
 * world.control, and only while w_map is stopped (then its editor, /mapedit, owns the blips) — the
 * server takes the area away the moment w_map starts, so the nav entry and the palette entry go too.
 * ════════════════════════════════════════════════════════════════════════════ */

import { definePage } from '../../app/pages';
import BlipsPage from './BlipsPage';
import './blips.css';

export const page = definePage({
  id: 'blips',
  section: 'world',
  order: 15,
  glyph: 'map',
  area: 'blips',
  component: BlipsPage,
});
