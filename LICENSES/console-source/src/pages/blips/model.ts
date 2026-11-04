/* ════════════════════════════════════════════════════════════════════════════
 * w_connector · pages/blips/model.ts (2.4.0)
 * The map blips as the Blips page edits them: the shapes ops/native_blips.lua answers, its limits, the
 * game's sprites (core/blip_sprites.json, one 32 px cell each in public/blips/sprites.webp, same order)
 * and the 32 colour modifiers. The server checks every value again; this only warns first.
 * ════════════════════════════════════════════════════════════════════════════ */

import catalog from '../../../../core/blip_sprites.json';
import type { CSSProperties } from 'react';
import { wsScale } from '../../wsScale';

export interface Blip {
  id: string;
  name: string;
  sprite: string;
  /** BLIP_MODIFIER_MP_COLOR_1..32, none = the game's own colour */
  color?: string;
  x: number;
  y: number;
  z?: number;
  scale: number;
  /** who saved it last, and when (unix seconds) */
  by?: string;
  at?: number;
}

export interface BlipLimits { name: number; nameBytes: number; scaleMin: number; scaleMax: number; xy: number; zMin: number; zMax: number }

export interface BlipsState { list: Blip[]; rev: number; max: number; limits: BlipLimits }

export const DEFAULT_LIMITS: BlipLimits = { name: 48, nameBytes: 128, scaleMin: 0.2, scaleMax: 2, xy: 10000, zMin: -500, zMax: 3000 };

/* ── the game's sprites ──────────────────────────────────────────────────── */

const CELL = catalog.cell;
const COLS = catalog.cols;
export const SPRITES: string[] = catalog.sprites.map((s) => s.name);
const AT = new Map(SPRITES.map((n, i) => [n, i]));
export const isSprite = (name: string): boolean => AT.has(name);

/** 'blip_shop_gunsmith' → 'shop gunsmith' (what the list shows; the search also reads the full name) */
export const spriteLabel = (name: string): string => name.replace(/^blip_/, '').replace(/_/g, ' ');

/** The sprite's cell of the atlas, drawn `size` design px square (x the screen scale, whole px so the
 *  cells line up; the atlas is the page's own file) */
export function spriteStyle(name: string, design: number): CSSProperties {
  const size = Math.max(1, Math.round(design * wsScale()));
  const i = AT.get(name);
  if (i === undefined) return { width: size, height: size };
  const k = size / CELL;
  return {
    width: size, height: size,
    backgroundImage: 'url("blips/sprites.webp")',
    backgroundSize: `${COLS * CELL * k}px auto`,
    backgroundPosition: `-${(i % COLS) * size}px -${Math.floor(i / COLS) * size}px`,
  };
}

/* ── the colours (the game's names; the swatches are close, measured in game for w_map's colour table) ── */

const HEX = [
  '#7fb2e5', '#c0392b', '#8e44ad', '#e67e22', '#a8e6ef', '#f3e9a0', '#e88fb4', '#4caf50', '#1f5f5b', '#a3172f',
  '#6abf3a', '#2a9d8f', '#2e5cb8', '#7b5cd6', '#6b2d5c', '#5e1a2a', '#9e9e9e', '#e8a0a8', '#b5e04a', '#2e6b30',
  '#6ec6f0', '#b03fe0', '#c9a227', '#5a6fa0', '#22c3d6', '#c8a77a', '#cfeaf7', '#def5a8', '#f08f7a', '#e06a6a',
  '#f4ecd2', '#ffffff',
];
export interface BlipColor { id: string; n: number; hex: string }
export const COLORS: BlipColor[] = HEX.map((hex, i) => ({ id: `BLIP_MODIFIER_MP_COLOR_${i + 1}`, n: i + 1, hex }));
export const colorOf = (id: string | undefined): BlipColor | undefined => COLORS.find((c) => c.id === id);

/* ── reading what the server sends ───────────────────────────────────────── */

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Lua sends an empty table as {} and a list as an array: always an array of blips here */
export function toList(v: unknown): Blip[] {
  const arr = Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v as Record<string, unknown>) : [];
  const out: Blip[] = [];
  for (const x of arr) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    const xx = num(r.x); const yy = num(r.y);
    if (typeof r.id !== 'string' || typeof r.name !== 'string' || typeof r.sprite !== 'string' || xx === undefined || yy === undefined) continue;
    out.push({
      id: r.id, name: r.name, sprite: r.sprite, x: xx, y: yy, z: num(r.z), scale: num(r.scale) ?? 1,
      color: typeof r.color === 'string' ? r.color : undefined,
      by: typeof r.by === 'string' ? r.by : undefined, at: num(r.at),
    });
  }
  return out;
}

export function toState(v: unknown): BlipsState | null {
  if (!v || typeof v !== 'object') return null;
  const d = v as Record<string, unknown>;
  const lim = (d.limits && typeof d.limits === 'object' ? d.limits : {}) as Partial<BlipLimits>;
  return {
    list: toList(d.list),
    rev: num(d.rev) ?? 0,
    max: num(d.max) ?? 200,
    limits: { ...DEFAULT_LIMITS, ...Object.fromEntries(Object.entries(lim).filter(([, n]) => typeof n === 'number')) },
  };
}

/* ── the editor's draft ──────────────────────────────────────────────────── */

export interface Draft { name: string; sprite: string; color: string; x: number | null; y: number | null; z: number | null; scale: number }

export const EMPTY_DRAFT: Draft = { name: '', sprite: '', color: '', x: null, y: null, z: null, scale: 1 };

export const draftOf = (b: Blip | null): Draft => (b
  ? { name: b.name, sprite: b.sprite, color: b.color ?? '', x: b.x, y: b.y, z: b.z ?? null, scale: b.scale }
  : { ...EMPTY_DRAFT });

/** What the server keeps of a name: no colour codes, no ~ tokens, no control characters, single spaces, trimmed */
export function cleanName(s: string): string {
  let prev: string;
  do { prev = s; s = s.replace(/\^\d/g, ''); } while (s !== prev);
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f~]/g, ' ').replace(/[ \t]+/g, ' ').replace(/^ | $/g, '');
}

const enc = new TextEncoder();

export interface DraftCheck { name: 'empty' | 'long' | null; sprite: boolean; pos: boolean; ok: boolean; letters: number }

export function checkDraft(d: Draft, lim: BlipLimits): DraftCheck {
  const n = cleanName(d.name);
  const letters = [...n].length;
  const name = !n ? 'empty' : letters > lim.name || enc.encode(n).length > lim.nameBytes ? 'long' : null;
  const sprite = isSprite(d.sprite);
  const inXY = (v: number | null) => v !== null && Number.isFinite(v) && Math.abs(v) <= lim.xy;
  const pos = inXY(d.x) && inXY(d.y) && (d.z === null || (Number.isFinite(d.z) && d.z >= lim.zMin && d.z <= lim.zMax));
  return { name, sprite, pos, letters, ok: !name && sprite && pos };
}

/** The draft as the server receives it (blips.save) */
export function wireOf(d: Draft, id: string | null): Record<string, unknown> {
  return {
    ...(id ? { id } : {}),
    name: cleanName(d.name), sprite: d.sprite, ...(d.color ? { color: d.color } : {}),
    x: d.x, y: d.y, ...(d.z !== null ? { z: d.z } : {}),
    scale: Math.round(d.scale * 20) / 20,
  };
}

export const sameDraft = (a: Draft, b: Draft): boolean =>
  cleanName(a.name) === cleanName(b.name) && a.sprite === b.sprite && a.color === b.color
  && a.x === b.x && a.y === b.y && a.z === b.z && a.scale === b.scale;
