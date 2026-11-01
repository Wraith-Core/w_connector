/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/tools  ("أدواتي" / My tools)
 * The page, and the palette entries of every tool the admin may use: a toggle or an action runs
 * straight from Ctrl+K (a tool that asks first shows its dialog); a form tool opens this page at it.
 * ════════════════════════════════════════════════════════════════════════════ */

import { definePage } from '../../app/pages';
import type { PaletteItem } from '../../app/pages';
import type { AppCtx } from '../../ctx';
import { post } from '../../nui';
import ToolsPage from './ToolsPage';
import { TOOLS, bundledT, canTool, docLang, isOn, startTool, toolHint, toolLabel } from './tools';

function palette(app: AppCtx): PaletteItem[] {
  const lang = docLang();
  const t = bundledT(lang);
  const other = bundledT(lang === 'ar' ? 'en' : 'ar');
  const group = t('label.shell.palette.tools');
  return TOOLS
    .filter((x) => canTool(app, x) && !x.unavailable?.(app.self))
    .map((x) => ({
      id: `tool:${x.id}`,
      label: toolLabel(t, x.id),
      sub: x.kind === 'toggle' ? t(isOn(x, app.self) ? 'label.tools.paletteOn' : 'label.tools.paletteOff')
        : x.kind === 'form' ? t('label.tools.paletteForm') : toolHint(t, x.id),
      group,
      area: x.area,
      keywords: `${toolLabel(other, x.id)} ${x.id} ${x.keywords ?? ''}`,
      run: (a: AppCtx) => {
        if (x.kind === 'form') { a.navigate('tools', { focus: x.id }); return; }
        startTool(a, x, t);
      },
    }));
}

export const page = definePage({
  id: 'tools',
  section: 'world',
  order: 30,
  glyph: 'tool',
  component: ToolsPage,
  layout: 'scroll',
  /* the 'self' push already arrives every 2 s; ask once so the page never opens on stale state */
  onEnter: () => { void post('refresh', { what: 'self' }); },
  palette,
});
