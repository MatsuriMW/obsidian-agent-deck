// Agent Deck — shared constants and small helpers.

import { t } from "./i18n.js";

// 追加在每条委派消息末尾：关键疑问先问，信息充分时继续执行
export const CONFIRM_FIRST = "先阅读任务及相关上下文。只有影响需求、范围或验收的问题尚不明确时，才集中向我提问；已明确或已确认的信息不要重复询问。信息充分时，简要说明执行计划并继续完成任务，运行必要检查后汇报结果。超出已授权范围的操作，先征求确认。";

export const STORE_VERSION = 1;
export const MEMORY_QUERY_ASSET_VERSION = 1;

export const DEFAULT_RECORD_RULES = {
  boldTitle: true,        // 自动记录母块标题自动加粗 **...**
  projectPrefix: true,    // 自动记录标题带 项目名 / Bot名 -> 前缀
  showTimeRange: true,    // 自动记录母块显示 HH:MM-HH:MM 时间段
  titleMax: 22,           // 自动记录生成标题最大字数
};

export function resolveRecordRules(cfg = {}) {
  const raw = cfg?.recordRules || {};
  const max = Number(raw.titleMax);
  return {
    boldTitle: raw.boldTitle !== false,
    projectPrefix: raw.projectPrefix !== false,
    showTimeRange: raw.showTimeRange !== false,
    titleMax: Number.isFinite(max) && max >= 10 ? Math.min(60, Math.round(max)) : DEFAULT_RECORD_RULES.titleMax,
  };
}

export const AGENTS = {
  claude: {
    id: "claude",
    name: "Claude Code",
    short: "Claude",
    glyph: "✳",
    color: "#a86f58",
    soft: "rgba(168,111,88,.13)",
    kind: "claude",
    where: ["~/.claude/projects", t("Claude Code 和 Claude 桌面版里的 Code 会话")],
    deep: "claude",
    desktopOnly: true,
  },
  codex: {
    id: "codex",
    name: "Codex",
    short: "Codex",
    glyph: "⌘",
    color: "#71899d",
    soft: "rgba(113,137,157,.13)",
    kind: "codex",
    where: ["~/.codex/sessions", t("Codex 桌面版和 codex 命令行")],
    deep: "codex",
    desktopOnly: true,
  },
  workbuddy: {
    id: "workbuddy",
    name: "WorkBuddy",
    short: "WorkBuddy",
    glyph: "✦",
    color: "#71917f",
    soft: "rgba(113,145,127,.13)",
    kind: "workbuddy",
    where: ["~/.workbuddy/projects", t("WorkBuddy 桌面版")],
    deep: "workbuddy",
    desktopOnly: true,
  },
  dsh: {
    id: "dsh",
    name: "DeepSeek Harness",
    short: "DSH",
    glyph: "◈",
    color: "#767fae",
    soft: "rgba(118,127,174,.13)",
    kind: "dsh",
    where: ["~/.dsh/sessions", t("DeepSeek Harness 桌面版、CLI 和通过 ACP 委派的任务")],
    deep: "dsh",
    desktopOnly: true,
  },
  antigravity: {
    id: "antigravity",
    name: "Antigravity",
    short: "Antigravity",
    glyph: "⟡",
    color: "#8b6fb8",
    soft: "rgba(139,111,184,.13)",
    kind: "antigravity",
    where: ["~/.gemini/antigravity/brain", t("Antigravity 桌面版与会话日志")],
    deep: "antigravity",
    desktopOnly: true,
  },
  opencode: {
    id: "opencode",
    name: "OpenCode",
    short: "OpenCode",
    glyph: "▣",
    color: "#777b83",
    soft: "rgba(119,123,131,.13)",
    kind: "opencode",
    where: ["~/.local/share/opencode/opencode.db", "OpenCode Desktop / CLI"],
    deep: "opencode",
    desktopOnly: true,
  },
  qoder: {
    id: "qoder",
    name: "Qoder",
    short: "Qoder",
    glyph: "◉",
    color: "#748c65",
    soft: "rgba(116,140,101,.13)",
    kind: "qoder",
    where: ["~/Library/Application Support/com.qoder.app.stable/main.sqlite · ~/.qoder/projects", "Qoder Desktop / CLI"],
    deep: "qoder",
    desktopOnly: true,
  },
  hermes: {
    id: "hermes",
    name: "Hermes Agent",
    short: "Hermes",
    glyph: "☿",
    color: "#b57536",
    soft: "rgba(181,117,54,.13)",
    kind: "hermes",
    where: ["~/.hermes/state.db · $HERMES_HOME", t("Hermes Agent 会话与 ACP / CLI")],
    deep: "hermes",
    desktopOnly: false,
  },
  minimax: {
    id: "minimax",
    name: "MiniMax Code",
    short: "MiniMax",
    glyph: "◆",
    color: "#e24d6a",
    soft: "rgba(226,77,106,.13)",
    kind: "minimax",
    where: ["~/.minimax/v2/sqlite/runtime-state.sqlite · $MINIMAX_DATA_DIR", t("MiniMax Code 桌面版与 mcode CLI / ACP")],
    deep: "minimax",
    desktopOnly: true,
  },
  qwenwork: {
    id: "qwenwork",
    name: "千问办公",
    short: "千问办公",
    glyph: "✦",
    color: "#6b63d6",
    soft: "rgba(107,99,214,.13)",
    kind: "qwenwork",
    where: ["~/.qwenworkcn/.harness/*/qwenwork · ~/.qwenworkcn/projects", t("千问办公（QwenWork）桌面版")],
    deep: "qwenwork",
    desktopOnly: true,
    trackingOnly: true,
  },
  cursor: {
    id: "cursor",
    name: "Cursor",
    short: "Cursor",
    glyph: "▸",
    color: "#5f7d95",
    soft: "rgba(95,125,149,.13)",
    kind: "cursor",
    where: ["~/.agent-deck/cursor-events · ~/.cursor/hooks.json", t("Cursor 桌面版（Hooks + 会话日志）")],
    deep: "cursor",
    desktopOnly: true,
    trackingOnly: true,
  },
  grokbot: {
    id: "grokbot",
    name: "Grok Bot",
    short: "Grok Bot",
    glyph: "✧",
    color: "#5b6472",
    soft: "rgba(91,100,114,.13)",
    kind: "grokbot",
    where: ["~/Library/Application Support/Grok Bot/sand-client-persistence", t("Grok Bot 桌面版（按 Bot 多选追踪）")],
    deep: "grokbot",
    desktopOnly: true,
    trackingOnly: true,
  },
  t3code: {
    id: "t3code",
    name: "T3 Code",
    short: "T3 Code",
    glyph: "◩",
    color: "#3d7bd9",
    soft: "rgba(61,123,217,.13)",
    kind: "t3code",
    where: ["~/.t3/userdata/statev2.sqlite · t3 CLI", t("T3 Code 桌面版与 t3 CLI")],
    deep: "t3code",
    desktopOnly: true,
  },
  muse: {
    id: "muse",
    name: "Muse",
    short: "Muse",
    glyph: "❋",
    color: "#c96f8f",
    soft: "rgba(201,111,143,.13)",
    kind: "muse",
    where: ["~/Library/Caches/ConversationCache/hatch-main.json", t("Muse 桌面版（仅追踪）")],
    deep: "muse",
    desktopOnly: true,
    trackingOnly: true,
  },
};

export const AGENT_ORDER = ["claude", "codex", "workbuddy", "dsh", "antigravity", "opencode", "qoder", "hermes", "minimax", "qwenwork", "cursor", "grokbot", "t3code", "muse"];

export const AGENT_SHORT = (id) => (AGENTS[id] ? AGENTS[id].short : id || "Agent");

// Models shown in the layered picker. `cli` is what Claude Code receives;
// `value` is what the DeepSeek Harness ACP config option receives.
export const MODEL_CATALOG = [
  { id: "dsh-default", agent: "dsh", name: t("不指定（使用 DSH 当前默认模型）"), value: "", provider: "DSH", context: "—", tags: [], note: t("不向 DSH 传模型参数，直接使用 DSH 自身配置的默认模型（适合接入第三方模型）。") },
  { id: "antigravity-default", agent: "antigravity", name: t("CLI 当前默认模型"), value: "", provider: "Antigravity", context: "—", tags: [], note: t("使用服务端的默认模型；读取可用模型后可指定模型。") },
  { id: "opencode-default", agent: "opencode", name: t("CLI 当前默认模型"), value: "", provider: "OpenCode", context: "—", tags: [], note: t("使用服务端的默认模型；读取可用模型后可指定模型。") },
  { id: "hermes-default", agent: "hermes", name: t("CLI 当前默认模型"), value: "", provider: "Hermes", context: "—", tags: [], note: t("使用 Hermes 当前配置的默认模型；读取可用模型后可指定模型。") },
  { id: "minimax-default", agent: "minimax", name: t("CLI 当前默认模型"), value: "", provider: "MiniMax", context: "—", tags: [], note: t("使用 MiniMax Code 当前配置的默认模型；读取可用模型后可指定模型。") },
  {
    id: "qoder-ultimate",
    agent: "qoder",
    name: "Ultimate",
    cli: "ultimate",
    value: "ultimate",
    provider: "Qoder",
    context: "—",
    strength: 5,
    speed: 3,
    tags: ["Reasoning"],
    cost: "High cost",
    note: "Qoder Ultimate model for complex engineering tasks.",
  },
  {
    id: "qoder-auto",
    agent: "qoder",
    name: "Auto",
    cli: "auto",
    value: "auto",
    provider: "Qoder",
    context: "—",
    strength: 4,
    speed: 4,
    tags: ["Reasoning", "Fast"],
    note: "Qoder automatic model routing.",
  },
  {
    id: "qoder-38max",
    agent: "qoder",
    name: "QModel 3.8 Max",
    cli: "qmodel_38max",
    value: "qmodel_38max",
    provider: "Qoder",
    context: "—",
    strength: 4,
    speed: 4,
    tags: ["Reasoning"],
    note: "QModel 3.8 Max.",
  },
  {
    id: "claude-opus-5-5",
    agent: "claude",
    name: "Opus 5.5",
    cli: "claude-opus-5-5",
    value: "claude-opus-5-5",
    provider: "Claude",
    context: "1M",
    strength: 5,
    speed: 2,
    tags: ["Reasoning", "Vision"],
    cost: "High cost",
    note: "The default: the strongest Claude for delegated work.",
  },
  {
    id: "claude-opus-5",
    agent: "claude",
    name: "Opus 5",
    cli: "opus",
    value: "opus",
    provider: "Claude",
    context: "1M",
    strength: 5,
    speed: 2,
    tags: ["Reasoning", "Vision"],
    cost: "High cost",
    note: "Deeper reasoning for hard, quality-first work.",
  },
  {
    id: "claude-sonnet-5",
    agent: "claude",
    name: "Sonnet 5",
    cli: "sonnet",
    value: "sonnet",
    provider: "Claude",
    context: "200K",
    strength: 3,
    speed: 4,
    tags: ["Reasoning", "Vision"],
    cost: "Medium cost",
    note: "The everyday balance of speed and depth.",
  },
  {
    id: "claude-haiku-5-5",
    agent: "claude",
    name: "Haiku 5.5",
    cli: "haiku",
    value: "haiku",
    provider: "Claude",
    context: "200K",
    strength: 2,
    speed: 5,
    tags: ["Fast", "Vision"],
    cost: "Low cost",
    note: "Quick, cheap turns where latency matters.",
  },
  {
    id: "claude-fable",
    agent: "claude",
    name: "Fable",
    cli: "fable",
    value: "fable",
    provider: "Claude",
    context: "200K",
    strength: 3,
    speed: 5,
    tags: ["Fast", "Reasoning"],
    cost: "Medium cost",
    note: "A fast Claude alias for interactive work.",
  },
  ...[
    ["gpt-6.1-sol", "GPT-6.1 Sol", "Reasoning"],
    ["gpt-6-astra", "GPT-6 Astra", "Reasoning"],
    ["gpt-6.1-terra", "GPT-6.1 Terra", "Reasoning"],
    ["gpt-6-sol", "GPT-6 Sol", "Reasoning"],
    ["gpt-6-luna", "GPT-6 Luna", "Fast"],
    ["gpt-5.6-sol", "GPT-5.6 Sol", "Reasoning"],
    ["gpt-5.6-terra", "GPT-5.6 Terra", "Reasoning"],
    ["gpt-5.6-luna", "GPT-5.6 Luna", "Fast"],
  ].map(([id, name, tag]) => ({ id, name, agent: "codex", cli: id, value: id, provider: "OpenAI", context: "—", tags: [tag], note: t("可用性由当前 Codex 登录账号决定。") })),
  {
    id: "deepseek-v4-pro",
    agent: "dsh",
    name: "DeepSeek-V4-Pro",
    provider: "DeepSeek",
    providerRoute: "deepseek-account",
    model: "deepseek-v4-pro",
    value: "[\"deepseek-account\",\"deepseek-v4-pro\"]",
    context: "128K",
    strength: 5,
    speed: 3,
    tags: ["Reasoning", "Coding"],
    cost: "High cost",
    note: "Stronger agentic coding and difficult reasoning.",
  },
  {
    id: "deepseek-v41-flash",
    agent: "dsh",
    name: "DeepSeek-V4.1-Flash",
    provider: "DeepSeek",
    providerRoute: "deepseek-account",
    model: "deepseek-flash",
    value: "[\"deepseek-account\",\"deepseek-flash\"]",
    context: "128K",
    strength: 3,
    speed: 5,
    tags: ["Fast", "Reasoning"],
    cost: "Low cost",
    note: "The everyday DeepSeek route: quick and inexpensive.",
  },
  {
    id: "deepseek-v4-flash",
    agent: "dsh",
    name: "DeepSeek-V4-Flash",
    provider: "DeepSeek official",
    providerRoute: "deepseek-official",
    model: "deepseek-v4-flash",
    value: "[\"deepseek-official\",\"deepseek-v4-flash\"]",
    context: "128K",
    strength: 2,
    speed: 5,
    tags: ["Fast", "Vision"],
    cost: "Low cost",
    note: "The official route, useful when an API key is configured.",
  },
  {
    id: "deepseek-v4-pro-official",
    agent: "dsh",
    name: "DeepSeek-V4-Pro (official)",
    provider: "DeepSeek official",
    providerRoute: "deepseek-official",
    model: "deepseek-v4-pro",
    value: "[\"deepseek-official\",\"deepseek-v4-pro\"]",
    context: "128K",
    strength: 5,
    speed: 3,
    tags: ["Reasoning", "Coding"],
    cost: "High cost",
    note: "The official-route Pro model.",
  },
];

export const EFFORTS = {
  antigravity: ["low", "medium", "high", "xhigh"].map((id) => ({ id, label: id, hint: t("实际可用强度由 ACP 服务端校验") })),
  opencode: ["low", "medium", "high"].map((id) => ({ id, label: id, hint: t("实际可用强度由 ACP 服务端校验") })),
  hermes: ["low", "medium", "high"].map((id) => ({ id, label: id, hint: t("实际可用强度由 ACP 服务端校验") })),
  minimax: ["low", "medium", "high"].map((id) => ({ id, label: id, hint: t("实际可用强度由 ACP 服务端校验") })),
  qoder: ["low", "medium", "high"].map((id) => ({ id, label: id, hint: t("传给 qodercli --reasoning-effort") })),
  codex: ["low", "medium", "high", "xhigh", "max"].map((id) => ({ id, label: id, hint: t("由所选 Codex 模型支持的强度决定") })),
  claude: [
    { id: "low", label: "Low", hint: "Fastest" },
    { id: "medium", label: "Medium", hint: "Balanced" },
    { id: "high", label: "High", hint: "Deeper" },
    { id: "xhigh", label: "X-High", hint: "Hard" },
    { id: "max", label: "Max", hint: "Hardest" },
  ],
  dsh: [
    { id: "off", label: "Off", hint: "Fastest" },
    { id: "low", label: "Low", hint: "Quick" },
    { id: "high", label: "High", hint: "Balanced" },
    { id: "max", label: "Max", hint: "Hardest" },
  ],
};

// 派发时可以临时覆盖沙箱：Claude 那套权限词也能映射过来（plan/manual → 只读，auto/acceptEdits → 工作区）。
export const SANDBOX_ALIAS = {
  plan: "read-only",
  manual: "read-only",
  auto: "workspace-write",
  acceptEdits: "workspace-write",
  "read-only": "read-only",
  "workspace-write": "workspace-write",
  "danger-full-access": "danger-full-access",
};
export const sandboxFor = (permission = "", fallback = "workspace-write") =>
  SANDBOX_ALIAS[String(permission || "").trim()] || fallback;

// Codex 的"工作模式"其实是沙箱：只读 / 只改工作区 / 完全不设防。
export const CODEX_SANDBOXES = [
  { id: "read-only", label: "Read-only", hint: "只读：可以看，不能改" },
  { id: "workspace-write", label: "Workspace", hint: "只能改工作目录里的文件" },
  { id: "danger-full-access", label: "Full access", hint: "完全权限：整机可写（慎用）" },
];

// 一次派发时能选的工作模式：按 Agent 各自的口径列。
export const CLAUDE_PERMISSIONS = [
  { id: "plan", label: "Plan", hint: "Think, propose, do not edit" },
  { id: "auto", label: "Auto", hint: "Let Claude choose and act" },
  { id: "acceptEdits", label: "Accept edits", hint: "Auto-accept file edits" },
  { id: "manual", label: "Manual", hint: "Ask before every step" },
];

export const DEFAULTS = {
  version: STORE_VERSION,
  // Which agents are read. Primary agents are always on.
  agents: { claude: true, codex: true, workbuddy: true, dsh: true, antigravity: true, opencode: true, qoder: true, hermes: true, minimax: true, qwenwork: true, cursor: true, grokbot: true, t3code: true, muse: true },
  customAcpAgents: [],
  primaryAgents: ["claude", "dsh"],
  // 0 = midnight (00:00); otherwise the hour at which a new journal day begins.
  dayCutoff: 0,
  experimentalDashboard: true,
  dashboardProjects: {},    // 会话 → 项目页面路径；缺省自动识别，空字符串手动未归类
  projectFolders: {},       // 项目名 → 工作目录；派活时按项目选目录，派发后按项目名记住
  autoProjectFolder: true,  // 派活时从笔记的双链 / 路径 / 标题前缀认出项目，自动换成项目文件夹
  pollSeconds: 30,
  fullHistoryDays: 14,
  // Claude desktop session list: identifies side chats (spawnedFrom) and archive state.
  claudeDesktop: true,
  hideArchived: true,
  cursorHooksPrompted: false,
  grokBotTrackedBotIds: [],
  museTrackedIds: ["hatch-main"],
  museMaxTracked: 5,
  // Human–AI journal: sessions written back into the daily note.
  journalFolder: "",       // 日记目录；留空自动检测（找不到就用「日记」）
  journalFormat: "",       // 日记文件名格式（moment 写法）；留空自动检测
  journalAutoWrite: true,  // 自动建项、结论和状态回写总开关；手动整理仍可用
  journalSync: true,
  journalLayout: null,
  uiLanguage: "auto",
  journalLayoutLanguage: "auto",
  updateCheck: true,
  updateCheckLastAt: 0,
  updateSkippedVersion: "",
  organizeJournalSuggest: true,
  journalOrganizePrompt: { day: "", count: 0, notes: {} },
  resultBack: true,
  agentKw: true,
  kidBlocks: true,
  dragGrip: true,
  cliOpen: "terminal",     // 终端里起的 Claude Code 会话点开时：terminal 回终端 / desktop 走桌面版
  cliTerminal: "auto",     // 主力终端：auto 按这台电脑的情况挑（见 delegation.js pickTerminal）/ terminal / iterm / warp / tern / herdr
  delegateInTerminal: false,  // 拖到 Claude Code / Codex 上默认在主力终端里开交互式会话（按住 ⌘ 反过来）
  yieldToNautilus: true,   // 螺旋日程在任务行下面画了进度行时，不再画 pill、🔗 链接不可点          // 光标所在的列表项尾巴上显示拖拽把手（面板开着时）
  autoLog: true,           // 默认打开：活跃会话自动建项并记进今天的日记
  aiRecordExpanded: {},
  aiRecordClosed: {},
  aiRecordViews: {},
  taskBoardViews: {},
  taskBoardFiles: {},
  taskBoardPins: {},
  projectTeams: { presets: {}, byProject: {}, stewards: {} },
  workbenchWaves: {},
  aiRecordDisplay: "latest1", // collapsed 折叠 / expanded 展开 / latest1、latest3、latest5 最近 N 条 AI 结论
  autoLogGranularity: "round", // latest 最新进展 / round 每轮 / paused 停歇或归档
  doneArchivePath: "Agent Deck/done/已完成任务.md",
  lastTaskExportDir: "",
  archiveOrder: "prepend",
  viewOpened: false,   // 首次加载时把面板放进右侧栏；之后不再自动打开
  welcomeShowcaseVersion: "",
  autoLogMerge: false,
  autoLogMergeThreshold: 10,
  autoLogSummaries: {},
  manualTaskStates: {},
  autoLogDetailHistory: [],
  autoLogDetail: "brief",   // brief 最新一句结论 / standard 每轮结论 / detailed 每轮提问和结论
  autoLogEvery: 20,        // 自动整理间隔（分钟）
  autoLogStartDelay: 1,    // 插件启动后第几分钟先整理一次，不用等满一个间隔
  autoLogMinMinutes: 3,    // 新会话累计活跃满几分钟才建项（归档了的不管多短都记）
  autoLogIdle: 10,         // 停了几分钟算 PAUSED
  autoLogGrokBotDoneMinutes: 120, // Grok Bot 多久无新对话自动标为 DONE（0 关闭）
  autoLogFirstRounds: 10,  // 第一次接入某个会话 / Bot 时只补最近几轮，之后只跟当天的新轮次
  autoLogSeen: {},         // 会话号 → 第一次记进日记的时间；按 180 天懒清理，用来区分「第一次接入」
  noteDispatchJournal: false, // 非日记笔记里的派发也写当天日记；默认只写回原笔记
  stewardWatch: false, // 管家中途干预：波次里有会话长时间没输出就提醒一次；默认关
  securityAllowlist: [], // 安全护栏白名单（与 Agent Deck/安全审计.md frontmatter allowlist 双向同步）
  replyInbox: [], // 回复信箱：还没回答的 ❓（渲染前会回笔记核对一遍）
  noteDispatchSessions: {},   // 会话号 → 从非日记笔记派发的时间；默认 autoLog 跳过这些会话
  keywordStyle: true,      // 关键词配色与 tsq-ico 图标；TODOseq 自己在格式化时让位
  recordRules: { ...DEFAULT_RECORD_RULES },
  autoLogBatch: 8,         // 一轮最多问模型几个会话
  autoLogAgents: { claude: true, codex: true, workbuddy: true, dsh: true, antigravity: true, opencode: true, qoder: true, cursor: true, grokbot: true, t3code: true, muse: true },
  autoLogProvider: "auto",
  autoLogEffort: "low",
  autoLogModel: "",
  autoLogApiUrl: "",
  autoLogApiKey: "",
  autoLogTimeout: 120,     // 整理时等模型几秒
  autoLogFallback: true,   // 模型问不到时（自动整理也一样）用会话标题先记上
  autoLogFailover: false,  // 主来源撞限额/超时/起不来时换下一个来源
  autoLogBackupProvider: "", // 备用来源：留空=自动挑下一个已登录 CLI；也可指定 CLI 或 api
  autoLogCooldownMin: 30,  // 撞限额的来源冷却多少分钟（冷却期内直接用备用来源）
  autoLogApiConfirm: true, // 自动调用 API 前先问人（API 会算钱）；同意后 30 分钟内不再问
  conclusionMaxCode: 65,   // 💬 编码类结论字数（做了什么、情况怎么样）
  conclusionMaxQA: 160,    // 💬 知识问答类结论字数（可以长一点，讲清判断）
  journalMarkerIntroShown: false, // 第一次遇到分区标记不全时解释过标记规则没有
  autoLogKw: true,         // 自动建的条目也跟着会话在 DOING / TOREVIEW / NEEDOK / ERRORED 之间切
  autoLogPath: "",
  autoLogArchiveDone: true,
  autoLogNotify: true,
  roundPolish: true,       // 每轮的 💬 先用本地规则写，再让模型润色成一句话
  roundPolishModel: "",    // 留空 = 跟整理用的模型一样
  roundPolishTimeout: 30,  // 润色时等模型几秒
  autoLogState: {},
  workLog: {},
  showMenuBar: true,
  menuBarAgentScope: "primary-running",
  menuBarPrimaryLimit: 6,
  menuBarOtherLimit: 3,
  menuBarHotkey: "control+option+command+D",
  menuBarHideNautilus: true,
  menuBarMigrated: false,
  menuBarPinnedSids: [],
  menuBarAutoTitles: {},
  showEditorPills: true,
  lineProgress: true,
  showRibbonIcon: true,
  openDashboardOnStartup: false,
  autoWriteResult: true,
  resultMax: 350,
  importNautilus: true,
  dream: { enabled: false, inject: true, store: "text", dir: "Agent Deck/记忆", backlinked: [], scope: "all", path: "Agent Deck/长期记忆.md", provider: "", model: "", effort: "", apiUrl: "", apiKey: "", syncProfile: false, lastRun: 0, lastAttempt: 0, states: {}, coverage: null, lastError: "", share: { enabled: false, path: "", intervalHours: 24, gitPush: false, lastAttempt: 0, lastSuccess: 0, lastError: "" } },
  // Delegation
  delegate: {
    target: "claude",
    claude: {
      model: "claude-opus-5-5",
      effort: "high",
      permission: "auto",
      path: "",
      cwd: "",
      addVault: true,
      openDesktop: true,
      useBackground: false,
      autoTrustedCwd: true,
      extraArgs: "",
    },
    codex: { transport: "desktop", model: "gpt-6.1-sol", effort: "low", cwd: "", path: "", sandbox: "workspace-write", project: true },
    antigravity: { model: "antigravity-default", effort: "medium", path: "", cwd: "", autoApprove: false },
    opencode: { model: "opencode-default", effort: "medium", path: "", cwd: "", autoApprove: false, extraArgs: "" },
    hermes: { model: "hermes-default", effort: "medium", path: "", cwd: "", autoApprove: false, extraArgs: "" },
    minimax: { model: "minimax-default", effort: "medium", path: "", cwd: "", autoApprove: false, extraArgs: "" },
    t3code: { path: "", cwd: "", extraArgs: "" },
    qoder: { model: "qoder-ultimate", effort: "high", permission: "auto", path: "", cwd: "", addVault: true, openDesktop: false, extraArgs: "" },
    dsh: {
      model: "dsh-default",
      effort: "high",
      path: "",
      cwd: "",
      autoApprove: false,
      extraArgs: "",
    },
    mentionSuggest: true,
    mentionTrigger: "@",
    promptPrefix: "",
    promptSuffix: "",
    excludedDirs: [],
    markStatus: true,
    confirmFirst: true,   // 委派消息末尾追加可自定义的附加要求
    confirmFirstPrompt: CONFIRM_FIRST,
    writeLink: true,
    nameMax: 56,
  },
  // Model picker state
  models: {
    enabled: MODEL_CATALOG.map((m) => m.id),
    pinned: ["claude-opus-5-5", "claude-sonnet-5", "deepseek-v4-pro"],
    order: MODEL_CATALOG.map((m) => m.id),
    custom: [],
    defaultByAgent: { claude: "claude-opus-5-5", codex: "gpt-6.1-sol", dsh: "dsh-default", antigravity: "antigravity-default", opencode: "opencode-default", hermes: "hermes-default", minimax: "minimax-default", qoder: "qoder-ultimate" },
    effort: "high",
    effortByAgent: {},
  },
  ui: {
    showSparkline: true,
    showUsageBars: true,
    recentDays: 7,
    nowGroupBy: "project",
    recentGroupBy: "agent",
    agentCards: { order: [...AGENT_ORDER], hidden: [], pinned: [] },
  },
  jobs: {},
  lastScan: 0,
};

export function deepMerge(base, extra) {
  if (!extra || typeof extra !== "object") return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(extra)) {
    if (Array.isArray(v)) out[k] = [...v];
    else if (v && typeof v === "object" && base && typeof base[k] === "object" && !Array.isArray(base[k])) out[k] = deepMerge(base[k], v);
    else out[k] = v;
  }
  return out;
}

const LEGACY_DSH_PRESETS = new Set([
  "deepseek-v4-pro",
  "deepseek-v41-flash",
  "deepseek-v4-flash",
  "deepseek-v4-pro-official",
  "",
]);

export function syncDelegationSettings(settings, raw = null) {
  if (!settings || typeof settings !== "object") return settings;
  if (!settings.resultMaxDefault350) {
    if (settings.resultMax === 240) settings.resultMax = DEFAULTS.resultMax;
    settings.resultMaxDefault350 = true;
  }
  const d = (settings.delegate ||= {});
  const m = (settings.models ||= {});
  m.defaultByAgent ||= {};
  m.effortByAgent ||= {};
  m.enabled = Array.isArray(m.enabled) ? m.enabled : [];
  const customAcpIds = (Array.isArray(settings.customAcpAgents) ? settings.customAcpAgents : [])
    .map((x) => String(x?.id || "").trim().toLowerCase())
    .filter(Boolean);
  const delegateAgents = [...new Set([
    ...Object.keys(DEFAULTS.delegate).filter((k) => {
      const entry = DEFAULTS.delegate[k];
      return Boolean(entry && typeof entry === "object" && !Array.isArray(entry));
    }),
    ...customAcpIds,
  ])];
  if (!delegateAgents.includes(d.target)) d.target = "claude";
  for (const agent of delegateAgents) {
    const cfg = (d[agent] ||= {});
    const rawDelModel = raw?.delegate?.[agent]?.model;
    const rawModModel = raw?.models?.defaultByAgent?.[agent];
    const model = rawDelModel !== undefined ? rawDelModel
      : rawModModel !== undefined ? rawModModel
      : cfg.model !== undefined ? cfg.model
      : m.defaultByAgent[agent] !== undefined ? m.defaultByAgent[agent]
      : (DEFAULTS.models.defaultByAgent[agent] ?? "");
    cfg.model = model;
    m.defaultByAgent[agent] = model;
    // Never re-enable a model the user explicitly turned off in models.enabled;
    // only ensure it is enabled on first-time migration or missing enabled list.
    const shouldSeedEnabled = !raw || !Array.isArray(raw?.models?.enabled) || (rawDelModel === undefined && rawModModel !== undefined);
    if (model && shouldSeedEnabled && !m.enabled.includes(model) && raw) m.enabled.push(model);
    const rawDelEffort = raw?.delegate?.[agent]?.effort;
    const rawModEffort = raw?.models?.effortByAgent?.[agent];
    const effort = rawDelEffort || rawModEffort || cfg.effort || m.effortByAgent[agent] || DEFAULTS.delegate[agent]?.effort || "high";
    cfg.effort = effort;
    m.effortByAgent[agent] = effort;
  }
  if (!settings.dshDefaultSeeded) {
    if (Array.isArray(raw?.models?.enabled) && !m.enabled.includes("dsh-default")) {
      m.enabled.push("dsh-default");
    }
    const curDshModel = d.dsh?.model ?? m.defaultByAgent.dsh ?? "";
    if (LEGACY_DSH_PRESETS.has(curDshModel)) {
      d.dsh ||= {};
      d.dsh.model = "dsh-default";
      m.defaultByAgent.dsh = "dsh-default";
    }
    settings.dshDefaultSeeded = true;
  }
  return settings;
}

export function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
export function pad(n) { return String(n).padStart(2, "0"); }
export function fmtKey(d = new Date(), cfg = {}) {
  const fmt = cfg.format || "YYYY_MM_DD";
  return fmt.replace("YYYY", d.getFullYear()).replace("MM", pad(d.getMonth() + 1)).replace("DD", pad(d.getDate()));
}
// ----- 日记文件名 -----
// 内部的日期键固定是 YYYY_MM_DD（用量统计、自动记日记的状态都按它存、按字典序比较），
// 日记文件名另按 journalFormat（moment 写法，可带子目录）。留空 = 自动检测：
// Obsidian「日记」核心插件 → Periodic Notes 的每日笔记 → 日记目录里已有文件的命名 → YYYY_MM_DD。
// 日记目录 journalFolder 留空也自动：「日记」核心插件 → Periodic Notes → 「日记」。
const GUESS_FORMATS = ["YYYY_MM_DD", "YYYY-MM-DD", "YYYYMMDD", "YYYY.MM.DD", "YYYY年MM月DD日", "YYYY年M月D日", "YYYY/MM/YYYY-MM-DD", "YYYY/YYYY-MM-DD", "YYYY-MM/YYYY-MM-DD", "YYYY/MM/DD"];
const TOKEN_RE = /\[[^\]]*\]|YYYY|YY|MM|M|DD|D/g;
// 日记模板的 {{date:…}} / {{time:…}} 也走这里，所以还要认时钟 token
const FMT_TOKEN_RE = /\[[^\]]*\]|YYYY|YY|MM|M|DD|D|HH|H|mm|m|ss|s/g;

export function formatDate(d, fmt) {
  const mom = globalThis.moment;
  if (typeof mom === "function") return mom(d).format(fmt);
  const v = { YYYY: d.getFullYear(), YY: String(d.getFullYear()).slice(2), MM: pad(d.getMonth() + 1), M: d.getMonth() + 1, DD: pad(d.getDate()), D: d.getDate(), HH: pad(d.getHours()), H: d.getHours(), mm: pad(d.getMinutes()), m: d.getMinutes(), ss: pad(d.getSeconds()), s: d.getSeconds() };
  return fmt.replace(FMT_TOKEN_RE, (t) => (t[0] === "[" ? t.slice(1, -1) : String(v[t])));
}

function formatRegex(fmt) {
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let out = "", last = 0;
  for (const mt of fmt.matchAll(TOKEN_RE)) {
    out += esc(fmt.slice(last, mt.index));
    const t = mt[0];
    out += t[0] === "[" ? esc(t.slice(1, -1)) : t === "YYYY" ? "\\d{4}" : t === "M" || t === "D" ? "\\d{1,2}" : "\\d{2}";
    last = mt.index + t.length;
  }
  return new RegExp("^" + out + esc(fmt.slice(last)) + "$");
}

export function dailyNotesOptions(app) {
  try {
    const dn = app?.internalPlugins?.getPluginById?.("daily-notes");
    if (dn?.enabled) return dn.instance?.options || {};
  } catch { /* 没有这个接口 */ }
  return null;
}

// 返回 { folder, folderSource, format, source }；folder 为 "" 表示库根目录
let journalGuess = null;
export function detectJournalFormat(app, cfg = {}) {
  const own = (cfg.journalFolder || "").trim().replace(/\/+$/, "");
  const core = dailyNotesOptions(app);
  const periodic = app?.plugins?.plugins?.["periodic-notes"]?.settings?.daily;
  const conf = core || (periodic?.enabled ? periodic : null);
  const source = core ? t("Obsidian「日记」核心插件") : conf ? "Periodic Notes" : t("默认");
  const folder = own || (conf ? String(conf.folder || "").trim().replace(/^\/+|\/+$/g, "") : "日记");
  const folderSource = own ? t("手动设置") : source;
  if (conf) return { format: conf.format || "YYYY-MM-DD", source, folder, folderSource };

  // 只缓存文件扫描。核心插件和 Periodic Notes 的设置每次读取。
  if (!journalGuess || journalGuess.app !== app || journalGuess.folder !== folder || Date.now() - journalGuess.at >= 60e3) {
    let files = [];
    try { files = app?.vault?.getMarkdownFiles?.() || []; } catch { /* 测试里的假 vault */ }
    const prefix = folder ? folder + "/" : "";
    const names = files.filter((f) => f.path.startsWith(prefix)).map((f) => f.path.slice(prefix.length, -3));
    let best = null;
    for (const fmt of GUESS_FORMATS) {
      const re = formatRegex(fmt);
      const n = names.filter((x) => re.test(x)).length;
      if (n && (!best || n > best.n)) best = { fmt, n };
    }
    journalGuess = { app, folder, at: Date.now(), best };
  }
  const { best } = journalGuess;
  const guessedSource = best ? (folder ? t("「{folder}」里已有的 {n} 篇日记", { folder, n: best.n }) : t("库根目录里已有的 {n} 篇日记", { n: best.n })) : source;
  return { format: best?.fmt || "YYYY_MM_DD", source: guessedSource, folder, folderSource };
}

// day 是内部日期键（YYYY_MM_DD），默认今天
export function journalPath(app, cfg = {}, day = dayKeyToday(cfg)) {
  const [y, m, d] = String(day).split(/\D+/).map(Number);
  const { folder, format } = detectJournalFormat(app, cfg);
  const name = formatDate(new Date(y, m - 1, d), (cfg.journalFormat || "").trim() || format);
  return folder ? `${folder}/${name}.md` : `${name}.md`;
}

export function dayKey(ms, cfg = {}) {
  const cutoff = Number.isFinite(cfg.dayCutoff) ? cfg.dayCutoff : 0;
  return fmtKey(new Date(ms - cutoff * 3600e3), cfg);
}
export function dayKeyToday(cfg = {}) { return dayKey(Date.now(), cfg); }
export function startOfDay(ms, cfg = {}) {
  const cutoff = Number.isFinite(cfg.dayCutoff) ? cfg.dayCutoff : 0;
  const d = new Date(ms - cutoff * 3600e3);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() + cutoff * 3600e3;
}
export function dayMinute(ms, cfg = {}) {
  const start = startOfDay(ms, cfg);
  return Math.round((ms - start) / 60000);
}
// 「见过的会话」：第一次接入只补最近几轮，之后只跟当天。标记按 180 天懒清理、封顶 2000 条；
// 老版本只存了 autoLogState 的会话也算见过，升级后不会回头补历史。
export function seenSessions(cfg = {}) {
  const seen = (cfg.autoLogSeen ||= {});
  const floor = Date.now() - 180 * 86400e3;
  for (const [sid, at] of Object.entries(seen)) if (!(Number(at) > floor)) delete seen[sid];
  for (const day of Object.keys(cfg.autoLogState || {})) {
    for (const sid of Object.keys(cfg.autoLogState[day] || {})) if (seen[sid] == null) seen[sid] = Date.now();
  }
  const keys = Object.keys(seen);
  if (keys.length > 2000) {
    cfg.autoLogSeen = Object.fromEntries(keys.sort((a, b) => Number(seen[b]) - Number(seen[a])).slice(0, 2000).map((sid) => [sid, seen[sid]]));
  }
  return cfg.autoLogSeen;
}

// 每个会话只追最近的活动：第一次接入（没有「见过」标记）取最近 max 轮，之后只取当天产生的轮次。
// since 是当天的起点毫秒（见 startOfDay），比逐轮格式化日期便宜；没时间戳的轮次分不出是哪天的，保留。
export function trackedRounds(rounds, { first = false, since = 0, max = 10 } = {}) {
  const list = (Array.isArray(rounds) ? rounds : []).filter(Boolean);
  if (first) return list.slice(-Math.max(1, Math.min(200, Math.round(Number(max)) || 10)));
  return since ? list.filter((r) => !r.at || r.at >= since) : list;
}
export function fmtTok(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return Math.round(n / 1e3) + "k";
  return String(n);
}
export function fmtMin(n) {
  n = Math.max(0, Math.round(Number(n) || 0));
  if (n < 60) return n + "m";
  const h = Math.floor(n / 60), m = n % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
export function fmtDur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
export function fmtClock(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function timeAgo(ms) {
  if (!ms) return "";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 45) return t("刚刚");
  if (s < 3600) return t("{n} 分钟前", { n: Math.round(s / 60) });
  if (s < 86400) return t("{n} 小时前", { n: Math.round(s / 3600) });
  return t("{n} 天前", { n: Math.round(s / 86400) });
}
export function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
export function truncate(s, n = 80) { s = String(s == null ? "" : s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
export function unionSegs(segs) {
  const out = [];
  for (const [a, b] of [...segs].sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export function visibleMenuAgents(agents, scope = "primary-running") {
  return agents.filter((agent) => scope === "all" || agent.primary || agent.running > 0);
}
