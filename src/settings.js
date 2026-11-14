import { changeLogDetail } from "./log-detail.js";
import { JOURNAL_LAYOUT_DEFAULT, journalLayout, builtinJournalLayout } from "./journal-layout.js";
// Agent Deck — settings, including the layered Models page.

import { archivePath } from "./journal-archive.js";
import { App, PluginSettingTab, Notice, Modal, Menu } from "obsidian";
import {
  AGENTS, AGENT_ORDER, EFFORTS, CLAUDE_PERMISSIONS, DEFAULTS, fmtTok, deepMerge, journalPath, detectJournalFormat,
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

const TABS = [
  ["agents", "Agents", "users"],
  ["delegate", "委派", "send"],
  ["models", "Models", "layers"],
  ["tracking", "追踪", "radar"],
  ["dream", "Dreaming", "moon"],
  ["about", "关于", "info"],
];

export class AgentDeckSettingsTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.tab = "agents";
    this.draft = null;
    this.filter = "all";
    this.search = "";
  }

  hide() {
    if (this._dreamTimer) { clearInterval(this._dreamTimer); this._dreamTimer = null; }
  }

  display() {
    this.hide();
    const { containerEl } = this;
    const active = (containerEl.ownerDocument || document).activeElement;
    const focusSearch = !!(active && active.classList && active.classList.contains("ad-search__input"));
    if (this._draftBar) { try { this._draftBar.remove(); } catch { /* gone */ } this._draftBar = null; }
    containerEl.empty();
    containerEl.addClass("ad-settings");
    const s = this.plugin.settings;
    const head = containerEl.createDiv({ cls: "ad-set-head" });
    const brand = head.createDiv({ cls: "ad-brand" });
    const brandMark = brand.createSpan({ cls: "ad-brand__mark" });
    setLucide(brandMark, "wand-sparkles");
    const bt = brand.createDiv({ cls: "ad-brand__text" });
    bt.createDiv({ cls: "ad-brand__name", text: "Agent Deck" });
    bt.createDiv({ cls: "ad-brand__sub", text: `${t("智能体甲板")} · v${this.plugin.manifest.version}` });

    const nav = containerEl.createDiv({ cls: "ad-set-nav" });
    const dirty = this.draft && JSON.stringify(this.draft) !== JSON.stringify(this.plugin.settings.models);
    for (const [id, label, icon] of TABS) {
      const text = id === "models" && dirty ? `${t(label)} ·` : t(label);
      const b = nav.createEl("button", { cls: "ad-set-tab" + (this.tab === id ? " is-on" : "") + (id === "models" && dirty ? " is-dirty" : "") });
      const ic = b.createSpan({ cls: "ad-tabicon" });
      setLucide(ic, icon);
      b.createSpan({ text });
      b.onclick = () => { this.tab = id; this.display(); };
    }
    const body = containerEl.createDiv({ cls: "ad-set-body" });
    if (this.tab === "agents") this.renderAgents(body);
    else if (this.tab === "delegate") this.renderDelegate(body);
    else if (this.tab === "models") this.renderModels(body);
    else if (this.tab === "dream") this.renderDream(body);
    else if (this.tab === "tracking") this.renderTracking(body);
    else this.renderAbout(body);
    if (this.tab === "models") this.renderDraftBar(body);
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
    // 状态记在按钮自己身上：点一下马上换样子，下一次点发的是新值（以前一直发创建时的反值，第二下就像点不动）
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

  // ---------- Agents ----------
  renderAgents(body) {
    const p = this.plugin;
    const s = p.settings;
    const agentSection = this.card(body, t("要追踪的 Agent"), t("最多两位主力读取全部历史，其余读取当天会话"));
    const grid = agentSection.createDiv({ cls: "ad-set-agents" });
    for (const id of AGENT_ORDER) {
      const a = AGENTS[id];
      const enabled = p.agentEnabled(id);
      const primary = p.isPrimary(id);
      const card = grid.createDiv({ cls: `ad-set-agent ${enabled ? "" : "is-off"} ${primary ? "is-primary" : ""}` });
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
      if (["claude", "codex", "dsh", "antigravity"].includes(id)) {
        const config = card.createDiv({ cls: "ad-set-agent__config" });
        this.modelSelect(config, id, p.defaultModel(id), (value) => { this.setDefaultModel(id, value); this.display(); });
        const isDefault = p.defaultTarget() === id;
        const button = this.bigButton(config, isDefault ? t("默认委派") : t("设为默认委派"), () => { s.delegate.target = id; p.saveSettings(); this.display(); }, isDefault ? "is-default" : "");
        button.setAttribute("aria-pressed", String(isDefault));
      }
    }
    const bar = body.createDiv({ cls: "ad-btnrow" });
    this.bigButton(bar, t("立即扫描"), () => p.scanNow(), "mod-cta");
    this.bigButton(bar, t("导入螺旋日程的历史"), () => p.importNautilus());
    const info = this.card(body, t("本机日志"), "");
    const paths = info.createDiv({ cls: "ad-pathlist" });
    for (const [id, a] of Object.entries(AGENTS)) {
      const r = paths.createDiv({ cls: "ad-pathrow" });
      agentIcon(r.createSpan({ cls: "ad-glyph", attr: { style: `color:${a.color}` } }), id);
      r.createSpan({ cls: "ad-pathrow__name", text: a.name });
      r.createSpan({ cls: "ad-pathrow__path", text: a.where[0] });
      r.createSpan({ cls: "ad-muted", text: p.agentEnabled(id) ? t("读") : t("不读") });
    }
    const errs = p.usage.errors || [];
    if (errs.length) {
      const e = this.card(body, t("读日志时遇到的问题"), "");
      for (const x of errs.slice(-6)) e.createDiv({ cls: "ad-error-line", text: `${x.path}: ${x.message}` });
    }
  }

  // ---------- Delegation ----------
  renderDelegate(body) {
    const p = this.plugin;
    const d = p.settings.delegate;
    const destinations = this.card(body, t("默认委派到"), "");
    const targetRow = destinations.createDiv({ cls: "ad-targetpick" });
    for (const id of AGENT_ORDER) {
      const a = AGENTS[id];
      const available = id !== "workbuddy" && !a.trackingOnly;
      const b = targetRow.createEl(available ? "button" : "div", { cls: "ad-target" + (available && d.target === id ? " is-on" : "") });
      if (available) b.setAttribute("aria-pressed", String(d.target === id));
      b.style.setProperty("--ad-agent", a.color);
      b.style.setProperty("--ad-agent-soft", a.soft);
      agentIcon(b.createSpan({ cls: "ad-glyph" }), id);
      b.createSpan({ text: a.name });
      b.createSpan({ cls: "ad-target__hint", text: a.trackingOnly ? t("暂不支持委派") : id === "workbuddy" ? t("客户端交接") : id === "claude" ? t("桌面版 / 后台") : id === "codex" ? t("桌面版 / 终端") : t("ACP / 自带账号") });
      if (available) b.onclick = async () => { d.target = id; await p.saveSettings(); this.display(); };
    }

    const mentions = this.card(body, t("任务行 Agent 补全"), t("输入触发符选择 Agent、模型和强度"));
    const suggestRow = this.row(mentions, t("输入时显示候选菜单"), "", null);
    this.toggle(suggestRow.querySelector(":scope > .ad-row__right"), d.mentionSuggest !== false, (v) => { d.mentionSuggest = v; p.saveSettings(); });
    const triggerRow = this.row(mentions, t("触发符号"), t("默认 @，前面需空格"), null);
    this.textInput(triggerRow.querySelector(":scope > .ad-row__right"), d.mentionTrigger || "@", "@", (v) => {
      const trigger = v.trim();
      if (!trigger || /[\s`\p{L}\p{N}]/u.test(trigger)) { new Notice(t("请填写不含空格、字母、数字或反引号的符号")); return; }
      d.mentionTrigger = trigger; p.saveSettings();
    });

    // Claude card
    const claude = this.card(body, "Claude Code", "");
    this.modelSelect(claude, "claude", d.claude.model, (v) => { this.setDefaultModel("claude", v); this.display(); });
    this.effortControl(claude, "claude", d.claude.effort, (v) => { d.claude.effort = v; p.saveSettings(); });
    const permRow = this.row(claude, t("权限模式"), t("plan：规划；auto：自动判断；acceptEdits：允许修改文件"), null);
    this.segmented(permRow.querySelector(":scope > .ad-row__right"), CLAUDE_PERMISSIONS, d.claude.permission, (v) => { d.claude.permission = v; p.saveSettings(); this.display(); });
    const cwdRow = this.row(claude, t("工作目录"), t("留空使用库根目录"), null);
    this.textInput(cwdRow.querySelector(":scope > .ad-row__right"), d.claude.cwd, t("留空 = 库根目录"), (v) => { d.claude.cwd = v.trim(); p.saveSettings(); }, "ad-input--wide");
    const addVault = this.row(claude, t("把当前库也加进可读目录"), "", null);
    this.toggle(addVault.querySelector(":scope > .ad-row__right"), d.claude.addVault !== false, (v) => { d.claude.addVault = v; p.saveSettings(); });
    const openDesk = this.row(claude, t("完成后自动在桌面版打开"), "", null);
    this.toggle(openDesk.querySelector(":scope > .ad-row__right"), d.claude.openDesktop === true, (v) => { d.claude.openDesktop = v; p.saveSettings(); });
    const bg = this.row(claude, t("使用 claude --bg 后台服务"), t("由 Claude 后台服务管理会话"), null);
    this.toggle(bg.querySelector(":scope > .ad-row__right"), d.claude.useBackground === true, (v) => { d.claude.useBackground = v; p.saveSettings(); });
    const trust = this.row(claude, t("库没被信任时自动换个目录"), t("使用已信任目录，并添加当前库的访问路径"), null);
    this.toggle(trust.querySelector(":scope > .ad-row__right"), d.claude.autoTrustedCwd !== false, (v) => { d.claude.autoTrustedCwd = v; p.saveSettings(); });
    const extra = this.row(claude, t("额外参数"), t("传给 Claude CLI 的参数"), null);
    this.textInput(extra.querySelector(":scope > .ad-row__right"), d.claude.extraArgs, t("可留空"), (v) => { d.claude.extraArgs = v; p.saveSettings(); }, "ad-input--wide");
    const test = claude.createDiv({ cls: "ad-btnrow" });
    this.bigButton(test, t("检查 claude"), async () => { const r = await p.checkBinary("claude"); new Notice(r, 6000); });
    this.bigButton(test, t("在终端里续这个目录"), () => p.openTerminalAt(d.claude.cwd || p.vaultPath, "claude"));

    const codex = this.card(body, "Codex", "");
    const transport = this.row(codex, t("派发到"), "", null);
    this.segmented(transport.querySelector(":scope > .ad-row__right"), [{ id: "desktop", label: t("Codex 桌面版") }, { id: "terminal", label: t("终端") }], d.codex.transport || "desktop", (v) => { d.codex.transport = v; p.saveSettings(); this.display(); });
    this.modelSelect(codex, "codex", d.codex.model, (v) => { this.setDefaultModel("codex", v); this.display(); });
    this.effortControl(codex, "codex", d.codex.effort, (v) => { d.codex.effort = v; p.saveSettings(); this.display(); });
    for (const [key, label, hint] of [["path", t("codex 程序路径"), t("桌面模式留空优先使用 Desktop 自带程序；终端模式从 PATH 查找")], ["cwd", t("工作目录"), t("留空 = 库根目录")]]) {
      const r = this.row(codex, label, hint, null);
      this.textInput(r.querySelector(":scope > .ad-row__right"), d.codex[key], hint, (v) => { d.codex[key] = v.trim(); p.saveSettings(); }, "ad-input--wide");
    }
    const sandbox = this.row(codex, t("沙箱模式"), t("read-only：只读；workspace-write：允许修改工作目录"), null);
    this.segmented(sandbox.querySelector(":scope > .ad-row__right"), ["read-only", "workspace-write"].map((id) => ({ id, label: id })), d.codex.sandbox, (v) => { d.codex.sandbox = v; p.saveSettings(); this.display(); });
    this.bigButton(codex.createDiv({ cls: "ad-btnrow" }), t("检查 codex"), async () => new Notice(await p.checkBinary("codex"), 6000));

    // DSH card
    const dsh = this.card(body, "DeepSeek Harness", "");
    this.modelSelect(dsh, "dsh", d.dsh.model, (v) => { this.setDefaultModel("dsh", v); this.display(); });
    this.effortControl(dsh, "dsh", d.dsh.effort, (v) => { d.dsh.effort = v; p.saveSettings(); });
    const route = this.row(dsh, t("自动允许工具调用"), t("关闭后逐次确认工具权限"), null);
    this.toggle(route.querySelector(":scope > .ad-row__right"), d.dsh.autoApprove === true, (v) => { d.dsh.autoApprove = v; p.saveSettings(); });
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

    for (const [id, card] of [["claude", claude], ["dsh", dsh]]) {
      const r = this.row(card, t("命令行路径"), t("留空自动查找"), null);
      this.textInput(r.querySelector(":scope > .ad-row__right"), d[id].path || "", t("自动查找"), (v) => { d[id].path = v.trim(); p.saveSettings(); }, "ad-input--wide");
    }

    const agy = this.card(body, "Antigravity ACP", t("安装 agy CLI 后运行 agy acp --login 登录"));
    this.modelSelect(agy, "antigravity", d.antigravity.model, (v) => { this.setDefaultModel("antigravity", v); this.display(); });
    this.effortControl(agy, "antigravity", d.antigravity.effort, (v) => { d.antigravity.effort = v; p.saveSettings(); });
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

    for (const id of ["workbuddy", "opencode", "qoder"]) {
      const card = this.card(body, AGENTS[id].name);
      this.row(card, t("委派方式"), "", id === "workbuddy" ? t("客户端交接") : t("暂不支持委派"));
    }

    // Prompt
    const prompt = this.card(body, t("提示词前后缀"), "");
    const pre = prompt.createDiv({ cls: "ad-field" });
    pre.createDiv({ cls: "ad-field__label", text: t("前缀") });
    const preTa = pre.createEl("textarea", { cls: "ad-textarea", attr: { placeholder: t("例如：先读一下相关文件，再动手。"), rows: "2" } });
    preTa.value = d.promptPrefix || "";
    preTa.onchange = () => { d.promptPrefix = preTa.value; p.saveSettings(); };
    const suf = prompt.createDiv({ cls: "ad-field" });
    suf.createDiv({ cls: "ad-field__label", text: t("后缀") });
    const sufTa = suf.createEl("textarea", { cls: "ad-textarea", attr: { placeholder: t("例如：做完把改动文件列出来。"), rows: "2" } });
    sufTa.value = d.promptSuffix || "";
    sufTa.onchange = () => { d.promptSuffix = sufTa.value; p.saveSettings(); };
    const rc = this.row(prompt, t("委派附加要求"), t("追加到每次委派消息末尾"), null);
    this.toggle(rc.querySelector(":scope > .ad-row__right"), d.confirmFirst !== false, (v) => { d.confirmFirst = v; p.saveSettings(); });
    const confirm = prompt.createDiv({ cls: "ad-field" });
    confirm.createDiv({ cls: "ad-field__label", text: t("附加要求正文（可自定义）") });
    const confirmTa = confirm.createEl("textarea", { cls: "ad-textarea", attr: { rows: "5" } });
    confirmTa.value = d.confirmFirstPrompt ?? DEFAULTS.delegate.confirmFirstPrompt;
    confirmTa.onchange = () => { d.confirmFirstPrompt = confirmTa.value; p.saveSettings(); };

    // Behaviour
    const beh = this.card(body, t("写回笔记"), "");
    const r1 = this.row(beh, t("把状态改成 DELEGATED"), "", null);
    this.toggle(r1.querySelector(":scope > .ad-row__right"), d.markStatus !== false, (v) => { d.markStatus = v; p.saveSettings(); });
    const r2 = this.row(beh, t("写 🔗 绑定行"), t("删除绑定行可解除关联"), null);
    this.toggle(r2.querySelector(":scope > .ad-row__right"), d.writeLink !== false, (v) => { d.writeLink = v; p.saveSettings(); });
    const r3 = this.row(beh, t("完成后写 💬 结论"), "", null);
    this.toggle(r3.querySelector(":scope > .ad-row__right"), p.settings.autoWriteResult !== false, (v) => { p.settings.autoWriteResult = v; p.saveSettings(); });
    const r4 = this.row(beh, t("💬 最多多少个字"), "", null);
    this.numberInput(r4.querySelector(":scope > .ad-row__right"), p.settings.resultMax || 240, 40, 2000, (v) => { p.settings.resultMax = v; p.saveSettings(); });
  }

  setDefaultModel(agent, value) {
    const s = this.plugin.settings;
    s.delegate[agent].model = value;
    s.models.defaultByAgent[agent] = value;
    if (!s.models.enabled.includes(value)) s.models.enabled.push(value);
    if (this.draft) { this.draft.defaultByAgent[agent] = value; if (!this.draft.enabled.includes(value)) this.draft.enabled.push(value); }
    return this.plugin.saveSettings();
  }

  modelSelect(parent, agent, value, onChange) {
    const row = this.row(parent, t("模型"), "", null);
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
      const lab = wrap.createEl("span", { cls: "ad-effort__lab", attr: { style: `left:${(i / Math.max(1, opts.length - 1)) * 100}%` }, text: o.label });
    });
  }

  // ---------- Models ----------
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
    this.toggle(enabled.querySelector(":scope > .ad-row__right"), c.enabled, v => { c.enabled = v; p.saveSettings(); });
    const target = this.row(shared, t("共享文件路径"), t("绝对路径，支持 ~/"), null);
    this.textInput(target.querySelector(":scope > .ad-row__right"), c.path, "/Users/me/shared-agent-memory/memory.md", v => { try { c.path = v.trim() ? externalMemoryPath(v) : ""; p.saveSettings(); } catch (e) { new Notice(e.message); } }, "ad-input--wide");
    const interval = this.row(shared, t("定期同步间隔（小时）"), t("1–168 小时"), null);
    this.numberInput(interval.querySelector(":scope > .ad-row__right"), c.intervalHours, 1, 168, v => { c.intervalHours = v; p.saveSettings(); });
    const git = this.row(shared, t("同步后提交并推送 Git"), t("共享文件需位于 Git 仓库中；推送到 origin 当前分支"), null);
    this.toggle(git.querySelector(":scope > .ad-row__right"), c.gitPush, v => { c.gitPush = v; p.saveSettings(); });
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
      meter.hidden = !d.busy; // Indeterminate: model completion time cannot be measured.
      syncNow.disabled = sharing.busy || d.busy;
      syncNow.textContent = sharing.busy ? t("共享同步中…") : t("立即同步共享记忆");
      sharedStatus.textContent = [sharing.status || (c.lastError ? t("上次共享失败：{error}", { error: c.lastError }) : ""), c.lastSuccess ? t("上次同步成功：{time}", { time: new Date(c.lastSuccess).toLocaleString() }) : t("尚未同步")].filter(Boolean).join(t("；"));
    };
    update();
    this._dreamTimer = setInterval(update, 1000);
  }

  modelsDraft() {
    if (!this.draft) this.draft = JSON.parse(JSON.stringify(this.plugin.settings.models));
    if (!this.draft.enabled) this.draft.enabled = [];
    if (!this.draft.pinned) this.draft.pinned = [];
    if (!this.draft.order) this.draft.order = [];
    if (!this.draft.custom) this.draft.custom = [];
    if (!this.draft.defaultByAgent) this.draft.defaultByAgent = { claude: "claude-opus-5-5", dsh: "deepseek-v4-pro" };
    return this.draft;
  }

  renderModels(body) {
    const p = this.plugin;
    if (syncModelGroups(p.settings, agent => p.agentEnabled(agent))) p.saveSettings();
    const d = this.modelsDraft();
    const target = this.modelTarget || p.defaultTarget();
    const models = p.allModels(d.custom);
    const enabled = new Set(d.enabled);
    const byId = new Map(models.map((m) => [m.id, m]));
    const defaultId = d.defaultByAgent[target] || p.defaultModel(target);
    const def = byId.get(defaultId) || models.find((m) => m.agent === target) || models[0];

    const intro = body.createDiv({ cls: "ad-models-intro" });
    intro.createDiv({ cls: "ad-models-title", text: "Models" });
    intro.createDiv({ cls: "ad-models-sub", text: t("管理可选模型、默认模型和推理强度") });

    // Defaults
    const defaults = body.createDiv({ cls: "ad-models-card" });
    const dhead = defaults.createDiv({ cls: "ad-models-sec" });
    dhead.createSpan({ cls: "ad-kicker", text: t("默认设置") });
    const targetSeg = defaults.createDiv({ cls: "ad-models-target" });
    for (const id of AGENT_ORDER) {
      const a = AGENTS[id];
      const b = targetSeg.createEl("button", { cls: "ad-target ad-target--sm" + (target === id ? " is-on" : ""), attr: { "aria-pressed": String(target === id) } });
      b.style.setProperty("--ad-agent", a.color);
      b.style.setProperty("--ad-agent-soft", a.soft);
      agentIcon(b.createSpan({ cls: "ad-glyph" }), id);
      b.createSpan({ text: a.short });
      b.onclick = () => { this.modelTarget = id; this.display(); };
    }
    if (target === "workbuddy" || AGENTS[target]?.trackingOnly) {
      this.row(defaults, t("模型"), "", t("在客户端选择模型"));
    } else {
      const defRow = defaults.createDiv({ cls: "ad-defrow" });
      const defLeft = defRow.createDiv({ cls: "ad-defrow__left" });
      defLeft.createDiv({ cls: "ad-defrow__name", text: t("默认模型") });
      const defRight = defRow.createDiv({ cls: "ad-defrow__right" });
      const pill = defRight.createEl("select", { cls: "ad-modelpill" });
      const candidates = models.filter((m) => m.agent === target && (enabled.has(m.id) || m.id === defaultId));
      const pool = candidates.length ? candidates : models.filter((m) => m.agent === target);
      for (const m of pool) {
        const o = pill.createEl("option", { text: m.name, attr: { value: m.id } });
        if (m.id === def.id) o.selected = true;
      }
      pill.onchange = () => { d.defaultByAgent[target] = pill.value; if (!d.enabled.includes(pill.value)) d.enabled.push(pill.value); this.display(); };
      if (def) {
        const meta = defaults.createDiv({ cls: "ad-modelmeta" });
        meta.createSpan({ text: def.context });
        meta.createSpan({ cls: "ad-dot", text: "·" });
        meta.createSpan({ text: strength(def.strength) });
        meta.createSpan({ cls: "ad-dot", text: "·" });
        for (const tag of def.tags || []) meta.createSpan({ cls: "ad-cap", text: tag });
        if (def.cost) meta.createSpan({ cls: "ad-cost", text: def.cost });
      }

      // Effort
      const eff = defaults.createDiv({ cls: "ad-defrow ad-defrow--effort" });
      const effLeft = eff.createDiv({ cls: "ad-defrow__left" });
      effLeft.createDiv({ cls: "ad-defrow__name", text: t("默认强度") });
      const effRight = eff.createDiv({ cls: "ad-defrow__right ad-effort ad-effort--big" });
      const eopts = EFFORTS[target] || EFFORTS.claude;
      const evalue = d.effortByAgent?.[target] || p.settings.delegate[target]?.effort || d.effort || "high";
      const eidx = Math.max(0, eopts.findIndex((x) => x.id === evalue));
      const etrack = effRight.createDiv({ cls: "ad-effort__track" });
      etrack.createDiv({ cls: "ad-effort__fill" }).style.width = `${(eidx / Math.max(1, eopts.length - 1)) * 100}%`;
      const estops = etrack.createDiv({ cls: "ad-effort__stops" });
      eopts.forEach((o, i) => {
        const b = estops.createEl("button", { cls: "ad-effort__stop" + (o.id === evalue ? " is-on" : ""), attr: { "aria-label": o.label, "aria-pressed": String(o.id === evalue) } });
        b.createSpan({ cls: "ad-effort__dot" });
        b.onclick = () => { (d.effortByAgent ||= {})[target] = o.id; this.display(); };
        const lab = effRight.createSpan({ cls: "ad-effort__lab", attr: { style: `left:${(i / Math.max(1, eopts.length - 1)) * 100}%` }, text: o.label });
      });
      const rec = effRight.createDiv({ cls: "ad-effort__rec" });
      const adv = rec.createEl("select", { cls: "ad-advselect" });
      for (const o of eopts) adv.createEl("option", { text: o.label, attr: { value: o.id } });
      adv.value = evalue;
      adv.onchange = () => { (d.effortByAgent ||= {})[target] = adv.value; this.display(); };
    }

    // Model picker
    const picker = body.createDiv({ cls: "ad-models-card" });
    const phead = picker.createDiv({ cls: "ad-models-sec" });
    phead.createSpan({ cls: "ad-kicker", text: t("可用模型") });
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
    let visible = models.filter((m) => {
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
      for (const m of rows) this.modelRow(g, m, d, target, defaultId, d.pinned.includes(m.id));
    }
    if (!pinned.length && !rest.length) {
      list.createDiv({ cls: "ad-empty ad-empty--small", text: t("没有符合条件的模型") });
    }
  }

  groupAction(head, rows, d, pinned) {
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

  modelRow(parent, m, d, target, defaultId, pinned) {
    const on = d.enabled.includes(m.id);
    const row = parent.createDiv({ cls: "ad-modelrow" + (on ? "" : " is-off") });
    row.tabIndex = 0;
    row.dataset.id = m.id;
    const left = row.createDiv({ cls: "ad-modelrow__left" });
    const name = left.createDiv({ cls: "ad-modelrow__name" });
    name.createSpan({ text: m.name });
    if (pinned) name.createSpan({ cls: "ad-badge ad-badge--soft", text: t("置顶") });
    if (m.id === defaultId) name.createSpan({ cls: "ad-badge", text: t("默认") });
    if (m.agent === target) name.createSpan({ cls: "ad-badge ad-badge--soft", text: AGENTS[m.agent].short });
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
      menu.addItem((it) => it.setTitle(t("设为默认模型")).setIcon("star").onClick(() => { d.defaultByAgent[m.agent] = m.id; if (!d.enabled.includes(m.id)) d.enabled.push(m.id); this.display(); }));
      if ((m.custom || d.custom.some((x) => x.id === m.id))) {
        menu.addItem((it) => it.setTitle(t("编辑模型")).setIcon("pencil").onClick(() => {
          new AddModelModal(this.app, this.plugin, (edited) => { d.custom = d.custom.map((x) => x.id === m.id ? edited : x); this.display(); }, m).open();
        }));
        menu.addItem((it) => it.setTitle(t("移除")).setIcon("trash").onClick(() => {
          d.custom = d.custom.filter((x) => x.id !== m.id);
          d.enabled = d.enabled.filter((x) => x !== m.id);
          d.pinned = d.pinned.filter((x) => x !== m.id);
          if (d.defaultByAgent[m.agent] === m.id) d.defaultByAgent[m.agent] = DEFAULTS.models.defaultByAgent[m.agent];
          this.display();
        }));
      }
      const ev = e;
      menu.showAtMouseEvent(ev);
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
    const p = this.plugin;
    if (!this.draft) return;
    const a = JSON.stringify(this.draft);
    const b = JSON.stringify(p.settings.models);
    if (a === b) return;
    const bar = document.createElement("div");
    bar.className = "ad-draftbar ad-draftbar--inline";
    bar.createSpan({ cls: "ad-draftbar__text", text: t("未保存的更改") });
    const discard = bar.createEl("button", { cls: "ad-btn ad-btn--ghost", text: t("放弃更改") });
    discard.onclick = () => { this.draft = JSON.parse(JSON.stringify(p.settings.models)); this.display(); };
    const save = bar.createEl("button", { cls: "ad-btn ad-btn--cta", text: t("保存 ⌘S") });
    save.onclick = () => this.saveDraft();
    if (this._draftBar) { try { this._draftBar.remove(); } catch { /* gone */ } }
    this._draftBar = bar;
    (parent || this.containerEl).prepend(bar);
    if (!this._draftKeyHandler) {
      this._draftKeyHandler = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); this.saveDraft(); } };
      this.app.scope.register(["Mod"], "s", (e) => { if (this.tab === "models") { e.preventDefault(); this.saveDraft(); } });
    }
  }

  saveDraft() {
    if (!this.draft) return;
    const p = this.plugin;
    p.settings.models = deepMerge(p.settings.models, this.draft);
    for (const agent of ["claude", "codex", "dsh", "antigravity"]) {
      const model = p.settings.models.defaultByAgent[agent];
      if (model) p.settings.delegate[agent].model = model;
      const effort = p.settings.models.effortByAgent?.[agent];
      if (effort) p.settings.delegate[agent].effort = effort;
    }
    p.saveSettings();
    new Notice(t("Models 已保存"));
    this.display();
  }

  // ---------- Tracking ----------
  renderTracking(body) {
    const p = this.plugin;
    const s = p.settings;
    const c = this.card(body, t("时间与扫描"));
    const r1 = this.row(c, t("日记日期分界"), t("此时刻之前计入前一天"), null);
    const cut = this.numberInput(r1.querySelector(":scope > .ad-row__right"), s.dayCutoff, 0, 12, (v) => { s.dayCutoff = v; p.saveSettings(); p.scheduleScan(); });
    const r2 = this.row(c, t("扫描间隔（秒）"), "", null);
    this.numberInput(r2.querySelector(":scope > .ad-row__right"), s.pollSeconds, 5, 300, (v) => { s.pollSeconds = v; p.saveSettings(); p.scheduleScan(); });
    const r4 = this.row(c, t("主力读多少天历史"), t("非主力读取当天会话"), null);
    this.numberInput(r4.querySelector(":scope > .ad-row__right"), s.fullHistoryDays, 1, 365, (v) => { s.fullHistoryDays = v; p.saveSettings(); p.scanNow(true); });

    const layoutCard = this.card(body, t("整理日志模板"), t("设置笔记分区的标题和顺序"));
    const suggest = this.row(layoutCard, t("日志杂乱时提醒整理"), t("每新增 4 条记录提醒，每天最多 2 次"), null);
    this.toggle(suggest.querySelector(":scope > .ad-row__right"), s.organizeJournalSuggest !== false, (v) => { s.organizeJournalSuggest = v; p.saveSettings(); });
    const templateRow = this.row(layoutCard, t("整理模板"), "", null);
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
      const orderRow = this.row(layoutCard, t("分区顺序"), "", null);
      const order = orderRow.querySelector(":scope > .ad-row__right").createEl("select", { cls: "ad-select" });
      for (const keys of [["done", "active", "notes"], ["active", "done", "notes"], ["notes", "done", "active"], ["notes", "active", "done"], ["done", "notes", "active"], ["active", "notes", "done"]]) order.createEl("option", { text: keys.map(key => names[key]).join(" → "), attr: { value: keys.join(",") } });
      order.value = s.journalLayout.order.join(",");
      order.onchange = () => { s.journalLayout = journalLayout({ ...s.journalLayout, order: order.value.split(",") }); p.saveSettings(); };
      for (const key of JOURNAL_LAYOUT_DEFAULT.order) {
        const row = this.row(layoutCard, t("{section}标题", { section: names[key] }), key === "notes" ? t("留空不添加标题") : "", null);
        const input = this.textInput(row.querySelector(":scope > .ad-row__right"), s.journalLayout.titles[key], names[key], (value) => {
          try { s.journalLayout = journalLayout({ ...s.journalLayout, titles: { ...s.journalLayout.titles, [key]: value } }); p.saveSettings(); }
          catch (error) { input.value = s.journalLayout.titles[key]; new Notice(error.message); }
        });
      }
    }
    this.bigButton(layoutCard.createDiv({ cls: "ad-btnrow" }), t("恢复默认整理模板"), () => { s.journalLayout = null; s.journalLayoutLanguage = "auto"; p.saveSettings(); this.display(); });

    const desk = this.card(body, t("Claude 桌面版"), "");
    const d1 = this.row(desk, t("识别 side chat 和母子关系"), "", null);
    this.toggle(d1.querySelector(":scope > .ad-row__right"), s.claudeDesktop !== false, (v) => { s.claudeDesktop = v; p.saveSettings(); p.scanNow(true); });
    const terminal = this.card(body, t("终端与会话跳转"));
    const dc = this.row(terminal, t("终端会话打开方式"), "", null);
    this.segmented(dc.querySelector(":scope > .ad-row__right"), [{ id: "terminal", label: t("终端") }, { id: "desktop", label: t("桌面版") }], s.cliOpen === "desktop" ? "desktop" : "terminal", (v) => { s.cliOpen = v; p.saveSettings(); this.display(); });
    const dt = this.row(terminal, t("主力终端"), t("用于终端委派和恢复会话"), null);
    this.segmented(dt.querySelector(":scope > .ad-row__right"), [{ id: "auto", label: t("自动") }, { id: "terminal", label: t("系统终端") }, { id: "iterm", label: "iTerm2" }, { id: "warp", label: "Warp" }, { id: "tern", label: "Tern" }, { id: "herdr", label: "Herdr" }], s.cliTerminal || "auto", (v) => { s.cliTerminal = v; p.saveSettings(); this.display(); });
    const dd = this.row(terminal, t("默认在终端委派"), t("适用于 Claude Code 和 Codex"), null);
    this.toggle(dd.querySelector(":scope > .ad-row__right"), !!s.delegateInTerminal, (v) => { s.delegateInTerminal = v; p.saveSettings(); p.refreshUI(); });
    const visibility = this.card(body, t("会话展示与进度"));
    const dn = this.row(visibility, t("使用螺旋日程的进度显示"), "", null);
    this.toggle(dn.querySelector(":scope > .ad-row__right"), s.yieldToNautilus !== false, (v) => { s.yieldToNautilus = v; p.saveSettings(); p.refreshUI(); });
    const d2 = this.row(visibility, t("归档的会话不再列出"), "", null);
    this.toggle(d2.querySelector(":scope > .ad-row__right"), s.hideArchived !== false, (v) => { s.hideArchived = v; p.saveSettings(); p.refreshUI(); });

    let jr = this.card(body, t("自动记日记（人机共写）"), t("将会话记录写入今天的日记"));
    const master = this.row(jr, t("启用日记写入"), "", null);
    this.toggle(master.querySelector(":scope > .ad-row__right"), s.journalAutoWrite !== false, (v) => { s.journalAutoWrite = v; p.saveSettings(); });
    const det = detectJournalFormat(this.app, s);
    const jf = this.row(jr, t("日记目录"), t("当前：{folder}；今天：{path}", { folder: det.folder || t("库根目录"), source: det.folderSource, path: journalPath(this.app, s) }), null);
    this.textInput(jf.querySelector(":scope > .ad-row__right"), s.journalFolder || "", t("自动：{folder}", { folder: det.folder || t("库根目录") }), (v) => { s.journalFolder = v.trim(); p.saveSettings(); this.display(); });
    const jfmt = this.row(jr, t("日记文件名格式"), t("例如 YYYY-MM-DD；当前：{format}", { format: det.format, source: det.source }), null);
    this.textInput(jfmt.querySelector(":scope > .ad-row__right"), s.journalFormat || "", t("自动：{format}", { format: det.format }), (v) => { s.journalFormat = v.trim(); p.saveSettings(); this.display(); });
    const ja = this.row(jr, t("自动整理进日记"), "", null);
    this.toggle(ja.querySelector(":scope > .ad-row__right"), s.autoLog === true, (v) => { s.autoLog = v; p.saveSettings(); });
    jr = this.card(body, t("记录内容与显示"));
    const grain = this.row(jr, t("自动记录颗粒度"), t("选择记录的时机"), null);
    this.segmented(grain.querySelector(":scope > .ad-row__right"), [{id:"latest",label:t("最新进展")},{id:"round",label:t("每轮记录")},{id:"paused",label:t("停歇或归档")}], s.autoLogGranularity || DEFAULTS.autoLogGranularity, (v) => { s.autoLogGranularity=v; p.saveSettings(); this.display(); });
    const rmode = this.row(jr, t("AI 记录显示方式"), t("控制笔记中默认展开的记录"), null);
    this.segmented(rmode.querySelector(":scope > .ad-row__right"), [
      { id: "collapsed", label: t("默认折叠") },
      { id: "expanded", label: t("默认展开") },
      { id: "latest5", label: t("最新五条") },
      { id: "latest3", label: t("最新三条") },
      { id: "latest1", label: t("最新一条") },
    ], s.aiRecordDisplay || DEFAULTS.aiRecordDisplay, (v) => { s.aiRecordDisplay = v; p.saveSettings(); p.refreshUI(); this.display(); });
    jr = this.card(body, t("归档与累计总结"));
    const archive = this.row(jr, t("默认归档位置"), t("库内 Markdown 路径"), null);
    this.textInput(archive.querySelector(":scope > .ad-row__right"), s.doneArchivePath, DEFAULTS.doneArchivePath, v => { try { s.doneArchivePath = archivePath(v); p.saveSettings(); } catch (e) { new Notice(e.message); } }, "ad-input--wide");
    const order = this.row(jr, t("归档顺序"), "", null);
    this.segmented(order.querySelector(":scope > .ad-row__right"), [{ id: "prepend", label: t("插到开头") }, { id: "append", label: t("追加到末尾") }], s.archiveOrder || "prepend", (v) => { s.archiveOrder = v; p.saveSettings(); });
    const merge = this.row(jr, t("累积后自动合并总结"), "", null);
    this.toggle(merge.querySelector(":scope > .ad-row__right"), !!s.autoLogMerge, (v) => { s.autoLogMerge=v; p.saveSettings(); this.display(); });
    const mergeN = this.row(jr, t("累积多少条结论后合并"), t("至少 2 条"), null);
    this.numberInput(mergeN.querySelector(":scope > .ad-row__right"), s.autoLogMergeThreshold || 10, 2, 100, (v) => { s.autoLogMergeThreshold=Math.round(v); p.saveSettings(); });
    jr = this.card(body, t("记录详细程度"));
    const jdetail = this.row(jr, t("自动日志详细程度"), "", null);
    const detailDesc = jdetail.querySelector(":scope > .ad-row__left");
    detailDesc.createDiv({ cls: "ad-row__desc", text: t("简略：任务和结论合成一段") });
    detailDesc.createDiv({ cls: "ad-row__desc", text: t("标准：提问、回答各一句") });
    detailDesc.createDiv({ cls: "ad-row__desc", text: t("详细：保留提问、回复摘录和步骤") });
    this.segmented(jdetail.querySelector(":scope > .ad-row__right"), [{ id: "brief", label: t("简略（默认）") }, { id: "standard", label: t("标准") }, { id: "detailed", label: t("详细") }], s.autoLogDetail || "brief", (v) => { changeLogDetail(s, v); p.saveSettings(); this.display(); });
    jr = this.card(body, t("自动整理频率"));
    const je = this.row(jr, t("整理间隔（分钟）"), t("至少 5 分钟"), null);
    this.numberInput(je.querySelector(":scope > .ad-row__right"), s.autoLogEvery || 20, 5, 240, (v) => { s.autoLogEvery = v; p.saveSettings(); });
    const jst = this.row(jr, t("首次整理延迟（分钟）"), "", null);
    this.numberInput(jst.querySelector(":scope > .ad-row__right"), s.autoLogStartDelay ?? 1, 1, 240, (v) => { s.autoLogStartDelay = v; p.saveSettings(); });
    const jmin = this.row(jr, t("最短记录时长（分钟）"), t("0 表示立即记录"), null);
    this.numberInput(jmin.querySelector(":scope > .ad-row__right"), s.autoLogMinMinutes ?? 3, 0, 120, (v) => { s.autoLogMinMinutes = v; p.saveSettings(); });
    const jid = this.row(jr, t("暂停判定（分钟）"), t("至少 5 分钟"), null);
    this.numberInput(jid.querySelector(":scope > .ad-row__right"), s.autoLogIdle || 10, 5, 480, (v) => { s.autoLogIdle = v; p.saveSettings(); });
    const jag = this.row(jr, t("记哪几个 Agent"), t("选择自动建项的 Agent"), null);
    const agBox = jag.querySelector(":scope > .ad-row__right").createDiv({ cls: "ad-seg ad-seg--many" });
    const agOn = (s.autoLogAgents ||= {});
    for (const id of AGENT_ORDER) {
      const b = agBox.createEl("button", { cls: "ad-seg__btn" + (agOn[id] !== false ? " is-on" : ""), text: AGENTS[id]?.short || id, attr: { "aria-pressed": String(agOn[id] !== false) } });
      b.onclick = () => { agOn[id] = agOn[id] === false; b.classList.toggle("is-on", agOn[id] !== false); b.setAttribute("aria-pressed", String(agOn[id] !== false)); p.saveSettings(); };
    }
    const jb = this.row(jr, t("每批会话数"), "", null);
    this.numberInput(jb.querySelector(":scope > .ad-row__right"), s.autoLogBatch || 8, 1, 20, (v) => { s.autoLogBatch = v; p.saveSettings(); });
    jr = this.card(body, t("AI 整理模型"));
    const jprovider = this.row(jr, t("整理使用的 CLI"), "", null);
    this.segmented(jprovider.querySelector(":scope > .ad-row__right"), [{ id: "claude", label: "Claude CLI" }, { id: "codex", label: "Codex CLI" }], s.autoLogProvider || "claude", (v) => {
      s.autoLogProvider = v; s.autoLogModel = v === "codex" ? "gpt-6-luna" : "haiku"; s.roundPolishModel = ""; s.autoLogPath = ""; p.saveSettings(); this.display();
    });
    if (s.autoLogProvider === "codex") {
      const effort = this.row(jr, t("整理与润色的推理强度"), "", null);
      this.segmented(effort.querySelector(":scope > .ad-row__right"), EFFORTS.codex, s.autoLogEffort || "low", (v) => { s.autoLogEffort = v; p.saveSettings(); this.display(); });
    }
    const jm = this.row(jr, t("整理用的模型"), t("填写模型名或别名"), null);
    this.textInput(jm.querySelector(":scope > .ad-row__right"), s.autoLogModel || "", s.autoLogProvider === "codex" ? "gpt-6-luna" : "haiku", (v) => { s.autoLogModel = v.trim(); p.saveSettings(); });
    const jt = this.row(jr, t("整理超时（秒）"), "", null);
    this.numberInput(jt.querySelector(":scope > .ad-row__right"), s.autoLogTimeout || 120, 10, 600, (v) => { s.autoLogTimeout = v; p.saveSettings(); });
    const jfb = this.row(jr, t("整理失败时使用会话标题"), "", null);
    this.toggle(jfb.querySelector(":scope > .ad-row__right"), s.autoLogFallback !== false, (v) => { s.autoLogFallback = v; p.saveSettings(); });
    const jp = this.row(jr, t("整理 CLI 路径"), t("留空使用委派设置中的路径"), null);
    this.textInput(jp.querySelector(":scope > .ad-row__right"), s.autoLogPath || "", t("自动找"), (v) => { s.autoLogPath = v.trim(); p.saveSettings(); }, "ad-input--wide");
    const jrp = this.row(jr, t("每轮结论让模型润色"), t("适用于简略和标准记录"), null);
    this.toggle(jrp.querySelector(":scope > .ad-row__right"), s.roundPolish !== false, (v) => { s.roundPolish = v; p.saveSettings(); });
    const jrm = this.row(jr, t("润色用的模型"), t("留空沿用整理模型"), null);
    this.textInput(jrm.querySelector(":scope > .ad-row__right"), s.roundPolishModel || "", t("同整理用的模型"), (v) => { s.roundPolishModel = v.trim(); p.saveSettings(); });
    const jrt = this.row(jr, t("润色超时（秒）"), "", null);
    this.numberInput(jrt.querySelector(":scope > .ad-row__right"), s.roundPolishTimeout || 30, 5, 300, (v) => { s.roundPolishTimeout = v; p.saveSettings(); });
    jr = this.card(body, t("状态与结论回写"));
    const jd = this.row(jr, t("归档的会话记成 DONE"), "", null);
    this.toggle(jd.querySelector(":scope > .ad-row__right"), s.autoLogArchiveDone !== false, (v) => { s.autoLogArchiveDone = v; p.saveSettings(); });
    const jn = this.row(jr, t("整理完弹通知"), "", null);
    this.toggle(jn.querySelector(":scope > .ad-row__right"), s.autoLogNotify !== false, (v) => { s.autoLogNotify = v; p.saveSettings(); });
    const js = this.row(jr, t("回写日记"), t("更新已绑定任务的状态与结论"), null);
    this.toggle(js.querySelector(":scope > .ad-row__right"), s.journalSync !== false, (v) => { s.journalSync = v; p.saveSettings(); });
    for (const [key, label, desc] of [
      ["resultBack", t("会话结论写回（💬）"), ""],
      ["agentKw", t("状态关键词跟着会话"), ""],
      ["autoLogKw", t("自动记的条目也跟着切状态"), ""],
      ["kidBlocks", t("子会话和 side chat 子块"), ""],
    ]) {
      const row = this.row(jr, label, desc, null);
      this.toggle(row.querySelector(":scope > .ad-row__right"), s[key] !== false, (v) => { s[key] = v; p.saveSettings(); });
    }
    const jbtn = jr.createDiv({ cls: "ad-btnrow" });
    this.bigButton(jbtn, t("现在整理一次"), () => p.autoLog.logNow());

    let ui = this.card(body, t("macOS 菜单栏"));
    const mb = this.row(ui, t("macOS 菜单栏"), "", null);
    // 菜单栏里点「隐藏」、助手起不来时，插件用 mbSwitch.setOn 把这里拨回去
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

    const mbbtn = this.row(ui, t("菜单栏助手"), "", null);
    const mbrestart = mbbtn.querySelector(":scope > .ad-row__right").createEl("button", { cls: "ad-btn", text: t("重启菜单栏") });
    mbrestart.onclick = () => p.menubar?.restart();
    ui = this.card(body, t("面板与编辑器"));
    this.row(ui, t("跳转到正在运行的项目"), t("默认 Ctrl+Alt+J"), "⌃⌥J");
    const nautRow = this.row(ui, t("关闭螺旋日程右下角的 Agent 汇总"), "", null);
    this.toggle(nautRow.querySelector(":scope > .ad-row__right"), s.menuBarHideNautilus !== false, (v) => { s.menuBarHideNautilus = v; p.saveSettings(); if (v) p.hideNautilusAgentBar().catch(() => {}); else p.restoreNautilusAgentBar().catch(() => {}); });
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

    const data = this.card(body, t("数据"), "");
    const btn = data.createDiv({ cls: "ad-btnrow" });
    this.bigButton(btn, t("重新启动菜单栏助手"), () => p.menubar?.restart());
    this.bigButton(btn, t("重新计算全部历史"), () => p.rebuildUsage(), "mod-warning");
    this.bigButton(btn, t("打开插件目录"), () => p.openPluginDir());
    this.bigButton(btn, t("导入螺旋日程的历史"), () => p.importNautilus());
    const stats = data.createDiv({ cls: "ad-statline" });
    const days = Object.keys(p.store.days).length;
    stats.createSpan({ text: t("{n} 天记录", { n: days }) });
    stats.createSpan({ cls: "ad-dot", text: "·" });
    stats.createSpan({ text: t("{n} 个会话索引", { n: p.usage.meta.size }) });
    stats.createSpan({ cls: "ad-dot", text: "·" });
    stats.createSpan({ text: t("{n} 个日志文件", { n: p.usage.files.size }) });

    const naut = this.card(body, t("和螺旋日程并存"), "");
    const nbtn = naut.createDiv({ cls: "ad-btnrow" });
    this.bigButton(nbtn, t("停用螺旋日程里的 AI 写入"), () => p.pauseNautilus(), "mod-warning");


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
      [t("保存工作记录"), t("在「追踪」中开启自动记录，在 Dreaming 中整理记忆")],
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
      for (const id of ["claude", "codex", "dsh", "antigravity"]) s.createEl("option", { text: AGENTS[id].name, attr: { value: id } });
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
