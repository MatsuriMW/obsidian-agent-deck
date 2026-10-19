// Agent Deck — the per-delegation options sheet.

import { Modal, Notice, setIcon } from "obsidian";
import { AGENTS, EFFORTS, CLAUDE_PERMISSIONS, fmtTok } from "./constants.js";
import { blockAt, blockTitle } from "./delegation.js";

export class DelegateOptionsModal extends Modal {
  constructor(app, plugin, path, line) {
    super(app);
    this.plugin = plugin;
    this.path = path;
    this.line = line;
    this.agent = plugin.defaultTarget();
    this.model = plugin.defaultModel(this.agent);
    this.effort = this.agent === "dsh" ? (plugin.settings.delegate.dsh.effort || "high") : (plugin.settings.delegate.claude.effort || "high");
    this.permission = plugin.settings.delegate.claude.permission || "auto";
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
    if (!file) { contentEl.createDiv({ text: "找不到这篇笔记" }); return; }
    this.file = file;
    const text = await this.app.vault.read(file);
    const lines = text.split("\n");
    this.block = blockAt(lines, this.line);
    this.lines = lines;
    if (!this.block) { contentEl.createDiv({ text: "光标要放在一个列表项里" }); return; }
    this.render();
  }

  render() {
    const { contentEl } = this;
    const p = this.plugin;
    contentEl.empty();
    const head = contentEl.createDiv({ cls: "ad-modalhead" });
    const title = head.createDiv({ cls: "ad-modalhead__title", text: "Delegate this block" });
    const sub = head.createDiv({ cls: "ad-modalhead__sub", text: `${blockTitle(this.block).slice(0, 80)} · ${this.path}` });

    const preview = contentEl.createDiv({ cls: "ad-preview" });
    const pre = preview.createEl("pre", { cls: "ad-preview__text" });
    pre.textContent = this.block.text.split("\n").slice(0, 6).join("\n") + (this.block.text.split("\n").length > 6 ? "\n…" : "");

    // Target
    const target = contentEl.createDiv({ cls: "ad-field" });
    target.createDiv({ cls: "ad-field__label", text: "Delegate to" });
    const targets = target.createDiv({ cls: "ad-targetpick" });
    for (const id of ["claude", "dsh"]) {
      const a = AGENTS[id];
      const b = targets.createEl("button", { cls: "ad-target ad-target--sm" + (this.agent === id ? " is-on" : "") });
      b.style.setProperty("--ad-agent", a.color);
      b.style.setProperty("--ad-agent-soft", a.soft);
      b.createSpan({ cls: "ad-glyph", text: a.glyph });
      b.createSpan({ text: a.short });
      b.createSpan({ cls: "ad-target__hint", text: id === "claude" ? "桌面版" : "ACP" });
      b.onclick = () => { this.agent = id; this.model = p.defaultModel(id); this.effort = id === "dsh" ? (p.settings.delegate.dsh.effort || "high") : (p.settings.delegate.claude.effort || "high"); this.render(); };
    }

    // Model
    const mf = contentEl.createDiv({ cls: "ad-field" });
    mf.createDiv({ cls: "ad-field__label", text: "Model" });
    const models = p.modelsFor(this.agent).filter((m) => p.modelEnabled(m.id));
    const grid = mf.createDiv({ cls: "ad-modelpick" });
    for (const m of models) {
      const b = grid.createEl("button", { cls: "ad-modelpick__item" + (this.model === m.id ? " is-on" : "") });
      const top = b.createDiv({ cls: "ad-modelpick__top" });
      top.createSpan({ cls: "ad-modelpick__name", text: m.name });
      if (m.cost) top.createSpan({ cls: "ad-modelpick__cost", text: m.cost.replace(" cost", "") });
      const meta = b.createDiv({ cls: "ad-modelpick__meta" });
      meta.createSpan({ text: m.context });
      for (const t of m.tags || []) meta.createSpan({ cls: "ad-cap", text: t });
      b.onclick = () => { this.model = m.id; this.render(); };
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
    } else {
      const af = contentEl.createDiv({ cls: "ad-field" });
      const row = af.createDiv({ cls: "ad-minirow" });
      row.createSpan({ text: "Auto-approve tool calls" });
      const b = row.createEl("button", { cls: "ad-switch" + (p.settings.delegate.dsh.autoApprove ? " is-on" : "") });
      b.createSpan({ cls: "ad-switch__knob" });
      b.onclick = () => { p.settings.delegate.dsh.autoApprove = !p.settings.delegate.dsh.autoApprove; p.saveSettings(); this.render(); };
      af.createDiv({ cls: "ad-hint", text: "ACP 模式没有 plan/auto 这个切换；关掉自动允许时，Harness 的权限请求会被拒绝并提醒你。" });
    }

    // Working directory
    const cf = contentEl.createDiv({ cls: "ad-field" });
    cf.createDiv({ cls: "ad-field__label", text: "Working directory" });
    const cwd = cf.createEl("input", { cls: "ad-input", attr: { placeholder: p.vaultPath, value: this.cwd } });
    cwd.oninput = () => { this.cwd = cwd.value; };
    cf.createDiv({ cls: "ad-hint", text: "留空 = 插件设置里的目录（默认是库根目录）。" });

    // Suffix
    const sf = contentEl.createDiv({ cls: "ad-field" });
    sf.createDiv({ cls: "ad-field__label", text: "Prompt suffix" });
    const ta = sf.createEl("textarea", { cls: "ad-textarea", attr: { rows: "2", placeholder: "加在这次委派最后的话" } });
    ta.value = this.suffix;
    ta.oninput = () => { this.suffix = ta.value; };

    const foot = contentEl.createDiv({ cls: "ad-modalfoot" });
    const cancel = foot.createEl("button", { cls: "ad-btn ad-btn--ghost", text: "Cancel" });
    cancel.onclick = () => this.close();
    const go = foot.createEl("button", { cls: "ad-btn ad-btn--cta ad-btn--delegate" });
    go.createSpan({ cls: "ad-btn__fill" });
    go.createSpan({ cls: "ad-btn__label", text: "Delegate" });
    go.onclick = async () => {
      go.classList.add("is-busy");
      go.setAttr("disabled", "true");
      const label = go.querySelector(".ad-btn__label");
      label.textContent = "Delegating";
      try {
        const job = await p.delegator.delegate({
          file: this.file,
          lines: this.lines,
          block: this.block,
          agent: this.agent,
          model: this.model,
          effort: this.effort,
          permission: this.agent === "claude" ? this.permission : "",
          cwd: this.cwd.trim(),
          promptSuffix: this.suffix,
          name: blockTitle(this.block),
        });
        this.close();
      } catch (e) {
        go.classList.remove("is-busy");
        go.removeAttribute("disabled");
        label.textContent = "Delegate";
        new Notice(String(e.message || e), 6000);
      }
    };
  }

  onClose() { this.contentEl.empty(); }
}
