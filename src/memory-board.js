// 记忆看板：直接渲染记忆目录（一个文件一条），按 state 分列，支持筛选与一键确认/拒绝。
// 卡片身份是文件路径 + 块号，状态变更写回该文件的 frontmatter，不经过任何中间副本。
import { ItemView } from "obsidian";
import { MEMORY_KINDS, readDroppedBrowserFiles } from "./memory-store.js";
import { t } from "./i18n.js";

export const MEMORY_BOARD_TYPE = "agent-deck-memory-board";
export const MEMORY_STATE_ORDER = ["有效", "已拒绝", "已被替代"];

// 来源角标只读 frontmatter 里的 [[笔记#^块号]]，不写文件、不改记忆正文。
export function sourceRefs(entry) {
  return (entry.sources || [])
    .map((raw) => {
      const m = /^\[\[([^\]|#]+)(?:#\^([^\]|]+))?/.exec(String(raw));
      return m ? { path: m[1], blockId: m[2] || "", raw: String(raw) } : null;
    })
    .filter(Boolean);
}

export function groupMemories(entries = []) {
  const columns = MEMORY_STATE_ORDER.map((state) => ({ state, items: [] }));
  for (const entry of entries) {
    const column = columns.find((c) => c.state === (entry.state || "有效")) || columns[0];
    column.items.push(entry);
  }
  return columns;
}

export class MemoryBoardView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.entries = [];
    this.filterQuery = "";
    this.filterVerified = "all"; // "all" | "pending" | "verified"
    this.filterKind = "all";
    this._boardEl = null;
  }

  getViewType() { return MEMORY_BOARD_TYPE; }
  getDisplayText() { return t("记忆看板"); }
  getIcon() { return "kanban"; }

  async onOpen() {
    this.contentEl.addEventListener("dragover", (e) => {
      if (e.dataTransfer?.types?.includes?.("Files")) e.preventDefault();
    });
    this.contentEl.addEventListener("drop", async (e) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      e.stopPropagation();
      const docs = await readDroppedBrowserFiles(e.dataTransfer.files);
      if (docs.length) this.plugin.openMemoryImport?.(docs, { onImported: () => this.refresh() });
    });
    await this.refresh();
  }

  async refresh() {
    this.entries = (await this.plugin.dreaming.loadEntries()).sort((a, b) => (a.date < b.date ? 1 : -1));
    this.render();
  }

  filteredEntries() {
    const q = this.filterQuery.trim().toLowerCase();
    return this.entries.filter((e) => {
      if (this.filterKind !== "all" && e.kind !== this.filterKind) return false;
      if (this.filterVerified === "pending" && (e.verified || e.state !== "有效")) return false;
      if (this.filterVerified === "verified" && !e.verified) return false;
      if (this.filterVerified === "conflicts" && !(e.conflictsWith?.length)) return false;
      if (q) {
        const hay = `${e.title || e.text} ${e.text || ""} ${e.project || ""} ${(e.tags || []).join(" ")} ${(e.concepts || []).join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass("ad-memory-board");

    const head = root.createDiv({ cls: "ad-memory-board__head" });
    const activeCount = this.entries.filter((e) => e.state === "有效").length;
    const pendingCount = this.entries.filter((e) => e.state === "有效" && !e.verified).length;
    head.createSpan({ text: t("共 {n} 条（有效 {active} · 待确认 {pending}）", { n: this.entries.length, active: activeCount, pending: pendingCount }) });

    head.createEl("button", { text: t("刷新") }).addEventListener("click", () => this.refresh());
    head.createEl("button", { text: t("+ 新建") }).addEventListener("click", () => this.plugin.openMemoryCreate?.(() => this.refresh()));
    head.createEl("button", { text: t("导入…") }).addEventListener("click", () => this.plugin.openMemoryImport?.([], { onImported: () => this.refresh() }));
    if (this.plugin?.dreaming?.storeMode) {
      head.createEl("button", { text: t("逐条审阅") }).addEventListener("click", () => this.plugin.reviewMemories?.());
      const userLogPending = this.entries.filter(
        (e) => e.state === "有效" && !e.verified && (e.provenance === "user-log" || e.provenance === "manual" || e.provenance === "mixed"),
      );
      if (userLogPending.length > 0 && typeof this.plugin.confirmUserLogMemories === "function") {
        head.createEl("button", { text: t("批量确认本人日志 ({n})", { n: userLogPending.length }) }).addEventListener("click", async () => {
          await this.plugin.confirmUserLogMemories(userLogPending);
          await this.refresh();
        });
      }
      head.createEl("button", { text: t("立即 Dream") }).addEventListener("click", async () => {
        await this.plugin.dreaming.run(true, { drain: true });
        await this.refresh();
      });
      head.createEl("button", { text: t("巩固去重") }).addEventListener("click", async () => {
        await this.plugin.consolidateMemories?.();
        await this.refresh();
      });
    } else if (this.plugin?.dreaming) {
      const migrateBtn = head.createEl("button", { cls: "mod-cta", text: t("初始化 / 迁移记忆库") });
      migrateBtn.addEventListener("click", async () => {
        await this.plugin.migrateMemoryToFiles?.();
        await this.refresh();
      });
    }
    head.createSpan({ cls: "ad-muted", text: t("可把 .md / .json / .zip 直接拖进看板导入") });

    const filters = root.createDiv({ cls: "ad-memory-board__filters" });
    const searchIn = filters.createEl("input", { cls: "ad-input", attr: { type: "search", placeholder: t("搜索记忆正文、项目或标签…") } });
    searchIn.value = this.filterQuery;
    searchIn.addEventListener("input", () => {
      this.filterQuery = searchIn.value || "";
      this.renderColumns();
    });

    const verSel = filters.createEl("select", { cls: "ad-memory-board__sel" });
    for (const [id, label] of [["all", t("全部审阅状态")], ["pending", t("仅待确认")], ["verified", t("仅已确认")], ["conflicts", t("仅冲突待裁决")]]) {
      const opt = verSel.createEl("option", { text: label });
      opt.value = id;
      if (this.filterVerified === id) opt.selected = true;
    }
    verSel.addEventListener("change", () => { this.filterVerified = verSel.value; this.renderColumns(); });

    const kindSel = filters.createEl("select", { cls: "ad-memory-board__sel" });
    kindSel.createEl("option", { text: t("全部类型") }).value = "all";
    for (const [id, label] of Object.entries(MEMORY_KINDS)) {
      const opt = kindSel.createEl("option", { text: t(label) });
      opt.value = id;
      if (this.filterKind === id) opt.selected = true;
    }
    kindSel.addEventListener("change", () => { this.filterKind = kindSel.value; this.renderColumns(); });

    this._boardEl = root.createDiv({ cls: "ad-memory-board__cols" });
    this.renderColumns();
  }

  renderColumns() {
    const board = this._boardEl;
    if (!board) return;
    const prevLeft = board.scrollLeft || 0;
    const prevTop = board.scrollTop || 0;
    board.empty();
    for (const column of groupMemories(this.filteredEntries())) {
      const col = board.createDiv({ cls: "ad-memory-board__col" });
      col.createDiv({ cls: "ad-memory-board__colhead", text: `${t(column.state)} · ${column.items.length}` });
      col.addEventListener("dragover", (e) => { e.preventDefault(); col.addClass("is-over"); });
      col.addEventListener("dragleave", () => col.removeClass("is-over"));
      col.addEventListener("drop", async (e) => {
        col.removeClass("is-over");
        if (e.dataTransfer?.files?.length) return;
        e.preventDefault();
        const path = e.dataTransfer?.getData("text/plain");
        if (!path) return;
        await this.plugin.dreaming.setEntryState(path, column.state);
        await this.refresh();
        this.plugin.dreaming.syncOverview().catch(() => {});
      });
      for (const entry of column.items) {
        const card = col.createDiv({ cls: "ad-memory-board__card" });
        card.draggable = true;
        card.addEventListener("dragstart", (e) => e.dataTransfer?.setData("text/plain", entry.path));
        if (entry.project || entry.verified || entry.conflictsWith?.length) {
          const badges = card.createDiv({ cls: "ad-memory-board__badges" });
          if (entry.verified) badges.createSpan({ cls: "ad-memory-board__ok", text: t("✓ 已确认") });
          if (entry.conflictsWith?.length) badges.createSpan({ cls: "ad-memory-board__conflict", text: t("⚠ 冲突 {n}", { n: entry.conflictsWith.length }) });
          if (entry.project) badges.createSpan({ cls: "ad-memory-board__proj", text: entry.project });
        }
        card.createDiv({ cls: "ad-memory-board__title", text: entry.title || entry.text });
        const foot = card.createDiv({ cls: "ad-memory-board__cardfoot" });
        foot.createDiv({ cls: "ad-muted", text: `${entry.type || entry.kind} · ${entry.date || ""}` });
        const act = foot.createDiv({ cls: "ad-memory-board__cardact" });
        if (entry.state === "有效" && !entry.verified) {
          const okBtn = act.createEl("button", { cls: "ad-memory-board__quick", text: "✓", attr: { "aria-label": t("确认这条记忆") } });
          okBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            await this.plugin.dreaming.setEntryState(entry.path, "有效");
            await this.refresh();
            this.plugin.dreaming.syncOverview().catch(() => {});
          });
        }
        if (entry.state !== "已拒绝") {
          const rejBtn = act.createEl("button", { cls: "ad-memory-board__quick", text: "✕", attr: { "aria-label": t("拒绝这条记忆") } });
          rejBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            await this.plugin.dreaming.setEntryState(entry.path, "已拒绝");
            await this.refresh();
            this.plugin.dreaming.syncOverview().catch(() => {});
          });
        }
        const del = act.createEl("button", { cls: "ad-memory-board__del", text: t("删除"), attr: { "aria-label": t("删除这条记忆") } });
        del.addEventListener("click", async (e) => {
          e.stopPropagation();
          await this.plugin.deleteMemoryFile?.(entry.path);
        });
        const refs = sourceRefs(entry);
        if (refs.length) {
          const badge = card.createSpan({ cls: "ad-memory-board__src", text: t("来源 {n}", { n: refs.length }) });
          badge.addEventListener("click", (e) => {
            e.stopPropagation();
            const ref = refs[0];
            this.plugin.app.workspace.openLinkText(`${ref.path}${ref.blockId ? `#^${ref.blockId}` : ""}`, "", false);
          });
        }
        card.addEventListener("click", () => this.plugin.app.workspace.openLinkText(entry.path, "", false));
      }
    }
    board.scrollLeft = prevLeft;
    board.scrollTop = prevTop;
  }
}
