/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · styles/fonts.ts
 * The @font-face rules are injected from JS, not written in CSS: their URLs must be relative to the
 * built page (nui://w_admin/web/build/) and Vite writes absolute CSS URLs that break under nui://.
 * Lalezar and Aref Ruqaa come from w_loading/html/fonts (SIL OFL 1.1, licences in public/fonts).
 * ════════════════════════════════════════════════════════════════════════════ */

const AR = 'U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200F,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FEFF,U+0660-0669';
const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2190-2199,U+2212,U+25A0-25FF';

export function injectFonts(): void {
  try {
    const base = new URL('./', window.location.href).href;
    const F = `${base}fonts/`;
    // one Arabic face server-wide (owner, 2026-10-22): the Arabic faces of the role names (Amiri, Tajawal,
    // Noto Sans Arabic, Aref Ruqaa) draw Lalezar's file at their own weights, so every stack keeps working.
    const style = document.createElement('style');
    style.setAttribute('data-w-admin-fonts', '');
    style.textContent = `
      @font-face { font-family: "RDR Lino"; src: url("${F}RDRLino-Regular.woff2") format("woff2"); font-display: swap; }
      @font-face { font-family: "Hapna Slab"; src: url("${F}HapnaSlabSerif-DemiBold.woff2") format("woff2"); font-display: swap; }
      @font-face { font-family: "RDR Catalogue"; src: url("${F}RDRCatalogueBold-Bold.woff2") format("woff2"); font-display: swap; }
      @font-face { font-family: "Noto Sans Arabic"; src: url("${F}Lalezar-400-arabic.woff2") format("woff2"); font-weight: 100 900; font-display: swap; }
      @font-face { font-family: "Tajawal"; font-weight: 400; src: url("${F}Lalezar-400-arabic.woff2") format("woff2"); unicode-range: ${AR}; font-display: swap; }
      @font-face { font-family: "Tajawal"; font-weight: 700; src: url("${F}Lalezar-400-arabic.woff2") format("woff2"); unicode-range: ${AR}; font-display: swap; }
      @font-face { font-family: "Tajawal"; font-weight: 400; src: url("${F}tajawal-latin-400-normal.woff2") format("woff2"); unicode-range: ${LATIN}; font-display: swap; }
      @font-face { font-family: "Tajawal"; font-weight: 700; src: url("${F}tajawal-latin-700-normal.woff2") format("woff2"); unicode-range: ${LATIN}; font-display: swap; }
      @font-face { font-family: "Lalezar"; font-weight: 400; src: url("${F}Lalezar-400-arabic.woff2") format("woff2"); unicode-range: ${AR}; font-display: swap; }
      @font-face { font-family: "Aref Ruqaa"; font-weight: 400; src: url("${F}Lalezar-400-arabic.woff2") format("woff2"); unicode-range: ${AR}; font-display: swap; }
    `;
    document.head.appendChild(style);
  } catch {
    /* the fallback font is enough: never drop the console for a font */
  }
}

/**
 * 2.3.0 The textures of the board look (the torn edge, the paper grain, the brushed bands), as ABSOLUTE urls on
 * <html>. The theme's tokens.css writes them as './tex/…' inside custom properties, and Chromium resolves such a
 * url against the page that uses it (web/build/tex/…, which does not exist), so the bands and the torn edges
 * never drew. The w_housing / w_pets boards set them the same way from main.tsx.
 */
export function injectTextures(): void {
  try {
    const tex = `${new URL('./', window.location.href).href}theme/tex/`;
    const root = document.documentElement.style;
    root.setProperty('--tex-tear', `url("${tex}tear.png")`);
    root.setProperty('--tex-grain', `url("${tex}grain.png")`);
    root.setProperty('--tex-band', `url("${tex}selection_box_bg_1a.png")`);
    root.setProperty('--tex-band-sm', `url("${tex}selection_box_bg_1c.png")`);
  } catch {
    /* without them the bands are plain paper bars and the cards square: still usable */
  }
}
