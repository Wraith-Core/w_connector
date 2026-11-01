# Wraith Core theme (`w_lib/nui/theme`)

One look for every interface on the server: the loading screen and the pause menu, the original Red Dead menus in white and black. Neutral ink, neutral paper and one red: the Wraith launcher's palette (`launcher/renderer/styles.css`). The package holds the values and the parts. Each resource keeps its own layout and behaviour.

| File | What it holds |
|---|---|
| `tokens.css` | Custom properties only: palette, faces per direction, role sizes, motion, texture URLs. Styles nothing by itself. |
| `fonts.css` | `@font-face` only. URLs are relative to this file, so the faces come from `fonts/` whichever page links it. |
| `base.css` | The `w-*` primitives. Classes only: no element selectors, no `!important`. Nothing changes until a page uses a class. |
| `fonts/` | The faces with their OFL licences. The loading-screen files are byte-identical to `w_loading/html/fonts`. |
| `tex/` | The game's brush art as white-on-alpha masks, `tear.png` (the pause menu's 9-slice torn edge) and `grain.png`. `tex/paper/`, `tex/ink/` and `tex/ink-3/` hold the same art recoloured, for `<img>`, `border-image` or a plain `background-image`. |
| `../assets/wraith-theme.css` | One link that `@import`s all three sheets. |
| `../assets/store-theme.css` | The `wst-*` store primitives, drawn with these tokens (see STORE_THEME.md). |

All of `nui/**` ships through w_lib's `fxmanifest.lua`, so a change here needs no manifest edit. It does need a **full server restart**, so that clients download w_lib again.

## Linking it

In CEF, `nui://w_lib/...` becomes `https://cfx-nui-w_lib/...`. Use the https form in HTML and in any `url()` that another resource's stylesheet resolves.

| Page | What to add |
|---|---|
| Already links `store-theme.css` (21 resources) | Nothing. `store-theme.css` `@import`s `tokens.css` and `fonts.css`, so the `--w-*` tokens and the faces are already on the page. Add `base.css` to use the `w-*` classes. |
| Plain HTML | `<link rel="stylesheet" href="https://cfx-nui-w_lib/nui/assets/wraith-theme.css">`, after the page's own CSS. |
| Vite app | The same `<link>` in `index.html`, **outside the bundle**. Vite rewrites absolute `nui://` and `https://cfx-nui-*` URLs inside CSS it bundles, so never `@import` the theme from `src/`. Rebuild, and commit the build the manifest serves. |
| Must stay offline or self-contained (`w_loading`) | Keep a local copy. The file hashes are recorded in `.reports/store-theme-assets.json`. |

Order: the page's own CSS, then `store-theme.css` (its `!important` primitives must win), then `base.css`.

**Still to confirm in game:** the fonts load cross-origin, from `https://cfx-nui-w_lib` into another resource's page. w_baloot and w_centralbank already rely on this. If a page ever shows a system face instead of Lalezar or Tajawal, copy `fonts.css` and `fonts/` next to that page and link the copy.

## Tokens

- **Palette**
  - Ink: `--w-ink #0A0A0A`, `--w-ink-2 #111111`, `--w-ink-3 #191919`, `--w-ink-4 #222222`, `--w-ink-5 #333333`.
  - Paper: `--w-paper #F2F2F2`, `--w-paper-lit #FFFFFF`, `--w-paper-dim #B4B4B4`, `--w-paper-faint #7A7A7A`.
  - Rules: `--w-rule` (.16), `--w-rule-2` (.32), `--w-rule-3` (.5), all `rgba(242,242,242,…)`.
  - Red, a mark only: `--w-red #CB0101`. `--w-red-deep` is the same `#CB0101` (one red, no second step). `--w-red-soft` is a paper lift (`rgba(242,242,242,.06)`), not a red wash: the plate behind an error stays ink and the red stays on its rule, tick or underline.
  - The paper note: `--w-note #E9E9E9`, `--w-note-ink #111111`, `--w-note-dim #555555`, `--w-note-rule` (`rgba(17,17,17,.18)`), `--w-note-glow` (its inset shade, `rgba(0,0,0,.28)`).
  - Other: `--w-strip #CFCFCF`, `--w-scrim` (`rgba(5,5,5,.72)`), `--w-shadow`, `--w-text-shadow`.
  - **Black and white, never a tint.** Every ink and paper step is a neutral grey (r = g = b), the same values as the Wraith launcher. Do not bring back the retired warm set (`#0B0A08`, `#15130F`, `#1D1A15`, `#27231C`, `#38322A`, `#EDE6D6`, `#F6F1E6`, `#B9AF9C`, `#7D7466`, `#E3D9C4`, `#CFC4AE`, `rgba(237,230,214,…)`, the `rgba(90,70,40,…)` burn): in game it read as a milky cream. No `sepia()`, `hue-rotate()` or warm-tinted texture either; a texture is white-on-alpha (a mask) or a neutral grey.
  - Text "white" is paper `#F2F2F2`; `#FFFFFF` only as `--w-paper-lit`.
- **Faces:** `--w-f-display`, `-title`, `-text`, `-action`, `-label`, `-input`, `-num`, `-figure`, `-hand`, `-book`, `-mono`.
  - Each is declared on `:root` / `[dir=ltr]` (Latin face first) and again on `[dir=rtl]` / `html[lang=ar]:not([dir=ltr])` (Arabic face first).
  - A `dir` on an inner element switches that subtree.
  - Arabic-first stacks that ignore direction: `--w-f-ar-display`, `-ar-text`, `-ar-action`, `-ar-label`, `-ar-hand`.
- **Scale:** `--w-rem` is 20 px at 1080p (the loading and pause scale) and never exceeds 24 px.
  - `--w-u` is 1 px at 1080p.
  - Role sizes: `--w-fs-display`, `-title`, `-title-sm`, `-text`, `-action`, `-label`, `-input`, `-hand`.
  - `--w-edge` is the torn-edge depth.
- **Per-direction switches**, read by the role classes:
  - `--w-k-<role>` (Arabic size factor), `--w-wt-<role>`, `--w-lh-<role>`, `--w-track-<role>`.
  - `--w-label-case`, `--w-label-track`.
  - `--w-rtl` (0 or 1), `--w-to-end` (`right` or `left`), `--w-deg-end`.
- **Motion:** `--w-ease` `cubic-bezier(.2,.7,.2,1)`, `--w-t-fast` 120 ms, `--w-t-med` 160 ms, `--w-t-in` 260 ms.
- **Textures:**
  - `--w-tex-band`, `-band-sm`, `-sheet`, `-header`, `-divider`, `-title-divider`, `-line`, `-vline`.
  - The frame: `-frame-{t,b,l,r,tl,tr,bl,br}`.
  - Glyphs and bars: `-arrow-l`, `-arrow-r`, `-tick`, `-cross`, `-lock`, `-swatch`, `-bar`, `-bar-mask`, `-toast`.
  - From the pause menu: `-tear`, `-grain`.

Never define these names in a resource: `--w-ui-scale`, `--w-ui-px`, `--w-lib-px`, `--w-aux-px`, `--w-nav`. They are in use already.

## Arabic faces by role

Arabic is never letter-spaced, uppercased, small-capped, slanted or faux-bold. Numbers use Western digits and are isolated left-to-right (`.w-num`, `.w-fig`).

**One Arabic face on the whole server (owner, 2026-10-22): Lalezar.** The role names below (Amiri, Tajawal, Aref Ruqaa, Noto Sans Arabic) stay as CSS names, so every stack and size factor keeps working, but their Arabic faces in `fonts.css` load Lalezar's file. Each name keeps the weights of its Latin faces (Amiri 400/700, Tajawal 400/500/700): Chromium joins unicode-range faces only inside one weight bucket, so an Arabic face declared 100-900 beside a Latin face declared 700 is never picked, and Noto draws instead. The kit pages (main.tsx), w_admin, w_loading and w_logs declare the same mapping in their own faces.

| Role | Arabic | Latin | Class | Arabic size factor | Arabic line height |
|---|---|---|---|---|---|
| Wordmark / masthead | Lalezar | RDR Lino | `.w-t-display` | 1.03 | 1.2 |
| Title | Lalezar 400 | EB Garamond 600 | `.w-t-title` (`.is-sm`) | 0.92 | 1.25 |
| Reading text | Amiri 400, 16 px or more | EB Garamond 400 | `.w-t-text` | 1.06 | 1.6 |
| Menu rows, big buttons | Amiri 700, 19 px or more | EB Garamond 500 | `.w-t-action`, `.w-item`, `.w-seg-opt`, `.w-choice` | 1 | 1.4 |
| Labels, controls, cells, chips, anything under 16 px | Tajawal 700 (500 for inputs) | Hapna Slab caps, tracked .14em | `.w-t-label`, `.w-kicker`, `.w-label`, `.w-tab`, `.w-btn`, `.w-switch` | 1.12 | 1.3 |
| What the player types | Tajawal 500 | Hapna Slab | `.w-t-input`, `.w-input` | 1.06 | 1.3 |
| Handwritten caption (at most one per screen, never clipped) | Aref Ruqaa | Hapna Slab caps | `.w-t-hand` | 1.6 | 1.7 |
| Big figures | RDR Catalogue | RDR Catalogue | `.w-num` | - | - |
| Figures in text | EB Garamond, lining and tabular | EB Garamond | `.w-fig` | - | - |

- Fallback: `W Noto Arabic`, the Noto file with its line box tamed. After it come Segoe UI and Times New Roman, which every Windows client has.
- `Noto Sans Arabic` is also declared, because w_chat and w_baloot use it as their main face. Since 2026-10-22 it draws Lalezar too; only `W Noto Arabic` is still the real Noto file.
- Do not use Cairo, Changa, Roboto or Arial for Arabic. The one exception is w_map's user-selectable map-label faces.
- A single-weight face (Lalezar, Aref Ruqaa, the RDR faces) is declared over a weight range, so a bold request never synthesises a smeared bold.
- To resize a role on one element, set its variable, for example `style="--w-fs-text:18px"`. The Arabic factor still applies.
- An Arabic run inside a Latin label would be tracked with the label. Wrap it in `.w-ar`.
- Never put `›` or `»` in an RDR Lino run. RDR Lino draws that glyph as a Rockstar badge.

## States, the same everywhere

| State | Row / item / card | Tab | Button | Field |
|---|---|---|---|---|
| Rest | Transparent on a hairline, paper text | Paper-dim | Ink-3 brushed plate, paper-dim | Ink-2, paper underline hairline |
| Under the cursor: hover, `:focus-visible`, `.is-here` | **Paper band, ink text** | Paper band | Paper band | Ink-3 and a 2 px paper underline |
| Active or selected: `.is-active`, `.is-selected`, `[aria-selected=true]` | Paper band | Paper band, same weight | – | – |
| Current but not the cursor (equipped) | `.is-current`: a paper tick at the end, never a second band | – | – | – |
| Primary | – | – | Band at rest, `--w-paper-lit` under the cursor | – |
| Danger | – | – | Paper text with a red underline; under the cursor the paper band like any button, ink text, the red underline kept (the pause menu's confirm note). A red plate only inside a confirm note. | – |
| Invalid | – | – | – | Red underline, plus `.w-error`: reading text in paper with a red square |
| Disabled | 40% | 45% | 45% (primary 35%, with `.w-reason` under it) | 40% |

One cursor: RDR has a single cursor, so a screen shows one band at a time. While the mouse is over a
list, the row under it carries the band and a row that only kept focus from an earlier click or key goes
back to rest (the creator's `.menu-list:hover` / `.component:hover` rules are the pattern).

Red has five uses only:
- `.w-tick` (the focused card's ribbon);
- `.w-pin` (you are here);
- the danger underline (a red fill only for the destructive choice inside a confirm note);
- `.w-attn` (an incomplete required step);
- the progress tick.

Never use red for text.

## Colours that arrive

Ink, paper and one red on every interface, without exception. A colour a script sends (a notice's `titleColor`, a reading's colour, a `<span style="color:…">` in a description, a house colour, a colour a player picked in an older build) is drawn on the palette at render time: the nearest tone by lightness, alpha kept. Text takes a paper step; a red that arrives as text becomes paper text with a red underline. Stored values are never rewritten. A colour field offers the eight tones only (paper to ink), never the machine's full-spectrum picker, and keeps its value until a tone is picked. w_lib's frame does this in `web/src/utils/palette.ts` (`toPalette`, `textStyle`, `monoHtml`) and `web/src/components/PaletteField.tsx`.

## Primitives (`base.css`)

- **Surfaces**
  - `.w-sheet`: a side sheet with the brushed edge.
  - `<i class="w-frame">`: the eight-piece frame, placed inside any positioned box.
  - `.w-header`: the header art.
  - `.w-card-wrap` > `.w-card`: the pause menu's torn card, with its grain on `::after`. Add `.is-focus` on either, and `.is-strip` for a thin strip.
  - `.w-tick`: the red ribbon.
  - `.w-note-wrap` > `.w-note`: the paper note, with `.w-choice` for its choices.
  - `.w-scrim`, `.w-scrim-side` (`.is-end`), `.w-grain`.
- **Hairlines:** `.w-rule` (`.is-strong`), `.w-vrule`, `.w-rule-brush`, `.w-lined`.
- **Band:** `.w-band` and `.w-band-sm` are always on. `.w-item` is a row that carries the states above, with `.w-item-end` for a chevron or icon.
- **Tabs:** `.w-tabs` > `.w-tab` (`.is-active`), with `.w-tab-num` and `.w-attn` inside.
- **Segmented control:** `.w-seg` > `.w-seg-opt` (`.is-on`).
- **Buttons:** `.w-btn` (`.is-primary`, `.is-danger`, `.is-text`), with `.w-reason` for why it is unavailable.
- **Fields:**
  - `.w-input`, or `.w-field` > `.w-input` (`.is-invalid`), with `.w-label` and `.w-error`.
  - `<input type=checkbox class="w-checkbox">`.
  - `.w-switch` (`.is-on`).
  - `<input type=range class="w-range" style="--w-fill:40%">`: the page keeps `--w-fill` in step.
  - `.w-progress` > `.w-progress-fill`.
- **Marks:**
  - `.w-key`: a key cap.
  - `.w-pin` (`.is-ping`).
  - `.w-glyph` with `.is-tick`, `.is-cross`, `.is-lock`, `.is-prev` or `.is-next`, drawn in `currentColor`.
- **Motion and scroll:** `.w-scroll`, `.w-rise` (stagger with `--i`), `.w-fade`. `prefers-reduced-motion` is honoured.
- **Type:** `.w-t-*` (the role classes above), `.w-num`, `.w-fig`, `.w-ar`, `.w-dim`, `.w-faint`, `.w-kicker`.

A static element whose decoration is a `::before`, such as `.wst-plate`, must be `position: relative` in its own page. Otherwise the pseudo-element covers the nearest positioned ancestor.

## Which edge goes where

- **Side panels and form dialogs** (a store, a stable, a bank, an input dialog) keep the store frame: the ink sheet with the 8-piece `crafting_highlight` frame, the `help_text_bg` edge and the `menu_header_1a` header. That is the game's own menu frame, and `test_store_theme_asset_panels.cjs` asserts it.
- **Cards** (a horse, a character, a balance strip, a summary) are the pause menu's torn ink card: `.w-card-wrap` > `.w-card`.
- **Confirm dialogs and help notes** are the paper note: `.w-note-wrap` > `.w-note`.

## Checking a page

```
node .tools/theme_shots.cjs <resource ...|all|theme> [--lang ar,en] [--res 1280x720,1920x1080]
     [--out DIR] [--scenario REGEX] [--lib-nui DIR] [--compare DIR] [--bg FILE] [--strict] [--list]
```

- `theme` renders every primitive above, plus the `wst-*` set, in both languages. `--no-sheet` skips the contact sheet.
- Each shot is audited. These fail the shot:
  - Arabic text not drawn by Lalezar, Amiri, Tajawal or Aref Ruqaa (the faces that actually drew each text node, through CDP), or an Arabic stack that leads with another face;
  - letters drawn by any face outside the package (a system face, Cairo, Bebas...);
  - tracked or slanted Arabic;
  - a request that leaves the game (Google Fonts, a CDN), a missing file, a font file that failed, a page error;
  - a panel outside the viewport.
- These are reported as warnings:
  - a painted colour outside the palette (text, fill, border, outline, shadow, gradient, decoration, placeholder, pseudo-element, SVG);
  - text cut by its own box or by an `overflow:hidden` ancestor (scrollers are exempt), Arabic tails at risk, Arabic line height left at `normal`;
  - a symbol (✕, ↻, ♥...) that only a system face has, Noto drawing a glyph the role face lacks, Latin drawn by an Arabic face on an English page;
  - red text (red is a mark).
- `--lib-nui` points at a copy of an older `nui/`, which gives the "before" shots. `--compare` writes `_compare.png`, with before and after side by side.

## Credits

| Files in `fonts/` | Face | Licence |
|---|---|---|
| `Lalezar-400-arabic` | Lalezar, © 2015 The Lalezar Project Authors | SIL OFL 1.1 (`OFL-Lalezar.txt`) |
| `Amiri-{400,700}-{arabic,latin}` | Amiri, © 2010-2022 The Amiri Project Authors | SIL OFL 1.1 (`OFL-Amiri.txt`) |
| `ArefRuqaa-400-arabic` | Aref Ruqaa, © 2015-2020 The Aref Ruqaa Project Authors | SIL OFL 1.1 (`OFL-ArefRuqaa.txt`) |
| `tajawal-{arabic,latin}-*` | Tajawal, © 2018 Boutros International | SIL OFL 1.1 (`OFL-Tajawal.txt`) |
| `NotoSansArabic` | Noto Sans Arabic, © 2022 The Noto Project Authors | SIL OFL 1.1 (`OFL-NotoSansArabic.txt`) |
| `EBGaramond-latin`, `EBGaramond-Italic-latin` | EB Garamond (variable, 400-800) | SIL OFL 1.1 (`OFL-EBGaramond.txt`) |
| `RDRLino-Regular`, `RDRCatalogueBold-Bold`, `HapnaSlabSerif-DemiBold` | The game's faces, already shipped by the server | Not verified. See `w_loading/CREDITS.md` |

- The OFL subsets are the unmodified Google Fonts subsets.
- The files in `tex/` are the game's UI art (the same files as `w_lib/web/build/tex/ui`), recoloured only in `tex/paper` (`#F2F2F2`), `tex/ink` (`#0A0A0A`) and `tex/ink-3` (`#191919`), all neutral.
- `tear.png` and `grain.png` are w_pausemenu's own procedural textures.
