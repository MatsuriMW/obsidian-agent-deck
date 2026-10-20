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
  Plugin, Notice, MarkdownView, Menu, setIcon, editorInfoField,
} from "obsidian";
import {
  PLUGIN_VERSION, AGENTS, AGENT_ORDER, DEFAULTS, MODEL_CATALOG, EFFORTS,
  deepMerge, dayKey, dayKeyToday, fmtKey, fmtMin, fmtTok, fmtClock, fmtDur,
  timeAgo, truncate, unionSegs, clamp,
} from "./constants.js";
import { AgentUsage, UsageStore, projectName } from "./readers.js";
import { Delegator, blockAt, blockTitle, openSession as openSessionRaw, openExternal as openExternalRaw, findClaudeBinary, findDshBinary, findLink, statusOf, sessionDeepLink, openAgentApp, isCliSession, isCodexDesktop } from "./delegation.js";
import { AgentDeckView, VIEW_TYPE } from "./view.js";
import { AgentDeckSettingsTab } from "./settings.js";
import { DelegateOptionsModal } from "./dialog.js";
import { createEditorExtension, dispatchRefresh, ITEM_MIME } from "./editor.js";
import { MenuBarBridge } from "./menubar.js";
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
      await this.store.save();
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
  defaultTarget() { return this.settings.delegate?.target === "dsh" ? "dsh" : "claude"; }
  defaultModel(agent) {
    if (agent === "dsh") return this.settings.delegate?.dsh?.model || this.settings.models?.defaultByAgent?.dsh || "deepseek-v4-pro";
    return this.settings.delegate?.claude?.model || this.settings.models?.defaultByAgent?.claude || "claude-sonnet-5";
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

  jobProgress(job) {
    if (!job || !job.sessionId) return null;
    const meta = this.usage.meta.get(job.sessionId);
    const todo = meta && meta.todo;
    return todo && todo.total ? { done: todo.done, total: todo.total } : null;
  }

  pillTitle(info) {
    if (!info) return "";
    if (info.kind === "idle") return "委派这一块；⌄ 选模型、强度、模式";
    const job = info.job, s = info.session;
    const parts = [];
    if (job) { parts.push(`${AGENTS[job.agent]?.name || job.agent} · ${job.name}`); if (job.step) parts.push(job.step); if (job.error) parts.push(job.error); }
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
    const parentByLine = new Map();
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
      parentByLine.set(i, parent);
      linkByLine.set(i, { ...parsed, parent });
      sessionByParent.set(parent, session);
    }
    const map = { doc, lines, sessionByParent, linkByLine, parentByLine };
    this._lineMaps[path] = { doc, map };
    return map;
  }

  jobAtLine(path, line, text) {
    const jobs = Object.values(this.jobs).filter((j) => j.path === path);
    let best = null;
    for (const j of jobs) {
      if (j.lineText === text || (j.line === line && j.lineText === text)) best = j;
    }
    return best;
  }

  // ---------- drag and drop ----------
  // 一个会话绑到了日记里（拖拽、委派、归档收尾）：告诉自动记日记别再替它新写一行
  markBound(sid) {
    if (!sid) return;
    const day = dayKeyToday(this.settings);
    const st = ((this.settings.autoLogState ||= {})[day] ||= {});
    if (st[sid] && st[sid].bound) return;
    st[sid] = { ...(st[sid] || {}), skip: true, bound: true };
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
    const since = first != null ? J.clock(first) : `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const text = cm.state.doc.toString();
    const res = J.bindInto(text, line, {
      sid, agent: data.agent || meta.agent || "claude",
      title: data.title || meta.title || (meta.text || "").split(" / ")[0] || sid.slice(0, 8),
      state: (live && live.state) || meta.state || "idle", since,
      dropKey: rec && rec.created && rec.key ? rec.key : null,
    }, { below });
    if (res.error) return this.notice(res.error, 6000);
    const change = J.diffLines(text, res.text);
    if (change) view.editor.transaction({ changes: [change] });
    this.markBound(sid);
    const a = AGENTS[data.agent] || AGENTS.claude;
    this.notice(res.kind === "bind" ? `🔗 已绑定：${a.short} 会话的状态、💬、⏱ 和归档都会跟着这一项走` : `🔗 新建了一项并绑上 ${a.short} 会话`, 5000);
    setTimeout(() => this.journalSync.run({ force: true }).catch(() => {}), 300);
    this.refreshUI();
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
  async delegateDrop(agent, item, fromEl, { cli = false } = {}) {
    this._dragItem = null;
    if (!item || !item.path) return this.notice("没认出拖的是哪一项；从列表项尾巴上的把手拖");
    const file = this.app.vault.getAbstractFileByPath(item.path);
    if (!file) return this.notice("找不到这篇笔记");
    const view = this.viewForPath(item.path);
    const lines = view ? view.editor.getValue().split("\n") : (await this.app.vault.read(file)).split("\n");
    let line = lines[item.line] === item.lineText ? item.line : lines.indexOf(item.lineText);
    if (line < 0) return this.notice("这一行刚改过，重新拖一次");
    // 只有人写的文字条目拖到 Agent 上才委派；Agent 写的（🤖）、已经绑着会话的，拖过来不再开新会话
    const block = blockAt(lines, line), k = J.kwLine(lines[line]);
    if (k && k.body.startsWith(J.AUTO_MARK.trim())) return this.notice("这一项是 Agent 记的，已经由机器追踪，不再委派");
    if (block && findLink(lines, block)) return this.notice("这一项已经绑着会话了，不再委派；要换会话，把会话卡片拖到它上面");
    if (block && lines.slice(block.start + 1, block.end + 1).some((l) => J.CLOCK_RE.test(l))) return this.notice("这一项已经有 Agent 的用时记录，不再委派");
    this._flyArmed = { agent, at: Date.now() };
    try {
      const opts = { file, lines, line, agent };
      // 按住 ⌘ 松手：Claude Code / Codex 在终端里开交互式会话，而不是后台跑 / 交给桌面版
      if (cli && (agent === "claude" || agent === "codex")) await this.delegator.handoffCli(opts);
      else if (agent === "claude" || agent === "dsh") await this.delegator.delegate(opts);
      else await this.delegator.handoff(opts);
    } catch (e) { this.notice(String(e.message || e), 8000); }
    this.refreshUI();
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
  activeEditor() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file) return null;
    return { view, editor: view.editor, file: view.file };
  }

  async delegateFromEditor(editor, agent) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file) return this.notice("先打开一篇笔记");
    const line = editor.getCursor().line;
    try {
      await this.delegator.delegate({ file: view.file, lines: editor.getValue().split("\n"), line, agent: agent || this.defaultTarget() });
    } catch (e) { this.notice(String(e.message || e), 8000); }
  }

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

  openModalFor(editor, view) {
    if (!view || !view.file) return this.notice("先打开一篇笔记");
    this.openDelegateModal(view.file.path, editor.getCursor().line);
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
      const where = agent === "claude" ? (s.app === "cli" ? "终端" : "桌面版") : agent === "codex" ? (isCodexDesktop(s.app) ? "桌面版" : "CLI") : agent === "workbuddy" ? "桌面版" : "Harness";
      const url = sessionDeepLink(agent, s.sid);
      seen.add(s.sid);
      out.push({
        id: `${agent}:${s.sid}`,
        agent, agentName: a.name, agentShort: a.short, color: a.color, glyph: a.glyph,
        title: (s.parentSid ? "↳ " : "") + truncate(s.title || (s.text || "").split(" / ")[0] || s.step || s.sid, 64),
        detail: `${a.short} ${where} · ${projectName(s.cwd)}${s.step ? " · " + truncate(s.step, 32) : ""}${s.sideChats ? " · side chat ×" + s.sideChats : ""} · ${timeAgo(s.lastAt)}`,
        project: projectName(s.cwd),
        step: s.step ? truncate(s.step, 40) : "",
        ago: timeAgo(s.lastAt),
        keyword: kw.id, keywordLabel: kw.zh,
        state, stateLabel: menuStateLabel(state), primary: !!primary,
        url: agent === "dsh" ? "dsh://open" : isCliSession(agent, s.app) && cfg.cliOpen !== "desktop" ? `obsidian://agent-deck?do=open&agent=${agent}&sid=${encodeURIComponent(s.sid)}` : url,
        copy: agent === "dsh" ? s.sid : (agent === "codex" ? `codex resume ${s.sid}` : ""),
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
    const agents = AGENT_ORDER.filter((x) => this.agentEnabled(x)).map((x) => {
      const rows = live.filter((s) => s.agent === x);
      return {
        id: x, short: AGENTS[x].short, name: AGENTS[x].name, color: AGENTS[x].color, glyph: AGENTS[x].glyph,
        running: rows.filter((s) => s.state === "run").length,
        waiting: rows.filter((s) => ["wait", "quiet", "needs-approval"].includes(s.state)).length,
        primary: primaries.includes(x),
      };
    });
    return {
      updatedAt: Date.now(), short, summary: summary.join(" · "), usage,
      hotkey: cfg.menuBarHotkey || "control+option+command+D",
      running, waiting, agents, sessions: out,
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
    const bin = kind === "dsh" ? findDshBinary() : findClaudeBinary(this.settings.delegate?.claude?.path || "");
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
  let agent = "claude";
  let sid = "";
  let m = /claude:\/\/resume\?session=([0-9a-f-]{20,})/i.exec(line);
  if (m) { sid = m[1]; agent = "claude"; }
  else if ((m = /workbuddy:\/\/chat\/([^\s)\]]+)/i.exec(line))) { sid = decodeURIComponent(m[1]); agent = "workbuddy"; }
  else if ((m = /codex:\/\/threads\/([0-9a-f-]{36})/i.exec(line))) { sid = m[1]; agent = "codex"; }
  else if ((m = /`(session-[0-9a-f-]{20,}|[0-9a-f]{8}-[0-9a-f-]{27})`/i.exec(line))) { sid = m[1]; agent = /dsh|deepseek|harness/i.test(line) ? "dsh" : "claude"; }
  else if ((m = /`([0-9a-f]{8}-[0-9a-f-]{27})`/i.exec(line))) { sid = m[1]; agent = "dsh"; }
  else if ((m = /codex\s+resume\s+([0-9a-f-]{20,})/i.exec(line))) { sid = m[1]; agent = "codex"; }
  if (/DeepSeek Harness|DSH/i.test(line) && !/claude:\/\//i.test(line)) agent = "dsh";
  return { agent, sid };
}
