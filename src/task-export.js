import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import pathMod from "path";
import { Component, MarkdownRenderer } from "obsidian";
import * as J from "./journal.js";
import { AGENTS } from "./constants.js";
import { blockAt } from "./delegation.js";
import {
  RECORD_VIEWS, aiRecordGroups, recordViewMode, buildTableModel, buildGroupTableRows,
  recordViewLabel, recordBadgeLabel, recordStepLabel, timelineSpanMeta, footerMetaText,
  tokenizeInlineMarkdown, trackedBlockIds, collectGroupSids, blockSessionMap,
  formatTimelineAt, formatTimelineFull,
} from "./ai-records.js";
import { t } from "./i18n.js";

const SAFE_HREF_RE = /^(?:https?:|mailto:|obsidian:|claude:|codex:|workbuddy:|dsh:|antigravity:|opencode:|qoder:|cursor:|\/|#|\.\.?\/)/i;

function dedentVisualLines(lines, cols) {
  if (!cols) return [...lines];
  return lines.map((line) => {
    let i = 0;
    let eaten = 0;
    while (i < line.length && eaten < cols) {
      const ch = line[i];
      if (ch === "\t") { eaten += 4; i++; }
      else if (ch === " ") { eaten += 1; i++; }
      else break;
    }
    return line.slice(i);
  });
}

function cleanExportLine(raw, inFence) {
  if (inFence) return raw;
  let line = raw.replace(J.RECORD_PROVENANCE_LINE_RE, "");
  const id = J.blockIdOf(line);
  if (id && (J.isDeckBlockId(id) || J.isLegacyBlockId(id))) line = J.stripBlockId(line);
  return J.stripBoundSessionSuffix(line);
}

function sanitizeFilePart(raw, fallback = "task", max = 60) {
  const s = String(raw || "")
    .replace(/\.\.+/g, "-")
    .replace(/[\\/:*?"<>|[\]#^]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-.\s]+|[-.\s]+$/g, "")
    .slice(0, max)
    .trim();
  return s || fallback;
}

function deriveTitle(rawHead) {
  const part = J.splitTask(rawHead);
  let raw = part ? part.rest : String(rawHead || "").replace(/^\s*(?:[-*+]|\d+[.)])\s*/, "");
  raw = J.stripInlineTitleMarkup(
    J.stripBlockId(raw)
      .replace(/^🤖\s*/, "")
      .replace(/^\d{1,2}[:：]\d{2}(?:\s*[-–~～到至]\s*\d{1,2}[:：]\d{2})?\s*/, ""),
  );
  return raw || t("AI 对话任务");
}

function deriveCategory(title, rawLines) {
  const projMatch = /^(.+?)\s*(?:->|→)\s*(.+)$/.exec(title);
  if (projMatch) {
    return {
      category: sanitizeFilePart(projMatch[1], "", 24),
      shortTitle: sanitizeFilePart(projMatch[2], title, 48),
    };
  }
  for (const line of rawLines) {
    const link = J.parseLink(line);
    if (link?.agent) {
      const name = AGENTS[link.agent]?.short || AGENTS[link.agent]?.name || link.agent;
      return {
        category: sanitizeFilePart(name, "", 20),
        shortTitle: sanitizeFilePart(title, "task", 48),
      };
    }
  }
  return {
    category: "",
    shortTitle: sanitizeFilePart(title, "task", 56),
  };
}

function deriveDate(sourcePath = "") {
  const m = /(\d{4})[-_](\d{2})[-_](\d{2})/.exec(String(sourcePath || ""));
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function extractStructuredRecords(lines, blockStart, blockEnd, cleanedLines, plugin) {
  const ids = trackedBlockIds(plugin);
  const blockMap = blockSessionMap(plugin);
  const groups = aiRecordGroups(lines.join("\n"), ids);
  const group = groups.find((g) => g.line === blockStart) || null;
  if (!group) return null;

  const duplicate = plugin?.redundantSessionLink?.(group, lines) ?? -1;
  const entries = (group.tableEntries || []).filter((e) => e.line !== duplicate);
  const sids = collectGroupSids(group, lines, blockMap);
  const agentNames = plugin?.agentShortNames
    || Object.fromEntries(Object.entries(AGENTS).map(([id, a]) => [id, a.short || a.name || id]));

  const parsedRows = buildGroupTableRows(group, entries, lines, plugin, {
    includeTime: true,
    blockMap,
    agentNames,
  });

  const model = buildTableModel(parsedRows);
  const covered = new Set((group.tableEntries || []).flatMap((e) => e.lineNumbers || []));
  const extraRaw = [];
  for (let i = blockStart + 1; i <= blockEnd; i++) {
    if (!covered.has(i) && i !== duplicate) extraRaw.push(cleanedLines[i - blockStart]);
  }
  while (extraRaw.length && !extraRaw[0].trim()) extraRaw.shift();
  while (extraRaw.length && !extraRaw.at(-1).trim()) extraRaw.pop();
  const minIndent = extraRaw
    .filter((l) => l.trim())
    .reduce((min, l) => Math.min(min, J.width(l)), Infinity);
  const extraMarkdown = extraRaw.length
    ? dedentVisualLines(extraRaw, Number.isFinite(minIndent) ? minIndent : 0).join("\n")
    : "";

  return {
    viewMode: recordViewMode(plugin?.settings, group),
    rows: model.rows,
    footer: model.footer,
    hasPromptCol: model.hasPromptCol,
    extraMarkdown,
    sids,
  };
}

export function extractTaskBlock(text, line, sourcePath = "", plugin = null) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const block = blockAt(lines, line);
  if (!block) return null;
  let end = block.end;
  while (end > block.start && !lines[end].trim()) end--;
  const rawLines = lines.slice(block.start, end + 1);
  const dedented = dedentVisualLines(rawLines, J.width(rawLines[0]));
  const fenced = J.fencedLines(dedented);
  const cleanedLines = dedented.map((l, idx) => cleanExportLine(l, fenced.has(idx)));
  const title = deriveTitle(cleanedLines[0]);
  const status = J.kwLine(cleanedLines[0])?.kw || "";
  const { category, shortTitle } = deriveCategory(title, rawLines);
  const date = deriveDate(sourcePath);
  const suggestedName = sanitizeFilePart(
    category ? `${date}-${category}-${shortTitle}` : `${date}-${shortTitle}`,
    `${date}-task`,
    72,
  );
  const structured = extractStructuredRecords(lines, block.start, end, cleanedLines, plugin);
  return {
    start: block.start,
    end,
    rawText: rawLines.join("\n"),
    markdown: cleanedLines.join("\n"),
    title,
    status,
    category,
    date,
    suggestedName,
    viewMode: structured?.viewMode || "outline",
    structured,
  };
}

export function buildTaskExportDocument(extracted, sourcePath = "") {
  const parts = [`# ${extracted.title}`];
  if (sourcePath) parts.push(`> ${t("来源：{path}", { path: sourcePath })}`);
  parts.push(extracted.markdown);
  return `${parts.join("\n\n").replace(/\n+$/, "")}\n`;
}

export function removeTaskBlockFromNote(text, start, end) {
  const src = String(text || "");
  const crlf = /\r\n/.test(src);
  const trailingNl = /\n$/.test(src.replace(/\r\n/g, "\n"));
  const lines = src.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length && lines.at(-1) === "" && trailingNl) lines.pop();
  if (start < 0 || end < start || end >= lines.length) return src;
  const before = lines.slice(0, start);
  const after = lines.slice(end + 1);
  while (before.length && !before.at(-1).trim() && after.length && !after[0].trim()) after.shift();
  if (!before.length) while (after.length && !after[0].trim()) after.shift();
  if (!after.length) while (before.length && !before.at(-1).trim()) before.pop();
  const next = [...before, ...after];
  if (!next.length) return "";
  const joined = next.join("\n") + (trailingNl ? "\n" : "");
  return crlf ? joined.replace(/\n/g, "\r\n") : joined;
}

function writeClipboard(text) {
  try {
    require("electron").clipboard.writeText(text);
    return true;
  } catch { /* fallback below */ }
  try {
    navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function getElectronRemote() {
  try {
    return require("electron")?.remote || null;
  } catch {
    return null;
  }
}

function initialExportDir(plugin, sourcePath = "") {
  const saved = String(plugin.settings?.lastTaskExportDir || "").trim();
  if (saved && fs.existsSync(saved)) return saved;
  const vaultBase = plugin.app?.vault?.adapter?.basePath || "";
  if (vaultBase && sourcePath) {
    const noteDir = pathMod.dirname(pathMod.join(vaultBase, sourcePath));
    if (fs.existsSync(noteDir)) return noteDir;
  }
  return vaultBase || os.homedir();
}

function rememberExportDir(plugin, filePath) {
  if (!plugin.settings || !filePath) return;
  plugin.settings.lastTaskExportDir = pathMod.dirname(filePath);
  plugin.saveSettings?.();
}

function ensureExt(filePath, ext) {
  const suffix = ext.startsWith(".") ? ext : `.${ext}`;
  return filePath.toLowerCase().endsWith(suffix) ? filePath : `${filePath}${suffix}`;
}

async function ensureVaultFolders(vault, relPath) {
  const parts = relPath.split("/").slice(0, -1);
  let cur = "";
  for (const part of parts) {
    cur = cur ? `${cur}/${part}` : part;
    if (!vault.getAbstractFileByPath(cur)) await vault.createFolder(cur);
  }
}

export async function writeExportFile(plugin, chosenPath, content) {
  const abs = pathMod.resolve(chosenPath);
  const vaultBase = plugin.app?.vault?.adapter?.basePath;
  if (vaultBase) {
    const rel = pathMod.relative(pathMod.resolve(vaultBase), abs);
    if (rel && !rel.startsWith("..") && !pathMod.isAbsolute(rel)) {
      const vaultPath = rel.split(pathMod.sep).join("/");
      const vault = plugin.app.vault;
      await ensureVaultFolders(vault, vaultPath);
      const existing = vault.getAbstractFileByPath(vaultPath);
      if (existing) await vault.modify(existing, content);
      else await vault.create(vaultPath, content);
      return { path: vaultPath, insideVault: true };
    }
  }
  await fsp.mkdir(pathMod.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, content, "utf8");
  return { path: abs, insideVault: false };
}

function escapeHtml(raw) {
  return String(raw || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resolveExportView(extracted, requestedView = "") {
  const candidate = RECORD_VIEWS.has(requestedView) ? requestedView : (extracted?.viewMode || "outline");
  if (candidate !== "outline" && !extracted?.structured?.rows?.length && !extracted?.structured?.footer?.length) {
    return "outline";
  }
  return candidate;
}

function renderInlineHtml(text) {
  return tokenizeInlineMarkdown(text).map((tok) => {
    if (tok.type === "text") return escapeHtml(tok.text).replace(/\n/g, "<br />");
    if (tok.type === "link") {
      if (SAFE_HREF_RE.test(tok.href) || !/^[a-z][a-z0-9+.-]*:/i.test(tok.href)) {
        return `<a class="ad-rt-link" href="${escapeHtml(tok.href)}">${escapeHtml(tok.label)}</a>`;
      }
      return escapeHtml(tok.label);
    }
    if (tok.type === "wikilink") return `<span class="ad-wikilink">${escapeHtml(tok.label)}</span>`;
    if (tok.type === "code") return `<code class="ad-rt-code">${escapeHtml(tok.text)}</code>`;
    if (tok.type === "bold") return `<strong>${escapeHtml(tok.text)}</strong>`;
    if (tok.type === "italic") return `<em>${escapeHtml(tok.text)}</em>`;
    return "";
  }).join("");
}

function renderRoundMarkerHtml(row) {
  if (row.type === "span" || row.round == null) {
    const kind = escapeHtml(row.badgeKind || "result");
    return `<span class="ad-rt-badge ad-rt-badge--${kind}">${escapeHtml(recordBadgeLabel(row.badgeKind, row.badge))}</span>`;
  }
  return `<span class="ad-rt-round-num">#${row.round}</span>`;
}

function renderStepTagHtml(row) {
  const label = recordStepLabel(row);
  return label ? `<span class="ad-rt-step">${escapeHtml(label)}</span>` : "";
}

function renderChildrenHtml(children) {
  if (!children?.length) return "";
  const items = children
    .map((c) => {
      const pad = c.level ? ` style="padding-left:${c.level * 14}px"` : "";
      return `<div class="ad-rt-sub-item"${pad}><span class="ad-rt-sub-dot">•</span><span>${renderInlineHtml(c.text)}</span></div>`;
    })
    .join("");
  return `<div class="ad-rt-sub-list">${items}</div>`;
}

function renderTableViewHtml(model) {
  const headCols = model.hasPromptCol
    ? [t("轮次"), t("任务 / 提问"), t("结论 / 回复")]
    : [t("轮次"), t("结论 / 回复")];
  const thead = `<thead><tr>${headCols.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>`;
  const tbodyRows = model.rows.map((row) => {
    const roundCell = `<td class="ad-rt-round">${renderRoundMarkerHtml(row)}</td>`;
    if (row.type === "span") {
      const colSpan = model.hasPromptCol ? ' colspan="2"' : "";
      return `<tr class="ad-rt-row">${roundCell}<td class="ad-rt-span"${colSpan}><div class="ad-rt-text">${renderInlineHtml(row.conclusion)}</div>${renderChildrenHtml(row.children)}</td></tr>`;
    }
    const promptCell = model.hasPromptCol
      ? `<td class="ad-rt-prompt">${renderStepTagHtml(row)}${row.prompt ? `<div class="ad-rt-text">${renderInlineHtml(row.prompt)}</div>` : ""}</td>`
      : "";
    const conclusionCell = `<td class="ad-rt-conclusion">${row.conclusion ? `<div class="ad-rt-text">${renderInlineHtml(row.conclusion)}</div>` : ""}${renderChildrenHtml(row.children)}</td>`;
    return `<tr class="ad-rt-row">${roundCell}${promptCell}${conclusionCell}</tr>`;
  }).join("");
  return `<table class="ad-record-table">${thead}<tbody>${tbodyRows}</tbody></table>`;
}

function renderCardsViewHtml(model) {
  const cards = model.rows.map((row) => {
    const spanCls = row.type === "span" ? " is-span" : "";
    const timeBadge = row.startedAt > 0
      ? `<time class="ad-rt-card__time" datetime="${escapeHtml(new Date(row.startedAt).toISOString())}">${escapeHtml(formatTimelineFull(row.startedAt).slice(0, 16))}</time>`
      : "";
    const prompt = row.prompt ? `<div class="ad-rt-card__prompt">${renderInlineHtml(row.prompt)}</div>` : "";
    const body = (row.conclusion || row.children?.length)
      ? `<div class="ad-rt-card__body">${row.conclusion ? `<div class="ad-rt-text">${renderInlineHtml(row.conclusion)}</div>` : ""}${renderChildrenHtml(row.children)}</div>`
      : "";
    return `<article class="ad-rt-card${spanCls}"><div class="ad-rt-card__head">${renderRoundMarkerHtml(row)}${renderStepTagHtml(row)}${timeBadge}</div>${prompt}${body}</article>`;
  }).join("");
  return `<div class="ad-rt-cards">${cards}</div>`;
}

function renderTimelineViewHtml(model) {
  const { timed, dated } = timelineSpanMeta(model.rows);
  const cls = `ad-rt-timeline${timed ? " ad-rt-timeline--timed" : ""}${dated ? " ad-rt-timeline--dated" : ""}`;
  const items = model.rows.map((row) => {
    const kind = escapeHtml(row.badgeKind || "result");
    const timeEl = row.startedAt > 0
      ? `<time class="ad-rt-tl-time" datetime="${escapeHtml(new Date(row.startedAt).toISOString())}">${escapeHtml(formatTimelineAt(row.startedAt, dated))}</time>`
      : "";
    const promptEl = row.prompt ? `<div class="ad-rt-tl-prompt">${renderInlineHtml(row.prompt)}</div>` : "";
    const replyEl = (row.conclusion || row.children?.length)
      ? `<div class="ad-rt-tl-reply">${row.conclusion ? `<div class="ad-rt-text">${renderInlineHtml(row.conclusion)}</div>` : ""}${renderChildrenHtml(row.children)}</div>`
      : "";
    return `<div class="ad-rt-tl-item ad-rt-tl-item--${kind}"><span class="ad-rt-tl-dot" aria-hidden="true"></span>${timeEl}<div class="ad-rt-tl-head">${renderRoundMarkerHtml(row)}${renderStepTagHtml(row)}</div>${promptEl}${replyEl}</div>`;
  }).join("");
  return `<div class="${cls}">${items}</div>`;
}

function renderFooterHtml(footer) {
  if (!footer?.length) return "";
  const items = footer.map((item) => {
    const ico = item.kind === "clock" ? "⏱" : "🔗";
    const meta = footerMetaText(item);
    const metaText = meta ? `<span class="ad-rt-footer-meta">${escapeHtml(meta)}</span>` : "";
    return `<div class="ad-rt-footer-item"><span class="ad-rt-footer-ico">${ico}</span><span class="ad-rt-footer-body">${renderInlineHtml(item.content)}</span>${metaText}</div>`;
  }).join("");
  return `<div class="ad-rt-footer">${items}</div>`;
}

function fallbackMarkdownHtml(md) {
  return `<pre class="ad-ex-fallback">${escapeHtml(md)}</pre>`;
}

export function buildTaskViewHtmlDocument(extracted, sourcePath = "", { viewMode = "", outlineBodyHtml = "", extraNotesHtml = "" } = {}) {
  const effectiveView = resolveExportView(extracted, viewMode);
  const label = recordViewLabel(effectiveView);
  const chips = [
    `<span class="ad-ex-chip ad-ex-chip--view">${escapeHtml(t("视图：{view}", { view: label }))}</span>`,
  ];
  if (extracted.status) chips.push(`<span class="ad-ex-chip">${escapeHtml(extracted.status)}</span>`);
  if (extracted.date) chips.push(`<span class="ad-ex-chip">${escapeHtml(extracted.date)}</span>`);
  if (extracted.category) chips.push(`<span class="ad-ex-chip">${escapeHtml(extracted.category)}</span>`);
  if (extracted.structured?.rows?.length) {
    chips.push(`<span class="ad-ex-chip">${escapeHtml(t("{n} 条记录", { n: extracted.structured.rows.length }))}</span>`);
  }
  const sourceHtml = sourcePath
    ? `<div class="ad-ex-source">${escapeHtml(t("来源：{path}", { path: sourcePath }))}</div>`
    : "";

  let mainHtml = "";
  if (effectiveView === "outline" || !extracted.structured) {
    mainHtml = `<section class="ad-ex-outline">${outlineBodyHtml || fallbackMarkdownHtml(extracted.markdown)}</section>`;
  } else {
    const model = extracted.structured;
    let viewBody = "";
    if (model.rows.length) {
      if (effectiveView === "cards") viewBody = renderCardsViewHtml(model);
      else if (effectiveView === "timeline") viewBody = renderTimelineViewHtml(model);
      else viewBody = renderTableViewHtml(model);
    }
    const footerHtml = renderFooterHtml(model.footer);
    const notesBlock = model.extraMarkdown
      ? `<section class="ad-ex-notes"><h2>${escapeHtml(t("附注与子任务"))}</h2>${extraNotesHtml || fallbackMarkdownHtml(model.extraMarkdown)}</section>`
      : "";
    mainHtml = `<div class="ad-record-view-wrap" data-view="${escapeHtml(effectiveView)}">${viewBody}${footerHtml}</div>${notesBlock}`;
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(extracted.title)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
    font-size: 13px;
    line-height: 1.62;
    color: #1f2328;
    background: #ffffff;
    overflow-wrap: anywhere;
  }
  @media print { body { padding: 0; } }
  .ad-ex-doc { max-width: 920px; margin: 0 auto; }
  .ad-ex-header {
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid #d8dee4;
  }
  .ad-ex-header h1 {
    margin: 0 0 8px;
    font-size: 20px;
    line-height: 1.35;
    color: #111827;
  }
  .ad-ex-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 6px;
  }
  .ad-ex-chip {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 500;
    color: #4b5563;
    background: #f3f4f6;
    border: 1px solid #e5e7eb;
  }
  .ad-ex-chip--view {
    color: #5b537a;
    background: #f4f2f8;
    border-color: #dcd6ea;
  }
  .ad-ex-source { font-size: 11.5px; color: #57606a; }
  h2, h3, h4 { margin: 14px 0 8px; line-height: 1.35; color: #111827; }
  h2 { font-size: 15px; }
  p, ul, ol, blockquote, pre, table { margin: 0 0 10px; }
  ul, ol { padding-left: 22px; }
  li { margin: 4px 0; }
  blockquote {
    padding: 6px 12px;
    border-left: 3px solid #d0d7de;
    color: #57606a;
    background: #f6f8fa;
    border-radius: 0 6px 6px 0;
  }
  code, .ad-rt-code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 12px;
    background: #f3f4f6;
    padding: 1px 4px;
    border-radius: 4px;
  }
  pre {
    background: #f6f8fa;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 10px 12px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  pre code { background: none; padding: 0; }
  a, .ad-rt-link { color: #0969da; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .ad-wikilink {
    color: #5b537a;
    background: #f4f2f8;
    padding: 0 4px;
    border-radius: 4px;
  }
  .ad-record-view-wrap {
    border: 1px solid #d8dee4;
    border-radius: 10px;
    background: #f9fafb;
    overflow: hidden;
  }
  .ad-record-table {
    width: 100%;
    border-collapse: collapse;
    margin: 0;
    font-size: 12.5px;
    background: #ffffff;
  }
  .ad-record-table thead { display: table-header-group; }
  .ad-record-table th {
    padding: 7px 10px;
    font-size: 11px;
    font-weight: 600;
    color: #57606a;
    text-align: left;
    white-space: nowrap;
    background: #f6f8fa;
    border-bottom: 1px solid #d8dee4;
  }
  .ad-record-table td {
    padding: 8px 10px;
    vertical-align: top;
    text-align: left;
    border-bottom: 1px solid #eaeef2;
  }
  .ad-record-table tbody tr { break-inside: avoid; }
  .ad-record-table tbody tr:last-child td { border-bottom: 0; }
  .ad-rt-round {
    width: 1%;
    white-space: nowrap;
    color: #57606a;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
  }
  .ad-rt-round-num { font-weight: 600; color: #57606a; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
  .ad-rt-badge, .ad-rt-step {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 5px;
    font-size: 10.5px;
    font-weight: 500;
    line-height: 1.4;
    background: #ffffff;
    color: #57606a;
    border: 1px solid #d0d7de;
  }
  .ad-rt-badge--result { color: #746d94; border-color: #cbc6db; }
  .ad-rt-badge--summary { color: #4d725d; border-color: #bcd3c5; }
  .ad-rt-badge--question { color: #8c663f; border-color: #dec8b0; }
  .ad-rt-badge--todo { color: #965553; border-color: #dfc0be; }
  .ad-rt-prompt { width: 34%; color: #4b5563; }
  .ad-rt-sub-list {
    margin-top: 6px;
    padding: 4px 0 2px 10px;
    border-left: 2px solid #d8dee4;
    font-size: 12px;
    color: #4b5563;
  }
  .ad-rt-sub-item { display: flex; gap: 6px; align-items: baseline; }
  .ad-rt-sub-item + .ad-rt-sub-item { margin-top: 3px; }
  .ad-rt-sub-dot { color: #8c959f; flex: none; }
  .ad-rt-cards {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    padding: 12px;
  }
  @media (max-width: 560px) { .ad-rt-cards { grid-template-columns: 1fr; } }
  .ad-rt-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid #d8dee4;
    background: #ffffff;
    font-size: 12.5px;
    break-inside: avoid;
  }
  .ad-rt-card.is-span { grid-column: 1 / -1; }
  .ad-rt-card__head, .ad-rt-tl-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .ad-rt-card__time { margin-left: auto; font-size: 11px; color: #6e7781; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .ad-rt-card__prompt { font-weight: 600; color: #111827; padding-bottom: 5px; border-bottom: 1px solid #eaeef2; }
  .ad-rt-card__body { color: #374151; }
  .ad-rt-timeline {
    position: relative;
    padding: 12px 14px 12px 26px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .ad-rt-timeline::before {
    content: "";
    position: absolute;
    left: 15px;
    top: 18px;
    bottom: 18px;
    width: 1px;
    background: #d0d7de;
  }
  .ad-rt-timeline--timed { padding-left: 78px; }
  .ad-rt-timeline--timed::before { left: 67px; }
  .ad-rt-timeline--dated { padding-left: 110px; }
  .ad-rt-timeline--dated::before { left: 99px; }
  .ad-rt-tl-item {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 8px 10px;
    border-radius: 7px;
    background: #ffffff;
    border: 1px solid #eaeef2;
    break-inside: avoid;
  }
  .ad-rt-tl-dot {
    position: absolute;
    left: -15px;
    top: 13px;
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: #746d94;
    box-shadow: 0 0 0 3px #f9fafb;
  }
  .ad-rt-tl-item--summary .ad-rt-tl-dot { background: #6f8f7c; }
  .ad-rt-tl-item--question .ad-rt-tl-dot { background: #a9845f; }
  .ad-rt-tl-item--todo .ad-rt-tl-dot { background: #a86f6d; }
  .ad-rt-tl-time {
    position: absolute;
    right: calc(100% + 20px);
    top: 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    color: #57606a;
    white-space: nowrap;
  }
  .ad-rt-tl-prompt {
    padding: 5px 8px;
    border-radius: 6px;
    background: #f6f8fa;
    border: 1px solid #e5e7eb;
    font-size: 12px;
    color: #4b5563;
  }
  .ad-rt-tl-reply {
    padding-left: 8px;
    border-left: 2px solid #b4aec9;
    font-size: 12.5px;
    color: #1f2328;
  }
  .ad-rt-footer {
    border-top: 1px solid #d8dee4;
    background: #f6f8fa;
  }
  .ad-rt-footer-item {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px;
    padding: 6px 10px;
    font-size: 11.5px;
    color: #57606a;
  }
  .ad-rt-footer-item + .ad-rt-footer-item { border-top: 1px solid #eaeef2; }
  .ad-rt-footer-meta { color: #6e7781; }
  .ad-ex-notes {
    margin-top: 16px;
    padding: 12px 14px;
    border: 1px solid #d8dee4;
    border-radius: 8px;
    background: #ffffff;
  }
  .ad-ex-notes > h2 { margin-top: 0; font-size: 13.5px; color: #374151; }
</style>
</head>
<body>
<main class="ad-ex-doc">
  <header class="ad-ex-header">
    <h1>${escapeHtml(extracted.title)}</h1>
    <div class="ad-ex-chips">${chips.join("")}</div>
    ${sourceHtml}
  </header>
  ${mainHtml}
</main>
</body>
</html>`;
}

function rowTypeLabel(row) {
  return recordStepLabel(row) || recordBadgeLabel(row.badgeKind, row.badge);
}

export function buildTaskExportJson(extracted, sourcePath = "", { viewMode = "" } = {}) {
  const effectiveView = resolveExportView(extracted, viewMode);
  const model = extracted.structured;
  const payload = {
    schema: "agent-deck.task-export.v1",
    exportedAt: new Date().toISOString(),
    title: extracted.title,
    category: extracted.category,
    date: extracted.date,
    source: sourcePath,
    status: extracted.status || "",
    viewMode: effectiveView,
    taskLine: extracted.markdown.split("\n")[0] || "",
    rounds: (model?.rows || []).map((row, idx) => ({
      index: idx + 1,
      round: row.round,
      type: row.badgeKind || row.type || "result",
      label: rowTypeLabel(row),
      step: row.promptMeta || "",
      startedAt: row.startedAt > 0 ? row.startedAt : null,
      startedAtIso: row.startedAt > 0 ? new Date(row.startedAt).toISOString() : null,
      prompt: row.prompt || "",
      conclusion: row.conclusion || "",
      children: (row.children || []).map((c) => ({ level: c.level, text: c.text })),
    })),
    footer: (model?.footer || []).map((item) => ({
      kind: item.kind,
      label: item.kindLabel,
      content: item.content,
      meta: item.meta || "",
    })),
    notes: model?.extraMarkdown || "",
    markdown: extracted.markdown,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function csvCell(val) {
  const s = String(val ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildTaskExportCsv(extracted, sourcePath = "") {
  const header = [t("标题"), t("日期"), t("来源"), t("轮次"), t("类型"), t("时间"), t("任务 / 提问"), t("结论 / 回复"), t("子项")];
  const rows = extracted.structured?.rows || [];
  const dataRows = rows.length
    ? rows.map((row) => [
        extracted.title,
        extracted.date,
        sourcePath,
        row.round != null ? `#${row.round}` : "",
        rowTypeLabel(row),
        row.startedAt > 0 ? formatTimelineFull(row.startedAt) : "",
        row.prompt || "",
        row.conclusion || "",
        (row.children || []).map((c) => `${"  ".repeat(c.level)}${c.text}`).join("\n"),
      ])
    : [[
        extracted.title,
        extracted.date,
        sourcePath,
        "",
        extracted.status || t("任务"),
        "",
        "",
        extracted.markdown.split("\n").slice(1).join("\n").trim(),
        "",
      ]];
  const lines = [header, ...dataRows].map((r) => r.map(csvCell).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function mdTableCell(raw) {
  return String(raw || "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
}

export function buildTaskMarkdownTable(extracted, sourcePath = "") {
  const model = extracted.structured;
  if (!model?.rows?.length) return buildTaskExportDocument(extracted, sourcePath);
  const parts = [`# ${extracted.title}`];
  if (sourcePath) parts.push(`> ${t("来源：{path}", { path: sourcePath })}`);

  const cols = model.hasPromptCol
    ? [t("轮次"), t("任务 / 提问"), t("结论 / 回复")]
    : [t("轮次"), t("结论 / 回复")];
  const tableLines = [
    `| ${cols.join(" | ")} |`,
    `| ${cols.map(() => "---").join(" | ")} |`,
  ];
  for (const row of model.rows) {
    const marker = row.round != null ? `#${row.round}` : rowTypeLabel(row);
    const stepPrefix = row.promptStep ? `[${rowTypeLabel(row)}] ` : "";
    const promptCell = mdTableCell(`${stepPrefix}${row.prompt || ""}`);
    const childSuffix = (row.children || []).length
      ? (row.conclusion ? "<br>" : "") + row.children.map((c) => `${"&nbsp;&nbsp;".repeat(c.level)}• ${c.text}`).join("<br>")
      : "";
    const conclusionCell = `${mdTableCell(row.conclusion || "")}${childSuffix.replace(/\|/g, "\\|")}`;
    tableLines.push(
      model.hasPromptCol
        ? `| ${mdTableCell(marker)} | ${promptCell} | ${conclusionCell} |`
        : `| ${mdTableCell(marker)} | ${conclusionCell} |`,
    );
  }
  parts.push(tableLines.join("\n"));

  if (model.extraMarkdown) parts.push(`## ${t("附注与子任务")}\n\n${model.extraMarkdown}`);
  if (model.footer?.length) {
    parts.push(model.footer.map((item) => `- ${item.kind === "clock" ? "⏱" : "🔗"} ${item.content}${item.meta ? ` · ${item.meta}` : ""}`).join("\n"));
  }
  return `${parts.join("\n\n").replace(/\n+$/, "")}\n`;
}

function stripInlineMarkdown(raw) {
  return String(raw || "")
    .replace(/\[([^\]\n]+)\]\(([^)\s]+(?:\([^)]*\))?[^)\s]*)\)/g, "$1 ($2)")
    .replace(/\[\[([^\]|\n]+?)(?:\|([^\]\n]+))?\]\]/g, (_, p, alias) => alias || p)
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1");
}

export function buildTaskPlainText(extracted, sourcePath = "") {
  const lines = [extracted.title];
  if (sourcePath) lines.push(t("来源：{path}", { path: sourcePath }));
  if (extracted.date) lines.push(`${t("日期")}：${extracted.date}`);
  const model = extracted.structured;
  if (!model?.rows?.length) {
    lines.push("", stripInlineMarkdown(extracted.markdown));
    return `${lines.join("\n").replace(/\n+$/, "")}\n`;
  }
  lines.push("");
  for (const row of model.rows) {
    const headParts = [];
    if (row.round != null) headParts.push(`#${row.round}`);
    else headParts.push(rowTypeLabel(row));
    if (row.promptStep) headParts.push(rowTypeLabel(row));
    if (row.startedAt > 0) headParts.push(formatTimelineFull(row.startedAt).slice(0, 16));
    lines.push(`[${headParts.join(" · ")}]`);
    if (row.prompt) lines.push(`${t("任务 / 提问")}：${stripInlineMarkdown(row.prompt)}`);
    if (row.conclusion) lines.push(`${t("结论 / 回复")}：${stripInlineMarkdown(row.conclusion)}`);
    for (const c of row.children || []) {
      lines.push(`${"  ".repeat(c.level + 1)}- ${stripInlineMarkdown(c.text)}`);
    }
    lines.push("");
  }
  if (model.extraMarkdown) {
    lines.push(`${t("附注与子任务")}：`, stripInlineMarkdown(model.extraMarkdown), "");
  }
  for (const item of model.footer || []) {
    lines.push(`${item.kind === "clock" ? "⏱" : "🔗"} ${stripInlineMarkdown(item.content)}${item.meta ? ` · ${item.meta}` : ""}`);
  }
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

async function copyTaskFormatted(plugin, path, line, { buildText, successMsg, viewMode = "" }) {
  const text = await plugin.readNote(path);
  const extracted = extractTaskBlock(text, line, path, plugin);
  if (!extracted) return plugin.notice(t("未找到可导出的任务块"));
  const output = buildText(extracted, path, { viewMode });
  if (!writeClipboard(output)) return plugin.notice(t("写入剪贴板失败"));
  plugin.notice(successMsg);
}

export async function copyTaskMarkdown(plugin, path, line) {
  return copyTaskFormatted(plugin, path, line, {
    buildText: (extracted) => `${extracted.markdown}\n`,
    successMsg: t("已按 Markdown 格式复制到剪贴板"),
  });
}

export async function copyTaskMarkdownTable(plugin, path, line) {
  return copyTaskFormatted(plugin, path, line, {
    buildText: (extracted, src) => buildTaskMarkdownTable(extracted, src),
    successMsg: t("已按 Markdown 表格复制到剪贴板"),
  });
}

export async function copyTaskPlainText(plugin, path, line) {
  return copyTaskFormatted(plugin, path, line, {
    buildText: (extracted, src) => buildTaskPlainText(extracted, src),
    successMsg: t("已按纯文本格式复制到剪贴板"),
  });
}

export async function copyTaskJson(plugin, path, line, options = {}) {
  return copyTaskFormatted(plugin, path, line, {
    buildText: (extracted, src, opts) => buildTaskExportJson(extracted, src, opts),
    successMsg: t("已按 JSON 格式复制到剪贴板"),
    viewMode: options.viewMode || "",
  });
}

async function renderMarkdownFragment(plugin, md, path, comp) {
  if (!md) return "";
  const host = document.createElement("div");
  try {
    await MarkdownRenderer.render(plugin.app, md, host, path, comp);
    return host.innerHTML;
  } finally {
    host.remove();
  }
}

async function renderTaskHtmlForExport(plugin, extracted, path, viewMode) {
  const effectiveView = resolveExportView(extracted, viewMode);
  const comp = new Component();
  comp.load();
  try {
    let outlineBodyHtml = "";
    let extraNotesHtml = "";
    if (effectiveView === "outline" || !extracted.structured) {
      outlineBodyHtml = await renderMarkdownFragment(plugin, extracted.markdown, path, comp);
    } else if (extracted.structured.extraMarkdown) {
      extraNotesHtml = await renderMarkdownFragment(plugin, extracted.structured.extraMarkdown, path, comp);
    }
    return buildTaskViewHtmlDocument(extracted, path, {
      viewMode: effectiveView,
      outlineBodyHtml,
      extraNotesHtml,
    });
  } finally {
    comp.unload();
  }
}

async function prepareExportTarget(plugin, path, line, {
  ext,
  filterName,
  dialogTitle,
  requireWindow = false,
  unavailableMsg = t("当前环境不支持选择保存位置"),
  viewMode = "",
}) {
  const remote = getElectronRemote();
  if (!remote?.dialog || (requireWindow && !remote?.BrowserWindow)) {
    plugin.notice(unavailableMsg);
    return null;
  }
  const text = await plugin.readNote(path);
  const extracted = extractTaskBlock(text, line, path, plugin);
  if (!extracted) {
    plugin.notice(t("未找到可导出的任务块"));
    return null;
  }
  const effectiveView = resolveExportView(extracted, viewMode);
  const title = typeof dialogTitle === "function" ? dialogTitle(effectiveView) : dialogTitle;
  const picked = await remote.dialog.showSaveDialog(remote.getCurrentWindow?.(), {
    title,
    defaultPath: pathMod.join(initialExportDir(plugin, path), `${extracted.suggestedName}${ext}`),
    filters: [{ name: filterName, extensions: [ext.replace(/^\./, "")] }],
  });
  if (picked.canceled || !picked.filePath) return null;
  const targetFile = ensureExt(picked.filePath, ext);
  const vaultBase = plugin.app?.vault?.adapter?.basePath;
  if (ext === ".md" && vaultBase && pathMod.resolve(pathMod.join(vaultBase, path)) === pathMod.resolve(targetFile)) {
    plugin.notice(t("不能覆盖当前所在笔记"));
    return null;
  }
  return { remote, extracted, effectiveView, targetFile };
}

export async function exportTaskToPdf(plugin, path, line, options = {}) {
  const prep = await prepareExportTarget(plugin, path, line, {
    ext: ".pdf",
    filterName: "PDF",
    requireWindow: true,
    unavailableMsg: t("当前环境不支持导出 PDF"),
    viewMode: options.viewMode || "",
    dialogTitle: (effectiveView) => t("导出任务与对话为 PDF（{view}）", { view: recordViewLabel(effectiveView) }),
  });
  if (!prep) return;
  const { remote, extracted, effectiveView, targetFile: targetPdf } = prep;
  let win = null;
  let tmpHtml = "";
  try {
    const html = await renderTaskHtmlForExport(plugin, extracted, path, effectiveView);
    tmpHtml = pathMod.join(os.tmpdir(), `agent-deck-pdf-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
    await fsp.writeFile(tmpHtml, html, "utf8");
    win = new remote.BrowserWindow({
      show: false,
      width: 860,
      height: 1120,
      webPreferences: { javascript: false, sandbox: true },
    });
    await win.loadFile(tmpHtml);
    const pdfData = await win.webContents.printToPDF({ printBackground: true, pageSize: "A4" });
    await fsp.mkdir(pathMod.dirname(targetPdf), { recursive: true });
    await fsp.writeFile(targetPdf, pdfData);
    rememberExportDir(plugin, targetPdf);
    plugin.notice(t("已导出 PDF：{path}", { path: targetPdf }));
  } catch (e) {
    plugin.notice(t("导出 PDF 失败：{error}", { error: String(e?.message || e) }));
  } finally {
    if (win && !win.isDestroyed?.()) win.destroy();
    if (tmpHtml) await fsp.unlink(tmpHtml).catch(() => {});
  }
}

async function exportTaskToTextFile(plugin, path, line, { ext, filterName, dialogTitle, buildContent, onSuccess, viewMode = "" }) {
  const prep = await prepareExportTarget(plugin, path, line, { ext, filterName, dialogTitle, viewMode });
  if (!prep) return;
  const { extracted, effectiveView, targetFile } = prep;
  const content = await buildContent(extracted, path, { viewMode: effectiveView });
  const written = await writeExportFile(plugin, targetFile, content);
  rememberExportDir(plugin, targetFile);
  plugin.notice(onSuccess(written.path));
}

export async function exportTaskToHtml(plugin, path, line, options = {}) {
  return exportTaskToTextFile(plugin, path, line, {
    ext: ".html",
    filterName: "HTML",
    dialogTitle: t("导出任务与对话为 HTML"),
    viewMode: options.viewMode || "",
    buildContent: (extracted, src, opts) => renderTaskHtmlForExport(plugin, extracted, src, opts.viewMode),
    onSuccess: (p) => t("已导出 HTML：{path}", { path: p }),
  });
}

export async function exportTaskToMarkdown(plugin, path, line) {
  return exportTaskToTextFile(plugin, path, line, {
    ext: ".md",
    filterName: "Markdown",
    dialogTitle: t("导出任务与对话为 Markdown"),
    buildContent: (extracted, src) => buildTaskExportDocument(extracted, src),
    onSuccess: (p) => t("已导出 Markdown：{path}", { path: p }),
  });
}

export async function exportTaskToJson(plugin, path, line, options = {}) {
  return exportTaskToTextFile(plugin, path, line, {
    ext: ".json",
    filterName: "JSON",
    dialogTitle: t("导出任务与对话为 JSON"),
    viewMode: options.viewMode || "",
    buildContent: (extracted, src, opts) => buildTaskExportJson(extracted, src, opts),
    onSuccess: (p) => t("已导出 JSON：{path}", { path: p }),
  });
}

export async function exportTaskToCsv(plugin, path, line) {
  return exportTaskToTextFile(plugin, path, line, {
    ext: ".csv",
    filterName: "CSV",
    dialogTitle: t("导出任务与对话为 CSV"),
    buildContent: (extracted, src) => buildTaskExportCsv(extracted, src),
    onSuccess: (p) => t("已导出 CSV：{path}", { path: p }),
  });
}

export async function saveTaskAsFile(plugin, path, line) {
  const prep = await prepareExportTarget(plugin, path, line, {
    ext: ".md",
    filterName: "Markdown",
    dialogTitle: t("另存为任务与对话"),
  });
  if (!prep) return;
  const { extracted, targetFile } = prep;
  const content = buildTaskExportDocument(extracted, path);
  const written = await writeExportFile(plugin, targetFile, content);
  rememberExportDir(plugin, targetFile);

  const latest = await plugin.readNote(path);
  const check = extractTaskBlock(latest, line, path, plugin);
  if (!check || check.rawText !== extracted.rawText) {
    return plugin.notice(t("原笔记内容刚有变化，已保存副本到 {path}，原文保留", { path: written.path }));
  }
  const updated = removeTaskBlockFromNote(latest, check.start, check.end);
  await plugin.writeNote(path, updated);
  plugin.refreshUI?.();
  plugin.notice(t("已另存为并移出原文本：{path}", { path: written.path }));
}
