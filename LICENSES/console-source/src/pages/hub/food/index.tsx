/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/hub/food  (X1: Food and drink)
 * The owner's example of "the admin controls every interface": what every food, drink and medicine
 * of w_hud does, edited live, every column explained. The data is w_hud's live settings (w_lib
 * w.settings, group 'food'); w_hud's own F7 panel stays as it is.
 *
 * Plugged into the Scripts hub by pages/hub/extend.ts: the hub's settings page for w_hud shows this
 * editor for the 'food' group (route: hub?resource=w_hud&group=food, pinned in the sidebar as
 * "Food and drink") and keeps its own draft, SaveBar, review and apply.
 * ════════════════════════════════════════════════════════════════════════════ */

import type { GroupEditorDef } from '../extend';
import FoodEditor from './FoodEditor';

export { FoodEditor };

export const editors: GroupEditorDef[] = [
  { resource: 'w_hud', group: 'food', component: FoodEditor },
];
