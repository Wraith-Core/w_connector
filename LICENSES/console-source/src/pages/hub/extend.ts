/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/hub/extend.ts
 * How another task plugs a richer editor for ONE settings group into a script's settings page,
 * without touching the hub's files (the food and drink editor, X1, lives in pages/hub/food/):
 *
 *   // pages/hub/food/index.tsx
 *   import type { GroupEditorDef } from '../extend';
 *   export const editors: GroupEditorDef[] = [{ resource: 'w_hud', group: 'food', component: FoodEditor }];
 *
 * Every folder under pages/hub/ with an index.tsx that exports `editors` is picked up at build time.
 * The editor gets the group's schema and values and the page's shared draft: it writes edits with
 * draft.set / draft.reset (keys '<table key>.<row>.<column>' for table cells, the field key for
 * forms) and the page's SaveBar, review dialog and apply do the rest. It never posts by itself.
 * A group without a plugged editor falls back to the hub's generic form or table.
 * ════════════════════════════════════════════════════════════════════════════ */

import type { ComponentType } from 'react';
import type { SettingsGroup, SettingsSchema, SettingsValues } from '../../types';
import type { DraftStore } from './draft';

export interface GroupEditorProps {
  resource: string;
  schema: SettingsSchema;
  group: SettingsGroup;
  /** the group's values as the server sent them (rows for table groups) */
  values: SettingsValues;
  /** the page's shared draft (already loaded with every key of this group) */
  draft: DraftStore;
  /** true when the admin's level cannot change this group: show, never edit */
  readOnly: boolean;
  /** asks the server for this group's values again (after a stale rejection) */
  reload(): void;
}

export interface GroupEditorDef {
  resource: string;
  group: string;
  component: ComponentType<GroupEditorProps>;
}

type EditorModule = { editors?: GroupEditorDef[] };
const FOUND = import.meta.glob<EditorModule>('./*/index.tsx', { eager: true });

const EDITORS: GroupEditorDef[] = Object.values(FOUND).flatMap((m) => (Array.isArray(m.editors) ? m.editors : []));

export function editorFor(resource: string, group: string): GroupEditorDef | undefined {
  return EDITORS.find((e) => e.resource === resource && e.group === group);
}
