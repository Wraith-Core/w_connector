/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · i18n
 * Every text comes from Lua: the 'open' / 'locale' messages carry the resource's whole dictionary
 * (locales/{ar,en}.json flattened by w_lib with '.'). The page ships the same dictionaries as a
 * fallback, flattened the same way (B16), plus the label.* strings of locales/help/*.json.
 *   t('ui_players_count', 12)          →  '12 players'   (%s are filled in order)
 *   t('label.shell.page.players')      →  'Players'
 *   lt({ ar: 'تفاحة', en: 'Apple' })    →  the viewer's language
 * ════════════════════════════════════════════════════════════════════════════ */

import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { Dir, Lang, LocalText, Strings } from '../types';
import { fragmentLabels } from '../help/texts';
import uiEn from '../../../locales/en.json';
import uiAr from '../../../locales/ar.json';
import fivemAr from '../../../locales/platforms/fivem.ar.json';
import fivemEn from '../../../locales/platforms/fivem.en.json';
import { useConsoleCapabilities } from '../nui';

/** Flattens nested JSON with '.', exactly as w_lib/imports/locale/shared.lua does */
export function flatten(src: unknown, prefix = '', out: Strings = {}): Strings {
  if (!src || typeof src !== 'object') return out;
  for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[key] = String(v);
    else if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
  }
  return out;
}

export const FALLBACK: Record<Lang, Strings> = {
  en: { ...flatten(uiEn), ...fragmentLabels('en') },
  ar: { ...flatten(uiAr), ...fragmentLabels('ar') },
};

export type TFn = (key: string, ...args: (string | number)[]) => string;
export type LtFn = (text: LocalText | string | null | undefined) => string;

export interface I18n {
  t: TFn;
  /** picks the viewer's language from a { ar, en } text (module data) */
  lt: LtFn;
  lang: Lang;
  dir: Dir;
  rtl: boolean;
  strings: Strings;
}

export function format(tpl: string, args: (string | number)[]): string {
  if (args.length === 0) return tpl;
  let i = 0;
  return tpl.replace(/%s/g, () => (i < args.length ? String(args[i++]) : '%s'));
}

export function makeT(strings: Strings, lang: Lang, game?: string): TFn {
  const fb = FALLBACK[lang] ?? FALLBACK.en;
    const platform: Strings = game === 'gta5' ? (lang === 'ar' ? fivemAr : fivemEn) : {};
  return (key, ...args) => {
    const s = platform[key] ?? strings[key] ?? fb[key] ?? FALLBACK.en[key] ?? key;
    return format(s, args);
  };
}

export function makeLt(lang: Lang): LtFn {
  return (text) => {
    if (text === null || text === undefined) return '';
    if (typeof text === 'string') return text;
    return (lang === 'ar' ? text.ar || text.en : text.en || text.ar) || '';
  };
}

/** Applies the direction and the language to <html>, so the whole document (scrollbars, bidi) follows */
export function applyDocumentLocale(lang: Lang, dir: Dir) {
  const el = document.documentElement;
  el.lang = lang;
  el.dir = dir;
  el.classList.toggle('is-rtl', dir === 'rtl');
}

const DEFAULT: I18n = { t: makeT({}, 'ar'), lt: makeLt('ar'), lang: 'ar', dir: 'rtl', rtl: true, strings: {} };
const Ctx = createContext<I18n>(DEFAULT);

export function I18nProvider({ strings, lang, dir, children }: { strings: Strings; lang: Lang; dir: Dir; children: ReactNode }) {
  const capabilities = useConsoleCapabilities();
  const game = capabilities?.game;
  const value = useMemo<I18n>(() => ({ t: makeT(strings, lang, game), lt: makeLt(lang), lang, dir, rtl: dir === 'rtl', strings }), [strings, lang, dir, game]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
export const useT = () => useContext(Ctx).t;
export const useLang = () => useContext(Ctx).lang;

/** Arabic counts: 1 → one, 2 → two, 0 and 3-10 → few ("0 لاعبين", not "0 لاعبًا"), else many.
 *  English: 1 → one, else many. */
export function pluralForm(n: number, lang: Lang): 'one' | 'two' | 'few' | 'many' {
  const a = Math.abs(Math.round(n));
  if (a === 1) return 'one';
  if (lang === 'ar') {
    if (a === 2) return 'two';
    if (a === 0 || (a >= 3 && a <= 10)) return 'few';
  }
  return 'many';
}

/** '5 ساعات' / '1 day' from label.common.unit.<unit>.<form>. Arabic says one and two with the word
 *  alone ('ساعة', 'ساعتين': 'قبل ساعتين', 'بعد يوم'), never '2 ساعتان' or '1 ساعة'. */
export function countOf(t: TFn, lang: Lang, n: number, unit: 'day' | 'hour' | 'minute' | 'second'): string {
  const form = pluralForm(n, lang);
  const word = t(`label.common.unit.${unit}.${form}`);
  if (lang === 'ar' && (form === 'one' || form === 'two')) return word;
  return `${n} ${word}`;
}
