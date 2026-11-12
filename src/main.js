// Agent Deck — Obsidian plugin entry.
//
// Extracted from Nautilus Spiral's human–agent tracking, then extended with a
// second primary agent, DeepSeek Harness sessions, deeplinks, inline delegation
// and a layered model picker.

import fs from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import {
  Plugin, Notice, MarkdownView, MarkdownRenderChild, Menu, editorInfoField,
} from "obsidian";
import {
  AGENTS, AGENT_ORDER, MODEL_CATALOG, DEFAULTS, deepMerge, dayKey, dayKeyToday, fmtMin, fmtTok, fmtClock, timeAgo, truncate, clamp,
} from "./constants.js";
import { AgentUsage, UsageStore, projectName } from "./readers.js";
import { Delegator, blockAt, openSession as openSessionRaw, openExternal as openExternalRaw, findClaudeBinary, findDshBinary, findLink, sessionDeepLink, openAgentApp, isCliSession, isCodexDesktop } from "./delegation.js";
import { AgentDeckView, VIEW_TYPE } from "./view.js";
import { AgentDeckSettingsTab } from "./settings.js";
import { DelegateOptionsModal, ConfirmSendModal } from "./dialog.js";
import { agentIcon } from "./icons.js";
import { createEditorExtension, dispatchRefresh, ITEM_MIME } from "./editor.js";
import { MenuBarBridge } from "./menubar.js";
import { renderAIRecords } from "./record-display.js";
import { AutoLog } from "./autolog.js";
import { JournalSync } from "./sync.js";
import * as J from "./journal.js";

const fsp = fs.promises;
const home = () => os.homedir();
// 螺旋日程画进度行的那些行（照抄它的 AGENT_LINE_RE）
const NAUTILUS_LINE_RE = /^\s*(?:[-*+]|\d+[.)])\s+(?:\*\*\d{1,2}[:：]\d{2}\*\*\s*)?(?:\[\/\]\s|(?:DOING|NOW|IN-PROGRESS|TOREVIEW|HITLIMIT|NEEDOK|QUEUED|ERRORED|DELEGATED)(?=\s|$))/;

export default class AgentDeckPlugin extends Plugin {
  async onload() {
    const data = await this.loadData();
    this.settings = deepMerge(DEFAULTS, data || {});
    if (!Array.isArray(this.settings.primaryAgents)) this.settings.primaryAgents = this.settings.aiPrimary ? [this.settings.aiPrimary] : ["claude"];
    this.settings.primaryAgents = this.settings.primaryAgents.filter((x) => AGENTS[x]).slice(0, 2);
    if (!this.settings.primaryAgents.length) this.settings.primaryAgents = ["claude"];
    this.settings.jobs = this.settings.jobs && typeof this.settings.jobs === "object" ? this.settings.jobs : {};
    J.setDayOffset((Number.isFinite(this.settings.dayCutoff) ? this.settings.dayCutoff : 8) * 60);
    this.jobs = this.settings.jobs;
    this.views = new Set();
    this._lineMaps = {};
    this.vaultPath = this.app.vault.adapter.getBasePath ? this.app.vault.adapter.getBasePath() : "";
    this.manifestDir = this.manifest.dir || `.obsidian/plugins/${this.manifest.id}`;
    this.pluginDir = path.join(this.vaultPath, this.manifestDir);
    this.usageFile = path.join(this.pluginDir, "usage.json");

    this.store = new UsageStore(this, this.settings);
    await this.store.load(this.usageFile);
    this.usage = new AgentUsage({ cfg: this.settings, settings: this.settings });
    this.editorInfoField = editorInfoField;
    this.delegator = new Delegator(this);
    this.menubar = new MenuBarBridge(this);
    this.autoLog = new AutoLog(this);
    this.journalSync = new JournalSync(this);

    this.registerView(VIEW_TYPE, (leaf) => new AgentDeckView(leaf, this));
    this.settingTab = new AgentDeckSettingsTab(this.app, this);
    this.addSettingTab(this.settingTab);
    this.registerEditorExtension(createEditorExtension(this));
    this.registerMarkdownPostProcessor((el, ctx) => {
      const child = new MarkdownRenderChild(el);
      child.onunload = renderAIRecords(el, this);
      ctx.addChild(child);
    });

    this.setupRibbon();

    this.addCommand({ id: "open-dashboard", name: "打开 Agent Deck 面板", callback: () => this.activateView() });
    this.addCommand({
      id: "open-menubar-panel",
      name: "打开 macOS 菜单栏面板",
      callback: async () => {
        if (this.settings.showMenuBar === false) return this.notice("macOS 菜单栏已关闭，请先在「追踪」里打开");
        await this.menubar.start();
        const started = Date.now();
        const wait = setInterval(() => {
          if (this.menubar.isAlive() || Date.now() - started > 15000) {
            clearInterval(wait);
            this.menubar.show();
          }
        }, 300);
      },
    });
    this.addCommand({ id: "open-settings", name: "打开 Agent Deck 设置", callback: () => this.openSettings() });
    this.addCommand({ id: "open-models", name: "打开 Agent Deck 的 Models 设置", callback: () => this.openSettings("models") });
    // 委派只有两个入口：笔记里人写的一项拖到面板的 Agent 卡片上，或者块去向的「委派给 Claude」（⌥⌘D）。
    // Agent Deck 不再在命令面板里放委派命令；委派失败后状态 pill 上的「重试」还在
    this.addCommand({ id: "open-session-line", name: "打开光标这一行绑定的会话", editorCallback: (editor, view) => this.openSessionForEditor(editor, view) });
    this.addCommand({ id: "merge-task-line", name: "把当前任务条目与笔记里另一条绑定/合并", editorCallback: (editor, view) => this.openMergeTaskForEditor(editor, view) });
    this.addCommand({ id: "scan-now", name: "重新扫描本机 Agent 会话", callback: () => this.scanNow(true) });
    this.addCommand({ id: "log-journal", name: "整理 Agent 会话进今天的日记", callback: () => this.autoLog.logNow() });
    this.addCommand({ id: "import-nautilus", name: "导入螺旋日程的历史用量", callback: () => this.importNautilus(true) });
    this.addCommand({ id: "clean-jobs", name: "清理已结束的委派记录", callback: () => this.cleanJobs() });

    this.registerObsidianProtocolHandler("agent-deck", async (params) => {
      if (params && params.do === "scan") return this.scanNow(true);
      if (params && params.do === "log") return this.autoLog.logNow();
      // 菜单栏里点命令行会话：交回插件，在终端里接着聊
      if (params && params.do === "open" && params.sid) { const m = this.usage.meta.get(params.sid) || {}; return this.openSession(params.agent || m.agent || "claude", params.sid, m.app || params.app || "", m); }
      if (params && params.do === "hide") {
        this.settings.showMenuBar = false;
        await this.saveSettings();
        this.menubar?.stop();
        this.settingTab?.mbSwitch?.setOn(false);
        this.notice("已隐藏 macOS 菜单栏；可在 Agent Deck → 追踪 里重新打开", 8000);
        return;
      }
      return this.activateView();
    });

    this.app.workspace.onLayoutReady(async () => {
      if (this.settings.openDashboardOnStartup) this.activateView();
      if (this.settings.showMenuBar !== false) this.menubar.start().catch((e) => console.error("[agent-deck] menubar", e));
      if (this.settings.menuBarHideNautilus !== false) setTimeout(() => this.hideNautilusAgentBar().catch(() => {}), 2500);
      this.scheduleScan();
      this.registerInterval(window.setInterval(() => this.autoLog.tick(), 60 * 1000));
      setTimeout(() => this.scanNow(false), 1200);
      if (this.settings.importNautilus !== false && !this.store.imported?.nautilus) {
        setTimeout(() => this.importNautilus(false).catch(() => {}), 3500);
      }
      setTimeout(() => this.recoverJobs(), 4000);
    });
  }

  onunload() {
    if (this.store?.dirty) { clearTimeout(this.store.saveTimer); this.store.save().catch(() => {}); }
    clearInterval(this._scanTimer);
    clearTimeout(this._refreshTimer);
    this.menubar?.stop();
    for (const runner of this.delegator?.runners?.values?.() || []) {
      try { if (runner.constructor && runner.constructor.name === "DshRunner") runner.cancel(); } catch { /* already gone */ }
    }
    // 面板不在这里 detach：固定在侧栏的位置要留着，重载 / 更新插件后原地回来
    try { this.ribbonEl?.remove(); } catch { /* gone */ }
  }

  // ---------- setup ----------
  setupRibbon() {
    if (this.ribbonEl) { this.ribbonEl.remove(); this.ribbonEl = null; }
    if (this.settings.showRibbonIcon === false) return;
    this.ribbonEl = this.addRibbonIcon("gauge", "Agent Deck", () => this.activateView());
  }

  applyUiSettings() {
    this.setupRibbon();
    if (this.settings.showMenuBar !== false) this.menubar?.start().catch((e) => console.error("[agent-deck] menubar", e));
    else this.menubar?.stop();
    this.refreshUI();
  }

  async activateView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  openSettings(tab) {
    try {
      if (tab && this.settingTab) this.settingTab.tab = tab;
      this.app.setting.open();
      this.app.setting.openTabById(this.manifest.id);
      if (tab && this.settingTab) setTimeout(() => { try { this.settingTab.display(); } catch { /* not open yet */ } }, 120);
    } catch (e) { console.error("[agent-deck] open settings", e); }
  }

  // ---------- scan ----------
  scheduleScan() {
    clearInterval(this._scanTimer);
    const sec = clamp(Number(this.settings.pollSeconds) || 20, 5, 300);
    this._scanTimer = setInterval(() => this.scanNow(false), sec * 1000);
  }

  async scanNow(force = false) {
    if (this._scanning) return;
    this._scanning = true;
    try {
      if (force) {
        this.usage.files.clear();
        this.usage.meta.clear();
        this.usage.titles.clear();
        this.usage.lastScan = 0;
      }
      const since = force ? 0 : Math.max(0, (this.usage.lastScan || 0) - 60000);
      const touched = await this.usage.scan({ since });
      this.store.cfg = this.settings;
      this.store.merge(touched, this.usage);
      this.store.prune();
      this.delegator.resolveHandoffs(this.usage);
      this.refreshUI();
      this.journalSync.run().catch((e) => console.error("[agent-deck] journal sync", e));
      if (force) new Notice(`Agent Deck：读到 ${this.usage.files.size} 个日志，${touched.size} 天有内容`, 4000);
    } catch (e) {
      console.error("[agent-deck] scan", e);
      this.notice("扫描会话失败：" + (e && e.message || e), 8000);
    } finally {
      this._scanning = false;
    }
  }

  async rebuildUsage() {
    this.store.days = {};
    this.store.imported = {};
    this.usage.files.clear();
    this.usage.meta.clear();
    this.usage.titles.clear();
    await this.store.save();
    await this.scanNow(true);
    new Notice("Agent Deck：历史已重算");
  }

  async importNautilus(manual = false) {
    const dir = path.join(this.vaultPath, ".obsidian/plugins/nautilus-spiral");
    let raw;
    try { raw = await fsp.readFile(path.join(dir, "ai-usage.json"), "utf8"); } catch { if (manual) new Notice("没有找到螺旋日程的 ai-usage.json"); return; }
    let src;
    try { src = JSON.parse(raw); } catch { if (manual) new Notice("螺旋日程的 ai-usage.json 解析失败"); return; }
    const days = src.days || {};
    let added = 0;
    for (const [key, day] of Object.entries(days)) {
      if (!day || typeof day !== "object") continue;
      if (this.store.days[key]) continue;
      this.store.days[key] = {
        ...day,
        by: day.by || (day.wall != null ? { claude: { wall: day.wall, agent: day.agent, out: day.out, segs: day.segs } } : {}),
        list: (day.list || []).map((x) => ({ ...x, agent: x.agent || "claude" })),
        imported: "nautilus",
      };
      added++;
    }
    this.store.imported = { ...(this.store.imported || {}), nautilus: Date.now() };
    await this.store.save();
    if (manual || added) new Notice(`Agent Deck：从螺旋日程导入 ${added} 天历史`);
    this.refreshUI();
  }

  recoverJobs() {
    for (const job of Object.values(this.jobs)) {
      if (job.state === "done" && job.linkWritten && !job.resultWritten) {
        this.delegator.writeResult(job).catch((e) => console.error("[agent-deck] recover result", e));
        continue;
      }
      if (!["starting", "running", "needs-approval"].includes(job.state)) continue;
      if (job.handoff) continue;   // 交接中的任务不归插件进程管，扫描时照样认领
      if (this.delegator.runners.has(job.id)) continue;
      const meta = job.sessionId ? this.usage.meta.get(job.sessionId) : null;
      if (meta && meta.lastAt) {
        job.state = meta.state === "run" ? "running" : (meta.state === "error" ? "error" : "done");
        job.step = meta.step || job.step || "";
        job.tokens = (meta.out || 0) + (meta.fresh || 0);
        this.saveJobs();
        if (job.state === "done") this.delegator.writeResult(job).catch(() => {});
      } else if (Date.now() - (job.startedAt || 0) > 60000) {
        job.state = "error";
        job.error = "插件重载后没有接上这个会话";
        job.endedAt = Date.now();
        this.saveJobs();
      }
    }
    this.refreshUI();
  }

  cleanJobs() {
    const cutoff = Date.now() - 7 * 86400000;
    for (const [id, job] of Object.entries(this.jobs)) if (job.endedAt && job.endedAt < cutoff) delete this.jobs[id];
    this.saveSettings();
    this.refreshUI();
  }

  // ---------- settings ----------
  async saveSettings() {
    this.settings.jobs = this.jobs;
    J.setDayOffset((Number.isFinite(this.settings.dayCutoff) ? this.settings.dayCutoff : 8) * 60);
    await this.saveData(this.settings);
  }

  saveJobs() {
    this.settings.jobs = this.jobs;
    this.saveSettings().catch(() => {});
  }

  // ---------- model helpers ----------
  allModels(custom) {
    const list = [...MODEL_CATALOG, ...(custom || this.settings.models.custom || [])];
    const seen = new Set();
    const out = [];
    for (const m of list) if (m && m.id && !seen.has(m.id)) { seen.add(m.id); out.push(m); }
    const order = this.settings.models.order || [];
    out.sort((a, b) => {
      const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
      if (ia < 0 && ib < 0) return 0;
      if (ia < 0) return 1;
      if (ib < 0) return -1;
      return ia - ib;
    });
    return out;
  }

  modelsFor(agent) { return this.allModels().filter((m) => m.agent === agent); }
  modelById(id) { return this.allModels().find((m) => m.id === id) || null; }
  modelEnabled(id) { return (this.settings.models.enabled || []).includes(id); }
  modelLabel(id) { const m = this.modelById(id); return m ? m.name : (id || ""); }

  primaryAgents() { return (this.settings.primaryAgents || []).filter((x) => AGENTS[x]).slice(0, 2); }
  isPrimary(agent) { return this.primaryAgents().includes(agent); }
  agentEnabled(agent) { return this.isPrimary(agent) || (this.settings.agents || {})[agent] !== false; }
  defaultTarget() { return ["claude", "codex", "dsh"].includes(this.settings.delegate?.target) ? this.settings.delegate.target : "claude"; }
  defaultModel(agent) {
    return this.settings.delegate?.[agent]?.model || this.settings.models?.defaultByAgent?.[agent] || DEFAULTS.models.defaultByAgent[agent] || "";
  }

  async togglePrimary(agent) {
    if (!AGENTS[agent]) return;
    const list = this.primaryAgents();
    const i = list.indexOf(agent);
    if (i >= 0) list.splice(i, 1);
    else {
      list.push(agent);
      if (list.length > 2) list.shift();
    }
    this.settings.primaryAgents = list.length ? list : [agent];
    (this.settings.agents ||= {})[agent] = true;
    await this.saveSettings();
    this.scanNow(true);
    this.refreshUI();
    new Notice(`Agent Deck 主力：${this.settings.primaryAgents.map((x) => AGENTS[x].short).join(" + ")}`);
  }

  async setAgentEnabled(agent, on) {
    if (this.isPrimary(agent) && !on) { new Notice("主力 Agent 不能关掉；先把主力换掉"); return; }
    (this.settings.agents ||= {})[agent] = !!on;
    await this.saveSettings();
    this.scanNow(true);
    this.refreshUI();
  }

  // ---------- sessions ----------
  liveSessions({ hours = 24 } = {}) {
    const since = Date.now() - hours * 3600e3;
    const list = this.usage.liveSessions({ since, limit: 100 }).filter((x) => this.agentEnabled(x.agent));
    const seen = new Set(list.map((x) => x.sid));
    for (const job of Object.values(this.jobs)) {
      if (!["running", "needs-approval"].includes(job.state)) continue;
      if (!job.sessionId || seen.has(job.sessionId)) continue;
      if (this.usage.hidden(job.sessionId)) continue;
      const sid = job.sessionId;
      list.push({
        sid, agent: job.agent, title: job.name, text: job.blockText, cwd: job.cwd || this.vaultPath,
        app: "", state: job.state === "needs-approval" ? "needs-approval" : "run", step: job.step || "正在启动会话…",
        lastAt: job.endedAt || job.startedAt, tokens: job.tokens || 0, job, model: job.model,
      });
      seen.add(sid);
    }
    return list.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
  }

  recentSessions({ days = 7, limit = 100 } = {}) {
    const since = Date.now() - days * 86400000;
    const list = this.usage.sessions({ since, limit: 200 }).filter((x) => this.agentEnabled(x.agent));
    const bySid = new Map(list.map((x) => [x.sid, x]));
    for (const job of Object.values(this.jobs)) {
      const sid = job.sessionId || job.id;
      if (!this.agentEnabled(job.agent)) continue;
      // 归档了的会话不回到列表里；交接还没认领到会话的不算会话
      if (job.sessionId && this.usage.hidden(job.sessionId)) { bySid.delete(sid); continue; }
      if (job.handoff && !job.sessionId) continue;
      const cur = bySid.get(sid);
      if (job.state === "bound") { if (cur) bySid.set(sid, { ...cur, job }); continue; }
      const row = {
        ...(cur || {}), sid, agent: job.agent, title: job.name || (cur && cur.title) || "",
        text: (cur && cur.text) || job.blockText || "", cwd: job.cwd || (cur && cur.cwd) || this.vaultPath,
        app: (cur && cur.app) || "", state: job.state === "starting" || job.state === "running" ? "run" : job.state,
        step: job.step || (cur && cur.step) || "", lastAt: job.endedAt || job.startedAt || (cur && cur.lastAt) || 0,
        tokens: job.tokens || (cur && cur.tokens) || 0, job, model: job.model || (cur && cur.model) || "",
        error: job.error, result: job.result,
      };
      bySid.set(sid, row);
    }
    const out = [...bySid.values()].filter((x) => (x.lastAt || 0) >= since);
    return out.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0)).slice(0, limit);
  }

  openSession(agent, sid, app, session) {
    return openSessionRaw(this, agent, sid, app, session);
  }

  // 给别的插件用（螺旋日程的进度行）：只给会话号，按 Agent Deck 的规矩打开——命令行会话切到它的终端标签
  openSessionBySid(sid, agent = "") {
    const m = (sid && this.usage.meta.get(sid)) || {};
    return this.openSession(m.agent || agent || "claude", sid, m.app || "", m);
  }

  // 螺旋日程在这一行下面画了进度行（它开着「任务行下面的进度条」和 AI 追踪），这一行就不再画 pill、🔗 链接也不可点，
  // 免得同一个会话有三个入口
  nautilusOwnsLine(text) {
    const n = this.app.plugins && this.app.plugins.plugins && this.app.plugins.plugins["nautilus-spiral"];
    if (!n || !n.settings || this.settings.yieldToNautilus === false) return false;
    if (n.settings.lineProgress === false || n.settings.showAi === false) return false;
    return NAUTILUS_LINE_RE.test(text);
  }

  openJob(jobId, sid) {
    const job = jobId ? this.jobs[jobId] : null;
    const sessionId = (job && job.sessionId) || sid;
    if (!sessionId) { this.notice("会话还没有会话号，稍等一秒再点"); return; }
    const meta = this.usage.meta.get(sessionId) || null;
    const agent = job ? job.agent : (meta && meta.agent) || "claude";
    return openSessionRaw(this, agent, sessionId, (job && job.app) || (meta && meta.app) || "", meta);
  }

  sessionProgressText(session, job) {
    const sid = (session && session.sid) || (job && job.sessionId) || "";
    const meta = (sid && this.usage.meta.get(sid)) || session || {};
    const agent = (session && session.agent) || (job && job.agent) || meta.agent || "claude";
    if (agent === "claude") {
      const todo = (session && session.todo) || meta.todo;
      if (todo && todo.total > 0) {
        return `${todo.done}/${todo.total}${todo.cur ? " · " + truncate(todo.cur, 20) : ""}`;
      }
    }
    const turns = (session && session.turns) || meta.turns || 0;
    if (turns > 0) return `第 ${turns} 轮`;
    return "";
  }

  jobProgress(job, session) {
    const sid = (job && job.sessionId) || (session && session.sid) || "";
    if (!sid) return null;
    const meta = this.usage.meta.get(sid) || session;
    const agent = (job && job.agent) || (session && session.agent) || (meta && meta.agent) || "claude";
    if (agent !== "claude") return null;
    const todo = meta && meta.todo;
    return todo && todo.total ? { done: todo.done, total: todo.total, cur: todo.cur || "" } : null;
  }

  pillTitle(info) {
    if (!info) return "";
    if (info.kind === "idle") return "";
    const job = info.job, s = info.session;
    const parts = [];
    if (job) { parts.push(`${AGENTS[job.agent]?.name || job.agent} · ${job.name}`); if (job.step) parts.push(job.step); if (job.error) parts.push(job.error); }
    const prog = this.sessionProgressText(s, job);
    if (prog) parts.push(`进度：${prog}`);
    if (s) { parts.push(s.title || s.step || s.sid); if (s.tokens) parts.push(`${fmtTok(s.tokens)} tok`); }
    return parts.filter(Boolean).join("\n");
  }

  // ---------- note line map ----------
  lineMap(path, doc) {
    const cached = this._lineMaps[path];
    if (cached && cached.doc === doc) return cached.map;
    const lines = doc.toString().split("\n");
    const sessionByParent = new Map();
    const linkByLine = new Map();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!/^\s*[-*+]\s+🔗/.test(line)) continue;
      const indent = (line.match(/^[ \t]*/) || [""])[0].length;
      let parent = -1;
      for (let j = i - 1; j >= 0; j--) {
        if (!lines[j].trim()) continue;
        const ind = (lines[j].match(/^[ \t]*/) || [""])[0].length;
        if (ind < indent) { if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[j])) parent = j; break; }
      }
      if (parent < 0) continue;
      const parsed = parseLinkLine(line);
      if (!parsed.sid) continue;
      const meta = this.usage.meta.get(parsed.sid) || { sid: parsed.sid, agent: parsed.agent, state: "idle", title: "", tokens: 0, lastAt: 0 };
      const live = this.usage.liveSessions({ since: Date.now() - 86400000, limit: 200 }).find((x) => x.sid === parsed.sid);
      const job = Object.values(this.jobs).find((j) => j.sessionId === parsed.sid);
      const session = { ...meta, ...(live || {}), agent: parsed.agent || meta.agent, job };
      linkByLine.set(i, { ...parsed, parent });
      sessionByParent.set(parent, session);
    }
    const daySt = (this.settings.autoLogState && this.settings.autoLogState[dayKeyToday(this.settings)]) || {};
    const byBlockId = new Map();
    for (const [sid, rec] of Object.entries(daySt)) {
      if (rec && rec.blockId && !rec.skip && !rec.gone) byBlockId.set(rec.blockId, sid);
    }
    if (byBlockId.size) {
      for (let i = 0; i < lines.length; i++) {
        if (sessionByParent.has(i)) continue;
        const bid = J.blockIdOf(lines[i]);
        const sid = bid && byBlockId.get(bid);
        if (!sid) continue;
        const meta = this.usage.meta.get(sid);
        if (!meta) continue;
        const live = this.usage.liveSessions({ since: Date.now() - 86400000, limit: 200 }).find((x) => x.sid === sid);
        sessionByParent.set(i, { ...meta, ...(live || {}), sid, agent: meta.agent || "claude" });
      }
    }
    const map = { doc, lines, sessionByParent, linkByLine };
    this._lineMaps[path] = { doc, map };
    return map;
  }

  jobAtLine(path, line, text) {
    const jobs = Object.values(this.jobs).filter((j) => j.path === path);
    const bid = J.blockIdOf(text);
    let best = null;
    for (const j of jobs) {
      if ((bid && j.blockId === bid) || j.lineText === text || (j.line === line && j.lineText === text)) best = j;
    }
    return best;
  }

  // ---------- drag and drop ----------
  // 一个会话绑到了日记里（拖拽、委派、归档收尾）：告诉自动记日记别再替它新写一行
  markBound(sid, blockId = "", key = "") {
    if (!sid) return;
    const day = dayKeyToday(this.settings);
    const st = ((this.settings.autoLogState ||= {})[day] ||= {});
    const prev = st[sid] || {};
    st[sid] = {
      ...prev,
      skip: true,
      bound: true,
      ...(blockId ? { blockId } : {}),
      ...(key ? { key } : {}),
    };
    this.saveSettings().catch(() => {});
  }

  // 编辑器里找打开着这篇笔记的那个 MarkdownView（不一定是当前激活的：拖拽时焦点常在面板上）
  viewForPath(path) {
    let found = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      const v = leaf.view;
      if (!found && v instanceof MarkdownView && v.file && v.file.path === path && v.editor) found = v;
    });
    return found;
  }

  // 面板里的会话卡片拖到了笔记第 line 行上
  bindSessionAt(cm, line, data, { below = false } = {}) {
    let view = null;
    this.app.workspace.iterateAllLeaves((leaf) => { const v = leaf.view; if (!view && v instanceof MarkdownView && v.editor && v.editor.cm === cm) view = v; });
    if (!view || !data || !data.sid) return;
    const sid = data.sid;
    const meta = this.usage.meta.get(sid) || {};
    const live = this.liveSessions({ hours: 24 }).find((x) => x.sid === sid);
    const day = dayKeyToday(this.settings);
    const rec = ((this.settings.autoLogState || {})[day] || {})[sid];
    const daySess = ((this.usage.summary(day) || {}).list || []).find((x) => x.sid === sid);
    const first = daySess && daySess.segs && daySess.segs.length ? daySess.segs[0][0] : null;
    const now = new Date();
    const since = first != null ? J.clock(first) : fmtClock(now.getTime());
    const text = cm.state.doc.toString();
    const res = J.bindInto(text, line, {
      sid, agent: data.agent || meta.agent || "claude",
      title: data.title || meta.title || (meta.text || "").split(" / ")[0] || sid.slice(0, 8),
      state: (live && live.state) || meta.state || "idle", since,
      dropKey: rec && rec.created && rec.key ? rec.key : null,
      blockId: rec && rec.blockId ? rec.blockId : "",
    }, { below, ensureBlockId: true });
    if (res.error) return this.notice(res.error, 6000);
    const change = J.diffLines(text, res.text);
    if (change) view.editor.transaction({ changes: [change] });
    this.markBound(sid, res.blockId || "", res.line != null ? J.workKey(res.text.split("\n")[res.line] || "") : "");
    const a = AGENTS[data.agent] || AGENTS.claude;
    this.notice(res.kind === "bind" ? `🔗 已绑定（^${res.blockId || ""}）：${a.short} 会话的每轮 💬、❓、⏱ 和状态都会跟着这一项走` : `🔗 新建了一项并绑上 ${a.short} 会话`, 5000);
    setTimeout(() => this.journalSync.run({ force: true }).catch(() => {}), 300);
    this.refreshUI();
  }

  // 把笔记里的第 srcLine 条任务合并/绑定到第 dstLine 条任务上（不管是 🤖 自动记的还是人写的）
  mergeTaskLines(cmOrView, srcLine, dstLine, srcLineText = "") {
    let view = cmOrView instanceof MarkdownView ? cmOrView : null;
    if (!view) {
      this.app.workspace.iterateAllLeaves((leaf) => { const v = leaf.view; if (!view && v instanceof MarkdownView && v.editor && v.editor.cm === cmOrView) view = v; });
    }
    if (!view || !view.editor) return;
    const text = view.editor.getValue();
    const lines = text.split("\n");
    let sLine = srcLine;
    if (srcLineText && lines[sLine] !== srcLineText) {
      const idx = lines.indexOf(srcLineText);
      if (idx >= 0) sLine = idx;
    }
    const res = J.mergeTasks(text, sLine, dstLine);
    if (res.error) return this.notice(res.error, 6000);
    const change = J.diffLines(text, res.text);
    if (change) view.editor.transaction({ changes: [change] });
    for (const daySt of Object.values(this.settings.autoLogState || {})) {
      if (!daySt || typeof daySt !== "object") continue;
      for (const rec of Object.values(daySt)) {
        if (!rec || typeof rec !== "object") continue;
        if ((res.srcKey && rec.key === res.srcKey) || (res.srcBlockId && rec.blockId === res.srcBlockId) || (res.dstKey && rec.key === res.dstKey)) {
          rec.key = res.key;
          rec.label = res.body;
          rec.blockId = res.blockId;
          rec.created = false;
        }
      }
    }
    const afterLines = res.text.split("\n");
    for (const job of Object.values(this.jobs)) {
      if (view.file && job.path === view.file.path && (job.line === sLine || job.line === dstLine || (res.srcBlockId && job.blockId === res.srcBlockId))) {
        job.line = res.line;
        job.blockId = res.blockId;
        job.lineText = afterLines[res.line] || job.lineText;
      }
    }
    this.saveSettings().catch(() => {});
    this.notice(`🔗 已合并条目（^${res.blockId}）：会话记录与结论已归入「${truncate(res.body, 28)}」`, 5000);
    setTimeout(() => this.journalSync.run({ force: true }).catch(() => {}), 300);
    this.refreshUI();
  }

  openMergeTaskForEditor(editor, view, event = null) {
    if (!view || !view.file) return;
    const line = editor.getCursor().line;
    const lines = editor.getValue().split("\n");
    let taskLine = line;
    if (!J.kwLine(lines[taskLine])) {
      const owner = J.markOwner(lines, taskLine);
      if (owner >= 0 && J.kwLine(lines[owner])) taskLine = owner;
      else return this.notice("先把光标放在一条任务行上");
    }
    const candidates = J.taskItems(lines.join("\n")).filter((t) => t.line !== taskLine);
    if (!candidates.length) return this.notice("当前笔记里没有别的任务条目可合并");
    const menu = new Menu();
    for (const c of candidates.slice(0, 20)) {
      menu.addItem((mi) => {
        const tag = c.auto ? "🤖 " : "";
        mi.setTitle(`合并到：${tag}${truncate(c.body.replace(/^🤖\s*/, ""), 36)}${c.blockId ? ` (^${c.blockId})` : ""}`);
        mi.setIcon("git-merge");
        mi.onClick(() => this.mergeTaskLines(view, taskLine, c.line, lines[taskLine]));
      });
    }
    if (event) menu.showAtMouseEvent(event);
    else {
      const coords = editor.cm && editor.cm.coordsAtPos ? editor.cm.coordsAtPos(editor.posToOffset(editor.getCursor())) : null;
      if (coords) menu.showAtPosition({ x: coords.left, y: coords.bottom });
      else menu.showAtPosition({ x: window.innerWidth / 2, y: window.innerHeight / 3 });
    }
  }

  // 编辑器里开始拖一项（把手或选中的文字）：记下来源，拖到 Agent 卡片上时用
  noteDragItem(src) {
    const item = this._dragItem = { ...src, at: Date.now() };
    document.body.classList.add("ad-dragging-item");
    const off = (e) => {
      document.body.classList.remove("ad-dragging-item");
      document.removeEventListener("dragend", off, true);
      document.removeEventListener("drop", off, true);
      // drop 先于卡片自己的 drop 处理（捕获阶段），来源要留给它读；拖完（dragend）再清
      if (e && e.type === "dragend") setTimeout(() => { if (this._dragItem && this._dragItem.at === item.at) this._dragItem = null; }, 0);
    };
    document.addEventListener("dragend", off, true);
    document.addEventListener("drop", off, true);
  }

  acceptsItemDrag(e) {
    const types = e.dataTransfer ? [...e.dataTransfer.types] : [];
    if (types.includes(ITEM_MIME)) return true;
    return types.includes("text/plain") && this._dragItem && Date.now() - this._dragItem.at < 120000;
  }

  readItemDrag(e) {
    try { const raw = e.dataTransfer.getData(ITEM_MIME); if (raw) return JSON.parse(raw); } catch { /* fall back */ }
    return this._dragItem && Date.now() - this._dragItem.at < 120000 ? this._dragItem : null;
  }

  // 笔记里的一项拖到了某个 Agent 卡片上：Claude / DSH 后台直接跑，Codex / WorkBuddy 打开客户端交接
  // 这一项能不能委派：能就给出笔记、行和整块，不能就给出原因
  async delegateTarget(item) {
    if (!item || !item.path) return { error: "没认出拖的是哪一项" };
    const file = this.app.vault.getAbstractFileByPath(item.path);
    if (!file) return { error: "找不到这篇笔记" };
    const view = this.viewForPath(item.path);
    const lines = view ? view.editor.getValue().split("\n") : (await this.app.vault.read(file)).split("\n");
    let line = lines[item.line] === item.lineText ? item.line : lines.indexOf(item.lineText);
    if (line < 0) return { error: "这一行刚改过，重新来一次" };
    // 只有人写的文字条目才委派；Agent 写的（🤖）、已经绑着会话的，不再开新会话
    const block = blockAt(lines, line), k = J.kwLine(lines[line]);
    if (k && k.body.startsWith(J.AUTO_MARK.trim())) return { error: "Agent 记的条目不委派" };
    if (block && findLink(lines, block)) return { error: "已经绑着会话，不委派" };
    if (block && lines.slice(block.start + 1, block.end + 1).some((l) => J.CLOCK_RE.test(l))) return { error: "已有用时记录，不委派" };
    return { file, lines, line, block };
  }

  async delegateDrop(agent, item, fromEl, { cli = false } = {}) {
    this._dragItem = null;
    const t = await this.delegateTarget(item);
    if (t.error) return this.notice(t.error);
    const { file, lines, line } = t;
    try {
      const opts = { file, lines, line, agent };
      // 按住 ⌘ 松手：Claude Code / Codex 在终端里开交互式会话；不按：Claude Code / DeepSeek Harness 后台直接开跑
      // （Claude Code 答完一轮自动在桌面版打开，见设置「完成后自动在桌面版打开」）
      if (cli && (agent === "claude" || agent === "codex")) await this.delegator.handoffCli(opts);
      else if (agent === "claude" || agent === "dsh") await this.delegator.delegate(opts);
      else await this.delegator.handoff(opts);
    } catch (e) { this.notice(String(e.message || e), 8000); }
    this.refreshUI();
  }

  // 把手单击：先确认，再把这一项连同子块发给主力（委派的默认目标）；如果是 🤖 自动记的或已绑定的行，则打开合并菜单
  async gripSend(item) {
    const t = await this.delegateTarget(item);
    if (t.error) {
      const view = item && item.path ? this.viewForPath(item.path) : null;
      if (view && (t.error.includes("Agent 记的") || t.error.includes("已经绑着会话"))) {
        view.editor.setCursor({ line: item.line, ch: 0 });
        return this.openMergeTaskForEditor(view.editor, view);
      }
      return this.notice(t.error);
    }
    const agent = this.defaultTarget();
    const where = agent === "codex" ? "终端新会话 · 使用默认模型" : agent === "claude" && this.settings.delegate.claude.openDesktop === true ? "后台开跑 · 答完在桌面版打开" : "后台新会话";
    new ConfirmSendModal(this.app, { agent, text: t.block ? t.block.text : t.lines[t.line], path: item.path, where }, () => this.delegateDrop(agent, item, null, { cli: agent === "codex" })).open();
  }

  // 把手双击：在把手旁边列出开着的 Agent，选哪个就发给哪个，和拖到那张卡片上一样；同时提供「合并到已有条目」
  gripPick(item, e) {
    const main = this.defaultTarget();
    const menu = new Menu();
    for (const id of AGENT_ORDER.filter((x) => this.agentEnabled(x))) {
      menu.addItem((mi) => {
        mi.setTitle(AGENTS[id].name + (id === main ? " · 主力" : ""));
        mi.setIcon("bot");
        if (mi.iconEl) agentIcon(mi.iconEl, id);
        mi.onClick(() => this.delegateDrop(id, item));
      });
    }
    const view = item && item.path ? this.viewForPath(item.path) : null;
    if (view) {
      const candidates = J.taskItems(view.editor.getValue()).filter((c) => c.line !== item.line);
      if (candidates.length) {
        menu.addSeparator();
        for (const c of candidates.slice(0, 10)) {
          menu.addItem((mi) => {
            const tag = c.auto ? "🤖 " : "";
            mi.setTitle(`合并到：${tag}${truncate(c.body.replace(/^🤖\s*/, ""), 32)}`);
            mi.setIcon("git-merge");
            mi.onClick(() => this.mergeTaskLines(view, item.line, c.line, item.lineText));
          });
        }
      }
    }
    menu.showAtMouseEvent(e);
  }

  // 笔记里的一项拖到面板的会话卡片上：把这个会话绑给它（和卡片拖到条目上一样，不委派）
  async bindItemToSession(item, data) {
    this._dragItem = null;
    if (!item || !item.path || !data || !data.sid) return;
    const view = this.viewForPath(item.path);
    if (view) {
      const lines = view.editor.getValue().split("\n");
      const line = lines[item.line] === item.lineText ? item.line : lines.indexOf(item.lineText);
      if (line < 0) return this.notice("这一行刚改过，重新拖一次");
      return this.bindSessionAt(view.editor.cm, line, data);
    }
    this.notice("先把这篇笔记打开再拖");
  }

  // 委派出去的会话有了会话号（客户端里能打开了）：下一次画面板时，卡片从 Agents 飞进「现在」
  flyFromAgent(job) {
    if (!job || !job.sessionId) return;
    this._fly = { agent: job.agent, sid: job.sessionId, at: Date.now() };
    this.refreshUI();
  }

  openAgentApp(agent) {
    return openAgentApp(agent).then((ok) => { if (!ok) this.notice(`没打开 ${AGENTS[agent]?.name || agent}：本机好像没装`); });
  }

  // ---------- editor actions ----------
  async delegateAtLine(path, line) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) return this.notice("找不到这篇笔记");
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const lines = view && view.file && view.file.path === path ? view.editor.getValue().split("\n") : (await this.app.vault.read(file)).split("\n");
    await this.delegator.delegate({ file, lines, line, agent: this.defaultTarget() });
  }

  openDelegateModal(path, line) {
    new DelegateOptionsModal(this.app, this, path, line).open();
  }


  openSessionForEditor(editor, view) {
    if (!view || !view.file) return;
    const path = view.file.path, line = editor.getCursor().line;
    const map = this.lineMap(path, editor.cm.state.doc);
    let s = map.sessionByParent.get(line);
    if (!s) {
      const text = editor.getLine(line);
      const job = this.jobAtLine(path, line, text);
      if (job) return this.openJob(job.id);
    }
    if (!s) return this.notice("这一行下面没有 🔗 绑定");
    return this.openSession(s.agent, s.sid, s.app, s);
  }

  cancelJob(id) {
    if (!id) return;
    this.delegator.cancel(id);
    this.refreshUI();
  }

  // ---------- macOS menu bar ----------
  buildMenuBarState() {
    const cfg = this.settings;
    const today = this.store.get(dayKeyToday(cfg));
    const live = this.liveSessions({ hours: 6 });
    const recent = this.recentSessions({ days: 1, limit: 120 });
    const primaries = this.primaryAgents();
    const out = [];
    const seen = new Set();
    const add = (s, primary, isLive) => {
      if (!s || !s.sid || seen.has(s.sid)) return false;
      const agent = AGENTS[s.agent] ? s.agent : "claude";
      const a = AGENTS[agent];
      const state = isLive ? (s.state || "idle") : "recent";
      const kw = menuKeyword(state);
      const where = agent === "codex" ? "终端新会话 · 使用默认模型" : agent === "claude" ? (s.app === "cli" ? "终端" : "桌面版") : agent === "codex" ? (isCodexDesktop(s.app) ? "桌面版" : "CLI") : agent === "workbuddy" ? "桌面版" : agent === "antigravity" ? "IDE" : "Harness";
      const url = sessionDeepLink(agent, s.sid);
      const prog = this.sessionProgressText(s);
      const stepStr = [prog, s.step ? truncate(s.step, 30) : ""].filter(Boolean).join(" · ");
      seen.add(s.sid);
      out.push({
        id: `${agent}:${s.sid}`,
        agent, agentName: a.name, agentShort: a.short, color: a.color, glyph: a.glyph,
        title: (s.parentSid ? "↳ " : "") + truncate(s.title || (s.text || "").split(" / ")[0] || s.step || s.sid, 64),
        detail: `${a.short} ${where} · ${projectName(s.cwd)}${stepStr ? " · " + stepStr : ""}${s.sideChats ? " · side chat ×" + s.sideChats : ""} · ${timeAgo(s.lastAt)}`,
        project: projectName(s.cwd),
        step: stepStr ? truncate(stepStr, 42) : "",
        ago: timeAgo(s.lastAt),
        keyword: kw.id, keywordLabel: kw.zh,
        state, stateLabel: menuStateLabel(state), primary: !!primary,
        url: agent === "dsh" ? "dsh://open" : agent === "antigravity" ? "antigravity://" : isCliSession(agent, s.app) && cfg.cliOpen !== "desktop" ? `obsidian://agent-deck?do=open&agent=${agent}&sid=${encodeURIComponent(s.sid)}` : url,
        copy: (agent === "dsh" || agent === "antigravity") ? s.sid : (agent === "codex" ? `codex resume ${s.sid}` : ""),
        _at: s.lastAt || 0,
      });
      return true;
    };
    for (const agent of AGENT_ORDER) {
      if (!this.agentEnabled(agent)) continue;
      const primary = primaries.includes(agent);
      const limit = Math.max(1, Number(primary ? cfg.menuBarPrimaryLimit : cfg.menuBarOtherLimit) || (primary ? 8 : 3));
      let count = 0;
      if (primary) {
        const lives = live.filter((x) => x.agent === agent)
          .sort((a, b) => menuRank(a.state) - menuRank(b.state) || (b.lastAt || 0) - (a.lastAt || 0));
        for (const s of lives) if (add(s, true, true) && ++count >= limit) break;
        if (count < limit) {
          const cutoff = Date.now() - 6 * 3600e3;
          const recs = recent.filter((x) => x.agent === agent && (x.lastAt || 0) >= cutoff).sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
          for (const s of recs) if (add(s, true, false) && ++count >= limit) break;
        }
      } else {
        // Other agents only contribute running sessions, except WorkBuddy:
        // its waiting sessions are part of the daily loop and should be jumpable
        // from the menu bar too.
        const wbWaiting = (state) => agent === "workbuddy" && ["wait", "quiet", "needs-approval"].includes(state);
        const rows = [
          ...live.filter((x) => x.agent === agent && (x.state === "run" || wbWaiting(x.state))),
          ...recent.filter((x) => x.agent === agent && x.state === "run"),
        ].sort((a, b) => menuRank(a.state) - menuRank(b.state) || (b.lastAt || 0) - (a.lastAt || 0));
        for (const s of rows) if (add(s, false, true) && ++count >= limit) break;
      }
    }
    out.sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0) || menuRank(a.state) - menuRank(b.state) || (b._at || 0) - (a._at || 0));
    for (const row of out) delete row._at;
    const running = out.filter((x) => x.state === "run").length;
    const waiting = out.filter((x) => ["wait", "quiet", "needs-approval"].includes(x.state)).length;
    const short = running && waiting ? `${running} 跑 · ${waiting} 等` : running ? `${running} 在跑` : waiting ? `${waiting} 等你` : "空闲";
    const summary = [];
    if (today) summary.push(`今天 ${fmtMin(today.wall)} · ${fmtTok(today.out)} tok`);
    summary.push(`${running} 个在跑`);
    if (waiting) summary.push(`${waiting} 个等你`);
    const usage = today ? `今天 ${fmtMin(today.wall)} · ${fmtTok(today.out)} tok` : "今天还没有用量记录";
    // 面板页头的几项数字：今天的协作时长、产出、会话数，再加一项「比前 7 天有用量的日子平均多还是少」
    const stats = [];
    if (today) {
      stats.push({ label: "协作", value: fmtMin(today.wall) }, { label: "产出", value: `${fmtTok(today.out)} tok` }, { label: "会话", value: String(today.sessions || 0) });
      const prev = [];
      for (let i = 1; i <= 7; i++) { const d = this.store.get(dayKey(Date.now() - i * 864e5, cfg)); if (d && d.wall) prev.push(d.wall); }
      if (prev.length >= 3) {
        const pct = Math.round((today.wall / (prev.reduce((a, b) => a + b, 0) / prev.length) - 1) * 100);
        stats.push({ label: "较 7 日均", value: `${pct >= 0 ? "+" : ""}${pct}%` });
      }
    }
    const agents = AGENT_ORDER.filter((x) => this.agentEnabled(x)).map((x) => {
      const rows = live.filter((s) => s.agent === x);
      const mine = today && today.by && today.by[x];
      return {
        id: x, short: AGENTS[x].short, name: AGENTS[x].name, color: AGENTS[x].color, glyph: AGENTS[x].glyph,
        running: rows.filter((s) => s.state === "run").length,
        waiting: rows.filter((s) => ["wait", "quiet", "needs-approval"].includes(s.state)).length,
        primary: primaries.includes(x),
        today: mine && mine.wall ? fmtMin(mine.wall) : "",
      };
    });
    return {
      updatedAt: Date.now(), short, summary: summary.join(" · "), usage,
      hotkey: cfg.menuBarHotkey || "control+option+command+D",
      running, waiting, stats, agents, sessions: out,
    };
  }

  async restoreNautilusAgentBar() {
    const p = path.join(this.vaultPath, ".obsidian/plugins/nautilus-spiral/data.json");
    try {
      const data = JSON.parse(await fsp.readFile(p, "utf8"));
      if (data.agentStatus !== true) {
        data.agentStatus = true;
        await fsp.writeFile(p, JSON.stringify(data, null, 1), "utf8");
      }
    } catch { /* not installed */ }
    const naut = this.app.plugins && this.app.plugins.plugins && this.app.plugins.plugins["nautilus-spiral"];
    if (naut && naut.settings) {
      naut.settings.agentStatus = true;
      try { await naut.saveData?.(naut.settings); } catch { /* best-effort */ }
      try { naut.tickAgents?.(); } catch { /* best-effort */ }
    }
    this.notice("已恢复螺旋日程右下角的 Agent 汇总", 6000);
  }

  async hideNautilusAgentBar() {
    if (this.settings.menuBarHideNautilus === false) return;
    const p = path.join(this.vaultPath, ".obsidian/plugins/nautilus-spiral/data.json");
    let data = null;
    try { data = JSON.parse(await fsp.readFile(p, "utf8")); } catch { /* not installed */ }
    let changed = false;
    if (data && data.agentStatus !== false) {
      try { await fsp.copyFile(p, p + `.agent-deck-backup-${Date.now()}`); } catch { /* best-effort */ }
      data.agentStatus = false;
      try { await fsp.writeFile(p, JSON.stringify(data, null, 1), "utf8"); changed = true; } catch { /* keep going */ }
    }
    const naut = this.app.plugins && this.app.plugins.plugins && this.app.plugins.plugins["nautilus-spiral"];
    if (naut && naut.settings) {
      if (naut.settings.agentStatus !== false) changed = true;
      naut.settings.agentStatus = false;
      try { await naut.saveData?.(naut.settings); } catch { /* best-effort */ }
      try { naut.tickAgents?.(); } catch { /* the bar may not be built yet */ }
    }
    if (changed && !this.settings.menuBarMigrated) {
      this.settings.menuBarMigrated = true;
      await this.saveSettings();
      this.notice("已把右下角的 Agent 汇总移到 macOS 菜单栏；螺旋日程的 Agent 汇总也已关闭。", 9000);
    } else if (!this.settings.menuBarMigrated) {
      this.settings.menuBarMigrated = true;
      await this.saveSettings();
    }
  }

  // ---------- ui refresh ----------
  refreshUI() {
    clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => {
      for (const view of this.views) { try { view.render(); } catch (e) { console.error("[agent-deck] view", e); } }
      try { dispatchRefresh(this); } catch { /* no editors */ }
      this.menubar?.update();
    }, 120);
  }

  // ---------- misc ----------
  notice(msg, ms) { try { new Notice(msg, ms); } catch { console.log("[agent-deck]", msg); } }
  openExternal(url) { return openExternalRaw(url); }

  async readNote(path) {
    const view = this.viewForPath(path);
    if (view) return view.editor.getValue();
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) throw new Error("找不到笔记：" + path);
    return await this.app.vault.read(file);
  }

  async writeNote(path, text) {
    // 开着的笔记按行改一处，不整篇 setValue：光标、折叠、撤销记录都留着
    const view = this.viewForPath(path);
    if (view) {
      const change = J.diffLines(view.editor.getValue(), text);
      if (change) view.editor.transaction({ changes: [change] });
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) throw new Error("找不到笔记：" + path);
    await this.app.vault.process(file, () => text);
  }

  async checkBinary(kind) {
    const bin = kind === "codex" ? this.settings.delegate?.codex?.path || "codex" : kind === "dsh" ? findDshBinary(this.settings.delegate?.dsh?.path || "") : findClaudeBinary(this.settings.delegate?.claude?.path || "");
    return await new Promise((resolve) => {
      execFile(bin, ["--version"], { timeout: 10000, env: process.env }, (err, out, errOut) => {
        if (err) resolve(`${kind} 没找到或不能运行：${String(err.message || err)}\n${String(errOut || "").slice(0, 300)}`);
        else resolve(`${kind}：${String(out || "").trim()}`);
      });
    });
  }

  openTerminalAt(cwd, cmd) {
    const script = `tell application "Terminal"\nactivate\ndo script ${JSON.stringify(`cd ${JSON.stringify(cwd)} && ${cmd}`)}\nend tell`;
    try { execFile("/usr/bin/osascript", ["-e", script], () => {}); } catch (e) { this.notice(String(e.message || e)); }
  }

  async pauseNautilus() {
    const p = path.join(this.vaultPath, ".obsidian/plugins/nautilus-spiral/data.json");
    let data;
    try { data = JSON.parse(await fsp.readFile(p, "utf8")); }
    catch { this.notice("没有找到螺旋日程的 data.json"); return; }
    const backup = p + `.agent-deck-backup-${Date.now()}`;
    try { await fsp.copyFile(p, backup); } catch { /* backup best-effort */ }
    // 只关写日记的那几项；showAi / agentStatus / lineProgress 是螺旋自己的追踪展示，留着。
    data.autoLog = false;
    data.autoLogArchiveDone = false;
    data.agentKw = false;
    data.resultBack = false;
    try { await fsp.writeFile(p, JSON.stringify(data, null, 1), "utf8"); }
    catch (e) { this.notice("写入螺旋日程设置失败：" + (e && e.message || e)); return; }
    this.notice(`已停用螺旋日程的 AI 写入（原设置备份在 ${path.basename(backup)}）：自动记日记、状态写回、💬 和子块都不再写；它的 Agent 追踪展示照常。请在 Obsidian 设置里重新加载螺旋日程，或重启 Obsidian。`, 10000);
  }

  // 螺旋日程的「写日记」还开着的时候，不让 Agent Deck 也改日记：两套写法会打架。
  // 只看会写笔记的那几个开关；showAi / agentStatus / lineProgress 是它的追踪展示，留着不碍事。
  nautilusOwnsAi() {
    const n = this.app.plugins?.plugins?.["nautilus-spiral"];
    const s = n && n.settings;
    if (!s) return false;
    if (s.showAi === false) return false;
    return s.resultBack !== false || s.agentKw !== false || s.autoLog === true;
  }

  openPluginDir() {
    try {
      const { shell } = require("electron");
      if (shell && shell.openPath) return shell.openPath(this.pluginDir);
    } catch { /* fallback */ }
    openExternalRaw("file://" + this.pluginDir);
  }
}

function menuStateLabel(state) {
  return ({ run: "在跑", wait: "等你", quiet: "安静", "needs-approval": "等你允许", error: "出错", limit: "限额", recent: "最近", done: "完成", idle: "空闲" })[state] || "空闲";
}

// The menu bar speaks TODOseq's keyword language instead of a separate status
// vocabulary: DOING / WAITING / NEEDOK? / HITLIMIT! map onto the same colours
// the todo panel uses.
function menuKeyword(state) {
  return ({
    run: { id: "DOING", zh: "在跑" },
    wait: { id: "WAITING", zh: "等你" },
    quiet: { id: "PAUSED", zh: "安静" },
    "needs-approval": { id: "NEEDOK", zh: "等你" },
    error: { id: "ERRORED", zh: "出错" },
    limit: { id: "HITLIMIT", zh: "限额" },
    done: { id: "DONE", zh: "完成" },
    recent: { id: "LATER", zh: "最近" },
    idle: { id: "TODO", zh: "空闲" },
  })[state] || { id: "TODO", zh: "空闲" };
}

function menuRank(state) {
  return ({ run: 0, "needs-approval": 1, wait: 2, quiet: 3, error: 4, limit: 4, recent: 5, done: 6, idle: 7 })[state] ?? 7;
}

function parseLinkLine(line) {
  const parsed = J.parseLink(line);
  if (parsed && parsed.sid) return parsed;
  let agent = "claude";
  let sid = "";
  let m = /claude:\/\/resume\?session=([0-9a-f-]{20,})/i.exec(line);
  if (m) { sid = m[1]; agent = "claude"; }
  else if ((m = /workbuddy:\/\/chat\/([^\s)\]]+)/i.exec(line))) { sid = decodeURIComponent(m[1]); agent = "workbuddy"; }
  else if ((m = /codex:\/\/threads\/([0-9a-f-]{36})/i.exec(line))) { sid = m[1]; agent = "codex"; }
  else if ((m = /`(session-[0-9a-f-]{20,}|[0-9a-f]{8}-[0-9a-f-]{27})`/i.exec(line))) { sid = m[1]; agent = /antigravity/i.test(line) ? "antigravity" : /dsh|deepseek|harness/i.test(line) ? "dsh" : "claude"; }
  else if ((m = /`([0-9a-f]{8}-[0-9a-f-]{27})`/i.exec(line))) { sid = m[1]; agent = /antigravity/i.test(line) ? "antigravity" : "dsh"; }
  else if ((m = /codex\s+resume\s+([0-9a-f-]{20,})/i.exec(line))) { sid = m[1]; agent = "codex"; }
  if (/Antigravity/i.test(line)) agent = "antigravity";
  else if (/DeepSeek Harness|DSH/i.test(line) && !/claude:\/\//i.test(line)) agent = "dsh";
  return { agent, sid };
}
