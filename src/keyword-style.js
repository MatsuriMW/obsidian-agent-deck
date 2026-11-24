// Agent Deck — 任务关键词的 Logseq 风格渲染：配色、tsq-ico 图标、完成/归档态文字。
//
// 这一层把 Logseq Style Tasks（TODOseq，同一位作者的另一支插件）的关键词视觉接了过来：
// 配色、图标路径、动画、类名（todoseq-keyword-formatted / tsq-ico / todoseq-completed-*）
// 与 --tsq-* 变量都是它的拷贝，样式表见 styles/views/keyword.css，两边看起来一致。
// 同时开着 TODOseq 并启用它的「格式化任务关键词」时这一层让位，避免同一行被装饰两次。
//
// AI 自动记录（行内带 🤖）不是待办：完成态不给关键词与正文加删除线。

import { Decoration, ViewPlugin, WidgetType } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { AUTO_MARK, DONE_KWS, TASK_KWS_RE_SRC } from "./journal.js";

// ---- 图标数据：与 TODOseq 的 src/logseq-style/keyword-icons.ts 一致（Lucide 路径） ----
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const P = (d, cls) =>
  `<path${cls ? ` class="${cls}"` : ''} d="${d}"${cls && cls.includes('draw') ? ' pathLength="1"' : ''}/>`;
const ICON = {
  todo: [
    'M10.1 2.182a10 10 0 0 1 3.8 0',
    'M17.609 3.721a10 10 0 0 1 2.69 2.7',
    'M21.818 10.1a10 10 0 0 1 0 3.8',
    'M20.279 17.609a10 10 0 0 1-2.7 2.69',
    'M13.9 21.818a10 10 0 0 1-3.8 0',
    'M6.391 20.279a10 10 0 0 1-2.69-2.7',
    'M2.182 13.9a10 10 0 0 1 0-3.8',
    'M3.721 6.391a10 10 0 0 1 2.7-2.69',
  ]
    .map(
      (d, i) => `<path class="seg" style="--i:${i}" d="${d}"/>`,
    )
    .join(''),
  bot:
    P('M12 8V4H8') +
    '<rect x="4" y="8" width="16" height="12" rx="2"/>' +
    P('M2 14h2') +
    P('M20 14h2') +
    '<g class="eyes"><line x1="15" x2="15" y1="13" y2="15"/><line x1="9" x2="9" y1="13" y2="15"/></g>',
  doing: P('M21 12a9 9 0 1 1-6.219-8.56', 'spin'),
  done: '<circle cx="12" cy="12" r="10"/>' + P('m9 12 2 2 4-4', 'draw'),
  paused:
    '<rect class="l" x="6" y="4" width="4" height="16" rx="1"/><rect class="r" x="14" y="4" width="4" height="16" rx="1"/>',
  waiting:
    '<g class="flip">' +
    P('M5 22h14') +
    P('M5 2h14') +
    P(
      'M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22',
    ) +
    P(
      'M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2',
    ) +
    '</g>',
  suspended:
    '<g class="wob">' +
    [
      'm10 20-1.25-2.5L6 18',
      'M10 4 8.75 6.5 6 6',
      'm14 20 1.25-2.5L18 18',
      'm14 4 1.25 2.5L18 6',
      'm17 21-3-6h-4',
      'm17 3-3 6 1.5 3',
      'M2 12h6.5L10 9',
      'm20 10-1.5 2 1.5 2',
      'M22 12h-6.5L14 15',
      'm4 10 1.5 2L4 14',
      'm7 21 3-6-1.5-3',
      'm7 3 3 6h4',
    ]
      .map((d) => P(d))
      .join('') +
    '</g>',
  cancelled:
    '<circle class="draw" pathLength="1" cx="12" cy="12" r="10"/>' +
    P('m4.9 4.9 14.2 14.2', 'draw slash'),
  failed: P('M18 6 6 18', 'draw') + P('m6 6 12 12', 'draw late'),
  review:
    P(
      'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0',
      'lid',
    ) + '<circle class="pupil" cx="12" cy="12" r="3"/>',
  needok:
    '<g class="wave">' +
    P('M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2') +
    P('M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2') +
    P('M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8') +
    P(
      'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15',
    ) +
    '</g>',
  errored:
    '<g class="shake">' +
    P(
      'M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z',
    ) +
    '<line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></g>',
  hitlimit: P('m12 14 4-4', 'needle') + P('M3.34 19a10 10 0 1 1 17.32 0'),
  delegated:
    '<g class="fly">' +
    P(
      'M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z',
    ) +
    P('m21.854 2.147-10.94 10.939') +
    '</g>' +
    '<path class="trail" stroke-dasharray="2 2" d="M -3 28 C -0.5 26.8 1.6 24.6 3.3 22 C 4.8 19.7 5.2 17.6 4.2 16.1 C 3.2 14.7 1.4 14.5 0.3 15.8 C -0.9 17.2 -0.6 19.4 1.2 20.4 C 3.4 21.5 6.4 19.4 9 15.8"/>',
  yes:
    '<g class="thumb">' +
    P('M7 10v12') +
    P(
      'M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z',
    ) +
    '</g>',
  no:
    '<g class="thumb">' +
    P('M17 14V2') +
    P(
      'M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z',
    ) +
    '</g>',
  maybe:
    '<circle cx="12" cy="12" r="10"/>' +
    '<g class="q">' +
    P('M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3') +
    P('M12 17h.01') +
    '</g>',
  queued:
    '<g class="ring">' +
    P('M18 20.5L19.5 22') +
    P('M6 20.5L4.5 22') +
    P(
      'M21 13C21 17.968 16.968 22 12 22C7.032 22 3 17.968 3 13C3 8.032 7.032 4 12 4C16.968 4 21 8.032 21 13Z',
    ) +
    P(
      'M15.339 15.862L12.549 14.197C12.063 13.909 11.667 13.216 11.667 12.649V8.95898',
    ) +
    '</g>' +
    '<g class="bells">' +
    P('M18 2L21.747 5.31064') +
    P('M6 2L2.25304 5.31064') +
    '</g>',
};

/** Icon for a built-in or commonly used keyword */
const KIND = {
  TODO: 'todo',
  LATER: 'todo',
  TODOFORAI: 'bot',
  TODO4AI: 'bot',
  TODO2AI: 'bot',
  TODOTOAI: 'bot',
  DOING: 'doing',
  NOW: 'doing',
  'IN-PROGRESS': 'doing',
  DONE: 'done',
  PAUSED: 'paused',
  WAITING: 'waiting',
  WAIT: 'waiting',
  SUSPENDED: 'suspended',
  CANCELLED: 'cancelled',
  CANCELED: 'cancelled',
  FAILED: 'failed',
  TOREVIEW: 'review',
  NEEDOK: 'needok',
  ERRORED: 'errored',
  HITLIMIT: 'hitlimit',
  QUEUED: 'queued',
  DELEGATED: 'delegated',
  YES: 'yes',
  NO: 'no',
  MAYBE: 'maybe',
};


// ---- 关键词识别 ----

const AI_MARK = AUTO_MARK.trim();
let compiled = null;

function keywordRegex() {
  if (!compiled) {
    const alternation = TASK_KWS_RE_SRC
      .split("|")
      .sort((a, b) => b.length - a.length)
      .map(escape)
      .join("|");
    compiled = new RegExp(
      `^(\\s*(?:>\\s*)*(?:(?:#{1,6}|[-*+]|\\d+[.)])\\s+)?(?:\\[[ xX/\\-]\\]\\s+)?(?:\\*\\*\\d{1,2}[:：]\\d{2}\\*\\*\\s*)?)(${alternation})(?=\\s|$)`,
      "u",
    );
  }
  return compiled;
}

/** 行首（列表标记、引用、复选框、**07:37** 时间之后）的关键词及其位置 */
export function keywordOf(text) {
  const m = keywordRegex().exec(String(text));
  return m ? { at: m[1].length, keyword: m[2].toUpperCase(), raw: m[2] } : null;
}

/** AI 自动记录（整行带 🤖）：完成也不划线 */
export const isAiRecordLine = (text) => String(text).includes(AI_MARK);

export const isDoneKeyword = (keyword) => DONE_KWS.includes(String(keyword || "").toUpperCase());

/**
 * TODOseq 在管关键词哪一层，这一层就让出去，避免同一行被装饰两次：
 * 「格式化任务关键词」管配色与完成态文字，「关键词图标」管 tsq-ico 图标。
 * 两个开关都关掉时，这一层整套接管。
 */
function todoSetting(plugin, key) {
  try {
    const plugins = plugin.app?.plugins?.plugins || {};
    const todo = plugins["logseq-style-tasks"] || plugins["todoseq"];
    return todo?.settings ? todo.settings[key] : undefined;
  } catch {
    return undefined;
  }
}

export function todoSeqFormatsKeywords(plugin) {
  const value = todoSetting(plugin, "formatTaskKeywords");
  return value !== undefined && value !== false;
}

export function todoSeqRendersIcons(plugin) {
  const value = todoSetting(plugin, "keywordIcons");
  return value !== undefined && value !== false;
}

/** 配色与完成态文字这一层是否由这边渲染 */
const active = (plugin) =>
  plugin.settings.keywordStyle !== false && !todoSeqFormatsKeywords(plugin);

/** 图标这一层是否由这边渲染 */
const activeIcons = (plugin) =>
  plugin.settings.keywordStyle !== false && !todoSeqRendersIcons(plugin);

const inCode = (view, pos) => {
  try {
    for (let n = syntaxTree(view.state).resolveInner(pos, 1); n; n = n.parent) {
      if (/codeblock|inline-code|frontmatter|hmd-code/i.test(n.name)) return true;
    }
  } catch {
    /* 没有语法树（很少见）就按正文处理 */
  }
  return false;
};

/** 关键词 → 图标种类；没有对应图标的关键词不上图标，其余照常上色 */
const kindOf = (keyword) => KIND[keyword] || null;

class Icon extends WidgetType {
  constructor(keyword, kind, fire) {
    super();
    this.keyword = keyword;
    this.kind = kind;
    this.fire = fire;
  }

  eq(other) {
    return (
      other.keyword === this.keyword &&
      other.kind === this.kind &&
      other.fire === this.fire
    );
  }

  toDOM() {
    const el = document.createElement("span");
    el.className = `tsq-ico tsq-ico-${this.kind}${this.fire ? " is-fire" : ""}`;
    el.setAttribute("data-kw", this.keyword);
    el.setAttribute("aria-hidden", "true");
    const svg = new DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[this.kind] || ""}</svg>`,
      "image/svg+xml",
    ).documentElement;
    el.appendChild(document.importNode(svg, true));
    return el;
  }

  ignoreEvent() {
    return false;
  }
}

// ---- 编辑器：关键词配色 + 完成态文字（AI 记录不划线） ----

export function keywordMarksExtension(plugin) {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = this.build(view);
      }

      update(update) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = this.build(update.view);
        }
      }

      build(view) {
        const out = new RangeSetBuilder();
        if (!active(plugin)) return out.finish();
        const doc = view.state.doc;
        for (const { from, to } of view.visibleRanges) {
          let pos = from;
          while (pos <= to) {
            const line = doc.lineAt(pos);
            const hit = keywordOf(line.text);
            if (hit && !inCode(view, line.from)) {
              const start = line.from + hit.at;
              const end = start + hit.raw.length;
              const done = isDoneKeyword(hit.keyword);
              const aiRecord = isAiRecordLine(line.text);
              const heading = /^\s*(?:>\s*)*#{1,6}\s+/.test(line.text);
              out.add(
                start,
                end,
                Decoration.mark({
                  class:
                    "todoseq-keyword-formatted" +
                    (done && !aiRecord ? " todoseq-completed-keyword" : "") +
                    (heading ? " todoseq-heading-task-keyword" : ""),
                  attributes: { "data-task-keyword": hit.keyword },
                }),
              );
              if (done && !aiRecord && end < line.to) {
                out.add(
                  end,
                  line.to,
                  Decoration.mark({ class: "todoseq-completed-task-text" }),
                );
              }
            }
            pos = line.to + 1;
          }
        }
        return out.finish();
      }
    },
    { decorations: (v) => v.decorations },
  );
}

// ---- 编辑器：关键词图标（与 TODOseq 的 tsq-ico 相同，含切换关键词时播一次的动画） ----

const FIRE_MS = 2500;

export function keywordIconsExtension(plugin) {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.fires = new Map();
        this.seq = 0;
        this.decorations = this.build(view);
      }

      /** 去掉关键词、时间和优先级后的正文：只改关键词时它不变 */
      bodyOf(text) {
        return text
          .replace(keywordRegex(), "$1")
          .replace(
            /^\s*(?:>\s*)*(?:(?:[-*+]|\d+[.)])\s+)?(?:\*\*\d{1,2}[:：]\d{2}\*\*\s*)?/,
            "",
          )
          .replace(
            /^\s*(?:\[#[ABC]\]\s*)?(?:\d{1,2}[:：]\d{2}(?:\s*[-–~～]\s*\d{1,2}[:：]\d{2})?\s*)?(?:\[#[ABC]\]\s*)?/,
            "",
          )
          .trim();
      }

      update(update) {
        if (update.docChanged && activeIcons(plugin)) {
          const now = Date.now();
          const moved = new Map();
          for (const [pos, f] of this.fires) {
            if (now - f.at < FIRE_MS) moved.set(update.changes.mapPos(pos, 1), f);
          }
          this.fires = moved;
          const before = update.startState.doc;
          const after = update.state.doc;
          const fresh = [];
          let lines = 0;
          update.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
            const was = new Map();
            for (
              let n = before.lineAt(fromA).number, end = before.lineAt(toA).number;
              n <= end && lines < 50;
              n++, lines++
            ) {
              const text = before.line(n).text;
              was.set(this.bodyOf(text), keywordOf(text)?.keyword || "");
            }
            for (
              let n = after.lineAt(fromB).number, end = after.lineAt(toB).number;
              n <= end && lines < 100;
              n++, lines++
            ) {
              const line = after.line(n);
              const hit = keywordOf(line.text);
              if (!hit) continue;
              const old = was.get(this.bodyOf(line.text));
              if (old !== undefined && old !== hit.keyword) fresh.push([line.from, hit.keyword]);
            }
          });
          if (fresh.length && fresh.length <= 5) {
            for (const [pos, keyword] of fresh) {
              this.fires.set(pos, { keyword, id: ++this.seq, at: now });
            }
          }
        }
        if (update.docChanged || update.viewportChanged || this.fires.size) {
          this.decorations = this.build(update.view);
        }
      }

      build(view) {
        const out = new RangeSetBuilder();
        if (!activeIcons(plugin)) return out.finish();
        const doc = view.state.doc;
        const now = Date.now();
        for (const [pos, f] of this.fires) {
          if (now - f.at >= FIRE_MS) this.fires.delete(pos);
        }
        // 一个内嵌块会把同一行拆成两段可见范围；从上一个扫完的下一行继续，别给一行放两个图标
        let next = 0;
        for (const { from, to } of view.visibleRanges) {
          for (let pos = Math.max(from, next); pos <= to; ) {
            const line = doc.lineAt(pos);
            const hit = keywordOf(line.text);
            const kind = hit && kindOf(hit.keyword);
            if (hit && kind && !inCode(view, line.from)) {
              const f = this.fires.get(line.from);
              const fire = f && f.keyword === hit.keyword ? f.id : 0;
              out.add(
                line.from + hit.at,
                line.from + hit.at,
                Decoration.widget({
                  widget: new Icon(hit.keyword, kind, fire),
                  side: -1,
                }),
              );
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

// ---- 阅读视图：关键词配色 + 完成态文字（TODOseq 在阅读视图也不放图标） ----

const BLOCK_CHILD_RE = /^(UL|OL|DIV|BLOCKQUOTE|PRE|TABLE|H[1-6])$/;

function firstTextChild(el) {
  for (const node of el.childNodes) {
    if (node.nodeType === 3 && node.textContent && node.textContent.trim()) return node;
  }
  return null;
}

function wrapRemainder(doc, keywordSpan) {
  const wrap = doc.createElement("span");
  wrap.className = "todoseq-completed-task-text";
  let cur = keywordSpan.nextSibling;
  while (cur) {
    const next = cur.nextSibling;
    if (cur.nodeType === 1 && BLOCK_CHILD_RE.test(cur.tagName)) break;
    wrap.append(cur);
    cur = next;
  }
  if (wrap.childNodes.length) keywordSpan.after(wrap);
}

// 便宜的第一道筛子：候选行必须以全大写或全小写关键词开头（`DOING …` / `todo …` / `> - TODO …`）。
// 命中才跑完整的关键词正则、再去查祖先与已渲染的标记，大笔记里省下大部分开销。
const LOOKS_LIKE_TASK = /^\s*(?:>\s*)*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)?(?:\[[ xX/\-]\]\s+)?(?:\*\*\d{1,2}[:：]\d{2}\*\*\s*)?(?:[A-Z][A-Z0-9-]*|[a-z][a-z0-9-]*)\b/;
const TASK_HOSTS = "li, p, h1, h2, h3, h4, h5, h6";
const IN_CODE = "pre, code, .table-cell-wrapper";

export function applyKeywordStyle(root) {
  const host = root.querySelectorAll ? root : null;
  if (!host) return;
  for (const el of root.querySelectorAll(TASK_HOSTS)) {
    const node = firstTextChild(el);
    const text = node && node.textContent;
    if (!text || !LOOKS_LIKE_TASK.test(text)) continue;
    if (el.closest(IN_CODE)) continue;
    if (el.querySelector(".todoseq-keyword-formatted")) continue;
    const hit = keywordOf(text);
    if (!hit) continue;
    const before = text.slice(0, hit.at);
    const rest = text.slice(hit.at + hit.raw.length);
    const doc = el.ownerDocument;
    const kw = doc.createElement("span");
    const done = isDoneKeyword(hit.keyword);
    const heading = /^H[1-6]$/.test(el.tagName);
    const aiRecord = isAiRecordLine(el.textContent);
    kw.className =
      "todoseq-keyword-formatted" +
      (done && !aiRecord ? " todoseq-completed-keyword" : "") +
      (heading ? " todoseq-heading-task-keyword" : "");
    kw.setAttribute("data-task-keyword", hit.keyword);
    kw.textContent = hit.raw;
    const frag = doc.createDocumentFragment();
    if (before) frag.append(before);
    frag.append(kw);
    node.replaceWith(frag);
    if (!rest) continue;
    const tail = doc.createTextNode(rest);
    kw.after(tail);
    if (done && !aiRecord) wrapRemainder(doc, kw);
  }
}

export function keywordPostProcessor(plugin) {
  return (el) => {
    if (!active(plugin)) return;
    applyKeywordStyle(el);
  };
}
