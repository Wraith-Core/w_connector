/* w_admin · the World page: weather, time and announcements for the whole server (area 'server').
   The same controls are exported from ./WorldControls for the dashboard card and the quick menu. */

import { definePage } from '../../app/pages';
import WorldPage from './WorldPage';

export const page = definePage({
  id: 'world',
  section: 'world',
  order: 20,
  glyph: 'sun',
  area: 'server',
  component: WorldPage,
  refresh: ['server'],
});
