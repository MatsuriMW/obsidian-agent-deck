// Agent Deck — the delegate button that lives on the task line.
//
// A CodeMirror widget at the end of a bound/delegated line. While a delegation is
// running the button itself becomes the progress surface: a liquid fill plus an
// elapsed clock and a cancel control. Bound sessions get a compact status pill.
//
// Drag and drop between the note and the panel also lives here:
//   · a session card dropped on a line binds it (🔗 child) or starts a new item there;
//     the target line is highlighted while dragging, with what will happen;
//   · the paragraph under the cursor gets a small arrow: click sends it (a list item goes
//     with its children, a plain paragraph goes alone) to the primary agent after a confirm,
//     double-click or ⌘-click picks the agent, drag it onto an agent card to delegate.

import { Decoration, WidgetType, ViewPlugin, EditorView } from "@codemirror/view";
import { RangeSetBuilder, StateEffect, StateField, Prec } from "@codemirror/state";
import * as J from "./journal.js";
import { agentIcon, setLucide } from "./icons.js";
import { lattice } from "./lattice.js";
import { aiRecordDisplayExtension } from "./record-display.js";
import { taskBoardExtension } from "./fractal-board.js";
import { executionStatus } from "./workflow.js";
import { AGENTS, fmtDur, fmtTok, truncate } from "./constants.js";
import { t as tr } from "./i18n.js";
import { RESULT_LINE_RE, SUB_LINE_RE, TOK_BLOCK_MAX } from "./external-state.js";
import { bindConnectedInterval } from "./runtime-guard.js";

export const refreshEffect = StateEffect.define();
export const SESSION_MIME = "application/x-agent-deck-session";
export const ITEM_MIME = "application/x-agent-deck-item";

const DROP_LABEL = { bind: "绑定", fill: "新建一项", new: "新建一项", below: "在下面新建", after: "在下面新建", merge: "合并到这一项" };
const setDrop = StateEffect.define();
const dropField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setDrop)) continue;
      if (!e.value) { deco = Decoration.none; continue; }
      const line = tr.state.doc.line(e.value.line + 1);
      deco = Decoration.set([Decoration.line({ class: `ad-drop-line ad-drop-line--${e.value.kind}`, attributes: { "data-ad-drop": tr(DROP_LABEL[e.value.kind] || "") } }).range(line.from)]);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const hasType = (e, type) => !!(e.dataTransfer && [...e.dataTransfer.types].includes(type));

function dropTarget(view, e) {
  const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }, false);
  if (pos == null) return null;
  const n = view.state.doc.lineAt(pos).number - 1;
  return J.dropKind(view.state.doc.toString().split("\n"), n, !!e.metaKey);   // 按住 ⌘：在下面新建一项，不绑这一项
}

function mergeTarget(view, e, plugin) {
  const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }, false);
  if (pos == null) return null;
  const lines = view.state.doc.toString().split("\n");
  let n = view.state.doc.lineAt(pos).number - 1;
  if (!J.kwLine(lines[n])) {
    const owner = J.markOwner(lines, n);
    if (owner >= 0 && J.kwLine(lines[owner])) n = owner;
    else return null;
  }
  const src = plugin._dragItem;
  if (src && src.line === n) return null;
  return { line: n, kind: "merge" };
}

function dndHandlers(plugin) {
  let last = "";
  const show = (view, t) => {
    const key = t ? `${t.line}:${t.kind}` : "";   // ⌘ 按下 / 松开时 kind 变了，提示跟着换
    if (key === last) return;
    last = key;
    view.dispatch({ effects: setDrop.of(t) });
  };
  return Prec.highest(EditorView.domEventHandlers({
    dragover(e, view) {
      if (hasType(e, SESSION_MIME)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "link";
        show(view, dropTarget(view, e));
        return true;
      }
      if (hasType(e, ITEM_MIME)) {
        const target = mergeTarget(view, e, plugin);
        if (!target) { show(view, null); return false; }
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        show(view, target);
        return true;
      }
      return false;
    },
    dragleave(e, view) {
      if (!hasType(e, SESSION_MIME) && !hasType(e, ITEM_MIME)) return false;
      if (e.relatedTarget && view.dom.contains(e.relatedTarget)) return false;
      show(view, null);
      return false;
    },
    drop(e, view) {
      if (hasType(e, SESSION_MIME)) {
        e.preventDefault();
        e.stopPropagation();
        const target = dropTarget(view, e);
        show(view, null);
        let data = null;
        try { data = JSON.parse(e.dataTransfer.getData(SESSION_MIME)); } catch { /* bad payload */ }
        if (data && target) plugin.bindSessionAt(view, target.line, data, { below: !!e.metaKey });
        else if (data) plugin.notice(tr("这一行放不了会话：拖到列表项、空的列表项或空行上"));
        return true;
      }
      if (hasType(e, ITEM_MIME)) {
        const target = mergeTarget(view, e, plugin);
        show(view, null);
        if (!target) return false;
        e.preventDefault();
        e.stopPropagation();
        const item = plugin.readItemDrag(e);
        if (item && item.line !== target.line) plugin.mergeTaskLines(view, item.line, target.line, item.lineText);
        return true;
      }
      return false;
    },
    // 选中一段文字拖出去：记下它从哪一行来，拖到 Agent 卡片上也能委派
    dragstart(e, view) {
      const sel = view.state.selection.main;
      if (sel.empty) return false;
      const info = view.state.field(plugin.editorInfoField, false);
      const path = info && info.file && info.file.path;
      if (!path) return false;
      const n = view.state.doc.lineAt(sel.from).number - 1;
      plugin.noteDragItem({ path, line: n, lineText: view.state.doc.line(n + 1).text });
      return false;
    },
  }));
}

// 光标所在的列表项尾巴上的小把手：单击确认后连同子块发给主力，双击或 ⌘ 单击选 Agent，拖到面板里的 Agent 卡片上也是委派
class GripWidget extends WidgetType {
  constructor(plugin, path, line, text) {
    super();
    this.plugin = plugin;
    this.path = path;
    this.line = line;
    this.text = text;
  }
  eq(o) { return o.path === this.path && o.line === this.line && o.text === this.text; }
  toDOM() {
    const el = document.createElement("span");
    el.className = "ad-grip";
    el.setAttribute("contenteditable", "false");
    el.draggable = true;
    setLucide(el, "send");
    const main = AGENTS[this.plugin.defaultTarget()] || AGENTS.claude;
    el.setAttribute("aria-label", tr("单击发给 {agent} · 双击或 ⌘ 单击选 Agent / 合并条目 · 拖到另一条任务上绑定混合", { agent: main.short }));
    const item = { path: this.path, line: this.line, lineText: this.text };
    // 单击要等一下看是不是双击，免得双击时先把任务发给了主力
    let clickTimer = null;
    el.addEventListener("mousedown", (e) => e.stopPropagation());
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.detail > 1) return;
      clearTimeout(clickTimer);
      if (e.metaKey) return this.plugin.gripPick(item, e);
      clickTimer = setTimeout(() => this.plugin.gripSend(item), 260);
    });
    el.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearTimeout(clickTimer);
      this.plugin.gripPick(item, e);
    });
    el.addEventListener("dragstart", (e) => {
      clearTimeout(clickTimer);
      e.dataTransfer.setData(ITEM_MIME, JSON.stringify(item));
      e.dataTransfer.setData("text/plain", this.text.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ""));
      e.dataTransfer.effectAllowed = "all";
      this.plugin.noteDragItem(item);
      e.stopPropagation();
    });
    return el;
  }
  ignoreEvent() { return true; }
}

function sigFor(x) {
  if (!x) return "none";
  const s = x.session;
  const td = s && s.todo;
  return [x.kind, x.job && x.job.id, x.job && x.job.state, s && s.sid, s && s.state, s && s.step, s && s.turns, s && s.tokens, td && `${td.done}/${td.total}:${td.cur || ""}`, x.todo && `${x.todo.done}/${x.todo.total}`].join("|");
}

class PillWidget extends WidgetType {
  constructor(plugin, path, line, info) {
    super();
    this.plugin = plugin;
    this.path = path;
    this.line = line;
    this.info = info;
    this.sig = sigFor(info);
  }
  eq(other) { return other.path === this.path && other.line === this.line && other.sig === this.sig; }
  toDOM(view) {
    const p = this.plugin;
    const info = this.info;
    const el = document.createElement("span");
    const background = info.job?.destination === "background";
    el.className = background ? `ad-background-progress ad-background-progress--${info.kind}` : `ad-pill ad-pill--${info.kind}`;
    el.setAttribute("contenteditable", "false");
    el.dataset.line = String(this.line);
    const job = info.job;
    const session = info.session;
    const agent = (job && job.agent) || (session && session.agent) || p.defaultTarget();
    const a = AGENTS[agent] || AGENTS.claude;
    el.style.setProperty("--ad-agent", a.color);
    el.style.setProperty("--ad-agent-soft", a.soft);

    const fill = document.createElement("span");
    fill.className = "ad-pill__fill";
    el.appendChild(fill);
    const wave = document.createElement("span");
    wave.className = "ad-pill__wave";
    el.appendChild(wave);

    const glyph = document.createElement("span");
    glyph.className = "ad-pill__glyph";
    agentIcon(glyph, agent);
    el.appendChild(glyph);

    const label = document.createElement("span");
    label.className = "ad-pill__label";
    el.appendChild(label);

    const meta = document.createElement("span");
    meta.className = "ad-pill__meta";
    el.appendChild(meta);

    const right = document.createElement("span");
    right.className = "ad-pill__right";
    el.appendChild(right);

    const modelName = (job && p.modelLabel(job.model)) || (session && p.modelLabel(session.model)) || "";
    const progText = p.sessionProgressText ? p.sessionProgressText(session, job) : "";
    if (info.kind === "idle") {
      label.textContent = tr("委派");
      meta.textContent = modelName || (agent === "dsh" ? "DeepSeek" : "Claude");
      const chev = document.createElement("span");
      chev.className = "ad-pill__chev";
      setLucide(chev, "chevron-down");
      chev.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); p.openDelegateModal(this.path, this.line); });
      right.appendChild(chev);
    } else if (info.kind === "running" || info.kind === "starting") {
      label.textContent = executionStatus(job) || (info.kind === "starting" ? tr("正在建立会话") : tr("正在执行"));
      // 等待态：Agent 图标换成点阵，准备中绕圈、委派中蛇形走，两段一眼能分开
      glyph.textContent = "";
      lattice(glyph, info.kind === "starting" ? "orbit" : "snake");
      const start = (job && job.startedAt) || (session && session.lastAt) || Date.now();
      const tick = () => {
        const dur = fmtDur(Math.max(0, Date.now() - start));
        const step = (session && session.step) || (job && job.step) || "";
        const extra = [progText, step ? truncate(step, 20) : ""].filter(Boolean).join(" · ");
        meta.textContent = extra ? `${extra} · ${dur}` : dur;
      };
      tick();
      bindConnectedInterval(el, "_adTimer", tick, 1000);
      if (job) {
        const cancel = document.createElement("span");
        cancel.className = "ad-pill__cancel";
        setLucide(cancel, "x");
        cancel.title = tr("取消");
        cancel.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); p.cancelJob(job && job.id); });
        right.appendChild(cancel);
      }
      const progress = p.jobProgress(job, session);
      if (job?.destination === "background") {
        el.setAttribute("role", "progressbar");
        el.setAttribute("aria-label", label.textContent);
      }
      if (job?.destination !== "background" && progress && progress.total) {
        el.style.setProperty("--ad-p", `${Math.round(progress.done / progress.total * 100)}%`);
        el.classList.add("is-determinate");
      }
    } else if (info.kind === "waiting" || info.kind === "needs-approval") {
      label.textContent = info.kind === "needs-approval" ? tr("等你允许") : tr("等你");
      if (progText) meta.textContent = progText;
      el.classList.add("is-pulse");
    } else if (info.kind === "done") {
      label.textContent = tr("本轮结束");
      const resText = job && job.result ? truncate(job.result, 28) : (session && session.lastText ? truncate(J.oneSentenceConclusion(session.lastText, 28), 28) : "");
      const elapsed = job?.endedAt && job?.startedAt ? fmtDur(Math.max(0, job.endedAt - job.startedAt)) : "";
      meta.textContent = [elapsed, progText, resText].filter(Boolean).join(" · ");
      const open = document.createElement("span");
      open.className = "ad-pill__open";
      setLucide(open, "arrow-up-right");
      open.title = tr("继续对话或重新委派");
      open.addEventListener("mousedown", e => { e.preventDefault(); e.stopPropagation(); p.taskActions(this.path, this.line, e); });
      right.appendChild(open);
    } else if (info.kind === "error") {
      label.textContent = tr("出错");
      const elapsed = job?.endedAt && job?.startedAt ? fmtDur(Math.max(0, job.endedAt - job.startedAt)) : "";
      meta.textContent = [elapsed, truncate((job && job.error) || (session && session.err) || "", 30)].filter(Boolean).join(" · ");
      const retry = document.createElement("span");
      retry.className = "ad-pill__open";
      setLucide(retry, "refresh-cw");
      retry.title = tr("重新委派（新会话）");
      retry.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); p.taskActions(this.path, this.line, e); });
      right.appendChild(retry);
    } else {
      label.textContent = tr("会话");
      meta.textContent = [progText, session && session.step ? truncate(session.step, 24) : ""].filter(Boolean).join(" · ");
    }

    if (session && session.tokens) {
      const tok = document.createElement("span");
      tok.className = "ad-pill__tok";
      const icon = tok.appendChild(document.createElement("span"));
      icon.setAttribute("aria-hidden", "true");
      setLucide(icon, "database");
      tok.appendChild(document.createTextNode(fmtTok(session.tokens)));
      tok.title = session.tokens.toLocaleString() + " token";
      right.appendChild(tok);
    }

    el.addEventListener("mousedown", (e) => {
      if (e.target.closest(".ad-pill__cancel, .ad-pill__chev, .ad-pill__open")) return;
      e.preventDefault();
      e.stopPropagation();
      if (info.kind === "idle") p.delegateAtLine(this.path, this.line).catch((err) => p.notice(String(err.message || err)));
      else if (info.kind === "error") p.taskActions(this.path, this.line, e);
      else p.taskActions(this.path, this.line, e);
    });
    el.title = p.pillTitle(info);
    return el;
  }
  destroy(dom) { if (dom._adTimer) clearInterval(dom._adTimer); }
  ignoreEvent() { return true; }
}

const PROG_BAR_WIDTH = 20;

function paintLineProgress(el, info) {
  const doc = el.ownerDocument;
  const win = doc.defaultView || window;
  if (!el._bar) {
    for (const k of ["bar", "pct", "tail", "tok"]) {
      el["_" + k] = doc.createElement("span");
      el["_" + k].className = "ad-prog-" + k;
      el.appendChild(el["_" + k]);
    }
    el._n = 0;
    el._i = 0;
  }
  win.clearInterval(el._timer);
  el._timer = 0;
  el.dataset.mode = info.mode;
  el.dataset.agent = info.agent || "";
  el.dataset.sid = info.sid || "";
  el.dataset.job = info.jobId || "";
  if (info.agent && AGENTS[info.agent]?.color) el.style.setProperty("--ad-prog", AGENTS[info.agent].color);
  else el.style.removeProperty("--ad-prog");
  el.classList.toggle("is-linked", !!(info.sid || info.jobId));
  el.title = info.tip + (info.sid || info.jobId ? "\n" + tr("点击打开会话 · 右键更多操作") : "");
  el._tail.textContent = (info.mode === "bar" ? "  " : " ") + info.tail;

  const tok = info.tok || 0;
  const full = Math.min(TOK_BLOCK_MAX, Math.floor(tok / 1e6));
  const part = Math.floor((tok % 1e6) / 1e5);
  if (el._tokN !== tok) {
    el._tokN = tok;
    if (!el._tokNum) {
      el._tokNum = el._tok.appendChild(doc.createElement("span"));
      el._tokRow = el._tok.appendChild(doc.createElement("span"));
      el._tokRow.className = "ad-tok-dbs";
    }
    el._tokNum.textContent = tok ? fmtTok(tok) : "";
    const row = el._tokRow;
    const want = Array.from({ length: full + part }, (_, i) => i < full);
    let keep = 0;
    while (keep < row.childElementCount && keep < want.length && row.children[keep].classList.contains("is-full") === want[keep]) keep++;
    while (row.childElementCount > keep) row.lastElementChild.remove();
    for (let i = keep; i < want.length; i++) {
      const c = row.appendChild(doc.createElement("span"));
      c.className = "ad-tok-db" + (want[i] ? " is-full" : "");
      c.style.setProperty("--ad-db-i", String(i - keep));
      setLucide(c, "database");
    }
  }
  el._tok.title = tok ? tr("{tok} tok：实心的一个 100 万，空心的一个 10 万", { tok: fmtTok(tok) }) : "";

  if (info.mode === "bar") {
    const to = Math.max(0, Math.min(PROG_BAR_WIDTH, Math.round(info.pct * PROG_BAR_WIDTH)));
    const show = (n) => {
      el._bar.textContent = "[" + "#".repeat(n) + "-".repeat(PROG_BAR_WIDTH - n) + "]";
      el._pct.textContent = " " + Math.round(n === to ? info.pct * 100 : (n / PROG_BAR_WIDTH) * 100) + "%";
    };
    show(el._n);
    if (el._n !== to) {
      el._timer = win.setInterval(() => {
        if (!el.isConnected) { win.clearInterval(el._timer); return; }
        el._n += el._n < to ? 1 : -1;
        show(el._n);
        if (el._n === to) win.clearInterval(el._timer);
      }, 28);
    }
  } else if (info.mode === "run") {
    const show = () => {
      const a = Array(PROG_BAR_WIDTH).fill(" ");
      for (let k = 0; k < 3; k++) {
        const q = (el._i % (PROG_BAR_WIDTH + 3)) - k;
        if (q >= 0 && q < PROG_BAR_WIDTH) a[q] = "#";
      }
      el._bar.textContent = "[" + a.join("") + "]";
    };
    el._pct.textContent = "";
    show();
    el._timer = win.setInterval(() => {
      if (!el.isConnected) { win.clearInterval(el._timer); return; }
      el._i++;
      show();
    }, 110);
  } else {
    el._bar.textContent = "[" + "·".repeat(PROG_BAR_WIDTH) + "]";
    el._pct.textContent = "";
  }
}

class LineProgressWidget extends WidgetType {
  constructor(plugin, path, line, info) {
    super();
    this.plugin = plugin;
    this.path = path;
    this.line = line;
    this.info = info;
    this.sig = JSON.stringify(info);
  }
  eq(other) { return other.path === this.path && other.line === this.line && other.sig === this.sig; }
  toDOM(view) {
    const el = view.dom.ownerDocument.createElement("span");
    el.className = "ad-prog";
    el.setAttribute("aria-hidden", "true");
    el.addEventListener("click", (ev) => {
      const sid = el.dataset.sid;
      const jobId = el.dataset.job;
      if (!sid && !jobId) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (jobId && this.plugin.jobs?.[jobId]) this.plugin.openJob(jobId, sid);
      else if (sid) this.plugin.openSession(el.dataset.agent || "claude", sid);
    });
    el.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.plugin.taskActions(this.path, this.line, ev);
    });
    paintLineProgress(el, this.info);
    return el;
  }
  updateDOM(dom) {
    if (!dom._bar) return false;
    paintLineProgress(dom, this.info);
    return true;
  }
  destroy(dom) { (dom.ownerDocument.defaultView || window).clearInterval(dom._timer); }
  ignoreEvent() { return true; }
}

function saidHandlers(plugin) {
  return EditorView.domEventHandlers({
    dblclick(ev, view) {
      const lineEl = ev.target && ev.target.closest && ev.target.closest(".cm-line.ad-said");
      if (!lineEl) return false;
      const doc = view.state.doc;
      const n = doc.lineAt(view.posAtDOM(lineEl)).number;
      const own = J.width(doc.line(n).text);
      for (let i = n - 1; i >= Math.max(1, n - 30); i--) {
        const lineText = doc.line(i).text;
        const w = J.width(lineText);
        const k = w === own ? J.parseLink(lineText) : null;
        if (k && k.sid) {
          ev.preventDefault();
          plugin.openSession(k.agent || "claude", k.sid);
          return true;
        }
        if (w < own && lineText.trim()) break;
      }
      return false;
    },
  });
}

function buildDecorations(view, plugin) {
  const builder = new RangeSetBuilder();
  const info = view.state.field(plugin.editorInfoField, false);
  const path = info && info.file && info.file.path;
  if (!path || !plugin.settings.showEditorPills) return builder.finish();
  const doc = view.state.doc;
  const map = plugin.lineMap(path, doc);
  const seen = new Set();
  const sel = view.state.selection.main;
  // 委派箭头只放在最近用过的那个编辑器的光标行上：点到侧栏面板里再回来，它还在
  const cursorLine = plugin._lastEditor === view && sel.empty ? doc.lineAt(sel.head).number - 1 : -1;
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      const n = line.number - 1;
      if (!seen.has(n)) {
        seen.add(n);
        const text = line.text;
        const job = plugin.jobAtLine(path, n, text);
        const session = map.sessionByParent.get(n) || null;
        // 螺旋日程已接管进度显示时，行尾不重复画 pill。
        if ((session || job?.sessionId) && plugin.nautilusOwnsLine(text, session || { sid: job.sessionId }, job?.destination !== "background")) { if (line.to >= to) break; pos = line.to + 1; continue; }
        let state = null;
        if (job && ["starting", "running"].includes(job.state)) state = { kind: job.state === "starting" ? "starting" : "running", job };
        else if (job && job.state === "needs-approval") state = { kind: "needs-approval", job, session };
        else if (job && job.state === "done") state = { kind: "done", job, session };
        else if (job && job.state === "error") state = { kind: "error", job, session };
        else if (job && job.state === "cancelled") state = null;
        else if (session) {
          const st = session.state || "idle";
          if (st === "run") state = { kind: "running", job, session };
          else if (st === "needs-approval") state = { kind: "needs-approval", job, session };
          else if (st === "wait" || st === "quiet" || st === "queued") state = { kind: "waiting", job, session };
          else if (st === "error" || st === "limit") state = { kind: "error", job, session };
          else state = { kind: "bound", job, session };
        }
        // A finished task keeps no status pill: 「正在执行」「等你」 under a line
        // that is already marked DONE is only noise.
        if (job?.destination === "background" && state?.kind === "done") state = null;
        const prog = line.length < 2000 && plugin.lineProgressInfo ? plugin.lineProgressInfo(text, map.lines, n, session, job) : null;
        if (!prog && typeof Decoration.line === "function" && (RESULT_LINE_RE.test(text) || SUB_LINE_RE.test(text))) {
          builder.add(line.from, line.from, Decoration.line({ class: "ad-said" }));
        }
        if (prog) {
          builder.add(line.to, line.to, Decoration.widget({ widget: new LineProgressWidget(plugin, path, n, prog), side: 1, block: false }));
        } else if (state && !J.isDoneLine(text)) {
          const widget = new PillWidget(plugin, path, n, state);
          builder.add(line.to, line.to, Decoration.widget({ widget, side: 1, block: false }));
        }
        // 光标所在的段落都出委派箭头：任务行、AI 记录行（💬 / ⏱ / 🔗 回传日志）、普通段落一视同仁，
        // 顶层的 AI 记录父行也照给。RangeSetBuilder 要求按 from 递增加入，所以这一段必须放在本行其他
        // 装饰（行首的 ad-said、行尾的 pill）之后，否则光标停在 💬 行上会抛 "Ranges must be added sorted"。
        if (n === cursorLine && plugin.settings.dragGrip !== false && text.trim() && !/^\s*<!--/.test(text)) {
          builder.add(line.to, line.to, Decoration.widget({ widget: new GripWidget(plugin, path, n, text), side: 1, block: false }));
        }
      }
      if (line.to >= to) break;
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

const SIMPLE_BULLET_RE = /^\s*(?:[-*+]|\d+[.)])\s/;

function cursorLineOf(view, plugin) {
  const sel = view.state.selection.main;
  return plugin._lastEditor === view && sel.empty ? view.state.doc.lineAt(sel.head).number - 1 : -1;
}

function lineHasBullet(doc, lineZero) {
  return lineZero >= 0 && lineZero < doc.lines && SIMPLE_BULLET_RE.test(doc.line(lineZero + 1).text);
}

export function createEditorExtension(plugin) {
  const pluginClass = class {
    constructor(view) {
      if (view.hasFocus) plugin._lastEditor = view;
      this._cursorLine = cursorLineOf(view, plugin);
      this.decorations = buildDecorations(view, plugin);
    }
    update(update) {
      if (update.focusChanged && update.view.hasFocus && plugin._lastEditor !== update.view) {
        const prev = plugin._lastEditor;
        plugin._lastEditor = update.view;
        if (prev && prev !== update.view) { try { prev.dispatch({ effects: refreshEffect.of(null) }); } catch { /* closed */ } }
      }
      const refresh = update.transactions.some((tr) => tr.effects.some((e) => e.is(refreshEffect)));
      if (update.docChanged || update.viewportChanged || update.focusChanged || refresh) {
        this._cursorLine = cursorLineOf(update.view, plugin);
        this.decorations = buildDecorations(update.view, plugin);
        return;
      }
      if (update.selectionSet) {
        const nextLine = cursorLineOf(update.view, plugin);
        const prevLine = this._cursorLine;
        this._cursorLine = nextLine;
        if (nextLine === prevLine || plugin.settings.dragGrip === false) return;
        const doc = update.view.state.doc;
        if (!lineHasBullet(doc, prevLine) && !lineHasBullet(doc, nextLine)) return;
        this.decorations = buildDecorations(update.view, plugin);
      }
    }
  };
  return [ViewPlugin.fromClass(pluginClass, { decorations: (v) => v.decorations }), dropField, dndHandlers(plugin), saidHandlers(plugin), aiRecordDisplayExtension(plugin, refreshEffect), taskBoardExtension(plugin, refreshEffect)];
}

export async function dispatchRefresh(plugin) {
  plugin.app.workspace.iterateAllLeaves((leaf) => {
    const view = leaf.view;
    const cm = view && view.editor && view.editor.cm;
    if (cm) { try { cm.dispatch({ effects: refreshEffect.of(null) }); } catch { /* closed */ } }
  });
}
