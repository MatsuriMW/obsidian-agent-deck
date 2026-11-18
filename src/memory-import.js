// 记忆导入弹窗：支持把外部 Markdown / Claude 导出 JSON / ZIP 或库内笔记导入到 Agent Deck 记忆库（记忆.base）。
// 模式 A（直接拆条，0 Token）：适合从其他 Agent 导出的记忆列表或已整理的条目；
// 模式 B（模型提炼）：适合自己的长文档或杂乱笔记，经 Dreaming 提炼后再选入记忆库。
import { Modal } from "obsidian";
import { MEMORY_KINDS, expandImportedDocs, parseMarkdownToMemories, readDroppedBrowserFiles, unzipTextEntries } from "./memory-store.js";
import { t } from "./i18n.js";

export { readDroppedBrowserFiles, unzipTextEntries };

const KINDS = Object.entries(MEMORY_KINDS).map(([id, label]) => ({ id, label }));

export class MemoryImportModal extends Modal {
  constructor(plugin, initialDocs = [], { onImported } = {}) {
    super(plugin.app);
    this.plugin = plugin;
    this.docs = expandImportedDocs(initialDocs);
    this.mode = "direct"; // "direct" (模式 A) | "extract" (模式 B)
    this.candidates = [];
    this.skippedDupes = 0;
    this.extracting = false;
    this.extractStatus = "";
    this.onImported = onImported;
    this._closed = false;
  }

  onClose() {
    this._closed = true;
    this.contentEl.empty();
  }

  async onOpen() {
    if (this.docs.length) await this.recomputeDirect();
    if (!this._closed) this.render();
  }

  async recomputeDirect() {
    const existing = await this.plugin.dreaming.loadEntries();
    const known = new Set(existing.map((e) => e.id));
    const parsed = parseMarkdownToMemories(this.docs);
    let skipped = 0;
    this.candidates = [];
    for (const item of parsed) {
      if (known.has(item.id)) { skipped++; continue; }
      this.candidates.push({ ...item, checked: true });
    }
    this.skippedDupes = skipped;
  }

  async runModelExtraction() {
    if (!this.docs.length || this.extracting) return;
    this.extracting = true;
    this.extractStatus = t("正在调用模型提炼记忆…");
    this.render();
    try {
      const items = await this.plugin.dreaming.extractFromDocs(this.docs, {
        onProgress: ({ done, total }) => {
          this.extractStatus = t("正在提炼文档块 {done}/{total}…", { done, total });
          if (!this._closed) this.render();
        },
      });
      this.candidates = items.map((item) => ({ ...item, checked: true }));
      this.skippedDupes = 0;
      this.extractStatus = items.length
        ? t("模型已提炼出 {n} 条候选记忆", { n: items.length })
        : t("未从文档中提炼出新的长期记忆");
    } catch (e) {
      this.extractStatus = t("提炼未完成：{error}", { error: e.message || String(e) });
    } finally {
      this.extracting = false;
      if (!this._closed) this.render();
    }
  }

  async addActiveNote() {
    const file = this.app.workspace.getActiveFile();
    if (!file || !file.path.endsWith(".md")) return this.plugin.notice(t("当前没有打开的 Markdown 笔记"));
    if (file.path.startsWith(`${this.plugin.dreaming.dir}/`)) return this.plugin.notice(t("该文件已在记忆库中"));
    const content = await this.app.vault.read(file);
    const date = file.stat?.mtime ? new Date(file.stat.mtime).toISOString().slice(0, 10) : "";
    this.docs = expandImportedDocs([...this.docs, { name: file.name, path: file.path, content, date }]);
    if (this.mode === "direct") await this.recomputeDirect();
    this.render();
  }

  async handleFiles(fileList) {
    const added = await readDroppedBrowserFiles(fileList);
    if (!added.length) return this.plugin.notice(t("未读到可导入的 .md / .json / .zip 文件"));
    this.docs = [...this.docs, ...added];
    if (this.mode === "direct") await this.recomputeDirect();
    this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ad-modal", "ad-mem-import");

    contentEl.createDiv({ cls: "ad-modalhead__title", text: t("导入到记忆库（记忆.base）") });
    contentEl.createDiv({
      cls: "ad-modalhead__sub",
      text: t("导入的条目默认进入「待确认」视图，可在记忆看板或逐条审阅中筛选"),
    });

    // 1. 文件拖入区与选择入口
    const drop = contentEl.createDiv({ cls: "ad-mem-import__drop" });
    drop.createDiv({
      cls: "ad-mem-import__droptext",
      text: this.docs.length
        ? t("已载入 {n} 份文档：{names}", {
            n: this.docs.length,
            names: this.docs.slice(0, 4).map((d) => d.name).join("、") + (this.docs.length > 4 ? "…" : ""),
          })
        : t("把 .md / Claude memories.json / .zip 拖到这里，或点击下方按钮选择"),
    });
    const btnRow = drop.createDiv({ cls: "ad-mem-import__dropbtns" });
    const fileInput = drop.createEl("input", { type: "file" });
    fileInput.multiple = true;
    fileInput.accept = ".md,.markdown,.txt,.json,.zip";
    fileInput.style.display = "none";
    fileInput.addEventListener("change", () => this.handleFiles(fileInput.files));

    btnRow.createEl("button", { text: t("选择文件…") }).addEventListener("click", () => fileInput.click());
    btnRow.createEl("button", { text: t("加入当前笔记") }).addEventListener("click", () => this.addActiveNote());
    if (this.docs.length) {
      btnRow.createEl("button", { text: t("清空文件") }).addEventListener("click", () => {
        this.docs = [];
        this.candidates = [];
        this.skippedDupes = 0;
        this.extractStatus = "";
        this.render();
      });
    }

    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.addClass("is-over"); });
    drop.addEventListener("dragleave", () => drop.removeClass("is-over"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.removeClass("is-over");
      if (e.dataTransfer?.files?.length) this.handleFiles(e.dataTransfer.files);
    });

    // 2. 模式 A / B 切换
    const modeRow = contentEl.createDiv({ cls: "ad-mem-import__modes" });
    const makeModeBtn = (id, title, sub) => {
      const btn = modeRow.createDiv({ cls: `ad-mem-import__mode${this.mode === id ? " is-active" : ""}` });
      btn.createDiv({ cls: "ad-mem-import__modetitle", text: title });
      btn.createDiv({ cls: "ad-muted", text: sub });
      btn.addEventListener("click", async () => {
        if (this.mode === id) return;
        this.mode = id;
        this.extractStatus = "";
        if (id === "direct") await this.recomputeDirect();
        else this.candidates = [];
        this.render();
      });
    };
    makeModeBtn("direct", t("模式 A：按条目直接导入（0 Token）"), t("适合其他 Agent 导出的记忆列表或已整理的要点"));
    makeModeBtn("extract", t("模式 B：经模型提炼后导入"), t("适合自己的长文档或随手记，由 Dreaming 模型去噪提炼"));

    if (this.mode === "extract") {
      const extractBar = contentEl.createDiv({ cls: "ad-mem-import__bar" });
      const runBtn = extractBar.createEl("button", {
        text: this.extracting ? t("正在提炼…") : t("用模型提炼候选记忆"),
        cls: "mod-cta",
      });
      runBtn.disabled = !this.docs.length || this.extracting;
      runBtn.addEventListener("click", () => this.runModelExtraction());
      if (this.extractStatus) extractBar.createSpan({ cls: "ad-muted", text: this.extractStatus });
    }

    // 3. 候选记忆勾选与类型微调列表
    const selectedCount = this.candidates.filter((c) => c.checked).length;
    if (this.candidates.length || this.skippedDupes) {
      const bar = contentEl.createDiv({ cls: "ad-mem-import__bar" });
      bar.createSpan({
        cls: "ad-muted",
        text: t("候选 {all} 条（已选 {picked} 条，跳过库内重复 {skipped} 条）", {
          all: this.candidates.length,
          picked: selectedCount,
          skipped: this.skippedDupes,
        }),
      });
      if (this.candidates.length) {
        const toggleAll = bar.createEl("button", {
          text: selectedCount === this.candidates.length ? t("取消全选") : t("全选"),
        });
        toggleAll.addEventListener("click", () => {
          const next = selectedCount !== this.candidates.length;
          for (const c of this.candidates) c.checked = next;
          this.render();
        });
      }
    }

    if (this.candidates.length) {
      const list = contentEl.createDiv({ cls: "ad-mem-import__list" });
      for (const item of this.candidates) {
        const row = list.createDiv({ cls: "ad-mem-import__item" });
        const cb = row.createEl("input", { type: "checkbox" });
        cb.checked = item.checked;
        cb.addEventListener("change", () => { item.checked = cb.checked; this.render(); });

        const select = row.createEl("select", { cls: "ad-mem-import__kind" });
        for (const k of KINDS) {
          const opt = select.createEl("option", { text: t(k.label) });
          opt.value = k.id;
          if (k.id === item.kind) opt.selected = true;
        }
        select.addEventListener("change", () => {
          item.kind = select.value;
          item.type = MEMORY_KINDS[item.kind];
        });

        const body = row.createDiv({ cls: "ad-mem-import__body" });
        body.createDiv({ cls: "ad-mem-import__text", text: item.text });
        if (item.sources?.[0]) {
          body.createDiv({ cls: "ad-muted", text: `${item.date || ""} · ${item.sources[0].split("；原文：")[0]}` });
        }
      }
    }

    // 4. 底部操作栏
    const foot = contentEl.createDiv({ cls: "ad-modalfoot" });
    foot.createEl("button", { text: t("取消") }).addEventListener("click", () => this.close());
    const submit = foot.createEl("button", {
      text: t("导入 {n} 条到记忆库", { n: selectedCount }),
      cls: "mod-cta",
    });
    submit.disabled = !selectedCount || this.extracting;
    submit.addEventListener("click", () => this.submit());
  }

  async submit() {
    const picked = this.candidates.filter((c) => c.checked);
    if (!picked.length) return;
    try {
      const res = await this.plugin.dreaming.importEntries(picked);
      this.plugin.notice(
        t("已导入 {added} 条记忆到 {dir}（跳过重复 {skipped} 条）", {
          added: res.added,
          dir: res.dir,
          skipped: res.skipped,
        }),
        8000,
      );
      await this.onImported?.(res);
      this.close();
      await this.plugin.openMemoryBase();
    } catch (e) {
      this.plugin.notice(t("导入失败：{error}", { error: e.message || String(e) }), 8000);
    }
  }
}

export class MemoryCreateModal extends Modal {
  constructor(plugin, { onCreated } = {}) {
    super(plugin.app);
    this.plugin = plugin;
    this.kind = "fact";
    this.verified = false;
    this.onCreated = onCreated;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ad-modal", "ad-mem-create");
    contentEl.createDiv({ cls: "ad-modalhead__title", text: t("新建一条记忆") });
    contentEl.createDiv({ cls: "ad-modalhead__sub", text: t("写入 {dir} 并同步到记忆.base 与长期记忆", { dir: this.plugin.dreaming.dir }) });

    const row = contentEl.createDiv({ cls: "ad-mem-create__row" });
    row.createSpan({ text: t("类型") });
    const select = row.createEl("select", { cls: "ad-mem-import__kind" });
    for (const k of KINDS) {
      const opt = select.createEl("option", { text: t(k.label) });
      opt.value = k.id;
      if (k.id === this.kind) opt.selected = true;
    }
    select.addEventListener("change", () => { this.kind = select.value; });

    const verifyWrap = row.createEl("label", { cls: "ad-mem-create__verify" });
    const cb = verifyWrap.createEl("input", { type: "checkbox" });
    cb.checked = this.verified;
    cb.addEventListener("change", () => { this.verified = cb.checked; });
    verifyWrap.createSpan({ text: t("直接标为已确认") });

    const input = contentEl.createEl("textarea", {
      cls: "ad-mem-create__input",
      attr: { rows: 3, placeholder: t("输入一句值得跨会话记住的事实、偏好、待验证规律或项目经验…") },
    });
    setTimeout(() => input.focus(), 20);

    const foot = contentEl.createDiv({ cls: "ad-modalfoot" });
    foot.createEl("button", { text: t("取消") }).addEventListener("click", () => this.close());
    const submit = foot.createEl("button", { text: t("保存记忆"), cls: "mod-cta" });
    const save = async () => {
      const text = input.value.trim();
      if (!text) return this.plugin.notice(t("记忆内容不能为空"));
      submit.disabled = true;
      try {
        const res = await this.plugin.dreaming.createEntry({ text, kind: this.kind });
        if (this.verified) await this.plugin.dreaming.setEntryState(res.path, "有效");
        this.plugin.notice(t("已新建记忆：{path}", { path: res.path }));
        await this.onCreated?.(res);
        this.close();
      } catch (e) {
        submit.disabled = false;
        this.plugin.notice(t("新建失败：{error}", { error: e.message || String(e) }));
      }
    };
    submit.addEventListener("click", save);
    input.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); save(); }
    });
  }
}
