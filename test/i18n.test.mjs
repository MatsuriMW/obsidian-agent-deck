// Guards the English UI table: no untranslated entries, no duplicate keys
// across fragments, and every t("…") call site has an English string.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const srcDir = path.join(root, 'src');
const en = (await import('../src/locales/en.js')).default;
const fragments = (await import('../src/locales/en.js')).fragments;

const CJK = /[\u4e00-\u9fff]/;

// 1. every English value is actually English
const untranslated = Object.entries(en).filter(([, v]) => typeof v !== 'string' || !v.trim() || CJK.test(v));
assert.equal(untranslated.length, 0, `untranslated English entries: ${untranslated.map(([k]) => k).join(' | ')}`);

// 2. no key defined twice across fragments
const seen = new Map();
const dupes = [];
for (const [name, table] of Object.entries(fragments)) {
  for (const key of Object.keys(table || {})) {
    if (seen.has(key)) dupes.push(`${key} (${seen.get(key)} + ${name})`);
    else seen.set(key, name);
  }
}
assert.equal(dupes.length, 0, `duplicate keys across fragments: ${dupes.join(' | ')}`);

// 3. every literal key used by t() in src has an English string
const callSite = /(?<![\w.$])t\(\s*(["'])((?:[^"'\\\n]|\\.)*?)\1/g;
const missing = [];
for (const file of fs.readdirSync(srcDir).filter((f) => f.endsWith('.js'))) {
  if (file === 'i18n.js') continue;
  const text = fs.readFileSync(path.join(srcDir, file), 'utf8');
  for (const match of text.matchAll(callSite)) {
    const key = match[2].replace(/\\(["'])/g, '$1');
    if (!Object.hasOwn(en, key)) missing.push(`${file}: ${key}`);
  }
}
assert.equal(missing.length, 0, `missing English strings:\n  ${missing.join('\n  ')}`);

// 4. placeholders must match between key and translation
const bad = [];
for (const [key, value] of Object.entries(en)) {
  const a = [...key.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const b = [...String(value).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  if (a !== b) bad.push(`${key} -> ${value}`);
}
assert.equal(bad.length, 0, `placeholder mismatch:\n  ${bad.join('\n  ')}`);

console.log(`PASS i18n table: ${Object.keys(en).length} English strings, no duplicates, no missing call sites`);
