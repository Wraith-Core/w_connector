/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/hub/hudAdapter.ts
 * The built-in w_hud module: until w_hud answers the w_settings protocol (X1), its settings page is
 * drawn from the blob w_admin already receives ('hudCfg', exports.w_hud:GetServerHudCfg) and saved
 * through the old path (post('hud', { action: 'save', cfg }) → SaveServerHudCfg, which re-checks the
 * admin, clamps, stores and pushes to every player). Nothing in w_hud changes.
 *
 * The schema below has the same shape as a real one, so the page draws both the same way. Its
 * labels and help come from locales/help/hud.<lang>.json (both languages at once). Defaults are the
 * sanitise(nil) values of w_hud/server/admin.lua, which are the real defaults (not config.lua's).
 * ════════════════════════════════════════════════════════════════════════════ */

import { fragmentLabels, resolveHelp } from '../../help';
import type { HelpKey } from '../../help';
import type { HudCfg, LocalText, ModuleDescriptor, SettingValue, SettingsField, SettingsSchema, SettingsValues } from '../../types';

export const HUD = 'w_hud';

const label = (key: string): LocalText => ({
  ar: fragmentLabels('ar')[key] ?? fragmentLabels('en')[key] ?? key,
  en: fragmentLabels('en')[key] ?? fragmentLabels('ar')[key] ?? key,
});

function help(key: string): { help: LocalText; example?: LocalText } {
  const a = resolveHelp(key as HelpKey, 'ar');
  const e = resolveHelp(key as HelpKey, 'en');
  const out: { help: LocalText; example?: LocalText } = { help: { ar: a?.text ?? '', en: e?.text ?? '' } };
  if (a?.example || e?.example) out.example = { ar: a?.example ?? e?.example ?? '', en: e?.example ?? a?.example ?? '' };
  return out;
}

/* the order of FEATURE_KEYS in w_hud/server/admin.lua */
export const HUD_FEATURES = [
  'health', 'stamina', 'hunger', 'thirst', 'voice', 'horse', 'buffs', 'ammo', 'money', 'identity', 'compass', 'location',
  'playerImages', 'playerPanel',
] as const;

/** sanitise(nil) in w_hud/server/admin.lua */
export const HUD_DEFAULTS: Record<string, SettingValue> = {
  'needs.hungerRate': 1, 'needs.thirstRate': 1.4, 'needs.interval': 90,
  'damage.enabled': true, 'damage.hungerAt': 15, 'damage.thirstAt': 15, 'damage.amount': 2, 'damage.interval': 20, 'damage.canKill': true,
  name: '', 'logo.url': '', 'logo.width': 30, 'logo.height': 0,
  'identity.x': 98.2, 'identity.y': 2, 'identity.scale': 1, 'identity.opacity': 1,
  ...Object.fromEntries(HUD_FEATURES.map((k) => [`features.${k}`, true])),
};

type Extra = Partial<SettingsField>;
/** a field whose texts are label.hud.<id> and help.hud.<id> */
function field(key: string, id: string, type: SettingsField['type'], extra: Extra = {}): SettingsField {
  const h = help(`help.hud.${id}`);
  return { key, type, label: label(`label.hud.${id}`), help: h.help, ...(h.example ? { example: h.example } : {}), ...extra };
}

const unit = (u: 'points' | 'seconds' | 'percent'): LocalText => label(`label.hud.unit.${u}`);

let cached: SettingsSchema | null = null;

/** The built-in schema (needs, damage, features, identity); built once, both languages inside */
export function hudSchema(): SettingsSchema {
  if (cached) return cached;
  const g = (id: string) => ({ label: label(`label.hud.group.${id}`), help: help(`help.hud.group.${id}`).help });
  cached = {
    resource: HUD,
    version: 0,
    level: 'admin',
    title: label('label.hub.builtin.whud.label'),
    description: label('label.hub.builtin.whud.description'),
    links: [{ id: 'hudmenu', command: 'hudmenu', label: label('label.hud.openPanel'), help: help('help.hud.openPanel').help }],
    groups: [
      {
        id: 'needs', store: 'own', clientVisible: true, ...g('needs'),
        fields: [
          field('needs.hungerRate', 'needs.hungerRate', 'number', { min: 0, max: 25, step: 0.1, unit: unit('points'), derived: { kind: 'drainTime', args: { rate: 'needs.hungerRate', interval: 'needs.interval' } } }),
          field('needs.thirstRate', 'needs.thirstRate', 'number', { min: 0, max: 25, step: 0.1, unit: unit('points'), derived: { kind: 'drainTime', args: { rate: 'needs.thirstRate', interval: 'needs.interval' } } }),
          field('needs.interval', 'needs.interval', 'number', { min: 5, max: 1800, step: 1, unit: unit('seconds') }),
        ],
      },
      {
        id: 'damage', store: 'own', clientVisible: true, ...g('damage'),
        fields: [
          field('damage.enabled', 'damage.enabled', 'bool'),
          field('damage.hungerAt', 'damage.hungerAt', 'number', { min: 0, max: 99, step: 1 }),
          field('damage.thirstAt', 'damage.thirstAt', 'number', { min: 0, max: 99, step: 1 }),
          field('damage.amount', 'damage.amount', 'number', { min: 0.5, max: 25, step: 0.5, unit: unit('percent') }),
          field('damage.interval', 'damage.interval', 'number', { min: 3, max: 600, step: 1, unit: unit('seconds'), derived: { kind: 'deathTime', args: { amount: 'damage.amount', interval: 'damage.interval' } } }),
          field('damage.canKill', 'damage.canKill', 'bool'),
        ],
      },
      {
        id: 'features', store: 'own', clientVisible: true, ...g('features'),
        fields: HUD_FEATURES.map((k) => field(`features.${k}`, `features.${k}`, 'bool')),
      },
      {
        id: 'identity', store: 'own', clientVisible: true, ...g('identity'),
        fields: [
          field('name', 'identity.name', 'text', { maxLength: 48 }),
          field('logo.url', 'identity.logoUrl', 'text', { maxLength: 400, pattern: '^(https://|http://|nui://)' }),
          field('logo.width', 'identity.logoWidth', 'number', { min: 2, max: 160, step: 1 }),
          field('logo.height', 'identity.logoHeight', 'number', { min: 0, max: 160, step: 1 }),
          field('identity.x', 'identity.x', 'number', { min: -20, max: 120, step: 0.1, unit: unit('percent') }),
          field('identity.y', 'identity.y', 'number', { min: -20, max: 120, step: 0.1, unit: unit('percent') }),
          field('identity.scale', 'identity.scale', 'number', { min: 0.4, max: 3, step: 0.05 }),
          field('identity.opacity', 'identity.opacity', 'number', { min: 0.15, max: 1, step: 0.05 }),
        ],
      },
    ],
  };
  return cached;
}

const getPath = (o: unknown, path: string): unknown => {
  let cur = o;
  for (const p of path.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
};

const asValue = (v: unknown): SettingValue | undefined =>
  typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string' ? v : undefined;

/** One group's values from the live blob (null blob → the defaults, flagged by the caller) */
export function hudValues(cfg: HudCfg | null, group: string): SettingsValues {
  const g = hudSchema().groups.find((x) => x.id === group);
  const values: Record<string, SettingValue> = {};
  const defaults: Record<string, SettingValue> = {};
  for (const f of g?.fields ?? []) {
    defaults[f.key] = HUD_DEFAULTS[f.key] ?? null;
    values[f.key] = asValue(getPath(cfg, f.key)) ?? HUD_DEFAULTS[f.key] ?? null;
  }
  return { values, defaults, overridden: {} };
}

/** The blob to save: the live one with the edits written in (w_hud rebuilds it field by field anyway) */
export function hudApply(cfg: HudCfg | null, edits: { key: string; value: SettingValue }[]): HudCfg {
  const out = JSON.parse(JSON.stringify(cfg ?? {})) as Record<string, unknown>;
  for (const { key, value } of edits) {
    const parts = key.split('.');
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
      cur = cur[p] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]] = value;
  }
  return out;
}

/** The w_hud card when the server list does not carry one (before the L1 hub lands, or a list error) */
export function builtinHudModule(state: string | undefined, version: string | undefined): ModuleDescriptor {
  return {
    resource: HUD,
    label: label('label.hub.builtin.whud.label'),
    description: label('label.hub.builtin.whud.description'),
    help: help('help.hub.builtin.whud').help,
    group: 'player',
    state: state ?? 'started',
    version: version ?? '',
    pinned: true,
    panel: { how: label('label.hub.builtin.whud.how') },
  };
}
