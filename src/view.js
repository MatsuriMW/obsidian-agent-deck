// Agent Deck — the sidebar dashboard.

import { ItemView, Menu } from "obsidian";
import { AGENTS, AGENT_ORDER, fmtMin, fmtTok, timeAgo, truncate, dayKey, dayKeyToday, dayMinute, startOfDay } from "./constants.js";
import { agentIcon, setLucide, stateIcon } from "./icons.js";
import { lattice } from "./lattice.js";
import { SESSION_MIME } from "./editor.js";

export const VIEW_TYPE = "agent-deck-view";

export class AgentDeckView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.filter = "all";
    this.search = "";
    this._scroll = 0;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "Agent Deck"; }
  getIcon() { return "gauge"; }

  async onOpen() {
    this.contentEl.addClass("ad-view");
    this.plugin.views.add(this);
    this.render();
  }

  async onClose() {
    this.plugin.views.delete(this);
  }

  render() {
    // 正在拖「现在」里的卡片排序：重画会把拖着的卡片换掉，等松手再画
    if (this._dragSid) { this._pendingRender = true; return; }
    const root = this.contentEl;
    this._scroll = root.scrollTop || this._scroll;
    const focused = document.activeElement;
    const searchWasFocused = focused && focused.classList && focused.classList.contains("ad-search__input");
    root.empty();
    root.addClass("ad-view");
    const dash = root.createDiv({ cls: "ad-dash" });

    const p = this.plugin;
    const todayKey = dayKeyToday(p.settings);
    const today = p.store.get(todayKey);
    const live = p.liveSessions({ hours: 6 });
    const running = live.filter((x) => ["run", "starting", "running"].includes(x.state) || (x.agent && x.state === "busy"));
    const waiting = live.filter((x) => ["wait", "quiet", "needs-approval"].includes(x.state));
    const recent = p.recentSessions({ days: 7, limit: 80 });

    // Header：会话搜索 + 两个按钮
    const head = dash.createDiv({ cls: "ad-head" });
    const search = head.createDiv({ cls: "ad-search" });
    setLucide(search.createSpan({ cls: "ad-search__icon" }), "search");
    const input = search.createEl("input", { cls: "ad-search__input", attr: { placeholder: "搜会话：标题、项目、第一步…", value: this.search } });
    const actions = head.createDiv({ cls: "ad-head__actions" });
    const scan = actions.createEl("button", { cls: "ad-iconbtn", attr: { "aria-label": "重新扫描本机会话" } });
    setLucide(scan.createSpan({ cls: "ad-iconbtn__icon" }), "refresh-cw");
    scan.onclick = () => p.scanNow(true);
    const gear = actions.createEl("button", { cls: "ad-iconbtn", attr: { "aria-label": "设置" } });
    setLucide(gear.createSpan({ cls: "ad-iconbtn__icon" }), "settings-2");
    gear.onclick = () => p.openSettings();

    // Hero：今天的数字 + 时间轴 + 花时间最多的项目
    const hero = dash.createDiv({ cls: "ad-hero" });
    const nums = hero.createDiv({ cls: "ad-hero__nums" });
    this.num(nums, fmtMin(today ? today.wall : 0), "协作时长", this.vsWeek(today));
    this.num(nums, fmtTok(today ? today.out : 0), "产出 token", today && today.calls ? `${today.calls} 次调用` : "");
    this.num(nums, String(today ? today.sessions || 0 : 0), "会话", today && today.prompts ? `${today.prompts} 次提问` : "");
    if (today && today.wall) {
      this.dayTimeline(hero, today);
      this.topProjects(hero, today);
    } else {
      hero.createDiv({ cls: "ad-hero__hint", text: "今天还没有会话" });
    }

    // Now
    const nowSec = dash.createDiv({ cls: "ad-sec ad-sec--now" });
    const nowHead = this.secHead(nowSec, "现在", `${running.length} 个在跑 · ${waiting.length} 个等你`);
    const nowList = nowSec.createDiv({ cls: "ad-nowlist" });
    const nowItems = this.nowOrdered([...running, ...waiting]).slice(0, 6);
    if (!nowItems.length) this.empty(nowList, "现在没有在跑的会话");
    for (const s of nowItems) this.sessionCard(nowList, s, true);
    this.nowReorder(nowList);

    // Agents
    const agentsSec = dash.createDiv({ cls: "ad-sec" });
    this.secHead(agentsSec, "Agents", "", () => p.openSettings());
    const grid = agentsSec.createDiv({ cls: "ad-agentgrid" });
    for (const id of AGENT_ORDER) this.agentCard(grid, id, today);

    // Usage
    if (p.settings.ui.showUsageBars !== false) {
      const usageSec = dash.createDiv({ cls: "ad-sec" });
      this.secHead(usageSec, "最近 14 天");
      this.usageBars(usageSec);
    }

    // Recent
    const recSec = dash.createDiv({ cls: "ad-sec ad-sec--recent" });
    const recHead = this.secHead(recSec, "最近的会话", `${recent.length} 个 · 最近 7 天`);
    const filters = recHead.createDiv({ cls: "ad-filters" });
    for (const [id, label] of [["all", "全部"], ["live", "在跑"], ["wait", "等你"], ["claude", "Claude"], ["codex", "Codex"], ["workbuddy", "WorkBuddy"], ["dsh", "DSH"]]) {
      const b = filters.createEl("button", { cls: "ad-chip" + (this.filter === id ? " is-on" : ""), text: label });
      b.onclick = () => { this.filter = id; this.render(); };
    }
    input.oninput = () => { this.search = input.value; this.renderSessions(recSec); };
    recSec._list = recSec.createDiv({ cls: "ad-sessionlist" });
    this.renderSessions(recSec);

    root.scrollTop = this._scroll;
    this.playFly(dash);
    if (searchWasFocused) { const i = root.querySelector(".ad-search__input"); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
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

  renderSessions(sec) {
    const list = sec._list || sec.querySelector(".ad-sessionlist");
    if (!list) return;
    list.empty();
    const p = this.plugin;
    let rows = p.recentSessions({ days: 7, limit: 200 });
    if (this.filter === "live") rows = rows.filter((x) => x.state === "run");
    else if (this.filter === "wait") rows = rows.filter((x) => ["wait", "quiet"].includes(x.state));
    else if (AGENTS[this.filter]) rows = rows.filter((x) => x.agent === this.filter);
    if (this.search.trim()) {
      const q = this.search.toLowerCase();
      rows = rows.filter((x) => `${x.title} ${x.cwd} ${x.text} ${x.step}`.toLowerCase().includes(q));
    }
    if (!rows.length) return this.empty(list, "没有符合条件的会话");
    for (const s of rows) this.sessionCard(list, s, false);
  }

  secHead(parent, title, sub, action) {
    const h = parent.createDiv({ cls: "ad-sechead" });
    const t = h.createDiv({ cls: "ad-sechead__title" });
    t.createSpan({ text: title });
    if (sub) t.createSpan({ cls: "ad-sechead__sub", text: sub });
    if (action) {
      const b = h.createEl("button", { cls: "ad-linkbtn", text: "管理" });
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
    return `较 7 日均 ${pct >= 0 ? "+" : ""}${pct}%`;
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
    ticks.createSpan({ text: "现在" });
  }

  // 今天花时间最多的三个项目
  topProjects(parent, today) {
    const rows = Object.entries(today.proj || {}).filter(([, v]) => v.min >= 1).sort((a, b) => b[1].min - a[1].min).slice(0, 3);
    if (!rows.length) return;
    const max = rows[0][1].min;
    const box = parent.createDiv({ cls: "ad-projs" });
    for (const [name, v] of rows) {
      const row = box.createDiv({ cls: "ad-proj" });
      row.createSpan({ cls: "ad-proj__name", text: name || "—" });
      const bar = row.createDiv({ cls: "ad-proj__bar" });
      bar.createDiv({ cls: "ad-proj__fill" }).style.width = `${(v.min / max) * 100}%`;
      row.createSpan({ cls: "ad-proj__min", text: fmtMin(v.min) });
    }
  }

  agentCard(parent, id, today) {
    const p = this.plugin;
    const a = AGENTS[id];
    const enabled = p.agentEnabled(id);
    const primary = p.isPrimary(id);
    const by = (today && today.by && today.by[id]) || null;
    const card = parent.createDiv({ cls: `ad-agentcard ${enabled ? "" : "is-off"} ${primary ? "is-primary" : ""}` });
    card.dataset.agent = id;
    card.style.setProperty("--ad-agent", a.color);
    card.style.setProperty("--ad-agent-soft", a.soft);
    // 笔记里的一项拖上来 = 委派给它
    // 按住 ⌘：Claude Code / Codex 改在终端里开交互式会话
    const handoff = id === "codex" || id === "workbuddy";
    const cliCapable = id === "claude" || id === "codex";
    const hint = handoff ? `交给 ${a.short}` : `委派给 ${a.short}`;
    // 设置里「默认在终端里委派」开着时反过来：不按 ⌘ 在终端里开，按住 ⌘ 走原来的后台 / 客户端
    const toTerm = (meta) => cliCapable && (!!meta !== !!p.settings.delegateInTerminal);
    const hintFor = (meta) => (toTerm(meta) ? `在终端里开 ${a.short}` : hint);
    card.setAttr("data-drop-hint", hintFor(false));
    card.addEventListener("dragover", (e) => {
      if (!p.acceptsItemDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      card.addClass("is-drop");
      card.toggleClass("is-cli", toTerm(e.metaKey));
      card.setAttr("data-drop-hint", hintFor(e.metaKey));
    });
    card.addEventListener("dragleave", (e) => { if (!card.contains(e.relatedTarget)) { card.removeClass("is-drop"); card.removeClass("is-cli"); card.setAttr("data-drop-hint", hintFor(false)); } });
    card.addEventListener("drop", (e) => {
      if (!p.acceptsItemDrag(e)) return;
      e.preventDefault();
      card.removeClass("is-drop");
      card.removeClass("is-cli");
      card.setAttr("data-drop-hint", hintFor(false));
      p.delegateDrop(id, p.readItemDrag(e), null, { cli: toTerm(e.metaKey) });
    });
    const top = card.createDiv({ cls: "ad-agentcard__top" });
    const mark = top.createEl("button", { cls: "ad-agentcard__mark", attr: { "aria-label": `打开 ${a.name}` } });
    agentIcon(mark.createSpan({ cls: "ad-glyph" }), id);
    mark.onclick = (e) => { e.stopPropagation(); p.openAgentApp(id); };
    const name = top.createDiv({ cls: "ad-agentcard__name" });
    name.createDiv({ cls: "ad-agentcard__title", text: a.name });
    const live = p.usage.liveSessions({ since: Date.now() - 86400000, limit: 100 }).filter((x) => x.agent === id);
    const running = live.filter((x) => x.state === "run").length;
    name.createDiv({ cls: "ad-agentcard__where", text: running ? `${running} 个在跑` : (by ? `${by.sessions || 0} 个会话` : "今天还没动") });
    const star = top.createEl("button", { cls: "ad-star" + (primary ? " is-on" : ""), attr: { "aria-label": primary ? "取消主力" : "设为主力（最多两个）" } });
    setLucide(star, primary ? "star" : "star-off");
    star.onclick = (e) => { e.stopPropagation(); p.togglePrimary(id); };
    const stats = card.createDiv({ cls: "ad-agentcard__stats" });
    stats.createSpan({ text: fmtMin(by ? by.wall : 0) });
    stats.createSpan({ cls: "ad-dot", text: "·" });
    stats.createSpan({ text: fmtTok(by ? by.out : 0) + " tok" });
    const spark = card.createDiv({ cls: "ad-spark" });
    if (p.settings.ui.showSparkline !== false) this.sparkline(spark, id);
    for (const job of Object.values(p.jobs).filter((j) => j.agent === id && j.handoff && j.state === "starting" && !j.sessionId)) {
      const row = card.createDiv({ cls: "ad-handoff" });
      lattice(row.createSpan({ cls: "ad-handoff__icon" }), "ripple");
      row.createSpan({ cls: "ad-handoff__text", text: job.cli ? `等终端里的会话：${truncate(job.name, 16)}` : `等你在 ${a.short} 里发出：${truncate(job.name, 18)}` });
      const x = row.createEl("button", { cls: "ad-handoff__x", attr: { "aria-label": "不等了" } });
      setLucide(x, "x");
      x.onclick = (e) => { e.stopPropagation(); p.cancelJob(job.id); };
    }
    const foot = card.createDiv({ cls: "ad-agentcard__foot" });
    const toggle = foot.createEl("button", { cls: "ad-minitoggle" + (enabled ? " is-on" : ""), text: enabled ? "追踪中" : "已关闭" });
    toggle.onclick = (e) => { e.stopPropagation(); p.setAgentEnabled(id, !enabled); };
    const open = foot.createEl("button", { cls: "ad-linkbtn", text: "扫描" });
    open.onclick = (e) => { e.stopPropagation(); p.scanNow(true); };
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

  sessionCard(parent, s, compact) {
    const p = this.plugin;
    const a = AGENTS[s.agent] || AGENTS.claude;
    const card = parent.createDiv({ cls: `ad-sess ${compact ? "is-now" : ""}` });
    card.dataset.sid = s.sid;
    card.draggable = true;
    card.addEventListener("dragstart", (e) => {
      const title = s.title || truncate(s.text || s.step || s.sid, 60);
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
    card.addEventListener("dragleave", (e) => { if (!card.contains(e.relatedTarget)) card.removeClass("is-drop"); });
    card.addEventListener("drop", (e) => {
      if (!p.acceptsItemDrag(e)) return;
      e.preventDefault(); card.removeClass("is-drop");
      p.bindItemToSession(p.readItemDrag(e), { agent: s.agent, sid: s.sid, title: s.title || truncate(s.text || s.step || s.sid, 60), app: s.app || "", state: s.state || "" });
    });
    card.style.setProperty("--ad-agent", a.color);
    card.style.setProperty("--ad-agent-soft", a.soft);
    const child = !!s.parentSid;
    if (child) card.addClass("is-child");
    const live = ["run", "starting", "running"].includes(s.state);
    const wait = ["wait", "quiet", "needs-approval"].includes(s.state);
    if (live) card.addClass("is-live");
    if (wait) card.addClass("is-wait");
    const icon = card.createDiv({ cls: "ad-sess__mark" });
    agentIcon(icon.createSpan({ cls: "ad-glyph" }), s.agent);
    const body = card.createDiv({ cls: "ad-sess__body" });
    const titleRow = body.createDiv({ cls: "ad-sess__title" });
    titleRow.createSpan({ cls: "ad-sess__name", text: s.title || truncate(s.text || s.step || s.sid, 60) || s.sid.slice(0, 12) });
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
      sb.createSpan({ text: subs.length > 1 ? `子代理 ×${subs.length}` : "子代理" });
      sb.title = subs.map((r) => r.desc || r.type || "subagent").join("\n");
    }
    if (s.sideChats) {
      const sc = titleRow.createSpan({ cls: "ad-side" });
      setLucide(sc.createSpan({ cls: "ad-side__icon" }), "message-square");
      sc.createSpan({ text: s.sideChats > 1 ? `side chat ×${s.sideChats}` : "side chat" });
      if (s.sideSince) sc.title = `${timeAgo(s.sideSince)}开的`;
    }
    const sub = body.createDiv({ cls: "ad-sess__sub" });
    sub.createSpan({ text: a.short });
    if (s.cwd) sub.createSpan({ text: "·" });
    if (s.cwd) sub.createSpan({ cls: "ad-sess__cwd", text: truncate(s.cwd, 34) });
    if (s.step) { sub.createSpan({ text: "·" }); sub.createSpan({ cls: "ad-sess__step", text: truncate(s.step, 34) }); }
    sub.createSpan({ text: "·" });
    sub.createSpan({ text: timeAgo(s.lastAt) });
    if (s.tokens) { sub.createSpan({ text: "·" }); sub.createSpan({ cls: "ad-sess__tok", text: fmtTok(s.tokens) + " tok" }); }
    if (child) {
      const kin = body.createDiv({ cls: "ad-sess__kin" });
      kin.createSpan({ cls: "ad-sess__kinmark", text: "↳" });
      kin.createSpan({ cls: "ad-sess__kintitle", text: `从「${truncate(s.parentTitle || "母会话", 24)}」开出` });
      if (s.deskTitle && s.deskTitle !== s.title) kin.title = `桌面版里的标题：${s.deskTitle}`;
    }
    if (compact) {
      card.addClass("has-x");
      const x = card.createEl("button", { cls: "ad-arrow ad-sess__x", attr: { "aria-label": "从「现在」移除" } });
      setLucide(x.createSpan({ cls: "ad-arrow__icon" }), "x");
      x.onclick = (e) => { e.stopPropagation(); this.removeFromNow(s.sid); };
      card.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const m = new Menu();
        m.addItem((i) => i.setTitle("打开会话").setIcon("arrow-up-right").onClick(() => p.openSession(s.agent, s.sid, s.app, s)));
        m.addItem((i) => i.setTitle("从「现在」移除").setIcon("x").onClick(() => this.removeFromNow(s.sid)));
        m.showAtMouseEvent(e);
      });
    }
    const go = card.createEl("button", { cls: "ad-arrow", attr: { "aria-label": "打开会话" } });
    setLucide(go.createSpan({ cls: "ad-arrow__icon" }), "arrow-up-right");
    const open = () => p.openSession(s.agent, s.sid, s.app, s);
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

function stateChip(s) {
  const st = s.state || "idle";
  if (st === "run") return { cls: "is-live", label: "在跑" };
  if (st === "wait") return { cls: "is-wait", label: "等你" };
  if (st === "quiet") return { cls: "is-quiet", label: "安静" };
  if (st === "error") return { cls: "is-error", label: "出错" };
  if (st === "limit") return { cls: "is-error", label: "限额" };
  if (st === "needs-approval") return { cls: "is-wait", label: "等你允许" };
  if (st === "done") return { cls: "is-done", label: "完成" };
  if (st === "cancelled") return { cls: "is-quiet", label: "已取消" };
  return null;
}
