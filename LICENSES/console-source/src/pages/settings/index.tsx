/* w_admin · Panel settings: this viewer's language, row size, table columns, help mode and motion. */

import { definePage } from '../../app/pages';
import SettingsPage from './SettingsPage';

export const page = definePage({
  id: 'settings',
  section: 'system',
  order: 90,
  glyph: 'sliders',
  component: SettingsPage,
});
