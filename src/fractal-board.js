// In-place WorkFlowy-style Fractal Kanban Board projection for parent tasks with child tasks.
// Pure Markdown remains the single source of truth; board mode only projects CM6 decorations.

import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import { Component, MarkdownRenderer, Menu } from "obsidian";
import { AGENTS, truncate } from "./constants.js";
import { t } from "./i18n.js";
import { recordRuns, trackedBlockIds } from "./ai-records.js";
import {
  extractTaskBoardGroups,
  buildTaskBoardModel,
  moveTaskBoardCardStatus,
  moveTaskBoardCardSubtree,
  insertTaskBoardCard,
  setTaskBoardCardAgent,
  buildBoardSiblingContext,
  delegableAgents,
  findActiveWaveForBoard,
  isTerminalWorkerState,
  boardCardPinId,
  applyTaskBoardPins,
  deleteTaskBoardCards,
} from "./project-workbench.js";
import { updateNote } from "./note-updates.js";
import { mentionTrigger } from "./task-mentions.js";
import { applyBatchStatusChoice } from "./task-status.js";

export const setTaskBoardEffect = StateEffect.define();
const BOARD_CARD_MIME = "application/x-agent-deck-board-card";
const BOARD_LIST_BUDGET = 320;
const boardSelections = new Map();

function boardPinIds(settings, group) {
  const pins = settings?.taskBoardPins;
  if (!pins || !group) return [];
  const list = pins[group.key] ?? pins[group.stableKey];
  return Array.isArray(list) ? list : [];
}

export function taskBoardPref(settings, group) {
  const map = settings?.taskBoardViews;
  const fallback = { mode: "outline", groupBy: "status", zoomStack: [] };
  if (!map || !group) return fallback;
  for (const k of [group.key, group.stableKey]) {
    if (!k || !Object.hasOwn(map, k)) continue;
    const raw = map[k];
    if (raw === "board") return { mode: "board", groupBy: "status", zoomStack: [] };
    if (raw && typeof raw === "object") {
      return {
        mode: raw.mode === "board" ? "board" : "outline",
        groupBy: raw.groupBy === "children" ? "children" : "status",
        zoomStack: Array.isArray(raw.zoomStack) ? raw.zoomStack.filter(Boolean) : [],
      };
    }
  }
  return fallback;
}

export function taskBoardMode(settings, group) {
  return taskBoardPref(settings, group).mode;
}

function rememberBoardPref(plugin, key, patch, stableKey = "") {
  const views = (plugin.settings.taskBoardViews ||= {});
  const keys = [key, stableKey].filter((k, i, a) => k && a.indexOf(k) === i);
  const current = taskBoardPref(plugin.settings, { key, stableKey });
  const next = { ...current, ...patch };
  if (next.mode !== "board") {
    for (const k of keys) delete views[k];
  } else {
    const val = next.groupBy === "status" && !next.zoomStack.length
      ? "board"
      : { mode: "board", groupBy: next.groupBy, zoomStack: next.zoomStack };
    for (const k of keys) views[k] = val;
  }
  plugin.saveSettings?.();
  plugin.refreshUI?.();
}

const BOARD_ICON_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="2" y="2.5" width="3.5" height="11" rx="1"/><rect x="6.5" y="2.5" width="3.5" height="7.5" rx="1"/><rect x="11" y="2.5" width="3" height="9.5" rx="1"/></svg>';

class BoardToggleWidget extends WidgetType {
  constructor(plugin, key, line, mode, count) {
    super();
    this.plugin = plugin;
    this.key = key;
    this.line = line;
    this.mode = mode;
    this.count = count;
  }
  eq(other) {
    return other.key === this.key && other.line === this.line && other.mode === this.mode && other.count === this.count;
  }
  toDOM(view) {
    const doc = view.dom.ownerDocument;
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = `ad-board-toggle${this.mode === "board" ? " is-on" : ""}`;
    btn.title = this.mode === "board" ? t("切回大纲视图") : t("切换为分形看板（{n} 张子卡）", { n: this.count });
    btn.setAttribute("aria-label", btn.title);

    const ico = btn.appendChild(doc.createElement("span"));
    ico.className = "ad-board-toggle__ico";
    ico.innerHTML = BOARD_ICON_SVG;

    const label = btn.appendChild(doc.createElement("span"));
    label.textContent = this.mode === "board" ? t("大纲") : t("看板 {n}", { n: this.count });

    btn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const next = this.mode === "board" ? "outline" : "board";
      view.dispatch({ effects: setTaskBoardEffect.of({ key: this.key, mode: next }) });
    });
    return btn;
  }
  ignoreEvent() { return true; }
}

class TaskBoardWidget extends WidgetType {
  constructor(plugin, rootGroup, activeGroup, model, pref, breadcrumbs, sourcePath, pinnedIds = []) {
    super();
    this.plugin = plugin;
    this.rootGroup = rootGroup;
    this.activeGroup = activeGroup;
    this.model = model;
    this.pref = pref;
    this.breadcrumbs = breadcrumbs;
    this.sourcePath = sourcePath;
    this.pinnedIds = pinnedIds;
    this.pinnedSet = new Set(pinnedIds);
    this.boardKey = activeGroup.key || activeGroup.stableKey || "";
    this.selKey = `${sourcePath || ""}::${this.boardKey}`;
    this.activeWave = findActiveWaveForBoard(plugin?.settings?.workbenchWaves, {
      path: sourcePath,
      parentBlockId: activeGroup.key,
      parentTitle: model.title,
    });
    const waveSig = this.activeWave
      ? [
          this.activeWave.id,
          this.activeWave.state,
          this.activeWave.round,
          this.activeWave.error,
          (this.activeWave.workers || []).map((w) => w.state).join(","),
        ]
      : null;
    this.sig = JSON.stringify({
      rootKey: rootGroup.key,
      key: model.key,
      line: model.line,
      groupBy: model.groupBy,
      wave: waveSig,
      crumbs: breadcrumbs.map((b) => b.key),
      pins: pinnedIds,
      cols: model.columns.map((c) => [c.id, c.cards.map((k) => [
        k.line, k.kw, k.title, k.titleMarkdown, k.agent, k.liveState, k.step, k.latestConclusion, k.childCardCount, k.isMirror,
      ])]),
    });
  }
  eq(other) {
    return other.sig === this.sig && other.sourcePath === this.sourcePath;
  }
  selectionSet() {
    let set = boardSelections.get(this.selKey);
    if (!set) boardSelections.set(this.selKey, set = new Set());
    return set;
  }
  selectedCards() {
    const ids = this.selectionSet();
    return this.model.columns.flatMap((col) => col.cards).filter((card) => ids.has(boardCardPinId(card)));
  }
  savePins(cards, pinned) {
    const ids = cards.map(boardCardPinId).filter(Boolean);
    if (!ids.length || !this.boardKey) return;
    applyTaskBoardPins(this.plugin.settings, this.boardKey, ids, pinned);
    this.plugin.saveSettings?.();
    this.plugin.refreshUI?.();
  }
  async applyBulkStatus(keyword) {
    const selected = this.selectedCards();
    const editable = selected.filter((card) => !card.isMirror);
    if (!editable.length) {
      this.plugin.notice?.(t("所选卡片中没有可改状态的卡（镜像卡请到源笔记修改）"));
      return;
    }
    const editor = this.plugin.viewForPath?.(this.sourcePath)?.editor;
    if (!editor) {
      this.plugin.notice?.(t("当前笔记没有可写入的编辑器"));
      return;
    }
    try {
      await applyBatchStatusChoice(this.plugin, editor, editable.map((card) => card.line), keyword);
      const skipped = selected.length - editable.length;
      if (skipped) this.plugin.notice?.(t("已跳过 {n} 张镜像卡（请到源笔记修改）", { n: skipped }));
    } catch (error) {
      this.plugin.notice?.(String(error?.message || error));
    }
  }
  async deleteSelectedCards() {
    const selected = this.selectedCards();
    const editable = selected.filter((card) => !card.isMirror);
    if (!editable.length) {
      this.plugin.notice?.(t("镜像卡不能删除，请到源笔记修改"));
      return;
    }
    if (!this.sourcePath) return;
    try {
      await updateNote(this.plugin, this.sourcePath, (text) =>
        deleteTaskBoardCards(text, editable.map((card) => card.line)),
      );
      const ids = this.selectionSet();
      for (const card of editable) ids.delete(boardCardPinId(card));
      applyTaskBoardPins(this.plugin.settings, this.boardKey, editable.map(boardCardPinId).filter(Boolean), false);
      this.plugin.saveSettings?.();
      this.plugin.notice?.(t("已删除 {n} 张卡片", { n: editable.length }));
      const skipped = selected.length - editable.length;
      if (skipped) this.plugin.notice?.(t("已跳过 {n} 张镜像卡（请到源笔记修改）", { n: skipped }));
      this.plugin.refreshUI?.();
    } catch (error) {
      this.plugin.notice?.(String(error?.message || error));
    }
  }
  renderMarkdown(text, el) {
    const value = String(text || "");
    if (!value) return Promise.resolve();
    const app = this.plugin?.app;
    if (!app || typeof MarkdownRenderer?.render !== "function") {
      el.textContent = value;
      return Promise.resolve();
    }
    try {
      if (!this._renderComponent) {
        this._renderComponent = new Component();
        this._renderComponent.load();
      }
      return MarkdownRenderer.render(app, value, el, this.sourcePath || "", this._renderComponent).catch(() => {
        el.textContent = value;
      });
    } catch {
      el.textContent = value;
      return Promise.resolve();
    }
  }
  openContextMenu(event, card) {
    let selected = this.selectedCards();
    const clickedId = card ? boardCardPinId(card) : "";
    if (!selected.length) {
      if (!clickedId) return;
      this.selectionSet().add(clickedId);
      this._syncBulk?.();
      selected = this.selectedCards();
    } else if (clickedId && selected.length === 1 && boardCardPinId(selected[0]) !== clickedId) {
      this.selectionSet().clear();
      this.selectionSet().add(clickedId);
      this._syncBulk?.();
      selected = this.selectedCards();
    }
    if (!selected.length) return;
    const editable = selected.filter((item) => !item.isMirror);
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(t("已选 {n} 张", { n: selected.length })).setDisabled(true));
    menu.addSeparator();
    const singleMirror = selected.length === 1 && selected[0].isMirror ? selected[0] : null;
    const mirrorColumns = { TODO: "todo", DOING: "doing", NEEDOK: "review", DONE: "done" };
    menu.addItem((item) => {
      item.setTitle(t("改为状态"));
      const choices = [["TODO", "TODO"], ["DOING", "DOING"], ["NEEDOK", t("待确认")], ["DONE", "DONE"]];
      const choose = (keyword) => {
        if (singleMirror) {
          this.moveCard(singleMirror, { targetColumn: mirrorColumns[keyword] })
            .catch((error) => this.plugin.notice?.(String(error?.message || error)));
        } else {
          this.applyBulkStatus(keyword);
        }
      };
      if (typeof item.setSubmenu === "function") {
        const sub = item.setSubmenu();
        for (const [keyword, label] of choices) {
          sub.addItem((entry) => entry.setTitle(label).onClick(() => choose(keyword)));
        }
      } else {
        item.onClick(() => {
          const sub = new Menu();
          for (const [keyword, label] of choices) {
            sub.addItem((entry) => entry.setTitle(label).onClick(() => choose(keyword)));
          }
          sub.showAtPosition({ x: event.clientX, y: event.clientY });
        });
      }
      if (!editable.length && !singleMirror) item.setDisabled(true);
    });
    if (selected.length === 1) {
      const target = selected[0];
      const addSingle = (title, onClick) => {
        menu.addItem((item) => item.setTitle(title).onClick(onClick));
      };
      if (target.activeJob && this.plugin?.cancelJob) {
        addSingle(t("停止"), () => this.plugin.cancelJob(target.activeJob.id));
      } else if (target.sid && this.plugin?.openConversation) {
        addSingle(t("正文"), () => this.plugin.openConversation({ sid: target.sid, agent: target.agent }));
      }
      if (target.column === "todo" && !target.hasLink && !target.activeJob && !target.isMirror && this.plugin?.delegateAtLine && this.sourcePath) {
        addSingle(t("派发"), () => this.plugin.delegateAtLine(this.sourcePath, target.line, {
          boardContext: buildBoardSiblingContext(this.model, target.line),
        }));
      }
    }
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(t("置顶所选")).onClick(() => this.savePins(selected, true)));
    menu.addItem((item) => item.setTitle(t("取消置顶")).onClick(() => this.savePins(selected, false)));
    if (editable.length) {
      menu.addSeparator();
      menu.addItem((item) => {
        item.setTitle(t("删除 {n} 张卡片", { n: editable.length }));
        const addConfirm = (sub) => {
          sub.addItem((entry) => entry.setTitle(t("确认删除 {n} 张", { n: editable.length })).onClick(() => this.deleteSelectedCards()));
          sub.addItem((entry) => entry.setTitle(t("取消")));
        };
        if (typeof item.setSubmenu === "function") {
          addConfirm(item.setSubmenu());
        } else {
          item.onClick(() => {
            const confirm = new Menu();
            addConfirm(confirm);
            confirm.showAtPosition({ x: event.clientX, y: event.clientY });
          });
        }
      });
    }
    menu.addItem((item) => item.setTitle(t("清空选择")).onClick(() => {
      this.selectionSet().clear();
      this._syncBulk?.();
    }));
    menu.showAtMouseEvent(event);
  }
  destroy() {
    this._resizeObserver?.disconnect?.();
    this._resizeObserver = null;
    this._renderComponent?.unload?.();
    this._renderComponent = null;
    this._syncBulk = null;
    this._scheduleCap = null;
    if (this._capRaf) cancelAnimationFrame(this._capRaf);
    this._capRaf = 0;
  }
  jumpTo(view, line) {
    const stDoc = view.state.doc;
    const target = Math.min(Math.max(0, line), Math.max(0, (stDoc.lines || 1) - 1));
    const lineObj = stDoc.line(target + 1);
    const leading = (/^\s*/.exec(lineObj.text || "") || [""])[0].length;
    view.dispatch({
      effects: [setTaskBoardEffect.of({ key: this.rootGroup.key, mode: "outline" })],
      selection: { anchor: lineObj.from + leading },
      scrollIntoView: true,
    });
    view.focus?.();
  }
  async moveCard(card, { targetColumn = "", beforeLine = -1, targetParentLine = -1 } = {}) {
    if (card?.isMirror && card.mirrorTarget?.path) {
      if (!targetColumn) return;
      await updateNote(this.plugin, card.mirrorTarget.path, (text) =>
        moveTaskBoardCardStatus(text, card.mirrorTarget.line, targetColumn),
      );
      return;
    }
    if (!this.sourcePath) return;
    await updateNote(this.plugin, this.sourcePath, (text) =>
      moveTaskBoardCardSubtree(text, card.line, { targetColumn, beforeLine, targetParentLine }),
    );
  }
  async addCard(title, column, agent) {
    if (!this.sourcePath || !String(title || "").trim()) return;
    await updateNote(this.plugin, this.sourcePath, (text) =>
      insertTaskBoardCard(text, this.activeGroup.line, { title, column, agent }),
    );
  }
  async setCardAgent(cardLine, agent) {
    if (!this.sourcePath) return;
    const trigger = mentionTrigger(this.plugin);
    await updateNote(this.plugin, this.sourcePath, (text) => setTaskBoardCardAgent(text, cardLine, agent, trigger));
  }
  toDOM(view) {
    const doc = view.dom.ownerDocument;
    this._renderComponent?.unload?.();
    this._renderComponent = null;
    const wrap = doc.createElement("div");
    wrap.className = "ad-board-wrap";
    wrap.setAttribute("contenteditable", "false");
    wrap.addEventListener("dragover", (e) => {
      if (e.dataTransfer && [...e.dataTransfer.types].includes(BOARD_CARD_MIME)) e.stopPropagation();
    });
    wrap.addEventListener("drop", (e) => {
      if (e.dataTransfer && [...e.dataTransfer.types].includes(BOARD_CARD_MIME)) e.stopPropagation();
    });

    // 1. Breadcrumb trail when zoomed into a nested sub-board
    if (this.breadcrumbs.length > 1) {
      const crumbsEl = wrap.appendChild(doc.createElement("div"));
      crumbsEl.className = "ad-board__crumbs";
      this.breadcrumbs.forEach((crumb, idx) => {
        if (idx > 0) {
          const sep = crumbsEl.appendChild(doc.createElement("span"));
          sep.className = "ad-board__crumbsep";
          sep.textContent = "›";
        }
        const isLast = idx === this.breadcrumbs.length - 1;
        const btn = crumbsEl.appendChild(doc.createElement("button"));
        btn.type = "button";
        btn.className = `ad-board__crumb${isLast ? " is-current" : ""}`;
        btn.textContent = truncate(crumb.title, 28);
        if (!isLast) {
          btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const nextStack = idx === 0 ? [] : this.breadcrumbs.slice(1, idx + 1).map((b) => b.key);
            view.dispatch({ effects: setTaskBoardEffect.of({ key: this.rootGroup.key, zoomStack: nextStack }) });
          });
        }
      });
    }

    // 2. Header bar with progress & mode controls
    const head = wrap.appendChild(doc.createElement("div"));
    head.className = "ad-board__head";
    const titleBox = head.appendChild(doc.createElement("div"));
    titleBox.className = "ad-board__titlebox";
    const titleEl = titleBox.appendChild(doc.createElement("div"));
    titleEl.className = "ad-board__title";
    titleEl.textContent = truncate(this.model.title || t("分形看板"), 44);
    const progMeta = titleBox.appendChild(doc.createElement("div"));
    progMeta.className = "ad-board__progress";
    const bar = progMeta.appendChild(doc.createElement("span"));
    bar.className = "ad-board__progbar";
    const fill = bar.appendChild(doc.createElement("span"));
    fill.className = "ad-board__progfill";
    fill.style.width = `${this.model.stats.progressPct}%`;
    const pct = progMeta.appendChild(doc.createElement("span"));
    pct.className = "ad-board__progtext";
    pct.textContent = `${this.model.stats.done}/${this.model.stats.total} · ${this.model.stats.progressPct}%`;

    const actions = head.appendChild(doc.createElement("div"));
    actions.className = "ad-board__actions";

    if (this.model.canGroupByChildren) {
      const nextMode = this.model.groupBy === "children" ? "status" : "children";
      const grpBtn = actions.appendChild(doc.createElement("button"));
      grpBtn.type = "button";
      grpBtn.className = `ad-board__btn${this.model.groupBy === "children" ? " is-primary" : ""}`;
      grpBtn.textContent = this.model.groupBy === "children" ? t("按状态分列") : t("按子组分列");
      grpBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        view.dispatch({ effects: setTaskBoardEffect.of({ key: this.rootGroup.key, groupBy: nextMode }) });
      });
    }

    if (this.plugin?.openProjectWorkbench && this.sourcePath) {
      const planBtn = actions.appendChild(doc.createElement("button"));
      planBtn.type = "button";
      planBtn.className = "ad-board__btn";
      planBtn.textContent = t("小队 / 拆解");
      planBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.plugin.openProjectWorkbench({ path: this.sourcePath, line: this.activeGroup.line });
      });
    }

    if (this.model.todoDispatchCount > 0 && this.plugin?.dispatchBoardGroup && this.sourcePath) {
      const runBtn = actions.appendChild(doc.createElement("button"));
      runBtn.type = "button";
      runBtn.className = "ad-board__btn is-primary";
      runBtn.textContent = t("派发 TODO ({n})", { n: this.model.todoDispatchCount });
      runBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.plugin.dispatchBoardGroup(this.sourcePath, this.activeGroup.line, { model: this.model });
      });
    }

    const backBtn = actions.appendChild(doc.createElement("button"));
    backBtn.type = "button";
    backBtn.className = "ad-board__btn";
    backBtn.textContent = t("切回大纲");
    backBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({ effects: setTaskBoardEffect.of({ key: this.rootGroup.key, mode: "outline" }) });
    });

    if (this.activeWave) {
      const wave = this.activeWave;
      const stewardName = AGENTS[wave.steward?.agent]?.short || wave.steward?.agent || "Agent";
      const workers = wave.workers || [];
      const settled = workers.filter((w) => isTerminalWorkerState(w.state)).length;
      const bar = wrap.appendChild(doc.createElement("div"));
      bar.className = `ad-board__steward is-${wave.state}`;
      const info = bar.appendChild(doc.createElement("span"));
      info.className = "ad-board__steward-text";
      if (wave.state === "waiting") {
        info.textContent = t("🧭 管家 {agent} 待命中 · 队员已完成 {done}/{total}", {
          agent: stewardName,
          done: settled,
          total: workers.length,
        });
      } else if (wave.state === "running") {
        info.textContent = t("🧭 管家 {agent} 正在收集 {total} 位队员结果并推进（第 {round} 轮）…", {
          agent: stewardName,
          total: workers.length,
          round: wave.round || 1,
        });
      } else if (wave.state === "error") {
        info.textContent = t("⚠️ 管家 {agent} 汇总失败：{err}", {
          agent: stewardName,
          err: truncate(wave.error || t("未知错误"), 60),
        });
      }

      const barBtns = bar.appendChild(doc.createElement("div"));
      barBtns.className = "ad-board__actions";
      if (wave.state === "waiting" && this.plugin?.runStewardWaveNow) {
        const nowBtn = barBtns.appendChild(doc.createElement("button"));
        nowBtn.type = "button";
        nowBtn.className = "ad-board__btn is-primary";
        nowBtn.textContent = t("立即汇总");
        nowBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.plugin.runStewardWaveNow(wave.id);
        });
      }
      if ((wave.state === "waiting" || wave.state === "running") && this.plugin?.cancelWorkbenchWave) {
        const stopBtn = barBtns.appendChild(doc.createElement("button"));
        stopBtn.type = "button";
        stopBtn.className = "ad-board__btn";
        stopBtn.textContent = wave.state === "running" ? t("停止管家") : t("取消管家");
        stopBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.plugin.cancelWorkbenchWave(wave.id);
        });
      }
      if (wave.state === "error") {
        if (this.plugin?.retryStewardWave) {
          const retryBtn = barBtns.appendChild(doc.createElement("button"));
          retryBtn.type = "button";
          retryBtn.className = "ad-board__btn is-primary";
          retryBtn.textContent = t("重试汇总");
          retryBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.plugin.retryStewardWave(wave.id);
          });
        }
        if (this.plugin?.cancelWorkbenchWave) {
          const closeBtn = barBtns.appendChild(doc.createElement("button"));
          closeBtn.type = "button";
          closeBtn.className = "ad-board__btn";
          closeBtn.textContent = t("忽略");
          closeBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.plugin.cancelWorkbenchWave(wave.id);
          });
        }
      }
    }

    // 3. Inline quick-add card bar
    const addAgents = this.plugin?.agentEnabled ? delegableAgents(this.plugin) : [];
    const quickBar = wrap.appendChild(doc.createElement("div"));
    quickBar.className = "ad-board__quickadd";
    const addInput = quickBar.appendChild(doc.createElement("input"));
    addInput.type = "text";
    addInput.className = "ad-board__quickinput";
    addInput.placeholder = t("新增子卡到 {title}…（回车写入 TODO）", { title: truncate(this.model.title, 18) });
    const addAgentSel = quickBar.appendChild(doc.createElement("select"));
    addAgentSel.className = "ad-board__quickselect";
    const emptyOpt = addAgentSel.appendChild(doc.createElement("option"));
    emptyOpt.value = "";
    emptyOpt.textContent = t("不指定 Agent");
    for (const id of addAgents) {
      const opt = addAgentSel.appendChild(doc.createElement("option"));
      opt.value = id;
      opt.textContent = AGENTS[id]?.short || id;
    }
    const addBtn = quickBar.appendChild(doc.createElement("button"));
    addBtn.type = "button";
    addBtn.className = "ad-board__btn";
    addBtn.textContent = t("+ 子卡");
    const submitNew = async () => {
      const val = addInput.value.trim();
      if (!val) return;
      addInput.value = "";
      await this.addCard(val, "todo", addAgentSel.value);
    };
    addInput.addEventListener("mousedown", (e) => e.stopPropagation());
    addInput.addEventListener("click", (e) => e.stopPropagation());
    addAgentSel.addEventListener("mousedown", (e) => e.stopPropagation());
    addAgentSel.addEventListener("keydown", (e) => e.stopPropagation());
    addBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); submitNew(); });
    addInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); submitNew(); }
    });

    // 4. Bulk selection bar (hidden until at least one card is selected)
    const allCards = this.model.columns.flatMap((col) => col.cards);
    const cardId = (card) => boardCardPinId(card);
    const selection = this.selectionSet();
    const liveIds = new Set(allCards.map(cardId).filter(Boolean));
    for (const id of [...selection]) if (!liveIds.has(id)) selection.delete(id);

    const bulk = wrap.appendChild(doc.createElement("div"));
    bulk.className = "ad-board__bulk";
    bulk.hidden = true;
    const bulkCount = bulk.appendChild(doc.createElement("span"));
    bulkCount.className = "ad-board__bulkcount";
    const bulkActs = bulk.appendChild(doc.createElement("div"));
    bulkActs.className = "ad-board__bulkacts";

    const checkInputs = [];
    const colChecks = [];
    const statusButtons = [];
    let pinOnBtn = null;
    let pinOffBtn = null;
    let deleteBtn = null;
    let deleteArmed = false;
    let deleteTimer = 0;

    const disarmDelete = () => {
      deleteArmed = false;
      clearTimeout(deleteTimer);
      if (deleteBtn) {
        deleteBtn.textContent = t("删除");
        deleteBtn.classList.remove("is-armed");
      }
    };
    const syncChecks = () => {
      for (const item of checkInputs) item.input.checked = selection.has(item.id);
      for (const item of colChecks) {
        const ids = item.col.cards.filter((card) => !card.isMirror).map(cardId).filter(Boolean);
        const selected = ids.filter((id) => selection.has(id)).length;
        item.input.checked = ids.length > 0 && selected === ids.length;
        item.input.indeterminate = selected > 0 && selected < ids.length;
        item.input.disabled = ids.length === 0;
      }
    };
    const syncBulk = () => {
      const selected = allCards.filter((card) => selection.has(cardId(card)));
      const editable = selected.filter((card) => !card.isMirror);
      bulk.hidden = selected.length === 0;
      bulkCount.textContent = t("已选 {n} 张", { n: selected.length });
      for (const btn of statusButtons) btn.disabled = editable.length === 0;
      if (pinOnBtn) pinOnBtn.disabled = selected.length === 0;
      if (pinOffBtn) pinOffBtn.disabled = selected.length === 0;
      if (deleteBtn) deleteBtn.disabled = editable.length === 0;
      if (!editable.length) disarmDelete();
      syncChecks();
    };
    this._syncBulk = syncBulk;
    const bulkButton = (label, className = "ad-board__btn") => {
      const btn = bulkActs.appendChild(doc.createElement("button"));
      btn.type = "button";
      btn.className = className;
      btn.textContent = label;
      btn.addEventListener("mousedown", (e) => e.stopPropagation());
      return btn;
    };

    for (const [keyword, label] of [["TODO", "TODO"], ["DOING", "DOING"], ["NEEDOK", t("待确认")], ["DONE", "DONE"]]) {
      const btn = bulkButton(label);
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.applyBulkStatus(keyword);
      });
      statusButtons.push(btn);
    }
    pinOnBtn = bulkButton(t("置顶所选"));
    pinOnBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.savePins(this.selectedCards(), true);
    });
    pinOffBtn = bulkButton(t("取消置顶"));
    pinOffBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.savePins(this.selectedCards(), false);
    });
    deleteBtn = bulkButton(t("删除"), "ad-board__btn is-danger");
    deleteBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const editable = this.selectedCards().filter((card) => !card.isMirror);
      if (!editable.length) return;
      if (!deleteArmed) {
        deleteArmed = true;
        deleteBtn.textContent = t("确认删除 {n} 张", { n: editable.length });
        deleteBtn.classList.add("is-armed");
        clearTimeout(deleteTimer);
        deleteTimer = setTimeout(disarmDelete, 8000);
        return;
      }
      disarmDelete();
      await this.deleteSelectedCards();
    });
    const clearBtn = bulkButton(t("清空"));
    clearBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      selection.clear();
      disarmDelete();
      syncBulk();
    });

    // 5. Kanban columns
    const cols = wrap.appendChild(doc.createElement("div"));
    cols.className = "ad-board__cols";
    const renderTasks = [];
    cols.addEventListener("contextmenu", (e) => {
      if (e.target?.closest?.(".ad-board__card")) return;
      if (!this.selectionSet().size) return;
      e.preventDefault();
      e.stopPropagation();
      this.openContextMenu(e, null);
    });
    if (this.model.columns.length > 4) {
      cols.style.gridTemplateColumns = `repeat(${Math.min(this.model.columns.length, 5)}, minmax(150px, 1fr))`;
    }

    for (const col of this.model.columns) {
      const colEl = cols.appendChild(doc.createElement("div"));
      colEl.className = `ad-board__col ad-board__col--${col.id.startsWith("parent:") ? "group" : col.id}`;
      colEl.dataset.column = col.id;

      const colHead = colEl.appendChild(doc.createElement("div"));
      colHead.className = "ad-board__colhead";
      const colNameWrap = colHead.appendChild(doc.createElement("span"));
      colNameWrap.className = "ad-board__colname";
      const colCheck = colNameWrap.appendChild(doc.createElement("input"));
      colCheck.type = "checkbox";
      colCheck.className = "ad-board__check ad-board__check--column";
      colCheck.title = t("选择本列卡片");
      colCheck.setAttribute("aria-label", colCheck.title);
      colCheck.addEventListener("mousedown", (e) => e.stopPropagation());
      colCheck.addEventListener("click", (e) => e.stopPropagation());
      colCheck.addEventListener("change", (e) => {
        e.stopPropagation();
        const ids = col.cards.filter((card) => !card.isMirror).map(cardId).filter(Boolean);
        for (const id of ids) {
          if (colCheck.checked) selection.add(id);
          else selection.delete(id);
        }
        disarmDelete();
        syncBulk();
      });
      colChecks.push({ input: colCheck, col });
      const colName = colNameWrap.appendChild(doc.createElement("span"));
      colName.textContent = col.id === "review" ? t("待确认") : col.label;
      const colCount = colHead.appendChild(doc.createElement("span"));
      colCount.className = "ad-board__colcount";
      colCount.textContent = String(col.cards.length);

      const list = colEl.appendChild(doc.createElement("div"));
      list.className = "ad-board__collist";

      colEl.addEventListener("dragover", (e) => {
        if (!e.dataTransfer || ![...e.dataTransfer.types].includes(BOARD_CARD_MIME)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        colEl.classList.add("is-drop");
      });
      colEl.addEventListener("dragleave", (e) => {
        if (!colEl.contains(e.relatedTarget)) colEl.classList.remove("is-drop");
      });
      colEl.addEventListener("drop", (e) => {
        if (!e.dataTransfer || ![...e.dataTransfer.types].includes(BOARD_CARD_MIME)) return;
        e.preventDefault();
        e.stopPropagation();
        colEl.classList.remove("is-drop");
        try {
          const payload = JSON.parse(e.dataTransfer.getData(BOARD_CARD_MIME));
          if (!payload || !Number.isInteger(payload.line)) return;
          const cardObj = this.model.columns.flatMap((c) => c.cards).find((c) => c.line === payload.line);
          if (!cardObj || cardObj.isMirror) return;
          if (this.model.groupBy === "children" && Number.isInteger(col.targetParentLine)) {
            const last = col.cards[col.cards.length - 1];
            if (!last) this.moveCard(cardObj, { targetParentLine: col.targetParentLine });
            else this.moveCard(cardObj, { beforeLine: last.endLine + 1, targetParentLine: col.targetParentLine });
            return;
          }
          if (payload.column !== col.id) {
            const last = col.cards[col.cards.length - 1];
            if (!last) this.moveCard(cardObj, { targetColumn: col.id });
            else this.moveCard(cardObj, { targetColumn: col.id, beforeLine: last.endLine + 1 });
            return;
          }
          if (col.cards.length > 1) {
            const last = col.cards[col.cards.length - 1];
            if (last.line !== cardObj.line) this.moveCard(cardObj, { beforeLine: last.endLine + 1 });
          }
        } catch { /* ignore invalid drag payload */ }
      });

      if (!col.cards.length) {
        const empty = list.appendChild(doc.createElement("div"));
        empty.className = "ad-board__empty";
        empty.textContent = t("空");
        continue;
      }

      for (const card of col.cards) {
        const pinId = cardId(card);
        const pinned = this.pinnedSet.has(pinId);
        const cardEl = list.appendChild(doc.createElement("div"));
        cardEl.className = `ad-board__card${card.activeJob ? " is-live" : ""}${card.isMirror ? " is-mirror" : ""}${pinned ? " is-pinned" : ""}`;
        cardEl.draggable = true;
        if (card.agent && AGENTS[card.agent]) {
          cardEl.style.setProperty("--ad-agent", AGENTS[card.agent].color);
          cardEl.style.setProperty("--ad-agent-soft", AGENTS[card.agent].soft);
        }

        cardEl.addEventListener("dragstart", (e) => {
          if (e.target?.tagName === "INPUT") {
            e.preventDefault();
            return;
          }
          e.stopPropagation();
          e.dataTransfer.setData(BOARD_CARD_MIME, JSON.stringify({ line: card.line, column: col.id }));
          e.dataTransfer.effectAllowed = "move";
          cardEl.classList.add("is-dragging");
        });
        cardEl.addEventListener("dragend", () => cardEl.classList.remove("is-dragging"));
        cardEl.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.openContextMenu(e, card);
        });
        cardEl.addEventListener("dragover", (e) => {
          if (!e.dataTransfer || ![...e.dataTransfer.types].includes(BOARD_CARD_MIME)) return;
          e.preventDefault();
          e.stopPropagation();
          const rect = cardEl.getBoundingClientRect();
          const after = e.clientY > rect.top + rect.height / 2;
          cardEl.classList.toggle("is-drop-after", after);
          cardEl.classList.toggle("is-drop-before", !after);
          colEl.classList.remove("is-drop");
        });
        cardEl.addEventListener("dragleave", () => {
          cardEl.classList.remove("is-drop-before", "is-drop-after");
        });
        cardEl.addEventListener("drop", (e) => {
          if (!e.dataTransfer || ![...e.dataTransfer.types].includes(BOARD_CARD_MIME)) return;
          e.preventDefault();
          e.stopPropagation();
          cardEl.classList.remove("is-drop-before", "is-drop-after");
          try {
            const payload = JSON.parse(e.dataTransfer.getData(BOARD_CARD_MIME));
            if (!payload || !Number.isInteger(payload.line) || payload.line === card.line) return;
            const dragged = this.model.columns.flatMap((c) => c.cards).find((c) => c.line === payload.line);
            if (!dragged || dragged.isMirror) return;
            const rect = cardEl.getBoundingClientRect();
            const after = e.clientY > rect.top + rect.height / 2;
            const beforeLine = after ? (Number.isInteger(card.endLine) ? card.endLine + 1 : card.line + 1) : card.line;
            if (this.model.groupBy === "children" && Number.isInteger(col.targetParentLine)) {
              this.moveCard(dragged, { beforeLine, targetParentLine: col.targetParentLine });
            } else {
              this.moveCard(dragged, { targetColumn: payload.column !== col.id ? col.id : "", beforeLine });
            }
          } catch { /* ignore */ }
        });

        const topRow = cardEl.appendChild(doc.createElement("div"));
        topRow.className = "ad-board__cardtop";
        const lead = topRow.appendChild(doc.createElement("div"));
        lead.className = "ad-board__cardlead";
        const check = lead.appendChild(doc.createElement("input"));
        check.type = "checkbox";
        check.className = "ad-board__check";
        check.checked = selection.has(pinId);
        check.disabled = !pinId;
        check.title = t("选择卡片");
        check.setAttribute("aria-label", check.title);
        check.addEventListener("mousedown", (e) => e.stopPropagation());
        check.addEventListener("click", (e) => e.stopPropagation());
        check.addEventListener("dragstart", (e) => { e.preventDefault(); e.stopPropagation(); });
        check.addEventListener("change", (e) => {
          e.stopPropagation();
          if (!pinId) return;
          if (check.checked) selection.add(pinId);
          else selection.delete(pinId);
          disarmDelete();
          syncBulk();
        });
        checkInputs.push({ input: check, id: pinId });

        const title = lead.appendChild(doc.createElement("div"));
        title.className = "ad-board__cardtitle ad-board__md";
        title.title = card.isMirror && card.mirrorTarget?.path
          ? t("点击打开镜像源：{path}", { path: card.mirrorTarget.path })
          : t("点击切回大纲定位编辑");
        renderTasks.push(this.renderMarkdown(card.titleMarkdown || card.title, title));
        title.addEventListener("click", (e) => {
          if (e.target?.closest?.("a, .internal-link, .external-link, .tag, .cm-hashtag")) return;
          e.preventDefault();
          e.stopPropagation();
          if (card.isMirror && card.mirrorTarget?.path && this.plugin?.openMirrorSource) {
            this.plugin.openMirrorSource(card.mirrorTarget.path, card.mirrorTarget.line);
          } else {
            this.jumpTo(view, card.line);
          }
        });

        if (card.subBoardKey) {
          const zoomBtn = topRow.appendChild(doc.createElement("button"));
          zoomBtn.type = "button";
          zoomBtn.className = "ad-board__zoom";
          zoomBtn.textContent = `↳ ${card.childDoneCount}/${card.childCardCount}`;
          zoomBtn.title = t("下钻聚焦到子看板");
          zoomBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const nextStack = [...(this.pref.zoomStack || []), card.subBoardKey];
            view.dispatch({ effects: setTaskBoardEffect.of({ key: this.rootGroup.key, zoomStack: nextStack }) });
          });
        } else if (card.isMirror) {
          const mBadge = topRow.appendChild(doc.createElement("span"));
          mBadge.className = "ad-board__mirror";
          mBadge.textContent = t("镜像");
          mBadge.title = card.mirrorTarget?.path || `${card.mirror?.target}#${card.mirror?.blockId}`;
        }

        const pinBtn = topRow.appendChild(doc.createElement("button"));
        pinBtn.type = "button";
        pinBtn.className = `ad-board__pin${pinned ? " is-on" : ""}`;
        pinBtn.textContent = "📌";
        pinBtn.title = pinned ? t("取消置顶") : t("置顶（移到本列最前）");
        pinBtn.setAttribute("aria-label", pinBtn.title);
        pinBtn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
        pinBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.savePins([card], !pinned);
        });

        if (card.step || card.latestConclusion) {
          const note = cardEl.appendChild(doc.createElement("div"));
          note.className = "ad-board__cardnote ad-board__md";
          renderTasks.push(this.renderMarkdown(truncate(card.step || card.latestConclusion, 88), note));
        }

        const foot = cardEl.appendChild(doc.createElement("div"));
        foot.className = "ad-board__cardfoot";

        if (!card.hasLink && !card.activeJob && !card.isMirror && addAgents.length) {
          const sel = foot.appendChild(doc.createElement("select"));
          sel.className = "ad-board__agentsel";
          const none = sel.appendChild(doc.createElement("option"));
          none.value = "";
          none.textContent = t("未指定");
          for (const id of addAgents) {
            const o = sel.appendChild(doc.createElement("option"));
            o.value = id;
            o.textContent = AGENTS[id]?.short || id;
          }
          sel.value = addAgents.includes(card.agent) ? card.agent : "";
          sel.addEventListener("mousedown", (e) => e.stopPropagation());
          sel.addEventListener("click", (e) => e.stopPropagation());
          sel.addEventListener("keydown", (e) => e.stopPropagation());
          sel.addEventListener("change", (e) => {
            e.stopPropagation();
            this.setCardAgent(card.line, sel.value);
          });
        } else {
          const badge = foot.appendChild(doc.createElement("span"));
          badge.className = "ad-board__agent";
          badge.textContent = card.agent ? (AGENTS[card.agent]?.short || card.agent) : t("未指定");
        }

      }
    }

    syncBulk();

    // 6. Cap each column to roughly three normal cards (four when every card is short).
    const capColumnLists = () => {
      if (!wrap.isConnected) return;
      for (const list of cols.querySelectorAll(".ad-board__collist")) {
        const cards = [...list.querySelectorAll(".ad-board__card")];
        list.style.maxHeight = "";
        list.classList.remove("is-capped");
        if (cards.length <= 3) continue;
        const gap = parseFloat(getComputedStyle(list).rowGap) || 6;
        const heights = cards.map((el) => el.getBoundingClientRect().height);
        if (heights.some((height) => height <= 0)) continue;
        const fourHeights = heights.slice(0, 4).reduce((sum, height) => sum + height, 0) + gap * 3;
        const visible = fourHeights <= BOARD_LIST_BUDGET ? 4 : 3;
        if (cards.length <= visible) continue;
        const cap = heights.slice(0, visible).reduce((sum, height) => sum + height, 0) + gap * (visible - 1);
        list.style.maxHeight = `${Math.ceil(cap + 1)}px`;
        list.classList.add("is-capped");
      }
    };
    const scheduleCap = (attempt = 0) => {
      requestAnimationFrame(() => {
        if (!wrap.isConnected) {
          if (attempt < 3) scheduleCap(attempt + 1);
          return;
        }
        capColumnLists();
      });
    };
    this._scheduleCap = scheduleCap;
    scheduleCap();
    Promise.allSettled(renderTasks).then(() => this._scheduleCap?.());
    this._resizeObserver?.disconnect?.();
    if (typeof ResizeObserver === "function") {
      let lastWidth = 0;
      const observer = new ResizeObserver((entries) => {
        const width = Math.round(entries[0]?.contentRect?.width || 0);
        if (!width || Math.abs(width - lastWidth) < 2) return;
        lastWidth = width;
        if (this._capRaf) cancelAnimationFrame(this._capRaf);
        this._capRaf = requestAnimationFrame(() => {
          this._capRaf = 0;
          capColumnLists();
        });
      });
      observer.observe(wrap);
      this._resizeObserver = observer;
    }
    return wrap;
  }
  ignoreEvent() { return true; }
}

function resolveActiveBoardAndBreadcrumbs(rootGroup, allGroups, pref) {
  const stack = pref.zoomStack || [];
  const crumbs = [rootGroup];
  let current = rootGroup;
  for (const key of stack) {
    const next = allGroups.find((g) => (g.key === key || g.stableKey === key) && g.line > current.line && g.endLine <= current.endLine);
    if (!next) break;
    crumbs.push(next);
    current = next;
  }
  return { activeGroup: current, breadcrumbs: crumbs };
}

export function taskBoardExtension(plugin, refreshEffect) {
  const build = (state) => {
    const ranges = [];
    const doc = state.doc;
    const text = doc.toString();
    const info = state.field?.(plugin.editorInfoField, false);
    const sourcePath = info?.file?.path || "";
    const ids = trackedBlockIds(plugin);
    const trigger = mentionTrigger(plugin);
    const groups = extractTaskBoardGroups(text, { trackedIds: ids, trigger });
    const boardLines = new Set();

    const mirrorCache = plugin._mirrorBoardCache || null;
    const resolveMirror = mirrorCache
      ? (ref) => mirrorCache.get(`${ref.target}#${ref.blockId}`) || null
      : null;

    if (plugin?.primeMirrorCache && sourcePath) {
      const mirrorRefs = groups.flatMap((g) => g.cards.filter((c) => c.isMirror && c.mirror).map((c) => c.mirror));
      if (mirrorRefs.length) plugin.primeMirrorCache(mirrorRefs, sourcePath);
    }

    for (const g of groups) {
      if (!g.topLevel) continue;
      const pref = taskBoardPref(plugin.settings, g);
      ranges.push(Decoration.widget({
        widget: new BoardToggleWidget(plugin, g.key, g.line, pref.mode, g.cards.length),
        side: 4,
      }).range(doc.line(g.line + 1).to));

      if (pref.mode === "board") {
        boardLines.add(g.line);
        const { activeGroup, breadcrumbs } = resolveActiveBoardAndBreadcrumbs(g, groups, pref);
        const pinnedIds = boardPinIds(plugin.settings, activeGroup);
        const model = buildTaskBoardModel(activeGroup, plugin, {
          groupBy: pref.groupBy,
          resolveMirror,
          pinnedIds,
        });
        ranges.push(Decoration.widget({
          widget: new TaskBoardWidget(plugin, g, activeGroup, model, pref, breadcrumbs, sourcePath, pinnedIds),
          block: true,
          side: 1,
        }).range(doc.line(g.line + 1).to));
        const hidden = [];
        for (let ln = g.line + 1; ln <= g.endLine; ln++) hidden.push(ln);
        for (const run of recordRuns(hidden)) {
          const from = Math.max(0, doc.line(run.from + 1).from - 1);
          const to = doc.line(run.to + 1).to;
          ranges.push(Decoration.replace({ inclusive: false }).range(from, to));
        }
      }
    }
    return { decorations: Decoration.set(ranges, true), boardLines };
  };

  const field = StateField.define({
    create: (state) => build(state),
    update(value, tr) {
      let changed = tr.docChanged;
      const groups = changed || tr.effects.some((e) => e.is(setTaskBoardEffect))
        ? extractTaskBoardGroups(tr.state.doc.toString(), { trackedIds: trackedBlockIds(plugin), trigger: mentionTrigger(plugin) })
        : null;
      for (const e of tr.effects) {
        if (e.is(setTaskBoardEffect)) {
          const group = groups?.find((g) => g.key === e.value.key || g.stableKey === e.value.key);
          const patch = {};
          if (e.value.mode !== undefined) patch.mode = e.value.mode;
          if (e.value.groupBy !== undefined) patch.groupBy = e.value.groupBy;
          if (e.value.zoomStack !== undefined) patch.zoomStack = e.value.zoomStack;
          rememberBoardPref(plugin, e.value.key, patch, group?.stableKey || e.value.stableKey);
          changed = true;
        }
        if (refreshEffect && e.is(refreshEffect)) changed = true;
      }
      return changed ? build(tr.state) : value;
    },
    provide: (f) => [
      EditorView.decorations.from(f, (v) => v.decorations),
      EditorView.atomicRanges.of((view) => view.state.field(f).decorations),
    ],
  });

  plugin.taskBoardField = field;
  return field;
}
