// 记忆审阅：逐条显示，下拉选择状态，避免手改 frontmatter。
import { Modal } from "obsidian";
import { t } from "./i18n.js";

const STATES = [
  { id: "有效", label: "确认（有效）" },
  { id: "已拒绝", label: "拒绝" },
  { id: "已被替代", label: "已被替代" },
];

export class MemoryReviewModal extends Modal {
  constructor(app, entries, onSave, onDone) {
    super(app);
    this.entries = entries;
    this.index = 0;
    this.onSave = onSave;
    this.onDone = onDone;
    this.picked = "有效";
  }

  onOpen() { this.render(); }

  async render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ad-modal");
    const entry = this.entries[this.index];
    if (!entry) return this.finish();
    this.picked = entry.state === "有效" ? "有效" : entry.state;

    contentEl.createDiv({ cls: "ad-send__title", text: t("记忆审阅 {now}/{all}", { now: this.index + 1, all: this.entries.length }) });
    contentEl.createDiv({ cls: "ad-muted", text: `${entry.type || entry.kind} · ${entry.date || t("无日期")}` });
    contentEl.createEl("p", { text: entry.text });
    const sources = (entry.sources || []).slice(0, 2).map((s) => s.replace(/（[^）]*）；原文：/, "："));
    contentEl.createDiv({ cls: "ad-muted", text: sources.length ? t("来源：{list}", { list: sources.join("；") }) : t("没有来源记录") });

    const field = contentEl.createDiv({ cls: "ad-field" });
    field.createDiv({ cls: "ad-send__title", text: t("这条记忆") });
    const select = field.createEl("select");
    for (const s of STATES) {
      const option = select.createEl("option", { text: t(s.label) });
      option.value = s.id;
      if (s.id === this.picked) option.selected = true;
    }
    select.addEventListener("change", () => { this.picked = select.value; });
    field.createDiv({ cls: "ad-muted", text: t("确认后仍会按相关度参与派发；拒绝后不再使用，也不会被 Dreaming 重新生成") });

    const row = contentEl.createDiv({ cls: "modal-button-container" });
    row.createEl("button", { text: t("保存并下一条"), cls: "mod-cta" }).addEventListener("click", () => this.save());
    row.createEl("button", { text: t("跳过") }).addEventListener("click", () => { this.index += 1; this.render(); });
  }

  async save() {
    const entry = this.entries[this.index];
    try { await this.onSave(entry, this.picked); } catch (e) { console.error("[agent-deck] 保存记忆状态失败", e); }
    this.index += 1;
    this.render();
  }

  finish() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("p", { text: t("审完了。") });
    const row = contentEl.createDiv({ cls: "modal-button-container" });
    row.createEl("button", { text: t("关闭"), cls: "mod-cta" }).addEventListener("click", () => this.close());
  }

  onClose() {
    this.contentEl.empty();
    this.onDone?.();
  }
}
