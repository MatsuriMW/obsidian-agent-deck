// Agent Deck — settings, including the layered Models page.

import { App, PluginSettingTab, Setting, Notice, Modal, Menu, setIcon } from "obsidian";
import {
  AGENTS, AGENT_ORDER, MODEL_CATALOG, EFFORTS, CLAUDE_PERMISSIONS, DEFAULTS,
  fmtMin, fmtTok, deepMerge, fmtClock,
} from "./constants.js";
import { agentIcon, setLucide } from "./icons.js";

const TABS = [
  ["agents", "Agents", "users"],
  ["delegate", "委派", "send"],
  ["models", "Models", "layers"],
  ["tracking", "追踪", "radar"],
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

  display() {
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
    bt.createDiv({ cls: "ad-brand__sub", text: "智能体甲板 · v1.0.2" });

    const nav = containerEl.createDiv({ cls: "ad-set-nav" });
    const dirty = this.draft && JSON.stringify(this.draft) !== JSON.stringify(this.plugin.settings.models);
    for (const [id, label, icon] of TABS) {
      const text = id === "models" && dirty ? `${label} ·` : label;
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
    if (!disabled) b.onclick = () => onChange(!value);
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
    this.card(body, "要追踪的 Agent", "主力最多两个：它们的全部历史都会读；其余开着的只读今天有动静的会话。");
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
      star.title = primary ? "取消主力" : "设为主力（最多两个）";
      star.onclick = () => p.togglePrimary(id);
      const stats = card.createDiv({ cls: "ad-agentcard__stats" });
      const meta = p.usage.meta;
      const sessions = [...meta.values()].filter((x) => x.agent === id);
      stats.createSpan({ text: `${sessions.length} 个会话` });
      stats.createSpan({ cls: "ad-dot", text: "·" });
      stats.createSpan({ text: fmtTok(sessions.reduce((n, x) => n + (x.out || 0), 0)) + " tok" });
      const foot = card.createDiv({ cls: "ad-agentcard__foot" });
      const state = p.agentEnabled(id) ? "追踪中" : "已关闭";
      this.toggle(foot, enabled, (v) => p.setAgentEnabled(id, v), primary);
      foot.createSpan({ cls: "ad-muted", text: primary ? "主力（全量）" : state });
      const path = card.createDiv({ cls: "ad-set-path", text: a.where[0] });
    }
    const bar = body.createDiv({ cls: "ad-btnrow" });
    this.bigButton(bar, "立即扫描", () => p.scanNow(true), "mod-cta");
    this.bigButton(bar, "导入螺旋日程的历史", () => p.importNautilus());
    const info = this.card(body, "本机日志", "只读，不上传。DeepSeek Harness 的会话是 zstd 压缩的 JSONL，插件内置了解压器。");
    const paths = info.createDiv({ cls: "ad-pathlist" });
    for (const [id, a] of Object.entries(AGENTS)) {
      const r = paths.createDiv({ cls: "ad-pathrow" });
      agentIcon(r.createSpan({ cls: "ad-glyph", attr: { style: `color:${a.color}` } }), id);
      r.createSpan({ cls: "ad-pathrow__name", text: a.name });
      r.createSpan({ cls: "ad-pathrow__path", text: a.where[0] });
      r.createSpan({ cls: "ad-muted", text: p.agentEnabled(id) ? "读" : "不读" });
    }
    const errs = p.usage.errors || [];
    if (errs.length) {
      const e = this.card(body, "读日志时遇到的问题", "通常是一个正在写的半截文件，下一轮会自己好。");
      for (const x of errs.slice(-6)) e.createDiv({ cls: "ad-error-line", text: `${x.path}: ${x.message}` });
    }
  }

  // ---------- Delegation ----------
  renderDelegate(body) {
    const p = this.plugin;
    const d = p.settings.delegate;
    this.card(body, "默认委派到", "任务行上的按钮会直接用这里的设置。点按钮右边的 ⌄ 可以临时改参数。");
    const targetRow = body.createDiv({ cls: "ad-targetpick" });
    for (const id of ["claude", "dsh"]) {
      const a = AGENTS[id];
      const b = targetRow.createEl("button", { cls: "ad-target" + (d.target === id ? " is-on" : "") });
      b.style.setProperty("--ad-agent", a.color);
      b.style.setProperty("--ad-agent-soft", a.soft);
      agentIcon(b.createSpan({ cls: "ad-glyph" }), id);
      b.createSpan({ text: a.name });
      b.createSpan({ cls: "ad-target__hint", text: id === "claude" ? "桌面版 / 后台" : "ACP / 自带账号" });
      b.onclick = async () => { d.target = id; await p.saveSettings(); this.display(); };
    }

    // Claude card
    const claude = this.card(body, "Claude Code", "后台开一个会话，答完一轮可以点开进入 Claude 桌面版。模型、强度、权限模式都会传给 claude 命令行。");
    const cModel = this.modelSelect(claude, "claude", d.claude.model, (v) => { d.claude.model = v; p.saveSettings(); this.display(); });
    this.effortControl(claude, "claude", d.claude.effort, (v) => { d.claude.effort = v; p.saveSettings(); });
    const permRow = this.row(claude, "权限模式", "plan = 只出方案不动手；auto = 让 Claude 自己判断；acceptEdits = 自动接受改文件。", null);
    this.segmented(permRow.querySelector(":scope > .ad-row__right"), CLAUDE_PERMISSIONS, d.claude.permission, (v) => { d.claude.permission = v; p.saveSettings(); this.display(); });
    const cwdRow = this.row(claude, "工作目录", "留空 = 当前库根目录。Claude 的会话日志按目录分开。", null);
    this.textInput(cwdRow.querySelector(":scope > .ad-row__right"), d.claude.cwd, "留空 = 库根目录", (v) => { d.claude.cwd = v.trim(); p.saveSettings(); }, "ad-input--wide");
    const addVault = this.row(claude, "把当前库也加进可读目录", "传 --add-dir，任务里引用笔记时 Claude 能读到。", null);
    this.toggle(addVault.querySelector(":scope > .ad-row__right"), d.claude.addVault !== false, (v) => { d.claude.addVault = v; p.saveSettings(); });
    const openDesk = this.row(claude, "完成后自动在桌面版打开", "不打开的话，任务行上的按钮会留在那儿等你点。", null);
    this.toggle(openDesk.querySelector(":scope > .ad-row__right"), d.claude.openDesktop === true, (v) => { d.claude.openDesktop = v; p.saveSettings(); });
    const bg = this.row(claude, "使用 claude --bg 后台服务", "打开后会话由 Claude 的后台 daemon 托管，能在 claude agents 里看到；有些版本 daemon 会掉，掉线时插件会自动改用无头会话。默认关：无头会话最稳。", null);
    this.toggle(bg.querySelector(":scope > .ad-row__right"), d.claude.useBackground === true, (v) => { d.claude.useBackground = v; p.saveSettings(); });
    const trust = this.row(claude, "库没被信任时自动换个目录", "Claude Code 只在自己信任过的目录里跑。打开后，如果库本身没有信任记录，插件会从 ~/.claude.json 里找一个已信任的目录当工作目录，并把库用 --add-dir 加进去。关掉就严格用上面的目录。", null);
    this.toggle(trust.querySelector(":scope > .ad-row__right"), d.claude.autoTrustedCwd !== false, (v) => { d.claude.autoTrustedCwd = v; p.saveSettings(); });
    const extra = this.row(claude, "额外参数", "例如 --dangerously-skip-permissions；会原样拼在 claude 后面。", null);
    this.textInput(extra.querySelector(":scope > .ad-row__right"), d.claude.extraArgs, "可留空", (v) => { d.claude.extraArgs = v; p.saveSettings(); }, "ad-input--wide");
    const test = claude.createDiv({ cls: "ad-btnrow" });
    this.bigButton(test, "检查 claude", async () => { const r = await p.checkBinary("claude"); new Notice(r, 6000); });
    this.bigButton(test, "在终端里续这个目录", () => p.openTerminalAt(d.claude.cwd || p.vaultPath, "claude"));

    // DSH card
    const dsh = this.card(body, "DeepSeek Harness", "通过 dsh acp 开一个真正的 Harness 会话，可以用模型和推理强度。回答完会写进会话日志，也会被追踪。");
    this.modelSelect(dsh, "dsh", d.dsh.model, (v) => { d.dsh.model = v; p.saveSettings(); this.display(); });
    this.effortControl(dsh, "dsh", d.dsh.effort, (v) => { d.dsh.effort = v; p.saveSettings(); });
    const route = this.row(dsh, "自动允许工具调用", "ACP 模式下 Harness 会把权限请求发回插件。打开 = 自动允许一次；关掉 = 拒绝并在通知里提醒你。", null);
    this.toggle(route.querySelector(":scope > .ad-row__right"), d.dsh.autoApprove === true, (v) => { d.dsh.autoApprove = v; p.saveSettings(); });
    const dcwd = this.row(dsh, "工作目录", "留空 = 当前库根目录。", null);
    this.textInput(dcwd.querySelector(":scope > .ad-row__right"), d.dsh.cwd, "留空 = 库根目录", (v) => { d.dsh.cwd = v.trim(); p.saveSettings(); }, "ad-input--wide");
    const dextra = this.row(dsh, "额外 ACP 参数", "目前不用填；留给以后版本。", null);
    this.textInput(dextra.querySelector(":scope > .ad-row__right"), d.dsh.extraArgs, "可留空", (v) => { d.dsh.extraArgs = v; p.saveSettings(); }, "ad-input--wide");
    const dtest = dsh.createDiv({ cls: "ad-btnrow" });
    this.bigButton(dtest, "检查 dsh", async () => { const r = await p.checkBinary("dsh"); new Notice(r, 6000); });

    // Prompt
    const prompt = this.card(body, "提示词前后缀", "每次委派会把这一块（连同子块）原样发过去，这里的内容加在前后。");
    const pre = prompt.createDiv({ cls: "ad-field" });
    pre.createDiv({ cls: "ad-field__label", text: "前缀" });
    const preTa = pre.createEl("textarea", { cls: "ad-textarea", attr: { placeholder: "例如：先读一下相关文件，再动手。", rows: "2" } });
    preTa.value = d.promptPrefix || "";
    preTa.onchange = () => { d.promptPrefix = preTa.value; p.saveSettings(); };
    const suf = prompt.createDiv({ cls: "ad-field" });
    suf.createDiv({ cls: "ad-field__label", text: "后缀" });
    const sufTa = suf.createEl("textarea", { cls: "ad-textarea", attr: { placeholder: "例如：做完把改动文件列出来。", rows: "2" } });
    sufTa.value = d.promptSuffix || "";
    sufTa.onchange = () => { d.promptSuffix = sufTa.value; p.saveSettings(); };

    // Behaviour
    const beh = this.card(body, "写回笔记", "委派开始后，在任务下面写一行 🔗；完成后写一行 💬。");
    const r1 = this.row(beh, "把状态改成 DELEGATED", "保留原来的时刻和优先级。", null);
    this.toggle(r1.querySelector(":scope > .ad-row__right"), d.markStatus !== false, (v) => { d.markStatus = v; p.saveSettings(); });
    const r2 = this.row(beh, "写 🔗 绑定行", "删除这一行就等于解除绑定。", null);
    this.toggle(r2.querySelector(":scope > .ad-row__right"), d.writeLink !== false, (v) => { d.writeLink = v; p.saveSettings(); });
    const r3 = this.row(beh, "完成后写 💬 结论", "把 Agent 最后说的话压成一行。", null);
    this.toggle(r3.querySelector(":scope > .ad-row__right"), p.settings.autoWriteResult !== false, (v) => { p.settings.autoWriteResult = v; p.saveSettings(); });
    const r4 = this.row(beh, "💬 最多多少个字", "", null);
    this.numberInput(r4.querySelector(":scope > .ad-row__right"), p.settings.resultMax || 240, 40, 2000, (v) => { p.settings.resultMax = v; p.saveSettings(); });
  }

  modelSelect(parent, agent, value, onChange) {
    const row = this.row(parent, "模型", "只列开启的模型；更多在 Models 页里管理。", null);
    const sel = row.querySelector(":scope > .ad-row__right").createEl("select", { cls: "ad-select" });
    const models = this.plugin.modelsFor(agent).filter((m) => this.plugin.modelEnabled(m.id));
    if (!models.length) models.push(...this.plugin.modelsFor(agent));
    for (const m of models) {
      const o = sel.createEl("option", { text: m.name, attr: { value: m.id } });
      if (m.id === value) o.selected = true;
    }
    sel.onchange = () => onChange(sel.value);
    return sel;
  }

  effortControl(parent, agent, value, onChange) {
    const row = this.row(parent, "默认强度", "", null);
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
  modelsDraft() {
    if (!this.draft) this.draft = JSON.parse(JSON.stringify(this.plugin.settings.models));
    if (!this.draft.enabled) this.draft.enabled = [];
    if (!this.draft.pinned) this.draft.pinned = [];
    if (!this.draft.order) this.draft.order = [];
    if (!this.draft.custom) this.draft.custom = [];
    if (!this.draft.defaultByAgent) this.draft.defaultByAgent = { claude: "claude-sonnet-5", dsh: "deepseek-v4-pro" };
    return this.draft;
  }

  renderModels(body) {
    const p = this.plugin;
    const d = this.modelsDraft();
    const target = p.settings.delegate.target === "dsh" ? "dsh" : "claude";
    const models = p.allModels(d.custom);
    const enabled = new Set(d.enabled);
    const byId = new Map(models.map((m) => [m.id, m]));
    const defaultId = d.defaultByAgent[target] || (target === "dsh" ? "deepseek-v4-pro" : "claude-sonnet-5");
    const def = byId.get(defaultId) || models.find((m) => m.agent === target) || models[0];

    const intro = body.createDiv({ cls: "ad-models-intro" });
    intro.createDiv({ cls: "ad-models-title", text: "Models" });
    intro.createDiv({ cls: "ad-models-sub", text: "哪些模型出现在委派按钮里，每次从哪里开始，以及它想多深。" });

    // Defaults
    const defaults = body.createDiv({ cls: "ad-models-card" });
    const dhead = defaults.createDiv({ cls: "ad-models-sec" });
    dhead.createSpan({ cls: "ad-kicker", text: "Defaults" });
    const targetSeg = defaults.createDiv({ cls: "ad-models-target" });
    for (const id of ["claude", "dsh"]) {
      const a = AGENTS[id];
      const b = targetSeg.createEl("button", { cls: "ad-target ad-target--sm" + (target === id ? " is-on" : "") });
      b.style.setProperty("--ad-agent", a.color);
      b.style.setProperty("--ad-agent-soft", a.soft);
      agentIcon(b.createSpan({ cls: "ad-glyph" }), id);
      b.createSpan({ text: a.short });
      b.onclick = () => { p.settings.delegate.target = id; p.saveSettings(); this.display(); };
    }
    const defRow = defaults.createDiv({ cls: "ad-defrow" });
    const defLeft = defRow.createDiv({ cls: "ad-defrow__left" });
    defLeft.createDiv({ cls: "ad-defrow__name", text: "Default model" });
    defLeft.createDiv({ cls: "ad-defrow__desc", text: "New delegations start with this model." });
    const defRight = defRow.createDiv({ cls: "ad-defrow__right" });
    const pill = defRight.createEl("select", { cls: "ad-modelpill" });
    const candidates = models.filter((m) => m.agent === target && enabled.has(m.id));
    const pool = candidates.length ? candidates : models.filter((m) => m.agent === target);
    for (const m of pool) {
      const o = pill.createEl("option", { text: m.name, attr: { value: m.id } });
      if (m.id === def.id) o.selected = true;
    }
    pill.onchange = () => { d.defaultByAgent[target] = pill.value; this.display(); };
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
    const evalue = d.effort || "high";
    const eidx = Math.max(0, eopts.findIndex((x) => x.id === evalue));
    const etrack = effRight.createDiv({ cls: "ad-effort__track" });
    etrack.createDiv({ cls: "ad-effort__fill" }).style.width = `${(eidx / Math.max(1, eopts.length - 1)) * 100}%`;
    const estops = etrack.createDiv({ cls: "ad-effort__stops" });
    eopts.forEach((o, i) => {
      const b = estops.createEl("button", { cls: "ad-effort__stop" + (o.id === evalue ? " is-on" : ""), attr: { title: o.hint || "" } });
      b.createSpan({ cls: "ad-effort__dot" });
      b.onclick = () => { d.effort = o.id; this.display(); };
      const lab = effRight.createSpan({ cls: "ad-effort__lab", attr: { style: `left:${(i / Math.max(1, eopts.length - 1)) * 100}%` }, text: o.label });
    });
    const rec = effRight.createDiv({ cls: "ad-effort__rec" });
    rec.createSpan({ text: "Recommended" });
    const adv = rec.createEl("select", { cls: "ad-advselect" });
    for (const o of eopts) adv.createEl("option", { text: o.label, attr: { value: o.id } });
    adv.value = evalue;
    adv.onchange = () => { d.effort = adv.value; this.display(); };

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
    for (const agent of ["claude", "dsh"]) {
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
      list.createDiv({ cls: "ad-empty ad-empty--small", text: "没有符合条件的模型" });
    }
    const note = picker.createDiv({ cls: "ad-models-note", text: "Pinned models show first. Reorder from the row menu or with Alt + ↑/↓." });

    // Task models
    const tasks = body.createDiv({ cls: "ad-models-card" });
    const th = tasks.createDiv({ cls: "ad-models-sec" });
    th.createSpan({ cls: "ad-kicker", text: "Task models" });
    th.createSpan({ cls: "ad-models-sec__sub", text: "Smaller jobs that run behind a delegation." });
    for (const [id, label, desc] of [
      ["delegate", "Delegation", "Default for a task delegated from the editor."],
      ["naming", "Chat titles", "Used when the agent names a session it opened."],
      ["summary", "Summaries", "Used for the one-line result written under a task."],
    ]) {
      const row = tasks.createDiv({ cls: "ad-taskrow" });
      const left = row.createDiv({ cls: "ad-taskrow__left" });
      left.createDiv({ cls: "ad-taskrow__name", text: label });
      left.createDiv({ cls: "ad-taskrow__desc", text: desc });
      const sel = row.createEl("select", { cls: "ad-select ad-select--sm" });
      sel.createEl("option", { text: "Auto", attr: { value: "auto" } });
      for (const m of models) sel.createEl("option", { text: m.name, attr: { value: m.id } });
      sel.value = d.taskModels?.[id] || "auto";
      sel.onchange = () => { d.taskModels = { ...(d.taskModels || {}), [id]: sel.value }; this.display(); };
    }
    const foot = tasks.createDiv({ cls: "ad-models-note", text: "Auto lets the chosen agent decide. The model picker above is shared by both Claude Code and DeepSeek Harness." });
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
    for (const t of m.tags || []) meta.createSpan({ cls: "ad-cap", text: t });
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
      menu.addItem((it) => it.setTitle("Make default").setIcon("star").onClick(() => { d.defaultByAgent[m.agent] = m.id; this.display(); }));
      if ((m.custom || d.custom.some((x) => x.id === m.id))) {
        menu.addItem((it) => it.setTitle("Remove").setIcon("trash").onClick(() => {
          d.custom = d.custom.filter((x) => x.id !== m.id);
          d.enabled = d.enabled.filter((x) => x !== m.id);
          d.pinned = d.pinned.filter((x) => x !== m.id);
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
    // Also keep delegate defaults in sync with the chosen model.
    const dc = p.settings.delegate.claude, dd = p.settings.delegate.dsh;
    const cm = p.settings.models.defaultByAgent.claude;
    const dm = p.settings.models.defaultByAgent.dsh;
    if (cm) dc.model = cm;
    if (dm) dd.model = dm;
    if (p.settings.models.effort) {
      if (p.settings.delegate.claude.effort) p.settings.delegate.claude.effort = p.settings.models.effort;
      if (p.settings.delegate.dsh.effort) p.settings.delegate.dsh.effort = p.settings.models.effort;
    }
    p.saveSettings();
    new Notice("Models 已保存");
    this.display();
  }

  // ---------- Tracking ----------
  renderTracking(body) {
    const p = this.plugin;
    const s = p.settings;
    const c = this.card(body, "时间与扫描");
    const r1 = this.row(c, "日记日期分界", "这个时刻之前算前一天。和螺旋日程保持一致。", null);
    const cut = this.numberInput(r1.querySelector(":scope > .ad-row__right"), s.dayCutoff, 0, 12, (v) => { s.dayCutoff = v; p.saveSettings(); p.scheduleScan(); });
    const r2 = this.row(c, "每隔几秒扫描", "本机日志的轮询间隔。会话少的时候 20–30 秒就够。", null);
    this.numberInput(r2.querySelector(":scope > .ad-row__right"), s.pollSeconds, 5, 300, (v) => { s.pollSeconds = v; p.saveSettings(); p.scheduleScan(); });
    const r3 = this.row(c, "多久没动算安静", "和下一段之间超过这么多分钟，就不算同一段连续工作。", null);
    this.numberInput(r3.querySelector(":scope > .ad-row__right"), s.idleMinutes, 1, 120, (v) => { s.idleMinutes = v; p.saveSettings(); });
    const r4 = this.row(c, "主力读多少天历史", "只影响主力；非主力只读今天。", null);
    this.numberInput(r4.querySelector(":scope > .ad-row__right"), s.fullHistoryDays, 1, 365, (v) => { s.fullHistoryDays = v; p.saveSettings(); p.scanNow(true); });

    const ui = this.card(body, "界面");
    const mb = this.row(ui, "macOS 菜单栏", "在系统最上方显示一个小图标和一串简短说明；点开是会话详情和跳转。Obsidian 右下角不再显示 Agent 汇总。第一次启动会编译一个 Swift 小助手，需要 Xcode Command Line Tools。", null);
    this.toggle(mb.querySelector(":scope > .ad-row__right"), s.showMenuBar !== false, (v) => { s.showMenuBar = v; p.saveSettings(); p.applyUiSettings(); });
    for (const [key, label, desc, min, max] of [
      ["menuBarPrimaryLimit", "菜单栏：主力最多几个", "主力 Agent 全量追踪，所以可以多放几个会话。", 3, 12],
      ["menuBarOtherLimit", "菜单栏：其它 Agent 最多几个", "其它 Agent 只显示正在运行的会话。", 1, 6],
    ]) {
      const row = this.row(ui, label, desc, null);
      this.numberInput(row.querySelector(":scope > .ad-row__right"), s[key] || (key === "menuBarPrimaryLimit" ? 6 : 3), min, max, (v) => { s[key] = v; p.saveSettings(); p.refreshUI(); });
    }
    const mbbtn = this.row(ui, "菜单栏助手", "如果菜单栏没出现，或者改完设置想立刻重开。", null);
    const mbrestart = mbbtn.querySelector(":scope > .ad-row__right").createEl("button", { cls: "ad-btn", text: "重启菜单栏" });
    mbrestart.onclick = () => p.menubar?.restart();
    const nautRow = this.row(ui, "关闭螺旋日程右下角的 Agent 汇总", "Agent Deck 接管后，螺旋日程那一格 🤖 会隐藏；它自己的日程状态栏和计时照常。", null);
    this.toggle(nautRow.querySelector(":scope > .ad-row__right"), s.menuBarHideNautilus !== false, (v) => { s.menuBarHideNautilus = v; p.saveSettings(); if (v) p.hideNautilusAgentBar().catch(() => {}); else p.restoreNautilusAgentBar().catch(() => {}); });
    for (const [key, label, desc, fallback] of [
      ["showEditorPills", "任务行上的会话状态按钮", "只有已经绑定会话 / 委派出去的行才显示状态和进度；不再在每个条目上放「委派」按钮。", true],
      ["showRibbonIcon", "左侧栏图标", "点一下打开 Agent Deck。", true],
      ["openDashboardOnStartup", "启动时打开面板", "Obsidian 启动时自动打开 Agent Deck 侧栏。", false],
    ]) {
      const row = this.row(ui, label, desc, null);
      this.toggle(row.querySelector(":scope > .ad-row__right"), s[key] === undefined ? fallback : s[key] !== false, (v) => { s[key] = v; p.saveSettings(); p.applyUiSettings(); });
    }
    const bars = this.row(ui, "最近 14 天的条形图", "", null);
    this.toggle(bars.querySelector(":scope > .ad-row__right"), s.ui.showUsageBars !== false, (v) => { s.ui.showUsageBars = v; p.saveSettings(); p.refreshUI(); });
    const spark = this.row(ui, "每个 Agent 的小火花线", "", null);
    this.toggle(spark.querySelector(":scope > .ad-row__right"), s.ui.showSparkline !== false, (v) => { s.ui.showSparkline = v; p.saveSettings(); p.refreshUI(); });

    const data = this.card(body, "数据", "usage.json 存在插件目录里；日志删了历史还在。");
    const btn = data.createDiv({ cls: "ad-btnrow" });
    this.bigButton(btn, "重新启动菜单栏助手", () => p.menubar?.restart());
    this.bigButton(btn, "重新计算全部历史", () => p.rebuildUsage(), "mod-warning");
    this.bigButton(btn, "打开插件目录", () => p.openPluginDir());
    this.bigButton(btn, "导入螺旋日程的历史", () => p.importNautilus());
    const stats = data.createDiv({ cls: "ad-statline" });
    const days = Object.keys(p.store.days).length;
    stats.createSpan({ text: `${days} 天记录` });
    stats.createSpan({ cls: "ad-dot", text: "·" });
    stats.createSpan({ text: `${p.usage.meta.size} 个会话索引` });
    stats.createSpan({ cls: "ad-dot", text: "·" });
    stats.createSpan({ text: `${p.usage.files.size} 个日志文件` });

    const naut = this.card(body, "和螺旋日程并存", "螺旋日程也会读同一批 🔗 会话、改任务状态、写 💬。用 Agent Deck 接管后，可以把它的 AI 部分关掉，日程本身不动。");
    const nbtn = naut.createDiv({ cls: "ad-btnrow" });
    this.bigButton(nbtn, "停用螺旋日程里的 AI 追踪", () => p.pauseNautilus(), "mod-warning");

    const links = this.card(body, "点击会话时打开哪儿", "Claude Code 用 claude://resume 回到桌面版；WorkBuddy 用 workbuddy://chat/<会话号>；DeepSeek Harness 目前只有 dsh://open（聚焦客户端），插件会把会话号复制到剪贴板，方便你在侧栏里找。Codex 没有 URL，会复制 codex resume 命令。");
    links.createDiv({ cls: "ad-hint", text: "这些是客户端自己的 URL scheme，插件不读也不发任何网络请求。" });
  }

  // ---------- About ----------
  renderAbout(body) {
    const p = this.plugin;
    const c = this.card(body, "Agent Deck", "智能体甲板 · 在 Obsidian 里追踪和委派 AI Agent。");
    c.createDiv({ cls: "ad-about-p", text: "把螺旋日程里的人机协作追踪拆出来，做成一个独立插件：读本机的 Claude Code、Codex、WorkBuddy 和 DeepSeek Harness 会话日志，画出在跑、等你、安静，算时长和 token，并且可以从任务行直接委派。" });
    const list = c.createDiv({ cls: "ad-about-list" });
    for (const line of [
      "最多两个主力 Agent 全量追踪，其余只读今天。",
      "Claude Code 委派支持模型、强度、plan / auto / acceptEdits 权限模式。",
      "DeepSeek Harness 通过 dsh acp 开真正的会话，支持模型和推理强度。",
      "任务行上的按钮就是进度条：委派中沿按钮背景推进，可取消。",
      "模型设置分层：默认模型、默认强度、能力标签、搜索筛选、置顶排序、任务模型。",
      "点会话用 deeplink 打开客户端；Claude Code、WorkBuddy 已实现，DeepSeek Harness 目前聚焦客户端并复制会话号。",
    ]) {
      const r = list.createDiv({ cls: "ad-about-li" });
      r.createSpan({ cls: "ad-about-dot", text: "·" });
      r.createSpan({ text: line });
    }
    const meta = c.createDiv({ cls: "ad-about-meta" });
    meta.createDiv({ text: "版本 1.0.2 · MIT License" });
    meta.createDiv({ text: "从 Nautilus Spiral（螺旋日程）的 AI 追踪部分拆出；交互参考了小红书 @ZZ.X 的两条帖子。" });
    const btns = c.createDiv({ cls: "ad-btnrow" });
    this.bigButton(btns, "打开 GitHub 仓库", () => p.openExternal("https://github.com/MatsuriMW/obsidian-agent-deck"));
    this.bigButton(btns, "复制调试信息", async () => {
      const text = JSON.stringify({ version: "1.0.2", settings: p.settings, files: p.usage.files.size, sessions: p.usage.meta.size, errors: p.usage.errors }, null, 2);
      await navigator.clipboard.writeText(text);
      new Notice("调试信息已复制");
    });
  }
}

function strength(n, dots = false) {
  n = Math.max(0, Math.min(5, Number(n) || 0));
  if (dots) return "●".repeat(n) + "○".repeat(5 - n);
  return ["", "Very light", "Light", "Balanced", "Strong", "Deepest"][n] || "Balanced";
}

class AddModelModal extends Modal {
  constructor(app, plugin, onAdd) {
    super(app);
    this.plugin = plugin;
    this.onAdd = onAdd;
    this.agent = "dsh";
    this.name = "";
    this.route = "deepseek-account";
    this.model = "";
    this.context = "128K";
    this.tags = "Reasoning";
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("ad-modal");
    contentEl.createEl("h3", { text: "Add model" });
    contentEl.createDiv({ cls: "ad-muted", text: "给委派按钮加一个模型。Claude 用命令行的别名或全名；DeepSeek Harness 用 ACP 的 provider / model。" });
    const form = contentEl.createDiv({ cls: "ad-form" });
    const field = (label, el) => { const f = form.createDiv({ cls: "ad-field" }); f.createDiv({ cls: "ad-field__label", text: label }); el(f); };
    field("显示名", (f) => { const i = f.createEl("input", { cls: "ad-input", attr: { placeholder: "例如 DeepSeek-V4-Pro" } }); i.oninput = () => this.name = i.value; });
    field("Agent", (f) => {
      const s = f.createEl("select", { cls: "ad-select" });
      for (const id of ["claude", "dsh"]) s.createEl("option", { text: AGENTS[id].name, attr: { value: id } });
      s.value = this.agent;
      s.onchange = () => { this.agent = s.value; };
    });
    field("Provider route（DSH）", (f) => { const i = f.createEl("input", { cls: "ad-input", attr: { value: this.route } }); i.oninput = () => this.route = i.value; });
    field("Model / alias", (f) => { const i = f.createEl("input", { cls: "ad-input", attr: { placeholder: "例如 deepseek-v4-pro 或 opus" } }); i.oninput = () => this.model = i.value; });
    field("上下文", (f) => { const i = f.createEl("input", { cls: "ad-input", attr: { value: this.context } }); i.oninput = () => this.context = i.value; });
    field("能力标签", (f) => { const i = f.createEl("input", { cls: "ad-input", attr: { value: this.tags, placeholder: "Reasoning, Fast, Vision" } }); i.oninput = () => this.tags = i.value; });
    const bar = contentEl.createDiv({ cls: "ad-btnrow ad-btnrow--end" });
    const cancel = bar.createEl("button", { cls: "ad-btn ad-btn--ghost", text: "Cancel" });
    cancel.onclick = () => this.close();
    const add = bar.createEl("button", { cls: "ad-btn ad-btn--cta", text: "Add" });
    add.onclick = () => {
      const name = this.name.trim() || this.model.trim();
      if (!name || !this.model.trim()) return new Notice("显示名和 model 至少填一个");
      const id = `custom-${this.agent}-${this.model.trim().replace(/[^a-z0-9]+/gi, "-")}`;
      const m = {
        id, agent: this.agent, name,
        cli: this.agent === "claude" ? this.model.trim() : undefined,
        value: this.agent === "dsh" ? JSON.stringify([this.route.trim() || "deepseek-account", this.model.trim()]) : this.model.trim(),
        provider: this.agent === "dsh" ? (this.route.trim() || "DeepSeek") : "Claude",
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
