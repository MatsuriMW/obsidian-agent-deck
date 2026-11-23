// Interactive showcase & "What's New" note generator and one-shot view preset seeder.
// Pure module: zero dependency on Obsidian, DOM, or session scanners.
//
// Layout invariant: ALWAYS place "What's New" (latest release highlights + visuals + "Try it now")
// at the very top right after the 2-line Quick Start, written in plain, user-friendly language
// (zero internal code jargon), followed by the interactive sandbox sections.

import { currentLanguage } from "./i18n.js";

export const SHOWCASE_VERSION = "1.10.0";
export const SHOWCASE_RELEASE_FLOOR = "1.13.13";

const RAW_BASE = "https://raw.githubusercontent.com/MatsuriMW/obsidian-agent-deck/main/assets";
const IMG_BASE = `${RAW_BASE}/shadow`;

function parseVerTuple(version) {
  const clean = String(version || "").trim().replace(/^v/i, "").split(/[-+]/)[0];
  if (!clean) return null;
  const parts = clean.split(".").map((n) => Number.parseInt(n, 10));
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return null;
  return [parts[0], parts[1], parts[2] || 0];
}

function cmpVer(a, b) {
  const pa = parseVerTuple(a);
  const pb = parseVerTuple(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

export function majorMinorOf(version) {
  const parts = parseVerTuple(version);
  if (!parts) return "";
  return `${parts[0]}.${parts[1]}`;
}

export function shouldOpenShowcaseForVersion(currentVersion, seenVersion, { floor = SHOWCASE_RELEASE_FLOOR } = {}) {
  const cur = majorMinorOf(currentVersion);
  if (!cur) return false;
  const seen = majorMinorOf(seenVersion);
  if (!seen) return true;
  if (floor && cmpVer(currentVersion, floor) >= 0 && cmpVer(seenVersion, floor) < 0) return true;
  return cur !== seen;
}

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
      "# Agent Deck — What's New & Interactive Guide",
      "",
      "> [!info] How to use Agent Deck?",
      "> The simplest way is to **do nothing at all**: just keep Obsidian open and work with your favorite AI tools as usual. Come back after a while, and Agent Deck will have recorded what you worked on.",
      "> - **Minimum recording duration**: By default, only conversations with **at least 1 minute** of active time are automatically written to your daily note (archived sessions are always recorded regardless of length). You can adjust or set this to `0` in **Settings → Recording**.",
      "",
      "## 1. What's New",
      "",
      "### Bring Your Own AI Tools — No Need to Wait for Updates",
      "Beyond the built-in AI assistants, you can now add your own compatible AI tools right from Settings. Give it a name and launch command, and you can mention it with `@` in any note to start working together — with credentials kept safely outside your vault.",
      "",
      `![Supported AI assistants in Agent Deck](${RAW_BASE}/agents.png)`,
      "",
      "- **Try it now**: Open **Settings → Delegation → Custom ACP Agents** and click **+ Add custom ACP Agent**.",
      "",
      "### One-Click Safety Check for Past AI Actions",
      "Review everything your AI assistants did over the past 7 or 30 days in one clean report. Risky commands, sensitive folders, or accidental keys are grouped into **High / Medium / Low** with sensitive values automatically masked, and trusted folders can be allowlisted right at the top of the report.",
      "",
      `![Collaboration Review Dashboard](${IMG_BASE}/dashboard-overview.en.png)`,
      "",
      "- **Try it now**: Open the Command Palette and run `Security: replay tool calls from the last 7 days`, or click **7-day replay** inside the Review Dashboard.",
      "",
      "### More AI Assistants & Combined Effort per Task",
      "Now tracks **T3 Code**, **MiniMax Code**, and **Muse** alongside your existing assistants. When you ask several AIs to help with the same task, the badge at the end of the line automatically combines total time, total usage, and session count — hover to see each assistant's share.",
      "",
      `![Project Workbench: organize multi-AI work by project](${RAW_BASE}/project-workbench.en.png)`,
      "",
      "- **Try it now**: Drag multiple session cards onto the same task line, or check **Settings → Recording** to turn on newly installed tools.",
      "",
      "### Gentle Update Reminders & Pinned Menu Bar Panel",
      "When a new version of Agent Deck arrives, a gentle prompt lets you jump straight to update (or skip that version). On macOS, the top menu bar panel now supports **Pinning** — click the pin icon in the top-right corner to keep it floating on screen while you work in other apps.",
      "",
      `![macOS Menu Bar panel with one-click Pin](${RAW_BASE}/menubar.png?v=1.13.14)`,
      "",
      "- **Try it now**: Open **Settings → About → Check for updates** anytime.",
      "",
      "---",
      "",
      "> [!tip] Try It Yourself — Safe Interactive Sandbox Below",
      `> Everything below is a local practice note. Feel free to drag cards, switch views, or zoom into sub-groups — nothing here touches your real AI sessions, daily notes, or stats. Reopen anytime from the Command Palette (\`Open ${SHOWCASE_VERSION} feature showcase note\`).`,
      "",
      "## 2. Try the In-Place Board (Drag, Group & Zoom)",
      "",
      `![Switch any outline into an interactive board right inside your note](${IMG_BASE}/fractal-board-and-sidebar.en.png)`,
      "",
      `- TODO Product Launch Checklist (try switching By status / By group / Team / Outline) ^${SHOWCASE_BOARD_KEY}`,
      "  - DOING Phase 1: Research & Outline ^ad-demo-p1",
      "    - DONE Collect user feedback and top feature requests @codex",
      "      - 💬 Round 1: Summarized the top 5 requests and grouped them by priority.",
      "    - DOING Draft the announcement post and key visuals @claude",
      "      - 💬 Round 1: First draft ready with clear before-and-after examples.",
      "    - DELEGATED Review linked design notes for consistency @opencode",
      "      - 📋 Checking tone and terminology across all linked pages.",
      "  - TODO Phase 2: Polish & Publish ^ad-demo-p2",
      "    - NEEDOK? Confirm whether to send the newsletter on Tuesday morning @claude",
      "      - ❓ Should we schedule the newsletter for Tuesday 9:00 AM or wait until Thursday?",
      "    - TOREVIEW Final proofread of the bilingual landing page @codex",
      "      - 💬 Round 1: Spelling and links verified; ready for your final glance.",
      "  - TODO Prepare demo screenshots for social posts @qoder",
      `  - ![[${noteLink}#^${SHOWCASE_MIRROR_SOURCE_KEY}]]`,
      "",
      "## 3. Try Four Views for the Same AI Record",
      "",
      `![Switch between Outline, Table, Cards, and Timeline with one click](${IMG_BASE}/ai-record-views.en.webp)`,
      "",
      "Click the view switcher on any line below to compare **Outline / Table / Cards / Timeline**:",
      "",
      `- DOING 🤖 Practice Record · Table View ^${SHOWCASE_RECORD_KEYS.table}`,
      "  - ❓ Round 1: Summarize this week's project milestones and highlight any blockers.",
      "  - 📋 Reviewed weekly notes and active project tasks.",
      "  - 💬 Round 1: 4 milestones completed on schedule; 1 design review waiting for feedback.",
      "  - ❓ Round 2: Turn the summary into a 3-bullet update for Monday standup.",
      "  - 💬 Round 2: Ready-to-share 3-bullet standup summary drafted.",
      "  - ⏱ Simulated 12m (practice item — excluded from real stats)",
      "",
      `- DONE 🤖 Practice Record · Cards View ^${SHOWCASE_RECORD_KEYS.cards}`,
      "  - ❓ Round 1: Compare three hotel options near the conference venue.",
      "  - 📋 Checked walking distance, quietness, and cancellation policy.",
      "  - 💬 Round 1: Ranked all three options with pros, cons, and total cost.",
      "  - ❓ Round 2: Draft a quick booking checklist before confirming.",
      "  - 💬 Round 2: Added invoice, check-in time, and transit notes.",
      "  - ⏱ Simulated 9m (practice item — excluded from real stats)",
      "",
      `- DOING 🤖 Practice Record · Timeline View ^${SHOWCASE_RECORD_KEYS.timeline}`,
      "  - ❓ Round 1: Outline a 10-minute lightning talk on note-taking with AI.",
      "  - 📋 Structured into Hook, Live Demo, and 3 Practical Takeaways.",
      "  - 💬 Round 1: Slide-by-slide outline ready with timing notes.",
      "  - ❓ Round 2: Trim the middle section so the live demo gets 4 full minutes.",
      "  - 💬 Round 2: Tightened intro to 90 seconds and expanded the live demo beats.",
      "  - ⏱ Simulated 15m (practice item — excluded from real stats)",
      "",
      `- DONE 🤖 Practice Record · Outline View ^${SHOWCASE_RECORD_KEYS.outline}`,
      "  - ❓ Round 1: Keep everything as plain, readable Markdown.",
      "  - 💬 Round 1: Even with every plugin turned off, your notes stay clean and complete.",
      "  - ⏱ Simulated 6m (practice item — excluded from real stats)",
      "",
      "## 4. Linked Mirror Task (Synced with the Board Above)",
      "",
      `- DOING Finalize visual theme for dark and light mode ^${SHOWCASE_MIRROR_SOURCE_KEY}`,
      "  - This task is mirrored inside the board above. Change `DOING` to `DONE` here and watch the mirrored card update automatically.",
      "",
      "## 5. Notes, Reusable Skills & Personal Memory",
      "",
      `![Browse and edit your personal Memory Base just like a spreadsheet](${IMG_BASE}/memory-base.png)`,
      "",
      "- TODO Polish `[[Project Architecture]]` using `[[skills/example-skill]]` with `[[task-plan]]` (practice line — no need to send)",
      "  - **Link any note as background**: Mentioning a linked note automatically shares its context with your AI — no copy-pasting needed.",
      "  - **Attach reusable workflows**: Keep your favorite prompts or guides as skill notes and link them whenever you need that workflow.",
      "  - **Personal Memory Base**: Import existing notes or let Agent Deck distill long-term preferences and lessons into editable Markdown cards you can review anytime.",
      "  - **Preview before sending**: Generate a draft first if you want to inspect or edit what gets sent, and reply to AI questions right inside your note.",
      "  - ❓ Round 1 (demo): Should we keep the introduction short and visual?",
      "  - ✍️ Answer: Yes — lead with visuals and plain language, and save details for later.",
      "  - 💬 Round 1: Updated the intro to be short, visual, and easy to scan.",
      "",
    ].join("\n");
  }

  if (lang === "zh-TW") {
    return [
      "# Agent Deck · 新功能速覽與互動指南",
      "",
      "> [!info] 如何使用 Agent Deck？",
      "> 最簡單的方案就是**什麼也不做**：開著 Obsidian，然後用你最常用的 AI 去工作就可以了，過一會來看，這裡會自動記錄下你做過的事。",
      "> - **最短記錄時長**：目前預設只有**累計活躍超過 1 分鐘**的對話才會被自動記進日記（已歸檔的會話無論多短都會記錄）；可以在「設定 → 記錄 → 最短記錄時長」裡隨時調低或改為 `0`。",
      "",
      "## 1. 本期新功能（What's New）",
      "",
      "### 接入更多你自己的 AI 工具，不必等外掛發版",
      "除了內建支援的 AI 助手，現在還能在設定裡直接新增新的命令列 AI。填好名稱與啟動指令，就能像內建助手一樣在筆記裡用 `@` 叫它幹活，金鑰也會安全存放、不寫進筆記庫。",
      "",
      `![Agent Deck 支援的多家 AI 助手](${RAW_BASE}/agents.png)`,
      "",
      "- **立即試試**：打開「設定 → 委派 → 自訂 ACP Agent」，點 `+ 新增自訂 ACP Agent`。",
      "",
      "### 一鍵幫歷史 AI 操作做「安全體檢」",
      "回顧最近 7 天或 30 天裡 AI 執行過的指令與檔案改動，自動標出高風險刪除、敏感目錄存取或意外出現的金鑰，按「高危 / 中危 / 低危」分組並自動脫敏。確認安全的資料夾順手加進白名單，之後就不再重複提醒。",
      "",
      `![協作回顧 Dashboard：一眼看清投入分佈與安全概況](${IMG_BASE}/dashboard.png)`,
      "",
      "- **立即試試**：指令面板執行 `安全：快速回放最近 7 天會話並產生稽核報告`，或在協作回顧 Dashboard 點「7 天快速回放」。",
      "",
      "### 支援更多 AI 助手，同一件事的投入自動合算",
      "新加入 **T3 Code**、**MiniMax Code** 與 **Muse**。如果同一條任務先後找了好幾個 AI 幫忙，行尾會自動把總耗時、總用量與對話次數合在一起顯示，滑鼠移上去就能看每個 AI 分別做了多少。",
      "",
      `![專案工作台：按專案整理多 AI 協作](${RAW_BASE}/project-workbench.png)`,
      "",
      "- **立即試試**：把多張會話卡拖到同一條任務行上，或在「設定 → 記錄」開啟剛裝好的 AI 工具。",
      "",
      "### 有新版自動問你，macOS 選單列面板支援置頂 Pin",
      "外掛發布新版時會輕輕問你要不要更新，點一下就能直達更新頁面，也可以略過這一版；在 macOS 上，點選頂部選單列面板右上角的 **圖釘（Pin）** 就能把它固定懸浮在螢幕上，切去別的軟體也能隨時盯著 AI 進度。",
      "",
      `![macOS 選單列面板：支援右上角一鍵置頂 Pin](${RAW_BASE}/menubar.png?v=1.13.14)`,
      "",
      "- **立即試試**：打開「設定 → 關於 → 版本與支援」，隨時可點 `檢查更新`。",
      "",
      "---",
      "",
      "> [!tip] 下面是互動練習區（不會影響真實記錄與統計）",
      `> 以下內容全是本地範例，你可以放心拖曳看板卡片、切換檢視或體驗下鑽，**不會動到真實 AI 會話與日記**。隨時可在指令面板搜尋 \`打开 ${SHOWCASE_VERSION} 新功能示例笔记\` 重開本頁。`,
      "",
      "## 2. 動手試試：原地看板（拖曳、分組與下鑽）",
      "",
      `![同一份清單，隨時切進看板模式拖曳整理](${IMG_BASE}/fractal-board-views.png)`,
      "",
      `- TODO 新版本發布清單（試試點右上角「按狀態分欄 / 小隊 / 切回大綱」） ^${SHOWCASE_BOARD_KEY}`,
      "  - DOING 第一階段：整理需求與初稿 ^ad-demo-p1",
      "    - DONE 整理近期使用者回饋與高頻建議 @codex",
      "      - 💬 第1輪：已歸納出最受期待的 5 個方向，按優先順序排好。",
      "    - DOING 撰寫更新亮點介紹與配圖說明 @claude",
      "      - 💬 第1輪：初稿已完成，重點突出了前後對比與上手步驟。",
      "    - DELEGATED 核對相關說明筆記的說法是否一致 @opencode",
      "      - 📋 正在比對多篇筆記裡的名稱與語氣。",
      "  - TODO 第二階段：潤飾與發布 ^ad-demo-p2",
      "    - NEEDOK? 確認這週二早上是否同步發出更新通知 @claude",
      "      - ❓ 更新通知定在週二早上 9 點發出，還是改到週四比較好？",
      "    - TOREVIEW 終稿校對多語介紹頁 @codex",
      "      - 💬 第1輪：錯別字與連結都檢查過了，等你最後確認。",
      "  - TODO 準備社群貼文用的示範截圖 @qoder",
      `  - ![[${noteLink}#^${SHOWCASE_MIRROR_SOURCE_KEY}]]`,
      "",
      "## 3. 動手試試：同一條 AI 記錄的四種檢視",
      "",
      `![大綱、表格、卡片、時間線四種檢視一鍵切換](${IMG_BASE}/ai-record-views.webp)`,
      "",
      "點每條記錄右側的檢視按鈕（`大綱 · 表格 · 卡片 · 時間線`），直接感受不同閱讀體驗：",
      "",
      `- DOING 🤖 練習記錄 · 表格檢視 ^${SHOWCASE_RECORD_KEYS.table}`,
      "  - ❓ 第1輪：幫我總結這週的專案進度，標出卡住的地方。",
      "  - 📋 已瀏覽本週日記與進行中的任務清單。",
      "  - 💬 第1輪：本週完成 4 項重點進度，另有 1 項設計稿待確認。",
      "  - ❓ 第2輪：濃縮成週一晨會可直接念的 3 條重點。",
      "  - 💬 第2輪：已整理好 3 條精簡版晨會匯報。",
      "  - ⏱ 練習佔位 12 分鐘（不計入真實統計）",
      "",
      `- DONE 🤖 練習記錄 · 卡片檢視 ^${SHOWCASE_RECORD_KEYS.cards}`,
      "  - ❓ 第1輪：幫我比較會場附近三家飯店的優缺點。",
      "  - 📋 已對比步行距離、安靜程度與取消政策。",
      "  - 💬 第1輪：已排出推薦順序，並附上大致預算與注意事項。",
      "  - ❓ 第2輪：列一份出發前的簡短確認清單。",
      "  - 💬 第2輪：已補上發票、入住時間與交通路線提醒。",
      "  - ⏱ 練習佔位 9 分鐘（不計入真實統計）",
      "",
      `- DOING 🤖 練習記錄 · 時間線檢視 ^${SHOWCASE_RECORD_KEYS.timeline}`,
      "  - ❓ 第1輪：幫我起草一份 10 分鐘的 AI 筆記工作流分享大綱。",
      "  - 📋 按「開場痛點 → 現場示範 → 3 個可帶走的方法」拆解。",
      "  - 💬 第1輪：每頁重點與節奏時間已排好。",
      "  - ❓ 第2輪：壓縮前半段，把現場示範拉長到 4 分鐘。",
      "  - 💬 第2輪：開場已縮至 90 秒，示範步驟更充裕。",
      "  - ⏱ 練習佔位 15 分鐘（不計入真實統計）",
      "",
      `- DONE 🤖 練習記錄 · 大綱檢視 ^${SHOWCASE_RECORD_KEYS.outline}`,
      "  - ❓ 第1輪：關掉所有外掛後，這些筆記還能正常讀嗎？",
      "  - 💬 第1輪：全部都是純淨的 Markdown 原文，換任何編輯器看都清清楚楚。",
      "  - ⏱ 練習佔位 6 分鐘（不計入真實統計）",
      "",
      "## 4. 跨處同步的鏡像任務（與上方看板連動）",
      "",
      `- DOING 調整深色與淺色模式的視覺細節 ^${SHOWCASE_MIRROR_SOURCE_KEY}`,
      "  - 這一條被上方看板直接引用。試著把這裡的 `DOING` 改成 `DONE`，上方看板裡的對應卡片會一起變狀態。",
      "",
      "## 5. 筆記當背景、常用技能與個人記憶庫",
      "",
      `![像表格一樣瀏覽與修改你的個人記憶庫](${IMG_BASE}/memory-base.png)`,
      "",
      "- TODO 結合 `[[雙鏈上下文協議]]`、`[[技能/media-to-obsidian-outline]]` 與 `[[範例-task]]` 推進任務（練習條目，不必真的發送）",
      "  - **用雙鏈把筆記交給 AI**：在任務裡連上相關筆記，派活時會自動帶上背景資料，不必來回複製貼上。",
      "  - **把常用流程存成技能卡**：寫作規範、分析套路都能做成筆記，需要時連上它就能直接複用。",
      "  - **看得見、改得動的個人記憶庫**：自動沉澱你的長期偏好與經驗，每條都是普通筆記，不對就刪、想改就改。",
      "  - **先看草稿再發送，在筆記裡直接續聊**：重要任務可以先生成草稿檢查再發；AI 有疑問時，直接在筆記裡寫下回答就能接著往下做。",
      "  - ❓ 第1輪（示範）：介紹頁應該寫得簡短直觀，還是把所有細節都列出來？",
      "  - ✍️ 答：簡短直觀、多配圖，把複雜細節藏在後面就好。",
      "  - 💬 第1輪：已把開頭改成通俗直觀的說法，並補上重點配圖。",
      "",
    ].join("\n");
  }

  return [
    "# Agent Deck · 新功能速览与交互指南",
    "",
    "> [!info] 如何使用 Agent Deck？",
    "> 最简单的方案就是**什么也不做**：开着 Obsidian，然后用你最常用的 AI 去工作就可以了，过一会来看，这里会自动记录下你做过的事。",
    "> - **最短记录时长**：目前默认只有**累计活跃超过 1 分钟**的对话才会被自动记进日记（已归档的会话无论多短都会记录）；可以在「设置 → 记录 → 最短记录时长」里随时调低或改为 `0`。",
    "",
    "## 1. 本期新功能（What's New）",
    "",
    "### 接入更多你自己的 AI 工具，不用等插件发版",
    "除了内置支持的 AI 助手，现在还能在设置里直接添加新的命令行 AI。填好名字和启动命令，就能像内置助手一样在笔记里用 `@` 叫它干活，密钥也会安全存放、不会明文写进笔记库。",
    "",
    `![Agent Deck 支持的多家 AI 助手](${RAW_BASE}/agents.png)`,
    "",
    "- **立即试试**：打开「设置 → 委派 → 自定义 ACP Agent」，点 `+ 添加自定义 ACP Agent`。",
    "",
    "### 一键给历史 AI 操作做一次「安全体检」",
    "回顾最近 7 天或 30 天里 AI 执行过的命令和文件改动，自动标出高风险删除、敏感目录访问或意外出现的密钥，按「高危 / 中危 / 低危」分组并自动脱敏。确认安全的目录顺手加进白名单，以后就不会反复提醒。",
    "",
    `![协作回顾 Dashboard：一眼看清投入分布与安全概况](${IMG_BASE}/dashboard.png)`,
    "",
    "- **立即试试**：命令面板运行 `安全：快速回放最近 7 天会话并生成审计报告`，或在协作回顾 Dashboard 点击「7 天快速回放」。",
    "",
    "### 支持更多 AI 助手，同一件事的投入自动合算",
    "新加入 **T3 Code**、**MiniMax Code** 与 **Muse**。如果同一条任务先后找了好几个 AI 帮忙，行尾会自动把总耗时、总用量和对话次数合在一起显示，鼠标移上去就能看每个 AI 分别干了多少。",
    "",
    `![项目工作台：按项目整理多 AI 协作](${RAW_BASE}/project-workbench.png)`,
    "",
    "- **立即试试**：把多张会话卡片拖到同一条任务行上，或在「设置 → 记录」开启刚装好的 AI 工具。",
    "",
    "### 有新版自动问你，macOS 菜单栏面板支持置顶 Pin",
    "插件发布新版时会轻轻问你要不要更新，点一下就能直达更新页面，也可以跳过这一版；在 macOS 上，点顶部菜单栏面板右上角的 **图钉（Pin）** 就能把它固定悬浮在屏幕上，切去别的软件也能随时盯着 AI 进度。",
    "",
    `![macOS 菜单栏面板：支持右上角一键置顶 Pin](${RAW_BASE}/menubar.png?v=1.13.14)`,
    "",
    "- **立即试试**：打开「设置 → 关于 → 版本与支持」，随时可点 `检查更新`。",
    "",
    "---",
    "",
    "> [!tip] 下面是互动练习区（不会影响真实记录与统计）",
    `> 以下内容全是本地示例，你可以放心拖拽看板卡片、切换视图或体验下钻，**不会动到真实 AI 会话和日记**。随时可在命令面板搜索 \`打开 ${SHOWCASE_VERSION} 新功能示例笔记\` 重开本页。`,
    "",
    "## 2. 动手试试：原地看板（拖拽、分组与下钻）",
    "",
    `![同一份清单，随时切进看板模式拖拽整理](${IMG_BASE}/fractal-board-views.png)`,
    "",
    `- TODO 新版本发布清单（试试点右上角「按状态分列 / 小队 / 切回大纲」） ^${SHOWCASE_BOARD_KEY}`,
    "  - DOING 第一阶段：整理需求与初稿 ^ad-demo-p1",
    "    - DONE 整理近期用户反馈与高频建议 @codex",
    "      - 💬 第1轮：已归纳出最受期待的 5 个方向，按优先级排好。",
    "    - DOING 撰写更新亮点介绍与配图说明 @claude",
    "      - 💬 第1轮：初稿已完成，重点突出了前后对比和上手步骤。",
    "    - DELEGATED 核对相关说明笔记的说法是否一致 @opencode",
    "      - 📋 正在比对多篇笔记里的名称与语气。",
    "  - TODO 第二阶段：润色与发布 ^ad-demo-p2",
    "    - NEEDOK? 确认这周二早上是否同步发出更新通知 @claude",
    "      - ❓ 更新通知定在周二早上 9 点发出，还是改到周四比较好？",
    "    - TOREVIEW 终稿校对多语介绍页 @codex",
    "      - 💬 第1轮：错别字和链接都检查过了，等你最后确认。",
    "  - TODO 准备社交动态用的演示截图 @qoder",
    `  - ![[${noteLink}#^${SHOWCASE_MIRROR_SOURCE_KEY}]]`,
    "",
    "## 3. 动手试试：同一条 AI 记录的四种视图",
    "",
    `![大纲、表格、卡片、时间线四种视图一键切换](${IMG_BASE}/ai-record-views.webp)`,
    "",
    "点每条记录右侧的视图按钮（`大纲 · 表格 · 卡片 · 时间线`），直接感受不同阅读体验：",
    "",
    `- DOING 🤖 练习记录 · 表格视图 ^${SHOWCASE_RECORD_KEYS.table}`,
    "  - ❓ 第1轮：帮我总结这周的项目进度，标出卡住的地方。",
    "  - 📋 已浏览本周日记和进行中的任务清单。",
    "  - 💬 第1轮：本周完成 4 项重点进度，另有 1 项设计稿待确认。",
    "  - ❓ 第2轮：浓缩成周一晨会可以直接念的 3 条重点。",
    "  - 💬 第2轮：已整理好 3 条精简版晨会汇报。",
    "  - ⏱ 练习占位 12 分钟（不计入真实统计）",
    "",
    `- DONE 🤖 练习记录 · 卡片视图 ^${SHOWCASE_RECORD_KEYS.cards}`,
    "  - ❓ 第1轮：帮我比较会场附近三家酒店的优缺点。",
    "  - 📋 已对比步行距离、安静程度与取消政策。",
    "  - 💬 第1轮：已排出推荐顺序，并附上大致预算与注意事项。",
    "  - ❓ 第2轮：列一份出发前的简短确认清单。",
    "  - 💬 第2轮：已补上发票、入住时间与交通路线提醒。",
    "  - ⏱ 练习占位 9 分钟（不计入真实统计）",
    "",
    `- DOING 🤖 练习记录 · 时间线视图 ^${SHOWCASE_RECORD_KEYS.timeline}`,
    "  - ❓ 第1轮：帮我起草一份 10 分钟的 AI 笔记工作流分享大纲。",
    "  - 📋 按「开场痛点 → 现场演示 → 3 个可带走的方法」拆解。",
    "  - 💬 第1轮：每页重点与节奏时间已排好。",
    "  - ❓ 第2轮：压缩前半段，把现场演示拉长到 4 分钟。",
    "  - 💬 第2轮：开场已缩至 90 秒，演示步骤更充裕。",
    "  - ⏱ 练习占位 15 分钟（不计入真实统计）",
    "",
    `- DONE 🤖 练习记录 · 大纲视图 ^${SHOWCASE_RECORD_KEYS.outline}`,
    "  - ❓ 第1轮：关掉所有插件后，这些笔记还能正常读吗？",
    "  - 💬 第1轮：全部都是纯净的 Markdown 原文，换任何编辑器看都清清楚楚。",
    "  - ⏱ 练习占位 6 分钟（不计入真实统计）",
    "",
    "## 4. 跨处同步的镜像任务（与上方看板联动）",
    "",
    `- DOING 调整深色与浅色模式的视觉细节 ^${SHOWCASE_MIRROR_SOURCE_KEY}`,
    "  - 这一条被上方看板直接引用。试着把这里的 `DOING` 改成 `DONE`，上方看板里的对应卡片会一起变状态。",
    "",
    "## 5. 笔记当背景、常用技能与个人记忆库",
    "",
    `![像表格一样浏览和修改你的个人记忆库](${IMG_BASE}/memory-base.png)`,
    "",
    "- TODO 结合 `[[双链上下文协议]]`、`[[技能/media-to-obsidian-outline]]` 与 `[[示例-task]]` 推进任务（练习条目，不必真的发送）",
    "  - **用双链把笔记交给 AI**：在任务里连上相关笔记，派活时会自动带上背景资料，不用来回复制粘贴。",
    "  - **把常用流程存成技能卡**：写作规范、分析套路都能做成笔记，需要时连上它就能直接复用。",
    "  - **看得见、改得动的个人记忆库**：自动沉淀你的长期偏好与经验，每条都是普通笔记，不对就删、想改就改。",
    "  - **先看草稿再发送，在笔记里直接续聊**：重要任务可以先生成草稿检查再发；AI 有疑问时，直接在笔记里写下回答就能接着往下做。",
    "  - ❓ 第1轮（示范）：介绍页应该写得简短直观，还是把所有细节都列出来？",
    "  - ✍️ 答：简短直观、多配图，把复杂细节藏在后面就好。",
    "  - 💬 第1轮：已把开头改成通俗直观的说法，并补上重点配图。",
    "",
  ].join("\n");
}
