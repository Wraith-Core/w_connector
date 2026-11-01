/* ════════════════════════════════════════════════════════════════════════════
 * Small inline glyphs drawn in the RDR style: single-colour, currentColor, no icon font.
 * ════════════════════════════════════════════════════════════════════════════ */

export type GlyphName =
  | 'dashboard' | 'players' | 'map' | 'hud' | 'self' | 'bans' | 'resources'
  | 'menu' | 'close' | 'search' | 'check' | 'skull' | 'heart' | 'food' | 'water' | 'bolt' | 'pin' | 'arrow'
  | 'sortUp' | 'sortDown' | 'warn' | 'info' | 'refresh' | 'coin' | 'lock' | 'star' | 'horse' | 'wagon';

const PATHS: Record<GlyphName, string> = {
  menu: 'M3 4h18v16H3zM9 4v16M13 9h5M13 15h5',
  dashboard: 'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z',
  players: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9c0-3.9 3.1-7 7-7s7 3.1 7 7H5z',
  map: 'M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2V5zm6 0v14l6 2V7L9 5z',
  hud: 'M3 5h18v3H3zM3 10h11v3H3zM3 15h7v4H3zM16 10h5v9h-5z',
  self: 'M12 2l2.6 6.2L21 9l-5 4.4 1.5 6.6L12 16.5 6.5 20l1.5-6.6L3 9l6.4-.8z',
  bans: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-6.4 6a7.5 7.5 0 0 0 10.4 10.4zm12.8 8A7.5 7.5 0 0 0 8 5.6z',
  resources: 'M4 4h16v4H4zM4 10h16v4H4zM4 16h16v4H4zM6 5.5v1M6 11.5v1M6 17.5v1',
  close: 'M5 5l14 14M19 5L5 19',
  search: 'M10 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm5.5 12.5L21 21',
  check: 'M4 12l5 5L20 6',
  skull: 'M12 2a8 8 0 0 0-8 8c0 3 1.5 5 3 6v4h10v-4c1.5-1 3-3 3-6a8 8 0 0 0-8-8zM9 9a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  heart: 'M12 21s-8-5.3-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.7-8 11-8 11z',
  food: 'M7 2v9a3 3 0 0 0 2 2.8V22h2V13.8A3 3 0 0 0 13 11V2h-2v7h-1V2H8v7H7zm10 0c-2 0-3 3-3 6v5h2v9h2V2z',
  water: 'M12 2s-6 7.5-6 12a6 6 0 0 0 12 0c0-4.5-6-12-6-12z',
  bolt: 'M11 21l1-7H7.5l5.5-12h2l-1 7h4.5z',
  pin: 'M12 2a6 6 0 0 0-6 6c0 4.5 6 14 6 14s6-9.5 6-14a6 6 0 0 0-6-6zm0 8.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z',
  arrow: 'M4 12h16M13 5l7 7-7 7',
  sortUp: 'M12 5l6 8H6z',
  sortDown: 'M12 19l-6-8h12z',
  warn: 'M12 3l10 18H2zM12 10v5M12 17.5v1',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 8v7M12 6.5v1',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  coin: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4v10M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4',
  lock: 'M6 10V7a6 6 0 0 1 12 0v3h2v11H4V10h2zm3 0h6V7a3 3 0 0 0-6 0v3z',
  star: 'M12 2l2.6 6.2L21 9l-5 4.4 1.5 6.6L12 16.5 6.5 20l1.5-6.6L3 9l6.4-.8z',
  horse: 'M4 20l2-7 2-2V6l3 1 4-4 2 2-1 3 4 2v10h-3v-6l-3 1v5H9l1-5-3 1-1 4z',
  wagon: 'M3 8h12l3 4h3v5h-2a2 2 0 1 1-4 0H9a2 2 0 1 1-4 0H3V8zm2 2v3h8v-3H5z',
};

const FILLED: Partial<Record<GlyphName, true>> = {
  dashboard: true, players: true, map: true, hud: true, self: true, bans: true, resources: true,
  skull: true, heart: true, food: true, water: true, bolt: true, pin: true, sortUp: true, sortDown: true, lock: true, star: true, horse: true, wagon: true,
};

export default function Glyph({ name, className }: { name: GlyphName; className?: string }) {
  const filled = !!FILLED[name];
  return (
    <svg
      className={className ? `wa-glyph ${className}` : 'wa-glyph'}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={filled ? 0 : 2.2}
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
