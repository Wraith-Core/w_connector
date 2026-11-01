/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · help/types.ts
 * What a "؟" can point at.
 *   HelpKey     a key of locales/help/*.json ('help.players.kick'); tsc rejects a misspelt one
 *   HelpInline  a text that arrives as data (module descriptors, settings schemas: { ar, en })
 *   false       no "؟": only for an IconButton that already carries an aria-label
 * ════════════════════════════════════════════════════════════════════════════ */

import type { Area, Level, LocalText } from '../types';
import type { HelpKey, LabelKey } from './keys.gen';

export type { HelpKey, LabelKey };

/** A plain string (already in the viewer's language) or both languages */
export type HelpText = string | LocalText;

export interface HelpInline {
  text: HelpText | undefined;
  title?: HelpText;
  example?: HelpText;
  undo?: HelpText;
  warn?: HelpText;
}

export type HelpProp = HelpKey | HelpInline | false;

/** One resolved help entry in the viewer's language */
export interface HelpEntry { text: string; title?: string; example?: string; undo?: string; warn?: string }

/** The facts block under the text, filled from data rather than prose */
export interface HelpFacts {
  /** the area this control needs; its level comes from the levels map ("Needs level: admin or higher") */
  area?: Area;
  /** an explicit level (module descriptors carry their own) */
  level?: Level;
  /** "Allowed: 0 to 25 points" */
  range?: { min?: number; max?: number; unit?: string };
  /** "Default: 1" */
  def?: string | number | boolean | null;
  /** true / false / a sentence ("Yes, from the Bans page"). false turns the note into the danger variant. */
  undo?: boolean | string;
  /** "Applies to: every player, right after saving" */
  appliesTo?: string;
  /** more label / value lines */
  extra?: { label: string; value: string }[];
}

/** Everything a HelpTip hands to the provider when its note opens */
export interface TipSpec {
  help: HelpKey | HelpInline;
  /** the control's visible label: the note title when the entry has none, and the aria-label */
  label?: string;
  facts?: HelpFacts;
  danger?: boolean;
}
