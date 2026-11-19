import { canOpenClient } from "./workflow.js";
import { canContinueSession } from "./agent-registry.js";
import { isAllowPermissionOption, pickPermissionOption } from "./delegation-runners.js";
import { Modal, Notice, MarkdownRenderer, Component } from "obsidian";
import { readConversation, archiveConversation, conversationTitle } from "./conversation.js";
import { AGENTS } from "./constants.js";
import { agentIcon, setLucide } from "./icons.js";
import { t } from "./i18n.js";

function sessionSubtitle(session = {}) {
  const parts = [];
  const cwd = String(session.cwd || "").trim().replace(/[/\\]+$/, "");
  if (cwd) parts.push(cwd.split(/[/\\]/).pop() || cwd);
  const sid = String(session.sid || session.sessionId || "").trim();
  if (sid) parts.push(sid.slice(0, 8));
  return parts.join(" · ");
}

function actionButton(parent, label, iconName, cls = "ad-btn") {
  const btn = parent.createEl("button", { cls, attr: { type: "button" } });
  const ico = btn.createSpan({ cls: "ad-btn__ico", attr: { "aria-hidden": "true" } });
  setLucide(ico, iconName);
  btn.createSpan({ text: label });
  return btn;
}

export class ConversationModal extends Modal {
  constructor(app, plugin, session) {
    super(app);
    this.plugin = plugin; this.session = session; this.cache = new Map();
  }
  onOpen() {
    const el = this.contentEl;
    const agent = AGENTS[this.session.agent] || { name: this.session.agent || "Agent", short: this.session.agent || "Agent", color: "#746d94", soft: "rgba(116,109,148,.13)" };
    this.agentInfo = agent;
    el.addClass("ad-modal", "ad-conversation");
    this.modalEl?.classList?.add("ad-conversation-modal");
    el.style.setProperty("--ad-agent", agent.color);
    el.style.setProperty("--ad-agent-soft", agent.soft);

    const head = el.createDiv({ cls: "ad-modalhead ad-conv-head" });
    const meta = head.createDiv({ cls: "ad-conv-meta" });
    const agentPill = meta.createSpan({ cls: "ad-conv-agent" });
    const mark = agentPill.createSpan({ cls: "ad-conv-agent__mark", attr: { "aria-hidden": "true" } });
    agentIcon(mark, this.session.agent);
    agentPill.createSpan({ text: agent.name });
    const subText = sessionSubtitle(this.session);
    if (subText) meta.createSpan({ cls: "ad-conv-sub", text: subText });

    const displayTitle = conversationTitle(this.session) || t("会话正文");
    this.titleEl = head.createDiv({ cls: "ad-modalhead__title ad-conv-title", text: displayTitle });

    const actions = el.createDiv({ cls: "ad-btnrow ad-conv-actions" });
    const archive = actionButton(actions, t("保存对话到笔记"), "bookmark-plus", "ad-btn ad-btn--cta");
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

    if (canOpenClient(this.session)) {
      const openBtn = actionButton(actions, t("在客户端打开"), "external-link", "ad-btn ad-btn--soft");
      openBtn.onclick = () => this.plugin.openClientSession(this.session);
    }
    const refresh = actionButton(actions, t("刷新正文"), "refresh-cw", "ad-btn ad-btn--ghost ad-conv-refresh");
    refresh.onclick = () => this.load();

    el.createDiv({
      cls: "ad-conv-note",
      text: this.session.agent === "cursor"
        ? t("保存用户消息、工具调用时间线与回复正文；长工具结果默认折叠。")
        : t("保存用户消息与回复正文；会话可继续，任务状态不受影响。工具结果、内部推理和附件不包含在内。"),
    });

    this.messagesEl = el.createDiv({ cls: "ad-conversation__messages" });

    const foot = el.createDiv({ cls: "ad-conv-foot" });
    const footIco = foot.createSpan({ cls: "ad-conv-foot__ico", attr: { "aria-hidden": "true" } });
    setLucide(footIco, "info");
    foot.createSpan({
      text: canContinueSession(this.session, this.plugin?.jobs)
        ? t("可通过任务右键菜单「继续对话（追问）」在当前会话中追问。")
        : t("此 Agent 的续聊请在原客户端完成。"),
    });

    this.load();
    this.timer = setInterval(() => this.load(), 2000);
  }
  async load() {
    if (this.loading || !this.messagesEl) return;
    this.loading = true;
    try {
      const messages = await readConversation(this.plugin, this.session, this.cache);
      if (this.titleEl && messages.length) {
        const cur = this.titleEl.textContent || "";
        const generic = `${String(this.session.agent || "Agent").trim()} 对话`;
        if (!cur || cur === t("会话正文") || cur === generic) {
          const better = conversationTitle(this.session, messages);
          if (better) this.titleEl.textContent = better;
        }
      }
      const job = Object.values(this.plugin.jobs).find((j) => j.agent === this.session.agent && j.sessionId === (this.session.sid || this.session.sessionId));
      const liveTail = job?.state === "running" && job.lastText ? (this.plugin.delegator.runners.get(job.id)?.assistantText || job.lastText) : "";
      const jobSig = `${job?.state || ""}|${job?.error || ""}`;
      if (!liveTail && messages === this._lastMsgsRef && jobSig === this._lastJobSig && !this._lastHadLiveTail) return;
      if (liveTail) messages.push({ role: "assistant", text: liveTail });
      this._lastMsgsRef = messages;
      this._lastJobSig = jobSig;
      this._lastHadLiveTail = !!liveTail;
      const signature = JSON.stringify([messages, job?.state, job?.error]);
      if (this.closed || signature === this.signature) return;
      this.signature = signature;
      this.renderComponent?.unload();
      this.renderComponent = new Component(); this.renderComponent.load();
      this.messagesEl.empty();
      if (!messages.length) {
        const empty = this.messagesEl.createDiv({ cls: "ad-conv-empty" });
        const emptyIco = empty.createSpan({ cls: "ad-conv-empty__ico", attr: { "aria-hidden": "true" } });
        setLucide(emptyIco, "message-square");
        empty.createDiv({ cls: "ad-conv-empty__text", text: t("暂未读到正文。可先扫描本机会话，再刷新。") });
      }
      for (const m of messages) {
        const isUser = m.role === "user";
        const item = this.messagesEl.createDiv({ cls: `ad-conversation__message ${isUser ? "is-user" : "is-assistant"}` });
        const roleRow = item.createDiv({ cls: "ad-conv-msg__role" });
        const roleIco = roleRow.createSpan({ cls: "ad-conv-msg__ico", attr: { "aria-hidden": "true" } });
        if (isUser) {
          setLucide(roleIco, "user");
          roleRow.createSpan({ text: t("用户") });
        } else {
          agentIcon(roleIco, this.session.agent);
          roleRow.createSpan({ text: this.agentInfo?.short || this.agentInfo?.name || "Agent" });
        }
        if (m.text) {
          const body = item.createDiv({ cls: "ad-conv-msg__body" });
          await MarkdownRenderer.render(this.app, m.text, body, "", this.renderComponent);
          if (this.closed) return;
        }
        if (Array.isArray(m.tools) && m.tools.length) this.renderTools(item, m.tools);
      }
      if (job?.state === "error") this.messagesEl.createDiv({ cls: "ad-conv-status is-error", text: t("本轮失败：{error}", { error: job.error }) });
      if (["starting", "running", "needs-approval"].includes(job?.state)) {
        this.messagesEl.createDiv({
          cls: `ad-conv-status ${job?.state === "needs-approval" ? "is-warn" : "is-live"}`,
          text: job?.state === "needs-approval" ? t("等待工具权限确认…") : t("正在回复…"),
        });
      }
    } catch (e) { if (!this.closed) this.messagesEl.empty(), this.messagesEl.createDiv({ cls: "ad-conv-status is-error", text: t("读取失败：{error}", { error: e.message }) }); }
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
    const { toolCall, options = [], onAutoApprove } = this.info;
    const agent = AGENTS[this.info.agent] || { name: this.info.agent || "Agent", color: "#746d94", soft: "rgba(116,109,148,.13)" };
    const el = this.contentEl;
    el.addClass("ad-modal", "ad-perm-modal");
    el.style.setProperty("--ad-agent", agent.color);
    el.style.setProperty("--ad-agent-soft", agent.soft);
    const head = el.createDiv({ cls: "ad-modalhead" });
    head.createDiv({ cls: "ad-modalhead__title", text: t("{agent} 请求工具权限", { agent: agent.name }) });
    head.createDiv({ cls: "ad-modalhead__sub ad-perm-sub", text: toolCall?.title || t("Agent 请求执行工具操作，请选择是否允许。") });
    if (toolCall?.rawInput) {
      const details = el.createEl("details", { cls: "ad-perm-details" });
      details.createEl("summary", { text: t("查看操作详情") });
      details.createEl("pre", { text: JSON.stringify(toolCall.rawInput, null, 2) });
    }
    const allowOption = pickPermissionOption(options, true);
    if (allowOption && typeof onAutoApprove === "function") {
      el.createDiv({ cls: "ad-hint", text: t("开启自动允许后将不再逐次弹窗询问 {agent} 的工具权限；可随时在设置或委派弹窗中关闭。", { agent: agent.name }) });
    }
    const row = el.createDiv({ cls: "ad-modalfoot ad-btnrow" });
    for (const option of options) {
      const allow = isAllowPermissionOption(option);
      const button = row.createEl("button", { cls: `ad-btn ${allow ? "ad-btn--cta" : "ad-btn--ghost"}`, text: option.name || option.optionId || option.kind, attr: { type: "button" } });
      button.onclick = () => { this.choice = option.optionId; this.close(); };
    }
    if (allowOption && typeof onAutoApprove === "function") {
      const autoBtn = row.createEl("button", { cls: "ad-btn ad-btn--soft", text: t("允许并开启 {agent} 自动允许", { agent: agent.name }), attr: { type: "button" } });
      autoBtn.onclick = () => {
        Promise.resolve(onAutoApprove()).catch((e) => console.error("[agent-deck] autoApprove", e));
        this.choice = allowOption.optionId;
        this.close();
      };
    }
  }
  onClose() { this.resolve(this.choice); this.contentEl.empty(); }
}
