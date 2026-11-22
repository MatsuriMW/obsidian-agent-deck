import { ItemView, FuzzySuggestModal } from "obsidian";
import { AGENTS, dayKeyToday, fmtMin, fmtTok, unionSegs } from "./constants.js";
import { aggregateDashboard, calendarDays, formatDashboardSummaryMarkdown, heatLevel, shiftDay, isoDay } from "./analytics.js";
import { DashboardData } from "./dashboard-data.js";
import { agentIcon } from "./icons.js";
import { ManagedTimers } from "./runtime-guard.js";
import { t } from "./i18n.js";

export const DASHBOARD_TYPE = "agent-deck-dashboard";

class ProjectPicker extends FuzzySuggestModal {
  constructor(view, row) { super(view.app); this.view = view; this.row = row; this.setPlaceholder(t("搜索已有页面，或恢复自动识别")); }
  getItems() { return [{ path: null, name: t("恢复自动识别") }, { path: "", name: t("未归类") }, ...this.view.data.pages]; }
  getItemText(item) { return item.path ? `${item.name}  ·  ${item.path}` : item.name; }
  async onChooseItem(item) {
    const p = this.view.plugin, previous = p.settings.dashboardProjects;
    p.settings.dashboardProjects = { ...previous };
    if (item.path === null) delete p.settings.dashboardProjects[this.row.sid];
    else p.settings.dashboardProjects[this.row.sid] = item.path;
    try { await p.saveSettings(); await this.view.render(); }
    catch (e) { p.settings.dashboardProjects = previous; p.notice(t("项目归属保存失败：{error}", { error: e.message })); }
  }
}

export class DashboardView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf); this.plugin = plugin; this.loader = new DashboardData(plugin);
    this.to = isoDay(dayKeyToday(plugin.settings)); this.from = shiftDay(this.to, -364);
    this.selectedDay = ""; this.project = null; this.agent = null; this.model = null;
    this.query = ""; this.recordFilter = "all"; this.sortBy = "day";
    this.projectSortBy = "tokens"; this.projectSortDir = "desc";
    this.limit = 40;
    this._timers = new ManagedTimers();
  }
  getViewType() { return DASHBOARD_TYPE; }
  getDisplayText() { return t("Agent Deck 回顾"); }
  getIcon() { return "chart-no-axes-combined"; }

  async onOpen() {
    if (this.plugin.settings.experimentalDashboard === false) { this.leaf.detach(); return; }
    this.contentEl.addClass("ad-review");
    this.plugin.views.add(this);
    const refresh = () => { if (this._pendingRender) this.render(); };
    this.registerEvent(this.app.workspace.on("layout-change", refresh));
    this.registerEvent(this.app.workspace.on("active-leaf-change", refresh));
    this.registerEvent(this.app.vault.on("modify", () => this.scheduleRender()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleRender()));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleRender()));
    this.register(() => this._timers?.dispose());
    await this.render();
  }
  async onClose() { this._closed = true; this.plugin.views.delete(this); this._timers?.dispose(); this._sourceTimer = null; }
  onResize() { if (this._pendingRender) this.render(); }
  scheduleRender() { this._timers.clear(this._sourceTimer); this._sourceTimer = this._timers.setTimeout(() => this.render(), 800); }

  async render() {
    if (this._closed || this.plugin.settings.experimentalDashboard === false) return;
    if (this.containerEl.isShown && !this.containerEl.isShown()) { this._pendingRender = true; return; }
    if (this._loading) { this._pendingRender = true; return; }
    // A scan must not replace a focused date control or a composing input.
    if (this.contentEl.contains(document.activeElement) && document.activeElement?.tagName === "INPUT") {
      this._pendingRender = true; return;
    }
    this._pendingRender = false; this._loading = true;
    if (!this.data) this.contentEl.setText(t("正在汇总 AI 记录…"));
    try {
      this.data = await this.loader.load();
      if (!this._closed) this.paint();
    } catch (e) {
      if (!this._closed) { this.contentEl.empty(); this.contentEl.createEl("p", { text: t("汇总失败：{error}", { error: e.message }) }); this.button(this.contentEl, t("重试"), () => this.render()); }
    } finally {
      this._loading = false;
      if (this._pendingRender && !this._closed) { this._pendingRender = false; this.scheduleRender(); }
    }
  }

  button(parent, label, action, cls = "") {
    const button = parent.createEl("button", { text: label, cls });
    button.onclick = action; return button;
  }
  update() { this.limit = 40; this.paint(); }
  paint() {
    const root = this.contentEl, scroll = root.scrollTop;
    const heatLeft = root.querySelector(".ad-review__heat-scroll")?.scrollLeft;
    const opened = new Set([...root.querySelectorAll(".ad-review__record[open]")].map(el => el.dataset.record));
    root.empty();
    const page = root.createDiv({ cls: "ad-review__page" });
    const head = page.createDiv({ cls: "ad-review__head" });
    const title = head.createDiv();
    title.createEl("h1", { text: t("AI 协作回顾") });
    title.createEl("p", { text: t("从每天的投入，回到做过的事。") });
    const actions = head.createDiv({ cls: "ad-review__actions" });
    this.button(actions, t("会话面板"), () => this.plugin.activateView());
    this.button(actions, t("刷新数据"), async () => { await this.plugin.scanNow(); await this.render(); });

    const controls = page.createDiv({ cls: "ad-review__controls" });
    const presets = controls.createDiv({ cls: "ad-review__presets" });
    for (const n of [7, 30, 90, 365]) {
      const end = isoDay(dayKeyToday(this.plugin.settings)), start = shiftDay(end, 1 - n);
      const button = this.button(presets, n === 365 ? t("最近一年") : t("{n} 天", { n }), () => { this.from = start; this.to = end; this.selectedDay = ""; this.update(); });
      button.setAttribute("aria-pressed", String(this.from === start && this.to === end));
    }
    const dates = controls.createDiv({ cls: "ad-review__dates" });
    for (const [key, label] of [["from", t("开始日期")], ["to", t("结束日期")]]) {
      const wrap = dates.createEl("label", { text: label });
      const input = wrap.createEl("input", { type: "date", value: this[key] });
      input.setAttribute("aria-label", label);
      input.onchange = () => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(input.value)) return;
        const from = key === "from" ? input.value : this.from, to = key === "to" ? input.value : this.to;
        if (from > to || shiftDay(from, 366 * 5) < to) { input.value = this[key]; this.plugin.notice(t("请选择起止有序、五年以内的日期范围")); return; }
        this[key] = input.value; this.selectedDay = ""; this.update();
      };
      input.onblur = () => { if (this._pendingRender) this.scheduleRender(); };
    }

    const dayCutoff = this.plugin.settings.dayCutoff ?? 0;
    const overview = aggregateDashboard(this.data.rows, this.from, this.to, { project: this.project, agent: this.agent, model: this.model, dayCutoff });
    this.heatmap(page, overview);
    const from = this.selectedDay || this.from, to = this.selectedDay || this.to;
    const projectScope = aggregateDashboard(this.data.rows, from, to, {
      agent: this.agent,
      model: this.model,
      dayCutoff,
      projectSortBy: this.projectSortBy,
      projectSortDir: this.projectSortDir,
    });
    const agentScope = aggregateDashboard(this.data.rows, from, to, { project: this.project, model: this.model, dayCutoff });
    const modelScope = aggregateDashboard(this.data.rows, from, to, { project: this.project, agent: this.agent, dayCutoff });
    const data = aggregateDashboard(this.data.rows, from, to, { project: this.project, agent: this.agent, model: this.model, dayCutoff });
    this.button(actions, t("复制简报"), () => this.copySummary(data, from, to, projectScope));

    const selection = page.createDiv({ cls: "ad-review__selection" });
    selection.createSpan({ text: this.selectedDay || `${this.from} — ${this.to}` });
    if (this.selectedDay) this.button(selection, t("查看整个日期范围"), () => { this.selectedDay = ""; this.update(); });
    if (this.project !== null) this.button(selection, t("清除项目筛选"), () => { this.project = null; this.update(); });
    if (this.agent !== null) this.button(selection, t("清除 Agent 筛选"), () => { this.agent = null; this.update(); });
    if (this.model !== null) this.button(selection, t("清除模型筛选"), () => { this.model = null; this.update(); });
    const stats = page.createDiv({ cls: "ad-review__stats" });
    for (const [label, value] of [[t("总 token"), fmtTok(data.tokens)], [t("活跃耗时"), fmtMin(data.wall)], [t("会话数"), String(data.sessions)], [t("活跃天数"), String(data.activeDays)]]) {
      const stat = stats.createDiv(); stat.createSpan({ text: label }); stat.createEl("strong", { text: value });
    }
    this.insights(page, data);
    page.createEl("p", { cls: "ad-review__note", text: t("输入 {fresh} · 输出 {out} · 缓存读取 {cached}。耗时按活跃时段去重；不同项目同时工作时，项目耗时之和可能超过总耗时。", { fresh: fmtTok(data.fresh), out: fmtTok(data.out), cached: fmtTok(data.cached) }) });
    if (data.missingTokens || data.missingSpans || this.data.unreadable) page.createEl("p", { cls: "ad-review__note", text: t("数据缺口：{tokens} 条日记录未提供 token，{spans} 条缺少活跃时段，{files} 篇来源暂时无法读取；统计不作估算。", { tokens: data.missingTokens, spans: data.missingSpans, files: this.data.unreadable }) });
    this.rhythm(page, data);
    this.agentBreakdown(page, agentScope);
    this.modelBreakdown(page, modelScope);
    this.projects(page, projectScope);
    this.multiSessionTasks(page, data);
    this.records(page, from, to, data, opened);
    this.securityAuditSection(page);
    const details = page.createEl("details", { cls: "ad-review__method" });
    details.createEl("summary", { text: t("统计与项目识别规则") });
    details.createEl("p", { text: t("只统计本机已经追踪并保存的历史。每日沿用日记分界 {hour}:00；token 包含输入、输出和缓存读取，不代表费用。", { hour: this.plugin.settings.dayCutoff ?? 0 }) });
    details.createEl("p", { text: t("项目优先采用日记条目中的页面链接，再匹配标题、目录与重复出现的正文关键词。重名或证据冲突时留在未归类；更正作用于该会话所有日期，可随时恢复自动识别。") });
    root.scrollTop = scroll;
    const heatScroll = root.querySelector(".ad-review__heat-scroll");
    const heatRange = `${this.from}:${this.to}`;
    if (heatScroll) heatScroll.scrollLeft = this._heatRange === heatRange ? heatLeft ?? heatScroll.scrollWidth : heatScroll.scrollWidth;
    this._heatRange = heatRange;
  }

  async copySummary(data, from, to, projectScope) {
    const selectedProj = this.project === null ? "" : (projectScope.projects.find(p => p.path === this.project)?.name || t("未归类"));
    const selectedAgent = this.agent ? (AGENTS[this.agent]?.name || this.agent) : "";
    const selectedModel = this.model === null ? "" : (this.model || t("未记录模型"));
    const md = formatDashboardSummaryMarkdown(data, {
      rangeLabel: from === to ? from : `${from} — ${to}`,
      projectName: selectedProj,
      agentName: selectedAgent,
      modelName: selectedModel,
      labels: {
        title: t("AI 协作回顾简报"),
        range: t("统计范围"),
        project: t("项目筛选"),
        agent: t("Agent 筛选"),
        model: t("模型筛选"),
        overview: t("核心投入"),
        tokens: t("总 token"),
        wall: t("活跃耗时"),
        sessions: t("会话数"),
        activeDays: t("活跃天数"),
        cacheHit: t("缓存读取占比"),
        dailyAvg: t("活跃日均"),
        peakDay: t("峰值日"),
        peakHour: t("最活跃时段"),
        concurrent: t("多会话并行"),
        journalCoverage: t("日记关联条目"),
        agentSection: t("Agent 分布"),
        modelSection: t("模型分布（Top 10）"),
        projectSection: t("项目投入（Top 10）"),
        unclassified: t("未归类"),
        unknownModel: t("未记录模型"),
        perDay: t("天"),
      },
      fmtTokFn: fmtTok,
      fmtMinFn: fmtMin,
      agentLabelFn: (id) => AGENTS[id]?.name || AGENTS[id]?.short || id,
    });
    let copied = false;
    try { require("electron").clipboard.writeText(md); copied = true; } catch { /* not electron */ }
    if (!copied) try { await navigator.clipboard.writeText(md); copied = true; } catch { /* clipboard */ }
    this.plugin.notice?.(copied ? t("已复制回顾简报到剪贴板") : t("写入剪贴板失败"));
  }

  rhythm(parent, data) {
    if (!data.hours?.some(h => h.minutes > 0)) return;
    const section = parent.createEl("section", { cls: "ad-review__rhythm" });
    const head = section.createDiv({ cls: "ad-review__sectionhead" });
    head.createEl("h2", { text: t("24 小时作息与并发") });
    const summaryParts = [];
    if (data.peakHour) {
      const range = data.peakHour.range || `${String(data.peakHour.hour).padStart(2, "0")}:00–${String((data.peakHour.hour + 1) % 24).padStart(2, "0")}:00`;
      summaryParts.push(t("最活跃 {range}（{wall}）", { range, wall: fmtMin(data.peakHour.minutes) }));
    }
    if (data.maxConcurrent >= 2) {
      summaryParts.push(t("并行 {wall} · 最高 {n} 并发", { wall: fmtMin(data.concurrentMinutes), n: data.maxConcurrent }));
    }
    if (summaryParts.length) head.createSpan({ text: summaryParts.join(" · ") });
    const card = section.createDiv({ cls: "ad-review__rhythm-card" });
    const bars = card.createDiv({ cls: "ad-review__rhythm-bars", attr: { role: "list", "aria-label": t("每日 24 小时 AI 协作投入与并发分布") } });
    const maxMin = Math.max(1, ...data.hours.map(h => h.minutes));
    for (const h of data.hours) {
      const col = bars.createDiv({ cls: "ad-review__rhythm-col" + (data.peakHour?.hour === h.hour ? " is-peak" : ""), attr: { role: "listitem" } });
      const range = h.range || `${h.label}:00–${String((h.hour + 1) % 24).padStart(2, "0")}:00`;
      const desc = h.minutes
        ? (h.concurrentMinutes > 0
          ? t("{range} · 活跃 {wall} · 并行 {concurrent}（最高 {max} 并发）· {sessions} 次日会话", { range, wall: fmtMin(h.minutes), concurrent: fmtMin(h.concurrentMinutes), max: h.maxConcurrent, sessions: h.sessions })
          : t("{range} · 活跃 {wall} · {sessions} 次日会话", { range, wall: fmtMin(h.minutes), sessions: h.sessions }))
        : t("{range} · 无记录", { range });
      col.title = desc;
      col.setAttribute("aria-label", desc);
      const track = col.createDiv({ cls: "ad-review__rhythm-track" });
      if (h.minutes > 0) {
        const fill = track.createDiv({ cls: "ad-review__rhythm-fill" });
        fill.style.height = `${Math.max(4, Math.round(100 * h.minutes / maxMin))}%`;
        if (h.concurrentMinutes > 0) {
          const conc = fill.createDiv({ cls: "ad-review__rhythm-conc" });
          conc.style.height = `${Math.max(8, Math.min(100, Math.round(100 * h.concurrentMinutes / h.minutes)))}%`;
        }
      }
      col.createSpan({ cls: "ad-review__rhythm-hour", text: h.hour % 3 === 0 ? h.label : "" });
    }
    const footer = card.createDiv({ cls: "ad-review__rhythm-footer" });
    footer.createSpan({ text: t("纵轴按每小时去重活跃分钟计算，高亮底段表示 2 个及以上会话同时运行。") });
    const legend = footer.createDiv({ cls: "ad-review__legend" });
    legend.createSpan({ cls: "ad-review__rhythm-swatch is-active" });
    legend.createSpan({ text: t("活跃时段") });
    legend.createSpan({ cls: "ad-review__rhythm-swatch is-conc" });
    legend.createSpan({ text: t("多会话并行") });
  }

  insights(parent, data) {
    const items = [];
    if (data.cacheHitRate !== null) items.push({ label: t("缓存读取占比 {pct}%", { pct: Math.round(data.cacheHitRate * 100) }) });
    if (data.activeDays > 0) items.push({ label: t("日均 {tokens} · {wall}", { tokens: fmtTok(data.avgDailyTokens), wall: fmtMin(data.avgDailyWall) }) });
    if (data.peakDay) {
      items.push({
        label: t("峰值 {day} · {tokens}", { day: data.peakDay.day, tokens: fmtTok(data.peakDay.tokens) }),
        active: this.selectedDay === data.peakDay.day,
        onClick: () => { this.selectedDay = this.selectedDay === data.peakDay.day ? "" : data.peakDay.day; this.update(); },
      });
    }
    if (data.rows.length > 0) items.push({ label: t("日记关联 {linked}/{total}", { linked: data.journalLinked, total: data.rows.length }) });
    if (data.unclassifiedCount > 0) {
      items.push({
        label: t("待归类 {n}", { n: data.unclassifiedCount }),
        active: this.recordFilter === "unclassified",
        onClick: () => { this.recordFilter = this.recordFilter === "unclassified" ? "all" : "unclassified"; this.update(); },
      });
    }
    if (!items.length) return;
    const strip = parent.createDiv({ cls: "ad-review__insights" });
    for (const item of items) {
      if (item.onClick) {
        const btn = this.button(strip, item.label, item.onClick, "ad-review__insight is-action");
        btn.setAttribute("aria-pressed", String(Boolean(item.active)));
      } else {
        strip.createSpan({ cls: "ad-review__insight", text: item.label });
      }
    }
  }

  renderAgentBadges(parent, agentIds = []) {
    const ids = (agentIds || []).filter(Boolean);
    if (!ids.length) return null;
    const wrap = parent.createSpan({ cls: "ad-review__agent-icons" });
    for (const id of ids) {
      const label = AGENTS[id]?.name || AGENTS[id]?.short || id;
      const badge = wrap.createSpan({ cls: "ad-glyph ad-review__agent-badge", attr: { title: label, "aria-label": label } });
      agentIcon(badge, id);
    }
    return wrap;
  }

  agentBreakdown(parent, data) {
    if (!data.agents?.length) return;
    const section = parent.createEl("section", { cls: "ad-review__agents" });
    const head = section.createDiv({ cls: "ad-review__sectionhead" });
    head.createEl("h2", { text: t("Agent 分布") });
    head.createSpan({ text: t("点击某个 Agent 可联动筛选下方项目与记录") });
    const list = section.createDiv({ cls: "ad-review__agent-list" });
    const max = Math.max(1, data.agents[0]?.tokens || 0, ...data.agents.map(a => a.tokens));
    for (const ag of data.agents) {
      const meta = AGENTS[ag.agent];
      const row = this.button(list, "", () => {
        this.agent = this.agent === ag.agent ? null : ag.agent;
        this.update();
      }, "ad-review__agent-row");
      if (this.agent === ag.agent) row.addClass("is-selected");
      row.setAttribute("aria-pressed", String(this.agent === ag.agent));
      if (meta?.color) row.style.setProperty("--ad-agent", meta.color);
      const top = row.createDiv({ cls: "ad-review__agent-top" });
      const nameWrap = top.createDiv({ cls: "ad-review__agent-name" });
      agentIcon(nameWrap.createSpan({ cls: "ad-glyph ad-review__agent-icon" }), ag.agent);
      nameWrap.createSpan({ text: meta?.name || ag.agent });
      const pct = data.tokens > 0 ? Math.round(ag.share * 100) : 0;
      const metrics = `${ag.tokens ? fmtTok(ag.tokens) + " tok" : t("用量未提供")}${data.tokens > 0 && ag.tokens > 0 ? ` (${pct}%)` : ""} · ${fmtMin(ag.wall)} · ${t("{n} 会话", { n: ag.sessions })}`;
      top.createSpan({ cls: "ad-review__agent-meta", text: metrics });
      const bar = row.createDiv({ cls: "ad-review__bar" });
      bar.createSpan().style.width = `${ag.tokens ? Math.max(2, Math.round(100 * ag.tokens / max)) : 0}%`;
    }
  }

  modelBreakdown(parent, data) {
    if (!data.models?.some(m => m.model)) return;
    const section = parent.createEl("section", { cls: "ad-review__models" });
    const head = section.createDiv({ cls: "ad-review__sectionhead" });
    head.createEl("h2", { text: t("模型分布") });
    head.createSpan({ text: t("点击模型可联动筛选记录与统计") });
    const scroll = section.createDiv({ cls: "ad-review__table-scroll" }), table = scroll.createEl("table");
    const header = table.createEl("thead").createEl("tr");
    for (const label of [t("模型"), "Token", t("问答轮次"), t("缓存命中"), t("活跃耗时"), t("会话数")]) {
      header.createEl("th", { text: label, attr: { scope: "col" } });
    }
    const body = table.createEl("tbody"), max = Math.max(1, ...data.models.map(m => m.tokens));
    for (const item of data.models.slice(0, 12)) {
      const tr = body.createEl("tr");
      if (this.model === item.model) tr.addClass("is-selected");
      const nameTd = tr.createEl("td");
      const btn = this.button(nameTd, item.model || t("未记录模型"), () => {
        this.model = this.model === item.model ? null : item.model;
        this.update();
      }, "ad-review__project-name");
      btn.setAttribute("aria-pressed", String(this.model === item.model));
      if (item.agents?.length) {
        const sub = nameTd.createDiv({ cls: "ad-review__project-sub" });
        this.renderAgentBadges(sub, item.agents);
      }
      const tokenTd = tr.createEl("td");
      const share = data.tokens > 0 && item.tokens > 0 ? ` (${Math.max(1, Math.round(item.share * 100))}%)` : "";
      tokenTd.createSpan({ text: item.tokens ? fmtTok(item.tokens) + share : t("用量未提供") });
      const bar = tokenTd.createDiv({ cls: "ad-review__bar" });
      bar.createSpan().style.width = `${item.tokens ? Math.max(2, Math.round(100 * item.tokens / max)) : 0}%`;
      const turnText = item.turns
        ? (item.tokensPerTurn ? t("{turns} 轮 ({per}/轮)", { turns: item.turns, per: fmtTok(item.tokensPerTurn) }) : t("{n} 次问答", { n: item.turns }))
        : "—";
      tr.createEl("td", { text: turnText });
      tr.createEl("td", { text: item.cacheHitRate !== null ? `${Math.round(item.cacheHitRate * 100)}%` : "—" });
      tr.createEl("td", { text: fmtMin(item.wall) });
      tr.createEl("td", { text: String(item.sessions) });
    }
  }

  heatmap(parent, data) {
    const section = parent.createEl("section", { cls: "ad-review__heat" });
    const head = section.createDiv({ cls: "ad-review__sectionhead" });
    head.createEl("h2", { text: t("Token 热力图") });
    head.createSpan({ text: t("{tokens} token · {days} 个活跃日", { tokens: fmtTok(data.tokens), days: data.activeDays }) });
    const days = calendarDays(this.from, this.to), max = Math.max(1, ...Object.values(data.days).map(d => d.tokens));
    const [y, m, d] = this.from.split("-").map(Number), offset = (new Date(y, m - 1, d, 12).getDay() + 6) % 7;
    const weeks = Math.ceil((days.length + offset) / 7);
    const scroll = section.createDiv({ cls: "ad-review__heat-scroll" });
    const chart = scroll.createDiv({ cls: "ad-review__calendar" });
    chart.style.setProperty("--ad-weeks", weeks);
    const labels = chart.createDiv({ cls: "ad-review__weekdays" });
    for (const label of [t("一"), "", t("三"), "", t("五"), "", t("日")]) labels.createSpan({ text: label });
    const months = chart.createDiv({ cls: "ad-review__months" });
    let lastMonth = "";
    days.forEach((day, i) => {
      const month = day.slice(0, 7);
      if (month === lastMonth) return;
      lastMonth = month;
      const label = months.createSpan({ text: month.slice(5), attr: { title: month } });
      label.style.gridColumn = String(Math.floor((i + offset) / 7) + 1);
    });
    const grid = chart.createDiv({ cls: "ad-review__grid", attr: { "aria-label": t("每日 token 用量，点击日期查看记录") } });
    for (let i = 0; i < offset; i++) grid.createSpan({ cls: "ad-review__blank" });
    for (const day of days) {
      const tokens = data.days[day]?.tokens || 0;
      const label = `${day} · ${tokens.toLocaleString()} token`;
      const cell = this.button(grid, "", () => {
        this.selectedDay = this.selectedDay === day ? "" : day; this.update();
        this.contentEl.querySelector(`[data-day="${day}"]`)?.focus({ preventScroll: true });
      }, "ad-review__day");
      cell.dataset.level = String(heatLevel(tokens, max)); cell.dataset.day = day;
      cell.title = label; cell.setAttribute("aria-label", label); cell.setAttribute("aria-pressed", String(this.selectedDay === day));
      cell.onkeydown = event => {
        const delta = ({ ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 })[event.key];
        if (delta === undefined) return;
        event.preventDefault(); grid.querySelector(`[data-day="${shiftDay(day, delta)}"]`)?.focus();
      };
    }
    const footer = section.createDiv({ cls: "ad-review__heat-footer" });
    footer.createSpan({ text: t("点击一天回顾当天；颜色越深，token 越多。") });
    const legend = footer.createDiv({ cls: "ad-review__legend" });
    legend.createSpan({ text: t("少") });
    for (let n = 0; n <= 4; n++) legend.createSpan({ cls: "ad-review__swatch", attr: { "data-level": String(n) } });
    legend.createSpan({ text: t("多") });
  }

  setProjectSort(sortKey) {
    if (this.projectSortBy === sortKey) {
      this.projectSortDir = this.projectSortDir === "asc" ? "desc" : "asc";
    } else {
      this.projectSortBy = sortKey;
      this.projectSortDir = sortKey === "name" ? "asc" : "desc";
    }
    this.update();
  }

  projects(parent, data) {
    const section = parent.createEl("section", { cls: "ad-review__projects" });
    const head = section.createDiv({ cls: "ad-review__sectionhead" });
    head.createEl("h2", { text: t("项目投入") });
    if (data.projects.length) {
      const sortBar = head.createDiv({ cls: "ad-review__chips" });
      for (const [id, label] of [
        ["tokens", t("按 Token")],
        ["wall", t("按耗时")],
        ["sessions", t("按会话")],
        ["name", t("按名称")],
      ]) {
        const btn = this.button(sortBar, label, () => this.setProjectSort(id), "ad-review__chip");
        btn.setAttribute("aria-pressed", String(this.projectSortBy === id));
      }
      const dirArrow = this.projectSortDir === "asc" ? "↑" : "↓";
      const dirLabel = `${this.projectSortDir === "asc" ? t("顺序") : t("倒序")} ${dirArrow}`;
      const dirBtn = this.button(sortBar, dirLabel, () => {
        this.projectSortDir = this.projectSortDir === "asc" ? "desc" : "asc";
        this.update();
      }, "ad-review__chip ad-review__sortdir");
      dirBtn.setAttribute("aria-pressed", "true");
      dirBtn.setAttribute("aria-label", t("切换排序方向"));
      dirBtn.title = t("切换排序方向");
    }
    if (!data.projects.length) { section.createEl("p", { cls: "ad-review__note", text: t("这段时间还没有记录；可先扫描本机会话，或选择其他日期。") }); return; }
    const scroll = section.createDiv({ cls: "ad-review__table-scroll" }), table = scroll.createEl("table");
    const header = table.createEl("thead").createEl("tr");
    for (const [key, label] of [
      ["name", t("项目")],
      ["tokens", "Token"],
      ["wall", t("活跃耗时")],
      ["sessions", t("会话数")],
    ]) {
      const active = this.projectSortBy === key;
      const th = header.createEl("th", {
        attr: { scope: "col", "aria-sort": active ? (this.projectSortDir === "asc" ? "ascending" : "descending") : "none" },
      });
      const text = active ? `${label} ${this.projectSortDir === "asc" ? "↑" : "↓"}` : label;
      const sortBtn = this.button(th, text, () => this.setProjectSort(key), "ad-review__th-sort" + (active ? " is-active" : ""));
      sortBtn.setAttribute("aria-pressed", String(active));
    }
    const body = table.createEl("tbody"), max = Math.max(1, data.projectsMaxTokens || data.projects.reduce((m, p) => Math.max(m, p.tokens), 0));
    for (const project of data.projects) {
      const tr = body.createEl("tr");
      if (project.path === this.project) tr.addClass("is-selected");
      const name = tr.createEl("td");
      this.button(name, project.name || t("未归类"), () => { this.project = this.project === project.path ? null : project.path; this.update(); }, "ad-review__project-name").setAttribute("aria-pressed", String(project.path === this.project));
      const metaRow = name.createDiv({ cls: "ad-review__project-sub" });
      if (project.path) this.button(metaRow, t("打开页面"), () => this.app.workspace.openLinkText(project.path, "", true), "ad-review__link");
      this.renderAgentBadges(metaRow, project.agents);
      const token = tr.createEl("td");
      const share = data.tokens > 0 && project.tokens > 0 ? ` (${Math.max(1, Math.round(project.share * 100))}%)` : "";
      token.createSpan({ text: fmtTok(project.tokens) + share });
      const bar = token.createDiv({ cls: "ad-review__bar" }); bar.createSpan().style.width = `${100 * project.tokens / max}%`;
      tr.createEl("td", { text: fmtMin(project.wall) }); tr.createEl("td", { text: String(project.sessions) });
    }
  }

  records(parent, from, to, baseData, initialOpened = new Set()) {
    const section = parent.createEl("section", { cls: "ad-review__records" });
    const head = section.createDiv({ cls: "ad-review__sectionhead" });
    head.createEl("h2", { text: t("记录明细") });
    const countEl = head.createSpan();
    const toolbar = section.createDiv({ cls: "ad-review__toolbar" });
    const search = toolbar.createEl("input", { type: "search", cls: "ad-review__search", value: this.query, attr: { placeholder: t("搜索标题、项目、模型或日记内容…"), "aria-label": t("搜索记录明细") } });
    const chips = toolbar.createDiv({ cls: "ad-review__chips" });
    const filterButtons = new Map();
    for (const [id, label] of [
      ["all", t("全部")],
      ["journal", t("仅含日记")],
      ["unclassified", baseData.unclassifiedCount ? t("待归类 ({n})", { n: baseData.unclassifiedCount }) : t("未归类")],
    ]) {
      const btn = this.button(chips, label, () => {
        this.recordFilter = id;
        this.limit = 40;
        for (const [k, el] of filterButtons) el.setAttribute("aria-pressed", String(k === id));
        renderList(new Set());
      }, "ad-review__chip");
      btn.setAttribute("aria-pressed", String(this.recordFilter === id));
      filterButtons.set(id, btn);
    }
    const sortChips = toolbar.createDiv({ cls: "ad-review__chips" });
    const sortButtons = new Map();
    for (const [id, label] of [
      ["day", t("按日期")],
      ["tokens", t("按 Token")],
      ["wall", t("按耗时")],
    ]) {
      const btn = this.button(sortChips, label, () => {
        this.sortBy = id;
        this.limit = 40;
        for (const [k, el] of sortButtons) el.setAttribute("aria-pressed", String(k === id));
        renderList(new Set());
      }, "ad-review__chip");
      btn.setAttribute("aria-pressed", String(this.sortBy === id));
      sortButtons.set(id, btn);
    }
    const listEl = section.createDiv({ cls: "ad-review__records-list" });
    const renderList = (opened = new Set()) => {
      const filtered = aggregateDashboard(this.data.rows, from, to, {
        project: this.project,
        agent: this.agent,
        model: this.model,
        dayCutoff: this.plugin.settings.dayCutoff ?? 0,
        onlyJournaled: this.recordFilter === "journal",
        onlyUnclassified: this.recordFilter === "unclassified",
        query: this.query,
        sortBy: this.sortBy,
      });
      countEl.setText(t("{n} 条日记录", { n: filtered.rows.length }));
      listEl.empty();
      if (!filtered.rows.length) {
        listEl.createEl("p", { cls: "ad-review__note", text: t("没有符合筛选条件的记录") });
        return;
      }
      for (const row of filtered.rows.slice(0, this.limit)) {
        const details = listEl.createEl("details", { cls: "ad-review__record" });
        const key = `${row.agent}:${row.sid}:${row.day}`;
        details.dataset.record = key;
        if (opened.has(key)) details.open = true;
        const summary = details.createEl("summary");
        summary.createSpan({ cls: "ad-review__record-title", text: row.title || (row.residual ? t("未归属的历史用量") : row.legacy ? t("历史汇总") : t("未命名会话")) });
        const metaEl = summary.createSpan({ cls: "ad-review__record-meta" });
        if (row.agent) this.renderAgentBadges(metaEl, [row.agent]);
        const metaParts = [row.day, AGENTS[row.agent]?.short || row.agent || "—"];
        if (row.model) metaParts.push(row.model);
        if (row.turns) metaParts.push(t("{n} 次问答", { n: row.turns }));
        metaParts.push(row.tokens ? fmtTok(row.tokens) + " tok" : t("用量未提供"), fmtMin(row.min));
        metaEl.createSpan({ text: metaParts.join(" · ") });
        const content = details.createDiv({ cls: "ad-review__record-body" });
        const reason = ({ manual: t("手动指定"), link: t("页面链接"), title: t("标题匹配"), cwd: t("目录匹配"), keyword: t("重复关键词"), unknown: t("未归类") })[row.reason];
        content.createEl("p", { text: `${row.projectName || t("未归类")} · ${reason}` });
        const actions = content.createDiv({ cls: "ad-review__actions" });
        if (!row.legacy) {
          this.button(actions, t("更正项目"), () => new ProjectPicker(this, row).open());
          this.button(actions, t("打开会话"), () => this.plugin.openSession(row.agent, row.sid, row.app || "", row));
        }
        const unique = new Set();
        for (const source of row.sources) {
          const id = `${source.path}:${source.line}`;
          if (unique.has(id)) continue; unique.add(id);
          this.button(content, source.path, () => this.app.workspace.openLinkText(source.path + (source.blockId ? `#^${source.blockId}` : ""), "", true), "ad-review__source");
          content.createEl("pre", { cls: "ad-review__excerpt", text: source.text });
        }
        if (!unique.size) content.createEl("p", { cls: "ad-review__note", text: t("尚未找到对应日记条目；用量来自已保存的会话日统计。") });
      }
      if (filtered.rows.length > this.limit) {
        this.button(listEl, t("再显示 40 条"), () => {
          const curOpened = new Set([...listEl.querySelectorAll(".ad-review__record[open]")].map(el => el.dataset.record));
          this.limit += 40;
          renderList(curOpened);
        });
      }
    };
    search.oninput = () => {
      this.query = search.value;
      this.limit = 40;
      renderList(new Set());
    };
    search.onblur = () => { if (this._pendingRender) this.scheduleRender(); };
    renderList(initialOpened);
  }

  multiSessionTasks(parent, data) {
    const byTask = new Map();
    for (const row of data.rows || []) {
      if (!row.sid || !Array.isArray(row.sources) || !row.sources.length) continue;
      for (const src of row.sources) {
        if (!src?.path) continue;
        const key = `${src.path}#${src.blockId || src.line || 0}`;
        let bucket = byTask.get(key);
        if (!bucket) {
          const rawTitle = String(src.title || String(src.text || "").split("\n")[0])
            .replace(/^\s*[-*+]\s+/, "")
            .replace(/\s+\^[a-z0-9-]+$/i, "")
            .trim();
          bucket = { key, path: src.path, blockId: src.blockId || "", line: src.line || 0, title: rawTitle || src.path, tokens: 0, sids: new Set(), seenRows: new Set(), agents: new Set(), segsByDay: new Map() };
          byTask.set(key, bucket);
        }
        const rowKey = `${row.day || ""}|${row.sid}`;
        if (bucket.seenRows.has(rowKey)) continue;
        bucket.seenRows.add(rowKey);
        bucket.sids.add(row.sid);
        if (row.agent) bucket.agents.add(row.agent);
        bucket.tokens += row.tokens || 0;
        if (Array.isArray(row.segs) && row.segs.length) {
          const dayKey = row.day || "";
          let arr = bucket.segsByDay.get(dayKey);
          if (!arr) bucket.segsByDay.set(dayKey, arr = []);
          arr.push(...row.segs);
        }
      }
    }
    const items = [...byTask.values()]
      .filter((x) => x.sids.size >= 2)
      .map((x) => {
        let wall = 0;
        for (const segs of x.segsByDay.values()) {
          for (const [a, b] of unionSegs(segs)) if (b > a) wall += b - a;
        }
        return { ...x, sessions: x.sids.size, agentList: [...x.agents], wall: Math.round(wall) };
      })
      .sort((a, b) => (b.tokens - a.tokens) || (b.wall - a.wall))
      .slice(0, 10);
    if (!items.length) return;

    const section = parent.createEl("section", { cls: "ad-review__projects ad-review__tasks" });
    const head = section.createDiv({ cls: "ad-review__sectionhead" });
    head.createEl("h2", { text: t("跨会话任务投入") });
    head.createSpan({ text: t("{n} 条多会话任务（去重耗时）", { n: items.length }) });

    const scroll = section.createDiv({ cls: "ad-review__table-scroll" }), table = scroll.createEl("table");
    const thead = table.createEl("thead").createEl("tr");
    for (const label of [t("任务"), "Token", t("活跃耗时"), t("会话数")]) thead.createEl("th", { text: label, attr: { scope: "col" } });
    const body = table.createEl("tbody");
    const max = Math.max(1, ...items.map((x) => x.tokens));
    for (const item of items) {
      const tr = body.createEl("tr");
      const nameTd = tr.createEl("td");
      const btn = this.button(nameTd, item.title.slice(0, 56), () => this.app?.workspace?.openLinkText?.(item.path + (item.blockId ? `#^${item.blockId}` : ""), "", true), "ad-review__source");
      btn.title = item.path;
      const metaRow = nameTd.createDiv({ cls: "ad-review__project-sub" });
      this.renderAgentBadges(metaRow, item.agentList);
      const tokTd = tr.createEl("td");
      tokTd.createSpan({ text: item.tokens ? fmtTok(item.tokens) : t("用量未提供") });
      const bar = tokTd.createDiv({ cls: "ad-review__bar" });
      bar.createSpan().style.width = `${item.tokens ? Math.max(2, Math.round(100 * item.tokens / max)) : 0}%`;
      tr.createEl("td", { text: fmtMin(item.wall) });
      tr.createEl("td", { text: String(item.sessions) });
    }
  }

  securityAuditSection(parent) {
    const audit = this.data?.securityAudit;
    const allowCount = audit ? audit.allowlistCount : (this.plugin.settings?.securityAllowlist?.length || 0);
    const section = parent.createEl("section", { cls: "ad-review__security" });
    const head = section.createDiv({ cls: "ad-review__sectionhead" });
    head.createEl("h2", { text: t("安全回放与护栏") });
    const actions = head.createDiv({ cls: "ad-review__actions" });
    if (typeof this.plugin.runSecurityAuditReport === "function") {
      const runReplay = async (days) => {
        if (this._runningAudit) return;
        this._runningAudit = true;
        b7.disabled = true;
        b30.disabled = true;
        try {
          await this.plugin.runSecurityAuditReport({ days, overrideDays: true });
          await this.render();
        } finally {
          this._runningAudit = false;
          b7.disabled = false;
          b30.disabled = false;
        }
      };
      const b7 = this.button(actions, t("7 天快速回放"), () => runReplay(7));
      const b30 = this.button(actions, t("30 天回放"), () => runReplay(30));
    }
    if (audit) {
      this.button(actions, t("打开审计报告"), () => this.app?.workspace?.openLinkText?.("Agent Deck/安全审计.md", "", true));
      const stats = section.createDiv({ cls: "ad-review__stats" });
      for (const [label, value] of [
        [t("最近回放"), audit.generatedAt || t("{n} 天", { n: audit.days })],
        [t("工具调用"), String(audit.totalToolCalls)],
        [t("命中风险"), String(audit.totalFindings)],
        [t("白名单规则"), String(allowCount)],
      ]) {
        const stat = stats.createDiv(); stat.createSpan({ text: label }); stat.createEl("strong", { text: value });
      }
      section.createEl("p", {
        cls: "ad-review__note",
        text: t("统计窗口 {days} 天 · 已扫描 {sessions} 个会话 · 白名单已放行 {allow} 条 · 已降噪临时/构建目录 {noise} 条。", {
          days: audit.days,
          sessions: audit.scannedSessions,
          allow: audit.suppressedByAllowlist,
          noise: audit.suppressedNoise,
        }),
      });
    } else {
      section.createEl("p", {
        cls: "ad-review__note",
        text: t("尚未生成安全审计报告。点击上方按钮离线回放历史工具调用，检测高危命令、敏感路径与明文密钥（当前已配置 {n} 条 ACP 护栏白名单）。", { n: allowCount }),
      });
    }
  }
}
