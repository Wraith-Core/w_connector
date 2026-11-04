/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · map/engine/MapEngine.ts  (the admin copy of w_map's engine/MapEngine.ts, trimmed)
 * The map engine: tiles on a canvas, and markers in the DOM above it.
 *
 * ═══ What was kept from w_map ═══
 *
 *   The tile painting (whole-pixel tiles, the parent tile magnified until the child arrives, the
 *   coarse level held during motion), the smooth fractional zoom anchored under the cursor, the
 *   flight to a point, the drag-to-pan with a 4px dead zone, the on-demand frame loop, the input
 *   reset on focus loss, and the DOM markers placed with translate3d. The feel is the same as the
 *   player's map so an admin never has to relearn it.
 *
 * ═══ What was dropped ═══
 *
 *   The route planner, zone editor, sprite tinting and snapshot tools remain in w_map.
 *   This view adds live players, service locations, saved markers and localized place names
 *   supplied by w_map, with admin actions around the shared map projection.
 *
 * ═══ The coordinates ═══
 *
 *   The map is one image whose size is proj.image at refZoom. The position = a pixel in it (cx, cy),
 *   and the zoom is fractional. The screen scale s = k . 2^(zoom - refZoom):
 *       screen = (px - c) . s + the centre of the screen
 *   And the game <-> the pixel through Projection.
 *
 *   k = wsScale() (the console's screen scale: 1 at 1080p, 2 at 4K, 4 at 8K, the height on an ultrawide),
 *   so one zoom shows the same piece of the map on every screen, as the CSS around it does. The tile
 *   level follows the real pixels (zoom + log2 k, at most one level finer: tiles as sharp as at 4K), so a
 *   big screen is not drawn from blurred tiles nor asks for 16x the tiles at 8K.
 * ════════════════════════════════════════════════════════════════════════════ */

import { Projection, type ProjectionCfg } from './coords';
import { TileCache } from './tiles';
import { wsScale } from '../../wsScale';

const TILE_DEFAULT = 512;

/** The tile set the engine draws: a URL template with {z}/{x}/{y} and the zoom bounds. */
export interface EngineTiles {
  base: string;
  size?: number;
  minZoom: number;
  maxZoom: number;
  /** The furthest zoom allowed - anything past maxZoom magnifies the last level */
  maxView?: number;
  theme?: string;
}

/** A marker above the paper - one player. */
export interface Marker {
  kind?: 'player' | 'place' | 'label';
  minZoom?: number;
  key: string;
  id: number;
  x: number;
  y: number;
  /** The tooltip's text */
  name: string;
  /** Extra classes on the marker element (is-self / is-selected / is-dead ...) */
  cls: string;
  /** Sorting priority: higher is drawn above (z-index) */
  z?: number;
}

export interface EngineEvents {
  onHover(marker: Marker | null): void;
  onClick(world: [number, number], marker: Marker | null, button: number, screen: { x: number; y: number }): void;
  /** After every drawn frame - for anything else that must stick to the paper. */
  onView?(): void;
}

interface Node {
  m: Marker;
  el: HTMLDivElement;
  tip: HTMLSpanElement;
  sx: number;
  sy: number;
}

export interface Anchor { el: HTMLElement; x: number; y: number }

/** What the canvas is cleared with under the tiles, by w_map's theme name, so nothing flashes while a
 *  tile is loading. The console's palette: the dark sets clear to ink (#0A0A0A), bone to paper (#F2F2F2).
 *  'light' (the parchment 'clean' set, the default) keeps the parchment's own tone: it stands in for the
 *  map image (content) only where a tile has not arrived yet, it is never paint of its own. */
const PAPER: Record<string, string> = {
  light: '#d3b790', dark: '#0A0A0A', ember: '#0A0A0A', blueprint: '#0A0A0A', bone: '#F2F2F2',
};
export function paperOf(theme: string | undefined | null): string {
  return PAPER[String(theme || 'light')] ?? PAPER.light;
}

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export class MapEngine {
  private tilesBase: string;
  readonly proj: Projection;

  private readonly host: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly layer: HTMLDivElement;
  private readonly cache: TileCache;

  private W = 1;
  private H = 1;
  /** The screen scale (wsScale) and the tile-level shift it gives (log2, capped at 1). */
  private k = 1;
  private lk = 0;

  private cx: number;
  private cy: number;
  private zoom: number;
  private zoomTarget: number;
  private anchor: { x: number; y: number } | null = null;
  private fly: { fx: number; fy: number; tx: number; ty: number; fz: number; tz: number; t0: number; dur: number } | null = null;

  private readonly tile: number;
  private readonly tileMin: number;
  private readonly tileMax: number;
  private readonly viewMax: number;
  private paper: string;

  private readonly nodes = new Map<string, Node>();
  private readonly anchors = new Set<Anchor>();
  private hovered: string | null = null;

  private readonly panKeys = new Set<string>();
  private raf = 0;
  private dirty = true;
  private destroyed = false;
  private moving = false;
  private suspended = false;
  private rect: { left: number; top: number } | null = null;
  private down: { x: number; y: number; cx: number; cy: number; button: number; target: Marker | null; moved: boolean } | null = null;
  private pointerId: number | null = null;
  private pending: { gx: number; gy: number; zoom?: number } | null = null;
  private tileZ: number | null = null;
  private sizeAt = 0;
  private readonly ro: ResizeObserver;

  constructor(
    host: HTMLElement,
    tiles: EngineTiles,
    proj: ProjectionCfg,
    private readonly events: EngineEvents,
  ) {
    this.host = host;
    this.tilesBase = tiles.base;
    this.proj = new Projection(proj);

    this.tile = tiles.size ?? TILE_DEFAULT;
    this.tileMin = tiles.minZoom;
    this.tileMax = tiles.maxZoom;
    this.viewMax = tiles.maxView ?? tiles.maxZoom;
    this.paper = paperOf(tiles.theme);

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'wa-map-tiles';
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;

    this.layer = document.createElement('div');
    this.layer.className = 'wa-map-layer';

    host.appendChild(this.canvas);
    host.appendChild(this.layer);

    const [iw, ih] = this.proj.cfg.image;
    this.cx = iw / 2;
    this.cy = ih / 2;
    this.zoom = tiles.minZoom;
    this.zoomTarget = this.zoom;

    /* ! The cache's capacity follows the tile size: decoded 512x512 tiles weigh about a megabyte each
       in CEF's memory, and the admin page shares the process with the rest of the console. */
    const cap = this.tile >= 512 ? 190 : 700;
    this.cache = new TileCache(MapEngine.urlOf(tiles.base), () => this.invalidate(), cap);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();

    this.bind();
    this.loop();
  }

  private static urlOf(base: string): (z: number, x: number, y: number) => string {
    return (z, x, y) => base.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  }

  /** A theme switch: another tile set and another paper colour, the view stays where it is. */
  setTiles(base: string, theme?: string): void {
    this.tilesBase = base;
    this.cache.rebase(MapEngine.urlOf(base));
    this.paper = paperOf(theme);
    this.tileZ = null;
    this.invalidate();
  }

  /* ── The size and the scale ──────────────────────────────────────────── */

  hasSize(): boolean {
    return this.W > 8 && this.H > 8;
  }

  resize(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    /* A hidden tab has a zero-size container; keep the last real size so centring still works. */
    if (w <= 0 || h <= 0) return;
    if (w === this.W && h === this.H && this.canvas.width === w) return;

    /* NUI is already drawn at the game's resolution: no devicePixelRatio doubling. */
    this.W = w;
    this.H = h;
    this.k = wsScale();
    this.lk = clamp(Math.log2(this.k), 0, 1);
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;

    this.zoomTarget = clamp(this.zoomTarget, this.minZoom(), this.viewMax);
    this.zoom = clamp(this.zoom, this.minZoom(), this.viewMax);
    this.clampCentre();
    this.rect = null;

    this.drainPending();
    this.invalidate();
  }

  private drainPending(): boolean {
    if (!this.pending || !this.hasSize()) return false;
    const p = this.pending;
    this.pending = null;
    this.centreOn(p.gx, p.gy, p.zoom, false);
    return true;
  }

  private scaleAt(zoom: number): number {
    return this.k * Math.pow(2, zoom - this.proj.cfg.refZoom);
  }

  /** The lowest zoom at which the paper covers the whole view - never any bare edges. */
  minZoom(): number {
    const [iw, ih] = this.proj.cfg.image;
    const cover = this.proj.cfg.refZoom + Math.log2(Math.max((this.W + 2) / iw, (this.H + 2) / ih) / this.k);
    return clamp(Math.max(cover, this.tileMin - 1), this.tileMin - 1, this.viewMax);
  }

  maxZoom(): number { return this.viewMax; }

  private clampCentre(): void {
    const [iw, ih] = this.proj.cfg.image;
    const s = this.scaleAt(this.zoom);
    const hw = this.W / (2 * s);
    const hh = this.H / (2 * s);
    this.cx = iw <= 2 * hw ? iw / 2 : clamp(this.cx, hw, iw - hw);
    this.cy = ih <= 2 * hh ? ih / 2 : clamp(this.cy, hh, ih - hh);
  }

  /* ── The transforms ────────────────────────────────────────────────────── */

  mapToScreen(px: number, py: number): [number, number] {
    const s = this.scaleAt(this.zoom);
    return [(px - this.cx) * s + this.W / 2, (py - this.cy) * s + this.H / 2];
  }

  screenToMap(sx: number, sy: number): [number, number] {
    const s = this.scaleAt(this.zoom);
    return [(sx - this.W / 2) / s + this.cx, (sy - this.H / 2) / s + this.cy];
  }

  gameToScreen(gx: number, gy: number): [number, number] {
    const [px, py] = this.proj.toPixel(gx, gy);
    return this.mapToScreen(px, py);
  }

  screenToGame(sx: number, sy: number): [number, number] {
    const [px, py] = this.screenToMap(sx, sy);
    return this.proj.toGame(px, py);
  }

  getZoom(): number { return this.zoom; }
  viewWidth(): number { return this.W; }
  viewHeight(): number { return this.H; }

  /* ── The motion ────────────────────────────────────────────────────────── */

  centreOn(gx: number, gy: number, zoom?: number, animate = true): void {
    if (!isFinite(gx) || !isFinite(gy)) return;
    if (!this.hasSize()) { this.pending = { gx, gy, zoom }; return; }
    const [px, py] = this.proj.toPixel(gx, gy);
    const tz = zoom === undefined ? this.zoomTarget : clamp(zoom, this.minZoom(), this.viewMax);

    if (!animate) {
      this.cx = px; this.cy = py; this.zoom = tz; this.zoomTarget = tz;
      this.fly = null; this.anchor = null;
      this.clampCentre();
      this.invalidate();
      return;
    }

    this.fly = { fx: this.cx, fy: this.cy, tx: px, ty: py, fz: this.zoom, tz, t0: performance.now(), dur: 420 };
    this.prefetchAt(px, py, tz);
    this.zoomTarget = tz;
    this.anchor = null;
    this.invalidate();
  }

  /** The whole paper in the view - the 'fit' button and the first frame. */
  fitAll(animate = false): void {
    const [iw, ih] = this.proj.cfg.image;
    const [gx, gy] = this.proj.toGame(iw / 2, ih / 2);
    this.centreOn(gx, gy, this.minZoom(), animate);
  }

  /** Ask for the tiles of a view we have not reached yet, so they arrive before the motion ends. */
  private prefetchAt(px: number, py: number, zoom: number): void {
    const tz = clamp(Math.round(zoom + this.lk), this.tileMin, this.tileMax);
    const s = this.scaleAt(zoom);
    const tileMap = this.tile * Math.pow(2, this.proj.cfg.refZoom - tz);
    const [iw, ih] = this.proj.cfg.image;
    const hw = this.W / (2 * s), hh = this.H / (2 * s);
    const x0 = Math.max(0, Math.floor((px - hw) / tileMap));
    const x1 = Math.min(Math.ceil(iw / tileMap) - 1, Math.floor((px + hw) / tileMap));
    const y0 = Math.max(0, Math.floor((py - hh) / tileMap));
    const y1 = Math.min(Math.ceil(ih / tileMap) - 1, Math.floor((py + hh) / tileMap));
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) this.cache.prefetch(tz, tx, ty);
    }
  }

  zoomBy(delta: number, around?: { x: number; y: number }): void {
    this.zoomTarget = clamp(this.zoomTarget + delta, this.minZoom(), this.viewMax);
    this.anchor = around ?? { x: this.W / 2, y: this.H / 2 };
    this.fly = null;
    if (this.hasSize()) this.prefetchAt(this.cx, this.cy, this.zoomTarget);
    this.invalidate();
  }

  panBy(dx: number, dy: number): void {
    const s = this.scaleAt(this.zoom);
    this.cx -= dx / s;
    this.cy -= dy / s;
    this.fly = null;
    this.clampCentre();
    this.invalidate();
  }

  setPanKey(dir: 'up' | 'down' | 'left' | 'right', pressed: boolean): void {
    if (pressed) this.panKeys.add(dir); else this.panKeys.delete(dir);
    this.invalidate();
  }

  /** Clearing every stuck input: the page loses NUI focus with no pointerup, so a drag would go on forever. */
  resetInput(): void {
    this.releasePointer();
    this.down = null;
    this.panKeys.clear();
    this.fly = null;
    this.anchor = null;
    this.zoomTarget = this.zoom;
    this.host.classList.remove('is-dragging');
  }

  private releasePointer(): void {
    const id = this.pointerId;
    this.pointerId = null;
    if (id !== null) {
      try { this.host.releasePointerCapture(id); } catch { /* Capture may already be lost. */ }
    }
  }

  private onLostFocus = (): void => { this.resetInput(); };
  private onHidden = (): void => { if (document.visibilityState === 'hidden') this.resetInput(); };

  /* ── The markers ───────────────────────────────────────────────────────── */

  setMarkers(list: Marker[]): void {
    const seen = new Set<string>();
    for (const m of list) {
      seen.add(m.key);
      const node = this.nodes.get(m.key);
      if (node) this.updateNode(node, m); else this.createNode(m);
    }
    for (const [key, node] of this.nodes) {
      if (!seen.has(key)) {
        node.el.remove();
        this.nodes.delete(key);
        if (this.hovered === key) { this.hovered = null; this.events.onHover(null); }
      }
    }
    this.invalidate();
  }

  getMarker(key: string): Marker | undefined {
    return this.nodes.get(key)?.m;
  }

  private createNode(m: Marker): void {
    const el = document.createElement('div');
    el.className = `wa-mk ${m.cls}`.trim();
    el.dataset.key = m.key;

    const inner = document.createElement('div');
    inner.className = 'wa-mk-inner';
    const dot = document.createElement('i');
    dot.className = 'wa-mk-dot';
    inner.appendChild(dot);
    el.appendChild(inner);

    const tip = document.createElement('span');
    tip.className = 'wa-mk-tip';
    tip.textContent = m.name;
    el.appendChild(tip);

    const node: Node = { m, el, tip, sx: NaN, sy: NaN };
    this.nodes.set(m.key, node);
    this.layer.appendChild(el);
    if (m.z !== undefined) el.style.zIndex = String(m.z);
    if (this.hovered === m.key) el.classList.add('is-hover');
  }

  private updateNode(node: Node, m: Marker): void {
    const prev = node.m;
    node.m = m;
    if (prev.cls !== m.cls) {
      node.el.className = `wa-mk ${m.cls}`.trim() + (this.hovered === m.key ? ' is-hover' : '');
    }
    if (prev.name !== m.name) node.tip.textContent = m.name;
    if (prev.z !== m.z) node.el.style.zIndex = m.z === undefined ? '' : String(m.z);
    if (prev.x !== m.x || prev.y !== m.y) { node.sx = NaN; node.sy = NaN; }
  }

  /* ── Anchored elements (the action card) ───────────────────────────────── */

  /** Keep an element of the host glued to a game point; it is placed after every frame. */
  addAnchor(el: HTMLElement, x: number, y: number): Anchor {
    const a: Anchor = { el, x, y };
    this.anchors.add(a);
    this.placeAnchor(a);
    return a;
  }

  removeAnchor(a: Anchor): void {
    this.anchors.delete(a);
  }

  private placeAnchor(a: Anchor): void {
    const [sx, sy] = this.gameToScreen(a.x, a.y);
    a.el.style.transform = `translate3d(${Math.round(sx)}px, ${Math.round(sy)}px, 0)`;
  }

  /* ── The input ────────────────────────────────────────────────────────── */

  private bind(): void {
    const host = this.host;
    host.addEventListener('pointerdown', this.onPointerDown);
    host.addEventListener('pointermove', this.onPointerMove);
    host.addEventListener('pointerup', this.onPointerUp);
    host.addEventListener('pointercancel', this.onPointerCancel);
    host.addEventListener('lostpointercapture', this.onPointerCancel);
    host.addEventListener('wheel', this.onWheel, { passive: false });
    host.addEventListener('contextmenu', this.onContext);
    this.layer.addEventListener('pointerover', this.onOver);
    this.layer.addEventListener('pointerout', this.onOut);
    window.addEventListener('blur', this.onLostFocus);
    document.addEventListener('visibilitychange', this.onHidden);
  }

  private onContext = (ev: Event): void => { ev.preventDefault(); };

  private markerAt(target: EventTarget | null): Marker | null {
    const el = (target as HTMLElement | null)?.closest?.('.wa-mk') as HTMLElement | null;
    const key = el?.dataset.key;
    return key ? this.nodes.get(key)?.m ?? null : null;
  }

  /** The container's rectangle, stored: getBoundingClientRect flushes the layout on every move otherwise. */
  private local(ev: PointerEvent | WheelEvent): { x: number; y: number } {
    let r = this.rect;
    if (!r) {
      const b = this.host.getBoundingClientRect();
      r = this.rect = { left: b.left, top: b.top };
    }
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  private onPointerDown = (ev: PointerEvent): void => {
    if ((ev.button !== 0 && ev.button !== 2) || this.pointerId !== null) return;
    /* Clicks on the controls and the card that sit inside the host are theirs, not the paper's. */
    if ((ev.target as HTMLElement | null)?.closest?.('.wa-map-ui')) return;
    const p = this.local(ev);
    this.pointerId = ev.pointerId;
    try { this.host.setPointerCapture(ev.pointerId); } catch { /* Synthetic/ended pointer. */ }
    this.fly = null;
    this.anchor = null;
    this.zoomTarget = this.zoom;
    this.panKeys.clear();
    this.down = { x: p.x, y: p.y, cx: this.cx, cy: this.cy, button: ev.button, target: this.markerAt(ev.target), moved: false };
  };

  private onPointerMove = (ev: PointerEvent): void => {
    if (this.pointerId !== null && ev.pointerId !== this.pointerId) return;
    if (!this.down || this.down.button !== 0) return;
    const p = this.local(ev);
    const dx = p.x - this.down.x;
    const dy = p.y - this.down.y;
    if (this.down.moved || Math.hypot(dx, dy) > 4 * this.k) {
      this.down.moved = true;
      const s = this.scaleAt(this.zoom);
      this.cx = this.down.cx - dx / s;
      this.cy = this.down.cy - dy / s;
      this.clampCentre();
      this.host.classList.add('is-dragging');
      this.invalidate();
    }
  };

  private onPointerUp = (ev: PointerEvent): void => {
    if (ev.pointerId !== this.pointerId) return;
    this.releasePointer();
    this.host.classList.remove('is-dragging');
    const d = this.down;
    this.down = null;
    if (!d) return;
    if (!d.moved) {
      const p = this.local(ev);
      this.events.onClick(this.screenToGame(p.x, p.y), d.target ?? this.markerAt(ev.target), d.button, p);
    }
  };

  private onPointerCancel = (ev: PointerEvent): void => {
    if (ev.pointerId === this.pointerId) this.resetInput();
  };

  private onWheel = (ev: WheelEvent): void => {
    ev.preventDefault();
    const step = ev.deltaY < 0 ? 0.5 : -0.5;
    this.zoomBy(step, this.local(ev));
  };

  private onOver = (ev: PointerEvent): void => {
    const m = this.markerAt(ev.target);
    if (!m || m.key === this.hovered) return;
    this.setHover(m.key);
  };

  private onOut = (ev: PointerEvent): void => {
    const m = this.markerAt(ev.target);
    if (!m || m.key !== this.hovered) return;
    const next = this.markerAt(ev.relatedTarget);
    if (next && next.key === m.key) return;
    this.setHover(null);
  };

  private setHover(key: string | null): void {
    if (this.hovered) this.nodes.get(this.hovered)?.el.classList.remove('is-hover');
    this.hovered = key;
    if (key) this.nodes.get(key)?.el.classList.add('is-hover');
    this.events.onHover(key ? this.nodes.get(key)?.m ?? null : null);
  }

  /* ── The drawing ──────────────────────────────────────────────────────── */

  invalidate(): void {
    this.dirty = true;
    this.wake();
  }

  /** A frame on demand and not a permanent frame: it runs only while there is something to draw. */
  private loop = (): void => {
    this.raf = 0;
    if (this.destroyed || this.suspended) return;
    this.step(performance.now());
    if (this.dirty || this.moving || this.fly || this.panKeys.size ||
        Math.abs(this.zoomTarget - this.zoom) > 0.0005 || this.pending) {
      this.raf = requestAnimationFrame(this.loop);
    }
  };

  private wake(): void {
    if (this.raf || this.destroyed || this.suspended) return;
    this.raf = requestAnimationFrame(this.loop);
  }

  /** The tab is hidden: no frame and no layout and no drawing. */
  suspend(): void {
    this.suspended = true;
    this.resetInput();
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
  }

  resume(): void {
    if (!this.suspended) return;
    this.suspended = false;
    this.rect = null;
    this.sizeAt = 0;
    this.invalidate();
  }

  private step(now: number): void {
    let moving = false;

    /* ResizeObserver alone is not relied on: a container shown after being display:none may
       never notify. Four readings a second are a cheap safety net. */
    if (now - this.sizeAt > 250) {
      this.sizeAt = now;
      if (this.host.clientWidth !== this.W || this.host.clientHeight !== this.H) {
        if (this.host.clientWidth > 0 && this.host.clientHeight > 0) this.resize();
      }
    }

    if (this.pending && this.drainPending()) moving = true;

    if (this.fly) {
      const f = this.fly;
      const t = clamp((now - f.t0) / f.dur, 0, 1);
      const k = easeOut(t);
      this.cx = f.fx + (f.tx - f.fx) * k;
      this.cy = f.fy + (f.ty - f.fy) * k;
      this.zoom = f.fz + (f.tz - f.fz) * k;
      if (t >= 1) { this.fly = null; this.zoom = f.tz; }
      this.clampCentre();
      moving = true;
    } else if (Math.abs(this.zoomTarget - this.zoom) > 0.0005) {
      const a = this.anchor ?? { x: this.W / 2, y: this.H / 2 };
      const [mx, my] = this.screenToMap(a.x, a.y);
      const next = this.zoom + (this.zoomTarget - this.zoom) * 0.26;
      this.zoom = Math.abs(this.zoomTarget - next) < 0.002 ? this.zoomTarget : next;
      const s = this.scaleAt(this.zoom);
      this.cx = mx - (a.x - this.W / 2) / s;
      this.cy = my - (a.y - this.H / 2) / s;
      this.clampCentre();
      moving = true;
    }

    if (this.panKeys.size) {
      const v = 14 * this.k;
      let dx = 0, dy = 0;
      if (this.panKeys.has('left')) dx += v;
      if (this.panKeys.has('right')) dx -= v;
      if (this.panKeys.has('up')) dy += v;
      if (this.panKeys.has('down')) dy -= v;
      const s = this.scaleAt(this.zoom);
      this.cx -= dx / s;
      this.cy -= dy / s;
      this.clampCentre();
      moving = true;
    }

    this.moving = moving;
    if (this.dirty || moving) {
      this.dirty = false;
      this.render();
    }
  }

  private render(): void {
    const ctx = this.ctx;
    this.cache.tick();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.paper;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.paintTiles(ctx, this.W, this.H, this.cx, this.cy, this.zoom);
    this.placeNodes();
    for (const a of this.anchors) this.placeAnchor(a);
    this.events.onView?.();
  }

  private paintTiles(ctx: CanvasRenderingContext2D, W: number, H: number, cx: number, cy: number, zoom: number): void {
    const s = this.scaleAt(zoom);
    const [iw, ih] = this.proj.cfg.image;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';

    /* The tile level: the nearest to the current zoom among what we actually have. During a flight
       we stay coarse (the destination is prefetched), and during a wheel motion we hold the level
       the view settled on - one level of stretch at most - so the decode never lands mid-motion. */
    const cap = this.fly ? Math.min(this.tileMax, this.tileMin + 3) : this.tileMax;
    let tz = clamp(Math.round(zoom + this.lk), this.tileMin, cap);
    const rest = !this.fly && Math.abs(this.zoomTarget - this.zoom) < 0.002;
    if (rest) this.tileZ = tz;
    else if (this.tileZ !== null && Math.abs(tz - this.tileZ) <= 1) tz = this.tileZ;

    const tileMap = this.tile * Math.pow(2, this.proj.cfg.refZoom - tz);
    const tileScreen = tileMap * s;

    const toScreen = (px: number, py: number): [number, number] => [(px - cx) * s + W / 2, (py - cy) * s + H / 2];
    const toMap = (sx: number, sy: number): [number, number] => [(sx - W / 2) / s + cx, (sy - H / 2) / s + cy];

    const [mx0, my0] = toMap(0, 0);
    const [mx1, my1] = toMap(W, H);
    const tilesX = Math.ceil(iw / tileMap);
    const tilesY = Math.ceil(ih / tileMap);

    const x0 = Math.max(0, Math.floor(mx0 / tileMap));
    const y0 = Math.max(0, Math.floor(my0 / tileMap));
    const x1 = Math.min(tilesX - 1, Math.floor(mx1 / tileMap));
    const y1 = Math.min(tilesY - 1, Math.floor(my1 / tileMap));

    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const [sx, sy] = toScreen(tx * tileMap, ty * tileMap);
        /* Whole positions in real pixels: the tile ends exactly where its neighbour begins */
        const dx = Math.round(sx);
        const dy = Math.round(sy);
        const dw = Math.round(sx + tileScreen) - dx;
        const dh = Math.round(sy + tileScreen) - dy;
        this.drawTile(ctx, tz, tx, ty, dx, dy, dw, dh);
      }
    }
  }

  private drawTile(ctx: CanvasRenderingContext2D, z: number, x: number, y: number, dx: number, dy: number, dw: number, dh: number): void {
    if (this.tilesBase === 'grid:') {
      ctx.strokeStyle = '#303030'; ctx.lineWidth = Math.max(1, Math.round(this.k));
      ctx.strokeRect(dx, dy, dw, dh);
      return;
    }
    const img = this.cache.get(z, x, y);
    if (img) {
      ctx.drawImage(img, 0, 0, img.naturalWidth || this.tile, img.naturalHeight || this.tile, dx, dy, dw, dh);
      return;
    }
    /* Until it arrives: a quarter of the parent tile magnified, then the grandparent - clearer than bare paper */
    for (let up = 1; up <= 3; up++) {
      const pz = z - up;
      if (pz < this.tileMin) break;
      const px = x >> up;
      const py = y >> up;
      const pimg = this.cache.get(pz, px, py);
      if (!pimg) continue;
      const nat = pimg.naturalWidth || this.tile;
      const part = nat / Math.pow(2, up);
      const ox = (x - (px << up)) * part;
      const oy = (y - (py << up)) * part;
      ctx.drawImage(pimg, ox, oy, part, part, dx, dy, dw, dh);
      return;
    }
  }

  private placeNodes(): void {
    const margin = 80 * this.k;
    const s = this.scaleAt(this.zoom);
    const ox = this.W / 2 - this.cx * s;
    const oy = this.H / 2 - this.cy * s;

    for (const node of this.nodes.values()) {
      const [px, py] = this.proj.toPixel(node.m.x, node.m.y);
      const sx = px * s + ox;
      const sy = py * s + oy;

      const visible = this.zoom >= (node.m.minZoom ?? 0) && sx > -margin && sy > -margin && sx < this.W + margin && sy < this.H + margin;
      if (!visible) {
        if (node.el.style.display !== 'none') node.el.style.display = 'none';
        continue;
      }
      if (node.el.style.display === 'none') node.el.style.display = '';

      const rx = Math.round(sx * 10) / 10;
      const ry = Math.round(sy * 10) / 10;
      if (rx === node.sx && ry === node.sy) continue;
      node.sx = rx;
      node.sy = ry;
      node.el.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.resetInput();
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.host.removeEventListener('pointerdown', this.onPointerDown);
    this.host.removeEventListener('pointermove', this.onPointerMove);
    this.host.removeEventListener('pointerup', this.onPointerUp);
    this.host.removeEventListener('pointercancel', this.onPointerCancel);
    this.host.removeEventListener('lostpointercapture', this.onPointerCancel);
    this.host.removeEventListener('wheel', this.onWheel);
    this.host.removeEventListener('contextmenu', this.onContext);
    this.layer.removeEventListener('pointerover', this.onOver);
    this.layer.removeEventListener('pointerout', this.onOut);
    window.removeEventListener('blur', this.onLostFocus);
    document.removeEventListener('visibilitychange', this.onHidden);
    this.cache.clear();
    this.canvas.remove();
    this.layer.remove();
    this.nodes.clear();
    this.anchors.clear();
  }
}
