import { Modal, Notice, MarkdownRenderer, Component } from "obsidian";
import { readConversation, archiveConversation } from "./conversation.js";

export class ConversationModal extends Modal {
  constructor(app, plugin, session) {
    super(app);
    this.plugin = plugin; this.session = session; this.cache = new Map();
  }
  onOpen() {
    const el = this.contentEl;
    el.addClass("ad-conversation");
    el.createEl("h2", { text: this.session.title || this.session.name || "会话正文" });
    const actions = el.createDiv({ cls: "ad-btnrow" });
    const refresh = actions.createEl("button", { text: "刷新正文" });
    refresh.onclick = () => this.load();
    const archive = actions.createEl("button", { text: "归档到笔记" });
    archive.onclick = async () => {
      archive.disabled = true;
      try {
        const file = await archiveConversation(this.plugin, this.session);
        await this.app.workspace.getLeaf(false).openFile(file);
        new Notice(`已归档：${file.path}`);
      } catch (e) { new Notice(e.message); }
      finally { archive.disabled = false; }
    };
    el.createDiv({ cls: "ad-hint", text: "显示用户消息与回复正文。归档不包含工具结果、内部推理和附件。" });
    this.messagesEl = el.createDiv({ cls: "ad-conversation__messages" });
    if (this.session.agent === "dsh" || (this.session.agent === "antigravity" && Object.values(this.plugin.jobs).some((j) => j.agent === "antigravity" && j.transport === "acp" && j.sessionId === (this.session.sid || this.session.sessionId)))) {
      this.input = el.createEl("textarea", { cls: "ad-textarea", attr: { rows: "3", placeholder: "在原会话中继续追问…" } });
      const row = el.createDiv({ cls: "ad-btnrow" });
      this.send = row.createEl("button", { cls: "mod-cta", text: "发送到原会话" });
      this.send.onclick = async () => {
        this.send.disabled = true;
        try {
          const job = await this.plugin.delegator.continueSession(this.session, this.input.value);
          if (job.state === "error") throw new Error(job.error);
          this.input.value = "";
          await this.load();
        } catch (e) { new Notice(e.message); }
        finally { this.send.disabled = false; }
      };
      const stop = row.createEl("button", { text: "停止当前一轮" });
      stop.onclick = () => {
        const job = Object.values(this.plugin.jobs).find((j) => j.agent === this.session.agent && j.sessionId === (this.session.sid || this.session.sessionId));
        if (job) this.plugin.delegator.cancel(job.id);
      };
    } else {
      el.createDiv({ cls: "ad-hint", text: "此 Agent 的续聊请在原客户端完成。" });
    }
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
      if (!messages.length) this.messagesEl.createDiv({ text: "暂未读到正文。可先扫描本机会话，再刷新。" });
      for (const m of messages) {
        const item = this.messagesEl.createDiv({ cls: "ad-conversation__message" });
        item.createEl("h3", { text: m.role === "user" ? "用户" : "Agent" });
        await MarkdownRenderer.render(this.app, m.text, item.createDiv(), "", this.renderComponent);
        if (this.closed) return;
      }
      if (job?.state === "error") this.messagesEl.createDiv({ text: `本轮失败：${job.error}` });
      if (["starting", "running", "needs-approval"].includes(job?.state)) this.messagesEl.createDiv({ text: job?.state === "needs-approval" ? "等待工具权限确认…" : "正在回复…" });
    } catch (e) { if (!this.closed) this.messagesEl.setText(`读取失败：${e.message}`); }
    finally { this.loading = false; }
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
    this.contentEl.createEl("h2", { text: "Antigravity 请求工具权限" });
    this.contentEl.createEl("pre", { text: JSON.stringify(toolCall || {}, null, 2) });
    const row = this.contentEl.createDiv({ cls: "ad-btnrow" });
    for (const option of options) {
      const button = row.createEl("button", { text: option.name || option.kind });
      button.onclick = () => { this.choice = option.optionId; this.close(); };
    }
  }
  onClose() { this.resolve(this.choice); this.contentEl.empty(); }
}
