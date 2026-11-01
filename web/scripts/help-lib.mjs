/* ════════════════════════════════════════════════════════════════════════════
 * w_admin · scripts/help-lib.mjs
 * Reads the help fragments (locales/help/<page>.<lang>.json) the same way the page does
 * (src/help/texts.ts). One file per page and language, nested:
 *
 *   {
 *     "players": {                              → help.players.*
 *       "kick": "text",                          → help.players.kick
 *       "banDuration": { "text": "…", "title": "…", "example": "…", "undo": "…", "warn": "…" }
 *     },
 *     "label": { "players": { "kick": "Kick" } } → label.players.kick (visible labels, read with t())
 *   }
 *
 * An object holding "text" is one entry (its sub-keys: title, example, undo, warn). Any other
 * object is a group. Every root key except "label" is a help namespace.
 * ════════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RES = path.resolve(WEB, '..');
export const HELP_DIR = path.join(RES, 'locales', 'help');
export const SUB_KEYS = ['text', 'title', 'example', 'undo', 'warn'];
export const LANGS = ['ar', 'en'];

/** { file, page, lang } for every locales/help/<page>.<lang>.json */
export function listFragments() {
  if (!fs.existsSync(HELP_DIR)) return [];
  return fs.readdirSync(HELP_DIR)
    .filter((f) => /^[a-z][a-zA-Z0-9_-]*\.(ar|en)\.json$/.test(f))
    .sort()
    .map((f) => {
      const [page, lang] = f.split('.');
      return { file: path.join(HELP_DIR, f), name: f, page, lang };
    });
}

export function readJson(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`${path.relative(RES, file)}: invalid JSON (${e.message})`);
  }
}

/**
 * Flattens one fragment.
 * @returns {{ help: Map<string, Record<string,string>>, labels: Map<string,string>, errors: string[] }}
 */
export function flattenFragment(json, where) {
  const help = new Map();
  const labels = new Map();
  const errors = [];
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    errors.push(`${where}: the root must be an object`);
    return { help, labels, errors };
  }
  const walkLabels = (node, prefix) => {
    for (const [k, v] of Object.entries(node)) {
      const key = `${prefix}.${k}`;
      if (typeof v === 'string') labels.set(key, v);
      else if (v && typeof v === 'object' && !Array.isArray(v)) walkLabels(v, key);
      else errors.push(`${where}: ${key} must be a string or an object`);
    }
  };
  const walkHelp = (node, prefix) => {
    for (const [k, v] of Object.entries(node)) {
      const key = `${prefix}.${k}`;
      if (k === 'text' || !/^[A-Za-z0-9_]+$/.test(k)) {
        errors.push(`${where}: bad help key name "${key}" (letters, digits and _ only; "text" is reserved)`);
        continue;
      }
      if (typeof v === 'string') { help.set(key, { text: v }); continue; }
      if (!v || typeof v !== 'object' || Array.isArray(v)) { errors.push(`${where}: ${key} must be a string or an object`); continue; }
      if (typeof v.text === 'string') {
        const entry = {};
        for (const [sk, sv] of Object.entries(v)) {
          if (!SUB_KEYS.includes(sk)) errors.push(`${where}: ${key}.${sk} is not a help sub-key (${SUB_KEYS.join(', ')})`);
          else if (typeof sv !== 'string') errors.push(`${where}: ${key}.${sk} must be a string`);
          else entry[sk] = sv;
        }
        help.set(key, entry);
      } else {
        walkHelp(v, key);
      }
    }
  };
  for (const [root, value] of Object.entries(json)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${where}: root key "${root}" must be an object`);
      continue;
    }
    if (root === 'label') walkLabels(value, 'label');
    else walkHelp(value, `help.${root}`);
  }
  return { help, labels, errors };
}

/** All fragments of one language merged, with collisions reported */
export function loadLanguage(lang) {
  const help = new Map();
  const labels = new Map();
  const errors = [];
  const origin = new Map();
  for (const f of listFragments().filter((x) => x.lang === lang)) {
    let json;
    try { json = readJson(f.file); } catch (e) { errors.push(e.message); continue; }
    const r = flattenFragment(json, f.name);
    errors.push(...r.errors);
    for (const [k, v] of r.help) {
      if (help.has(k)) errors.push(`${f.name}: ${k} is also defined in ${origin.get(k)}`);
      help.set(k, v); origin.set(k, f.name);
    }
    for (const [k, v] of r.labels) {
      if (labels.has(k)) errors.push(`${f.name}: ${k} is also defined in ${origin.get(k)}`);
      labels.set(k, v); origin.set(k, f.name);
    }
  }
  return { help, labels, errors, origin };
}
