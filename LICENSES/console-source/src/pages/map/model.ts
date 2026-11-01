/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · pages/map/model.ts
 * The rows the Map page lists: the live map players (mapPlayers, every second while the page is
 * open) joined with the player list (players, every 2 s) for the citizen id, the character name and
 * the flags; and the places (w_map's services, saved markers and town names).
 * ════════════════════════════════════════════════════════════════════════════ */

import type { AdminPlayer, LocalText, MapCfg, MapData, MapPlayerRow } from '../../types';

export interface MapRow {
  /** server id (the session number) */
  id: number;
  x: number;
  y: number;
  z?: number;
  dead: boolean;
  citizenid: string;
  /** the character's name (first + last), else the account name */
  charName: string;
  account: string;
  job: string;
  frozen: boolean;
  canReturn: boolean;
}

export type PlaceKind = 'town' | 'service' | 'saved';
export interface PlaceRow { key: string; x: number; y: number; name: string; kind: PlaceKind }

const fullName = (p: AdminPlayer) => `${p.firstname ?? ''} ${p.lastname ?? ''}`.trim();

export function mapRows(mapPlayers: MapPlayerRow[], seen: boolean, players: AdminPlayer[]): MapRow[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const src: MapPlayerRow[] = seen ? mapPlayers : players.filter((p) => p.coords).map((p) => ({
    id: p.id, name: p.name, x: p.coords.x, y: p.coords.y, z: p.coords.z, job: p.job?.label ?? '', dead: p.dead,
  }));
  return src
    .filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y))
    .map((r) => {
      const p = byId.get(r.id);
      return {
        id: r.id, x: r.x, y: r.y, z: r.z, dead: !!r.dead,
        citizenid: p?.citizenid ?? '',
        charName: (p && fullName(p)) || r.name,
        account: p?.name ?? r.name,
        job: r.job || p?.job?.label || '',
        frozen: !!p?.frozen,
        canReturn: !!p?.canReturn,
      };
    });
}

export function placeRows(data: MapData, lang: 'ar' | 'en'): PlaceRow[] {
  const out: PlaceRow[] = [];
  for (const p of data.places) if (Number.isFinite(p.x) && Number.isFinite(p.y)) out.push({ key: `place:${p.id}`, x: p.x, y: p.y, name: p.name, kind: 'service' });
  for (const p of data.markers) if (Number.isFinite(p.x) && Number.isFinite(p.y)) out.push({ key: `saved:${p.id}`, x: p.x, y: p.y, name: p.name, kind: 'saved' });
  data.labels.forEach((l, i) => {
    if (l.hidden || !Number.isFinite(l.x) || !Number.isFinite(l.y)) return;
    out.push({ key: `name:${l.key ?? i}`, x: l.x, y: l.y, name: (lang === 'ar' && l.ar) || l.en, kind: 'town' });
  });
  return out;
}

/** The themes w_map offers: mapCfg.themes once L1 sends them (B13), else w_map's five tile sets */
export const FALLBACK_THEMES = ['light', 'dark', 'ember', 'blueprint', 'bone'];
export function themesOf(cfg: MapCfg | null): { id: string; label?: LocalText }[] {
  const list = cfg?.themes?.filter((x) => x && typeof x.id === 'string' && x.id) ?? [];
  if (list.length) return list;
  return FALLBACK_THEMES.map((id) => ({ id }));
}

const norm = (s: string) => s.toLocaleLowerCase().normalize('NFKD').replace(/[ً-ٰٟ]/g, '');

/** Name, account, job, citizen id ('12'), or session number ('#5') */
export function matchRow(r: MapRow, q: string): boolean {
  const s = q.trim();
  if (!s) return true;
  if (/^#\d+$/.test(s)) return r.id === Number(s.slice(1));
  if (r.citizenid && r.citizenid.toUpperCase() === s.toUpperCase()) return true;
  return norm(`${r.charName} ${r.account} ${r.job} ${r.citizenid} #${r.id}`).includes(norm(s));
}

export const matchPlace = (p: PlaceRow, q: string) => !q.trim() || norm(p.name).includes(norm(q.trim()));
