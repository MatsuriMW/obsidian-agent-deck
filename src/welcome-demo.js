// Interactive showcase & "What's New" note generator and one-shot view preset seeder.
// Pure module: zero dependency on Obsidian, DOM, or session scanners.
//
// Layout invariant: ALWAYS place "What's New" (latest release highlights + visuals + "Try it now")
// at the very top right after the 2-line Quick Start, written in plain, user-friendly language
// (zero internal code jargon), followed by the interactive sandbox sections.

import { currentLanguage } from "./i18n.js";

export const SHOWCASE_VERSION = "1.10.0";
export const SHOWCASE_RELEASE_FLOOR = "1.13.29";

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
      "> - **Minimum recording duration**: By default, only conversations with **at least 1 minute** of active time are automatically written to your daily note (archived sessions are always recorded regardless of length). You can adjust or set this to `0` in **Settings → Recording → More settings → Minimum session duration (minutes)**.",
      "",
      "## 1. What's New",
      "",
      "### Personal Memory Reimagined: Visual Knowledge Graph, Easy Review & On-Demand AI Lookup",
      "Your saved preferences, project lessons, and recurring workflows now turn into concise, readable cards connected cleanly in Obsidian's **Graph View** across topics, projects, and source notes — with one-click graph color presets, conflict spotting, table browsing, and automatic archiving for outdated entries. In the **Memory Board**, filter by status or batch-confirm personal journal logs, or run item-by-item review to confirm, reject, and resolve conflicts in place; delegating also matches multi-keyword lessons more accurately and external AI assistants can look up relevant memories on demand or propose new learnings for review. (If you are still on single-file mode, click **Migrate to one-file-per-memory store (recommended)** first.)",
      "",
      `![Browse and organize your personal memory network](${IMG_BASE}/memory-base.png)`,
      "",
      "- **Try it now**: Open **Settings → Dreaming → Memory Workspace** (click **Open Memory Board**, expand **Graph & Store Maintenance** for graph presets, or click **Review one by one**), or run `Memory: open the memory board (columns by state, drag to change)` from the Command Palette.",
      "",
      "### Staged Multi-AI Workbench: Auto Breakdown, Batch Handoff & One-Click Recovery",
      "Turn large goals into staged batches (**Batch 1 / 2 / 3**) across multiple AI assistants. When one batch wraps up, its findings pass straight into the next batch and end with a steward summary. The workbench flags overlapping file edits with one-click staggering, skips unavailable or rate-limited tools automatically, and keeps queued batches intact if a step pauses with a question or fails so you can answer, swap assistants, retry failed items, or skip ahead without starting over.",
      "",
      `![Project Workbench: staged multi-AI collaboration](${RAW_BASE}/project-workbench.en.png)`,
      "",
      "- **Try it now**: Click the **Project Workbench** icon at the top of the Agent Deck sidebar, right-click any task line and pick **Plan & assign team in Project Workbench**, or run `Open Project Workbench: team setup & concurrent dispatch` from the Command Palette.",
      "",
      "### Pick Any Workspace Folder & Drag Any Task Straight to an AI",
      "Freely choose a project folder, browse folders directly, or switch back to **Vault root (no project)** when delegating or launching work from the Project Workbench — with recent folders remembered automatically, smoother Windows folder and terminal handoffs, and automatic workspace display & missing-folder recovery when continuing a conversation. You can also drag bullet, numbered, or checkbox list items directly onto sidebar AI cards to delegate or onto session cards to bind, use lowercase keywords (`todo` / `doing` / `done`), and view clean read-only boards and four-view AI records in Reading View.",
      "",
      `![Interactive boards and drag-to-delegate sidebar](${IMG_BASE}/fractal-board-and-sidebar.en.png)`,
      "",
      "- **Try it now**: Pick or browse a workspace folder when delegating, or drag any list item onto a sidebar AI card.",
      "",
      "### Expanded to 21 AI Assistants, 11 Terminals & Cleaner Daily Logs",
      "Now supports **Trae**, **Orca**, **TeleAgent**, **Cindy**, **Kimi Code**, **DoubaoWork**, and **Gemini CLI** alongside existing tools — with background delegation extended to Cursor, Kimi Code, Gemini CLI, and Trae when their CLI is installed (falling back to desktop handoff otherwise), plus automatic deduplication when one client launches another. Terminal handoff now supports **11 terminals** (adding Ghostty, WezTerm, Kitty, Alacritty, cmux, and tmux), while daily logs feature crisp round badges, assistant icons, collapsible subagent summaries, and automatic tracking recovery when you unarchive or resume past sessions.",
      "",
      `![Supported AI assistants in Agent Deck](${RAW_BASE}/agents.png)`,
      "",
      "- **Try it now**: Click **Re-detect Harnesses** under **Settings → Recording** (or **Delegation**), and choose **Primary terminal** under **Settings → Delegation → Shared terminal & other Agents**.",
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
      `- TODO Product Launch Checklist (try switching By status / By group · Team / Plan · Outline) ^${SHOWCASE_BOARD_KEY}`,
      "  - DOING Phase 1: Research & Outline ^ad-demo-p1",
      "    - DONE Collect user feedback and top feature requests @codex",
      "      - 💬 Round 1: Summarized the top 5 requests and grouped them by priority.",
      "    - DOING Draft the announcement post and key visuals @claude",
      "      - 💬 Round 1: First draft ready with clear before-and-after examples.",
      "    - DELEGATED Review linked design notes for consistency @opencode",
      "      - 📋 Checking tone and terminology across all linked pages.",
      "  - TODO Phase 2: Polish & Publish ^ad-demo-p2",
      "    - NEEDOK Confirm whether to send the newsletter on Tuesday morning @claude",
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
      "> - **最短記錄時長**：目前預設只有**累計活躍超過 1 分鐘**的對話才會被自動記進日記（已歸檔的會話無論多短都會記錄）；可以在「設定 → 記錄 → 更多設定 → 最短記錄時長（分鐘）」裡隨時調低或改為 `0`。",
      "",
      "## 1. 本期新功能（What's New）",
      "",
      "### 個人長期記憶全面升級：看得見的知識網路、輕鬆審閱與外部 AI 隨用隨查",
      "沉澱下來的偏好、專案經驗與常用規則會自動整理成簡短好讀的記憶卡片，在 Obsidian **關聯圖譜**裡連向對應主題、專案與原始日記；支援一鍵圖譜分組配色、衝突發現、表格瀏覽與過期自動歸檔恢復。在「記憶看板」裡可依狀態篩選或批次確認本人日誌記憶，點「逐條審閱」也能就地確認、拒絕與裁決衝突；派活時更精準挑出相關經驗，並支援外部 AI 按需查詢或提議補充記憶供你把關（仍為單檔模式時可先點「遷移到一文一條記憶庫（推薦）」啟用完整體驗）。",
      "",
      `![瀏覽與整理你的個人知識網路](${IMG_BASE}/memory-base.png)`,
      "",
      "- **立即試試**：打開「設定 → Dreaming → 記憶庫工作區」（點「開啟記憶看板」、展開「圖譜與庫維護」應用圖譜預設，或點「逐條審閱」），或在指令面板搜尋 `記憶：開啟記憶看板（按狀態分列，可拖拽）`。",
      "",
      "### 多 AI 分批協作工作台：自動拆解、排批接力與失敗一鍵重派",
      "複雜任務可以直接在工作台拆成「第 1 / 2 / 3 批」交給不同 AI 助手分工合作，前一批完成後自動帶著摘要接力下一批並由管家總結驗收。支援偵測同批修改衝突並一鍵錯峰、自動避開未安裝或額度受限的助手；中途有人反問或失敗時會保留後續批次佇列，回答問題、換助手或點「重派失敗項」就能無縫接著往下跑。",
      "",
      `![專案工作台：分批協調多 AI 分工接力](${RAW_BASE}/project-workbench.png)`,
      "",
      "- **立即試試**：點 Agent Deck 側欄頂部的「專案工作台」圖示、右鍵任意任務列點「在專案工作臺拆解並分配小隊」，或在指令面板執行 `開啟專案協作工作臺：小隊編排與拆解派發`。",
      "",
      "### 委派與續聊自由指定工作目錄，列表項隨手一拖就能派活",
      "派發任務或在專案工作台編排小隊時，可以自由挑選專案資料夾、直接瀏覽本機目錄或切回「庫根目錄（不指定專案）」，系統會自動記住最近使用過的工作目錄，Windows 路徑與終端交接也更順暢；續聊或回覆提問時也會顯示目前工作目錄，原目錄遺失時會自動切換復原。同時支援把無序、有序或核取方塊列表項直接拖到側欄 AI 卡片派活或拖到會話卡綁定，支援全小寫任務關鍵詞（`todo` / `doing` / `done`），閱讀檢視也能直接預覽乾淨的唯讀看板與四種 AI 記錄檢視。",
      "",
      `![互動看板與側欄拖拽派發體驗](${IMG_BASE}/fractal-board-views.png)`,
      "",
      "- **立即試試**：派發任務時挑選或瀏覽工作目錄，或直接把任意列表項拖到側欄 AI 卡片上。",
      "",
      "### 支援擴展至 21 家 AI 助手與 11 家主力終端，日記記錄更清爽",
      "新加入對 **Trae**、**Orca**、**TeleAgent（星辰超級智能體）**、**Cindy**、**Kimi Code**、**豆包工作** 與 **Gemini CLI** 的支援，並為 Cursor、Kimi Code、Gemini CLI 與 Trae 補齊後台委派（已裝對應命令列時支援後台直派，未裝則自動改用桌面交接），聚合客戶端啟動的底層會話也會自動去重。終端清單擴展到 **11 家**（新增 Ghostty、WezTerm、Kitty、Alacritty、cmux、tmux）；日記裡的圓圈輪次徽標與助手圖示更精緻，子代理過程可隨母任務折疊，取消歸檔或續聊舊對話也會自動接回追蹤。",
      "",
      `![Agent Deck 支援的多家 AI 助手](${RAW_BASE}/agents.png)`,
      "",
      "- **立即試試**：打開「設定 → 記錄（或 委派）」點 `重新偵測 Harness` 識別本機工具，並在「設定 → 委派 → 公共終端與其餘 Agent」選擇 `主力終端`。",
      "",
      "---",
      "",
      "> [!tip] 下面是互動練習區（不會影響真實記錄與統計）",
      `> 以下內容全是本地範例，你可以放心拖曳看板卡片、切換檢視或體驗下鑽，**不會動到真實 AI 會話與日記**。隨時可在指令面板搜尋 \`開啟 ${SHOWCASE_VERSION} 新功能示例筆記\` 重開本頁。`,
      "",
      "## 2. 動手試試：原地看板（拖曳、分組與下鑽）",
      "",
      `![同一份清單，隨時切進看板模式拖曳整理](${IMG_BASE}/fractal-board-views.png)`,
      "",
      `- TODO 新版本發布清單（試試點右上角「按狀態分列 / 按子組分列 · 小隊 / 拆解 · 切回大綱」） ^${SHOWCASE_BOARD_KEY}`,
      "  - DOING 第一階段：整理需求與初稿 ^ad-demo-p1",
      "    - DONE 整理近期使用者回饋與高頻建議 @codex",
      "      - 💬 第1輪：已歸納出最受期待的 5 個方向，按優先順序排好。",
      "    - DOING 撰寫更新亮點介紹與配圖說明 @claude",
      "      - 💬 第1輪：初稿已完成，重點突出了前後對比與上手步驟。",
      "    - DELEGATED 核對相關說明筆記的說法是否一致 @opencode",
      "      - 📋 正在比對多篇筆記裡的名稱與語氣。",
      "  - TODO 第二階段：潤飾與發布 ^ad-demo-p2",
      "    - NEEDOK 確認這週二早上是否同步發出更新通知 @claude",
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
    "> - **最短记录时长**：目前默认只有**累计活跃超过 1 分钟**的对话才会被自动记进日记（已归档的会话无论多短都会记录）；可以在「设置 → 记录 → 更多设置 → 最短记录时长（分钟）」里随时调低或改为 `0`。",
    "",
    "## 1. 本期新功能（What's New）",
    "",
    "### 个人长期记忆全面升级：看得见的知识网络、轻松审阅与外部 AI 随用随查",
    "沉淀下来的偏好、项目经验与常用规则会自动整理成简短好读的记忆卡片，在 Obsidian **关系图谱**里连向对应主题、项目与原始日记；支持一键图谱分组配色、冲突发现、表格浏览与过期自动归档恢复。在「记忆看板」里可按状态筛选或批量确认本人日志记忆，点「逐条审阅」也能就地确认、拒绝与裁决冲突；派活时更精准挑出相关经验，并支持外部 AI 按需查询或提议补充记忆供你把关（仍为单文件模式时可先点「迁移到一文一条记忆库（推荐）」启用完整体验）。",
    "",
    `![浏览与整理你的个人知识网络](${IMG_BASE}/memory-base.png)`,
    "",
    "- **立即试试**：打开「设置 → Dreaming → 记忆库工作区」（点「打开记忆看板」、展开「图谱与库维护」应用图谱预设，或点「逐条审阅」），或在命令面板搜索 `记忆：打开记忆看板（按状态分列，可拖拽）`。",
    "",
    "### 多 AI 分批协作工作台：自动拆解、排批接力与失败一键重派",
    "复杂任务可以直接在工作台拆成「第 1 / 2 / 3 批」交给不同 AI 助手分工合作，前一批完成后自动带着摘要接力下一批并由管家总结验收。支持检测同批修改冲突并一键错峰、自动避开未安装或额度受限的助手；中途有人反问或失败时会保留后续批次队列，回答问题、换助手或点「重派失败项」就能无缝接着往下跑。",
    "",
    `![项目工作台：分批协调多 AI 分工接力](${RAW_BASE}/project-workbench.png)`,
    "",
    "- **立即试试**：点 Agent Deck 侧栏顶部的「项目工作台」图标、右键任意任务行点「在项目工作台拆解并分配小队」，或在命令面板运行 `打开项目协作工作台：小队编排与拆解派发`。",
    "",
    "### 委派与续聊自由指定工作目录，列表项随手一拖就能派活",
    "派发任务或在项目工作台编排小队时，可以自由挑选项目文件夹、直接浏览本地目录或切回「库根目录（不指定项目）」，系统会自动记住最近使用过的工作目录，Windows 路径与终端交接也更顺畅；续聊或回复提问时也会显示当前工作目录，原目录丢失时会自动切换恢复。同时支持把无序、有序或复选框列表项直接拖到侧栏 AI 卡片派活或拖到会话卡绑定，支持全小写任务关键词（`todo` / `doing` / `done`），阅读视图也能直接预览干净的只读看板与四种 AI 记录视图。",
    "",
    `![互动看板与侧栏拖拽派发体验](${IMG_BASE}/fractal-board-views.png)`,
    "",
    "- **立即试试**：派发任务时挑选或浏览工作目录，或直接把任意列表项拖到侧栏 AI 卡片上。",
    "",
    "### 支持扩展至 21 家 AI 助手与 11 家主力终端，日记记录更清爽",
    "新加入对 **Trae**、**Orca**、**TeleAgent（星辰超级智能体）**、**Cindy**、**Kimi Code**、**豆包工作** 与 **Gemini CLI** 的支持，并将后台委派扩展到 Cursor、Kimi Code、Gemini CLI 与 Trae（已装对应命令行时支持后台直派，未装则自动改用桌面交接），聚合客户端拉起的底层会话也会自动去重。终端清单扩展到 **11 家**（新增 Ghostty、WezTerm、Kitty、Alacritty、cmux、tmux）；日记里的圆圈轮次徽标与助手图标更精致，子代理过程可随母任务折叠，取消归档或续聊旧对话也会自动接回追踪。",
    "",
    `![Agent Deck 支持的多家 AI 助手](${RAW_BASE}/agents.png)`,
    "",
    "- **立即试试**：打开「设置 → 记录（或 委派）」点 `重新检测 Harness` 识别本机工具，并在「设置 → 委派 → 公共终端与其余 Agent」选择 `主力终端`。",
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
    `- TODO 新版本发布清单（试试点右上角「按状态分列 / 按子组分列 · 小队 / 拆解 · 切回大纲」） ^${SHOWCASE_BOARD_KEY}`,
    "  - DOING 第一阶段：整理需求与初稿 ^ad-demo-p1",
    "    - DONE 整理近期用户反馈与高频建议 @codex",
    "      - 💬 第1轮：已归纳出最受期待的 5 个方向，按优先级排好。",
    "    - DOING 撰写更新亮点介绍与配图说明 @claude",
    "      - 💬 第1轮：初稿已完成，重点突出了前后对比和上手步骤。",
    "    - DELEGATED 核对相关说明笔记的说法是否一致 @opencode",
    "      - 📋 正在比对多篇笔记里的名称与语气。",
    "  - TODO 第二阶段：润色与发布 ^ad-demo-p2",
    "    - NEEDOK 确认这周二早上是否同步发出更新通知 @claude",
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
