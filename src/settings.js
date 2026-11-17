import { settingsAgentOrder, moveSettingsAgent } from "./settings-agents.js";
import { changeLogDetail } from "./log-detail.js";
import { JOURNAL_LAYOUT_DEFAULT, journalLayout, builtinJournalLayout, configuredJournalLayout } from "./journal-layout.js";
// Agent Deck — settings: Delegation, Recording, Dreaming, Experiments, and About.

import { archivePath } from "./journal-archive.js";
import * as obsidianNs from "obsidian";
import { App, PluginSettingTab, Notice, Modal, Menu } from "obsidian";
import {
  AGENTS, AGENT_ORDER, MODEL_CATALOG, EFFORTS, CLAUDE_PERMISSIONS, DEFAULTS, DEFAULT_RECORD_RULES, resolveRecordRules, fmtTok, syncDelegationSettings, journalPath, detectJournalFormat,
} from "./constants.js";
import { notePath } from "./dream-entries.js";
import { companionInstalled, dreamModelConfig } from "./dream.js";
import { externalMemoryPath } from "./dream-sharing.js";
import { agentIcon, setLucide } from "./icons.js";
import { t, currentLanguage } from "./i18n.js";
import { syncModelGroups } from "./model-groups.js";
import { ManagedTimers } from "./runtime-guard.js";
import { delegateAgents } from "./agent-registry.js";
import {
  detectJournalProviders, resolveJournalProvider, JOURNAL_PROVIDERS, API_PRESETS, fetchAgyModels, testJournalModel,
} from "./llm.js";
import { discoverGrokBotStorage } from "./grok-bot-sessions.js";
import { folderExists, normalizeProjectFolder, projectFolderEntries } from "./project-folders.js";

const HOTKEY_MOD_SYMBOL = { control: "⌃", option: "⌥", shift: "⇧", command: "⌘", ctrl: "⌃", alt: "⌥", cmd: "⌘" };

function hotkeyDisplay(spec) {
  const parts = String(spec || DEFAULTS.menuBarHotkey).split("+").map((x) => x.trim()).filter(Boolean);
  return parts.map((p) => HOTKEY_MOD_SYMBOL[p.toLowerCase()] || p.toUpperCase()).join("");
}

function hotkeyKeyFromEvent(event) {
  const key = String(event.key || "");
  if (/^[a-zA-Z]$/.test(key)) return key.toUpperCase();
  if (/^[0-9]$/.test(key)) return key;
  if (/^F([1-9]|1[0-2])$/i.test(key)) return key.toUpperCase();
  return null;
}

function hotkeySpecFromEvent(event, key) {
  const mods = [];
  if (event.ctrlKey) mods.push("control");
  if (event.altKey) mods.push("option");
  if (event.shiftKey) mods.push("shift");
  if (event.metaKey) mods.push("command");
  return [...mods, key].join("+");
}

function catalogSnapshot(src = {}) {
  return {
    enabled: [...(src.enabled || [])],
    pinned: [...(src.pinned || [])],
    order: [...(src.order || [])],
    custom: JSON.parse(JSON.stringify(src.custom || [])),
  };
}

export const TABS = [
  ["delegate", "委派", "send"],
  ["record", "记录", "radar"],
  ["dream", "Dreaming", "moon"],
  ["experimental", "实验功能", "flask-conical"],
  ["about", "关于", "info"],
];

export class AgentDeckSettingsTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.tab = "delegate";
    this.draft = null;
    this.filter = "all";
    this.search = "";
    this.subOpen = {};
    this._timers = new ManagedTimers();
  }

  normalizeTab(tab) {
    if (tab === "models") return "delegate";
    if (tab === "agents" || tab === "tracking" || tab === "record") return "record";
    if (tab === "dream" || tab === "about" || tab === "delegate" || tab === "experimental") return tab;
    return "delegate";
  }

  openTab(tab) {
    if (tab === "models") {
      this.tab = "delegate";
      this._scrollToModels = true;
    } else {
      this.tab = this.normalizeTab(tab);
    }
  }

  hide() {
    this._timers?.dispose();
    this._dreamTimer = null;
    this._aboutComp?.unload?.();
    this._aboutComp = null;
  }

  display() {
    this.hide();
    this._timers = new ManagedTimers();
    if (this.tab === "models") this._scrollToModels = true;
    this.tab = this.normalizeTab(this.tab);
    syncDelegationSettings(this.plugin.settings);
    const { containerEl } = this;
    const active = (containerEl.ownerDocument || document).activeElement;
    const focusSearch = !!(active && active.classList && active.classList.contains("ad-search__input"));
    if (this._draftBar) { try { this._draftBar.remove(); } catch { /* gone */ } this._draftBar = null; }
    containerEl.empty();
    containerEl.addClass("ad-settings");
    const head = containerEl.createDiv({ cls: "ad-set-head" });
    const brand = head.createDiv({ cls: "ad-brand" });
    const brandMark = brand.createSpan({ cls: "ad-brand__mark" });
    setLucide(brandMark, "wand-sparkles");
    const bt = brand.createDiv({ cls: "ad-brand__text" });
    bt.createDiv({ cls: "ad-brand__name", text: "Agent Deck" });
    bt.createDiv({ cls: "ad-brand__sub", text: `${t("智能体甲板")} · v${this.plugin.manifest.version}` });

    const nav = containerEl.createDiv({ cls: "ad-set-nav" });
    const dirty = this.isDraftDirty();
    for (const [id, label, icon] of TABS) {
      const isDirtyTab = id === "delegate" && dirty;
      const text = isDirtyTab ? `${t(label)} ·` : t(label);
      const b = nav.createEl("button", { cls: "ad-set-tab" + (this.tab === id ? " is-on" : "") + (isDirtyTab ? " is-dirty" : "") });
      const ic = b.createSpan({ cls: "ad-tabicon" });
      setLucide(ic, icon);
      b.createSpan({ text });
      b.onclick = () => { this.tab = id; this.display(); };
    }
    const body = containerEl.createDiv({ cls: "ad-set-body" });
    if (this.tab === "delegate") {
      this.renderDelegate(body);
      this.renderDraftBar(body);
    } else if (this.tab === "record") {
      this.renderRecord(body);
    } else if (this.tab === "dream") {
      this.renderDream(body);
    } else if (this.tab === "experimental") {
      this.renderExperimental(body);
    } else {
      this.renderAbout(body);
    }
    if (this._scrollToModels) {
      const mc = containerEl.querySelector?.(".ad-models-card");
      if (mc?.scrollIntoView) mc.scrollIntoView({ block: "start" });
      this._scrollToModels = false;
    }
    if (focusSearch) {
      const i = containerEl.querySelector(".ad-search__input");
      if (i) { i.focus(); try { i.setSelectionRange(i.value.length, i.value.length); } catch { /* range */ } }
    }
  }

  // ---------- shared bits ----------
  card(parent, title, sub) {
    const c = parent.createDiv({ cls: "ad-card" });
    if (title) {
      const h = c.createDiv({ cls: "ad-card__head" });
      h.createDiv({ cls: "ad-card__title", text: title });
      if (sub) h.createDiv({ cls: "ad-card__sub", text: sub });
    }
    return c;
  }

  agentCard(parent, agent, title, sub = "") {
    const state = this.plugin.settings.ui.delegateGroups[agent];
    const card = parent.createEl("details", { cls: "ad-card ad-delegate-agent" });
    card.dataset.agent = agent;
    card.open = state.open;
    card.ontoggle = () => {
      if (!card.isConnected || this.plugin.settings.ui.delegateGroups[agent] !== state || state.open === card.open) return;
      state.open = card.open;
      this.plugin.saveSettings();
    };
    const head = card.createEl("summary", { cls: "ad-card__head" });
    agentIcon(head.createSpan({ cls: "ad-glyph" }), agent);
    head.createSpan({ cls: "ad-card__title", text: title });
    const body = card.createDiv({ cls: "ad-delegate-agent__body" });
    if (sub) body.createDiv({ cls: "ad-card__sub", text: sub });
    return body;
  }

  sortHandle(parent, grid, section, agent) {
    const grip = parent.createEl("button", { cls: "ad-settings-grip", attr: { type: "button", draggable: "true", "aria-label": t("拖动排序；方向键调整位置"), title: t("拖动排序；方向键调整位置") } });
    grip.dataset.agent = agent;
    setLucide(grip, "grip-vertical");
    grip.ondragstart = event => {
      event.stopPropagation();
      this._settingsDrag = { section, agent };
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-agent-deck-settings-agent", JSON.stringify(this._settingsDrag));
    };
    grip.ondragend = () => {
      this._settingsDrag = null;
      grid.querySelectorAll(".is-drop-target").forEach(el => el.classList.remove("is-drop-target"));
    };
    grip.onkeydown = async event => {
      if (!["ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const enabled = id => this.plugin.agentEnabled(id);
      const order = settingsAgentOrder(this.plugin.settings, section, enabled).filter(id => section !== "tracking" || enabled(id) === enabled(agent));
      const after = ["ArrowDown", "ArrowRight"].includes(event.key), target = order[order.indexOf(agent) + (after ? 1 : -1)];
      if (target) await this.moveSettingAgent(section, agent, target, after);
      this.containerEl?.querySelector(`.ad-settings-grip[data-agent="${agent}"]`)?.focus();
    };
    return grip;
  }

  agentReorder(grid, section, selector) {
    grid.ondragover = event => {
      if (this._settingsDrag?.section !== section) return;
      const target = event.target.closest(selector);
      if (!target || !grid.contains(target)) return;
      if (section === "tracking" && this.plugin.agentEnabled(this._settingsDrag.agent) !== this.plugin.agentEnabled(target.dataset.agent)) return;
      event.preventDefault(); event.dataTransfer.dropEffect = "move";
      grid.querySelectorAll(".is-drop-target").forEach(el => el.classList.remove("is-drop-target"));
      target.classList.add("is-drop-target");
    };
    grid.ondrop = async event => {
      const drag = this._settingsDrag;
      if (drag?.section !== section) return;
      event.preventDefault(); event.stopPropagation();
      const target = event.target.closest(selector);
      this._settingsDrag = null;
      grid.querySelectorAll(".is-drop-target").forEach(el => el.classList.remove("is-drop-target"));
      if (!target || !grid.contains(target)) return;
      const rect = target.getBoundingClientRect();
      const after = section === "tracking" ? event.clientY > rect.top + rect.height / 2 : event.clientX > rect.left + rect.width / 2;
      await this.moveSettingAgent(section, drag.agent, target.dataset.agent, after);
    };
  }

  async moveSettingAgent(section, agent, target, after) {
    if (!moveSettingsAgent(this.plugin.settings, section, agent, target, after, id => this.plugin.agentEnabled(id))) return;
    await this.plugin.saveSettings();
    this.display();
  }

  subDetails(parent, key, title, defaultOpen = false) {
    const d = parent.createEl("details", { cls: "ad-subdetails" });
    d.dataset.section = key;
    d.open = this.subOpen[key] ?? defaultOpen;
    d.ontoggle = () => { if (d.isConnected) this.subOpen[key] = d.open; };
    const sum = d.createEl("summary", { cls: "ad-subdetails__head" });
    sum.createSpan({ text: title });
    return d.createDiv({ cls: "ad-subdetails__body" });
  }

  row(parent, name, desc, right) {
    const r = parent.createDiv({ cls: "ad-row" });
    const left = r.createDiv({ cls: "ad-row__left" });
    left.createDiv({ cls: "ad-row__name", text: name });
    if (desc) left.createDiv({ cls: "ad-row__desc", text: desc });
    const rr = r.createDiv({ cls: "ad-row__right" });
    if (typeof right === "function") right(rr, r);
    else if (typeof right === "string") rr.createSpan({ cls: "ad-row__value", text: right });
    else if (right) rr.appendChild(right);
    return r;
  }

  rowToggle(parent, name, desc, value, onChange, disabled = false) {
    let el;
    this.row(parent, name, desc, (rr) => { el = this.toggle(rr, value, onChange, disabled); });
    return el;
  }

  rowSegmented(parent, name, desc, options, value, onChange, cls = "") {
    let el;
    this.row(parent, name, desc, (rr) => { el = this.segmented(rr, options, value, onChange, cls); });
    return el;
  }

  rowSelect(parent, name, desc, options, value, onChange, cls = "") {
    let el;
    this.row(parent, name, desc, (rr) => { el = this.selectInput(rr, options, value, onChange, cls); });
    return el;
  }

  rowText(parent, name, desc, value, placeholder, onChange, cls = "") {
    let el;
    this.row(parent, name, desc, (rr) => { el = this.textInput(rr, value, placeholder, onChange, cls); });
    return el;
  }

  rowNumber(parent, name, desc, value, min, max, onChange) {
    let el;
    this.row(parent, name, desc, (rr) => { el = this.numberInput(rr, value, min, max, onChange); });
    return el;
  }

  detectedProviderChoices(detected, firstOption) {
    return [
      firstOption,
      ...detected.providers.map((x) => ({
        id: x.id,
        label: `${x.label} ${x.available ? t("（已登录）") : x.found ? t("（未登录）") : t("（未安装）")}`,
      })),
      { id: "api", label: t("自定义 API（OpenAI 兼容）") },
    ];
  }

  providerPresetRow(parent, { label, desc, resolved, emptyLabel, value, onChange, showAgyRefresh = false, agyPath = "" }) {
    const spec = JOURNAL_PROVIDERS[resolved];
    const presetModels = [...new Set([
      ...(resolved === "agy" && this._agyJournalModels?.length ? this._agyJournalModels : []),
      ...(spec?.models || []),
    ])];
    if (resolved === "api" || !presetModels.length) return;
    this.row(parent, label, desc, (rr) => {
      this.selectInput(
        rr,
        [{ id: "", label: emptyLabel }, ...presetModels.map((m) => ({ id: m, label: m }))],
        presetModels.includes(value) ? value : "",
        onChange,
      );
      if (showAgyRefresh && resolved === "agy") {
        this.bigButton(rr, t("刷新列表"), async () => {
          const list = await fetchAgyModels(agyPath);
          if (!list.length) return new Notice(t("没有读到可用 agy 模型"));
          this._agyJournalModels = list;
          new Notice(t("已读取 {n} 个 agy 模型", { n: list.length }));
          this.display();
        });
      }
    });
  }

  renderModelTestRow(parent, { label, desc, value, placeholder, wide, onChange, pendingText, testFn }) {
    this.row(parent, label, desc, (rr) => {
      this.textInput(rr, value, placeholder, onChange, wide ? "ad-input--wide" : "");
      this.bigButton(rr, t("测试连接"), async () => {
        new Notice(pendingText, 2500);
        try {
          const reply = await testFn();
          new Notice(t("整理模型可用：{reply}", { reply: reply.slice(0, 60) || "OK" }), 5000);
        } catch (e) {
          new Notice(t("整理模型不可用：{msg}", { msg: e?.message || String(e) }), 8000);
        }
      });
    });
  }

  renderApiCredentialsAndEffort(parent, { showApi, showEffort, urlLabel, urlValue, onUrlChange, keyLabel, keyValue, onKeyChange, effortLabel, effortValue, onEffortChange }) {
    if (showApi) {
      this.rowText(parent, urlLabel, t("填写服务商接口地址（自动补齐 /chat/completions）"), urlValue, "https://api.deepseek.com", onUrlChange, "ad-input--wide");
      const keyInput = this.rowText(parent, keyLabel, t("保存于插件设置 data.json 中"), keyValue, t("输入 API Key（本地 Ollama 可留空）"), onKeyChange, "ad-input--wide");
      keyInput.type = "password";
    } else if (showEffort) {
      this.rowSegmented(parent, effortLabel, "", EFFORTS.codex, effortValue, onEffortChange);
    }
  }

  toggle(parent, value, onChange, disabled = false) {
    const b = parent.createEl("button", { cls: "ad-switch" + (value ? " is-on" : "") + (disabled ? " is-disabled" : ""), attr: { role: "switch", "aria-checked": String(!!value) } });
    b.createSpan({ cls: "ad-switch__knob" });
    let on = !!value;
    b.setOn = (v) => { on = !!v; b.classList.toggle("is-on", on); b.setAttribute("aria-checked", String(on)); };
    if (!disabled) b.onclick = () => { b.setOn(!on); onChange(on); };
    return b;
  }

  segmented(parent, options, value, onChange, cls = "") {
    const box = parent.createDiv({ cls: "ad-seg " + (options.length > 2 ? "ad-seg--many " : "") + cls });
    for (const opt of options) {
      const b = box.createEl("button", { cls: "ad-seg__btn" + (opt.id === value ? " is-on" : ""), text: opt.label, attr: { "aria-pressed": String(opt.id === value) } });
      b.title = opt.hint || "";
      b.onclick = () => {
        for (const choice of box.children) {
          choice.classList.toggle("is-on", choice === b);
          choice.setAttribute("aria-pressed", String(choice === b));
        }
        onChange(opt.id);
      };
    }
    return box;
  }

  selectInput(parent, options, value, onChange, cls = "") {
    const sel = parent.createEl("select", { cls: "ad-select" + (cls ? " " + cls : "") });
    for (const opt of options) {
      const o = sel.createEl("option", { text: opt.label, attr: { value: opt.id } });
      if (opt.id === value) o.selected = true;
    }
    sel.onchange = () => onChange(sel.value);
    return sel;
  }

  textInput(parent, value, placeholder, onChange, cls = "") {
    const input = parent.createEl("input", { cls: "ad-input " + cls, attr: { value: value || "", placeholder: placeholder || "" } });
    input.onchange = () => onChange(input.value);
    return input;
  }

  numberInput(parent, value, min, max, onChange) {
    const input = parent.createEl("input", { cls: "ad-input ad-input--num", attr: { type: "number", value: String(value), min: String(min), max: String(max) } });
    input.onchange = () => { const n = Number(input.value); if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n))); };
    return input;
  }

  bigButton(parent, label, onClick, cls = "") {
    const b = parent.createEl("button", { cls: "ad-btn " + cls, text: label });
    b.onclick = onClick;
    return b;
  }

  // ---------- Delegation ----------
  renderDelegate(body) {
    const p = this.plugin;
    const s = p.settings;
    const d = s.delegate;

    if (syncModelGroups(s, id => p.agentEnabled(id))) p.saveSettings();

    // 1. 委派 → 默认目标
    const destinations = this.card(body, t("默认委派到"), t("追踪主力与默认委派分别设置"));
    const targetRow = destinations.createDiv({ cls: "ad-targetpick" });
    for (const id of settingsAgentOrder(s, "delegation", id => p.agentEnabled(id))) {
      const a = AGENTS[id];
      const available = id !== "workbuddy" && !a.trackingOnly;
      const item = targetRow.createDiv({ cls: "ad-settings-target" });
      item.dataset.agent = id;
      this.sortHandle(item, targetRow, "delegation", id);
      const b = item.createEl(available ? "button" : "div", { cls: "ad-target" + (available && p.defaultTarget() === id ? " is-on" : ""), attr: { "data-agent": id } });
      if (available) b.setAttribute("aria-pressed", String(p.defaultTarget() === id));
      b.style.setProperty("--ad-agent", a.color);
      b.style.setProperty("--ad-agent-soft", a.soft);
      agentIcon(b.createSpan({ cls: "ad-glyph" }), id);
      b.createSpan({ text: a.name });
      b.createSpan({ cls: "ad-target__hint", text: a.trackingOnly ? t("暂不支持委派") : id === "workbuddy" ? t("客户端交接") : id === "claude" ? t("桌面版 / 后台") : id === "codex" ? t("桌面版 / 终端") : id === "qoder" ? t("桌面版 / CLI") : t("ACP / 自带账号") });
      if (available) b.onclick = async () => { d.target = id; await p.saveSettings(); this.display(); };
    }

    this.agentReorder(targetRow, "delegation", ".ad-settings-target");

    // 管家汇总：看板一次派发多条时会额外起一个汇总会话；这里决定用谁，或直接关掉。
    const stewardNow = s.projectTeams?.stewards?.default || {};
    const stewardCard = this.card(body, t("管家汇总"), t("看板一次派发多条任务时，额外起一个会话汇总进度。默认用「默认委派到」那个 Agent；这里可以单独指定或关掉，避免占错配额。"));
    this.rowSelect(
      stewardCard,
      t("管家 Agent"),
      t("选「关闭」就不自动起管家会话"),
      [{ id: "off", label: t("关闭") }, ...settingsAgentOrder(s, "delegation", (id) => p.agentEnabled(id) && !AGENTS[id].trackingOnly).map((id) => ({ id, label: AGENTS[id].name }))],
      stewardNow.enabled === false || !stewardNow.agent ? "off" : stewardNow.agent,
      (v) => {
        s.projectTeams ||= {};
        s.projectTeams.stewards ||= {};
        s.projectTeams.stewards.default = v === "off" ? { enabled: false } : { enabled: true, agent: v };
        p.saveSettings();
      },
    );

    const projectCard = this.card(body, t("项目文件夹"), t("派活时按项目选目录；笔记里的双链、路径或「项目 -> 标题」也能认出项目，笔记项目优先于各 Agent 的默认目录。Codex 会把会话归到同名项目。"));
    this.rowToggle(projectCard, t("按项目文件夹派活"), t("从笔记认出项目后，派到这个项目的目录；认不出再用各 Agent 的默认目录或库根"), s.autoProjectFolder !== false, (v) => { s.autoProjectFolder = v; p.saveSettings(); });
    this.rowToggle(projectCard, t("非日记笔记的派发也记进当天日记"), t("默认不记，结论仍写回原笔记；打开后和普通会话一样进当天日记"), s.noteDispatchJournal === true, (v) => { s.noteDispatchJournal = v; p.saveSettings(); });
    this.renderProjectFolders(projectCard);

    // 2. 委派 → 各 Agent
    const claude = this.agentCard(body, "claude", "Claude Code", "");
    this.modelSelect(claude, "claude", p.defaultModel("claude"), (v) => { this.setDefaultModel("claude", v); this.display(); });
    this.effortControl(claude, "claude", d.claude.effort, (v) => { this.setDefaultEffort("claude", v); this.display(); });
    this.rowSegmented(claude, t("权限模式"), t("plan：规划；auto：自动判断；acceptEdits：允许修改文件"), CLAUDE_PERMISSIONS, d.claude.permission, (v) => { d.claude.permission = v; p.saveSettings(); this.display(); });
    const claudeMore = this.subDetails(claude, "claude-more", t("更多设置"));
    this.rowText(claudeMore, t("命令行路径"), t("留空自动查找"), d.claude.path || "", t("自动查找"), (v) => { d.claude.path = v.trim(); p.saveSettings(); }, "ad-input--wide");
    this.rowText(claude, t("工作目录"), t("留空使用库根目录"), d.claude.cwd, t("留空 = 库根目录"), (v) => { d.claude.cwd = v.trim(); p.saveSettings(); }, "ad-input--wide");
    this.rowToggle(claudeMore, t("完成后自动在桌面版打开"), "", d.claude.openDesktop === true, (v) => { d.claude.openDesktop = v; p.saveSettings(); });
    this.rowToggle(claudeMore, t("把当前库也加进可读目录"), "", d.claude.addVault !== false, (v) => { d.claude.addVault = v; p.saveSettings(); });
    this.rowToggle(claudeMore, t("库没被信任时自动换个目录"), t("使用已信任目录，并添加当前库的访问路径"), d.claude.autoTrustedCwd !== false, (v) => { d.claude.autoTrustedCwd = v; p.saveSettings(); });
    this.rowToggle(claudeMore, t("使用 claude --bg 后台服务"), t("由 Claude 后台服务管理会话"), d.claude.useBackground === true, (v) => { d.claude.useBackground = v; p.saveSettings(); });
    this.rowText(claudeMore, t("额外参数"), t("传给 Claude CLI 的参数"), d.claude.extraArgs, t("可留空"), (v) => { d.claude.extraArgs = v; p.saveSettings(); }, "ad-input--wide");
    const test = claudeMore.createDiv({ cls: "ad-btnrow" });
    this.bigButton(test, t("检查 claude"), async () => { const r = await p.checkBinary("claude"); new Notice(r, 6000); });
    this.bigButton(test, t("在终端里续这个目录"), () => p.openTerminalAt(d.claude.cwd || p.vaultPath, "claude"));

    claude.appendChild(claudeMore.parentElement);

    const codex = this.agentCard(body, "codex", "Codex", "");
    this.rowSegmented(codex, t("派发到"), "", [{ id: "desktop", label: t("Codex 桌面版") }, { id: "terminal", label: t("终端") }], d.codex.transport || "desktop", (v) => { d.codex.transport = v; p.saveSettings(); this.display(); });
    this.modelSelect(codex, "codex", p.defaultModel("codex"), (v) => { this.setDefaultModel("codex", v); this.display(); });
    this.effortControl(codex, "codex", d.codex.effort, (v) => { this.setDefaultEffort("codex", v); this.display(); });
    this.rowSegmented(codex, t("沙箱模式"), t("read-only：只读；workspace-write：允许修改工作目录"), ["read-only", "workspace-write"].map((id) => ({ id, label: id })), d.codex.sandbox, (v) => { d.codex.sandbox = v; p.saveSettings(); this.display(); });
    const codexMore = this.subDetails(codex, "codex-more", t("更多设置"));
    for (const [key, label, hint] of [["path", t("codex 程序路径"), t("桌面模式留空优先使用 Desktop 自带程序；终端模式从 PATH 查找")], ["cwd", t("工作目录"), t("留空 = 库根目录")]]) {
      this.rowText(key === "cwd" ? codex : codexMore, label, hint, d.codex[key], hint, (v) => { d.codex[key] = v.trim(); p.saveSettings(); }, "ad-input--wide");
    }
    this.bigButton(codexMore.createDiv({ cls: "ad-btnrow" }), t("检查 codex"), async () => new Notice(await p.checkBinary("codex"), 6000));
    this.rowToggle(codexMore, t("把会话归到 Codex 项目"), t("同目录已有项目就复用，没有就用项目名建一个；项目接口是实验性的，失败时按原样派发"), d.codex.project !== false, (v) => { d.codex.project = v; p.saveSettings(); });

    codex.appendChild(codexMore.parentElement);

    const dsh = this.agentCard(body, "dsh", "DeepSeek Harness", "");
    this.modelSelect(dsh, "dsh", p.defaultModel("dsh"), (v) => { this.setDefaultModel("dsh", v); this.display(); });
    this.effortControl(dsh, "dsh", d.dsh.effort, (v) => { this.setDefaultEffort("dsh", v); this.display(); });
    this.rowToggle(dsh, t("自动允许工具调用"), t("关闭后逐次确认工具权限"), d.dsh.autoApprove === true, (v) => { d.dsh.autoApprove = v; p.saveSettings(); });
    const dshMore = this.subDetails(dsh, "dsh-more", t("更多设置"));
    this.rowText(dshMore, t("命令行路径"), t("留空自动查找"), d.dsh.path || "", t("自动查找"), (v) => { d.dsh.path = v.trim(); p.saveSettings(); }, "ad-input--wide");
    this.rowText(dsh, t("工作目录"), t("留空使用库根目录"), d.dsh.cwd, t("留空 = 库根目录"), (v) => { d.dsh.cwd = v.trim(); p.saveSettings(); }, "ad-input--wide");
    this.rowText(dshMore, t("额外 ACP 参数"), t("可留空"), d.dsh.extraArgs, t("可留空"), (v) => { d.dsh.extraArgs = v; p.saveSettings(); }, "ad-input--wide");
    const dtest = dshMore.createDiv({ cls: "ad-btnrow" });
    this.bigButton(dtest, t("读取 Harness 可用模型"), async () => {
      try { const models = await p.refreshDshModels(); new Notice(t("已读取 {n} 个模型，包含 Harness 中配置的自定义模型", { n: models.length })); this.display(); }
      catch (e) { new Notice(t("读取失败：{msg}", { msg: e.message }), 8000); }
    });
    this.bigButton(dtest, t("检查 dsh"), async () => { const r = await p.checkBinary("dsh"); new Notice(r, 6000); });

    dsh.appendChild(dshMore.parentElement);

    const agy = this.agentCard(body, "antigravity", "Antigravity ACP", t("安装 agy CLI 后运行 agy acp --login 登录"));
    this.modelSelect(agy, "antigravity", p.defaultModel("antigravity"), (v) => { this.setDefaultModel("antigravity", v); this.display(); });
    this.effortControl(agy, "antigravity", d.antigravity.effort, (v) => { this.setDefaultEffort("antigravity", v); this.display(); });
    const agyMore = this.subDetails(agy, "agy-more", t("更多设置"));
    for (const [key, label, hint] of [["path", t("agy 程序路径"), t("留空自动查找，例如 ~/.local/bin/agy")], ["cwd", t("工作目录"), t("留空 = 库根目录")]]) {
      this.rowText(key === "cwd" ? agy : agyMore, label, hint, d.antigravity[key], hint, (v) => { d.antigravity[key] = v.trim(); p.saveSettings(); }, "ad-input--wide");
    }
    const atest = agyMore.createDiv({ cls: "ad-btnrow" });
    this.bigButton(atest, t("读取 Antigravity 可用模型"), async () => {
      try { const models = await p.refreshAcpModels("antigravity"); new Notice(t("已读取 {n} 个模型", { n: models.length })); this.display(); }
      catch (e) { new Notice(t("读取失败：{msg}", { msg: e.message }), 8000); }
    });
    this.bigButton(atest, t("检查 agy"), async () => new Notice(await p.checkBinary("antigravity"), 6000));

    agy.appendChild(agyMore.parentElement);

    const opencode = this.agentCard(body, "opencode", "OpenCode", t("通过 OpenCode.app 内置的 opencode-cli acp 后台委派，也可打开桌面端或终端"));
    this.modelSelect(opencode, "opencode", p.defaultModel("opencode"), (v) => { this.setDefaultModel("opencode", v); this.display(); });
    this.effortControl(opencode, "opencode", d.opencode.effort, (v) => { this.setDefaultEffort("opencode", v); this.display(); });
    this.rowToggle(opencode, t("自动允许工具调用"), t("关闭后逐次确认工具权限"), d.opencode.autoApprove === true, (v) => { d.opencode.autoApprove = v; p.saveSettings(); });
    const opencodeMore = this.subDetails(opencode, "opencode-more", t("更多设置"));
    this.rowToggle(opencodeMore, t("完成后自动在桌面版打开"), "", d.opencode.openDesktop === true, (v) => { d.opencode.openDesktop = v; p.saveSettings(); });
    for (const [key, label, hint] of [["path", t("命令行路径"), t("留空自动查找（含 OpenCode.app 内置 CLI）")], ["cwd", t("工作目录"), t("留空 = 库根目录")], ["extraArgs", t("额外 ACP 参数"), t("可留空")]]) {
      this.rowText(key === "cwd" ? opencode : opencodeMore, label, hint, d.opencode[key] || "", hint, (v) => { d.opencode[key] = v.trim(); p.saveSettings(); }, "ad-input--wide");
    }
    const octest = opencodeMore.createDiv({ cls: "ad-btnrow" });
    this.bigButton(octest, t("读取 OpenCode 可用模型"), async () => {
      try { const models = await p.refreshAcpModels("opencode"); new Notice(t("已读取 {n} 个模型", { n: models.length })); this.display(); }
      catch (e) { new Notice(t("读取失败：{msg}", { msg: e.message }), 8000); }
    });
    this.bigButton(octest, t("检查 opencode"), async () => new Notice(await p.checkBinary("opencode"), 6000));

    opencode.appendChild(opencodeMore.parentElement);

    const qoder = this.agentCard(body, "qoder", "Qoder", t("已登录 qodercli 时后台直接执行；未登录时自动复制任务并打开 Qoder 桌面版交接"));
    this.modelSelect(qoder, "qoder", p.defaultModel("qoder"), (v) => { this.setDefaultModel("qoder", v); this.display(); });
    this.effortControl(qoder, "qoder", d.qoder.effort, (v) => { this.setDefaultEffort("qoder", v); this.display(); });
    this.rowSegmented(qoder, t("权限模式"), t("plan：规划；auto：自动判断；acceptEdits：允许修改文件"), CLAUDE_PERMISSIONS, d.qoder.permission, (v) => { d.qoder.permission = v; p.saveSettings(); this.display(); });
    const qoderMore = this.subDetails(qoder, "qoder-more", t("更多设置"));
    for (const [key, label, hint] of [["path", t("命令行路径"), t("留空自动查找（~/.qoder/bin/qodercli/qodercli）")], ["cwd", t("工作目录"), t("留空 = 库根目录")], ["extraArgs", t("额外参数"), t("可留空")]]) {
      this.rowText(key === "cwd" ? qoder : qoderMore, label, hint, d.qoder[key] || "", hint, (v) => { d.qoder[key] = v.trim(); p.saveSettings(); }, "ad-input--wide");
    }
    const qtest = qoderMore.createDiv({ cls: "ad-btnrow" });
    this.bigButton(qtest, t("检查 qoder"), async () => new Notice(await p.checkBinary("qoder"), 6000));
    this.bigButton(qtest, t("登录 qoder CLI"), () => p.openTerminalAt(d.qoder.cwd || p.vaultPath, "qoder login"));

    qoder.appendChild(qoderMore.parentElement);

    const sharedAgents = this.card(body, t("公共终端与其余 Agent"), "");
    this.rowSelect(sharedAgents, t("主力终端"), t("用于终端委派和恢复会话"), [{ id: "auto", label: t("自动") }, { id: "terminal", label: t("系统终端") }, { id: "iterm", label: "iTerm2" }, { id: "warp", label: "Warp" }, { id: "tern", label: "Tern" }, { id: "herdr", label: "Herdr" }], s.cliTerminal || "auto", (v) => { s.cliTerminal = v; p.saveSettings(); this.display(); });
    this.rowToggle(sharedAgents, t("默认在终端委派"), t("适用于 Claude Code、Codex、OpenCode 和 Qoder"), !!s.delegateInTerminal, (v) => { s.delegateInTerminal = v; p.saveSettings(); p.refreshUI(); });
    for (const id of ["workbuddy"]) {
      const r = this.row(sharedAgents, AGENTS[id].name, "", t("客户端交接 · 在客户端选择模型"));
      r.dataset.agent = id;
    }

    // 3. 委派 → 管理模型
    this.renderModels(body);

    // 4. 委派 → 发送规则
    const rules = this.card(body, t("发送规则"), t("任务行 Agent 补全、提示词前后缀和委派附加要求"));
    this.rowToggle(rules, t("输入时显示候选菜单"), t("输入触发符选择 Agent、模型和强度"), d.mentionSuggest !== false, (v) => { d.mentionSuggest = v; p.saveSettings(); });
    const rulesMore = this.subDetails(rules, "rules-more", t("更多设置"));
    this.rowText(rulesMore, t("触发符号"), t("默认 @，前面需空格"), d.mentionTrigger || "@", "@", (v) => {
      const trigger = v.trim();
      if (!trigger || /[\s`\p{L}\p{N}]/u.test(trigger)) { new Notice(t("请填写不含空格、字母、数字或反引号的符号")); return; }
      d.mentionTrigger = trigger; p.saveSettings();
    });
    const pre = rulesMore.createDiv({ cls: "ad-field" });
    pre.createDiv({ cls: "ad-field__label", text: t("前缀") });
    const preTa = pre.createEl("textarea", { cls: "ad-textarea", attr: { placeholder: t("例如：先读一下相关文件，再动手。"), rows: "2" } });
    preTa.value = d.promptPrefix || "";
    preTa.onchange = () => { d.promptPrefix = preTa.value; p.saveSettings(); };
    const suf = rulesMore.createDiv({ cls: "ad-field" });
    suf.createDiv({ cls: "ad-field__label", text: t("后缀") });
    const sufTa = suf.createEl("textarea", { cls: "ad-textarea", attr: { placeholder: t("例如：做完把改动文件列出来。"), rows: "2" } });
    sufTa.value = d.promptSuffix || "";
    sufTa.onchange = () => { d.promptSuffix = sufTa.value; p.saveSettings(); };
    this.rowToggle(rules, t("委派附加要求"), t("追加到每次委派消息末尾"), d.confirmFirst !== false, (v) => { d.confirmFirst = v; p.saveSettings(); });
    const confirm = rulesMore.createDiv({ cls: "ad-field" });
    confirm.createDiv({ cls: "ad-field__label", text: t("附加要求正文（可自定义）") });
    const confirmTa = confirm.createEl("textarea", { cls: "ad-textarea", attr: { rows: "5" } });
    confirmTa.value = d.confirmFirstPrompt ?? DEFAULTS.delegate.confirmFirstPrompt;
    confirmTa.onchange = () => { d.confirmFirstPrompt = confirmTa.value; p.saveSettings(); };
    rules.appendChild(rulesMore.parentElement);
  }

  renderProjectFolders(card) {
    const p = this.plugin;
    const folders = (p.settings.projectFolders ||= {});
    const entries = projectFolderEntries(p.settings);
    if (!entries.length) card.createDiv({ cls: "ad-hint", text: t("还没有登记。在委派对话框里填一次目录，就会按项目名记住；也可以在这里直接加。") });
    for (const e of entries) {
      this.row(card, e.name, "", (rr) => {
        const input = rr.createEl("input", { cls: "ad-input ad-input--wide", attr: { type: "text", value: e.path } });
        input.onchange = () => {
          if (!folderExists(input.value)) { new Notice(t("目录不存在：{path}", { path: input.value })); return; }
          folders[e.name] = normalizeProjectFolder(input.value);
          p.saveSettings();
          this.display();
        };
        const remove = rr.createEl("button", { cls: "ad-btn ad-btn--ghost", text: t("移除"), attr: { type: "button" } });
        remove.onclick = () => { delete folders[e.name]; p.saveSettings(); this.display(); };
      });
    }
    const add = card.createDiv({ cls: "ad-btnrow" });
    const name = add.createEl("input", { cls: "ad-input", attr: { type: "text", placeholder: t("项目名") } });
    const dir = add.createEl("input", { cls: "ad-input ad-input--wide", attr: { type: "text", placeholder: t("例如：~/claude/agent-deck") } });
    const addBtn = add.createEl("button", { cls: "ad-btn ad-btn--soft", text: t("登记"), attr: { type: "button" } });
    addBtn.onclick = () => {
      const label = name.value.trim();
      const folder = normalizeProjectFolder(dir.value);
      if (!label || !folder) { new Notice(t("项目名和目录都要填")); return; }
      if (!folderExists(folder)) { new Notice(t("目录不存在：{path}", { path: folder })); return; }
      folders[label] = folder;
      p.saveSettings();
      this.display();
    };
  }

  setDefaultModel(agent, value) {
    const s = this.plugin.settings;
    s.delegate[agent].model = value;
    s.models.defaultByAgent[agent] = value;
    if (!s.models.enabled.includes(value)) s.models.enabled.push(value);
    if (this.draft && !this.draft.enabled.includes(value)) this.draft.enabled.push(value);
    return this.plugin.saveSettings();
  }

  setDefaultEffort(agent, value) {
    const s = this.plugin.settings;
    s.delegate[agent].effort = value;
    (s.models.effortByAgent ||= {})[agent] = value;
    return this.plugin.saveSettings();
  }

  modelSelect(parent, agent, value, onChange) {
    const all = this.plugin.modelsFor(agent);
    const models = agent === "codex" ? all : all.filter((m) => this.plugin.modelEnabled(m.id));
    if (!models.length) models.push(...all);
    if (value && !models.some((m) => m.id === value)) models.push(this.plugin.modelById(value) || { id: value, name: value });
    return this.rowSelect(parent, t("默认模型"), "", models.map((m) => ({ id: m.id, label: m.name })), value, onChange);
  }

  effortControl(parent, agent, value, onChange) {
    this.row(parent, t("默认强度"), "", (right) => {
      const wrap = right.createDiv({ cls: "ad-effort" });
      const opts = EFFORTS[agent] || EFFORTS.claude;
      const track = wrap.createDiv({ cls: "ad-effort__track" });
      const fill = track.createDiv({ cls: "ad-effort__fill" });
      const stops = track.createDiv({ cls: "ad-effort__stops" });
      const idx = Math.max(0, opts.findIndex((x) => x.id === value));
      fill.style.width = `${(idx / Math.max(1, opts.length - 1)) * 100}%`;
      opts.forEach((o, i) => {
        const b = stops.createEl("button", { cls: "ad-effort__stop" + (o.id === value ? " is-on" : ""), attr: { "aria-label": o.label, "aria-pressed": String(o.id === value) } });
        b.createSpan({ cls: "ad-effort__dot" });
        b.onclick = () => onChange(o.id);
        wrap.createEl("span", { cls: "ad-effort__lab", attr: { style: `left:${(i / Math.max(1, opts.length - 1)) * 100}%` }, text: o.label });
      });
    });
  }

  // ---------- Manage Models (inside Delegation) ----------
  modelsDraft() {
    if (!this.draft) this.draft = catalogSnapshot(this.plugin.settings.models);
    if (!this.draft.enabled) this.draft.enabled = [];
    if (!this.draft.pinned) this.draft.pinned = [];
    if (!this.draft.order) this.draft.order = [];
    if (!this.draft.custom) this.draft.custom = [];
    return this.draft;
  }

  isDraftDirty() {
    if (!this.draft) return false;
    return JSON.stringify(catalogSnapshot(this.draft)) !== JSON.stringify(catalogSnapshot(this.plugin.settings.models));
  }

  discardDraft() {
    this.draft = catalogSnapshot(this.plugin.settings.models);
    this.display();
  }

  renderModels(body) {
    const p = this.plugin;
    if (syncModelGroups(p.settings, (agent) => p.agentEnabled(agent))) p.saveSettings();
    const d = this.modelsDraft();
    const models = p.allModels(d.custom);
    const enabled = new Set(d.enabled);

    const picker = body.createDiv({ cls: "ad-card ad-models-card" });
    const phead = picker.createDiv({ cls: "ad-card__head" });
    phead.createDiv({ cls: "ad-card__title", text: t("管理模型") });
    phead.createDiv({ cls: "ad-card__sub", text: t("添加、编辑、启用、置顶和排序可用模型") });

    const tools = picker.createDiv({ cls: "ad-picker-tools" });
    const searchWrap = tools.createDiv({ cls: "ad-search" });
    searchWrap.createSpan({ cls: "ad-search__icon", text: "⌕" });
    const search = searchWrap.createEl("input", { cls: "ad-search__input", attr: { placeholder: t("搜索模型"), value: this.search } });
    search.oninput = () => { this.search = search.value; this.display(); };
    const add = tools.createEl("button", { cls: "ad-btn ad-btn--soft", text: "＋ " + t("添加模型") });
    add.onclick = () => new AddModelModal(this.app, p, (m) => {
      d.custom.push(m);
      if (!d.enabled.includes(m.id)) d.enabled.push(m.id);
      if (!d.order.includes(m.id)) d.order.push(m.id);
      this.display();
    }).open();
    const filters = picker.createDiv({ cls: "ad-filters ad-filters--models" });
    for (const [id, label] of [["all", t("全部")], ["enabled", t("已启用")], ["reasoning", t("推理")], ["fast", t("快速")], ["vision", t("视觉")]]) {
      const b = filters.createEl("button", { cls: "ad-chip" + (this.filter === id ? " is-on" : ""), text: label, attr: { "aria-pressed": String(this.filter === id) } });
      b.onclick = () => { this.filter = id; this.display(); };
    }
    const list = picker.createDiv({ cls: "ad-modellist" });
    const q = this.search.trim().toLowerCase();
    const visible = models.filter((m) => {
      if (this.filter === "enabled" && !enabled.has(m.id)) return false;
      if (this.filter === "reasoning" && !(m.tags || []).includes("Reasoning")) return false;
      if (this.filter === "fast" && !(m.tags || []).includes("Fast")) return false;
      if (this.filter === "vision" && !(m.tags || []).includes("Vision")) return false;
      if (q && !`${m.name} ${m.provider} ${(m.tags || []).join(" ")}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const pinned = d.pinned.map((id) => visible.find((m) => m.id === id)).filter(Boolean);
    const rest = visible.filter((m) => !d.pinned.includes(m.id));
    for (const agent of AGENT_ORDER) {
      const rows = [...pinned, ...rest].filter((m) => m.agent === agent);
      const clientModels = agent === "workbuddy" || AGENTS[agent].trackingOnly;
      if (!rows.length && (!clientModels || q || this.filter !== "all")) continue;
      const state = p.settings.ui.modelGroups[agent];
      const g = list.createEl(clientModels ? "div" : "details", { cls: "ad-modelgroup" });
      g.dataset.agent = agent;
      if (!clientModels) {
        g.open = state.open;
        g.ontoggle = () => {
          if (!g.isConnected || p.settings.ui.modelGroups[agent] !== state || state.open === g.open) return;
          state.open = g.open;
          p.saveSettings();
        };
      }
      const gh = g.createEl(clientModels ? "div" : "summary", { cls: "ad-modelgroup__head" });
      const a = AGENTS[agent];
      agentIcon(gh.createSpan({ cls: "ad-glyph", attr: { style: `color:${a.color}` } }), agent);
      gh.createSpan({ text: a.name });
      gh.createSpan({ cls: "ad-muted", text: clientModels ? t("在客户端选择模型") : t("已启用 {n} / {total}", { n: rows.filter((m) => enabled.has(m.id)).length, total: rows.length }) });
      if (rows.length) this.groupAction(gh, rows, d, false);
      const defaultId = p.defaultModel(agent);
      for (const m of rows) this.modelRow(g, m, d, agent, defaultId, d.pinned.includes(m.id));
    }
    if (!pinned.length && !rest.length) {
      list.createDiv({ cls: "ad-empty ad-empty--small", text: t("没有符合条件的模型") });
    }
  }

  groupAction(head, rows, d) {
    const allOn = rows.every((m) => d.enabled.includes(m.id));
    const b = head.createEl("button", { cls: "ad-linkbtn", text: allOn ? t("全部关闭") : t("全部开启") });
    b.onclick = () => {
      for (const m of rows) {
        const i = d.enabled.indexOf(m.id);
        if (allOn && i >= 0) d.enabled.splice(i, 1);
        if (!allOn && i < 0) d.enabled.push(m.id);
      }
      this.display();
    };
  }

  modelRow(parent, m, d, _agent, defaultId, pinned) {
    const on = d.enabled.includes(m.id);
    const row = parent.createDiv({ cls: "ad-modelrow" + (on ? "" : " is-off") });
    row.tabIndex = 0;
    row.dataset.id = m.id;
    const left = row.createDiv({ cls: "ad-modelrow__left" });
    const name = left.createDiv({ cls: "ad-modelrow__name" });
    name.createSpan({ text: m.name });
    if (pinned) name.createSpan({ cls: "ad-badge ad-badge--soft", text: t("置顶") });
    if (m.id === defaultId) name.createSpan({ cls: "ad-badge", text: t("默认") });
    const meta = left.createDiv({ cls: "ad-modelrow__meta" });
    meta.createSpan({ text: m.context });
    meta.createSpan({ cls: "ad-dot", text: "·" });
    meta.createSpan({ text: strength(m.strength, true) });
    meta.createSpan({ cls: "ad-dot", text: "·" });
    for (const tag of m.tags || []) meta.createSpan({ cls: "ad-cap", text: tag });
    if (m.cost) meta.createSpan({ cls: "ad-cost", text: m.cost });
    const right = row.createDiv({ cls: "ad-modelrow__right" });
    this.toggle(right, on, (v) => {
      const i = d.enabled.indexOf(m.id);
      if (v && i < 0) d.enabled.push(m.id);
      if (!v && i >= 0) d.enabled.splice(i, 1);
      this.display();
    });
    const more = right.createEl("button", { cls: "ad-morebtn", text: "⋯" });
    more.onclick = (e) => {
      e.stopPropagation();
      const menu = new Menu();
      menu.addItem((it) => it.setTitle(pinned ? t("取消置顶") : t("置顶")).setIcon(pinned ? "pin-off" : "pin").onClick(() => {
        const i = d.pinned.indexOf(m.id);
        if (pinned && i >= 0) d.pinned.splice(i, 1);
        if (!pinned && i < 0) d.pinned.push(m.id);
        this.display();
      }));
      menu.addItem((it) => it.setTitle(t("上移")).setIcon("arrow-up").onClick(() => this.moveModel(d, m, -1)));
      menu.addItem((it) => it.setTitle(t("下移")).setIcon("arrow-down").onClick(() => this.moveModel(d, m, 1)));
      if ((m.custom || d.custom.some((x) => x.id === m.id))) {
        menu.addItem((it) => it.setTitle(t("编辑模型")).setIcon("pencil").onClick(() => {
          new AddModelModal(this.app, this.plugin, (edited) => { d.custom = d.custom.map((x) => x.id === m.id ? edited : x); this.display(); }, m).open();
        }));
        menu.addItem((it) => it.setTitle(t("移除")).setIcon("trash").onClick(() => {
          d.custom = d.custom.filter((x) => x.id !== m.id);
          d.enabled = d.enabled.filter((x) => x !== m.id);
          d.pinned = d.pinned.filter((x) => x !== m.id);
          this.display();
        }));
      }
      menu.showAtMouseEvent(e);
    };
    row.addEventListener("keydown", (e) => {
      if (!e.altKey) return;
      if (e.key === "ArrowUp") { e.preventDefault(); this.moveModel(d, m, -1); }
      if (e.key === "ArrowDown") { e.preventDefault(); this.moveModel(d, m, 1); }
    });
  }

  moveModel(d, m, dir) {
    const order = d.order.length ? d.order : this.plugin.allModels(d.custom).map((x) => x.id);
    const i = order.indexOf(m.id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    d.order = order;
    this.display();
  }

  renderDraftBar(parent) {
    if (!this.isDraftDirty()) return;
    const bar = document.createElement("div");
    bar.className = "ad-draftbar ad-draftbar--inline";
    bar.createSpan({ cls: "ad-draftbar__text", text: t("未保存的更改") });
    const discard = bar.createEl("button", { cls: "ad-btn ad-btn--ghost", text: t("放弃更改") });
    discard.onclick = () => this.discardDraft();
    const save = bar.createEl("button", { cls: "ad-btn ad-btn--cta", text: t("保存 ⌘S") });
    save.onclick = () => this.saveDraft();
    if (this._draftBar) { try { this._draftBar.remove(); } catch { /* gone */ } }
    this._draftBar = bar;
    (parent || this.containerEl).prepend(bar);
    if (!this._draftKeyHandler && this.app?.scope?.register) {
      this._draftKeyHandler = true;
      this.app.scope.register(["Mod"], "s", (e) => { if (this.tab === "delegate" && this.isDraftDirty()) { e.preventDefault(); this.saveDraft(); } });
    }
  }

  saveDraft() {
    if (!this.draft) return;
    const p = this.plugin;
    const snap = catalogSnapshot(this.draft);
    const prevCustomIds = new Set((p.settings.models.custom || []).map((x) => x.id));
    const nextCustomIds = new Set(snap.custom.map((x) => x.id));
    p.settings.models.enabled = snap.enabled;
    p.settings.models.pinned = snap.pinned;
    p.settings.models.order = snap.order;
    p.settings.models.custom = snap.custom;
    for (const agent of delegateAgents()) {
      const cur = p.defaultModel ? p.defaultModel(agent) : p.settings.delegate[agent]?.model;
      if (cur && prevCustomIds.has(cur) && !nextCustomIds.has(cur)) {
        const fallback = DEFAULTS.models.defaultByAgent[agent];
        p.settings.delegate[agent].model = fallback;
        p.settings.models.defaultByAgent[agent] = fallback;
      }
      const active = p.defaultModel ? p.defaultModel(agent) : p.settings.delegate[agent]?.model;
      if (active && !p.settings.models.enabled.includes(active)) {
        p.settings.models.enabled.push(active);
      }
    }
    this.draft = catalogSnapshot(p.settings.models);
    p.saveSettings();
    new Notice(t("Models 已保存"));
    this.display();
  }

  renderGrokBotPicker(card, sessCountEl, s, p) {
    const selected = new Set(Array.isArray(s.grokBotTrackedBotIds) ? s.grokBotTrackedBotIds : []);
    const allBots = typeof p.grokBotBots === "function"
      ? p.grokBotBots()
      : discoverGrokBotStorage(s.grokBotPersistenceDir ? { persistenceDir: s.grokBotPersistenceDir } : {}).bots;
    const bots = allBots.filter((bot) => bot.inRoster !== false || selected.has(bot.id));
    const details = card.createEl("details", { cls: "ad-subdetails ad-grokbot-picker" });
    details.open = typeof this._grokBotsOpen === "boolean" ? this._grokBotsOpen : selected.size === 0;
    details.ontoggle = () => { this._grokBotsOpen = details.open; };
    const summary = details.createEl("summary", { cls: "ad-subdetails__head" });
    const summaryTitle = summary.createSpan({ cls: "ad-grokbot-picker__title" });
    const updateSummary = () => {
      if (!selected.size) {
        summaryTitle.textContent = t("追踪 Bot · 未选择（点击勾选）");
        return;
      }
      const names = bots.filter((b) => selected.has(b.id)).map((b) => b.name);
      const preview = names.length > 3 ? t("{names} 等 {n} 个", { names: names.slice(0, 3).join("、"), n: names.length }) : names.join("、");
      summaryTitle.textContent = preview
        ? t("追踪 Bot · 已选 {n} 个（{preview}）", { n: selected.size, preview })
        : t("追踪 Bot · 已选 {n} 个", { n: selected.size });
    };
    updateSummary();

    const body = details.createDiv({ cls: "ad-grokbot-picker__body" });
    if (!bots.length) {
      body.createSpan({ cls: "ad-muted", text: t("未检测到本机 Grok Bot 对话缓存") });
      return;
    }

    const activeBots = bots.filter((bot) => (!bot.isHidden && !bot.isRemoved) || selected.has(bot.id));
    const hiddenBots = bots.filter((bot) => (bot.isHidden || bot.isRemoved) && !selected.has(bot.id));
    const chips = body.createDiv({ cls: "ad-seg ad-seg--many ad-grokbot-picker__chips" });
    const renderChips = () => {
      chips.textContent = "";
      const shown = this._showHiddenGrokBots ? [...activeBots, ...hiddenBots] : activeBots;
      for (const bot of shown) {
        const on = selected.has(bot.id);
        const label = bot.isHidden || bot.isRemoved ? `${bot.name} (${t("已隐藏")})` : bot.name;
        const b = chips.createEl("button", { cls: "ad-seg__btn ad-grokbot-chip" + (on ? " is-on" : ""), text: label, attr: { "aria-pressed": String(on), "data-bot-id": bot.id } });
        b.onclick = async () => {
          if (selected.has(bot.id)) selected.delete(bot.id);
          else selected.add(bot.id);
          s.grokBotTrackedBotIds = [...selected];
          const nowOn = selected.has(bot.id);
          b.classList.toggle("is-on", nowOn);
          b.setAttribute("aria-pressed", String(nowOn));
          updateSummary();
          await p.saveSettings?.();
          p.watchGrokBotPersistence?.();
          await p.scanNow?.(false, { agent: "grokbot" });
          const nextCount = [...(p.usage?.meta?.values?.() || [])].filter((x) => x.agent === "grokbot").length;
          if (sessCountEl) sessCountEl.textContent = t("{n} 个会话", { n: nextCount });
        };
      }
    };
    renderChips();

    if (hiddenBots.length) {
      const foot = body.createDiv({ cls: "ad-grokbot-picker__foot" });
      const toggleHidden = foot.createEl("button", {
        cls: "ad-linkbtn",
        text: this._showHiddenGrokBots ? t("收起已隐藏 Bot") : t("显示已隐藏（{n}）", { n: hiddenBots.length }),
      });
      toggleHidden.onclick = () => {
        this._showHiddenGrokBots = !this._showHiddenGrokBots;
        toggleHidden.textContent = this._showHiddenGrokBots ? t("收起已隐藏 Bot") : t("显示已隐藏（{n}）", { n: hiddenBots.length });
        renderChips();
      };
    }
  }

  // ---------- Recording ----------
  renderAgents(body) { return this.renderRecord(body); }
  renderTracking(body) { return this.renderRecord(body); }

  renderRecord(body) {
    const p = this.plugin;
    const s = p.settings;
    const d = s.delegate;

    // 1. 记录 → 来源与扫描
    const sourceCard = this.card(body, t("来源与扫描"), t("最多三位主力读取全部历史；首次安装按近 30 天会话数推荐"));
    const grid = sourceCard.createDiv({ cls: "ad-set-agents" });
    for (const id of settingsAgentOrder(s, "tracking", id => p.agentEnabled(id))) {
      const a = AGENTS[id];
      const enabled = p.agentEnabled(id);
      const primary = p.isPrimary(id);
      const card = grid.createDiv({ cls: `ad-set-agent ${enabled ? "" : "is-off"} ${primary ? "is-primary" : ""}` });
      card.dataset.agent = id;
      card.style.setProperty("--ad-agent", a.color);
      card.style.setProperty("--ad-agent-soft", a.soft);
      const top = card.createDiv({ cls: "ad-set-agent__top" });
      agentIcon(top.createSpan({ cls: "ad-set-agent__icon" }), id);
      const name = top.createDiv({ cls: "ad-set-agent__identity" });
      name.createDiv({ cls: "ad-set-agent__name", text: a.name });
      const controls = top.createDiv({ cls: "ad-set-agent__controls" });
      const star = controls.createEl("button", { cls: "ad-star" + (primary ? " is-on" : ""), attr: { "aria-label": primary ? t("取消主力") : t("设为主力（最多三个）"), "aria-pressed": String(primary) } });
      setLucide(star, primary ? "star" : "star-off");
      star.title = primary ? t("取消主力") : t("设为主力（最多三个）");
      star.onclick = () => p.togglePrimary(id);
      this.toggle(controls, enabled, (v) => p.setAgentEnabled(id, v), primary);
      this.sortHandle(controls, grid, "tracking", id);
      const sessions = [...p.usage.meta.values()].filter((x) => x.agent === id);
      const stats = card.createDiv({ cls: "ad-set-agent__meta" });
      const sessCountEl = stats.createSpan({ text: t("{n} 个会话", { n: sessions.length }) });
      stats.createSpan({ text: id === "grokbot" ? t("用量未提供") : fmtTok(sessions.reduce((n, x) => n + (x.out || 0), 0)) + " tok" });
      stats.createSpan({ cls: "ad-set-agent__state", text: primary ? t("主力（全量）") : enabled ? t("追踪中") : t("已关闭") });
      if (id === "grokbot" && enabled) this.renderGrokBotPicker(card, sessCountEl, s, p);
    }
    this.agentReorder(grid, "tracking", ".ad-set-agent");
    const sourceMore = this.subDetails(sourceCard, "source-more", t("更多设置"));
    this.rowNumber(sourceMore, t("日记日期分界"), t("此时刻之前计入前一天"), s.dayCutoff, 0, 12, (v) => { s.dayCutoff = v; p.saveSettings(); p.scheduleScan(); });
    this.rowNumber(sourceMore, t("扫描间隔（秒）"), "", s.pollSeconds, 5, 300, (v) => { s.pollSeconds = v; p.saveSettings(); p.scheduleScan(); });
    this.rowNumber(sourceMore, t("主力读多少天历史"), t("非主力读取当天会话"), s.fullHistoryDays, 1, 365, (v) => { s.fullHistoryDays = v; p.saveSettings(); p.scanNow(true); });
    this.rowToggle(sourceMore, t("识别 side chat 和母子关系"), t("Claude 桌面版子会话与母子关联"), s.claudeDesktop !== false, (v) => { s.claudeDesktop = v; p.saveSettings(); p.scanNow(true); });
    if (typeof p.cursorHooksStatus === "function") {
      const ch = p.cursorHooksStatus();
      const statusText = ch.outdated
        ? t("Cursor Hooks 需要更新（{matched}/{total}）", { matched: ch.matchedEvents, total: ch.totalEvents })
        : ch.installed
          ? t("已配置 Cursor 3.30.14+ Hooks（{matched}/{total}）", { matched: ch.matchedEvents, total: ch.totalEvents })
          : t("未安装 Cursor Hooks；仅追踪安装后的 Cursor 3.30.14+ 新会话或新对话轮次");
      this.row(sourceMore, "Cursor Hooks", statusText, (curRight) => {
        this.bigButton(curRight, ch.installed && !ch.outdated ? t("更新 Hooks") : t("安装 Hooks"), () => {
          try { p.installCursorHooks(); } catch (e) { p.notice?.(e.message || String(e)); }
          this.display();
        });
        if (ch.installed || ch.matchedEvents > 0 || ch.scriptExists) {
          this.bigButton(curRight, t("卸载 Hooks"), () => {
            try { p.uninstallCursorHooks(); } catch (e) { p.notice?.(e.message || String(e)); }
            this.display();
          });
        }
      });
    }
    const scanBar = sourceCard.createDiv({ cls: "ad-btnrow" });
    this.bigButton(scanBar, t("立即扫描"), () => p.scanNow(), "mod-cta");
    this.bigButton(sourceMore.createDiv({ cls: "ad-btnrow" }), t("导入螺旋日程的历史"), () => p.importNautilus());
    const logDetails = this.subDetails(sourceMore, "log-paths", t("本机日志"));
    const paths = logDetails.createDiv({ cls: "ad-pathlist" });
    for (const [id, a] of Object.entries(AGENTS)) {
      const r = paths.createDiv({ cls: "ad-pathrow" });
      agentIcon(r.createSpan({ cls: "ad-glyph", attr: { style: `color:${a.color}` } }), id);
      r.createSpan({ cls: "ad-pathrow__name", text: a.name });
      r.createSpan({ cls: "ad-pathrow__path", text: a.where[0] });
      r.createSpan({ cls: "ad-muted", text: p.agentEnabled(id) ? t("读") : t("不读") });
    }
    const errs = p.usage.errors || [];
    if (errs.length) {
      for (const x of errs.slice(-6)) logDetails.createDiv({ cls: "ad-error-line", text: `${x.path}: ${x.message}` });
    }

    sourceCard.appendChild(sourceMore.parentElement);

    // 2. 记录 → 日记与归档
    const jr = this.card(body, t("日记与归档"), t("将会话记录写入今天的日记"));
    this.rowToggle(jr, t("启用日记写入"), "", s.journalAutoWrite !== false, (v) => { s.journalAutoWrite = v; p.saveSettings(); });
    const det = detectJournalFormat(this.app, s);
    this.rowText(jr, t("日记目录"), t("当前：{folder}；今天：{path}", { folder: det.folder || t("库根目录"), source: det.folderSource, path: journalPath(this.app, s) }), s.journalFolder || "", t("自动：{folder}", { folder: det.folder || t("库根目录") }), (v) => { s.journalFolder = v.trim(); p.saveSettings(); this.display(); });
    this.rowText(jr, t("日记文件名格式"), t("例如 YYYY-MM-DD；当前：{format}", { format: det.format, source: det.source }), s.journalFormat || "", t("自动：{format}", { format: det.format }), (v) => { s.journalFormat = v.trim(); p.saveSettings(); this.display(); });
    this.rowToggle(jr, t("自动会话记录"), t("自动将活跃会话建项并记入今日日记"), s.autoLog === true, (v) => { s.autoLog = v; p.saveSettings(); });
    this.row(jr, t("记哪几个 Agent"), t("选择自动建项的 Agent"), (rr) => {
      const agBox = rr.createDiv({ cls: "ad-seg ad-seg--many" });
      const agOn = (s.autoLogAgents ||= {});
      for (const id of AGENT_ORDER) {
        const b = agBox.createEl("button", { cls: "ad-seg__btn" + (agOn[id] !== false ? " is-on" : ""), text: AGENTS[id]?.short || id, attr: { "aria-pressed": String(agOn[id] !== false) } });
        b.onclick = () => { agOn[id] = agOn[id] === false; b.classList.toggle("is-on", agOn[id] !== false); b.setAttribute("aria-pressed", String(agOn[id] !== false)); p.saveSettings(); };
      }
    });
    const grain = this.row(jr, t("自动记录颗粒度"), t("选择记录的时机"), (rr) => {
      this.segmented(rr, [{ id: "latest", label: t("最新进展") }, { id: "round", label: t("每轮记录") }, { id: "paused", label: t("停歇或归档") }], s.autoLogGranularity || DEFAULTS.autoLogGranularity, (v) => { s.autoLogGranularity = v; p.saveSettings(); this.display(); });
    });
    const jdetail = this.row(jr, t("自动日志详细程度"), "", (rr) => {
      this.segmented(rr, [{ id: "brief", label: t("简略（默认）") }, { id: "standard", label: t("标准") }, { id: "detailed", label: t("详细") }], s.autoLogDetail || "brief", (v) => { changeLogDetail(s, v); p.saveSettings(); this.display(); });
    });
    const detailDesc = jdetail.querySelector(":scope > .ad-row__left");
    detailDesc.createDiv({ cls: "ad-row__desc", text: t("简略：任务和结论合成一段") });
    detailDesc.createDiv({ cls: "ad-row__desc", text: t("标准：提问、回答各一句") });
    detailDesc.createDiv({ cls: "ad-row__desc", text: t("详细：保留提问、回复摘录和步骤") });
    this.rowSegmented(jr, t("AI 记录显示方式"), t("控制笔记中默认展开的记录"), [
      { id: "collapsed", label: t("默认折叠") },
      { id: "expanded", label: t("默认展开") },
      { id: "latest5", label: t("最新五条") },
      { id: "latest3", label: t("最新三条") },
      { id: "latest1", label: t("最新一条") },
    ], s.aiRecordDisplay || DEFAULTS.aiRecordDisplay, (v) => { s.aiRecordDisplay = v; p.saveSettings(); p.refreshUI(); this.display(); });
    this.rowToggle(jr, t("关键词配色与图标"), t("Logseq 风格的关键词颜色与图标；同时开着 Logseq Style Tasks 时，请关掉它的「格式化任务关键词」"), s.keywordStyle !== false, (v) => { s.keywordStyle = v; p.saveSettings(); p.refreshUI(); this.display(); });
    const jrMore = this.subDetails(jr, "recording-more", t("更多设置"));
    jrMore.appendChild(grain);
    this.rowToggle(jrMore, t("累积后自动合并总结"), "", !!s.autoLogMerge, (v) => { s.autoLogMerge = v; p.saveSettings(); this.display(); });
    this.rowNumber(jrMore, t("累积多少条结论后合并"), t("至少 2 条"), s.autoLogMergeThreshold || 10, 2, 100, (v) => { s.autoLogMergeThreshold = Math.round(v); p.saveSettings(); });
    this.rowNumber(jrMore, t("首次记录最近多少轮"), t("第一次接入某个会话 / Bot 时只补最近几轮；之后只记当天产生的新轮次"), s.autoLogFirstRounds || DEFAULTS.autoLogFirstRounds, 1, 100, (v) => { s.autoLogFirstRounds = Math.max(1, Math.round(v)); p.saveSettings(); });

    const wb = jrMore;
    this.rowToggle(wb, t("把状态改成 DELEGATED"), "", d.markStatus !== false, (v) => { d.markStatus = v; p.saveSettings(); });
    this.rowToggle(wb, t("写 🔗 绑定行"), t("删除绑定行可解除关联"), d.writeLink !== false, (v) => { d.writeLink = v; p.saveSettings(); });
    this.rowToggle(wb, t("委派任务回写"), t("委派完成后写 💬 结论"), s.autoWriteResult !== false, (v) => { s.autoWriteResult = v; p.saveSettings(); });
    this.rowToggle(wb, t("回写日记"), t("更新已绑定任务的状态与结论"), s.journalSync !== false, (v) => { s.journalSync = v; p.saveSettings(); });
    for (const [key, label, desc] of [
      ["resultBack", t("会话结论写回（💬）"), ""],
      ["agentKw", t("状态关键词跟着会话"), ""],
      ["autoLogKw", t("自动记的条目也跟着切状态"), ""],
      ["kidBlocks", t("子会话和 side chat 子块"), ""],
    ]) {
      this.rowToggle(wb, label, desc, s[key] !== false, (v) => { s[key] = v; p.saveSettings(); });
    }
    this.rowNumber(jr, t("💬 最多多少个字"), t("普通会话的结论长度；后台回答超过 500 字时返回完整问答文件"), s.resultMax || DEFAULTS.resultMax, 40, 2000, (v) => { s.resultMax = v; p.saveSettings(); });
    this.rowNumber(jr, t("💬 编码类结论字数"), t("写做了什么、现在什么状态；默认 65"), s.conclusionMaxCode || DEFAULTS.conclusionMaxCode, 20, 400, (v) => { s.conclusionMaxCode = Math.max(20, Math.round(v)); p.saveSettings(); });
    this.rowNumber(jr, t("💬 知识问答结论字数"), t("解释概念、回答问题时可以长一点；默认 160"), s.conclusionMaxQA || DEFAULTS.conclusionMaxQA, 40, 800, (v) => { s.conclusionMaxQA = Math.max(40, Math.round(v)); p.saveSettings(); });
    this.rowToggle(wb, t("归档的会话记成 DONE"), "", s.autoLogArchiveDone !== false, (v) => { s.autoLogArchiveDone = v; p.saveSettings(); });
    this.rowToggle(wb, t("整理完弹通知"), "", s.autoLogNotify !== false, (v) => { s.autoLogNotify = v; p.saveSettings(); });

    const rulesBox = this.subDetails(jrMore, "record-rules", t("记录规则细则"));
    const rules = (s.recordRules = resolveRecordRules(s));
    this.rowToggle(rulesBox, t("母块标题自动加粗"), t("生成 AI 自动记录时用 **标题** 突出显示"), rules.boldTitle !== false, (v) => { rules.boldTitle = v; p.saveSettings(); });
    this.rowToggle(rulesBox, t("标题自动带项目 / Bot 前缀"), t("工作区项目或 Grok Bot 自动加上「名称 -> 」"), rules.projectPrefix !== false, (v) => { rules.projectPrefix = v; p.saveSettings(); });
    this.rowToggle(rulesBox, t("母块显示起止时间段"), t("在 🤖 后写入 HH:MM-HH:MM"), rules.showTimeRange !== false, (v) => { rules.showTimeRange = v; p.saveSettings(); });
    this.rowNumber(rulesBox, t("生成标题最大字数"), t("10–60 字，默认 22"), rules.titleMax || DEFAULT_RECORD_RULES.titleMax, 10, 60, (v) => { rules.titleMax = Math.max(10, Math.min(60, Math.round(v))); p.saveSettings(); });
    this.rowNumber(rulesBox, t("Grok Bot 无新对话自动 DONE（分钟）"), t("0 表示不自动标为 DONE；默认 120 分钟"), s.autoLogGrokBotDoneMinutes ?? DEFAULTS.autoLogGrokBotDoneMinutes, 0, 1440, (v) => { s.autoLogGrokBotDoneMinutes = Math.max(0, Math.round(v)); p.saveSettings(); });

    const tpl = this.subDetails(jrMore, "template-archive", t("整理日志模板与归档"));
    this.rowToggle(tpl, t("日志杂乱时提醒整理"), t("每新增 4 条记录提醒，每天最多 2 次"), s.organizeJournalSuggest !== false, (v) => { s.organizeJournalSuggest = v; p.saveSettings(); });
    this.rowSelect(
      tpl,
      t("整理模板"),
      t("设置笔记分区的标题和顺序"),
      [["auto", t("跟随界面（默认）")], ["zh", t("中文模板")], ["en", "English template"], ["custom", t("自定义模板")]].map(([id, label]) => ({ id, label })),
      s.journalLayout ? "custom" : s.journalLayoutLanguage || "auto",
      (val) => {
        if (val === "custom") s.journalLayout = builtinJournalLayout(s.journalLayoutLanguage === "auto" ? currentLanguage() : s.journalLayoutLanguage || currentLanguage());
        else { s.journalLayout = null; s.journalLayoutLanguage = val; }
        p.saveSettings(); this.display();
      },
    );
    if (s.journalLayout) {
      s.journalLayout = configuredJournalLayout(s);
      const names = { active: t("正在做"), todo: t("还要做"), done: t("已完成") };
      this.rowSelect(
        tpl,
        t("分区顺序"),
        "",
        [["active", "todo", "done"], ["active", "done", "todo"], ["todo", "active", "done"], ["todo", "done", "active"], ["done", "active", "todo"], ["done", "todo", "active"]].map((keys) => ({ id: keys.join(","), label: keys.map((key) => names[key]).join(" → ") })),
        s.journalLayout.order.join(","),
        (val) => { s.journalLayout = journalLayout({ ...s.journalLayout, order: val.split(",") }); p.saveSettings(); },
      );
      for (const key of JOURNAL_LAYOUT_DEFAULT.order) {
        const input = this.rowText(tpl, t("{section}标题", { section: names[key] }), "", s.journalLayout.titles[key], names[key], (value) => {
          try { s.journalLayout = journalLayout({ ...s.journalLayout, titles: { ...s.journalLayout.titles, [key]: value } }); p.saveSettings(); }
          catch (error) { input.value = s.journalLayout.titles[key]; new Notice(error.message); }
        });
      }
    }
    this.rowText(tpl, t("默认归档位置"), t("库内 Markdown 路径"), s.doneArchivePath, DEFAULTS.doneArchivePath, (v) => { try { s.doneArchivePath = archivePath(v); p.saveSettings(); } catch (e) { new Notice(e.message); } }, "ad-input--wide");
    this.rowSegmented(tpl, t("归档顺序"), "", [{ id: "prepend", label: t("插到开头") }, { id: "append", label: t("追加到末尾") }], s.archiveOrder || "prepend", (v) => { s.archiveOrder = v; p.saveSettings(); });
    const jrBtns = jr.createDiv({ cls: "ad-btnrow" });
    this.bigButton(jrBtns, t("现在整理一次"), () => p.autoLog.logNow());
    this.bigButton(tpl.createDiv({ cls: "ad-btnrow" }), t("恢复默认整理模板"), () => { s.journalLayout = null; s.journalLayoutLanguage = "auto"; p.saveSettings(); this.display(); });

    jr.appendChild(jrMore.parentElement);

    // 3. 记录 → 整理模型
    const detected = detectJournalProviders({ cfg: s });
    const detectedNames = detected.available.map((x) => x.label).join("、");
    const modelSub = detected.available.length
      ? t("已扫描本机已登录 CLI：{list}", { list: detectedNames })
      : t("未检测到已登录的本地 CLI，可选用自定义 API");
    const modelCard = this.card(body, t("AI 整理模型"), modelSub);
    const curProvider = s.autoLogProvider || "auto";
    const resolved = resolveJournalProvider(s);
    const autoTarget = detected.providers.find((x) => x.id === detected.recommended);
    const providerOptions = this.detectedProviderChoices(detected, {
      id: "auto",
      label: autoTarget?.available
        ? t("自动挑选本机 CLI（当前：{name}）", { name: autoTarget.label })
        : t("自动挑选本机 CLI"),
    });
    this.rowSelect(modelCard, t("整理使用的模型来源"), t("自动检测本机已登录 CLI，或自填兼容 OpenAI 格式的 API"), providerOptions, curProvider, (v) => {
      s.autoLogProvider = v;
      s.autoLogModel = v === "auto" ? "" : (JOURNAL_PROVIDERS[v]?.defaultModel || "");
      s.roundPolishModel = "";
      s.autoLogPath = "";
      p.saveSettings();
      this.display();
    });

    if (resolved === "api") {
      const matchedPreset = API_PRESETS.find((x) => x.url === (s.autoLogApiUrl || "").trim())?.id || "custom";
      this.rowSelect(
        modelCard,
        t("API 预设"),
        t("快捷填入地址与默认模型"),
        [{ id: "custom", label: t("手动填写") }, ...API_PRESETS.map((x) => ({ id: x.id, label: x.id === "ollama" ? t("本地 Ollama") : x.label }))],
        matchedPreset,
        (id) => {
          const hit = API_PRESETS.find((x) => x.id === id);
          if (!hit) return;
          s.autoLogApiUrl = hit.url;
          s.autoLogModel = hit.model;
          p.saveSettings();
          this.display();
        },
      );
    }
    this.renderApiCredentialsAndEffort(modelCard, {
      showApi: resolved === "api",
      showEffort: resolved === "codex",
      urlLabel: "API Base URL",
      urlValue: s.autoLogApiUrl || "",
      onUrlChange: (v) => { s.autoLogApiUrl = v.trim(); p.saveSettings(); },
      keyLabel: "API Key",
      keyValue: s.autoLogApiKey || "",
      onKeyChange: (v) => { s.autoLogApiKey = v.trim(); p.saveSettings(); },
      effortLabel: t("整理与润色的推理强度"),
      effortValue: s.autoLogEffort || "low",
      onEffortChange: (v) => { s.autoLogEffort = v; p.saveSettings(); this.display(); },
    });

    const spec = JOURNAL_PROVIDERS[resolved];
    this.providerPresetRow(modelCard, {
      label: t("常用模型预设"),
      desc: t("点选可填入下方模型框"),
      resolved,
      emptyLabel: t("自定义输入"),
      value: s.autoLogModel || spec?.defaultModel || "",
      onChange: (m) => { if (m) { s.autoLogModel = m; p.saveSettings(); this.display(); } },
      showAgyRefresh: true,
      agyPath: s.autoLogPath || s.delegate?.antigravity?.path || "",
    });

    const modelPlaceholder = resolved === "api" ? "deepseek-chat" : (spec?.defaultModel || t("留空用 CLI 默认模型"));
    this.renderModelTestRow(modelCard, {
      label: t("整理用的模型"),
      desc: t("填写模型名或别名；留空使用当前方式默认模型"),
      value: s.autoLogModel || "",
      placeholder: modelPlaceholder,
      wide: resolved === "api",
      onChange: (v) => { s.autoLogModel = v.trim(); p.saveSettings(); },
      pendingText: t("正在测试整理模型连接…"),
      testFn: () => testJournalModel(s),
    });

    const modelMore = this.subDetails(modelCard, "model-more", t("更多设置"));
    this.rowNumber(modelMore, t("整理超时（秒）"), "", s.autoLogTimeout || 120, 10, 600, (v) => { s.autoLogTimeout = v; p.saveSettings(); });
    this.rowToggle(modelMore, t("整理失败时使用会话标题"), "", s.autoLogFallback !== false, (v) => { s.autoLogFallback = v; p.saveSettings(); });
    this.rowToggle(modelMore, t("用 API 前先问我"), t("API 调用会产生费用；同意后 30 分钟内不再问"), s.autoLogApiConfirm !== false, (v) => { s.autoLogApiConfirm = v; p.saveSettings(); });
    this.rowToggle(modelMore, t("主来源不可用时换备用"), t("撞限额、超时或起不来时换下一个来源，换不上再用会话标题记"), !!s.autoLogFailover, (v) => { s.autoLogFailover = v; p.saveSettings(); this.display(); });
    if (s.autoLogFailover) {
      const backupOptions = [
        { id: "auto", label: t("自动挑下一个已登录 CLI（没有就用 API）") },
        ...detected.providers.map((x) => ({ id: x.id, label: `${x.label} ${x.available ? t("（已登录）") : x.found ? t("（未登录）") : t("（未安装）")}` })),
        { id: "api", label: t("自定义 API（OpenAI 兼容）") },
      ];
      this.rowSelect(modelMore, t("备用来源"), "", backupOptions, s.autoLogBackupProvider || "auto", (v) => { s.autoLogBackupProvider = v; p.saveSettings(); });
      this.rowNumber(modelMore, t("撞限额后冷却（分钟）"), t("冷却期内直接用备用来源"), s.autoLogCooldownMin || 30, 1, 240, (v) => { s.autoLogCooldownMin = Math.max(1, Math.round(v)); p.saveSettings(); });
    }
    if (resolved !== "api") {
      this.rowText(modelMore, t("整理 CLI 路径"), t("留空自动查找或沿用委派路径"), s.autoLogPath || "", t("自动找"), (v) => { s.autoLogPath = v.trim(); p.saveSettings(); }, "ad-input--wide");
    }
    this.rowToggle(modelMore, t("每轮结论让模型润色"), t("适用于简略和标准记录"), s.roundPolish !== false, (v) => { s.roundPolish = v; p.saveSettings(); });
    this.rowText(modelMore, t("润色用的模型"), t("留空沿用整理模型"), s.roundPolishModel || "", t("同整理用的模型"), (v) => { s.roundPolishModel = v.trim(); p.saveSettings(); });
    this.rowNumber(modelMore, t("润色超时（秒）"), "", s.roundPolishTimeout || 30, 5, 300, (v) => { s.roundPolishTimeout = v; p.saveSettings(); });
    const sched = modelMore;
    this.rowNumber(sched, t("整理间隔（分钟）"), t("至少 5 分钟"), s.autoLogEvery || 20, 5, 240, (v) => { s.autoLogEvery = v; p.saveSettings(); });
    this.rowNumber(sched, t("首次整理延迟（分钟）"), "", s.autoLogStartDelay ?? 1, 1, 240, (v) => { s.autoLogStartDelay = v; p.saveSettings(); });
    this.rowNumber(sched, t("最短记录时长（分钟）"), t("0 表示立即记录"), s.autoLogMinMinutes ?? 3, 0, 120, (v) => { s.autoLogMinMinutes = v; p.saveSettings(); });
    this.rowNumber(sched, t("暂停判定（分钟）"), t("至少 5 分钟"), s.autoLogIdle || 10, 5, 480, (v) => { s.autoLogIdle = v; p.saveSettings(); });
    this.rowNumber(sched, t("每批会话数"), "", s.autoLogBatch || 8, 1, 20, (v) => { s.autoLogBatch = v; p.saveSettings(); });

    // 4. 记录 → 展示与维护
    const ui = this.card(body, t("展示与维护"), t("会话打开方式、面板、编辑器与菜单栏显示、缓存维护"));
    this.rowSegmented(ui, t("终端会话打开方式"), "", [{ id: "terminal", label: t("终端") }, { id: "desktop", label: t("桌面版") }], s.cliOpen === "desktop" ? "desktop" : "terminal", (v) => { s.cliOpen = v; p.saveSettings(); this.display(); });
    this.rowToggle(ui, t("归档的会话不再列出"), "", s.hideArchived !== false, (v) => { s.hideArchived = v; p.saveSettings(); p.refreshUI(); });
    for (const [key, label, desc, fallback] of [
      ["showEditorPills", t("任务行上的会话状态按钮"), "", true],
      ["lineProgress", t("显示任务行进度条与 token 块"), t("在 AI 任务行下方渲染 ASCII 进度条与紫色 token 方块"), true],
      ["dragGrip", t("列表项尾巴上的把手"), t("单击委派；双击或 ⌘ 单击选择 Agent"), true],
      ["showRibbonIcon", t("左侧栏图标"), "", true],
      ["openDashboardOnStartup", t("启动时打开面板"), "", false],
    ]) {
      this.rowToggle(ui, label, desc, s[key] === undefined ? fallback : s[key] !== false, (v) => { s[key] = v; p.saveSettings(); p.applyUiSettings(); });
    }
    const uiMore = this.subDetails(ui, "display-more", t("更多设置"));
    this.rowToggle(uiMore, t("最近 14 天的条形图"), "", s.ui.showUsageBars !== false, (v) => { s.ui.showUsageBars = v; p.saveSettings(); p.refreshUI(); });
    this.rowToggle(uiMore, t("每个 Agent 的小火花线"), "", s.ui.showSparkline !== false, (v) => { s.ui.showSparkline = v; p.saveSettings(); p.refreshUI(); });

    this.mbSwitch = this.rowToggle(ui, t("macOS 菜单栏"), "", s.showMenuBar !== false, (v) => { s.showMenuBar = v; p.saveSettings(); p.applyUiSettings(); });
    this.rowSegmented(uiMore, t("菜单栏显示哪些 Agent"), "", [{ id: "primary-running", label: t("主力与在跑的") }, { id: "all", label: t("全部已启用") }], s.menuBarAgentScope || "primary-running", (v) => { s.menuBarAgentScope = v; p.saveSettings(); p.menubar?.update(true); this.display(); });
    for (const [key, label, desc, min, max] of [
      ["menuBarPrimaryLimit", t("菜单栏：主力最多几个"), "", 3, 12],
      ["menuBarOtherLimit", t("菜单栏：其它 Agent 最多几个"), "", 1, 6],
    ]) {
      this.rowNumber(uiMore, label, desc, s[key] || (key === "menuBarPrimaryLimit" ? 6 : 3), min, max, (v) => { s[key] = v; p.saveSettings(); p.refreshUI(); });
    }
    this.row(ui, t("菜单栏快捷键"), t("点输入框后按组合键，需包含 ⌃、⌥ 或 ⌘"), (hkRight) => {
      const hkInput = hkRight.createEl("input", { cls: "ad-hotkey", attr: { type: "text", spellcheck: "false", tabindex: "0", "aria-label": t("菜单栏快捷键") } });
      hkInput.value = hotkeyDisplay(s.menuBarHotkey);
      hkInput.addEventListener("focus", () => {
        hkInput.value = t("按下组合键…");
        hkInput.classList.add("is-capturing");
      });
      hkInput.addEventListener("blur", () => {
        hkInput.value = hotkeyDisplay(s.menuBarHotkey);
        hkInput.classList.remove("is-capturing");
      });
      hkInput.addEventListener("input", () => {
        hkInput.value = hotkeyDisplay(s.menuBarHotkey);
      });
      hkInput.addEventListener("keydown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Escape") { hkInput.blur(); return; }
        if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return;
        const key = hotkeyKeyFromEvent(event);
        if (!key) { hkInput.value = t("只支持 A–Z / 0–9 / F1–F12"); return; }
        if (!event.ctrlKey && !event.altKey && !event.metaKey) { hkInput.value = t("至少加 ⌃ / ⌥ / ⌘"); return; }
        s.menuBarHotkey = hotkeySpecFromEvent(event, key);
        p.saveSettings();
        p.menubar?.update(true);
        new Notice(t("菜单栏快捷键已保存，约 2 秒内生效"));
        hkInput.value = hotkeyDisplay(s.menuBarHotkey);
        hkInput.classList.remove("is-capturing");
        hkInput.blur();
      }, true);
      const hkReset = hkRight.createEl("button", { cls: "ad-btn", text: t("默认") });
      hkReset.onclick = () => {
        s.menuBarHotkey = DEFAULTS.menuBarHotkey;
        p.saveSettings();
        p.menubar?.update(true);
        hkInput.value = hotkeyDisplay(s.menuBarHotkey);
      };
    });

    this.rowToggle(uiMore, t("使用螺旋日程的进度显示"), "", s.yieldToNautilus !== false, (v) => { s.yieldToNautilus = v; p.saveSettings(); p.refreshUI(); });
    this.rowToggle(uiMore, t("关闭螺旋日程右下角的 Agent 汇总"), "", s.menuBarHideNautilus !== false, (v) => { s.menuBarHideNautilus = v; p.saveSettings(); if (v) p.hideNautilusAgentBar().catch(() => {}); else p.restoreNautilusAgentBar().catch(() => {}); });

    const btn = uiMore.createDiv({ cls: "ad-btnrow" });
    this.bigButton(btn, t("重启菜单栏"), () => p.menubar?.restart());
    this.bigButton(btn, t("重新计算全部历史"), () => p.rebuildUsage(), "mod-warning");
    this.bigButton(btn, t("打开插件目录"), () => p.openPluginDir());
    const stats = uiMore.createDiv({ cls: "ad-statline" });
    const days = Object.keys(p.store.days).length;
    stats.createSpan({ text: t("{n} 天记录", { n: days }) });
    stats.createSpan({ cls: "ad-dot", text: "·" });
    stats.createSpan({ text: t("{n} 个会话索引", { n: p.usage.meta.size }) });
    stats.createSpan({ cls: "ad-dot", text: "·" });
    stats.createSpan({ text: t("{n} 个日志文件", { n: p.usage.files.size }) });
    ui.appendChild(uiMore.parentElement);
  }

  // ---------- Dreaming ----------
  renderDream(body) {
    const p = this.plugin, s = p.settings.dream;
    const card = this.card(body, t("Dreaming · 长期记忆"), t("从近 14 天日志提炼记忆，保存到笔记"));
    this.rowToggle(card, t("每天自动整理"), "", s.enabled, (v) => { s.enabled = v; p.saveSettings(); });
    this.rowToggle(card, t("派发时注入相关记忆"), t("按当前任务从长期记忆里挑出最多 5 条相关条目一起发给 Agent；词面不相关时不注入"), s.inject !== false, (v) => { s.inject = v; p.saveSettings(); });
    this.rowSegmented(
      card,
      t("Dreaming 采集范围"),
      t("控制 Dreaming 只读取带 AI 自动记录的条目，还是读取全部日记与任务"),
      [
        { id: "all", label: t("全部日记与任务") },
        { id: "ai-records", label: t("仅 AI 自动记录条目") },
      ],
      s.scope === "ai-records" ? "ai-records" : "all",
      (v) => { s.scope = v; p.saveSettings(); this.display(); },
    );

    const detected = detectJournalProviders({ cfg: p.settings });
    const baseCfg = p.settings;
    const baseProvider = resolveJournalProvider(baseCfg);
    const baseModel = baseCfg.autoLogModel || JOURNAL_PROVIDERS[baseProvider]?.defaultModel || "";
    const curDreamProvider = String(s.provider || "").trim();
    const effectiveCfg = dreamModelConfig(baseCfg);
    const effectiveProvider = resolveJournalProvider(effectiveCfg);
    const effectiveSpec = JOURNAL_PROVIDERS[effectiveProvider];
    const dreamChoices = this.detectedProviderChoices(detected, {
      id: "",
      label: t("跟随 AI 自动记录（当前：{name}）", {
        name: baseModel ? `${JOURNAL_PROVIDERS[baseProvider]?.label || baseProvider} / ${baseModel}` : (JOURNAL_PROVIDERS[baseProvider]?.label || baseProvider),
      }),
    });
    this.rowSelect(
      card,
      t("Dreaming 模型来源"),
      t("默认跟随「AI 自动记录」使用的 CLI 与模型，也可单独切换"),
      dreamChoices,
      curDreamProvider,
      (v) => {
        s.provider = v;
        s.model = v ? (JOURNAL_PROVIDERS[v]?.defaultModel || "") : "";
        p.saveSettings();
        this.display();
      },
    );

    this.providerPresetRow(card, {
      label: t("Dreaming 模型预设"),
      desc: t("点选可单独指定 Dreaming 使用的模型"),
      resolved: effectiveProvider,
      emptyLabel: curDreamProvider ? t("自定义输入") : t("跟随 AI 自动记录"),
      value: s.model || "",
      onChange: (m) => { s.model = m; p.saveSettings(); this.display(); },
    });

    const dreamModelPlaceholder = !curDreamProvider
      ? (baseModel ? t("跟随：{model}", { model: baseModel }) : (effectiveSpec?.defaultModel || t("跟随 AI 自动记录")))
      : (effectiveProvider === "api" ? "deepseek-chat" : (effectiveSpec?.defaultModel || t("留空用 CLI 默认模型")));
    this.renderModelTestRow(card, {
      label: t("Dreaming 模型"),
      desc: t("留空跟随 AI 自动记录；填写可单独覆盖模型"),
      value: s.model || "",
      placeholder: dreamModelPlaceholder,
      wide: effectiveProvider === "api",
      onChange: (v) => { s.model = v.trim(); p.saveSettings(); },
      pendingText: t("正在测试 Dreaming 模型连接…"),
      testFn: () => testJournalModel(dreamModelConfig(p.settings)),
    });

    const dreamMore = this.subDetails(card, "dream-more", t("更多设置"));
    this.renderApiCredentialsAndEffort(dreamMore, {
      showApi: curDreamProvider === "api",
      showEffort: curDreamProvider === "codex",
      urlLabel: "Dreaming API Base URL",
      urlValue: s.apiUrl || "",
      onUrlChange: (v) => { s.apiUrl = v.trim(); p.saveSettings(); },
      keyLabel: "Dreaming API Key",
      keyValue: s.apiKey || "",
      onKeyChange: (v) => { s.apiKey = v.trim(); p.saveSettings(); },
      effortLabel: t("Dreaming 推理强度"),
      effortValue: s.effort || p.settings.autoLogEffort || "low",
      onEffortChange: (v) => { s.effort = v; p.saveSettings(); this.display(); },
    });
    this.rowText(dreamMore, t("长期记忆笔记"), t("库内 Markdown 路径"), s.path, "Agent Deck/长期记忆.md", (v) => { try { s.path = notePath(v); p.saveSettings(); } catch (e) { new Notice(e.message); } }, "ad-input--wide");
    if (companionInstalled(p.app)) {
      this.rowToggle(dreamMore, t("同步到 Telegram Companion 陪伴档案"), t("同步有效记忆，最多 6000 字"), s.syncProfile, (v) => { s.syncProfile = v; p.saveSettings(); });
    }
    const actions = card.createDiv({ cls: "ad-btnrow" });
    const run = this.bigButton(actions, t("现在 Dream 一次"), async () => {
      const task = p.dreaming.run(true, { drain: true }); update();
      try { await task; } finally { update(); }
    });
    const progress = card.createDiv({ cls: "ad-dream-progress", attr: { role: "status", "aria-live": "polite" } });
    const phase = progress.createDiv();
    const elapsed = progress.createDiv({ cls: "ad-muted" });
    const meter = progress.createEl("progress", { attr: { "aria-label": t("Dream 整理进度") } });
    this.bigButton(dreamMore.createDiv({ cls: "ad-btnrow" }), t("导出长期记忆 Markdown 副本"), () => p.dreaming.exportMemory());
    card.createDiv({ cls: "ad-muted", text: t("可直接编辑长期记忆笔记") });
    const summary = card.createDiv({ cls: "ad-muted" });

    card.appendChild(dreamMore.parentElement);

    const c = s.share, sharing = p.dreaming.sharing;
    const shared = this.card(body, t("与其他 Agent 共享记忆"), t("将记忆导出到固定文件，供其他 Agent 读取"));
    this.rowToggle(shared, t("自动同步共享记忆"), t("Dream 完成后同步，并按下方间隔定期同步"), c.enabled, (v) => { c.enabled = v; p.saveSettings(); });
    this.rowText(shared, t("共享文件路径"), t("绝对路径，支持 ~/"), c.path, "/Users/me/shared-agent-memory/memory.md", (v) => { try { c.path = v.trim() ? externalMemoryPath(v) : ""; p.saveSettings(); } catch (e) { new Notice(e.message); } }, "ad-input--wide");
    const shareMore = this.subDetails(shared, "share-more", t("更多设置"));
    this.rowNumber(shareMore, t("定期同步间隔（小时）"), t("1–168 小时"), c.intervalHours, 1, 168, (v) => { c.intervalHours = v; p.saveSettings(); });
    this.rowToggle(shareMore, t("同步后提交并推送 Git"), t("共享文件需位于 Git 仓库中；推送到 origin 当前分支"), c.gitPush, (v) => { c.gitPush = v; p.saveSettings(); });
    const syncNow = this.bigButton(shared.createDiv({ cls: "ad-btnrow" }), t("立即同步共享记忆"), async () => {
      const task = sharing.sync(); update();
      try { await task; } finally { update(); }
    });
    const sharedStatus = shared.createDiv({ cls: "ad-muted", attr: { role: "status", "aria-live": "polite" } });
    shared.appendChild(shareMore.parentElement);
    const update = () => {
      const d = p.dreaming, state = d.progress;
      run.disabled = d.busy;
      run.textContent = d.busy ? t("Dream 整理中…") : t("现在 Dream 一次");
      progress.hidden = state.phase === "idle";
      progress.setAttribute("aria-busy", String(d.busy));
      const steps = { collect: 1, model: 2, write: 3, sync: 4 };
      phase.textContent = `${steps[state.phase] ? t("第 {step}/4 步 · ", { step: steps[state.phase] }) : ""}${state.message}`;
      elapsed.textContent = state.startedAt ? t("耗时 {n} 秒", { n: Math.max(0, Math.floor(((state.endedAt || Date.now()) - state.startedAt) / 1000)) }) : "";
      summary.textContent = [s.coverage ? t("上次采集 {files} 篇；已处理 {done}/{total} 块，待处理 {pending} 块。", { files: s.coverage.files, done: s.coverage.processed, total: s.coverage.total, pending: s.coverage.pending }) : "", s.lastRun ? t("上次完成：{time}", { time: new Date(s.lastRun).toLocaleString() }) : "", s.lastError ? t("上次未完成：{error}", { error: s.lastError }) : ""].filter(Boolean).join(t("；"));
      meter.hidden = !d.busy;
      syncNow.disabled = sharing.busy || d.busy;
      syncNow.textContent = sharing.busy ? t("共享同步中…") : t("立即同步共享记忆");
      sharedStatus.textContent = [sharing.status || (c.lastError ? t("上次共享失败：{error}", { error: c.lastError }) : ""), c.lastSuccess ? t("上次同步成功：{time}", { time: new Date(c.lastSuccess).toLocaleString() }) : t("尚未同步")].filter(Boolean).join(t("；"));
    };
    update();
    this._dreamTimer = this._timers.setInterval(update, 1000);
  }

  // ---------- About ----------
  renderExperimental(body) {
    const p = this.plugin;
    const card = this.card(body, t("实验功能"));
    this.rowToggle(card, t("AI 协作回顾"), t("默认开启。查看 token 热力图、项目投入和历史记录；关闭后隐藏入口并关闭回顾页，保留统计数据。"), p.settings.experimentalDashboard !== false, async (enabled) => {
      try { await p.setExperimentalDashboard(enabled); }
      catch (error) { new Notice(t("设置保存失败：{error}", { error: error.message })); }
      this.display();
    });
  }

  renderAbout(body) {
    const p = this.plugin;
    const intro = this.card(body, "Agent Deck", t("在 Obsidian 里追踪会话、委派任务、保存 AI 工作记录。"));
    intro.addClass("ad-about-intro");
    const agents = intro.createDiv({ cls: "ad-about-agents" });
    for (const id of AGENT_ORDER) {
      const agent = agents.createDiv({ cls: "ad-about-agent" });
      agentIcon(agent.createSpan({ cls: "ad-glyph" }), id);
      agent.createSpan({ text: AGENTS[id].name });
    }
    const flowCard = this.card(
      body,
      t("核心结构与信息流转"),
      t("从笔记委派，本机只读采集多端日志，状态与结论回写原任务，再沉淀为回顾数据与长期记忆。"),
    );
    const diagramEl = flowCard.createDiv({ cls: "ad-about-diagram" });
    this.renderAboutDiagram(diagramEl);
    const guide = this.card(body, t("常用操作"));
    const rows = [
      [t("整理日志"), t("Ctrl+Alt+L，或点击面板顶部的「整理日志」")],
      [t("管理侧边栏"), t("点击 Agents 右上角「管理」，拖动调整顺序")],
      [t("查看与扫描"), t("点击会话打开；在 Agent 菜单中扫描")],
      [t("从笔记委派"), t("点击任务行末尾把手，或拖到 Agent 卡片")],
      [t("绑定已有会话"), t("在任务与会话卡片之间拖放")],
      [t("保存工作记录"), t("在「记录」中开启自动会话记录，在 Dreaming 中整理记忆")],
    ];
    for (const [title, text] of rows) {
      const row = guide.createDiv({ cls: "ad-about-guide" });
      row.createDiv({ cls: "ad-about-guide__title", text: title });
      row.createDiv({ cls: "ad-about-guide__text", text });
    }
    const c = this.card(body, t("版本与支持"));
    const meta = c.createDiv({ cls: "ad-about-meta" });
    meta.createDiv({ text: t("版本 {version} · Apache-2.0 License", { version: p.manifest.version }) });
    meta.createDiv({ text: t("欢迎在 GitHub Issues 反馈 bug，或在 Roadmap 提交建议并为你期待的方向投票。") });
    const btns = c.createDiv({ cls: "ad-btnrow" });
    this.bigButton(btns, t("打开 GitHub 仓库"), () => p.openExternal("https://github.com/MatsuriMW/obsidian-agent-deck"));
    this.bigButton(btns, t("反馈 Issue"), () => p.openExternal("https://github.com/MatsuriMW/obsidian-agent-deck/issues"));
    this.bigButton(btns, t("查看 Roadmap"), () => p.openExternal("https://matsuri.site/portfolio/journal-workflow/#whistlist"));
    this.bigButton(btns, t("复制调试信息"), async () => {
      const text = JSON.stringify({ version: p.manifest.version, settings: p.settings, files: p.usage.files.size, sessions: p.usage.meta.size, errors: p.usage.errors }, null, 2);
      await navigator.clipboard.writeText(text);
      new Notice(t("调试信息已复制"));
    });
  }

  renderAboutDiagram(el) {
    const md = aboutArchitectureMermaid(currentLanguage());
    const Comp = obsidianNs.Component;
    const Renderer = obsidianNs.MarkdownRenderer;
    if (Renderer?.render && Comp) {
      this._aboutComp?.unload?.();
      this._aboutComp = new Comp();
      this._aboutComp.load();
      Renderer.render(this.plugin.app, md, el, "", this._aboutComp).catch(() => {
        el.empty();
        el.createEl("pre", { cls: "ad-about-diagram__raw", text: md.replace(/^```mermaid\n|\n```$/g, "") });
      });
      return;
    }
    el.createEl("pre", { cls: "ad-about-diagram__raw", text: md.replace(/^```mermaid\n|\n```$/g, "") });
  }
}

function aboutArchitectureMermaid(lang) {
  if (lang === "en") {
    return [
      "```mermaid",
      "flowchart LR",
      '  subgraph NOTE["Obsidian Journal & Notes"]',
      "    direction TB",
      '    Task["Task Line / Outline Block\\nGrip · Drag · @agent"]',
      '    Views["Multi-View & Tidy\\nOutline · Table · Cards · Timeline"]',
      "  end",
      '  subgraph HARNESS["Delegation & Context"]',
      '    Ctx["Harness Pipeline\\nAncestors · Wikilinks · Model"]',
      "  end",
      '  subgraph AGENTS["8 Local AI Agents"]',
      "    direction TB",
      '    Run["Runners\\nACP/CLI · Desktop · Terminal"]',
      '    Logs["Local Logs & Hooks\\nJSONL · SQLite (Read-only)"]',
      "  end",
      '  subgraph DECK["Agent Deck Control & Sync"]',
      "    direction TB",
      '    Panel["Sidebar Deck & macOS Menu Bar\\nLive Status · Alerts · Jump"]',
      '    Sync["Journal Auto-Sync\\nStatus · Conclusions · Spans · Links"]',
      "  end",
      '  subgraph INSIGHT["Review & Memory"]',
      "    direction TB",
      '    Dash["Review Dashboard\\nToken Heatmap · Project Effort"]',
      '    Dream["Dreaming Memory\\nFacts/Patterns · Shared Note"]',
      "  end",
      '  Task -->|"Delegate"| Ctx',
      '  Ctx -->|"Launch / Resume"| Run',
      '  Run -->|"Transcripts & Events"| Logs',
      '  Logs -->|"Incremental Scan"| Panel',
      '  Panel <-->|"Drag Bind / Jump"| Task',
      '  Logs -->|"00:00 Split & Noise Filter"| Sync',
      '  Sync -->|"Write Back"| Views',
      '  Logs -->|"Usage Stats"| Dash',
      '  Views -->|"Daily Evidence"| Dash',
      '  Views -->|"14-Day Evidence"| Dream',
      "```",
    ].join("\n");
  }
  return [
    "```mermaid",
    "flowchart LR",
    '  subgraph NOTE["Obsidian 日记与笔记"]',
    "    direction TB",
    '    Task["任务行 / 大纲块\\n把手 · 拖拽 · @agent"]',
    '    Views["同源多视图与整理\\n大纲 · 表格 · 卡片 · 时间线 · 归档"]',
    "  end",
    '  subgraph HARNESS["委派与上下文管道"]',
    '    Ctx["Harness 组装\\n母项链 · 双链 · 模型与位置"]',
    "  end",
    '  subgraph AGENTS["本机 8 家 AI Agent"]',
    "    direction TB",
    '    Run["执行端\\n后台 ACP/CLI · 桌面版 · 终端"]',
    '    Logs["本机会话日志 / Hooks\\nJSONL · SQLite（只读数据源）"]',
    "  end",
    '  subgraph DECK["Agent Deck 控制与回写"]',
    "    direction TB",
    '    Panel["侧栏甲板 · macOS 菜单栏\\n实时状态 · 待确认提醒 · 直达跳转"]',
    '    Sync["日志自动回写引擎\\n状态 · 结论 · 时段 · 短链"]',
    "  end",
    '  subgraph INSIGHT["回顾分析与长期记忆"]',
    "    direction TB",
    '    Dash["协作回顾 Dashboard\\nToken 热力图 · 项目投入排名"]',
    '    Dream["Dreaming 长期记忆\\n提炼偏好规律 · 单向共享"]',
    "  end",
    '  Task -->|"委派任务"| Ctx',
    '  Ctx -->|"启动 / 续聊"| Run',
    '  Run -->|"写入对话与事件"| Logs',
    '  Logs -->|"只读增量扫描"| Panel',
    '  Panel <-->|"拖放绑定 / 跳转"| Task',
    '  Logs -->|"零点分割与口语过滤"| Sync',
    '  Sync -->|"写回原任务块"| Views',
    '  Logs -->|"用量汇总"| Dash',
    '  Views -->|"日记证据归属"| Dash',
    '  Views -->|"近 14 天证据"| Dream',
    "```",
  ].join("\n");
}

function strength(n, dots = false) {
  n = Math.max(0, Math.min(5, Number(n) || 0));
  if (dots) return "●".repeat(n) + "○".repeat(5 - n);
  return ["", "Very light", "Light", "Balanced", "Strong", "Deepest"][n] || "Balanced";
}

class AddModelModal extends Modal {
  constructor(app, plugin, onAdd, existing = null) {
    super(app);
    this.plugin = plugin;
    this.onAdd = onAdd;
    this.agent = "dsh";
    this.name = "";
    this.route = "deepseek-account";
    this.model = "";
    this.context = "128K";
    this.tags = "Reasoning";
    this.existing = existing;
    if (existing) {
      this.agent = existing.agent; this.name = existing.name;
      this.route = existing.providerRoute || "deepseek-account";
      this.model = existing.model || existing.cli || existing.value || "";
      this.context = existing.context || ""; this.tags = (existing.tags || []).join(", ");
    }
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("ad-modal");
    contentEl.createEl("h3", { text: this.existing ? t("编辑模型") : t("添加模型") });
    contentEl.createDiv({ cls: "ad-muted", text: t("Claude / Codex 填写 CLI 模型名；DSH 填写 provider / model") });
    const form = contentEl.createDiv({ cls: "ad-form" });
    const field = (label, el) => { const f = form.createDiv({ cls: "ad-field" }); f.createDiv({ cls: "ad-field__label", text: label }); el(f); };
    field(t("显示名"), (f) => { const i = f.createEl("input", { cls: "ad-input", attr: { value: this.name, placeholder: t("例如 GPT-6-Luna") } }); i.oninput = () => this.name = i.value; });
    field("Agent", (f) => {
      const s = f.createEl("select", { cls: "ad-select" });
      for (const id of delegateAgents()) s.createEl("option", { text: AGENTS[id]?.name || id, attr: { value: id } });
      s.value = this.agent;
      s.disabled = !!this.existing;
      s.onchange = () => { this.agent = s.value; };
    });
    field(t("Provider route（DSH）"), (f) => { const i = f.createEl("input", { cls: "ad-input", attr: { value: this.route } }); i.oninput = () => this.route = i.value; });
    field(t("模型名或别名"), (f) => { const i = f.createEl("input", { cls: "ad-input", attr: { value: this.model, placeholder: t("例如 gpt-6-luna、deepseek-v4-pro 或 opus") } }); i.oninput = () => this.model = i.value; });
    field(t("上下文"), (f) => { const i = f.createEl("input", { cls: "ad-input", attr: { value: this.context } }); i.oninput = () => this.context = i.value; });
    field(t("能力标签"), (f) => { const i = f.createEl("input", { cls: "ad-input", attr: { value: this.tags, placeholder: "Reasoning, Fast, Vision" } }); i.oninput = () => this.tags = i.value; });
    const bar = contentEl.createDiv({ cls: "ad-btnrow ad-btnrow--end" });
    const cancel = bar.createEl("button", { cls: "ad-btn ad-btn--ghost", text: t("取消") });
    cancel.onclick = () => this.close();
    const add = bar.createEl("button", { cls: "ad-btn ad-btn--cta", text: this.existing ? t("保存") : t("添加") });
    add.onclick = () => {
      const name = this.name.trim() || this.model.trim();
      if (!name || !this.model.trim()) return new Notice(t("显示名和 model 至少填一个"));
      const id = this.existing?.id || `custom-${this.agent}-${Date.now().toString(36)}`;
      const m = {
        id, agent: this.agent, name,
        cli: this.agent !== "dsh" ? this.model.trim() : undefined,
        model: this.model.trim(),
        providerRoute: this.agent === "dsh" ? this.route.trim() : undefined,
        value: this.agent === "dsh" ? JSON.stringify([this.route.trim() || "deepseek-account", this.model.trim()]) : this.model.trim(),
        provider: this.agent === "dsh" ? (this.route.trim() || "DeepSeek") : AGENTS[this.agent].name,
        context: this.context.trim() || "—",
        strength: 3, speed: 3,
        tags: this.tags.split(/[,，]/).map((x) => x.trim()).filter(Boolean),
        cost: "",
        note: "Custom model",
        custom: true,
      };
      this.onAdd(m);
      this.close();
    };
  }
  onClose() { this.contentEl.empty(); }
}
