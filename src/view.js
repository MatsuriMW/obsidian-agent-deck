// Agent Deck — the sidebar dashboard.

import { ItemView, Menu, setIcon } from "obsidian";
import { AGENTS, AGENT_ORDER, fmtKey, fmtMin, fmtTok, fmtClock, fmtDur, timeAgo, truncate, unionSegs, dayKeyToday, esc } from "./constants.js";
import { agentIcon, setLucide, stateIcon } from "./icons.js";
import { SESSION_MIME } from "./editor.js";

export const VIEW_TYPE = "agent-deck-view";

const STATE_LABEL = { run: "在跑", wait: "等你", idle: "安静", error: "出错", limit: "限额", done: "完成", starting: "准备中", running: "在跑", "needs-approval": "等你允许", cancelled: "已取消" };

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

    // Header
    const head = dash.createDiv({ cls: "ad-head" });
    const brand = head.createDiv({ cls: "ad-brand" });
    const brandMark = brand.createSpan({ cls: "ad-brand__mark" });
    setLucide(brandMark, "wand-sparkles");
    const brandText = brand.createDiv({ cls: "ad-brand__text" });
    brandText.createDiv({ cls: "ad-brand__name", text: "Agent Deck" });
    brandText.createDiv({ cls: "ad-brand__sub", text: "智能体甲板" });
    const actions = head.createDiv({ cls: "ad-head__actions" });
    const scan = actions.createEl("button", { cls: "ad-iconbtn", attr: { "aria-label": "重新扫描本机会话" } });
    setLucide(scan.createSpan({ cls: "ad-iconbtn__icon" }), "refresh-cw");
    scan.onclick = () => p.scanNow(true);
    const gear = actions.createEl("button", { cls: "ad-iconbtn", attr: { "aria-label": "设置" } });
    setLucide(gear.createSpan({ cls: "ad-iconbtn__icon" }), "settings-2");
    gear.onclick = () => p.openSettings();

    // Hero
    const hero = dash.createDiv({ cls: "ad-hero" });
    const dateLine = hero.createDiv({ cls: "ad-hero__date" });
    const now = new Date();
    const wd = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][now.getDay()];
    dateLine.createSpan({ text: `${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${wd}` });
    dateLine.createSpan({ cls: "ad-hero__hint", text: today ? "今天的协作记录" : "今天还没有会话" });
    const nums = hero.createDiv({ cls: "ad-hero__nums" });
    this.num(nums, String(live.filter((x) => ["run", "running"].includes(x.state)).length), "在跑", "is-live");
    this.num(nums, fmtMin(today ? today.wall : 0), "协作时长", "");
    this.num(nums, fmtTok(today ? today.out : 0), "产出 token", "");
    const prim = hero.createDiv({ cls: "ad-hero__primaries" });
    prim.createSpan({ cls: "ad-kicker", text: "主力" });
    for (const id of p.primaryAgents()) {
      const a = AGENTS[id];
      const chip = prim.createSpan({ cls: "ad-primary-chip", attr: { style: `--ad-agent:${a.color};--ad-agent-soft:${a.soft}` } });
      agentIcon(chip.createSpan({ cls: "ad-glyph" }), id);
      chip.createSpan({ text: a.name });
      chip.createSpan({ cls: "ad-primary-chip__tag", text: "全量" });
    }
    if (!p.primaryAgents().length) prim.createSpan({ cls: "ad-muted", text: "在设置里选 1–2 个" });

    // Now
    const nowSec = dash.createDiv({ cls: "ad-sec ad-sec--now" });
    const nowHead = this.secHead(nowSec, "现在", `${running.length} 个在跑 · ${waiting.length} 个等你`);
    const nowList = nowSec.createDiv({ cls: "ad-nowlist" });
    const nowItems = [...running, ...waiting].slice(0, 6);
    if (!nowItems.length) this.empty(nowList, "现在没有在跑的会话", "把笔记里的一项拖到下面的 Agent 上委派，或者等下一次扫描。");
    for (const s of nowItems) this.sessionCard(nowList, s, true);

    // Agents
    const agentsSec = dash.createDiv({ cls: "ad-sec" });
    this.secHead(agentsSec, "Agents", "点图标打开客户端 · 把笔记里的一项拖上来委派", () => p.openSettings());
    const grid = agentsSec.createDiv({ cls: "ad-agentgrid" });
    for (const id of AGENT_ORDER) this.agentCard(grid, id, today);

    // Usage
    if (p.settings.ui.showUsageBars !== false) {
      const usageSec = dash.createDiv({ cls: "ad-sec" });
      this.secHead(usageSec, "最近 14 天", "按 Agent 堆叠的协作分钟");
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
    const search = recHead.createDiv({ cls: "ad-search" });
    search.createSpan({ cls: "ad-search__icon", text: "⌕" });
    const input = search.createEl("input", { cls: "ad-search__input", attr: { placeholder: "搜标题、项目、第一步…", value: this.search } });
    input.oninput = () => { this.search = input.value; this.renderSessions(recSec); };
    recSec._list = recSec.createDiv({ cls: "ad-sessionlist" });
    this.renderSessions(recSec);

    root.scrollTop = this._scroll;
    this.playFly(dash);
    if (searchWasFocused) { const i = root.querySelector(".ad-search__input"); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
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
    if (!rows.length) return this.empty(list, "没有符合条件的会话", "试试别的筛选，或者点右上角重新扫描。");
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

  num(parent, value, label, cls) {
    const box = parent.createDiv({ cls: `ad-num ${cls || ""}` });
    box.createDiv({ cls: "ad-num__v", text: value });
    box.createDiv({ cls: "ad-num__l", text: label });
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
    const handoff = id === "codex" || id === "workbuddy";
    card.setAttr("data-drop-hint", handoff ? `交给 ${a.short}：复制任务并打开客户端` : `委派给 ${a.short}`);
    card.addEventListener("dragover", (e) => {
      if (!p.acceptsItemDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      card.addClass("is-drop");
    });
    card.addEventListener("dragleave", (e) => { if (!card.contains(e.relatedTarget)) card.removeClass("is-drop"); });
    card.addEventListener("drop", (e) => {
      if (!p.acceptsItemDrag(e)) return;
      e.preventDefault();
      card.removeClass("is-drop");
      p.delegateDrop(id, p.readItemDrag(e));
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
      setLucide(row.createSpan({ cls: "ad-handoff__icon ad-spin" }), "loader-circle");
      row.createSpan({ cls: "ad-handoff__text", text: `等你在 ${a.short} 里发出：${truncate(job.name, 18)}` });
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
      e.dataTransfer.effectAllowed = "copyLink";
      card.addClass("is-dragging");
      document.body.classList.add("ad-dragging-session");
    });
    card.addEventListener("dragend", () => { card.removeClass("is-dragging"); document.body.classList.remove("ad-dragging-session"); });
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
      const sic = chip.createSpan({ cls: "ad-state__icon" + (st.cls === "is-live" ? " ad-spin" : "") });
      stateIcon(sic, s.state);
      chip.createSpan({ text: st.label });
    }
    if (s.sideChats) {
      const sc = titleRow.createSpan({ cls: "ad-side" });
      setLucide(sc.createSpan({ cls: "ad-side__icon" }), "message-square");
      sc.createSpan({ text: s.sideChats > 1 ? `side chat ×${s.sideChats}` : "side chat" });
      sc.title = "这个会话正开着 side chat" + (s.sideSince ? `（${timeAgo(s.sideSince)}开的）` : "");
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
    const go = card.createEl("button", { cls: "ad-arrow", attr: { "aria-label": "打开会话" } });
    setLucide(go.createSpan({ cls: "ad-arrow__icon" }), "arrow-up-right");
    const open = () => p.openSession(s.agent, s.sid, s.app, s);
    go.onclick = (e) => { e.stopPropagation(); open(); };
    card.onclick = open;
    card.title = "点击打开会话 · 拖到笔记里的一项上绑定，拖到空行上新建一项";
    if (s.agent === "dsh") card.title += "\nDeepSeek Harness 当前只提供 dsh://open（聚焦客户端），会话号会复制到剪贴板";
    if (s.agent === "claude" && s.app === "cli") card.title += "\n终端里的 Claude Code：会尝试在 Claude 桌面版打开，也可在设置里改成终端";
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
    e.createDiv({ cls: "ad-empty__sub", text: sub });
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
