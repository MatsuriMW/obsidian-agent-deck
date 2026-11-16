// Simulated v1.10.0 showcase note generator and one-shot view preset seeder.
// Pure module: zero dependency on Obsidian, DOM, or session scanners.

import { currentLanguage } from "./i18n.js";

export const SHOWCASE_VERSION = "1.10.0";

export const SHOWCASE_BOARD_KEY = "ad-demo-board";
export const SHOWCASE_MIRROR_SOURCE_KEY = "ad-demo-src";
export const SHOWCASE_RECORD_KEYS = {
  table: "ad-demo-table",
  cards: "ad-demo-cards",
  timeline: "ad-demo-timeline",
  outline: "ad-demo-outline",
};

export function showcasePath(lang = currentLanguage()) {
  return lang === "en"
    ? `Agent Deck/Welcome-${SHOWCASE_VERSION}.md`
    : `Agent Deck/功能示例-${SHOWCASE_VERSION}.md`;
}

export function applyShowcaseDefaults(settings, { force = false } = {}) {
  if (!settings || typeof settings !== "object") return false;
  let changed = false;

  const boardViews = (settings.taskBoardViews ||= {});
  if (force || !Object.hasOwn(boardViews, SHOWCASE_BOARD_KEY)) {
    boardViews[SHOWCASE_BOARD_KEY] = { mode: "board", groupBy: "children", zoomStack: [] };
    changed = true;
  }

  const recordViews = (settings.aiRecordViews ||= {});
  const desiredViews = {
    [SHOWCASE_RECORD_KEYS.table]: "table",
    [SHOWCASE_RECORD_KEYS.cards]: "cards",
    [SHOWCASE_RECORD_KEYS.timeline]: "timeline",
  };
  for (const [key, mode] of Object.entries(desiredViews)) {
    if (force || !Object.hasOwn(recordViews, key)) {
      recordViews[key] = mode;
      changed = true;
    }
  }
  if (force && Object.hasOwn(recordViews, SHOWCASE_RECORD_KEYS.outline)) {
    delete recordViews[SHOWCASE_RECORD_KEYS.outline];
    changed = true;
  }

  const expanded = (settings.aiRecordExpanded ||= {});
  const closed = (settings.aiRecordClosed ||= {});
  for (const key of Object.values(SHOWCASE_RECORD_KEYS)) {
    if (force) {
      if (closed[key]) { delete closed[key]; changed = true; }
      if (!expanded[key]) { expanded[key] = true; changed = true; }
    } else if (!Object.hasOwn(expanded, key) && !Object.hasOwn(closed, key)) {
      expanded[key] = true;
      changed = true;
    }
  }

  return changed;
}

export function buildShowcaseMarkdown(lang = currentLanguage()) {
  const noteLink = showcasePath(lang).replace(/\.md$/i, "");
  if (lang === "en") {
    return [
      `# Agent Deck ${SHOWCASE_VERSION} — Interactive Feature Showcase`,
      "",
      "> [!tip] Safe Simulated Sandbox",
      `> All records below are local Markdown examples created for Agent Deck **v${SHOWCASE_VERSION}**. Nothing here connects to live CLI sessions or affects your token usage stats.`,
      "> - **Sidebar Project Grouping**: Open the right Agent Deck panel and switch **Now / Recent** to **By project**. Hover a project header to open its folder, launch **Team Workbench**, or batch-stop active runs.",
      "> - **In-Place Fractal Board**: Drag cards across columns, switch **By status / By group**, click **↳** on a group card to Zoom in, or click **Team / Split** in the board toolbar.",
      "> - **Reopen anytime**: Command Palette → `Open 1.10.0 feature showcase note`.",
      "",
      "## 1. In-Place Fractal Kanban Board (With Zoom & Mirror Cards)",
      "",
      `- TODO Agent Deck ${SHOWCASE_VERSION} Release Board (try switching By status / By group / Team / Outline) ^${SHOWCASE_BOARD_KEY}`,
      `  - DOING Phase 1: Project Aggregation & Fractal Engine ^ad-demo-p1`,
      "    - DONE Group sidebar sessions by project + priority state @codex",
      "      - 💬 Round 1: Task: aggregate active runs under project folders; Result: hitlimit, queued, and error states bubble to the top.",
      "    - DOING Render CM6 in-place Kanban boards with drag-and-drop and Zoom @claude",
      "      - 💬 Round 1: Task: keep pure Markdown as single source of truth; Result: board columns project live CM6 widgets with subtree moves.",
      "    - DELEGATED Resolve wikilink context packs in delegation prompts @opencode",
      "      - 📋 Read linked note sections and `^blockId` excerpts into delegation context.",
      `  - TODO Phase 2: Team Workbench & Parallel Dispatch ^ad-demo-p2`,
      "    - NEEDOK? Confirm default background execution for multi-agent team waves @claude",
      "      - ❓ Should team workbench waves default to background concurrent execution?",
      "    - TOREVIEW Verify drag-and-drop indentation and mirror card navigation @codex",
      "      - 💬 Round 1: Task: test mirror card source jump; Result: ready for final Obsidian UI review.",
      "  - TODO Polish bilingual changelog and release notes @qoder",
      `  - ![[${noteLink}#^${SHOWCASE_MIRROR_SOURCE_KEY}]]`,
      "",
      "## 2. Four AI Record Views (Table · Cards · Timeline · Outline)",
      "",
      "Click the view pills on any task line below to switch freely between **Outline / Table / Cards / Timeline**:",
      "",
      `- DOING 🤖 Simulated Session · Table View ^${SHOWCASE_RECORD_KEYS.table}`,
      "  - ❓ Round 1: Check module boundaries and confirm zero circular imports across `src/`.",
      "  - 📋 Inspected `src/outline.js`, `src/harness.js`, and `src/project-workbench.js`.",
      "  - 💬 Round 1: Task: audit core module dependency directions; Result: shared primitives extracted with zero circular imports.",
      "  - ❓ Round 2: Verify `npm test` and i18n coverage before tagging the release.",
      "  - 💬 Round 2: Task: run full unit tests and i18n checks; Result: all unit tests, architecture checks, and bilingual keys pass.",
      "  - ⏱ Simulated 12m (demo placeholder — excluded from real analytics)",
      "",
      `- DONE 🤖 Simulated Session · Cards View ^${SHOWCASE_RECORD_KEYS.cards}`,
      "  - ❓ Round 1: Design project-level Stop / Workbench quick actions on sidebar headers.",
      "  - 📋 Added hover action strip for Open Folder, Team Workbench, and Batch Stop.",
      "  - 💬 Round 1: Task: add project-level quick actions on sidebar headers; Result: supports one-click Team Workbench launch and batch stop.",
      "  - ❓ Round 2: Ensure queued and rate-limited sessions appear in the sidebar with retry metadata.",
      "  - 💬 Round 2: Task: display queued and rate-limited states; Result: shows queue position, cooldown remaining, and reason hints.",
      "  - ⏱ Simulated 9m (demo placeholder — excluded from real analytics)",
      "",
      `- DOING 🤖 Simulated Session · Timeline View ^${SHOWCASE_RECORD_KEYS.timeline}`,
      "  - ❓ Round 1: Prototype WorkFlowy-style Mirror Cards referencing shared tasks.",
      "  - 📋 Added shared `parseMirrorRef` parser so analytics and journals never double-count mirrors.",
      "  - 💬 Round 1: Task: support inline mirror cards and source jump in boards; Result: clicking a mirror card title jumps straight to its source line.",
      "  - ❓ Round 2: Add Zoom breadcrumbs so deep task hierarchies stay clean inside boards.",
      "  - 💬 Round 2: Task: support multi-level nested group Zoom drill-down; Result: breadcrumbs navigate cleanly back to any parent level.",
      "  - ⏱ Simulated 15m (demo placeholder — excluded from real analytics)",
      "",
      `- DONE 🤖 Simulated Session · Outline View ^${SHOWCASE_RECORD_KEYS.outline}`,
      "  - ❓ Round 1: Keep raw Markdown outline lossless even when board or table decorations are active.",
      "  - 💬 Round 1: Task: verify plain-text outline compatibility; Result: full tree structure stays intact even with decorations off or in external editors.",
      "  - ⏱ Simulated 6m (demo placeholder — excluded from real analytics)",
      "",
      "## 3. Mirror Source Task (Referenced by the Board Above)",
      "",
      `- DOING Align board tokens & light/dark theme variables ^${SHOWCASE_MIRROR_SOURCE_KEY}`,
      "  - This is the canonical source block referenced by the mirror card inside the Kanban board above. Change its status (for example to `DONE`) and watch every mirror card stay in sync.",
      "",
    ].join("\n");
  }

  return [
    `# Agent Deck ${SHOWCASE_VERSION} · 新功能交互示例`,
    "",
    "> [!tip] 纯净模拟沙盒（不会影响真实会话与用量统计）",
    `> 本笔记为你预置了 **Agent Deck ${SHOWCASE_VERSION}** 的核心界面模拟。你可以直接拖拽卡片、切换视图或体验分形下钻——所有内容均为纯 Markdown 示例，**不绑定真实 CLI 会话、不改写日记、也不计入 Token 统计**。`,
    "> - **侧边栏「按项目」聚合（P0）**：在右侧 Agent Deck 面板把 **正在进行 / 最近会话** 切到 **按项目**，悬停项目标题可直达「打开目录 / 小队工作台 / 一键停止该项目」。",
    "> - **原地分形看板 + 小队工作台（P1）**：直接在下方看板拖拽卡片跨列、点 **按状态分列 / 按子组分列**、点子组卡片的 **↳ Zoom** 下钻，或点工具栏 **小队 / 拆解** 体验 Copilot 自动拆解与多模型分工。",
    "> - **随时重开本示例**：命令面板搜索 `打开 1.10.0 新功能示例笔记`。",
    "",
    "## 1. 原地分形看板（支持子组下钻 Zoom 与跨块镜像卡）",
    "",
    `- TODO Agent Deck ${SHOWCASE_VERSION} 发布协同看板（试试点右上角「按状态分列 / 小队 / 切回大纲」） ^${SHOWCASE_BOARD_KEY}`,
    "  - DOING 阶段一：项目聚合与分形引擎 ^ad-demo-p1",
    "    - DONE 梳理右侧栏按项目分组与状态优先级 @codex",
    "      - 💬 第1轮：任务：按项目目录与最后活跃时间聚合会话；结论：已在侧边栏上线，hitlimit / queued / error 状态会自动置顶提示。",
    "    - DOING 实现 CM6 原地分形看板、拖拽回写与 Zoom 面包屑 @claude",
    "      - 💬 第1轮：任务：保持纯 Markdown 为唯一数据源；结论：卡片拖拽会直接改写缩进层级与状态关键字，支持任意嵌套层级下钻。",
    "    - DELEGATED 补充 Harness 双链上下文解析 @opencode",
    "      - 📋 自动读取任务中引用的 `[[双链笔记]]` 与 `^blockId` 片段并注入委派上下文。",
    "  - TODO 阶段二：小队工作台与多模型并发 ^ad-demo-p2",
    "    - NEEDOK? 确认多 Agent 并发默认走后台策略 @claude",
    "      - ❓ 多 Agent 工作台一键派发时，确认所有子节点默认走后台并发、不抢占桌面终端？",
    "    - TOREVIEW 实机核对看板拖拽重排与镜像跳转 @codex",
    "      - 💬 第1轮：任务：核验镜像卡点击与源任务同步；结论：点击上方镜像卡片可跳至本文底部源任务。",
    "  - TODO 整理演示截图与发版说明 @qoder",
    `  - ![[${noteLink}#^${SHOWCASE_MIRROR_SOURCE_KEY}]]`,
    "",
    "## 2. AI 自动记录 · 四种视图对照（表格 · 卡片 · 时间线 · 大纲）",
    "",
    "点击每条任务右侧的 **记录 / 视图切换按钮**（`大纲 · 表格 · 卡片 · 时间线`），可以直接对比同一份 AI 记录在不同视图下的排版效果：",
    "",
    `- DOING 🤖 模拟自动记录 · 表格视图（Table） ^${SHOWCASE_RECORD_KEYS.table}`,
    "  - ❓ 第1轮：检查核心模块依赖边界，确认 `src/` 下无循环引用。",
    "  - 📋 已扫描 `src/outline.js`、`src/harness.js` 与 `src/project-workbench.js` 的导出依赖。",
    "  - 💬 第1轮：任务：审计模块职责与依赖方向；结论：共享大纲解析原语已统一抽取，零循环依赖。",
    "  - ❓ 第2轮：发版前核对全部单元测试与双语翻译键覆盖率。",
    "  - 💬 第2轮：任务：运行完整测试与构建链路；结论：单元测试、架构校验与 i18n 键检查全部通过。",
    "  - ⏱ 模拟耗时 12 分钟（示例占位，不计入真实统计）",
    "",
    `- DONE 🤖 模拟自动记录 · 卡片视图（Cards） ^${SHOWCASE_RECORD_KEYS.cards}`,
    "  - ❓ 第1轮：在侧边栏项目头增加打开目录、团队工作台与批量停止入口。",
    "  - 📋 复用了工作流层的活跃进程索引与项目名归一化逻辑。",
    "  - 💬 第1轮：任务：完成项目级悬停快捷操作栏；结论：支持单项目一键批量停止与直接打开项目工作台。",
    "  - ❓ 第2轮：补充排队与限流状态在侧边栏和工作区卡片中的提示文案。",
    "  - 💬 第2轮：任务：适配 hitlimit 与 queued 状态展示；结论：可展示排队序号、预计冷却剩余与具体原因。",
    "  - ⏱ 模拟耗时 9 分钟（示例占位，不计入真实统计）",
    "",
    `- DOING 🤖 模拟自动记录 · 时间线视图（Timeline） ^${SHOWCASE_RECORD_KEYS.timeline}`,
    "  - ❓ 第1轮：设计 WorkFlowy 风格的跨笔记镜像卡片渲染与源行同步。",
    "  - 📋 引入共享 `parseMirrorRef`，确保统计分析与每日归档不会重复计入镜像任务。",
    "  - 💬 第1轮：任务：支持看板中渲染 `![[note#^blockId]]` 镜像卡；结论：展示源状态、Agent 标签与一键跳转图标。",
    "  - ❓ 第2轮：为深层大纲树补全 Zoom 下钻与面包屑导航。",
    "  - 💬 第2轮：任务：支持任意深度子组下钻看板；结论：顶部面包屑可一键返回上层或根节点。",
    "  - ⏱ 模拟耗时 15 分钟（示例占位，不计入真实统计）",
    "",
    `- DONE 🤖 模拟自动记录 · 大纲视图（Outline） ^${SHOWCASE_RECORD_KEYS.outline}`,
    "  - ❓ 第1轮：确认开启看板与表格装饰后，纯文本大纲依然保持 100% 原生可读。",
    "  - 💬 第1轮：任务：验证无损 Markdown 格式；结论：关掉插件或在任意编辑器中查看，层级缩进、任务状态与记录符号完整保留。",
    "  - ⏱ 模拟耗时 6 分钟（示例占位，不计入真实统计）",
    "",
    "## 3. 镜像源任务（被上方看板直接引用）",
    "",
    `- DOING 对齐浅色 / 深色主题与看板样式变量 ^${SHOWCASE_MIRROR_SOURCE_KEY}`,
    "  - 这是上方分形看板里 `镜像` 卡片指向的源任务。试着把这里的 `DOING` 改成 `DONE`，上方看板里的镜像卡片会同步切换状态。",
    "",
  ].join("\n");
}
