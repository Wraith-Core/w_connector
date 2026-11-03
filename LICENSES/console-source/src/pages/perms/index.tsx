/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/perms  (P4; 2.3.1: the website's model)
 * The read-only permissions page: your website role and custom roles, every website permission with the
 * website's names, and your in-game script permissions per script. Area perms: every staff member sees it.
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
  refresh: ['access'],
  component: PermsPage,
});
