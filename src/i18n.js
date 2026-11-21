// Agent Deck — UI language.
//
// Source strings in src/ are Chinese and are used as their own translation key
// (gettext style), so a missing English entry falls back to Chinese instead of
// showing a raw key. English lives in src/locales/en/*.js, one fragment per
// module, merged in src/locales/en.js.
//
// The language follows Obsidian's own UI language automatically: Obsidian keeps
// it in localStorage under "language" (e.g. "zh", "zh-TW", "en"). Anything that
// is not Chinese gets English, which is the sane fallback for the other locales
// the plugin does not translate.
//
// Outside Obsidian (the node test suite, helper scripts) there is no UI language
// to follow, so the Chinese source is used as-is. Set AGENT_DECK_LANG=en to
// exercise the English table from a script.

import en from "./locales/en.js";
import zhTW from "./locales/zh-TW.js";

let cached = null;
let preferred = "auto";
const customLocales = new Map();

function isTraditionalChineseTag(tag) {
  const lower = String(tag || "").trim().toLowerCase().replace(/_/g, "-");
  return lower === "zh-tw" || lower === "zh-hk" || lower === "zh-mo" || lower.startsWith("zh-hant");
}

function matchCustomLocale(tag) {
  if (!tag || !customLocales.size) return "";
  const lower = String(tag).trim().toLowerCase();
  for (const id of customLocales.keys()) {
    if (id.toLowerCase() === lower) return id;
  }
  return "";
}

export function registerCustomLocales(packs = []) {
  customLocales.clear();
  for (const pack of packs || []) {
    const id = String(pack?.id || "").trim();
    const lower = id.toLowerCase();
    if (!id || lower === "auto" || lower === "zh" || lower === "en") continue;
    const normalizedId = isTraditionalChineseTag(id) ? "zh-TW" : id;
    const strings = pack?.strings && typeof pack.strings === "object" ? pack.strings : {};
    const name = String(pack?.name || normalizedId).trim() || normalizedId;
    customLocales.set(normalizedId, { id: normalizedId, name, path: pack?.path || "", strings });
  }
  cached = null;
  return listCustomLocales();
}

export function listCustomLocales() {
  return [...customLocales.values()].map(({ id, name, path, strings }) => ({
    id,
    name,
    path,
    count: Object.keys(strings).length,
  }));
}

export function setLanguage(lang = "auto") {
  const raw = String(lang || "auto").trim() || "auto";
  preferred = isTraditionalChineseTag(raw) ? "zh-TW" : raw;
  cached = null;
  return currentLanguage();
}

export function preferredLanguage() {
  return preferred;
}

export function exportLocaleTemplate() {
  const out = {
    _meta: {
      name: "日本語",
      note: "Translate the values below, rename this file to e.g. ja.json or ko.json in Agent Deck/locales/, then click Rescan in Settings → About → UI Language. Plugin updates will not overwrite files in this folder.",
    },
  };
  for (const [key, enValue] of Object.entries(en)) out[key] = enValue;
  return JSON.stringify(out, null, 2) + "\n";
}

export function detectLanguage() {
  try {
    const forced = typeof process !== "undefined" && process.env && process.env.AGENT_DECK_LANG;
    if (forced) {
      if (isTraditionalChineseTag(forced)) return "zh-TW";
      const customHit = matchCustomLocale(forced);
      if (customHit) return customHit;
      return String(forced).toLowerCase().startsWith("zh") ? "zh" : "en";
    }
    if (preferred && preferred !== "auto") {
      if (preferred === "zh" || preferred === "zh-TW" || preferred === "en") return preferred;
      const customHit = matchCustomLocale(preferred);
      if (customHit) return customHit;
      return preferred.toLowerCase().startsWith("zh") ? "zh" : "en";
    }
    if (typeof window === "undefined" || !window.localStorage) return "zh";
    let raw = window.localStorage.getItem("language") || "";
    if (!raw && typeof navigator !== "undefined") raw = navigator.language || "";
    if (isTraditionalChineseTag(raw)) return "zh-TW";
    const customHit = matchCustomLocale(raw);
    if (customHit) return customHit;
    const tag = String(raw || "en").toLowerCase();
    return tag.startsWith("zh") ? "zh" : "en";
  } catch (_) {
    return "zh";
  }
}

export function currentLanguage() {
  if (!cached) cached = detectLanguage();
  return cached;
}

// Only used by tests and by a reload hook; normal runs cache once per load.
export function resetLanguage() {
  cached = null;
  return currentLanguage();
}

export function t(key, vars) {
  let text = key;
  const lang = currentLanguage();
  if (lang === "en") {
    const hit = en[key];
    if (typeof hit === "string" && hit) text = hit;
  } else if (lang === "zh-TW") {
    const override = customLocales.get("zh-TW")?.strings?.[key];
    const hit = typeof override === "string" && override ? override : zhTW[key];
    if (typeof hit === "string" && hit) text = hit;
  } else if (lang !== "zh") {
    const pack = customLocales.get(lang);
    const customHit = pack?.strings?.[key];
    if (typeof customHit === "string" && customHit) {
      text = customHit;
    } else if (!lang.toLowerCase().startsWith("zh")) {
      const enHit = en[key];
      if (typeof enHit === "string" && enHit) text = enHit;
    }
  }
  if (!vars) return text;
  return String(text).replace(/\{(\w+)\}/g, (match, name) => {
    const value = vars[name];
    return value === undefined || value === null ? match : String(value);
  });
}

export default t;
