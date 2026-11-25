// Project Workbench Modal: Team presets, Copilot task decomposition, and concurrent multi-agent dispatch.

import fs from "fs";
import { Modal, Notice } from "obsidian";
import { AGENTS, journalPath, truncate } from "./constants.js";
import { t } from "./i18n.js";
import { agentIcon, setLucide } from "./icons.js";
import { blockAt, blockTitle, ancestorLines } from "./delegation.js";
import { uninstalledAgentsFor } from "./delegation-runners.js";
import { resolveTaskProjectState } from "./dialog.js";
import { projectFolderEntries, projectFolderForName, resolveProjectForTask, sameFolder } from "./project-folders.js";
import { mentionTrigger, stripTaskMention } from "./task-mentions.js";
import { destinations, defaultDestination } from "./workflow.js";
import { JOURNAL_PROVIDERS, detectJournalProviders, resolveJournalProvider, runJournalModel } from "./llm.js";
import * as J from "./journal.js";
import {
  resolveSessionProject,
  resolveTeamPresets,
  delegableAgents,
  limitAgentsFromSessions,
  assignTeamToRoles,
  resolveStewardConfig,
  buildCopilotPlanPrompt,
  buildCopilotFixPrompt,
  parseCopilotPlanResponse,
  fallbackCopilotPlan,
  detectStageScopeOverlaps,
  staggerConflictingStages,
  isQuotaOrProviderErrorText,
} from "./project-workbench.js";

function extractGoalFromBlock(block, trigger) {
  if (!block) return "";
  const title = blockTitle(block, trigger);
  const rawLines = String(block.text || "").split("\n").slice(1);
  const details = rawLines
    .map((l) => l.trim())
    .filter((l) => l
      && !J.RECORD_LINE_RE.test(l)
      && !J.LINK_RE.test(l)
      && !/^(?:[-*+]\s+)?(?:📄|📝|❓|✍️|⏱|🔗|💬)\s*/.test(l)
      && !J.kwLine(l)?.kw)
    .map((l) => J.stripBlockId(stripTaskMention(l, trigger)).replace(/^(?:[-*+]|\d+[.)])\s+/, "").trim())
    .filter(Boolean)
    .slice(0, 6);
  return details.length ? `${title}\n${details.map((d) => `- ${d}`).join("\n")}` : title;
}

export class ProjectWorkbenchModal extends Modal {
  constructor(app, plugin, opts = {}) {
    super(app);
    this.plugin = plugin;
    this.opts = opts;
    this.projectName = opts.projectName || "";
    this.cwd = opts.cwd || "";
    this.targetPath = opts.path || "";
    this.targetLine = Number.isInteger(opts.line) ? opts.line : -1;
    this.contextLines = [];
    this.goal = opts.goal || "";
    this.presetId = "fullstack";
    this.roleOverrides = {};
    this.stewardEnabled = true;
    this.stewardAgent = "";
    this.stewardAutoContinue = false;
    this.skipConfirmFirst = plugin?.settings?.projectTeams?.skipConfirmFirst !== false;
    this.plannerProvider = plugin?.settings?.projectTeams?.plannerProvider || "auto-cfg";
    this.plannerOptions = [{ id: "auto-cfg", label: t("跟随整理模型") }];
    this.uninstalledAgents = new Set();
    this.orderedAgents = [];
    this.subtasks = [];
    this.planSource = "";
    this.planning = false;
    this.dispatching = false;
    this._closed = false;
    this._draftEdited = false;
    this._lastAutoProject = this.projectName || "";
  }

  detectAgentReadiness() {
    const p = this.plugin;
    this.uninstalledAgents = this.opts.uninstalledAgents instanceof Set
      ? new Set(this.opts.uninstalledAgents)
      : uninstalledAgentsFor(p, this.availableAgents);
    this.orderedAgents = [...this.availableAgents].sort((a, b) => {
      const rank = (id) => (this.uninstalledAgents.has(id) ? 2 : (this.limitAgents.has(id) ? 1 : 0));
      return rank(a) - rank(b);
    });
  }

  syncPlannerOptions() {
    const p = this.plugin;
    const cfg = p.settings || {};
    const detected = detectJournalProviders({ cfg });
    const resolvedId = resolveJournalProvider(cfg);
    const resolvedLabel = resolvedId === "api"
      ? (cfg.autoLogModel ? `API (${cfg.autoLogModel})` : "API")
      : (JOURNAL_PROVIDERS[resolvedId]?.label || resolvedId);
    const opts = [{
      id: "auto-cfg",
      label: resolvedLabel ? t("跟随整理模型 ({name})", { name: resolvedLabel }) : t("跟随整理模型"),
    }];
    for (const prov of detected.available || []) {
      opts.push({ id: prov.id, label: prov.label });
    }
    if (cfg.autoLogApiUrl && cfg.autoLogModel) {
      opts.push({ id: "api", label: `API (${cfg.autoLogModel})` });
    }
    this.plannerOptions = opts;
    if (!opts.some((o) => o.id === this.plannerProvider)) this.plannerProvider = "auto-cfg";
  }

  agentOptionLabel(id) {
    const base = AGENTS[id]?.short || id;
    if (this.uninstalledAgents.has(id)) return `${base} (${t("未装 CLI")})`;
    if (this.limitAgents.has(id)) return `${base} (${t("限额")})`;
    return base;
  }

  syncStewardFromSettings() {
    const defaultAgent = this.orderedAgents.includes(this.plugin.defaultTarget?.())
      ? this.plugin.defaultTarget()
      : (this.orderedAgents[0] || this.availableAgents[0] || "claude");
    const cfg = resolveStewardConfig(this.plugin.settings, {
      presetId: this.presetId,
      projectName: this.projectName,
      availableAgents: this.orderedAgents.length ? this.orderedAgents : this.availableAgents,
      limitAgents: this.limitAgents,
      uninstalledAgents: this.uninstalledAgents,
      defaultAgent,
    });
    this.stewardEnabled = cfg.enabled;
    this.stewardAgent = cfg.agent;
    this.stewardAutoContinue = cfg.autoContinue;
  }

  async onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass("ad-workbench-dialog");
    contentEl.addClass("ad-modal", "ad-workbench");

    const p = this.plugin;
    this.availableAgents = delegableAgents(p);
    this.limitAgents = limitAgentsFromSessions(p.liveSessions?.({ hours: 6 }) || []);
    this.detectAgentReadiness();
    this.syncPlannerOptions();

    let detectedBlock = null;
    let noteLines = [];
    if (this.targetPath && this.targetLine >= 0) {
      try {
        const text = await p.readNote(this.targetPath);
        noteLines = text.split("\n");
        detectedBlock = blockAt(noteLines, this.targetLine);
        if (detectedBlock) {
          this.goal = this.goal || extractGoalFromBlock(detectedBlock, mentionTrigger(p));
          this.contextLines = ancestorLines(noteLines, detectedBlock.start);
        }
      } catch { /* fallback to empty goal */ }
    } else if (!this.targetPath) {
      const active = this.app.workspace.getActiveFile?.();
      if (active?.extension === "md") this.targetPath = active.path;
      else if (p.journalSync?.todayJournal) {
        const today = p.journalSync.todayJournal();
        this.targetPath = today?.path || "";
      }
    }

    if (!this.cwd || !this.projectName) {
      if (this.targetPath && detectedBlock) {
        const ps = resolveTaskProjectState(p, this.targetPath, noteLines, detectedBlock);
        const hint = ps.projectConflict ? ps.projectSuggest : (ps.projectHint || ps.projectSuggest);
        if (!this.projectName && hint?.name) this.projectName = hint.name;
        if (!this.cwd && ps.cwd) this.cwd = ps.cwd;
      } else if (this.targetPath && p.settings?.autoProjectFolder !== false) {
        const hint = resolveProjectForTask({ settings: p.settings, notePath: this.targetPath, contextLines: [], blockText: this.goal });
        if (!this.projectName && hint?.name) this.projectName = hint.name;
        if (!this.cwd && hint?.path) this.cwd = hint.path;
      }
    }
    if (!this.projectName && this.cwd) {
      this.projectName = resolveSessionProject({ cwd: this.cwd });
    }
    if (!this.cwd) this.cwd = p.vaultPath || "";
    const registered = this.projectName ? projectFolderForName(p.settings, this.projectName) : "";
    if (registered && (!this.cwd || sameFolder(this.cwd, p.vaultPath))) this.cwd = registered;
    this._lastAutoProject = this.projectName || "";

    const savedByProj = p.settings?.projectTeams?.byProject || {};
    if (this.projectName && savedByProj[this.projectName]) {
      this.presetId = savedByProj[this.projectName];
    }
    this.syncStewardFromSettings();
    if (!this._closed) this.render();
  }

  currentPreset() {
    const presets = resolveTeamPresets(this.plugin.settings);
    return presets.find((x) => x.id === this.presetId) || presets[0];
  }

  teamDestination(agent) {
    const dests = destinations(agent);
    if (dests.some((d) => d.id === "background")) return "background";
    return defaultDestination(this.plugin, agent);
  }

  resolvedRoles() {
    return assignTeamToRoles(this.currentPreset(), {
      availableAgents: this.orderedAgents.length ? this.orderedAgents : this.availableAgents,
      limitAgents: this.limitAgents,
      uninstalledAgents: this.uninstalledAgents,
      overrides: this.roleOverrides,
      defaultDestinationFn: (agent) => this.teamDestination(agent),
    });
  }

  saveTeamPreference() {
    const p = this.plugin;
    const teams = (p.settings.projectTeams ||= { presets: {}, byProject: {}, stewards: {} });
    teams.presets ||= {};
    teams.byProject ||= {};
    teams.stewards ||= {};
    teams.stewards.byPreset ||= {};
    teams.stewards.byProject ||= {};
    teams.plannerProvider = this.plannerProvider || "auto-cfg";
    teams.skipConfirmFirst = this.skipConfirmFirst !== false;
    if (this.projectName) teams.byProject[this.projectName] = this.presetId;
    if (Object.keys(this.roleOverrides).length) {
      teams.presets[this.presetId] = {
        roleAgents: { ...(teams.presets[this.presetId]?.roleAgents || {}), ...this.roleOverrides },
      };
    }
    if (this.stewardAgent) {
      const entry = {
        enabled: this.stewardEnabled !== false,
        agent: this.stewardAgent,
        autoContinue: this.stewardAutoContinue === true,
      };
      teams.stewards.default = entry;
      teams.stewards.byPreset[this.presetId] = entry;
      if (this.projectName) teams.stewards.byProject[this.projectName] = entry;
    }
    p.saveSettings?.();
  }

  applyFallbackPlan() {
    const roles = this.resolvedRoles();
    const pool = this.orderedAgents.length ? this.orderedAgents : this.availableAgents;
    const defaultAgent = pool.includes(this.plugin.defaultTarget?.()) && !this.uninstalledAgents.has(this.plugin.defaultTarget?.())
      ? this.plugin.defaultTarget()
      : (pool[0] || "claude");
    const plan = fallbackCopilotPlan({ goal: this.goal, roles, defaultAgent });
    this.planSource = "template";
    this._draftEdited = false;
    this.subtasks = plan.subtasks.map((item) => ({
      ...item,
      stage: item.stage || 1,
      destination: this.teamDestination(item.agent),
    }));
  }

  async runCopilotPlan() {
    if (!this.goal.trim()) {
      new Notice(t("请先输入项目目标或需求描述"));
      return;
    }
    this.planning = true;
    this.render();
    const roles = this.resolvedRoles();
    const pool = this.orderedAgents.length ? this.orderedAgents : this.availableAgents;
    const readyPool = pool.filter((id) => !this.uninstalledAgents.has(id) && !this.limitAgents.has(id));
    const plannerPool = readyPool.length ? readyPool : pool;
    const defaultAgent = roles[0]?.agent || plannerPool[0] || "claude";

    const baseCfg = this.plugin.settings || {};
    const minTimeout = Math.max(Number(baseCfg.autoLogTimeout) || 0, 120);
    const planCfg = this.plannerProvider && this.plannerProvider !== "auto-cfg"
      ? {
          ...baseCfg,
          autoLogProvider: this.plannerProvider,
          autoLogTimeout: minTimeout,
          // Never leak another provider's autoLogModel (e.g. gpt-6-luna) when user selects DeepSeek or Antigravity here.
          autoLogModel: this.plannerProvider === "api" ? baseCfg.autoLogModel : "",
          roundPolishModel: "",
        }
      : {
          ...baseCfg,
          autoLogTimeout: minTimeout,
          autoLogFailover: true,
        };

    try {
      const prompt = buildCopilotPlanPrompt({
        goal: this.goal,
        projectName: this.projectName,
        cwd: this.cwd,
        contextLines: this.contextLines,
        roles,
        availableAgents: plannerPool,
      });
      let raw = await runJournalModel(prompt, planCfg, { polish: false });
      if (isQuotaOrProviderErrorText(raw)) {
        throw new Error(truncate(String(raw || "").trim(), 160));
      }
      let parsed = parseCopilotPlanResponse(raw, {
        availableAgents: plannerPool,
        roles,
        defaultAgent,
      });
      if (!parsed?.subtasks?.length) {
        raw = await runJournalModel(
          buildCopilotFixPrompt(raw, { availableAgents: plannerPool, goal: this.goal }),
          planCfg,
          { polish: false },
        );
        if (isQuotaOrProviderErrorText(raw)) {
          throw new Error(truncate(String(raw || "").trim(), 160));
        }
        parsed = parseCopilotPlanResponse(raw, {
          availableAgents: plannerPool,
          roles,
          defaultAgent,
        });
      }
      if (this._closed) return;
      if (parsed?.subtasks?.length) {
        this.planSource = "ai";
        this._draftEdited = false;
        this.subtasks = parsed.subtasks.map((item) => ({
          ...item,
          stage: item.stage || 1,
          destination: this.teamDestination(item.agent),
        }));
      } else {
        this.applyFallbackPlan();
        new Notice(t("模型返回未按结构化格式输出，已按小队角色生成可编辑草案"));
      }
    } catch (e) {
      if (this._closed) return;
      this.applyFallbackPlan();
      new Notice(t("未连上整理模型，已按小队角色生成可编辑草案：{msg}", { msg: e.message || e }), 5000);
    } finally {
      this.planning = false;
      if (!this._closed) this.render();
    }
  }

  updateActionCounts() {
    const active = this.subtasks.filter((s) => s.checked !== false && String(s.title || "").trim());
    const n = active.length;
    if (this._draftCountEl) {
      this._draftCountEl.textContent = t("待派发子任务草案（{n} 条已选）", { n });
    }
    if (this._saveOnlyBtn) {
      this._saveOnlyBtn.disabled = this.dispatching || !n;
    }
    if (this._goBtn) {
      this._goBtn.disabled = this.dispatching || !n;
    }
    if (this._goBtnLabel) {
      this._goBtnLabel.textContent = this.dispatching ? t("正在派发…") : t("写入并并发派发 ({n})", { n });
    }
    if (this._conflictHintEl) {
      const overlaps = detectStageScopeOverlaps(active);
      const stage1Count = active.filter((s) => (Number(s.stage) || 1) === 1).length;
      if (overlaps.length) {
        const files = [...new Set(overlaps.map((o) => o.file))].slice(0, 3).join(", ");
        if (this._conflictTextEl) {
          this._conflictTextEl.textContent = t("⚠️ 第 {stage} 批中有子任务涉及相同文件（{files}），建议错开批次防冲突", {
            stage: overlaps[0].stage,
            files,
          });
        }
        if (this._staggerBtn) this._staggerBtn.hidden = false;
        this._conflictHintEl.hidden = false;
      } else if (stage1Count >= 2) {
        if (this._conflictTextEl) {
          this._conflictTextEl.textContent = t("第 1 批有 {n} 个并行子任务，已注入分工边界防冲突；有先后依赖的可切换为第 2 批", { n: stage1Count });
        }
        if (this._staggerBtn) this._staggerBtn.hidden = true;
        this._conflictHintEl.hidden = false;
      } else {
        if (this._conflictTextEl) this._conflictTextEl.textContent = "";
        if (this._staggerBtn) this._staggerBtn.hidden = true;
        this._conflictHintEl.hidden = true;
      }
    }
    if (this._preflightEl) {
      const pool = this.orderedAgents.length ? this.orderedAgents : this.availableAgents;
      const healthy = pool.filter((id) => !this.uninstalledAgents.has(id) && !this.limitAgents.has(id));
      const badTasks = healthy.length
        ? active.filter((s) => this.uninstalledAgents.has(s.agent) || this.limitAgents.has(s.agent))
        : [];
      const cwdTrimmed = String(this.cwd || "").trim();
      let cwdMissing = false;
      try {
        if (cwdTrimmed) cwdMissing = !fs.existsSync(cwdTrimmed);
      } catch {
        cwdMissing = false;
      }
      if (cwdMissing) {
        if (this._preflightTextEl) this._preflightTextEl.textContent = t("⚠️ 工作目录不存在：{cwd}", { cwd: cwdTrimmed });
        if (this._swapAgentBtn) this._swapAgentBtn.hidden = true;
        this._preflightEl.hidden = false;
      } else if (badTasks.length) {
        if (this._preflightTextEl) {
          this._preflightTextEl.textContent = t("⚠️ {n} 条已选子任务指派给了未装 CLI 或限额 Agent", { n: badTasks.length });
        }
        if (this._swapAgentBtn) this._swapAgentBtn.hidden = false;
        this._preflightEl.hidden = false;
      } else {
        if (this._preflightTextEl) this._preflightTextEl.textContent = "";
        if (this._swapAgentBtn) this._swapAgentBtn.hidden = true;
        this._preflightEl.hidden = true;
      }
    }
  }

  async commitTasks({ dispatch = false } = {}) {
    const active = this.subtasks.filter((s) => s.checked !== false && String(s.title || "").trim());
    if (!active.length) {
      new Notice(t("请至少保留一条要写入的子任务"));
      return;
    }
    const cwdTrimmed = String(this.cwd || "").trim();
    if (dispatch && cwdTrimmed && !fs.existsSync(cwdTrimmed)) {
      new Notice(t("工作目录不存在，请先修正路径：{cwd}", { cwd: cwdTrimmed }), 6000);
      return;
    }
    this.dispatching = true;
    this.render();
    try {
      this.saveTeamPreference();
      const parentTitle = this.goal.split(/\r?\n/)[0]?.trim() || this.projectName || t("项目协同任务");
      const saved = await this.plugin.writeWorkbenchTasks({
        path: this.targetPath,
        line: this.targetLine,
        parentTitle,
        subtasks: active,
        enableBoard: this.targetLine >= 0 || active.length >= 2,
      });
      if (dispatch) {
        await this.plugin.dispatchWorkbenchTasks({
          path: saved.path,
          lines: saved.lines,
          subtaskLines: saved.subtaskLines,
          cwd: this.cwd.trim(),
          parentTitle,
          parentBlockId: saved.parentBlockId || "",
          projectName: this.projectName,
          goal: this.goal.trim() || parentTitle,
          skipConfirmFirst: this.skipConfirmFirst,
          steward: this.stewardEnabled && this.stewardAgent
            ? {
                enabled: true,
                agent: this.stewardAgent,
                destination: this.teamDestination(this.stewardAgent),
                autoContinue: this.stewardAutoContinue,
              }
            : { enabled: false },
        });
      } else {
        new Notice(t("已将 {n} 条协作子任务写入笔记", { n: active.length }));
      }
      if (!this._closed) this.close();
    } catch (e) {
      this.dispatching = false;
      if (!this._closed) this.render();
      new Notice(String(e.message || e), 6000);
    }
  }

  render() {
    const { contentEl } = this;
    const p = this.plugin;
    contentEl.empty();
    const presets = resolveTeamPresets(p.settings);
    const roles = this.resolvedRoles();
    const agentPool = this.orderedAgents.length ? this.orderedAgents : this.availableAgents;

    const head = contentEl.createDiv({ cls: "ad-modalhead" });
    head.createDiv({ cls: "ad-modalhead__title", text: t("项目协作工作台") });
    head.createDiv({
      cls: "ad-modalhead__sub",
      text: t("配置 Agent 协作小队，拆解任务并在确认后并发派发，记录自动落盘到 Markdown"),
    });

    // 1. Project & workspace context
    const metaGrid = contentEl.createDiv({ cls: "ad-wb-grid" });
    const projField = metaGrid.createDiv({ cls: "ad-field" });
    projField.createDiv({ cls: "ad-field__label", text: t("项目名称") });
    const projInput = projField.createEl("input", {
      cls: "ad-input",
      attr: { type: "text", placeholder: t("例如：agent-deck"), value: this.projectName },
    });

    const cwdField = metaGrid.createDiv({ cls: "ad-field" });
    cwdField.createDiv({ cls: "ad-field__label", text: t("工作目录 (cwd)") });
    const folderEntries = projectFolderEntries(p.settings);
    let folderSel = null;
    if (folderEntries.length) {
      folderSel = cwdField.createEl("select", { cls: "ad-input" });
      folderSel.createEl("option", { value: "", text: t("库根目录（不指定项目）") });
      for (const e of folderEntries) folderSel.createEl("option", { value: e.name, text: `${e.name} · ${e.path}` });
      folderSel.value = folderEntries.find((e) => sameFolder(e.path, this.cwd))?.name || "";
      folderSel.onchange = () => {
        const hit = folderEntries.find((e) => e.name === folderSel.value);
        this.cwd = hit ? hit.path : (p.vaultPath || "");
        if (hit && (!this.projectName || this.projectName === this._lastAutoProject)) {
          this.projectName = hit.name;
          this._lastAutoProject = hit.name;
          const savedByProj = p.settings?.projectTeams?.byProject || {};
          if (savedByProj[this.projectName]) {
            this.presetId = savedByProj[this.projectName];
            this.roleOverrides = {};
          }
          this.syncStewardFromSettings();
        }
        this.render();
      };
    }
    const cwdInput = cwdField.createEl("input", {
      cls: "ad-input",
      attr: { type: "text", placeholder: p.vaultPath || "", value: this.cwd },
    });
    cwdInput.oninput = () => {
      this.cwd = cwdInput.value;
      if (folderSel) folderSel.value = folderEntries.find((e) => sameFolder(e.path, this.cwd))?.name || "";
      this.updateActionCounts();
    };
    projInput.oninput = () => {
      this.projectName = projInput.value.trim();
      const folder = projectFolderForName(p.settings, this.projectName);
      if (folder && (!this.cwd || sameFolder(this.cwd, p.vaultPath))) {
        this.cwd = folder;
        cwdInput.value = folder;
        if (folderSel) folderSel.value = folderEntries.find((e) => sameFolder(e.path, folder))?.name || "";
        this.updateActionCounts();
      }
    };

    if (this.targetLine >= 0 && this.targetPath) {
      const targetMeta = contentEl.createDiv({ cls: "ad-hint ad-wb-target" });
      targetMeta.textContent = t("写入位置：{path} 第 {line} 行下方（自动启用分形看板）", { path: this.targetPath, line: this.targetLine + 1 });
    } else {
      const targetField = contentEl.createDiv({ cls: "ad-field" });
      targetField.createDiv({ cls: "ad-field__label", text: t("写入目标笔记") });
      const targetRow = targetField.createDiv({ cls: "ad-wb-task__top" });
      const targetInput = targetRow.createEl("input", {
        cls: "ad-input ad-wb-task__title",
        attr: { type: "text", placeholder: t("留空则写入今日日记"), value: this.targetPath },
      });
      targetInput.oninput = () => { this.targetPath = targetInput.value.trim(); };
      const todayBtn = targetRow.createEl("button", { cls: "ad-btn ad-btn--ghost", text: t("今日日记"), attr: { type: "button" } });
      todayBtn.onclick = () => {
        this.targetPath = journalPath(this.app, p.settings);
        this.render();
      };
      const activeFile = this.app.workspace.getActiveFile?.();
      if (activeFile?.extension === "md" && activeFile.path !== this.targetPath) {
        const curBtn = targetRow.createEl("button", { cls: "ad-btn ad-btn--ghost", text: t("当前笔记"), attr: { type: "button" } });
        curBtn.onclick = () => {
          this.targetPath = activeFile.path;
          this.render();
        };
      }
    }

    // 2. Team preset & role routing
    const teamField = contentEl.createDiv({ cls: "ad-field" });
    teamField.createDiv({ cls: "ad-field__label", text: t("Agent 协作小队预设") });
    const presetRow = teamField.createDiv({ cls: "ad-wb-presets" });
    for (const preset of presets) {
      const btn = presetRow.createEl("button", {
        cls: `ad-chip${preset.id === this.presetId ? " is-on" : ""}`,
        text: preset.name,
        attr: { type: "button", title: preset.desc },
      });
      btn.onclick = () => {
        this.presetId = preset.id;
        this.roleOverrides = {};
        this.syncStewardFromSettings();
        if (this.planSource === "template" && !this._draftEdited && this.subtasks.length) {
          this.applyFallbackPlan();
        }
        this.render();
      };
    }

    const roleList = teamField.createDiv({ cls: "ad-wb-roles" });
    for (const role of roles) {
      const row = roleList.createDiv({ cls: "ad-wb-role" });
      const info = row.createDiv({ cls: "ad-wb-role__info" });
      info.createDiv({ cls: "ad-wb-role__name", text: role.label });
      info.createDiv({ cls: "ad-wb-role__hint", text: role.hint });

      const selWrap = row.createDiv({ cls: "ad-wb-role__pick" });
      agentIcon(selWrap.createSpan({ cls: "ad-glyph" }), role.agent);
      const sel = selWrap.createEl("select", { cls: "ad-input ad-wb-select" });
      for (const id of agentPool) {
        sel.createEl("option", { text: this.agentOptionLabel(id), attr: { value: id } });
      }
      sel.value = role.agent;
      sel.onchange = () => {
        const nextAgent = sel.value;
        this.roleOverrides[role.id] = nextAgent;
        for (const item of this.subtasks) {
          if (item && !item._manualAgent && (item.roleId === role.id || item.role === role.label)) {
            item.agent = nextAgent;
            item.destination = this.teamDestination(nextAgent);
          }
        }
        this.saveTeamPreference();
        this.render();
      };
    }

    if (roles.some((r) => r.fallbackFrom)) {
      const assignedNames = [...new Set(roles.map((r) => AGENTS[r.agent]?.short || r.agent))].join("、");
      teamField.createDiv({
        cls: "ad-hint",
        text: t("已自动分配给当前可用 Agent：{agents}", { agents: assignedNames }),
      });
    }

    const stewardBox = teamField.createDiv({ cls: "ad-wb-steward" });
    const stewardTop = stewardBox.createDiv({ cls: "ad-wb-steward__top" });
    const stewardToggle = stewardTop.createEl("label", { cls: "ad-wb-steward__check" });
    const stewardCb = stewardToggle.createEl("input", { attr: { type: "checkbox" } });
    stewardCb.checked = this.stewardEnabled !== false;
    stewardCb.onchange = () => {
      this.stewardEnabled = stewardCb.checked;
      this.saveTeamPreference();
      this.render();
    };
    stewardToggle.createSpan({
      cls: "ad-wb-role__name",
      text: t("管家 Agent（队员全部完成后自动汇总并继续推进）"),
    });

    const stewardPick = stewardTop.createDiv({ cls: "ad-wb-role__pick" });
    const activeSteward = agentPool.includes(this.stewardAgent)
      ? this.stewardAgent
      : (agentPool[0] || "claude");
    agentIcon(stewardPick.createSpan({ cls: "ad-glyph" }), activeSteward);
    const stewardSel = stewardPick.createEl("select", { cls: "ad-input ad-wb-select" });
    for (const id of agentPool) {
      stewardSel.createEl("option", { text: this.agentOptionLabel(id), attr: { value: id } });
    }
    stewardSel.value = activeSteward;
    stewardSel.disabled = !this.stewardEnabled;
    stewardSel.onchange = () => {
      this.stewardAgent = stewardSel.value;
      this.saveTeamPreference();
      this.render();
    };

    if (this.stewardEnabled) {
      const stewardSub = stewardBox.createDiv({ cls: "ad-wb-steward__sub" });
      const autoLabel = stewardSub.createEl("label", { cls: "ad-wb-steward__check" });
      const autoCb = autoLabel.createEl("input", { attr: { type: "checkbox" } });
      autoCb.checked = this.stewardAutoContinue === true;
      autoCb.onchange = () => {
        this.stewardAutoContinue = autoCb.checked;
        this.saveTeamPreference();
      };
      autoLabel.createSpan({
        cls: "ad-wb-role__hint",
        text: t("自动续派管家生成的后续 TODO（最多 2 轮）"),
      });
    }

    // 3. Goal & copilot planning
    const goalField = contentEl.createDiv({ cls: "ad-field" });
    goalField.createDiv({ cls: "ad-field__label", text: t("项目目标 / 待拆解任务") });
    const goalArea = goalField.createEl("textarea", {
      cls: "ad-textarea",
      attr: { rows: "3", placeholder: t("描述这一阶段要推进的目标，或直接贴入多行要点…") },
    });
    goalArea.value = this.goal;
    goalArea.oninput = () => { this.goal = goalArea.value; };
    goalArea.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !this.planning && !this.dispatching) {
        e.preventDefault();
        this.runCopilotPlan();
      }
    });

    const planBar = goalField.createDiv({ cls: "ad-wb-planbar" });
    const aiBtn = planBar.createEl("button", {
      cls: "ad-btn ad-btn--cta",
      attr: { type: "button", title: "⌘Enter / Ctrl+Enter" },
    });
    setLucide(aiBtn.createSpan({ cls: "ad-btn__icon" }), "sparkles");
    aiBtn.createSpan({ text: this.planning ? t("正在拆解任务…") : t("AI 副驾拆解并配队") });
    aiBtn.disabled = this.planning || this.dispatching;
    aiBtn.onclick = () => this.runCopilotPlan();

    const quickBtn = planBar.createEl("button", {
      cls: "ad-btn ad-btn--ghost",
      text: t("按小队快速拆分"),
      attr: { type: "button" },
    });
    quickBtn.disabled = this.planning || this.dispatching;
    quickBtn.onclick = () => { this.applyFallbackPlan(); this.render(); };

    const addBtn = planBar.createEl("button", {
      cls: "ad-btn ad-btn--ghost",
      text: t("+ 添加子任务"),
      attr: { type: "button" },
    });
    addBtn.disabled = this.dispatching;
    addBtn.onclick = () => {
      const fallbackAgent = roles[0]?.agent || agentPool[0] || "claude";
      this.subtasks.push({
        checked: true,
        title: "",
        role: t("新增任务"),
        agent: fallbackAgent,
        stage: 1,
        destination: this.teamDestination(fallbackAgent),
        detail: "",
      });
      this.render();
    };

    if (this.plannerOptions.length > 1) {
      const plannerWrap = planBar.createDiv({ cls: "ad-wb-planner" });
      plannerWrap.createSpan({ cls: "ad-wb-role__hint", text: t("拆解模型") });
      const planSel = plannerWrap.createEl("select", { cls: "ad-input ad-wb-select" });
      for (const opt of this.plannerOptions) {
        planSel.createEl("option", { text: opt.label, attr: { value: opt.id } });
      }
      planSel.value = this.plannerProvider;
      planSel.disabled = this.planning || this.dispatching;
      planSel.onchange = () => {
        this.plannerProvider = planSel.value;
        this.saveTeamPreference();
      };
    }

    // 4. Editable draft list
    const draftField = contentEl.createDiv({ cls: "ad-field" });
    const draftHead = draftField.createDiv({ cls: "ad-wb-drafthead" });
    this._draftCountEl = draftHead.createDiv({ cls: "ad-field__label" });
    if (this.planSource) {
      draftHead.createSpan({
        cls: `ad-wb-badge is-${this.planSource}`,
        text: this.planSource === "ai" ? t("AI 拆解") : t("模板拆分"),
      });
    }
    const list = draftField.createDiv({ cls: "ad-wb-tasks" });
    if (!this.subtasks.length) {
      list.createDiv({ cls: "ad-hint", text: t("输入目标后点击「AI 副驾拆解并配队」或「按小队快速拆分」生成子任务草案。") });
    }
    this.subtasks.forEach((item, idx) => {
      const row = list.createDiv({ cls: "ad-wb-task" });
      const top = row.createDiv({ cls: "ad-wb-task__top" });

      const cb = top.createEl("input", { attr: { type: "checkbox" } });
      cb.checked = item.checked !== false;
      cb.onchange = () => { item.checked = cb.checked; this.updateActionCounts(); };

      const titleIn = top.createEl("input", {
        cls: "ad-input ad-wb-task__title",
        attr: { type: "text", placeholder: t("子任务标题"), value: item.title || "" },
      });
      titleIn.oninput = () => {
        item.title = titleIn.value;
        this._draftEdited = true;
        this.updateActionCounts();
      };

      const delBtn = top.createEl("button", { cls: "ad-linkbtn", text: "×", attr: { type: "button", title: t("移除") } });
      delBtn.onclick = () => {
        this._draftEdited = true;
        this.subtasks.splice(idx, 1);
        this.render();
      };

      const metaRow = row.createDiv({ cls: "ad-wb-task__meta" });
      const agentSel = metaRow.createEl("select", { cls: "ad-input ad-wb-select" });
      for (const id of agentPool) {
        agentSel.createEl("option", { text: this.agentOptionLabel(id), attr: { value: id } });
      }
      agentSel.value = agentPool.includes(item.agent) ? item.agent : (agentPool[0] || "claude");
      agentSel.onchange = () => {
        item._manualAgent = true;
        this._draftEdited = true;
        item.agent = agentSel.value;
        item.destination = this.teamDestination(item.agent);
        this.render();
      };

      const stageSel = metaRow.createEl("select", { cls: "ad-input ad-wb-select ad-wb-stage" });
      for (const n of [1, 2, 3]) {
        stageSel.createEl("option", { text: t("第 {n} 批", { n }), attr: { value: String(n) } });
      }
      stageSel.value = String(Math.min(3, Math.max(1, Number(item.stage) || 1)));
      stageSel.onchange = () => {
        this._draftEdited = true;
        item.stage = Number(stageSel.value) || 1;
        this.updateActionCounts();
      };

      const destSel = metaRow.createEl("select", { cls: "ad-input ad-wb-select" });
      const destOpts = destinations(item.agent);
      for (const d of destOpts) destSel.createEl("option", { text: d.label, attr: { value: d.id } });
      destSel.value = destOpts.some((d) => d.id === item.destination) ? item.destination : (destOpts[0]?.id || "background");
      destSel.onchange = () => { item.destination = destSel.value; };

      const detailIn = row.createEl("input", {
        cls: "ad-input ad-wb-task__detail",
        attr: { type: "text", placeholder: t("补充要求或验收标准（可选）"), value: item.detail || "" },
      });
      detailIn.oninput = () => {
        this._draftEdited = true;
        item.detail = detailIn.value;
        this.updateActionCounts();
      };
    });

    this._conflictHintEl = draftField.createDiv({ cls: "ad-wb-banner" });
    this._conflictHintEl.hidden = true;
    this._conflictTextEl = this._conflictHintEl.createSpan({ cls: "ad-wb-banner__text" });
    this._staggerBtn = this._conflictHintEl.createEl("button", {
      cls: "ad-btn ad-btn--ghost ad-wb-inlinebtn",
      text: t("一键错峰排批"),
      attr: { type: "button" },
    });
    this._staggerBtn.hidden = true;
    this._staggerBtn.onclick = () => {
      const res = staggerConflictingStages(this.subtasks);
      this.subtasks = res.subtasks;
      if (res.movedCount) {
        this._draftEdited = true;
        new Notice(t("已将 {n} 条同文件冲突子任务自动错开至下一批", { n: res.movedCount }));
      }
      this.render();
    };

    this._preflightEl = draftField.createDiv({ cls: "ad-wb-banner is-warn" });
    this._preflightEl.hidden = true;
    this._preflightTextEl = this._preflightEl.createSpan({ cls: "ad-wb-banner__text" });
    this._swapAgentBtn = this._preflightEl.createEl("button", {
      cls: "ad-btn ad-btn--ghost ad-wb-inlinebtn",
      text: t("一键替换为可用 Agent"),
      attr: { type: "button" },
    });
    this._swapAgentBtn.hidden = true;
    this._swapAgentBtn.onclick = () => {
      const pool = this.orderedAgents.length ? this.orderedAgents : this.availableAgents;
      const healthy = pool.filter((id) => !this.uninstalledAgents.has(id) && !this.limitAgents.has(id));
      if (!healthy.length) return;
      let cursor = 0;
      let swapped = 0;
      for (const item of this.subtasks) {
        if (!item || item.checked === false) continue;
        if (this.uninstalledAgents.has(item.agent) || this.limitAgents.has(item.agent)) {
          const next = healthy[cursor % healthy.length];
          cursor += 1;
          item.agent = next;
          item.destination = this.teamDestination(next);
          swapped += 1;
        }
      }
      if (swapped) {
        this._draftEdited = true;
        new Notice(t("已为 {n} 条子任务切换为可用 Agent", { n: swapped }));
      }
      this.render();
    };

    // Footer
    const foot = contentEl.createDiv({ cls: "ad-modalfoot ad-wb-foot" });
    const skipWrap = foot.createEl("label", { cls: "ad-wb-steward__check ad-wb-footopt" });
    const skipCb = skipWrap.createEl("input", { attr: { type: "checkbox" } });
    skipCb.checked = this.skipConfirmFirst !== false;
    skipCb.onchange = () => {
      this.skipConfirmFirst = skipCb.checked;
      this.saveTeamPreference();
    };
    skipWrap.createSpan({
      cls: "ad-wb-role__hint",
      text: t("队员直接执行（跳过首轮反问确认，减少多轮中断）"),
    });

    const footBtns = foot.createDiv({ cls: "ad-btnrow" });
    const cancel = footBtns.createEl("button", { cls: "ad-btn ad-btn--ghost", text: t("取消"), attr: { type: "button" } });
    cancel.onclick = () => this.close();

    this._saveOnlyBtn = footBtns.createEl("button", { cls: "ad-btn ad-btn--ghost", text: t("仅写入 Markdown"), attr: { type: "button" } });
    this._saveOnlyBtn.onclick = () => this.commitTasks({ dispatch: false });

    this._goBtn = footBtns.createEl("button", { cls: "ad-btn ad-btn--cta", attr: { type: "button" } });
    setLucide(this._goBtn.createSpan({ cls: "ad-btn__icon" }), "send");
    this._goBtnLabel = this._goBtn.createSpan();
    this._goBtn.onclick = () => this.commitTasks({ dispatch: true });

    this.updateActionCounts();
  }

  onClose() {
    this._closed = true;
    this.contentEl.empty();
  }
}
