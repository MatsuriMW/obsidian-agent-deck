// Agent Deck — shared constants and small helpers.

export const STORE_VERSION = 1;

export const AGENTS = {
  claude: {
    id: "claude",
    name: "Claude Code",
    short: "Claude",
    glyph: "✳",
    color: "#a86f58",
    soft: "rgba(168,111,88,.13)",
    kind: "claude",
    where: ["~/.claude/projects", "Claude Code 和 Claude 桌面版里的 Code 会话"],
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
    where: ["~/.codex/sessions", "Codex 桌面版和 codex 命令行"],
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
    where: ["~/.workbuddy/projects", "WorkBuddy 桌面版"],
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
    where: ["~/.dsh/sessions", "DeepSeek Harness 桌面版、CLI 和通过 ACP 委派的任务"],
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
    where: ["~/.gemini/antigravity/brain", "Antigravity 桌面版与会话日志"],
    deep: "antigravity",
    desktopOnly: true,
  },
};

export const AGENT_ORDER = ["claude", "codex", "workbuddy", "dsh", "antigravity"];

export const AGENT_SHORT = (id) => (AGENTS[id] ? AGENTS[id].short : id || "Agent");

// Models shown in the layered picker. `cli` is what Claude Code receives;
// `value` is what the DeepSeek Harness ACP config option receives.
export const MODEL_CATALOG = [
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
    ["gpt-6-luna", "GPT-6-Luna", "Fast"],
    ["gpt-6.1-sol", "GPT-6.1-Sol", "Reasoning"],
    ["gpt-6.1-terra", "GPT-6.1 Terra", "Reasoning"],
    ["gpt-6-astra", "GPT-6-Astra", "Reasoning"],
    ["gpt-6-sol", "GPT-6-Sol", "Reasoning"],
    ["gpt-5.6-sol", "GPT-5.6-Sol", "Reasoning"],
    ["gpt-5.6-terra", "GPT-5.6-Terra", "Reasoning"],
    ["gpt-5.6-luna", "GPT-5.6-Luna", "Fast"],
  ].map(([id, name, tag]) => ({ id, name, agent: "codex", cli: id, value: id, provider: "OpenAI", context: "—", tags: [tag], note: "可用性由当前 Codex 登录账号决定。" })),
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
  codex: ["low", "medium", "high", "xhigh", "max"].map((id) => ({ id, label: id, hint: "由所选 Codex 模型支持的强度决定" })),
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

export const CLAUDE_PERMISSIONS = [
  { id: "plan", label: "Plan", hint: "Think, propose, do not edit" },
  { id: "auto", label: "Auto", hint: "Let Claude choose and act" },
  { id: "acceptEdits", label: "Accept edits", hint: "Auto-accept file edits" },
  { id: "manual", label: "Manual", hint: "Ask before every step" },
];

export const DEFAULTS = {
  version: STORE_VERSION,
  // Which agents are read. Primary agents are always on.
  agents: { claude: true, codex: true, workbuddy: true, dsh: true, antigravity: true },
  primaryAgents: ["claude", "dsh"],
  // 0 = no cutoff; otherwise the hour at which a new journal day begins.
  dayCutoff: 8,
  pollSeconds: 20,
  fullHistoryDays: 14,
  // Claude desktop session list: identifies side chats (spawnedFrom) and archive state.
  claudeDesktop: true,
  hideArchived: true,
  // Human–AI journal: sessions written back into the daily note.
  journalFolder: "",       // 日记目录；留空自动检测（找不到就用「日记」）
  journalFormat: "",       // 日记文件名格式（moment 写法）；留空自动检测
  journalAutoWrite: true,  // 自动建项、结论和状态回写总开关；手动整理仍可用
  journalSync: true,
  resultBack: true,
  agentKw: true,
  kidBlocks: true,
  dragGrip: true,
  cliOpen: "terminal",     // 终端里起的 Claude Code 会话点开时：terminal 回终端 / desktop 走桌面版
  cliTerminal: "auto",     // 主力终端：auto 按这台电脑的情况挑（见 delegation.js pickTerminal）/ terminal / iterm / warp / tern / herdr
  delegateInTerminal: false,  // 拖到 Claude Code / Codex 上默认在主力终端里开交互式会话（按住 ⌘ 反过来）
  yieldToNautilus: true,   // 螺旋日程在任务行下面画了进度行时，不再画 pill、🔗 链接不可点          // 光标所在的列表项尾巴上显示拖拽把手（面板开着时）
  autoLog: false,
  aiRecordDisplay: "collapsed", // collapsed 默认折叠 / expanded 默认展开 / latest5 只显示最新五条
  autoLogGranularity: "latest", // latest 最新进展 / round 每轮 / paused 停歇或归档
  autoLogMerge: false,
  autoLogMergeThreshold: 10,
  autoLogSummaries: {},
  autoLogDetail: "brief",   // brief 最新一句结论 / standard 每轮结论 / detailed 每轮提问和结论
  autoLogEvery: 20,        // 自动整理间隔（分钟）
  autoLogStartDelay: 1,    // 插件启动后第几分钟先整理一次，不用等满一个间隔
  autoLogMinMinutes: 3,    // 新会话累计活跃满几分钟才建项（归档了的不管多短都记）
  autoLogIdle: 40,         // 停了几分钟算 PAUSED
  autoLogBatch: 8,         // 一轮最多问模型几个会话
  autoLogAgents: { claude: true, codex: true, workbuddy: true, dsh: true, antigravity: true },
  autoLogProvider: "claude",
  autoLogEffort: "low",
  autoLogModel: "haiku",
  autoLogTimeout: 120,     // 整理时等模型几秒
  autoLogFallback: true,   // 模型问不到时（自动整理也一样）用会话标题先记上
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
  showEditorPills: true,
  showRibbonIcon: true,
  openDashboardOnStartup: false,
  autoWriteResult: true,
  resultMax: 240,
  importNautilus: true,
  dream: { enabled: false, path: "Agent Deck/长期记忆.md", syncProfile: false, lastRun: 0, lastAttempt: 0, fingerprint: "", lastError: "" },
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
    codex: { model: "gpt-6.1-sol", effort: "low", cwd: "", path: "", sandbox: "workspace-write" },
    dsh: {
      model: "deepseek-v4-pro",
      effort: "high",
      path: "",
      cwd: "",
      autoApprove: false,
      extraArgs: "",
    },
    promptPrefix: "",
    promptSuffix: "",
    markStatus: true,
    confirmFirst: true,   // 委派消息末尾追加「先确认再动手」
    writeLink: true,
    nameMax: 56,
  },
  // Model picker state
  models: {
    enabled: MODEL_CATALOG.map((m) => m.id),
    pinned: ["claude-opus-5-5", "claude-sonnet-5", "deepseek-v4-pro"],
    order: MODEL_CATALOG.map((m) => m.id),
    custom: [],
    defaultByAgent: { claude: "claude-opus-5-5", codex: "gpt-6.1-sol", dsh: "deepseek-v4-pro" },
    effort: "high",
    effortByAgent: {},
  },
  ui: {
    showSparkline: true,
    showUsageBars: true,
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

export function formatDate(d, fmt) {
  const m = globalThis.moment;
  if (typeof m === "function") return m(d).format(fmt);
  const v = { YYYY: d.getFullYear(), YY: String(d.getFullYear()).slice(2), MM: pad(d.getMonth() + 1), M: d.getMonth() + 1, DD: pad(d.getDate()), D: d.getDate() };
  return fmt.replace(TOKEN_RE, (t) => (t[0] === "[" ? t.slice(1, -1) : String(v[t])));
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

// 返回 { folder, folderSource, format, source }；folder 为 "" 表示库根目录
let _detected = null;
export function detectJournalFormat(app, cfg = {}) {
  const own = (cfg.journalFolder || "").trim().replace(/\/+$/, "");
  const key = own + "\n" + (cfg.journalFormat || "");
  if (_detected && _detected.app === app && _detected.key === key && Date.now() - _detected.at < 60e3) return _detected;
  let conf = null;
  try {
    const dn = app?.internalPlugins?.getPluginById?.("daily-notes");
    if (dn?.enabled) conf = { ...(dn.instance?.options || {}), source: "Obsidian「日记」核心插件" };
  } catch { /* 没有这个接口 */ }
  if (!conf) {
    const pn = app?.plugins?.plugins?.["periodic-notes"]?.settings?.daily;
    if (pn?.enabled) conf = { ...pn, source: "Periodic Notes" };
  }
  const folder = own || (conf ? String(conf.folder || "").trim().replace(/^\/+|\/+$/g, "") : "日记");
  const folderSource = own ? "手动设置" : conf ? conf.source : "默认";
  let hit = conf ? { format: conf.format || "YYYY-MM-DD", source: conf.source } : null;
  if (!hit) {
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
    if (best) hit = { format: best.fmt, source: `「${folder || "库根目录"}」里已有的 ${best.n} 篇日记` };
  }
  _detected = { ...(hit || { format: "YYYY_MM_DD", source: "默认" }), folder, folderSource, key, app, at: Date.now() };
  return _detected;
}

export function journalFormat(app, cfg = {}) {
  return (cfg.journalFormat || "").trim() || detectJournalFormat(app, cfg).format;
}

// day 是内部日期键（YYYY_MM_DD），默认今天
export function journalPath(app, cfg = {}, day = dayKeyToday(cfg)) {
  const [y, m, d] = String(day).split(/\D+/).map(Number);
  const folder = detectJournalFormat(app, cfg).folder;
  const name = formatDate(new Date(y, m - 1, d), journalFormat(app, cfg));
  return folder ? `${folder}/${name}.md` : `${name}.md`;
}

export function dayKey(ms, cfg = {}) {
  const cutoff = Number.isFinite(cfg.dayCutoff) ? cfg.dayCutoff : 8;
  return fmtKey(new Date(ms - cutoff * 3600e3), cfg);
}
export function dayKeyToday(cfg = {}) { return dayKey(Date.now(), cfg); }
export function startOfDay(ms, cfg = {}) {
  const cutoff = Number.isFinite(cfg.dayCutoff) ? cfg.dayCutoff : 8;
  const d = new Date(ms - cutoff * 3600e3);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() + cutoff * 3600e3;
}
export function dayMinute(ms, cfg = {}) {
  const start = startOfDay(ms, cfg);
  return Math.round((ms - start) / 60000);
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
  if (s < 45) return "刚刚";
  if (s < 3600) return Math.round(s / 60) + " 分钟前";
  if (s < 86400) return Math.round(s / 3600) + " 小时前";
  return Math.round(s / 86400) + " 天前";
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
