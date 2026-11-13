// Agent Deck — settings, including the layered Models page.

import { archivePath } from "./journal-archive.js";
import { App, PluginSettingTab, Notice, Modal, Menu } from "obsidian";
import {
  AGENTS, AGENT_ORDER, EFFORTS, CLAUDE_PERMISSIONS, DEFAULTS, fmtTok, deepMerge, journalPath, detectJournalFormat,
} from "./constants.js";
import { notePath, companionInstalled } from "./dream.js";
import { externalMemoryPath } from "./dream-sharing.js";
import { agentIcon, setLucide } from "./icons.js";
import { t } from "./i18n.js";

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
    const box = parent.createDiv({ cls: "ad-seg " + cls });
    for (const opt of options) {
      const b = box.createEl("button", { cls: "ad-seg__btn" + (opt.id === value ? " is-on" : ""), text: opt.label });
      b.title = opt.hint || "";
      b.onclick = () => onChange(opt.id);
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
    this.card(body, t("要追踪的 Agent"), t("主力最多两个：它们的全部历史都会读；其余开着的只读今天有动静的会话。"));
    const grid = body.createDiv({ cls: "ad-set-agents" });
    for (const id of AGENT_ORDER) {
      const a = AGENTS[id];
      const enabled = p.agentEnabled(id);
      const primary = p.isPrimary(id);
      const card = grid.createDiv({ cls: `ad-agentcard is-set ${enabled ? "" : "is-off"} ${primary ? "is-primary" : ""}` });
      card.style.setProperty("--ad-agent", a.color);
      card.style.setProperty("--ad-agent-soft", a.soft);
      const top = card.createDiv({ cls: "ad-agentcard__top" });
      const mark = top.createDiv({ cls: "ad-agentcard__mark" });
      agentIcon(mark.createSpan({ cls: "ad-glyph" }), id);
      const nm = top.createDiv({ cls: "ad-agentcard__name" });
      nm.createDiv({ cls: "ad-agentcard__title", text: a.name });
      nm.createDiv({ cls: "ad-agentcard__where", text: a.where[1] });
      const star = top.createEl("button", { cls: "ad-star" + (primary ? " is-on" : "") });
      setLucide(star, primary ? "star" : "star-off");
      star.title = primary ? t("取消主力") : t("设为主力（最多两个）");
      star.onclick = () => p.togglePrimary(id);
      const stats = card.createDiv({ cls: "ad-agentcard__stats" });
      const meta = p.usage.meta;
      const sessions = [...meta.values()].filter((x) => x.agent === id);
      stats.createSpan({ text: t("{n} 个会话", { n: sessions.length }) });
      stats.createSpan({ cls: "ad-dot", text: "·" });
      stats.createSpan({ text: fmtTok(sessions.reduce((n, x) => n + (x.out || 0), 0)) + " tok" });
      const foot = card.createDiv({ cls: "ad-agentcard__foot" });
      const state = p.agentEnabled(id) ? t("追踪中") : t("已关闭");
      this.toggle(foot, enabled, (v) => p.setAgentEnabled(id, v), primary);
      foot.createSpan({ cls: "ad-muted", text: primary ? t("主力（全量）") : state });
      if (["claude", "codex", "dsh", "antigravity"].includes(id)) {
        this.modelSelect(card, id, p.defaultModel(id), (value) => { this.setDefaultModel(id, value); this.display(); });
        const main = card.createDiv({ cls: "ad-btnrow" });
        this.bigButton(main, p.defaultTarget() === id ? t("默认委派到这里") : t("设为默认委派 Agent"), () => { s.delegate.target = id; p.saveSettings(); this.display(); });
      }
      const path = card.createDiv({ cls: "ad-set-path", text: a.where[0] });
    }
    const bar = body.createDiv({ cls: "ad-btnrow" });
    this.bigButton(bar, t("立即扫描"), () => p.scanNow(true), "mod-cta");
    this.bigButton(bar, t("导入螺旋日程的历史"), () => p.importNautilus());
    const info = this.card(body, t("本机日志"), t("只读，不上传。DeepSeek Harness 的会话是 zstd 压缩的 JSONL，插件内置了解压器。"));
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
      const e = this.card(body, t("读日志时遇到的问题"), t("通常是一个正在写的半截文件，下一轮会自己好。"));
      for (const x of errs.slice(-6)) e.createDiv({ cls: "ad-error-line", text: `${x.path}: ${x.message}` });
    }
  }

  // ---------- Delegation ----------
  renderDelegate(body) {
    const p = this.plugin;
    const d = p.settings.delegate;
    this.card(body, t("默认委派到"), t("Claude Code / DeepSeek Harness / Antigravity ACP 在后台开会话；Codex 在终端里开交互式会话。委派失败时点状态 pill 上的「重试」可以临时改参数。"));
    const targetRow = body.createDiv({ cls: "ad-targetpick" });
    for (const id of ["claude", "codex", "dsh", "antigravity"]) {
      const a = AGENTS[id];
      const b = targetRow.createEl("button", { cls: "ad-target" + (d.target === id ? " is-on" : "") });
      b.style.setProperty("--ad-agent", a.color);
      b.style.setProperty("--ad-agent-soft", a.soft);
      agentIcon(b.createSpan({ cls: "ad-glyph" }), id);
      b.createSpan({ text: a.name });
      b.createSpan({ cls: "ad-target__hint", text: id === "claude" ? t("桌面版 / 后台") : id === "codex" ? t("桌面版 / 终端") : t("ACP / 自带账号") });
      b.onclick = async () => { d.target = id; await p.saveSettings(); this.display(); };
    }

    const mentions = this.card(body, t("任务行 Agent 补全"), t("在列表任务中输入触发符号，选择 Agent、模型和推理强度。"));
    const suggestRow = this.row(mentions, t("输入时显示候选菜单"), t("关闭后不弹菜单；已有任务标记仍可正常派发。"), null);
    this.toggle(suggestRow.querySelector(":scope > .ad-row__right"), d.mentionSuggest !== false, (v) => { d.mentionSuggest = v; p.saveSettings(); });
    const triggerRow = this.row(mentions, t("触发符号"), t("默认 @，也可使用 !、:: 等符号；前面需空格。旧 @ 标记继续有效。"), null);
    this.textInput(triggerRow.querySelector(":scope > .ad-row__right"), d.mentionTrigger || "@", "@", (v) => {
      const trigger = v.trim();
      if (!trigger || /[\s`\p{L}\p{N}]/u.test(trigger)) { new Notice(t("请填写不含空格、字母、数字或反引号的符号")); return; }
      d.mentionTrigger = trigger; p.saveSettings();
    });

    // Claude card
    const claude = this.card(body, "Claude Code", t("后台开一个会话，答完一轮可以点开进入 Claude 桌面版。模型、强度、权限模式都会传给 claude 命令行。"));
    this.modelSelect(claude, "claude", d.claude.model, (v) => { this.setDefaultModel("claude", v); this.display(); });
    this.effortControl(claude, "claude", d.claude.effort, (v) => { d.claude.effort = v; p.saveSettings(); });
    const permRow = this.row(claude, t("权限模式"), t("plan = 只出方案不动手；auto = 让 Claude 自己判断；acceptEdits = 自动接受改文件。"), null);
    this.segmented(permRow.querySelector(":scope > .ad-row__right"), CLAUDE_PERMISSIONS, d.claude.permission, (v) => { d.claude.permission = v; p.saveSettings(); this.display(); });
    const cwdRow = this.row(claude, t("工作目录"), t("留空 = 当前库根目录。Claude 的会话日志按目录分开。"), null);
    this.textInput(cwdRow.querySelector(":scope > .ad-row__right"), d.claude.cwd, t("留空 = 库根目录"), (v) => { d.claude.cwd = v.trim(); p.saveSettings(); }, "ad-input--wide");
    const addVault = this.row(claude, t("把当前库也加进可读目录"), t("传 --add-dir，任务里引用笔记时 Claude 能读到。"), null);
    this.toggle(addVault.querySelector(":scope > .ad-row__right"), d.claude.addVault !== false, (v) => { d.claude.addVault = v; p.saveSettings(); });
    const openDesk = this.row(claude, t("完成后自动在桌面版打开"), t("不打开的话，任务行上的按钮会留在那儿等你点。"), null);
    this.toggle(openDesk.querySelector(":scope > .ad-row__right"), d.claude.openDesktop === true, (v) => { d.claude.openDesktop = v; p.saveSettings(); });
    const bg = this.row(claude, t("使用 claude --bg 后台服务"), t("打开后会话由 Claude 的后台 daemon 托管，能在 claude agents 里看到；有些版本 daemon 会掉，掉线时插件会自动改用无头会话。默认关：无头会话最稳。"), null);
    this.toggle(bg.querySelector(":scope > .ad-row__right"), d.claude.useBackground === true, (v) => { d.claude.useBackground = v; p.saveSettings(); });
    const trust = this.row(claude, t("库没被信任时自动换个目录"), t("Claude Code 只在自己信任过的目录里跑。打开后，如果库本身没有信任记录，插件会从 ~/.claude.json 里找一个已信任的目录当工作目录，并把库用 --add-dir 加进去。关掉就严格用上面的目录。"), null);
    this.toggle(trust.querySelector(":scope > .ad-row__right"), d.claude.autoTrustedCwd !== false, (v) => { d.claude.autoTrustedCwd = v; p.saveSettings(); });
    const extra = this.row(claude, t("额外参数"), t("例如 --dangerously-skip-permissions；会原样拼在 claude 后面。"), null);
    this.textInput(extra.querySelector(":scope > .ad-row__right"), d.claude.extraArgs, t("可留空"), (v) => { d.claude.extraArgs = v; p.saveSettings(); }, "ad-input--wide");
    const test = claude.createDiv({ cls: "ad-btnrow" });
    this.bigButton(test, t("检查 claude"), async () => { const r = await p.checkBinary("claude"); new Notice(r, 6000); });
    this.bigButton(test, t("在终端里续这个目录"), () => p.openTerminalAt(d.claude.cwd || p.vaultPath, "claude"));

    const codex = this.card(body, "Codex", t("任务行的 @codex/模型/强度会传入新会话。桌面模式通过 App Server 完成第一轮，再打开 Codex Desktop 继续；遇到审批或交互会停止并提示到桌面继续。连接失败会报错。"));
    const transport = this.row(codex, t("派发到"), t("按住 ⌘ 拖放仍可直接在终端启动。"), null);
    this.segmented(transport.querySelector(":scope > .ad-row__right"), [{ id: "desktop", label: t("Codex 桌面版") }, { id: "terminal", label: t("终端") }], d.codex.transport || "desktop", (v) => { d.codex.transport = v; p.saveSettings(); this.display(); });
    this.modelSelect(codex, "codex", d.codex.model, (v) => { this.setDefaultModel("codex", v); this.display(); });
    this.effortControl(codex, "codex", d.codex.effort, (v) => { d.codex.effort = v; p.saveSettings(); this.display(); });
    for (const [key, label, hint] of [["path", t("codex 程序路径"), t("桌面模式留空优先使用 Desktop 自带程序；终端模式从 PATH 查找")], ["cwd", t("工作目录"), t("留空 = 库根目录")]]) {
      const r = this.row(codex, label, hint, null);
      this.textInput(r.querySelector(":scope > .ad-row__right"), d.codex[key], hint, (v) => { d.codex[key] = v.trim(); p.saveSettings(); }, "ad-input--wide");
    }
    const sandbox = this.row(codex, t("沙箱模式"), t("read-only = 只读；workspace-write = 可修改工作目录。"), null);
    this.segmented(sandbox.querySelector(":scope > .ad-row__right"), ["read-only", "workspace-write"].map((id) => ({ id, label: id })), d.codex.sandbox, (v) => { d.codex.sandbox = v; p.saveSettings(); this.display(); });
    this.bigButton(codex.createDiv({ cls: "ad-btnrow" }), t("检查 codex"), async () => new Notice(await p.checkBinary("codex"), 6000));

    // DSH card
    const dsh = this.card(body, "DeepSeek Harness", t("通过 dsh acp 开一个真正的 Harness 会话，可以用模型和推理强度。回答完会写进会话日志，也会被追踪。"));
    this.modelSelect(dsh, "dsh", d.dsh.model, (v) => { this.setDefaultModel("dsh", v); this.display(); });
    this.effortControl(dsh, "dsh", d.dsh.effort, (v) => { d.dsh.effort = v; p.saveSettings(); });
    const route = this.row(dsh, t("自动允许工具调用"), t("ACP 模式下 Harness 会把权限请求发回插件。打开 = 自动允许一次；关掉 = 在 Obsidian 中逐次确认，并发送通知。"), null);
    this.toggle(route.querySelector(":scope > .ad-row__right"), d.dsh.autoApprove === true, (v) => { d.dsh.autoApprove = v; p.saveSettings(); });
    const dcwd = this.row(dsh, t("工作目录"), t("留空 = 当前库根目录。"), null);
    this.textInput(dcwd.querySelector(":scope > .ad-row__right"), d.dsh.cwd, t("留空 = 库根目录"), (v) => { d.dsh.cwd = v.trim(); p.saveSettings(); }, "ad-input--wide");
    const dextra = this.row(dsh, t("额外 ACP 参数"), t("传给 dsh acp 的参数，通常留空。"), null);
    this.textInput(dextra.querySelector(":scope > .ad-row__right"), d.dsh.extraArgs, t("可留空"), (v) => { d.dsh.extraArgs = v; p.saveSettings(); }, "ad-input--wide");
    const dtest = dsh.createDiv({ cls: "ad-btnrow" });
    this.bigButton(dtest, t("读取 Harness 可用模型"), async () => {
      try { const models = await p.refreshDshModels(); new Notice(t("已读取 {n} 个模型，包含 Harness 中配置的自定义模型", { n: models.length })); this.display(); }
      catch (e) { new Notice(t("读取失败：{msg}", { msg: e.message }), 8000); }
    });
    this.bigButton(dtest, t("检查 dsh"), async () => { const r = await p.checkBinary("dsh"); new Notice(r, 6000); });

    for (const [id, card] of [["claude", claude], ["dsh", dsh]]) {
      const r = this.row(card, t("命令行路径"), t("留空 = 自动查找已安装的 CLI。"), null);
      this.textInput(r.querySelector(":scope > .ad-row__right"), d[id].path || "", t("自动查找"), (v) => { d[id].path = v.trim(); p.saveSettings(); }, "ad-input--wide");
    }

    const agy = this.card(body, "Antigravity ACP", t("需要独立 Antigravity CLI（agy），安装并运行 agy acp --login 完成登录。任务、回复和后续追问在 Obsidian 内完成；工具请求逐次弹窗确认。此会话不保证能在 Antigravity IDE 中打开。"));
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

    // Prompt
    const prompt = this.card(body, t("提示词前后缀"), t("每次委派会把这一块（连同子块）原样发过去，这里的内容加在前后。"));
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
    const rc = this.row(prompt, t("动手前先确认"), t("在最后再追加一句（笔记里看不到）：有疑问先问，都清楚了先说打算，等你确认再动手。"), null);
    this.toggle(rc.querySelector(":scope > .ad-row__right"), d.confirmFirst !== false, (v) => { d.confirmFirst = v; p.saveSettings(); });
    const confirm = prompt.createDiv({ cls: "ad-field" });
    confirm.createDiv({ cls: "ad-field__label", text: t("确认提示词（开启时追加到消息末尾，可自定义）") });
    const confirmTa = confirm.createEl("textarea", { cls: "ad-textarea", attr: { rows: "5" } });
    confirmTa.value = d.confirmFirstPrompt ?? DEFAULTS.delegate.confirmFirstPrompt;
    confirmTa.onchange = () => { d.confirmFirstPrompt = confirmTa.value; p.saveSettings(); };

    // Behaviour
    const beh = this.card(body, t("写回笔记"), t("委派开始后，在任务下面写一行 🔗；完成后写一行 💬。"));
    const r1 = this.row(beh, t("把状态改成 DELEGATED"), t("保留原来的时刻和优先级。"), null);
    this.toggle(r1.querySelector(":scope > .ad-row__right"), d.markStatus !== false, (v) => { d.markStatus = v; p.saveSettings(); });
    const r2 = this.row(beh, t("写 🔗 绑定行"), t("删除这一行就等于解除绑定。"), null);
    this.toggle(r2.querySelector(":scope > .ad-row__right"), d.writeLink !== false, (v) => { d.writeLink = v; p.saveSettings(); });
    const r3 = this.row(beh, t("完成后写 💬 结论"), t("把 Agent 最后说的话压成一行。"), null);
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
    const row = this.row(parent, t("模型"), t("可选内置或自定义模型；在 Models 页添加、编辑和启用。"), null);
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
    const row = this.row(parent, t("默认强度"), t("可用强度由所选模型决定。"), null);
    const right = row.querySelector(":scope > .ad-row__right");
    const wrap = right.createDiv({ cls: "ad-effort" });
    const opts = EFFORTS[agent] || EFFORTS.claude;
    const track = wrap.createDiv({ cls: "ad-effort__track" });
    const fill = track.createDiv({ cls: "ad-effort__fill" });
    const stops = track.createDiv({ cls: "ad-effort__stops" });
    const idx = Math.max(0, opts.findIndex((x) => x.id === value));
    fill.style.width = `${(idx / Math.max(1, opts.length - 1)) * 100}%`;
    opts.forEach((o, i) => {
      const b = stops.createEl("button", { cls: "ad-effort__stop" + (o.id === value ? " is-on" : ""), attr: { title: o.hint || "" } });
      b.createSpan({ cls: "ad-effort__dot" });
      b.onclick = () => onChange(o.id);
      const lab = wrap.createEl("span", { cls: "ad-effort__lab", attr: { style: `left:${(i / Math.max(1, opts.length - 1)) * 100}%` }, text: o.label });
    });
  }

  // ---------- Models ----------
  renderDream(body) {
    const p = this.plugin, s = p.settings.dream;
    const card = this.card(body, t("Dreaming · 长期记忆"), t("从最近十四天的用户日志和已写入笔记的 AI 记录提炼事实、偏好与项目经验。沿用「追踪」里整理日记的 CLI、模型和登录；材料会发送给该 CLI 所用的模型服务。记忆为带来源的 Markdown，可直接修改。自动整理仅在本插件运行时执行。"));
    const auto = this.row(card, t("每天自动整理"), t("每天处理新增或变化的记录；有积压时每分钟继续一批，失败至少隔一小时再试。"), null);
    this.toggle(auto.querySelector(":scope > .ad-row__right"), s.enabled, (v) => { s.enabled = v; p.saveSettings(); });
    const file = this.row(card, t("长期记忆笔记"), t("库内 Markdown 路径。修改路径不会移动旧记忆。"), null);
    this.textInput(file.querySelector(":scope > .ad-row__right"), s.path, "Agent Deck/长期记忆.md", (v) => { try { s.path = notePath(v); p.saveSettings(); } catch (e) { new Notice(e.message); } }, "ad-input--wide");
    if (companionInstalled(p.app)) {
      const sync = this.row(card, t("同步到 Telegram Companion 陪伴档案"), t("只同步当前有效记忆，最多 6000 字；完整历史保留在长期记忆笔记。只更新 Agent Deck 专属区段，不会直接发送 Telegram 消息。"), null);
      this.toggle(sync.querySelector(":scope > .ad-row__right"), s.syncProfile, (v) => { s.syncProfile = v; p.saveSettings(); });
    }
    const run = this.bigButton(card, t("现在 Dream 一次"), async () => {
      const task = p.dreaming.run(); update();
      try { await task; } finally { update(); }
    });
    const progress = card.createDiv({ cls: "ad-dream-progress", attr: { role: "status", "aria-live": "polite" } });
    const phase = progress.createDiv();
    const elapsed = progress.createDiv({ cls: "ad-muted" });
    const meter = progress.createEl("progress", { attr: { "aria-label": t("Dream 整理进度") } });
    this.bigButton(card, t("导出长期记忆 Markdown 副本"), () => p.dreaming.exportMemory());
    card.createDiv({ cls: "ad-muted", text: t("可在笔记里修改记忆；将状态改为「已拒绝」或删除整条，后续整理会排除它。新证据改变旧记忆时，旧条目标为「已被替代」。") });
    const summary = card.createDiv({ cls: "ad-muted" });

    const c = s.share, sharing = p.dreaming.sharing;
    const shared = this.card(body, t("与其他 Agent 共享记忆"), t("单向同步为固定路径的 Markdown，保留人工说明、当前有效记忆与来源，排除已拒绝和已被替代条目。让其他 Agent 在启动说明或记忆配置中读取此文件即可。修改请回到原长期记忆笔记；下次同步会覆盖共享文件。"));
    const enabled = this.row(shared, t("自动同步共享记忆"), t("每次 Dream 完成后同步，并按下方间隔定期同步人工修改。独立于每天自动整理，仅在插件运行时执行；失败一小时后重试。"), null);
    this.toggle(enabled.querySelector(":scope > .ad-row__right"), c.enabled, v => { c.enabled = v; p.saveSettings(); });
    const target = this.row(shared, t("共享文件路径"), t("绝对路径，支持 ~/。例如 /Users/me/shared-agent-memory/memory.md；可放在同步盘或 GitHub 仓库的本地克隆中。首次使用请指定专用文件。"), null);
    this.textInput(target.querySelector(":scope > .ad-row__right"), c.path, "/Users/me/shared-agent-memory/memory.md", v => { try { c.path = v.trim() ? externalMemoryPath(v) : ""; p.saveSettings(); } catch (e) { new Notice(e.message); } }, "ad-input--wide");
    const interval = this.row(shared, t("定期同步间隔（小时）"), t("1—168 小时。其他 Agent 读取本地共享文件，或拉取仓库中的这个文件。"), null);
    this.numberInput(interval.querySelector(":scope > .ad-row__right"), c.intervalHours, 1, 168, v => { c.intervalHours = v; p.saveSettings(); });
    const git = this.row(shared, t("同步后提交并推送 Git"), t("目标文件的父目录须已存在于本地 Git 仓库。使用已有 Git 登录与提交身份，只提交此共享文件，推送到 origin 的当前分支（包括 GitHub）。开启前确认仓库可见范围适合存放这些记忆。"), null);
    this.toggle(git.querySelector(":scope > .ad-row__right"), c.gitPush, v => { c.gitPush = v; p.saveSettings(); });
    const syncNow = this.bigButton(shared, t("立即同步共享记忆"), async () => {
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
    const d = this.modelsDraft();
    const target = this.modelTarget || p.defaultTarget();
    const models = p.allModels(d.custom);
    const enabled = new Set(d.enabled);
    const byId = new Map(models.map((m) => [m.id, m]));
    const defaultId = d.defaultByAgent[target] || p.defaultModel(target);
    const def = byId.get(defaultId) || models.find((m) => m.agent === target) || models[0];

    const intro = body.createDiv({ cls: "ad-models-intro" });
    intro.createDiv({ cls: "ad-models-title", text: "Models" });
    intro.createDiv({ cls: "ad-models-sub", text: t("哪些模型出现在委派按钮里，每次从哪里开始，以及它想多深。") });

    // Defaults
    const defaults = body.createDiv({ cls: "ad-models-card" });
    const dhead = defaults.createDiv({ cls: "ad-models-sec" });
    dhead.createSpan({ cls: "ad-kicker", text: "Defaults" });
    const targetSeg = defaults.createDiv({ cls: "ad-models-target" });
    for (const id of ["claude", "codex", "dsh", "antigravity"]) {
      const a = AGENTS[id];
      const b = targetSeg.createEl("button", { cls: "ad-target ad-target--sm" + (target === id ? " is-on" : "") });
      b.style.setProperty("--ad-agent", a.color);
      b.style.setProperty("--ad-agent-soft", a.soft);
      agentIcon(b.createSpan({ cls: "ad-glyph" }), id);
      b.createSpan({ text: a.short });
      b.onclick = () => { this.modelTarget = id; this.display(); };
    }
    const defRow = defaults.createDiv({ cls: "ad-defrow" });
    const defLeft = defRow.createDiv({ cls: "ad-defrow__left" });
    defLeft.createDiv({ cls: "ad-defrow__name", text: "Default model" });
    defLeft.createDiv({ cls: "ad-defrow__desc", text: "New delegations start with this model." });
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
      if (def.note) defaults.createDiv({ cls: "ad-defnote", text: def.note });
    }

    // Effort
    const eff = defaults.createDiv({ cls: "ad-defrow ad-defrow--effort" });
    const effLeft = eff.createDiv({ cls: "ad-defrow__left" });
    effLeft.createDiv({ cls: "ad-defrow__name", text: "Default effort" });
    effLeft.createDiv({ cls: "ad-defrow__desc", text: "How long the model thinks before it answers. You can change it per delegation." });
    const effRight = eff.createDiv({ cls: "ad-defrow__right ad-effort ad-effort--big" });
    const eopts = EFFORTS[target] || EFFORTS.claude;
    const evalue = d.effortByAgent?.[target] || p.settings.delegate[target]?.effort || d.effort || "high";
    const eidx = Math.max(0, eopts.findIndex((x) => x.id === evalue));
    const etrack = effRight.createDiv({ cls: "ad-effort__track" });
    etrack.createDiv({ cls: "ad-effort__fill" }).style.width = `${(eidx / Math.max(1, eopts.length - 1)) * 100}%`;
    const estops = etrack.createDiv({ cls: "ad-effort__stops" });
    eopts.forEach((o, i) => {
      const b = estops.createEl("button", { cls: "ad-effort__stop" + (o.id === evalue ? " is-on" : ""), attr: { title: o.hint || "" } });
      b.createSpan({ cls: "ad-effort__dot" });
      b.onclick = () => { (d.effortByAgent ||= {})[target] = o.id; this.display(); };
      const lab = effRight.createSpan({ cls: "ad-effort__lab", attr: { style: `left:${(i / Math.max(1, eopts.length - 1)) * 100}%` }, text: o.label });
    });
    const rec = effRight.createDiv({ cls: "ad-effort__rec" });
    rec.createSpan({ text: "Recommended" });
    const adv = rec.createEl("select", { cls: "ad-advselect" });
    for (const o of eopts) adv.createEl("option", { text: o.label, attr: { value: o.id } });
    adv.value = evalue;
    adv.onchange = () => { (d.effortByAgent ||= {})[target] = adv.value; this.display(); };

    // Model picker
    const picker = body.createDiv({ cls: "ad-models-card" });
    const phead = picker.createDiv({ cls: "ad-models-sec" });
    phead.createSpan({ cls: "ad-kicker", text: "Model picker" });
    phead.createSpan({ cls: "ad-models-sec__sub", text: "Choose which models show up when you delegate." });
    const tools = picker.createDiv({ cls: "ad-picker-tools" });
    const searchWrap = tools.createDiv({ cls: "ad-search" });
    searchWrap.createSpan({ cls: "ad-search__icon", text: "⌕" });
    const search = searchWrap.createEl("input", { cls: "ad-search__input", attr: { placeholder: "Search models", value: this.search } });
    search.oninput = () => { this.search = search.value; this.display(); };
    const add = tools.createEl("button", { cls: "ad-btn ad-btn--soft", text: "＋ Add model" });
    add.onclick = () => new AddModelModal(this.app, p, (m) => {
      d.custom.push(m);
      if (!d.enabled.includes(m.id)) d.enabled.push(m.id);
      if (!d.order.includes(m.id)) d.order.push(m.id);
      this.display();
    }).open();
    const filters = picker.createDiv({ cls: "ad-filters ad-filters--models" });
    for (const [id, label] of [["all", "All"], ["enabled", "Enabled"], ["reasoning", "Reasoning"], ["fast", "Fast"], ["vision", "Vision"]]) {
      const b = filters.createEl("button", { cls: "ad-chip" + (this.filter === id ? " is-on" : ""), text: label });
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
    if (pinned.length) {
      const g = list.createDiv({ cls: "ad-modelgroup" });
      const gh = g.createDiv({ cls: "ad-modelgroup__head" });
      gh.createSpan({ text: "Pinned" });
      this.groupAction(gh, pinned, d, true);
      for (const m of pinned) this.modelRow(g, m, d, target, defaultId, true);
    }
    for (const agent of ["claude", "codex", "dsh", "antigravity"]) {
      const rows = rest.filter((m) => m.agent === agent);
      if (!rows.length) continue;
      const g = list.createDiv({ cls: "ad-modelgroup" });
      const gh = g.createDiv({ cls: "ad-modelgroup__head" });
      const a = AGENTS[agent];
      agentIcon(gh.createSpan({ cls: "ad-glyph", attr: { style: `color:${a.color}` } }), agent);
      gh.createSpan({ text: a.name });
      gh.createSpan({ cls: "ad-muted", text: `${rows.filter((m) => enabled.has(m.id)).length} of ${rows.length} on` });
      this.groupAction(gh, rows, d, false);
      for (const m of rows) this.modelRow(g, m, d, target, defaultId, false);
    }
    if (!pinned.length && !rest.length) {
      list.createDiv({ cls: "ad-empty ad-empty--small", text: t("没有符合条件的模型") });
    }
    const note = picker.createDiv({ cls: "ad-models-note", text: "Pinned models show first. Reorder from the row menu or with Alt + ↑/↓." });
  }

  groupAction(head, rows, d, pinned) {
    const allOn = rows.every((m) => d.enabled.includes(m.id));
    const b = head.createEl("button", { cls: "ad-linkbtn", text: allOn ? "Turn all off" : "Turn all on" });
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
    if (m.id === defaultId) name.createSpan({ cls: "ad-badge", text: "Default" });
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
      menu.addItem((it) => it.setTitle(pinned ? "Unpin" : "Pin").setIcon(pinned ? "pin-off" : "pin").onClick(() => {
        const i = d.pinned.indexOf(m.id);
        if (pinned && i >= 0) d.pinned.splice(i, 1);
        if (!pinned && i < 0) d.pinned.push(m.id);
        this.display();
      }));
      menu.addItem((it) => it.setTitle("Move up").setIcon("arrow-up").onClick(() => this.moveModel(d, m, -1)));
      menu.addItem((it) => it.setTitle("Move down").setIcon("arrow-down").onClick(() => this.moveModel(d, m, 1)));
      menu.addItem((it) => it.setTitle("Make default").setIcon("star").onClick(() => { d.defaultByAgent[m.agent] = m.id; if (!d.enabled.includes(m.id)) d.enabled.push(m.id); this.display(); }));
      if ((m.custom || d.custom.some((x) => x.id === m.id))) {
        menu.addItem((it) => it.setTitle(t("编辑模型")).setIcon("pencil").onClick(() => {
          new AddModelModal(this.app, this.plugin, (edited) => { d.custom = d.custom.map((x) => x.id === m.id ? edited : x); this.display(); }, m).open();
        }));
        menu.addItem((it) => it.setTitle("Remove").setIcon("trash").onClick(() => {
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
    bar.createSpan({ cls: "ad-draftbar__text", text: "Unsaved changes" });
    const discard = bar.createEl("button", { cls: "ad-btn ad-btn--ghost", text: "Discard" });
    discard.onclick = () => { this.draft = JSON.parse(JSON.stringify(p.settings.models)); this.display(); };
    const save = bar.createEl("button", { cls: "ad-btn ad-btn--cta", text: "Save  ⌘S" });
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
    const r1 = this.row(c, t("日记日期分界"), t("这个时刻之前算前一天。和螺旋日程保持一致。"), null);
    const cut = this.numberInput(r1.querySelector(":scope > .ad-row__right"), s.dayCutoff, 0, 12, (v) => { s.dayCutoff = v; p.saveSettings(); p.scheduleScan(); });
    const r2 = this.row(c, t("每隔几秒扫描"), t("本机日志的轮询间隔。会话少的时候 20–30 秒就够。"), null);
    this.numberInput(r2.querySelector(":scope > .ad-row__right"), s.pollSeconds, 5, 300, (v) => { s.pollSeconds = v; p.saveSettings(); p.scheduleScan(); });
    const r4 = this.row(c, t("主力读多少天历史"), t("只影响主力；非主力只读今天。"), null);
    this.numberInput(r4.querySelector(":scope > .ad-row__right"), s.fullHistoryDays, 1, 365, (v) => { s.fullHistoryDays = v; p.saveSettings(); p.scanNow(true); });

    const desk = this.card(body, t("Claude 桌面版"), t("桌面版给每个会话存一份清单（claude-code-sessions/<账号>/<组织>/local_*.json）。侧栏里看着同级、其实是「从某个会话开出来」的 side chat，只有这份清单里的 spawnedFrom 记得；终端里的 claude 没有这一项。"));
    const d1 = this.row(desk, t("识别 side chat 和母子关系"), t("子会话在面板里缩进，标出从哪个会话开出；顺手看有哪些会话正开着 side chat。"), null);
    this.toggle(d1.querySelector(":scope > .ad-row__right"), s.claudeDesktop !== false, (v) => { s.claudeDesktop = v; p.saveSettings(); p.scanNow(true); });
    const dc = this.row(desk, t("终端里的会话点开到哪儿"), t("终端里起的 Claude Code / Codex 会话：还开着就切到跑它的那个终端标签（系统终端、iTerm2、Tern、Herdr 能切到标签；Warp 没有脚本接口，只能叫到前台），关了才在新标签里 cd 到会话目录 resume。也可以改成在桌面版打开。"), null);
    this.segmented(dc.querySelector(":scope > .ad-row__right"), [{ id: "terminal", label: t("终端") }, { id: "desktop", label: t("桌面版") }], s.cliOpen === "desktop" ? "desktop" : "terminal", (v) => { s.cliOpen = v; p.saveSettings(); this.display(); });
    const dt = this.row(desk, t("主力终端"), t("resume、按住 ⌘ 拖到 Claude Code / Codex 上委派时，在哪个终端里开新标签。自动（默认）按这台电脑挑：眼下的 claude / codex 命令行会话开在哪个终端就用哪个，没有就用上次认出的，再没有就看开着的、装了的（Herdr → Tern → iTerm2 → Warp → 系统终端）。"), null);
    this.segmented(dt.querySelector(":scope > .ad-row__right"), [{ id: "auto", label: t("自动") }, { id: "terminal", label: t("系统终端") }, { id: "iterm", label: "iTerm2" }, { id: "warp", label: "Warp" }, { id: "tern", label: "Tern" }, { id: "herdr", label: "Herdr" }], s.cliTerminal || "auto", (v) => { s.cliTerminal = v; p.saveSettings(); this.display(); });
    const dd = this.row(desk, t("拖到 Claude Code / Codex 上默认在终端里开"), t("开着：笔记里的一项拖到 Claude Code / Codex 卡片上，在主力终端里新开标签跑交互式会话；按住 ⌘ 拖才走后台（Claude Code）/ 交给桌面版（Codex）。关着则反过来。"), null);
    this.toggle(dd.querySelector(":scope > .ad-row__right"), !!s.delegateInTerminal, (v) => { s.delegateInTerminal = v; p.saveSettings(); p.refreshUI(); });
    const dn = this.row(desk, t("有螺旋日程的进度行时让给它"), t("螺旋日程在任务行下面画了会话进度行时，行尾不再画 pill，🔗 链接放淡、不可点；点进度行打开会话（命令行会话切到它的终端标签）。"), null);
    this.toggle(dn.querySelector(":scope > .ad-row__right"), s.yieldToNautilus !== false, (v) => { s.yieldToNautilus = v; p.saveSettings(); p.refreshUI(); });
    const d2 = this.row(desk, t("归档的会话不再列出"), t("桌面版里归档 = 做完：归档的会话从「现在」和「最近的会话」里收起来，历史用量照旧保留。"), null);
    this.toggle(d2.querySelector(":scope > .ad-row__right"), s.hideArchived !== false, (v) => { s.hideArchived = v; p.saveSettings(); p.refreshUI(); });

    const jr = this.card(body, t("自动记日记（人机共写）"), t("把 Agent 会话写回今天的日记：新会话记成 DOING，停了一阵改成 PAUSED 并把实际时段写在下面，桌面版或 Codex 里归档了记成 DONE。名字和「接在哪一行」可由本机 Claude 或 Codex CLI 整理。只改它自己记着的那几行，你手改过的状态不会被他掰回去。"));
    const master = this.row(jr, t("自动记录到日记（总开关）"), t("由 Agent Deck 负责。关闭后不再自动建项、续写结论或更新任务状态；会话追踪照常，仍可点“现在整理一次”手动整理。"), null);
    this.toggle(master.querySelector(":scope > .ad-row__right"), s.journalAutoWrite !== false, (v) => { s.journalAutoWrite = v; p.saveSettings(); });
    const det = detectJournalFormat(this.app, s);
    const jf = this.row(jr, t("日记目录"), t("留空自动检测：先看 Obsidian 的「日记」核心插件和 Periodic Notes，都没开就用「日记」。现在用的：{folder}（{source}）。今天的日记：{path}", { folder: det.folder || t("库根目录"), source: det.folderSource, path: journalPath(this.app, s) }), null);
    this.textInput(jf.querySelector(":scope > .ad-row__right"), s.journalFolder || "", t("自动：{folder}", { folder: det.folder || t("库根目录") }), (v) => { s.journalFolder = v.trim(); p.saveSettings(); this.display(); });
    const jfmt = this.row(jr, t("日记文件名格式"), t("moment 写法，可以带子目录，比如 YYYY-MM-DD、YYYY/MM/YYYY-MM-DD。留空自动检测：先看 Obsidian 的「日记」核心插件和 Periodic Notes，都没开就按日记目录里已有文件的命名。现在检测到：{format}（{source}）。", { format: det.format, source: det.source }), null);
    this.textInput(jfmt.querySelector(":scope > .ad-row__right"), s.journalFormat || "", t("自动：{format}", { format: det.format }), (v) => { s.journalFormat = v.trim(); p.saveSettings(); this.display(); });
    const ja = this.row(jr, t("自动整理进日记"), t("每隔一阵扫一遍今天开着的会话；自动关着也可以用命令「整理 Agent 会话进今天的日记」手动跑。"), null);
    this.toggle(ja.querySelector(":scope > .ad-row__right"), s.autoLog === true, (v) => { s.autoLog = v; p.saveSettings(); });
    const grain = this.row(jr, t("自动记录颗粒度"), t("最新进展：覆盖上一句；每轮记录：按已完成对话轮次累积结论；停歇或归档：只在自动暂停或识别归档时写结论。任务状态与用时另按原规则同步。"), null);
    this.segmented(grain.querySelector(":scope > .ad-row__right"), [{id:"latest",label:t("最新进展")},{id:"round",label:t("每轮记录")},{id:"paused",label:t("停歇或归档")}], s.autoLogGranularity || "latest", (v) => { s.autoLogGranularity=v; p.saveSettings(); this.display(); });
    const archive = this.row(jr, t("已完成任务归档位置"), t("点击“归档已完成日志”时，整块移到此文件，按原日记日期分组。填写库内的 .md 文件路径；修改位置只影响后续归档。"), null);
    this.textInput(archive.querySelector(":scope > .ad-row__right"), s.doneArchivePath, DEFAULTS.doneArchivePath, v => { try { s.doneArchivePath = archivePath(v); p.saveSettings(); } catch (e) { new Notice(e.message); } }, "ad-input--wide");
    const merge = this.row(jr, t("累积后自动合并总结"), t("在“每轮记录”模式下，累积到指定条数后由所选 CLI 显示一条累计总结；原轮次记录保留在笔记中，点击“更多”展开。手写内容、实际用时与待办保留。总结失败时保留原记录。"), null);
    this.toggle(merge.querySelector(":scope > .ad-row__right"), !!s.autoLogMerge, (v) => { s.autoLogMerge=v; p.saveSettings(); this.display(); }, s.autoLogGranularity !== "round");
    const mergeN = this.row(jr, t("累积多少条结论后合并"), t("同一会话从上次总结后新增的已完成轮次；默认 10 条，至少 2 条。最新进展与停歇模式不累积合并。"), null);
    this.numberInput(mergeN.querySelector(":scope > .ad-row__right"), s.autoLogMergeThreshold || 10, 2, 100, (v) => { s.autoLogMergeThreshold=Math.round(v); p.saveSettings(); });
    const jdetail = this.row(jr, t("自动日志详细程度"), t("简略：每条结论约 45 字，不抄用户提问和步骤；标准：结论更完整，可显示步骤；详细：按轮记录时再保留每轮提问。需要你处理的待办、实际用时和手写内容保留。切换后在下次写回时整理本任务的自动记录。"), null);
    this.segmented(jdetail.querySelector(":scope > .ad-row__right"), [{ id: "brief", label: t("简略（默认）") }, { id: "standard", label: t("标准") }, { id: "detailed", label: t("详细") }], s.autoLogDetail || "brief", (v) => { s.autoLogDetail = v; p.saveSettings(); this.display(); });
    this.row(jr, t("AI 记录显示方式"), t("默认折叠；手动展开后保留该任务的展开状态，折叠后恢复为折叠。累计总结保留一条可见结论，点“更多”看明细。由 Agent Deck 自己控制，并与 Obsidian 原生折叠命令联动，不依赖 Logseq Style Fold。"), null);
    const je = this.row(jr, t("每隔几分钟"), t("自动整理的间隔，最少 5 分钟。"), null);
    this.numberInput(je.querySelector(":scope > .ad-row__right"), s.autoLogEvery || 20, 5, 240, (v) => { s.autoLogEvery = v; p.saveSettings(); });
    const jst = this.row(jr, t("启动后第几分钟先整理一次"), t("Obsidian 刚打开时不用等满一个间隔，到这个时候先跑一次；之后按上面的间隔。"), null);
    this.numberInput(jst.querySelector(":scope > .ad-row__right"), s.autoLogStartDelay ?? 1, 1, 240, (v) => { s.autoLogStartDelay = v; p.saveSettings(); });
    const jmin = this.row(jr, t("新会话活跃满几分钟才记"), t("不到这个时长的会话先不建项，免得随手问一句也进日记；客户端里归档了的不管多短都记。0 = 有动静就记。"), null);
    this.numberInput(jmin.querySelector(":scope > .ad-row__right"), s.autoLogMinMinutes ?? 3, 0, 120, (v) => { s.autoLogMinMinutes = v; p.saveSettings(); });
    const jid = this.row(jr, t("停了几分钟算暂停"), t("会话停下超过这么久，那一行从 DOING 改成 PAUSED，并写上实际时段 ⏱。最少 5 分钟。"), null);
    this.numberInput(jid.querySelector(":scope > .ad-row__right"), s.autoLogIdle || 10, 5, 480, (v) => { s.autoLogIdle = v; p.saveSettings(); });
    const jag = this.row(jr, t("记哪几个 Agent"), t("只有勾上的 Agent 里自己新开的会话会自动进日记；日记里 🔗 绑着的会话不受这个影响。"), null);
    const agBox = jag.querySelector(":scope > .ad-row__right").createDiv({ cls: "ad-seg" });
    const agOn = (s.autoLogAgents ||= {});
    for (const id of AGENT_ORDER) {
      const b = agBox.createEl("button", { cls: "ad-seg__btn" + (agOn[id] !== false ? " is-on" : ""), text: AGENTS[id]?.short || id });
      b.onclick = () => { agOn[id] = agOn[id] === false; b.classList.toggle("is-on", agOn[id] !== false); p.saveSettings(); };
    }
    const jb = this.row(jr, t("一轮最多问几个会话"), t("每次整理一次最多交给模型看几个新会话，剩下的下一轮再问（手动整理会接着问完）。"), null);
    this.numberInput(jb.querySelector(":scope > .ad-row__right"), s.autoLogBatch || 8, 1, 20, (v) => { s.autoLogBatch = v; p.saveSettings(); });
    const jprovider = this.row(jr, t("整理使用的 CLI"), t("自动建项与每轮结论润色都使用这个 CLI，沿用它的登录。"), null);
    this.segmented(jprovider.querySelector(":scope > .ad-row__right"), [{ id: "claude", label: "Claude CLI" }, { id: "codex", label: "Codex CLI" }], s.autoLogProvider || "claude", (v) => {
      s.autoLogProvider = v; s.autoLogModel = v === "codex" ? "gpt-6-luna" : "haiku"; s.roundPolishModel = ""; s.autoLogPath = ""; p.saveSettings(); this.display();
    });
    if (s.autoLogProvider === "codex") {
      const effort = this.row(jr, t("整理与润色的推理强度"), t("简单摘要可选 low。"), null);
      this.segmented(effort.querySelector(":scope > .ad-row__right"), EFFORTS.codex, s.autoLogEffort || "low", (v) => { s.autoLogEffort = v; p.saveSettings(); this.display(); });
    }
    const jm = this.row(jr, t("整理用的模型"), t("传给所选 CLI 的 --model，可填模型名或别名。Claude 如 haiku；Codex 如 gpt-6-luna。"), null);
    this.textInput(jm.querySelector(":scope > .ad-row__right"), s.autoLogModel || "", s.autoLogProvider === "codex" ? "gpt-6-luna" : "haiku", (v) => { s.autoLogModel = v.trim(); p.saveSettings(); });
    const jt = this.row(jr, t("整理时等模型几秒"), t("超过这么久没回来就算这一轮没问到。"), null);
    this.numberInput(jt.querySelector(":scope > .ad-row__right"), s.autoLogTimeout || 120, 10, 600, (v) => { s.autoLogTimeout = v; p.saveSettings(); });
    const jfb = this.row(jr, t("模型问不到时先用会话标题记上"), t("所选 CLI 没装、没登录、超时或回的不是 JSON 时，自动整理也像手动整理一样用会话标题 / 第一句话先建项；关掉则跳过，等下一轮再问。"), null);
    this.toggle(jfb.querySelector(":scope > .ad-row__right"), s.autoLogFallback !== false, (v) => { s.autoLogFallback = v; p.saveSettings(); });
    const jp = this.row(jr, t("整理 CLI 路径"), t("留空 = 使用所选 CLI 的委派路径，再从 PATH 找。"), null);
    this.textInput(jp.querySelector(":scope > .ad-row__right"), s.autoLogPath || "", t("自动找"), (v) => { s.autoLogPath = v.trim(); p.saveSettings(); }, "ad-input--wide");
    const jrp = this.row(jr, t("每轮结论让模型润色"), t("每答完一轮，💬 先用本地规则摘一句写上，再在后台让模型改成一句通顺的结论替换掉。"), null);
    this.toggle(jrp.querySelector(":scope > .ad-row__right"), s.roundPolish !== false, (v) => { s.roundPolish = v; p.saveSettings(); });
    const jrm = this.row(jr, t("润色用的模型"), t("留空 = 和整理用的模型一样。"), null);
    this.textInput(jrm.querySelector(":scope > .ad-row__right"), s.roundPolishModel || "", t("同整理用的模型"), (v) => { s.roundPolishModel = v.trim(); p.saveSettings(); });
    const jrt = this.row(jr, t("润色时等模型几秒"), t("超时就留着本地摘的那一句。"), null);
    this.numberInput(jrt.querySelector(":scope > .ad-row__right"), s.roundPolishTimeout || 30, 5, 300, (v) => { s.roundPolishTimeout = v; p.saveSettings(); });
    const jd = this.row(jr, t("归档的会话记成 DONE"), t("你在 Claude 桌面版或 Codex 里归档一个会话 = 这件事做完了，它那一行记成 DONE。桌面版开了自动归档的话就关掉这个。"), null);
    this.toggle(jd.querySelector(":scope > .ad-row__right"), s.autoLogArchiveDone !== false, (v) => { s.autoLogArchiveDone = v; p.saveSettings(); });
    const jn = this.row(jr, t("整理完弹通知"), t("列出这一轮记成 DOING / PAUSED / DONE 的条目和记下的待拍板事项。"), null);
    this.toggle(jn.querySelector(":scope > .ad-row__right"), s.autoLogNotify !== false, (v) => { s.autoLogNotify = v; p.saveSettings(); });
    const js = this.row(jr, t("回写日记"), t("日记里 🔗 绑着的会话：答完写 💬，状态跟着会话切，归档记 DONE，子会话和开着的 side chat 写成子块。螺旋日程的 AI 追踪还开着时先不写，免得两套写法打架。"), null);
    this.toggle(js.querySelector(":scope > .ad-row__right"), s.journalSync !== false, (v) => { s.journalSync = v; p.saveSettings(); });
    for (const [key, label, desc] of [
      ["resultBack", t("会话结论写回（💬）"), t("会话答完一轮或归档时，把最后那条回复写成任务下面的一行。")],
      ["agentKw", t("状态关键词跟着会话"), t("在 DOING / TOREVIEW / NEEDOK / ERRORED / HITLIMIT 之间跟着会话切；你改成别的就不碰。")],
      ["autoLogKw", t("自动记的条目也跟着切状态"), t("自动整理建的 🤖 条目（没有 🔗 行）也在 DOING / TOREVIEW / NEEDOK / ERRORED 之间跟着会话切；PAUSED、DONE 照旧由自动整理管。")],
      ["kidBlocks", t("子会话和 side chat 子块"), t("桌面版里开出来的子会话、开着的 side chat 写成缩进子块。")],
    ]) {
      const row = this.row(jr, label, desc, null);
      this.toggle(row.querySelector(":scope > .ad-row__right"), s[key] !== false, (v) => { s[key] = v; p.saveSettings(); });
    }
    const jbtn = jr.createDiv({ cls: "ad-btnrow" });
    this.bigButton(jbtn, t("现在整理一次"), () => p.autoLog.logNow());
    jr.createDiv({ cls: "ad-hint", text: t("写入前会核对日记没被同时改过，正在用输入法打字的那一下不写。") });

    const ui = this.card(body, t("界面"));
    const mb = this.row(ui, t("macOS 菜单栏"), t("在系统最上方显示一个小图标和一串简短说明；点开是会话详情和跳转。Obsidian 右下角不再显示 Agent 汇总。第一次启动会编译一个 Swift 小助手，需要 Xcode Command Line Tools。"), null);
    // 菜单栏里点「隐藏」、助手起不来时，插件用 mbSwitch.setOn 把这里拨回去
    this.mbSwitch = this.toggle(mb.querySelector(":scope > .ad-row__right"), s.showMenuBar !== false, (v) => { s.showMenuBar = v; p.saveSettings(); p.applyUiSettings(); });
    this.row(ui, t("跳转到正在运行的项目"), t("默认 Ctrl + Alt + J；多个项目时连续按依次跳转。在 Obsidian 设置 → 快捷键中搜索“Agent Deck: 跳转到日记中正在运行的项目”可自定义。"), "⌃⌥J");
    const ma = this.row(ui, t("菜单栏显示哪些 Agent"), t("默认只展示主力和当前正在运行任务的 Agent；其余等待或空闲的 Agent 收起。可以改为显示全部已启用的 Agent。"), null);
    this.segmented(ma.querySelector(":scope > .ad-row__right"), [{ id: "primary-running", label: t("主力与在跑的") }, { id: "all", label: t("全部已启用") }], s.menuBarAgentScope || "primary-running", (v) => { s.menuBarAgentScope = v; p.saveSettings(); p.menubar?.update(true); this.display(); });
    for (const [key, label, desc, min, max] of [
      ["menuBarPrimaryLimit", t("菜单栏：主力最多几个"), t("主力 Agent 全量追踪，所以可以多放几个会话。"), 3, 12],
      ["menuBarOtherLimit", t("菜单栏：其它 Agent 最多几个"), t("其它 Agent 只显示正在运行的会话。"), 1, 6],
    ]) {
      const row = this.row(ui, label, desc, null);
      this.numberInput(row.querySelector(":scope > .ad-row__right"), s[key] || (key === "menuBarPrimaryLimit" ? 6 : 3), min, max, (v) => { s[key] = v; p.saveSettings(); p.refreshUI(); });
    }
    const hkRow = this.row(ui, t("菜单栏快捷键"), t("菜单栏被 macOS 藏起来时，用这个组合在任意 App 开合面板。点一下输入框，再按新的组合；至少包含 ⌃ / ⌥ / ⌘ 之一。如果没反应，可能被别的 App 占用，换一个组合试试。"), null);
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

    const mbbtn = this.row(ui, t("菜单栏助手"), t("如果菜单栏没出现，或者改完设置想立刻重开。"), null);
    const mbrestart = mbbtn.querySelector(":scope > .ad-row__right").createEl("button", { cls: "ad-btn", text: t("重启菜单栏") });
    mbrestart.onclick = () => p.menubar?.restart();
    const nautRow = this.row(ui, t("关闭螺旋日程右下角的 Agent 汇总"), t("Agent Deck 接管后，螺旋日程那一格 🤖 会隐藏；它自己的日程状态栏和计时照常。"), null);
    this.toggle(nautRow.querySelector(":scope > .ad-row__right"), s.menuBarHideNautilus !== false, (v) => { s.menuBarHideNautilus = v; p.saveSettings(); if (v) p.hideNautilusAgentBar().catch(() => {}); else p.restoreNautilusAgentBar().catch(() => {}); });
    for (const [key, label, desc, fallback] of [
      ["showEditorPills", t("任务行上的会话状态按钮"), t("只有已经绑定会话 / 委派出去的行才显示状态和进度；不再在每个条目上放「委派」按钮。"), true],
      ["dragGrip", t("列表项尾巴上的把手"), t("光标所在的列表项尾巴上出一个小把手：单击确认后连同子块发给主力，双击或 ⌘ 单击选发给哪个 Agent，拖到侧栏的 Agent 卡片上也是委派。选中文字直接拖也行。"), true],
      ["showRibbonIcon", t("左侧栏图标"), t("点一下打开 Agent Deck。"), true],
      ["openDashboardOnStartup", t("启动时打开面板"), t("Obsidian 启动时自动打开 Agent Deck 侧栏。"), false],
    ]) {
      const row = this.row(ui, label, desc, null);
      this.toggle(row.querySelector(":scope > .ad-row__right"), s[key] === undefined ? fallback : s[key] !== false, (v) => { s[key] = v; p.saveSettings(); p.applyUiSettings(); });
    }
    const bars = this.row(ui, t("最近 14 天的条形图"), "", null);
    this.toggle(bars.querySelector(":scope > .ad-row__right"), s.ui.showUsageBars !== false, (v) => { s.ui.showUsageBars = v; p.saveSettings(); p.refreshUI(); });
    const spark = this.row(ui, t("每个 Agent 的小火花线"), "", null);
    this.toggle(spark.querySelector(":scope > .ad-row__right"), s.ui.showSparkline !== false, (v) => { s.ui.showSparkline = v; p.saveSettings(); p.refreshUI(); });

    const data = this.card(body, t("数据"), t("usage.json 存在插件目录里；日志删了历史还在。"));
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

    const naut = this.card(body, t("和螺旋日程并存"), t("螺旋日程也会读同一批 🔗 会话、改任务状态、写 💬。用 Agent Deck 接管后，可以只关掉它的 AI 写入，日程和它的追踪展示照样在。"));
    const nbtn = naut.createDiv({ cls: "ad-btnrow" });
    this.bigButton(nbtn, t("停用螺旋日程里的 AI 写入"), () => p.pauseNautilus(), "mod-warning");
    naut.createDiv({ cls: "ad-hint", text: t("只关自动记日记、状态写回、💬 和子块写入；螺旋自己的 Agent 追踪展示保留。会先备份它的 data.json。写入后请在 Obsidian 设置里重新加载螺旋日程（或重启 Obsidian）；Agent Deck 不会自动启停其它插件。") });

    const links = this.card(body, t("点击会话时打开哪儿"), t("Claude Code 桌面版会话用 claude://resume；Codex 桌面版用 codex://threads/<会话号>；WorkBuddy 用 workbuddy://chat/<会话号>；DeepSeek Harness 只有 dsh://open（聚焦客户端），会话号会复制到剪贴板。终端里的 Claude Code / Codex 会话：还开着就切到那个终端标签，关了才 resume（见「追踪 → Claude 桌面版」）。"));
    links.createDiv({ cls: "ad-hint", text: t("这些是客户端自己的 URL scheme，插件不读也不发任何网络请求。") });
  }

  // ---------- About ----------
  renderAbout(body) {
    const p = this.plugin;
    const c = this.card(body, "Agent Deck", t("智能体甲板 · 在 Obsidian 里追踪和委派 AI Agent。"));
    c.createDiv({ cls: "ad-about-p", text: t("读本机 Claude Code、Codex、WorkBuddy、DeepSeek Harness 的会话日志，在面板里看谁在跑、谁在等你；从笔记里派活，进度和结果写回笔记。怎么操作：") });
    const list = c.createDiv({ cls: "ad-about-list" });
    for (const line of [
      t("点会话卡片：打开这个会话。点 Agent 卡片上的图标：把客户端叫到前台。⭐ 设主力（最多两个，全部历史都读）。"),
      t("会话卡片拖到笔记里有字的一项上：绑定（原文不动，下面写 🔗）；拖到空行或空的列表项上：在那儿新建一项并绑上。按住 ⌘ 拖：在这一项下面新建。"),
      t("笔记里的一项（光标行尾巴上的把手 ⠿，或选中文字）拖到 Agent 卡片上：委派。Claude Code / DeepSeek Harness 后台跑；Codex / WorkBuddy 复制任务、打开客户端，你发出后自动绑回。"),
      t("按住 ⌘ 拖到 Claude Code / Codex 上：在主力终端里新开标签跑交互式会话，任务直接发出去。"),
      t("Agent 记的条目（🤖）、已经绑着会话的、有 ⏱ 记录的不会再委派。"),
      t("笔记里的一项拖到面板的会话卡片上：把这个会话绑给它。在客户端里归档会话：这一项记 DONE + ⏱。"),
      t("行尾 pill 是进度：委派中可以 × 取消，出错可以重试。和螺旋日程一起用时，pill 让给螺旋的进度行，点进度行打开会话。"),
    ]) {
      const r = list.createDiv({ cls: "ad-about-li" });
      r.createSpan({ cls: "ad-about-dot", text: "·" });
      r.createSpan({ text: line });
    }
    const meta = c.createDiv({ cls: "ad-about-meta" });
    meta.createDiv({ text: t("版本 {version} · MIT License", { version: p.manifest.version }) });
    meta.createDiv({ text: t("从 Nautilus Spiral（螺旋日程）的 AI 追踪部分拆出；交互参考了小红书 @ZZ.X 的两条帖子。") });
    const btns = c.createDiv({ cls: "ad-btnrow" });
    this.bigButton(btns, t("打开 GitHub 仓库"), () => p.openExternal("https://github.com/MatsuriMW/obsidian-agent-deck"));
    this.bigButton(btns, t("复制调试信息"), async () => {
      const text = JSON.stringify({ version: "1.0.2", settings: p.settings, files: p.usage.files.size, sessions: p.usage.meta.size, errors: p.usage.errors }, null, 2);
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
    contentEl.createDiv({ cls: "ad-muted", text: t("Claude 和 Codex 用 CLI 的模型名或别名；DeepSeek Harness 用 ACP 的 provider / model。可用性由各客户端账号决定。") });
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
    field("Model / alias", (f) => { const i = f.createEl("input", { cls: "ad-input", attr: { value: this.model, placeholder: t("例如 gpt-6-luna、deepseek-v4-pro 或 opus") } }); i.oninput = () => this.model = i.value; });
    field(t("上下文"), (f) => { const i = f.createEl("input", { cls: "ad-input", attr: { value: this.context } }); i.oninput = () => this.context = i.value; });
    field(t("能力标签"), (f) => { const i = f.createEl("input", { cls: "ad-input", attr: { value: this.tags, placeholder: "Reasoning, Fast, Vision" } }); i.oninput = () => this.tags = i.value; });
    const bar = contentEl.createDiv({ cls: "ad-btnrow ad-btnrow--end" });
    const cancel = bar.createEl("button", { cls: "ad-btn ad-btn--ghost", text: "Cancel" });
    cancel.onclick = () => this.close();
    const add = bar.createEl("button", { cls: "ad-btn ad-btn--cta", text: "Add" });
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
