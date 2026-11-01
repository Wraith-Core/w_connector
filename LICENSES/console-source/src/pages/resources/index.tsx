/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/resources  (P4)
 * Start, stop and restart scripts (area resources, god by default). The protected list comes from the
 * server (B4), Wraith scripts need their name typed before a stop or a restart.
 * ════════════════════════════════════════════════════════════════════════════ */

import { definePage } from '../../app/pages';
import ResourcesPage from './ResourcesPage';
import './resources.css';

export const page = definePage({
  id: 'resources',
  section: 'system',
  order: 10,
  glyph: 'stack',
  area: 'resources',
  refresh: ['server'],
  component: ResourcesPage,
  badge: (app) => {
    const list = app.serverInfo?.resources;
    if (!list) return null;
    const stopped = list.filter((r) => r.state !== 'started').length;
    return stopped || null;
  },
});
