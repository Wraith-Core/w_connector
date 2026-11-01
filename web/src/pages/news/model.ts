/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/news/model.ts
 * The pause menu's news (w_pausemenu, server/board.lua) as the News page edits them: the shapes the
 * 'news' runner answers (server/sv_news.lua), and the same cleaning and limits it applies, so the page
 * warns before the server refuses:
 *   the chat colour codes ^0-^9 go, a control character (a new line) becomes a space, the ends are trimmed
 *   title 80 · text 400 · date 60 · image 300, in BYTES as board.lua counts them (an Arabic letter is two)
 *   at most 12 items · a title · the image a bundled plate or a nui:// / https://cfx-nui-<res>/ picture
 * ════════════════════════════════════════════════════════════════════════════ */

import type { Lang } from '../../types';

/** A text by language ({ ar, en }); a missing language shows the other one in the pause menu */
export type Loc = Record<string, string>;

export interface NewsItem {
  /** set by the server; a new item has none until it is saved */
  id?: string;
  title: Loc;
  text?: Loc;
  date?: Loc;
  /** 'news/saloon.webp' (bundled), nui://<res>/… or https://cfx-nui-<res>/…; none = a bundled plate in turn */
  image?: string;
}

export interface NewsLimits { title: number; text: number; date: number; image: number; id: number; items: number }

export interface NewsState {
  list: NewsItem[];
  /** names the list the page read; a save sends it back (someone else's change in between is refused) */
  rev: string;
  plates: string[];
  limits: NewsLimits;
  /** the pause menu script (Config.News.resource) */
  resource: string;
}

export const DEFAULT_LIMITS: NewsLimits = { title: 80, text: 400, date: 60, image: 300, id: 40, items: 12 };
/** w_pausemenu's own plates, in the order it hands them to an item without a picture (App.tsx PLATES) */
export const ROTATION = ['news/saloon.webp', 'news/wagons.webp', 'news/frontier.webp'];
const IMAGE_EXT = new Set(['webp', 'png', 'jpg', 'jpeg', 'gif']);

/* ── reading what the server sends ─────────────────────────────────────── */

/** A text as the server may send it: { ar, en } or one plain string for both languages */
export function toLoc(v: unknown): Loc {
  if (typeof v === 'string' || typeof v === 'number') return String(v) === '' ? {} : { ar: String(v) };
  const out: Loc = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, s] of Object.entries(v as Record<string, unknown>)) {
      if ((typeof s === 'string' || typeof s === 'number') && String(s) !== '') out[k] = String(s);
    }
  }
  return out;
}

/** Lua sends an empty table as {} and a list as an array: always an array of items here */
export function toList(v: unknown): NewsItem[] {
  const arr = Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v as Record<string, unknown>) : [];
  return arr
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({
      id: typeof x.id === 'string' || typeof x.id === 'number' ? String(x.id) : undefined,
      title: toLoc(x.title),
      text: toLoc(x.text),
      date: toLoc(x.date),
      image: typeof x.image === 'string' ? x.image : undefined,
    }));
}

export function toState(v: unknown): NewsState | null {
  if (!v || typeof v !== 'object') return null;
  const d = v as Record<string, unknown>;
  const lim = (d.limits && typeof d.limits === 'object' ? d.limits : {}) as Partial<NewsLimits>;
  const plates = Array.isArray(d.plates) ? d.plates.filter((p): p is string => typeof p === 'string') : [];
  return {
    list: toList(d.list),
    rev: typeof d.rev === 'string' ? d.rev : '',
    plates: plates.length ? plates : ROTATION,
    limits: { ...DEFAULT_LIMITS, ...Object.fromEntries(Object.entries(lim).filter(([, n]) => typeof n === 'number')) },
    resource: typeof d.resource === 'string' && d.resource ? d.resource : 'w_pausemenu',
  };
}

/* ── the pause menu's own reading ─────────────────────────────────────── */

/** The language the pause menu shows: the viewer's, else English, else Arabic, else any */
export function pick(v: Loc | undefined, lang: Lang): string {
  if (!v) return '';
  return v[lang] || v.en || v.ar || Object.values(v).find((s) => !!s) || '';
}

const EDGE = /^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g;
/** What board.lua keeps of a text: no colour codes, control characters as spaces, trimmed */
export function cleanText(s: string): string {
  /* the colour codes until none is left, as the server does ('^^11' → '^1' → ''): board.lua would take
     away what one pass leaves */
  let prev: string;
  do { prev = s; s = s.replace(/\^\d/g, ''); } while (s !== prev);
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(EDGE, '');
}

const enc = new TextEncoder();
/** The size board.lua measures: UTF-8 bytes (an Arabic letter is two, an English one is one) */
export const bytesOf = (s: string): number => enc.encode(s).length;

/** The picture's address as this page can load it (the pause menu reads a bundled plate from its own page) */
export function imageUrl(image: string | undefined, index: number, resource = 'w_pausemenu'): string {
  const src = image && image.trim() ? image.trim() : ROTATION[((index % ROTATION.length) + ROTATION.length) % ROTATION.length];
  const nui = /^nui:\/\/([^/]+)\/(.*)$/i.exec(src);
  if (nui) return `https://cfx-nui-${nui[1]}/${nui[2]}`;
  if (/^https?:/i.test(src)) return src;
  return `https://cfx-nui-${resource}/web/build/${src.replace(/^\.?\//, '')}`;
}

/** Why a typed picture path would be refused (null = fine or empty) */
export function imageProblem(v: string, limits: NewsLimits): 'long' | 'shape' | null {
  const s = v.replace(EDGE, '');
  if (!s) return null;
  if (bytesOf(s) > limits.image) return 'long';
  if (s.includes('..') || /[^\w\-./:]/.test(s)) return 'shape';
  const shaped = /^news\/[\w\-./]+$/.test(s) || /^nui:\/\/[\w-]+\/[\w\-./]+$/.test(s) || /^https:\/\/cfx-nui-[\w-]+\/[\w\-./]+$/.test(s);
  const ext = /\.(\w+)$/.exec(s)?.[1]?.toLowerCase();
  if (!shaped || !ext || !IMAGE_EXT.has(ext)) return 'shape';
  return null;
}

/* ── the editor's draft ────────────────────────────────────────────────── */

export interface Draft {
  titleAr: string; titleEn: string;
  textAr: string; textEn: string;
  dateAr: string; dateEn: string;
  /** a plate of the list, or 'custom' with `path` */
  plate: string;
  path: string;
}

export type DraftKey = 'titleAr' | 'titleEn' | 'textAr' | 'textEn' | 'dateAr' | 'dateEn';
export const FIELD_OF: Record<DraftKey, 'title' | 'text' | 'date'> = {
  titleAr: 'title', titleEn: 'title', textAr: 'text', textEn: 'text', dateAr: 'date', dateEn: 'date',
};

/** The draft of an item (a new one takes the next plate in turn) */
export function draftOf(item: NewsItem | null, index: number, plates: string[]): Draft {
  const image = item?.image?.trim() || (item ? ROTATION[index % ROTATION.length] : plates[index % plates.length] ?? ROTATION[0]);
  const known = plates.includes(image);
  return {
    titleAr: item?.title.ar ?? '', titleEn: item?.title.en ?? '',
    textAr: item?.text?.ar ?? '', textEn: item?.text?.en ?? '',
    dateAr: item?.date?.ar ?? '', dateEn: item?.date?.en ?? '',
    plate: known ? image : 'custom',
    path: known ? '' : image,
  };
}

/** The draft as the item the server receives; languages other than ar / en the item had stay as they were */
export function itemOf(d: Draft, base: NewsItem | null): NewsItem {
  const loc = (old: Loc | undefined, ar: string, en: string): Loc | undefined => {
    const out: Loc = {};
    for (const [k, v] of Object.entries(old ?? {})) if (k !== 'ar' && k !== 'en' && v) out[k] = v;
    const a = cleanText(ar); const e = cleanText(en);
    if (a) out.ar = a;
    if (e) out.en = e;
    return Object.keys(out).length ? out : undefined;
  };
  const image = d.plate === 'custom' ? d.path.replace(EDGE, '') : d.plate;
  return {
    id: base?.id,
    title: loc(base?.title, d.titleAr, d.titleEn) ?? {},
    text: loc(base?.text, d.textAr, d.textEn),
    date: loc(base?.date, d.dateAr, d.dateEn),
    image: image || undefined,
  };
}

export interface DraftCheck {
  /** bytes used per field (after cleaning) */
  used: Record<DraftKey, number>;
  over: Partial<Record<DraftKey, true>>;
  noTitle: boolean;
  image: 'long' | 'shape' | 'empty' | null;
  ok: boolean;
}

export function checkDraft(d: Draft, limits: NewsLimits): DraftCheck {
  const keys: DraftKey[] = ['titleAr', 'titleEn', 'textAr', 'textEn', 'dateAr', 'dateEn'];
  const used = {} as Record<DraftKey, number>;
  const over: Partial<Record<DraftKey, true>> = {};
  for (const k of keys) {
    used[k] = bytesOf(cleanText(d[k]));
    if (used[k] > limits[FIELD_OF[k]]) over[k] = true;
  }
  const noTitle = !cleanText(d.titleAr);
  const image = d.plate === 'custom' ? (d.path.trim() ? imageProblem(d.path, limits) : 'empty') : null;
  return { used, over, noTitle, image, ok: !noTitle && Object.keys(over).length === 0 && !image };
}

/** True when two drafts would save the same item */
export const sameDraft = (a: Draft, b: Draft): boolean => (Object.keys(a) as (keyof Draft)[])
  .every((k) => (k === 'path' && a.plate !== 'custom' && b.plate !== 'custom') || cleanText(a[k]) === cleanText(b[k]));
