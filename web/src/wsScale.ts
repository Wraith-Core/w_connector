/**
 * The screen scale in JS -- the same rule as ui-scale.cjs (--ws-px): 1 at 1080p, 0.667 at 720p,
 * 2 at 4K, 4 at 8K; on an ultrawide the height decides. Master copy: ops/local/ui-scale/wsScale.ts.
 * Use it for sizes JS draws itself (canvas lines and fonts, px offsets, drag thresholds).
 */
export function wsScale(): number {
  const h = window.innerHeight || 1080;
  const w = window.innerWidth || 1920;
  return Math.max(0.6667, Math.min(h / 1080, w / 1920));
}

/** The text scale (--ws-fpx): like wsScale but never below 0.8. */
export function wsFontScale(): number {
  return Math.max(0.8, wsScale());
}

/** n design px (1080p) in real px now. */
export const wsPx = (n: number): number => n * wsScale();

/** Free band left/right of a centred 16:9 frame on a screen wider than 16:9 (--ws-gutter). */
export function wsGutter(): number {
  const h = window.innerHeight || 1080;
  const w = window.innerWidth || 1920;
  return Math.max(0, (w - (h * 16) / 9) / 2);
}
