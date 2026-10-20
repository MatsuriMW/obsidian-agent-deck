// Agent Deck — the delegate button that lives on the task line.
//
// A CodeMirror widget at the end of a bound/delegated line. While a delegation is
// running the button itself becomes the progress surface: a liquid fill plus an
// elapsed clock and a cancel control. Bound sessions get a compact status pill.
//
// Drag and drop between the note and the panel also lives here:
//   · a session card dropped on a line binds it (🔗 child) or starts a new item there;
//     the target line is highlighted while dragging, with what will happen;
//   · the line under the cursor gets a small grip — drag it onto an agent card to delegate.

import { Decoration, WidgetType, ViewPlugin, EditorView } from "@codemirror/view";
import { RangeSetBuilder, StateEffect, StateField, Prec } from "@codemirror/state";
import { BULLET_RE, findLink, blockAt } from "./delegation.js";
import * as J from "./journal.js";
import { agentIcon, setLucide } from "./icons.js";
import { AGENTS, fmtDur, fmtTok, truncate } from "./constants.js";

export const refreshEffect = StateEffect.define();
export const SESSION_MIME = "application/x-agent-deck-session";
export const ITEM_MIME = "application/x-agent-deck-item";

const DROP_LABEL = { bind: "绑定到这一项", fill: "在这里新建一项", new: "在这里新建一项", below: "在下面新建一项" };
const setDrop = StateEffect.define();
const dropField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setDrop)) continue;
      if (!e.value) { deco = Decoration.none; continue; }
      const line = tr.state.doc.line(e.value.line + 1);
      deco = Decoration.set([Decoration.line({ class: `ad-drop-line ad-drop-line--${e.value.kind}`, attributes: { "data-ad-drop": DROP_LABEL[e.value.kind] || "" } }).range(line.from)]);
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
  return J.dropKind(view.state.doc.toString().split("\n"), n);
}

function dndHandlers(plugin) {
  let last = "";
  const show = (view, t) => {
    const key = t ? `${t.line}:${t.kind}` : "";
    if (key === last) return;
    last = key;
    view.dispatch({ effects: setDrop.of(t) });
  };
  return Prec.highest(EditorView.domEventHandlers({
    dragover(e, view) {
      if (!hasType(e, SESSION_MIME)) return false;
      e.preventDefault();
      e.dataTransfer.dropEffect = "link";
      show(view, dropTarget(view, e));
      return true;
    },
    dragleave(e, view) {
      if (!hasType(e, SESSION_MIME)) return false;
      if (e.relatedTarget && view.dom.contains(e.relatedTarget)) return false;
      show(view, null);
      return false;
    },
    drop(e, view) {
      if (!hasType(e, SESSION_MIME)) return false;
      e.preventDefault();
      e.stopPropagation();
      const t = dropTarget(view, e);
      show(view, null);
      let data = null;
      try { data = JSON.parse(e.dataTransfer.getData(SESSION_MIME)); } catch { /* bad payload */ }
      if (data && t) plugin.bindSessionAt(view, t.line, data);
      else if (data) plugin.notice("这一行放不了会话：拖到列表项、空的列表项或空行上");
      return true;
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

// 光标所在的列表项尾巴上的小把手：拖到面板里的 Agent 卡片上就是委派
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
    el.title = "拖到 Agent Deck 里的某个 Agent 上，委派这一项";
    setLucide(el, "grip-vertical");
    el.addEventListener("mousedown", (e) => e.stopPropagation());
    el.addEventListener("dragstart", (e) => {
      const item = { path: this.path, line: this.line, lineText: this.text };
      e.dataTransfer.setData(ITEM_MIME, JSON.stringify(item));
      e.dataTransfer.setData("text/plain", this.text.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ""));
      e.dataTransfer.effectAllowed = "copy";
      this.plugin.noteDragItem(item);
      e.stopPropagation();
    });
    return el;
  }
  ignoreEvent() { return true; }
}

function sigFor(x) {
  if (!x) return "none";
  return [x.kind, x.job && x.job.id, x.job && x.job.state, x.session && x.session.sid, x.session && x.session.state, x.session && x.session.step, x.session && x.session.tokens, x.todo && `${x.todo.done}/${x.todo.total}`].join("|");
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
    el.className = `ad-pill ad-pill--${info.kind}`;
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
    if (info.kind === "idle") {
      label.textContent = "委派";
      meta.textContent = modelName || (agent === "dsh" ? "DeepSeek" : "Claude");
      const chev = document.createElement("span");
      chev.className = "ad-pill__chev";
      setLucide(chev, "chevron-down");
      chev.title = "选择模型、强度、模式";
      chev.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); p.openDelegateModal(this.path, this.line); });
      right.appendChild(chev);
    } else if (info.kind === "running" || info.kind === "starting") {
      label.textContent = info.kind === "starting" ? "准备中" : "委派中";
      const start = (job && job.startedAt) || Date.now();
      const tick = () => { meta.textContent = fmtDur(Date.now() - start); };
      tick();
      el._adTimer = setInterval(tick, 1000);
      const cancel = document.createElement("span");
      cancel.className = "ad-pill__cancel";
      setLucide(cancel, "x");
      cancel.title = "取消这次委派";
      cancel.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); p.cancelJob(job && job.id); });
      right.appendChild(cancel);
      const progress = p.jobProgress(job);
      if (progress && progress.total) {
        el.style.setProperty("--ad-p", `${Math.round(progress.done / progress.total * 100)}%`);
        el.classList.add("is-determinate");
      }
    } else if (info.kind === "waiting" || info.kind === "needs-approval") {
      label.textContent = info.kind === "needs-approval" ? "等你允许" : "等你";
      meta.textContent = info.kind === "needs-approval" ? "打开客户端处理" : "点击打开";
      el.classList.add("is-pulse");
    } else if (info.kind === "done") {
      label.textContent = "完成";
      meta.textContent = job && job.result ? truncate(job.result, 28) : (session && session.lastText ? truncate(session.lastText, 28) : "打开会话");
      const open = document.createElement("span");
      open.className = "ad-pill__open";
      setLucide(open, "arrow-up-right");
      right.appendChild(open);
    } else if (info.kind === "error") {
      label.textContent = "出错";
      meta.textContent = truncate((job && job.error) || (session && session.err) || "点击重试", 30);
      const retry = document.createElement("span");
      retry.className = "ad-pill__open";
      setLucide(retry, "refresh-cw");
      retry.title = "重新委派";
      retry.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); p.openDelegateModal(this.path, this.line); });
      right.appendChild(retry);
    } else {
      label.textContent = "会话";
      meta.textContent = session && session.step ? truncate(session.step, 26) : "";
    }

    if (session && session.tokens) {
      const tok = document.createElement("span");
      tok.className = "ad-pill__tok";
      tok.textContent = fmtTok(session.tokens);
      right.appendChild(tok);
    }

    el.addEventListener("mousedown", (e) => {
      if (e.target.closest(".ad-pill__cancel, .ad-pill__chev, .ad-pill__open")) return;
      e.preventDefault();
      e.stopPropagation();
      if (info.kind === "idle") p.delegateAtLine(this.path, this.line).catch((err) => p.notice(String(err.message || err)));
      else if (info.kind === "error") p.openDelegateModal(this.path, this.line);
      else p.openJob(job && job.id, session && session.sid);
    });
    el.title = p.pillTitle(info);
    return el;
  }
  destroy(dom) { if (dom._adTimer) clearInterval(dom._adTimer); }
  ignoreEvent() { return true; }
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
  // 把手只放在最近用过的那个编辑器的光标行上：点到侧栏面板里再回来拖，它还在
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
        let state = null;
        if (job && ["starting", "running"].includes(job.state)) state = { kind: job.state === "starting" ? "starting" : "running", job };
        else if (job && job.state === "needs-approval") state = { kind: "needs-approval", job, session };
        else if (job && job.state === "done") state = { kind: "done", job, session };
        else if (job && job.state === "error") state = { kind: "error", job, session };
        else if (job && job.state === "cancelled") state = null;
        else if (session) {
          const st = session.state || "idle";
          if (st === "run") state = { kind: "running", job, session };
          else if (st === "wait" || st === "quiet") state = { kind: "waiting", job, session };
          else if (st === "error" || st === "limit") state = { kind: "error", job, session };
          else state = { kind: "bound", job, session };
        }
        if (state) {
          const widget = new PillWidget(plugin, path, n, state);
          builder.add(line.to, line.to, Decoration.widget({ widget, side: 1, block: false }));
        } else if (n === cursorLine && plugin.views.size && plugin.settings.dragGrip !== false && BULLET_RE.test(text) && J.kwLine(text)) {
          builder.add(line.to, line.to, Decoration.widget({ widget: new GripWidget(plugin, path, n, text), side: 1, block: false }));
        }
      }
      if (line.to >= to) break;
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

export function createEditorExtension(plugin) {
  const pluginClass = class {
    constructor(view) { if (view.hasFocus) plugin._lastEditor = view; this.decorations = buildDecorations(view, plugin); }
    update(update) {
      if (update.focusChanged && update.view.hasFocus && plugin._lastEditor !== update.view) {
        const prev = plugin._lastEditor;
        plugin._lastEditor = update.view;
        if (prev && prev !== update.view) { try { prev.dispatch({ effects: refreshEffect.of(null) }); } catch { /* closed */ } }
      }
      const refresh = update.transactions.some((tr) => tr.effects.some((e) => e.is(refreshEffect)));
      if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged || refresh) this.decorations = buildDecorations(update.view, plugin);
    }
  };
  return [ViewPlugin.fromClass(pluginClass, { decorations: (v) => v.decorations }), dropField, dndHandlers(plugin)];
}

export async function dispatchRefresh(plugin) {
  plugin.app.workspace.iterateAllLeaves((leaf) => {
    const view = leaf.view;
    const cm = view && view.editor && view.editor.cm;
    if (cm) { try { cm.dispatch({ effects: refreshEffect.of(null) }); } catch { /* closed */ } }
  });
}
