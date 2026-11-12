import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import { aiRecordGroups, recordRuns } from "./ai-records.js";

const toggleRecords = StateEffect.define();
const modeFor = (plugin) => plugin.settings.aiRecordDisplay || "collapsed";
function trackedIds(plugin) {
  const ids = new Set();
  for (const day of Object.values(plugin.settings.autoLogState || {})) for (const rec of Object.values(day || {})) if (rec?.blockId) ids.add(rec.blockId);
  for (const rec of Object.values(plugin.settings.taskBindings || {})) if (rec?.blockId) ids.add(rec.blockId);
  return ids;
}

class RecordsToggle extends WidgetType {
  constructor(key, count, open, limited = false) { super(); Object.assign(this, { key, count, open, limited }); }
  eq(other) { return other.key === this.key && other.count === this.count && other.open === this.open && other.limited === this.limited; }
  toDOM(view) {
    const el = view.dom.ownerDocument.createElement(this.limited ? "span" : "button");
    el.className = "ad-records-toggle";
    el.textContent = this.limited ? `已隐藏更早的 ${this.count} 条 AI 记录` : `AI 记录 · ${this.count} 条 · ${this.open ? "折叠" : "展开"}`;
    if (!this.limited) {
      el.type = "button";
      el.setAttribute("aria-expanded", String(this.open));
      el.onclick = (e) => { e.preventDefault(); view.dispatch({ effects: toggleRecords.of(this.key), selection: { anchor: Math.max(0, view.posAtDOM(el) - 1) } }); };
    }
    return el;
  }
  ignoreEvent() { return true; }
}

export function aiRecordDisplayExtension(plugin, refreshEffect) {
  const build = (state, mode, toggled) => {
    const ranges = [], doc = state.doc;
    for (const group of aiRecordGroups(doc.toString(), trackedIds(plugin))) {
      const open = mode === "expanded" ? !toggled.has(group.key) : toggled.has(group.key);
      const hidden = mode === "latest5" ? group.records.slice(0, -5) : open ? [] : group.records;
      if (!hidden.length) {
        if (mode !== "latest5") ranges.push(Decoration.widget({ widget: new RecordsToggle(group.key, group.records.length, true), block: true, side: -1 }).range(doc.line(group.records[0] + 1).from));
        continue;
      }
      for (const run of recordRuns(hidden)) {
        const from = doc.line(run.from + 1).from, to = doc.line(run.to + 1).to;
        // 用户把光标放进记录时允许编辑，不在正在编辑的地方盖住文字。
        if (state.selection.ranges.some((s) => s.from <= to && s.to >= from)) continue;
        ranges.push(Decoration.replace({ widget: new RecordsToggle(group.key, run.to - run.from + 1, false, mode === "latest5"), block: true }).range(from, to));
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
    provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
  });
  return field;
}

// 阅读视图只切换记录元素的可见性，不改笔记正文。
export function renderAIRecords(el, plugin) {
  const mode = modeFor(plugin), ids = trackedIds(plugin), cleanups = [];
  for (const list of el.querySelectorAll("li > ul, li > ol")) {
    if (list.dataset.adRecords) continue;
    const parent = list.parentElement;
    const own = [...parent.childNodes].filter((n) => n !== list && n.nodeName !== "UL" && n.nodeName !== "OL").map((n) => n.textContent).join("");
    const records = [...list.children].filter((li) => /^(?:💬|❓|📋|⏱|🔗)\s|^TODO\s+🤖\s/.test(li.textContent.trim()));
    const bound = records.some((li) => /^🔗\s/.test(li.textContent.trim()));
    if (!records.length || !(bound || own.includes("🤖") || parent.id?.startsWith("ad-") || ids.has(parent.id) || ids.has(parent.dataset.blockId))) continue;
    list.dataset.adRecords = "true";
    const button = list.ownerDocument.createElement("button");
    button.className = "ad-records-toggle";
    let open = mode === "expanded";
    const update = () => {
      records.forEach((li, i) => { li.classList.toggle("ad-record-hidden", mode === "latest5" ? i < records.length - 5 : !open); });
      button.textContent = mode === "latest5" ? `AI 记录 · 仅展示最新 ${Math.min(5, records.length)} 条` : `AI 记录 · ${records.length} 条 · ${open ? "折叠" : "展开"}`;
      button.setAttribute("aria-expanded", String(open));
    };
    button.onclick = () => { open = !open; update(); };
    button.disabled = mode === "latest5";
    parent.insertBefore(button, list);
    update();
    cleanups.push(() => { records.forEach((li) => li.classList.remove("ad-record-hidden")); button.remove(); delete list.dataset.adRecords; });
  }
  return () => cleanups.forEach((cleanup) => cleanup());
}
