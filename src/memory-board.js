// 记忆看板：直接渲染记忆目录（一个文件一条），按 state 分列。
// 卡片身份是文件路径 + 块号，拖拽改状态时写回该文件的 frontmatter，不经过任何中间副本。
import { ItemView } from "obsidian";
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
  }

  getViewType() { return MEMORY_BOARD_TYPE; }
  getDisplayText() { return t("记忆看板"); }
  getIcon() { return "kanban"; }

  async onOpen() { await this.refresh(); }

  async refresh() {
    this.entries = (await this.plugin.dreaming.loadEntries()).sort((a, b) => (a.date < b.date ? 1 : -1));
    this.render();
  }

  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass("ad-memory-board");
    const head = root.createDiv({ cls: "ad-memory-board__head" });
    head.createSpan({ text: t("共 {n} 条", { n: this.entries.length }) });
    const refresh = head.createEl("button", { text: t("刷新") });
    refresh.addEventListener("click", () => this.refresh());

    const board = root.createDiv({ cls: "ad-memory-board__cols" });
    for (const column of groupMemories(this.entries)) {
      const col = board.createDiv({ cls: "ad-memory-board__col" });
      col.createDiv({ cls: "ad-memory-board__colhead", text: `${column.state} · ${column.items.length}` });
      col.addEventListener("dragover", (e) => { e.preventDefault(); col.addClass("is-over"); });
      col.addEventListener("dragleave", () => col.removeClass("is-over"));
      col.addEventListener("drop", async (e) => {
        e.preventDefault();
        col.removeClass("is-over");
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
        card.createDiv({ cls: "ad-memory-board__title", text: entry.title || entry.text });
        card.createDiv({ cls: "ad-muted", text: `${entry.type || entry.kind} · ${entry.date || ""}` });
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
  }
}
