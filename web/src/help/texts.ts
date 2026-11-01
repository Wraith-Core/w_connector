/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · help/texts.ts
 * Loads every locales/help/<page>.<lang>.json into the bundle (import.meta.glob, eager) and flattens
 * it the way scripts/help-lib.mjs does:
 *   { "players": { "kick": "…" } }                   → help.players.kick
 *   { "players": { "ban": { "text": "…", "undo": "…" } } } → help.players.ban (+ its sub-keys)
 *   { "label": { "players": { "kick": "Kick" } } }   → label.players.kick   (read with t())
 * Lua never needs these texts, so they do not travel in the 'open' message.
 * ════════════════════════════════════════════════════════════════════════════ */

import type { Lang, LocalText } from '../types';
import type { HelpEntry, HelpInline, HelpKey, HelpText } from './types';

type Json = Record<string, unknown>;

const FILES = import.meta.glob('../../../locales/help/*.json', { eager: true, import: 'default' }) as Record<string, Json>;

const HELP: Record<Lang, Map<string, HelpEntry>> = { ar: new Map(), en: new Map() };
const LABELS: Record<Lang, Record<string, string>> = { ar: {}, en: {} };
const SUB = new Set(['text', 'title', 'example', 'undo', 'warn']);

function walkLabels(node: Json, prefix: string, out: Record<string, string>) {
  for (const [k, v] of Object.entries(node)) {
    const key = `${prefix}.${k}`;
    if (typeof v === 'string') out[key] = v;
    else if (v && typeof v === 'object' && !Array.isArray(v)) walkLabels(v as Json, key, out);
  }
}

function walkHelp(node: Json, prefix: string, out: Map<string, HelpEntry>) {
  for (const [k, v] of Object.entries(node)) {
    const key = `${prefix}.${k}`;
    if (typeof v === 'string') { out.set(key, { text: v }); continue; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const o = v as Json;
    if (typeof o.text === 'string') {
      const e: HelpEntry = { text: o.text };
      for (const [sk, sv] of Object.entries(o)) if (SUB.has(sk) && typeof sv === 'string') (e as unknown as Record<string, string>)[sk] = sv;
      out.set(key, e);
    } else {
      walkHelp(o, key, out);
    }
  }
}

for (const [path, json] of Object.entries(FILES)) {
  const m = /([^/\\]+)\.(ar|en)\.json$/.exec(path);
  if (!m || !json || typeof json !== 'object') continue;
  const lang = m[2] as Lang;
  for (const [root, value] of Object.entries(json)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    if (root === 'label') walkLabels(value as Json, 'label', LABELS[lang]);
    else walkHelp(value as Json, `help.${root}`, HELP[lang]);
  }
}

/** The label.* strings of every fragment, merged into the i18n fallback */
export const fragmentLabels = (lang: Lang): Record<string, string> => LABELS[lang];

const warned = new Set<string>();
function warnOnce(id: string, msg: string) {
  if (warned.has(id)) return;
  warned.add(id);
  // eslint-disable-next-line no-console
  console.warn(`[w_admin help] ${msg}`);
}

/** Picks the viewer's language from a HelpText */
export function pickText(v: HelpText | undefined, lang: Lang): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string') return v;
  const lt = v as LocalText;
  return (lang === 'ar' ? lt.ar || lt.en : lt.en || lt.ar) || undefined;
}

/** Resolves a key or an inline text. Returns null (and warns once) when there is no text: the "no explanation" marker. */
export function resolveHelp(help: HelpKey | HelpInline, lang: Lang): HelpEntry | null {
  if (typeof help === 'string') {
    const e = HELP[lang].get(help) ?? HELP[lang === 'ar' ? 'en' : 'ar'].get(help);
    if (!e || !e.text.trim()) { warnOnce(help, `no help text for ${help} (${lang})`); return null; }
    if (!HELP[lang].has(help)) warnOnce(`${help}:${lang}`, `${help} has no ${lang} text; showing the other language`);
    return e;
  }
  const text = pickText(help.text, lang);
  if (!text || !text.trim()) {
    const t = pickText(help.title, lang) ?? '?';
    warnOnce(`inline:${t}`, `a field arrived without help: "${t}"`);
    return null;
  }
  return {
    text,
    title: pickText(help.title, lang),
    example: pickText(help.example, lang),
    undo: pickText(help.undo, lang),
    warn: pickText(help.warn, lang),
  };
}

/** True when the key or inline text resolves (used to show the "no explanation" marker without opening) */
export function hasHelp(help: HelpKey | HelpInline, lang: Lang): boolean {
  if (typeof help === 'string') return !!(HELP[lang].get(help) ?? HELP.en.get(help))?.text.trim();
  return !!pickText(help.text, lang)?.trim();
}

/** Builds a HelpInline from a module field's { ar, en } texts */
export function inlineHelp(text: LocalText | undefined, extra?: { title?: LocalText | string; example?: LocalText; undo?: LocalText | string; warn?: LocalText }): HelpInline {
  return { text, ...extra };
}
