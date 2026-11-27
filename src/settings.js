import { settingsAgentOrder, moveSettingsAgent } from "./settings-agents.js";
import { changeLogDetail } from "./log-detail.js";
import { JOURNAL_LAYOUT_DEFAULT, journalLayout, builtinJournalLayout, configuredJournalLayout } from "./journal-layout.js";
// Agent Deck — settings: Delegation, Recording, Dreaming, Experiments, and About.

import { archivePath } from "./journal-archive.js";
import * as obsidianNs from "obsidian";
import { App, PluginSettingTab, Notice, Modal, Menu } from "obsidian";
import {
  AGENTS, AGENT_ORDER, MODEL_CATALOG, EFFORTS, CLAUDE_PERMISSIONS, CODEX_SANDBOXES, DEFAULTS, DEFAULT_RECORD_RULES, resolveRecordRules, fmtTok, syncDelegationSettings, journalPath, detectJournalFormat, MEMORY_QUERY_ASSET_VERSION, MEMORY_MCP_ASSET_VERSION,
} from "./constants.js";
import { checkExternalAssets } from "./trace.js";
import { notePath } from "./dream-entries.js";
import { companionInstalled, dreamModelConfig } from "./dream.js";
import { externalMemoryPath } from "./dream-sharing.js";
import { agentIcon, setLucide } from "./icons.js";
import { t, currentLanguage, listCustomLocales } from "./i18n.js";
import { syncModelGroups } from "./model-groups.js";
import { ManagedTimers } from "./runtime-guard.js";
import { delegateAgents, cliHandoffAgents, modelCatalogAgents } from "./agent-registry.js";
import { normalizeCustomAcpId, normalizeCustomAcpEntry } from "./custom-acp.js";
import { detectInstalledHarnesses } from "./harness-detect.js";
import {
  detectJournalProviders, resolveJournalProvider, JOURNAL_PROVIDERS, API_PRESETS, fetchAgyModels, testJournalModel,
} from "./llm.js";
import { DEFAULT_CUSTOM_CONCLUSION_PROMPT, previewConclusion } from "./conclusion.js";
import { discoverGrokBotStorage } from "./grok-bot-sessions.js";
import { discoverMuseConversations } from "./muse-sessions.js";
import { canPickNativeFolder, folderExists, normalizeProjectFolder, pickNativeFolder, projectFolderEntries, sameFolder } from "./project-folders.js";
import { getTerminalOptions } from "./terminals.js";

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

  renderAcpCard(body, cfg, spec, modelCtx) {
    const p = this.plugin;
    const card = this.agentCard(body, spec.id, spec.title, spec.sub, { forceOpen: modelCtx?.filterActive });
    this.modelSelect(card, spec.id, p.defaultModel(spec.id), (v) => { this.setDefaultModel(spec.id, v); this.display(); });
    this.effortControl(card, spec.id, cfg.effort || spec.defaultEffort || "medium", (v) => { this.setDefaultEffort(spec.id, v); this.display(); });
    this.rowToggle(card, t("自动允许工具调用"), t("关闭后逐次确认工具权限"), cfg.autoApprove === true, (v) => { cfg.autoApprove = v; p.saveSettings(); card._refreshPills?.(); });
    const refreshModels = async () => {
      try {
        const models = await p.refreshAcpModels(spec.id);
        if (this.draft) this.draft = catalogSnapshot(p.settings.models);
        this.subOpen[`models-${spec.id}`] = true;
        new Notice(spec.refreshNotice ? spec.refreshNotice(models.length) : t("已读取 {n} 个模型", { n: models.length }));
        this.display();
      } catch (e) { new Notice(t("读取失败：{msg}", { msg: e.message }), 8000); }
    };
    this.renderAgentModels(card, spec.id, modelCtx, { onRefresh: refreshModels, refreshTitle: spec.refreshLabel });
    const more = this.subDetails(card, spec.moreKey, t("更多设置"));
    if (spec.openDesktopToggle) {
      this.rowToggle(more, t("完成后自动在桌面版打开"), "", cfg.openDesktop === true, (v) => { cfg.openDesktop = v; p.saveSettings(); });
    }
    this.rowText(more, spec.pathLabel || t("命令行路径"), spec.pathHint, cfg.path || "", spec.pathPlaceholder || spec.pathHint, (v) => { cfg.path = v.trim(); p.saveSettings(); }, "ad-input--wide");
    this.rowText(more, t("工作目录"), spec.cwdHint || t("留空 = 库根目录"), cfg.cwd || "", t("留空 = 库根目录"), (v) => { cfg.cwd = v.trim(); p.saveSettings(); }, "ad-input--wide");
    if (spec.hasExtraArgs !== false) {
      this.rowText(more, spec.extraArgsLabel || t("额外 ACP 参数"), t("可留空"), cfg.extraArgs || "", t("可留空"), (v) => { cfg.extraArgs = spec.trimExtraArgs === false ? v : v.trim(); p.saveSettings(); }, "ad-input--wide");
    }
    const btns = more.createDiv({ cls: "ad-btnrow" });
    this.bigButton(btns, spec.checkLabel, async () => new Notice(await p.checkBinary(spec.id), 6000));
    card.appendChild(more.parentElement);
    return card;
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
      const targetSel = typeof this._scrollToModels === "string"
        ? `.ad-modelgroup[data-agent="${this._scrollToModels}"]`
        : ".ad-models-card";
      const mc = containerEl.querySelector?.(targetSel) || containerEl.querySelector?.(".ad-models-card");
      if (mc?.scrollIntoView) mc.scrollIntoView({ block: "start", behavior: "smooth" });
      if (this._scrollToModels === true && !focusSearch) {
        containerEl.querySelector?.(".ad-models-card .ad-search__input")?.focus?.();
      }
      this._scrollToModels = false;
    }
    if (focusSearch) {
      const i = containerEl.querySelector(".ad-search__input");
      if (i) { i.focus(); try { i.setSelectionRange(i.value.length, i.value.length); } catch { /* range */ } }
    }
  }

  // ---------- shared bits ----------
  card(parent, title, sub, renderRight = null) {
    const c = parent.createDiv({ cls: "ad-card" });
    if (title) {
      const h = c.createDiv({ cls: "ad-card__head" + (renderRight ? " ad-card__head--bar" : "") });
      const textWrap = renderRight ? h.createDiv({ cls: "ad-card__head-text" }) : h;
      textWrap.createDiv({ cls: "ad-card__title", text: title });
      if (sub) textWrap.createDiv({ cls: "ad-card__sub", text: sub });
      if (renderRight) renderRight(h.createDiv({ cls: "ad-card__head-actions" }), h);
    }
    return c;
  }

  delegateSummaryPills(agent) {
    const p = this.plugin;
    const d = p.settings?.delegate || {};
    const cfg = d[agent] || {};
    if (agent === "t3code") {
      const pills = [t("t3 CLI"), t("在客户端选择模型")];
      if (cfg.openDesktop === true) pills.push(t("完成后自动在桌面版打开"));
      return pills;
    }
    const pills = [];
    const modelId = typeof p.defaultModel === "function" ? p.defaultModel(agent) : (cfg.model ?? "");
    if (!modelId || modelId === `${agent}-default`) {
      pills.push(t("CLI 默认"));
    } else {
      const m = typeof p.modelById === "function" ? p.modelById(modelId) : null;
      pills.push(m?.name || modelId);
    }
    if (cfg.effort) pills.push(cfg.effort);
    if (agent === "claude" || agent === "qoder") {
      pills.push(cfg.permission || "auto");
    } else if (agent === "codex") {
      const transport = (cfg.transport || "desktop") === "terminal" ? t("终端") : t("桌面版");
      pills.push(`${transport} · ${cfg.sandbox || "workspace-write"}`);
    } else {
      pills.push(cfg.autoApprove === true ? t("自动允许") : t("逐次确认"));
    }
    return pills;
  }

  agentCard(parent, agent, title, sub = "", { forceOpen = false } = {}) {
    const p = this.plugin;
    const state = p.settings.ui.delegateGroups[agent];
    const card = parent.createEl("details", { cls: "ad-delegate-agent" });
    card.dataset.agent = agent;
    card.open = forceOpen ? true : state.open;
    card.ontoggle = () => {
      if (forceOpen || !card.isConnected || p.settings.ui.delegateGroups[agent] !== state || state.open === card.open) return;
      state.open = card.open;
      p.saveSettings();
    };
    const head = card.createEl("summary", { cls: "ad-delegate-agent__head" });
    agentIcon(head.createSpan({ cls: "ad-glyph" }), agent);
    head.createSpan({ cls: "ad-delegate-agent__name", text: title });
    if (p.defaultTarget?.() === agent) {
      head.createSpan({ cls: "ad-delegate-tag is-default", text: t("默认") });
    } else if (p.isPrimary?.(agent)) {
      head.createSpan({ cls: "ad-delegate-tag", text: t("主力") });
    }
    const pillsEl = head.createSpan({ cls: "ad-delegate-agent__pills" });
    const body = card.createDiv({ cls: "ad-delegate-agent__body" });
    body._refreshPills = () => {
      if (typeof pillsEl.empty === "function") pillsEl.empty();
      else {
        pillsEl.textContent = "";
        if (Array.isArray(pillsEl.children)) pillsEl.children = [];
      }
      for (const text of this.delegateSummaryPills(agent)) {
        pillsEl.createSpan({ cls: "ad-delegate-pill", text });
      }
    };
    body._refreshPills();
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
    if (Array.from(rr.children || []).some((c) => c.classList?.contains?.("ad-seg--many")) || rr.querySelector?.(".ad-seg--many")) {
      r.classList?.add?.("ad-row--stack");
    }
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
      const keyInput = this.rowText(parent, keyLabel, t("支持 env:变量名 或 secret:键名（推荐，避免明文进同步盘）；直接填则存于 data.json"), keyValue, t("输入 API Key、env:VAR 或 secret:key（本地 Ollama 可留空）"), onKeyChange, "ad-input--wide");
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
    const destinations = this.card(
      body,
      t("默认委派到"),
      t("仅显示已启用的 Harness；追踪主力与默认委派分别设置"),
      (actions) => {
        this.bigButton(actions, t("重新检测 Harness"), () => p.redetectHarnesses?.(), "ad-btn--compact ad-btn--ghost");
      },
    );
    const targetRow = destinations.createDiv({ cls: "ad-targetpick" });
    const targetHints = {
      claude: t("桌面版 / 后台"),
      codex: t("桌面版 / 终端"),
      qoder: t("桌面版 / CLI"),
      workbuddy: t("客户端交接"),
      teleagent: t("客户端交接"),
      antigravity: t("agy CLI / 终端"),
      t3code: t("t3 CLI / 桌面版"),
      dsh: t("ACP / 自带账号"),
      opencode: t("ACP / 终端"),
      hermes: t("ACP / 终端"),
      minimax: t("ACP / 终端"),
      gemini: t("ACP / 终端"),
      cursor: t("ACP / 桌面交接"),
      trae: t("ACP / 桌面交接"),
      kimicode: t("ACP / 桌面交接"),
    };
    const targetAgents = settingsAgentOrder(s, "delegation", id => p.agentEnabled(id)).filter((id) => p.agentEnabled(id) && !AGENTS[id].trackingOnly);
    for (const id of targetAgents) {
      const a = AGENTS[id];
      const available = id !== "workbuddy" && id !== "teleagent" && !a.trackingOnly;
      const item = targetRow.createDiv({ cls: "ad-settings-target" });
      item.dataset.agent = id;
      this.sortHandle(item, targetRow, "delegation", id);
      const b = item.createEl(available ? "button" : "div", { cls: "ad-target" + (available && p.defaultTarget() === id ? " is-on" : ""), attr: { "data-agent": id } });
      if (available) b.setAttribute("aria-pressed", String(p.defaultTarget() === id));
      b.style.setProperty("--ad-agent", a.color);
      b.style.setProperty("--ad-agent-soft", a.soft);
      agentIcon(b.createSpan({ cls: "ad-glyph" }), id);
      b.createSpan({ text: a.name });
      b.createSpan({ cls: "ad-target__hint", text: a.trackingOnly ? t("暂不支持委派") : (targetHints[id] || t("ACP / 自带账号")) });
      if (available) b.onclick = async () => { d.target = id; await p.saveSettings(); this.display(); };
    }
    if (!targetAgents.length) {
      destinations.createDiv({ cls: "ad-hint", text: t("当前没有已启用的可委派 Harness，点击「重新检测」或前往「记录 → 来源与扫描」开启。") });
    }
    this.renderClientWikiHint(destinations);
    this.agentReorder(targetRow, "delegation", ".ad-settings-target");

    // 2. 委派 → Agent 配置（按上方拖动顺序聚合为一个折叠列表，内嵌可用模型 + 底部自定义 ACP）
    const dModels = this.modelsDraft();
    const allModels = typeof p.allModels === "function" ? p.allModels(dModels.custom) : [];
    const enabledSet = new Set(dModels.enabled);
    const q = this.search.trim().toLowerCase();
    const filterActive = Boolean(q || this.filter !== "all");
    const visibleModels = allModels.filter((m) => {
      if (this.filter === "enabled" && !enabledSet.has(m.id)) return false;
      if (this.filter === "reasoning" && !(m.tags || []).includes("Reasoning")) return false;
      if (this.filter === "fast" && !(m.tags || []).includes("Fast")) return false;
      if (this.filter === "vision" && !(m.tags || []).includes("Vision")) return false;
      if (q && !`${m.name} ${m.provider} ${(m.tags || []).join(" ")}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const pinnedModels = dModels.pinned.map((id) => visibleModels.find((m) => m.id === id)).filter(Boolean);
    const restModels = visibleModels.filter((m) => !dModels.pinned.includes(m.id));
    const rowsByAgent = new Map();
    for (const m of [...pinnedModels, ...restModels]) {
      if (!rowsByAgent.has(m.agent)) rowsByAgent.set(m.agent, []);
      rowsByAgent.get(m.agent).push(m);
    }
    const modelCtx = { draft: dModels, enabledSet, rowsByAgent, filterActive };

    const agentConfigCard = this.card(
      body,
      t("Agent 配置"),
      t("展开调整单个 Agent 的参数与可用模型；顺序与上方保持一致"),
      (actions) => {
        this.bigButton(actions, "＋ " + t("添加模型"), () => new AddModelModal(this.app, p, (m) => {
          this.subOpen[`models-${m.agent}`] = true;
          if (s.ui?.delegateGroups?.[m.agent]) s.ui.delegateGroups[m.agent].open = true;
          this.persistModelsChange((store) => {
            store.custom.push(m);
            if (!store.enabled.includes(m.id)) store.enabled.push(m.id);
            if (!store.order.includes(m.id)) store.order.push(m.id);
          });
        }).open(), "ad-btn--soft ad-btn--compact");
      },
    );
    agentConfigCard.classList.add("ad-models-card");

    const tools = agentConfigCard.createDiv({ cls: "ad-picker-tools" });
    const searchWrap = tools.createDiv({ cls: "ad-search" });
    searchWrap.createSpan({ cls: "ad-search__icon", text: "⌕" });
    const search = searchWrap.createEl("input", { cls: "ad-search__input", attr: { placeholder: t("搜索模型"), value: this.search } });
    let composing = false;
    search.addEventListener?.("compositionstart", () => { composing = true; });
    search.addEventListener?.("compositionend", () => {
      composing = false;
      if (this.search !== search.value) { this.search = search.value; this.display(); }
    });
    search.oninput = (e) => {
      if (composing || e?.isComposing) return;
      this.search = search.value;
      this.display();
    };
    const filters = agentConfigCard.createDiv({ cls: "ad-filters ad-filters--models" });
    for (const [id, label] of [["all", t("全部")], ["enabled", t("已启用")], ["reasoning", t("推理")], ["fast", t("快速")], ["vision", t("视觉")]]) {
      const b = filters.createEl("button", { cls: "ad-chip" + (this.filter === id ? " is-on" : ""), text: label, attr: { "aria-pressed": String(this.filter === id) } });
      b.onclick = () => { this.filter = id; this.display(); };
    }

    const agentList = agentConfigCard.createDiv({ cls: "ad-delegate-list" });
    const acpSpecs = {
      dsh: {
        id: "dsh",
        title: "DeepSeek Harness",
        sub: "",
        moreKey: "dsh-more",
        defaultEffort: "high",
        pathHint: t("留空自动查找"),
        pathPlaceholder: t("自动查找"),
        cwdHint: t("留空使用库根目录"),
        trimExtraArgs: false,
        refreshLabel: t("读取 Harness 可用模型"),
        refreshNotice: (n) => t("已读取 {n} 个模型，包含 Harness 中配置的自定义模型", { n }),
        checkLabel: t("检查 dsh"),
      },
      antigravity: {
        id: "antigravity",
        title: "Antigravity",
        sub: t("通过官方 agy CLI 后台委派，也可在终端交互运行"),
        moreKey: "agy-more",
        pathLabel: t("agy 程序路径"),
        pathHint: t("留空自动查找，例如 ~/.local/bin/agy"),
        extraArgsLabel: t("额外 CLI 参数"),
        refreshLabel: t("读取 Antigravity 可用模型"),
        checkLabel: t("检查 agy"),
      },
      opencode: {
        id: "opencode",
        title: "OpenCode",
        sub: t("通过 OpenCode.app 内置的 opencode-cli acp 后台委派，也可打开桌面端或终端"),
        moreKey: "opencode-more",
        openDesktopToggle: true,
        pathHint: t("留空自动查找（含 OpenCode.app 内置 CLI）"),
        refreshLabel: t("读取 OpenCode 可用模型"),
        checkLabel: t("检查 opencode"),
      },
      hermes: {
        id: "hermes",
        title: "Hermes Agent",
        sub: t("通过 hermes-acp 后台委派，也可在终端用 hermes chat / --resume 续聊"),
        moreKey: "hermes-more",
        defaultEffort: "medium",
        pathHint: t("留空自动查找 hermes-acp（或填 hermes）"),
        refreshLabel: t("读取 Hermes 可用模型"),
        checkLabel: t("检查 hermes-acp"),
      },
      minimax: {
        id: "minimax",
        title: "MiniMax Code",
        sub: t("追踪桌面版与 CLI 会话；装有 mcode CLI 时支持 mcode acp 后台委派与终端续聊"),
        moreKey: "minimax-more",
        openDesktopToggle: true,
        defaultEffort: "medium",
        pathHint: t("留空自动查找 mcode（~/.minimax-code/bin/mcode 或 PATH）"),
        refreshLabel: t("读取 MiniMax 可用模型"),
        checkLabel: t("检查 mcode"),
      },
      cursor: {
        id: "cursor",
        title: "Cursor",
        sub: t("装有 Cursor CLI（agent）时支持 agent acp 后台委派；未装 CLI 时自动复制任务并打开桌面端交接"),
        moreKey: "cursor-more",
        pathHint: t("留空自动查找 agent / cursor-agent"),
        refreshLabel: t("读取 Cursor 可用模型"),
        checkLabel: t("检查 agent"),
      },
      trae: {
        id: "trae",
        title: "Trae",
        sub: t("装有 Trae CLI（traecli）时支持 traecli acp serve 后台委派；未装 CLI 时自动复制任务并打开桌面端交接"),
        moreKey: "trae-more",
        pathHint: t("留空自动查找 traecli / trae-cli"),
        refreshLabel: t("读取 Trae 可用模型"),
        checkLabel: t("检查 traecli"),
      },
      kimicode: {
        id: "kimicode",
        title: "Kimi Code",
        sub: t("装有 Kimi Code CLI（kimi）时支持 kimi acp 后台委派；未装 CLI 时自动复制任务并打开桌面端交接"),
        moreKey: "kimicode-more",
        defaultEffort: "high",
        pathHint: t("留空自动查找 kimi / kimi-code"),
        refreshLabel: t("读取 Kimi Code 可用模型"),
        checkLabel: t("检查 kimi"),
      },
      gemini: {
        id: "gemini",
        title: "Gemini CLI",
        sub: t("通过 gemini --acp 后台委派，也可在终端用 gemini --resume 续聊"),
        moreKey: "gemini-more",
        pathHint: t("留空自动查找 gemini"),
        refreshLabel: t("读取 Gemini 可用模型"),
        checkLabel: t("检查 gemini"),
      },
    };
    const renderConfigurableAgent = (id) => {
      if (filterActive && !(rowsByAgent.get(id)?.length)) return false;
      if (id === "claude") {
        const claude = this.agentCard(agentList, "claude", "Claude Code", "", { forceOpen: filterActive });
        this.modelSelect(claude, "claude", p.defaultModel("claude"), (v) => { this.setDefaultModel("claude", v); this.display(); });
        this.effortControl(claude, "claude", d.claude.effort, (v) => { this.setDefaultEffort("claude", v); this.display(); });
        this.rowSegmented(claude, t("权限模式（默认）"), t("plan：规划；auto：自动判断；acceptEdits：允许修改文件；manual：每步都问。派发时可以在确认框里临时改"), CLAUDE_PERMISSIONS, d.claude.permission, (v) => { d.claude.permission = v; p.saveSettings(); this.display(); });
        this.renderAgentModels(claude, "claude", modelCtx);
        const claudeMore = this.subDetails(claude, "claude-more", t("更多设置"));
        this.rowText(claudeMore, t("命令行路径"), t("留空自动查找"), d.claude.path || "", t("自动查找"), (v) => { d.claude.path = v.trim(); p.saveSettings(); }, "ad-input--wide");
        this.rowText(claudeMore, t("工作目录"), t("留空使用库根目录"), d.claude.cwd, t("留空 = 库根目录"), (v) => { d.claude.cwd = v.trim(); p.saveSettings(); }, "ad-input--wide");
        this.rowToggle(claudeMore, t("完成后自动在桌面版打开"), "", d.claude.openDesktop === true, (v) => { d.claude.openDesktop = v; p.saveSettings(); });
        this.rowToggle(claudeMore, t("把当前库也加进可读目录"), "", d.claude.addVault !== false, (v) => { d.claude.addVault = v; p.saveSettings(); });
        this.rowToggle(claudeMore, t("库没被信任时自动换个目录"), t("使用已信任目录，并添加当前库的访问路径"), d.claude.autoTrustedCwd !== false, (v) => { d.claude.autoTrustedCwd = v; p.saveSettings(); });
        this.rowToggle(claudeMore, t("使用 claude --bg 后台服务"), t("由 Claude 后台服务管理会话"), d.claude.useBackground === true, (v) => { d.claude.useBackground = v; p.saveSettings(); });
        this.rowText(claudeMore, t("额外参数"), t("传给 Claude CLI 的参数"), d.claude.extraArgs, t("可留空"), (v) => { d.claude.extraArgs = v; p.saveSettings(); }, "ad-input--wide");
        const test = claudeMore.createDiv({ cls: "ad-btnrow" });
        this.bigButton(test, t("检查 claude"), async () => { const r = await p.checkBinary("claude"); new Notice(r, 6000); });
        this.bigButton(test, t("在终端里续这个目录"), () => p.openTerminalAt(d.claude.cwd || p.vaultPath, "claude"));
        claude.appendChild(claudeMore.parentElement);
        return true;
      }
      if (id === "codex") {
        const codex = this.agentCard(agentList, "codex", "Codex", "", { forceOpen: filterActive });
        this.rowSegmented(codex, t("派发到"), "", [{ id: "desktop", label: t("Codex 桌面版") }, { id: "terminal", label: t("终端") }], d.codex.transport || "desktop", (v) => { d.codex.transport = v; p.saveSettings(); this.display(); });
        this.modelSelect(codex, "codex", p.defaultModel("codex"), (v) => { this.setDefaultModel("codex", v); this.display(); });
        this.effortControl(codex, "codex", d.codex.effort, (v) => { this.setDefaultEffort("codex", v); this.display(); });
        this.rowSegmented(codex, t("沙箱模式（默认）"), t("read-only：只读；workspace-write：只改工作目录；danger-full-access：完全权限。派发时可以在确认框里临时改"), CODEX_SANDBOXES, d.codex.sandbox || "workspace-write", (v) => { d.codex.sandbox = v; p.saveSettings(); this.display(); });
        this.renderAgentModels(codex, "codex", modelCtx);
        const codexMore = this.subDetails(codex, "codex-more", t("更多设置"));
        for (const [key, label, hint] of [["path", t("codex 程序路径"), t("桌面模式留空优先使用 Desktop 自带程序；终端模式从 PATH 查找")], ["cwd", t("工作目录"), t("留空 = 库根目录")]]) {
          this.rowText(codexMore, label, hint, d.codex[key], hint, (v) => { d.codex[key] = v.trim(); p.saveSettings(); }, "ad-input--wide");
        }
        this.bigButton(codexMore.createDiv({ cls: "ad-btnrow" }), t("检查 codex"), async () => new Notice(await p.checkBinary("codex"), 6000));
        this.rowToggle(codexMore, t("把会话归到 Codex 项目"), t("同目录已有项目就复用，没有就用项目名建一个；项目接口是实验性的，失败时按原样派发"), d.codex.project !== false, (v) => { d.codex.project = v; p.saveSettings(); });
        codex.appendChild(codexMore.parentElement);
        return true;
      }
      if (id === "qoder") {
        const qoder = this.agentCard(agentList, "qoder", "Qoder", t("已登录 qodercli 时后台直接执行；未登录时自动复制任务并打开 Qoder 桌面版交接"), { forceOpen: filterActive });
        this.modelSelect(qoder, "qoder", p.defaultModel("qoder"), (v) => { this.setDefaultModel("qoder", v); this.display(); });
        this.effortControl(qoder, "qoder", d.qoder.effort, (v) => { this.setDefaultEffort("qoder", v); this.display(); });
        this.rowSegmented(qoder, t("权限模式（默认）"), t("plan：规划；auto：自动判断；acceptEdits：允许修改文件；manual：每步都问。派发时可以在确认框里临时改"), CLAUDE_PERMISSIONS, d.qoder.permission, (v) => { d.qoder.permission = v; p.saveSettings(); this.display(); });
        this.renderAgentModels(qoder, "qoder", modelCtx);
        const qoderMore = this.subDetails(qoder, "qoder-more", t("更多设置"));
        for (const [key, label, hint] of [["path", t("命令行路径"), t("留空自动查找（~/.qoder/bin/qodercli/qodercli）")], ["cwd", t("工作目录"), t("留空 = 库根目录")], ["extraArgs", t("额外参数"), t("可留空")]]) {
          this.rowText(qoderMore, label, hint, d.qoder[key] || "", hint, (v) => { d.qoder[key] = v.trim(); p.saveSettings(); }, "ad-input--wide");
        }
        const qtest = qoderMore.createDiv({ cls: "ad-btnrow" });
        this.bigButton(qtest, t("检查 qoder"), async () => new Notice(await p.checkBinary("qoder"), 6000));
        this.bigButton(qtest, t("登录 qoder CLI"), () => p.openTerminalAt(d.qoder.cwd || p.vaultPath, "qoder login"));
        qoder.appendChild(qoderMore.parentElement);
        return true;
      }
      if (id === "t3code") {
        if (filterActive) return false;
        const t3Cfg = (d.t3code ||= { ...DEFAULTS.delegate.t3code });
        const t3Card = this.agentCard(agentList, "t3code", "T3 Code", t("通过 t3 CLI 后台委派与应用内续聊；模型在 T3 Code 客户端选择"));
        this.rowToggle(t3Card, t("完成后自动在桌面版打开"), "", t3Cfg.openDesktop === true, (v) => { t3Cfg.openDesktop = v; p.saveSettings(); t3Card._refreshPills?.(); });
        const t3More = this.subDetails(t3Card, "t3code-more", t("更多设置"));
        this.rowText(t3More, t("t3 程序路径"), t("留空自动查找"), t3Cfg.path || "", t("自动查找"), (v) => { t3Cfg.path = v.trim(); p.saveSettings(); }, "ad-input--wide");
        this.rowText(t3More, t("工作目录"), t("留空使用库根目录"), t3Cfg.cwd || "", t("留空 = 库根目录"), (v) => { t3Cfg.cwd = v.trim(); p.saveSettings(); }, "ad-input--wide");
        this.rowText(t3More, t("额外参数"), t("传给 t3 CLI 的参数"), t3Cfg.extraArgs || "", t("可留空"), (v) => { t3Cfg.extraArgs = v; p.saveSettings(); }, "ad-input--wide");
        this.bigButton(t3More.createDiv({ cls: "ad-btnrow" }), t("检查 t3"), async () => new Notice(await p.checkBinary("t3code"), 6000));
        t3Card.appendChild(t3More.parentElement);
        return true;
      }
      const spec = acpSpecs[id];
      if (spec) {
        this.renderAcpCard(agentList, (d[spec.id] ||= { ...DEFAULTS.delegate[spec.id] }), spec, modelCtx);
        return true;
      }
      return false;
    };

    let hasConfiguredAgents = false;
    for (const id of settingsAgentOrder(s, "delegation", id => p.agentEnabled(id))) {
      if (!p.agentEnabled(id)) continue;
      if (renderConfigurableAgent(id)) hasConfiguredAgents = true;
    }
    if (!hasConfiguredAgents) {
      if (filterActive) {
        agentList.createDiv({ cls: "ad-empty ad-empty--small", text: t("没有符合条件的模型") });
      } else {
        agentList.createDiv({ cls: "ad-delegate-empty", text: t("当前没有已启用的可委派 Agent。") });
      }
    }

    if (!filterActive) {
      const configuredIds = new Set(["claude", "codex", "qoder", "t3code", ...Object.keys(acpSpecs)]);
      const passiveAgents = settingsAgentOrder(s, "delegation", (id) => p.agentEnabled(id))
        .filter((id) => p.agentEnabled(id) && !AGENTS[id]?.customAcp && !configuredIds.has(id));
      if (passiveAgents.length) {
        const passive = agentConfigCard.createDiv({ cls: "ad-delegate-passive" });
        passive.createDiv({ cls: "ad-delegate-passive__title", text: t("仅客户端交接 / 追踪") });
        for (const id of passiveAgents) {
          const desc = id === "workbuddy"
            ? t("客户端交接 · 在客户端选择模型")
            : (id === "teleagent"
              ? t("客户端复制 / 填入交接 · 暂不支持后台委派")
              : t("会话追踪与记录（暂不支持后台委派）"));
          const r = this.row(passive, AGENTS[id].name, "", desc);
          r.dataset.agent = id;
        }
      }
      this.renderCustomAcpSection(agentConfigCard);
    }

    // 3. 委派 → 路由与发送规则（项目目录路由 + 补全 / 前后缀 / 附加要求）
    const routingCard = this.card(
      body,
      t("路由与发送规则"),
      t("项目目录自动路由、@ 候选菜单、附加要求与提示词前后缀"),
    );
    this.rowToggle(routingCard, t("按项目文件夹派活"), t("从笔记认出项目后，派到这个项目的目录；认不出再用各 Agent 的默认目录或库根"), s.autoProjectFolder !== false, (v) => { s.autoProjectFolder = v; p.saveSettings(); });
    this.rowToggle(routingCard, t("输入时显示候选菜单"), t("输入触发符选择 Agent、模型和强度"), d.mentionSuggest !== false, (v) => { d.mentionSuggest = v; p.saveSettings(); });
    this.rowToggle(routingCard, t("委派附加要求"), t("追加到每次委派消息末尾"), d.confirmFirst !== false, (v) => { d.confirmFirst = v; p.saveSettings(); });

    const projCount = projectFolderEntries(s).length;
    const projectBox = this.subDetails(routingCard, "project-folders", t("项目文件夹（{n}）", { n: projCount }));
    projectBox.createDiv({
      cls: "ad-hint",
      text: t("派活时按项目选目录；笔记里的双链、路径或「项目 -> 标题」也能认出项目，笔记项目优先于各 Agent 的默认目录。Codex 会把会话归到同名项目。"),
    });
    this.renderProjectFolders(projectBox);
    routingCard.appendChild(projectBox.parentElement);

    const rulesMore = this.subDetails(routingCard, "rules-more", t("更多设置"));
    this.rowToggle(rulesMore, t("非日记笔记的派发也记进当天日记"), t("默认不记，结论仍写回原笔记；打开后和普通会话一样进当天日记"), s.noteDispatchJournal === true, (v) => { s.noteDispatchJournal = v; p.saveSettings(); });
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
    const confirm = rulesMore.createDiv({ cls: "ad-field" });
    confirm.createDiv({ cls: "ad-field__label", text: t("附加要求正文（可自定义）") });
    const confirmTa = confirm.createEl("textarea", { cls: "ad-textarea", attr: { rows: "5" } });
    confirmTa.value = d.confirmFirstPrompt ?? DEFAULTS.delegate.confirmFirstPrompt;
    confirmTa.onchange = () => { d.confirmFirstPrompt = confirmTa.value; p.saveSettings(); };
    const excluded = rulesMore.createDiv({ cls: "ad-field" });
    excluded.createDiv({ cls: "ad-field__label", text: t("不注入目录（每行一个）") });
    const excludedTa = excluded.createEl("textarea", { cls: "ad-textarea", attr: { placeholder: t("例如：私密日记（每行一个路径）"), rows: "2" } });
    excludedTa.value = Array.isArray(d.excludedDirs) ? d.excludedDirs.join("\n") : String(d.excludedDirs || "");
    excludedTa.onchange = () => {
      d.excludedDirs = excludedTa.value.split(/[\n,;]+/).map((s) => s.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")).filter(Boolean);
      p.saveSettings();
    };
    routingCard.appendChild(rulesMore.parentElement);

    // 4. 委派 → 多任务与终端
    const stewardNow = s.projectTeams?.stewards?.default || {};
    const stewardAgentVal = stewardNow.enabled === false || !stewardNow.agent || !p.agentEnabled(stewardNow.agent) ? "off" : stewardNow.agent;
    const showTerminal = cliHandoffAgents().some((id) => p.agentEnabled(id));
    const opsCard = this.card(body, t("多任务与终端"), t("看板多任务波次汇总与交互式终端委派"));
    this.rowSelect(
      opsCard,
      t("管家 Agent"),
      t("看板一次派发多条任务时自动汇总进度；选「关闭」就不起管家会话，避免占错配额"),
      [{ id: "off", label: t("关闭") }, ...settingsAgentOrder(s, "delegation", (id) => p.agentEnabled(id) && delegateAgents().includes(id) && !AGENTS[id]?.trackingOnly).filter((id) => p.agentEnabled(id) && delegateAgents().includes(id) && !AGENTS[id]?.trackingOnly).map((id) => ({ id, label: AGENTS[id].name }))],
      stewardAgentVal,
      (v) => {
        s.projectTeams ||= {};
        s.projectTeams.stewards ||= {};
        s.projectTeams.stewards.default = v === "off" ? { enabled: false } : { enabled: true, agent: v };
        p.saveSettings();
      },
    );
    this.rowToggle(opsCard, t("管家中途看护"), t("每 5 分钟看一眼波次：有会话 15 分钟没有输出，就提醒一次并写回子卡。默认关"), s.stewardWatch === true, (v) => {
      s.stewardWatch = v;
      p.saveSettings();
      p.startStewardWatch?.();
    });
    if (showTerminal) {
      const termSupportedIds = cliHandoffAgents().filter((id) => p.agentEnabled(id));
      const termList = (termSupportedIds.length ? termSupportedIds : cliHandoffAgents())
        .map((id) => AGENTS[id]?.name || id)
        .join("、");
      this.rowSelect(opsCard, t("主力终端"), t("用于终端委派和恢复会话"), getTerminalOptions(), s.cliTerminal || "auto", (v) => { s.cliTerminal = v; p.saveSettings(); this.display(); });
      this.rowToggle(opsCard, t("默认在终端委派"), t("适用于 {agents}", { agents: termList }), !!s.delegateInTerminal, (v) => { s.delegateInTerminal = v; p.saveSettings(); p.refreshUI(); });
    }
  }

  renderProjectFolders(card) {
    const p = this.plugin;
    const folders = (p.settings.projectFolders ||= {});
    const entries = projectFolderEntries(p.settings);
    if (!entries.length) {
      card.createDiv({ cls: "ad-hint", text: t("还没有登记。在委派对话框里填一次目录，就会按项目名记住；也可以在这里直接加。") });
    } else {
      const listEl = card.createDiv({ cls: "ad-proj-list" });
      for (const e of entries) {
        const item = listEl.createDiv({ cls: "ad-proj-item" });
        item.createSpan({ cls: "ad-proj-item__name", text: e.name });
        const input = item.createEl("input", { cls: "ad-input", attr: { type: "text", value: e.path } });
        input.onchange = () => {
          if (!folderExists(input.value)) { new Notice(t("目录不存在：{path}", { path: input.value })); return; }
          folders[e.name] = normalizeProjectFolder(input.value);
          p.saveSettings();
          this.display();
        };
        const remove = item.createEl("button", { cls: "ad-btn ad-btn--ghost ad-btn--compact", text: t("移除"), attr: { type: "button" } });
        remove.onclick = () => { delete folders[e.name]; p.saveSettings(); this.display(); };
      }
    }
    const add = card.createDiv({ cls: "ad-proj-add" });
    const name = add.createEl("input", { cls: "ad-input ad-proj-add__name", attr: { type: "text", placeholder: t("项目名") } });
    const dir = add.createEl("input", { cls: "ad-input ad-proj-add__dir", attr: { type: "text", placeholder: t("例如：~/claude/agent-deck") } });
    const addBtns = add.createDiv({ cls: "ad-proj-add__btns" });
    if (canPickNativeFolder()) {
      const browse = addBtns.createEl("button", { cls: "ad-btn ad-btn--ghost ad-btn--compact", text: t("浏览…"), attr: { type: "button" } });
      browse.onclick = async () => {
        const picked = await pickNativeFolder(dir.value || p.vaultPath || "");
        if (!picked) return;
        dir.value = picked;
        if (!name.value.trim()) name.value = picked.split("/").pop() || "";
      };
    }
    const addBtn = addBtns.createEl("button", { cls: "ad-btn ad-btn--soft ad-btn--compact", text: t("登记"), attr: { type: "button" } });
    addBtn.onclick = () => {
      const label = name.value.trim();
      const folder = normalizeProjectFolder(dir.value);
      if (!label || !folder) { new Notice(t("项目名和目录都要填")); return; }
      if (!folderExists(folder)) { new Notice(t("目录不存在：{path}", { path: folder })); return; }
      folders[label] = folder;
      p.saveSettings();
      this.display();
    };
    const suggestions = (p.projectFolderSuggestions?.(6) || [])
      .filter((s) => s?.path && !entries.some((e) => sameFolder(e.path, s.path)));
    if (suggestions.length) {
      const suggBox = card.createDiv({ cls: "ad-proj-suggs" });
      suggBox.createDiv({ cls: "ad-hint", text: t("最近在会话里用过的目录（点一下直接登记）：") });
      const chipRow = suggBox.createDiv({ cls: "ad-proj-suggs__chips" });
      for (const s of suggestions) {
        const btn = chipRow.createEl("button", {
          cls: "ad-btn ad-btn--ghost ad-btn--compact ad-proj-chip",
          text: `+ ${s.name} · ${s.path}`,
          attr: { type: "button", title: s.path },
        });
        btn.onclick = () => {
          folders[s.name] = s.path;
          p.saveSettings();
          this.display();
        };
      }
    }
  }

  setDefaultModel(agent, value) {
    const s = this.plugin.settings;
    s.delegate[agent].model = value;
    s.models.defaultByAgent[agent] = value;
    if (value && !s.models.enabled.includes(value)) s.models.enabled.push(value);
    if (this.draft && value && !this.draft.enabled.includes(value)) this.draft.enabled.push(value);
    return this.plugin.saveSettings();
  }

  setDefaultEffort(agent, value) {
    const s = this.plugin.settings;
    s.delegate[agent].effort = value;
    (s.models.effortByAgent ||= {})[agent] = value;
    return this.plugin.saveSettings();
  }

  jumpToAgentModels(agent) {
    const ui = (this.plugin.settings.ui ||= {});
    if (ui.delegateGroups?.[agent]) ui.delegateGroups[agent].open = true;
    if (ui.modelGroups?.[agent]) ui.modelGroups[agent].open = true;
    this.subOpen[`models-${agent}`] = true;
    this.filter = "all";
    this.search = "";
    this._scrollToModels = agent;
    this.display();
  }

  modelSelect(parent, agent, value, onChange) {
    const all = this.plugin.modelsFor(agent);
    const enabled = all.filter((m) => this.plugin.modelEnabled(m.id));
    const models = agent === "codex" ? [...all] : [...enabled];
    if (value && !models.some((m) => m.id === value)) models.push(this.plugin.modelById(value) || { id: value, name: value });
    const hasDefaultEntry = models.some((m) => m.id === `${agent}-default` || m.id === "");
    const options = [
      ...(hasDefaultEntry ? [] : [{ id: "", label: t("不指定（使用当前默认模型）") }]),
      ...models.map((m) => ({ id: m.id, label: m.name })),
    ];
    const selected = options.some((o) => o.id === value) ? value : (options[0]?.id ?? "");
    return this.row(parent, t("默认模型"), "", (rr) => {
      this.selectInput(rr, options, selected, onChange);
    });
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

  async persistModelsChange(mutator) {
    const p = this.plugin;
    const m = (p.settings.models ||= {});
    m.enabled = Array.isArray(m.enabled) ? m.enabled : [];
    m.pinned = Array.isArray(m.pinned) ? m.pinned : [];
    m.order = Array.isArray(m.order) ? m.order : [];
    m.custom = Array.isArray(m.custom) ? m.custom : [];
    mutator(m);
    for (const agent of delegateAgents()) {
      const cur = p.defaultModel ? p.defaultModel(agent) : p.settings.delegate?.[agent]?.model;
      if (!cur) continue;
      const exists = p.modelsFor ? p.modelsFor(agent).some((x) => x.id === cur) : true;
      if (!m.enabled.includes(cur) || !exists) {
        const enabledForAgent = (p.modelsFor ? p.modelsFor(agent) : []).filter((x) => m.enabled.includes(x.id));
        const fallback = enabledForAgent.find((x) => x.id === `${agent}-default`)?.id || enabledForAgent[0]?.id || "";
        if (p.settings.delegate?.[agent]) p.settings.delegate[agent].model = fallback;
        (m.defaultByAgent ||= {})[agent] = fallback;
      }
    }
    this.draft = catalogSnapshot(m);
    try {
      await p.saveSettings();
    } catch (e) {
      new Notice(t("保存模型设置失败：{error}", { error: e?.message || String(e) }), 6000);
    }
    this.display();
  }

  renderCustomAcpSection(parent) {
    const p = this.plugin;
    const s = p.settings;
    const list = (s.customAcpAgents ||= []);
    const box = parent.createDiv({ cls: "ad-custom-acp" });
    const head = box.createDiv({ cls: "ad-custom-acp__head" });
    const titleWrap = head.createDiv({ cls: "ad-custom-acp__titlewrap" });
    titleWrap.createDiv({ cls: "ad-custom-acp__title", text: t("自定义 ACP Agent") });
    titleWrap.createDiv({
      cls: "ad-custom-acp__sub",
      text: t("填写任意兼容 ACP 协议的 CLI 命令、参数与环境变量即可接入后台委派与应用内续聊，环境变量值支持 secret:KEY / env:VAR"),
    });
    const persist = () => {
      p.syncCustomAcpAgents?.();
      syncDelegationSettings(s, s);
      p.saveSettings();
      p.refreshUI?.();
      this.display();
    };
    this.bigButton(head, t("+ 添加自定义 ACP Agent"), () => new CustomAcpAgentModal(this.app, null, list, (entry) => {
      list.push(entry);
      persist();
    }).open(), "ad-btn--soft ad-btn--compact");
    if (!list.length) {
      box.createDiv({ cls: "ad-hint", text: t("尚未添加自定义 ACP Agent（可接入 Kiro、Mistral Vibe、Pi 等任意 ACP 命令）") });
      return;
    }
    const listEl = box.createDiv({ cls: "ad-custom-acp__list" });
    for (const entry of list) {
      const item = listEl.createDiv({ cls: "ad-custom-acp__item" });
      const info = item.createDiv({ cls: "ad-custom-acp__info" });
      const top = info.createDiv({ cls: "ad-custom-acp__top" });
      top.createSpan({ cls: "ad-custom-acp__name", text: entry.name || entry.id });
      top.createSpan({ cls: "ad-delegate-pill", text: `@${entry.id}` });
      if (entry.autoApprove) top.createSpan({ cls: "ad-delegate-pill", text: t("自动允许") });
      info.createDiv({ cls: "ad-custom-acp__cmd", text: `${entry.command}${entry.args ? " " + entry.args : ""}` });
      const actions = item.createDiv({ cls: "ad-custom-acp__actions" });
      this.toggle(actions, entry.enabled !== false, (v) => { entry.enabled = v; persist(); });
      this.bigButton(actions, t("检查"), async () => new Notice(await p.checkBinary(entry.id), 6000), "ad-btn--compact ad-btn--ghost");
      this.bigButton(actions, t("编辑"), () => new CustomAcpAgentModal(this.app, entry, list, (next) => {
        Object.assign(entry, next);
        persist();
      }).open(), "ad-btn--compact ad-btn--ghost");
      this.bigButton(actions, t("删除"), () => {
        const idx = list.indexOf(entry);
        if (idx >= 0) list.splice(idx, 1);
        if (s.agents) delete s.agents[entry.id];
        if (s.delegate) delete s.delegate[entry.id];
        persist();
      }, "ad-btn--compact ad-btn--ghost");
    }
  }

  renderAgentModels(parent, agent, modelCtx, { onRefresh = null, refreshTitle = "" } = {}) {
    const p = this.plugin;
    const d = modelCtx.draft;
    const rows = modelCtx.rowsByAgent.get(agent) || [];
    const key = `models-${agent}`;
    const g = parent.createEl("details", { cls: "ad-modelgroup ad-agent-models" });
    g.dataset.agent = agent;
    g.open = modelCtx.filterActive ? true : (this.subOpen[key] ?? false);
    g.ontoggle = () => {
      if (!g.isConnected || modelCtx.filterActive) return;
      this.subOpen[key] = g.open;
    };
    const gh = g.createEl("summary", { cls: "ad-modelgroup__head" });
    gh.createSpan({ text: t("可用模型") });
    gh.createSpan({
      cls: "ad-muted",
      text: t("已启用 {n} / {total}", { n: rows.filter((m) => modelCtx.enabledSet.has(m.id)).length, total: rows.length }),
    });
    const actions = gh.createDiv({ cls: "ad-modelgroup__actions" });
    if (onRefresh) {
      const refreshBtn = actions.createEl("button", {
        cls: "ad-linkbtn",
        text: t("读取模型"),
        attr: { type: "button", title: refreshTitle || t("读取模型") },
      });
      refreshBtn.onclick = (e) => {
        e?.preventDefault?.();
        e?.stopPropagation?.();
        onRefresh();
      };
    }
    if (modelCatalogAgents().includes(agent)) {
      const addGroup = actions.createEl("button", { cls: "ad-linkbtn", text: "＋ " + t("添加"), attr: { type: "button" } });
      addGroup.onclick = (e) => {
        e?.preventDefault?.();
        e?.stopPropagation?.();
        new AddModelModal(this.app, p, (m) => {
          this.subOpen[key] = true;
          this.persistModelsChange((store) => {
            store.custom.push(m);
            if (!store.enabled.includes(m.id)) store.enabled.push(m.id);
            if (!store.order.includes(m.id)) store.order.push(m.id);
          });
        }, null, { defaultAgent: agent }).open();
      };
    }
    if (rows.length) this.groupAction(actions, rows, d);
    const bodyEl = g.createDiv({ cls: "ad-modelgroup__body" });
    if (!rows.length) {
      bodyEl.createDiv({ cls: "ad-hint", text: t("没有符合条件的模型") });
    } else {
      const defaultId = p.defaultModel(agent);
      for (const m of rows) this.modelRow(bodyEl, m, d, agent, defaultId, d.pinned.includes(m.id));
    }
    return g;
  }

  groupAction(head, rows, d) {
    const allOn = rows.every((m) => d.enabled.includes(m.id));
    const b = head.createEl("button", { cls: "ad-linkbtn", text: allOn ? t("全部关闭") : t("全部开启"), attr: { type: "button" } });
    b.onclick = (e) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      const rowIds = new Set(rows.map((m) => m.id));
      this.persistModelsChange((store) => {
        if (allOn) {
          store.enabled = store.enabled.filter((id) => !rowIds.has(id));
        } else {
          for (const id of rowIds) {
            if (!store.enabled.includes(id)) store.enabled.push(id);
          }
        }
      });
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
    const metaParts = [];
    if (m.context && m.context !== "—") metaParts.push({ cls: "", text: m.context });
    if (Number(m.strength) > 0) metaParts.push({ cls: "", text: strength(m.strength, true) });
    const tags = Array.isArray(m.tags) ? m.tags.filter(Boolean) : [];
    if (tags.length) metaParts.push({ cls: "tags", tags });
    if (m.cost) metaParts.push({ cls: "ad-cost", text: m.cost });
    if (metaParts.length) {
      const meta = left.createDiv({ cls: "ad-modelrow__meta" });
      metaParts.forEach((part, idx) => {
        if (idx > 0) meta.createSpan({ cls: "ad-dot", text: "·" });
        if (part.cls === "tags") {
          for (const tag of part.tags) meta.createSpan({ cls: "ad-cap", text: tag });
        } else if (part.cls) {
          meta.createSpan({ cls: part.cls, text: part.text });
        } else {
          meta.createSpan({ text: part.text });
        }
      });
    }
    const right = row.createDiv({ cls: "ad-modelrow__right" });
    this.toggle(right, on, (v) => {
      this.persistModelsChange((store) => {
        const i = store.enabled.indexOf(m.id);
        if (v && i < 0) store.enabled.push(m.id);
        if (!v && i >= 0) store.enabled.splice(i, 1);
      });
    });
    const more = right.createEl("button", { cls: "ad-morebtn", text: "⋯" });
    more.onclick = (e) => {
      e.stopPropagation();
      const menu = new Menu();
      menu.addItem((it) => it.setTitle(pinned ? t("取消置顶") : t("置顶")).setIcon(pinned ? "pin-off" : "pin").onClick(() => {
        this.persistModelsChange((store) => {
          const i = store.pinned.indexOf(m.id);
          if (pinned && i >= 0) store.pinned.splice(i, 1);
          if (!pinned && i < 0) store.pinned.push(m.id);
        });
      }));
      menu.addItem((it) => it.setTitle(t("上移")).setIcon("arrow-up").onClick(() => this.moveModel(d, m, -1)));
      menu.addItem((it) => it.setTitle(t("下移")).setIcon("arrow-down").onClick(() => this.moveModel(d, m, 1)));
      if ((m.custom || d.custom.some((x) => x.id === m.id))) {
        menu.addItem((it) => it.setTitle(t("编辑模型")).setIcon("pencil").onClick(() => {
          new AddModelModal(this.app, this.plugin, (edited) => {
            this.persistModelsChange((store) => {
              store.custom = store.custom.map((x) => x.id === m.id ? edited : x);
            });
          }, m).open();
        }));
        menu.addItem((it) => it.setTitle(t("移除")).setIcon("trash").onClick(() => {
          this.persistModelsChange((store) => {
            store.custom = store.custom.filter((x) => x.id !== m.id);
            store.enabled = store.enabled.filter((x) => x !== m.id);
            store.pinned = store.pinned.filter((x) => x !== m.id);
          });
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
    const order = d.order.length ? [...d.order] : this.plugin.allModels(d.custom).map((x) => x.id);
    const i = order.indexOf(m.id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    this.persistModelsChange((store) => { store.order = order; });
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
        const enabledForAgent = p.modelsFor ? p.modelsFor(agent).filter((x) => p.settings.models.enabled.includes(x.id)) : [];
        const fallback = enabledForAgent.find((x) => x.id === `${agent}-default`)?.id || enabledForAgent[0]?.id || "";
        if (p.settings.delegate?.[agent]) p.settings.delegate[agent].model = fallback;
        p.settings.models.defaultByAgent[agent] = fallback;
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

  renderMusePicker(card, sessCountEl, s, p) {
    const maxTracked = Math.max(1, Math.min(20, Number(s.museMaxTracked) || 5));
    const configured = Array.isArray(s.museTrackedIds) ? s.museTrackedIds : ["hatch-main"];
    const selected = new Set(configured.map((x) => String(x || "").trim()).filter(Boolean).slice(0, maxTracked));
    const conversations = typeof p.museConversations === "function"
      ? p.museConversations()
      : discoverMuseConversations(s.museCacheDir ? { cacheDir: s.museCacheDir } : {}).conversations;

    const details = card.createEl("details", { cls: "ad-subdetails ad-grokbot-picker" });
    details.open = typeof this._museThreadsOpen === "boolean" ? this._museThreadsOpen : conversations.length > 1;
    details.ontoggle = () => { this._museThreadsOpen = details.open; };
    const summary = details.createEl("summary", { cls: "ad-subdetails__head" });
    const summaryTitle = summary.createSpan({ cls: "ad-grokbot-picker__title" });
    const updateSummary = () => {
      if (!selected.size) {
        summaryTitle.textContent = t("追踪对话流 · 未选择（上限 {max} 个）", { max: maxTracked });
        return;
      }
      const names = conversations.filter((c) => selected.has(c.id)).map((c) => (c.isMain ? "Main Chat" : c.title));
      const preview = names.length > 3 ? t("{names} 等 {n} 个", { names: names.slice(0, 3).join("、"), n: names.length }) : names.join("、");
      summaryTitle.textContent = preview
        ? t("追踪对话流 · 已选 {n}/{max}（{preview}）", { n: selected.size, max: maxTracked, preview })
        : t("追踪对话流 · 已选 {n}/{max}", { n: selected.size, max: maxTracked });
    };
    updateSummary();

    const body = details.createDiv({ cls: "ad-grokbot-picker__body" });
    if (!conversations.length) {
      body.createSpan({ cls: "ad-muted", text: t("未检测到本机 Muse 对话缓存") });
    } else {
      const chips = body.createDiv({ cls: "ad-seg ad-seg--many ad-grokbot-picker__chips" });
      for (const conv of conversations) {
        const on = selected.has(conv.id);
        const label = conv.isMain ? "Main Chat (Muse)" : conv.title;
        const b = chips.createEl("button", { cls: "ad-seg__btn ad-grokbot-chip" + (on ? " is-on" : ""), text: label, attr: { "aria-pressed": String(on), "data-muse-id": conv.id } });
        b.onclick = async () => {
          if (selected.has(conv.id)) {
            selected.delete(conv.id);
          } else {
            if (selected.size >= maxTracked) {
              new Notice(t("最多同时追踪 {max} 个 Muse 对话流，请先取消一个", { max: maxTracked }));
              return;
            }
            selected.add(conv.id);
          }
          s.museTrackedIds = [...selected];
          const nowOn = selected.has(conv.id);
          b.classList.toggle("is-on", nowOn);
          b.setAttribute("aria-pressed", String(nowOn));
          updateSummary();
          await p.saveSettings?.();
          p.watchMuseCache?.();
          await p.scanNow?.(false, { agent: "muse" });
          const nextCount = [...(p.usage?.meta?.values?.() || [])].filter((x) => x.agent === "muse").length;
          if (sessCountEl) sessCountEl.textContent = t("{n} 个会话", { n: nextCount });
        };
      }
    }
    this.rowToggle(
      body,
      t("追踪 Muse 主动推送消息"),
      t("默认仅追踪你发起的对话；开启后连同 Muse 主动发送的消息一起记录"),
      s.museTrackProactive === true,
      async (v) => {
        s.museTrackProactive = v;
        await p.saveSettings?.();
        await p.scanNow?.(false, { agent: "muse" });
        const nextCount = [...(p.usage?.meta?.values?.() || [])].filter((x) => x.agent === "muse").length;
        if (sessCountEl) sessCountEl.textContent = t("{n} 个会话", { n: nextCount });
      },
    );
    card.createDiv({ cls: "ad-hint", text: t("Muse 仅在重启或刷新历史时写入本地缓存，缓存更新后 Agent Deck 会自动追踪。") });
  }

  // ---------- Recording ----------
  renderAgents(body) { return this.renderRecord(body); }
  renderTracking(body) { return this.renderRecord(body); }

  renderClientWikiHint(parent) {
    const url = t("https://github.com/MatsuriMW/obsidian-agent-deck/wiki/Supported-Agents-and-Models");
    const hint = parent.createDiv({ cls: "ad-hint ad-client-wiki-hint" });
    hint.createSpan({ text: t("部分客户端（主要是一些国内客户端）不支持委派，部分客户端有一些前置的安装或开关配置需求，具体可查看 ") });
    hint.createEl("a", {
      cls: "external-link",
      text: t("GitHub Wiki（支持列表与前置要求）"),
      href: url,
      attr: { href: url, target: "_blank", rel: "noopener noreferrer" },
    });
  }

  renderTrackingAgentCard(grid, id, { enabled, primary, detected }) {
    const p = this.plugin;
    const s = p.settings;
    const a = AGENTS[id];
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
    if (enabled) this.sortHandle(controls, grid, "tracking", id);
    const sessions = [...p.usage.meta.values()].filter((x) => x.agent === id && !p.usage.delegatedOwnerOf?.(x.sid, x.agent));
    const stats = card.createDiv({ cls: "ad-set-agent__meta" });
    const sessCountEl = stats.createSpan({ text: t("{n} 个会话", { n: sessions.length }) });
    stats.createSpan({ text: id === "grokbot" || id === "muse" || id === "doubaowork" ? t("用量未提供") : fmtTok(sessions.reduce((n, x) => n + (x.out || 0), 0)) + " tok" });
    const stateText = primary
      ? t("主力（全量）")
      : enabled
        ? t("追踪中")
        : (detected ? t("已关闭 · 本机已安装") : t("已关闭 · 未检测到"));
    stats.createSpan({ cls: "ad-set-agent__state", text: stateText });
    if (id === "grokbot" && enabled) this.renderGrokBotPicker(card, sessCountEl, s, p);
    if (id === "muse" && enabled) this.renderMusePicker(card, sessCountEl, s, p);
    if (enabled && (id === "t3code" || id === "cindy" || id === "orca")) {
      let dedupCount = 0;
      for (const owners of p.usage?.delegatedOwners?.values?.() || []) {
        if (owners?.has?.(id)) dedupCount++;
      }
      card.createDiv({
        cls: "ad-hint",
        text: dedupCount > 0
          ? t("已自动去重 {n} 个底层 Agent 会话，统一归入 {agent}；关闭追踪可随时恢复", { n: dedupCount, agent: a.short })
          : t("由 {agent} 拉起的底层 Agent 会话会自动去重，统一归入 {agent} 不重复统计", { agent: a.short }),
      });
    }
  }

  renderRecord(body) {
    const p = this.plugin;
    const s = p.settings;
    const d = s.delegate;

    // 1. 记录 → 来源与扫描
    const detection = typeof p.detectedHarnesses === "function"
      ? p.detectedHarnesses()
      : detectInstalledHarnesses({ cfg: s });
    const detectedMap = detection?.detected || {};
    const orderedIds = settingsAgentOrder(s, "tracking", id => p.agentEnabled(id));
    const enabledIds = orderedIds.filter((id) => p.agentEnabled(id));
    const disabledIds = orderedIds.filter((id) => !p.agentEnabled(id));

    const sourceCard = this.card(body, t("来源与扫描"), t("默认只开启本机已安装的 Harness；最多三位主力读取全部历史"));
    const grid = sourceCard.createDiv({ cls: "ad-set-agents" });
    for (const id of enabledIds) {
      this.renderTrackingAgentCard(grid, id, {
        enabled: true,
        primary: p.isPrimary(id),
        detected: !!detectedMap[id],
      });
    }
    if (!enabledIds.length) {
      grid.createDiv({ cls: "ad-hint", text: t("当前没有已启用的 Harness，点击下方「重新检测 Harness」自动识别本机工具，或展开下方列表手动开启。") });
    }
    this.agentReorder(grid, "tracking", ".ad-set-agent");

    if (disabledIds.length) {
      const disabledBody = this.subDetails(
        sourceCard,
        "disabled-agents",
        t("未安装或已关闭的 Harness（{n}）", { n: disabledIds.length }),
      );
      const disabledGrid = disabledBody.createDiv({ cls: "ad-set-agents ad-set-agents--disabled" });
      for (const id of disabledIds) {
        this.renderTrackingAgentCard(disabledGrid, id, {
          enabled: false,
          primary: false,
          detected: !!detectedMap[id],
        });
      }
    }

    const sourceMore = this.subDetails(sourceCard, "source-more", t("更多设置"));
    const spiralCutoff = p.spiralJournalCutoff?.();
    const cutoff = this.rowNumber(sourceMore, t("日记日期分界"),
      spiralCutoff == null ? t("此时刻之前计入前一天") : t("已跟随螺旋日程，请在螺旋日程中修改"),
      spiralCutoff ?? s.dayCutoff, 0, 23.99, (v) => p.setStandaloneDayCutoff(v));
    cutoff.disabled = spiralCutoff != null;
    this.rowNumber(sourceMore, t("扫描间隔（秒）"), "", s.pollSeconds, 5, 300, (v) => { s.pollSeconds = v; p.saveSettings(); p.scheduleScan(); });
    this.rowNumber(sourceMore, t("主力读多少天历史"), t("非主力读取当天会话"), s.fullHistoryDays, 1, 365, (v) => { s.fullHistoryDays = v; p.saveSettings(); p.scanNow(true); });
    this.rowToggle(sourceMore, t("桌面数据库也读全部历史"),
      t("关闭时桌面库只读上面的天数：几千个会话、几百 MB 的大库（TeleAgent、T3 Code、豆包工作 等）首次扫描不会卡住；打开后主力 Agent 读全部历史，首次扫描明显变慢"),
      s.desktopFullHistory === true, (v) => { s.desktopFullHistory = v; p.saveSettings(); p.scanNow(true); });
    this.rowToggle(sourceMore, t("识别 side chat 和母子关系"), t("Claude 桌面版子会话与母子关联"), s.claudeDesktop !== false, (v) => { s.claudeDesktop = v; p.saveSettings(); p.scanNow(true); });
    if (typeof p.cursorHooksStatus === "function" && p.agentEnabled("cursor")) {
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
    if (typeof p.traeHooksStatus === "function" && p.agentEnabled("trae")) {
      const th = p.traeHooksStatus();
      const statusText = th.outdated
        ? t("Trae Hooks 需要更新（{matched}/{total}）", { matched: th.matchedEvents, total: th.totalEvents })
        : th.installed
          ? t("已配置 Trae Hooks（{matched}/{total}）；需在 Trae 设置 → Hooks 开启「全局 Hooks」（若沙箱拦截写盘请切到「本地自动运行」）", { matched: th.matchedEvents, total: th.totalEvents })
          : t("未安装 Trae Hooks；安装并在 Trae 设置 → Hooks 开启「全局 Hooks」后可追踪 Trae 会话");
      this.row(sourceMore, "Trae Hooks", statusText, (traeRight) => {
        this.bigButton(traeRight, th.installed && !th.outdated ? t("更新 Hooks") : t("安装 Hooks"), () => {
          try { p.installTraeHooks(); } catch (e) { p.notice?.(e.message || String(e)); }
          this.display();
        });
        if (th.installed || th.matchedEvents > 0 || th.scriptExists) {
          this.bigButton(traeRight, t("卸载 Hooks"), () => {
            try { p.uninstallTraeHooks(); } catch (e) { p.notice?.(e.message || String(e)); }
            this.display();
          });
        }
      });
    }
    this.renderClientWikiHint(sourceCard);
    const scanBar = sourceCard.createDiv({ cls: "ad-btnrow" });
    this.bigButton(scanBar, t("立即扫描"), () => p.scanNow(), "mod-cta");
    this.bigButton(scanBar, t("重新检测 Harness"), () => p.redetectHarnesses?.());
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
    this.rowToggle(jr, t("自动创建今日日记"), t("今日日记不存在时按模板自动新建；关闭后只写入已存在的日记，避免抢在自定义模板或 Templater 之前建空文件"), s.journalAutoCreate !== false, (v) => { s.journalAutoCreate = v; p.saveSettings(); });
    this.rowToggle(jr, t("自动会话记录"), t("自动将活跃会话建项并记入今日日记"), s.autoLog === true, (v) => { s.autoLog = v; p.saveSettings(); });
    const autoLogDetails = jr.createEl("details", { cls: "ad-subdetails ad-autolog-picker" });
    autoLogDetails.dataset.section = "auto-log-agents";
    autoLogDetails.open = this.subOpen["auto-log-agents"] ?? false;
    autoLogDetails.ontoggle = () => { if (autoLogDetails.isConnected) this.subOpen["auto-log-agents"] = autoLogDetails.open; };
    const agOn = (s.autoLogAgents ||= {});
    const logAgents = AGENT_ORDER.filter((id) => p.agentEnabled(id));
    const enabledCount = () => logAgents.filter((id) => agOn[id] !== false).length;
    const countText = () => (logAgents.length ? t("已启用 {n} / {total}", { n: enabledCount(), total: logAgents.length }) : t("暂无已启用的 Harness"));
    const autoLogSum = autoLogDetails.createEl("summary", { cls: "ad-subdetails__head" });
    autoLogSum.createSpan({ cls: "ad-autolog-picker__title", text: t("记哪几个 Agent") });
    const countEl = autoLogSum.createSpan({ cls: "ad-autolog-picker__count", text: countText() });
    const toggleAllBtn = logAgents.length
      ? autoLogSum.createEl("button", {
          cls: "ad-linkbtn ad-autolog-picker__toggle",
          text: enabledCount() === logAgents.length ? t("全部关闭") : t("全部开启"),
          attr: { type: "button" },
        })
      : null;
    const autoLogBody = autoLogDetails.createDiv({ cls: "ad-subdetails__body" });
    autoLogBody.createDiv({ cls: "ad-row__desc ad-autolog-picker__desc", text: t("选择自动建项的 Agent") });
    const agBox = autoLogBody.createDiv({ cls: "ad-seg ad-seg--many" });
    const btns = [];
    const syncHeader = () => {
      const n = enabledCount();
      countEl.textContent = countText();
      if (toggleAllBtn) toggleAllBtn.textContent = n === logAgents.length ? t("全部关闭") : t("全部开启");
    };
    for (const id of logAgents) {
      const on = agOn[id] !== false;
      const b = agBox.createEl("button", { cls: "ad-seg__btn" + (on ? " is-on" : ""), text: AGENTS[id]?.short || id, attr: { "aria-pressed": String(on) } });
      b.onclick = () => {
        const nextOn = agOn[id] === false;
        agOn[id] = nextOn;
        b.classList.toggle("is-on", nextOn);
        b.setAttribute("aria-pressed", String(nextOn));
        syncHeader();
        p.saveSettings();
      };
      btns.push({ id, b });
    }
    if (toggleAllBtn) {
      toggleAllBtn.onclick = (e) => {
        e?.preventDefault?.();
        e?.stopPropagation?.();
        const turnOn = enabledCount() < logAgents.length;
        for (const { id, b } of btns) {
          agOn[id] = turnOn;
          b.classList.toggle("is-on", turnOn);
          b.setAttribute("aria-pressed", String(turnOn));
        }
        syncHeader();
        p.saveSettings();
      };
    }
    if (!logAgents.length) agBox.createSpan({ cls: "ad-muted", text: t("暂无已启用的 Harness") });
    const grain = this.row(jr, t("自动记录颗粒度"), t("选择记录的时机"), (rr) => {
      this.segmented(rr, [{ id: "latest", label: t("最新进展") }, { id: "round", label: t("每轮记录") }, { id: "paused", label: t("停歇或归档") }], s.autoLogGranularity || DEFAULTS.autoLogGranularity, (v) => { s.autoLogGranularity = v; p.saveSettings(); this.display(); });
    });
    const rules = (s.recordRules = resolveRecordRules(s));
    const timingRow = this.row(jr, t("会话计时方式"), "", (rr) => {
      this.segmented(
        rr,
        [
          { id: "child", label: t("子块 ⏱（默认 · 与螺旋日程一致）") },
          { id: "inline", label: t("行首 HH:MM-HH:MM（传统）") },
        ],
        rules.showTimeRange ? "inline" : "child",
        (v) => { rules.showTimeRange = v === "inline"; p.saveSettings(); },
      );
    });
    const timingDesc = timingRow.querySelector(":scope > .ad-row__left");
    timingDesc.createDiv({ cls: "ad-row__desc", text: t("子块 ⏱：母块保留原样（预估时长、预约时段或间歇时间戳），子块 ⏱ 记实际用时，便于在螺旋日程中对照「预计 vs 实际」") });
    timingDesc.createDiv({ cls: "ad-row__desc", text: t("行首时段：按旧版在任务行首写入 HH:MM-HH:MM 起止时间段") });
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
    this.rowToggle(wb, t("归档的会话记成 DONE"), "", s.autoLogArchiveDone !== false, (v) => { s.autoLogArchiveDone = v; p.saveSettings(); });
    this.rowToggle(wb, t("整理完弹通知"), "", s.autoLogNotify !== false, (v) => { s.autoLogNotify = v; p.saveSettings(); });

    const rulesBox = this.subDetails(jrMore, "record-rules", t("记录规则细则"));
    this.rowToggle(rulesBox, t("母块标题自动加粗"), t("生成 AI 自动记录时用 **标题** 突出显示"), rules.boldTitle !== false, (v) => { rules.boldTitle = v; p.saveSettings(); });
    this.rowToggle(rulesBox, t("标题自动带项目 / Bot 前缀"), t("工作区项目或 Grok Bot 自动加上「名称 -> 」"), rules.projectPrefix !== false, (v) => { rules.projectPrefix = v; p.saveSettings(); });
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

    // 3. 记录 → 任务结论与总结模型（可单独指定总结 Agent，全部结论格式/字数/提示词收口于此）
    const detected = detectJournalProviders({ cfg: s });
    const detectedNames = detected.available.map((x) => x.label).join("、");
    const modelSub = detected.available.length
      ? t("可单独指定用于总结的 Agent 或 API（不影响委派主力）· 已检测到：{list}", { list: detectedNames })
      : t("可单独指定用于总结的 Agent 或 API（不影响委派主力）· 未检测到已登录 CLI");
    const modelCard = this.card(body, t("任务结论与总结模型"), modelSub);
    const curProvider = s.autoLogProvider || "auto";
    const resolved = resolveJournalProvider(s);
    const autoTarget = detected.providers.find((x) => x.id === detected.recommended);
    const providerOptions = this.detectedProviderChoices(detected, {
      id: "auto",
      label: autoTarget?.available
        ? t("自动挑选本机 CLI（当前：{name}）", { name: autoTarget.label })
        : t("自动挑选本机 CLI"),
    });
    this.rowSelect(modelCard, t("总结使用的 Agent / 来源"), t("单独为日志整理与结论总结指定本机已登录 CLI，或自填兼容 OpenAI 格式的 API"), providerOptions, curProvider, (v) => {
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
    this.rowToggle(modelCard, t("每轮结论让模型润色"), t("适用于简略和标准记录；关闭后直接按本地规则截取"), s.roundPolish !== false, (v) => { s.roundPolish = v; p.saveSettings(); });

    this.rowSegmented(
      modelCard,
      t("自动日志详细程度"),
      t("简略：任务+结论合一段｜标准：问答各一句｜详细：保留摘录与步骤"),
      [{ id: "brief", label: t("简略（默认）") }, { id: "standard", label: t("标准") }, { id: "detailed", label: t("详细") }],
      s.autoLogDetail || "brief",
      (v) => { changeLogDetail(s, v); p.saveSettings(); this.display(); },
    );

    const curStyle = s.conclusionStyle || DEFAULTS.conclusionStyle;
    this.rowSegmented(
      modelCard,
      t("结论总结风格"),
      t("决定 AI 提炼任务结论时的表达方式；选「自定义」可完全接管提示词模板"),
      [
        { id: "balanced", label: t("精准完整") },
        { id: "concise", label: t("极简要点") },
        { id: "structured", label: t("结构化") },
        { id: "custom", label: t("自定义") },
      ],
      curStyle,
      (v) => { s.conclusionStyle = v; p.saveSettings(); this.display(); },
    );

    this.row(modelCard, t("结论字数上限"), t("分别控制编码、问答、多轮合并与兜底上限（字）"), (rr) => {
      const grid = rr.createDiv({ cls: "ad-num-grid" });
      const addCell = (lbl, val, min, max, onSet) => {
        const cell = grid.createDiv({ cls: "ad-num-cell" });
        cell.createSpan({ cls: "ad-num-cell__label", text: lbl });
        this.numberInput(cell, val, min, max, onSet);
      };
      addCell(t("编码"), s.conclusionMaxCode || DEFAULTS.conclusionMaxCode, 20, 400, (v) => { s.conclusionMaxCode = Math.max(20, Math.round(v)); p.saveSettings(); });
      addCell(t("问答"), s.conclusionMaxQA || DEFAULTS.conclusionMaxQA, 40, 800, (v) => { s.conclusionMaxQA = Math.max(40, Math.round(v)); p.saveSettings(); });
      addCell(t("合并"), s.conclusionMaxMerge || DEFAULTS.conclusionMaxMerge, 60, 600, (v) => { s.conclusionMaxMerge = Math.max(60, Math.round(v)); p.saveSettings(); });
      addCell(t("兜底"), s.resultMax || DEFAULTS.resultMax, 40, 2000, (v) => { s.resultMax = Math.max(40, Math.round(v)); p.saveSettings(); });
    });

    let tplTa = null;
    if (curStyle === "custom") {
      const tplField = modelCard.createDiv({ cls: "ad-field" });
      tplField.createDiv({ cls: "ad-field__label", text: t("自定义总结提示词模板") });
      tplField.createDiv({ cls: "ad-field__desc", text: t("支持占位符 {{task}}、{{reply}}、{{codeMax}}、{{qaMax}}；不写占位符也会自动在末尾附上任务和回复。") });
      tplTa = tplField.createEl("textarea", { cls: "ad-textarea", attr: { rows: "6" } });
      tplTa.value = s.conclusionPromptTemplate || DEFAULT_CUSTOM_CONCLUSION_PROMPT;
      tplTa.onchange = () => {
        const val = tplTa.value.trim();
        s.conclusionPromptTemplate = val === DEFAULT_CUSTOM_CONCLUSION_PROMPT.trim() ? "" : val;
        p.saveSettings();
      };
    } else {
      this.rowText(modelCard, t("结论总结补充要求"), t("可选，附加到整理与每轮润色提示词末尾（例如「先写改动文件再写验证结果」）；留空使用默认规则"), s.summaryPrompt || "", t("例如：先写核心结论，再写未验证项"), (v) => { s.summaryPrompt = v.trim(); p.saveSettings(); }, "ad-input--wide");
    }
    const previewRow = modelCard.createDiv({ cls: "ad-btnrow" });
    const previewOut = modelCard.createDiv({ cls: "ad-hint" });
    this.bigButton(previewRow, t("用样例试跑总结"), async () => {
      previewOut.textContent = t("生成中…");
      try {
        const res = await previewConclusion(s);
        previewOut.textContent = res.result
          ? t("样例总结（{ms}ms · {kind}）：{result}", { ms: res.ms, kind: res.kind || "-", result: res.result })
          : t("样例总结（{ms}ms · {kind}）：未提取到有效结论（已回退本地规则）", { ms: res.ms, kind: res.kind || "-" });
      } catch (e) {
        previewOut.textContent = t("试跑失败：{error}", { error: e?.message || String(e) });
      }
    }, "ad-btn--soft");
    if (curStyle === "custom" && tplTa) {
      this.bigButton(previewRow, t("恢复默认提示词"), () => {
        s.conclusionPromptTemplate = "";
        tplTa.value = DEFAULT_CUSTOM_CONCLUSION_PROMPT;
        p.saveSettings();
        new Notice(t("已恢复默认总结提示词"));
      }, "ad-btn--ghost");
    }
    const lastErr = p.autoLog?._err || p.journalSync?._lastPolishErr || "";
    if (lastErr) modelCard.createDiv({ cls: "ad-error-line", text: t("最近一次整理 / 润色失败（已回退本地规则）：{error}", { error: lastErr }) });

    this.rowToggle(modelCard, t("累积后自动合并总结"), t("长任务达到阈值后自动合并多轮记录为一段总结"), !!s.autoLogMerge, (v) => { s.autoLogMerge = v; p.saveSettings(); this.display(); });
    if (s.autoLogMerge) {
      this.rowNumber(modelCard, t("累积多少条结论后合并"), t("至少 2 条"), s.autoLogMergeThreshold || 10, 2, 100, (v) => { s.autoLogMergeThreshold = Math.round(v); p.saveSettings(); });
    }

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
    this.rowText(modelMore, t("润色用的模型"), t("留空沿用整理模型"), s.roundPolishModel || "", t("同整理用的模型"), (v) => { s.roundPolishModel = v.trim(); p.saveSettings(); });
    this.rowNumber(modelMore, t("润色超时（秒）"), "", s.roundPolishTimeout || DEFAULTS.roundPolishTimeout, 5, 300, (v) => { s.roundPolishTimeout = v; p.saveSettings(); });
    const sched = modelMore;
    this.rowNumber(sched, t("整理间隔（分钟）"), t("至少 5 分钟"), s.autoLogEvery || 20, 5, 240, (v) => { s.autoLogEvery = v; p.saveSettings(); });
    this.rowNumber(sched, t("首次整理延迟（分钟）"), "", s.autoLogStartDelay ?? 1, 1, 240, (v) => { s.autoLogStartDelay = v; p.saveSettings(); });
    this.rowNumber(sched, t("最短记录时长（分钟）"), t("0 表示立即记录"), s.autoLogMinMinutes ?? 1, 0, 120, (v) => { s.autoLogMinMinutes = v; p.saveSettings(); });
    this.rowNumber(sched, t("暂停判定（分钟）"), t("至少 5 分钟"), s.autoLogIdle || 10, 5, 480, (v) => { s.autoLogIdle = v; p.saveSettings(); });
    this.rowNumber(sched, t("每批会话数"), "", s.autoLogBatch || 8, 1, 20, (v) => { s.autoLogBatch = v; p.saveSettings(); });

    // 4. 记录 → 展示与维护
    const ui = this.card(body, t("展示与维护"), t("会话打开方式、面板、编辑器与菜单栏显示、缓存维护"));
    this.rowSegmented(ui, t("终端会话打开方式"), "", [{ id: "terminal", label: t("终端") }, { id: "desktop", label: t("桌面版") }], s.cliOpen === "desktop" ? "desktop" : "terminal", (v) => { s.cliOpen = v; p.saveSettings(); this.display(); });
    this.rowToggle(ui, t("归档的会话不再列出"), "", s.hideArchived !== false, (v) => { s.hideArchived = v; p.saveSettings(); p.refreshUI(); });
    for (const [key, label, desc, fallback] of [
      ["showEditorPills", t("任务行上的会话状态按钮"), "", true],
      ["lineProgress", t("显示任务行进度条与 token 块"), t("在 AI 任务行下方渲染 ASCII 进度条与紫色 token 方块"), true],
      ["dragGrip", t("段落尾巴上的小箭头"), t("单击委派；双击或 ⌘ 单击选择 Agent"), true],
      ["showRibbonIcon", t("左侧栏图标"), "", true],
      ["openDashboardOnStartup", t("启动时打开面板"), "", false],
    ]) {
      this.rowToggle(ui, label, desc, s[key] === undefined ? fallback : s[key] !== false, (v) => { s[key] = v; p.saveSettings(); p.applyUiSettings(); });
    }
    this.rowToggle(ui, t("AI 协作回顾"), t("默认开启。查看 token 热力图、项目投入和历史记录；关闭后隐藏入口并关闭回顾页，保留统计数据。"), s.experimentalDashboard !== false, async (enabled) => {
      try { await p.setExperimentalDashboard(enabled); }
      catch (error) { new Notice(t("设置保存失败：{error}", { error: error.message })); }
      this.display();
    });
    const uiMore = this.subDetails(ui, "display-more", t("更多设置"));
    this.rowToggle(uiMore, t("最近 14 天的条形图"), "", s.ui.showUsageBars !== false, (v) => { s.ui.showUsageBars = v; p.saveSettings(); p.refreshUI(); });
    this.rowToggle(uiMore, t("每个 Agent 的小火花线"), "", s.ui.showSparkline !== false, (v) => { s.ui.showSparkline = v; p.saveSettings(); p.refreshUI(); });

    const isMac = process.platform === "darwin";
    this.mbSwitch = null;
    if (isMac) {
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
    }

    this.rowToggle(uiMore, t("使用螺旋日程的进度显示"), "", s.yieldToNautilus !== false, (v) => { s.yieldToNautilus = v; p.saveSettings(); p.refreshUI(); });
    if (isMac) {
      this.rowToggle(uiMore, t("关闭螺旋日程右下角的 Agent 汇总"), "", s.menuBarHideNautilus !== false, (v) => { s.menuBarHideNautilus = v; p.saveSettings(); if (v) p.hideNautilusAgentBar().catch(() => {}); else p.restoreNautilusAgentBar().catch(() => {}); });
    }

    const btn = uiMore.createDiv({ cls: "ad-btnrow" });
    if (isMac) this.bigButton(btn, t("重启菜单栏"), () => p.menubar?.restart());
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

    // 1. 记忆库工作区快捷入口（不必去命令面板翻找）
    const hub = this.card(body, t("记忆库工作区"), t("管理已沉淀的长期记忆、审阅待确认条目与巩固去重"));
    hub.addClass("ad-dream-hub");
    const hubSummary = hub.createDiv({ cls: "ad-muted" });
    const hubAlert = hub.createDiv({ cls: "ad-muted" });
    hubAlert.hidden = true;
    const hubBtns = hub.createDiv({ cls: "ad-btnrow" });
    if (p.dreaming.storeMode) {
      hubSummary.textContent = t("当前模式：一文一条记忆库（{dir}）· 正在读取统计…", { dir: p.dreaming.dir });
      Promise.all([p.dreaming.loadEntries(), p.dreaming.listArchivedPaths()]).then(([entries, archivedPaths]) => {
        if (!hubSummary.isConnected) return;
        const active = entries.filter((e) => e.state === "有效" && !e.private);
        const verified = active.filter((e) => e.verified).length;
        const pendingCount = active.length - verified;
        const conflicts = active.filter((e) => (e.conflictsWith || []).length > 0).length;
        const archived = archivedPaths.length;
        hubSummary.textContent = t("一文一条记忆库（{dir}）：共 {total} 条（有效 {active} · 已确认 {verified} · 待确认 {pending}）", {
          dir: p.dreaming.dir,
          total: entries.length,
          active: active.length,
          verified,
          pending: pendingCount,
        });
        const alertParts = [
          conflicts > 0 ? t("待裁决冲突 {n} 条", { n: conflicts }) : "",
          archived > 0 ? t("已归档 {n} 条", { n: archived }) : "",
        ].filter(Boolean);
        hubAlert.hidden = !alertParts.length;
        hubAlert.textContent = alertParts.join(t("；"));
      }).catch(() => {});
      this.bigButton(hubBtns, t("打开记忆看板"), () => p.openMemoryBoard?.());
      this.bigButton(hubBtns, t("打开记忆图谱"), () => p.openMemoryGraph?.());
      this.bigButton(hubBtns, t("打开记忆.base"), () => p.openMemoryBase?.());
      this.bigButton(hubBtns, t("逐条审阅"), () => p.reviewMemories?.());
      this.bigButton(hubBtns, t("巩固去重"), () => p.consolidateMemories?.());
      this.bigButton(hubBtns, t("导入记忆…"), () => p.openMemoryImport?.());
      const maint = this.subDetails(hub, "dream-maint", t("图谱与库维护"));
      this.rowSegmented(
        maint,
        t("关系图谱预设视角"),
        t("控制应用到 Obsidian 关系图谱的配色分组规则"),
        [
          { id: "kind", label: t("类型与核验") },
          { id: "trust", label: t("OKF 信任热力") },
        ],
        s.graphPreset === "trust" ? "trust" : "kind",
        (v) => { s.graphPreset = v; p.saveSettings(); this.display(); },
      );
      const maintBtns = maint.createDiv({ cls: "ad-btnrow" });
      this.bigButton(maintBtns, t("应用图谱预设"), () => p.applyMemoryGraphPreset?.(s.graphPreset));
      this.bigButton(maintBtns, t("记忆体检"), () => p.auditMemory?.());
      this.bigButton(maintBtns, t("补齐 OKF 元信息"), async () => { await p.backfillMemoryOkf?.(); this.display(); });
      this.bigButton(maintBtns, t("升级图谱边与短命名"), async () => { await p.backfillMemoryOkf?.({ renameShort: true }); this.display(); });
      this.bigButton(maintBtns, t("润色短命名（模型）"), async () => { await p.polishMemoryShortTitles?.(); this.display(); });
      this.bigButton(maintBtns, t("归档超期失效记忆"), async () => { await p.archiveDeprecatedMemories?.(); this.display(); });
      hub.appendChild(maint.parentElement);
    } else {
      hubSummary.textContent = t("当前模式：单文件长期记忆（{path}）。迁移到一文一条后可使用记忆看板、Base 表格、按条审阅与巩固去重。", { path: s.path || "Agent Deck/长期记忆.md" });
      this.bigButton(hubBtns, t("迁移到一文一条记忆库（推荐）"), async () => {
        await p.migrateMemoryToFiles?.();
        this.display();
      });
      this.bigButton(hubBtns, t("导入记忆…"), () => p.openMemoryImport?.());
    }

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
    this.rowToggle(dreamMore, t("Dream 后自动给来源行补块号（^mem-*）"), t("为新提炼记忆的来源笔记自动追加 ^mem-* 硬锚点，防止日后行号漂移"), s.autoAnchor !== false, (v) => { s.autoAnchor = v; p.saveSettings(); });
    this.rowText(dreamMore, t("记忆库目录"), t("库内相对路径；修改后对新写入与读取生效，不会自动搬移旧文件"), s.dir || DEFAULTS.dream.dir, DEFAULTS.dream.dir, (v) => {
      const clean = v.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      if (!clean || clean.split("/").includes("..")) { new Notice(t("记忆库目录必须是库内相对路径")); return; }
      s.dir = clean;
      p.saveSettings();
    }, "ad-input--wide");
    this.rowToggle(dreamMore, t("巩固时自动归档超期失效记忆"), t("睡眠巩固后将超出保留天数且已拒绝或已被替代的记忆移入 archive/"), s.autoArchive !== false, (v) => { s.autoArchive = v; p.saveSettings(); });
    this.rowNumber(dreamMore, t("失效记忆归档天数"), t("已拒绝或已被替代的记忆超过多少天后移入 archive/（0 = 立即归档）"), s.archiveAfterDays ?? 30, 0, 365, (v) => { s.archiveAfterDays = v; p.saveSettings(); });
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

    // 2. 召回效果测试（0 Token 本地调试派发注入命中率）
    const recallDetails = this.subDetails(card, "dream-recall", t("召回效果测试（本地 0 Token 调试）"));
    const recallWrap = recallDetails.createDiv({ cls: "ad-dream-recall" });
    const recallInput = recallWrap.createEl("input", {
      cls: "ad-input ad-input--wide",
      attr: { type: "text", placeholder: t("输入模拟任务句，例如：排查 Windows 路径断言失败 / 优化 RAG 拒答门槛") },
    });
    const recallRow = recallWrap.createDiv({ cls: "ad-dream-recall__row" });
    const codeLabel = recallRow.createEl("label", { cls: "ad-mem-create__verify" });
    const codeCb = codeLabel.createEl("input", { type: "checkbox" });
    codeLabel.createSpan({ text: t("模拟代码项目（过滤个人生活事实）") });
    const projInput = recallRow.createEl("input", { cls: "ad-input", attr: { type: "text", placeholder: t("可选项目名，如 agent-deck") } });
    const recallBtn = recallRow.createEl("button", { cls: "ad-btn ad-btn--soft", text: t("测试召回") });
    const recallOut = recallWrap.createDiv({ cls: "ad-dream-recall__list" });
    const runRecall = async () => {
      const q = recallInput.value.trim();
      recallOut.empty();
      if (!q) {
        recallOut.createDiv({ cls: "ad-muted", text: t("请先输入一句任务描述") });
        return;
      }
      const refs = [...q.matchAll(/\[\[([^\]]+)\]\]/g)]
        .map((m) => String(m[1] || "").split("|")[0].split("#")[0].trim())
        .filter(Boolean);
      const hits = await p.dreaming.previewContext(q, {
        projectName: projInput.value.trim(),
        isCodeProject: codeCb.checked,
        refs,
      });
      if (!hits.length) {
        recallOut.createDiv({ cls: "ad-muted", text: t("未命中相关记忆（0 注入）") });
        return;
      }
      for (const h of hits) {
        const e = h.entry || h;
        const item = recallOut.createDiv({ cls: "ad-dream-recall__item" });
        item.createDiv({ text: `[${e.type || e.kind}${e.verified ? " ✓" : ""}]${e.project ? ` [${e.project}]` : ""} ${e.text}` });
        item.createDiv({ cls: "ad-muted", text: t("命中：{why}", { why: (h.why || []).join("、") }) });
      }
    };
    recallBtn.addEventListener("click", runRecall);
    recallInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); runRecall(); } });
    card.appendChild(recallDetails.parentElement);

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
      const dropStr = s.coverage?.dropped ? t("（忽略未过核验 {n} 条）", { n: s.coverage.dropped }) : "";
      const consParts = s.lastConsolidate?.at
        ? [
          t("上次巩固：合并 {m} 组 / 淘汰 {d} 条", { m: s.lastConsolidate.merged || 0, d: s.lastConsolidate.deprecated || 0 }),
          s.lastConsolidate.conflicts?.length ? t("冲突 {n} 组", { n: s.lastConsolidate.conflicts.length }) : "",
          s.lastConsolidate.archived ? t("归档 {n} 条", { n: s.lastConsolidate.archived }) : "",
        ].filter(Boolean)
        : [];
      const consStr = consParts.join(t("；"));
      summary.textContent = [
        s.coverage ? t("上次采集 {files} 篇；已处理 {done}/{total} 块，待处理 {pending} 块", { files: s.coverage.files, done: s.coverage.processed, total: s.coverage.total, pending: s.coverage.pending }) + dropStr : "",
        s.lastRun ? t("上次完成：{time}", { time: new Date(s.lastRun).toLocaleString() }) : "",
        consStr,
        s.lastError ? t("上次未完成：{error}", { error: s.lastError }) : "",
      ].filter(Boolean).join(t("；"));
      meter.hidden = !d.busy;
      syncNow.disabled = sharing.busy || d.busy;
      syncNow.textContent = sharing.busy ? t("共享同步中…") : t("立即同步共享记忆");
      sharedStatus.textContent = [sharing.status || (c.lastError ? t("上次共享失败：{error}", { error: c.lastError }) : ""), c.lastSuccess ? t("上次同步成功：{time}", { time: new Date(c.lastSuccess).toLocaleString() }) : t("尚未同步")].filter(Boolean).join(t("；"));
    };
    update();
    this._dreamTimer = this._timers.setInterval(update, 1000);
  }

  // ---------- About ----------
  // ---------- Experiments ----------
  renderMemoryMcpCard(body) {
    const p = this.plugin;
    const s = (p.settings.dream ||= {});
    const mcpCfg = (s.mcp ||= { toolsMode: "all", allowWrite: false, excludeAiLogs: true, agentPrompt: "" });
    if (mcpCfg.toolsMode !== "memory-only" && mcpCfg.toolsMode !== "all") mcpCfg.toolsMode = "all";
    mcpCfg.allowWrite = Boolean(mcpCfg.allowWrite);
    mcpCfg.excludeAiLogs = mcpCfg.excludeAiLogs !== false;
    if (typeof mcpCfg.agentPrompt !== "string") mcpCfg.agentPrompt = "";

    const mcpCard = this.card(body, t("外部 Agent 接入（MCP / CLI）"), t("让 Claude Code、Codex、Antigravity、OpenCode、DeepSeek Harness、Cursor 等在库外直接检索全库笔记（FTS5）与 Dream 记忆"));
    const mcpPaths = p.resolveMcpPaths?.() || {};
    const cfgDir = p.app?.vault?.configDir || "";
    const core = p.contextCore;
    const assetCheck = checkExternalAssets(p.vaultPath, {
      expectedMemoryQueryVersion: MEMORY_QUERY_ASSET_VERSION,
      expectedMemoryMcpVersion: MEMORY_MCP_ASSET_VERSION,
      scriptsDir: mcpPaths.scriptsDir || "",
      configDir: cfgDir,
    });
    const statusText = assetCheck.checked
      ? assetCheck.items.map((it) => `${it.name}: ${it.status === "ok" ? t("已就绪 v{v}", { v: it.expectedVersion }) : it.status === "missing" ? t("未安装（需重新运行 install:plugin）") : t("版本过期（当前 v{a} / 期望 v{e}）", { a: it.actualVersion, e: it.expectedVersion })}`).join(" ｜ ")
      : t("未检测到 Vault 路径");
    mcpCard.createDiv({ cls: "ad-mcp-assets", text: statusText });

    const defaultMcpPrompt = (mode) => (mode === "memory-only"
      ? t("当涉及我的个人偏好、历史决定、项目踩坑经验或过往记忆时，先调用 agent-deck-memory MCP（memory_search / memory_graph / memory_recent / memory_read）查证再回答。")
      : t("当涉及我的个人偏好、过往记忆或笔记库内容时，先调用 agent-deck-memory MCP 的 memory_search 与 vault_find / vault_outline / vault_read 查证（跳过 AI 自动流水，以用户手写笔记与已沉淀记忆为准），再回答。"));

    let mcpAllowWrite = mcpCfg.allowWrite;
    let renderClients = () => {};
    let renderIndexStats = () => {};
    let handshakeStatus = null;
    let promptTa = null;
    const clearHandshake = () => {
      if (!handshakeStatus) return;
      handshakeStatus.setText("");
      handshakeStatus.hidden = true;
    };

    // 显性控制 1：工具暴露范围
    this.rowSegmented(
      mcpCard,
      t("MCP 工具暴露范围"),
      t("若同时使用 Obsidian 官方 Connector 管全库，可切为仅开放长期记忆"),
      [
        { id: "all", label: t("记忆 + 全库用户笔记") },
        { id: "memory-only", label: t("仅长期记忆 (memory_*)") },
      ],
      mcpCfg.toolsMode,
      (v) => {
        const prevDefault = defaultMcpPrompt(mcpCfg.toolsMode);
        mcpCfg.toolsMode = v;
        p.saveSettings();
        if (promptTa && (!mcpCfg.agentPrompt || promptTa.value.trim() === prevDefault)) {
          promptTa.value = defaultMcpPrompt(v);
          mcpCfg.agentPrompt = "";
          p.saveSettings();
        }
        clearHandshake();
        renderClients();
        new Notice(t("已更新 MCP 工具范围（重开客户端会话后生效）"));
      },
    );

    // 显性控制 2：允许提交候选记忆（持久化 --allow-write）
    this.rowToggle(
      mcpCard,
      t("允许外部 Agent 提交候选记忆（--allow-write）"),
      t("开启后增加 memory_propose 工具；外部写入仅进 AI 待审列表，绝不改动原笔记"),
      mcpCfg.allowWrite,
      (v) => {
        mcpAllowWrite = Boolean(v);
        mcpCfg.allowWrite = mcpAllowWrite;
        p.saveSettings();
        clearHandshake();
        renderClients();
      },
    );

    // 显性控制 3：搜索隔离策略（AI 日志排除开关 + 统一样式的隐私目录摘要跳转）
    this.rowToggle(
      mcpCard,
      t("全库检索排除 AI 自动记录"),
      t("默认开启：vault_* 只搜用户手写内容，AI 会话流水经 Dream 沉淀后走 memory_*"),
      mcpCfg.excludeAiLogs,
      (v) => {
        mcpCfg.excludeAiLogs = Boolean(v);
        p.saveSettings();
        if (p.vaultPath) core?.clearVaultIndexCache?.(p.vaultPath);
        renderIndexStats();
      },
    );

    const excludedList = Array.isArray(p.settings?.delegate?.excludedDirs) ? p.settings.delegate.excludedDirs : [];
    const excludedPreview = excludedList.length
      ? (excludedList.length > 3
        ? t("{items} 等 {n} 项", { items: excludedList.slice(0, 3).join("、"), n: excludedList.length })
        : excludedList.join("、"))
      : t("未设额外排除目录");
    this.row(
      mcpCard,
      t("隐私与目录隔离"),
      t("始终跳过 private: true 笔记 ｜ 排除目录：{dirs}", { dirs: excludedPreview }),
      (rr) => {
        this.bigButton(rr, t("前往设置"), () => {
          this.tab = "delegate";
          this.display();
        }, "ad-btn--compact");
      },
    );

    // 显性控制 4：本地全文索引状态与一键重建
    let rebuildBtn = null;
    const idxRow = this.row(mcpCard, t("本地全文索引"), " ", (rr) => {
      rebuildBtn = this.bigButton(rr, t("重建本地索引"), () => {
        if (!p.vaultPath || !core?.loadVaultIndex || !rebuildBtn) return;
        rebuildBtn.disabled = true;
        rebuildBtn.textContent = t("重建中…");
        setTimeout(() => {
          try {
            const t0 = Date.now();
            core.clearVaultIndexCache?.(p.vaultPath);
            const idx = core.loadVaultIndex(p.vaultPath, { forceRebuild: true, persist: true, configDir: cfgDir });
            const ms = Date.now() - t0;
            renderIndexStats();
            new Notice(t("索引重建完成：{n} 篇用户笔记（{ms}ms）", { n: idx.stats?.indexedFiles || 0, ms }));
          } catch (e) {
            new Notice(t("索引重建失败：{error}", { error: e?.message || e }));
          } finally {
            rebuildBtn.disabled = false;
            rebuildBtn.textContent = t("重建本地索引");
          }
        }, 0);
      }, "ad-btn--compact");
    });
    const idxTextEl = idxRow.querySelector(".ad-row__desc");
    renderIndexStats = () => {
      if (!idxTextEl) return;
      if (!p.vaultPath || !core?.peekVaultIndexStatus) {
        idxTextEl.setText(t("当前环境不支持离线状态检测"));
        return;
      }
      const st = core.peekVaultIndexStatus(p.vaultPath, { configDir: cfgDir });
      const engineLabel = st.ftsEngine === "sqlite-fts5" ? "SQLite FTS5" : t("JSON 回退");
      if (!st.exists) {
        idxTextEl.setText(t("{engine} · 尚未建立（首次查询自动生成或点右侧重建）", { engine: engineLabel }));
        return;
      }
      idxTextEl.setText(t("{engine} · {indexed} 篇用户笔记 · 跳过 {gen} 个生成文件 · {priv} 篇私密", {
        engine: engineLabel,
        indexed: st.indexedFiles,
        gen: st.generatedCount,
        priv: st.privateCount,
      }));
    };
    renderIndexStats();

    // 显性控制 5：可手动编辑的 Agent 自动触发提示词 + 复制 / 恢复默认
    const promptField = mcpCard.createDiv({ cls: "ad-field ad-mcp-prompt" });
    promptField.createDiv({ cls: "ad-field__label", text: t("外部 Agent 自动触发提示词（可编辑后复制）") });
    promptField.createDiv({ cls: "ad-field__desc", text: t("粘贴到 ~/.claude/CLAUDE.md、~/.codex/AGENTS.md 或 Cursor / Antigravity 全局规则，让 Agent 主动查记忆") });
    promptTa = promptField.createEl("textarea", { cls: "ad-textarea", attr: { rows: "3" } });
    promptTa.value = mcpCfg.agentPrompt || defaultMcpPrompt(mcpCfg.toolsMode);
    promptTa.onchange = () => {
      const val = promptTa.value;
      mcpCfg.agentPrompt = val.trim() === defaultMcpPrompt(mcpCfg.toolsMode) ? "" : val;
      p.saveSettings();
    };
    const promptBtns = promptField.createDiv({ cls: "ad-btnrow" });
    this.bigButton(promptBtns, t("复制提示词"), async () => {
      const text = promptTa.value.trim() || defaultMcpPrompt(mcpCfg.toolsMode);
      let copied = false;
      try { await navigator?.clipboard?.writeText?.(text); copied = true; } catch { /* fallback below */ }
      if (!copied) { try { require("electron").clipboard.writeText(text); } catch { /* ignore */ } }
      new Notice(t("已复制外部 Agent 触发提示词"));
    }, "ad-btn--soft ad-btn--compact");
    this.bigButton(promptBtns, t("恢复默认"), () => {
      mcpCfg.agentPrompt = "";
      promptTa.value = defaultMcpPrompt(mcpCfg.toolsMode);
      p.saveSettings();
      new Notice(t("已恢复默认提示词"));
    }, "ad-btn--ghost ad-btn--compact");

    if (p.vaultPath && core?.listMcpClients && core?.installMcpClient && core?.uninstallMcpClient) {
      const mcpScript = mcpPaths.mcpScript || "";
      const clientsWrap = mcpCard.createDiv({ cls: "ad-mcp-clients" });
      const headRow = clientsWrap.createDiv({ cls: "ad-mcp-clients__head" });
      headRow.createSpan({ cls: "ad-mcp-clients__title", text: t("本机客户端一键接入") });
      const headBtns = headRow.createDiv({ cls: "ad-btnrow ad-mcp-clients__tools" });
      handshakeStatus = clientsWrap.createDiv({ cls: "ad-hint" });
      handshakeStatus.hidden = true;
      const rowsEl = clientsWrap.createDiv({ cls: "ad-mcp-clients__list" });

      const statusTextFor = (c) => {
        if (c.status === "error") return t("配置异常");
        if (c.status === "connected") return c.currentAllowWrite ? t("已接入 · 可提候选") : t("已接入 · 只读");
        if (c.status === "outdated") return t("配置需更新");
        return c.detected ? t("未接入") : t("未检测到");
      };

      renderClients = () => {
        rowsEl.empty();
        const items = core.listMcpClients({ vaultPath: p.vaultPath, mcpScript, allowWrite: mcpAllowWrite, configDir: cfgDir });
        for (const c of items) {
          const row = rowsEl.createDiv({ cls: "ad-mcp-client" });
          const left = row.createDiv({ cls: "ad-mcp-client__info" });
          const top = left.createDiv({ cls: "ad-mcp-client__top" });
          top.createSpan({ cls: "ad-mcp-client__name", text: c.label });
          const badgeCls = c.status === "connected" ? "is-ok" : c.status === "outdated" ? "is-warn" : c.status === "error" ? "is-err" : "";
          top.createSpan({ cls: `ad-mcp-badge ${badgeCls}`.trim(), text: statusTextFor(c) });
          const shortPath = c.displayPath || c.configPath;
          left.createDiv({ cls: "ad-mcp-client__path", text: c.error ? `${shortPath} — ${c.error}` : shortPath, attr: { title: c.configPath } });
          const actions = row.createDiv({ cls: "ad-mcp-client__actions" });
          if (c.status !== "connected" && c.status !== "error") {
            const actionLabel = c.installed ? t("更新配置") : t("一键接入");
            this.bigButton(actions, actionLabel, () => {
              try {
                const res = core.installMcpClient(c.id, { vaultPath: p.vaultPath, mcpScript, allowWrite: mcpAllowWrite, configDir: cfgDir });
                new Notice(t("{name} 已写入 MCP 配置（{hint}）", { name: res.label, hint: t(res.restartHint) }));
                renderClients();
              } catch (e) {
                new Notice(t("写入 MCP 配置失败：{error}", { error: e?.message || e }));
              }
            }, "ad-btn--soft ad-btn--compact");
          }
          if (c.installed) {
            this.bigButton(actions, t("断开"), () => {
              try {
                core.uninstallMcpClient(c.id);
                new Notice(t("已从 {name} 移除 MCP 配置", { name: c.label }));
                renderClients();
              } catch (e) {
                new Notice(t("移除 MCP 配置失败：{error}", { error: e?.message || e }));
              }
            }, "ad-btn--ghost ad-btn--compact");
          }
        }
      };

      this.bigButton(headBtns, t("检测握手"), () => {
        if (!core.verifyMcpHandshake) return;
        const res = core.verifyMcpHandshake({ mcpScript, vaultPath: p.vaultPath, allowWrite: mcpAllowWrite, toolsMode: mcpCfg.toolsMode, configDir: cfgDir });
        handshakeStatus.hidden = false;
        handshakeStatus.setText(res.ok
          ? t("握手通过：{n} 个工具（{ms}ms）", { n: res.toolsCount, ms: res.latencyMs })
          : t("握手失败：{error}", { error: res.error || "unknown" }));
      }, "ad-btn--compact");
      this.bigButton(headBtns, t("同步已接入客户端"), () => {
        const outdated = core.listMcpClients({ vaultPath: p.vaultPath, mcpScript, allowWrite: mcpAllowWrite, configDir: cfgDir })
          .filter((c) => c.installed && c.status === "outdated");
        if (!outdated.length) return new Notice(t("已接入客户端均为最新配置"));
        let count = 0;
        for (const c of outdated) {
          try { core.installMcpClient(c.id, { vaultPath: p.vaultPath, mcpScript, allowWrite: mcpAllowWrite, configDir: cfgDir }); count++; } catch { /* reported on row */ }
        }
        new Notice(t("已同步更新 {n} 个客户端 MCP 配置", { n: count }));
        renderClients();
      }, "ad-btn--compact");

      renderClients();
    }

    const mcpMore = this.subDetails(mcpCard, "mcp-manual", t("手动复制配置与 CLI 命令"));
    const mcpBtns = mcpMore.createDiv({ cls: "ad-btnrow" });
    this.bigButton(mcpBtns, t("复制 MCP 配置 JSON"), () => p.copyMcpConfig?.("json", { allowWrite: mcpAllowWrite }), "ad-btn--compact");
    this.bigButton(mcpBtns, t("复制 Claude Code 命令"), () => p.copyMcpConfig?.("claude", { allowWrite: mcpAllowWrite }), "ad-btn--compact");
    this.bigButton(mcpBtns, t("复制 CLI 查询示例"), () => p.copyMcpConfig?.("cli"), "ad-btn--compact");
    mcpCard.appendChild(mcpMore.parentElement);
  }

  renderExperimental(body) {
    this.renderMemoryMcpCard(body);
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
    const langCard = this.card(
      body,
      t("界面语言"),
      t("选择插件界面语言并持久保存在设置中，更新插件不会重置。也可以把翻译好的 JSON 语言包放到 Vault 的 Agent Deck/locales/ 目录（如 zh-TW.json、ja.json）。"),
    );
    const customPacks = listCustomLocales().filter((pack) => pack.id !== "zh-TW");
    const langChoices = [
      { id: "auto", label: t("跟随 Obsidian") },
      { id: "zh", label: "简体中文" },
      { id: "zh-TW", label: "繁體中文" },
      { id: "en", label: "English" },
      ...customPacks.map((pack) => ({
        id: pack.id,
        label: pack.name === pack.id ? pack.id : `${pack.name} (${pack.id})`,
      })),
    ];
    const selectedLang = p.settings.uiLanguage || "auto";
    if (!langChoices.some((item) => item.id === selectedLang)) {
      langChoices.push({ id: selectedLang, label: t("{id}（未找到语言包）", { id: selectedLang }) });
    }
    this.rowSelect(
      langCard,
      t("当前界面语言"),
      customPacks.length
        ? t("已载入 {count} 个自定义语言包", { count: customPacks.length })
        : t("需要繁體中文、日文等其他语系？先导出模板，交给 AI 翻译后放到 Agent Deck/locales/ 即可。"),
      langChoices,
      selectedLang,
      (val) => { p.setUiLanguage(val); },
    );
    const langBtns = langCard.createDiv({ cls: "ad-btnrow" });
    this.bigButton(langBtns, t("导出语言模板"), () => p.exportLocaleTemplateFile());
    this.bigButton(langBtns, t("重新扫描语言包"), () => {
      const packs = p.reloadLocales();
      this.display();
      new Notice(packs.length
        ? t("已扫描到 {count} 个自定义语言包", { count: packs.length })
        : t("暂未发现自定义语言包（目录：Agent Deck/locales/）"));
    });
    const flowCard = this.card(
      body,
      t("核心结构与信息流转"),
      t("从笔记委派，本机只读采集多端日志，状态与结论回写原任务，再沉淀为回顾数据与长期记忆。"),
    );
    const diagramEl = flowCard.createDiv({ cls: "ad-about-diagram" });
    this.renderAboutDiagram(diagramEl);
    const guide = this.card(body, t("常用操作"));
    const rows = [
      [t("整理日志版面"), t("Ctrl+Alt+L，或点击面板的「整理日志版面」")],
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
    this.rowToggle(c, t("启动时自动检查新版本"), t("每天最多检查一次 GitHub Releases，有新版时提示并提供一键跳转更新"), p.settings.updateCheck !== false, (v) => { p.settings.updateCheck = v; p.saveSettings(); });
    const btns = c.createDiv({ cls: "ad-btnrow" });
    const checkBtn = this.bigButton(btns, t("检查更新"), async () => {
      if (checkBtn.disabled) return;
      checkBtn.disabled = true;
      try { await p.checkForUpdates({ manual: true }); } finally { checkBtn.disabled = false; }
    });
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
      '    Task["Task Line / In-Place Board\\nGrip · Drag · @agent · Mirror"]',
      '    Views["Multi-View & Reading Preview\\nOutline · Table · Cards · Timeline · Export"]',
      "  end",
      '  subgraph HARNESS["Delegation & Guardrails"]',
      '    Ctx["Harness Context & Policy\\nAncestors · Wikilinks · Skills · Allowlist"]',
      "  end",
      '  subgraph AGENTS["14 Built-in + Custom ACP Agents"]',
      "    direction TB",
      '    Run["Runners\\nACP/CLI · Desktop · Terminal"]',
      '    Logs["Local Logs & Hooks\\nJSONL · SQLite (Read-only)"]',
      "  end",
      '  subgraph DECK["Agent Deck Control & Sync"]',
      "    direction TB",
      '    Panel["Sidebar & Pinned macOS Bar\\nLive Status · Alerts · Jump"]',
      '    Sync["Journal Auto-Sync\\nStatus · Conclusions · Combined Metrics"]',
      "  end",
      '  subgraph INSIGHT["Review · Security & Memory"]',
      "    direction TB",
      '    Dash["Dashboard & Security Replay\\nHeatmap · Multi-Session Tasks · Audit"]',
      '    Dream["Dreaming Memory\\nFacts/Patterns · Memory Base & Board"]',
      "  end",
      '  Task -->|"Delegate"| Ctx',
      '  Ctx -->|"Launch / Resume"| Run',
      '  Run -->|"Transcripts & Events"| Logs',
      '  Logs -->|"Incremental Scan"| Panel',
      '  Panel <-->|"Drag Bind / Jump"| Task',
      '  Logs -->|"00:00 Split & Noise Filter"| Sync',
      '  Sync -->|"Write Back"| Views',
      '  Logs -->|"Usage & Security Replay"| Dash',
      '  Dash -.->|"Allowlist Guardrails"| Ctx',
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
    '    Task["任务行 / 原地分形看板\\n把手 · 拖拽 · @agent · 镜像卡"]',
    '    Views["同源四视图与阅读预览\\n大纲 · 表格 · 卡片 · 时间线 · 导出"]',
    "  end",
    '  subgraph HARNESS["委派与安全护栏"]',
    '    Ctx["Harness 上下文与策略\\n母项链 · 双链 · 技能卡 · 白名单"]',
    "  end",
    '  subgraph AGENTS["14 家内置 + 自定义 ACP Agent"]',
    "    direction TB",
    '    Run["执行端\\n后台 ACP/CLI · 桌面版 · 终端"]',
    '    Logs["本机会话日志 / Hooks\\nJSONL · SQLite（只读数据源）"]',
    "  end",
    '  subgraph DECK["Agent Deck 控制与回写"]',
    "    direction TB",
    '    Panel["侧栏甲板 · 置顶 macOS 菜单栏\\n实时状态 · 待确认提醒 · 直达跳转"]',
    '    Sync["日志自动回写引擎\\n状态 · 结论 · 多会话合计时段"]',
    "  end",
    '  subgraph INSIGHT["回顾 · 安全与长期记忆"]',
    "    direction TB",
    '    Dash["协作回顾与安全回放\\n热力图 · 跨会话任务 · 离线审计"]',
    '    Dream["Dreaming 长期记忆\\n提炼偏好规律 · 记忆看板与 Base"]',
    "  end",
    '  Task -->|"委派任务"| Ctx',
    '  Ctx -->|"启动 / 续聊"| Run',
    '  Run -->|"写入对话与事件"| Logs',
    '  Logs -->|"只读增量扫描"| Panel',
    '  Panel <-->|"拖放绑定 / 跳转"| Task',
    '  Logs -->|"零点分割与口语过滤"| Sync',
    '  Sync -->|"写回原任务块"| Views',
    '  Logs -->|"用量与安全回放"| Dash',
    '  Dash -.->|"白名单闭环"| Ctx',
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
  constructor(app, plugin, onAdd, existing = null, { defaultAgent = "" } = {}) {
    super(app);
    this.plugin = plugin;
    this.onAdd = onAdd;
    const enabledAgents = modelCatalogAgents().filter((id) => plugin?.agentEnabled?.(id) ?? true);
    this.agent = defaultAgent || (enabledAgents.includes("dsh") ? "dsh" : (enabledAgents[0] || "dsh"));
    this.name = "";
    this.route = "";
    this.model = "";
    this.context = "128K";
    this.tags = "Reasoning";
    this.existing = existing;
    if (existing) {
      this.agent = existing.agent; this.name = existing.name;
      this.route = existing.providerRoute || "";
      this.model = existing.model || existing.cli || existing.value || "";
      this.context = existing.context || ""; this.tags = (existing.tags || []).join(", ");
    }
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("ad-modal");
    contentEl.createEl("h3", { text: this.existing ? t("编辑模型") : t("添加模型") });
    contentEl.createDiv({ cls: "ad-muted", text: t("Claude / Codex / 第三方模型填模型名即可；DSH 官方或指定路由可填 Provider route") });
    const form = contentEl.createDiv({ cls: "ad-form" });
    const field = (label, el) => { const f = form.createDiv({ cls: "ad-field" }); f.createDiv({ cls: "ad-field__label", text: label }); el(f); };
    field(t("显示名"), (f) => { const i = f.createEl("input", { cls: "ad-input", attr: { value: this.name, placeholder: t("例如 GPT-6-Luna") } }); i.oninput = () => this.name = i.value; });
    field("Agent", (f) => {
      const s = f.createEl("select", { cls: "ad-select" });
      const enabledDel = modelCatalogAgents().filter((id) => this.plugin?.agentEnabled?.(id) ?? true);
      const choices = enabledDel.length ? enabledDel : modelCatalogAgents();
      if (this.existing && !choices.includes(this.existing.agent)) choices.unshift(this.existing.agent);
      for (const id of choices) s.createEl("option", { text: AGENTS[id]?.name || id, attr: { value: id } });
      s.value = this.agent;
      s.disabled = !!this.existing;
      s.onchange = () => { this.agent = s.value; };
    });
    field(t("Provider route（DSH，可选）"), (f) => { const i = f.createEl("input", { cls: "ad-input", attr: { value: this.route, placeholder: t("留空直接使用模型名；官方路由填 deepseek-account") } }); i.oninput = () => this.route = i.value; });
    field(t("模型名或别名"), (f) => { const i = f.createEl("input", { cls: "ad-input", attr: { value: this.model, placeholder: t("例如 gpt-6-luna、deepseek-v4-pro 或 opus") } }); i.oninput = () => this.model = i.value; });
    field(t("上下文"), (f) => { const i = f.createEl("input", { cls: "ad-input", attr: { value: this.context } }); i.oninput = () => this.context = i.value; });
    field(t("能力标签"), (f) => { const i = f.createEl("input", { cls: "ad-input", attr: { value: this.tags, placeholder: "Reasoning, Fast, Vision" } }); i.oninput = () => this.tags = i.value; });
    const bar = contentEl.createDiv({ cls: "ad-btnrow ad-btnrow--end" });
    const cancel = bar.createEl("button", { cls: "ad-btn ad-btn--ghost", text: t("取消") });
    cancel.onclick = () => this.close();
    const add = bar.createEl("button", { cls: "ad-btn ad-btn--cta", text: this.existing ? t("保存") : t("添加") });
    add.onclick = () => {
      const rawModel = this.model.trim();
      if (!rawModel) return new Notice(t("请填写模型名或别名"));
      const name = this.name.trim() || rawModel;
      const id = this.existing?.id || `custom-${this.agent}-${Date.now().toString(36)}`;
      const route = this.route.trim();
      const m = {
        id, agent: this.agent, name,
        cli: this.agent !== "dsh" ? rawModel : undefined,
        model: rawModel,
        providerRoute: this.agent === "dsh" ? route : undefined,
        value: this.agent === "dsh" ? (route ? JSON.stringify([route, rawModel]) : rawModel) : rawModel,
        provider: this.agent === "dsh" ? (route || AGENTS[this.agent].name) : AGENTS[this.agent].name,
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

class CustomAcpAgentModal extends Modal {
  constructor(app, existing, list, onSave) {
    super(app);
    this.existing = existing || null;
    this.list = Array.isArray(list) ? list : [];
    this.onSave = onSave;
    this.id = existing?.id || "";
    this.name = existing?.name || "";
    this.command = existing?.command || "";
    this.args = existing ? String(existing.args ?? "") : "acp";
    this.env = existing?.env || "";
    this.autoApprove = Boolean(existing?.autoApprove);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("ad-modal");
    contentEl.createEl("h3", { text: this.existing ? t("编辑自定义 ACP Agent") : t("添加自定义 ACP Agent") });
    const form = contentEl.createDiv({ cls: "ad-form" });
    const field = (label, el) => { const f = form.createDiv({ cls: "ad-field" }); f.createDiv({ cls: "ad-field__label", text: label }); el(f); };
    field(t("Agent ID（用于 @ 路由）"), (f) => {
      const i = f.createEl("input", { cls: "ad-input", attr: { value: this.id, placeholder: t("例如 kiro、pi、mistral-vibe（小写字母/数字/-/_）") } });
      i.disabled = Boolean(this.existing);
      i.oninput = () => { this.id = i.value; };
    });
    field(t("显示名"), (f) => {
      const i = f.createEl("input", { cls: "ad-input", attr: { value: this.name, placeholder: t("例如 Kiro") } });
      i.oninput = () => { this.name = i.value; };
    });
    field(t("命令或绝对路径"), (f) => {
      const i = f.createEl("input", { cls: "ad-input", attr: { value: this.command, placeholder: t("例如 kiro-cli 或 /usr/local/bin/pi") } });
      i.oninput = () => { this.command = i.value; };
    });
    field(t("启动参数（空格分隔，留空不传子命令）"), (f) => {
      const i = f.createEl("input", { cls: "ad-input", attr: { value: this.args, placeholder: "acp" } });
      i.oninput = () => { this.args = i.value; };
    });
    field(t("环境变量（可选，每行 KEY=VALUE，支持 secret:KEY / env:VAR）"), (f) => {
      const ta = f.createEl("textarea", { cls: "ad-input", attr: { rows: "3", placeholder: "OPENAI_API_KEY=secret:my_key" } });
      ta.value = this.env;
      ta.oninput = () => { this.env = ta.value; };
    });
    field(t("自动允许常规工具调用"), (f) => {
      const cb = f.createEl("input", { type: "checkbox" });
      cb.checked = this.autoApprove;
      cb.onchange = () => { this.autoApprove = cb.checked; };
    });
    const bar = contentEl.createDiv({ cls: "ad-btnrow ad-btnrow--end" });
    const cancel = bar.createEl("button", { cls: "ad-btn ad-btn--ghost", text: t("取消") });
    cancel.onclick = () => this.close();
    const save = bar.createEl("button", { cls: "ad-btn ad-btn--cta", text: this.existing ? t("保存") : t("添加") });
    save.onclick = () => {
      const id = this.existing ? this.existing.id : normalizeCustomAcpId(this.id);
      if (!id) return new Notice(t("Agent ID 需以小写字母开头（2–32 位字母/数字/-/_），且不能与内置 Agent 重名"));
      if (!this.existing && this.list.some((x) => x.id === id)) return new Notice(t("已存在同 ID 的自定义 ACP Agent"));
      if (!this.command.trim()) return new Notice(t("请填写命令或可执行文件路径"));
      const entry = normalizeCustomAcpEntry({
        id,
        name: this.name.trim() || id,
        command: this.command.trim(),
        args: this.args.trim(),
        env: this.env,
        color: this.existing?.color,
        autoApprove: this.autoApprove,
        enabled: this.existing ? this.existing.enabled !== false : true,
      });
      if (!entry) return new Notice(t("自定义 ACP Agent 配置无效"));
      this.onSave(entry);
      this.close();
    };
  }
  onClose() { this.contentEl.empty(); }
}
