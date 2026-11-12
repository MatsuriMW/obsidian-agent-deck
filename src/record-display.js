import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import { aiRecordGroups, recordRuns, adBlockIdRanges } from "./ai-records.js";

const toggleRecords = StateEffect.define();
const modeFor = (plugin) => plugin.settings.aiRecordDisplay || "collapsed";
function trackedIds(plugin) {
  const ids = new Set();
  for (const day of Object.values(plugin.settings.autoLogState || {})) for (const rec of Object.values(day || {})) if (rec?.blockId) ids.add(rec.blockId);
  for (const rec of Object.values(plugin.settings.taskBindings || {})) if (rec?.blockId) ids.add(rec.blockId);
  return ids;
}

function recordControl(doc, count, open, limited = false) {
  const el = doc.createElement(limited ? "span" : "button");
  el.className = "ad-records-toggle";
  el.dataset.open = String(open);
  const arrow = el.appendChild(doc.createElement("span"));
  arrow.className = "ad-records-chevron";
  arrow.textContent = limited ? "⋯" : "›";
  arrow.setAttribute("aria-hidden", "true");
  const label = el.appendChild(doc.createElement("span"));
  label.textContent = "记录";
  const badge = el.appendChild(doc.createElement("span"));
  badge.className = "ad-records-count";
  badge.textContent = String(count);
  const title = limited ? `共 ${count} 条 AI 记录，仅显示最新 5 条` : `${open ? "折叠" : "展开"} ${count} 条 AI 记录`;
  el.title = title;
  el.setAttribute("aria-label", title);
  if (!limited) { el.type = "button"; el.setAttribute("aria-expanded", String(open)); }
  return el;
}

class RecordsToggle extends WidgetType {
  constructor(key, count, open, limited = false) { super(); Object.assign(this, { key, count, open, limited }); }
  eq(other) { return other.key === this.key && other.count === this.count && other.open === this.open && other.limited === this.limited; }
  toDOM(view) {
    const el = recordControl(view.dom.ownerDocument, this.count, this.open, this.limited);
    if (!this.limited) {
      el.onclick = (e) => { e.preventDefault(); e.stopPropagation(); view.dispatch({ effects: toggleRecords.of(this.key), selection: { anchor: view.state.doc.lineAt(view.posAtDOM(el)).from } }); };
    }
    return el;
  }
  ignoreEvent() { return true; }
}

export function aiRecordDisplayExtension(plugin, refreshEffect) {
  const build = (state, mode, toggled) => {
    const ranges = [], doc = state.doc, text = doc.toString();
    for (const { from, to } of adBlockIdRanges(text)) ranges.push(Decoration.replace({}).range(from, to));
    for (const group of aiRecordGroups(text, trackedIds(plugin))) {
      for (const n of group.records) ranges.push(Decoration.line({ class: "ad-record-line" }).range(doc.line(n + 1).from));
      const open = mode === "expanded" ? !toggled.has(group.key) : toggled.has(group.key);
      const hidden = mode === "latest5" ? group.records.slice(0, -5) : open ? [] : group.records;
      ranges.push(Decoration.widget({ widget: new RecordsToggle(group.key, group.records.length, open, mode === "latest5"), side: 2 }).range(doc.line(group.line + 1).to));
      for (const run of recordRuns(hidden)) {
        const from = Math.max(0, doc.line(run.from + 1).from - 1), to = doc.line(run.to + 1).to;
        // 用户将光标放进记录时允许编辑；边界上的任务行光标不算进入记录。
        if (state.selection.ranges.some((s) => s.empty ? s.from > from && s.from < to : s.from < to && s.to > from)) continue;
        ranges.push(Decoration.replace({ inclusive: false }).range(from, to));
      }
    }
    return Decoration.set(ranges, true);
  };
  const field = StateField.define({
    create(state) {
      const mode = modeFor(plugin), toggled = new Set();
      return { mode, toggled, decorations: build(state, mode, toggled) };
    },
    update(value, tr) {
      const mode = modeFor(plugin);
      let toggled = mode === value.mode ? value.toggled : new Set();
      let changed = mode !== value.mode;
      for (const e of tr.effects) {
        if (e.is(refreshEffect)) changed = true;
        if (e.is(toggleRecords)) {
          toggled = new Set(toggled);
          if (toggled.has(e.value)) toggled.delete(e.value); else toggled.add(e.value);
          changed = true;
        }
      }
      return changed || tr.docChanged || tr.selection ? { mode, toggled, decorations: build(tr.state, mode, toggled) } : value;
    },
    provide: (f) => [EditorView.decorations.from(f, (v) => v.decorations), EditorView.atomicRanges.of((view) => view.state.field(f).decorations)],
  });
  return field;
}

// 阅读视图只切换记录元素的可见性，不改笔记正文。
export function renderAIRecords(el, plugin) {
  const mode = modeFor(plugin), ids = trackedIds(plugin), cleanups = [];
  const walker = el.ownerDocument.createTreeWalker(el, 4);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (node.parentElement?.closest("pre, code, .ad-block-id-hidden")) continue;
    const match = /(?:[ \t]+|^)\^ad-[a-z0-9-]+[ \t]*$/i.exec(node.textContent);
    if (!match) continue;
    const tail = node.splitText(match.index);
    const hidden = el.ownerDocument.createElement("span");
    hidden.className = "ad-block-id-hidden";
    tail.replaceWith(hidden); hidden.appendChild(tail);
    cleanups.push(() => hidden.replaceWith(tail));
  }
  for (const list of el.querySelectorAll("li > ul, li > ol")) {
    if (list.dataset.adRecords) continue;
    const parent = list.parentElement;
    const own = [...parent.childNodes].filter((n) => n !== list && n.nodeName !== "UL" && n.nodeName !== "OL").map((n) => n.textContent).join("");
    const records = [...list.children].filter((li) => /^(?:💬|❓|📋|⏱|🔗)\s|^TODO\s+🤖\s/.test(li.textContent.trim()));
    const bound = records.some((li) => /^🔗\s/.test(li.textContent.trim()));
    if (!records.length || !(bound || own.includes("🤖") || parent.id?.startsWith("ad-") || ids.has(parent.id) || ids.has(parent.dataset.blockId))) continue;
    list.dataset.adRecords = "true";
    let button = recordControl(list.ownerDocument, records.length, mode === "expanded", mode === "latest5");
    let open = mode === "expanded";
    const update = () => {
      records.forEach((li, i) => { li.classList.add("ad-record-item"); li.classList.toggle("ad-record-hidden", mode === "latest5" ? i < records.length - 5 : !open); });
      button.dataset.open = String(open);
      button.title = mode === "latest5" ? "仅展示最新 5 条 AI 记录" : `${open ? "折叠" : "展开"} ${records.length} 条 AI 记录`;
      button.setAttribute("aria-label", button.title);
      button.setAttribute("aria-expanded", String(open));
    };
    if (mode !== "latest5") button.onclick = () => { open = !open; update(); };
    const paragraph = parent.querySelector(":scope > p");
    if (paragraph) paragraph.appendChild(button); else parent.insertBefore(button, list);
    update();
    cleanups.push(() => { records.forEach((li) => li.classList.remove("ad-record-hidden", "ad-record-item")); button.remove(); delete list.dataset.adRecords; });
  }
  return () => cleanups.forEach((cleanup) => cleanup());
}
