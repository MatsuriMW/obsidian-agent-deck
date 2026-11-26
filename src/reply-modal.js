// 回复提问：单字段弹窗。它只干一件事——把一句话写回笔记里那行 `✍️ 答：`。
// 不是聊天窗：关掉它笔记里也有那一行，你去别处（手机、另一台机器）手写效果一样。
import { Modal } from "obsidian";
import { t } from "./i18n.js";

export class ReplyModal extends Modal {
  constructor(app, { question = "", options = [], value = "", hint = "", workspace = "", canContinue = false, onSubmit } = {}) {
    super(app);
    this.question = question;
    this.options = options;
    this.value = value;
    this.hint = hint;
    this.workspace = workspace;
    this.canContinue = canContinue;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ad-modal", "ad-reply-modal");
    contentEl.createDiv({ cls: "ad-send__title", text: t("回答这一问") });
    if (this.workspace) contentEl.createDiv({ cls: "ad-muted", text: t("工作目录：{workspace}", { workspace: this.workspace }) });
    if (this.question) contentEl.createEl("p", { cls: "ad-reply-modal__question", text: this.question });
    if (this.hint) contentEl.createDiv({ cls: "ad-muted", text: this.hint });

    if (this.options.length) {
      const chips = contentEl.createDiv({ cls: "ad-reply-modal__chips" });
      for (const option of this.options) {
        const chip = chips.createEl("button", { cls: "ad-chip", text: option });
        chip.setAttribute("type", "button");
        chip.addEventListener("click", () => {
          this.input.value = option;
          this.input.focus();
        });
      }
    }

    const field = contentEl.createDiv({ cls: "ad-field" });
    this.input = field.createEl("textarea", { cls: "ad-reply-modal__input", attr: { rows: "3" } });
    this.input.value = this.value || "";
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.submit({ continue: false }); }
    });

    const row = contentEl.createDiv({ cls: "modal-button-container" });
    row.createEl("button", { text: t("记下回答"), cls: "mod-cta" }).addEventListener("click", () => this.submit({ continue: false }));
    if (this.canContinue) row.createEl("button", { text: t("回答并继续") }).addEventListener("click", () => this.submit({ continue: true }));
    row.createEl("button", { text: t("取消") }).addEventListener("click", () => this.close());
    window.setTimeout(() => this.input?.focus(), 0);
  }

  submit({ continue: keepGoing = false } = {}) {
    const value = String(this.input?.value || "").trim();
    if (!value) return;
    this.close();
    this.onSubmit?.(value, { continue: keepGoing });
  }

  onClose() { this.contentEl.empty(); }
}
