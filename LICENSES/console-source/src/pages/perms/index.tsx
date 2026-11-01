/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/perms  (P4)
 * The read-only permissions matrix: every area, what it allows in plain words, which levels have it,
 * and whether the viewer has it; plus the chat commands. Area perms (mod): every staff member sees it.
 * ════════════════════════════════════════════════════════════════════════════ */

import { definePage } from '../../app/pages';
import PermsPage from './PermsPage';
import './perms.css';

export const page = definePage({
  id: 'perms',
  section: 'system',
  order: 20,
  glyph: 'shield',
  area: 'perms',
  component: PermsPage,
});
