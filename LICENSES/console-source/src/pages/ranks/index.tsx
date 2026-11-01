/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/ranks
 * The w_core ranks: two tabs over one state (post('ranks'), every answer is the whole state).
 *   Ranks   the list (colour, label, name, members) and the editor (fields + the permission catalogue)
 *   Staff   who holds which rank: give one (online player or identifier), take one away
 * Route params: player=<server id> opens Staff with that player picked (the player file links here);
 * view=staff|ranks picks a tab.
 * ════════════════════════════════════════════════════════════════════════════ */

import { definePage } from '../../app/pages';
import RanksPage from './RanksPage';
import './ranks.css';

export const page = definePage({
  id: 'ranks',
  section: 'system',
  order: 15,
  glyph: 'shield',
  area: 'ranks',
  layout: 'fill',
  component: RanksPage,
});
