// Agent Deck — English UI strings (macOS menu bar).
// Keys are the Chinese source strings; placeholders use {name}.
// The Swift helper compiles the Chinese literals in, so entries here are what
// the plugin pushes through the `labels` map of menubar.json.

export default {
  "macOS 菜单栏启动失败，已把开关关上：{error}":
    "Could not start the macOS menu bar, so the switch was turned off: {error}",
  "找不到 /usr/bin/swiftc。安装 Xcode Command Line Tools（xcode-select --install）后再试。":
    "Cannot find /usr/bin/swiftc. Install the Xcode Command Line Tools (xcode-select --install) and try again.",
  "正在准备 macOS 菜单栏（第一次要编译一个小助手，约几秒）…":
    "Preparing the macOS menu bar (the helper compiles once, a few seconds)…",
  "编译超过 90 秒": "Compiling took more than 90 seconds",
  "swiftc 编译失败": "swiftc failed to compile",

  "等待 Agent Deck…": "Waiting for Agent Deck…",
  "{n} 个 NEEDOK? 需要你允许": "{n} NEEDOK? waiting for your approval",
  "等待中的提问或终端任务、待认领与在跑会话会出现在这里。":
    "Waiting prompts, active terminal sessions, unclaimed handoffs, and running tasks appear here.",
  "等待 Agent 会话": "Waiting for agent sessions",
  "共 {n} 个 · 向下滑动": "{n} total · scroll for more",
  "点击卡片跳转": "Click a card to jump",
  "打开面板": "Open panel",
  "重新扫描": "Rescan",
  "隐藏": "Hide",
  "跑": "run",
  "等": "wait",
  "待认领": "Pending",
  "固定面板（始终显示）": "Pin panel (keep always open)",
  "取消固定（点击外部自动收起）": "Unpin panel (auto-close on outside click)",
  "置顶此会话到最上方": "Pin this session to top",
  "取消置顶此会话": "Unpin this session",

  // Menu bar payload built by src/main.js (short line, summary, header stats,
  // session rows). Sent to the Swift helper as plain text, so these must be
  // translated here rather than in the Swift file.
  "{run} 跑 · {wait} 等": "{run} running · {wait} waiting",
  "{n} 在跑": "{n} running",
  "{n} 等你": "{n} waiting",
  "{n} 个等你": "{n} waiting",
  "今天 {time} · {tok} tok": "Today {time} · {tok} tok",
  "今天还没有用量记录": "No usage recorded today",
  "协作": "Active",
  "产出": "Output",
  "会话数": "Sessions",
  "较 7 日均": "vs 7-day avg",
  "第 {turns} 轮": "turn {turns}",
  "正在启动会话…": "Starting session…",
  "最近": "Recent",
  "空闲": "Idle",
  "刚刚": "just now",
  "{n} 分钟前": "{n} min ago",
  "{n} 小时前": "{n} h ago",
  "{n} 天前": "{n} d ago",
};
