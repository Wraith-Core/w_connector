/* w_admin · the Dashboard: the server right now (replaces the legacy tab of the same id). */

import { definePage } from '../../app/pages';
import DashboardPage from './Dashboard';

export const page = definePage({
  id: 'dashboard',
  section: 'overview',
  order: 10,
  glyph: 'home',
  component: DashboardPage,
  refresh: ['server'],
  onEnter(app) {
    /* the blocked-characters count: serverInfo.blocksCount (L1) or the 'blocks' push */
    if (app.can('characters') && typeof app.serverInfo?.blocksCount !== 'number') app.refresh('blocks');
  },
});
