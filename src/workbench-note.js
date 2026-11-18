// 工作台总览：把 AI 生成的各类产物聚到一页 Markdown 里（不新增格式，只是索引）。
import { t } from "./i18n.js";

const link = (path, label) => `[[${String(path).replace(/\.md$/, "")}|${label || String(path).split("/").pop().replace(/\.md$/, "")}]]`;

export function buildWorkbenchNote({ boardFiles = [], memory = {}, tasks = [], at = "" } = {}) {
  const stamp = at || new Date().toISOString().slice(0, 16).replace("T", " ");
  const byKind = (path) => (/\/任务\//.test(path) ? t("任务") : /\/规格\//.test(path) ? t("规格") : t("笔记"));
  const lines = [
    "# 工作台",
    "",
    `> 由插件生成，${stamp} 刷新。这里只做索引，内容都在各自的笔记里，直接点开就能改。`,
    "",
    "## 看板文件",
    "| 文件 | 类型 |",
    "|---|---|",
    ...(boardFiles.length ? boardFiles.map((p) => `| ${link(p)} | ${byKind(p)} |`) : [`| ${t("还没有看板文件。用「看板：把当前笔记设为看板文件」选一篇。")} | |`]),
    "",
    "## 记忆",
    "| 项 | 数量 |",
    "|---|---|",
    `| ${t("总数")} | ${memory.total ?? 0} |`,
    `| ${t("待确认")} | ${memory.pending ?? 0} |`,
    `| ${t("无来源")} | ${memory.noSource ?? 0} |`,
    "",
    `- ${t("表格视图")}：[[Agent Deck/记忆.base]]`,
    `- ${t("逐条审阅")}：${t("命令面板 → 记忆：逐条审阅")}`,
    `- ${t("批量导入")}：${t("命令面板 → 记忆：从 Markdown / JSON 导入到记忆库…（或直接把文件拖进记忆看板）")}`,
    `- ${t("体检")}：${t("命令面板 → 记忆：体检")}`,
    "",
    "## 最近任务规划",
    ...(tasks.length ? tasks.map((p) => `- ${link(p)}`) : [`- ${t("还没有生成过任务规划。")}`]),
    "",
    "## 生成入口",
    `- ${t("规划")}：${t("把光标放在目标那一行 → 命令面板 → 规划：把当前这一条拆成 task.md")}`,
    `- ${t("看板")}：${t("一篇笔记设为看板文件后，打开即看板；拖动即改 Markdown")}`,
    "",
  ];
  return lines.join("\n");
}
