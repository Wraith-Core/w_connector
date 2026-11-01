/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/hub/index.tsx: the Scripts hub ("the admin controls all the interfaces")
 * An EXTRA control layer over every script; no script's own interface is replaced.
 *
 * Routes (params are strings):
 *   hub                              every script as a card (search, filters, sections)
 *   hub?card=w_level[&focus=commands] the same, with that script's details drawer (quick commands)
 *   hub?resource=w_hud[&group=needs]  that script's settings (w_settings schema, or the built-in w_hud)
 * The sidebar pins scripts marked `pinned` (w_hud always) and "food and drink" once w_hud's schema
 * has it. The command palette finds every script.
 *
 * Visible with area 'scripts' (mod) OR 'hud' (the old HUD tab's admins keep their page while the
 * Lua side of the hub is not there yet). The server re-checks every action.
 * ════════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { definePage } from '../../app/pages';
import type { PageProps, PaletteItem, SubNavItem } from '../../app/pages';
import { useApp } from '../../ctx';
import type { AppCtx } from '../../ctx';
import { fragmentLabels, inlineHelp } from '../../help';
import { useI18n } from '../../i18n';
import type { Lang, LocalText, ModuleDescriptor } from '../../types';
import { fetchSchema, listModules, schemaCache } from './api';
import HubGrid from './HubGrid';
import { HUD, builtinHudModule } from './hudAdapter';
import ModulePage from './ModulePage';
import { normalizeModules } from './model';
import './hub.css';

/* ── the list: the server's, plus the built-in w_hud card when the server list has none ── */

function withBuiltin(app: Pick<AppCtx, 'can' | 'serverInfo'>, raw: ModuleDescriptor[] | null): ModuleDescriptor[] | null {
  /* empty Lua tables arrive as [] or {}: every list inside the descriptors is made an array first */
  const list = normalizeModules(raw);
  if (!app.can('hud') && !app.can('needs')) return list;
  if (list && list.some((m) => m.resource === HUD)) return list;
  const res = app.serverInfo?.resources.find((r) => r.name === HUD);
  const state = res ? String(res.state) : app.serverInfo ? 'missing' : 'started';
  return [...(list ?? []), builtinHudModule(state, res?.version)];
}

const hasSettingsFor = (app: Pick<AppCtx, 'can'>) => (m: ModuleDescriptor) =>
  !!m.settings || (m.resource === HUD && (app.can('hud') || app.can('settings') || app.can('needs')));

/* the sidebar and the palette run outside React: they read the document's language */
const docLang = (): Lang => (document.documentElement.lang === 'en' ? 'en' : 'ar');
const pick = (x: LocalText | undefined, lang: Lang) => (x ? (lang === 'ar' ? x.ar || x.en : x.en || x.ar) : '');
const FOOD_SUB = `${HUD}:food`;

function subFor(list: ModuleDescriptor[] | null, resource: string | undefined, group?: string): string | undefined {
  if (!resource) return undefined;
  if (resource === HUD && group === 'food' && schemaCache.get(HUD)?.groups.some((g) => g.id === 'food')) return FOOD_SUB;
  return list?.some((m) => m.resource === resource && m.pinned) ? resource : undefined;
}

/* ── the page ────────────────────────────────────────────────────────────── */

function HubPage({ route }: PageProps) {
  const app = useApp();
  const { t } = useI18n();
  const [local, setLocal] = useState<ModuleDescriptor[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const r = await listModules();
    if (r.ok && Array.isArray(r.data)) { setLocal(r.data); setError(null); }
    else setError(t(r.error ?? 'label.hub.loadError'));
    setLoading(false);
  }, [t]);
  useEffect(() => { void reload(); }, [reload]);

  /* the 'modules' push keeps the list live; the answer of 'list' covers a Lua that does not push */
  /* only what the list depends on (the context object changes with every 2 s player push) */
  const { modules, serverInfo, can } = app;
  const list = useMemo(() => withBuiltin({ can, serverInfo }, modules ?? local), [can, serverInfo, modules, local]);
  const hasSettings = useMemo(() => hasSettingsFor({ can }), [can]);

  /* w_hud's schema, early: the sidebar pins "food and drink" from it */
  const hudMod = list?.find((m) => m.resource === HUD);
  const { refresh } = app;
  useEffect(() => {
    if (!hudMod?.settings || schemaCache.has(HUD)) return;
    /* the sidebar reads the schema cache when it draws: a 'modules' push makes it draw again */
    void fetchSchema(HUD).then(() => { if (schemaCache.has(HUD)) refresh('modules'); });
  }, [hudMod?.settings, refresh]);

  const params = route.params;
  const resource = params.resource || undefined;

  const onOpen = useCallback(async (res: string, link?: string) => {
    const key = link ? `${res}:${link}` : res;
    setOpening(key);
    try {
      /* the server checks the script's own permission, then Lua closes this console and opens it */
      await app.act('scripts', link ? { action: 'open', resource: res, link } : { action: 'open', resource: res });
    } finally {
      setOpening(null);
    }
  }, [app]);

  const onSelect = useCallback((res: string | null, focus?: 'commands') => {
    app.navigate('hub', res ? { card: res, ...(focus ? { focus } : {}) } : {});
  }, [app]);

  const onSettings = useCallback((res: string) => {
    const sub = subFor(list, res);
    app.navigate('hub', { resource: res, ...(sub ? { sub } : {}) });
  }, [app, list]);

  const onStart = useCallback(async (res: string) => {
    const r = await app.act('scripts', { action: 'start', resource: res });
    if (r.ok) { void reload(); app.refresh('server'); }
  }, [app, reload]);

  if (resource) {
    const mod = list?.find((m) => m.resource === resource);
    return (
      <ModulePage
        key={resource}
        resource={resource}
        mod={mod}
        listLoading={loading && !list?.some((m) => m.resource === resource && m.settings)}
        group={params.group}
        opening={opening}
        onOpen={(res, link) => void onOpen(res, link)}
        onBack={() => app.navigate('hub', {})}
        onGroup={(group) => {
          const sub = subFor(list, resource, group);
          app.navigate('hub', { resource, group, ...(sub ? { sub } : {}) });
        }}
      />
    );
  }

  return (
    <HubGrid
      list={list}
      /* still loading while only the built-in w_hud card is there: the server's list has not come */
      loading={loading && !(modules ?? local)?.length}
      error={error}
      hasSettings={hasSettings}
      selected={params.card || null}
      focus={params.focus === 'commands' ? 'commands' : undefined}
      opening={opening}
      onSelect={onSelect}
      onOpen={(res) => void onOpen(res)}
      onSettings={onSettings}
      onStart={(res) => void onStart(res)}
      onReload={() => void reload()}
    />
  );
}

/* ── the page definition ─────────────────────────────────────────────────── */

export const page = definePage({
  id: 'hub',
  section: 'scripts',
  order: 10,
  glyph: 'blocks',
  area: ['scripts', 'hud'],
  layout: 'fill',
  header: false,
  component: HubPage,
  badge: (app) => (app.modules && app.modules.length ? app.modules.length : null),
  subnav: (app): SubNavItem[] => {
    const lang = docLang();
    const list = withBuiltin(app, app.modules) ?? [];
    const out: SubNavItem[] = [];
    for (const m of list.filter((x) => x.pinned)) {
      out.push({ id: m.resource, label: pick(m.label, lang), params: { resource: m.resource }, help: inlineHelp(m.help) });
      const food = m.resource === HUD ? schemaCache.get(HUD)?.groups.find((g) => g.id === 'food') : undefined;
      if (food) out.push({ id: FOOD_SUB, label: pick(food.label, lang), params: { resource: HUD, group: 'food' }, help: inlineHelp(food.help) });
    }
    return out;
  },
  palette: (app): PaletteItem[] => {
    const lang = docLang();
    const L = fragmentLabels(lang);
    const group = L['label.hub.palette'] ?? 'Scripts';
    return (withBuiltin(app, app.modules) ?? []).map((m) => ({
      id: `hub:${m.resource}`,
      label: pick(m.label, lang),
      sub: m.settings || m.resource === HUD ? (L['label.hub.paletteSettings'] ?? '%s').replace('%s', m.resource) : m.resource,
      group,
      keywords: [m.resource, m.label?.ar, m.label?.en, m.description?.ar, m.description?.en].filter(Boolean).join(' '),
      area: 'scripts',
      run: (a: AppCtx) => a.navigate('hub', m.settings || m.resource === HUD ? { resource: m.resource } : { card: m.resource }),
    }));
  },
});
