/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · map/engine/tiles.ts  (the admin copy of w_map's engine/tiles.ts)
 * The tile cache: it loads on demand, remembers, and throws out the oldest when it fills up.
 *
 * * An image is requested once however many times it is asked for in the same frame, and a failed tile
 *   (off the paper) is recorded so it is never requested again nor fills the console with errors.
 * * Tiles come from nui://w_map/web/tiles/<set>/<z>/<x>/<y>.webp - w_map's manifest exposes them, so
 *   the admin page needs no copy of the pyramid.
 * ════════════════════════════════════════════════════════════════════════════ */

export interface TileEntry {
  img: HTMLImageElement;
  loaded: boolean;
  failed: boolean;
  lastUsed: number;
}

export class TileCache {
  private readonly entries = new Map<string, TileEntry>();
  private frame = 0;

  constructor(
    private urlOf: (z: number, x: number, y: number) => string,
    private readonly onLoad: () => void,
    private readonly capacity = 190,
  ) {}

  /** Called once at the start of every drawing frame. */
  tick(): void {
    this.frame += 1;
    if (this.entries.size > this.capacity) this.evict();
  }

  /** Every tile is emptied - on a theme switch, otherwise the previous colour set stays. */
  clear(): void {
    for (const e of this.entries.values()) {
      e.img.onload = null;
      e.img.onerror = null;
    }
    this.entries.clear();
  }

  /** Swap the URL pattern (a theme change) and drop what was cached from the old set. */
  rebase(urlOf: (z: number, x: number, y: number) => string): void {
    this.urlOf = urlOf;
    this.clear();
  }

  /** The image if it is ready, otherwise it is requested and null is returned. */
  get(z: number, x: number, y: number): HTMLImageElement | null {
    const key = `${z}/${x}/${y}`;
    let e = this.entries.get(key);

    if (!e) {
      if (this.urlOf(z, x, y) === 'grid:') return null;
      const img = new Image();
      img.decoding = 'async';
      e = { img, loaded: false, failed: false, lastUsed: this.frame };
      this.entries.set(key, e);

      /* * The image is decoded before it is counted ready: onload means 'the bytes arrived', and the
         first drawImage would otherwise decode a 512x512 WebP on the main thread mid-frame. */
      const entry = e;
      const ready = () => { if (!entry.failed) { entry.loaded = true; this.onLoad(); } };
      img.onload = () => {
        const d = (img as HTMLImageElement & { decode?: () => Promise<void> }).decode;
        if (typeof d === 'function') d.call(img).then(ready, ready); else ready();
      };
      img.onerror = () => { entry.failed = true; };
      img.src = this.urlOf(z, x, y);
    }

    e.lastUsed = this.frame;
    return e.loaded ? e.img : null;
  }

  /** Ask for it now and do not wait for it - for preloading before the motion reaches its destination. */
  prefetch(z: number, x: number, y: number): void {
    this.get(z, x, y);
  }

  private evict(): void {
    const rows = Array.from(this.entries.entries())
      .filter(([, e]) => e.lastUsed < this.frame - 1)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);

    const drop = Math.max(0, this.entries.size - Math.floor(this.capacity * 0.75));
    for (let i = 0; i < drop && i < rows.length; i++) {
      const [key, e] = rows[i];
      e.img.onload = null;
      e.img.onerror = null;
      e.img.src = '';
      this.entries.delete(key);
    }
  }
}
