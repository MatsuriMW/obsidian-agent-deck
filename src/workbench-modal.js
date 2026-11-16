// Project Workbench Modal: Team presets, Copilot task decomposition, and concurrent multi-agent dispatch.

import { Modal, Notice } from "obsidian";
import { AGENTS, journalPath } from "./constants.js";
import { t } from "./i18n.js";
import { agentIcon, setLucide } from "./icons.js";
import { blockAt, blockTitle, ancestorLines } from "./delegation.js";
import { mentionTrigger } from "./task-mentions.js";
import { destinations, defaultDestination } from "./workflow.js";
import { runJournalModel } from "./llm.js";
import {
  resolveSessionProject,
  resolveTeamPresets,
  delegableAgents,
  limitAgentsFromSessions,
  assignTeamToRoles,
  resolveStewardConfig,
  buildCopilotPlanPrompt,
  parseCopilotPlanResponse,
  fallbackCopilotPlan,
} from "./project-workbench.js";

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
    this.subtasks = [];
    this.planning = false;
    this.dispatching = false;
  }

  syncStewardFromSettings() {
    const defaultAgent = this.availableAgents.includes(this.plugin.defaultTarget?.())
      ? this.plugin.defaultTarget()
      : (this.availableAgents[0] || "claude");
    const cfg = resolveStewardConfig(this.plugin.settings, {
      presetId: this.presetId,
      projectName: this.projectName,
      availableAgents: this.availableAgents,
      limitAgents: this.limitAgents,
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

    if (this.targetPath && this.targetLine >= 0) {
      try {
        const text = await p.readNote(this.targetPath);
        const lines = text.split("\n");
        const block = blockAt(lines, this.targetLine);
        if (block) {
          this.goal = this.goal || blockTitle(block, mentionTrigger(p));
          this.contextLines = ancestorLines(lines, block.start);
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

    if (!this.projectName && this.cwd) {
      this.projectName = resolveSessionProject({ cwd: this.cwd });
    }
    if (!this.cwd) this.cwd = p.vaultPath || "";

    const savedByProj = p.settings?.projectTeams?.byProject || {};
    if (this.projectName && savedByProj[this.projectName]) {
      this.presetId = savedByProj[this.projectName];
    }
    this.syncStewardFromSettings();

    if (!this.subtasks.length && this.goal) {
      this.applyFallbackPlan();
    }
    this.render();
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
      availableAgents: this.availableAgents,
      limitAgents: this.limitAgents,
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
    const defaultAgent = this.availableAgents.includes(this.plugin.defaultTarget?.())
      ? this.plugin.defaultTarget()
      : (this.availableAgents[0] || "claude");
    const plan = fallbackCopilotPlan({ goal: this.goal, roles, defaultAgent });
    this.subtasks = plan.subtasks.map((item) => ({
      ...item,
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
    const defaultAgent = this.availableAgents.includes(this.plugin.defaultTarget?.())
      ? this.plugin.defaultTarget()
      : (this.availableAgents[0] || "claude");
    try {
      const prompt = buildCopilotPlanPrompt({
        goal: this.goal,
        projectName: this.projectName,
        cwd: this.cwd,
        contextLines: this.contextLines,
        roles,
        availableAgents: this.availableAgents,
      });
      const raw = await runJournalModel(prompt, this.plugin.settings, { polish: true });
      const parsed = parseCopilotPlanResponse(raw, {
        availableAgents: this.availableAgents,
        roles,
        defaultAgent,
      });
      if (parsed?.subtasks?.length) {
        this.subtasks = parsed.subtasks.map((item) => ({
          ...item,
          destination: this.teamDestination(item.agent),
        }));
      } else {
        this.applyFallbackPlan();
        new Notice(t("模型返回未按结构化格式输出，已按小队角色生成可编辑草案"));
      }
    } catch (e) {
      this.applyFallbackPlan();
      new Notice(t("未连上整理模型，已按小队角色生成可编辑草案：{msg}", { msg: e.message || e }), 5000);
    } finally {
      this.planning = false;
      this.render();
    }
  }

  async commitTasks({ dispatch = false } = {}) {
    const active = this.subtasks.filter((s) => s.checked !== false && String(s.title || "").trim());
    if (!active.length) {
      new Notice(t("请至少保留一条要写入的子任务"));
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
        enableBoard: active.length >= 2,
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
      this.close();
    } catch (e) {
      this.dispatching = false;
      this.render();
      new Notice(String(e.message || e), 6000);
    }
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    const presets = resolveTeamPresets(this.plugin.settings);
    const roles = this.resolvedRoles();

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
    projInput.oninput = () => { this.projectName = projInput.value.trim(); };

    const cwdField = metaGrid.createDiv({ cls: "ad-field" });
    cwdField.createDiv({ cls: "ad-field__label", text: t("工作目录 (cwd)") });
    const cwdInput = cwdField.createEl("input", {
      cls: "ad-input",
      attr: { type: "text", placeholder: this.plugin.vaultPath || "", value: this.cwd },
    });
    cwdInput.oninput = () => { this.cwd = cwdInput.value; };

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
        this.targetPath = journalPath(this.app, this.plugin.settings);
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
      for (const id of this.availableAgents) {
        const suffix = this.limitAgents.has(id) ? ` (${t("限额")})` : "";
        sel.createEl("option", { text: `${AGENTS[id]?.short || id}${suffix}`, attr: { value: id } });
      }
      sel.value = role.agent;
      sel.onchange = () => {
        this.roleOverrides[role.id] = sel.value;
        this.saveTeamPreference();
        this.render();
      };
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
    const activeSteward = this.availableAgents.includes(this.stewardAgent)
      ? this.stewardAgent
      : (this.availableAgents[0] || "claude");
    agentIcon(stewardPick.createSpan({ cls: "ad-glyph" }), activeSteward);
    const stewardSel = stewardPick.createEl("select", { cls: "ad-input ad-wb-select" });
    for (const id of this.availableAgents) {
      const suffix = this.limitAgents.has(id) ? ` (${t("限额")})` : "";
      stewardSel.createEl("option", { text: `${AGENTS[id]?.short || id}${suffix}`, attr: { value: id } });
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

    const planBar = goalField.createDiv({ cls: "ad-wb-planbar" });
    const aiBtn = planBar.createEl("button", {
      cls: "ad-btn ad-btn--cta",
      attr: { type: "button" },
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
      const fallbackAgent = roles[0]?.agent || this.availableAgents[0] || "claude";
      this.subtasks.push({
        checked: true,
        title: "",
        role: t("新增任务"),
        agent: fallbackAgent,
        destination: this.teamDestination(fallbackAgent),
        detail: "",
      });
      this.render();
    };

    // 4. Editable draft list
    const draftField = contentEl.createDiv({ cls: "ad-field" });
    const checkedCount = this.subtasks.filter((s) => s.checked !== false && String(s.title || "").trim()).length;
    draftField.createDiv({ cls: "ad-field__label", text: t("待派发子任务草案（{n} 条已选）", { n: checkedCount }) });
    const list = draftField.createDiv({ cls: "ad-wb-tasks" });
    if (!this.subtasks.length) {
      list.createDiv({ cls: "ad-hint", text: t("输入目标后点击「AI 副驾拆解并配队」或「按小队快速拆分」生成子任务草案。") });
    }
    this.subtasks.forEach((item, idx) => {
      const row = list.createDiv({ cls: "ad-wb-task" });
      const top = row.createDiv({ cls: "ad-wb-task__top" });

      const cb = top.createEl("input", { attr: { type: "checkbox" } });
      cb.checked = item.checked !== false;
      cb.onchange = () => { item.checked = cb.checked; this.render(); };

      const titleIn = top.createEl("input", {
        cls: "ad-input ad-wb-task__title",
        attr: { type: "text", placeholder: t("子任务标题"), value: item.title || "" },
      });
      titleIn.oninput = () => { item.title = titleIn.value; };

      const agentSel = top.createEl("select", { cls: "ad-input ad-wb-select" });
      for (const id of this.availableAgents) {
        agentSel.createEl("option", { text: AGENTS[id]?.short || id, attr: { value: id } });
      }
      agentSel.value = this.availableAgents.includes(item.agent) ? item.agent : (this.availableAgents[0] || "claude");
      agentSel.onchange = () => {
        item.agent = agentSel.value;
        item.destination = this.teamDestination(item.agent);
        this.render();
      };

      const destSel = top.createEl("select", { cls: "ad-input ad-wb-select" });
      const destOpts = destinations(item.agent);
      for (const d of destOpts) destSel.createEl("option", { text: d.label, attr: { value: d.id } });
      destSel.value = destOpts.some((d) => d.id === item.destination) ? item.destination : (destOpts[0]?.id || "background");
      destSel.onchange = () => { item.destination = destSel.value; };

      const delBtn = top.createEl("button", { cls: "ad-linkbtn", text: "×", attr: { type: "button", title: t("移除") } });
      delBtn.onclick = () => { this.subtasks.splice(idx, 1); this.render(); };

      const detailIn = row.createEl("input", {
        cls: "ad-input ad-wb-task__detail",
        attr: { type: "text", placeholder: t("补充要求或验收标准（可选）"), value: item.detail || "" },
      });
      detailIn.oninput = () => { item.detail = detailIn.value; };
    });

    // Footer
    const foot = contentEl.createDiv({ cls: "ad-modalfoot" });
    const cancel = foot.createEl("button", { cls: "ad-btn ad-btn--ghost", text: t("取消"), attr: { type: "button" } });
    cancel.onclick = () => this.close();

    const saveOnly = foot.createEl("button", { cls: "ad-btn ad-btn--ghost", text: t("仅写入 Markdown"), attr: { type: "button" } });
    saveOnly.disabled = this.dispatching || !checkedCount;
    saveOnly.onclick = () => this.commitTasks({ dispatch: false });

    const go = foot.createEl("button", { cls: "ad-btn ad-btn--cta", attr: { type: "button" } });
    setLucide(go.createSpan({ cls: "ad-btn__icon" }), "send");
    go.createSpan({ text: this.dispatching ? t("正在派发…") : t("写入并并发派发 ({n})", { n: checkedCount }) });
    go.disabled = this.dispatching || !checkedCount;
    go.onclick = () => this.commitTasks({ dispatch: true });
  }

  onClose() {
    this.contentEl.empty();
  }
}
