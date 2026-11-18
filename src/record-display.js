// 记录留存与显示独立：收起时按最近 N 条 AI 结论展示，展开时显示全部记录。
// 编辑和阅读视图共用 ai-records.js 的选择规则；手动开合状态持久保存。

import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { foldedRanges, foldEffect, unfoldEffect } from "@codemirror/language";
import {
  aiRecordGroups, recordRuns, adBlockIdRanges, layoutMarkerRanges, hiddenBlockId, redirectHiddenTailTransaction,
  recordIsOpen, recordStartsOpen, visibleRecords, visibleTableEntries, RECORD_VIEWS, RECORD_MARKER_BODY_RE,
  recordViewMode, recordViewLabel, recordBadgeLabel, recordStepLabel, timelineSpanMeta, footerMetaText,
  buildTableModel, buildGroupTableRows, tokenizeInlineMarkdown, isBriefRecord, isPinnedLine,
  trackedBlockIds, blockSessionMap, formatTimelineAt, formatTimelineFull,
} from "./ai-records.js";
import { isDeckBlockId, hasPinMarker, togglePinMarker, CONTEXT_RECORD_RE, RECORD_LINE_RE } from "./journal.js";
import { t } from "./i18n.js";

const MODES = new Set(["collapsed", "expanded", "latest5", "latest3", "latest1"]);
const LIMITED = new Set(["latest5", "latest3", "latest1"]);

export const displayMode = (plugin) => (MODES.has(plugin.settings?.aiRecordDisplay) ? plugin.settings.aiRecordDisplay : "latest1");

const toggleRecords = StateEffect.define();
export const setRecordsOpenEffect = StateEffect.define();
export const setRecordViewEffect = StateEffect.define();

const groupPrefKeys = (key, stableKey = "") => [key, stableKey].filter((k, i, arr) => k && arr.indexOf(k) === i);

// Opening or folding by hand is stored as an exception to the mode default, so
// switching modes later keeps a sane baseline.
function rememberOpen(plugin, key, open, startsOpen, stableKey = "") {
  const expanded = (plugin.settings.aiRecordExpanded ||= {});
  const closed = (plugin.settings.aiRecordClosed ||= {});
  for (const k of groupPrefKeys(key, stableKey)) {
    delete expanded[k];
    delete closed[k];
    if (open !== startsOpen) (open ? expanded : closed)[k] = true;
  }
  plugin.saveSettings();
  plugin.refreshUI();
}

function rememberView(plugin, key, viewMode, stableKey = "") {
  const views = (plugin.settings.aiRecordViews ||= {});
  const keys = groupPrefKeys(key, stableKey);
  if (viewMode && viewMode !== "outline" && RECORD_VIEWS.has(viewMode)) {
    for (const k of keys) views[k] = viewMode;
  } else {
    for (const k of keys) delete views[k];
  }
  plugin.saveSettings();
  plugin.refreshUI();
}

const trackedIds = (plugin) => trackedBlockIds(plugin);

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

function createPinButton(doc, pinned, onToggle) {
  const btn = doc.createElement("button");
  btn.type = "button";
  btn.className = "ad-record-pin-btn" + (pinned ? " is-on" : "");
  btn.setAttribute("aria-pressed", String(Boolean(pinned)));
  const title = pinned
    ? t("已 Pin：折叠时不隐藏，Dreaming 优先记忆（点击取消）")
    : t("Pin 此条关键记录（折叠不隐藏 · Dreaming 优先）");
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.textContent = "📌";
  btn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onToggle(btn);
  });
  return btn;
}

function toggleLinePinInView(view, lineIndex, plugin, sourcePath) {
  if (view?.state?.doc && lineIndex >= 0 && lineIndex < view.state.doc.lines) {
    const lineObj = view.state.doc.line(lineIndex + 1);
    const next = togglePinMarker(lineObj.text);
    if (next !== lineObj.text) {
      view.dispatch({ changes: { from: lineObj.from, to: lineObj.to, insert: next } });
    }
    return;
  }
  if (sourcePath && plugin?.toggleRecordPin) plugin.toggleRecordPin(sourcePath, lineIndex);
}

class RecordPinWidget extends WidgetType {
  constructor(plugin, sourcePath, line, pinned) {
    super();
    Object.assign(this, { plugin, sourcePath, line, pinned });
  }
  eq(other) { return other.line === this.line && other.pinned === this.pinned && other.sourcePath === this.sourcePath; }
  toDOM(view) {
    return createPinButton(view.dom.ownerDocument, this.pinned, () => toggleLinePinInView(view, this.line, this.plugin, this.sourcePath));
  }
  ignoreEvent() { return true; }
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

const EMPTY_VIEW_LABELS = {
  table: "表格视图 · 已收起 {n} 条记录",
  cards: "卡片视图 · 已收起 {n} 条记录",
  timeline: "时间线视图 · 已收起 {n} 条记录",
};
const VIEW_FALLBACK_ICON = {
  outline: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M5 4h8M5 8h8M5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01"/></svg>',
  table: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 6.5h12M6.5 6.5V13"/></svg>',
  cards: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="2" y="2.5" width="5" height="4.5" rx="1"/><rect x="9" y="2.5" width="5" height="4.5" rx="1"/><rect x="2" y="9" width="5" height="4.5" rx="1"/><rect x="9" y="9" width="5" height="4.5" rx="1"/></svg>',
  timeline: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M5 3v10M5 4.5h8M5 8h6M5 11.5h8"/></svg>',
};

function renderInlineText(doc, container, text, sourcePath, plugin) {
  for (const tok of tokenizeInlineMarkdown(text)) {
    if (tok.type === "text") {
      container.appendChild(doc.createTextNode(tok.text));
    } else if (tok.type === "link") {
      const a = doc.createElement("a");
      a.className = "ad-rt-link";
      a.textContent = tok.label;
      a.href = tok.href;
      a.title = tok.href;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        plugin.openRecordLink?.(tok.href, sourcePath);
      });
      container.appendChild(a);
    } else if (tok.type === "wikilink") {
      const span = doc.createElement("span");
      span.className = "ad-wikilink";
      span.textContent = tok.label;
      container.appendChild(span);
    } else if (tok.type === "code") {
      const code = doc.createElement("code");
      code.className = "ad-rt-code";
      code.textContent = tok.text;
      container.appendChild(code);
    } else if (tok.type === "bold") {
      const strong = doc.createElement("strong");
      strong.textContent = tok.text;
      container.appendChild(strong);
    } else if (tok.type === "italic") {
      const em = doc.createElement("em");
      em.textContent = tok.text;
      container.appendChild(em);
    }
  }
}

class ViewToggleWidget extends WidgetType {
  constructor(plugin, key, line, viewMode) {
    super();
    this.plugin = plugin;
    this.key = key;
    this.line = line;
    this.viewMode = viewMode;
  }
  eq(other) { return other.key === this.key && other.line === this.line && other.viewMode === this.viewMode; }
  toDOM(view) {
    const doc = view.dom.ownerDocument;
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "ad-view-toggle";
    btn.dataset.view = this.viewMode;
    btn.title = t("切换 AI 记录展示形式");
    btn.setAttribute("aria-label", t("切换 AI 记录展示形式"));
    btn.setAttribute("aria-haspopup", "menu");

    const ico = btn.appendChild(doc.createElement("span"));
    ico.className = "ad-view-toggle__ico";
    ico.setAttribute("aria-hidden", "true");
    if (this.plugin.setRecordViewIcon) this.plugin.setRecordViewIcon(ico, this.viewMode);
    else ico.innerHTML = VIEW_FALLBACK_ICON[this.viewMode] || VIEW_FALLBACK_ICON.outline;

    const label = btn.appendChild(doc.createElement("span"));
    label.className = "ad-view-toggle__label";
    label.textContent = recordViewLabel(this.viewMode);

    const chev = btn.appendChild(doc.createElement("span"));
    chev.className = "ad-view-toggle__chev";
    chev.textContent = "▾";
    chev.setAttribute("aria-hidden", "true");

    btn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const select = (nextView) => {
        if (nextView === this.viewMode) return;
        view.dispatch({ effects: setRecordViewEffect.of({ key: this.key, view: nextView }) });
      };
      if (this.plugin.openRecordViewMenu) {
        const info = view.state.field?.(this.plugin.editorInfoField, false);
        const path = info?.file?.path || "";
        this.plugin.openRecordViewMenu(e, { path, line: this.line, key: this.key, viewMode: this.viewMode, onSelect: select });
      } else {
        select(this.viewMode === "table" ? "outline" : "table");
      }
    });
    return btn;
  }
  ignoreEvent() { return true; }
}

class RecordViewWidget extends WidgetType {
  constructor(plugin, viewMode, key, groupLine, rows, totalCount, open, mode, sourcePath) {
    super();
    this.plugin = plugin;
    this.viewMode = viewMode;
    this.key = key;
    this.groupLine = groupLine;
    this.rows = rows;
    this.totalCount = totalCount;
    this.open = open;
    this.mode = mode;
    this.sourcePath = sourcePath;
    this.model = buildTableModel(rows);
    this.sig = `${viewMode}|${key}|${open}|${mode}|${totalCount}|${rows.map((r) => `${r.line}:${r.startedAt || 0}:${r.sig}`).join("\n")}`;
  }
  eq(other) { return other.sig === this.sig && other.sourcePath === this.sourcePath; }
  jumpTo(view, line) {
    const stDoc = view.state.doc;
    const target = Math.min(Math.max(0, line), Math.max(0, (stDoc.lines || 1) - 1));
    const lineObj = stDoc.line(target + 1);
    const leading = (/^\s*/.exec(lineObj.text || "") || [""])[0].length;
    const effects = [setRecordViewEffect.of({ key: this.key, view: "outline" })];
    if (!this.open) effects.push(setRecordsOpenEffect.of({ keys: [this.key], open: true }));
    view.dispatch({
      effects,
      selection: { anchor: lineObj.from + leading },
      scrollIntoView: true,
    });
    view.focus?.();
  }
  bindJump(el, view, line) {
    el.addEventListener("click", (e) => {
      if (e.target.closest("a, button")) return;
      e.preventDefault();
      e.stopPropagation();
      this.jumpTo(view, line);
    });
  }
  renderRoundMarker(doc, parent, row) {
    if (row.type === "span" || row.round == null) {
      const badge = parent.appendChild(doc.createElement("span"));
      badge.className = `ad-rt-badge ad-rt-badge--${row.badgeKind || "result"}`;
      badge.textContent = recordBadgeLabel(row.badgeKind, row.badge);
      return badge;
    }
    const label = parent.appendChild(doc.createElement("span"));
    label.className = "ad-rt-round-num";
    label.textContent = `#${row.round}`;
    return label;
  }
  appendStepTag(doc, parent, row) {
    const label = recordStepLabel(row);
    if (!label) return;
    const stepTag = parent.appendChild(doc.createElement("span"));
    stepTag.className = "ad-rt-step";
    stepTag.textContent = label;
  }
  appendPinButton(doc, view, parent, row) {
    if (!Number.isInteger(row?.pinLine) || row.pinLine < 0) return;
    const btn = createPinButton(doc, Boolean(row.pinned), () => toggleLinePinInView(view, row.pinLine, this.plugin, this.sourcePath));
    parent.appendChild(btn);
  }
  appendChildren(doc, view, td, children) {
    if (!children?.length) return;
    const subToggle = td.appendChild(doc.createElement("button"));
    subToggle.type = "button";
    subToggle.className = "ad-rt-sub-toggle";
    subToggle.setAttribute("aria-expanded", "false");
    subToggle.textContent = `▸ ${t("{n} 条子项", { n: children.length })}`;
    const subList = td.appendChild(doc.createElement("div"));
    subList.className = "ad-rt-sub-list";
    subList.hidden = true;
    for (const child of children) {
      const item = subList.appendChild(doc.createElement("div"));
      item.className = "ad-rt-sub-item";
      if (child.level) item.style.paddingLeft = `${child.level * 14}px`;
      renderInlineText(doc, item, child.text, this.sourcePath, this.plugin);
    }
    subToggle.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const expanded = subList.hidden;
      subList.hidden = !expanded;
      subToggle.setAttribute("aria-expanded", String(expanded));
      subToggle.textContent = `${expanded ? "▾" : "▸"} ${t("{n} 条子项", { n: children.length })}`;
      view.requestMeasure?.();
    });
  }
  renderTable(doc, view, wrap, { rows, hasPromptCol }) {
    const table = wrap.appendChild(doc.createElement("table"));
    table.className = "ad-record-table";
    const thead = table.appendChild(doc.createElement("thead"));
    const headRow = thead.appendChild(doc.createElement("tr"));
    const cols = hasPromptCol
      ? [t("轮次"), t("任务 / 提问"), t("结论 / 回复")]
      : [t("轮次"), t("结论 / 回复")];
    for (const col of cols) {
      const th = headRow.appendChild(doc.createElement("th"));
      th.textContent = col;
    }
    const tbody = table.appendChild(doc.createElement("tbody"));
    for (const row of rows) {
      const tr = tbody.appendChild(doc.createElement("tr"));
      tr.className = "ad-rt-row";
      tr.title = t("点击定位并回到原块编辑");
      const tdRound = tr.appendChild(doc.createElement("td"));
      tdRound.className = "ad-rt-round";
      this.renderRoundMarker(doc, tdRound, row);
      this.appendPinButton(doc, view, tdRound, row);
      if (row.pinned) tr.classList.add("is-pinned");
      if (row.type === "span") {
        const tdSpan = tr.appendChild(doc.createElement("td"));
        tdSpan.className = "ad-rt-span";
        tdSpan.colSpan = hasPromptCol ? 2 : 1;
        const textEl = tdSpan.appendChild(doc.createElement("div"));
        textEl.className = "ad-rt-text";
        renderInlineText(doc, textEl, row.conclusion, this.sourcePath, this.plugin);
        this.appendChildren(doc, view, tdSpan, row.children);
      } else {
        if (hasPromptCol) {
          const tdPrompt = tr.appendChild(doc.createElement("td"));
          tdPrompt.className = "ad-rt-prompt";
          this.appendStepTag(doc, tdPrompt, row);
          if (row.prompt) {
            const pEl = tdPrompt.appendChild(doc.createElement("div"));
            pEl.className = "ad-rt-text";
            renderInlineText(doc, pEl, row.prompt, this.sourcePath, this.plugin);
          }
          this.bindJump(tdPrompt, view, row.promptLine ?? row.line);
        }
        const tdConclusion = tr.appendChild(doc.createElement("td"));
        tdConclusion.className = "ad-rt-conclusion";
        if (row.conclusion) {
          const cEl = tdConclusion.appendChild(doc.createElement("div"));
          cEl.className = "ad-rt-text";
          renderInlineText(doc, cEl, row.conclusion, this.sourcePath, this.plugin);
        }
        this.appendChildren(doc, view, tdConclusion, row.children);
      }
      this.bindJump(tr, view, row.conclusionLine ?? row.line);
    }
  }
  renderCards(doc, view, wrap, { rows }) {
    const grid = wrap.appendChild(doc.createElement("div"));
    grid.className = "ad-rt-cards";
    for (const row of rows) {
      const card = grid.appendChild(doc.createElement("div"));
      card.className = `ad-rt-card${row.type === "span" ? " is-span" : ""}${row.pinned ? " is-pinned" : ""}`;
      card.title = t("点击定位并回到原块编辑");
      const head = card.appendChild(doc.createElement("div"));
      head.className = "ad-rt-card__head";
      this.renderRoundMarker(doc, head, row);
      this.appendStepTag(doc, head, row);
      this.appendPinButton(doc, view, head, row);
      if (row.prompt) {
        const promptEl = card.appendChild(doc.createElement("div"));
        promptEl.className = "ad-rt-card__prompt";
        renderInlineText(doc, promptEl, row.prompt, this.sourcePath, this.plugin);
        this.bindJump(promptEl, view, row.promptLine ?? row.line);
      }
      if (row.conclusion || row.children?.length) {
        const body = card.appendChild(doc.createElement("div"));
        body.className = "ad-rt-card__body";
        if (row.conclusion) {
          const textEl = body.appendChild(doc.createElement("div"));
          textEl.className = "ad-rt-text";
          renderInlineText(doc, textEl, row.conclusion, this.sourcePath, this.plugin);
        }
        this.appendChildren(doc, view, body, row.children);
      }
      this.bindJump(card, view, row.conclusionLine ?? row.line);
    }
  }
  renderTimeline(doc, view, wrap, { rows }) {
    const { timed, dated } = timelineSpanMeta(rows);
    const list = wrap.appendChild(doc.createElement("div"));
    list.className = "ad-rt-timeline" + (timed ? " ad-rt-timeline--timed" : "") + (dated ? " ad-rt-timeline--dated" : "");
    for (const row of rows) {
      const item = list.appendChild(doc.createElement("div"));
      item.className = `ad-rt-tl-item ad-rt-tl-item--${row.badgeKind || "result"}${row.pinned ? " is-pinned" : ""}`;
      item.title = t("点击定位并回到原块编辑");
      const dot = item.appendChild(doc.createElement("span"));
      dot.className = "ad-rt-tl-dot";
      dot.setAttribute("aria-hidden", "true");
      if (row.startedAt > 0) {
        const timeEl = item.appendChild(doc.createElement("time"));
        timeEl.className = "ad-rt-tl-time";
        timeEl.setAttribute("datetime", new Date(row.startedAt).toISOString());
        timeEl.textContent = formatTimelineAt(row.startedAt, dated);
        timeEl.title = t("提问时间：{time}", { time: formatTimelineFull(row.startedAt) });
      }
      const head = item.appendChild(doc.createElement("div"));
      head.className = "ad-rt-tl-head";
      this.renderRoundMarker(doc, head, row);
      this.appendStepTag(doc, head, row);
      this.appendPinButton(doc, view, head, row);
      if (row.prompt) {
        const promptEl = item.appendChild(doc.createElement("div"));
        promptEl.className = "ad-rt-tl-prompt";
        renderInlineText(doc, promptEl, row.prompt, this.sourcePath, this.plugin);
        this.bindJump(promptEl, view, row.promptLine ?? row.line);
      }
      if (row.conclusion || row.children?.length) {
        const replyEl = item.appendChild(doc.createElement("div"));
        replyEl.className = "ad-rt-tl-reply";
        if (row.conclusion) {
          const textEl = replyEl.appendChild(doc.createElement("div"));
          textEl.className = "ad-rt-text";
          renderInlineText(doc, textEl, row.conclusion, this.sourcePath, this.plugin);
        }
        this.appendChildren(doc, view, replyEl, row.children);
      }
      this.bindJump(item, view, row.conclusionLine ?? row.line);
    }
  }
  renderFooter(doc, view, wrap, footer) {
    if (!footer.length) return;
    const foot = wrap.appendChild(doc.createElement("div"));
    foot.className = "ad-rt-footer";
    for (const item of footer) {
      const lineEl = foot.appendChild(doc.createElement("div"));
      lineEl.className = "ad-rt-footer-item";
      lineEl.title = t("点击定位并回到原块编辑");
      const icon = lineEl.appendChild(doc.createElement("span"));
      icon.className = "ad-rt-footer-ico";
      icon.textContent = item.kind === "clock" ? "⏱" : "🔗";
      const body = lineEl.appendChild(doc.createElement("span"));
      body.className = "ad-rt-footer-body";
      renderInlineText(doc, body, item.content, this.sourcePath, this.plugin);
      const metaText = footerMetaText(item);
      if (metaText) {
        const metaEl = lineEl.appendChild(doc.createElement("span"));
        metaEl.className = "ad-rt-footer-meta";
        metaEl.textContent = metaText;
      }
      this.bindJump(lineEl, view, item.line);
    }
  }
  toDOM(view) {
    const doc = view.dom.ownerDocument;
    const wrap = doc.createElement("div");
    wrap.className = "ad-record-table-wrap ad-record-view-wrap";
    wrap.dataset.view = this.viewMode;
    wrap.setAttribute("contenteditable", "false");

    const { rows, footer } = this.model;
    if (!rows.length && !footer.length) {
      const bar = wrap.appendChild(doc.createElement("div"));
      bar.className = "ad-record-table-empty";
      const note = bar.appendChild(doc.createElement("span"));
      note.textContent = t(EMPTY_VIEW_LABELS[this.viewMode] || EMPTY_VIEW_LABELS.table, { n: this.totalCount });
      const expand = bar.appendChild(doc.createElement("button"));
      expand.type = "button";
      expand.className = "ad-record-table-expand";
      expand.textContent = t("展开");
      expand.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        view.dispatch({ effects: setRecordsOpenEffect.of({ keys: [this.key], open: true }) });
      });
      return wrap;
    }

    if (rows.length) {
      const renderer = this.viewMode === "cards"
        ? this.renderCards
        : this.viewMode === "timeline"
          ? this.renderTimeline
          : this.renderTable;
      renderer.call(this, doc, view, wrap, this.model);
    }
    this.renderFooter(doc, view, wrap, footer);
    return wrap;
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
      const start = state.doc.line(g.records[0] + 1).from;
      const end = state.doc.line(g.records[g.records.length - 1] + 1).to;
      for (const f of folds) {
        // 只收记录块内部的折叠；母项自身与更上层的折叠是用户自己的，不碰
        if (f.from >= start && f.from <= end) out.push(unfoldEffect.of(f));
      }
    }
    return out;
  };
  return ViewPlugin.fromClass(class {
    constructor(view) { this._t = setTimeout(() => this.run(view), 0); }
    update(u) {
      const touched = u.transactions.some((tr) => tr.effects.some((e) => e.is(toggleRecords) || e.is(setRecordsOpenEffect) || e.is(setRecordViewEffect) || e.is(refreshEffect)));
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
    const topLevelLines = new Set();
    const info = state.field?.(plugin.editorInfoField, false);
    const sourcePath = info?.file?.path || "";
    const agentNames = plugin.agentShortNames || null;
    let sidsByBlock = null;
    for (const { from, to } of adBlockIdRanges(text, ids)) ranges.push(Decoration.replace({}).range(from, to));
    for (const { from, to } of layoutMarkerRanges(text)) ranges.push(Decoration.replace({ inclusive: false }).range(from, to));
    for (const group of aiRecordGroups(text, ids)) {
      const open = recordIsOpen(plugin.settings, mode, group);
      const duplicate = plugin.redundantSessionLink?.(group, lines) ?? -1;
      const available = group.records.filter(n => n !== duplicate);
      const tableAll = (group.tableEntries || []).filter(e => e.line !== duplicate);
      const isTopLevel = Boolean(group.topLevel) && tableAll.length > 0;
      const viewMode = isTopLevel ? recordViewMode(plugin.settings, group) : "outline";
      if (isTopLevel) topLevelLines.add(group.line);

      if (viewMode !== "outline") {
        const visibleEntries = visibleTableEntries(group, lines, mode, open, duplicate);
        const rows = buildGroupTableRows(group, visibleEntries, lines, plugin, {
          includeTime: viewMode === "timeline",
          blockMap: viewMode === "timeline" ? (sidsByBlock ||= blockSessionMap(plugin)) : null,
          agentNames,
        });
        const summaryCount = tableAll.filter((e) => /💬\s+累计总结[：:]/.test(lines[e.line])).length;
        ranges.push(Decoration.widget({ widget: new RecordsToggle(group.key, tableAll.length, open, mode, summaryCount > 0), side: 2 }).range(doc.line(group.line + 1).to));
        ranges.push(Decoration.widget({ widget: new ViewToggleWidget(plugin, group.key, group.line, viewMode), side: 3 }).range(doc.line(group.line + 1).to));
        ranges.push(Decoration.widget({
          widget: new RecordViewWidget(plugin, viewMode, group.key, group.line, rows, tableAll.length, open, mode, sourcePath),
          block: true,
          side: 1,
        }).range(doc.line(group.line + 1).to));
        const hiddenLines = [...new Set((group.tableEntries || []).flatMap((e) => e.lineNumbers))].sort((a, b) => a - b);
        for (const run of recordRuns(hiddenLines)) {
          const from = Math.max(0, doc.line(run.from + 1).from - 1), to = doc.line(run.to + 1).to;
          ranges.push(Decoration.replace({ inclusive: false }).range(from, to));
        }
        continue;
      }

      const visible = (open ? available : visibleRecords(group, lines, mode)).filter(n => n !== duplicate);
      const visibleSet = new Set(visible);
      if (available.length) ranges.push(Decoration.widget({ widget: new RecordsToggle(group.key, available.length, open, mode, group.summaries.length > 0), side: 2 }).range(doc.line(group.line + 1).to));
      if (isTopLevel) ranges.push(Decoration.widget({ widget: new ViewToggleWidget(plugin, group.key, group.line, viewMode), side: 3 }).range(doc.line(group.line + 1).to));
      const recordSet = new Set(group.records);
      for (const n of group.records) {
        const pinned = isPinnedLine(lines[n]);
        ranges.push(Decoration.line({
          class: "ad-record-line"
            + (!open && isBriefRecord(lines[n]) ? " ad-record-brief-clamped" : "")
            + (pinned ? " ad-record-line--pinned" : ""),
        }).range(doc.line(n + 1).from));
        if (visibleSet.has(n) && (pinned || (open && CONTEXT_RECORD_RE.test(lines[n])))) {
          ranges.push(Decoration.widget({ widget: new RecordPinWidget(plugin, sourcePath, n, pinned), side: 1 }).range(doc.line(n + 1).to));
        }
      }
      for (const entry of tableAll) {
        const n = entry.line;
        if (recordSet.has(n) || !CONTEXT_RECORD_RE.test(lines[n])) continue;
        const pinned = isPinnedLine(lines[n]);
        if (pinned) ranges.push(Decoration.line({ class: "ad-record-line--pinned" }).range(doc.line(n + 1).from));
        if (pinned || open) ranges.push(Decoration.widget({ widget: new RecordPinWidget(plugin, sourcePath, n, pinned), side: 1 }).range(doc.line(n + 1).to));
      }
      const hidden = group.records.filter((n) => !visible.includes(n));
      for (const run of recordRuns(hidden)) {
        const from = Math.max(0, doc.line(run.from + 1).from - 1), to = doc.line(run.to + 1).to;
        ranges.push(Decoration.replace({ inclusive: false }).range(from, to));
      }
    }
    return { decorations: Decoration.set(ranges, true), topLevelLines };
  };
  const field = StateField.define({
    create(state) {
      const mode = displayMode(plugin);
      const { decorations, topLevelLines } = build(state, mode);
      return { mode, topLevelLines, decorations };
    },
    update(value, tr) {
      const mode = displayMode(plugin);
      let changed = mode !== value.mode;
      const setOpen = (keys, open) => {
        const groups = aiRecordGroups(tr.state.doc.toString(), trackedIds(plugin));
        for (const key of keys) {
          const group = groups.find((g) => g.key === key || g.stableKey === key);
          rememberOpen(plugin, key, open, group ? recordStartsOpen(mode, group) : false, group?.stableKey);
        }
        changed = true;
      };
      for (const e of tr.effects) {
        if (e.is(setRecordsOpenEffect)) setOpen(e.value.keys, e.value.open);
        if (e.is(setRecordViewEffect)) {
          const group = aiRecordGroups(tr.state.doc.toString(), trackedIds(plugin)).find((g) => g.key === e.value.key || g.stableKey === e.value.key);
          rememberView(plugin, e.value.key, e.value.view, group?.stableKey || e.value.stableKey);
          changed = true;
        }
        if (e.is(refreshEffect)) changed = true;
        if (e.is(toggleRecords)) {
          const group = aiRecordGroups(tr.state.doc.toString(), trackedIds(plugin)).find((g) => g.key === e.value);
          const open = recordIsOpen(plugin.settings, mode, group || { key: e.value, summaries: [] });
          setOpen([e.value], !open);
        }
      }
      if (!changed && !tr.docChanged) return value;
      const { decorations, topLevelLines } = build(tr.state, mode);
      return { mode, topLevelLines, decorations };
    },
    provide: (f) => [EditorView.decorations.from(f, (v) => v.decorations), EditorView.atomicRanges.of((view) => view.state.field(f).decorations)],
  });
  const guardHiddenTail = EditorState.transactionFilter.of((tr) => {
    const startDoc = tr.startState.doc;
    const prevSel = tr.startState.selection.main;
    // Cursor moves and typing only need the affected line, not the whole diary.
    const redirectAt = (pos, options) => {
      const line = startDoc.lineAt(pos);
      const text = line.text + (line.to < startDoc.length ? "\n" : "");
      const local = options.change ? { change: { ...options.change, from: options.change.from - line.from, to: options.change.to - line.from } }
        : { ...options, prevHead: options.prevHead - line.from, nextHead: options.nextHead - line.from };
      const result = redirectHiddenTailTransaction(text, trackedIds(plugin), local);
      if (!result) return null;
      return { ...result, head: result.head + line.from,
        ...(result.change ? { change: { ...result.change, from: result.change.from + line.from, to: result.change.to + line.from } } : {}) };
    };
    if (!tr.docChanged && tr.effects.some((e) => e.is(foldEffect)) && !tr.effects.some((e) => e.is(unfoldEffect) || e.is(setRecordsOpenEffect))) {
      const mode = displayMode(plugin);
      if (mode !== "expanded") {
        const groups = aiRecordGroups(startDoc.toString(), trackedIds(plugin));
        const openByLine = new Map();
        for (const g of groups) {
          if (g.records.length && recordIsOpen(plugin.settings, mode, g)) openByLine.set(g.line, g.key);
        }
        if (openByLine.size) {
          const keys = [], kept = [];
          for (const e of tr.effects) {
            const key = e.is(foldEffect) ? openByLine.get(startDoc.lineAt(e.value.from).number - 1) : null;
            if (key) keys.push(key);
            else kept.push(e);
          }
          if (keys.length) return { effects: [...kept, setRecordsOpenEffect.of({ keys, open: false })], selection: tr.selection, scrollIntoView: tr.scrollIntoView };
        }
      }
    }
    if (tr.docChanged) {
      let count = 0, single = null;
      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        count++;
        single = { from: fromA, to: toA, insert: inserted.toString() };
      });
      if (count !== 1 || !single || single.from !== single.to || !single.insert) return tr;
      const redirected = redirectAt(single.from, { change: single });
      if (!redirected?.change) return tr;
      return [{ changes: redirected.change, selection: { anchor: redirected.head } }];
    }
    if (tr.selection && tr.newSelection.ranges.length === 1 && tr.newSelection.main.empty) {
      const redirected = redirectAt(tr.newSelection.main.head, {
        prevHead: prevSel.empty ? prevSel.head : -1,
        nextHead: tr.newSelection.main.head,
        selectionEmpty: true,
      });
      if (redirected?.head != null) return [tr, { selection: { anchor: redirected.head } }];
    }
    return tr;
  });
  plugin.aiRecordDisplayField = field;
  plugin.recordTrackedIds = () => trackedIds(plugin);
  return [field, guardHiddenTail, aiRecordUnfoldExtension(plugin, refreshEffect)];
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
    const match = /(?:[ \t]+|^)\^([a-z0-9-]+)(?:\S*)?[ \t]*$/i.exec(node.textContent);
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
    const records = [...list.children].filter((li) => !li.querySelector('ul, ol') && !li.id && !li.dataset.blockId && RECORD_MARKER_BODY_RE.test(li.textContent.trim()));
    const section = ctx?.getSectionInfo?.(el);
    const srcLines = section?.text ? section.text.split("\n") : [];
    const first = srcLines[(section?.lineStart || 0) + (Number(parent.dataset.line) || 0)];
    const key = parent.id || parent.dataset.blockId || (first && /\s\^([A-Za-z0-9-]+)\s*$/.exec(first)?.[1]);
    const bound = records.some((li) => /^🔗\s|^💬\s+累计总结[：:]/.test(li.textContent.trim()));
    if (!records.length || !(bound || isDeckBlockId(key) || ids.has(key) || own.includes("🤖") || isDeckBlockId(parent.id) || ids.has(parent.id) || ids.has(parent.dataset.blockId))) continue;
    list.dataset.adRecords = "true";
    const summaries = records.filter((li) => /^💬\s+累计总结[：:]/.test(li.textContent.trim()));
    const done = /^(?:DONE|CANCELED|CANCELLED|FAILED)\b/i.test(parent.textContent.trim());
    // Map rendered list items back to raw Markdown lines so Reading View preserves <!-- ad-pin -->.
    const srcGroup = section?.text ? aiRecordGroups(section.text, ids).find((g) => (key && (g.key === key || g.stableKey === key)) || (g.line >= (section.lineStart || 0) && g.line <= (section.lineEnd ?? srcLines.length) && g.records.length === records.length)) : null;
    const pinnedSet = new Set();
    const recordLineNums = records.map((li, i) => {
      const explicit = li.dataset?.line != null ? (section?.lineStart || 0) + Number(li.dataset.line) : -1;
      const lineNum = explicit >= 0 && explicit < srcLines.length ? explicit : (srcGroup?.records?.[i] ?? -1);
      if (lineNum >= 0 && hasPinMarker(srcLines[lineNum])) pinnedSet.add(i);
      return lineNum;
    });
    // The selection helper works on line numbers, so the DOM list is indexed.
    const texts = records.map((li) => li.textContent.trim());
    const group = { key, records: records.map((_, i) => i), summaries: summaries.map((li) => records.indexOf(li)), state: done ? "done" : "doing" };
    const startsOpen = recordStartsOpen(mode, group);
    let open = recordIsOpen(plugin.settings, mode, group);
    const button = recordControl(list.ownerDocument, records.length, open, mode, summaries.length > 0);
    const pinButtons = [];
    const update = () => {
      const kept = open ? group.records : visibleRecords(group, texts, mode, pinnedSet);
      for (const [i, li] of records.entries()) {
        const pinned = pinnedSet.has(i);
        li.classList.add("ad-record-item");
        li.classList.toggle("ad-record-pinned", pinned);
        li.classList.toggle("ad-record-hidden", !kept.includes(i));
        li.classList.toggle("ad-record-brief-clamped", !open && isBriefRecord(texts[i]));
        const btn = pinButtons[i];
        if (btn) {
          btn.classList.toggle("is-on", pinned);
          btn.setAttribute("aria-pressed", String(pinned));
        }
      }
      button.querySelector("span:nth-child(2)").textContent = buttonLabel(open, mode, summaries.length > 0);
      button.dataset.open = String(open);
      const title = open ? t("折叠 {n} 条 AI 记录", { n: records.length }) : t("展开 {n} 条 AI 记录", { n: records.length });
      button.title = title;
      button.setAttribute("aria-label", title);
      button.setAttribute("aria-expanded", String(open));
    };
    for (const [i, li] of records.entries()) {
      if (!RECORD_LINE_RE.test(`- ${texts[i]}`) || /^🔗\s|^⏱\s/.test(texts[i]) || recordLineNums[i] < 0) {
        pinButtons.push(null);
        continue;
      }
      const btn = createPinButton(list.ownerDocument, pinnedSet.has(i), () => {
        if (pinnedSet.has(i)) pinnedSet.delete(i);
        else pinnedSet.add(i);
        update();
        if (ctx?.sourcePath && plugin?.toggleRecordPin) plugin.toggleRecordPin(ctx.sourcePath, recordLineNums[i]);
      });
      li.appendChild(btn);
      pinButtons.push(btn);
    }
    button.onclick = () => { open = !open; rememberOpen(plugin, key, open, startsOpen); update(); };
    const paragraph = parent.querySelector(":scope > p");
    if (paragraph) paragraph.appendChild(button); else list.parentNode.insertBefore(button, list);
    update();
    cleanups.push(() => { for (const b of pinButtons) b?.remove(); for (const li of records) li.classList.remove("ad-record-hidden", "ad-record-item", "ad-record-brief-clamped", "ad-record-pinned"); button.remove(); delete list.dataset.adRecords; });
  }
  return () => cleanups.forEach((cleanup) => cleanup());
}
