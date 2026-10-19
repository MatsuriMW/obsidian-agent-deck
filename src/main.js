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
import { AgentUsage, UsageStore } from "./readers.js";
import { Delegator, blockAt, blockTitle, openSession as openSessionRaw, openExternal as openExternalRaw, findClaudeBinary, findDshBinary, findLink, statusOf } from "./delegation.js";
import { AgentDeckView, VIEW_TYPE } from "./view.js";
import { AgentDeckSettingsTab } from "./settings.js";
import { DelegateOptionsModal } from "./dialog.js";
import { createEditorExtension, dispatchRefresh } from "./editor.js";

const fsp = fs.promises;
const home = () => os.homedir();

export default class AgentDeckPlugin extends Plugin {
  async onload() {
    const data = await this.loadData();
    this.settings = deepMerge(DEFAULTS, data || {});
    if (!Array.isArray(this.settings.primaryAgents)) this.settings.primaryAgents = this.settings.aiPrimary ? [this.settings.aiPrimary] : ["claude"];
    this.settings.primaryAgents = this.settings.primaryAgents.filter((x) => AGENTS[x]).slice(0, 2);
    if (!this.settings.primaryAgents.length) this.settings.primaryAgents = ["claude"];
    this.settings.jobs = this.settings.jobs && typeof this.settings.jobs === "object" ? this.settings.jobs : {};
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

    this.registerView(VIEW_TYPE, (leaf) => new AgentDeckView(leaf, this));
    this.settingTab = new AgentDeckSettingsTab(this.app, this);
    this.addSettingTab(this.settingTab);
    this.registerEditorExtension(createEditorExtension(this));

    this.setupRibbon();
    this.setupStatusBar();

    this.addCommand({ id: "open-dashboard", name: "打开 Agent Deck 面板", callback: () => this.activateView() });
    this.addCommand({ id: "open-settings", name: "打开 Agent Deck 设置", callback: () => this.openSettings() });
    this.addCommand({ id: "open-models", name: "打开 Agent Deck 的 Models 设置", callback: () => this.openSettings("models") });
    this.addCommand({ id: "delegate-current", name: "委派光标所在块（默认 Agent）", editorCallback: (editor) => this.delegateFromEditor(editor) });
    this.addCommand({ id: "delegate-current-claude", name: "委派光标所在块 → Claude Code", editorCallback: (editor) => this.delegateFromEditor(editor, "claude") });
    this.addCommand({ id: "delegate-current-dsh", name: "委派光标所在块 → DeepSeek Harness", editorCallback: (editor) => this.delegateFromEditor(editor, "dsh") });
    this.addCommand({ id: "delegate-options", name: "委派选项…（模型、强度、模式）", editorCallback: (editor, view) => this.openModalFor(editor, view) });
    this.addCommand({ id: "open-session-line", name: "打开光标这一行绑定的会话", editorCallback: (editor, view) => this.openSessionForEditor(editor, view) });
    this.addCommand({ id: "scan-now", name: "重新扫描本机 Agent 会话", callback: () => this.scanNow(true) });
    this.addCommand({ id: "import-nautilus", name: "导入螺旋日程的历史用量", callback: () => this.importNautilus(true) });
    this.addCommand({ id: "clean-jobs", name: "清理已结束的委派记录", callback: () => this.cleanJobs() });

    this.app.workspace.onLayoutReady(async () => {
      if (this.settings.openDashboardOnStartup) this.activateView();
      this.scheduleScan();
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
    for (const runner of this.delegator?.runners?.values?.() || []) {
      try { if (runner.constructor && runner.constructor.name === "DshRunner") runner.cancel(); } catch { /* already gone */ }
    }
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) try { leaf.detach(); } catch { /* gone */ }
    try { this.statusEl?.remove(); } catch { /* gone */ }
    try { this.ribbonEl?.remove(); } catch { /* gone */ }
  }

  // ---------- setup ----------
  setupRibbon() {
    if (this.ribbonEl) { this.ribbonEl.remove(); this.ribbonEl = null; }
    if (this.settings.showRibbonIcon === false) return;
    this.ribbonEl = this.addRibbonIcon("gauge", "Agent Deck", () => this.activateView());
  }

  setupStatusBar() {
    if (this.statusEl) { this.statusEl.remove(); this.statusEl = null; }
    if (this.settings.showStatusBar === false) return;
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("ad-statusbar");
    this.statusEl.setText("◈ Agent Deck");
    this.statusEl.onclick = (e) => {
      if (e.altKey) {
        const waiting = this.liveSessions({ hours: 24 }).find((x) => ["wait", "quiet", "needs-approval"].includes(x.state));
        if (waiting) return this.openSession(waiting.agent, waiting.sid, waiting.app, waiting);
      }
      this.activateView();
    };
  }

  applyUiSettings() {
    this.setupRibbon();
    this.setupStatusBar();
    this.updateStatusBar();
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
      this.updateStatusBar();
      this.refreshUI();
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
      if (!["starting", "running", "needs-approval"].includes(job.state)) continue;
      if (job.sessionId && seen.has(job.sessionId)) continue;
      if (!job.sessionId && seen.has(job.id)) continue;
      const sid = job.sessionId || job.id;
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
      const cur = bySid.get(sid);
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

  openJob(jobId, sid) {
    const job = jobId ? this.jobs[jobId] : null;
    const agent = job ? job.agent : (this.usage.meta.get(sid) || {}).agent || "claude";
    const sessionId = (job && job.sessionId) || sid;
    if (!sessionId) { this.notice("会话还没有会话号，稍等一秒再点"); return; }
    return openSessionRaw(this, agent, sessionId, job?.app || (this.usage.meta.get(sessionId) || {}).app || "", session);
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

  // ---------- ui refresh ----------
  refreshUI() {
    clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => {
      for (const view of this.views) { try { view.render(); } catch (e) { console.error("[agent-deck] view", e); } }
      try { dispatchRefresh(this); } catch { /* no editors */ }
      this.updateStatusBar();
    }, 120);
  }

  updateStatusBar() {
    if (!this.statusEl) return;
    const live = this.liveSessions({ hours: 6 });
    const running = live.filter((x) => x.state === "run").length;
    const waiting = live.filter((x) => ["wait", "quiet", "needs-approval"].includes(x.state)).length;
    if (running || waiting) {
      this.statusEl.setText(`◈ ${running} 在跑${waiting ? ` · ${waiting} 等你` : ""}`);
      this.statusEl.setAttr("aria-label", `Agent Deck：${running} 个在跑，${waiting} 个等你。单击打开面板，⌥ 单击打开等你的会话`);
    } else {
      const today = this.store.get(dayKeyToday(this.settings));
      this.statusEl.setText(`◈ ${today ? fmtMin(today.wall) : "今日 0m"}`);
    }
  }

  // ---------- misc ----------
  notice(msg, ms) { try { new Notice(msg, ms); } catch { console.log("[agent-deck]", msg); } }
  openExternal(url) { return openExternalRaw(url); }

  async readNote(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) throw new Error("找不到笔记：" + path);
    return await this.app.vault.read(file);
  }

  async writeNote(path, text) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view && view.file && view.file.path === path) {
      const ed = view.editor;
      const line = clamp(ed.getCursor().line, 0, Math.max(0, ed.lineCount() - 1));
      ed.setValue(text);
      try { ed.setCursor({ line: Math.min(line, ed.lineCount() - 1), ch: 0 }); } catch { /* cursor */ }
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
    data.showAi = false;
    data.autoLog = false;
    data.autoLogArchiveDone = false;
    data.agentKw = false;
    data.agentStatus = false;
    data.agentAlert = false;
    data.resultBack = false;
    data.lineProgress = false;
    try { await fsp.writeFile(p, JSON.stringify(data, null, 1), "utf8"); }
    catch (e) { this.notice("写入螺旋日程设置失败：" + (e && e.message || e)); return; }
    this.notice(`已停用螺旋日程的 AI 追踪（原设置备份在 ${path.basename(backup)}）。重新加载螺旋日程或重启 Obsidian 后生效。`, 10000);
    try {
      if (this.app.plugins && this.app.plugins.disablePlugin && this.app.plugins.enablePlugin) {
        await this.app.plugins.disablePlugin("nautilus-spiral");
        await this.app.plugins.enablePlugin("nautilus-spiral");
      }
    } catch { /* user can reload manually */ }
  }

  openPluginDir() {
    try {
      const { shell } = require("electron");
      if (shell && shell.openPath) return shell.openPath(this.pluginDir);
    } catch { /* fallback */ }
    openExternalRaw("file://" + this.pluginDir);
  }
}

function parseLinkLine(line) {
  let agent = "claude";
  let sid = "";
  let m = /claude:\/\/resume\?session=([0-9a-f-]{20,})/i.exec(line);
  if (m) { sid = m[1]; agent = "claude"; }
  else if ((m = /workbuddy:\/\/chat\/([^\s)\]]+)/i.exec(line))) { sid = decodeURIComponent(m[1]); agent = "workbuddy"; }
  else if ((m = /`(session-[0-9a-f-]{20,}|[0-9a-f]{8}-[0-9a-f-]{27})`/i.exec(line))) { sid = m[1]; agent = /dsh|deepseek|harness/i.test(line) ? "dsh" : "claude"; }
  else if ((m = /`([0-9a-f]{8}-[0-9a-f-]{27})`/i.exec(line))) { sid = m[1]; agent = "dsh"; }
  else if ((m = /codex\s+resume\s+([0-9a-f-]{20,})/i.exec(line))) { sid = m[1]; agent = "codex"; }
  if (/DeepSeek Harness|DSH/i.test(line) && !/claude:\/\//i.test(line)) agent = "dsh";
  return { agent, sid };
}
