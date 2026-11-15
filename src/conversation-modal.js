import { canOpenClient } from "./workflow.js";
import { Modal, Notice, MarkdownRenderer, Component } from "obsidian";
import { readConversation, archiveConversation } from "./conversation.js";
import { AGENTS } from "./constants.js";
import { t } from "./i18n.js";

export class ConversationModal extends Modal {
  constructor(app, plugin, session) {
    super(app);
    this.plugin = plugin; this.session = session; this.cache = new Map();
  }
  onOpen() {
    const el = this.contentEl;
    el.addClass("ad-conversation");
    el.createEl("h2", { text: this.session.title || this.session.name || t("会话正文") });
    const actions = el.createDiv({ cls: "ad-btnrow" });
    const refresh = actions.createEl("button", { text: t("刷新正文") });
    refresh.onclick = () => this.load();
    if (canOpenClient(this.session)) actions.createEl("button", { text: t("在客户端打开") }).onclick = () => this.plugin.openClientSession(this.session);
    const archive = actions.createEl("button", { text: t("保存对话到笔记") });
    archive.onclick = async () => {
      archive.disabled = true;
      try {
        const file = await archiveConversation(this.plugin, this.session);
        await this.app.workspace.getLeaf(false).openFile(file);
        new Notice(t("已归档：{path}", { path: file.path }));
      } catch (e) { new Notice(e.message); }
      finally { archive.disabled = false; }
    };
    this.scope.register(["Mod"], "s", (event) => { event.preventDefault(); if (!archive.disabled) archive.click(); return false; });
    archive.title = t("保存对话（⌘S / Ctrl+S）");
    el.createDiv({
      cls: "ad-hint",
      text: this.session.agent === "cursor"
        ? t("保存用户消息、工具调用时间线与回复正文；长工具结果默认折叠。")
        : t("保存用户消息与回复正文；会话可继续，任务状态不受影响。工具结果、内部推理和附件不包含在内。"),
    });
    this.messagesEl = el.createDiv({ cls: "ad-conversation__messages" });
    el.createDiv({ cls: "ad-hint", text: t("此 Agent 的续聊请在原客户端完成。") });
    this.load();
    this.timer = setInterval(() => this.load(), 2000);
  }
  async load() {
    if (this.loading || !this.messagesEl) return;
    this.loading = true;
    try {
      const messages = await readConversation(this.plugin, this.session, this.cache);
      const job = Object.values(this.plugin.jobs).find((j) => j.agent === this.session.agent && j.sessionId === (this.session.sid || this.session.sessionId));
      if (job?.state === "running" && job.lastText) messages.push({ role: "assistant", text: this.plugin.delegator.runners.get(job.id)?.assistantText || job.lastText });
      const signature = JSON.stringify([messages, job?.state, job?.error]);
      if (this.closed || signature === this.signature) return;
      this.signature = signature;
      this.renderComponent?.unload();
      this.renderComponent = new Component(); this.renderComponent.load();
      this.messagesEl.empty();
      if (!messages.length) this.messagesEl.createDiv({ text: t("暂未读到正文。可先扫描本机会话，再刷新。") });
      for (const m of messages) {
        const item = this.messagesEl.createDiv({ cls: "ad-conversation__message" });
        item.createEl("h3", { text: m.role === "user" ? t("用户") : "Agent" });
        if (m.text) {
          await MarkdownRenderer.render(this.app, m.text, item.createDiv(), "", this.renderComponent);
          if (this.closed) return;
        }
        if (Array.isArray(m.tools) && m.tools.length) this.renderTools(item, m.tools);
      }
      if (job?.state === "error") this.messagesEl.createDiv({ text: t("本轮失败：{error}", { error: job.error }) });
      if (["starting", "running", "needs-approval"].includes(job?.state)) this.messagesEl.createDiv({ text: job?.state === "needs-approval" ? t("等待工具权限确认…") : t("正在回复…") });
    } catch (e) { if (!this.closed) this.messagesEl.setText(t("读取失败：{error}", { error: e.message })); }
    finally { this.loading = false; }
  }
  renderTools(parent, tools) {
    const wrap = parent.createDiv({ cls: "ad-tool-timeline" });
    wrap.createDiv({ cls: "ad-tool-timeline__title", text: t("工具时间线（{count}）", { count: tools.length }) });
    const glyph = { success: "✓", error: "✗", interrupted: "⏸", missing: "?", running: "⋯" };
    const label = {
      success: t("成功"),
      error: t("失败"),
      interrupted: t("中断"),
      missing: t("结果缺失"),
      running: t("执行中"),
    };
    for (const tool of tools) {
      const row = wrap.createDiv({ cls: `ad-tool-item is-${tool.status || "running"}` });
      const head = row.createDiv({ cls: "ad-tool-item__head" });
      head.createSpan({ cls: "ad-tool-item__glyph", text: glyph[tool.status] || "•" });
      head.createEl("strong", { text: tool.name || "tool" });
      head.createSpan({ cls: "ad-tool-item__status", text: label[tool.status] || tool.status || "" });
      if (tool.durationMs > 0) head.createSpan({ cls: "ad-tool-item__dur", text: `${tool.durationMs}ms` });
      const inp = tool.input === undefined || tool.input === null ? "" : typeof tool.input === "string" ? tool.input : JSON.stringify(tool.input, null, 2);
      if (inp) {
        if (inp.length > 180 || inp.includes("\n")) {
          const det = row.createEl("details", { cls: "ad-tool-item__details" });
          det.createEl("summary", { text: t("查看工具参数") });
          det.createEl("pre", { text: inp });
        } else {
          row.createDiv({ cls: "ad-tool-item__input", text: inp });
        }
      }
      if (tool.missingResult) {
        row.createDiv({ cls: "ad-tool-item__missing", text: t("未采集到工具结果") });
      } else if (tool.error) {
        row.createDiv({ cls: "ad-tool-item__error", text: String(tool.error) });
      } else if (tool.output) {
        const out = String(tool.output);
        if (out.length > 240 || out.split("\n").length > 4) {
          const det = row.createEl("details", { cls: "ad-tool-item__details" });
          det.createEl("summary", { text: t("展开工具结果（{count} 字符）", { count: tool.outputLength || out.length }) });
          det.createEl("pre", { text: out });
        } else {
          row.createEl("pre", { cls: "ad-tool-item__output", text: out });
        }
      }
    }
  }
  onClose() {
    this.closed = true; clearInterval(this.timer);
    this.renderComponent?.unload(); this.contentEl.empty();
  }
}

// Display the server's actual choices; closing the dialog cancels the request.
export class AcpPermissionModal extends Modal {
  constructor(app, info, resolve) { super(app); this.info = info; this.resolve = resolve; }
  onOpen() {
    const { toolCall, options } = this.info;
    this.contentEl.createEl("h2", { text: t("{agent} 请求工具权限", { agent: AGENTS[this.info.agent]?.name || this.info.agent }) });
    this.contentEl.createEl("p", { text: toolCall?.title || t("Agent 请求执行工具操作，请选择是否允许。") });
    if (toolCall?.rawInput) {
      const details = this.contentEl.createEl("details");
      details.createEl("summary", { text: t("查看操作详情") });
      details.createEl("pre", { text: JSON.stringify(toolCall.rawInput, null, 2) });
    }
    const row = this.contentEl.createDiv({ cls: "ad-btnrow" });
    for (const option of options) {
      const button = row.createEl("button", { text: option.name || option.kind });
      button.onclick = () => { this.choice = option.optionId; this.close(); };
    }
  }
  onClose() { this.resolve(this.choice); this.contentEl.empty(); }
}
