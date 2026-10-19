// Agent Deck — shared constants and small helpers.

export const PLUGIN_ID = "agent-deck";
export const PLUGIN_NAME = "Agent Deck";
export const PLUGIN_VERSION = "1.0.2";
export const USAGE_FILE = "usage.json";
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
};

export const AGENT_ORDER = ["claude", "codex", "workbuddy", "dsh"];

export const AGENT_LABEL = (id) => (AGENTS[id] ? AGENTS[id].name : id || "Agent");
export const AGENT_SHORT = (id) => (AGENTS[id] ? AGENTS[id].short : id || "Agent");

// Models shown in the layered picker. `cli` is what Claude Code receives;
// `value` is what the DeepSeek Harness ACP config option receives.
export const MODEL_CATALOG = [
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
  agents: { claude: true, codex: true, workbuddy: true, dsh: true },
  primaryAgents: ["claude", "dsh"],
  // 0 = no cutoff; otherwise the hour at which a new journal day begins.
  dayCutoff: 8,
  pollSeconds: 20,
  idleMinutes: 5,
  fullHistoryDays: 14,
  showStatusBar: false,
  showMenuBar: true,
  menuBarPrimaryLimit: 6,
  menuBarOtherLimit: 3,
  menuBarHideNautilus: true,
  menuBarMigrated: false,
  showEditorPills: true,
  showRibbonIcon: true,
  openDashboardOnStartup: false,
  autoWriteResult: true,
  autoStatus: true,
  resultMax: 240,
  importNautilus: true,
  // Delegation
  delegate: {
    target: "claude",
    claude: {
      model: "claude-sonnet-5",
      effort: "high",
      permission: "auto",
      cwd: "",
      addVault: true,
      openDesktop: true,
      useBackground: false,
      autoTrustedCwd: true,
      extraArgs: "",
    },
    dsh: {
      model: "deepseek-v4-pro",
      effort: "high",
      cwd: "",
      autoApprove: false,
      extraArgs: "",
    },
    promptPrefix: "",
    promptSuffix: "",
    markStatus: true,
    writeLink: true,
    nameMax: 56,
  },
  // Model picker state
  models: {
    enabled: MODEL_CATALOG.map((m) => m.id),
    pinned: ["claude-opus-5", "claude-sonnet-5", "deepseek-v4-pro"],
    order: MODEL_CATALOG.map((m) => m.id),
    custom: [],
    defaultByAgent: { claude: "claude-sonnet-5", dsh: "deepseek-v4-pro" },
    taskModels: { delegate: "auto", naming: "auto", summary: "auto" },
    effort: "high",
  },
  ui: {
    density: "comfortable",
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
export function fmtDate(ms) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
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
export function unionMin(segs) {
  return unionSegs(segs).reduce((n, [a, b]) => n + (b - a), 0);
}
export function relTime(ms) {
  const d = new Date(ms), now = new Date();
  const same = d.toDateString() === now.toDateString();
  return same ? fmtClock(ms) : `${d.getMonth() + 1}/${d.getDate()} ${fmtClock(ms)}`;
}
