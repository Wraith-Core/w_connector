/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · map/engine/coords.ts  (the admin copy of w_map's coords.ts)
 * The affine world-to-map projection of the tile pyramid w_map ships.
 *
 * * The numbers are w_map's own (Config.Projection): the full image is 48841x38666 pixels at
 *   refZoom 8, and its two corners are known game coordinates. The admin page receives the same
 *   projection in 'mapCfg' and falls back to these defaults when a field is missing.
 * * Coordinates outside the paper stay outside it (no clamping) so the transform stays invertible.
 * ════════════════════════════════════════════════════════════════════════════ */

export interface ProjectionCfg {
  image: [number, number];
  topLeft: [number, number];
  bottomRight: [number, number];
  refZoom: number;
}

export const DEFAULT_PROJECTION: ProjectionCfg = {
  image: [48841, 38666],
  topLeft: [-7168, 4096],
  bottomRight: [5120, -5632],
  refZoom: 8,
};

const pair = (v: unknown, fallback: [number, number]): [number, number] => {
  if (Array.isArray(v) && v.length >= 2 && Number.isFinite(Number(v[0])) && Number.isFinite(Number(v[1]))) {
    return [Number(v[0]), Number(v[1])];
  }
  /* Lua tables arrive as objects when they are not sequences ({ "1": .., "2": .. }) */
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const a = Number(o['1'] ?? o['0'] ?? o.x), b = Number(o['2'] ?? o['1'] ?? o.y);
    if (Number.isFinite(a) && Number.isFinite(b)) return [a, b];
  }
  return fallback;
};

/** A projection config from whatever Lua sent (tolerant of objects instead of arrays). */
export function normaliseProjection(raw: unknown): ProjectionCfg {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const refZoom = Number(o.refZoom);
  return {
    image: pair(o.image, DEFAULT_PROJECTION.image),
    topLeft: pair(o.topLeft, DEFAULT_PROJECTION.topLeft),
    bottomRight: pair(o.bottomRight, DEFAULT_PROJECTION.bottomRight),
    refZoom: Number.isFinite(refZoom) ? refZoom : DEFAULT_PROJECTION.refZoom,
  };
}

export class Projection {
  readonly cfg: ProjectionCfg;
  private readonly spanX: number;
  private readonly spanY: number;

  constructor(cfg: Partial<ProjectionCfg> | undefined) {
    this.cfg = {
      image: cfg?.image ?? DEFAULT_PROJECTION.image,
      topLeft: cfg?.topLeft ?? DEFAULT_PROJECTION.topLeft,
      bottomRight: cfg?.bottomRight ?? DEFAULT_PROJECTION.bottomRight,
      refZoom: cfg?.refZoom ?? DEFAULT_PROJECTION.refZoom,
    };

    this.spanX = this.cfg.bottomRight[0] - this.cfg.topLeft[0];
    this.spanY = this.cfg.topLeft[1] - this.cfg.bottomRight[1];
    if (![...this.cfg.image, ...this.cfg.topLeft, ...this.cfg.bottomRight, this.cfg.refZoom].every(Number.isFinite) ||
        this.cfg.image[0] <= 0 || this.cfg.image[1] <= 0 || this.spanX <= 0 || this.spanY <= 0) {
      throw new Error('Invalid map projection');
    }
  }

  /** How many map pixels in one game unit at refZoom. */
  pxPerUnit(): number {
    return this.cfg.image[0] / this.spanX;
  }

  /** Game coordinates -> map pixels at refZoom. */
  toPixel(gameX: number, gameY: number): [number, number] {
    const { image, topLeft } = this.cfg;
    const fx = (gameX - topLeft[0]) / this.spanX;
    const fy = (topLeft[1] - gameY) / this.spanY;
    return [image[0] * fx, image[1] * fy];
  }

  /** Map pixels -> game coordinates. */
  toGame(pixelX: number, pixelY: number): [number, number] {
    const { image, topLeft } = this.cfg;
    return [
      topLeft[0] + (pixelX / image[0]) * this.spanX,
      topLeft[1] - (pixelY / image[1]) * this.spanY,
    ];
  }
}
