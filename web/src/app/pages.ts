/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · app/pages.ts
 * The page contract. A page is a folder:  src/pages/<id>/index.tsx  exporting
 *
 *   export const page = definePage({
 *     id: 'players', section: 'people', order: 10, glyph: 'people', area: 'players',
 *     layout: 'fill', refresh: ['players'], component: PlayersPage,
 *   });
 *
 * The registry (app/registry.ts) finds it with import.meta.glob; nothing else needs editing.
 * Label, description and page help default to the shell's texts:
 *   label.shell.page.<id> · label.shell.desc.<id> · help.shell.page.<id>
 * ════════════════════════════════════════════════════════════════════════════ */

import type { ComponentType } from 'react';
import type { AppCtx, Route, RouteParams } from '../ctx';
import type { HelpKey, HelpProp } from '../help/types';
import type { TFn } from '../i18n';
import type { GlyphName } from '../kit/Glyph';
import type { Area, Lang, RefreshWhat } from '../types';

/** What the shell hands to subnav() / palette(): the viewer's translator and language */
export interface PageI18n { t: TFn; lang: Lang }

export type NavSection = 'overview' | 'people' | 'world' | 'scripts' | 'system';
export const NAV_SECTIONS: readonly NavSection[] = ['overview', 'people', 'world', 'scripts', 'system'];

/** The pages of the redesign (any other folder name works too) */
export type KnownPageId =
  | 'dashboard' | 'players' | 'characters' | 'bans' | 'map' | 'world' | 'tools'
  | 'hub' | 'resources' | 'perms' | 'log' | 'settings' | 'news' | 'ranks' | 'blips';
export type PageId = KnownPageId | (string & {});

export interface PageProps {
  /** the current route (params are strings: { sel: '7' }, { cid: '12' }, { resource: 'w_hud', group: 'food' }) */
  route: Route;
}

/** An entry under the page in the sidebar (the hub pins modules this way) */
export interface SubNavItem {
  id: string;
  label: string;
  params: RouteParams;
  help: HelpProp;
  badge?: number | string | null;
}

/** A command palette entry (tools, shortcuts) */
export interface PaletteItem {
  id: string;
  label: string;
  sub?: string;
  /** the result group heading (already translated) */
  group: string;
  /** extra words that match (other language, synonyms) */
  keywords?: string;
  area?: Area;
  run(app: AppCtx): void;
}

export interface PageDef {
  id: PageId;
  section: NavSection;
  /** position inside its section (10, 20, 30 …) */
  order: number;
  glyph: GlyphName;
  component: ComponentType<PageProps>;
  /** hidden unless the admin holds this area (any of a list) */
  area?: Area | Area[];
  /** i18n keys; default label.shell.page.<id> / label.shell.desc.<id> */
  labelKey?: string;
  descKey?: string;
  /** the page "؟"; default help.shell.page.<id> */
  help?: HelpKey;
  /** 'fill': the page manages its own scrolling (SplitView, map, settings) · 'scroll' (default): the body scrolls */
  layout?: 'fill' | 'scroll';
  /** false: the page draws its own <PageHeader> (default: the shell draws it; use <PageActions> for buttons) */
  header?: boolean;
  /** pushes to ask Lua for when the page opens */
  refresh?: RefreshWhat[];
  /** runs when the page opens; may return a cleanup (the map starts and stops its player loop) */
  onEnter?(app: AppCtx): void | (() => void);
  /** the number beside the nav item (online players, active bans) */
  badge?(app: AppCtx): number | string | null;
  subnav?(app: AppCtx, i18n: PageI18n): SubNavItem[];
  palette?(app: AppCtx, i18n: PageI18n): PaletteItem[];
  /** not listed in the sidebar (reachable by navigate() and the palette) */
  hidden?: boolean;
}

export function definePage(def: PageDef): PageDef {
  return def;
}
