import { formatDate, dailyNotesOptions } from "./constants.js";
import { fencedLines } from "./outline.js";

export const AI_ANCHOR_COMMENT = "<!-- agent-deck:ai-anchor -->";
export const AI_PLACEHOLDER_RE = /\{\{\s*ai\s*\}\}/i;
const AI_MARKER_RE = /(<!--\s*agent-deck:ai-anchor\s*-->|\{\{\s*ai\s*\}\})/i;

export const JOURNAL_MODES = ["auto", "manual"];
export const TEMPLATE_SOURCES = ["obsidian", "file", "custom", "none"];
export const AI_PLACEMENTS = ["bottom", "top", "after-heading", "placeholder"];

export const DEFAULT_JOURNAL_POLICY = {
  configured: false,
  mode: "auto",
  templateSource: "obsidian",
  templatePath: "",
  templateText: "",
  aiPlacement: "bottom",
  aiAnchorHeading: "",
  updatedAt: 0,
};

export function normalizeJournalPolicy(raw, { legacyAutoCreate = true } = {}) {
  const src = raw && typeof raw === "object" ? raw : {};
  const configured = src.configured === true;
  const mode = JOURNAL_MODES.includes(src.mode)
    ? src.mode
    : (legacyAutoCreate === false ? "manual" : "auto");
  const templateSource = TEMPLATE_SOURCES.includes(src.templateSource) ? src.templateSource : "obsidian";
  const templatePath = String(src.templatePath || "").trim();
  const templateText = String(src.templateText ?? "");
  const aiPlacement = AI_PLACEMENTS.includes(src.aiPlacement) ? src.aiPlacement : "bottom";
  const aiAnchorHeading = String(src.aiAnchorHeading || "").trim();
  const updatedAt = Number.isFinite(Number(src.updatedAt)) ? Number(src.updatedAt) : 0;
  return {
    configured,
    mode,
    templateSource,
    templatePath,
    templateText,
    aiPlacement,
    aiAnchorHeading,
    updatedAt,
  };
}

// Recognize Obsidian YAML frontmatter including Chinese/Unicode property keys.
export function splitFrontMatterLines(lines) {
  if (!Array.isArray(lines) || (lines[0] || "").trim() !== "---") return { head: [], start: 0 };
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() !== "---") continue;
    const body = lines.slice(1, i);
    if (body.some((line) => /^[^\s:#-][^\n:]*\s*:/.test(line))) {
      return { head: lines.slice(0, i + 1), start: i + 1 };
    }
    return { head: [], start: 0 };
  }
  return { head: [], start: 0 };
}

export function extractTemplateHeadings(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const { start } = splitFrontMatterLines(lines);
  const fences = fencedLines(lines);
  const out = [];
  for (let i = start; i < lines.length; i++) {
    if (fences.has(i)) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*$/.exec(lines[i]);
    if (!m) continue;
    out.push({ level: m[1].length, raw: `${m[1]} ${m[2]}`, text: m[2].trim() });
  }
  return out;
}

export function hasAiPlaceholder(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const fences = fencedLines(lines);
  for (let i = 0; i < lines.length; i++) {
    if (fences.has(i)) continue;
    if (AI_PLACEHOLDER_RE.test(lines[i]) || lines[i].includes(AI_ANCHOR_COMMENT)) return true;
  }
  return false;
}

export function expandJournalTemplateVars(text, {
  title = "",
  now = new Date(),
  dateFormat = "YYYY-MM-DD",
  timeFormat = "HH:mm",
  keepAiAnchor = true,
} = {}) {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  const fences = fencedLines(lines);
  const varExpanded = lines.map((line) =>
    line.replace(/\{\{\s*(date|time|title)\s*(?::([^{}]*))?\s*\}\}/g, (_, name, fmt) => {
      if (name === "title") return title;
      const format = String(fmt || "").trim() || (name === "date" ? dateFormat : timeFormat);
      return formatDate(now, format);
    }),
  );
  return varExpanded.map((line, i) => {
    if (fences.has(i)) return line;
    if (!AI_PLACEHOLDER_RE.test(line)) return line;
    const replaced = line.replace(/\{\{\s*ai\s*\}\}/gi, keepAiAnchor ? AI_ANCHOR_COMMENT : "");
    return replaced;
  }).join("\n");
}

export function detectObsidianDailyTemplate(app) {
  let tplPath = "";
  try {
    tplPath = String(dailyNotesOptions(app)?.template || "").trim();
  } catch { /* ignore */ }
  if (!tplPath) {
    try {
      const pn = app?.plugins?.plugins?.["periodic-notes"]?.settings?.daily;
      if (pn?.enabled) tplPath = String(pn.template || "").trim();
    } catch { /* ignore */ }
  }
  return tplPath;
}

export function resolveVaultTemplateFile(app, tplPath) {
  const p = String(tplPath || "").trim();
  if (!p || !app?.vault) return null;
  const cand = app.vault.getAbstractFileByPath?.(p)
    || (/\.md$/i.test(p) ? null : app.vault.getAbstractFileByPath?.(`${p}.md`))
    || app.metadataCache?.getFirstLinkpathDest?.(p, "");
  return cand && typeof cand.extension === "string" ? cand : null;
}

export async function resolveJournalInitialContent(app, policy, { path = "", now = new Date(), fallbackSeed = "" } = {}) {
  const p = normalizeJournalPolicy(policy);
  if (p.templateSource === "none") return fallbackSeed;

  let format = {};
  try { format = app?.internalPlugins?.getPluginById?.("templates")?.instance?.options || {}; } catch { /* ignore */ }
  const cleanPath = String(path || "");
  const title = cleanPath.slice(cleanPath.lastIndexOf("/") + 1).replace(/\.md$/i, "");
  const expandOpts = {
    title,
    now,
    dateFormat: format.dateFormat || "YYYY-MM-DD",
    timeFormat: format.timeFormat || "HH:mm",
    keepAiAnchor: true,
  };

  if (p.templateSource === "custom") {
    return expandJournalTemplateVars(p.templateText || "", expandOpts);
  }

  const tplPath = p.templateSource === "file" ? p.templatePath : detectObsidianDailyTemplate(app);
  if (!tplPath) return fallbackSeed;
  const file = resolveVaultTemplateFile(app, tplPath);
  if (!file) return fallbackSeed;
  try {
    const raw = await app.vault.read(file);
    return expandJournalTemplateVars(raw, expandOpts);
  } catch {
    return fallbackSeed;
  }
}

function joinBoundary(beforeStr, afterStr) {
  let head = String(beforeStr || "").replace(/[ \t]+$/, "");
  if (head) {
    if (head.endsWith("\n\n")) { /* keep */ }
    else if (head.endsWith("\n")) head += "\n";
    else head += "\n\n";
  }
  const trimmedAfter = String(afterStr || "").replace(/^[ \t]*\n*/, "");
  let tail = "\n";
  if (trimmedAfter) {
    tail = "\n\n" + trimmedAfter;
    if (!tail.endsWith("\n")) tail += "\n";
  }
  return { head, tail };
}

export function findAiInsertPosition(text, policy = {}) {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const fences = fencedLines(lines);

  // 1. Explicit anchor comment or {{ai}} placeholder wins regardless of preset.
  for (let i = 0; i < lines.length; i++) {
    if (fences.has(i)) continue;
    const m = AI_MARKER_RE.exec(lines[i]);
    if (!m) continue;
    const restLine = (lines[i].slice(0, m.index) + lines[i].slice(m.index + m[0].length)).trim();
    if (!restLine) {
      return joinBoundary(lines.slice(0, i).join("\n"), lines.slice(i + 1).join("\n"));
    }
    const beforeLines = [...lines.slice(0, i), lines[i].slice(0, m.index).trimEnd()];
    const afterLines = [lines[i].slice(m.index + m[0].length).trimStart(), ...lines.slice(i + 1)];
    return joinBoundary(beforeLines.join("\n"), afterLines.join("\n"));
  }

  const placement = AI_PLACEMENTS.includes(policy?.aiPlacement) ? policy.aiPlacement : "bottom";

  // 2. Top: strictly below YAML frontmatter.
  if (placement === "top") {
    const { start } = splitFrontMatterLines(lines);
    return joinBoundary(lines.slice(0, start).join("\n"), lines.slice(start).join("\n"));
  }

  // 3. After a named heading: insert right under the heading line.
  if (placement === "after-heading") {
    const targetRaw = String(policy?.aiAnchorHeading || "").trim();
    if (targetRaw) {
      const targetText = targetRaw.replace(/^#{1,6}\s+/, "").trim().toLowerCase();
      const { start } = splitFrontMatterLines(lines);
      for (let i = start; i < lines.length; i++) {
        if (fences.has(i)) continue;
        const hm = /^(#{1,6})\s+(.+?)\s*#*$/.exec(lines[i]);
        if (!hm) continue;
        const hText = hm[2].trim().toLowerCase();
        if (lines[i].trim().toLowerCase() === targetRaw.toLowerCase() || hText === targetText) {
          return joinBoundary(lines.slice(0, i + 1).join("\n"), lines.slice(i + 1).join("\n"));
        }
      }
    }
  }

  // 4. Default ("bottom" or fallback when target heading/placeholder is absent).
  return joinBoundary(normalized, "");
}

export function getSharedJournalPromptState(app) {
  const store = (globalThis.__obSharedJournalPromptState ||= {});
  const key = app?.vault?.getName?.() || "__default__";
  return (store[key] ||= { modalPromise: null, dismissedDay: "" });
}
