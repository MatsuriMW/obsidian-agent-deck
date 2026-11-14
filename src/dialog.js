// Agent Deck — the per-delegation options sheet.

import { Modal, Notice } from "obsidian";
import { AGENTS, EFFORTS, CLAUDE_PERMISSIONS, DEFAULTS } from "./constants.js";
import { agentIcon, setLucide } from "./icons.js";
import { lattice } from "./lattice.js";
import { blockAt, blockTitle, BULLET_RE, delegationText } from "./delegation.js";
import { mentionOptions, mentionTrigger } from "./task-mentions.js";
import { destinations, defaultDestination } from "./workflow.js";
import { kwLine, fencedLines } from "./journal.js";
import { t } from "./i18n.js";
import { archivePath } from "./journal-archive.js";

export class DelegateOptionsModal extends Modal {
  constructor(app, plugin, path, line) {
    super(app);
    this.plugin = plugin;
    this.path = path;
    this.line = line;
    this.agent = plugin.defaultTarget();
    this.model = plugin.defaultModel(this.agent);
    this.effort = plugin.settings.delegate[this.agent]?.effort || "high";
    this.permission = plugin.settings.delegate.claude.permission || "auto";
    this.destination = defaultDestination(plugin, this.agent);
    this.cwd = "";
    this.suffix = plugin.settings.delegate.promptSuffix || "";
    this.block = null;
    this.file = null;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.addClass("ad-modal");
    contentEl.addClass("ad-delegate");
    const file = this.app.vault.getAbstractFileByPath(this.path);
    if (!file) { contentEl.createDiv({ text: t("找不到这篇笔记") }); return; }
    this.file = file;
    const text = await this.plugin.readNote(file.path);
    const lines = text.split("\n");
    this.block = blockAt(lines, this.line);
    this.lines = lines;
    if (!this.block) { contentEl.createDiv({ text: t("光标要放在一个列表项里") }); return; }
    try {
      const selected = mentionOptions(this.plugin, { block: this.block, agent: this.agent });
      this.agent = selected.agent;
      this.model = selected.model || this.plugin.defaultModel(this.agent);
      this.effort = selected.effort || this.plugin.settings.delegate[this.agent]?.effort || "high";
    } catch (e) { new Notice(e.message); this.close(); return; }
    this.render();
  }

  render() {
    const { contentEl } = this;
    const p = this.plugin;
    contentEl.empty();
    const head = contentEl.createDiv({ cls: "ad-modalhead" });
    const title = head.createDiv({ cls: "ad-modalhead__title", text: "Delegate this block" });
    const sub = head.createDiv({ cls: "ad-modalhead__sub", text: `${blockTitle(this.block, mentionTrigger(p)).slice(0, 80)} · ${this.path}` });

    const preview = contentEl.createDiv({ cls: "ad-preview" });
    const pre = preview.createEl("pre", { cls: "ad-preview__text" });
    const full = delegationText(this.lines || [], this.block);
    const fullLines = full.split("\n");
    pre.textContent = fullLines.slice(0, 6).join("\n") + (fullLines.length > 6 ? "\n…" : "");

    // Target
    const target = contentEl.createDiv({ cls: "ad-field" });
    target.createDiv({ cls: "ad-field__label", text: "Delegate to" });
    const targets = target.createDiv({ cls: "ad-targetpick" });
    for (const id of ["claude", "codex", "dsh", "antigravity"]) {
      const a = AGENTS[id];
      const b = targets.createEl("button", { cls: "ad-target ad-target--sm" + (this.agent === id ? " is-on" : "") });
      b.style.setProperty("--ad-agent", a.color);
      b.style.setProperty("--ad-agent-soft", a.soft);
      agentIcon(b.createSpan({ cls: "ad-glyph" }), id);
      b.createSpan({ text: a.short });
      b.createSpan({ cls: "ad-target__hint", text: id === "claude" ? t("桌面版") : id === "codex" ? (p.settings.delegate.codex.transport === "terminal" ? t("CLI / 终端") : t("首轮后打开桌面版")) : "ACP" });
      b.onclick = () => { this.agent = id; this.model = p.defaultModel(id); this.effort = p.settings.delegate[id]?.effort || "high"; this.destination = defaultDestination(p, id); this.render(); };
    }

    destinationPicker(contentEl, this.agent, this.destination, (v) => { this.destination = v; });

    // Model
    const mf = contentEl.createDiv({ cls: "ad-field" });
    mf.createDiv({ cls: "ad-field__label", text: "Model" });
    const models = p.modelsFor(this.agent).filter((m) => p.modelEnabled(m.id) || m.id === this.model);
    const grid = mf.createDiv({ cls: "ad-modelpick" });
    for (const m of models) {
      const b = grid.createEl("button", { cls: "ad-modelpick__item" + (this.model === m.id ? " is-on" : "") });
      const top = b.createDiv({ cls: "ad-modelpick__top" });
      top.createSpan({ cls: "ad-modelpick__name", text: m.name });
      if (m.cost) top.createSpan({ cls: "ad-modelpick__cost", text: m.cost.replace(" cost", "") });
      const meta = b.createDiv({ cls: "ad-modelpick__meta" });
      meta.createSpan({ text: m.context });
      for (const tag of m.tags || []) meta.createSpan({ cls: "ad-cap", text: tag });
      b.onclick = () => { this.model = m.id; this.render(); };
    }

    if (["dsh", "antigravity"].includes(this.agent)) {
      const refresh = mf.createEl("button", { cls: "ad-btn", text: t("读取 {agent} 可用模型", { agent: AGENTS[this.agent].name }) });
      refresh.onclick = async () => {
        refresh.disabled = true;
        try { await p.refreshAcpModels(this.agent); this.render(); }
        catch (e) { new Notice(e.message); refresh.disabled = false; }
      };
    }

    // Effort
    const ef = contentEl.createDiv({ cls: "ad-field" });
    ef.createDiv({ cls: "ad-field__label", text: "Effort" });
    const opts = EFFORTS[this.agent] || EFFORTS.claude;
    const ewrap = ef.createDiv({ cls: "ad-effort ad-effort--big" });
    const track = ewrap.createDiv({ cls: "ad-effort__track" });
    const idx = Math.max(0, opts.findIndex((x) => x.id === this.effort));
    track.createDiv({ cls: "ad-effort__fill" }).style.width = `${(idx / Math.max(1, opts.length - 1)) * 100}%`;
    const stops = track.createDiv({ cls: "ad-effort__stops" });
    opts.forEach((o, i) => {
      const b = stops.createEl("button", { cls: "ad-effort__stop" + (o.id === this.effort ? " is-on" : "") });
      b.createSpan({ cls: "ad-effort__dot" });
      b.onclick = () => { this.effort = o.id; this.render(); };
      ewrap.createSpan({ cls: "ad-effort__lab", attr: { style: `left:${(i / Math.max(1, opts.length - 1)) * 100}%` }, text: o.label });
    });

    // Permission
    if (this.agent === "claude") {
      const pf = contentEl.createDiv({ cls: "ad-field" });
      pf.createDiv({ cls: "ad-field__label", text: "Mode" });
      const seg = pf.createDiv({ cls: "ad-seg" });
      for (const o of CLAUDE_PERMISSIONS) {
        const b = seg.createEl("button", { cls: "ad-seg__btn" + (this.permission === o.id ? " is-on" : ""), text: o.label });
        b.title = o.hint;
        b.onclick = () => { this.permission = o.id; this.render(); };
      }
      pf.createDiv({ cls: "ad-hint", text: CLAUDE_PERMISSIONS.find((x) => x.id === this.permission)?.hint || "" });
    } else if (this.agent === "dsh") {
      const af = contentEl.createDiv({ cls: "ad-field" });
      const row = af.createDiv({ cls: "ad-minirow" });
      row.createSpan({ text: "Auto-approve tool calls" });
      const b = row.createEl("button", { cls: "ad-switch" + (p.settings.delegate.dsh.autoApprove ? " is-on" : "") });
      b.createSpan({ cls: "ad-switch__knob" });
      b.onclick = () => { p.settings.delegate.dsh.autoApprove = !p.settings.delegate.dsh.autoApprove; p.saveSettings(); this.render(); };
      af.createDiv({ cls: "ad-hint", text: t("ACP 模式没有 plan/auto 这个切换；关掉自动允许时，Harness 的权限请求会在 Obsidian 中逐次确认。") });
    }

    if (this.agent === "antigravity") contentEl.createDiv({ cls: "ad-hint", text: t("通过 agy acp 委派，工具请求会在 Obsidian 中逐次确认；完成后可打开会话正文继续追问。推理强度以当前模型支持的值为准。") });

    // Working directory
    const cf = contentEl.createDiv({ cls: "ad-field" });
    cf.createDiv({ cls: "ad-field__label", text: "Working directory" });
    const cwd = cf.createEl("input", { cls: "ad-input", attr: { placeholder: p.vaultPath, value: this.cwd } });
    cwd.oninput = () => { this.cwd = cwd.value; };
    cf.createDiv({ cls: "ad-hint", text: t("留空 = 插件设置里的目录（默认是库根目录）。") });

    // Suffix
    const sf = contentEl.createDiv({ cls: "ad-field" });
    sf.createDiv({ cls: "ad-field__label", text: "Prompt suffix" });
    const ta = sf.createEl("textarea", { cls: "ad-textarea", attr: { rows: "2", placeholder: t("加在这次委派最后的话") } });
    ta.value = this.suffix;
    ta.oninput = () => { this.suffix = ta.value; };

    const foot = contentEl.createDiv({ cls: "ad-modalfoot" });
    const cancel = foot.createEl("button", { cls: "ad-btn ad-btn--ghost", text: "Cancel" });
    cancel.onclick = () => this.close();
    const go = foot.createEl("button", { cls: "ad-btn ad-btn--cta ad-btn--delegate" });
    go.createSpan({ cls: "ad-btn__fill" });
    const goIcon = go.createSpan({ cls: "ad-btn__icon" });
    setLucide(goIcon, "send");
    go.createSpan({ cls: "ad-btn__label", text: "Delegate" });
    go.onclick = async () => {
      go.classList.add("is-busy");
      go.setAttr("disabled", "true");
      const label = go.querySelector(".ad-btn__label");
      label.textContent = "Delegating";
      goIcon.textContent = "";
      lattice(goIcon, "orbit");
      try {
        const job = await p.delegator.delegate({
          ignoreMention: true,
          destination: this.destination,
          file: this.file,
          lines: this.lines,
          block: this.block,
          agent: this.agent,
          model: this.model,
          effort: this.effort,
          permission: this.agent === "claude" ? this.permission : "",
          cwd: this.cwd.trim(),
          promptSuffix: this.suffix,
          name: blockTitle(this.block, mentionTrigger(p)),
        });
        this.close();
      } catch (e) {
        go.classList.remove("is-busy");
        go.removeAttribute("disabled");
        setLucide(goIcon, "send");
        label.textContent = "Delegate";
        new Notice(String(e.message || e), 6000);
      }
    };
  }

  onClose() { this.contentEl.empty(); }
}

// 把手单击后的确认：看一眼要发出去的整块，再发给主力
export class ConfirmSendModal extends Modal {
  constructor(app, { agent, text, path, where, destination, newSession = false, context = [] }, onSend) {
    super(app);
    this.agent = agent;
    this.text = text;
    this.path = path;
    this.where = where;
    this.destination = destination || destinations(agent)[0]?.id;
    this.newSession = newSession;
    this.context = context || [];
    this.onSend = onSend;
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    const a = AGENTS[this.agent] || AGENTS.claude;
    modalEl.addClass("ad-send-modal");
    contentEl.addClass("ad-modal", "ad-send");
    contentEl.style.setProperty("--ad-agent", a.color);
    contentEl.style.setProperty("--ad-agent-soft", a.soft);

    const head = contentEl.createDiv({ cls: "ad-send__head" });
    agentIcon(head.createSpan({ cls: "ad-send__mark" }), this.agent);
    const tt = head.createDiv({ cls: "ad-send__titles" });
    tt.createDiv({ cls: "ad-send__title", text: this.newSession ? t("重新委派给 {agent}", { agent: a.name }) : t("发给 {agent}", { agent: a.name }) });
    tt.createDiv({ cls: "ad-send__sub", text: this.where });

    destinationPicker(contentEl, this.agent, this.destination, (v) => { this.destination = v; });
    if (this.newSession) contentEl.createDiv({ cls: "ad-hint", text: t("这次将新建会话，原会话及记录保留。") });

    // 要发出去的整块：按缩进画成一张小卡片，母项在上面当上下文，最里面那行是这次要做的
    const card = contentEl.createDiv({ cls: "ad-send__card" });
    const ctx = this.context.filter((l) => l && l.trim());
    const lines = [...ctx, ...this.text.split("\n")].filter((l) => l.trim());
    const base = lines.length ? indentOf(lines[0]) : 0;
    lines.forEach((raw, i) => {
      const m = BULLET_RE.exec(raw);
      const k = kwLine(raw);
      const body = k ? k.body : (m ? m[3] : raw.trim());
      const row = card.createDiv({ cls: "ad-send__line" + (i === ctx.length ? " is-title" : "") });
      row.style.setProperty("--lvl", String(Math.max(0, indentOf(raw) - base)));
      row.createSpan({ cls: "ad-send__dot" });
      if (i === ctx.length && k && k.kw) row.createSpan({ cls: "ad-send__kw", text: k.kw });
      row.createSpan({ cls: "ad-send__text", text: body });
    });
    const more = this.text.split("\n").filter((l) => l.trim()).length - 1;
    const meta = contentEl.createDiv({ cls: "ad-send__meta" });
    if (ctx.length) {
      const fenced = fencedLines(ctx);
      meta.createSpan({ text: t("带上 {n} 层母项作为上下文", { n: ctx.filter((line, i) => !fenced.has(i) && BULLET_RE.test(line)).length }) });
    }
    meta.createSpan({ text: more > 0 ? t("连同 {n} 行子块，作为一条消息", { n: more }) : t("作为一条消息") });
    meta.createSpan({ cls: "ad-send__path", text: this.path });

    const foot = contentEl.createDiv({ cls: "ad-send__foot" });
    const btns = foot.createDiv({ cls: "ad-send__btns" });
    btns.createEl("button", { cls: "ad-btn ad-btn--ghost", text: t("取消") }).onclick = () => this.close();
    const go = btns.createEl("button", { cls: "ad-btn ad-send__go" });
    setLucide(go.createSpan({ cls: "ad-btn__icon" }), "send");
    go.createSpan({ text: t("发送") });
    go.onclick = () => { this.close(); this.onSend(this.destination); };
    setTimeout(() => go.focus(), 0);   // 回车直接发
  }

  onClose() { this.contentEl.empty(); }
}

// 缩进层级：一个 tab 或两个空格算一层
function indentOf(line) {
  const ws = (line.match(/^[ \t]*/) || [""])[0];
  return ws.replace(/\t/g, "  ").length / 2;
}

function destinationPicker(parent, agent, value, onChange) {
  const field = parent.createDiv({ cls: "ad-field" });
  field.createDiv({ cls: "ad-field__label", text: t("接下来在哪里工作") });
  const options = destinations(agent);
  const select = field.createEl("select", { cls: "ad-input ad-input--wide", attr: { "aria-label": t("接下来在哪里工作") } });
  for (const option of options) select.createEl("option", { text: option.label, attr: { value: option.id } });
  select.value = options.some(o => o.id === value) ? value : options[0]?.id;
  const hint = field.createDiv({ cls: "ad-hint" });
  const update = () => { hint.textContent = options.find(o => o.id === select.value)?.hint || ""; onChange(select.value); };
  select.onchange = update;
  update();
}

// Pick where finished AI blocks go. The order (prepend/append) lives in the
// settings; this sheet only chooses the file, defaulting to the last used one.
export class ArchiveTargetModal extends Modal {
  constructor(app, plugin, file, base, plan) {
    super(app);
    this.plugin = plugin;
    this.file = file;
    this.base = base;
    this.plan = plan;
    this.path = plugin.settings.doneArchivePath || DEFAULTS.doneArchivePath;
  }

  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass("ad-send-modal");
    contentEl.addClass("ad-modal", "ad-send");

    const head = contentEl.createDiv({ cls: "ad-send__head" });
    const tt = head.createDiv({ cls: "ad-send__titles" });
    tt.createDiv({ cls: "ad-send__title", text: t("归档已完成的日志") });
    tt.createDiv({ cls: "ad-send__sub", text: this.file.path });

    const count = (this.plan.done || []).filter((entry) => entry.ai).length;
    const meta = contentEl.createDiv({ cls: "ad-send__meta" });
    meta.createSpan({ text: t("{n} 个已完成的 AI 任务将被移出这篇日记", { n: count }) });

    const field = contentEl.createDiv({ cls: "ad-field" });
    field.createDiv({ cls: "ad-field__label", text: t("归档到哪个文件") });
    const input = field.createEl("input", { cls: "ad-input ad-input--wide", attr: { type: "text", spellcheck: "false", placeholder: DEFAULTS.doneArchivePath } });
    input.value = this.path;
    const error = field.createDiv({ cls: "ad-hint" });

    const order = this.plugin.settings.archiveOrder === "append" ? t("追加到文件末尾") : t("插到文件开头");
    field.createDiv({ cls: "ad-hint", text: t("写入顺序：{order}（在 设置 → 追踪 里改）", { order }) });

    // Vault suggestions; the first few matches are enough, the field stays free text.
    const sugg = contentEl.createDiv({ cls: "ad-hint" });
    const all = () => this.app.vault.getMarkdownFiles().map((f) => f.path).sort();
    let files = all();
    const render = () => {
      sugg.empty();
      const q = input.value.trim().toLowerCase();
      const hits = files.filter((p) => !q || p.toLowerCase().includes(q)).slice(0, 6);
      for (const p of hits) {
        if (p === input.value.trim()) continue;
        const b = sugg.createEl("button", { cls: "ad-btn ad-btn--ghost", text: p });
        b.onclick = (e) => { e.preventDefault(); input.value = p; render(); };
      }
    };
    input.addEventListener("input", render);
    render();

    const foot = contentEl.createDiv({ cls: "ad-send__foot" });
    const btns = foot.createDiv({ cls: "ad-send__btns" });
    btns.createEl("button", { cls: "ad-btn ad-btn--ghost", text: t("取消") }).onclick = () => this.close();
    const go = btns.createEl("button", { cls: "ad-btn ad-send__go" });
    setLucide(go.createSpan({ cls: "ad-btn__icon" }), "archive");
    go.createSpan({ text: t("归档") });
    go.onclick = () => {
      let target;
      try { target = archivePath(input.value); } catch (e) { error.setText(e.message); return; }
      this.close();
      this.plugin.archiveJournalTo(this.file, this.base, this.plan, target);
    };
    setTimeout(() => input.focus(), 0);
  }

  onClose() { this.contentEl.empty(); }
}
