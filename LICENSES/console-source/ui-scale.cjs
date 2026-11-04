/* ============================================================================
   ui-scale -- one screen scale for every Wraith interface (720p .. 8K, 16:10 .. 32:9).

   Interfaces are drawn at 1920x1080. At build time every `Npx` in the CSS becomes a
   multiple of one variable, so the whole page grows and shrinks with the screen:

     --ws-px  : 1px at 1080p. = min(height / 1080, width / 1920)
                720p 0.667 · 1440p 1.333 · 4K 2 · 8K 4. On an ultrawide (21:9, 32:9) the
                HEIGHT decides, so the page is as tall as on a 16:9 screen of that height and
                the extra width stays free (edge-pinned parts stay at the edges, centred
                boards stay centred, nothing is stretched).
     --ws-fpx : the same for font-size, never below 0.8 (Arabic text stays readable at 720p).
     --ws-gutter : on a screen wider than 16:9, the empty band left and right of a centred 16:9
                frame. Menus and boards that sit at an edge add it (`calc(2rem + var(--ws-gutter))`)
                so on 32:9 they stay in front of the player; the HUD stays at the real edges.

   Width / height media queries: the page is always at least 1920x1080 "design px" wide/tall,
   so `(max-width: 1500px)` is rewritten to the aspect ratio that gives that design width
   (`(max-aspect-ratio: 1500/1080)`), and `(max-height: Npx)` below 1080 never matches.

   Hairlines (0 < |N| <= 2px) never drop below their 1080p size, so a border never vanishes.
   @media / @supports / @container conditions are left alone (they are not drawn lengths).

   Used three ways (keep this file identical in every resource -- master copy:
   ops/local/ui-scale/ui-scale.cjs):
     1. PostCSS plugin  -- web/postcss.config.cjs: `module.exports = { plugins: [require('./ui-scale.cjs')()] }`
     2. stylis plugin   -- Mantine/emotion runtime styles: `stylisPlugins: [uiScale.stylis]`
     3. node ui-scale.cjs --rewrite <file.css ...> -- plain HTML pages with no build step
        (rewrites the files in place, once; files already converted are skipped).
   RedM's browser is Chromium 103: only calc/min/max/var are used (no typed arithmetic, no zoom).
   ============================================================================ */
'use strict';

const ROOT_VARS =
  ':root{--ws-px:max(.6667px,min(.0925926vh,.0520833vw));' +
  '--ws-fpx:max(.8px,min(.0925926vh,.0520833vw));' +
  '--ws-gutter:max(0px,calc((100vw - 177.7778vh) / 2))}';
const MARK = '/* ui-scale */';

const PX = /(^|[^\w.#-])(-?\d*\.?\d+)px\b/g;

function fmt(n) {
  return String(+n.toFixed(4));
}

/** One CSS value with its px lengths scaled. `font` = the property is font-size / font. */
function scaleValue(value, font) {
  // already converted (has a scaled unit) -> leave it; var(--ws-gutter) alone does not count
  if (!value || value.indexOf('px') < 0 || /var\(--ws-f?px\)/.test(value)) return value;
  // url(...) and quoted strings are kept as they are.
  const keep = [];
  const masked = value.replace(/url\([^)]*\)|"[^"]*"|'[^']*'/g, (m) => {
    keep.push(m);
    return `\u0000${keep.length - 1}\u0000`;
  });
  const unit = font ? 'var(--ws-fpx)' : 'var(--ws-px)';
  const out = masked.replace(PX, (all, pre, num) => {
    const n = parseFloat(num);
    if (!n) return all;
    const scaled = `calc(${fmt(n)} * ${unit})`;
    if (Math.abs(n) <= 2) return `${pre}${n > 0 ? 'max' : 'min'}(${fmt(n)}px, ${scaled})`;
    return `${pre}${scaled}`;
  });
  return out.replace(/\u0000(\d+)\u0000/g, (m, i) => keep[+i]);
}

/** Media conditions in design px. The page is always >= 1920 design px wide (a screen narrower than
 *  16:9 is limited by its width -> exactly 1920; a wider one is 1080 * aspect). So a width below 1920 is
 *  always / never met, and only a width above 1920 depends on the aspect ratio. Heights: always >= 1080. */
function scaleMedia(params) {
  return params
    .replace(/\((max|min)-width\s*:\s*(\d*\.?\d+)px\s*\)/g, (m, kind, n) => {
      const w = Math.round(+n);
      if (w < 1920) return kind === 'max' ? '(max-width: 0px)' : '(min-width: 0px)';
      return `(${kind}-aspect-ratio: ${w}/1080)`;
    })
    .replace(/\(max-height\s*:\s*(\d*\.?\d+)px\s*\)/g, (m, n) => (+n < 1080 ? '(max-height: 0px)' : m))
    .replace(/\(min-height\s*:\s*(\d*\.?\d+)px\s*\)/g, (m, n) => (+n <= 1080 ? '(min-height: 0px)' : m));
}

/* Older per-resource scales, now one rule. A stepped `zoom: var(--w-ui-scale)` (or the JS
   `--ui-scale` of responsive.ts) on top of scaled px would scale twice, so those become 1;
   the old capped unit variables become the new unit. */
const NEUTRAL = { '--ui-scale': '1', '--w-ui-scale': '1' };
const ALIAS = { '--w-ui-px': 'var(--ws-fpx)', '--hs-unit': 'var(--ws-fpx)', '--lb-px': 'var(--ws-fpx)', '--w-lib-px': 'var(--ws-fpx)' };

/** One declaration: returns the new value. */
function scaleDecl(prop, value) {
  const p = String(prop || '').trim();
  if (p in NEUTRAL) return NEUTRAL[p];
  if (p in ALIAS) return ALIAS[p];
  // any other copy of the old capped unit: clamp(1px, .0925925926vh, 2px)
  if (p.startsWith('--') && /^\s*clamp\(\s*1px\s*,\s*0?\.0925\d*vh\s*,\s*2px\s*\)\s*$/.test(String(value))) return 'var(--ws-fpx)';
  return scaleValue(value, isFontProp(p));
}

function isFontProp(prop) {
  const p = String(prop || '').trim().toLowerCase();
  return p === 'font-size' || p === 'font';
}

/* ── 1. PostCSS ─────────────────────────────────────────────────────────── */
function plugin(opts = {}) {
  const skip = opts.skip || /node_modules/;
  return {
    postcssPlugin: 'wraith-ui-scale',
    Once(root, { parse }) {
      const file = (root.source && root.source.input && root.source.input.file) || '';
      if (skip.test(file.replace(/\\/g, '/'))) return;
      root.walkDecls((decl) => {
        decl.value = scaleDecl(decl.prop, decl.value);
      });
      root.walkAtRules('media', (rule) => {
        rule.params = scaleMedia(rule.params);
      });
      if (opts.vars !== false && !root.toString().includes('--ws-px:')) {
        insertVars(root, [parse(ROOT_VARS).first.clone()]);
      }
    },
  };
}
plugin.postcss = true;

/* ── 2. stylis (emotion / Mantine) ──────────────────────────────────────── */
function stylis(element) {
  if (element.type !== 'decl') return;
  const v = element.children;
  if (typeof v !== 'string' || v.indexOf('px') < 0) return;
  element.return = `${element.props}:${scaleDecl(element.props, v)};`;
}

/* ── 3. one-off rewrite of a plain stylesheet (postcss from NODE_PATH) ──── */
function rewriteCss(text, from) {
  if (text.includes(MARK)) return null;
  const postcss = require('postcss');
  const root = postcss.parse(text, { from });
  root.walkDecls((decl) => {
    decl.value = scaleDecl(decl.prop, decl.value);
  });
  root.walkAtRules('media', (rule) => {
    rule.params = scaleMedia(rule.params);
  });
  // ⚠️ @charset / @import must stay first, or the browser drops them (wraith-theme.css).
  insertVars(root, postcss.parse(`${MARK}\n${ROOT_VARS}\n`).nodes);
  return root.toString();
}

/** Put the vars after any leading @charset / @import, never above them. */
function insertVars(root, nodes) {
  let last = null;
  for (const n of root.nodes) {
    if (n.type === 'comment') continue;
    if (n.type === 'atrule' && (n.name === 'import' || n.name === 'charset')) last = n;
    else break;
  }
  if (last) last.after(nodes);
  else root.prepend(nodes);
}

module.exports = plugin;
module.exports.scaleValue = scaleValue;
module.exports.stylis = stylis;
module.exports.scaleMedia = scaleMedia;
module.exports.scaleDecl = scaleDecl;
module.exports.rewriteCss = rewriteCss;
module.exports.ROOT_VARS = ROOT_VARS;

if (require.main === module) {
  const fs = require('fs');
  const args = process.argv.slice(2);
  if (args[0] !== '--rewrite') {
    console.log('usage: node ui-scale.cjs --rewrite <file.css> [...]');
    process.exit(1);
  }
  // keep the file's own line ending (most of these files are CRLF)
  const eol = (src, text) => {
    const crlf = (src.match(/\r\n/g) || []).length;
    const lf = (src.match(/\n/g) || []).length - crlf;
    const t = text.replace(/\r\n/g, '\n');
    return crlf > lf ? t.replace(/\n/g, '\r\n') : t;
  };
  for (const f of args.slice(1)) {
    const src = fs.readFileSync(f, 'utf8');
    if (/\.html?$/i.test(f)) {
      if (src.includes(MARK)) { console.log(`skip (already scaled): ${f}`); continue; }
      const html = src.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, a, css, b) => a + rewriteCss(css, f) + b);
      fs.writeFileSync(f, eol(src, html));
      console.log(`scaled <style> in: ${f}`);
      continue;
    }
    const out = rewriteCss(src, f);
    if (out === null) {
      console.log(`skip (already scaled): ${f}`);
      continue;
    }
    fs.writeFileSync(f, eol(src, out));
    console.log(`scaled: ${f}`);
  }
}
