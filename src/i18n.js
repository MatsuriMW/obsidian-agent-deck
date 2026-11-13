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

let cached = null;

export function detectLanguage() {
  try {
    const forced = typeof process !== "undefined" && process.env && process.env.AGENT_DECK_LANG;
    if (forced) return String(forced).toLowerCase().startsWith("zh") ? "zh" : "en";
    if (typeof window === "undefined" || !window.localStorage) return "zh";
    let raw = window.localStorage.getItem("language") || "";
    if (!raw && typeof navigator !== "undefined") raw = navigator.language || "";
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
  if (currentLanguage() === "en") {
    const hit = en[key];
    if (typeof hit === "string" && hit) text = hit;
  }
  if (!vars) return text;
  return String(text).replace(/\{(\w+)\}/g, (match, name) => {
    const value = vars[name];
    return value === undefined || value === null ? match : String(value);
  });
}

export default t;
