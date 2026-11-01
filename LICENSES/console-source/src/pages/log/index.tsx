/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/log  (P4)
 * The admin log: who did what, to whom and when, with filters, live lines and links to the player,
 * the character and the script settings. Area logs (admin by default). Read only.
 * ════════════════════════════════════════════════════════════════════════════ */

import { definePage } from '../../app/pages';
import LogPageView from './LogPage';
import './log.css';

export const page = definePage({
  id: 'log',
  section: 'system',
  order: 30,
  glyph: 'list',
  area: 'logs',
  layout: 'fill',
  component: LogPageView,
});
