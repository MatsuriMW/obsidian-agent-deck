// Agent Deck — the sidebar dashboard.

import { workspaceLabel } from "./workflow.js";
import { ItemView, Menu, Modal } from "obsidian";
import { AGENTS, AGENT_ORDER, fmtMin, fmtTok, timeAgo, truncate, dayKey, dayKeyToday, dayMinute, startOfDay } from "./constants.js";
import { agentIcon, setLucide, stateIcon } from "./icons.js";
import { lattice } from "./lattice.js";
import { SESSION_MIME } from "./editor.js";
import { t } from "./i18n.js";
import { buildProjectGroups, buildNowStatusGroups, planRecentProjectDisplay, isWaitingSession, isActiveNowSession, STANDALONE_PROJECT_ID } from "./project-workbench.js";
import { treePlan, treeOrder } from "./session-tree.js";

export const VIEW_TYPE = "agent-deck-view";
export const RECENT_DAY_OPTIONS = [7, 30, 120];
export const MAX_RECENT_CARDS = 30;

export function filterRecentRows(rows, filter = "all", now = Date.now()) {
  if (filter === "live") return rows.filter((x) => ["run", "starting", "running", "busy"].includes(x.state));
  if (filter === "wait") return rows.filter((x) => isWaitingSession(x, now));
  if (AGENTS[filter]) return rows.filter((x) => x.agent === filter);
  return rows;
}

export function planRecentDisplay(rows, { filter = "all", expanded = new Set(), maxCards = MAX_RECENT_CARDS } = {}) {
  if (AGENTS[filter]) {
    const cards = rows.slice(0, maxCards);
    return {
      mode: "flat",
      total: rows.length,
      renderedCount: cards.length,
      hiddenCount: Math.max(0, rows.length - cards.length),
      cards,
      groups: [],
    };
  }
  const byAgent = new Map();
  for (const s of rows) {
    const id = s.agent || "claude";
    let g = byAgent.get(id);
    if (!g) byAgent.set(id, g = { agent: id, items: [] });
    g.items.push(s);
  }
  const groups = [...byAgent.values()].slice(0, maxCards);
  let extraBudget = Math.max(0, maxCards - groups.length);
  let renderedCount = 0;
  const planned = groups.map((g) => {
    const isSingle = g.items.length === 1;
    const isExpanded = !isSingle && expanded.has(g.agent);
    const extra = isExpanded ? Math.min(g.items.length - 1, extraBudget) : 0;
    extraBudget -= extra;
    const visibleItems = g.items.slice(0, 1 + extra);
    renderedCount += visibleItems.length;
    return {
      agent: g.agent,
      items: g.items,
      visibleItems,
      expanded: isExpanded,
      stacked: !isSingle && !isExpanded,
      unshownCount: Math.max(0, g.items.length - visibleItems.length),
    };
  });
  return {
    mode: "grouped",
    total: rows.length,
    renderedCount,
    hiddenCount: Math.max(0, rows.length - renderedCount),
    cards: [],
    groups: planned,
  };
}

export class AgentDeckView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.filter = "all";
    this.search = "";
    this.expandedAgents = new Set();
    this.expandedProjects = new Set();
    this.collapsedNowProjects = new Set();
    this.collapsedNowStatus = new Set();
    this._scroll = 0;
    this._bottomSlack = 0;
  }

  recentDays() {
    const v = Number(this.plugin.settings?.ui?.recentDays);
    return RECENT_DAY_OPTIONS.includes(v) ? v : 7;
  }

  nowGroupBy() {
    const v = this.plugin.settings?.ui?.nowGroupBy;
    return v === "flat" || v === "status" ? v : "project";
  }

  recentGroupBy() {
    return this.plugin.settings?.ui?.recentGroupBy === "project" ? "project" : "agent";
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "Agent Deck"; }
  getIcon() { return "gauge"; }

  async onOpen() {
    this.contentEl.addClass("ad-view");
    this.plugin.views.add(this);
    const onScroll = () => {
      if (this._reconcilingScroll) return;
      this._scroll = this.contentEl.scrollTop;
      this.reconcileBottomSlack();
    };
    if (typeof this.registerDomEvent === "function") this.registerDomEvent(this.contentEl, "scroll", onScroll, { passive: true });
    else if (this.contentEl.addEventListener) this.contentEl.addEventListener("scroll", onScroll, { passive: true });
    const refreshPending = () => { if (this._pendingRender) this.render(); };
    this.registerEvent(this.app.workspace.on("layout-change", refreshPending));
    this.registerEvent(this.app.workspace.on("active-leaf-change", refreshPending));
    this.render();
  }

  async onClose() {
    this.plugin.views.delete(this);
  }

  onResize() {
    if (this._pendingRender) this.render();
    else this.reconcileBottomSlack();
  }

  render() {
    if (this.containerEl.isShown && !this.containerEl.isShown()) { this._pendingRender = true; return; }
    // 正在拖「现在」里的卡片排序：重画会把拖着的卡片换掉，等松手再画
    if (this._dragSid || this._dragAgent) { this._pendingRender = true; return; }
    // 搜索框里正在用输入法拼字：重画会把输入框换掉、打断拼字，等拼完再画
    if (this._composing) { this._pendingRender = true; return; }
    this._pendingRender = false;
    const root = this.contentEl;
    if (root.children?.length && typeof root.scrollTop === "number") this._scroll = root.scrollTop;
    const focused = document.activeElement;
    const searchWasFocused = focused && focused.classList && focused.classList.contains("ad-search__input");
    root.empty();
    root.addClass("ad-view");
    const dash = root.createDiv({ cls: "ad-dash" });
    if (this._bottomSlack > 0) dash.style.setProperty("--ad-slack", `${this._bottomSlack}px`);

    const p = this.plugin;
    const now = Date.now();
    const todayKey = dayKeyToday(p.settings);
    const today = p.store.get(todayKey);
    const live = p.liveSessions({ hours: 6 });
    const running = live.filter((x) => ["run", "starting", "running"].includes(x.state) || (x.agent && x.state === "busy"));
    const waiting = live.filter((x) => isWaitingSession(x, now));
    const days = this.recentDays();
    const recent = p.recentSessions({ days, limit: 1000 });

    // Header：会话搜索 + 两个按钮
    const head = dash.createDiv({ cls: "ad-head" });
    const search = head.createDiv({ cls: "ad-search" });
    setLucide(search.createSpan({ cls: "ad-search__icon" }), "search");
    const input = search.createEl("input", { cls: "ad-search__input", attr: { placeholder: t("搜会话：标题、项目、第一步…"), value: this.search } });
    const actions = head.createDiv({ cls: "ad-head__actions" });
    const workbenchBtn = actions.createEl("button", { cls: "ad-iconbtn", attr: { "aria-label": t("打开项目工作台（小队编排与拆解派发）") } });
    setLucide(workbenchBtn.createSpan({ cls: "ad-iconbtn__icon" }), "folder-kanban");
    workbenchBtn.onclick = () => p.openProjectWorkbench?.();
    if (p.settings.experimentalDashboard !== false) {
      const review = actions.createEl("button", { cls: "ad-iconbtn", attr: { "aria-label": t("打开 Agent Deck 回顾 Dashboard") } });
      setLucide(review.createSpan({ cls: "ad-iconbtn__icon" }), "chart-no-axes-combined");
      review.onclick = () => p.activateDashboard();
    }
    const scan = actions.createEl("button", { cls: "ad-iconbtn", attr: { "aria-label": t("重新扫描本机会话") } });
    setLucide(scan.createSpan({ cls: "ad-iconbtn__icon" }), "refresh-cw");
    scan.onclick = () => p.scanNow();
    const gear = actions.createEl("button", { cls: "ad-iconbtn", attr: { "aria-label": t("设置") } });
    setLucide(gear.createSpan({ cls: "ad-iconbtn__icon" }), "settings-2");
    gear.onclick = () => p.openSettings();
    input.addEventListener("compositionstart", () => { this._composing = true; });
    input.addEventListener("compositionend", () => {
      this._composing = false;
      this._pendingRender = false;
      this.search = input.value;
      this.render();
    });
    input.oninput = (e) => {
      if (e.isComposing || this._composing) return;
      const was = !!this.search.trim();
      this.search = input.value;
      // 有字和没字是两种版面（搜索结果 / 仪表盘），切换时整页重画；否则只刷结果列表
      if (was !== !!this.search.trim() || !this._resultSec) this.render();
      else this.renderSearch(this._resultSec);
    };
    input.onkeydown = (e) => { if (e.key === "Escape" && input.value) { e.preventDefault(); input.value = ""; this.search = ""; this.render(); } };

    // 有搜索词时只显示搜索结果，放在搜索框正下方，范围是本机扫到的全部会话
    this._resultSec = null;
    if (this.search.trim()) {
      this._bottomSlack = 0;
      this._scroll = 0;
      dash.style.setProperty("--ad-slack", "0px");
      const sec = dash.createDiv({ cls: "ad-sec ad-sec--search" });
      sec._head = this.secHead(sec, t("搜索结果"));
      sec._list = sec.createDiv({ cls: "ad-sessionlist" });
      this._resultSec = sec;
      this.renderSearch(sec);
      root.scrollTop = 0;
      if (searchWasFocused) { const i = root.querySelector(".ad-search__input"); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
      return;
    }

    const journalActions = dash.createDiv({ cls: "ad-btnrow" });
    for (const action of [
      { label: t("整理日志"), hint: t("按正在做、还要做、已完成整理分区，分割线外的笔记保持原样"), run: () => p.organizeJournal() },
      { label: t("归档已完成的日志到…"), hint: t("把已完成的 AI 日志移出这篇日记，写进你选的归档文件"), run: () => p.archiveCompletedJournal() },
    ]) {
      const button = journalActions.createEl("button", { text: action.label });
      button.title = action.hint;
      button.onclick = async () => { button.disabled = true; try { await action.run(); } catch (e) { p.notice(e.message); } finally { button.disabled = false; } };
    }

    journalActions.createEl("button", { text: t("跳到正在做") }).onclick = () => p.jumpRunningProject();

    // Hero：今天的数字 + 时间轴 + 花时间最多的项目
    const hero = dash.createDiv({ cls: "ad-hero" });
    const nums = hero.createDiv({ cls: "ad-hero__nums" });
    this.num(nums, fmtMin(today ? today.wall : 0), t("协作时长"), this.vsWeek(today));
    this.num(nums, fmtTok(today ? today.out : 0), t("产出 token"), today && today.calls ? t("{n} 次调用", { n: today.calls }) : "");
    this.num(nums, String(today ? today.sessions || 0 : 0), t("会话数"), today && today.prompts ? t("{n} 次提问", { n: today.prompts }) : "");
    if (today && today.wall) {
      this.dayTimeline(hero, today);
      this.topProjects(hero, today);
    } else {
      hero.createDiv({ cls: "ad-hero__hint", text: t("今天还没有会话") });
    }

    // Now
    const nowSec = dash.createDiv({ cls: "ad-sec ad-sec--now" });
    const nowGroupBy = this.nowGroupBy();
    const nowHead = this.secHead(nowSec, t("现在"), t("{run} 个在跑 · {wait} 个等你", { run: running.length, wait: waiting.length }));
    const nowSwitch = nowHead.createDiv({ cls: "ad-range" });
    for (const [id, label] of [["project", t("按项目")], ["status", t("按状态")], ["flat", t("列表")]]) {
      const b = nowSwitch.createEl("button", { cls: "ad-chip ad-nowgroup__btn" + (nowGroupBy === id ? " is-on" : ""), text: label });
      b.onclick = () => {
        if (this.nowGroupBy() === id) return;
        (p.settings.ui ||= {}).nowGroupBy = id;
        p.saveSettings();
        this.render();
      };
    }
    const nowList = nowSec.createDiv({ cls: "ad-nowlist" });
    if (nowGroupBy === "project") {
      const nowActive = live.filter((x) => isActiveNowSession(x, now));
      this.renderNowProjects(nowList, nowActive);
    } else if (nowGroupBy === "status") {
      const nowActive = live.filter((x) => isActiveNowSession(x, now));
      this.renderNowStatus(nowList, nowActive, now);
    } else {
      const nowItems = this.nowOrdered([...running, ...waiting]).slice(0, 6);
      if (!nowItems.length) this.empty(nowList, t("现在没有在跑的会话"));
      for (const s of nowItems) this.sessionCard(nowList, s, true);
      this.nowReorder(nowList);
    }

    this.agentSection(dash, today);

    // Usage
    if (p.settings.ui.showUsageBars !== false) {
      const usageSec = dash.createDiv({ cls: "ad-sec" });
      this.secHead(usageSec, t("最近 14 天"));
      this.usageBars(usageSec);
    }

    // Recent
    const recSec = dash.createDiv({ cls: "ad-sec ad-sec--recent" });
    const recentGroupBy = this.recentGroupBy();
    const filteredRecent = filterRecentRows(recent, this.filter);
    const recHead = this.secHead(recSec, t("最近的会话"), t("{n} 个 · 最近 {days} 天", { n: filteredRecent.length, days }));
    const range = recHead.createDiv({ cls: "ad-range" });
    for (const [id, label] of [["agent", t("按 Agent")], ["project", t("按项目")]]) {
      const gb = range.createEl("button", { cls: "ad-chip ad-groupby__btn" + (recentGroupBy === id ? " is-on" : ""), text: label });
      gb.onclick = () => {
        if (this.recentGroupBy() === id) return;
        this._bottomSlack = 0;
        (p.settings.ui ||= {}).recentGroupBy = id;
        p.saveSettings();
        this.render();
      };
    }
    for (const d of RECENT_DAY_OPTIONS) {
      const rb = range.createEl("button", { cls: "ad-chip ad-range__btn" + (days === d ? " is-on" : ""), text: t("{days} 天", { days: d }) });
      rb.onclick = () => {
        if (this.recentDays() === d) return;
        this._bottomSlack = 0;
        (p.settings.ui ||= {}).recentDays = d;
        p.saveSettings();
        this.render();
      };
    }
    const filters = recHead.createDiv({ cls: "ad-filters" });
    for (const [id, label] of [["all", t("全部")], ["live", t("在跑")], ["wait", t("等你")], ["claude", "Claude"], ["codex", "Codex"], ["workbuddy", "WorkBuddy"], ["dsh", "DSH"], ["antigravity", "Antigravity"], ["opencode", "OpenCode"], ["qoder", "Qoder"], ["cursor", "Cursor"], ["grokbot", "Grok Bot"]]) {
      const b = filters.createEl("button", { cls: "ad-chip" + (this.filter === id ? " is-on" : ""), text: label });
      b.onclick = () => { this._bottomSlack = 0; this.filter = id; this.render(); };
    }
    recSec._head = recHead;
    recSec._rows = filteredRecent;
    recSec._list = recSec.createDiv({ cls: "ad-sessionlist" });
    this.renderSessions(recSec);

    root.scrollTop = this._scroll;
    this.reconcileBottomSlack(dash);
    this.playFly(dash);
    if (searchWasFocused) { const i = root.querySelector(".ad-search__input"); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  }

  agentSection(parent, today) {
    const sec = parent.createDiv({ cls: "ad-sec" });
    this.secHead(sec, "Agents", "", () => new AgentCardsModal(this).open());
    const ids = this.visibleAgentIds();
    const mode = ids.length <= 3 ? "list" : "grid";
    const grid = sec.createDiv({ cls: `ad-agentgrid ad-agentgrid--${mode}` });
    grid.dataset.layout = mode;
    for (const id of ids) this.agentCard(grid, id, today, mode);
    if (!ids.length) this.empty(sec, t("没有显示的 Agent 卡片，可在「管理」或 Agent 设置中添加。"));
    this.agentReorder(grid);
    return grid;
  }

  runningAgents() {
    return new Set(this.plugin.liveSessions({ hours: 6 }).filter(session => ["run", "starting", "running", "busy"].includes(session.state)).map(session => session.agent));
  }

  agentPriority(id) {
    return this.agentLayout().pinned.includes(id) ? 0 : this.runningAgents().has(id) ? 1 : 2;
  }

  agentLayout() {
    const saved = this.plugin.settings.ui.agentCards || {};
    const valid = (ids) => [...new Set((Array.isArray(ids) ? ids : []).filter((id) => AGENT_ORDER.includes(id)))];
    return { order: valid([...(Array.isArray(saved.order) ? saved.order : []), ...AGENT_ORDER]), hidden: valid(saved.hidden), pinned: valid(saved.pinned) };
  }

  visibleAgentIds() {
    const { order, hidden, pinned } = this.agentLayout();
    const visible = order.filter((id) => !hidden.includes(id) && this.plugin.agentEnabled(id));
    const running = this.runningAgents();
    const priority = id => pinned.includes(id) ? 0 : running.has(id) ? 1 : 2;
    return visible.sort((a, b) => priority(a) - priority(b));
  }

  async updateAgentCards(change) {
    const layout = this.agentLayout();
    change(layout);
    this.plugin.settings.ui.agentCards = layout;
    await this.plugin.saveSettings();
    for (const view of this.plugin.views) view.render();
  }

  moveAgentCard(id, target, after = false) {
    const visible = this.visibleAgentIds();
    if (id === target || !visible.includes(id) || !visible.includes(target) || this.agentPriority(id) !== this.agentPriority(target)) return;
    return this.updateAgentCards((layout) => {
      layout.order = layout.order.filter((x) => x !== id);
      layout.order.splice(layout.order.indexOf(target) + (after ? 1 : 0), 0, id);
    });
  }

  agentReorder(grid) {
    grid.addEventListener("dragover", (e) => {
      if (!this._dragAgent) return;
      const target = e.target.closest(".ad-agentcard");
      if (!target || !grid.contains(target)) return;
      if (this.agentPriority(this._dragAgent) !== this.agentPriority(target.dataset.agent)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    grid.addEventListener("drop", (e) => {
      const id = this._dragAgent;
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      const target = e.target.closest(".ad-agentcard");
      if (!target || !grid.contains(target)) return;
      const rect = target.getBoundingClientRect();
      this._dragAgent = null;
      this.moveAgentCard(id, target.dataset.agent, grid.dataset.layout === "list" ? e.clientY > rect.top + rect.height / 2 : e.clientX > rect.left + rect.width / 2);
      this.render();
    });
  }

  // 「现在」：去掉移除过的，按拖出来的顺序排；没排过的（新来的）放最上面
  nowOrdered(items) {
    const st = this.plugin.settings;
    const hidden = st.nowHidden || {};
    const order = st.nowOrder || [];
    return items
      .filter((x) => !hidden[x.sid])
      .map((x, i) => ({ x, i, k: order.indexOf(x.sid) }))
      .sort((a, b) => {
        if (a.k < 0 && b.k < 0) return a.i - b.i;
        if (a.k < 0) return -1;
        if (b.k < 0) return 1;
        return a.k - b.k;
      })
      .map((o) => o.x);
  }

  nowReorder(list) {
    list.addEventListener("dragover", (e) => {
      const dragged = this._dragSid && list.querySelector(`.ad-sess[data-sid="${CSS.escape(this._dragSid)}"]`);
      if (!dragged) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const after = [...list.querySelectorAll(".ad-sess:not(.is-dragging)")].find((el) => {
        const r = el.getBoundingClientRect();
        return e.clientY < r.top + r.height / 2;
      });
      if (after) { if (dragged.nextSibling !== after) list.insertBefore(dragged, after); }
      else if (list.lastChild !== dragged) list.appendChild(dragged);
    });
    list.addEventListener("drop", (e) => {
      if (!this._dragSid) return;
      e.preventDefault();
      this._nowDropped = true;
      const sids = [...list.querySelectorAll(".ad-sess")].map((el) => el.dataset.sid);
      const rest = (this.plugin.settings.nowOrder || []).filter((x) => !sids.includes(x));
      this.plugin.settings.nowOrder = [...sids, ...rest].slice(0, 60);
      this.plugin.saveSettings();
    });
  }

  removeFromNow(sid) {
    const st = this.plugin.settings;
    const cutoff = Date.now() - 3 * 86400000;
    const hidden = Object.fromEntries(Object.entries(st.nowHidden || {}).filter(([, at]) => at > cutoff));
    hidden[sid] = Date.now();
    st.nowHidden = hidden;
    st.nowOrder = (st.nowOrder || []).filter((x) => x !== sid);
    this.plugin.saveSettings();
    this.render();
  }

  renderNowProjects(nowList, liveRows) {
    const p = this.plugin;
    const hidden = p.settings?.nowHidden || {};
    const visibleRows = this.nowOrdered(liveRows);
    const groups = buildProjectGroups(visibleRows, {
      jobs: p.jobs || {},
      agentEnabled: (id) => p.agentEnabled(id),
    }).map((g) => ({
      ...g,
      sessions: g.sessions.filter((s) => !hidden[s.sid]),
    })).filter((g) => g.sessions.length > 0);
    if (!groups.length) return this.empty(nowList, t("现在没有在跑的会话"));
    for (const g of groups) {
      const collapsed = this.collapsedNowProjects.has(g.id);
      const card = nowList.createDiv({ cls: `ad-projgroup ${collapsed ? "is-collapsed" : "is-open"}${g.counts.attention ? " has-attention" : ""}` });
      card.dataset.project = g.id;
      const head = card.createDiv({ cls: "ad-projgroup__head" });
      const toggle = head.createEl("button", { cls: "ad-projgroup__toggle", attr: { type: "button", title: g.cwds[0] || g.name } });
      toggle.createSpan({ cls: "ad-projgroup__chev", text: collapsed ? "▸" : "▾" });
      toggle.createSpan({ cls: "ad-projgroup__name", text: g.name });
      const glyphs = toggle.createSpan({ cls: "ad-projgroup__agents" });
      for (const id of g.agents.slice(0, 4)) agentIcon(glyphs.createSpan({ cls: "ad-glyph" }), id);
      const badges = toggle.createSpan({ cls: "ad-projgroup__badges" });
      if (g.counts.running) badges.createSpan({ cls: "ad-projbadge is-live", text: t("{n} 在跑", { n: g.counts.running }) });
      if (g.counts.waiting) badges.createSpan({ cls: "ad-projbadge is-wait", text: t("{n} 等你", { n: g.counts.waiting }) });
      if (g.counts.error || g.counts.limit) badges.createSpan({ cls: "ad-projbadge is-error", text: t("{n} 异常", { n: g.counts.error + g.counts.limit }) });
      toggle.onclick = () => {
        if (this.collapsedNowProjects.has(g.id)) this.collapsedNowProjects.delete(g.id);
        else this.collapsedNowProjects.add(g.id);
        this.render();
      };
      const actions = head.createDiv({ cls: "ad-projgroup__actions" });
      if (!g.isStandalone && g.cwds[0] && p.openProjectFolder) {
        const dirBtn = actions.createEl("button", { cls: "ad-iconbtn ad-iconbtn--xs", attr: { type: "button", "aria-label": t("打开项目目录：{cwd}", { cwd: g.cwds[0] }), title: t("打开项目目录：{cwd}", { cwd: g.cwds[0] }) } });
        setLucide(dirBtn.createSpan({ cls: "ad-iconbtn__icon" }), "folder-open");
        dirBtn.onclick = (e) => {
          e.stopPropagation();
          p.openProjectFolder(g.cwds[0]);
        };
      }
      if (p.openProjectWorkbench) {
        const wb = actions.createEl("button", { cls: "ad-iconbtn ad-iconbtn--xs", attr: { type: "button", "aria-label": t("在项目工作台编排小队"), title: t("在项目工作台编排小队") } });
        setLucide(wb.createSpan({ cls: "ad-iconbtn__icon" }), "folder-kanban");
        wb.onclick = (e) => {
          e.stopPropagation();
          p.openProjectWorkbench({ projectName: g.isStandalone ? "" : g.name, cwd: g.cwds[0] || p.vaultPath });
        };
      }
      if (g.activeJobIds.length && p.cancelProjectJobs) {
        const stop = actions.createEl("button", { cls: "ad-iconbtn ad-iconbtn--xs is-danger", attr: { type: "button", "aria-label": t("停止本项目的活跃任务"), title: t("停止本项目的活跃任务") } });
        setLucide(stop.createSpan({ cls: "ad-iconbtn__icon" }), "square");
        stop.onclick = (e) => {
          e.stopPropagation();
          p.cancelProjectJobs(g.id, g.activeJobIds);
        };
      }
      if (!collapsed) {
        const body = card.createDiv({ cls: "ad-projgroup__list" });
        for (const s of g.sessions) this.sessionCard(body, s, true);
      }
    }
  }

  renderNowStatus(nowList, liveRows, now = Date.now()) {
    const p = this.plugin;
    const hidden = p.settings?.nowHidden || {};
    const groups = buildNowStatusGroups(this.nowOrdered(liveRows), {
      jobs: p.jobs || {},
      agentEnabled: (id) => p.agentEnabled(id),
      now,
    }).map((g) => ({
      ...g,
      sessions: g.sessions.filter((s) => !hidden[s.sid]),
    })).filter((g) => g.sessions.length > 0);
    if (!groups.length) return this.empty(nowList, t("现在没有在跑的会话"));
    for (const g of groups) {
      const collapsed = this.collapsedNowStatus.has(g.id);
      const card = nowList.createDiv({ cls: `ad-projgroup ${collapsed ? "is-collapsed" : "is-open"}${g.attention ? " has-attention" : ""}` });
      card.dataset.status = g.id;
      const head = card.createDiv({ cls: "ad-projgroup__head" });
      const toggle = head.createEl("button", { cls: "ad-projgroup__toggle", attr: { type: "button" } });
      toggle.createSpan({ cls: "ad-projgroup__chev", text: collapsed ? "▸" : "▾" });
      toggle.createSpan({ cls: "ad-projgroup__name", text: t(g.label) });
      const badges = toggle.createSpan({ cls: "ad-projgroup__badges" });
      badges.createSpan({ cls: `ad-projbadge is-${g.tone}`, text: String(g.sessions.length) });
      toggle.onclick = () => {
        if (this.collapsedNowStatus.has(g.id)) this.collapsedNowStatus.delete(g.id);
        else this.collapsedNowStatus.add(g.id);
        this.render();
      };
      if (!collapsed) {
        const body = card.createDiv({ cls: "ad-projgroup__list" });
        for (const s of g.sessions) this.sessionCard(body, s, true);
      }
    }
  }

  renderSessions(sec) {
    const list = sec._list || sec.querySelector(".ad-sessionlist");
    if (!list) return;
    list.empty();
    const p = this.plugin;
    const days = this.recentDays();
    const rows = sec._rows || filterRecentRows(p.recentSessions({ days, limit: 1000 }), this.filter);
    sec._rows = rows;
    if (!rows.length) return this.empty(list, t("没有符合条件的会话"));
    // 父子树：父在同一份列表里就排在父后面并缩进；父不在就留在顶层（分过组也算不在）。
    const tree = treePlan(rows);
    const ordered = (items) => treeOrder(items, tree);
    const depthOf = (s) => tree.depth.get(s.sid) || 0;
    if (this.recentGroupBy() === "project" && !AGENTS[this.filter]) {
      const plan = planRecentProjectDisplay(rows, {
        expanded: this.expandedProjects,
        maxCards: MAX_RECENT_CARDS,
        jobs: p.jobs || {},
        agentEnabled: (id) => p.agentEnabled(id),
      });
      for (const g of plan.groups) {
        if (g.items.length === 1) {
          this.sessionCard(list, g.visibleItems[0], false, depthOf(g.visibleItems[0]));
          continue;
        }
        const leadAgent = AGENTS[g.agents[0]] || AGENTS.claude;
        const stack = list.createDiv({ cls: `ad-stack ad-stack--project ${g.stacked ? "is-collapsed" : "is-expanded"}` });
        stack.dataset.project = g.id;
        stack.style.setProperty("--ad-agent", leadAgent.color);
        stack.style.setProperty("--ad-agent-soft", leadAgent.soft);
        if (g.stacked) {
          const expand = () => this.toggleStackGroup(sec, stack, g.id, true, "project");
          const topWrap = stack.createDiv({ cls: "ad-stack__top" });
          this.sessionCard(topWrap, g.visibleItems[0], false, depthOf(g.visibleItems[0]));
          const topCard = topWrap.firstElementChild;
          if (topCard) topCard.onclick = expand;
          const bar = stack.createEl("button", { cls: "ad-stack__bar", attr: { type: "button" } });
          bar.createSpan({ cls: "ad-stack__label", text: t("{project} · 共 {total} 条对话 · 点击展开 +{more}", { project: g.name, total: g.items.length, more: g.items.length - 1 }) });
          bar.createSpan({ cls: "ad-stack__chev", text: "▾" });
          bar.onclick = expand;
        } else {
          const head = stack.createEl("button", { cls: "ad-stack__head", attr: { type: "button" } });
          const headLeft = head.createSpan({ cls: "ad-stack__title" });
          for (const id of g.agents.slice(0, 3)) agentIcon(headLeft.createSpan({ cls: "ad-glyph" }), id);
          headLeft.createSpan({ text: t("{project} · 共 {total} 条对话", { project: g.name, total: g.items.length }) });
          head.createSpan({ cls: "ad-stack__toggle", text: `${t("收起")} ▴` });
          head.onclick = () => this.toggleStackGroup(sec, stack, g.id, false, "project");
          const body = stack.createDiv({ cls: "ad-stack__list" });
          for (const s of ordered(g.visibleItems)) this.sessionCard(body, s, false, depthOf(s));
          if (g.unshownCount > 0) {
            stack.createDiv({ cls: "ad-stack__foot", text: t("已达单页 {max} 张卡片上限，另有 {n} 条较早会话未显示", { max: MAX_RECENT_CARDS, n: g.unshownCount }) });
          }
        }
      }
      return;
    }
    const plan = planRecentDisplay(rows, { filter: this.filter, expanded: this.expandedAgents, maxCards: MAX_RECENT_CARDS });
    if (plan.mode === "flat") {
      for (const s of ordered(plan.cards)) this.sessionCard(list, s, false, depthOf(s));
      if (plan.hiddenCount > 0) {
        list.createDiv({ cls: "ad-recent-more", text: t("已显示最新 {shown} / 共 {total} 张卡片，更多请用顶部搜索", { shown: plan.renderedCount, total: plan.total }) });
      }
      return;
    }
    for (const g of plan.groups) {
      const a = AGENTS[g.agent] || AGENTS.claude;
      if (g.items.length === 1) {
        this.sessionCard(list, g.visibleItems[0], false, depthOf(g.visibleItems[0]));
        continue;
      }
      const stack = list.createDiv({ cls: `ad-stack ${g.stacked ? "is-collapsed" : "is-expanded"}` });
      stack.dataset.agent = g.agent;
      stack.style.setProperty("--ad-agent", a.color);
      stack.style.setProperty("--ad-agent-soft", a.soft);
      if (g.stacked) {
        const expand = () => this.toggleStackGroup(sec, stack, g.agent, true, "agent");
        const topWrap = stack.createDiv({ cls: "ad-stack__top" });
        this.sessionCard(topWrap, g.visibleItems[0], false, depthOf(g.visibleItems[0]));
        const topCard = topWrap.firstElementChild;
        if (topCard) topCard.onclick = expand;
        const bar = stack.createEl("button", { cls: "ad-stack__bar", attr: { type: "button" } });
        bar.createSpan({ cls: "ad-stack__label", text: t("共 {total} 条 {agent} 对话 · 点击展开 +{more}", { total: g.items.length, agent: a.short, more: g.items.length - 1 }) });
        bar.createSpan({ cls: "ad-stack__chev", text: "▾" });
        bar.onclick = expand;
      } else {
        const head = stack.createEl("button", { cls: "ad-stack__head", attr: { type: "button" } });
        const headLeft = head.createSpan({ cls: "ad-stack__title" });
        agentIcon(headLeft.createSpan({ cls: "ad-glyph" }), g.agent);
        headLeft.createSpan({ text: t("{agent} · 共 {total} 条对话", { agent: a.short, total: g.items.length }) });
        head.createSpan({ cls: "ad-stack__toggle", text: `${t("收起")} ▴` });
        head.onclick = () => this.toggleStackGroup(sec, stack, g.agent, false, "agent");
        const body = stack.createDiv({ cls: "ad-stack__list" });
        for (const s of ordered(g.visibleItems)) this.sessionCard(body, s, false, depthOf(s));
        if (g.unshownCount > 0) {
          stack.createDiv({ cls: "ad-stack__foot", text: t("已达单页 {max} 张卡片上限，另有 {n} 条较早会话未显示", { max: MAX_RECENT_CARDS, n: g.unshownCount }) });
        }
      }
    }
  }

  // 收起或展开同 Agent/同项目堆叠时锚定该组顶部在视口中的位置，避免高处横条因高度骤减被 scrollTop 夹紧而突然下跳；
  // 留出的底部余量只维持当前位置，并在向上滚动或内容重新撑高时自动收回。
  toggleStackGroup(sec, stack, key, expand, kind = "agent") {
    const root = this.contentEl;
    const dash = root?.querySelector?.(".ad-dash");
    const rootRect = root?.getBoundingClientRect?.();
    const stackRect = stack?.getBoundingClientRect?.();
    const prevRelTop = rootRect && stackRect ? stackRect.top - rootRect.top : null;
    const set = kind === "project" ? this.expandedProjects : this.expandedAgents;
    if (expand) set.add(key);
    else set.delete(key);
    this.renderSessions(sec);
    if (!dash || prevRelTop === null || !root.clientHeight) return;
    const attr = kind === "project" ? "project" : "agent";
    const nextStack = [...(sec._list?.children || [])].find((el) => el.dataset?.[attr] === key);
    const nextRootRect = root.getBoundingClientRect?.();
    const nextStackRect = nextStack?.getBoundingClientRect?.();
    if (!nextRootRect || !nextStackRect) return;
    const nextContentTop = nextStackRect.top - nextRootRect.top + root.scrollTop;
    const targetScrollTop = Math.max(0, Math.round(nextContentTop - prevRelTop));
    this._reconcilingScroll = true;
    try {
      this.syncBottomSlack(dash, targetScrollTop);
      root.scrollTop = targetScrollTop;
      this._scroll = root.scrollTop;
    } finally {
      this._reconcilingScroll = false;
    }
  }

  toggleAgentGroup(sec, stack, agent, expand) {
    return this.toggleStackGroup(sec, stack, agent, expand, "agent");
  }

  syncBottomSlack(dash, targetScrollTop, maxCap = Infinity) {
    const root = this.contentEl;
    if (!root || !dash || !root.clientHeight) return 0;
    dash.style.setProperty("--ad-slack", "0px");
    const naturalHeight = root.scrollHeight;
    const naturalMax = Math.max(0, naturalHeight - root.clientHeight);
    const slack = targetScrollTop > naturalMax
      ? Math.min(maxCap, Math.ceil(targetScrollTop + root.clientHeight - naturalHeight))
      : 0;
    this._bottomSlack = slack;
    dash.style.setProperty("--ad-slack", `${slack}px`);
    return slack;
  }

  reconcileBottomSlack(dash = this.contentEl?.querySelector?.(".ad-dash")) {
    if (!this._bottomSlack || this._reconcilingScroll || !dash) return;
    const root = this.contentEl;
    if (!root || !root.clientHeight) return;
    this._reconcilingScroll = true;
    try {
      const savedScrollTop = root.scrollTop;
      this.syncBottomSlack(dash, savedScrollTop, this._bottomSlack);
      if (root.scrollTop !== savedScrollTop) root.scrollTop = savedScrollTop;
    } finally {
      this._reconcilingScroll = false;
    }
  }

  // 搜索：空格分开的几个词都要命中（不分大小写），查标题、首条消息、项目路径、当前步骤、最近回复、模型、Agent 名和会话号
  renderSearch(sec) {
    const list = sec._list;
    list.empty();
    const words = this.search.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = this.plugin.recentSessions({ days: 3650, limit: 5000 }).filter((x) => {
      const hay = [x.title, x.text, x.cwd, x.step, x.lastText, x.model, x.parentTitle, AGENTS[x.agent]?.name, x.agent, x.sid].filter(Boolean).join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    const sub = sec._head.querySelector(".ad-sechead__sub") || sec._head.firstChild.createSpan({ cls: "ad-sechead__sub" });
    sub.setText(rows.length > 100 ? t("{n} 个 · 显示最近 100 个", { n: rows.length }) : t("{n} 个", { n: rows.length }));
    if (!rows.length) return this.empty(list, t("没有找到会话"));
    for (const s of rows.slice(0, 100)) this.sessionCard(list, s, false);
  }

  secHead(parent, title, sub, action) {
    const h = parent.createDiv({ cls: "ad-sechead" });
    const titleEl = h.createDiv({ cls: "ad-sechead__title" });
    titleEl.createSpan({ text: title });
    if (sub) titleEl.createSpan({ cls: "ad-sechead__sub", text: sub });
    if (action) {
      const b = h.createEl("button", { cls: "ad-linkbtn", text: t("管理") });
      b.onclick = action;
    }
    return h;
  }

  num(parent, value, label, sub) {
    const box = parent.createDiv({ cls: "ad-num" });
    box.createDiv({ cls: "ad-num__v", text: value });
    box.createDiv({ cls: "ad-num__l", text: label });
    if (sub) box.createDiv({ cls: "ad-num__sub", text: sub });
  }

  // 今天的协作时长比前 7 天里有用量的日子平均多还是少（有 3 天以上才算）
  vsWeek(today) {
    if (!today || !today.wall) return "";
    const p = this.plugin;
    const prev = [];
    for (let i = 1; i <= 7; i++) { const d = p.store.get(dayKey(Date.now() - i * 864e5, p.settings)); if (d && d.wall) prev.push(d.wall); }
    if (prev.length < 3) return "";
    const pct = Math.round((today.wall / (prev.reduce((a, b) => a + b, 0) / prev.length) - 1) * 100);
    return t("较 7 日均 {pct}", { pct: `${pct >= 0 ? "+" : ""}${pct}%` });
  }

  // 今天哪几段在用：从第一段所在的整点画到现在，每个 Agent 一条
  dayTimeline(parent, today) {
    const p = this.plugin;
    const start = startOfDay(Date.now(), p.settings);
    const nowMin = dayMinute(Date.now(), p.settings);
    const first = Math.min(...(today.segs || []).map((s) => s[0]), nowMin);
    const from = Math.floor(first / 60) * 60;
    const to = Math.max(Math.ceil(nowMin / 60) * 60, from + 180);
    const span = to - from;
    const clock = (m) => { const d = new Date(start + m * 60000); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`; };
    const box = parent.createDiv({ cls: "ad-day" });
    const lanes = AGENT_ORDER.filter((id) => today.by && today.by[id] && (today.by[id].segs || []).length);
    for (const id of lanes) {
      const a = AGENTS[id];
      const lane = box.createDiv({ cls: "ad-day__lane", attr: { "aria-label": `${a.name} ${fmtMin(today.by[id].wall)}` } });
      for (const [s, e] of today.by[id].segs) {
        const seg = lane.createDiv({ cls: "ad-day__seg" });
        seg.style.left = `${((s - from) / span) * 100}%`;
        seg.style.width = `${(Math.max(e - s, 2) / span) * 100}%`;
        seg.style.background = a.color;
        seg.title = `${a.name} ${clock(s)}–${clock(e)}`;
      }
    }
    const now = box.createDiv({ cls: "ad-day__now" });
    now.style.left = `${((nowMin - from) / span) * 100}%`;
    const ticks = box.createDiv({ cls: "ad-day__ticks" });
    ticks.createSpan({ text: clock(from) });
    ticks.createSpan({ text: clock(Math.round((from + to) / 2)) });
    ticks.createSpan({ text: t("现在") });
  }

  // 今天花时间最多的三个项目
  topProjects(parent, today) {
    const rows = Object.entries(today.proj || {}).filter(([, v]) => v.min >= 1).sort((a, b) => b[1].min - a[1].min).slice(0, 3);
    if (!rows.length) return;
    const max = rows[0][1].min;
    const box = parent.createDiv({ cls: "ad-projs" });
    for (const [name, v] of rows) {
      const row = box.createDiv({ cls: "ad-proj" });
      row.setAttr("title", t("{project} · 今天 {time}", { project: name || "—", time: fmtMin(v.min) }));
      row.createSpan({ cls: "ad-proj__name", text: name || "—" });
      const bar = row.createDiv({ cls: "ad-proj__bar" });
      bar.createDiv({ cls: "ad-proj__fill" }).style.width = `${(v.min / max) * 100}%`;
      row.createSpan({ cls: "ad-proj__min", text: fmtMin(v.min) });
    }
  }

  agentCard(parent, id, today, mode = "grid") {
    const p = this.plugin;
    const a = AGENTS[id];
    const enabled = p.agentEnabled(id);
    const primary = p.isPrimary(id);
    const by = (today && today.by && today.by[id]) || null;
    const card = parent.createDiv({ cls: `ad-agentcard ad-agentcard--${mode} ${enabled ? "" : "is-off"} ${primary ? "is-primary" : ""}` });
    card.dataset.agent = id;
    const pinned = this.agentLayout().pinned.includes(id);
    card.style.setProperty("--ad-agent", a.color);
    card.style.setProperty("--ad-agent-soft", a.soft);
    // 笔记里的一项拖上来 = 委派给它
    // 按住 ⌘：Claude Code / Codex 改在终端里开交互式会话
    const handoff = id === "codex" || id === "workbuddy";
    const cliCapable = ["claude", "codex", "opencode", "qoder", "workbuddy"].includes(id);
    const hint = handoff ? t("交给 {name}", { name: a.short }) : t("委派给 {name}", { name: a.short });
    // 设置里「默认在终端里委派」开着时反过来：不按 ⌘ 在终端里开，按住 ⌘ 走原来的后台 / 客户端
    const toTerm = (meta) => cliCapable && (!!meta !== !!p.settings.delegateInTerminal);
    const hintFor = (meta) => (toTerm(meta) ? t("在终端里开 {name}", { name: a.short }) : hint);
    if (!a.trackingOnly) card.setAttr("data-drop-hint", hintFor(false));
    card.addEventListener("dragover", (e) => {
      if (this._dragAgent || a.trackingOnly) return;
      if (!p.acceptsItemDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      card.addClass("is-drop");
      card.toggleClass("is-cli", toTerm(e.metaKey));
      card.setAttr("data-drop-hint", hintFor(e.metaKey));
    });
    card.addEventListener("dragleave", (e) => { if (!a.trackingOnly && !card.contains(e.relatedTarget)) { card.removeClass("is-drop"); card.removeClass("is-cli"); card.setAttr("data-drop-hint", hintFor(false)); } });
    card.addEventListener("drop", (e) => {
      if (this._dragAgent || a.trackingOnly) return;
      if (!p.acceptsItemDrag(e)) return;
      e.preventDefault();
      card.removeClass("is-drop");
      card.removeClass("is-cli");
      card.setAttr("data-drop-hint", hintFor(false));
      p.delegateDrop(id, p.readItemDrag(e), null, { cli: toTerm(e.metaKey) });
    });
    const top = card.createDiv({ cls: "ad-agentcard__top" });
    const grip = top.createEl("button", { cls: "ad-agentcard__grip ad-linkbtn", attr: { draggable: "true", "aria-label": t("拖动排序；方向键调整位置"), title: t("拖动排序；方向键调整位置") } });
    setLucide(grip, "grip-vertical");
    const mark = top.createEl("button", { cls: "ad-agentcard__mark", attr: { "aria-label": t("打开 {name}", { name: a.name }) } });
    agentIcon(mark.createSpan({ cls: "ad-glyph" }), id);
    mark.onclick = (e) => { e.stopPropagation(); p.openAgentApp(id); };
    const name = top.createDiv({ cls: "ad-agentcard__name" });
    name.createDiv({ cls: "ad-agentcard__title", text: mode === "list" ? a.name : a.short, attr: { title: a.name } });
    const live = p.liveSessions({ hours: 24 }).filter((x) => x.agent === id);
    const running = live.filter((x) => ["run", "starting", "running", "busy"].includes(x.state)).length;
    card.toggleClass("is-running", running > 0);
    const where = name.createDiv({ cls: "ad-agentcard__where", text: running ? t("{n} 个在跑", { n: running }) : (by ? t("{n} 个会话", { n: by.sessions || 0 }) : t("今天还没动")) });
    if (pinned) {
      const pin = where.createSpan({ cls: "ad-agentcard__pin", attr: { "aria-label": t("已置顶"), title: t("已置顶") } });
      setLucide(pin, "pin");
    }
    const star = top.createEl("button", { cls: "ad-star" + (primary ? " is-on" : ""), attr: { "aria-label": primary ? t("取消主力") : t("设为主力（最多三个）") } });
    setLucide(star, primary ? "star" : "star-off");
    star.onclick = (e) => { e.stopPropagation(); p.togglePrimary(id); };
    const stats = card.createDiv({ cls: "ad-agentcard__stats" });
    stats.createSpan({ text: fmtMin(by ? by.wall : 0) });
    stats.createSpan({ cls: "ad-dot", text: "·" });
    stats.createSpan({ text: fmtTok(by ? by.out : 0) + " tok" });
    if (mode === "list") {
      card.createDiv({ cls: "ad-agentcard__detail", text: t("今天 {n} 个会话 · 追踪中", { n: by?.sessions || 0 }) });
      const current = live.find(session => ["run", "starting", "running", "busy", "wait", "needs-approval"].includes(session.state));
      if (current) {
        const context = card.createDiv({ cls: "ad-agentcard__context", text: current.title || current.step || workspaceLabel(current.cwd) });
        context.title = [current.title, current.cwd, current.step].filter(Boolean).join(" · ");
      }
      if (p.settings.ui.showSparkline !== false) {
        const trend = card.createDiv({ cls: "ad-agentcard__trend" });
        trend.createSpan({ text: t("近 14 天") });
        this.sparkline(trend.createDiv({ cls: "ad-spark" }), id);
      }
    }
    for (const job of Object.values(p.jobs).filter((j) => j.agent === id && j.handoff && j.state === "starting" && !j.sessionId)) {
      const row = card.createDiv({ cls: "ad-handoff" });
      lattice(row.createSpan({ cls: "ad-handoff__icon" }), "ripple");
      row.createSpan({ cls: "ad-handoff__text", text: job.cli ? t("等终端里的会话：{name}", { name: truncate(job.name, 16) }) : t("等你在 {agent} 里发出：{name}", { agent: a.short, name: truncate(job.name, 18) }) });
      const x = row.createEl("button", { cls: "ad-handoff__x", attr: { "aria-label": t("不等了") } });
      setLucide(x, "x");
      x.onclick = (e) => { e.stopPropagation(); p.cancelJob(job.id); };
    }
    grip.ondragstart = (e) => {
      e.stopPropagation();
      this._dragAgent = id;
      e.dataTransfer.setData("application/x-agent-deck-card", id);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setDragImage(card, 12, 12);
      card.addClass("is-dragging");
    };
    grip.ondragend = () => { this._dragAgent = null; this.render(); };
    grip.onkeydown = (e) => {
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
      e.preventDefault();
      const next = e.key === "ArrowDown" || e.key === "ArrowRight";
      const ids = this.visibleAgentIds().filter((x) => this.agentPriority(x) === this.agentPriority(id));
      const target = ids[ids.indexOf(id) + (next ? 1 : -1)];
      if (target) Promise.resolve(this.moveAgentCard(id, target, next)).then(() => this.contentEl.querySelector(`[data-agent="${id}"] .ad-agentcard__grip`)?.focus());
    };
    const more = top.createEl("button", { cls: "ad-linkbtn ad-agentcard__more", attr: { "aria-label": t("管理 {name} 卡片", { name: a.name }) } });
    setLucide(more, "ellipsis");
    more.onclick = (e) => {
      const menu = new Menu();
      menu.addItem((item) => item.setTitle(t("扫描最近 7 天的会话")).setIcon("refresh-cw").onClick(() => p.scanNow(false, { agent: id, days: 7 })));
      menu.addItem((item) => item.setTitle(pinned ? t("取消置顶") : t("置顶卡片")).setIcon(pinned ? "pin-off" : "pin").onClick(() => this.updateAgentCards((layout) => { layout.pinned = pinned ? layout.pinned.filter((x) => x !== id) : [...layout.pinned, id]; })));
      menu.addItem((item) => item.setTitle(t("关闭追踪并隐藏")).setIcon("eye-off").setDisabled(primary).onClick(() => p.setAgentEnabled(id, false)));
      menu.addItem((item) => item.setTitle(t("从侧边栏移除")).setIcon("minus").onClick(() => this.updateAgentCards((layout) => { layout.hidden.push(id); })));
      menu.showAtMouseEvent(e);
    };
  }

  sparkline(parent, agent) {
    const p = this.plugin;
    const days = p.store.range(14, p.settings);
    const vals = days.map((d) => (d.by && d.by[agent] ? d.by[agent].wall : 0));
    const max = Math.max(1, ...vals);
    const w = 120, h = 26, gap = 2, bw = (w - gap * (vals.length - 1)) / vals.length;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("class", "ad-spark__svg");
    vals.forEach((v, i) => {
      const bh = v ? Math.max(2, (v / max) * (h - 3)) : 1.5;
      const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      r.setAttribute("x", String(i * (bw + gap)));
      r.setAttribute("y", String(h - bh));
      r.setAttribute("width", String(bw));
      r.setAttribute("height", String(bh));
      r.setAttribute("rx", "1.2");
      r.setAttribute("fill", v ? "var(--ad-agent)" : "var(--background-modifier-border)");
      r.setAttribute("opacity", v ? "0.85" : "0.5");
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = `${days[i].key} · ${fmtMin(v)}`;
      r.appendChild(title);
      svg.appendChild(r);
    });
    parent.appendChild(svg);
  }

  usageBars(parent) {
    const p = this.plugin;
    const days = p.store.range(14, p.settings);
    const max = Math.max(1, ...days.map((d) => d.wall || 0));
    const box = parent.createDiv({ cls: "ad-bars" });
    for (const d of days) {
      const col = box.createDiv({ cls: "ad-bar" });
      const stack = col.createDiv({ cls: "ad-bar__stack" });
      const total = d.wall || 0;
      if (total) {
        const agents = AGENT_ORDER.filter((id) => d.by && d.by[id] && d.by[id].wall > 0);
        for (const id of agents) {
          const a = AGENTS[id];
          const seg = stack.createDiv({ cls: "ad-bar__seg" });
          seg.style.height = `${((d.by[id].wall || 0) / max) * 100}%`;
          seg.style.background = a.color;
          seg.title = `${d.key} · ${a.name} ${fmtMin(d.by[id].wall)}`;
        }
      } else {
        const dot = stack.createDiv({ cls: "ad-bar__zero" });
      }
      col.createDiv({ cls: "ad-bar__label", text: d.key.slice(5).replace("_", "/") });
    }
    const legend = parent.createDiv({ cls: "ad-legend" });
    for (const id of AGENT_ORDER) {
      const a = AGENTS[id];
      const item = legend.createSpan({ cls: "ad-legend__item" });
      item.createSpan({ cls: "ad-legend__dot", attr: { style: `background:${a.color}` } });
      item.createSpan({ text: a.short });
    }
  }

  sessionCard(parent, s, compact, depth = 0) {
    const p = this.plugin;
    const a = AGENTS[s.agent] || AGENTS.claude;
    const card = parent.createDiv({ cls: `ad-sess ${compact ? "is-now" : ""}` });
    card.dataset.sid = s.sid;
    card.draggable = true;
    card.addEventListener("dragstart", (e) => {
      const title = s.title || truncate(s.text || s.step || "未命名会话", 60);
      e.dataTransfer.setData(SESSION_MIME, JSON.stringify({ agent: s.agent, sid: s.sid, title, app: s.app || "", state: s.state || "" }));
      e.dataTransfer.setData("text/plain", title);
      e.dataTransfer.effectAllowed = "all";   // 按住 ⌘ 拖（在下面新建）时 macOS 会换拖放效果，都放行
      card.addClass("is-dragging");
      document.body.classList.add("ad-dragging-session");
      if (compact) { this._dragSid = s.sid; this._nowDropped = false; }
    });
    card.addEventListener("dragend", () => {
      card.removeClass("is-dragging");
      document.body.classList.remove("ad-dragging-session");
      if (!compact) return;
      this._dragSid = null;
      // 拖到笔记里或半路放弃：卡片回原位；在列表里放下的顺序已经存了
      if (this._pendingRender || !this._nowDropped) { this._pendingRender = false; this.render(); }
    });
    // 笔记里的一项拖到会话卡片上：绑定，不委派
    card.addEventListener("dragover", (e) => { if (!p.acceptsItemDrag(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "link"; card.addClass("is-drop"); });
    card.addEventListener("dragleave", (e) => { if (!a.trackingOnly && !card.contains(e.relatedTarget)) card.removeClass("is-drop"); });
    card.addEventListener("drop", (e) => {
      if (!p.acceptsItemDrag(e)) return;
      e.preventDefault(); card.removeClass("is-drop");
      p.bindItemToSession(p.readItemDrag(e), { agent: s.agent, sid: s.sid, title: s.title || truncate(s.text || s.step || "未命名会话", 60), app: s.app || "", state: s.state || "" });
    });
    card.style.setProperty("--ad-agent", a.color);
    card.style.setProperty("--ad-agent-soft", a.soft);
    // 只有父会话就在这份列表里（depth > 0）时才缩进；父不在列表就留在顶层，缩进不能凭空捏造层级。
    const child = depth > 0;
    if (child) {
      card.addClass("is-child");
      card.style.setProperty("--ad-tree-depth", String(depth));
    }
    const live = ["run", "starting", "running"].includes(s.state);
    const wait = ["wait", "quiet", "needs-approval"].includes(s.state);
    if (live) card.addClass("is-live");
    if (wait) card.addClass("is-wait");
    const icon = card.createDiv({ cls: "ad-sess__mark" });
    agentIcon(icon.createSpan({ cls: "ad-glyph" }), s.agent);
    const body = card.createDiv({ cls: "ad-sess__body" });
    const titleRow = body.createDiv({ cls: "ad-sess__title" });
    titleRow.createSpan({ cls: "ad-sess__name", text: s.title || truncate(s.text || s.step || "未命名会话", 60) });
    const st = stateChip(s);
    if (st) {
      const chip = titleRow.createSpan({ cls: `ad-state ${st.cls}` });
      const sic = chip.createSpan({ cls: "ad-state__icon" });
      if (st.cls === "is-live") lattice(sic, "orbit");
      else stateIcon(sic, s.state);
      chip.createSpan({ text: st.label });
    }
    // 会话派出去的 subagent：终端里和桌面版里一样写在 <会话>/subagents/ 下，在跑的数一下
    const subs = p.usage.subsOf ? p.usage.subsOf(s.sid).filter((r) => r.state !== "done" && r.state !== "fail" && Date.now() - (r.at || r.start || 0) < 5 * 60e3) : [];
    if (subs.length) {
      const sb = titleRow.createSpan({ cls: "ad-side" });
      setLucide(sb.createSpan({ cls: "ad-side__icon" }), "bot");
      sb.createSpan({ text: subs.length > 1 ? t("子代理 ×{n}", { n: subs.length }) : t("子代理") });
      sb.title = subs.map((r) => r.desc || r.type || "subagent").join("\n");
    }
    if (s.sideChats) {
      const sc = titleRow.createSpan({ cls: "ad-side" });
      setLucide(sc.createSpan({ cls: "ad-side__icon" }), "message-square");
      sc.createSpan({ text: s.sideChats > 1 ? `side chat ×${s.sideChats}` : "side chat" });
      if (s.sideSince) sc.title = t("{ago}开的", { ago: timeAgo(s.sideSince) });
    }
    const sub = body.createDiv({ cls: "ad-sess__sub" });
    sub.createSpan({ text: a.short });
    if (s.cwd) sub.createSpan({ text: "·" });
    if (s.cwd) sub.createSpan({ cls: "ad-sess__cwd", text: truncate(workspaceLabel(s.cwd), 34), attr: { title: s.cwd } });
    const prog = p.sessionProgressText ? p.sessionProgressText(s, s.job) : "";
    if (prog) { sub.createSpan({ text: "·" }); sub.createSpan({ cls: "ad-sess__prog", text: prog }); }
    if (s.step) { sub.createSpan({ text: "·" }); sub.createSpan({ cls: "ad-sess__step", text: truncate(s.step, 34) }); }
    sub.createSpan({ text: "·" });
    sub.createSpan({ text: timeAgo(s.lastAt) });
    if (s.tokens) { sub.createSpan({ text: "·" }); sub.createSpan({ cls: "ad-sess__tok", text: fmtTok(s.tokens) + " tok" }); }
    // 父子关系这一行照旧：父在不在列表里都写出来（缩进只表示"父就在眼前"）。
    if (s.parentSid) {
      const kin = body.createDiv({ cls: "ad-sess__kin" });
      kin.createSpan({ cls: "ad-sess__kinmark", text: "↳" });
      kin.createSpan({ cls: "ad-sess__kintitle", text: t("从「{title}」开出", { title: truncate(s.parentTitle || t("母会话"), 24) }) });
      if (s.deskTitle && s.deskTitle !== s.title) kin.title = t("桌面版里的标题：{title}", { title: s.deskTitle });
    }
    const isPending = Boolean(s.isPendingJob && s.job && !s.job.sessionId);
    if (!isPending && AGENT_ORDER.includes(s.agent)) {
      card.addClass("has-conversation");
      const conversation = card.createEl("button", { cls: "ad-arrow", attr: { "aria-label": t("查看对话、续聊与归档") } });
      setLucide(conversation.createSpan({ cls: "ad-arrow__icon" }), "messages-square");
      conversation.onclick = (e) => { e.stopPropagation(); p.openConversation(s); };
    }
    const open = () => {
      if (isPending && s.job?.path && p.openMirrorSource) return p.openMirrorSource(s.job.path, s.job.line || 0);
      if (isPending && s.job?.id && p.openJob) return p.openJob(s.job.id);
      return p.openSession(s.agent, s.sid, s.app, s);
    };
    if (compact) {
      card.addClass("has-x");
      const x = card.createEl("button", { cls: "ad-arrow ad-sess__x", attr: { "aria-label": t("从「现在」移除") } });
      setLucide(x.createSpan({ cls: "ad-arrow__icon" }), "x");
      x.onclick = (e) => { e.stopPropagation(); this.removeFromNow(s.sid); };
      card.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const m = new Menu();
        m.addItem((i) => i.setTitle(t("打开会话")).setIcon("arrow-up-right").onClick(open));
        m.addItem((i) => i.setTitle(t("从「现在」移除")).setIcon("x").onClick(() => this.removeFromNow(s.sid)));
        m.showAtMouseEvent(e);
      });
    }
    const go = card.createEl("button", { cls: "ad-arrow", attr: { "aria-label": t("打开会话") } });
    setLucide(go.createSpan({ cls: "ad-arrow__icon" }), "arrow-up-right");
    go.onclick = (e) => { e.stopPropagation(); open(); };
    card.onclick = open;
  }

  // 刚委派出去的会话有了会话号：卡片从它的 Agent 卡片飞进「现在」
  playFly(dash) {
    // 飞行途中面板重画了：新画出来的目标卡片也先藏着，等影子落地
    const flying = this.plugin._flying;
    if (flying && Date.now() < flying.until) {
      const t = dash.querySelector(`.ad-nowlist .ad-sess[data-sid="${CSS.escape(flying.sid)}"]`);
      if (t) { t.style.opacity = "0"; flying.target = t; }
    }
    const fly = this.plugin._fly;
    if (!fly) return;
    if (Date.now() - fly.at > 10000) { this.plugin._fly = null; return; }
    const target = dash.querySelector(`.ad-nowlist .ad-sess[data-sid="${CSS.escape(fly.sid)}"]`);
    const from = dash.querySelector(`.ad-agentcard[data-agent="${fly.agent}"]`);
    if (!target || !from) return;   // 还没进「现在」：等下一次画
    this.plugin._fly = null;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) { target.addClass("is-landed"); return; }
    requestAnimationFrame(() => {
      const a = from.getBoundingClientRect(), b = target.getBoundingClientRect();
      if (!a.width || !b.width) return;
      // 影子挂在 body 上，外面包一层 ad-view：卡片的配色变量都定义在 .ad-view 上
      const layer = document.body.createDiv({ cls: "ad-view ad-fly-layer" });
      const ghost = target.cloneNode(true);
      ghost.classList.add("ad-fly-ghost");
      Object.assign(ghost.style, { position: "fixed", left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px`, margin: "0", zIndex: "9999", pointerEvents: "none", transformOrigin: "top left" });
      layer.appendChild(ghost);
      target.style.opacity = "0";
      const flying = this.plugin._flying = { sid: fly.sid, until: Date.now() + 3000, target };
      const sx = a.width / b.width, sy = a.height / b.height;
      const dx = a.left - b.left, dy = a.top - b.top;
      const anim = ghost.animate([
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.35 },
        { transform: `translate(${dx * 0.12}px, ${Math.min(-10, dy * 0.12)}px) scale(1.03)`, opacity: 1, offset: 0.62 },
        { transform: "none", opacity: 1 },
      ], { duration: 760, easing: "cubic-bezier(.22,.9,.24,1)" });
      const done = () => {
        layer.remove();
        const t = flying.target || target;
        t.style.opacity = "";
        t.addClass("is-landed");
        if (this.plugin._flying === flying) this.plugin._flying = null;
      };
      anim.onfinish = done;
      anim.oncancel = done;
    });
  }

  empty(parent, title, sub) {
    const e = parent.createDiv({ cls: "ad-empty" });
    e.createDiv({ cls: "ad-empty__title", text: title });
    if (sub) e.createDiv({ cls: "ad-empty__sub", text: sub });
  }
}

export class AgentCardsModal extends Modal {
  constructor(view) { super(view.app); this.view = view; this.modalEl.addClass("ad-cardmanager-dialog"); }

  onOpen() { this.render(); }

  render() {
    const el = this.contentEl;
    el.empty();
    el.addClass("ad-modal", "ad-cardmanager");
    el.createEl("h3", { text: t("管理 Agent 卡片") });
    el.createDiv({ cls: "ad-muted", text: t("置顶的 Agent 始终在最上面，未置顶时运行中的优先。同一优先级内可拖动排序。移除不影响追踪和会话。") });
    const view = this.view;
    const { hidden, pinned } = view.agentLayout();
    const visible = view.visibleAgentIds();
    const change = async (fn) => { await view.updateAgentCards(fn); this.render(); };
    const button = (parent, label, icon, run, disabled = false) => {
      const b = parent.createEl("button", { cls: "ad-linkbtn", attr: { "aria-label": label, title: label } });
      setLucide(b, icon);
      b.disabled = disabled;
      b.onclick = run;
    };
    const list = el.createDiv({ cls: "ad-cardmanager__list" });
    if (!visible.length) list.createDiv({ cls: "ad-muted", text: t("还没有 Agent 卡片，点「管理」添加。") });
    for (const id of visible) {
      const row = list.createDiv({ cls: "ad-cardmanager__row", attr: { "data-agent": id } });
      agentIcon(row.createSpan({ cls: "ad-glyph" }), id);
      row.createSpan({ cls: "ad-cardmanager__name", text: AGENTS[id].name });
      const group = visible.filter((x) => view.agentPriority(x) === view.agentPriority(id));
      const i = group.indexOf(id);
      button(row, t("上移"), "arrow-up", async () => { await view.moveAgentCard(id, group[i - 1]); this.render(); }, i === 0);
      button(row, t("下移"), "arrow-down", async () => { await view.moveAgentCard(id, group[i + 1], true); this.render(); }, i === group.length - 1);
      button(row, pinned.includes(id) ? t("取消置顶") : t("置顶卡片"), pinned.includes(id) ? "pin-off" : "pin", () => change((layout) => { layout.pinned = pinned.includes(id) ? layout.pinned.filter((x) => x !== id) : [...layout.pinned, id]; }));
      button(row, t("从侧边栏移除"), "minus", () => change((layout) => { layout.hidden.push(id); }));
    }
    el.createEl("h4", { text: t("添加卡片") });
    if (!hidden.length) el.createDiv({ cls: "ad-muted", text: t("所有可用的 Agent 都已添加。") });
    for (const id of hidden) {
      const row = el.createDiv({ cls: "ad-cardmanager__row", attr: { "data-agent": id } });
      agentIcon(row.createSpan({ cls: "ad-glyph" }), id);
      row.createSpan({ cls: "ad-cardmanager__name", text: AGENTS[id].name });
      if (!view.plugin.agentEnabled(id)) { row.createSpan({ cls: "ad-muted", text: t("已关闭") }); continue; }
      const add = row.createEl("button", { cls: "ad-linkbtn", text: t("添加到侧边栏") });
      add.onclick = () => change((layout) => { layout.hidden = layout.hidden.filter((x) => x !== id); });
    }
    const foot = el.createDiv({ cls: "ad-modalfoot" });
    const settings = foot.createEl("button", { text: t("Agent 设置") });
    settings.onclick = () => { this.close(); view.plugin.openSettings("record"); };
    foot.createEl("button", { text: t("完成") }).onclick = () => this.close();
  }

  onClose() { this.contentEl.empty(); }
}

function stateChip(s) {
  const st = s.state || "idle";
  if (st === "run") return { cls: "is-live", label: t("在跑") };
  if (st === "wait") return { cls: "is-wait", label: t("等你") };
  if (st === "quiet") return { cls: "is-quiet", label: t("安静") };
  if (st === "error") return { cls: "is-error", label: t("出错") };
  if (st === "limit") return { cls: "is-error", label: t("限额") };
  if (st === "queued") return { cls: "is-quiet", label: t("排队续跑") };
  if (st === "needs-approval") return { cls: "is-wait", label: t("等你允许") };
  if (st === "done") return { cls: "is-done", label: t("完成") };
  if (st === "cancelled") return { cls: "is-quiet", label: t("已取消") };
  return null;
}
