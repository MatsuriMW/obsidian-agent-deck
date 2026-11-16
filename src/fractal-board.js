// In-place WorkFlowy-style Fractal Kanban Board projection for parent tasks with child tasks.
// Pure Markdown remains the single source of truth; board mode only projects CM6 decorations.

import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
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
} from "./project-workbench.js";
import { updateNote } from "./note-updates.js";
import { mentionTrigger } from "./task-mentions.js";

export const setTaskBoardEffect = StateEffect.define();
const BOARD_CARD_MIME = "application/x-agent-deck-board-card";

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
  constructor(plugin, rootGroup, activeGroup, model, pref, breadcrumbs, sourcePath) {
    super();
    this.plugin = plugin;
    this.rootGroup = rootGroup;
    this.activeGroup = activeGroup;
    this.model = model;
    this.pref = pref;
    this.breadcrumbs = breadcrumbs;
    this.sourcePath = sourcePath;
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
      cols: model.columns.map((c) => [c.id, c.cards.map((k) => [
        k.line, k.kw, k.title, k.agent, k.liveState, k.latestConclusion, k.childCardCount, k.isMirror,
      ])]),
    });
  }
  eq(other) {
    return other.sig === this.sig && other.sourcePath === this.sourcePath;
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

    // 4. Kanban columns
    const cols = wrap.appendChild(doc.createElement("div"));
    cols.className = "ad-board__cols";
    if (this.model.columns.length > 4) {
      cols.style.gridTemplateColumns = `repeat(${Math.min(this.model.columns.length, 5)}, minmax(150px, 1fr))`;
    }

    for (const col of this.model.columns) {
      const colEl = cols.appendChild(doc.createElement("div"));
      colEl.className = `ad-board__col ad-board__col--${col.id.startsWith("parent:") ? "group" : col.id}`;
      colEl.dataset.column = col.id;

      const colHead = colEl.appendChild(doc.createElement("div"));
      colHead.className = "ad-board__colhead";
      const colName = colHead.appendChild(doc.createElement("span"));
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
          if (!cardObj) return;
          if (this.model.groupBy === "children" && Number.isInteger(col.targetParentLine)) {
            if (payload.column !== col.id) this.moveCard(cardObj, { targetParentLine: col.targetParentLine });
          } else if (payload.column !== col.id) {
            this.moveCard(cardObj, { targetColumn: col.id });
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
        const cardEl = list.appendChild(doc.createElement("div"));
        cardEl.className = `ad-board__card${card.activeJob ? " is-live" : ""}${card.isMirror ? " is-mirror" : ""}`;
        cardEl.draggable = true;
        if (card.agent && AGENTS[card.agent]) {
          cardEl.style.setProperty("--ad-agent", AGENTS[card.agent].color);
          cardEl.style.setProperty("--ad-agent-soft", AGENTS[card.agent].soft);
        }

        cardEl.addEventListener("dragstart", (e) => {
          e.stopPropagation();
          e.dataTransfer.setData(BOARD_CARD_MIME, JSON.stringify({ line: card.line, column: col.id }));
          e.dataTransfer.effectAllowed = "move";
          cardEl.classList.add("is-dragging");
        });
        cardEl.addEventListener("dragend", () => cardEl.classList.remove("is-dragging"));
        cardEl.addEventListener("dragover", (e) => {
          if (!e.dataTransfer || ![...e.dataTransfer.types].includes(BOARD_CARD_MIME)) return;
          e.preventDefault();
          e.stopPropagation();
          cardEl.classList.add("is-drop-before");
        });
        cardEl.addEventListener("dragleave", () => cardEl.classList.remove("is-drop-before"));
        cardEl.addEventListener("drop", (e) => {
          if (!e.dataTransfer || ![...e.dataTransfer.types].includes(BOARD_CARD_MIME)) return;
          e.preventDefault();
          e.stopPropagation();
          cardEl.classList.remove("is-drop-before");
          try {
            const payload = JSON.parse(e.dataTransfer.getData(BOARD_CARD_MIME));
            if (!payload || !Number.isInteger(payload.line) || payload.line === card.line) return;
            const dragged = this.model.columns.flatMap((c) => c.cards).find((c) => c.line === payload.line);
            if (!dragged || dragged.isMirror) return;
            if (this.model.groupBy === "children" && Number.isInteger(col.targetParentLine)) {
              this.moveCard(dragged, { beforeLine: card.line, targetParentLine: col.targetParentLine });
            } else {
              this.moveCard(dragged, { targetColumn: payload.column !== col.id ? col.id : "", beforeLine: card.line });
            }
          } catch { /* ignore */ }
        });

        const topRow = cardEl.appendChild(doc.createElement("div"));
        topRow.className = "ad-board__cardtop";
        const title = topRow.appendChild(doc.createElement("div"));
        title.className = "ad-board__cardtitle";
        title.textContent = card.title;
        title.title = card.isMirror && card.mirrorTarget?.path
          ? t("点击打开镜像源：{path}", { path: card.mirrorTarget.path })
          : t("点击切回大纲定位编辑");
        title.addEventListener("click", (e) => {
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

        if (card.step || card.latestConclusion) {
          const note = cardEl.appendChild(doc.createElement("div"));
          note.className = "ad-board__cardnote";
          note.textContent = truncate(card.step || card.latestConclusion, 88);
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

        const cardActions = foot.appendChild(doc.createElement("div"));
        cardActions.className = "ad-board__cardbtns";
        if (card.activeJob && this.plugin?.cancelJob) {
          const stopBtn = cardActions.appendChild(doc.createElement("button"));
          stopBtn.type = "button";
          stopBtn.className = "ad-board__mini is-danger";
          stopBtn.textContent = t("停止");
          stopBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.plugin.cancelJob(card.activeJob.id);
          });
        } else if (card.sid && this.plugin?.openConversation) {
          const chatBtn = cardActions.appendChild(doc.createElement("button"));
          chatBtn.type = "button";
          chatBtn.className = "ad-board__mini";
          chatBtn.textContent = t("正文");
          chatBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.plugin.openConversation({ sid: card.sid, agent: card.agent });
          });
        }

        if (card.column === "todo" && !card.hasLink && !card.activeJob && !card.isMirror && this.plugin?.delegateAtLine && this.sourcePath) {
          const sendBtn = cardActions.appendChild(doc.createElement("button"));
          sendBtn.type = "button";
          sendBtn.className = "ad-board__mini";
          sendBtn.textContent = t("派发");
          sendBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.plugin.delegateAtLine(this.sourcePath, card.line, {
              boardContext: buildBoardSiblingContext(this.model, card.line),
            });
          });
        }

        if (this.model.groupBy === "status") {
          const nextCol = card.column === "todo" ? "doing" : card.column === "doing" ? "done" : card.column === "review" ? "done" : "todo";
          const nextLabel = nextCol === "doing" ? "→ DOING" : nextCol === "done" ? "→ DONE" : "→ TODO";
          const stepBtn = cardActions.appendChild(doc.createElement("button"));
          stepBtn.type = "button";
          stepBtn.className = "ad-board__mini";
          stepBtn.textContent = nextLabel;
          stepBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.moveCard(card, { targetColumn: nextCol });
          });
        }
      }
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
        const model = buildTaskBoardModel(activeGroup, plugin, { groupBy: pref.groupBy, resolveMirror });
        ranges.push(Decoration.widget({
          widget: new TaskBoardWidget(plugin, g, activeGroup, model, pref, breadcrumbs, sourcePath),
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
