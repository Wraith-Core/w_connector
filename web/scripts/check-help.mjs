/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · scripts/check-help.mjs  (part of `npm run build`; fails it on any error)
 *
 * Code (TypeScript compiler API over src/**\/*.tsx):
 *   1. a raw <button|input|select|textarea|summary|a> outside src/kit, src/help, src/app → "use the kit"
 *   2. a kit element without `help`:
 *        always:  Button IconButton Field Section PageHeader KeyValue StatTile Drawer SettingRow HelpTip
 *        controls (TextInput TextArea NumberInput Switch Select Combobox Segmented SliderNumber CitizenIdInput):
 *                 need `help` unless they sit inside a <Field> / <SettingRow control={…}>
 *      and a column / item object literal ({ label, render } or { id, label }) without `help`
 *   3. help={false} only on an element that has aria-label (or label)
 *   4. every 'help.x.y' string literal must exist in ar AND en
 * Texts (locales/help/<page>.<ar|en>.json):
 *   5. ar/en pairs, key parity, non-empty, ar has Arabic letters, en has none, ≤ 240 characters,
 *      no trailing colon; unused keys are warnings
 * Module data (src/dev/modules/*.json, the mock descriptors and schemas):
 *   6. every module, command, argument, group, field, column and link carries label + help in ar and en
 *
 * Legacy files (the old tabs, no longer imported by the app; delete them from disk) are skipped: see LEGACY below.
 * A page may also put the comment  help-lint: legacy  in its first line to skip a temporary copy.
 * ════════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { HELP_DIR, LANGS, RES, WEB, listFragments, loadLanguage, readJson, flattenFragment } from './help-lib.mjs';

const SRC = path.join(WEB, 'src');
const rel = (f) => path.relative(WEB, f).replace(/\\/g, '/');

/* the old tabs: nothing imports them any more (tsconfig excludes them too); delete the files */
const LEGACY = ['src/tabs/', 'src/ui/', 'src/QuickMenu.tsx', 'src/map/MapView.tsx', 'src/app/legacy.tsx'];
/* the kit itself and the shell may draw raw elements */
const RAW_OK = ['src/kit/', 'src/help/', 'src/app/'];
/* the kit defines the components: no help checks inside it */
const NO_CHECK = ['src/kit/', 'src/help/'];

const RAW = new Set(['button', 'input', 'select', 'textarea', 'summary', 'a']);
const ALWAYS = new Set(['Button', 'IconButton', 'Field', 'Section', 'PageHeader', 'KeyValue', 'StatTile', 'Drawer', 'SettingRow', 'HelpTip']);
const CONTROLS = new Set(['TextInput', 'TextArea', 'NumberInput', 'Switch', 'Select', 'Combobox', 'Segmented', 'SliderNumber', 'CitizenIdInput']);
const CONTAINERS = new Set(['Field', 'SettingRow']);
const MAX = 240;
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

const errors = [];
const warnings = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

/* ── texts ───────────────────────────────────────────────────────────────── */
const byLang = Object.fromEntries(LANGS.map((l) => [l, loadLanguage(l)]));
for (const l of LANGS) for (const e of byLang[l].errors) err('locales/help', e);

const frags = listFragments();
const pages = new Set(frags.map((f) => f.page));
for (const page of pages) {
  const files = Object.fromEntries(LANGS.map((l) => [l, frags.find((f) => f.page === page && f.lang === l)]));
  for (const l of LANGS) if (!files[l]) err(`locales/help/${page}.${l}.json`, 'missing (every fragment needs ar and en)');
  if (!files.ar || !files.en) continue;
  let ja; let je;
  try { ja = flattenFragment(readJson(files.ar.file), files.ar.name); je = flattenFragment(readJson(files.en.file), files.en.name); } catch (e) { err(page, e.message); continue; }
  for (const [k] of ja.help) if (!je.help.has(k)) err(files.en.name, `${k} is missing (it exists in ar)`);
  for (const [k] of je.help) if (!ja.help.has(k)) err(files.ar.name, `${k} is missing (it exists in en)`);
  for (const [k] of ja.labels) if (!je.labels.has(k)) err(files.en.name, `${k} is missing (it exists in ar)`);
  for (const [k] of je.labels) if (!ja.labels.has(k)) err(files.ar.name, `${k} is missing (it exists in en)`);
  for (const [k, entry] of ja.help) {
    const e2 = je.help.get(k);
    for (const [sub, v] of Object.entries(entry)) if (e2 && !(sub in e2)) err(files.en.name, `${k}.${sub} is missing (it exists in ar)`);
    if (e2) for (const sub of Object.keys(e2)) if (!(sub in entry)) err(files.ar.name, `${k}.${sub} is missing (it exists in en)`);
  }
  const checkText = (file, lang, key, sub, v) => {
    const where = `${file}: ${key}${sub === 'text' ? '' : `.${sub}`}`;
    if (!v || !v.trim()) { errors.push(`${where}: empty`); return; }
    if (v.length > MAX) errors.push(`${where}: ${v.length} characters (at most ${MAX})`);
    if (/[:：]\s*$/.test(v)) errors.push(`${where}: ends with a colon`);
    if (lang === 'en' && ARABIC.test(v)) errors.push(`${where}: Arabic letters in the English text`);
    if (lang === 'ar' && (sub === 'text' || sub === 'title' || sub === 'undo' || sub === 'warn') && !ARABIC.test(v)) errors.push(`${where}: no Arabic letters in the Arabic text`);
  };
  for (const [lang, fl, f] of [['ar', ja, files.ar], ['en', je, files.en]]) {
    for (const [k, entry] of fl.help) for (const [sub, v] of Object.entries(entry)) checkText(f.name, lang, k, sub, v);
    for (const [k, v] of fl.labels) if (!v.trim()) err(f.name, `${k}: empty label`);
  }
}

/* ── code ────────────────────────────────────────────────────────────────── */
function walkDir(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkDir(p, out);
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts') && !e.name.endsWith('.gen.ts')) out.push(p);
  }
  return out;
}

const usedKeys = new Set();
const usedPrefixes = new Set();
let skipped = 0;

const tagName = (n) => n.tagName.getText();
const attrsOf = (opening) => {
  const out = new Map();
  let spread = false;
  for (const p of opening.attributes.properties) {
    if (ts.isJsxSpreadAttribute(p)) { spread = true; continue; }
    out.set(p.name.getText(), p);
  }
  return { attrs: out, spread };
};
const isFalse = (attr) => {
  const init = attr?.initializer;
  return !!init && ts.isJsxExpression(init) && init.expression && init.expression.kind === ts.SyntaxKind.FalseKeyword;
};
/* the prop / property an array literal is given to: items={[…]} or tabs: […] */
const ITEM_PROPS = new Set(['items', 'tabs', 'nav', 'columns']);
function ownerName(arr) {
  let p = arr.parent;
  if (p && ts.isJsxExpression(p)) p = p.parent;
  if (p && (ts.isJsxAttribute(p) || ts.isPropertyAssignment(p))) return p.name.getText();
  return '';
}
function insideContainer(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isJsxElement(p) && CONTAINERS.has(tagName(p.openingElement))) return true;
    if (ts.isJsxAttribute(p) && p.name.getText() === 'control') return true;
  }
  return false;
}

for (const file of walkDir(SRC)) {
  const r = rel(file);
  const text = fs.readFileSync(file, 'utf8');
  const legacy = LEGACY.some((p) => r.startsWith(p)) || /^\s*(\/\/|\/\*)\s*help-lint:\s*legacy/.test(text);
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, r.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const noCheck = NO_CHECK.some((p) => r.startsWith(p));
  const rawOk = RAW_OK.some((p) => r.startsWith(p));
  const at = (n) => { const { line, character } = sf.getLineAndCharacterOfPosition(n.getStart(sf)); return `${r}:${line + 1}:${character + 1}`; };

  const visit = (n) => {
    /* every 'help.x' literal counts as used and must exist */
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && /^help\.[A-Za-z0-9_.]+$/.test(n.text)) {
      usedKeys.add(n.text);
      if (!legacy && !(r.startsWith('src/help/') && n.text === 'help.common.level')) {
        for (const l of LANGS) if (!byLang[l].help.has(n.text)) err(at(n), `${n.text} has no ${l} text (locales/help/*.${l}.json)`);
      }
    }
    /* `help.shell.page.${id}` marks every key under that prefix as used (at least two segments) */
    if (ts.isTemplateExpression(n) && /^help\.[A-Za-z0-9_]+\./.test(n.head.text)) usedPrefixes.add(n.head.text);

    if (!legacy && !noCheck && (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n))) {
      const name = tagName(n);
      const { attrs, spread } = attrsOf(n);
      if (RAW.has(name) && !rawOk) err(at(n), `raw <${name}>: use the kit (Button, IconButton, TextInput, Select, …)`);
      const needs = ALWAYS.has(name) || (CONTROLS.has(name) && !insideContainer(n));
      if (needs && !spread && !attrs.has('help')) err(at(n), `<${name}> without help (add help="help.<page>.<item>")`);
      if (attrs.has('help') && isFalse(attrs.get('help')) && !attrs.has('aria-label') && !attrs.has('label')) {
        err(at(n), `<${name} help={false}> is allowed only with an aria-label (or label)`);
      }
    }
    if (!legacy && !noCheck && ts.isObjectLiteralExpression(n)) {
      const keys = new Set(n.properties.map((p) => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : '')).filter(Boolean));
      const spread = n.properties.some((p) => ts.isSpreadAssignment(p));
      const column = keys.has('label') && keys.has('render');
      const item = keys.has('id') && keys.has('label') && ts.isArrayLiteralExpression(n.parent) && ITEM_PROPS.has(ownerName(n.parent));
      if ((column || item) && !spread && !keys.has('help')) err(at(n), `${column ? 'a column' : 'an item'} without help`);
    }
    ts.forEachChild(n, visit);
  };
  if (legacy) skipped++;
  visit(sf);
}

/* unused keys (warnings) */
for (const k of byLang.en.help.keys()) {
  if (usedKeys.has(k)) continue;
  if ([...usedPrefixes].some((p) => k.startsWith(p))) continue;
  warn('locales/help', `${k} is never used`);
}

/* ── module data (mock descriptors and schemas) ──────────────────────────── */
const MOD_DIR = path.join(SRC, 'dev', 'modules');
function localText(where, v, what, optional = false) {
  if (v === undefined && optional) return;
  if (!v || typeof v !== 'object') { err(where, `${what}: missing { ar, en }`); return; }
  for (const l of LANGS) {
    const s = v[l];
    if (typeof s !== 'string' || !s.trim()) { err(where, `${what}.${l}: empty`); continue; }
    if (s.length > MAX) err(where, `${what}.${l}: ${s.length} characters (at most ${MAX})`);
    if (l === 'en' && ARABIC.test(s)) err(where, `${what}.en: Arabic letters in the English text`);
  }
  if (typeof v.ar === 'string' && /(^|\.)(help|description|how|note)$/.test(what) && !ARABIC.test(v.ar)) err(where, `${what}.ar: no Arabic letters`);
}
function field(where, f) {
  const w = `${where} ${f.key ?? '?'}`;
  localText(w, f.label, 'label');
  localText(w, f.help, 'help');
  localText(w, f.example, 'example', true);
  localText(w, f.unit, 'unit', true);
  localText(w, f.danger, 'danger', true);
  localText(w, f.confirm, 'confirm', true);
  for (const o of f.options ?? []) localText(`${w} option ${o.value}`, o.label, 'label');
  for (const c of f.columns ?? []) field(`${w} column`, c);
  for (const fam of f.families ?? []) localText(`${w} family ${fam.id}`, fam.label, 'label');
  for (const ro of f.readOnly ?? []) localText(`${w} readOnly ${ro.key}`, ro.label, 'label');
}
if (fs.existsSync(MOD_DIR)) {
  for (const name of fs.readdirSync(MOD_DIR).filter((f) => f.endsWith('.json'))) {
    const where = `src/dev/modules/${name}`;
    let data;
    try { data = JSON.parse(fs.readFileSync(path.join(MOD_DIR, name), 'utf8')); } catch (e) { err(where, `invalid JSON (${e.message})`); continue; }
    if (Array.isArray(data)) {
      for (const m of data) {
        const w = `${where} ${m.resource ?? '?'}`;
        localText(w, m.label, 'label'); localText(w, m.description, 'description'); localText(w, m.help, 'help');
        if (m.panel) { localText(w, m.panel.how, 'panel.how'); localText(w, m.panel.note, 'panel.note', true); localText(w, m.panel.locked?.text, 'panel.locked.text', true); }
        for (const c of m.commands ?? []) {
          const wc = `${w} command ${c.id}`;
          localText(wc, c.label, 'label'); localText(wc, c.help, 'help');
          for (const a of c.args ?? []) { localText(`${wc} arg ${a.key}`, a.label, 'label'); localText(`${wc} arg ${a.key}`, a.help, 'help'); }
        }
      }
    } else if (data && Array.isArray(data.groups)) {
      localText(where, data.title, 'title'); localText(where, data.description, 'description');
      for (const l of data.links ?? []) { localText(`${where} link ${l.id}`, l.label, 'label'); localText(`${where} link ${l.id}`, l.help, 'help'); }
      for (const g of data.groups) {
        const w = `${where} group ${g.id}`;
        localText(w, g.label, 'label'); localText(w, g.help, 'help'); localText(w, g.confirm, 'confirm', true);
        for (const f of g.fields ?? []) field(w, f);
      }
    } else {
      warn(where, 'neither a module list nor a settings schema');
    }
  }
}

/* ── report ──────────────────────────────────────────────────────────────── */
for (const w of warnings) console.warn(`warn  ${w}`);
for (const e of errors) console.error(`error ${e}`);
const nKeys = byLang.en.help.size;
console.log(`check-help: ${nKeys} help keys × ${LANGS.length} languages, ${errors.length} error(s), ${warnings.length} warning(s), ${skipped} legacy file(s) skipped`);
if (errors.length) process.exit(1);
void RES; void HELP_DIR;
