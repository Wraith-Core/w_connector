/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · app/registry.ts
 * Every page: the folders under src/pages/<id>/index.tsx (export const page = definePage({...})),
 * then the dev-only kit sample.
 * ════════════════════════════════════════════════════════════════════════════ */

import { lazy } from 'react';
import type { AppCtx } from '../ctx';
import type { HelpKey } from '../help/types';
import { NAV_SECTIONS } from './pages';
import type { NavSection, PageDef } from './pages';

type PageModule = { page?: PageDef; default?: PageDef };
const FOUND = import.meta.glob<PageModule>('../pages/*/index.tsx', { eager: true });

function fromFolders(): PageDef[] {
  const out: PageDef[] = [];
  for (const [path, mod] of Object.entries(FOUND)) {
    const def = mod.page ?? (mod.default && typeof mod.default === 'object' ? mod.default : undefined);
    if (!def || !def.id || !def.component) {
      // eslint-disable-next-line no-console
      console.warn(`[w_admin] ${path} does not export a page (export const page = definePage({...}))`);
      continue;
    }
    out.push(def);
  }
  return out;
}

/** The dev-only component sample (?page=kit in the browser mock); never in the resource build */
const DEV_PAGES: PageDef[] = import.meta.env.MODE === 'mock' || import.meta.env.DEV
  ? [{ id: 'kit', section: 'system', order: 99, glyph: 'blocks', component: lazy(() => import('../dev/KitGallery')), layout: 'scroll' }]
  : [];

const REAL = fromFolders();

export const PAGES: PageDef[] = [
  ...REAL,
  ...DEV_PAGES,
].sort((a, b) => NAV_SECTIONS.indexOf(a.section) - NAV_SECTIONS.indexOf(b.section) || a.order - b.order);

export const pageById = (id: string): PageDef | undefined => PAGES.find((p) => p.id === id);

export const labelKeyOf = (p: PageDef) => p.labelKey ?? `label.shell.page.${p.id}`;
export const descKeyOf = (p: PageDef) => p.descKey ?? `label.shell.desc.${p.id}`;
export const helpKeyOf = (p: PageDef): HelpKey => p.help ?? (`help.shell.page.${p.id}` as HelpKey);

/** True when the admin may open the page */
export function allowed(p: PageDef, app: Pick<AppCtx, 'can'>): boolean {
  if (!p.area) return true;
  const areas = Array.isArray(p.area) ? p.area : [p.area];
  return areas.some((a) => app.can(a));
}

export function visiblePages(app: Pick<AppCtx, 'can'>): PageDef[] {
  return PAGES.filter((p) => allowed(p, app));
}

export function sectionsOf(pages: PageDef[]): { section: NavSection; pages: PageDef[] }[] {
  return NAV_SECTIONS
    .map((section) => ({ section, pages: pages.filter((p) => p.section === section && !p.hidden) }))
    .filter((s) => s.pages.length > 0);
}
