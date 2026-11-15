import { ItemView, FuzzySuggestModal } from "obsidian";
import { AGENTS, dayKeyToday, fmtMin, fmtTok } from "./constants.js";
import { aggregateDashboard, calendarDays, heatLevel, shiftDay, isoDay } from "./analytics.js";
import { DashboardData } from "./dashboard-data.js";
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
    this.selectedDay = ""; this.project = null; this.limit = 40;
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
    this.register(() => clearTimeout(this._sourceTimer));
    await this.render();
  }
  async onClose() { this._closed = true; this.plugin.views.delete(this); clearTimeout(this._sourceTimer); }
  onResize() { if (this._pendingRender) this.render(); }
  scheduleRender() { clearTimeout(this._sourceTimer); this._sourceTimer = setTimeout(() => this.render(), 800); }

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

    const overview = aggregateDashboard(this.data.rows, this.from, this.to);
    this.heatmap(page, overview);
    const from = this.selectedDay || this.from, to = this.selectedDay || this.to;
    const scope = aggregateDashboard(this.data.rows, from, to);
    const data = this.project === null ? scope : aggregateDashboard(this.data.rows, from, to, this.project);
    const selection = page.createDiv({ cls: "ad-review__selection" });
    selection.createSpan({ text: this.selectedDay || `${this.from} — ${this.to}` });
    if (this.selectedDay) this.button(selection, t("查看整个日期范围"), () => { this.selectedDay = ""; this.update(); });
    if (this.project !== null) this.button(selection, t("清除项目筛选"), () => { this.project = null; this.update(); });
    const stats = page.createDiv({ cls: "ad-review__stats" });
    for (const [label, value] of [[t("总 token"), fmtTok(data.tokens)], [t("活跃耗时"), fmtMin(data.wall)], [t("会话数"), String(data.sessions)], [t("活跃天数"), String(data.activeDays)]]) {
      const stat = stats.createDiv(); stat.createSpan({ text: label }); stat.createEl("strong", { text: value });
    }
    page.createEl("p", { cls: "ad-review__note", text: t("输入 {fresh} · 输出 {out} · 缓存读取 {cached}。耗时按活跃时段去重；不同项目同时工作时，项目耗时之和可能超过总耗时。", { fresh: fmtTok(data.fresh), out: fmtTok(data.out), cached: fmtTok(data.cached) }) });
    if (data.missingTokens || data.missingSpans || this.data.unreadable) page.createEl("p", { cls: "ad-review__note", text: t("数据缺口：{tokens} 条日记录未提供 token，{spans} 条缺少活跃时段，{files} 篇来源暂时无法读取；统计不作估算。", { tokens: data.missingTokens, spans: data.missingSpans, files: this.data.unreadable }) });
    this.projects(page, scope);
    this.records(page, data);
    for (const record of root.querySelectorAll(".ad-review__record")) if (opened.has(record.dataset.record)) record.open = true;
    const details = page.createEl("details", { cls: "ad-review__method" });
    details.createEl("summary", { text: t("统计与项目识别规则") });
    details.createEl("p", { text: t("只统计本机已经追踪并保存的历史。每日沿用日记分界 {hour}:00；token 包含输入、输出和缓存读取，不代表费用。", { hour: this.plugin.settings.dayCutoff ?? 8 }) });
    details.createEl("p", { text: t("项目优先采用日记条目中的页面链接，再匹配标题、目录与重复出现的正文关键词。重名或证据冲突时留在未归类；更正作用于该会话所有日期，可随时恢复自动识别。") });
    root.scrollTop = scroll;
    const heatScroll = root.querySelector(".ad-review__heat-scroll");
    const heatRange = `${this.from}:${this.to}`;
    if (heatScroll) heatScroll.scrollLeft = this._heatRange === heatRange ? heatLeft ?? heatScroll.scrollWidth : heatScroll.scrollWidth;
    this._heatRange = heatRange;
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

  projects(parent, data) {
    const section = parent.createEl("section", { cls: "ad-review__projects" });
    section.createEl("h2", { text: t("项目投入") });
    if (!data.projects.length) { section.createEl("p", { cls: "ad-review__note", text: t("这段时间还没有记录；可先扫描本机会话，或选择其他日期。") }); return; }
    const scroll = section.createDiv({ cls: "ad-review__table-scroll" }), table = scroll.createEl("table");
    const header = table.createEl("thead").createEl("tr");
    for (const label of [t("项目"), "Token", t("活跃耗时"), t("会话数")]) header.createEl("th", { text: label, attr: { scope: "col" } });
    const body = table.createEl("tbody"), max = data.projects[0]?.tokens || 1;
    for (const project of data.projects) {
      const tr = body.createEl("tr");
      if (project.path === this.project) tr.addClass("is-selected");
      const name = tr.createEl("td");
      this.button(name, project.name || t("未归类"), () => { this.project = this.project === project.path ? null : project.path; this.update(); }, "ad-review__project-name").setAttribute("aria-pressed", String(project.path === this.project));
      if (project.path) this.button(name, t("打开页面"), () => this.app.workspace.openLinkText(project.path, "", true), "ad-review__link");
      const token = tr.createEl("td"); token.createSpan({ text: fmtTok(project.tokens) });
      const bar = token.createDiv({ cls: "ad-review__bar" }); bar.createSpan().style.width = `${100 * project.tokens / max}%`;
      tr.createEl("td", { text: fmtMin(project.wall) }); tr.createEl("td", { text: String(project.sessions) });
    }
  }

  records(parent, data) {
    const section = parent.createEl("section", { cls: "ad-review__records" });
    const head = section.createDiv({ cls: "ad-review__sectionhead" });
    head.createEl("h2", { text: t("记录明细") });
    head.createSpan({ text: t("{n} 条日记录", { n: data.rows.length }) });
    if (!data.rows.length) section.createEl("p", { cls: "ad-review__note", text: t("没有符合筛选条件的记录") });
    for (const row of data.rows.slice(0, this.limit)) {
      const details = section.createEl("details", { cls: "ad-review__record" });
      details.dataset.record = `${row.agent}:${row.sid}:${row.day}`;
      const summary = details.createEl("summary");
      summary.createSpan({ cls: "ad-review__record-title", text: row.title || (row.residual ? t("未归属的历史用量") : row.legacy ? t("历史汇总") : t("未命名会话")) });
      summary.createSpan({ cls: "ad-review__record-meta", text: `${row.day} · ${AGENTS[row.agent]?.short || row.agent || "—"} · ${row.tokens ? fmtTok(row.tokens) + " tok" : t("用量未提供")} · ${fmtMin(row.min)}` });
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
    if (data.rows.length > this.limit) this.button(section, t("再显示 40 条"), () => { this.limit += 40; this.paint(); });
  }
}
