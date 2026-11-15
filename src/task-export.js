import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import pathMod from "path";
import { Component, MarkdownRenderer } from "obsidian";
import * as J from "./journal.js";
import { AGENTS } from "./constants.js";
import { blockAt } from "./delegation.js";
import { t } from "./i18n.js";

const RECORD_COMMENT_RE = /[ \t]+<!-- ad-(?:(?:turn|summary(?:-pending)?):[A-Za-z0-9_-]+:\d+|clock:[a-f0-9]+) -->[ \t]*$/;
const UUID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

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
  let line = raw.replace(RECORD_COMMENT_RE, "");
  const id = J.blockIdOf(line);
  if (id && (J.isDeckBlockId(id) || UUID_RE.test(id))) line = J.stripBlockId(line);
  const link = J.parseLink(line);
  const suffix = /[ \t]+`([^`]+)`[ \t]*$/.exec(line);
  if (link && suffix?.[1] === link.sid) line = line.slice(0, suffix.index).trimEnd();
  return line;
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
  raw = J.stripBlockId(raw)
    .replace(/^🤖\s*/, "")
    .replace(/^\d{1,2}[:：]\d{2}(?:\s*[-–~～到至]\s*\d{1,2}[:：]\d{2})?\s*/, "")
    .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, "$2")
    .replace(/\[([^\]\n]+)\]\([^)\n]+\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

export function extractTaskBlock(text, line, sourcePath = "") {
  const lines = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const block = blockAt(lines, line);
  if (!block) return null;
  let end = block.end;
  while (end > block.start && !lines[end].trim()) end--;
  const rawLines = lines.slice(block.start, end + 1);
  const dedented = dedentVisualLines(rawLines, J.width(rawLines[0]));
  const fenced = J.fencedLines(dedented);
  const cleanedLines = dedented.map((l, idx) => cleanExportLine(l, fenced.has(idx)));
  const title = deriveTitle(cleanedLines[0]);
  const { category, shortTitle } = deriveCategory(title, rawLines);
  const date = deriveDate(sourcePath);
  const suggestedName = sanitizeFilePart(
    category ? `${date}-${category}-${shortTitle}` : `${date}-${shortTitle}`,
    `${date}-task`,
    72,
  );
  return {
    start: block.start,
    end,
    rawText: rawLines.join("\n"),
    markdown: cleanedLines.join("\n"),
    title,
    category,
    date,
    suggestedName,
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

export async function copyTaskMarkdown(plugin, path, line) {
  const text = await plugin.readNote(path);
  const extracted = extractTaskBlock(text, line, path);
  if (!extracted) return plugin.notice(t("未找到可导出的任务块"));
  if (!writeClipboard(`${extracted.markdown}\n`)) return plugin.notice(t("写入剪贴板失败"));
  plugin.notice(t("已按 Markdown 格式复制到剪贴板"));
}

function escapeHtml(raw) {
  return String(raw || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildPdfHtmlDocument(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
    font-size: 13.5px;
    line-height: 1.65;
    color: #1f2328;
    background: #ffffff;
    overflow-wrap: anywhere;
  }
  h1, h2, h3, h4 { margin: 0 0 10px; line-height: 1.35; color: #111827; }
  h1 { font-size: 20px; padding-bottom: 8px; border-bottom: 1px solid #d0d7de; }
  p, ul, ol, blockquote, pre, table { margin: 0 0 10px; }
  ul, ol { padding-left: 22px; }
  li { margin: 4px 0; }
  li > ul, li > ol { margin-top: 4px; margin-bottom: 4px; }
  blockquote {
    padding: 6px 12px;
    border-left: 3px solid #d0d7de;
    color: #57606a;
    background: #f6f8fa;
    border-radius: 0 6px 6px 0;
  }
  code {
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
  a { color: #0969da; text-decoration: none; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { border: 1px solid #d0d7de; padding: 6px 8px; text-align: left; }
  th { background: #f6f8fa; }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

export async function exportTaskToPdf(plugin, path, line) {
  const remote = getElectronRemote();
  if (!remote?.dialog || !remote?.BrowserWindow) {
    return plugin.notice(t("当前环境不支持导出 PDF"));
  }
  const text = await plugin.readNote(path);
  const extracted = extractTaskBlock(text, line, path);
  if (!extracted) return plugin.notice(t("未找到可导出的任务块"));

  const startDir = initialExportDir(plugin, path);
  const picked = await remote.dialog.showSaveDialog(remote.getCurrentWindow?.(), {
    title: t("导出任务与对话为 PDF"),
    defaultPath: pathMod.join(startDir, `${extracted.suggestedName}.pdf`),
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (picked.canceled || !picked.filePath) return;

  const targetPdf = ensureExt(picked.filePath, ".pdf");
  const md = buildTaskExportDocument(extracted, path);
  const host = document.createElement("div");
  const comp = new Component();
  comp.load();
  let win = null;
  let tmpHtml = "";
  try {
    await MarkdownRenderer.render(plugin.app, md, host, path, comp);
    const html = buildPdfHtmlDocument(extracted.title, host.innerHTML);
    tmpHtml = pathMod.join(os.tmpdir(), `agent-deck-pdf-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
    await fsp.writeFile(tmpHtml, html, "utf8");
    win = new remote.BrowserWindow({
      show: false,
      width: 820,
      height: 1080,
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
    comp.unload();
    host.remove();
    if (win && !win.isDestroyed?.()) win.destroy();
    if (tmpHtml) await fsp.unlink(tmpHtml).catch(() => {});
  }
}

export async function saveTaskAsFile(plugin, path, line) {
  const remote = getElectronRemote();
  if (!remote?.dialog) {
    return plugin.notice(t("当前环境不支持选择保存位置"));
  }
  const base = await plugin.readNote(path);
  const extracted = extractTaskBlock(base, line, path);
  if (!extracted) return plugin.notice(t("未找到可导出的任务块"));

  const startDir = initialExportDir(plugin, path);
  const picked = await remote.dialog.showSaveDialog(remote.getCurrentWindow?.(), {
    title: t("另存为任务与对话"),
    defaultPath: pathMod.join(startDir, `${extracted.suggestedName}.md`),
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (picked.canceled || !picked.filePath) return;

  const targetFile = ensureExt(picked.filePath, ".md");
  const vaultBase = plugin.app?.vault?.adapter?.basePath;
  if (vaultBase && pathMod.resolve(pathMod.join(vaultBase, path)) === pathMod.resolve(targetFile)) {
    return plugin.notice(t("不能覆盖当前所在笔记"));
  }

  const content = buildTaskExportDocument(extracted, path);
  const written = await writeExportFile(plugin, targetFile, content);
  rememberExportDir(plugin, targetFile);

  const latest = await plugin.readNote(path);
  const check = extractTaskBlock(latest, line, path);
  if (!check || check.rawText !== extracted.rawText) {
    return plugin.notice(t("原笔记内容刚有变化，已保存副本到 {path}，原文保留", { path: written.path }));
  }
  const updated = removeTaskBlockFromNote(latest, check.start, check.end);
  await plugin.writeNote(path, updated);
  plugin.refreshUI?.();
  plugin.notice(t("已另存为并移出原文本：{path}", { path: written.path }));
}
