// 记忆审阅：按钮 + 快捷键高速审阅，支持来源跳转与内联编辑。
import { Modal } from "obsidian";
import { MEMORY_KINDS } from "./memory-store.js";
import { t } from "./i18n.js";

const KINDS = Object.entries(MEMORY_KINDS).map(([id, label]) => ({ id, label }));

function clickableSources(entry) {
  return (entry.sources || []).slice(0, 3).map((raw) => {
    const s = String(raw || "");
    const link = (/^\[\[([^\]]+)\]\]/.exec(s) || [])[1] || "";
    const excerpt = s.replace(/^.*原文：/, "").trim();
    return { raw: s, link, label: link || s.slice(0, 60), excerpt };
  });
}

const PROV_LABELS = {
  "user-log": "用户日志",
  "ai-log": "AI 提炼",
  mixed: "混合来源",
  import: "外部导入",
  consolidated: "巩固合并",
  manual: "手动创建",
};

export class MemoryReviewModal extends Modal {
  constructor(app, entries, onSave, onDone, { onUpdate = null, onOpenSource = null, onOpenLocalGraph = null, onResolveConflict = null, allEntries = null } = {}) {
    super(app);
    this.entries = entries;
    this.index = 0;
    this.onSave = onSave;
    this.onDone = onDone;
    this.onUpdate = onUpdate;
    this.onOpenSource = onOpenSource;
    this.onOpenLocalGraph = onOpenLocalGraph;
    this.onResolveConflict = onResolveConflict;
    this.entryByTarget = new Map();
    for (const e of [...(Array.isArray(allEntries) ? allEntries : []), ...(entries || [])]) {
      if (!e?.path) continue;
      const noExt = e.path.replace(/\.md$/i, "");
      const base = noExt.split("/").pop();
      this.entryByTarget.set(noExt, e);
      if (base && !this.entryByTarget.has(base)) this.entryByTarget.set(base, e);
    }
    this.editing = false;
    this._keyHandler = null;
  }

  stepIndex(delta = 1) {
    let next = this.index + (delta >= 0 ? 1 : -1);
    while (next >= 0 && next < this.entries.length && this.entries[next]?._skipInReview) {
      next += (delta >= 0 ? 1 : -1);
    }
    if (delta < 0 && next < 0) return;
    this.index = Math.max(0, next);
  }

  onOpen() {
    this._keyHandler = (e) => {
      if (this.editing) return;
      const tag = String(e.target?.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const entry = this.entries[this.index];
      if (!entry) return;
      if (e.key === "1") { e.preventDefault(); this.commitState("有效"); }
      else if (e.key === "2") { e.preventDefault(); this.commitState("已拒绝"); }
      else if (e.key === "3") { e.preventDefault(); this.commitState("已被替代"); }
      else if (e.key === "s" || e.key === "S") { e.preventDefault(); this.stepIndex(1); this.render(); }
      else if (e.key === "Backspace" || e.key === "ArrowLeft") {
        e.preventDefault();
        if (this.index > 0) { this.stepIndex(-1); this.render(); }
      }
      else if ((e.key === "e" || e.key === "E") && this.onUpdate) { e.preventDefault(); this.editing = true; this.render(); }
    };
    this.modalEl?.addEventListener?.("keydown", this._keyHandler);
    this.render();
  }

  async commitState(state) {
    const entry = this.entries[this.index];
    if (!entry) return;
    try {
      await this.onSave(entry, state);
      entry.state = state;
      if (state === "有效") entry.verified = true;
    } catch (e) { console.error("[agent-deck] 保存记忆状态失败", e); }
    this.editing = false;
    this.stepIndex(1);
    this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ad-modal", "ad-mem-review");
    const entry = this.entries[this.index];
    if (!entry) return this.finish();

    const head = contentEl.createDiv({ cls: "ad-mem-review__head" });
    head.createDiv({ cls: "ad-send__title", text: t("记忆审阅 {now}/{all}", { now: this.index + 1, all: this.entries.length }) });
    const statusBadge = entry.verified ? t("已确认") : t("待确认");
    head.createDiv({
      cls: "ad-muted",
      text: `${entry.type || entry.kind} · ${entry.state || "有效"} · ${statusBadge} · ${entry.date || t("无日期")}`,
    });

    if (entry.provenance || entry.project || entry.tags?.length) {
      const chips = contentEl.createDiv({ cls: "ad-mem-review__chips" });
      if (entry.provenance) {
        const provLabel = PROV_LABELS[entry.provenance] || entry.provenance;
        chips.createSpan({ cls: "ad-mem-review__chip", text: t(provLabel) });
      }
      if (entry.project) chips.createSpan({ cls: "ad-mem-review__chip", text: entry.project });
      for (const tg of entry.tags || []) chips.createSpan({ cls: "ad-mem-review__chip", text: `#${tg}` });
    }

    if (this.editing) {
      this.renderEditor(contentEl, entry);
      return;
    }

    contentEl.createEl("p", { cls: "ad-mem-review__text", text: entry.text });

    if (entry.conflictsWith?.length) {
      const confBox = contentEl.createDiv({ cls: "ad-mem-review__conflicts" });
      confBox.createSpan({ text: t("冲突待裁决：") });
      for (const raw of entry.conflictsWith) {
        const target = String(raw || "").replace(/^\[\[|\]\]$/g, "").split("|")[0].trim();
        if (!target) continue;
        const peer = this.entryByTarget.get(target) || this.entryByTarget.get(target.split("/").pop());
        const item = confBox.createDiv({ cls: "ad-mem-review__confitem" });
        const btn = item.createEl("button", { cls: "ad-btn ad-btn--ghost ad-mem-review__srclink", text: target.split("/").pop(), attr: { type: "button" } });
        btn.addEventListener("click", () => {
          if (this.onOpenSource) this.onOpenSource(target);
          else this.app?.workspace?.openLinkText?.(target, "", false);
        });
        if (peer?.text) item.createSpan({ cls: "ad-muted", text: peer.text.slice(0, 90) });
        if (this.onResolveConflict) {
          const keepBtn = item.createEl("button", { cls: "ad-btn ad-btn--ghost ad-mem-review__srclink", text: t("保留本条·淘汰对方"), attr: { type: "button" } });
          keepBtn.addEventListener("click", async () => {
            await this.onResolveConflict(entry, target, "keep-current");
            entry.conflictsWith = (entry.conflictsWith || []).filter((x) => !String(x).includes(target.split("/").pop()));
            entry.state = "有效";
            entry.verified = true;
            if (peer) {
              peer.state = "已被替代";
              peer._skipInReview = true;
            }
            this.render();
          });
          const dismissBtn = item.createEl("button", { cls: "ad-btn ad-btn--ghost ad-mem-review__srclink", text: t("双方保留（解除冲突）"), attr: { type: "button" } });
          dismissBtn.addEventListener("click", async () => {
            await this.onResolveConflict(entry, target, "dismiss");
            entry.conflictsWith = (entry.conflictsWith || []).filter((x) => !String(x).includes(target.split("/").pop()));
            if (peer) {
              const curShort = entry.path.replace(/\.md$/i, "").split("/").pop();
              peer.conflictsWith = (peer.conflictsWith || []).filter((x) => !String(x).includes(curShort));
            }
            this.render();
          });
        }
      }
    }

    const srcs = clickableSources(entry);
    const srcBox = contentEl.createDiv({ cls: "ad-mem-review__sources" });
    if (!srcs.length) {
      srcBox.createDiv({ cls: "ad-muted", text: t("没有来源记录") });
    } else {
      for (const s of srcs) {
        const line = srcBox.createDiv({ cls: "ad-mem-review__srcline" });
        if (s.link) {
          const btn = line.createEl("button", { cls: "ad-btn ad-btn--ghost ad-mem-review__srclink", text: s.link, attr: { type: "button" } });
          btn.addEventListener("click", () => {
            if (this.onOpenSource) this.onOpenSource(s.link);
            else this.app?.workspace?.openLinkText?.(s.link, "", false);
          });
        } else {
          line.createSpan({ cls: "ad-muted", text: s.label });
        }
        if (s.excerpt) line.createDiv({ cls: "ad-muted", text: s.excerpt.slice(0, 180) });
      }
    }

    contentEl.createDiv({ cls: "ad-muted", text: t("确认后按相关度参与派发；拒绝后不再使用，也不会被 Dreaming 重新生成") });

    const row = contentEl.createDiv({ cls: "ad-mem-review__actions" });
    const confirmBtn = row.createEl("button", { text: t("✓ 确认 (1)"), cls: "mod-cta" });
    confirmBtn.addEventListener("click", () => this.commitState("有效"));
    row.createEl("button", { text: t("✕ 拒绝 (2)") }).addEventListener("click", () => this.commitState("已拒绝"));
    row.createEl("button", { text: t("↻ 已替代 (3)") }).addEventListener("click", () => this.commitState("已被替代"));
    if (this.onUpdate) {
      row.createEl("button", { text: t("✎ 编辑 (E)") }).addEventListener("click", () => { this.editing = true; this.render(); });
    }
    if (this.onOpenLocalGraph) {
      row.createEl("button", { cls: "ad-btn ad-btn--ghost", text: t("局部图谱") }).addEventListener("click", () => {
        this.onOpenLocalGraph(entry);
        this.close();
      });
    }
    if (this.index > 0) {
      row.createEl("button", { text: t("← 上一条") }).addEventListener("click", () => { this.stepIndex(-1); this.render(); });
    }
    row.createEl("button", { text: t("跳过 (S)") }).addEventListener("click", () => { this.stepIndex(1); this.render(); });
    setTimeout(() => confirmBtn.focus(), 10);
  }

  renderEditor(contentEl, entry) {
    const form = contentEl.createDiv({ cls: "ad-mem-review__edit" });
    const ta = form.createEl("textarea", { cls: "ad-mem-create__input", attr: { rows: 3 } });
    ta.value = entry.text;

    const descIn = form.createEl("input", { cls: "ad-input ad-input--wide", attr: { placeholder: t("触发/适用场景短句（可选）") } });
    descIn.value = entry.description || "";

    const metaRow = form.createDiv({ cls: "ad-mem-create__row" });
    const kindSel = metaRow.createEl("select", { cls: "ad-mem-import__kind" });
    let nextKind = entry.kind || "fact";
    for (const k of KINDS) {
      const opt = kindSel.createEl("option", { text: t(k.label) });
      opt.value = k.id;
      if (k.id === nextKind) opt.selected = true;
    }
    kindSel.addEventListener("change", () => { nextKind = kindSel.value; });

    const projIn = metaRow.createEl("input", { cls: "ad-input", attr: { placeholder: t("适用项目（可选）") } });
    projIn.value = entry.project || "";
    const tagsIn = metaRow.createEl("input", { cls: "ad-input", attr: { placeholder: t("标签（逗号分隔）") } });
    tagsIn.value = (entry.tags || []).join(", ");

    const conceptsIn = form.createEl("input", { cls: "ad-input ad-input--wide", attr: { placeholder: t("概念双链（逗号分隔，可选）") } });
    conceptsIn.value = (entry.concepts || []).map((c) => String(c || "").replace(/^\[\[|\]\]$/g, "")).filter(Boolean).join(", ");

    const foot = contentEl.createDiv({ cls: "modal-button-container" });
    foot.createEl("button", { text: t("取消") }).addEventListener("click", () => { this.editing = false; this.render(); });
    const saveBtn = foot.createEl("button", { text: t("保存修改并确认"), cls: "mod-cta" });
    saveBtn.addEventListener("click", async () => {
      const text = ta.value.trim();
      if (!text) return;
      const description = descIn.value.trim();
      const project = projIn.value.trim();
      const tags = tagsIn.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
      const concepts = conceptsIn.value.split(/[,，]/)
        .map((s) => String(s || "").replace(/^\[\[|\]\]$/g, "").trim())
        .filter(Boolean)
        .map((s) => `[[${s}]]`);
      try {
        await this.onUpdate?.(entry, { text, description, kind: nextKind, project, tags, concepts, state: "有效", verified: true });
        entry.text = text;
        entry.description = description;
        entry.kind = nextKind;
        entry.type = MEMORY_KINDS[nextKind] || entry.type;
        entry.project = project;
        entry.tags = tags;
        entry.concepts = concepts;
        entry.state = "有效";
        entry.verified = true;
      } catch (e) { console.error("[agent-deck] 更新记忆失败", e); }
      this.editing = false;
      this.stepIndex(1);
      this.render();
    });
    setTimeout(() => ta.focus(), 10);
  }

  finish() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("p", { text: t("审完了。") });
    const row = contentEl.createDiv({ cls: "modal-button-container" });
    row.createEl("button", { text: t("关闭"), cls: "mod-cta" }).addEventListener("click", () => this.close());
  }

  onClose() {
    if (this._keyHandler) this.modalEl?.removeEventListener?.("keydown", this._keyHandler);
    this.contentEl.empty();
    this.onDone?.();
  }
}
