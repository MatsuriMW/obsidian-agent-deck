import { changeLogDetail } from "./log-detail.js";
import { JOURNAL_LAYOUT_DEFAULT, journalLayout, builtinJournalLayout } from "./journal-layout.js";
// Agent Deck — settings: Delegation, Recording, Dreaming, and About.

import { archivePath } from "./journal-archive.js";
import { App, PluginSettingTab, Notice, Modal, Menu } from "obsidian";
import {
  AGENTS, AGENT_ORDER, EFFORTS, CLAUDE_PERMISSIONS, DEFAULTS, fmtTok, syncDelegationSettings, journalPath, detectJournalFormat,
} from "./constants.js";
import { notePath, companionInstalled } from "./dream.js";
import { externalMemoryPath } from "./dream-sharing.js";
import { agentIcon, setLucide } from "./icons.js";
import { t, currentLanguage } from "./i18n.js";
import { syncModelGroups } from "./model-groups.js";

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
  }

  normalizeTab(tab) {
    if (tab === "models") return "delegate";
    if (tab === "agents" || tab === "tracking" || tab === "record") return "record";
    if (tab === "dream" || tab === "about" || tab === "delegate") return tab;
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
    if (this._dreamTimer) { clearInterval(this._dreamTimer); this._dreamTimer = null; }
  }

  display() {
    this.hide();
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
    if (typeof right === "string") rr.createSpan({ cls: "ad-row__value", text: right });
    else if (right) rr.appendChild(right);
    return r;
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

    // 1. 委派 → 默认目标
    const destinations = this.card(body, t("默认委派到"), t("追踪主力与默认委派分别设置"));
    const targetRow = destinations.createDiv({ cls: "ad-targetpick" });
    for (const id of AGENT_ORDER) {
      const a = AGENTS[id];
      const available = id !== "workbuddy" && !a.trackingOnly;
      const b = targetRow.createEl(available ? "button" : "div", { cls: "ad-target" + (available && p.defaultTarget() === id ? " is-on" : ""), attr: { "data-agent": id } });
      if (available) b.setAttribute("aria-pressed", String(p.defaultTarget() === id));
      b.style.setProperty("--ad-agent", a.color);
      b.style.setProperty("--ad-agent-soft", a.soft);
      agentIcon(b.createSpan({ cls: "ad-glyph" }), id);
      b.createSpan({ text: a.name });
      b.createSpan({ cls: "ad-target__hint", text: a.trackingOnly ? t("暂不支持委派") : id === "workbuddy" ? t("客户端交接") : id === "claude" ? t("桌面版 / 后台") : id === "codex" ? t("桌面版 / 终端") : id === "qoder" ? t("桌面版 / CLI") : t("ACP / 自带账号") });
      if (available) b.onclick = async () => { d.target = id; await p.saveSettings(); this.display(); };
    }

    // 2. 委派 → 各 Agent
    const claude = this.card(body, "Claude Code", "");
    this.modelSelect(claude, "claude", p.defaultModel("claude"), (v) => { this.setDefaultModel("claude", v); this.display(); });
    this.effortControl(claude, "claude", d.claude.effort, (v) => { this.setDefaultEffort("claude", v); this.display(); });
    const permRow = this.row(claude, t("权限模式"), t("plan：规划；auto：自动判断；acceptEdits：允许修改文件"), null);
    this.segmented(permRow.querySelector(":scope > .ad-row__right"), CLAUDE_PERMISSIONS, d.claude.permission, (v) => { d.claude.permission = v; p.saveSettings(); this.display(); });
    const claudePathRow = this.row(claude, t("命令行路径"), t("留空自动查找"), null);
    this.textInput(claudePathRow.querySelector(":scope > .ad-row__right"), d.claude.path || "", t("自动查找"), (v) => { d.claude.path = v.trim(); p.saveSettings(); }, "ad-input--wide");
    const cwdRow = this.row(claude, t("工作目录"), t("留空使用库根目录"), null);
    this.textInput(cwdRow.querySelector(":scope > .ad-row__right"), d.claude.cwd, t("留空 = 库根目录"), (v) => { d.claude.cwd = v.trim(); p.saveSettings(); }, "ad-input--wide");
    const openDesk = this.row(claude, t("完成后自动在桌面版打开"), "", null);
    this.toggle(openDesk.querySelector(":scope > .ad-row__right"), d.claude.openDesktop === true, (v) => { d.claude.openDesktop = v; p.saveSettings(); });
    const claudeMore = this.subDetails(claude, "claude-more", t("更多 Claude Code 选项"));
    const addVault = this.row(claudeMore, t("把当前库也加进可读目录"), "", null);
    this.toggle(addVault.querySelector(":scope > .ad-row__right"), d.claude.addVault !== false, (v) => { d.claude.addVault = v; p.saveSettings(); });
    const trust = this.row(claudeMore, t("库没被信任时自动换个目录"), t("使用已信任目录，并添加当前库的访问路径"), null);
    this.toggle(trust.querySelector(":scope > .ad-row__right"), d.claude.autoTrustedCwd !== false, (v) => { d.claude.autoTrustedCwd = v; p.saveSettings(); });
    const bg = this.row(claudeMore, t("使用 claude --bg 后台服务"), t("由 Claude 后台服务管理会话"), null);
    this.toggle(bg.querySelector(":scope > .ad-row__right"), d.claude.useBackground === true, (v) => { d.claude.useBackground = v; p.saveSettings(); });
    const extra = this.row(claudeMore, t("额外参数"), t("传给 Claude CLI 的参数"), null);
    this.textInput(extra.querySelector(":scope > .ad-row__right"), d.claude.extraArgs, t("可留空"), (v) => { d.claude.extraArgs = v; p.saveSettings(); }, "ad-input--wide");
    const test = claude.createDiv({ cls: "ad-btnrow" });
    this.bigButton(test, t("检查 claude"), async () => { const r = await p.checkBinary("claude"); new Notice(r, 6000); });
    this.bigButton(test, t("在终端里续这个目录"), () => p.openTerminalAt(d.claude.cwd || p.vaultPath, "claude"));

    const codex = this.card(body, "Codex", "");
    const transport = this.row(codex, t("派发到"), "", null);
    this.segmented(transport.querySelector(":scope > .ad-row__right"), [{ id: "desktop", label: t("Codex 桌面版") }, { id: "terminal", label: t("终端") }], d.codex.transport || "desktop", (v) => { d.codex.transport = v; p.saveSettings(); this.display(); });
    this.modelSelect(codex, "codex", p.defaultModel("codex"), (v) => { this.setDefaultModel("codex", v); this.display(); });
    this.effortControl(codex, "codex", d.codex.effort, (v) => { this.setDefaultEffort("codex", v); this.display(); });
    const sandbox = this.row(codex, t("沙箱模式"), t("read-only：只读；workspace-write：允许修改工作目录"), null);
    this.segmented(sandbox.querySelector(":scope > .ad-row__right"), ["read-only", "workspace-write"].map((id) => ({ id, label: id })), d.codex.sandbox, (v) => { d.codex.sandbox = v; p.saveSettings(); this.display(); });
    for (const [key, label, hint] of [["path", t("codex 程序路径"), t("桌面模式留空优先使用 Desktop 自带程序；终端模式从 PATH 查找")], ["cwd", t("工作目录"), t("留空 = 库根目录")]]) {
      const r = this.row(codex, label, hint, null);
      this.textInput(r.querySelector(":scope > .ad-row__right"), d.codex[key], hint, (v) => { d.codex[key] = v.trim(); p.saveSettings(); }, "ad-input--wide");
    }
    this.bigButton(codex.createDiv({ cls: "ad-btnrow" }), t("检查 codex"), async () => new Notice(await p.checkBinary("codex"), 6000));

    const dsh = this.card(body, "DeepSeek Harness", "");
    this.modelSelect(dsh, "dsh", p.defaultModel("dsh"), (v) => { this.setDefaultModel("dsh", v); this.display(); });
    this.effortControl(dsh, "dsh", d.dsh.effort, (v) => { this.setDefaultEffort("dsh", v); this.display(); });
    const route = this.row(dsh, t("自动允许工具调用"), t("关闭后逐次确认工具权限"), null);
    this.toggle(route.querySelector(":scope > .ad-row__right"), d.dsh.autoApprove === true, (v) => { d.dsh.autoApprove = v; p.saveSettings(); });
    const dshPathRow = this.row(dsh, t("命令行路径"), t("留空自动查找"), null);
    this.textInput(dshPathRow.querySelector(":scope > .ad-row__right"), d.dsh.path || "", t("自动查找"), (v) => { d.dsh.path = v.trim(); p.saveSettings(); }, "ad-input--wide");
    const dcwd = this.row(dsh, t("工作目录"), t("留空使用库根目录"), null);
    this.textInput(dcwd.querySelector(":scope > .ad-row__right"), d.dsh.cwd, t("留空 = 库根目录"), (v) => { d.dsh.cwd = v.trim(); p.saveSettings(); }, "ad-input--wide");
    const dextra = this.row(dsh, t("额外 ACP 参数"), t("可留空"), null);
    this.textInput(dextra.querySelector(":scope > .ad-row__right"), d.dsh.extraArgs, t("可留空"), (v) => { d.dsh.extraArgs = v; p.saveSettings(); }, "ad-input--wide");
    const dtest = dsh.createDiv({ cls: "ad-btnrow" });
    this.bigButton(dtest, t("读取 Harness 可用模型"), async () => {
      try { const models = await p.refreshDshModels(); new Notice(t("已读取 {n} 个模型，包含 Harness 中配置的自定义模型", { n: models.length })); this.display(); }
      catch (e) { new Notice(t("读取失败：{msg}", { msg: e.message }), 8000); }
    });
    this.bigButton(dtest, t("检查 dsh"), async () => { const r = await p.checkBinary("dsh"); new Notice(r, 6000); });

    const agy = this.card(body, "Antigravity ACP", t("安装 agy CLI 后运行 agy acp --login 登录"));
    this.modelSelect(agy, "antigravity", p.defaultModel("antigravity"), (v) => { this.setDefaultModel("antigravity", v); this.display(); });
    this.effortControl(agy, "antigravity", d.antigravity.effort, (v) => { this.setDefaultEffort("antigravity", v); this.display(); });
    for (const [key, label, hint] of [["path", t("agy 程序路径"), t("留空自动查找，例如 ~/.local/bin/agy")], ["cwd", t("工作目录"), t("留空 = 库根目录")]]) {
      const r = this.row(agy, label, hint, null);
      this.textInput(r.querySelector(":scope > .ad-row__right"), d.antigravity[key], hint, (v) => { d.antigravity[key] = v.trim(); p.saveSettings(); }, "ad-input--wide");
    }
    const atest = agy.createDiv({ cls: "ad-btnrow" });
    this.bigButton(atest, t("读取 Antigravity 可用模型"), async () => {
      try { const models = await p.refreshAcpModels("antigravity"); new Notice(t("已读取 {n} 个模型", { n: models.length })); this.display(); }
      catch (e) { new Notice(t("读取失败：{msg}", { msg: e.message }), 8000); }
    });
    this.bigButton(atest, t("检查 agy"), async () => new Notice(await p.checkBinary("antigravity"), 6000));

    const opencode = this.card(body, "OpenCode", t("通过 OpenCode.app 内置的 opencode-cli acp 后台委派，也可打开桌面端或终端"));
    this.modelSelect(opencode, "opencode", p.defaultModel("opencode"), (v) => { this.setDefaultModel("opencode", v); this.display(); });
    this.effortControl(opencode, "opencode", d.opencode.effort, (v) => { this.setDefaultEffort("opencode", v); this.display(); });
    const ocRoute = this.row(opencode, t("自动允许工具调用"), t("关闭后逐次确认工具权限"), null);
    this.toggle(ocRoute.querySelector(":scope > .ad-row__right"), d.opencode.autoApprove === true, (v) => { d.opencode.autoApprove = v; p.saveSettings(); });
    const ocDesk = this.row(opencode, t("完成后自动在桌面版打开"), "", null);
    this.toggle(ocDesk.querySelector(":scope > .ad-row__right"), d.opencode.openDesktop === true, (v) => { d.opencode.openDesktop = v; p.saveSettings(); });
    for (const [key, label, hint] of [["path", t("命令行路径"), t("留空自动查找（含 OpenCode.app 内置 CLI）")], ["cwd", t("工作目录"), t("留空 = 库根目录")], ["extraArgs", t("额外 ACP 参数"), t("可留空")]]) {
      const r = this.row(opencode, label, hint, null);
      this.textInput(r.querySelector(":scope > .ad-row__right"), d.opencode[key] || "", hint, (v) => { d.opencode[key] = v.trim(); p.saveSettings(); }, "ad-input--wide");
    }
    const octest = opencode.createDiv({ cls: "ad-btnrow" });
    this.bigButton(octest, t("读取 OpenCode 可用模型"), async () => {
      try { const models = await p.refreshAcpModels("opencode"); new Notice(t("已读取 {n} 个模型", { n: models.length })); this.display(); }
      catch (e) { new Notice(t("读取失败：{msg}", { msg: e.message }), 8000); }
    });
    this.bigButton(octest, t("检查 opencode"), async () => new Notice(await p.checkBinary("opencode"), 6000));

    const qoder = this.card(body, "Qoder", t("已登录 qodercli 时后台直接执行；未登录时自动复制任务并打开 Qoder 桌面版交接"));
    this.modelSelect(qoder, "qoder", p.defaultModel("qoder"), (v) => { this.setDefaultModel("qoder", v); this.display(); });
    this.effortControl(qoder, "qoder", d.qoder.effort, (v) => { this.setDefaultEffort("qoder", v); this.display(); });
    const qPermRow = this.row(qoder, t("权限模式"), t("plan：规划；auto：自动判断；acceptEdits：允许修改文件"), null);
    this.segmented(qPermRow.querySelector(":scope > .ad-row__right"), CLAUDE_PERMISSIONS, d.qoder.permission, (v) => { d.qoder.permission = v; p.saveSettings(); this.display(); });
    for (const [key, label, hint] of [["path", t("命令行路径"), t("留空自动查找（~/.qoder/bin/qodercli/qodercli）")], ["cwd", t("工作目录"), t("留空 = 库根目录")], ["extraArgs", t("额外参数"), t("可留空")]]) {
      const r = this.row(qoder, label, hint, null);
      this.textInput(r.querySelector(":scope > .ad-row__right"), d.qoder[key] || "", hint, (v) => { d.qoder[key] = v.trim(); p.saveSettings(); }, "ad-input--wide");
    }
    const qtest = qoder.createDiv({ cls: "ad-btnrow" });
    this.bigButton(qtest, t("检查 qoder"), async () => new Notice(await p.checkBinary("qoder"), 6000));
    this.bigButton(qtest, t("登录 qoder CLI"), () => p.openTerminalAt(d.qoder.cwd || p.vaultPath, "qoder login"));

    const sharedAgents = this.card(body, t("公共终端与其余 Agent"), "");
    const dt = this.row(sharedAgents, t("主力终端"), t("用于终端委派和恢复会话"), null);
    this.segmented(dt.querySelector(":scope > .ad-row__right"), [{ id: "auto", label: t("自动") }, { id: "terminal", label: t("系统终端") }, { id: "iterm", label: "iTerm2" }, { id: "warp", label: "Warp" }, { id: "tern", label: "Tern" }, { id: "herdr", label: "Herdr" }], s.cliTerminal || "auto", (v) => { s.cliTerminal = v; p.saveSettings(); this.display(); });
    const dd = this.row(sharedAgents, t("默认在终端委派"), t("适用于 Claude Code、Codex、OpenCode 和 Qoder"), null);
    this.toggle(dd.querySelector(":scope > .ad-row__right"), !!s.delegateInTerminal, (v) => { s.delegateInTerminal = v; p.saveSettings(); p.refreshUI(); });
    for (const id of ["workbuddy"]) {
      const r = this.row(sharedAgents, AGENTS[id].name, "", t("客户端交接 · 在客户端选择模型"));
      r.dataset.agent = id;
    }

    // 3. 委派 → 管理模型
    this.renderModels(body);

    // 4. 委派 → 发送规则
    const rules = this.card(body, t("发送规则"), t("任务行 Agent 补全、提示词前后缀和委派附加要求"));
    const suggestRow = this.row(rules, t("输入时显示候选菜单"), t("输入触发符选择 Agent、模型和强度"), null);
    this.toggle(suggestRow.querySelector(":scope > .ad-row__right"), d.mentionSuggest !== false, (v) => { d.mentionSuggest = v; p.saveSettings(); });
    const triggerRow = this.row(rules, t("触发符号"), t("默认 @，前面需空格"), null);
    this.textInput(triggerRow.querySelector(":scope > .ad-row__right"), d.mentionTrigger || "@", "@", (v) => {
      const trigger = v.trim();
      if (!trigger || /[\s`\p{L}\p{N}]/u.test(trigger)) { new Notice(t("请填写不含空格、字母、数字或反引号的符号")); return; }
      d.mentionTrigger = trigger; p.saveSettings();
    });
    const pre = rules.createDiv({ cls: "ad-field" });
    pre.createDiv({ cls: "ad-field__label", text: t("前缀") });
    const preTa = pre.createEl("textarea", { cls: "ad-textarea", attr: { placeholder: t("例如：先读一下相关文件，再动手。"), rows: "2" } });
    preTa.value = d.promptPrefix || "";
    preTa.onchange = () => { d.promptPrefix = preTa.value; p.saveSettings(); };
    const suf = rules.createDiv({ cls: "ad-field" });
    suf.createDiv({ cls: "ad-field__label", text: t("后缀") });
    const sufTa = suf.createEl("textarea", { cls: "ad-textarea", attr: { placeholder: t("例如：做完把改动文件列出来。"), rows: "2" } });
    sufTa.value = d.promptSuffix || "";
    sufTa.onchange = () => { d.promptSuffix = sufTa.value; p.saveSettings(); };
    const rc = this.row(rules, t("委派附加要求"), t("追加到每次委派消息末尾"), null);
    this.toggle(rc.querySelector(":scope > .ad-row__right"), d.confirmFirst !== false, (v) => { d.confirmFirst = v; p.saveSettings(); });
    const confirm = rules.createDiv({ cls: "ad-field" });
    confirm.createDiv({ cls: "ad-field__label", text: t("附加要求正文（可自定义）") });
    const confirmTa = confirm.createEl("textarea", { cls: "ad-textarea", attr: { rows: "5" } });
    confirmTa.value = d.confirmFirstPrompt ?? DEFAULTS.delegate.confirmFirstPrompt;
    confirmTa.onchange = () => { d.confirmFirstPrompt = confirmTa.value; p.saveSettings(); };
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
    const row = this.row(parent, t("默认模型"), "", null);
    const sel = row.querySelector(":scope > .ad-row__right").createEl("select", { cls: "ad-select" });
    const models = this.plugin.modelsFor(agent).filter((m) => this.plugin.modelEnabled(m.id));
    if (!models.length) models.push(...this.plugin.modelsFor(agent));
    if (value && !models.some((m) => m.id === value)) models.push(this.plugin.modelById(value) || { id: value, name: value });
    for (const m of models) {
      const o = sel.createEl("option", { text: m.name, attr: { value: m.id } });
      if (m.id === value) o.selected = true;
    }
    sel.onchange = () => onChange(sel.value);
    return sel;
  }

  effortControl(parent, agent, value, onChange) {
    const row = this.row(parent, t("默认强度"), "", null);
    const right = row.querySelector(":scope > .ad-row__right");
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
    for (const agent of ["claude", "codex", "dsh", "antigravity", "opencode", "qoder"]) {
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

  // ---------- Recording ----------
  renderAgents(body) { return this.renderRecord(body); }
  renderTracking(body) { return this.renderRecord(body); }

  renderRecord(body) {
    const p = this.plugin;
    const s = p.settings;
    const d = s.delegate;

    // 1. 记录 → 来源与扫描
    const sourceCard = this.card(body, t("来源与扫描"), t("最多两位主力读取全部历史，其余读取当天会话"));
    const grid = sourceCard.createDiv({ cls: "ad-set-agents" });
    for (const id of AGENT_ORDER) {
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
      const star = controls.createEl("button", { cls: "ad-star" + (primary ? " is-on" : ""), attr: { "aria-label": primary ? t("取消主力") : t("设为主力（最多两个）"), "aria-pressed": String(primary) } });
      setLucide(star, primary ? "star" : "star-off");
      star.title = primary ? t("取消主力") : t("设为主力（最多两个）");
      star.onclick = () => p.togglePrimary(id);
      this.toggle(controls, enabled, (v) => p.setAgentEnabled(id, v), primary);
      const sessions = [...p.usage.meta.values()].filter((x) => x.agent === id);
      const stats = card.createDiv({ cls: "ad-set-agent__meta" });
      stats.createSpan({ text: t("{n} 个会话", { n: sessions.length }) });
      stats.createSpan({ text: fmtTok(sessions.reduce((n, x) => n + (x.out || 0), 0)) + " tok" });
      stats.createSpan({ cls: "ad-set-agent__state", text: primary ? t("主力（全量）") : enabled ? t("追踪中") : t("已关闭") });
    }
    const r1 = this.row(sourceCard, t("日记日期分界"), t("此时刻之前计入前一天"), null);
    this.numberInput(r1.querySelector(":scope > .ad-row__right"), s.dayCutoff, 0, 12, (v) => { s.dayCutoff = v; p.saveSettings(); p.scheduleScan(); });
    const r2 = this.row(sourceCard, t("扫描间隔（秒）"), "", null);
    this.numberInput(r2.querySelector(":scope > .ad-row__right"), s.pollSeconds, 5, 300, (v) => { s.pollSeconds = v; p.saveSettings(); p.scheduleScan(); });
    const r4 = this.row(sourceCard, t("主力读多少天历史"), t("非主力读取当天会话"), null);
    this.numberInput(r4.querySelector(":scope > .ad-row__right"), s.fullHistoryDays, 1, 365, (v) => { s.fullHistoryDays = v; p.saveSettings(); p.scanNow(true); });
    const d1 = this.row(sourceCard, t("识别 side chat 和母子关系"), t("Claude 桌面版子会话与母子关联"), null);
    this.toggle(d1.querySelector(":scope > .ad-row__right"), s.claudeDesktop !== false, (v) => { s.claudeDesktop = v; p.saveSettings(); p.scanNow(true); });
    const scanBar = sourceCard.createDiv({ cls: "ad-btnrow" });
    this.bigButton(scanBar, t("立即扫描"), () => p.scanNow(), "mod-cta");
    this.bigButton(scanBar, t("导入螺旋日程的历史"), () => p.importNautilus());
    const logDetails = this.subDetails(sourceCard, "log-paths", t("本机日志"));
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

    // 2. 记录 → 日记与归档
    const jr = this.card(body, t("日记与归档"), t("将会话记录写入今天的日记"));
    const master = this.row(jr, t("启用日记写入"), "", null);
    this.toggle(master.querySelector(":scope > .ad-row__right"), s.journalAutoWrite !== false, (v) => { s.journalAutoWrite = v; p.saveSettings(); });
    const det = detectJournalFormat(this.app, s);
    const jf = this.row(jr, t("日记目录"), t("当前：{folder}；今天：{path}", { folder: det.folder || t("库根目录"), source: det.folderSource, path: journalPath(this.app, s) }), null);
    this.textInput(jf.querySelector(":scope > .ad-row__right"), s.journalFolder || "", t("自动：{folder}", { folder: det.folder || t("库根目录") }), (v) => { s.journalFolder = v.trim(); p.saveSettings(); this.display(); });
    const jfmt = this.row(jr, t("日记文件名格式"), t("例如 YYYY-MM-DD；当前：{format}", { format: det.format, source: det.source }), null);
    this.textInput(jfmt.querySelector(":scope > .ad-row__right"), s.journalFormat || "", t("自动：{format}", { format: det.format }), (v) => { s.journalFormat = v.trim(); p.saveSettings(); this.display(); });
    const ja = this.row(jr, t("自动会话记录"), t("自动将活跃会话建项并记入今日日记"), null);
    this.toggle(ja.querySelector(":scope > .ad-row__right"), s.autoLog === true, (v) => { s.autoLog = v; p.saveSettings(); });
    const jag = this.row(jr, t("记哪几个 Agent"), t("选择自动建项的 Agent"), null);
    const agBox = jag.querySelector(":scope > .ad-row__right").createDiv({ cls: "ad-seg ad-seg--many" });
    const agOn = (s.autoLogAgents ||= {});
    for (const id of AGENT_ORDER) {
      const b = agBox.createEl("button", { cls: "ad-seg__btn" + (agOn[id] !== false ? " is-on" : ""), text: AGENTS[id]?.short || id, attr: { "aria-pressed": String(agOn[id] !== false) } });
      b.onclick = () => { agOn[id] = agOn[id] === false; b.classList.toggle("is-on", agOn[id] !== false); b.setAttribute("aria-pressed", String(agOn[id] !== false)); p.saveSettings(); };
    }
    const grain = this.row(jr, t("自动记录颗粒度"), t("选择记录的时机"), null);
    this.segmented(grain.querySelector(":scope > .ad-row__right"), [{ id: "latest", label: t("最新进展") }, { id: "round", label: t("每轮记录") }, { id: "paused", label: t("停歇或归档") }], s.autoLogGranularity || DEFAULTS.autoLogGranularity, (v) => { s.autoLogGranularity = v; p.saveSettings(); this.display(); });
    const jdetail = this.row(jr, t("自动日志详细程度"), "", null);
    const detailDesc = jdetail.querySelector(":scope > .ad-row__left");
    detailDesc.createDiv({ cls: "ad-row__desc", text: t("简略：任务和结论合成一段") });
    detailDesc.createDiv({ cls: "ad-row__desc", text: t("标准：提问、回答各一句") });
    detailDesc.createDiv({ cls: "ad-row__desc", text: t("详细：保留提问、回复摘录和步骤") });
    this.segmented(jdetail.querySelector(":scope > .ad-row__right"), [{ id: "brief", label: t("简略（默认）") }, { id: "standard", label: t("标准") }, { id: "detailed", label: t("详细") }], s.autoLogDetail || "brief", (v) => { changeLogDetail(s, v); p.saveSettings(); this.display(); });
    const rmode = this.row(jr, t("AI 记录显示方式"), t("控制笔记中默认展开的记录"), null);
    this.segmented(rmode.querySelector(":scope > .ad-row__right"), [
      { id: "collapsed", label: t("默认折叠") },
      { id: "expanded", label: t("默认展开") },
      { id: "latest5", label: t("最新五条") },
      { id: "latest3", label: t("最新三条") },
      { id: "latest1", label: t("最新一条") },
    ], s.aiRecordDisplay || DEFAULTS.aiRecordDisplay, (v) => { s.aiRecordDisplay = v; p.saveSettings(); p.refreshUI(); this.display(); });
    const merge = this.row(jr, t("累积后自动合并总结"), "", null);
    this.toggle(merge.querySelector(":scope > .ad-row__right"), !!s.autoLogMerge, (v) => { s.autoLogMerge = v; p.saveSettings(); this.display(); });
    const mergeN = this.row(jr, t("累积多少条结论后合并"), t("至少 2 条"), null);
    this.numberInput(mergeN.querySelector(":scope > .ad-row__right"), s.autoLogMergeThreshold || 10, 2, 100, (v) => { s.autoLogMergeThreshold = Math.round(v); p.saveSettings(); });

    const wb = this.subDetails(jr, "writeback", t("状态与结论回写"), true);
    const dm1 = this.row(wb, t("把状态改成 DELEGATED"), "", null);
    this.toggle(dm1.querySelector(":scope > .ad-row__right"), d.markStatus !== false, (v) => { d.markStatus = v; p.saveSettings(); });
    const dm2 = this.row(wb, t("写 🔗 绑定行"), t("删除绑定行可解除关联"), null);
    this.toggle(dm2.querySelector(":scope > .ad-row__right"), d.writeLink !== false, (v) => { d.writeLink = v; p.saveSettings(); });
    const dm3 = this.row(wb, t("委派任务回写"), t("委派完成后写 💬 结论"), null);
    this.toggle(dm3.querySelector(":scope > .ad-row__right"), s.autoWriteResult !== false, (v) => { s.autoWriteResult = v; p.saveSettings(); });
    const js = this.row(wb, t("回写日记"), t("更新已绑定任务的状态与结论"), null);
    this.toggle(js.querySelector(":scope > .ad-row__right"), s.journalSync !== false, (v) => { s.journalSync = v; p.saveSettings(); });
    for (const [key, label, desc] of [
      ["resultBack", t("会话结论写回（💬）"), ""],
      ["agentKw", t("状态关键词跟着会话"), ""],
      ["autoLogKw", t("自动记的条目也跟着切状态"), ""],
      ["kidBlocks", t("子会话和 side chat 子块"), ""],
    ]) {
      const row = this.row(wb, label, desc, null);
      this.toggle(row.querySelector(":scope > .ad-row__right"), s[key] !== false, (v) => { s[key] = v; p.saveSettings(); });
    }
    const rMax = this.row(wb, t("💬 最多多少个字"), "", null);
    this.numberInput(rMax.querySelector(":scope > .ad-row__right"), s.resultMax || 240, 40, 2000, (v) => { s.resultMax = v; p.saveSettings(); });
    const jd = this.row(wb, t("归档的会话记成 DONE"), "", null);
    this.toggle(jd.querySelector(":scope > .ad-row__right"), s.autoLogArchiveDone !== false, (v) => { s.autoLogArchiveDone = v; p.saveSettings(); });
    const jn = this.row(wb, t("整理完弹通知"), "", null);
    this.toggle(jn.querySelector(":scope > .ad-row__right"), s.autoLogNotify !== false, (v) => { s.autoLogNotify = v; p.saveSettings(); });

    const tpl = this.subDetails(jr, "template-archive", t("整理日志模板与归档"), true);
    const suggest = this.row(tpl, t("日志杂乱时提醒整理"), t("每新增 4 条记录提醒，每天最多 2 次"), null);
    this.toggle(suggest.querySelector(":scope > .ad-row__right"), s.organizeJournalSuggest !== false, (v) => { s.organizeJournalSuggest = v; p.saveSettings(); });
    const templateRow = this.row(tpl, t("整理模板"), t("设置笔记分区的标题和顺序"), null);
    const template = templateRow.querySelector(":scope > .ad-row__right").createEl("select", { cls: "ad-select" });
    for (const [value, label] of [["auto", t("跟随界面（默认）")], ["zh", t("中文模板")], ["en", "English template"], ["custom", t("自定义模板")]]) template.createEl("option", { text: label, attr: { value } });
    template.value = s.journalLayout ? "custom" : s.journalLayoutLanguage || "auto";
    template.onchange = () => {
      if (template.value === "custom") s.journalLayout = builtinJournalLayout(s.journalLayoutLanguage === "auto" ? currentLanguage() : s.journalLayoutLanguage || currentLanguage());
      else { s.journalLayout = null; s.journalLayoutLanguage = template.value; }
      p.saveSettings(); this.display();
    };
    if (s.journalLayout) {
      const names = { done: t("已完成"), active: t("进行中"), notes: t("手写内容") };
      const orderRow = this.row(tpl, t("分区顺序"), "", null);
      const orderSel = orderRow.querySelector(":scope > .ad-row__right").createEl("select", { cls: "ad-select" });
      for (const keys of [["done", "active", "notes"], ["active", "done", "notes"], ["notes", "done", "active"], ["notes", "active", "done"], ["done", "notes", "active"], ["active", "notes", "done"]]) orderSel.createEl("option", { text: keys.map((key) => names[key]).join(" → "), attr: { value: keys.join(",") } });
      orderSel.value = s.journalLayout.order.join(",");
      orderSel.onchange = () => { s.journalLayout = journalLayout({ ...s.journalLayout, order: orderSel.value.split(",") }); p.saveSettings(); };
      for (const key of JOURNAL_LAYOUT_DEFAULT.order) {
        const row = this.row(tpl, t("{section}标题", { section: names[key] }), key === "notes" ? t("留空不添加标题") : "", null);
        const input = this.textInput(row.querySelector(":scope > .ad-row__right"), s.journalLayout.titles[key], names[key], (value) => {
          try { s.journalLayout = journalLayout({ ...s.journalLayout, titles: { ...s.journalLayout.titles, [key]: value } }); p.saveSettings(); }
          catch (error) { input.value = s.journalLayout.titles[key]; new Notice(error.message); }
        });
      }
    }
    const archive = this.row(tpl, t("默认归档位置"), t("库内 Markdown 路径"), null);
    this.textInput(archive.querySelector(":scope > .ad-row__right"), s.doneArchivePath, DEFAULTS.doneArchivePath, (v) => { try { s.doneArchivePath = archivePath(v); p.saveSettings(); } catch (e) { new Notice(e.message); } }, "ad-input--wide");
    const archOrder = this.row(tpl, t("归档顺序"), "", null);
    this.segmented(archOrder.querySelector(":scope > .ad-row__right"), [{ id: "prepend", label: t("插到开头") }, { id: "append", label: t("追加到末尾") }], s.archiveOrder || "prepend", (v) => { s.archiveOrder = v; p.saveSettings(); });
    const jrBtns = jr.createDiv({ cls: "ad-btnrow" });
    this.bigButton(jrBtns, t("现在整理一次"), () => p.autoLog.logNow());
    this.bigButton(jrBtns, t("恢复默认整理模板"), () => { s.journalLayout = null; s.journalLayoutLanguage = "auto"; p.saveSettings(); this.display(); });

    // 3. 记录 → 整理模型
    const modelCard = this.card(body, t("AI 整理模型"), t("自动整理、润色使用的 CLI、模型与调用频率，独立于委派模型"));
    const jprovider = this.row(modelCard, t("整理使用的 CLI"), "", null);
    this.segmented(jprovider.querySelector(":scope > .ad-row__right"), [{ id: "claude", label: "Claude CLI" }, { id: "codex", label: "Codex CLI" }], s.autoLogProvider || "claude", (v) => {
      s.autoLogProvider = v; s.autoLogModel = v === "codex" ? "gpt-6-luna" : "haiku"; s.roundPolishModel = ""; s.autoLogPath = ""; p.saveSettings(); this.display();
    });
    if (s.autoLogProvider === "codex") {
      const effort = this.row(modelCard, t("整理与润色的推理强度"), "", null);
      this.segmented(effort.querySelector(":scope > .ad-row__right"), EFFORTS.codex, s.autoLogEffort || "low", (v) => { s.autoLogEffort = v; p.saveSettings(); this.display(); });
    }
    const jm = this.row(modelCard, t("整理用的模型"), t("填写模型名或别名"), null);
    this.textInput(jm.querySelector(":scope > .ad-row__right"), s.autoLogModel || "", s.autoLogProvider === "codex" ? "gpt-6-luna" : "haiku", (v) => { s.autoLogModel = v.trim(); p.saveSettings(); });
    const jt = this.row(modelCard, t("整理超时（秒）"), "", null);
    this.numberInput(jt.querySelector(":scope > .ad-row__right"), s.autoLogTimeout || 120, 10, 600, (v) => { s.autoLogTimeout = v; p.saveSettings(); });
    const jfb = this.row(modelCard, t("整理失败时使用会话标题"), "", null);
    this.toggle(jfb.querySelector(":scope > .ad-row__right"), s.autoLogFallback !== false, (v) => { s.autoLogFallback = v; p.saveSettings(); });
    const jp = this.row(modelCard, t("整理 CLI 路径"), t("留空使用委派设置中的路径"), null);
    this.textInput(jp.querySelector(":scope > .ad-row__right"), s.autoLogPath || "", t("自动找"), (v) => { s.autoLogPath = v.trim(); p.saveSettings(); }, "ad-input--wide");
    const jrp = this.row(modelCard, t("每轮结论让模型润色"), t("适用于简略和标准记录"), null);
    this.toggle(jrp.querySelector(":scope > .ad-row__right"), s.roundPolish !== false, (v) => { s.roundPolish = v; p.saveSettings(); });
    const jrm = this.row(modelCard, t("润色用的模型"), t("留空沿用整理模型"), null);
    this.textInput(jrm.querySelector(":scope > .ad-row__right"), s.roundPolishModel || "", t("同整理用的模型"), (v) => { s.roundPolishModel = v.trim(); p.saveSettings(); });
    const jrt = this.row(modelCard, t("润色超时（秒）"), "", null);
    this.numberInput(jrt.querySelector(":scope > .ad-row__right"), s.roundPolishTimeout || 30, 5, 300, (v) => { s.roundPolishTimeout = v; p.saveSettings(); });
    const sched = this.subDetails(modelCard, "autolog-schedule", t("自动整理频率"), true);
    const je = this.row(sched, t("整理间隔（分钟）"), t("至少 5 分钟"), null);
    this.numberInput(je.querySelector(":scope > .ad-row__right"), s.autoLogEvery || 20, 5, 240, (v) => { s.autoLogEvery = v; p.saveSettings(); });
    const jst = this.row(sched, t("首次整理延迟（分钟）"), "", null);
    this.numberInput(jst.querySelector(":scope > .ad-row__right"), s.autoLogStartDelay ?? 1, 1, 240, (v) => { s.autoLogStartDelay = v; p.saveSettings(); });
    const jmin = this.row(sched, t("最短记录时长（分钟）"), t("0 表示立即记录"), null);
    this.numberInput(jmin.querySelector(":scope > .ad-row__right"), s.autoLogMinMinutes ?? 3, 0, 120, (v) => { s.autoLogMinMinutes = v; p.saveSettings(); });
    const jid = this.row(sched, t("暂停判定（分钟）"), t("至少 5 分钟"), null);
    this.numberInput(jid.querySelector(":scope > .ad-row__right"), s.autoLogIdle || 10, 5, 480, (v) => { s.autoLogIdle = v; p.saveSettings(); });
    const jb = this.row(sched, t("每批会话数"), "", null);
    this.numberInput(jb.querySelector(":scope > .ad-row__right"), s.autoLogBatch || 8, 1, 20, (v) => { s.autoLogBatch = v; p.saveSettings(); });

    // 4. 记录 → 展示与维护
    const ui = this.card(body, t("展示与维护"), t("会话打开方式、面板、编辑器与菜单栏显示、缓存维护"));
    const dc = this.row(ui, t("终端会话打开方式"), "", null);
    this.segmented(dc.querySelector(":scope > .ad-row__right"), [{ id: "terminal", label: t("终端") }, { id: "desktop", label: t("桌面版") }], s.cliOpen === "desktop" ? "desktop" : "terminal", (v) => { s.cliOpen = v; p.saveSettings(); this.display(); });
    const d2 = this.row(ui, t("归档的会话不再列出"), "", null);
    this.toggle(d2.querySelector(":scope > .ad-row__right"), s.hideArchived !== false, (v) => { s.hideArchived = v; p.saveSettings(); p.refreshUI(); });
    for (const [key, label, desc, fallback] of [
      ["showEditorPills", t("任务行上的会话状态按钮"), "", true],
      ["dragGrip", t("列表项尾巴上的把手"), t("单击委派；双击或 ⌘ 单击选择 Agent"), true],
      ["showRibbonIcon", t("左侧栏图标"), "", true],
      ["openDashboardOnStartup", t("启动时打开面板"), "", false],
    ]) {
      const row = this.row(ui, label, desc, null);
      this.toggle(row.querySelector(":scope > .ad-row__right"), s[key] === undefined ? fallback : s[key] !== false, (v) => { s[key] = v; p.saveSettings(); p.applyUiSettings(); });
    }
    const bars = this.row(ui, t("最近 14 天的条形图"), "", null);
    this.toggle(bars.querySelector(":scope > .ad-row__right"), s.ui.showUsageBars !== false, (v) => { s.ui.showUsageBars = v; p.saveSettings(); p.refreshUI(); });
    const spark = this.row(ui, t("每个 Agent 的小火花线"), "", null);
    this.toggle(spark.querySelector(":scope > .ad-row__right"), s.ui.showSparkline !== false, (v) => { s.ui.showSparkline = v; p.saveSettings(); p.refreshUI(); });
    this.row(ui, t("跳转到正在运行的项目"), t("默认 Ctrl+Alt+J"), "⌃⌥J");

    const mb = this.row(ui, t("macOS 菜单栏"), "", null);
    this.mbSwitch = this.toggle(mb.querySelector(":scope > .ad-row__right"), s.showMenuBar !== false, (v) => { s.showMenuBar = v; p.saveSettings(); p.applyUiSettings(); });
    const ma = this.row(ui, t("菜单栏显示哪些 Agent"), "", null);
    this.segmented(ma.querySelector(":scope > .ad-row__right"), [{ id: "primary-running", label: t("主力与在跑的") }, { id: "all", label: t("全部已启用") }], s.menuBarAgentScope || "primary-running", (v) => { s.menuBarAgentScope = v; p.saveSettings(); p.menubar?.update(true); this.display(); });
    for (const [key, label, desc, min, max] of [
      ["menuBarPrimaryLimit", t("菜单栏：主力最多几个"), "", 3, 12],
      ["menuBarOtherLimit", t("菜单栏：其它 Agent 最多几个"), "", 1, 6],
    ]) {
      const row = this.row(ui, label, desc, null);
      this.numberInput(row.querySelector(":scope > .ad-row__right"), s[key] || (key === "menuBarPrimaryLimit" ? 6 : 3), min, max, (v) => { s[key] = v; p.saveSettings(); p.refreshUI(); });
    }
    const hkRow = this.row(ui, t("菜单栏快捷键"), t("点输入框后按组合键，需包含 ⌃、⌥ 或 ⌘"), null);
    const hkRight = hkRow.querySelector(":scope > .ad-row__right");
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

    const dn = this.row(ui, t("使用螺旋日程的进度显示"), "", null);
    this.toggle(dn.querySelector(":scope > .ad-row__right"), s.yieldToNautilus !== false, (v) => { s.yieldToNautilus = v; p.saveSettings(); p.refreshUI(); });
    const nautRow = this.row(ui, t("关闭螺旋日程右下角的 Agent 汇总"), "", null);
    this.toggle(nautRow.querySelector(":scope > .ad-row__right"), s.menuBarHideNautilus !== false, (v) => { s.menuBarHideNautilus = v; p.saveSettings(); if (v) p.hideNautilusAgentBar().catch(() => {}); else p.restoreNautilusAgentBar().catch(() => {}); });

    const btn = ui.createDiv({ cls: "ad-btnrow" });
    this.bigButton(btn, t("重启菜单栏"), () => p.menubar?.restart());
    this.bigButton(btn, t("重新计算全部历史"), () => p.rebuildUsage(), "mod-warning");
    this.bigButton(btn, t("打开插件目录"), () => p.openPluginDir());
    this.bigButton(btn, t("停用螺旋日程里的 AI 写入"), () => p.pauseNautilus(), "mod-warning");
    const stats = ui.createDiv({ cls: "ad-statline" });
    const days = Object.keys(p.store.days).length;
    stats.createSpan({ text: t("{n} 天记录", { n: days }) });
    stats.createSpan({ cls: "ad-dot", text: "·" });
    stats.createSpan({ text: t("{n} 个会话索引", { n: p.usage.meta.size }) });
    stats.createSpan({ cls: "ad-dot", text: "·" });
    stats.createSpan({ text: t("{n} 个日志文件", { n: p.usage.files.size }) });
  }

  // ---------- Dreaming ----------
  renderDream(body) {
    const p = this.plugin, s = p.settings.dream;
    const card = this.card(body, t("Dreaming · 长期记忆"), t("从近 14 天日志提炼记忆，保存到笔记"));
    const auto = this.row(card, t("每天自动整理"), "", null);
    this.toggle(auto.querySelector(":scope > .ad-row__right"), s.enabled, (v) => { s.enabled = v; p.saveSettings(); });
    const file = this.row(card, t("长期记忆笔记"), t("库内 Markdown 路径"), null);
    this.textInput(file.querySelector(":scope > .ad-row__right"), s.path, "Agent Deck/长期记忆.md", (v) => { try { s.path = notePath(v); p.saveSettings(); } catch (e) { new Notice(e.message); } }, "ad-input--wide");
    if (companionInstalled(p.app)) {
      const sync = this.row(card, t("同步到 Telegram Companion 陪伴档案"), t("同步有效记忆，最多 6000 字"), null);
      this.toggle(sync.querySelector(":scope > .ad-row__right"), s.syncProfile, (v) => { s.syncProfile = v; p.saveSettings(); });
    }
    const actions = card.createDiv({ cls: "ad-btnrow" });
    const run = this.bigButton(actions, t("现在 Dream 一次"), async () => {
      const task = p.dreaming.run(); update();
      try { await task; } finally { update(); }
    });
    const progress = card.createDiv({ cls: "ad-dream-progress", attr: { role: "status", "aria-live": "polite" } });
    const phase = progress.createDiv();
    const elapsed = progress.createDiv({ cls: "ad-muted" });
    const meter = progress.createEl("progress", { attr: { "aria-label": t("Dream 整理进度") } });
    this.bigButton(actions, t("导出长期记忆 Markdown 副本"), () => p.dreaming.exportMemory());
    card.createDiv({ cls: "ad-muted", text: t("可直接编辑长期记忆笔记") });
    const summary = card.createDiv({ cls: "ad-muted" });

    const c = s.share, sharing = p.dreaming.sharing;
    const shared = this.card(body, t("与其他 Agent 共享记忆"), t("将记忆导出到固定文件，供其他 Agent 读取"));
    const enabled = this.row(shared, t("自动同步共享记忆"), t("Dream 完成后同步，并按下方间隔定期同步"), null);
    this.toggle(enabled.querySelector(":scope > .ad-row__right"), c.enabled, (v) => { c.enabled = v; p.saveSettings(); });
    const target = this.row(shared, t("共享文件路径"), t("绝对路径，支持 ~/"), null);
    this.textInput(target.querySelector(":scope > .ad-row__right"), c.path, "/Users/me/shared-agent-memory/memory.md", (v) => { try { c.path = v.trim() ? externalMemoryPath(v) : ""; p.saveSettings(); } catch (e) { new Notice(e.message); } }, "ad-input--wide");
    const interval = this.row(shared, t("定期同步间隔（小时）"), t("1–168 小时"), null);
    this.numberInput(interval.querySelector(":scope > .ad-row__right"), c.intervalHours, 1, 168, (v) => { c.intervalHours = v; p.saveSettings(); });
    const git = this.row(shared, t("同步后提交并推送 Git"), t("共享文件需位于 Git 仓库中；推送到 origin 当前分支"), null);
    this.toggle(git.querySelector(":scope > .ad-row__right"), c.gitPush, (v) => { c.gitPush = v; p.saveSettings(); });
    const syncNow = this.bigButton(shared.createDiv({ cls: "ad-btnrow" }), t("立即同步共享记忆"), async () => {
      const task = sharing.sync(); update();
      try { await task; } finally { update(); }
    });
    const sharedStatus = shared.createDiv({ cls: "ad-muted", attr: { role: "status", "aria-live": "polite" } });
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
    this._dreamTimer = setInterval(update, 1000);
  }

  // ---------- About ----------
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
    meta.createDiv({ text: t("版本 {version} · MIT License", { version: p.manifest.version }) });
    meta.createDiv({ text: t("从 Nautilus Spiral（螺旋日程）的 AI 追踪部分拆出；交互参考了小红书 @ZZ.X 的两条帖子。") });
    const btns = c.createDiv({ cls: "ad-btnrow" });
    this.bigButton(btns, t("打开 GitHub 仓库"), () => p.openExternal("https://github.com/MatsuriMW/obsidian-agent-deck"));
    this.bigButton(btns, t("复制调试信息"), async () => {
      const text = JSON.stringify({ version: p.manifest.version, settings: p.settings, files: p.usage.files.size, sessions: p.usage.meta.size, errors: p.usage.errors }, null, 2);
      await navigator.clipboard.writeText(text);
      new Notice(t("调试信息已复制"));
    });
  }
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
      for (const id of ["claude", "codex", "dsh", "antigravity", "opencode", "qoder"]) s.createEl("option", { text: AGENTS[id].name, attr: { value: id } });
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
