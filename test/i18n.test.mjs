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

// 5. built-in zh-TW table placeholder check & runtime switching, custom packs, fallbacks
const zhTW = (await import('../src/locales/zh-TW.js')).default;
const badTw = [];
for (const [key, value] of Object.entries(zhTW)) {
  const a = [...key.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const b = [...String(value).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  if (a !== b) badTw.push(`${key} -> ${value}`);
}
assert.equal(badTw.length, 0, `zh-TW placeholder mismatch:\n  ${badTw.join('\n  ')}`);
assert.ok(Object.keys(zhTW).length > 1500, 'built-in zh-TW table covers UI strings');

const {
  t,
  currentLanguage,
  setLanguage,
  registerCustomLocales,
  listCustomLocales,
  exportLocaleTemplate,
} = await import('../src/i18n.js');

const prevLang = process.env.AGENT_DECK_LANG;
try {
  delete process.env.AGENT_DECK_LANG;
  registerCustomLocales([]);

  // Built-in zh-TW works out of the box (including zh-HK / zh-Hant normalization)
  setLanguage('zh-TW');
  assert.equal(currentLanguage(), 'zh-TW');
  assert.equal(t('界面语言'), '介面語言');
  assert.equal(t('已建立日志分区，区外笔记保持原样'), '已建立日誌分區，區外筆記保持原樣');
  assert.equal(t('已整理 {count} 个任务', { count: 3 }), '已整理 3 個任務');
  setLanguage('zh-HK');
  assert.equal(currentLanguage(), 'zh-TW');

  // Custom locale packs: can override zh-TW entries or add new languages like ja
  registerCustomLocales([
    { id: 'zh-TW', name: '繁體中文（自訂）', strings: { '界面语言': '顯示語系' } },
    { id: 'ja', name: '日本語', strings: { '界面语言': 'UI言語' } },
    { id: 'en', name: 'Ignored override', strings: { '界面语言': 'WRONG' } },
  ]);
  const packs = listCustomLocales();
  assert.equal(packs.length, 2, 'built-in auto/zh/en cannot be shadowed; zh-TW override and ja are loaded');

  setLanguage('zh-TW');
  assert.equal(t('界面语言'), '顯示語系', 'custom zh-TW pack overrides built-in zh-TW entry');
  assert.equal(t('导出语言模板'), '匯出語言模板', 'non-overridden entry still uses built-in zh-TW');

  setLanguage('ja');
  assert.equal(currentLanguage(), 'ja');
  assert.equal(t('界面语言'), 'UI言語');
  assert.equal(t('导出语言模板'), 'Export language template', 'missing non-zh custom key falls back to English');

  setLanguage('en');
  assert.equal(currentLanguage(), 'en');
  assert.equal(t('界面语言'), 'UI language');

  setLanguage('zh');
  assert.equal(currentLanguage(), 'zh');
  assert.equal(t('界面语言'), '界面语言');

  const tpl = JSON.parse(exportLocaleTemplate());
  assert.ok(tpl._meta?.name, 'exported template carries _meta');
  assert.equal(tpl['界面语言'], 'UI language', 'exported template includes full key set');
} finally {
  registerCustomLocales([]);
  setLanguage('auto');
  if (prevLang !== undefined) process.env.AGENT_DECK_LANG = prevLang;
}
console.log(`PASS i18n runtime: built-in zh-TW (${Object.keys(zhTW).length} strings), custom locale packs, fallbacks, and template export`);
