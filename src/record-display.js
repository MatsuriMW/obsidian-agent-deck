// 记录留存与显示独立：收起时按最近 N 条 AI 结论展示，展开时显示全部记录。
// 编辑和阅读视图共用 ai-records.js 的选择规则；手动开合状态持久保存。

import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import { foldedRanges, unfoldEffect } from "@codemirror/language";
import {
  aiRecordGroups, recordRuns, adBlockIdRanges, hiddenBlockId,
  recordIsOpen, recordStartsOpen, visibleRecords,
} from "./ai-records.js";
import { t } from "./i18n.js";

const MODES = new Set(["collapsed", "expanded", "latest5", "latest3", "latest1"]);
const LIMITED = new Set(["latest5", "latest3", "latest1"]);

export const displayMode = (plugin) => (MODES.has(plugin.settings?.aiRecordDisplay) ? plugin.settings.aiRecordDisplay : "latest1");

const toggleRecords = StateEffect.define();
export const setRecordsOpenEffect = StateEffect.define();

// Opening or folding by hand is stored as an exception to the mode default, so
// switching modes later keeps a sane baseline.
function rememberOpen(plugin, key, open, startsOpen) {
  const expanded = (plugin.settings.aiRecordExpanded ||= {});
  const closed = (plugin.settings.aiRecordClosed ||= {});
  delete expanded[key];
  delete closed[key];
  if (open !== startsOpen) (open ? expanded : closed)[key] = true;
  plugin.saveSettings();
  plugin.refreshUI();
}

function trackedIds(plugin) {
  const ids = new Set();
  for (const day of Object.values(plugin.settings.autoLogState || {})) for (const rec of Object.values(day || {})) if (rec?.blockId) ids.add(rec.blockId);
  for (const rec of Object.values(plugin.settings.taskBindings || {})) if (rec?.blockId) ids.add(rec.blockId);
  return ids;
}

function buttonLabel(open, mode, summary) {
  if (open) return t("收起");
  return summary || LIMITED.has(mode) ? t("更多") : t("记录");
}

function recordControl(doc, count, open, mode, summary = false) {
  const el = doc.createElement("button");
  el.className = "ad-records-toggle";
  el.dataset.open = String(open);
  const arrow = el.appendChild(doc.createElement("span"));
  arrow.className = "ad-records-chevron";
  arrow.textContent = !open && LIMITED.has(mode) ? "⋯" : "›";
  arrow.setAttribute("aria-hidden", "true");
  const label = el.appendChild(doc.createElement("span"));
  label.textContent = buttonLabel(open, mode, summary);
  const badge = el.appendChild(doc.createElement("span"));
  badge.className = "ad-records-count";
  badge.textContent = String(count);
  const title = open ? t("折叠 {n} 条 AI 记录", { n: count }) : t("展开 {n} 条 AI 记录", { n: count });
  el.title = title;
  el.setAttribute("aria-label", title);
  el.type = "button";
  el.setAttribute("aria-expanded", String(open));
  return el;
}

class RecordsToggle extends WidgetType {
  constructor(key, count, open, mode, summary = false) { super(); Object.assign(this, { key, count, open, mode, summary }); }
  eq(other) { return other.key === this.key && other.count === this.count && other.open === this.open && other.mode === this.mode && other.summary === this.summary; }
  toDOM(view) {
    const el = recordControl(view.dom.ownerDocument, this.count, this.open, this.mode, this.summary);
    el.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      view.dispatch({ effects: toggleRecords.of(this.key), selection: { anchor: view.state.doc.lineAt(view.posAtDOM(el)).from } });
    };
    return el;
  }
  ignoreEvent() { return true; }
}

// The record layer owns folding for these blocks. A native fold (⌘⇧[, the list
// arrow, a leftover fold restored on open, another fold plugin's marker) would
// put Obsidian's own “…” placeholder next to our “⋯ 更多 3” button — two
// ellipses for one block. So unfold anything folded inside a managed record
// block and let our button be the only control.
export function aiRecordUnfoldExtension(plugin, refreshEffect) {
  const foldedInGroups = (view) => {
    const state = view.state;
    const folds = [];
    foldedRanges(state).between(0, state.doc.length, (from, to) => folds.push({ from, to }));
    if (!folds.length) return [];   // 没折叠就什么都不用算
    const groups = aiRecordGroups(state.doc.toString(), trackedIds(plugin));
    if (!groups.length) return [];
    const out = [];
    for (const g of groups) {
      if (!g.records.length) continue;
      const start = state.doc.line(g.line + 1).from;
      const end = state.doc.line(g.records[g.records.length - 1] + 1).to;
      for (const f of folds) {
        // 只收记录块内部的折叠；更上层（母项）的折叠是用户自己的，不碰
        if (f.from > start && f.from <= end) out.push(unfoldEffect.of(f));
      }
    }
    return out;
  };
  return ViewPlugin.fromClass(class {
    constructor(view) { this._t = setTimeout(() => this.run(view), 0); }
    update(u) {
      const touched = u.transactions.some((tr) => tr.effects.some((e) => e.is(toggleRecords) || e.is(setRecordsOpenEffect) || e.is(refreshEffect)));
      if (u.docChanged || touched) {
        clearTimeout(this._t);
        this._t = setTimeout(() => this.run(u.view), 0);
      }
    }
    run(view) {
      let effects = [];
      try { effects = foldedInGroups(view); } catch { return; }
      if (effects.length) view.dispatch({ effects });
    }
    destroy() { clearTimeout(this._t); }
  });
}

export function aiRecordDisplayExtension(plugin, refreshEffect) {
  const build = (state, mode) => {
    const ranges = [], doc = state.doc, text = doc.toString();
    const ids = trackedIds(plugin);
    const lines = text.split("\n");
    for (const { from, to } of adBlockIdRanges(text, ids)) ranges.push(Decoration.replace({}).range(from, to));
    for (const group of aiRecordGroups(text, ids)) {
      for (const n of group.records) ranges.push(Decoration.line({ class: "ad-record-line" }).range(doc.line(n + 1).from));
      const open = recordIsOpen(plugin.settings, mode, group);
      const duplicate = plugin.redundantSessionLink?.(group, lines) ?? -1;
      const available = group.records.filter(n => n !== duplicate);
      const visible = (open ? available : visibleRecords(group, lines, mode)).filter(n => n !== duplicate);
      if (available.length) ranges.push(Decoration.widget({ widget: new RecordsToggle(group.key, available.length, open, mode, group.summaries.length > 0), side: 2 }).range(doc.line(group.line + 1).to));
      const hidden = group.records.filter((n) => !visible.includes(n));
      for (const run of recordRuns(hidden)) {
        const from = Math.max(0, doc.line(run.from + 1).from - 1), to = doc.line(run.to + 1).to;
        ranges.push(Decoration.replace({ inclusive: false }).range(from, to));
      }
    }
    return Decoration.set(ranges, true);
  };
  const field = StateField.define({
    create(state) {
      const mode = displayMode(plugin);
      return { mode, decorations: build(state, mode) };
    },
    update(value, tr) {
      const mode = displayMode(plugin);
      let changed = mode !== value.mode;
      const setOpen = (keys, open) => {
        const groups = aiRecordGroups(tr.state.doc.toString(), trackedIds(plugin));
        for (const key of keys) {
          const group = groups.find((g) => g.key === key);
          rememberOpen(plugin, key, open, group ? recordStartsOpen(mode, group) : false);
        }
        changed = true;
      };
      for (const e of tr.effects) {
        if (e.is(setRecordsOpenEffect)) setOpen(e.value.keys, e.value.open);
        if (e.is(refreshEffect)) changed = true;
        if (e.is(toggleRecords)) {
          const group = aiRecordGroups(tr.state.doc.toString(), trackedIds(plugin)).find((g) => g.key === e.value);
          const open = recordIsOpen(plugin.settings, mode, group || { key: e.value, summaries: [] });
          setOpen([e.value], !open);
        }
      }
      return changed || tr.docChanged ? { mode, decorations: build(tr.state, mode) } : value;
    },
    provide: (f) => [EditorView.decorations.from(f, (v) => v.decorations), EditorView.atomicRanges.of((view) => view.state.field(f).decorations)],
  });
  plugin.aiRecordDisplayField = field;
  plugin.recordTrackedIds = () => trackedIds(plugin);
  return [field, aiRecordUnfoldExtension(plugin, refreshEffect)];
}

// Reading view only toggles visibility of the record elements; the note text is
// not touched.
export function renderAIRecords(el, plugin, ctx) {
  const mode = displayMode(plugin), ids = trackedIds(plugin), cleanups = [];
  const walker = el.ownerDocument.createTreeWalker(el, 4);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (node.parentElement?.closest("pre, code, .ad-block-id-hidden")) continue;
    const match = /(?:[ \t]+|^)\^([a-z0-9-]+)[ \t]*$/i.exec(node.textContent);
    if (!match || !hiddenBlockId(match[1], ids)) continue;
    const tail = node.splitText(match.index);
    const hidden = el.ownerDocument.createElement("span");
    hidden.className = "ad-block-id-hidden";
    tail.replaceWith(hidden); hidden.appendChild(tail);
    cleanups.push(() => hidden.replaceWith(tail));
  }
  for (const code of el.querySelectorAll("li code")) {
    if (!/^(?:session-)?[0-9a-f-]{36}$/i.test(code.textContent)) continue;
    const li = code.closest("li");
    if (!li.textContent.trim().startsWith("🔗") || !li.querySelector('a[href^="dsh:"], a[href^="antigravity:"]')) continue;
    code.classList.add("ad-block-id-hidden");
    cleanups.push(() => code.classList.remove("ad-block-id-hidden"));
  }
  for (const list of el.querySelectorAll("li ul, li ol")) {
    if (list.dataset.adRecords) continue;
    const parent = list.parentElement.closest("li");
    if (!parent) continue;
    const own = [...parent.childNodes].filter((n) => n !== list && n.nodeName !== "UL" && n.nodeName !== "OL").map((n) => n.textContent).join("");
    const records = [...list.children].filter((li) => /^(?:💬|❓|📋|⏱|🔗)\s|^TODO\s+🤖\s/.test(li.textContent.trim()));
    const section = ctx?.getSectionInfo?.(el);
    const first = section && section.text.split("\n")[(section.lineStart || 0) + (Number(parent.dataset.line) || 0)];
    const key = parent.id || parent.dataset.blockId || (first && /\s\^([A-Za-z0-9-]+)\s*$/.exec(first)?.[1]);
    const bound = records.some((li) => /^🔗\s|^💬\s+累计总结[：:]/.test(li.textContent.trim()));
    if (!records.length || !(bound || key?.startsWith("ad-") || ids.has(key) || own.includes("🤖") || parent.id?.startsWith("ad-") || ids.has(parent.id) || ids.has(parent.dataset.blockId))) continue;
    list.dataset.adRecords = "true";
    const summaries = records.filter((li) => /^💬\s+累计总结[：:]/.test(li.textContent.trim()));
    const done = /^(?:DONE|CANCELED|CANCELLED|FAILED)\b/i.test(parent.textContent.trim());
    // The selection helper works on line numbers, so the DOM list is indexed.
    const texts = records.map((li) => li.textContent.trim());
    const group = { key, records: records.map((_, i) => i), summaries: summaries.map((li) => records.indexOf(li)), state: done ? "done" : "doing" };
    const startsOpen = recordStartsOpen(mode, group);
    let open = recordIsOpen(plugin.settings, mode, group);
    const button = recordControl(list.ownerDocument, records.length, open, mode, summaries.length > 0);
    const update = () => {
      const kept = open ? group.records : visibleRecords(group, texts, mode);
      for (const [i, li] of records.entries()) {
        li.classList.add("ad-record-item");
        li.classList.toggle("ad-record-hidden", !kept.includes(i));
      }
      button.querySelector("span:nth-child(2)").textContent = buttonLabel(open, mode, summaries.length > 0);
      button.dataset.open = String(open);
      const title = open ? t("折叠 {n} 条 AI 记录", { n: records.length }) : t("展开 {n} 条 AI 记录", { n: records.length });
      button.title = title;
      button.setAttribute("aria-label", title);
      button.setAttribute("aria-expanded", String(open));
    };
    button.onclick = () => { open = !open; rememberOpen(plugin, key, open, startsOpen); update(); };
    const paragraph = parent.querySelector(":scope > p");
    if (paragraph) paragraph.appendChild(button); else list.parentNode.insertBefore(button, list);
    update();
    cleanups.push(() => { for (const li of records) li.classList.remove("ad-record-hidden", "ad-record-item"); button.remove(); delete list.dataset.adRecords; });
  }
  return () => cleanups.forEach((cleanup) => cleanup());
}
