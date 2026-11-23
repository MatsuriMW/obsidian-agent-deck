// Agent Deck — 日记 AI 记录图标渲染：
// 1. 结论行行首的「第N轮：」（及历史「💬 第N轮：」）渲染为带数字的圆圈 icon；
// 2. 任务行的「🤖」渲染为对应 Agent 的官方桌面 App 小图标（识别不到时保留 🤖）。
//
// Markdown 源码保持纯净纯文本（保留 🤖 与 第N轮：），编辑器 Live Preview 与阅读视图统一替换显示。

import { Decoration, ViewPlugin, WidgetType } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { AGENTS } from "./constants.js";
import { AGENT_IMAGES } from "./agent-assets.js";
import { t } from "./i18n.js";
import {
  TASK_KWS,
  CLOCK_RE,
  blockIdOf,
  agentFromBlockId,
  parseLink,
  width,
  kwLine,
  workKey,
} from "./journal.js";

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 按 Agent id / name / short 建立不区分大小写的反查表，供 ⏱ 行尾的「· Claude」「· Codex」等反推 Agent。
const AGENT_BY_LABEL = new Map();
for (const [id, info] of Object.entries(AGENTS)) {
  for (const label of [id, info?.short, info?.name]) {
    const key = String(label || "").trim().toLowerCase();
    if (key && !AGENT_BY_LABEL.has(key)) AGENT_BY_LABEL.set(key, id);
  }
}

export function agentFromLabel(raw) {
  const key = String(raw || "").trim().toLowerCase();
  if (!key) return "";
  if (AGENT_BY_LABEL.has(key)) return AGENT_BY_LABEL.get(key);
  for (const [label, id] of AGENT_BY_LABEL) {
    if (key.startsWith(`${label} `) || key.startsWith(`${label}(`) || key.startsWith(`${label}（`)) return id;
  }
  return "";
}

export function agentFromClockLine(line) {
  const s = String(line || "").replace(/\s*<!--[\s\S]*?-->\s*/g, "").replace(/\s*\^[A-Za-z0-9-]+\s*$/, "").trim();
  if (!CLOCK_RE.test(s) && !s.startsWith("⏱")) return "";
  const parts = s.split(/\s+·\s+/).map((p) => p.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 1; i--) {
    const agent = agentFromLabel(parts[i]);
    if (agent) return agent;
  }
  return "";
}

// 匹配 AI 结论行行首的「第N轮：」或历史「💬 第N轮：」（不匹配 ❓ / 📋 / 累计总结）。
const LINE_ROUND_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)((?:💬\s+)?(?:第(\d+)轮|Round\s+(\d+))[：:]\s*)/;
const TEXT_ROUND_RE = /^((?:💬\s+)?(?:第(\d+)轮|Round\s+(\d+))[：:]\s*)/;

export function matchRoundPrefix(line) {
  const m = LINE_ROUND_RE.exec(String(line || ""));
  if (!m) return null;
  const from = m[1].length;
  const to = from + m[2].length;
  const round = Number(m[3] || m[4]);
  return Number.isFinite(round) && round > 0 ? { from, to, round } : null;
}

export function matchRoundTextPrefix(text) {
  const m = TEXT_ROUND_RE.exec(String(text || ""));
  if (!m) return null;
  const round = Number(m[2] || m[3]);
  return Number.isFinite(round) && round > 0 ? { from: 0, to: m[1].length, round } : null;
}

// 匹配历史未加粗 AI 结论行里的「任务」和「结论」关键词区间（已带 ** 的由 Markdown 原生加粗）。
const PLAIN_BRIEF_RE = /^(\s*(?:[-*+]|\d+[.)])\s+(?:💬\s+(?:(?:第\d+轮|Round\s+\d+)[：:]\s*)?|(?:第\d+轮|Round\s+\d+)[：:]\s*))(任务)([：:][\s\S]+?；)(结论)(?=[：:])/;

export function matchBriefLabels(line) {
  const m = PLAIN_BRIEF_RE.exec(String(line || ""));
  if (!m) return [];
  const taskFrom = m[1].length;
  const taskTo = taskFrom + m[2].length;
  const concFrom = taskTo + m[3].length;
  const concTo = concFrom + m[4].length;
  return [{ from: taskFrom, to: taskTo }, { from: concFrom, to: concTo }];
}

let robotLineRe = null;
function robotLineRegex() {
  if (!robotLineRe) {
    const kws = TASK_KWS.split("|").sort((a, b) => b.length - a.length).map(escapeRe).join("|");
    robotLineRe = new RegExp(
      `^(\\s*(?:>\\s*)*(?:[-*+]|\\d+[.)])\\s+(?:\\[[ xX/\\-]\\]\\s+)?(?:\\*\\*\\d{1,2}[:：]\\d{2}\\*\\*\\s*)?(?:(?:${kws})\\s+)?(?:\\d{1,2}[:：]\\d{2}(?:\\s*[-–~～到至]\\s*\\d{1,2}[:：]\\d{2})?\\s+)?)(🤖)`,
      "u",
    );
  }
  return robotLineRe;
}

export function matchRobotMark(line) {
  const m = robotLineRegex().exec(String(line || ""));
  if (!m) return null;
  const from = m[1].length;
  return { from, to: from + m[2].length };
}

function agentFromAutoLogState(plugin, blockId, taskLine) {
  const all = plugin?.settings?.autoLogState;
  if (!all || typeof all !== "object") return "";
  const key = workKey(kwLine(taskLine)?.body || "");
  const usageMeta = plugin?.usage?.meta;
  for (const dayState of Object.values(all)) {
    if (!dayState || typeof dayState !== "object") continue;
    for (const [sid, rec] of Object.entries(dayState)) {
      if (!rec || typeof rec !== "object") continue;
      if ((blockId && rec.blockId === blockId) || (key && (rec.key === key || workKey(rec.label || "") === key))) {
        const agent = rec.agent || usageMeta?.get?.(sid)?.agent || "";
        if (agent) return agent;
      }
    }
  }
  return "";
}

/** 推断任务行对应的 Agent id：blockId 前缀 → 子行 🔗 / ⏱ → lineMap → autoLogState */
export function resolveLineAgent(lines, lineIndex, { plugin = null, path = "", doc = null } = {}) {
  if (!Array.isArray(lines) || lineIndex < 0 || lineIndex >= lines.length) return "";
  const raw = String(lines[lineIndex] || "");
  const id = blockIdOf(raw);
  const byId = agentFromBlockId(id);
  if (byId) return byId;

  const base = width(raw);
  for (let i = lineIndex + 1; i < lines.length; i++) {
    const cur = lines[i];
    if (!cur.trim()) continue;
    if (width(cur) <= base) break;
    const link = parseLink(cur);
    if (link?.agent) return link.agent;
    const byClock = agentFromClockLine(cur);
    if (byClock) return byClock;
  }

  if (plugin && path && doc) {
    try {
      const mapped = plugin.lineMap?.(path, doc)?.sessionByParent?.get(lineIndex);
      if (mapped?.agent) return mapped.agent;
    } catch { /* ignore */ }
  }

  if (plugin) {
    const byState = agentFromAutoLogState(plugin, id, raw);
    if (byState) return byState;
  }

  return "";
}

function createRoundBadge(doc, round) {
  const span = doc.createElement("span");
  span.className = "ad-round-badge";
  span.dataset.round = String(round);
  const num = doc.createElement("span");
  num.className = "ad-round-badge__num";
  num.textContent = String(round);
  span.appendChild(num);
  const label = t("第 {n} 轮", { n: round });
  span.title = label;
  span.setAttribute("aria-label", label);
  return span;
}

function createAgentMark(doc, agent, images = AGENT_IMAGES) {
  const src = images?.[agent];
  if (!src) return null;
  const info = AGENTS[agent];
  const label = info?.name || info?.short || agent;
  const wrap = doc.createElement("span");
  wrap.className = "ad-agent-mark";
  wrap.dataset.agent = agent;
  wrap.title = label;
  wrap.setAttribute("aria-label", label);
  const img = doc.createElement("img");
  img.className = "ad-agent-mark__img";
  img.src = src;
  img.alt = info?.short || agent;
  img.decoding = "async";
  img.draggable = false;
  wrap.appendChild(img);
  return wrap;
}

class RoundBadgeWidget extends WidgetType {
  constructor(round) {
    super();
    this.round = round;
  }
  eq(other) {
    return other.round === this.round;
  }
  toDOM(view) {
    return createRoundBadge(view.dom.ownerDocument, this.round);
  }
  ignoreEvent() {
    return false;
  }
}

class AgentMarkWidget extends WidgetType {
  constructor(agent, images = AGENT_IMAGES) {
    super();
    this.agent = agent;
    this.images = images;
  }
  eq(other) {
    return other.agent === this.agent;
  }
  toDOM(view) {
    return createAgentMark(view.dom.ownerDocument, this.agent, this.images) || view.dom.ownerDocument.createTextNode("🤖");
  }
  ignoreEvent() {
    return false;
  }
}

function inCode(view, pos) {
  try {
    for (let n = syntaxTree(view.state).resolveInner(pos, 1); n; n = n.parent) {
      if (/codeblock|inline-code|frontmatter|hmd-code/i.test(n.name)) return true;
    }
  } catch { /* ignore */ }
  return false;
}

function selectionTouches(sel, from, to) {
  for (const range of sel.ranges) {
    if (range.from <= to && range.to >= from) return true;
  }
  return false;
}

export function recordIconsExtension(plugin, images = AGENT_IMAGES) {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = this.build(view);
      }

      update(update) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = this.build(update.view);
        }
      }

      build(view) {
        const out = new RangeSetBuilder();
        const doc = view.state.doc;
        const sel = view.state.selection;
        const info = plugin?.editorInfoField ? view.state.field(plugin.editorInfoField, false) : null;
        const path = info?.file?.path || "";
        let linesCache = null;
        const getLines = () => (linesCache ||= doc.toString().split("\n"));
        let next = 0;

        for (const { from, to } of view.visibleRanges) {
          for (let pos = Math.max(from, next); pos <= to; ) {
            const line = doc.lineAt(pos);
            const text = line.text;
            if (!inCode(view, line.from)) {
              const roundHit = matchRoundPrefix(text);
              if (roundHit) {
                const rf = line.from + roundHit.from;
                const rt = line.from + roundHit.to;
                if (!selectionTouches(sel, rf, rt)) {
                  out.add(rf, rt, Decoration.replace({ widget: new RoundBadgeWidget(roundHit.round) }));
                }
                for (const lbl of matchBriefLabels(text)) {
                  out.add(line.from + lbl.from, line.from + lbl.to, Decoration.mark({ class: "ad-record-label" }));
                }
              } else {
                const briefLabels = text.includes("💬") ? matchBriefLabels(text) : [];
                if (briefLabels.length) {
                  for (const lbl of briefLabels) {
                    out.add(line.from + lbl.from, line.from + lbl.to, Decoration.mark({ class: "ad-record-label" }));
                  }
                } else if (text.includes("🤖")) {
                  const robotHit = matchRobotMark(text);
                  if (robotHit) {
                    const rf = line.from + robotHit.from;
                    const rt = line.from + robotHit.to;
                    if (!selectionTouches(sel, rf, rt)) {
                      const agent = resolveLineAgent(getLines(), line.number - 1, { plugin, path, doc });
                      if (agent && images?.[agent]) {
                        out.add(rf, rt, Decoration.replace({ widget: new AgentMarkWidget(agent, images) }));
                      }
                    }
                  }
                }
              }
            }
            pos = next = line.to + 1;
          }
        }
        return out.finish();
      }
    },
    { decorations: (v) => v.decorations },
  );
}

// ---- 阅读视图（MarkdownPostProcessor） ----

const IN_CODE = "pre, code, .table-cell-wrapper";

function firstDirectTextNode(el) {
  const host = el.querySelector(":scope > p") || el;
  for (const node of host.childNodes) {
    if (node.nodeType === 3 && node.textContent && node.textContent.trim()) return node;
    if (node.nodeType === 1 && /^(UL|OL)$/.test(node.tagName)) break;
  }
  return null;
}

function findRobotTextNode(el) {
  const host = el.querySelector(":scope > p") || el;
  for (const node of host.childNodes) {
    if (node.nodeType === 1 && /^(UL|OL)$/.test(node.tagName)) break;
    if (node.nodeType === 3 && node.textContent && node.textContent.includes("🤖")) return node;
    if (node.nodeType === 1 && node.classList?.contains("todoseq-completed-task-text")) {
      for (const child of node.childNodes) {
        if (child.nodeType === 3 && child.textContent && child.textContent.includes("🤖")) return child;
      }
    }
  }
  return null;
}

function resolveReadingLiAgent(li, { srcLines = null, lineStart = 0, plugin = null } = {}) {
  if (srcLines && li.dataset?.line != null) {
    const idx = lineStart + Number(li.dataset.line);
    const bySrc = resolveLineAgent(srcLines, idx, { plugin });
    if (bySrc) return bySrc;
  }
  const byDomId = agentFromBlockId(li.id || li.dataset?.blockId || "");
  if (byDomId) return byDomId;
  const subList = li.querySelector(":scope > ul, :scope > ol");
  if (subList) {
    for (const child of subList.querySelectorAll(":scope > li")) {
      const txt = child.textContent?.trim() || "";
      const byClock = agentFromClockLine(txt);
      if (byClock) return byClock;
      const linkEl = child.querySelector("a[href]");
      if (linkEl) {
        const href = linkEl.getAttribute("href") || "";
        const m = /[?&]agent=([a-z0-9]+)/i.exec(href) || /^(claude|codex|workbuddy|dsh|antigravity):\/\//i.exec(href);
        if (m) return m[1].toLowerCase();
      }
    }
  }
  if (srcLines) {
    const ownText = ((li.querySelector(":scope > p") || li).textContent || "").split("\n")[0].replace(/\s+/g, " ").trim();
    const afterBot = ownText.includes("🤖") ? ownText.slice(ownText.indexOf("🤖") + "🤖".length).trim().slice(0, 24) : "";
    if (afterBot) {
      for (let i = lineStart; i < srcLines.length; i++) {
        if (!srcLines[i].includes("🤖")) continue;
        const clean = srcLines[i].replace(/[*_`]/g, "");
        if (clean.includes(afterBot)) {
          const byMatch = resolveLineAgent(srcLines, i, { plugin });
          if (byMatch) return byMatch;
        }
      }
    }
  }
  return "";
}

const PLAIN_TEXT_BRIEF_RE = /^((?:💬\s+)?)(任务)([：:][\s\S]+?；)(结论)([：:][\s\S]*)$/;

function appendBriefStyledText(doc, frag, text) {
  const m = PLAIN_TEXT_BRIEF_RE.exec(text);
  if (!m) {
    if (text) frag.appendChild(doc.createTextNode(text));
    return;
  }
  if (m[1]) frag.appendChild(doc.createTextNode(m[1]));
  const s1 = doc.createElement("strong");
  s1.className = "ad-record-label";
  s1.textContent = m[2];
  frag.appendChild(s1);
  frag.appendChild(doc.createTextNode(m[3]));
  const s2 = doc.createElement("strong");
  s2.className = "ad-record-label";
  s2.textContent = m[4];
  frag.appendChild(s2);
  if (m[5]) frag.appendChild(doc.createTextNode(m[5]));
}

export function applyRecordIcons(root, { plugin = null, ctx = null, images = AGENT_IMAGES } = {}) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  const doc = root.ownerDocument;
  const section = ctx?.getSectionInfo?.(root) || null;
  const srcLines = section?.text ? section.text.split("\n") : null;
  const lineStart = section?.lineStart || 0;

  for (const li of root.querySelectorAll("li")) {
    if (li.closest(IN_CODE)) continue;
    // 1. 结论行行首「第N轮：」或历史「💬 第N轮：」→ 圆圈数字 icon（并加粗历史未加粗的「任务」「结论」）
    if (!li.querySelector(":scope > .ad-round-badge, :scope > p > .ad-round-badge")) {
      const textNode = firstDirectTextNode(li);
      const hit = textNode ? matchRoundTextPrefix(textNode.textContent) : null;
      if (hit) {
        const rest = textNode.textContent.slice(hit.to);
        const frag = doc.createDocumentFragment();
        frag.appendChild(createRoundBadge(doc, hit.round));
        appendBriefStyledText(doc, frag, rest);
        textNode.replaceWith(frag);
        continue;
      }
      if (textNode && /^💬\s+任务[：:]/.test(textNode.textContent) && !li.querySelector(":scope > .ad-record-label, :scope > p > .ad-record-label")) {
        const frag = doc.createDocumentFragment();
        appendBriefStyledText(doc, frag, textNode.textContent);
        textNode.replaceWith(frag);
        continue;
      }
    }
    // 2. 任务行「🤖」→ 对应 Agent 官方桌面小图标
    if (!li.querySelector(":scope > .ad-agent-mark, :scope > p > .ad-agent-mark")) {
      const robotNode = findRobotTextNode(li);
      if (robotNode) {
        const agent = resolveReadingLiAgent(li, { srcLines, lineStart, plugin });
        const mark = agent ? createAgentMark(doc, agent, images) : null;
        if (mark) {
          const raw = robotNode.textContent;
          const idx = raw.indexOf("🤖");
          if (idx >= 0) {
            const before = raw.slice(0, idx);
            const after = raw.slice(idx + "🤖".length);
            const frag = doc.createDocumentFragment();
            if (before) frag.appendChild(doc.createTextNode(before));
            frag.appendChild(mark);
            if (after) frag.appendChild(doc.createTextNode(after));
            robotNode.replaceWith(frag);
          }
        }
      }
    }
  }
}

export function recordIconsPostProcessor(plugin, images = AGENT_IMAGES) {
  return (el, ctx) => {
    applyRecordIcons(el, { plugin, ctx, images });
  };
}
