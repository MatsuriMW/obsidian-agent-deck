// 回复信箱：侧栏里的一个非模态列表，把所有"它在等你回答"的任务摆在一起。
// 不抢焦点，不占满屏；回复的动作和笔记里写 ✍️ 答 完全等价（都走 plugin.applyReply）。
import { ItemView } from "obsidian";
import { t } from "./i18n.js";
import { AGENTS } from "./constants.js";
import { inboxSorted, stillPending } from "./reply-inbox.js";
import { suggestOptions } from "./thread-replies.js";
import { canContinueSession } from "./agent-registry.js";

export const REPLY_INBOX_TYPE = "agent-deck-reply-inbox";

const shortPath = (path = "") => String(path).replace(/\.md$/, "");

export class ReplyInboxView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.drafts = new Map();   // key → 正在输入的内容：重绘不丢草稿
    this.signature = "";
    this.verifying = false;
  }

  getViewType() { return REPLY_INBOX_TYPE; }
  getDisplayText() { return t("回复信箱"); }
  getIcon() { return "message-square-dot"; }

  async onOpen() { await this.render(); }

  // 只在"条目集合"变了才重建 DOM：用户正在输入时不能被刷新打断，更不能抢焦点。
  async render({ force = false } = {}) {
    const items = inboxSorted(this.plugin.settings.replyInbox || []);
    const sig = JSON.stringify(items.map((x) => [x.path, x.questionId || x.question, x.question, x.sid || ""]));
    if (!force && sig === this.signature) {
      this.paintCount(items.length);
      return;
    }
    this.signature = sig;
    const root = this.contentEl;
    const focused = document.activeElement;
    root.empty();
    root.addClass("ad-inbox");
    this.paintCount(items.length);

    const head = root.createDiv({ cls: "ad-inbox__head" });
    head.createSpan({ cls: "ad-inbox__title", text: t("回复信箱") });
    head.createSpan({ cls: "ad-inbox__hint", text: items.length ? t("{n} 条在等你", { n: String(items.length) }) : t("暂时没有要回答的") });
    const scan = head.createEl("button", { cls: "ad-chip", text: t("核对一遍") });
    scan.setAttribute("type", "button");
    scan.onclick = () => this.verify();

    if (!items.length) {
      root.createDiv({ cls: "ad-inbox__empty", text: t("Agent 提问时会自动出现在这里，不用回原文找。") });
      return;
    }

    const list = root.createDiv({ cls: "ad-inbox__list" });
    for (const item of items) this.row(list, item);
    if (focused && root.contains(focused)) focused.focus?.();
  }

  row(parent, item) {
    const key = `${item.path}#${item.questionId || item.question}`;
    const card = parent.createDiv({ cls: "ad-inbox__card" });
    const top = card.createDiv({ cls: "ad-inbox__top" });
    const agent = AGENTS[item.agent]?.name || item.agent || "";
    top.createSpan({ cls: "ad-inbox__meta", text: [agent, item.title || shortPath(item.path)].filter(Boolean).join(" · ") });
    const open = top.createEl("button", { cls: "ad-inbox__link", text: t("原文") });
    open.setAttribute("type", "button");
    open.onclick = () => this.plugin.openReplySource(item);
    card.createDiv({ cls: "ad-inbox__question", text: item.question });

    const options = suggestOptions(item.question);
    if (options.length) {
      const chips = card.createDiv({ cls: "ad-inbox__chips" });
      for (const option of options) {
        const chip = chips.createEl("button", { cls: "ad-chip", text: option });
        chip.setAttribute("type", "button");
        chip.onclick = () => { input.value = option; input.focus(); this.drafts.set(key, option); };
      }
    }

    const input = card.createEl("textarea", { cls: "ad-inbox__input", attr: { rows: "2", placeholder: t("写下你的回答…（不着急，写别的也行）") } });
    input.value = this.drafts.get(key) || "";
    input.addEventListener("input", () => this.drafts.set(key, input.value));

    const actions = card.createDiv({ cls: "ad-inbox__actions" });
    const canContinue = canContinueSession(item, this.plugin?.jobs);
    if (canContinue) {
      const send = actions.createEl("button", { cls: "mod-cta", text: t("回答并继续") });
      send.setAttribute("type", "button");
      send.onclick = async () => {
        const value = input.value.trim();
        if (!value) return input.focus();
        send.disabled = true;
        await this.plugin.submitInboxReply(item, value, { continueSession: true });
        this.drafts.delete(key);
      };
    }
    const keep = actions.createEl("button", { ...(canContinue ? {} : { cls: "mod-cta" }), text: t("先记下回答") });
    keep.setAttribute("type", "button");
    keep.onclick = async () => {
      const value = input.value.trim();
      if (!value) return input.focus();
      keep.disabled = true;
      await this.plugin.submitInboxReply(item, value, { continueSession: false });
      this.drafts.delete(key);
    };
  }

  paintCount(n) {
    try { this.leaf?.setViewData?.("", true); } catch { /* 标题栏计数是可选装饰 */ }
    this.containerEl?.setAttribute?.("data-count", String(n));
  }

  // 核对一遍：笔记里已经答过 / 删掉的条目从信箱里清掉。不抢焦点，也不碰正在输入的草稿。
  async verify() {
    if (this.verifying) return;
    this.verifying = true;
    try {
      const items = this.plugin.settings.replyInbox || [];
      const alive = [];
      for (const item of items) {
        let text = "";
        try { text = await this.plugin.readNote(item.path); } catch { text = ""; }
        if (text && stillPending(text, item)) alive.push(item);
      }
      if (alive.length !== items.length) {
        this.plugin.settings.replyInbox = alive;
        await this.plugin.saveSettings();
      }
      await this.render({ force: true });
    } finally {
      this.verifying = false;
    }
  }
}
