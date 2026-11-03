/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · kit/Glyph.tsx
 * A few plain line glyphs in currentColor: square caps, one weight, no fills, no emblems.
 * Text beats a glyph: use one only where a label would not fit (the collapsed rail, a close ×).
 * ════════════════════════════════════════════════════════════════════════════ */

export type GlyphName =
  | 'close' | 'search' | 'check' | 'chevron' | 'chevronDown' | 'chevronUp' | 'arrow' | 'lock' | 'copy' | 'refresh' | 'menu'
  | 'plus' | 'minus' | 'warn' | 'dot' | 'external' | 'reset'
  | 'home' | 'people' | 'card' | 'ban' | 'map' | 'sun' | 'tool' | 'blocks' | 'stack' | 'shield' | 'list' | 'sliders' | 'news' | 'pin';

const PATHS: Record<GlyphName, string> = {
  close: 'M6 6l12 12M18 6L6 18',
  search: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.5 15.5L20 20',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  chevron: 'M9 5l7 7-7 7',
  chevronDown: 'M5 9l7 7 7-7',
  chevronUp: 'M5 15l7-7 7 7',
  arrow: 'M4 12h15M13 6l6 6-6 6',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9h-13z',
  copy: 'M8 8h11v12H8zM5 16V4h11',
  refresh: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v5h-5',
  menu: 'M4 6h16M4 12h16M4 18h16',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  warn: 'M12 4l9 16H3zM12 10v5M12 17.5v.5',
  dot: 'M12 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  reset: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v5h5',
  home: 'M4 11l8-7 8 7M6 9.5V20h12V9.5',
  people: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.3c1.8.8 3 2.6 3 4.7',
  card: 'M3 6h18v12H3zM7 10.5h4M7 14h7M15.5 10h2.5',
  ban: 'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM6.4 6.4l11.2 11.2',
  map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14',
  sun: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
  tool: 'M14.5 4a4.5 4.5 0 0 0-4.2 6.1L4 16.4 7.6 20l6.3-6.3A4.5 4.5 0 0 0 20 9.5l-3 3-3.5-.5-.5-3.5 3-3a4.5 4.5 0 0 0-1.5-.5z',
  blocks: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  stack: 'M4 5h16v4H4zM4 10h16v4H4zM4 15h16v4H4z',
  shield: 'M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  /* a folded newspaper: the pause menu's news card */
  news: 'M4 5h13v14H6.5A2.5 2.5 0 0 1 4 16.5zM17 9h3v7.5a2.5 2.5 0 0 1-2.5 2.5M7 9h7M7 12.5h7M7 16h4',
  /* 2.3.0 the quick menu's pin (a push pin) */
  pin: 'M9 4h6M10 4v5l-3 4h10l-3-4V4M12 13v7',
};

export default function Glyph({ name, className, size }: { name: GlyphName; className?: string; size?: string }) {
  return (
    <svg
      className={className ? `k-glyph ${className}` : 'k-glyph'}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
