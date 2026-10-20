/* Agent Deck 1.2.1 — MIT — https://github.com/MatsuriMW/obsidian-agent-deck */
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.js
var main_exports = {};
__export(main_exports, {
  default: () => AgentDeckPlugin
});
module.exports = __toCommonJS(main_exports);
var import_fs5 = __toESM(require("fs"), 1);
var import_path5 = __toESM(require("path"), 1);
var import_child_process5 = require("child_process");
var import_obsidian7 = require("obsidian");

// src/constants.js
var STORE_VERSION = 1;
var AGENTS = {
  claude: {
    id: "claude",
    name: "Claude Code",
    short: "Claude",
    glyph: "\u2733",
    color: "#a86f58",
    soft: "rgba(168,111,88,.13)",
    kind: "claude",
    where: ["~/.claude/projects", "Claude Code \u548C Claude \u684C\u9762\u7248\u91CC\u7684 Code \u4F1A\u8BDD"],
    deep: "claude",
    desktopOnly: true
  },
  codex: {
    id: "codex",
    name: "Codex",
    short: "Codex",
    glyph: "\u2318",
    color: "#71899d",
    soft: "rgba(113,137,157,.13)",
    kind: "codex",
    where: ["~/.codex/sessions", "Codex \u684C\u9762\u7248\u548C codex \u547D\u4EE4\u884C"],
    deep: "codex",
    desktopOnly: true
  },
  workbuddy: {
    id: "workbuddy",
    name: "WorkBuddy",
    short: "WorkBuddy",
    glyph: "\u2726",
    color: "#71917f",
    soft: "rgba(113,145,127,.13)",
    kind: "workbuddy",
    where: ["~/.workbuddy/projects", "WorkBuddy \u684C\u9762\u7248"],
    deep: "workbuddy",
    desktopOnly: true
  },
  dsh: {
    id: "dsh",
    name: "DeepSeek Harness",
    short: "DSH",
    glyph: "\u25C8",
    color: "#767fae",
    soft: "rgba(118,127,174,.13)",
    kind: "dsh",
    where: ["~/.dsh/sessions", "DeepSeek Harness \u684C\u9762\u7248\u3001CLI \u548C\u901A\u8FC7 ACP \u59D4\u6D3E\u7684\u4EFB\u52A1"],
    deep: "dsh",
    desktopOnly: true
  }
};
var AGENT_ORDER = ["claude", "codex", "workbuddy", "dsh"];
var MODEL_CATALOG = [
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
    note: "Deeper reasoning for hard, quality-first work."
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
    note: "The everyday balance of speed and depth."
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
    note: "Quick, cheap turns where latency matters."
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
    note: "A fast Claude alias for interactive work."
  },
  {
    id: "deepseek-v4-pro",
    agent: "dsh",
    name: "DeepSeek-V4-Pro",
    provider: "DeepSeek",
    providerRoute: "deepseek-account",
    model: "deepseek-v4-pro",
    value: '["deepseek-account","deepseek-v4-pro"]',
    context: "128K",
    strength: 5,
    speed: 3,
    tags: ["Reasoning", "Coding"],
    cost: "High cost",
    note: "Stronger agentic coding and difficult reasoning."
  },
  {
    id: "deepseek-v41-flash",
    agent: "dsh",
    name: "DeepSeek-V4.1-Flash",
    provider: "DeepSeek",
    providerRoute: "deepseek-account",
    model: "deepseek-flash",
    value: '["deepseek-account","deepseek-flash"]',
    context: "128K",
    strength: 3,
    speed: 5,
    tags: ["Fast", "Reasoning"],
    cost: "Low cost",
    note: "The everyday DeepSeek route: quick and inexpensive."
  },
  {
    id: "deepseek-v4-flash",
    agent: "dsh",
    name: "DeepSeek-V4-Flash",
    provider: "DeepSeek official",
    providerRoute: "deepseek-official",
    model: "deepseek-v4-flash",
    value: '["deepseek-official","deepseek-v4-flash"]',
    context: "128K",
    strength: 2,
    speed: 5,
    tags: ["Fast", "Vision"],
    cost: "Low cost",
    note: "The official route, useful when an API key is configured."
  },
  {
    id: "deepseek-v4-pro-official",
    agent: "dsh",
    name: "DeepSeek-V4-Pro (official)",
    provider: "DeepSeek official",
    providerRoute: "deepseek-official",
    model: "deepseek-v4-pro",
    value: '["deepseek-official","deepseek-v4-pro"]',
    context: "128K",
    strength: 5,
    speed: 3,
    tags: ["Reasoning", "Coding"],
    cost: "High cost",
    note: "The official-route Pro model."
  }
];
var EFFORTS = {
  claude: [
    { id: "low", label: "Low", hint: "Fastest" },
    { id: "medium", label: "Medium", hint: "Balanced" },
    { id: "high", label: "High", hint: "Deeper" },
    { id: "xhigh", label: "X-High", hint: "Hard" },
    { id: "max", label: "Max", hint: "Hardest" }
  ],
  dsh: [
    { id: "off", label: "Off", hint: "Fastest" },
    { id: "low", label: "Low", hint: "Quick" },
    { id: "high", label: "High", hint: "Balanced" },
    { id: "max", label: "Max", hint: "Hardest" }
  ]
};
var CLAUDE_PERMISSIONS = [
  { id: "plan", label: "Plan", hint: "Think, propose, do not edit" },
  { id: "auto", label: "Auto", hint: "Let Claude choose and act" },
  { id: "acceptEdits", label: "Accept edits", hint: "Auto-accept file edits" },
  { id: "manual", label: "Manual", hint: "Ask before every step" }
];
var DEFAULTS = {
  version: STORE_VERSION,
  // Which agents are read. Primary agents are always on.
  agents: { claude: true, codex: true, workbuddy: true, dsh: true },
  primaryAgents: ["claude", "dsh"],
  // 0 = no cutoff; otherwise the hour at which a new journal day begins.
  dayCutoff: 8,
  pollSeconds: 20,
  idleMinutes: 5,
  fullHistoryDays: 14,
  // Claude desktop session list: identifies side chats (spawnedFrom) and archive state.
  claudeDesktop: true,
  hideArchived: true,
  // Human–AI journal: sessions written back into the daily note.
  journalFolder: "\u65E5\u8BB0",
  journalSync: true,
  resultBack: true,
  agentKw: true,
  kidBlocks: true,
  dragGrip: true,
  cliOpen: "terminal",
  // 终端里起的 Claude Code 会话点开时：terminal 回终端 / desktop 走桌面版
  cliTerminal: "auto",
  // auto：装了 Warp 用 Warp，否则系统终端；warp / terminal 指定          // 光标所在的列表项尾巴上显示拖拽把手（面板开着时）
  autoLog: false,
  autoLogEvery: 20,
  autoLogIdle: 40,
  autoLogModel: "haiku",
  autoLogPath: "",
  autoLogArchiveDone: true,
  autoLogNotify: true,
  autoLogState: {},
  workLog: {},
  showStatusBar: false,
  showMenuBar: true,
  menuBarPrimaryLimit: 6,
  menuBarOtherLimit: 3,
  menuBarHotkey: "control+option+command+D",
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
      extraArgs: ""
    },
    dsh: {
      model: "deepseek-v4-pro",
      effort: "high",
      cwd: "",
      autoApprove: false,
      extraArgs: ""
    },
    promptPrefix: "",
    promptSuffix: "",
    markStatus: true,
    writeLink: true,
    nameMax: 56
  },
  // Model picker state
  models: {
    enabled: MODEL_CATALOG.map((m) => m.id),
    pinned: ["claude-opus-5", "claude-sonnet-5", "deepseek-v4-pro"],
    order: MODEL_CATALOG.map((m) => m.id),
    custom: [],
    defaultByAgent: { claude: "claude-sonnet-5", dsh: "deepseek-v4-pro" },
    taskModels: { delegate: "auto", naming: "auto", summary: "auto" },
    effort: "high"
  },
  ui: {
    density: "comfortable",
    showSparkline: true,
    showUsageBars: true
  },
  jobs: {},
  lastScan: 0
};
function deepMerge(base, extra) {
  if (!extra || typeof extra !== "object") return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(extra)) {
    if (Array.isArray(v)) out[k] = [...v];
    else if (v && typeof v === "object" && base && typeof base[k] === "object" && !Array.isArray(base[k])) out[k] = deepMerge(base[k], v);
    else out[k] = v;
  }
  return out;
}
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
function pad(n) {
  return String(n).padStart(2, "0");
}
function fmtKey(d = /* @__PURE__ */ new Date(), cfg = {}) {
  const fmt = cfg.format || "YYYY_MM_DD";
  return fmt.replace("YYYY", d.getFullYear()).replace("MM", pad(d.getMonth() + 1)).replace("DD", pad(d.getDate()));
}
function dayKey(ms, cfg = {}) {
  const cutoff = Number.isFinite(cfg.dayCutoff) ? cfg.dayCutoff : 8;
  return fmtKey(new Date(ms - cutoff * 36e5), cfg);
}
function dayKeyToday(cfg = {}) {
  return dayKey(Date.now(), cfg);
}
function startOfDay(ms, cfg = {}) {
  const cutoff = Number.isFinite(cfg.dayCutoff) ? cfg.dayCutoff : 8;
  const d = new Date(ms - cutoff * 36e5);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() + cutoff * 36e5;
}
function dayMinute(ms, cfg = {}) {
  const start = startOfDay(ms, cfg);
  return Math.round((ms - start) / 6e4);
}
function fmtTok(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return Math.round(n / 1e3) + "k";
  return String(n);
}
function fmtMin(n) {
  n = Math.max(0, Math.round(Number(n) || 0));
  if (n < 60) return n + "m";
  const h = Math.floor(n / 60), m = n % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
function fmtDur(ms) {
  const s = Math.max(0, Math.round(ms / 1e3));
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
function timeAgo(ms) {
  if (!ms) return "";
  const s = Math.max(0, (Date.now() - ms) / 1e3);
  if (s < 45) return "\u521A\u521A";
  if (s < 3600) return Math.round(s / 60) + " \u5206\u949F\u524D";
  if (s < 86400) return Math.round(s / 3600) + " \u5C0F\u65F6\u524D";
  return Math.round(s / 86400) + " \u5929\u524D";
}
function truncate(s, n = 80) {
  s = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "\u2026" : s;
}
function unionSegs(segs) {
  const out = [];
  for (const [a, b] of [...segs].sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

// src/readers.js
var import_fs = __toESM(require("fs"), 1);
var import_path = __toESM(require("path"), 1);
var import_os = __toESM(require("os"), 1);
var import_child_process = require("child_process");

// node_modules/fzstd/esm/index.mjs
var ab = ArrayBuffer;
var u8 = Uint8Array;
var u16 = Uint16Array;
var i16 = Int16Array;
var i32 = Int32Array;
var slc = function(v, s, e) {
  if (u8.prototype.slice)
    return u8.prototype.slice.call(v, s, e);
  if (s == null || s < 0)
    s = 0;
  if (e == null || e > v.length)
    e = v.length;
  var n = new u8(e - s);
  n.set(v.subarray(s, e));
  return n;
};
var fill = function(v, n, s, e) {
  if (u8.prototype.fill)
    return u8.prototype.fill.call(v, n, s, e);
  if (s == null || s < 0)
    s = 0;
  if (e == null || e > v.length)
    e = v.length;
  for (; s < e; ++s)
    v[s] = n;
  return v;
};
var cpw = function(v, t, s, e) {
  if (u8.prototype.copyWithin)
    return u8.prototype.copyWithin.call(v, t, s, e);
  if (s == null || s < 0)
    s = 0;
  if (e == null || e > v.length)
    e = v.length;
  while (s < e) {
    v[t++] = v[s++];
  }
};
var ec = [
  "invalid zstd data",
  "window size too large (>2046MB)",
  "invalid block type",
  "FSE accuracy too high",
  "match distance too far back",
  "unexpected EOF"
];
var err = function(ind, msg, nt) {
  var e = new Error(msg || ec[ind]);
  e.code = ind;
  if (Error.captureStackTrace)
    Error.captureStackTrace(e, err);
  if (!nt)
    throw e;
  return e;
};
var rb = function(d, b, n) {
  var i = 0, o = 0;
  for (; i < n; ++i)
    o |= d[b++] << (i << 3);
  return o;
};
var b4 = function(d, b) {
  return (d[b] | d[b + 1] << 8 | d[b + 2] << 16 | d[b + 3] << 24) >>> 0;
};
var rzfh = function(dat, w) {
  var n3 = dat[0] | dat[1] << 8 | dat[2] << 16;
  if (n3 == 3126568 && dat[3] == 253) {
    var flg = dat[4];
    var ss = flg >> 5 & 1, cc = flg >> 2 & 1, df = flg & 3, fcf = flg >> 6;
    if (flg & 8)
      err(0);
    var bt = 6 - ss;
    var db = df == 3 ? 4 : df;
    var di = rb(dat, bt, db);
    bt += db;
    var fsb = fcf ? 1 << fcf : ss;
    var fss = rb(dat, bt, fsb) + (fcf == 1 && 256);
    var ws = fss;
    if (!ss) {
      var wb = 1 << 10 + (dat[5] >> 3);
      ws = wb + (wb >> 3) * (dat[5] & 7);
    }
    if (ws > 2145386496)
      err(1);
    var buf = new u8((w == 1 ? fss || ws : w ? 0 : ws) + 12);
    buf[0] = 1, buf[4] = 4, buf[8] = 8;
    return {
      b: bt + fsb,
      y: 0,
      l: 0,
      d: di,
      w: w && w != 1 ? w : buf.subarray(12),
      e: ws,
      o: new i32(buf.buffer, 0, 3),
      u: fss,
      c: cc,
      m: Math.min(131072, ws)
    };
  } else if ((n3 >> 4 | dat[3] << 20) == 25481893) {
    return b4(dat, 4) + 8;
  }
  err(0);
};
var msb = function(val) {
  var bits = 0;
  for (; 1 << bits <= val; ++bits)
    ;
  return bits - 1;
};
var rfse = function(dat, bt, mal) {
  var tpos = (bt << 3) + 4;
  var al = (dat[bt] & 15) + 5;
  if (al > mal)
    err(3);
  var sz = 1 << al;
  var probs = sz, sym = -1, re = -1, i = -1, ht = sz;
  var buf = new ab(512 + (sz << 2));
  var freq = new i16(buf, 0, 256);
  var dstate = new u16(buf, 0, 256);
  var nstate = new u16(buf, 512, sz);
  var bb1 = 512 + (sz << 1);
  var syms = new u8(buf, bb1, sz);
  var nbits = new u8(buf, bb1 + sz);
  while (sym < 255 && probs > 0) {
    var bits = msb(probs + 1);
    var cbt = tpos >> 3;
    var msk = (1 << bits + 1) - 1;
    var val = (dat[cbt] | dat[cbt + 1] << 8 | dat[cbt + 2] << 16) >> (tpos & 7) & msk;
    var msk1fb = (1 << bits) - 1;
    var msv = msk - probs - 1;
    var sval = val & msk1fb;
    if (sval < msv)
      tpos += bits, val = sval;
    else {
      tpos += bits + 1;
      if (val > msk1fb)
        val -= msv;
    }
    freq[++sym] = --val;
    if (val == -1) {
      probs += val;
      syms[--ht] = sym;
    } else
      probs -= val;
    if (!val) {
      do {
        var rbt = tpos >> 3;
        re = (dat[rbt] | dat[rbt + 1] << 8) >> (tpos & 7) & 3;
        tpos += 2;
        sym += re;
      } while (re == 3);
    }
  }
  if (sym > 255 || probs)
    err(0);
  var sympos = 0;
  var sstep = (sz >> 1) + (sz >> 3) + 3;
  var smask = sz - 1;
  for (var s = 0; s <= sym; ++s) {
    var sf = freq[s];
    if (sf < 1) {
      dstate[s] = -sf;
      continue;
    }
    for (i = 0; i < sf; ++i) {
      syms[sympos] = s;
      do {
        sympos = sympos + sstep & smask;
      } while (sympos >= ht);
    }
  }
  if (sympos)
    err(0);
  for (i = 0; i < sz; ++i) {
    var ns = dstate[syms[i]]++;
    var nb = nbits[i] = al - msb(ns);
    nstate[i] = (ns << nb) - sz;
  }
  return [tpos + 7 >> 3, {
    b: al,
    s: syms,
    n: nbits,
    t: nstate
  }];
};
var rhu = function(dat, bt) {
  var i = 0, wc = -1;
  var buf = new u8(292), hb = dat[bt];
  var hw = buf.subarray(0, 256);
  var rc = buf.subarray(256, 268);
  var ri = new u16(buf.buffer, 268);
  if (hb < 128) {
    var _a = rfse(dat, bt + 1, 6), ebt = _a[0], fdt = _a[1];
    bt += hb;
    var epos = ebt << 3;
    var lb = dat[bt];
    if (!lb)
      err(0);
    var st1 = 0, st2 = 0, btr1 = fdt.b, btr2 = btr1;
    var fpos = (++bt << 3) - 8 + msb(lb);
    for (; ; ) {
      fpos -= btr1;
      if (fpos < epos)
        break;
      var cbt = fpos >> 3;
      st1 += (dat[cbt] | dat[cbt + 1] << 8) >> (fpos & 7) & (1 << btr1) - 1;
      hw[++wc] = fdt.s[st1];
      fpos -= btr2;
      if (fpos < epos)
        break;
      cbt = fpos >> 3;
      st2 += (dat[cbt] | dat[cbt + 1] << 8) >> (fpos & 7) & (1 << btr2) - 1;
      hw[++wc] = fdt.s[st2];
      btr1 = fdt.n[st1];
      st1 = fdt.t[st1];
      btr2 = fdt.n[st2];
      st2 = fdt.t[st2];
    }
    if (++wc > 255)
      err(0);
  } else {
    wc = hb - 127;
    for (; i < wc; i += 2) {
      var byte = dat[++bt];
      hw[i] = byte >> 4;
      hw[i + 1] = byte & 15;
    }
    ++bt;
  }
  var wes = 0;
  for (i = 0; i < wc; ++i) {
    var wt = hw[i];
    if (wt > 11)
      err(0);
    wes += wt && 1 << wt - 1;
  }
  var mb = msb(wes) + 1;
  var ts = 1 << mb;
  var rem = ts - wes;
  if (rem & rem - 1)
    err(0);
  hw[wc++] = msb(rem) + 1;
  for (i = 0; i < wc; ++i) {
    var wt = hw[i];
    ++rc[hw[i] = wt && mb + 1 - wt];
  }
  var hbuf = new u8(ts << 1);
  var syms = hbuf.subarray(0, ts), nb = hbuf.subarray(ts);
  ri[mb] = 0;
  for (i = mb; i > 0; --i) {
    var pv = ri[i];
    fill(nb, i, pv, ri[i - 1] = pv + rc[i] * (1 << mb - i));
  }
  if (ri[0] != ts)
    err(0);
  for (i = 0; i < wc; ++i) {
    var bits = hw[i];
    if (bits) {
      var code = ri[bits];
      fill(syms, i, code, ri[bits] = code + (1 << mb - bits));
    }
  }
  return [bt, {
    n: nb,
    b: mb,
    s: syms
  }];
};
var dllt = rfse(/* @__PURE__ */ new u8([
  81,
  16,
  99,
  140,
  49,
  198,
  24,
  99,
  12,
  33,
  196,
  24,
  99,
  102,
  102,
  134,
  70,
  146,
  4
]), 0, 6)[1];
var dmlt = rfse(/* @__PURE__ */ new u8([
  33,
  20,
  196,
  24,
  99,
  140,
  33,
  132,
  16,
  66,
  8,
  33,
  132,
  16,
  66,
  8,
  33,
  68,
  68,
  68,
  68,
  68,
  68,
  68,
  68,
  36,
  9
]), 0, 6)[1];
var doct = rfse(/* @__PURE__ */ new u8([
  32,
  132,
  16,
  66,
  102,
  70,
  68,
  68,
  68,
  68,
  36,
  73,
  2
]), 0, 5)[1];
var b2bl = function(b, s) {
  var len = b.length, bl = new i32(len);
  for (var i = 0; i < len; ++i) {
    bl[i] = s;
    s += 1 << b[i];
  }
  return bl;
};
var llb = /* @__PURE__ */ new u8((/* @__PURE__ */ new i32([
  0,
  0,
  0,
  0,
  16843009,
  50528770,
  134678020,
  202050057,
  269422093
])).buffer, 0, 36);
var llbl = /* @__PURE__ */ b2bl(llb, 0);
var mlb = /* @__PURE__ */ new u8((/* @__PURE__ */ new i32([
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  16843009,
  50528770,
  117769220,
  185207048,
  252579084,
  16
])).buffer, 0, 53);
var mlbl = /* @__PURE__ */ b2bl(mlb, 3);
var dhu = function(dat, out, hu) {
  var len = dat.length, ss = out.length, lb = dat[len - 1], msk = (1 << hu.b) - 1, eb = -hu.b;
  if (!lb)
    err(0);
  var st = 0, btr = hu.b, pos = (len << 3) - 8 + msb(lb) - btr, i = -1;
  for (; pos > eb && i < ss; ) {
    var cbt = pos >> 3;
    var val = (dat[cbt] | dat[cbt + 1] << 8 | dat[cbt + 2] << 16) >> (pos & 7);
    st = (st << btr | val) & msk;
    out[++i] = hu.s[st];
    pos -= btr = hu.n[st];
  }
  if (pos != eb || i + 1 != ss)
    err(0);
};
var dhu4 = function(dat, out, hu) {
  var bt = 6;
  var ss = out.length, sz1 = ss + 3 >> 2, sz2 = sz1 << 1, sz3 = sz1 + sz2;
  dhu(dat.subarray(bt, bt += dat[0] | dat[1] << 8), out.subarray(0, sz1), hu);
  dhu(dat.subarray(bt, bt += dat[2] | dat[3] << 8), out.subarray(sz1, sz2), hu);
  dhu(dat.subarray(bt, bt += dat[4] | dat[5] << 8), out.subarray(sz2, sz3), hu);
  dhu(dat.subarray(bt), out.subarray(sz3), hu);
};
var rzb = function(dat, st, out) {
  var _a;
  var bt = st.b;
  var b0 = dat[bt], btype = b0 >> 1 & 3;
  st.l = b0 & 1;
  var sz = b0 >> 3 | dat[bt + 1] << 5 | dat[bt + 2] << 13;
  var ebt = (bt += 3) + sz;
  if (btype == 1) {
    if (bt >= dat.length)
      return;
    st.b = bt + 1;
    if (out) {
      fill(out, dat[bt], st.y, st.y += sz);
      return out;
    }
    return fill(new u8(sz), dat[bt]);
  }
  if (ebt > dat.length)
    return;
  if (btype == 0) {
    st.b = ebt;
    if (out) {
      out.set(dat.subarray(bt, ebt), st.y);
      st.y += sz;
      return out;
    }
    return slc(dat, bt, ebt);
  }
  if (btype == 2) {
    var b3 = dat[bt], lbt = b3 & 3, sf = b3 >> 2 & 3;
    var lss = b3 >> 4, lcs = 0, s4 = 0;
    if (lbt < 2) {
      if (sf & 1)
        lss |= dat[++bt] << 4 | (sf & 2 && dat[++bt] << 12);
      else
        lss = b3 >> 3;
    } else {
      s4 = sf;
      if (sf < 2)
        lss |= (dat[++bt] & 63) << 4, lcs = dat[bt] >> 6 | dat[++bt] << 2;
      else if (sf == 2)
        lss |= dat[++bt] << 4 | (dat[++bt] & 3) << 12, lcs = dat[bt] >> 2 | dat[++bt] << 6;
      else
        lss |= dat[++bt] << 4 | (dat[++bt] & 63) << 12, lcs = dat[bt] >> 6 | dat[++bt] << 2 | dat[++bt] << 10;
    }
    ++bt;
    var buf = out ? out.subarray(st.y, st.y + st.m) : new u8(st.m);
    var spl = buf.length - lss;
    if (lbt == 0)
      buf.set(dat.subarray(bt, bt += lss), spl);
    else if (lbt == 1)
      fill(buf, dat[bt++], spl);
    else {
      var hu = st.h;
      if (lbt == 2) {
        var hud = rhu(dat, bt);
        lcs += bt - (bt = hud[0]);
        st.h = hu = hud[1];
      } else if (!hu)
        err(0);
      (s4 ? dhu4 : dhu)(dat.subarray(bt, bt += lcs), buf.subarray(spl), hu);
    }
    var ns = dat[bt++];
    if (ns) {
      if (ns == 255)
        ns = (dat[bt++] | dat[bt++] << 8) + 32512;
      else if (ns > 127)
        ns = ns - 128 << 8 | dat[bt++];
      var scm = dat[bt++];
      if (scm & 3)
        err(0);
      var dts = [dmlt, doct, dllt];
      for (var i = 2; i > -1; --i) {
        var md = scm >> (i << 1) + 2 & 3;
        if (md == 1) {
          var rbuf = new u8([0, 0, dat[bt++]]);
          dts[i] = {
            s: rbuf.subarray(2, 3),
            n: rbuf.subarray(0, 1),
            t: new u16(rbuf.buffer, 0, 1),
            b: 0
          };
        } else if (md == 2) {
          _a = rfse(dat, bt, 9 - (i & 1)), bt = _a[0], dts[i] = _a[1];
        } else if (md == 3) {
          if (!st.t)
            err(0);
          dts[i] = st.t[i];
        }
      }
      var _b = st.t = dts, mlt = _b[0], oct = _b[1], llt = _b[2];
      var lb = dat[ebt - 1];
      if (!lb)
        err(0);
      var spos = (ebt << 3) - 8 + msb(lb) - llt.b, cbt = spos >> 3, oubt = 0;
      var lst = (dat[cbt] | dat[cbt + 1] << 8) >> (spos & 7) & (1 << llt.b) - 1;
      cbt = (spos -= oct.b) >> 3;
      var ost = (dat[cbt] | dat[cbt + 1] << 8) >> (spos & 7) & (1 << oct.b) - 1;
      cbt = (spos -= mlt.b) >> 3;
      var mst = (dat[cbt] | dat[cbt + 1] << 8) >> (spos & 7) & (1 << mlt.b) - 1;
      for (++ns; --ns; ) {
        var llc = llt.s[lst];
        var lbtr = llt.n[lst];
        var mlc = mlt.s[mst];
        var mbtr = mlt.n[mst];
        var ofc = oct.s[ost];
        var obtr = oct.n[ost];
        cbt = (spos -= ofc) >> 3;
        var ofp = 1 << ofc;
        var off = ofp + ((dat[cbt] | dat[cbt + 1] << 8 | dat[cbt + 2] << 16 | dat[cbt + 3] << 24) >>> (spos & 7) & ofp - 1);
        cbt = (spos -= mlb[mlc]) >> 3;
        var ml = mlbl[mlc] + ((dat[cbt] | dat[cbt + 1] << 8 | dat[cbt + 2] << 16) >> (spos & 7) & (1 << mlb[mlc]) - 1);
        cbt = (spos -= llb[llc]) >> 3;
        var ll = llbl[llc] + ((dat[cbt] | dat[cbt + 1] << 8 | dat[cbt + 2] << 16) >> (spos & 7) & (1 << llb[llc]) - 1);
        cbt = (spos -= lbtr) >> 3;
        lst = llt.t[lst] + ((dat[cbt] | dat[cbt + 1] << 8) >> (spos & 7) & (1 << lbtr) - 1);
        cbt = (spos -= mbtr) >> 3;
        mst = mlt.t[mst] + ((dat[cbt] | dat[cbt + 1] << 8) >> (spos & 7) & (1 << mbtr) - 1);
        cbt = (spos -= obtr) >> 3;
        ost = oct.t[ost] + ((dat[cbt] | dat[cbt + 1] << 8) >> (spos & 7) & (1 << obtr) - 1);
        if (off > 3) {
          st.o[2] = st.o[1];
          st.o[1] = st.o[0];
          st.o[0] = off -= 3;
        } else {
          var idx = off - (ll != 0);
          if (idx) {
            off = idx == 3 ? st.o[0] - 1 : st.o[idx];
            if (idx > 1)
              st.o[2] = st.o[1];
            st.o[1] = st.o[0];
            st.o[0] = off;
          } else
            off = st.o[0];
        }
        for (var i = 0; i < ll; ++i) {
          buf[oubt + i] = buf[spl + i];
        }
        oubt += ll, spl += ll;
        var stin = oubt - off;
        if (stin < 0) {
          var len = -stin;
          var bs = st.e + stin;
          if (len > ml)
            len = ml;
          for (var i = 0; i < len; ++i) {
            buf[oubt + i] = st.w[bs + i];
          }
          oubt += len, ml -= len, stin = 0;
        }
        for (var i = 0; i < ml; ++i) {
          buf[oubt + i] = buf[stin + i];
        }
        oubt += ml;
      }
      if (oubt != spl) {
        while (spl < buf.length) {
          buf[oubt++] = buf[spl++];
        }
      } else
        oubt = buf.length;
      if (out)
        st.y += oubt;
      else
        buf = slc(buf, 0, oubt);
    } else if (out) {
      st.y += lss;
      if (spl) {
        for (var i = 0; i < lss; ++i) {
          buf[i] = buf[spl + i];
        }
      }
    } else if (spl)
      buf = slc(buf, spl);
    st.b = ebt;
    return buf;
  }
  err(2);
};
var cct = function(bufs, ol) {
  if (bufs.length == 1)
    return bufs[0];
  var buf = new u8(ol);
  for (var i = 0, b = 0; i < bufs.length; ++i) {
    var chk = bufs[i];
    buf.set(chk, b);
    b += chk.length;
  }
  return buf;
};
function decompress(dat, buf) {
  var bufs = [], nb = +!buf;
  var bt = 0, ol = 0;
  for (; dat.length; ) {
    var st = rzfh(dat, nb || buf);
    if (typeof st == "object") {
      if (nb) {
        buf = null;
        if (st.w.length == st.u) {
          bufs.push(buf = st.w);
          ol += st.u;
        }
      } else {
        bufs.push(buf);
        st.e = 0;
      }
      for (; !st.l; ) {
        var blk = rzb(dat, st, buf);
        if (!blk)
          err(5);
        if (buf)
          st.e = st.y;
        else {
          bufs.push(blk);
          ol += blk.length;
          cpw(st.w, 0, blk.length);
          st.w.set(blk, st.w.length - blk.length);
        }
      }
      bt = st.b + st.c * 4;
    } else
      bt = st;
    dat = dat.subarray(bt);
  }
  return cct(bufs, ol);
}

// src/readers.js
var fsp = import_fs.default.promises;
var AI_IDLE = 5;
var LIVE_STALE = 90 * 1e3;
var MAX_TS = 2e4;
var DSH_TOUCH = /* @__PURE__ */ new Set(["user/message", "assistant/message", "tool/call", "tool/result", "turn/start", "turn/end", "step/start", "step/end"]);
var home = () => import_os.default.homedir();
var norm = (p) => String(p || "").replace(/^~(?=\/)/, home());
function projectName(cwd) {
  if (!cwd) return "?";
  if (/\/WorkBuddy\/\d{4}-\d\d-\d\d/.test(cwd)) return "WorkBuddy";
  if (/\/\.dsh\/sessions\//.test(cwd)) return "DSH";
  const p = String(cwd).split("/.claude/worktrees/")[0].replace(/\/+$/, "");
  return p === home() ? "~" : p.split("/").pop() || p;
}
function isPromptText(text) {
  const s = String(text || "").trim();
  if (!s) return false;
  if (/^<(command-|local-command|system-reminder|task-notification|ci-monitor|environment_context)/.test(s)) return false;
  if (/^\[Request interrupted/.test(s)) return false;
  if (/^You are an AI agent powered by/.test(s)) return false;
  return true;
}
function stepText(name, input) {
  const i = input || {};
  const n = String(name || "");
  const base = (x) => String(x || "").split("/").pop();
  const cut = (x) => {
    x = String(x || "").replace(/\s+/g, " ").trim();
    return x.length > 34 ? x.slice(0, 33) + "\u2026" : x;
  };
  if (/^(bash|shell|local_shell_call|exec_command|shell_command)$/i.test(n)) return cut(i.description || (Array.isArray(i.command) ? i.command[i.command.length - 1] : i.command || i.cmd) || "\u8DD1\u547D\u4EE4");
  if (/^(edit|multiedit|notebookedit|apply_patch|str_replace_editor)$/i.test(n)) return cut(`\u6539 ${base(i.file_path || i.notebook_path || i.path) || "\u6587\u4EF6"}`);
  if (/^(write|create_file)$/i.test(n)) return cut(`\u5199 ${base(i.file_path || i.path)}`);
  if (/^(read|view)$/i.test(n)) return cut(`\u8BFB ${base(i.file_path || i.path)}`);
  if (/^(grep|glob|search)$/i.test(n)) return cut(`\u627E ${i.pattern || i.query || ""}`);
  if (/^(agent|task|subagent)$/i.test(n)) return cut(`\u6D3E\u51FA\u53BB\uFF1A${i.description || ""}`);
  if (/^(websearch|web_search)$/i.test(n)) return cut(`\u641C ${i.query || ""}`);
  if (/^(webfetch|web_fetch)$/i.test(n)) return "\u8BFB\u7F51\u9875";
  if (n === "Skill") return cut(`\u7528\u6280\u80FD ${i.skill || ""}`);
  if (/^todo/.test(n)) return "\u6574\u7406\u5F85\u529E";
  return cut(n.startsWith("mcp__") ? n.split("__").pop() : n);
}
function todoOf(pairs) {
  if (!pairs || !pairs.length) return null;
  const cur = (pairs.find(([st]) => st === "in_progress") || [])[1] || "";
  return { done: pairs.filter(([st]) => st === "completed").length, total: pairs.length, cur: String(cur).replace(/\s+/g, " ").slice(0, 36) };
}
function cleanLive(v, now = Date.now()) {
  if (!v) return v;
  if (v.state === "run" && now - (v.at || 0) > LIVE_STALE) v.quiet = true;
  else v.quiet = false;
  return v;
}
var AgentUsage = class {
  constructor(opts = {}) {
    this.cfg = opts.cfg || {};
    this.settings = opts.settings || {};
    this.files = /* @__PURE__ */ new Map();
    this.meta = /* @__PURE__ */ new Map();
    this.titles = /* @__PURE__ */ new Map();
    this.codexIndexAt = 0;
    this.archived = /* @__PURE__ */ new Set();
    this.desk = /* @__PURE__ */ new Map();
    this.deskBySid = /* @__PURE__ */ new Map();
    this.deskByLocal = /* @__PURE__ */ new Map();
    this.archivedClaude = /* @__PURE__ */ new Set();
    this.sideChats = /* @__PURE__ */ new Map();
    this.subs = /* @__PURE__ */ new Map();
    this.sideAt = 0;
    this.errors = [];
    this.lastScan = 0;
  }
  get primaries() {
    const p = this.settings.primaryAgents;
    const list = Array.isArray(p) ? p : [p].filter(Boolean);
    return list.filter((x) => AGENTS[x]).slice(0, 2);
  }
  isPrimary(agent) {
    return this.primaries.includes(agent);
  }
  enabled(agent) {
    if (this.isPrimary(agent)) return true;
    const a = this.settings.agents || {};
    return a[agent] !== false;
  }
  stale(agent, ms) {
    if (this.isPrimary(agent)) return false;
    return dayKey(ms, this.cfg) < dayKeyToday(this.cfg);
  }
  // ----- roots -----
  roots() {
    const h = home();
    const out = [];
    const add = (dir, agent) => {
      if (this.enabled(agent)) out.push([norm(dir), agent]);
    };
    add(import_path.default.join(h, ".claude/projects"), "claude");
    add(import_path.default.join(h, ".config/claude/projects"), "claude");
    for (const d of String(process.env.CLAUDE_CONFIG_DIR || "").split(",").filter(Boolean)) add(import_path.default.join(d, "projects"), "claude");
    add(process.env.CODEX_HOME ? import_path.default.join(process.env.CODEX_HOME, "sessions") : import_path.default.join(h, ".codex/sessions"), "codex");
    add(process.env.CODEX_HOME ? import_path.default.join(process.env.CODEX_HOME, "archived_sessions") : import_path.default.join(h, ".codex/archived_sessions"), "codex");
    add(import_path.default.join(h, ".workbuddy/projects"), "workbuddy");
    add(import_path.default.join(h, ".dsh/sessions"), "dsh");
    const seen = /* @__PURE__ */ new Set();
    return out.filter(([d]) => !seen.has(d) && seen.add(d));
  }
  sinceMs() {
    const days = clamp(Number(this.settings.fullHistoryDays) || 14, 1, 365);
    return Date.now() - days * 864e5;
  }
  // ----- scanning -----
  async scan({ since = 0, onProgress } = {}) {
    const touched = /* @__PURE__ */ new Set();
    const floor = since || this.sinceMs();
    for (const [root, agent] of this.roots()) {
      const files = await this.walk(root, agent === "dsh" ? 4 : 5);
      for (const p of files) {
        let st;
        try {
          st = await fsp.stat(p);
        } catch {
          continue;
        }
        const fc = this.files.get(p);
        if (!fc && st.mtimeMs < floor && !this.isPrimary(agent)) continue;
        if (fc && st.size === fc.size && st.mtimeMs === fc.mtimeMs) continue;
        try {
          if (agent === "dsh") await this.readDsh(p, st, touched);
          else await this.readJsonl(p, agent, st, touched);
        } catch (e) {
          this.errors.push({ path: p, message: String(e && e.message || e) });
          if (this.errors.length > 20) this.errors.shift();
        }
        if (onProgress) onProgress(p);
        await new Promise((r) => setImmediate(r));
      }
    }
    await this.readCodexTitles();
    await this.readCodexArchived();
    await this.readClaudeDesktop();
    await this.readClaudeSideChats();
    this.applyClaudeDesktop();
    this.lastScan = Date.now();
    return touched;
  }
  async walk(dir, depth) {
    const out = [];
    let ents;
    try {
      ents = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of ents) {
      const p = import_path.default.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth > 0) out.push(...await this.walk(p, depth - 1));
      } else if (e.isFile()) {
        if (e.name.endsWith(".jsonl") || e.name.endsWith(".jsonl.zstd") || e.name.endsWith(".jsonl.zst")) out.push(p);
      }
    }
    return out;
  }
  async readCodexTitles() {
    const p = import_path.default.join(process.env.CODEX_HOME || import_path.default.join(home(), ".codex"), "session_index.jsonl");
    try {
      const st = await fsp.stat(p);
      if (st.mtimeMs === this.codexIndexAt) return;
      this.codexIndexAt = st.mtimeMs;
      const text = await fsp.readFile(p, "utf8");
      for (const line of text.split("\n")) {
        if (!line) continue;
        try {
          const d = JSON.parse(line);
          if (d.id && d.thread_name) this.titles.set(d.id, String(d.thread_name));
        } catch {
        }
      }
    } catch {
    }
  }
  // 桌面版以外几家的「归档」各记在各的地方，每轮重读一遍（取消归档也能跟上）：
  //   Codex：老版本把日志挪进 archived_sessions/，新版在 state_*.sqlite 的 threads.archived
  //   WorkBuddy：workbuddy.db 的 sessions.status = 'archived'（删掉的有 deleted_at）
  //   DeepSeek Harness：storages/workspace.json 的 global.archivedSessionIds
  async readCodexArchived() {
    const out = /* @__PURE__ */ new Set();
    const codex = process.env.CODEX_HOME || import_path.default.join(home(), ".codex");
    try {
      for (const f of await fsp.readdir(import_path.default.join(codex, "archived_sessions"))) {
        const m = /([0-9a-f]{8}-[0-9a-f-]{27})\.jsonl$/.exec(f);
        if (m) out.add(m[1]);
      }
    } catch {
    }
    if (Date.now() - (this._dbAt || 0) > 15e3 || !this._dbArchived) {
      this._dbAt = Date.now();
      const db = /* @__PURE__ */ new Set();
      try {
        const states = (await fsp.readdir(codex)).filter((f) => /^state_\d+\.sqlite$/.test(f)).sort();
        if (states.length) {
          const st = import_path.default.join(codex, states[states.length - 1]);
          for (const id of await sqliteColumn(st, "select id from threads where archived = 1")) db.add(id);
          for (const row of await sqliteColumn(st, "select id || char(9) || replace(replace(title, char(10), ' '), char(9), ' ') from threads where title != '' and updated_at > strftime('%s','now') - 30*86400")) {
            const i = row.indexOf("	");
            if (i > 0 && !this.titles.has(row.slice(0, i))) this.titles.set(row.slice(0, i), row.slice(i + 1).slice(0, 120));
          }
        }
      } catch {
      }
      for (const id of await sqliteColumn(import_path.default.join(home(), ".workbuddy/workbuddy.db"), "select id from sessions where status = 'archived' or deleted_at is not null")) db.add(id);
      try {
        const ws = JSON.parse(await fsp.readFile(import_path.default.join(home(), ".dsh/storages/workspace.json"), "utf8"));
        for (const id of ws && ws.global && ws.global.archivedSessionIds || []) db.add(String(id));
      } catch {
      }
      this._dbArchived = db;
    }
    for (const id of this._dbArchived) out.add(id);
    this.archived = out;
  }
  // ----- Claude desktop session index -----
  // 桌面版给每个会话存一份 claude-code-sessions/<账号>/<组织>/local_*.json。
  // 侧栏里看着同一级的两个会话，如果是后者从前者开出来的，只有这里有线索：
  // spawnedFrom.sessionId 是母会话的 local_ 号；归档也只是把 isArchived 设成 true，
  // ~/.claude/projects 里的 .jsonl 照旧。sid 用 cliSessionId，和 .jsonl 同名。
  deskRoots() {
    const h = home();
    const base = process.platform === "darwin" ? import_path.default.join(h, "Library/Application Support") : process.platform === "win32" ? process.env.APPDATA || import_path.default.join(h, "AppData/Roaming") : process.env.XDG_CONFIG_HOME || import_path.default.join(h, ".config");
    return [import_path.default.join(base, "Claude", "claude-code-sessions")];
  }
  async readClaudeDesktop() {
    this.deskBySid.clear();
    this.deskByLocal.clear();
    this.archivedClaude.clear();
    if (this.settings.claudeDesktop === false || !this.enabled("claude")) return;
    const cutoff = Date.now() - 7 * 864e5;
    const walk = async (dir, depth) => {
      let ents;
      try {
        ents = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of ents) {
        const p = import_path.default.join(dir, e.name);
        if (e.isDirectory()) {
          if (depth < 3) await walk(p, depth + 1);
          continue;
        }
        if (!e.isFile() || !/^local_.*\.json$/.test(e.name)) continue;
        let st;
        try {
          st = await fsp.stat(p);
        } catch {
          continue;
        }
        if (st.mtimeMs < cutoff) continue;
        let d = this.desk.get(p);
        if (!d || d.mtime !== st.mtimeMs) {
          let raw;
          try {
            raw = JSON.parse(await fsp.readFile(p, "utf8"));
          } catch {
            continue;
          }
          d = {
            mtime: st.mtimeMs,
            sid: String(raw.cliSessionId || ""),
            local: String(raw.sessionId || e.name.replace(/\.json$/, "")),
            title: String(raw.title || ""),
            parentLocal: String(raw.spawnedFrom && raw.spawnedFrom.sessionId || ""),
            created: +raw.createdAt || 0,
            active: +raw.lastActivityAt || +raw.createdAt || 0,
            archived: raw.isArchived === true,
            parentSid: "",
            parentTitle: ""
          };
          this.desk.set(p, d);
        }
        if (!d.sid) continue;
        this.deskBySid.set(d.sid, d);
        this.deskByLocal.set(d.local, d);
      }
    };
    for (const root of this.deskRoots()) await walk(root, 0);
    for (const d of this.deskBySid.values()) {
      const par = d.parentLocal ? this.deskByLocal.get(d.parentLocal) : null;
      d.parentSid = par ? par.sid : "";
      d.parentTitle = par ? par.title : "";
      if (d.archived) this.archivedClaude.add(d.sid);
    }
    for (const [p, d] of this.desk) if (!this.deskBySid.has(d.sid)) this.desk.delete(p);
  }
  // 开着的 side chat：桌面版给每个 side chat 起一个 claude 子进程，参数里带
  // --fork-session --no-session-persistence --resume <母会话 sid>；进程不在就是关了。
  readClaudeSideChats() {
    if (this.settings.claudeDesktop === false || !this.enabled("claude") || process.platform === "win32") {
      this.sideChats.clear();
      return Promise.resolve(this.sideChats);
    }
    if (Date.now() - this.sideAt < 1e4) return Promise.resolve(this.sideChats);
    this.sideAt = Date.now();
    return new Promise((resolve) => {
      (0, import_child_process.execFile)("ps", ["-axo", "pid=,etime=,command="], { maxBuffer: 16 << 20 }, (err2, text) => {
        const out = /* @__PURE__ */ new Map();
        if (!err2) for (const line of String(text).split("\n")) {
          if (!line.includes("--fork-session") || !line.includes("--no-session-persistence")) continue;
          if (line.includes("disclaimer")) continue;
          const m = /--resume[= ]([0-9a-f]{8}-[0-9a-f-]{27})/.exec(line);
          if (!m) continue;
          const [pid, et] = line.trim().split(/\s+/);
          const t = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(et || "");
          const age = t ? ((+t[1] || 0) * 86400 + (+t[2] || 0) * 3600 + +t[3] * 60 + +t[4]) * 1e3 : 0;
          if (!out.has(m[1])) out.set(m[1], []);
          out.get(m[1]).push({ pid: +pid, since: Date.now() - age });
        }
        this.sideChats = out;
        resolve(out);
      });
    });
  }
  // 把桌面版清单和 side chat 状态贴到会话索引上：parentSid / parentTitle 是母子关系，
  // archived 是桌面版里归档了，sideChats / sideSince 是正开着的 side chat 数和最早那个的开始时间。
  applyClaudeDesktop() {
    for (const m of this.meta.values()) {
      if (m.agent !== "claude") continue;
      m.deskTitle = "";
      m.parentSid = "";
      m.parentTitle = "";
      m.archived = false;
      m.sideChats = 0;
      m.sideSince = 0;
    }
    for (const d of this.deskBySid.values()) {
      const m = this.meta.get(d.sid);
      if (!m) continue;
      m.deskTitle = d.title;
      if (!m.title && d.title) m.title = d.title;
      m.parentSid = d.parentSid || "";
      m.parentTitle = d.parentTitle || "";
      m.archived = d.archived === true;
      if (d.created && !m.startedAt) m.startedAt = d.created;
    }
    for (const [sid, list] of this.sideChats) {
      const m = this.meta.get(sid);
      if (!m || !list.length) continue;
      const since = list.map((x) => x.since || 0).filter(Boolean);
      m.sideChats = list.length;
      m.sideSince = since.length ? Math.min(...since) : 0;
    }
  }
  // 归档 = 做完：桌面版里归档的、Codex archived_sessions 里的都可以从会话列表里收起来
  hidden(sid) {
    if (this.settings.hideArchived === false) return false;
    return this.archivedClaude.has(sid) || this.archived.has(sid);
  }
  // ----- file caches -----
  ensureFile(p, agent) {
    let fc = this.files.get(p);
    if (!fc) {
      const base = import_path.default.basename(p).replace(/\.jsonl(\.zstd|\.zst)?$/, "");
      const flat = p.replace(/\\/g, "/");
      const sm = /([0-9a-f]{8}-[0-9a-f-]{27})\/subagents\/agent-([^/]+)\.jsonl$/.exec(flat);
      const sid = sm ? sm[1] : base.startsWith("session-") ? base : (/([0-9a-f]{8}-[0-9a-f-]{27})/.exec(base) || [])[1] || base;
      fc = {
        path: p,
        agent,
        size: 0,
        offset: 0,
        mtime: 0,
        sid,
        id: sid,
        cwd: "",
        app: base.startsWith("session-") ? "dsh" : "",
        model: "",
        days: /* @__PURE__ */ new Map(),
        msgs: /* @__PURE__ */ new Map(),
        titles: /* @__PURE__ */ new Map(),
        live: null,
        zstd: p.endsWith(".zstd") || p.endsWith(".zst"),
        sub: sm ? sm[2] : "",
        parentSid: sm ? sm[1] : "",
        metaRead: false
      };
      this.files.set(p, fc);
    }
    return fc;
  }
  dayFor(fc, key) {
    let day = fc.days.get(key);
    if (!day) fc.days.set(key, day = { sess: /* @__PURE__ */ new Map(), prompts: 0 });
    return day;
  }
  touchSess(fc, touched, ms, sid, cwd, app) {
    const key = dayKey(ms, this.cfg);
    touched.add(key);
    const day = this.dayFor(fc, key);
    let s = day.sess.get(sid);
    if (!s) day.sess.set(sid, s = { proj: projectName(cwd), cwd: cwd || "", app: app || "", agent: fc.agent, ts: [], text: "" });
    if (s.ts.length < MAX_TS) s.ts.push(dayMinuteCfg(ms, this.cfg));
    return { key, day, s };
  }
  liveOf(fc, sid, ms) {
    if (!fc.live) fc.live = { sid, agent: fc.agent, at: 0, state: "run", step: "", todo: null, err: "", lastText: "", model: "", title: "" };
    const v = fc.live;
    if (ms >= v.at) {
      v.at = ms;
    }
    return v;
  }
  noteMeta(fc, sid, patch) {
    let m = this.meta.get(sid);
    if (!m) this.meta.set(sid, m = { sid, agent: fc.agent, title: "", text: "", cwd: fc.cwd || "", app: fc.app || "", model: "", lastAt: 0, out: 0, fresh: 0, cached: 0, calls: 0, segs: [], state: "idle", step: "", todo: null, err: "", lastText: "", archived: false });
    Object.assign(m, patch);
    if (!m.title && this.titles.has(sid)) m.title = this.titles.get(sid);
    return m;
  }
  // ----- JSONL agents -----
  async readJsonl(p, agent, st, touched) {
    const fc = this.ensureFile(p, agent);
    if (fc.sub && !fc.metaRead) {
      fc.metaRead = true;
      this.readSubMeta(p, fc).catch(() => {
      });
    }
    if (st.size < fc.size) {
      fc.size = 0;
      fc.offset = 0;
      fc.days = /* @__PURE__ */ new Map();
      fc.msgs = /* @__PURE__ */ new Map();
      fc.titles = /* @__PURE__ */ new Map();
      fc.live = null;
    }
    fc.mtime = st.mtimeMs;
    if (st.size === fc.offset) {
      fc.size = st.size;
      return;
    }
    const fh = await fsp.open(p, "r");
    try {
      const len = st.size - fc.offset;
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, buf.length, fc.offset);
      fc.size = st.size;
      const end = buf.lastIndexOf(10);
      if (end < 0) return;
      fc.offset += end + 1;
      const lines = buf.toString("utf8", 0, end).split("\n");
      for (let i = 0; i < lines.length; i++) {
        this.ingestJsonl(lines[i], fc, touched);
        if (i % 2e3 === 1999) await new Promise((r) => setImmediate(r));
      }
    } finally {
      await fh.close();
    }
  }
  ingestJsonl(line, fc, touched) {
    if (!line) return;
    if (fc.agent === "claude" && fc.sub) this.subLine(fc, line);
    if (fc.agent === "claude") return this.ingestClaude(line, fc, touched);
    if (fc.agent === "codex") return this.ingestCodex(line, fc, touched);
    if (fc.agent === "workbuddy") return this.ingestWorkbuddy(line, fc, touched);
  }
  // ---- Claude Code subagents ----
  // 会话派一个 subagent，日志另起一个文件：<会话号>/subagents/agent-<agentId>.jsonl，
  // 旁边的 .meta.json 写着 { description, agentType, requestShape }。每个子代理单独记一份，
  // 给日记里的「🤖 子代理」子块用；跑完 / 出错 / 被停也看父会话收到的 <task-notification>。
  subOf(sid, id) {
    let m = this.subs.get(sid);
    if (!m) this.subs.set(sid, m = /* @__PURE__ */ new Map());
    let r = m.get(id);
    if (!r) m.set(id, r = { id, desc: "", type: "", bg: false, start: 0, at: 0, state: "run", step: "", last: "", end: "", endAt: 0, tok: /* @__PURE__ */ new Map() });
    return r;
  }
  subsOf(sid) {
    return [...(this.subs.get(sid) || /* @__PURE__ */ new Map()).values()].filter((r) => r.start).sort((a, b) => a.start - b.start);
  }
  async readSubMeta(p, fc) {
    try {
      const m = JSON.parse(await fsp.readFile(p.replace(/\.jsonl$/, ".meta.json"), "utf8"));
      const r = this.subOf(fc.parentSid, fc.sub);
      r.desc = String(m.description || "");
      r.type = String(m.agentType || "");
      r.bg = m.requestShape === "background";
    } catch {
    }
  }
  subLine(fc, line) {
    if (line.indexOf('"isSidechain":true') < 0) return;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      return;
    }
    const ms = Date.parse(d.timestamp);
    if (!ms) return;
    const r = this.subOf(fc.parentSid, fc.sub);
    if (!r.start || ms < r.start) r.start = ms;
    if (ms < r.at) return;
    r.at = ms;
    if (r.end && ms > r.endAt) r.end = "";
    const c = d.message && d.message.content;
    if (d.type === "user") {
      if (!r.end && !r.handed) r.state = "run";
      return;
    }
    const stop = d.message && d.message.stop_reason;
    const tools = (Array.isArray(c) ? c : []).filter((b) => b && b.type === "tool_use");
    if (tools.length) r.handed = tools.some((b) => b.name === "SubagentHandback");
    if (!r.end) r.state = r.handed || stop === "end_turn" || stop === "stop_sequence" ? "done" : "run";
    for (const b of tools) if (b.name !== "SubagentHandback") r.step = stepText(b.name, b.input);
    const hb = tools.find((b) => b.name === "SubagentHandback");
    const said = (Array.isArray(c) ? c : []).filter((b) => b && b.type === "text").map((b) => b.text || "").join("\n").trim();
    if (hb && hb.input) r.last = String(hb.input.message || hb.input.report || hb.input.result || "");
    else if (said && !r.handed) r.last = said;
    const u = d.message && d.message.usage;
    if (u && d.message.id) r.tok.set(d.message.id, (u.output_tokens || 0) + (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0));
  }
  // 父会话收到的「后台任务结束了」：只管 subagent 的（后台命令也发这种通知，没有对应子代理的不管）
  subNotice(sid, text, ms) {
    const id = (/<task-id>([^<]+)<\/task-id>/.exec(text) || [])[1], st = (/<status>([^<]+)<\/status>/.exec(text) || [])[1];
    if (!id || !st) return;
    const known = this.subs.get(sid) && this.subs.get(sid).get(id), sum = /<summary>Agent "([^"]*)"/.exec(text);
    if (!known && !sum) return;
    const r = this.subOf(sid, id);
    if (!r.desc && sum) r.desc = sum[1];
    if (!r.start) r.start = ms;
    if (ms < r.endAt) return;
    r.end = st;
    r.endAt = ms;
    r.at = Math.max(r.at, ms);
    r.state = st === "completed" ? "done" : "fail";
  }
  // ---- Claude Code ----
  ingestClaude(line, fc, touched) {
    if (line.indexOf("<task-notification>") >= 0 && line.indexOf('"type":"user"') < 0 && line.indexOf('"isSidechain":true') < 0) {
      let q;
      try {
        q = JSON.parse(line);
      } catch {
        return;
      }
      const text = q.type === "queue-operation" && q.operation === "enqueue" ? q.content : q.attachment && q.attachment.type === "queued_command" ? q.attachment.prompt : "";
      if (typeof text === "string" && text.startsWith("<task-notification>") && q.sessionId) this.subNotice(q.sessionId, text, Date.parse(q.timestamp) || 0);
      return;
    }
    if (line.indexOf('"type":"assistant"') < 0 && line.indexOf('"type":"user"') < 0 && line.indexOf('"type":"custom-title"') < 0 && line.indexOf('"type":"last-prompt"') < 0) return;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      return;
    }
    if (d.type === "custom-title") {
      if (d.customTitle) {
        fc.titles.set(d.sessionId, d.customTitle);
        this.titles.set(d.sessionId, d.customTitle);
        const m = this.meta.get(d.sessionId);
        if (m) m.title = d.customTitle;
      }
      fc.sid = d.sessionId || fc.sid;
      return;
    }
    if (d.type === "last-prompt") {
      fc.sid = d.sessionId || fc.sid;
      return;
    }
    if (d.type !== "assistant" && d.type !== "user") return;
    const ms = Date.parse(d.timestamp);
    if (!ms || this.stale("claude", ms)) return;
    fc.sid = d.sessionId || fc.sid;
    fc.cwd = d.cwd || fc.cwd;
    fc.app = d.entrypoint || fc.app;
    const sid = fc.sid;
    const { key, day, s } = this.touchSess(fc, touched, ms, sid, fc.cwd, fc.app);
    const v = this.liveOf(fc, sid, ms);
    v.title = fc.titles.get(sid) || this.titles.get(sid) || v.title;
    v.cwd = fc.cwd;
    v.app = fc.app;
    if (d.type === "assistant" && d.message) {
      v.model = d.message.model || v.model;
      const c = d.message.content;
      for (const b of Array.isArray(c) ? c : []) {
        if (b.type === "tool_use") {
          if (b.name === "TodoWrite" && Array.isArray(b.input && b.input.todos)) v.todo = todoOf(b.input.todos.map((t) => [t.status, t.activeForm || t.content]));
          else v.step = stepText(b.name, b.input);
        }
        if (b.type === "text" && b.text) v.lastText = b.text;
      }
      const stop = d.message.stop_reason;
      v.state = stop === "end_turn" || stop === "stop_sequence" ? "wait" : "run";
      const u = d.message.usage;
      if (u && d.message.id && !d.isSidechain) {
        const id = `${d.message.id}:${d.requestId || ""}`;
        fc.msgs.set(id, { key, sid, proj: s.proj, model: d.message.model, out: u.output_tokens || 0, fresh: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0), cached: u.cache_read_input_tokens || 0, at: ms });
        this.noteMeta(fc, sid, { title: v.title, text: s.text, cwd: fc.cwd, app: fc.app, model: v.model, lastAt: Math.max(ms, this.meta.get(sid)?.lastAt || 0), out: (this.meta.get(sid)?.out || 0) + (u.output_tokens || 0), fresh: (this.meta.get(sid)?.fresh || 0) + (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0), cached: (this.meta.get(sid)?.cached || 0) + (u.cache_read_input_tokens || 0), calls: (this.meta.get(sid)?.calls || 0) + 1, state: v.state, step: v.step, todo: v.todo, lastText: v.lastText });
      }
    } else if (d.type === "user" && !d.isSidechain) {
      const c = d.message && d.message.content;
      const text = typeof c === "string" ? c : Array.isArray(c) && !c.some((b) => b.type === "tool_result") ? c.filter((b) => b.type === "text").map((b) => b.text).join("") : "";
      if (isPromptText(text)) {
        day.prompts++;
        if (s.text.length < 300) s.text += (s.text ? " / " : "") + text.replace(/\s+/g, " ").slice(0, 300 - s.text.length);
        v.state = /^\s*\[Request interrupted/.test(text) ? "wait" : "run";
        this.noteMeta(fc, sid, { title: v.title, text: s.text, cwd: fc.cwd, app: fc.app, lastAt: Math.max(ms, this.meta.get(sid)?.lastAt || 0), state: v.state });
      }
    }
  }
  // ---- Codex ----
  ingestCodex(line, fc, touched) {
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      return;
    }
    const p = d.payload || {};
    if (d.type === "session_meta") {
      fc.sid = p.id || fc.sid;
      fc.cwd = p.cwd || fc.cwd;
      fc.app = p.originator || fc.app || "codex";
      const spawn4 = p.source && typeof p.source === "object" && p.source.subagent && p.source.subagent.thread_spawn;
      const parent = p.parent_thread_id || spawn4 && spawn4.parent_thread_id || "";
      if (parent && parent !== fc.sid) {
        fc.parentSid = String(parent);
        this.noteMeta(fc, fc.sid, { parentSid: fc.parentSid });
      }
      return;
    }
    if (d.type === "turn_context") {
      if (p.model) fc.model = p.model;
      return;
    }
    const ms = Date.parse(d.timestamp);
    if (!ms || d.type !== "event_msg" && d.type !== "response_item") return;
    const sid = fc.sid;
    if (this.stale("codex", ms)) {
      const t2 = d.type === "event_msg" && p.type === "token_count" && p.info && p.info.total_token_usage;
      if (t2) fc.tot = { out: t2.output_tokens || 0, fresh: Math.max(0, (t2.input_tokens || 0) - (t2.cached_input_tokens || 0)), cached: t2.cached_input_tokens || 0 };
      return;
    }
    const { key, day, s } = this.touchSess(fc, touched, ms, sid, fc.cwd, fc.app);
    const v = this.liveOf(fc, sid, ms);
    v.cwd = fc.cwd;
    v.app = fc.app;
    v.title = this.titles.get(sid) || v.title;
    if (d.type === "event_msg") {
      if (p.type === "task_complete" || p.type === "turn_aborted") v.state = "wait";
      else if (p.type === "error") {
        v.state = "error";
        v.err = String(p.message || "").replace(/\s+/g, " ").slice(0, 80);
      } else if (p.type === "task_started" || p.type === "user_message") v.state = "run";
      else if (p.type === "agent_message" && p.message) v.lastText = String(p.message);
    }
    if (d.type === "response_item") {
      if (p.type === "message" && p.role === "user") {
        const text = (Array.isArray(p.content) ? p.content : []).filter((b) => b && b.type === "input_text").map((b) => b.text || "").join("").trim();
        if (text && isPromptText(text)) {
          day.prompts++;
          if (s.text.length < 300) s.text += (s.text ? " / " : "") + text.replace(/\s+/g, " ").slice(0, 300 - s.text.length);
        }
      }
      if (p.type === "message" && p.role === "assistant") {
        const text = (Array.isArray(p.content) ? p.content : []).filter((b) => b && (b.type === "output_text" || b.type === "text")).map((b) => b.text || "").join(" ");
        if (text) v.lastText = text;
      }
      if (p.type === "function_call" || p.type === "custom_tool_call" || p.type === "local_shell_call") {
        let a = {};
        try {
          a = typeof p.arguments === "string" ? JSON.parse(p.arguments) : p.arguments || p.action || {};
        } catch {
        }
        if (p.name === "update_plan" && Array.isArray(a.plan)) v.todo = todoOf(a.plan.map((x) => [x.status, x.step]));
        else v.step = stepText(p.name || p.type, a);
        v.state = "run";
      }
    }
    const t = d.type === "event_msg" && p.type === "token_count" && p.info && p.info.total_token_usage;
    if (t) {
      const prev = fc.tot || { out: 0, fresh: 0, cached: 0 };
      const cur = { out: t.output_tokens || 0, fresh: Math.max(0, (t.input_tokens || 0) - (t.cached_input_tokens || 0)), cached: t.cached_input_tokens || 0 };
      const m = { key, sid, proj: s.proj, model: fc.model, out: Math.max(0, cur.out - prev.out), fresh: Math.max(0, cur.fresh - prev.fresh), cached: Math.max(0, cur.cached - prev.cached), at: ms };
      if (m.out || m.fresh || m.cached) {
        fc.msgs.set(`codex:${fc.id}:${fc.msgs.size}`, m);
        const meta = this.meta.get(sid) || {};
        this.noteMeta(fc, sid, { title: v.title, text: s.text, cwd: fc.cwd, app: fc.app, model: fc.model, lastAt: Math.max(ms, meta.lastAt || 0), out: (meta.out || 0) + m.out, fresh: (meta.fresh || 0) + m.fresh, cached: (meta.cached || 0) + m.cached, calls: (meta.calls || 0) + 1, state: v.state, step: v.step, todo: v.todo, lastText: v.lastText });
      }
      fc.tot = cur;
    }
  }
  // ---- WorkBuddy ----
  ingestWorkbuddy(line, fc, touched) {
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      return;
    }
    if (d.type === "ai-title") {
      if (d.aiTitle) {
        fc.titles.set(fc.sid, d.aiTitle);
        this.titles.set(fc.sid, d.aiTitle);
      }
      return;
    }
    if (!["message", "reasoning", "function_call", "function_call_result"].includes(d.type) || !+d.timestamp) return;
    const ms = +d.timestamp;
    if (this.stale("workbuddy", ms)) return;
    const { key, day, s } = this.touchSess(fc, touched, ms, fc.sid, d.cwd || fc.cwd, "workbuddy");
    const v = this.liveOf(fc, fc.sid, ms);
    v.title = fc.titles.get(fc.sid) || v.title;
    v.cwd = d.cwd || fc.cwd;
    if (d.type === "message") {
      v.state = d.role === "assistant" ? "wait" : "run";
      if (d.role === "assistant") {
        const text = (Array.isArray(d.content) ? d.content : []).filter((b) => b && (b.type === "output_text" || b.type === "text")).map((b) => b.text || "").join(" ");
        if (text) v.lastText = text;
      }
      if (d.role === "user") {
        const text = (Array.isArray(d.content) ? d.content : []).filter((b) => b && b.type === "input_text").map((b) => b.text || "").join("").replace(/<system-reminder[\s\S]*?<\/system-reminder>/g, "").trim();
        if (isPromptText(text)) {
          day.prompts++;
          if (s.text.length < 300) s.text += (s.text ? " / " : "") + text.replace(/\s+/g, " ").slice(0, 300 - s.text.length);
        }
      }
    } else if (d.type === "function_call") {
      v.state = "run";
      let a = {};
      try {
        a = typeof d.arguments === "string" ? JSON.parse(d.arguments) : d.arguments || {};
      } catch {
      }
      v.step = stepText(d.name, a);
    }
    const pd = d.providerData || {}, u = pd.usage;
    if (u && pd.messageId) {
      const cached = (u.inputTokensDetails || []).reduce((k, x) => k + (x && x.cached_tokens || 0), 0);
      const m = { key, sid: fc.sid, proj: s.proj, model: pd.requestModelName || pd.model, out: u.outputTokens || 0, fresh: Math.max(0, (u.inputTokens || 0) - cached), cached, at: ms };
      fc.msgs.set("wb:" + pd.messageId, m);
      const meta = this.meta.get(fc.sid) || {};
      this.noteMeta(fc, fc.sid, { title: v.title, text: s.text, cwd: v.cwd, app: "workbuddy", model: m.model, lastAt: Math.max(ms, meta.lastAt || 0), out: (meta.out || 0) + m.out, fresh: (meta.fresh || 0) + m.fresh, cached: (meta.cached || 0) + m.cached, calls: (meta.calls || 0) + 1, state: v.state, step: v.step, lastText: v.lastText });
    }
  }
  // ----- DeepSeek Harness (zstd JSONL) -----
  async readDsh(p, st, touched) {
    const fc = this.ensureFile(p, "dsh");
    if (fc.mtime === st.mtimeMs && fc.size === st.size) return;
    const fd = await fsp.open(p, "r");
    try {
      const head = Buffer.alloc(Math.min(64, st.size));
      await fd.read(head, 0, head.length, 0);
      const headHex = head.toString("hex");
      const grown = fc.zOff > 0 && st.size >= fc.zOff && fc.zHead === headHex;
      const from = grown ? fc.zOff : 0;
      const raw = Buffer.alloc(st.size - from);
      await fd.read(raw, 0, raw.length, from);
      let bytes = null, used = raw.length;
      try {
        bytes = decompress(raw);
      } catch {
        for (let i = raw.length - 4; i > 0 && !bytes; i--) {
          if (raw[i] !== 40 || raw[i + 1] !== 181 || raw[i + 2] !== 47 || raw[i + 3] !== 253) continue;
          try {
            bytes = decompress(raw.subarray(0, i));
            used = i;
          } catch {
          }
        }
        if (!bytes) return;
      }
      if (!grown) {
        fc.days = /* @__PURE__ */ new Map();
        fc.msgs = /* @__PURE__ */ new Map();
        fc.titles = /* @__PURE__ */ new Map();
        fc.live = null;
        fc.tot = null;
        fc.zCarry = "";
      }
      fc.mtime = used === raw.length ? st.mtimeMs : 0;
      fc.size = from + used;
      fc.zOff = from + used;
      fc.zHead = headHex;
      const text = (fc.zCarry || "") + Buffer.from(bytes).toString("utf8");
      const cut = text.lastIndexOf("\n");
      fc.zCarry = cut < 0 ? text : text.slice(cut + 1);
      const lines = cut < 0 ? [] : text.slice(0, cut).split("\n");
      for (let i = 0; i < lines.length; i++) {
        this.ingestDsh(lines[i], fc, touched);
        if (i % 2e3 === 1999) await new Promise((r) => setImmediate(r));
      }
    } finally {
      await fd.close();
    }
  }
  ingestDsh(line, fc, touched) {
    if (!line) return;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      return;
    }
    const t = d.type;
    const ms = +d.time || Date.parse(d.timestamp) || 0;
    if (t === "session") {
      fc.sid = d.id || fc.sid;
      fc.cwd = d.cwd || fc.cwd;
      fc.app = "dsh";
      fc.createdAt = d.createdAt || fc.createdAt;
      if (d.parentSession) fc.parentSid = String(d.parentSession);
      const m = this.noteMeta(fc, fc.sid, { cwd: fc.cwd, app: "dsh", lastAt: Math.max(ms || d.createdAt || 0, this.meta.get(fc.sid)?.lastAt || 0), ...fc.parentSid ? { parentSid: fc.parentSid } : {} });
      return;
    }
    if (!ms) return;
    if (t === "session/title") {
      const title = d.data && d.data.title;
      if (title) {
        fc.titles.set(fc.sid, title);
        this.titles.set(fc.sid, title);
        const m = this.meta.get(fc.sid);
        if (m) m.title = title;
      }
      return;
    }
    if (!DSH_TOUCH.has(t) || this.stale("dsh", ms)) return;
    const sid = fc.sid;
    const { key, day, s } = this.touchSess(fc, touched, ms, sid, fc.cwd, "dsh");
    const v = this.liveOf(fc, sid, ms);
    v.cwd = fc.cwd;
    v.title = fc.titles.get(sid) || v.title;
    const data = d.data || {};
    if (t === "user/message") {
      const content = data.message ? data.message.content : data.content;
      const text = Array.isArray(content) ? content.filter((b) => b && b.type === "text").map((b) => b.text || "").join("") : String(content || "");
      if (isPromptText(text) && !(data.source && data.source.kind === "system")) {
        day.prompts++;
        if (s.text.length < 300) s.text += (s.text ? " / " : "") + text.replace(/\s+/g, " ").slice(0, 300 - s.text.length);
        v.state = "run";
        this.noteMeta(fc, sid, { title: v.title, text: s.text, cwd: fc.cwd, app: "dsh", lastAt: Math.max(ms, this.meta.get(sid)?.lastAt || 0), state: "run" });
      }
    } else if (t === "turn/start") {
      v.state = "run";
      v.err = "";
    } else if (t === "step/start") {
      v.state = "run";
    } else if (t === "tool/call") {
      v.state = "run";
      let a = {};
      try {
        a = typeof data.arguments === "string" ? JSON.parse(data.arguments) : data.arguments || {};
      } catch {
      }
      v.step = stepText(data.name, a);
      if (/todo/i.test(String(data.name || "")) && Array.isArray(a.todos)) v.todo = todoOf(a.todos.map((x) => [x.status, x.content || x.activeForm]));
    } else if (t === "assistant/message") {
      v.state = "run";
      const msg = data.message || {};
      const content = msg.content || [];
      for (const b of Array.isArray(content) ? content : []) {
        if (b.type === "text" && b.text) v.lastText = b.text;
        if (b.type === "tool-call" || b.type === "tool_use") v.step = stepText(b.name, b.arguments || b.input);
      }
      const src = msg.source || {};
      if (src.model) v.model = src.model;
      const u = data.usage;
      if (u && (u.outputTokens || u.inputTokens || u.cacheReadTokens)) {
        const id = msg.id || `dsh:${sid}:${d.seq ?? fc.msgs.size}`;
        const m = {
          key,
          sid,
          proj: s.proj,
          model: src.model || v.model,
          out: u.outputTokens || 0,
          fresh: (u.inputTokens || 0) + (u.cacheWriteTokens || 0),
          cached: u.cacheReadTokens || 0,
          at: ms
        };
        fc.msgs.set(id, m);
        const meta = this.meta.get(sid) || {};
        this.noteMeta(fc, sid, { title: v.title, text: s.text, cwd: fc.cwd, app: "dsh", model: m.model, lastAt: Math.max(ms, meta.lastAt || 0), out: (meta.out || 0) + m.out, fresh: (meta.fresh || 0) + m.fresh, cached: (meta.cached || 0) + m.cached, calls: (meta.calls || 0) + 1, state: v.state, step: v.step, todo: v.todo, lastText: v.lastText });
      }
    } else if (t === "turn/end") {
      const reason = data.reason || {};
      if (reason.kind === "error") {
        v.state = "error";
        v.err = String(reason.error && reason.error.message || "").slice(0, 120);
      } else if (reason.kind === "aborted") v.state = "wait";
      else v.state = "wait";
      v.todo = null;
      const meta = this.meta.get(sid);
      if (meta) {
        meta.state = v.state;
        meta.err = v.err;
        meta.lastAt = Math.max(ms, meta.lastAt || 0);
      }
    }
  }
  // ----- derived -----
  summary(key) {
    var _a, _b, _c, _d;
    const sessions = /* @__PURE__ */ new Map();
    const asked = {};
    let prompts = 0;
    for (const fc of this.files.values()) {
      for (const [sid, t] of fc.titles) this.titles.set(sid, t);
      const day = fc.days.get(key);
      if (!day) continue;
      prompts += day.prompts;
      asked[fc.agent] = (asked[fc.agent] || 0) + day.prompts;
      for (const [sid, s] of day.sess) {
        const cur = sessions.get(sid);
        if (cur) {
          cur.ts.push(...s.ts);
          if (cur.text.length < 300 && s.text) cur.text += (cur.text ? " / " : "") + s.text;
        } else {
          sessions.set(sid, { sid, proj: s.proj, cwd: s.cwd, app: s.app, agent: s.agent, ts: [...s.ts], text: s.text, min: 0, out: 0, fresh: 0, cached: 0, segs: [] });
        }
      }
    }
    if (!sessions.size) return null;
    const res = { wall: 0, agent: 0, sessions: sessions.size, prompts, calls: 0, out: 0, fresh: 0, cached: 0, segs: [], proj: {}, models: {}, list: [], by: {} };
    const spans = [];
    for (const s of sessions.values()) {
      s.ts.sort((a2, b2) => a2 - b2);
      let a = s.ts[0], b = a + 1;
      const g = (_a = res.by)[_b = s.agent] || (_a[_b] = { wall: 0, agent: 0, out: 0, fresh: 0, cached: 0, segs: [], calls: 0, prompts: asked[s.agent] || 0, models: {} });
      const push = () => {
        var _a2, _b2;
        spans.push([a, b]);
        s.segs.push([a, b]);
        s.min += b - a;
        res.agent += b - a;
        g.agent += b - a;
        g.segs.push([a, b]);
        const pj = (_a2 = res.proj)[_b2 = s.proj] || (_a2[_b2] = { min: 0, out: 0, agents: {} });
        pj.min += b - a;
        pj.agents[s.agent] = (pj.agents[s.agent] || 0) + b - a;
      };
      for (const t of s.ts.slice(1)) {
        if (t - b <= AI_IDLE) b = Math.max(b, t);
        else {
          push();
          a = t;
          b = t + 1;
        }
      }
      push();
    }
    res.segs = unionSegs(spans);
    res.wall = Math.round(res.segs.reduce((n, [a, b]) => n + b - a, 0));
    const seen = /* @__PURE__ */ new Set();
    for (const fc of this.files.values()) {
      for (const [id, m] of fc.msgs) {
        if (m.key !== key || seen.has(id)) continue;
        seen.add(id);
        res.calls++;
        res.out += m.out;
        res.fresh += m.fresh;
        res.cached += m.cached;
        ((_c = res.proj)[_d = m.proj] || (_c[_d] = { min: 0, out: 0, agents: {} })).out += m.out;
        const liveModel = m.model && m.model !== "<synthetic>";
        if (sessions.has(m.sid)) {
          const ss = sessions.get(m.sid);
          const g = res.by[ss.agent];
          ss.out += m.out;
          ss.fresh += m.fresh;
          ss.cached += m.cached;
          g.out += m.out;
          g.calls++;
          g.fresh += m.fresh;
          g.cached += m.cached;
          if (liveModel) g.models[m.model] = (g.models[m.model] || 0) + m.out;
        }
        if (liveModel) res.models[m.model] = (res.models[m.model] || 0) + m.out;
      }
    }
    for (const g of Object.values(res.by)) {
      g.segs = unionSegs(g.segs);
      g.wall = Math.round(g.segs.reduce((n, [a, b]) => n + b - a, 0));
      g.agent = Math.round(g.agent);
    }
    for (const s of sessions.values()) {
      res.list.push({
        sid: s.sid,
        agent: s.agent,
        dir: s.proj,
        cwd: s.cwd,
        app: s.app,
        title: this.titles.get(s.sid) || "",
        text: s.text.slice(0, 300),
        min: Math.round(s.min),
        out: s.out,
        fresh: s.fresh,
        cached: s.cached,
        segs: s.segs.map(([a, b]) => [Math.round(a), Math.round(b)])
      });
    }
    for (const x of res.list) if (res.by[x.agent]) res.by[x.agent].sessions = (res.by[x.agent].sessions || 0) + 1;
    res.wall = Math.round(res.wall);
    res.agent = Math.round(res.agent);
    res.segs = res.segs.map(([a, b]) => [Math.round(a), Math.round(b)]);
    for (const p of Object.values(res.proj)) {
      p.min = Math.round(p.min);
      p.out = Math.round(p.out);
      for (const k in p.agents || {}) p.agents[k] = Math.round(p.agents[k]);
    }
    res.list.sort((a, b) => (b.segs[b.segs.length - 1]?.[1] || 0) - (a.segs[a.segs.length - 1]?.[1] || 0));
    return res;
  }
  day(key) {
    return this.summary(key);
  }
  liveSessions({ since = 0, limit = 50 } = {}) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const fc of this.files.values()) {
      const v = fc.live;
      if (!v || !v.at || v.at < since) continue;
      const sid = fc.sid;
      if (seen.has(sid)) continue;
      const meta = this.meta.get(sid) || {};
      const live = cleanLive({ ...v }, Date.now());
      if (live.quiet && live.state === "run") live.state = "quiet";
      if (this.hidden(sid) && !["run", "running", "starting"].includes(live.state)) continue;
      seen.add(sid);
      if (meta.parentSid && !meta.parentTitle) {
        const pm = this.meta.get(meta.parentSid);
        if (pm) meta.parentTitle = pm.title || this.titles.get(pm.sid) || "";
      }
      out.push({ ...meta, ...live, sid, agent: fc.agent, cwd: v.cwd || fc.cwd, app: v.app || fc.app, title: v.title || meta.title || this.titles.get(sid) || "", model: v.model || meta.model || "", tokens: (meta.out || 0) + (meta.fresh || 0), lastAt: v.at });
    }
    return out.sort((a, b) => b.lastAt - a.lastAt).slice(0, limit);
  }
  sessions({ since = 0, limit = 100, agent = "" } = {}) {
    const out = [];
    for (const m of this.meta.values()) {
      if (!m.lastAt || m.lastAt < since) continue;
      if (agent && m.agent !== agent) continue;
      if (this.hidden(m.sid) && !["run", "running", "starting"].includes(m.state)) continue;
      if (m.parentSid && !m.parentTitle) {
        const pm = this.meta.get(m.parentSid);
        if (pm) m.parentTitle = pm.title || this.titles.get(pm.sid) || "";
      }
      out.push({ ...m, title: m.title || this.titles.get(m.sid) || "", tokens: (m.out || 0) + (m.fresh || 0) });
    }
    return out.sort((a, b) => b.lastAt - a.lastAt).slice(0, limit);
  }
};
function dayMinuteCfg(ms, cfg) {
  const cutoff = Number.isFinite(cfg.dayCutoff) ? cfg.dayCutoff : 8;
  const d = new Date(ms - cutoff * 36e5);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() + cutoff * 36e5;
  return Math.round((ms - start) / 6e4);
}
var UsageStore = class {
  constructor(plugin, cfg = {}) {
    this.plugin = plugin;
    this.cfg = cfg;
    this.days = {};
    this.dirty = false;
    this.saveTimer = null;
  }
  async load(file) {
    this.file = file;
    try {
      const raw = await fsp.readFile(file, "utf8");
      const d = JSON.parse(raw);
      this.days = d.days || {};
      this.imported = d.imported || {};
    } catch {
      this.days = {};
    }
  }
  merge(touched, usage) {
    let changed = false;
    for (const key of touched) {
      const s = usage.summary(key);
      if (s) {
        if (JSON.stringify(s) !== JSON.stringify(this.days[key])) {
          this.days[key] = s;
          changed = true;
        }
      } else if (this.days[key] && key >= dayKeyToday(this.cfg)) {
        delete this.days[key];
        changed = true;
      }
    }
    if (changed) this.queueSave();
    return changed;
  }
  queueSave() {
    this.dirty = true;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save().catch(() => {
    }), 800);
  }
  async save() {
    if (!this.file) return;
    this.dirty = false;
    const tmp = this.file + ".tmp";
    await fsp.writeFile(tmp, JSON.stringify({ version: 1, days: this.days, imported: this.imported || {}, savedAt: Date.now() }), "utf8");
    await fsp.rename(tmp, this.file);
  }
  get(key) {
    return this.days[key] || null;
  }
  range(n = 14, cfg = this.cfg) {
    const out = [];
    const now = Date.now();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now - i * 864e5);
      const key = dayKey(d.getTime(), cfg);
      const day = this.days[key] || null;
      out.push({ key, date: d, day, wall: day ? day.wall : 0, out: day ? day.out : 0, sessions: day ? day.sessions : 0, by: day ? day.by : {} });
    }
    return out;
  }
  prune(days = 120) {
    const cutoff = dayKey(Date.now() - days * 864e5, this.cfg);
    for (const k of Object.keys(this.days)) if (k < cutoff) delete this.days[k];
  }
  totals(days = 1) {
    var _a;
    const out = { wall: 0, out: 0, fresh: 0, cached: 0, sessions: 0, prompts: 0, calls: 0, by: {} };
    const now = Date.now();
    for (let i = 0; i < days; i++) {
      const key = dayKey(now - i * 864e5, this.cfg);
      const d = this.days[key];
      if (!d) continue;
      for (const k of ["wall", "out", "fresh", "cached", "sessions", "prompts", "calls"]) out[k] += d[k] || 0;
      for (const [a, v] of Object.entries(d.by || {})) {
        const g = (_a = out.by)[a] || (_a[a] = { wall: 0, out: 0, agent: 0, sessions: 0, segs: [] });
        g.wall += v.wall || 0;
        g.out += v.out || 0;
        g.agent += v.agent || 0;
        g.sessions += v.sessions || 0;
        g.segs.push(...v.segs || []);
      }
    }
    return out;
  }
};
function sqliteColumn(db, sql) {
  return new Promise((resolve) => {
    if (!import_fs.default.existsSync(db)) return resolve([]);
    (0, import_child_process.execFile)("/usr/bin/sqlite3", ["-noheader", db, sql], { timeout: 5e3, maxBuffer: 4 * 1024 * 1024 }, (err2, out) => {
      if (err2) return resolve([]);
      resolve(String(out || "").split("\n").map((s) => s.trim()).filter(Boolean));
    });
  });
}

// src/delegation.js
var import_fs2 = __toESM(require("fs"), 1);
var import_path2 = __toESM(require("path"), 1);
var import_os2 = __toESM(require("os"), 1);
var import_child_process2 = require("child_process");

// src/journal.js
var LIST_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
var STAMP_RE = /^\*\*(\d{1,2})[:：](\d{2})\*\*\s*/;
var CHECKBOX_RE = /^\[([ xX\/\-])\]\s*/;
var KEYWORD_RE = /^(TODOFORAI|TODO4AI|TODO2AI|TODOTOAI|TODO|DOING|LATER|NOW|PAUSED|TOREVIEW|HITLIMIT|NEEDOK|QUEUED|ERRORED|DELEGATED|WAITING|WAIT|SUSPENDED|IN-PROGRESS|DONE|CANCELED|CANCELLED|FAILED)\s*/;
var AGENT_KW_RE = /^(TOREVIEW|HITLIMIT|NEEDOK|QUEUED|ERRORED|DELEGATED)$/;
var OPEN_KWS = ["TODO", "LATER", "NOW", "WAITING", "WAIT", "TODOFORAI", "TODO4AI", "TODO2AI", "TODOTOAI"];
var DONE_KWS = ["DONE", "CANCELED", "CANCELLED", "FAILED"];
var RESULT_RE = /^\s*[-*+]\s+💬/;
var CLOCK_RE = /^\s*[-*+]\s+⏱/;
var KID_LINK_RE = /^\s*[-*+]\s+🔗\s*(子代理|side chat)\s*`(?:pid\s*)?([0-9a-z]+)`/;
var AUTO_MARK = "\u{1F916} ";
var pad2 = (n) => String(n).padStart(2, "0");
var DAY_OFFSET = 0;
var setDayOffset = (min) => {
  DAY_OFFSET = Number(min) || 0;
};
var dayOffset = () => DAY_OFFSET;
var clock = (t) => {
  const m = Math.round(t + DAY_OFFSET);
  return `${pad2(Math.floor((m % 1440 + 1440) % 1440 / 60))}:${pad2((m % 60 + 60) % 60)}`;
};
var durTag = (m) => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? m % 60 + "m" : ""}` : `${Math.max(1, Math.round(m))}m`;
var width = (line) => {
  let w = 0;
  for (const c of (/^\s*/.exec(line) || [""])[0]) w += c === "	" ? 4 : 1;
  return w;
};
var workKey = (label) => String(label || "").replace(/\s*←\s*\S+\s*$/, "").trim();
function splitTask(raw) {
  const m = /^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/.exec(raw);
  if (!m) return null;
  let [, prefix, rest] = m;
  const st = STAMP_RE.exec(rest);
  if (st) {
    prefix += st[0];
    rest = rest.slice(st[0].length);
  }
  const cb = CHECKBOX_RE.exec(rest);
  if (cb) rest = rest.slice(cb[0].length);
  const kw = KEYWORD_RE.exec(rest);
  if (kw) rest = rest.slice(kw[0].length);
  const pr = kw && /^\[#[ABC]\]\s*/.exec(rest);
  if (pr) rest = rest.slice(pr[0].length);
  let since = null;
  const t = kw && /^(\d{1,2})[:：](\d{2})(?![\d:：]|\s*[-–~～到至])\s*/.exec(rest);
  if (t) {
    since = `${pad2(+t[1])}:${t[2]}`;
    rest = rest.slice(t[0].length);
  }
  if (pr) rest = `${pr[0].trim()} ${rest}`;
  return { prefix, rest, since, kw: kw ? kw[1] : null, cb: cb ? cb[1] : null };
}
function kwLine(raw) {
  let s = raw.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/^\s+/, "").replace(STAMP_RE, "");
  let kw = "";
  const cb = CHECKBOX_RE.exec(s);
  if (cb) {
    kw = cb[1] === " " ? "TODO" : cb[1] === "/" ? "DOING" : cb[1] === "-" ? "CANCELLED" : "DONE";
    s = s.slice(cb[0].length);
  }
  const m = /^(TODOFORAI|TODO4AI|TODO2AI|TODOTOAI|TODO|DOING|LATER|NOW|PAUSED|TOREVIEW|HITLIMIT|NEEDOK|QUEUED|ERRORED|DELEGATED|WAITING|WAIT|SUSPENDED|IN-PROGRESS|DONE|CANCELED|CANCELLED|FAILED)(?=\s|$)\s*/.exec(s);
  if (m) {
    kw = m[1];
    s = s.slice(m[0].length);
  }
  s = s.replace(/^\[#[ABC]\]\s*/, "").replace(/^\d{1,2}[:：]\d{2}(?:\s*[-–~～]\s*\d{1,2}[:：]\d{2})?\s*/, "").replace(/^\[#[ABC]\]\s*/, "").trim();
  if (!s || s.startsWith("\u23F1") || s.startsWith("\u{1F517}") || s.startsWith("\u{1F4AC}") || /^🤖\s*(?:子代理|side chat)/.test(s)) return null;
  return { kw, body: s };
}
function parseLink(line) {
  const m = /^\s*[-*+]\s+🔗\s*(?:\[([^\]]+)\])?\(?(claude|codex|workbuddy|dsh):\/\/[^)]*?session=([0-9a-f-]{36})/.exec(line);
  if (m) return { agent: m[2], sid: m[3], title: m[1] || "" };
  const d = /^\s*[-*+]\s+🔗\s*(?:\[([^\]]+)\])?\(?(codex):\/\/threads\/([0-9a-f-]{36})|^\s*[-*+]\s+🔗\s*(?:\[([^\]]+)\])?\(?(workbuddy):\/\/chat\/([0-9A-Za-z_-]{8,})/.exec(line);
  if (d) return d[2] ? { agent: "codex", sid: d[3], title: d[1] || "" } : { agent: "workbuddy", sid: decodeURIComponent(d[6]), title: d[4] || "" };
  const b = /^\s*[-*+]\s+🔗.*`((?:session-)?[0-9a-f-]{36})`/.exec(line);
  if (!b) return null;
  const agent = /DeepSeek Harness|dsh:\/\//.test(line) ? "dsh" : /Codex[：:]/.test(line) ? "codex" : /WorkBuddy[：:]/.test(line) ? "workbuddy" : "claude";
  return { agent, sid: b[1], title: "" };
}
function linkLine(indent, agent, title, sid) {
  const safe = String(title || "").replace(/[\[\]()`]+/g, " ").trim();
  if (agent === "claude") return `${indent}- \u{1F517} [Claude\uFF1A${safe}](claude://resume?session=${sid})`;
  if (agent === "dsh") return `${indent}- \u{1F517} [DeepSeek Harness\uFF1A${safe}](dsh://open) \`${sid}\``;
  if (agent === "codex") return `${indent}- \u{1F517} [Codex\uFF1A${safe}](codex://threads/${sid})`;
  if (agent === "workbuddy") return `${indent}- \u{1F517} [WorkBuddy\uFF1A${safe}](workbuddy://chat/${encodeURIComponent(sid)})`;
  return `${indent}- \u{1F517} ${agent}\uFF1A${safe} \`${sid}\``;
}
function markOwner(lines, i) {
  const ind = width(lines[i]);
  for (let j = i - 1; j >= 0; j--) if (lines[j].trim() && LIST_RE.test(lines[j]) && width(lines[j]) < ind) return j;
  return -1;
}
function childMark(lines, n, pick) {
  const base = width(lines[n]);
  for (let i = n + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (width(lines[i]) <= base) break;
    const l = pick(lines[i]);
    if (l) return { line: i, ...l };
  }
  return null;
}
var linkUnder = (lines, n) => childMark(lines, n, parseLink);
var resultUnder = (lines, n) => childMark(lines, n, (l) => RESULT_RE.test(l) ? {} : null);
function resultText(raw, max = 200) {
  let t = String(raw || "").replace(/```[\s\S]*?(?:```|$)/g, " ").replace(/^\s{0,3}#{1,6}\s+/gm, "").replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "").replace(/^\s*>\s?/gm, "").replace(/^\s*\|?[\s:|-]{3,}\|?\s*$/gm, " ").replace(/\d{12,}/g, "\u2026").replace(/\s+/g, " ").trim();
  const cap = Math.max(40, +max || 200);
  if ([...t].length > cap) {
    const cut = [...t].slice(0, cap).join("");
    const stop = Math.max(...["\u3002", "\uFF01", "\uFF1F", "\uFF1B", ". ", "! ", "? "].map((c) => cut.lastIndexOf(c)));
    t = (stop > cap * 0.5 ? cut.slice(0, stop + 1) : cut).trim() + "\u2026";
  }
  return t.replace(/\[\[/g, "\\[\\[").replace(/(^|[^\w&\\])#(?=[^\s#])/g, "$1\\#").replace(/==/g, "\\=\\=").replace(/%%/g, "\\%\\%").replace(/\$/g, "\\$").replace(/</g, "\\<").replace(/\s\^(?=[A-Za-z0-9-]+$)/, " \\^");
}
function resultInto(text, sid, said) {
  if (!said || !text.includes(sid)) return text;
  const lines = text.split("\n");
  const at = lines.findIndex((l) => {
    const k = parseLink(l);
    return k && k.sid === sid;
  });
  const n = at < 0 ? -1 : markOwner(lines, at);
  if (n < 0) return text;
  const line = `${/^\s*/.exec(lines[at])[0]}- \u{1F4AC} ${said}`;
  const had = resultUnder(lines, n);
  if (had) {
    if (lines[had.line] === line) return text;
    lines[had.line] = line;
  } else lines.splice(at + 1, 0, line);
  return lines.join("\n");
}
function diffLines(before, after) {
  const a = before.split("\n"), b = after.split("\n");
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) {
    ea--;
    eb--;
  }
  if (s === ea && s === eb) return null;
  const mid = b.slice(s, eb);
  if (ea < a.length) return { from: { line: s, ch: 0 }, to: { line: ea, ch: 0 }, text: mid.map((l) => l + "\n").join("") };
  const end = { line: a.length - 1, ch: a[a.length - 1].length };
  if (s > 0) return { from: { line: s - 1, ch: a[s - 1].length }, to: end, text: mid.map((l) => "\n" + l).join("") };
  return { from: { line: 0, ch: 0 }, to: end, text: mid.join("\n") };
}
function taskItems(text) {
  const out = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!LIST_RE.test(lines[i])) continue;
    const k = kwLine(lines[i]);
    if (!k) continue;
    const st = DONE_KWS.includes(k.kw) ? "done" : /^(DOING|NOW|IN-PROGRESS)$/.test(k.kw) || AGENT_KW_RE.test(k.kw) ? "doing" : /^(PAUSED|SUSPENDED|WAITING|WAIT)$/.test(k.kw) ? "paused" : "open";
    out.push({ line: i, kw: k.kw, body: k.body, key: workKey(k.body), indent: width(lines[i]), state: st });
  }
  return out;
}
function findTask(text, key) {
  const hits = taskItems(text).filter((i) => i.key === key);
  return hits.find((i) => i.state === "open") || hits[0] || null;
}
function openTasks(text) {
  return taskItems(text).filter((i) => i.state !== "done").map((i) => ({
    label: i.body,
    doing: i.state === "doing",
    paused: i.kw === "PAUSED" || i.kw === "SUSPENDED",
    line: i.line
  }));
}
function linkMap(text) {
  const out = /* @__PURE__ */ new Map();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = parseLink(lines[i]);
    if (!l) continue;
    const n = markOwner(lines, i);
    const k = n >= 0 ? kwLine(lines[n]) : null;
    if (k) out.set(l.sid, workKey(k.body));
  }
  return out;
}
function parseKid(line) {
  const m = KID_LINK_RE.exec(line);
  return m ? { kind: m[1] === "\u5B50\u4EE3\u7406" ? "sub" : "side", id: m[2] } : null;
}
function kidUnder(lines, n) {
  return childMark(lines, n, parseKid);
}
function kidIdent(line) {
  const c = parseKid(line);
  if (c) return { ...c, open: true };
  const m = /^\s*[-*+]\s+⏱.*·\s*(子代理|side chat)\s*`(?:pid\s*)?([0-9a-z]+)`\s*$/.exec(line);
  return m ? { kind: m[1] === "\u5B50\u4EE3\u7406" ? "sub" : "side", id: m[2], open: false } : null;
}
var kidNorm = (s) => String(s || "").replace(/🤖/g, "").replace(/^\s*(?:\d+[.)、]\s*)?(?:(?:TODO|DOING|LATER|NOW|WAITING|WAIT|PAUSED|TOREVIEW|HITLIMIT|NEEDOK|QUEUED|ERRORED|DELEGATED)\s+)?(?:\d{1,2}[:：]\d{2}\s*)?/, "").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
function kidMatch(body, desc) {
  const a = kidNorm(body), d = kidNorm(desc);
  if (a.length < 4 || d.length < 4) return false;
  return a.startsWith(d) || d.startsWith(a) || a.length >= 8 && d.length >= 8 && a.slice(0, 8) === d.slice(0, 8);
}
var EMPTY_ITEM_RE = /^(\s*(?:[-*+]|\d+[.)]))\s*$/;
var MARKER_RE = /^\s*[-*+]\s+(?:🔗|⏱|💬)/;
function kwForState(state) {
  return { run: "DOING", running: "DOING", starting: "DOING", wait: "TOREVIEW", quiet: "TOREVIEW", idle: "TOREVIEW", "needs-approval": "NEEDOK", error: "ERRORED", limit: "HITLIMIT", queued: "QUEUED" }[state] || "DOING";
}
function dropKind(lines, at, below = false) {
  if (at < 0 || at >= lines.length) return null;
  const raw = lines[at];
  if (below) {
    if (/^\s*(?:#|```|~~~|\|)/.test(raw)) return null;
    const n = MARKER_RE.test(raw) ? markOwner(lines, at) : at;
    if (n < 0) return null;
    if (!raw.trim()) return { kind: "new", line: at };
    return { kind: "after", line: n };
  }
  if (MARKER_RE.test(raw)) {
    const n = markOwner(lines, at);
    return n >= 0 ? { kind: "bind", line: n } : null;
  }
  if (EMPTY_ITEM_RE.test(raw)) return { kind: "fill", line: at };
  if (!raw.trim()) return { kind: "new", line: at };
  if (LIST_RE.test(raw)) return kwLine(raw) ? { kind: "bind", line: at } : null;
  if (/^\s*(?:#|```|~~~|\||>|---)/.test(raw)) return null;
  return { kind: "below", line: at };
}
function childIndent(lines, n) {
  const base = width(lines[n]);
  for (let i = n + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (width(lines[i]) > base) return (/^\s*/.exec(lines[i]) || [""])[0];
    break;
  }
  const lead = (/^\s*/.exec(lines[n]) || [""])[0];
  return lead + (lead && !lead.includes("	") ? "    " : "	");
}
function bindInto(text, at, s, { below = false } = {}) {
  let lines = text.split("\n");
  const target = dropKind(lines, at, below);
  if (!target) return { text, error: "\u8FD9\u4E00\u884C\u653E\u4E0D\u4E86\u4F1A\u8BDD\uFF1A\u62D6\u5230\u5217\u8868\u9879\u3001\u7A7A\u7684\u5217\u8868\u9879\u6216\u7A7A\u884C\u4E0A" };
  let n = target.line;
  if (target.kind === "bind") {
    const had = linkUnder(lines, n);
    if (had && had.sid === s.sid) return { text, error: "\u8FD9\u4E00\u9879\u5DF2\u7ECF\u7ED1\u7740\u8FD9\u4E2A\u4F1A\u8BDD\u4E86" };
    if (had) return { text, error: "\u8FD9\u4E00\u9879\u5DF2\u7ECF\u7ED1\u7740\u53E6\u4E00\u4E2A\u4F1A\u8BDD\uFF1B\u5148\u5220\u6389\u5B83\u4E0B\u9762\u7684 \u{1F517} \u884C" };
  }
  const want = kwForState(s.state);
  const since = s.since || "";
  const title = resultText(s.title || "\u6CA1\u8D77\u540D\u7684\u4F1A\u8BDD", 60);
  const anchor = lines[n];
  const drop = (i) => {
    lines.splice(i, 1);
    if (i < n) n--;
  };
  for (let i = lines.length - 1; i >= 0; i--) {
    const k = parseLink(lines[i]);
    if (k && k.sid === s.sid) drop(i);
  }
  if (s.dropKey) {
    const hit = taskItems(lines.join("\n")).find((t) => t.key === s.dropKey && t.body.startsWith(AUTO_MARK.trim()) && t.line !== n);
    if (hit) {
      const base = width(lines[hit.line]);
      let end = hit.line, own = true;
      for (let i = hit.line + 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        if (width(lines[i]) <= base) break;
        if (!MARKER_RE.test(lines[i])) own = false;
        end = i;
      }
      if (own) for (let i = end; i >= hit.line; i--) drop(i);
    }
  }
  if (lines[n] !== anchor) {
    const back = lines.indexOf(anchor);
    if (back < 0) return { text, error: "\u7B14\u8BB0\u5728\u62D6\u7684\u65F6\u5019\u53D8\u4E86\uFF0C\u518D\u62D6\u4E00\u6B21" };
    n = back;
  }
  if (target.kind === "bind") {
    const p = splitTask(lines[n]);
    if (p && !p.cb && (!p.kw || OPEN_KWS.includes(p.kw) || p.kw === "DOING" || AGENT_KW_RE.test(p.kw))) {
      lines[n] = `${p.prefix}${want} ${p.since || since} ${p.rest}`.replace(/ {2,}/g, " ").trimEnd();
    }
    lines.splice(n + 1, 0, linkLine(childIndent(lines, n), s.agent, title, s.sid));
    return { text: lines.join("\n"), line: n, kind: "bind" };
  }
  let prefix;
  if (target.kind === "after") {
    const base = width(lines[n]);
    let end = n;
    for (let i = n + 1; i < lines.length; i++) {
      if (!lines[i].trim()) {
        const j = lines.findIndex((l, k) => k > i && l.trim());
        if (j > 0 && width(lines[j]) > base) continue;
        break;
      }
      if (width(lines[i]) <= base) break;
      end = i;
    }
    const pm = /^(\s*)([-*+]|(\d+)([.)]))\s+/.exec(lines[n]);
    prefix = !pm ? "- " : pm[3] ? `${pm[1]}${+pm[3] + 1}${pm[4]} ` : `${pm[1]}${pm[2]} `;
    const item2 = `${prefix}${want} ${since ? since + " " : ""}${AUTO_MARK}${title}`.replace(/ {2,}/g, " ");
    const lead2 = (/^\s*/.exec(item2) || [""])[0];
    lines.splice(end + 1, 0, item2, linkLine(lead2 + (lead2 && !lead2.includes("	") ? "    " : "	"), s.agent, title, s.sid));
    return { text: lines.join("\n"), line: end + 1, kind: "after" };
  }
  if (target.kind === "fill") prefix = EMPTY_ITEM_RE.exec(lines[n])[1] + " ";
  else {
    let prev = -1;
    for (let i = target.kind === "below" ? n : n - 1; i >= 0; i--) {
      if (lines[i].trim()) {
        prev = i;
        break;
      }
    }
    const pm = prev >= 0 ? /^(\s*)([-*+]|(\d+)([.)]))\s+/.exec(lines[prev]) : null;
    prefix = !pm || MARKER_RE.test(lines[prev]) ? pm ? (/^\s*/.exec(lines[markOwner(lines, prev)] || "") || [""])[0] + "- " : "- " : pm[3] ? `${pm[1]}${+pm[3] + 1}${pm[4]} ` : `${pm[1]}${pm[2]} `;
  }
  const item = `${prefix}${want} ${since ? since + " " : ""}${AUTO_MARK}${title}`.replace(/ {2,}/g, " ");
  if (target.kind === "below") {
    lines.splice(n + 1, 0, item);
    n = n + 1;
  } else if (target.kind === "new" && lines[n + 1] && lines[n + 1].trim() && !LIST_RE.test(lines[n + 1])) lines.splice(n, 0, item);
  else lines[n] = item;
  const lead = (/^\s*/.exec(item) || [""])[0];
  lines.splice(n + 1, 0, linkLine(lead + (lead && !lead.includes("	") ? "    " : "	"), s.agent, title, s.sid));
  return { text: lines.join("\n"), line: n, kind: target.kind };
}

// src/delegation.js
var fsp2 = import_fs2.default.promises;
var home2 = () => import_os2.default.homedir();
var norm2 = (p) => String(p || "").replace(/^~(?=\/)/, home2());
var BULLET_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
var LINK_RE = /^\s*[-*+]\s+🔗/;
var RESULT_RE2 = /^\s*[-*+]\s+💬/;
var STATUS_RE = /^(\s*(?:[-*+]|\d+[.)])\s+(?:\*\*\d{1,2}[:：]\d{2}\*\*\s*)?)(TODOFORAI|TODO4AI|TODO2AI|TODOTOAI|TODO|DOING|LATER|NOW|PAUSED|TOREVIEW|HITLIMIT|NEEDOK|QUEUED|ERRORED|DELEGATED|WAITING|WAIT|IN-PROGRESS|SUSPENDED|CANCELED|CANCELLED|FAILED|DONE)(?=\s|$)/i;
function blockAt(lines, at) {
  if (at < 0 || at >= lines.length) return null;
  const m = BULLET_RE.exec(lines[at]);
  if (!m) return null;
  const indent = m[1].length;
  let end = at;
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      end = i;
      continue;
    }
    const indentHere = (line.match(/^[ \t]*/) || [""])[0].length;
    if (indentHere <= indent) break;
    end = i;
  }
  return { start: at, end, indent, text: lines.slice(at, end + 1).join("\n") };
}
function blockTitle(block) {
  if (!block) return "";
  const first = block.text.split("\n")[0] || "";
  return first.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/^\s*(?:\*\*\d{1,2}[:：]\d{2}\*\*\s*)?/, "").replace(/^(TODOFORAI|TODO4AI|TODO2AI|TODOTOAI|TODO|DOING|LATER|NOW|PAUSED|TOREVIEW|HITLIMIT|NEEDOK|QUEUED|ERRORED|DELEGATED|WAITING|WAIT|IN-PROGRESS|SUSPENDED|CANCELED|CANCELLED|FAILED|DONE)\s+/i, "").replace(/[#*_`>[\]]/g, "").trim();
}
function hasLink(lines, block) {
  for (let i = block.start + 1; i <= block.end; i++) if (LINK_RE.test(lines[i])) return i;
  return -1;
}
function findLink(lines, block) {
  const at = hasLink(lines, block);
  if (at < 0) return null;
  const m = /claude:\/\/resume\?session=([0-9a-f-]{20,})/i.exec(lines[at]);
  const wb = /workbuddy:\/\/chat\/([^\s)\]]+)/i.exec(lines[at]);
  const cx = /codex:\/\/threads\/([0-9a-f-]{36})/i.exec(lines[at]);
  const back = /`([0-9a-f-]{16,}|session-[0-9a-f-]{20,})`/i.exec(lines[at]);
  return { line: at, sid: m && m[1] || cx && cx[1] || wb && decodeURIComponent(wb[1]) || back && back[1] || "", raw: lines[at] };
}
function markDelegated(line) {
  const m = /^(\s*(?:[-*+]|\d+[.)])\s+(?:\*\*\d{1,2}[:：]\d{2}\*\*\s*)?)(.*)$/.exec(line || "");
  if (!m) return `DELEGATED ${line || ""}`;
  const rest = m[2];
  const s = STATUS_RE.exec(line);
  if (s) return line.replace(s[2], "DELEGATED");
  return `${m[1]}DELEGATED ${rest}`;
}
function linkLine2(indent, agent, name, sid) {
  return linkLine(indent, agent, String(name || "").slice(0, 48), sid);
}
function findDshBinary() {
  const candidates = [
    "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh",
    import_path2.default.join(home2(), "Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"),
    import_path2.default.join(home2(), ".local/bin/dsh"),
    "/opt/homebrew/bin/dsh",
    "/usr/local/bin/dsh"
  ];
  for (const p of candidates) {
    try {
      if (import_fs2.default.existsSync(p)) return p;
    } catch {
    }
  }
  return "dsh";
}
function findClaudeBinary(configured = "") {
  if (configured && configured.trim()) return norm2(configured.trim());
  const candidates = [import_path2.default.join(home2(), ".local/bin/claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude", "/usr/bin/claude"];
  for (const p of candidates) {
    try {
      if (import_fs2.default.existsSync(p)) return p;
    } catch {
    }
  }
  return "claude";
}
async function findTrustedDir(vaultPath) {
  const h = home2();
  try {
    const cfg = JSON.parse(await fsp2.readFile(import_path2.default.join(h, ".claude.json"), "utf8"));
    const projects = cfg.projects || {};
    const isDir = (p) => {
      try {
        return import_fs2.default.statSync(p).isDirectory();
      } catch {
        return false;
      }
    };
    if (projects[vaultPath] && projects[vaultPath].hasTrustDialogAccepted) return vaultPath;
    const trusted = Object.keys(projects).filter((p) => projects[p] && projects[p].hasTrustDialogAccepted && isDir(p));
    const notAncestor = trusted.filter((p) => p !== vaultPath && !String(vaultPath).startsWith(p.replace(/\/+$/, "") + "/"));
    notAncestor.sort((a, b) => a.length - b.length);
    if (notAncestor.length) return notAncestor[0];
    trusted.sort((a, b) => a.length - b.length);
    return trusted[0] || vaultPath;
  } catch {
    return vaultPath;
  }
}
function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  const parts = new Set(String(env.PATH || "").split(":").filter(Boolean));
  for (const p of [import_path2.default.join(home2(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]) parts.add(p);
  env.PATH = [...parts].join(":");
  return env;
}
function openExternal(url) {
  try {
    const { shell } = require("electron");
    if (shell && typeof shell.openExternal === "function") {
      shell.openExternal(url);
      return true;
    }
  } catch {
  }
  try {
    (0, import_child_process2.execFile)("/usr/bin/open", [url], () => {
    });
    return true;
  } catch {
    return false;
  }
}
function openTerminal(command, cwd = "", which = "auto") {
  const dir = cwd && import_fs2.default.existsSync(cwd) ? cwd : home2();
  const warp = ["/Applications/Warp.app", import_path2.default.join(home2(), "Applications/Warp.app")].some((p) => import_fs2.default.existsSync(p));
  if (which === "auto" && warp || which === "warp") {
    try {
      const d = import_path2.default.join(home2(), ".warp/launch_configurations");
      import_fs2.default.mkdirSync(d, { recursive: true });
      const q = (s) => JSON.stringify(String(s));
      import_fs2.default.writeFileSync(import_path2.default.join(d, "agent-deck-resume.yaml"), [
        "---",
        "name: agent-deck-resume",
        "windows:",
        "  - tabs:",
        "      - title: Claude",
        "        layout:",
        `          cwd: ${q(dir)}`,
        "          commands:",
        `            - exec: ${q(command)}`,
        ""
      ].join("\n"));
      return openExternal("warp://launch/agent-deck-resume");
    } catch {
    }
  }
  try {
    const script = `tell application "Terminal"
activate
do script ${JSON.stringify(`cd ${JSON.stringify(dir)} && ${command}`)}
end tell`;
    (0, import_child_process2.execFile)("/usr/bin/osascript", ["-e", script], () => {
    });
    return true;
  } catch {
    return false;
  }
}
var isCodexDesktop = (app) => /desktop|vscode|app|ide/i.test(String(app || "")) && !/exec|cli/i.test(String(app || ""));
function isCliSession(agent, app) {
  if (agent === "claude") return app === "cli";
  if (agent === "codex") return !isCodexDesktop(app);
  return false;
}
function sessionDeepLink(agent, sid) {
  if (!sid) return "";
  if (agent === "claude") return `claude://resume?session=${sid}`;
  if (agent === "workbuddy") return `workbuddy://chat/${encodeURIComponent(sid)}`;
  if (agent === "dsh") return "dsh://open";
  if (agent === "codex") return `codex://threads/${sid}`;
  return "";
}
var AGENT_APPS = {
  claude: { bundle: "com.anthropic.claudefordesktop", url: "claude://" },
  codex: { bundle: "com.openai.codex", url: "codex://launch" },
  workbuddy: { bundle: "com.tencent.workbuddy.mac", url: "workbuddy://home" },
  dsh: { bundle: "com.deepseek.dsh", url: "dsh://open" }
};
function openAgentApp(agent) {
  const app = AGENT_APPS[agent];
  if (!app) return Promise.resolve(false);
  return new Promise((resolve) => {
    (0, import_child_process2.execFile)("/usr/bin/open", ["-b", app.bundle], (err2) => {
      if (!err2) return resolve(true);
      resolve(openExternal(app.url));
    });
  });
}
function copyText(text) {
  try {
    require("electron").clipboard.writeText(text);
    return true;
  } catch {
  }
  try {
    navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
function openSession(plugin, agent, sid, app = "", session = null) {
  if (!sid) {
    plugin.notice("\u8FD9\u4E2A\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u4F1A\u8BDD\u53F7\uFF0C\u7A0D\u7B49\u4E00\u79D2\u518D\u70B9");
    return false;
  }
  if (agent === "claude") {
    if (app === "cli" && plugin.settings.cliOpen !== "desktop") {
      const cwd = session && session.cwd || (plugin.usage && plugin.usage.meta.get(sid) || {}).cwd || "";
      return openTerminal(`claude --resume ${sid}`, cwd, plugin.settings.cliTerminal || "auto");
    }
    openExternal(`claude://resume?session=${sid}`);
    return true;
  }
  if (agent === "workbuddy") {
    openExternal(`workbuddy://chat/${encodeURIComponent(sid)}`);
    return true;
  }
  if (agent === "codex") {
    const meta = session || plugin.usage && plugin.usage.meta.get(sid) || {};
    if (!isCodexDesktop(app || meta.app) && plugin.settings.cliOpen !== "desktop") {
      return openTerminal(`codex resume ${sid}`, meta.cwd || "", plugin.settings.cliTerminal || "auto");
    }
    openExternal(`codex://threads/${sid}`);
    copyText(`codex resume ${sid}`);
    return true;
  }
  if (agent === "dsh") {
    openExternal("dsh://open");
    try {
      navigator.clipboard.writeText(sid);
    } catch {
    }
    plugin.notice(`\u5DF2\u6253\u5F00 DeepSeek Harness\uFF1B\u4F1A\u8BDD\u53F7\u5DF2\u590D\u5236\uFF08${sid.slice(0, 8)}\u2026\uFF09`);
    return true;
  }
  return false;
}
var ClaudeRunner = class {
  constructor(delegator, job) {
    this.d = delegator;
    this.job = job;
    this.child = null;
    this.short = "";
    this.pollTimer = null;
    this.finished = false;
  }
  async start(opts) {
    const d = this.d;
    const cfg = d.settings.delegate.claude;
    const bin = findClaudeBinary(cfg.path || "");
    const name = opts.name || "Agent Deck task";
    let cwd = norm2(opts.cwd || cfg.cwd || d.vaultPath);
    if (cfg.autoTrustedCwd !== false && !opts.cwd && !cfg.cwd) {
      const trusted = await findTrustedDir(d.vaultPath);
      if (trusted && trusted !== cwd) {
        cwd = trusted;
        this.job.cwd = cwd;
        if (!d._trustNoticeAt || Date.now() - d._trustNoticeAt > 10 * 6e4) {
          d._trustNoticeAt = Date.now();
          d.notice(`Claude Code \u6CA1\u6709\u4FE1\u4EFB\u5E93\u76EE\u5F55\uFF0C\u6539\u5728 ${cwd} \u91CC\u8DD1\uFF1B\u5E93\u5DF2\u7ECF\u7528 --add-dir \u52A0\u8FDB\u53BB\u4E86\u3002`);
        }
      }
    }
    const model = opts.model || cfg.model || "claude-sonnet-5";
    const modelCli = model.startsWith("claude-") ? model === "claude-opus-5" ? "opus" : model === "claude-sonnet-5" ? "sonnet" : model === "claude-haiku-5-5" ? "haiku" : model === "claude-fable" ? "fable" : model : model;
    const effort = opts.effort || cfg.effort || "high";
    const permission = opts.permission || cfg.permission || "auto";
    const addVault = cfg.addVault !== false && d.vaultPath && d.vaultPath !== cwd;
    const common = ["--model", modelCli, "--effort", effort, "--permission-mode", permission, "-n", name];
    if (addVault) common.push("--add-dir", d.vaultPath);
    if (cfg.extraArgs && cfg.extraArgs.trim()) common.push(...splitArgs(cfg.extraArgs));
    const prompt = opts.prompt;
    if (cfg.useBackground === true) {
      const args = ["--bg", ...common, "--", prompt];
      this.job.command = `${bin} ${args.slice(0, -2).join(" ")} \u2026`;
      const res = await spawnCapture(bin, args, { cwd, env: cleanEnv(), timeout: 3e4 });
      if (res.ok) {
        const m = /backgrounded\s*·\s*([0-9a-f]{6,})/i.exec(res.out || "");
        if (m) {
          this.short = m[1];
          this.job.short = this.short;
          this.job.state = "running";
          this.job.startedAt = Date.now();
          this.opts = opts;
          this.watchStart = Date.now();
          this.d.saveJobs();
          this.watchAgents();
          return true;
        }
      }
    }
    return this.startHeadless({ cwd, common, prompt, bin });
  }
  startHeadless({ cwd, common, prompt, bin }) {
    const sid = require("crypto").randomUUID();
    const args2 = ["-p", "--session-id", sid, ...common, "--", prompt];
    this.job.command = `${bin} ${args2.slice(0, -2).join(" ")} \u2026`;
    const child = (0, import_child_process2.spawn)(bin, args2, { cwd, env: cleanEnv(), stdio: ["ignore", "pipe", "pipe"] });
    this.child = child;
    this.fallbackStarted = true;
    this.job.sessionId = sid;
    this.job.state = "running";
    this.job.startedAt = Date.now();
    this.job.short = "";
    this.job.agentState = "headless";
    let err2 = "";
    child.stdout.on("data", (b) => {
      const s = b.toString();
      this.job.lastText = s.slice(-2e3);
    });
    child.stderr.on("data", (b) => {
      err2 += b.toString();
      if (err2.length > 4e3) err2 = err2.slice(-4e3);
      this.job.stderr = err2.slice(-1e3);
    });
    child.on("error", (e) => this.fail(String(e && e.message || e)));
    child.on("exit", (code) => {
      if (this.finished) return;
      if (code === 0) this.done();
      else this.fail(err2.trim() || `claude \u9000\u51FA\u7801 ${code}`);
    });
    this.d.saveJobs();
    this.d.onSession(this.job, sid);
    this.d.notice?.("Claude \u540E\u53F0\u670D\u52A1\u6CA1\u8D77\u6765\uFF0C\u5DF2\u6539\u7528\u65E0\u5934\u4F1A\u8BDD\uFF08\u7B54\u5B8C\u53EF\u4EE5\u70B9\u4EFB\u52A1\u884C\u6253\u5F00\uFF09");
    return true;
  }
  async watchAgents() {
    if (this.finished) return;
    const bin = findClaudeBinary(this.d.settings.delegate.claude.path || "");
    const res = await execCapture(bin, ["agents", "--json"], { cwd: this.d.vaultPath, env: cleanEnv(), timeout: 1e4 });
    let found = false;
    if (res.ok) {
      try {
        const list = JSON.parse(res.out || "[]");
        const row = list.find((x) => x.id === this.short || x.kind === "background" && String(x.name || "") === this.job.name);
        if (row && row.sessionId) {
          found = true;
          this.job.sessionId = row.sessionId;
          this.job.status = row.status;
          this.job.agentState = row.state || row.status;
          if (!this.job.linkWritten) this.d.onSession(this.job, row.sessionId);
          if (row.status === "idle" || row.status === "done" || row.status === "stopped") {
            this.settleStarted = this.settleStarted || Date.now();
            if (Date.now() - this.settleStarted > 5e3) return this.done();
          } else this.settleStarted = 0;
        }
      } catch {
      }
    }
    if (!found && this.job.short && this.watchStart && Date.now() - this.watchStart > 8e3 && !this.fallbackStarted) {
      this.fallbackStarted = true;
      return this.startHeadless({ cwd: this.job.cwd || this.d.vaultPath, common: this.commonArgs(), prompt: this.job.prompt, bin });
    }
    this.pollTimer = setTimeout(() => this.watchAgents(), 1800);
  }
  commonArgs() {
    const cfg = this.d.settings.delegate.claude;
    const model = this.job.model || cfg.model || "claude-sonnet-5";
    const modelCli = model.startsWith("claude-") ? model === "claude-opus-5" ? "opus" : model === "claude-sonnet-5" ? "sonnet" : model === "claude-haiku-5-5" ? "haiku" : model === "claude-fable" ? "fable" : model : model;
    const addVault = cfg.addVault !== false && this.d.vaultPath && this.d.vaultPath !== (this.job.cwd || cfg.cwd);
    const out = ["--model", modelCli, "--effort", this.job.effort || cfg.effort || "high", "--permission-mode", this.job.permission || cfg.permission || "auto", "-n", this.job.name];
    if (addVault) out.push("--add-dir", this.d.vaultPath);
    return out;
  }
  cancel() {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.pollTimer);
    if (this.short) {
      const bin = findClaudeBinary(this.d.settings.delegate.claude.path || "");
      (0, import_child_process2.execFile)(bin, ["stop", this.short], { env: cleanEnv() }, () => {
      });
    }
    if (this.child) {
      try {
        this.child.kill("SIGTERM");
      } catch {
      }
    }
    this.job.state = "cancelled";
    this.job.endedAt = Date.now();
    this.d.saveJobs();
  }
  done() {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.pollTimer);
    this.job.state = "done";
    this.job.endedAt = Date.now();
    this.d.saveJobs();
    this.d.onDone(this.job);
  }
  fail(message) {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.pollTimer);
    this.job.state = "error";
    this.job.error = String(message || "").slice(0, 500);
    this.job.endedAt = Date.now();
    this.d.saveJobs();
    this.d.onError(this.job);
  }
};
var DshRunner = class {
  constructor(delegator, job) {
    this.d = delegator;
    this.job = job;
    this.child = null;
    this.buf = "";
    this.nextId = 1;
    this.pending = /* @__PURE__ */ new Map();
    this.finished = false;
    this.assistantText = "";
    this.lastStep = "";
    this.sessionId = "";
    this.timer = null;
  }
  async start(opts) {
    const d = this.d;
    const cfg = d.settings.delegate.dsh;
    const bin = findDshBinary();
    const cwd = norm2(opts.cwd || cfg.cwd || d.vaultPath);
    const model = opts.model || cfg.model || "deepseek-v4-pro";
    const effort = opts.effort || cfg.effort || "high";
    this.job.command = `${bin} acp`;
    const child = (0, import_child_process2.spawn)(bin, ["acp"], { cwd, env: cleanEnv(), stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    this.job.state = "running";
    this.job.startedAt = Date.now();
    let err2 = "";
    child.stdout.on("data", (b) => this.onData(b.toString()));
    child.stderr.on("data", (b) => {
      err2 += b.toString();
      if (err2.length > 4e3) err2 = err2.slice(-4e3);
      this.job.stderr = err2.slice(-1e3);
    });
    child.on("error", (e) => this.fail(String(e && e.message || e)));
    child.on("exit", (code) => {
      if (this.finished) return;
      if (code !== 0) this.fail(err2.trim() || `dsh acp \u9000\u51FA\u7801 ${code}`);
    });
    try {
      const init = await this.request("initialize", { protocolVersion: 1, clientCapabilities: {} }, 3e4);
      const made = await this.request("session/new", { cwd, mcpServers: [] }, 6e4);
      this.sessionId = made && (made.sessionId || made.session_id);
      if (!this.sessionId) throw new Error("DeepSeek Harness \u6CA1\u6709\u8FD4\u56DE\u4F1A\u8BDD\u53F7");
      this.job.sessionId = this.sessionId;
      this.job.state = "running";
      this.d.saveJobs();
      this.d.onSession(this.job, this.sessionId);
      const options = (made.configOptions || []).map((x) => x.id);
      if (options.includes("model")) {
        const custom = this.d.plugin && this.d.plugin.modelById ? this.d.plugin.modelById(model) : null;
        const m = custom && custom.value ? { value: custom.value } : resolveDshModel(model);
        if (m) {
          try {
            await this.request("session/set_config_option", { sessionId: this.sessionId, configId: "model", value: m.value }, 15e3);
          } catch {
          }
        }
      }
      if (options.includes("reasoning_effort")) {
        const e = dshEffort(effort);
        if (e) {
          try {
            await this.request("session/set_config_option", { sessionId: this.sessionId, configId: "reasoning_effort", value: e }, 15e3);
          } catch {
          }
        }
      }
      this.timer = setTimeout(() => this.fail("\u59D4\u6D3E\u8D85\u8FC7 30 \u5206\u949F\u6CA1\u6709\u7ED3\u675F"), 30 * 6e4);
      this.request("session/prompt", { sessionId: this.sessionId, prompt: [{ type: "text", text: opts.prompt }] }, 31 * 6e4).then((r) => this.done(r)).catch((e) => this.fail(e && e.message || String(e)));
    } catch (e) {
      this.fail(e && e.message || String(e));
    }
    return true;
  }
  onData(text) {
    this.buf += text;
    let at;
    while ((at = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, at).trim();
      this.buf = this.buf.slice(at + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      this.onMessage(msg);
    }
  }
  onMessage(msg) {
    if (msg.id != null && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else p.resolve(msg.result);
      return;
    }
    const method = msg.method;
    if (!method) return;
    const params = msg.params || {};
    if (method === "session/update") {
      const u = params.update || {};
      const kind = u.sessionUpdate;
      if (kind === "agent_message_chunk") {
        const t = u.content && u.content.text;
        if (t) {
          this.assistantText += t;
          this.job.lastText = this.assistantText.slice(-2e3);
        }
      } else if (kind === "agent_thought_chunk") {
        const t = u.content && u.content.text;
        if (t) this.job.thought = t.slice(-500);
      } else if (kind === "tool_call" || kind === "tool_call_update") {
        const name = u.title || u.kind || u.toolName || "tool";
        this.lastStep = truncate(name, 40);
        this.job.step = this.lastStep;
        this.job.state = "running";
      } else if (kind === "usage_update") {
        this.job.contextUsed = u.used;
        this.job.contextSize = u.size;
      }
      this.d.saveJobs();
      this.d.refreshUI();
      return;
    }
    if (method === "session/request_permission") {
      const auto = this.d.settings.delegate.dsh.autoApprove === true;
      if (auto) {
        this.respond(msg.id, { outcome: { outcome: "selected", optionId: "allow-once" } });
      } else {
        this.job.state = "needs-approval";
        this.job.step = "\u7B49\u4F60\u5141\u8BB8\u4E00\u6B21\u5DE5\u5177\u8C03\u7528";
        this.d.saveJobs();
        this.d.notify({ title: "DeepSeek Harness \u9700\u8981\u4F60\u5141\u8BB8", body: `\u300C${this.job.name}\u300D\u505C\u5728\u4E86\u4E00\u6B21\u5DE5\u5177\u8C03\u7528\u4E0A\u3002\u5230\u8BBE\u7F6E\u91CC\u6253\u5F00\u300C\u81EA\u52A8\u5141\u8BB8\u300D\u540E\u91CD\u8BD5\uFF0C\u6216\u8005\u5728 Harness \u91CC\u624B\u52A8\u7EE7\u7EED\u3002`, job: this.job });
        this.respond(msg.id, { outcome: { outcome: "selected", optionId: "reject-once" } });
      }
      return;
    }
  }
  respond(id, result) {
    this.send({ jsonrpc: "2.0", id, result });
  }
  send(o) {
    if (!this.child || !this.child.stdin || this.finished) return;
    try {
      this.child.stdin.write(JSON.stringify(o) + "\n");
    } catch {
    }
  }
  request(method, params, timeout = 2e4) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} \u8D85\u65F6`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }
  cancel() {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.timer);
    if (this.sessionId) {
      try {
        this.send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: this.sessionId } });
      } catch {
      }
    }
    setTimeout(() => {
      try {
        this.child && this.child.kill("SIGTERM");
      } catch {
      }
    }, 500);
    this.job.state = "cancelled";
    this.job.endedAt = Date.now();
    this.d.saveJobs();
    this.d.refreshUI();
  }
  done(result) {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.timer);
    this.job.state = "done";
    this.job.endedAt = Date.now();
    this.job.stopReason = result && result.stopReason || "";
    if (this.assistantText) this.job.result = this.assistantText;
    this.d.saveJobs();
    this.close();
    this.d.onDone(this.job);
  }
  fail(message) {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.timer);
    this.job.state = "error";
    this.job.error = String(message || "").slice(0, 500);
    this.job.endedAt = Date.now();
    this.d.saveJobs();
    this.close();
    this.d.onError(this.job);
  }
  close() {
    if (this.sessionId) {
      try {
        this.send({ jsonrpc: "2.0", id: this.nextId++, method: "session/close", params: { sessionId: this.sessionId } });
      } catch {
      }
    }
    setTimeout(() => {
      try {
        this.child && this.child.kill("SIGTERM");
      } catch {
      }
    }, 1200);
    this.d.refreshUI();
  }
};
function resolveDshModel(id) {
  const staticMap = {
    "deepseek-v4-pro": '["deepseek-account","deepseek-v4-pro"]',
    "deepseek-v41-flash": '["deepseek-account","deepseek-flash"]',
    "deepseek-v4-flash": '["deepseek-official","deepseek-v4-flash"]',
    "deepseek-v4-pro-official": '["deepseek-official","deepseek-v4-pro"]'
  };
  if (staticMap[id]) return { value: staticMap[id] };
  if (String(id || "").startsWith("[")) return { value: id };
  return null;
}
function dshEffort(e) {
  const map = { off: "off", low: "low", medium: "high", high: "high", xhigh: "max", max: "max" };
  return map[e] || "high";
}
var Delegator = class {
  constructor(plugin) {
    this.plugin = plugin;
    this.jobs = plugin.jobs;
    this.runners = /* @__PURE__ */ new Map();
    this.settings = plugin.settings;
    this.vaultPath = plugin.vaultPath;
  }
  refreshSettings() {
    this.settings = this.plugin.settings;
    this.vaultPath = this.plugin.vaultPath;
  }
  notice(text, ms) {
    this.plugin.notice(text, ms);
  }
  notify({ title, body }) {
    this.plugin.notice(`${title}
${body}`, 12e3);
  }
  get C() {
    return this.settings.delegate || DEFAULTS.delegate;
  }
  defaultTarget() {
    return this.C.target === "dsh" ? "dsh" : "claude";
  }
  defaultModel(agent) {
    const a = this.C[agent] || {};
    return a.model || (agent === "dsh" ? "deepseek-v4-pro" : "claude-sonnet-5");
  }
  async delegate(opts) {
    this.refreshSettings();
    const agent = opts.agent === "dsh" ? "dsh" : "claude";
    const file = opts.file;
    if (!file) throw new Error("\u6CA1\u6709\u5F53\u524D\u7B14\u8BB0");
    const lines = opts.lines || (await this.plugin.readNote(file.path)).split("\n");
    const block = opts.block || blockAt(lines, opts.line);
    if (!block) throw new Error("\u5149\u6807\u8981\u653E\u5728\u4E00\u4E2A\u5217\u8868\u9879\u91CC");
    if (hasLink(lines, block) >= 0) throw new Error("\u8FD9\u4E00\u5757\u4E0B\u9762\u5DF2\u7ECF\u6709 \u{1F517} \u4E86\uFF1B\u8981\u91CD\u53D1\u5148\u5220\u6389\u90A3\u4E00\u884C");
    const title = blockTitle(block) || "Agent Deck task";
    const name = truncate(title, this.C.nameMax || 56);
    const prompt = this.buildPrompt({ ...opts, block, file, title });
    const job = {
      id: `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      agent,
      name,
      path: file.path,
      line: block.start,
      lineText: lines[block.start],
      blockText: block.text.slice(0, 6e3),
      prompt: prompt.slice(0, 12e3),
      originalLine: lines[block.start],
      startedAt: Date.now(),
      state: "starting",
      model: opts.model || this.defaultModel(agent),
      effort: opts.effort || (agent === "dsh" ? this.C.dsh.effort : this.C.claude.effort),
      permission: opts.permission || (agent === "dsh" ? "" : this.C.claude.permission),
      cwd: opts.cwd || (agent === "dsh" ? this.C.dsh.cwd : this.C.claude.cwd) || this.vaultPath,
      sessionId: "",
      linkWritten: false,
      resultWritten: false
    };
    this.jobs[job.id] = job;
    this.plugin.saveJobs();
    this.plugin.refreshUI();
    this.plugin.notice(`\u{1F6EB} \u6B63\u5728\u59D4\u6D3E\u7ED9 ${agent === "dsh" ? "DeepSeek Harness" : "Claude Code"}\uFF1A${name}`);
    const runner = agent === "dsh" ? new DshRunner(this, job) : new ClaudeRunner(this, job);
    this.runners.set(job.id, runner);
    try {
      await runner.start({ ...opts, prompt, name });
    } catch (e) {
      runner.fail && runner.fail(e && e.message || String(e));
    }
    return job;
  }
  // Codex / WorkBuddy 没有能起会话的命令行接口：任务文字放进剪贴板、把客户端叫到前台，你粘贴发出去。
  // 之后每轮扫描找这个 Agent 新出现、开头对得上的会话，找到就绑回这一行（🔗 + DELEGATED），面板里的卡片飞进「现在」。
  async handoff(opts) {
    this.refreshSettings();
    const agent = opts.agent;
    const file = opts.file;
    if (!file) throw new Error("\u6CA1\u6709\u5F53\u524D\u7B14\u8BB0");
    const lines = opts.lines || (await this.plugin.readNote(file.path)).split("\n");
    const block = opts.block || blockAt(lines, opts.line);
    if (!block) throw new Error("\u8981\u62D6\u4E00\u4E2A\u5217\u8868\u9879");
    if (hasLink(lines, block) >= 0) throw new Error("\u8FD9\u4E00\u5757\u4E0B\u9762\u5DF2\u7ECF\u6709 \u{1F517} \u4E86\uFF1B\u8981\u91CD\u53D1\u5148\u5220\u6389\u90A3\u4E00\u884C");
    const title = blockTitle(block) || "Agent Deck task";
    const name = truncate(title, this.C.nameMax || 56);
    const prompt = this.buildPrompt({ ...opts, block, file, title });
    const job = {
      id: `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      agent,
      name,
      path: file.path,
      line: block.start,
      lineText: lines[block.start],
      blockText: block.text.slice(0, 6e3),
      prompt: prompt.slice(0, 12e3),
      originalLine: lines[block.start],
      startedAt: Date.now(),
      state: "starting",
      handoff: true,
      step: `\u7B49\u4F60\u5728 ${AGENTS[agent]?.name || agent} \u91CC\u53D1\u51FA\u53BB`,
      cwd: this.vaultPath,
      sessionId: "",
      linkWritten: false,
      resultWritten: false
    };
    this.jobs[job.id] = job;
    this.plugin.saveJobs();
    copyText(prompt);
    await openAgentApp(agent);
    this.plugin.notice(`\u{1F4CB} \u4EFB\u52A1\u5DF2\u590D\u5236\uFF0C${AGENTS[agent]?.name || agent} \u5DF2\u6253\u5F00\uFF1A\u65B0\u5EFA\u5BF9\u8BDD\u3001\u7C98\u8D34\u53D1\u51FA\u53BB\u3002
\u4F1A\u8BDD\u4E00\u51FA\u73B0\uFF0CAgent Deck \u4F1A\u628A\u5B83\u7ED1\u56DE\u300C${name}\u300D\u3002`, 1e4);
    this.plugin.refreshUI();
    return job;
  }
  // 每轮扫描后调用：交接中的任务认领新会话；半小时没等到就作罢
  resolveHandoffs(usage) {
    const waiting = Object.values(this.jobs).filter((j) => j.handoff && j.state === "starting" && !j.sessionId);
    if (!waiting.length) return;
    const taken = new Set(Object.values(this.jobs).map((j) => j.sessionId).filter(Boolean));
    const norm3 = (s) => String(s || "").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
    for (const job of waiting) {
      if (Date.now() - job.startedAt > 30 * 6e4) {
        job.state = "cancelled";
        job.error = "\u534A\u5C0F\u65F6\u91CC\u6CA1\u5728\u5BA2\u6237\u7AEF\u770B\u5230\u8FD9\u4E2A\u4EFB\u52A1\u7684\u65B0\u4F1A\u8BDD";
        job.endedAt = Date.now();
        this.saveJobs();
        continue;
      }
      const head = norm3(job.name).slice(0, 10);
      const promptHead = norm3(job.prompt).slice(0, 24);
      let best = null;
      for (const m of usage.meta.values()) {
        if (m.agent !== job.agent || taken.has(m.sid) || (m.lastAt || 0) < job.startedAt - 5e3) continue;
        const t = norm3(m.text || m.title);
        if (!t || !(t.includes(head) || t.startsWith(promptHead.slice(0, 16)))) continue;
        if (!best || (m.lastAt || 0) < (best.lastAt || 0)) best = m;
      }
      if (!best) continue;
      taken.add(best.sid);
      job.app = best.app || "";
      this.onSession(job, best.sid);
    }
  }
  buildPrompt(opts) {
    const c = this.C;
    const parts = [];
    if (c.promptPrefix && c.promptPrefix.trim()) parts.push(c.promptPrefix.trim());
    parts.push(opts.block.text.trim());
    if (opts.promptSuffix && opts.promptSuffix.trim()) parts.push(opts.promptSuffix.trim());
    else if (c.promptSuffix && c.promptSuffix.trim()) parts.push(c.promptSuffix.trim());
    if (opts.file) parts.push(`
\uFF08\u6765\u81EA Obsidian\uFF1A${opts.file.path}\uFF09`);
    return parts.join("\n\n");
  }
  onSession(job, sid) {
    job.sessionId = sid;
    job.state = job.handoff ? "bound" : "running";
    this.plugin.markBound?.(sid);
    this.plugin.flyFromAgent?.(job);
    this.saveJobs();
    if (job.linkWritten) return;
    job.linkWritten = true;
    job._linkPromise = this.writeLink(job, sid).catch((e) => console.error("[agent-deck] writeLink", e));
    this.refreshUI();
  }
  async writeLink(job, sid) {
    if (!this.C.writeLink) return;
    const path6 = job.path;
    const text = await this.plugin.readNote(path6);
    const lines = text.split("\n");
    let at = lines.findIndex((l) => l === job.lineText);
    if (at < 0) at = lines.findIndex((l) => blockTitle({ text: l }) && l.includes(truncate(job.name, 20)));
    if (at < 0) return;
    const block = blockAt(lines, at);
    if (!block) return;
    if (hasLink(lines, block) >= 0) return;
    const indent = (lines[block.start].match(/^[ \t]*/) || [""])[0] + "	";
    const link = linkLine2(indent, job.agent, job.name, sid);
    lines.splice(block.start + 1, 0, link);
    if (this.C.markStatus) lines[block.start] = markDelegated(lines[block.start]);
    await this.plugin.writeNote(path6, lines.join("\n"));
    job.line = block.start;
    job.lineText = lines[block.start];
    job.linkLineText = link;
    this.saveJobs();
  }
  async onDone(job) {
    try {
      if (job._linkPromise) await job._linkPromise;
    } catch {
    }
    this.refreshUI();
    const agent = AGENTS[job.agent];
    this.plugin.notice(`\u2705 ${agent ? agent.name : job.agent} \u505A\u5B8C\u4E86\u4E00\u8F6E\uFF1A${job.name}
\u70B9\u4EFB\u52A1\u884C\u65C1\u8FB9\u7684\u6309\u94AE\u53EF\u4EE5\u5728\u5BA2\u6237\u7AEF\u91CC\u6253\u5F00\u4F1A\u8BDD`, 8e3);
    if (this.C.claude.openDesktop === true && job.agent === "claude" && job.sessionId) openSession(this.plugin, "claude", job.sessionId);
    if (this.settings.autoWriteResult && job.linkWritten) {
      try {
        await this.writeResult(job);
      } catch (e) {
        console.error("[agent-deck] writeResult", e);
      }
    }
    this.plugin.refreshUI();
  }
  onError(job) {
    this.refreshUI();
    const err2 = String(job.error || "");
    if (/not trusted/i.test(err2)) {
      this.plugin.notice(`Claude Code \u4E0D\u4FE1\u4EFB\u8FD9\u4E2A\u5DE5\u4F5C\u76EE\u5F55\uFF1A
${job.cwd}

\u5728\u7EC8\u7AEF\u91CC cd \u5230\u90A3\u513F\u8FD0\u884C\u4E00\u6B21 claude\uFF0C\u63A5\u53D7\u4FE1\u4EFB\u63D0\u793A\uFF1B\u6216\u8005\u5728\u300C\u59D4\u6D3E\u300D\u8BBE\u7F6E\u91CC\u628A\u5DE5\u4F5C\u76EE\u5F55\u6362\u6210\u4E00\u4E2A\u5DF2\u7ECF\u4FE1\u4EFB\u7684\u76EE\u5F55\u3002
\uFF08\u8FD9\u6B21\u6CA1\u6709\u771F\u6B63\u8DD1\u8D77\u6765\uFF0C\u5DF2\u7ECF\u628A \u{1F517} \u548C DELEGATED \u64A4\u56DE\uFF09`, 16e3);
    } else if (/unknown option|invalid option|unrecognized/i.test(err2)) {
      this.plugin.notice(`Claude Code \u4E0D\u8BA4\u8BC6\u4F20\u8FC7\u53BB\u7684\u53C2\u6570\uFF1A
${err2.slice(0, 300)}

\u628A\u300C\u59D4\u6D3E \u2192 \u989D\u5916\u53C2\u6570\u300D\u6E05\u7A7A\uFF0C\u6216\u68C0\u67E5 claude --help\u3002`, 12e3);
    } else {
      this.plugin.notice(`\u26A0\uFE0F ${job.agent === "dsh" ? "DeepSeek Harness" : "Claude Code"} \u6CA1\u8DD1\u5B8C\uFF1A${job.name}
${err2 || "\u8BE6\u60C5\u89C1\u63A7\u5236\u53F0"}`, 1e4);
    }
    if (job.linkWritten && Date.now() - (job.startedAt || 0) < 12e3 && /not trusted|unknown option|invalid option|unrecognized|ENOENT/i.test(err2)) {
      this.removeLink(job).catch(() => {
      });
    }
    console.error("[agent-deck] delegate failed", job.id, job.error);
  }
  async removeLink(job) {
    try {
      const text = await this.plugin.readNote(job.path);
      const lines = text.split("\n");
      const sid = job.sessionId || "";
      let li = sid ? lines.findIndex((l) => l.includes(sid)) : -1;
      if (li < 0 && job.linkLineText) li = lines.indexOf(job.linkLineText);
      if (li >= 0) lines.splice(li, 1);
      let at = lines.indexOf(job.lineText);
      if (at < 0) at = lines.findIndex((l) => /DELEGATED/.test(l) && job.originalLine && l.includes(String(job.name || "").slice(0, 16)));
      if (at >= 0 && job.originalLine) lines[at] = job.originalLine;
      await this.plugin.writeNote(job.path, lines.join("\n"));
      job.linkWritten = false;
      job.resultWritten = true;
      this.saveJobs();
    } catch (e) {
      console.error("[agent-deck] removeLink", e);
    }
  }
  async writeResult(job) {
    if (job.resultWritten) return;
    let said = job.result || job.lastText || "";
    if (!said) {
      const meta = this.plugin.usage && this.plugin.usage.meta.get(job.sessionId);
      said = meta && (meta.lastText || "");
    }
    said = String(said || "").replace(/\s+/g, " ").trim();
    if (!said) return;
    const max = clamp(Number(this.settings.resultMax) || 240, 40, 2e3);
    const text = await this.plugin.readNote(job.path);
    const lines = text.split("\n");
    let at = lines.indexOf(job.lineText);
    let block = at >= 0 ? blockAt(lines, at) : null;
    if (!block) {
      const li = lines.findIndex((l) => job.sessionId && l.includes(job.sessionId));
      if (li >= 0) {
        const indent2 = (lines[li].match(/^[ \t]*/) || [""])[0].length;
        let parent = -1;
        for (let i = li - 1; i >= 0; i--) {
          if (!lines[i].trim()) continue;
          const ind = (lines[i].match(/^[ \t]*/) || [""])[0].length;
          if (ind < indent2) {
            if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[i])) parent = i;
            break;
          }
        }
        if (parent >= 0) {
          at = parent;
          block = blockAt(lines, parent);
        }
      }
    }
    if (!block) return;
    const indent = (lines[block.start].match(/^[ \t]*/) || [""])[0] + "	";
    let resultAt = -1;
    for (let i = block.start + 1; i <= block.end; i++) if (RESULT_RE2.test(lines[i])) {
      resultAt = i;
      break;
    }
    const line = `${indent}- \u{1F4AC} ${truncate(said, max)}`;
    if (resultAt >= 0) lines[resultAt] = line;
    else {
      const link = findLink(lines, block);
      lines.splice((link ? link.line : block.start) + 1, 0, line);
    }
    await this.plugin.writeNote(job.path, lines.join("\n"));
    job.resultWritten = true;
    this.saveJobs();
  }
  cancel(id) {
    const runner = this.runners.get(id);
    const job = this.jobs[id];
    if (!job) return false;
    if (runner) runner.cancel();
    else {
      job.state = "cancelled";
      job.endedAt = Date.now();
      this.saveJobs();
    }
    this.refreshUI();
    return true;
  }
  cancelForLine(path6, lineText) {
    for (const job of Object.values(this.jobs)) {
      if (job.path === path6 && (job.lineText === lineText || job.line === lineText) && ["starting", "running", "needs-approval"].includes(job.state)) return job;
    }
    return null;
  }
  jobsFor(path6) {
    return Object.values(this.jobs).filter((j) => j.path === path6 && j.state !== "cancelled").sort((a, b) => b.startedAt - a.startedAt);
  }
  jobForSession(sid) {
    return Object.values(this.jobs).find((j) => j.sessionId === sid);
  }
  saveJobs() {
    const clean = {};
    for (const [id, job] of Object.entries(this.jobs)) {
      const { _linkPromise, ...rest } = job;
      clean[id] = rest;
    }
    this.plugin.settings.jobs = clean;
    this.plugin.saveSettings();
  }
  refreshUI() {
    this.plugin.refreshUI();
  }
};
function splitArgs(s) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while (m = re.exec(s)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}
function spawnCapture(bin, args, { cwd, env, timeout = 3e4 }) {
  return new Promise((resolve) => {
    let out = "", err2 = "", done = false;
    let child;
    try {
      child = (0, import_child_process2.spawn)(bin, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      return resolve({ ok: false, out: "", err: String(e && e.message || e) });
    }
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        try {
          child.kill("SIGTERM");
        } catch {
        }
        resolve({ ok: false, out, err: err2 || "\u8D85\u65F6" });
      }
    }, timeout);
    child.stdout.on("data", (b) => {
      out += b.toString();
      if (out.length > 2e4) out = out.slice(-2e4);
    });
    child.stderr.on("data", (b) => {
      err2 += b.toString();
      if (err2.length > 1e4) err2 = err2.slice(-1e4);
    });
    child.on("error", (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: false, out, err: String(e && e.message || e) });
    });
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, out, err: err2, code });
    });
  });
}
function execCapture(bin, args, { cwd, env, timeout = 1e4 } = {}) {
  return new Promise((resolve) => {
    (0, import_child_process2.execFile)(bin, args, { cwd, env, timeout, maxBuffer: 8 * 1024 * 1024 }, (err2, out, errOut) => {
      resolve({ ok: !err2, out: String(out || ""), err: String(errOut || err2 && err2.message || "") });
    });
  });
}

// src/view.js
var import_obsidian2 = require("obsidian");

// src/icons.js
var import_obsidian = require("obsidian");

// assets/agents/claude.png
var claude_default = "data:image/png;base64,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";

// assets/agents/codex.png
var codex_default = "data:image/png;base64,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";

// assets/agents/workbuddy.png
var workbuddy_default = "data:image/png;base64,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";

// assets/agents/dsh.png
var dsh_default = "data:image/png;base64,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";

// src/agent-assets.js
var AGENT_IMAGES = { claude: claude_default, codex: codex_default, workbuddy: workbuddy_default, dsh: dsh_default };
function agentImageBuffer(id) {
  const uri = AGENT_IMAGES[id];
  if (!uri) return null;
  return Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64");
}

// src/icons.js
var AGENT_ICONS = {
  claude: "asterisk",
  codex: "square-terminal",
  workbuddy: "users",
  dsh: "brain-circuit"
};
var STATE_ICONS = {
  run: "loader-circle",
  wait: "hand",
  quiet: "clock",
  "needs-approval": "hand",
  error: "triangle-alert",
  limit: "triangle-alert",
  done: "check",
  cancelled: "circle-x",
  idle: "circle-dot",
  recent: "history"
};
function setLucide(el, name, cls = "") {
  if (!el) return el;
  el.textContent = "";
  try {
    (0, import_obsidian.setIcon)(el, name);
  } catch {
    el.textContent = "";
  }
  el.classList.add("ad-icon");
  if (cls) el.classList.add(cls);
  return el;
}
function agentIcon(el, agent, cls = "") {
  if (!el) return el;
  const src = AGENT_IMAGES[agent];
  if (!src) return setLucide(el, AGENT_ICONS[agent] || AGENT_ICONS.claude, cls);
  el.textContent = "";
  const img = el.ownerDocument.createElement("img");
  img.src = src;
  img.alt = "";
  img.decoding = "async";
  img.draggable = false;
  img.className = "ad-agentimg" + (cls ? ` ${cls}` : "");
  el.appendChild(img);
  el.classList.add("ad-icon", "ad-glyph--img");
  return el;
}
function stateIcon(el, state, cls = "") {
  return setLucide(el, STATE_ICONS[state] || STATE_ICONS.idle, cls);
}

// src/editor.js
var import_view = require("@codemirror/view");
var import_state = require("@codemirror/state");
var refreshEffect = import_state.StateEffect.define();
var SESSION_MIME = "application/x-agent-deck-session";
var ITEM_MIME = "application/x-agent-deck-item";
var DROP_LABEL = { bind: "\u7ED1\u5B9A\u5230\u8FD9\u4E00\u9879 \xB7 \u6309\u4F4F \u2318 \u5728\u4E0B\u9762\u65B0\u5EFA", fill: "\u5728\u8FD9\u91CC\u65B0\u5EFA\u4E00\u9879", new: "\u5728\u8FD9\u91CC\u65B0\u5EFA\u4E00\u9879", below: "\u5728\u4E0B\u9762\u65B0\u5EFA\u4E00\u9879", after: "\u5728\u8FD9\u4E00\u9879\u4E0B\u9762\u65B0\u5EFA" };
var setDrop = import_state.StateEffect.define();
var dropField = import_state.StateField.define({
  create: () => import_view.Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setDrop)) continue;
      if (!e.value) {
        deco = import_view.Decoration.none;
        continue;
      }
      const line = tr.state.doc.line(e.value.line + 1);
      deco = import_view.Decoration.set([import_view.Decoration.line({ class: `ad-drop-line ad-drop-line--${e.value.kind}`, attributes: { "data-ad-drop": DROP_LABEL[e.value.kind] || "" } }).range(line.from)]);
    }
    return deco;
  },
  provide: (f) => import_view.EditorView.decorations.from(f)
});
var hasType = (e, type) => !!(e.dataTransfer && [...e.dataTransfer.types].includes(type));
function dropTarget(view, e) {
  const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }, false);
  if (pos == null) return null;
  const n = view.state.doc.lineAt(pos).number - 1;
  return dropKind(view.state.doc.toString().split("\n"), n, !!e.metaKey);
}
function dndHandlers(plugin) {
  let last = "";
  const show = (view, t) => {
    const key = t ? `${t.line}:${t.kind}` : "";
    if (key === last) return;
    last = key;
    view.dispatch({ effects: setDrop.of(t) });
  };
  return import_state.Prec.highest(import_view.EditorView.domEventHandlers({
    dragover(e, view) {
      if (!hasType(e, SESSION_MIME)) return false;
      e.preventDefault();
      e.dataTransfer.dropEffect = "link";
      show(view, dropTarget(view, e));
      return true;
    },
    dragleave(e, view) {
      if (!hasType(e, SESSION_MIME)) return false;
      if (e.relatedTarget && view.dom.contains(e.relatedTarget)) return false;
      show(view, null);
      return false;
    },
    drop(e, view) {
      if (!hasType(e, SESSION_MIME)) return false;
      e.preventDefault();
      e.stopPropagation();
      const t = dropTarget(view, e);
      show(view, null);
      let data = null;
      try {
        data = JSON.parse(e.dataTransfer.getData(SESSION_MIME));
      } catch {
      }
      if (data && t) plugin.bindSessionAt(view, t.line, data, { below: !!e.metaKey });
      else if (data) plugin.notice("\u8FD9\u4E00\u884C\u653E\u4E0D\u4E86\u4F1A\u8BDD\uFF1A\u62D6\u5230\u5217\u8868\u9879\u3001\u7A7A\u7684\u5217\u8868\u9879\u6216\u7A7A\u884C\u4E0A");
      return true;
    },
    // 选中一段文字拖出去：记下它从哪一行来，拖到 Agent 卡片上也能委派
    dragstart(e, view) {
      const sel = view.state.selection.main;
      if (sel.empty) return false;
      const info = view.state.field(plugin.editorInfoField, false);
      const path6 = info && info.file && info.file.path;
      if (!path6) return false;
      const n = view.state.doc.lineAt(sel.from).number - 1;
      plugin.noteDragItem({ path: path6, line: n, lineText: view.state.doc.line(n + 1).text });
      return false;
    }
  }));
}
var GripWidget = class extends import_view.WidgetType {
  constructor(plugin, path6, line, text) {
    super();
    this.plugin = plugin;
    this.path = path6;
    this.line = line;
    this.text = text;
  }
  eq(o) {
    return o.path === this.path && o.line === this.line && o.text === this.text;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "ad-grip";
    el.setAttribute("contenteditable", "false");
    el.draggable = true;
    el.title = "\u62D6\u5230 Agent Deck \u91CC\u7684\u67D0\u4E2A Agent \u4E0A\uFF0C\u59D4\u6D3E\u8FD9\u4E00\u9879";
    setLucide(el, "grip-vertical");
    el.addEventListener("mousedown", (e) => e.stopPropagation());
    el.addEventListener("dragstart", (e) => {
      const item = { path: this.path, line: this.line, lineText: this.text };
      e.dataTransfer.setData(ITEM_MIME, JSON.stringify(item));
      e.dataTransfer.setData("text/plain", this.text.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ""));
      e.dataTransfer.effectAllowed = "copy";
      this.plugin.noteDragItem(item);
      e.stopPropagation();
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
};
function sigFor(x) {
  if (!x) return "none";
  return [x.kind, x.job && x.job.id, x.job && x.job.state, x.session && x.session.sid, x.session && x.session.state, x.session && x.session.step, x.session && x.session.tokens, x.todo && `${x.todo.done}/${x.todo.total}`].join("|");
}
var PillWidget = class extends import_view.WidgetType {
  constructor(plugin, path6, line, info) {
    super();
    this.plugin = plugin;
    this.path = path6;
    this.line = line;
    this.info = info;
    this.sig = sigFor(info);
  }
  eq(other) {
    return other.path === this.path && other.line === this.line && other.sig === this.sig;
  }
  toDOM(view) {
    const p = this.plugin;
    const info = this.info;
    const el = document.createElement("span");
    el.className = `ad-pill ad-pill--${info.kind}`;
    el.setAttribute("contenteditable", "false");
    el.dataset.line = String(this.line);
    const job = info.job;
    const session = info.session;
    const agent = job && job.agent || session && session.agent || p.defaultTarget();
    const a = AGENTS[agent] || AGENTS.claude;
    el.style.setProperty("--ad-agent", a.color);
    el.style.setProperty("--ad-agent-soft", a.soft);
    const fill2 = document.createElement("span");
    fill2.className = "ad-pill__fill";
    el.appendChild(fill2);
    const wave = document.createElement("span");
    wave.className = "ad-pill__wave";
    el.appendChild(wave);
    const glyph = document.createElement("span");
    glyph.className = "ad-pill__glyph";
    agentIcon(glyph, agent);
    el.appendChild(glyph);
    const label = document.createElement("span");
    label.className = "ad-pill__label";
    el.appendChild(label);
    const meta = document.createElement("span");
    meta.className = "ad-pill__meta";
    el.appendChild(meta);
    const right = document.createElement("span");
    right.className = "ad-pill__right";
    el.appendChild(right);
    const modelName = job && p.modelLabel(job.model) || session && p.modelLabel(session.model) || "";
    if (info.kind === "idle") {
      label.textContent = "\u59D4\u6D3E";
      meta.textContent = modelName || (agent === "dsh" ? "DeepSeek" : "Claude");
      const chev = document.createElement("span");
      chev.className = "ad-pill__chev";
      setLucide(chev, "chevron-down");
      chev.title = "\u9009\u62E9\u6A21\u578B\u3001\u5F3A\u5EA6\u3001\u6A21\u5F0F";
      chev.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        p.openDelegateModal(this.path, this.line);
      });
      right.appendChild(chev);
    } else if (info.kind === "running" || info.kind === "starting") {
      label.textContent = info.kind === "starting" ? "\u51C6\u5907\u4E2D" : "\u59D4\u6D3E\u4E2D";
      const start = job && job.startedAt || Date.now();
      const tick = () => {
        meta.textContent = fmtDur(Date.now() - start);
      };
      tick();
      el._adTimer = setInterval(tick, 1e3);
      const cancel = document.createElement("span");
      cancel.className = "ad-pill__cancel";
      setLucide(cancel, "x");
      cancel.title = "\u53D6\u6D88\u8FD9\u6B21\u59D4\u6D3E";
      cancel.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        p.cancelJob(job && job.id);
      });
      right.appendChild(cancel);
      const progress = p.jobProgress(job);
      if (progress && progress.total) {
        el.style.setProperty("--ad-p", `${Math.round(progress.done / progress.total * 100)}%`);
        el.classList.add("is-determinate");
      }
    } else if (info.kind === "waiting" || info.kind === "needs-approval") {
      label.textContent = info.kind === "needs-approval" ? "\u7B49\u4F60\u5141\u8BB8" : "\u7B49\u4F60";
      meta.textContent = info.kind === "needs-approval" ? "\u6253\u5F00\u5BA2\u6237\u7AEF\u5904\u7406" : "\u70B9\u51FB\u6253\u5F00";
      el.classList.add("is-pulse");
    } else if (info.kind === "done") {
      label.textContent = "\u5B8C\u6210";
      meta.textContent = job && job.result ? truncate(job.result, 28) : session && session.lastText ? truncate(session.lastText, 28) : "\u6253\u5F00\u4F1A\u8BDD";
      const open = document.createElement("span");
      open.className = "ad-pill__open";
      setLucide(open, "arrow-up-right");
      right.appendChild(open);
    } else if (info.kind === "error") {
      label.textContent = "\u51FA\u9519";
      meta.textContent = truncate(job && job.error || session && session.err || "\u70B9\u51FB\u91CD\u8BD5", 30);
      const retry = document.createElement("span");
      retry.className = "ad-pill__open";
      setLucide(retry, "refresh-cw");
      retry.title = "\u91CD\u65B0\u59D4\u6D3E";
      retry.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        p.openDelegateModal(this.path, this.line);
      });
      right.appendChild(retry);
    } else {
      label.textContent = "\u4F1A\u8BDD";
      meta.textContent = session && session.step ? truncate(session.step, 26) : "";
    }
    if (session && session.tokens) {
      const tok = document.createElement("span");
      tok.className = "ad-pill__tok";
      tok.textContent = fmtTok(session.tokens);
      right.appendChild(tok);
    }
    el.addEventListener("mousedown", (e) => {
      if (e.target.closest(".ad-pill__cancel, .ad-pill__chev, .ad-pill__open")) return;
      e.preventDefault();
      e.stopPropagation();
      if (info.kind === "idle") p.delegateAtLine(this.path, this.line).catch((err2) => p.notice(String(err2.message || err2)));
      else if (info.kind === "error") p.openDelegateModal(this.path, this.line);
      else p.openJob(job && job.id, session && session.sid);
    });
    el.title = p.pillTitle(info);
    return el;
  }
  destroy(dom) {
    if (dom._adTimer) clearInterval(dom._adTimer);
  }
  ignoreEvent() {
    return true;
  }
};
function buildDecorations(view, plugin) {
  const builder = new import_state.RangeSetBuilder();
  const info = view.state.field(plugin.editorInfoField, false);
  const path6 = info && info.file && info.file.path;
  if (!path6 || !plugin.settings.showEditorPills) return builder.finish();
  const doc = view.state.doc;
  const map = plugin.lineMap(path6, doc);
  const seen = /* @__PURE__ */ new Set();
  const sel = view.state.selection.main;
  const cursorLine = plugin._lastEditor === view && sel.empty ? doc.lineAt(sel.head).number - 1 : -1;
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      const n = line.number - 1;
      if (!seen.has(n)) {
        seen.add(n);
        const text = line.text;
        const job = plugin.jobAtLine(path6, n, text);
        const session = map.sessionByParent.get(n) || null;
        let state = null;
        if (job && ["starting", "running"].includes(job.state)) state = { kind: job.state === "starting" ? "starting" : "running", job };
        else if (job && job.state === "needs-approval") state = { kind: "needs-approval", job, session };
        else if (job && job.state === "done") state = { kind: "done", job, session };
        else if (job && job.state === "error") state = { kind: "error", job, session };
        else if (job && job.state === "cancelled") state = null;
        else if (session) {
          const st = session.state || "idle";
          if (st === "run") state = { kind: "running", job, session };
          else if (st === "wait" || st === "quiet") state = { kind: "waiting", job, session };
          else if (st === "error" || st === "limit") state = { kind: "error", job, session };
          else state = { kind: "bound", job, session };
        }
        if (state) {
          const widget = new PillWidget(plugin, path6, n, state);
          builder.add(line.to, line.to, import_view.Decoration.widget({ widget, side: 1, block: false }));
        } else if (n === cursorLine && plugin.views.size && plugin.settings.dragGrip !== false && BULLET_RE.test(text) && kwLine(text)) {
          builder.add(line.to, line.to, import_view.Decoration.widget({ widget: new GripWidget(plugin, path6, n, text), side: 1, block: false }));
        }
      }
      if (line.to >= to) break;
      pos = line.to + 1;
    }
  }
  return builder.finish();
}
function createEditorExtension(plugin) {
  const pluginClass = class {
    constructor(view) {
      if (view.hasFocus) plugin._lastEditor = view;
      this.decorations = buildDecorations(view, plugin);
    }
    update(update) {
      if (update.focusChanged && update.view.hasFocus && plugin._lastEditor !== update.view) {
        const prev = plugin._lastEditor;
        plugin._lastEditor = update.view;
        if (prev && prev !== update.view) {
          try {
            prev.dispatch({ effects: refreshEffect.of(null) });
          } catch {
          }
        }
      }
      const refresh = update.transactions.some((tr) => tr.effects.some((e) => e.is(refreshEffect)));
      if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged || refresh) this.decorations = buildDecorations(update.view, plugin);
    }
  };
  return [import_view.ViewPlugin.fromClass(pluginClass, { decorations: (v) => v.decorations }), dropField, dndHandlers(plugin)];
}
async function dispatchRefresh(plugin) {
  plugin.app.workspace.iterateAllLeaves((leaf) => {
    const view = leaf.view;
    const cm = view && view.editor && view.editor.cm;
    if (cm) {
      try {
        cm.dispatch({ effects: refreshEffect.of(null) });
      } catch {
      }
    }
  });
}

// src/view.js
var VIEW_TYPE = "agent-deck-view";
var AgentDeckView = class extends import_obsidian2.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.filter = "all";
    this.search = "";
    this._scroll = 0;
  }
  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "Agent Deck";
  }
  getIcon() {
    return "gauge";
  }
  async onOpen() {
    this.contentEl.addClass("ad-view");
    this.plugin.views.add(this);
    this.render();
  }
  async onClose() {
    this.plugin.views.delete(this);
  }
  render() {
    const root = this.contentEl;
    this._scroll = root.scrollTop || this._scroll;
    const focused = document.activeElement;
    const searchWasFocused = focused && focused.classList && focused.classList.contains("ad-search__input");
    root.empty();
    root.addClass("ad-view");
    const dash = root.createDiv({ cls: "ad-dash" });
    const p = this.plugin;
    const todayKey = dayKeyToday(p.settings);
    const today = p.store.get(todayKey);
    const live = p.liveSessions({ hours: 6 });
    const running = live.filter((x) => ["run", "starting", "running"].includes(x.state) || x.agent && x.state === "busy");
    const waiting = live.filter((x) => ["wait", "quiet", "needs-approval"].includes(x.state));
    const recent = p.recentSessions({ days: 7, limit: 80 });
    const head = dash.createDiv({ cls: "ad-head" });
    const brand = head.createDiv({ cls: "ad-brand" });
    const brandMark = brand.createSpan({ cls: "ad-brand__mark" });
    setLucide(brandMark, "wand-sparkles");
    const brandText = brand.createDiv({ cls: "ad-brand__text" });
    brandText.createDiv({ cls: "ad-brand__name", text: "Agent Deck" });
    brandText.createDiv({ cls: "ad-brand__sub", text: "\u667A\u80FD\u4F53\u7532\u677F" });
    const actions = head.createDiv({ cls: "ad-head__actions" });
    const scan = actions.createEl("button", { cls: "ad-iconbtn", attr: { "aria-label": "\u91CD\u65B0\u626B\u63CF\u672C\u673A\u4F1A\u8BDD" } });
    setLucide(scan.createSpan({ cls: "ad-iconbtn__icon" }), "refresh-cw");
    scan.onclick = () => p.scanNow(true);
    const gear = actions.createEl("button", { cls: "ad-iconbtn", attr: { "aria-label": "\u8BBE\u7F6E" } });
    setLucide(gear.createSpan({ cls: "ad-iconbtn__icon" }), "settings-2");
    gear.onclick = () => p.openSettings();
    const hero = dash.createDiv({ cls: "ad-hero" });
    const dateLine = hero.createDiv({ cls: "ad-hero__date" });
    const now = /* @__PURE__ */ new Date();
    const wd = ["\u5468\u65E5", "\u5468\u4E00", "\u5468\u4E8C", "\u5468\u4E09", "\u5468\u56DB", "\u5468\u4E94", "\u5468\u516D"][now.getDay()];
    dateLine.createSpan({ text: `${now.getMonth() + 1} \u6708 ${now.getDate()} \u65E5 \xB7 ${wd}` });
    dateLine.createSpan({ cls: "ad-hero__hint", text: today ? "\u4ECA\u5929\u7684\u534F\u4F5C\u8BB0\u5F55" : "\u4ECA\u5929\u8FD8\u6CA1\u6709\u4F1A\u8BDD" });
    const nums = hero.createDiv({ cls: "ad-hero__nums" });
    this.num(nums, String(live.filter((x) => ["run", "running"].includes(x.state)).length), "\u5728\u8DD1", "is-live");
    this.num(nums, fmtMin(today ? today.wall : 0), "\u534F\u4F5C\u65F6\u957F", "");
    this.num(nums, fmtTok(today ? today.out : 0), "\u4EA7\u51FA token", "");
    const prim = hero.createDiv({ cls: "ad-hero__primaries" });
    prim.createSpan({ cls: "ad-kicker", text: "\u4E3B\u529B" });
    for (const id of p.primaryAgents()) {
      const a = AGENTS[id];
      const chip = prim.createSpan({ cls: "ad-primary-chip", attr: { style: `--ad-agent:${a.color};--ad-agent-soft:${a.soft}` } });
      agentIcon(chip.createSpan({ cls: "ad-glyph" }), id);
      chip.createSpan({ text: a.name });
      chip.createSpan({ cls: "ad-primary-chip__tag", text: "\u5168\u91CF" });
    }
    if (!p.primaryAgents().length) prim.createSpan({ cls: "ad-muted", text: "\u5728\u8BBE\u7F6E\u91CC\u9009 1\u20132 \u4E2A" });
    const nowSec = dash.createDiv({ cls: "ad-sec ad-sec--now" });
    const nowHead = this.secHead(nowSec, "\u73B0\u5728", `${running.length} \u4E2A\u5728\u8DD1 \xB7 ${waiting.length} \u4E2A\u7B49\u4F60`);
    const nowList = nowSec.createDiv({ cls: "ad-nowlist" });
    const nowItems = [...running, ...waiting].slice(0, 6);
    if (!nowItems.length) this.empty(nowList, "\u73B0\u5728\u6CA1\u6709\u5728\u8DD1\u7684\u4F1A\u8BDD", "\u628A\u7B14\u8BB0\u91CC\u7684\u4E00\u9879\u62D6\u5230\u4E0B\u9762\u7684 Agent \u4E0A\u59D4\u6D3E\uFF0C\u6216\u8005\u7B49\u4E0B\u4E00\u6B21\u626B\u63CF\u3002");
    for (const s of nowItems) this.sessionCard(nowList, s, true);
    const agentsSec = dash.createDiv({ cls: "ad-sec" });
    this.secHead(agentsSec, "Agents", "\u70B9\u56FE\u6807\u6253\u5F00\u5BA2\u6237\u7AEF \xB7 \u628A\u7B14\u8BB0\u91CC\u7684\u4E00\u9879\u62D6\u4E0A\u6765\u59D4\u6D3E", () => p.openSettings());
    const grid = agentsSec.createDiv({ cls: "ad-agentgrid" });
    for (const id of AGENT_ORDER) this.agentCard(grid, id, today);
    if (p.settings.ui.showUsageBars !== false) {
      const usageSec = dash.createDiv({ cls: "ad-sec" });
      this.secHead(usageSec, "\u6700\u8FD1 14 \u5929", "\u6309 Agent \u5806\u53E0\u7684\u534F\u4F5C\u5206\u949F");
      this.usageBars(usageSec);
    }
    const recSec = dash.createDiv({ cls: "ad-sec ad-sec--recent" });
    const recHead = this.secHead(recSec, "\u6700\u8FD1\u7684\u4F1A\u8BDD", `${recent.length} \u4E2A \xB7 \u6700\u8FD1 7 \u5929`);
    const filters = recHead.createDiv({ cls: "ad-filters" });
    for (const [id, label] of [["all", "\u5168\u90E8"], ["live", "\u5728\u8DD1"], ["wait", "\u7B49\u4F60"], ["claude", "Claude"], ["codex", "Codex"], ["workbuddy", "WorkBuddy"], ["dsh", "DSH"]]) {
      const b = filters.createEl("button", { cls: "ad-chip" + (this.filter === id ? " is-on" : ""), text: label });
      b.onclick = () => {
        this.filter = id;
        this.render();
      };
    }
    const search = recHead.createDiv({ cls: "ad-search" });
    search.createSpan({ cls: "ad-search__icon", text: "\u2315" });
    const input = search.createEl("input", { cls: "ad-search__input", attr: { placeholder: "\u641C\u6807\u9898\u3001\u9879\u76EE\u3001\u7B2C\u4E00\u6B65\u2026", value: this.search } });
    input.oninput = () => {
      this.search = input.value;
      this.renderSessions(recSec);
    };
    recSec._list = recSec.createDiv({ cls: "ad-sessionlist" });
    this.renderSessions(recSec);
    root.scrollTop = this._scroll;
    this.playFly(dash);
    if (searchWasFocused) {
      const i = root.querySelector(".ad-search__input");
      if (i) {
        i.focus();
        i.setSelectionRange(i.value.length, i.value.length);
      }
    }
  }
  renderSessions(sec) {
    const list = sec._list || sec.querySelector(".ad-sessionlist");
    if (!list) return;
    list.empty();
    const p = this.plugin;
    let rows = p.recentSessions({ days: 7, limit: 200 });
    if (this.filter === "live") rows = rows.filter((x) => x.state === "run");
    else if (this.filter === "wait") rows = rows.filter((x) => ["wait", "quiet"].includes(x.state));
    else if (AGENTS[this.filter]) rows = rows.filter((x) => x.agent === this.filter);
    if (this.search.trim()) {
      const q = this.search.toLowerCase();
      rows = rows.filter((x) => `${x.title} ${x.cwd} ${x.text} ${x.step}`.toLowerCase().includes(q));
    }
    if (!rows.length) return this.empty(list, "\u6CA1\u6709\u7B26\u5408\u6761\u4EF6\u7684\u4F1A\u8BDD", "\u8BD5\u8BD5\u522B\u7684\u7B5B\u9009\uFF0C\u6216\u8005\u70B9\u53F3\u4E0A\u89D2\u91CD\u65B0\u626B\u63CF\u3002");
    for (const s of rows) this.sessionCard(list, s, false);
  }
  secHead(parent, title, sub, action) {
    const h = parent.createDiv({ cls: "ad-sechead" });
    const t = h.createDiv({ cls: "ad-sechead__title" });
    t.createSpan({ text: title });
    if (sub) t.createSpan({ cls: "ad-sechead__sub", text: sub });
    if (action) {
      const b = h.createEl("button", { cls: "ad-linkbtn", text: "\u7BA1\u7406" });
      b.onclick = action;
    }
    return h;
  }
  num(parent, value, label, cls) {
    const box = parent.createDiv({ cls: `ad-num ${cls || ""}` });
    box.createDiv({ cls: "ad-num__v", text: value });
    box.createDiv({ cls: "ad-num__l", text: label });
  }
  agentCard(parent, id, today) {
    const p = this.plugin;
    const a = AGENTS[id];
    const enabled = p.agentEnabled(id);
    const primary = p.isPrimary(id);
    const by = today && today.by && today.by[id] || null;
    const card = parent.createDiv({ cls: `ad-agentcard ${enabled ? "" : "is-off"} ${primary ? "is-primary" : ""}` });
    card.dataset.agent = id;
    card.style.setProperty("--ad-agent", a.color);
    card.style.setProperty("--ad-agent-soft", a.soft);
    const handoff = id === "codex" || id === "workbuddy";
    card.setAttr("data-drop-hint", handoff ? `\u4EA4\u7ED9 ${a.short}\uFF1A\u590D\u5236\u4EFB\u52A1\u5E76\u6253\u5F00\u5BA2\u6237\u7AEF` : `\u59D4\u6D3E\u7ED9 ${a.short}`);
    card.addEventListener("dragover", (e) => {
      if (!p.acceptsItemDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      card.addClass("is-drop");
    });
    card.addEventListener("dragleave", (e) => {
      if (!card.contains(e.relatedTarget)) card.removeClass("is-drop");
    });
    card.addEventListener("drop", (e) => {
      if (!p.acceptsItemDrag(e)) return;
      e.preventDefault();
      card.removeClass("is-drop");
      p.delegateDrop(id, p.readItemDrag(e));
    });
    const top = card.createDiv({ cls: "ad-agentcard__top" });
    const mark = top.createEl("button", { cls: "ad-agentcard__mark", attr: { "aria-label": `\u6253\u5F00 ${a.name}` } });
    agentIcon(mark.createSpan({ cls: "ad-glyph" }), id);
    mark.onclick = (e) => {
      e.stopPropagation();
      p.openAgentApp(id);
    };
    const name = top.createDiv({ cls: "ad-agentcard__name" });
    name.createDiv({ cls: "ad-agentcard__title", text: a.name });
    const live = p.usage.liveSessions({ since: Date.now() - 864e5, limit: 100 }).filter((x) => x.agent === id);
    const running = live.filter((x) => x.state === "run").length;
    name.createDiv({ cls: "ad-agentcard__where", text: running ? `${running} \u4E2A\u5728\u8DD1` : by ? `${by.sessions || 0} \u4E2A\u4F1A\u8BDD` : "\u4ECA\u5929\u8FD8\u6CA1\u52A8" });
    const star = top.createEl("button", { cls: "ad-star" + (primary ? " is-on" : ""), attr: { "aria-label": primary ? "\u53D6\u6D88\u4E3B\u529B" : "\u8BBE\u4E3A\u4E3B\u529B\uFF08\u6700\u591A\u4E24\u4E2A\uFF09" } });
    setLucide(star, primary ? "star" : "star-off");
    star.onclick = (e) => {
      e.stopPropagation();
      p.togglePrimary(id);
    };
    const stats = card.createDiv({ cls: "ad-agentcard__stats" });
    stats.createSpan({ text: fmtMin(by ? by.wall : 0) });
    stats.createSpan({ cls: "ad-dot", text: "\xB7" });
    stats.createSpan({ text: fmtTok(by ? by.out : 0) + " tok" });
    const spark = card.createDiv({ cls: "ad-spark" });
    if (p.settings.ui.showSparkline !== false) this.sparkline(spark, id);
    for (const job of Object.values(p.jobs).filter((j) => j.agent === id && j.handoff && j.state === "starting" && !j.sessionId)) {
      const row = card.createDiv({ cls: "ad-handoff" });
      setLucide(row.createSpan({ cls: "ad-handoff__icon ad-spin" }), "loader-circle");
      row.createSpan({ cls: "ad-handoff__text", text: `\u7B49\u4F60\u5728 ${a.short} \u91CC\u53D1\u51FA\uFF1A${truncate(job.name, 18)}` });
      const x = row.createEl("button", { cls: "ad-handoff__x", attr: { "aria-label": "\u4E0D\u7B49\u4E86" } });
      setLucide(x, "x");
      x.onclick = (e) => {
        e.stopPropagation();
        p.cancelJob(job.id);
      };
    }
    const foot = card.createDiv({ cls: "ad-agentcard__foot" });
    const toggle = foot.createEl("button", { cls: "ad-minitoggle" + (enabled ? " is-on" : ""), text: enabled ? "\u8FFD\u8E2A\u4E2D" : "\u5DF2\u5173\u95ED" });
    toggle.onclick = (e) => {
      e.stopPropagation();
      p.setAgentEnabled(id, !enabled);
    };
    const open = foot.createEl("button", { cls: "ad-linkbtn", text: "\u626B\u63CF" });
    open.onclick = (e) => {
      e.stopPropagation();
      p.scanNow(true);
    };
  }
  sparkline(parent, agent) {
    const p = this.plugin;
    const days = p.store.range(14, p.settings);
    const vals = days.map((d) => d.by && d.by[agent] ? d.by[agent].wall : 0);
    const max = Math.max(1, ...vals);
    const w = 120, h = 26, gap = 2, bw = (w - gap * (vals.length - 1)) / vals.length;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("class", "ad-spark__svg");
    vals.forEach((v, i) => {
      const bh = v ? Math.max(2, v / max * (h - 3)) : 1.5;
      const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      r.setAttribute("x", String(i * (bw + gap)));
      r.setAttribute("y", String(h - bh));
      r.setAttribute("width", String(bw));
      r.setAttribute("height", String(bh));
      r.setAttribute("rx", "1.2");
      r.setAttribute("fill", v ? "var(--ad-agent)" : "var(--background-modifier-border)");
      r.setAttribute("opacity", v ? "0.85" : "0.5");
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = `${days[i].key} \xB7 ${fmtMin(v)}`;
      r.appendChild(title);
      svg.appendChild(r);
    });
    parent.appendChild(svg);
  }
  usageBars(parent) {
    const p = this.plugin;
    const days = p.store.range(14, p.settings);
    const max = Math.max(1, ...days.map((d) => d.wall || 0));
    const box = parent.createDiv({ cls: "ad-bars" });
    for (const d of days) {
      const col = box.createDiv({ cls: "ad-bar" });
      const stack = col.createDiv({ cls: "ad-bar__stack" });
      const total = d.wall || 0;
      if (total) {
        const agents = AGENT_ORDER.filter((id) => d.by && d.by[id] && d.by[id].wall > 0);
        for (const id of agents) {
          const a = AGENTS[id];
          const seg = stack.createDiv({ cls: "ad-bar__seg" });
          seg.style.height = `${(d.by[id].wall || 0) / max * 100}%`;
          seg.style.background = a.color;
          seg.title = `${d.key} \xB7 ${a.name} ${fmtMin(d.by[id].wall)}`;
        }
      } else {
        const dot = stack.createDiv({ cls: "ad-bar__zero" });
      }
      col.createDiv({ cls: "ad-bar__label", text: d.key.slice(5).replace("_", "/") });
    }
    const legend = parent.createDiv({ cls: "ad-legend" });
    for (const id of AGENT_ORDER) {
      const a = AGENTS[id];
      const item = legend.createSpan({ cls: "ad-legend__item" });
      item.createSpan({ cls: "ad-legend__dot", attr: { style: `background:${a.color}` } });
      item.createSpan({ text: a.short });
    }
  }
  sessionCard(parent, s, compact) {
    const p = this.plugin;
    const a = AGENTS[s.agent] || AGENTS.claude;
    const card = parent.createDiv({ cls: `ad-sess ${compact ? "is-now" : ""}` });
    card.dataset.sid = s.sid;
    card.draggable = true;
    card.addEventListener("dragstart", (e) => {
      const title = s.title || truncate(s.text || s.step || s.sid, 60);
      e.dataTransfer.setData(SESSION_MIME, JSON.stringify({ agent: s.agent, sid: s.sid, title, app: s.app || "", state: s.state || "" }));
      e.dataTransfer.setData("text/plain", title);
      e.dataTransfer.effectAllowed = "all";
      card.addClass("is-dragging");
      document.body.classList.add("ad-dragging-session");
    });
    card.addEventListener("dragend", () => {
      card.removeClass("is-dragging");
      document.body.classList.remove("ad-dragging-session");
    });
    card.addEventListener("dragover", (e) => {
      if (!p.acceptsItemDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "link";
      card.addClass("is-drop");
    });
    card.addEventListener("dragleave", (e) => {
      if (!card.contains(e.relatedTarget)) card.removeClass("is-drop");
    });
    card.addEventListener("drop", (e) => {
      if (!p.acceptsItemDrag(e)) return;
      e.preventDefault();
      card.removeClass("is-drop");
      p.bindItemToSession(p.readItemDrag(e), { agent: s.agent, sid: s.sid, title: s.title || truncate(s.text || s.step || s.sid, 60), app: s.app || "", state: s.state || "" });
    });
    card.style.setProperty("--ad-agent", a.color);
    card.style.setProperty("--ad-agent-soft", a.soft);
    const child = !!s.parentSid;
    if (child) card.addClass("is-child");
    const live = ["run", "starting", "running"].includes(s.state);
    const wait = ["wait", "quiet", "needs-approval"].includes(s.state);
    if (live) card.addClass("is-live");
    if (wait) card.addClass("is-wait");
    const icon = card.createDiv({ cls: "ad-sess__mark" });
    agentIcon(icon.createSpan({ cls: "ad-glyph" }), s.agent);
    const body = card.createDiv({ cls: "ad-sess__body" });
    const titleRow = body.createDiv({ cls: "ad-sess__title" });
    titleRow.createSpan({ cls: "ad-sess__name", text: s.title || truncate(s.text || s.step || s.sid, 60) || s.sid.slice(0, 12) });
    const st = stateChip(s);
    if (st) {
      const chip = titleRow.createSpan({ cls: `ad-state ${st.cls}` });
      const sic = chip.createSpan({ cls: "ad-state__icon" + (st.cls === "is-live" ? " ad-spin" : "") });
      stateIcon(sic, s.state);
      chip.createSpan({ text: st.label });
    }
    const subs = p.usage.subsOf ? p.usage.subsOf(s.sid).filter((r) => r.state !== "done" && r.state !== "fail" && Date.now() - (r.at || r.start || 0) < 5 * 6e4) : [];
    if (subs.length) {
      const sb = titleRow.createSpan({ cls: "ad-side" });
      setLucide(sb.createSpan({ cls: "ad-side__icon" }), "bot");
      sb.createSpan({ text: subs.length > 1 ? `\u5B50\u4EE3\u7406 \xD7${subs.length}` : "\u5B50\u4EE3\u7406" });
      sb.title = subs.map((r) => r.desc || r.type || "subagent").join("\n");
    }
    if (s.sideChats) {
      const sc = titleRow.createSpan({ cls: "ad-side" });
      setLucide(sc.createSpan({ cls: "ad-side__icon" }), "message-square");
      sc.createSpan({ text: s.sideChats > 1 ? `side chat \xD7${s.sideChats}` : "side chat" });
      sc.title = "\u8FD9\u4E2A\u4F1A\u8BDD\u6B63\u5F00\u7740 side chat" + (s.sideSince ? `\uFF08${timeAgo(s.sideSince)}\u5F00\u7684\uFF09` : "");
    }
    const sub = body.createDiv({ cls: "ad-sess__sub" });
    sub.createSpan({ text: a.short });
    if (s.cwd) sub.createSpan({ text: "\xB7" });
    if (s.cwd) sub.createSpan({ cls: "ad-sess__cwd", text: truncate(s.cwd, 34) });
    if (s.step) {
      sub.createSpan({ text: "\xB7" });
      sub.createSpan({ cls: "ad-sess__step", text: truncate(s.step, 34) });
    }
    sub.createSpan({ text: "\xB7" });
    sub.createSpan({ text: timeAgo(s.lastAt) });
    if (s.tokens) {
      sub.createSpan({ text: "\xB7" });
      sub.createSpan({ cls: "ad-sess__tok", text: fmtTok(s.tokens) + " tok" });
    }
    if (child) {
      const kin = body.createDiv({ cls: "ad-sess__kin" });
      kin.createSpan({ cls: "ad-sess__kinmark", text: "\u21B3" });
      kin.createSpan({ cls: "ad-sess__kintitle", text: `\u4ECE\u300C${truncate(s.parentTitle || "\u6BCD\u4F1A\u8BDD", 24)}\u300D\u5F00\u51FA` });
      if (s.deskTitle && s.deskTitle !== s.title) kin.title = `\u684C\u9762\u7248\u91CC\u7684\u6807\u9898\uFF1A${s.deskTitle}`;
    }
    const go = card.createEl("button", { cls: "ad-arrow", attr: { "aria-label": "\u6253\u5F00\u4F1A\u8BDD" } });
    setLucide(go.createSpan({ cls: "ad-arrow__icon" }), "arrow-up-right");
    const open = () => p.openSession(s.agent, s.sid, s.app, s);
    go.onclick = (e) => {
      e.stopPropagation();
      open();
    };
    card.onclick = open;
    card.title = "\u70B9\u51FB\u6253\u5F00\u4F1A\u8BDD \xB7 \u62D6\u5230\u7B14\u8BB0\u91CC\u7684\u4E00\u9879\u4E0A\u7ED1\u5B9A\uFF0C\u62D6\u5230\u7A7A\u884C\u4E0A\u65B0\u5EFA\u4E00\u9879";
    if (s.agent === "dsh") card.title += "\nDeepSeek Harness \u5F53\u524D\u53EA\u63D0\u4F9B dsh://open\uFF08\u805A\u7126\u5BA2\u6237\u7AEF\uFF09\uFF0C\u4F1A\u8BDD\u53F7\u4F1A\u590D\u5236\u5230\u526A\u8D34\u677F";
    if (s.agent === "claude" && s.app === "cli") card.title += p.settings.cliOpen === "desktop" ? "\n\u7EC8\u7AEF\u91CC\u7684 Claude Code\uFF1A\u5728 Claude \u684C\u9762\u7248\u6253\u5F00\uFF08\u8BBE\u7F6E\u91CC\u53EF\u4EE5\u6539\u56DE\u7EC8\u7AEF\uFF09" : "\n\u7EC8\u7AEF\u91CC\u7684 Claude Code\uFF1A\u5728\u7EC8\u7AEF\u65B0\u6807\u7B7E\u91CC claude --resume \u63A5\u7740\u804A";
  }
  // 刚委派出去的会话有了会话号：卡片从它的 Agent 卡片飞进「现在」
  playFly(dash) {
    const flying = this.plugin._flying;
    if (flying && Date.now() < flying.until) {
      const t = dash.querySelector(`.ad-nowlist .ad-sess[data-sid="${CSS.escape(flying.sid)}"]`);
      if (t) {
        t.style.opacity = "0";
        flying.target = t;
      }
    }
    const fly = this.plugin._fly;
    if (!fly) return;
    if (Date.now() - fly.at > 1e4) {
      this.plugin._fly = null;
      return;
    }
    const target = dash.querySelector(`.ad-nowlist .ad-sess[data-sid="${CSS.escape(fly.sid)}"]`);
    const from = dash.querySelector(`.ad-agentcard[data-agent="${fly.agent}"]`);
    if (!target || !from) return;
    this.plugin._fly = null;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      target.addClass("is-landed");
      return;
    }
    requestAnimationFrame(() => {
      const a = from.getBoundingClientRect(), b = target.getBoundingClientRect();
      if (!a.width || !b.width) return;
      const layer = document.body.createDiv({ cls: "ad-view ad-fly-layer" });
      const ghost = target.cloneNode(true);
      ghost.classList.add("ad-fly-ghost");
      Object.assign(ghost.style, { position: "fixed", left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px`, margin: "0", zIndex: "9999", pointerEvents: "none", transformOrigin: "top left" });
      layer.appendChild(ghost);
      target.style.opacity = "0";
      const flying2 = this.plugin._flying = { sid: fly.sid, until: Date.now() + 3e3, target };
      const sx = a.width / b.width, sy = a.height / b.height;
      const dx = a.left - b.left, dy = a.top - b.top;
      const anim = ghost.animate([
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.35 },
        { transform: `translate(${dx * 0.12}px, ${Math.min(-10, dy * 0.12)}px) scale(1.03)`, opacity: 1, offset: 0.62 },
        { transform: "none", opacity: 1 }
      ], { duration: 760, easing: "cubic-bezier(.22,.9,.24,1)" });
      const done = () => {
        layer.remove();
        const t = flying2.target || target;
        t.style.opacity = "";
        t.addClass("is-landed");
        if (this.plugin._flying === flying2) this.plugin._flying = null;
      };
      anim.onfinish = done;
      anim.oncancel = done;
    });
  }
  empty(parent, title, sub) {
    const e = parent.createDiv({ cls: "ad-empty" });
    e.createDiv({ cls: "ad-empty__title", text: title });
    e.createDiv({ cls: "ad-empty__sub", text: sub });
  }
};
function stateChip(s) {
  const st = s.state || "idle";
  if (st === "run") return { cls: "is-live", label: "\u5728\u8DD1" };
  if (st === "wait") return { cls: "is-wait", label: "\u7B49\u4F60" };
  if (st === "quiet") return { cls: "is-quiet", label: "\u5B89\u9759" };
  if (st === "error") return { cls: "is-error", label: "\u51FA\u9519" };
  if (st === "limit") return { cls: "is-error", label: "\u9650\u989D" };
  if (st === "needs-approval") return { cls: "is-wait", label: "\u7B49\u4F60\u5141\u8BB8" };
  if (st === "done") return { cls: "is-done", label: "\u5B8C\u6210" };
  if (st === "cancelled") return { cls: "is-quiet", label: "\u5DF2\u53D6\u6D88" };
  return null;
}

// src/settings.js
var import_obsidian3 = require("obsidian");
var HOTKEY_MOD_SYMBOL = { control: "\u2303", option: "\u2325", shift: "\u21E7", command: "\u2318", ctrl: "\u2303", alt: "\u2325", cmd: "\u2318" };
function hotkeyDisplay(spec) {
  const parts = String(spec || DEFAULTS.menuBarHotkey).split("+").map((x) => x.trim()).filter(Boolean);
  return parts.map((p) => HOTKEY_MOD_SYMBOL[p.toLowerCase()] || p.toUpperCase()).join("");
}
function hotkeyKeyFromEvent(event) {
  const key = String(event.key || "");
  if (/^[a-zA-Z]$/.test(key)) return key.toUpperCase();
  if (/^[0-9]$/.test(key)) return key;
  if (/^F([1-9]|1[0-2])$/i.test(key)) return key.toUpperCase();
  return null;
}
function hotkeySpecFromEvent(event, key) {
  const mods = [];
  if (event.ctrlKey) mods.push("control");
  if (event.altKey) mods.push("option");
  if (event.shiftKey) mods.push("shift");
  if (event.metaKey) mods.push("command");
  return [...mods, key].join("+");
}
var TABS = [
  ["agents", "Agents", "users"],
  ["delegate", "\u59D4\u6D3E", "send"],
  ["models", "Models", "layers"],
  ["tracking", "\u8FFD\u8E2A", "radar"],
  ["about", "\u5173\u4E8E", "info"]
];
var AgentDeckSettingsTab = class extends import_obsidian3.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.tab = "agents";
    this.draft = null;
    this.filter = "all";
    this.search = "";
  }
  display() {
    const { containerEl } = this;
    const active = (containerEl.ownerDocument || document).activeElement;
    const focusSearch = !!(active && active.classList && active.classList.contains("ad-search__input"));
    if (this._draftBar) {
      try {
        this._draftBar.remove();
      } catch {
      }
      this._draftBar = null;
    }
    containerEl.empty();
    containerEl.addClass("ad-settings");
    const s = this.plugin.settings;
    const head = containerEl.createDiv({ cls: "ad-set-head" });
    const brand = head.createDiv({ cls: "ad-brand" });
    const brandMark = brand.createSpan({ cls: "ad-brand__mark" });
    setLucide(brandMark, "wand-sparkles");
    const bt = brand.createDiv({ cls: "ad-brand__text" });
    bt.createDiv({ cls: "ad-brand__name", text: "Agent Deck" });
    bt.createDiv({ cls: "ad-brand__sub", text: "\u667A\u80FD\u4F53\u7532\u677F \xB7 v1.0.2" });
    const nav = containerEl.createDiv({ cls: "ad-set-nav" });
    const dirty = this.draft && JSON.stringify(this.draft) !== JSON.stringify(this.plugin.settings.models);
    for (const [id, label, icon] of TABS) {
      const text = id === "models" && dirty ? `${label} \xB7` : label;
      const b = nav.createEl("button", { cls: "ad-set-tab" + (this.tab === id ? " is-on" : "") + (id === "models" && dirty ? " is-dirty" : "") });
      const ic = b.createSpan({ cls: "ad-tabicon" });
      setLucide(ic, icon);
      b.createSpan({ text });
      b.onclick = () => {
        this.tab = id;
        this.display();
      };
    }
    const body = containerEl.createDiv({ cls: "ad-set-body" });
    if (this.tab === "agents") this.renderAgents(body);
    else if (this.tab === "delegate") this.renderDelegate(body);
    else if (this.tab === "models") this.renderModels(body);
    else if (this.tab === "tracking") this.renderTracking(body);
    else this.renderAbout(body);
    if (this.tab === "models") this.renderDraftBar(body);
    if (focusSearch) {
      const i = containerEl.querySelector(".ad-search__input");
      if (i) {
        i.focus();
        try {
          i.setSelectionRange(i.value.length, i.value.length);
        } catch {
        }
      }
    }
  }
  // ---------- shared bits ----------
  card(parent, title, sub) {
    const c = parent.createDiv({ cls: "ad-card" });
    if (title) {
      const h = c.createDiv({ cls: "ad-card__head" });
      h.createDiv({ cls: "ad-card__title", text: title });
      if (sub) h.createDiv({ cls: "ad-card__sub", text: sub });
    }
    return c;
  }
  row(parent, name, desc, right) {
    const r = parent.createDiv({ cls: "ad-row" });
    const left = r.createDiv({ cls: "ad-row__left" });
    left.createDiv({ cls: "ad-row__name", text: name });
    if (desc) left.createDiv({ cls: "ad-row__desc", text: desc });
    const rr = r.createDiv({ cls: "ad-row__right" });
    if (typeof right === "string") rr.createSpan({ cls: "ad-row__value", text: right });
    else if (right) rr.appendChild(right);
    return r;
  }
  toggle(parent, value, onChange, disabled = false) {
    const b = parent.createEl("button", { cls: "ad-switch" + (value ? " is-on" : "") + (disabled ? " is-disabled" : ""), attr: { role: "switch", "aria-checked": String(!!value) } });
    b.createSpan({ cls: "ad-switch__knob" });
    if (!disabled) b.onclick = () => onChange(!value);
    return b;
  }
  segmented(parent, options, value, onChange, cls = "") {
    const box = parent.createDiv({ cls: "ad-seg " + cls });
    for (const opt of options) {
      const b = box.createEl("button", { cls: "ad-seg__btn" + (opt.id === value ? " is-on" : ""), text: opt.label });
      b.title = opt.hint || "";
      b.onclick = () => onChange(opt.id);
    }
    return box;
  }
  textInput(parent, value, placeholder, onChange, cls = "") {
    const input = parent.createEl("input", { cls: "ad-input " + cls, attr: { value: value || "", placeholder: placeholder || "" } });
    input.onchange = () => onChange(input.value);
    return input;
  }
  numberInput(parent, value, min, max, onChange) {
    const input = parent.createEl("input", { cls: "ad-input ad-input--num", attr: { type: "number", value: String(value), min: String(min), max: String(max) } });
    input.onchange = () => {
      const n = Number(input.value);
      if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
    };
    return input;
  }
  bigButton(parent, label, onClick, cls = "") {
    const b = parent.createEl("button", { cls: "ad-btn " + cls, text: label });
    b.onclick = onClick;
    return b;
  }
  // ---------- Agents ----------
  renderAgents(body) {
    const p = this.plugin;
    const s = p.settings;
    this.card(body, "\u8981\u8FFD\u8E2A\u7684 Agent", "\u4E3B\u529B\u6700\u591A\u4E24\u4E2A\uFF1A\u5B83\u4EEC\u7684\u5168\u90E8\u5386\u53F2\u90FD\u4F1A\u8BFB\uFF1B\u5176\u4F59\u5F00\u7740\u7684\u53EA\u8BFB\u4ECA\u5929\u6709\u52A8\u9759\u7684\u4F1A\u8BDD\u3002");
    const grid = body.createDiv({ cls: "ad-set-agents" });
    for (const id of AGENT_ORDER) {
      const a = AGENTS[id];
      const enabled = p.agentEnabled(id);
      const primary = p.isPrimary(id);
      const card = grid.createDiv({ cls: `ad-agentcard is-set ${enabled ? "" : "is-off"} ${primary ? "is-primary" : ""}` });
      card.style.setProperty("--ad-agent", a.color);
      card.style.setProperty("--ad-agent-soft", a.soft);
      const top = card.createDiv({ cls: "ad-agentcard__top" });
      const mark = top.createDiv({ cls: "ad-agentcard__mark" });
      agentIcon(mark.createSpan({ cls: "ad-glyph" }), id);
      const nm = top.createDiv({ cls: "ad-agentcard__name" });
      nm.createDiv({ cls: "ad-agentcard__title", text: a.name });
      nm.createDiv({ cls: "ad-agentcard__where", text: a.where[1] });
      const star = top.createEl("button", { cls: "ad-star" + (primary ? " is-on" : "") });
      setLucide(star, primary ? "star" : "star-off");
      star.title = primary ? "\u53D6\u6D88\u4E3B\u529B" : "\u8BBE\u4E3A\u4E3B\u529B\uFF08\u6700\u591A\u4E24\u4E2A\uFF09";
      star.onclick = () => p.togglePrimary(id);
      const stats = card.createDiv({ cls: "ad-agentcard__stats" });
      const meta = p.usage.meta;
      const sessions = [...meta.values()].filter((x) => x.agent === id);
      stats.createSpan({ text: `${sessions.length} \u4E2A\u4F1A\u8BDD` });
      stats.createSpan({ cls: "ad-dot", text: "\xB7" });
      stats.createSpan({ text: fmtTok(sessions.reduce((n, x) => n + (x.out || 0), 0)) + " tok" });
      const foot = card.createDiv({ cls: "ad-agentcard__foot" });
      const state = p.agentEnabled(id) ? "\u8FFD\u8E2A\u4E2D" : "\u5DF2\u5173\u95ED";
      this.toggle(foot, enabled, (v) => p.setAgentEnabled(id, v), primary);
      foot.createSpan({ cls: "ad-muted", text: primary ? "\u4E3B\u529B\uFF08\u5168\u91CF\uFF09" : state });
      const path6 = card.createDiv({ cls: "ad-set-path", text: a.where[0] });
    }
    const bar = body.createDiv({ cls: "ad-btnrow" });
    this.bigButton(bar, "\u7ACB\u5373\u626B\u63CF", () => p.scanNow(true), "mod-cta");
    this.bigButton(bar, "\u5BFC\u5165\u87BA\u65CB\u65E5\u7A0B\u7684\u5386\u53F2", () => p.importNautilus());
    const info = this.card(body, "\u672C\u673A\u65E5\u5FD7", "\u53EA\u8BFB\uFF0C\u4E0D\u4E0A\u4F20\u3002DeepSeek Harness \u7684\u4F1A\u8BDD\u662F zstd \u538B\u7F29\u7684 JSONL\uFF0C\u63D2\u4EF6\u5185\u7F6E\u4E86\u89E3\u538B\u5668\u3002");
    const paths = info.createDiv({ cls: "ad-pathlist" });
    for (const [id, a] of Object.entries(AGENTS)) {
      const r = paths.createDiv({ cls: "ad-pathrow" });
      agentIcon(r.createSpan({ cls: "ad-glyph", attr: { style: `color:${a.color}` } }), id);
      r.createSpan({ cls: "ad-pathrow__name", text: a.name });
      r.createSpan({ cls: "ad-pathrow__path", text: a.where[0] });
      r.createSpan({ cls: "ad-muted", text: p.agentEnabled(id) ? "\u8BFB" : "\u4E0D\u8BFB" });
    }
    const errs = p.usage.errors || [];
    if (errs.length) {
      const e = this.card(body, "\u8BFB\u65E5\u5FD7\u65F6\u9047\u5230\u7684\u95EE\u9898", "\u901A\u5E38\u662F\u4E00\u4E2A\u6B63\u5728\u5199\u7684\u534A\u622A\u6587\u4EF6\uFF0C\u4E0B\u4E00\u8F6E\u4F1A\u81EA\u5DF1\u597D\u3002");
      for (const x of errs.slice(-6)) e.createDiv({ cls: "ad-error-line", text: `${x.path}: ${x.message}` });
    }
  }
  // ---------- Delegation ----------
  renderDelegate(body) {
    const p = this.plugin;
    const d = p.settings.delegate;
    this.card(body, "\u9ED8\u8BA4\u59D4\u6D3E\u5230", "\u4EFB\u52A1\u884C\u4E0A\u7684\u6309\u94AE\u4F1A\u76F4\u63A5\u7528\u8FD9\u91CC\u7684\u8BBE\u7F6E\u3002\u70B9\u6309\u94AE\u53F3\u8FB9\u7684 \u2304 \u53EF\u4EE5\u4E34\u65F6\u6539\u53C2\u6570\u3002");
    const targetRow = body.createDiv({ cls: "ad-targetpick" });
    for (const id of ["claude", "dsh"]) {
      const a = AGENTS[id];
      const b = targetRow.createEl("button", { cls: "ad-target" + (d.target === id ? " is-on" : "") });
      b.style.setProperty("--ad-agent", a.color);
      b.style.setProperty("--ad-agent-soft", a.soft);
      agentIcon(b.createSpan({ cls: "ad-glyph" }), id);
      b.createSpan({ text: a.name });
      b.createSpan({ cls: "ad-target__hint", text: id === "claude" ? "\u684C\u9762\u7248 / \u540E\u53F0" : "ACP / \u81EA\u5E26\u8D26\u53F7" });
      b.onclick = async () => {
        d.target = id;
        await p.saveSettings();
        this.display();
      };
    }
    const claude = this.card(body, "Claude Code", "\u540E\u53F0\u5F00\u4E00\u4E2A\u4F1A\u8BDD\uFF0C\u7B54\u5B8C\u4E00\u8F6E\u53EF\u4EE5\u70B9\u5F00\u8FDB\u5165 Claude \u684C\u9762\u7248\u3002\u6A21\u578B\u3001\u5F3A\u5EA6\u3001\u6743\u9650\u6A21\u5F0F\u90FD\u4F1A\u4F20\u7ED9 claude \u547D\u4EE4\u884C\u3002");
    const cModel = this.modelSelect(claude, "claude", d.claude.model, (v) => {
      d.claude.model = v;
      p.saveSettings();
      this.display();
    });
    this.effortControl(claude, "claude", d.claude.effort, (v) => {
      d.claude.effort = v;
      p.saveSettings();
    });
    const permRow = this.row(claude, "\u6743\u9650\u6A21\u5F0F", "plan = \u53EA\u51FA\u65B9\u6848\u4E0D\u52A8\u624B\uFF1Bauto = \u8BA9 Claude \u81EA\u5DF1\u5224\u65AD\uFF1BacceptEdits = \u81EA\u52A8\u63A5\u53D7\u6539\u6587\u4EF6\u3002", null);
    this.segmented(permRow.querySelector(":scope > .ad-row__right"), CLAUDE_PERMISSIONS, d.claude.permission, (v) => {
      d.claude.permission = v;
      p.saveSettings();
      this.display();
    });
    const cwdRow = this.row(claude, "\u5DE5\u4F5C\u76EE\u5F55", "\u7559\u7A7A = \u5F53\u524D\u5E93\u6839\u76EE\u5F55\u3002Claude \u7684\u4F1A\u8BDD\u65E5\u5FD7\u6309\u76EE\u5F55\u5206\u5F00\u3002", null);
    this.textInput(cwdRow.querySelector(":scope > .ad-row__right"), d.claude.cwd, "\u7559\u7A7A = \u5E93\u6839\u76EE\u5F55", (v) => {
      d.claude.cwd = v.trim();
      p.saveSettings();
    }, "ad-input--wide");
    const addVault = this.row(claude, "\u628A\u5F53\u524D\u5E93\u4E5F\u52A0\u8FDB\u53EF\u8BFB\u76EE\u5F55", "\u4F20 --add-dir\uFF0C\u4EFB\u52A1\u91CC\u5F15\u7528\u7B14\u8BB0\u65F6 Claude \u80FD\u8BFB\u5230\u3002", null);
    this.toggle(addVault.querySelector(":scope > .ad-row__right"), d.claude.addVault !== false, (v) => {
      d.claude.addVault = v;
      p.saveSettings();
    });
    const openDesk = this.row(claude, "\u5B8C\u6210\u540E\u81EA\u52A8\u5728\u684C\u9762\u7248\u6253\u5F00", "\u4E0D\u6253\u5F00\u7684\u8BDD\uFF0C\u4EFB\u52A1\u884C\u4E0A\u7684\u6309\u94AE\u4F1A\u7559\u5728\u90A3\u513F\u7B49\u4F60\u70B9\u3002", null);
    this.toggle(openDesk.querySelector(":scope > .ad-row__right"), d.claude.openDesktop === true, (v) => {
      d.claude.openDesktop = v;
      p.saveSettings();
    });
    const bg = this.row(claude, "\u4F7F\u7528 claude --bg \u540E\u53F0\u670D\u52A1", "\u6253\u5F00\u540E\u4F1A\u8BDD\u7531 Claude \u7684\u540E\u53F0 daemon \u6258\u7BA1\uFF0C\u80FD\u5728 claude agents \u91CC\u770B\u5230\uFF1B\u6709\u4E9B\u7248\u672C daemon \u4F1A\u6389\uFF0C\u6389\u7EBF\u65F6\u63D2\u4EF6\u4F1A\u81EA\u52A8\u6539\u7528\u65E0\u5934\u4F1A\u8BDD\u3002\u9ED8\u8BA4\u5173\uFF1A\u65E0\u5934\u4F1A\u8BDD\u6700\u7A33\u3002", null);
    this.toggle(bg.querySelector(":scope > .ad-row__right"), d.claude.useBackground === true, (v) => {
      d.claude.useBackground = v;
      p.saveSettings();
    });
    const trust = this.row(claude, "\u5E93\u6CA1\u88AB\u4FE1\u4EFB\u65F6\u81EA\u52A8\u6362\u4E2A\u76EE\u5F55", "Claude Code \u53EA\u5728\u81EA\u5DF1\u4FE1\u4EFB\u8FC7\u7684\u76EE\u5F55\u91CC\u8DD1\u3002\u6253\u5F00\u540E\uFF0C\u5982\u679C\u5E93\u672C\u8EAB\u6CA1\u6709\u4FE1\u4EFB\u8BB0\u5F55\uFF0C\u63D2\u4EF6\u4F1A\u4ECE ~/.claude.json \u91CC\u627E\u4E00\u4E2A\u5DF2\u4FE1\u4EFB\u7684\u76EE\u5F55\u5F53\u5DE5\u4F5C\u76EE\u5F55\uFF0C\u5E76\u628A\u5E93\u7528 --add-dir \u52A0\u8FDB\u53BB\u3002\u5173\u6389\u5C31\u4E25\u683C\u7528\u4E0A\u9762\u7684\u76EE\u5F55\u3002", null);
    this.toggle(trust.querySelector(":scope > .ad-row__right"), d.claude.autoTrustedCwd !== false, (v) => {
      d.claude.autoTrustedCwd = v;
      p.saveSettings();
    });
    const extra = this.row(claude, "\u989D\u5916\u53C2\u6570", "\u4F8B\u5982 --dangerously-skip-permissions\uFF1B\u4F1A\u539F\u6837\u62FC\u5728 claude \u540E\u9762\u3002", null);
    this.textInput(extra.querySelector(":scope > .ad-row__right"), d.claude.extraArgs, "\u53EF\u7559\u7A7A", (v) => {
      d.claude.extraArgs = v;
      p.saveSettings();
    }, "ad-input--wide");
    const test = claude.createDiv({ cls: "ad-btnrow" });
    this.bigButton(test, "\u68C0\u67E5 claude", async () => {
      const r = await p.checkBinary("claude");
      new import_obsidian3.Notice(r, 6e3);
    });
    this.bigButton(test, "\u5728\u7EC8\u7AEF\u91CC\u7EED\u8FD9\u4E2A\u76EE\u5F55", () => p.openTerminalAt(d.claude.cwd || p.vaultPath, "claude"));
    const dsh = this.card(body, "DeepSeek Harness", "\u901A\u8FC7 dsh acp \u5F00\u4E00\u4E2A\u771F\u6B63\u7684 Harness \u4F1A\u8BDD\uFF0C\u53EF\u4EE5\u7528\u6A21\u578B\u548C\u63A8\u7406\u5F3A\u5EA6\u3002\u56DE\u7B54\u5B8C\u4F1A\u5199\u8FDB\u4F1A\u8BDD\u65E5\u5FD7\uFF0C\u4E5F\u4F1A\u88AB\u8FFD\u8E2A\u3002");
    this.modelSelect(dsh, "dsh", d.dsh.model, (v) => {
      d.dsh.model = v;
      p.saveSettings();
      this.display();
    });
    this.effortControl(dsh, "dsh", d.dsh.effort, (v) => {
      d.dsh.effort = v;
      p.saveSettings();
    });
    const route = this.row(dsh, "\u81EA\u52A8\u5141\u8BB8\u5DE5\u5177\u8C03\u7528", "ACP \u6A21\u5F0F\u4E0B Harness \u4F1A\u628A\u6743\u9650\u8BF7\u6C42\u53D1\u56DE\u63D2\u4EF6\u3002\u6253\u5F00 = \u81EA\u52A8\u5141\u8BB8\u4E00\u6B21\uFF1B\u5173\u6389 = \u62D2\u7EDD\u5E76\u5728\u901A\u77E5\u91CC\u63D0\u9192\u4F60\u3002", null);
    this.toggle(route.querySelector(":scope > .ad-row__right"), d.dsh.autoApprove === true, (v) => {
      d.dsh.autoApprove = v;
      p.saveSettings();
    });
    const dcwd = this.row(dsh, "\u5DE5\u4F5C\u76EE\u5F55", "\u7559\u7A7A = \u5F53\u524D\u5E93\u6839\u76EE\u5F55\u3002", null);
    this.textInput(dcwd.querySelector(":scope > .ad-row__right"), d.dsh.cwd, "\u7559\u7A7A = \u5E93\u6839\u76EE\u5F55", (v) => {
      d.dsh.cwd = v.trim();
      p.saveSettings();
    }, "ad-input--wide");
    const dextra = this.row(dsh, "\u989D\u5916 ACP \u53C2\u6570", "\u76EE\u524D\u4E0D\u7528\u586B\uFF1B\u7559\u7ED9\u4EE5\u540E\u7248\u672C\u3002", null);
    this.textInput(dextra.querySelector(":scope > .ad-row__right"), d.dsh.extraArgs, "\u53EF\u7559\u7A7A", (v) => {
      d.dsh.extraArgs = v;
      p.saveSettings();
    }, "ad-input--wide");
    const dtest = dsh.createDiv({ cls: "ad-btnrow" });
    this.bigButton(dtest, "\u68C0\u67E5 dsh", async () => {
      const r = await p.checkBinary("dsh");
      new import_obsidian3.Notice(r, 6e3);
    });
    const prompt = this.card(body, "\u63D0\u793A\u8BCD\u524D\u540E\u7F00", "\u6BCF\u6B21\u59D4\u6D3E\u4F1A\u628A\u8FD9\u4E00\u5757\uFF08\u8FDE\u540C\u5B50\u5757\uFF09\u539F\u6837\u53D1\u8FC7\u53BB\uFF0C\u8FD9\u91CC\u7684\u5185\u5BB9\u52A0\u5728\u524D\u540E\u3002");
    const pre = prompt.createDiv({ cls: "ad-field" });
    pre.createDiv({ cls: "ad-field__label", text: "\u524D\u7F00" });
    const preTa = pre.createEl("textarea", { cls: "ad-textarea", attr: { placeholder: "\u4F8B\u5982\uFF1A\u5148\u8BFB\u4E00\u4E0B\u76F8\u5173\u6587\u4EF6\uFF0C\u518D\u52A8\u624B\u3002", rows: "2" } });
    preTa.value = d.promptPrefix || "";
    preTa.onchange = () => {
      d.promptPrefix = preTa.value;
      p.saveSettings();
    };
    const suf = prompt.createDiv({ cls: "ad-field" });
    suf.createDiv({ cls: "ad-field__label", text: "\u540E\u7F00" });
    const sufTa = suf.createEl("textarea", { cls: "ad-textarea", attr: { placeholder: "\u4F8B\u5982\uFF1A\u505A\u5B8C\u628A\u6539\u52A8\u6587\u4EF6\u5217\u51FA\u6765\u3002", rows: "2" } });
    sufTa.value = d.promptSuffix || "";
    sufTa.onchange = () => {
      d.promptSuffix = sufTa.value;
      p.saveSettings();
    };
    const beh = this.card(body, "\u5199\u56DE\u7B14\u8BB0", "\u59D4\u6D3E\u5F00\u59CB\u540E\uFF0C\u5728\u4EFB\u52A1\u4E0B\u9762\u5199\u4E00\u884C \u{1F517}\uFF1B\u5B8C\u6210\u540E\u5199\u4E00\u884C \u{1F4AC}\u3002");
    const r1 = this.row(beh, "\u628A\u72B6\u6001\u6539\u6210 DELEGATED", "\u4FDD\u7559\u539F\u6765\u7684\u65F6\u523B\u548C\u4F18\u5148\u7EA7\u3002", null);
    this.toggle(r1.querySelector(":scope > .ad-row__right"), d.markStatus !== false, (v) => {
      d.markStatus = v;
      p.saveSettings();
    });
    const r2 = this.row(beh, "\u5199 \u{1F517} \u7ED1\u5B9A\u884C", "\u5220\u9664\u8FD9\u4E00\u884C\u5C31\u7B49\u4E8E\u89E3\u9664\u7ED1\u5B9A\u3002", null);
    this.toggle(r2.querySelector(":scope > .ad-row__right"), d.writeLink !== false, (v) => {
      d.writeLink = v;
      p.saveSettings();
    });
    const r3 = this.row(beh, "\u5B8C\u6210\u540E\u5199 \u{1F4AC} \u7ED3\u8BBA", "\u628A Agent \u6700\u540E\u8BF4\u7684\u8BDD\u538B\u6210\u4E00\u884C\u3002", null);
    this.toggle(r3.querySelector(":scope > .ad-row__right"), p.settings.autoWriteResult !== false, (v) => {
      p.settings.autoWriteResult = v;
      p.saveSettings();
    });
    const r4 = this.row(beh, "\u{1F4AC} \u6700\u591A\u591A\u5C11\u4E2A\u5B57", "", null);
    this.numberInput(r4.querySelector(":scope > .ad-row__right"), p.settings.resultMax || 240, 40, 2e3, (v) => {
      p.settings.resultMax = v;
      p.saveSettings();
    });
  }
  modelSelect(parent, agent, value, onChange) {
    const row = this.row(parent, "\u6A21\u578B", "\u53EA\u5217\u5F00\u542F\u7684\u6A21\u578B\uFF1B\u66F4\u591A\u5728 Models \u9875\u91CC\u7BA1\u7406\u3002", null);
    const sel = row.querySelector(":scope > .ad-row__right").createEl("select", { cls: "ad-select" });
    const models = this.plugin.modelsFor(agent).filter((m) => this.plugin.modelEnabled(m.id));
    if (!models.length) models.push(...this.plugin.modelsFor(agent));
    for (const m of models) {
      const o = sel.createEl("option", { text: m.name, attr: { value: m.id } });
      if (m.id === value) o.selected = true;
    }
    sel.onchange = () => onChange(sel.value);
    return sel;
  }
  effortControl(parent, agent, value, onChange) {
    const row = this.row(parent, "\u9ED8\u8BA4\u5F3A\u5EA6", "", null);
    const right = row.querySelector(":scope > .ad-row__right");
    const wrap = right.createDiv({ cls: "ad-effort" });
    const opts = EFFORTS[agent] || EFFORTS.claude;
    const track = wrap.createDiv({ cls: "ad-effort__track" });
    const fill2 = track.createDiv({ cls: "ad-effort__fill" });
    const stops = track.createDiv({ cls: "ad-effort__stops" });
    const idx = Math.max(0, opts.findIndex((x) => x.id === value));
    fill2.style.width = `${idx / Math.max(1, opts.length - 1) * 100}%`;
    opts.forEach((o, i) => {
      const b = stops.createEl("button", { cls: "ad-effort__stop" + (o.id === value ? " is-on" : ""), attr: { title: o.hint || "" } });
      b.createSpan({ cls: "ad-effort__dot" });
      b.onclick = () => onChange(o.id);
      const lab = wrap.createEl("span", { cls: "ad-effort__lab", attr: { style: `left:${i / Math.max(1, opts.length - 1) * 100}%` }, text: o.label });
    });
  }
  // ---------- Models ----------
  modelsDraft() {
    if (!this.draft) this.draft = JSON.parse(JSON.stringify(this.plugin.settings.models));
    if (!this.draft.enabled) this.draft.enabled = [];
    if (!this.draft.pinned) this.draft.pinned = [];
    if (!this.draft.order) this.draft.order = [];
    if (!this.draft.custom) this.draft.custom = [];
    if (!this.draft.defaultByAgent) this.draft.defaultByAgent = { claude: "claude-sonnet-5", dsh: "deepseek-v4-pro" };
    return this.draft;
  }
  renderModels(body) {
    const p = this.plugin;
    const d = this.modelsDraft();
    const target = p.settings.delegate.target === "dsh" ? "dsh" : "claude";
    const models = p.allModels(d.custom);
    const enabled = new Set(d.enabled);
    const byId = new Map(models.map((m) => [m.id, m]));
    const defaultId = d.defaultByAgent[target] || (target === "dsh" ? "deepseek-v4-pro" : "claude-sonnet-5");
    const def = byId.get(defaultId) || models.find((m) => m.agent === target) || models[0];
    const intro = body.createDiv({ cls: "ad-models-intro" });
    intro.createDiv({ cls: "ad-models-title", text: "Models" });
    intro.createDiv({ cls: "ad-models-sub", text: "\u54EA\u4E9B\u6A21\u578B\u51FA\u73B0\u5728\u59D4\u6D3E\u6309\u94AE\u91CC\uFF0C\u6BCF\u6B21\u4ECE\u54EA\u91CC\u5F00\u59CB\uFF0C\u4EE5\u53CA\u5B83\u60F3\u591A\u6DF1\u3002" });
    const defaults = body.createDiv({ cls: "ad-models-card" });
    const dhead = defaults.createDiv({ cls: "ad-models-sec" });
    dhead.createSpan({ cls: "ad-kicker", text: "Defaults" });
    const targetSeg = defaults.createDiv({ cls: "ad-models-target" });
    for (const id of ["claude", "dsh"]) {
      const a = AGENTS[id];
      const b = targetSeg.createEl("button", { cls: "ad-target ad-target--sm" + (target === id ? " is-on" : "") });
      b.style.setProperty("--ad-agent", a.color);
      b.style.setProperty("--ad-agent-soft", a.soft);
      agentIcon(b.createSpan({ cls: "ad-glyph" }), id);
      b.createSpan({ text: a.short });
      b.onclick = () => {
        p.settings.delegate.target = id;
        p.saveSettings();
        this.display();
      };
    }
    const defRow = defaults.createDiv({ cls: "ad-defrow" });
    const defLeft = defRow.createDiv({ cls: "ad-defrow__left" });
    defLeft.createDiv({ cls: "ad-defrow__name", text: "Default model" });
    defLeft.createDiv({ cls: "ad-defrow__desc", text: "New delegations start with this model." });
    const defRight = defRow.createDiv({ cls: "ad-defrow__right" });
    const pill = defRight.createEl("select", { cls: "ad-modelpill" });
    const candidates = models.filter((m) => m.agent === target && enabled.has(m.id));
    const pool = candidates.length ? candidates : models.filter((m) => m.agent === target);
    for (const m of pool) {
      const o = pill.createEl("option", { text: m.name, attr: { value: m.id } });
      if (m.id === def.id) o.selected = true;
    }
    pill.onchange = () => {
      d.defaultByAgent[target] = pill.value;
      this.display();
    };
    if (def) {
      const meta = defaults.createDiv({ cls: "ad-modelmeta" });
      meta.createSpan({ text: def.context });
      meta.createSpan({ cls: "ad-dot", text: "\xB7" });
      meta.createSpan({ text: strength(def.strength) });
      meta.createSpan({ cls: "ad-dot", text: "\xB7" });
      for (const tag of def.tags || []) meta.createSpan({ cls: "ad-cap", text: tag });
      if (def.cost) meta.createSpan({ cls: "ad-cost", text: def.cost });
      if (def.note) defaults.createDiv({ cls: "ad-defnote", text: def.note });
    }
    const eff = defaults.createDiv({ cls: "ad-defrow ad-defrow--effort" });
    const effLeft = eff.createDiv({ cls: "ad-defrow__left" });
    effLeft.createDiv({ cls: "ad-defrow__name", text: "Default effort" });
    effLeft.createDiv({ cls: "ad-defrow__desc", text: "How long the model thinks before it answers. You can change it per delegation." });
    const effRight = eff.createDiv({ cls: "ad-defrow__right ad-effort ad-effort--big" });
    const eopts = EFFORTS[target] || EFFORTS.claude;
    const evalue = d.effort || "high";
    const eidx = Math.max(0, eopts.findIndex((x) => x.id === evalue));
    const etrack = effRight.createDiv({ cls: "ad-effort__track" });
    etrack.createDiv({ cls: "ad-effort__fill" }).style.width = `${eidx / Math.max(1, eopts.length - 1) * 100}%`;
    const estops = etrack.createDiv({ cls: "ad-effort__stops" });
    eopts.forEach((o, i) => {
      const b = estops.createEl("button", { cls: "ad-effort__stop" + (o.id === evalue ? " is-on" : ""), attr: { title: o.hint || "" } });
      b.createSpan({ cls: "ad-effort__dot" });
      b.onclick = () => {
        d.effort = o.id;
        this.display();
      };
      const lab = effRight.createSpan({ cls: "ad-effort__lab", attr: { style: `left:${i / Math.max(1, eopts.length - 1) * 100}%` }, text: o.label });
    });
    const rec = effRight.createDiv({ cls: "ad-effort__rec" });
    rec.createSpan({ text: "Recommended" });
    const adv = rec.createEl("select", { cls: "ad-advselect" });
    for (const o of eopts) adv.createEl("option", { text: o.label, attr: { value: o.id } });
    adv.value = evalue;
    adv.onchange = () => {
      d.effort = adv.value;
      this.display();
    };
    const picker = body.createDiv({ cls: "ad-models-card" });
    const phead = picker.createDiv({ cls: "ad-models-sec" });
    phead.createSpan({ cls: "ad-kicker", text: "Model picker" });
    phead.createSpan({ cls: "ad-models-sec__sub", text: "Choose which models show up when you delegate." });
    const tools = picker.createDiv({ cls: "ad-picker-tools" });
    const searchWrap = tools.createDiv({ cls: "ad-search" });
    searchWrap.createSpan({ cls: "ad-search__icon", text: "\u2315" });
    const search = searchWrap.createEl("input", { cls: "ad-search__input", attr: { placeholder: "Search models", value: this.search } });
    search.oninput = () => {
      this.search = search.value;
      this.display();
    };
    const add = tools.createEl("button", { cls: "ad-btn ad-btn--soft", text: "\uFF0B Add model" });
    add.onclick = () => new AddModelModal(this.app, p, (m) => {
      d.custom.push(m);
      if (!d.enabled.includes(m.id)) d.enabled.push(m.id);
      if (!d.order.includes(m.id)) d.order.push(m.id);
      this.display();
    }).open();
    const filters = picker.createDiv({ cls: "ad-filters ad-filters--models" });
    for (const [id, label] of [["all", "All"], ["enabled", "Enabled"], ["reasoning", "Reasoning"], ["fast", "Fast"], ["vision", "Vision"]]) {
      const b = filters.createEl("button", { cls: "ad-chip" + (this.filter === id ? " is-on" : ""), text: label });
      b.onclick = () => {
        this.filter = id;
        this.display();
      };
    }
    const list = picker.createDiv({ cls: "ad-modellist" });
    const q = this.search.trim().toLowerCase();
    let visible = models.filter((m) => {
      if (this.filter === "enabled" && !enabled.has(m.id)) return false;
      if (this.filter === "reasoning" && !(m.tags || []).includes("Reasoning")) return false;
      if (this.filter === "fast" && !(m.tags || []).includes("Fast")) return false;
      if (this.filter === "vision" && !(m.tags || []).includes("Vision")) return false;
      if (q && !`${m.name} ${m.provider} ${(m.tags || []).join(" ")}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const pinned = d.pinned.map((id) => visible.find((m) => m.id === id)).filter(Boolean);
    const rest = visible.filter((m) => !d.pinned.includes(m.id));
    if (pinned.length) {
      const g = list.createDiv({ cls: "ad-modelgroup" });
      const gh = g.createDiv({ cls: "ad-modelgroup__head" });
      gh.createSpan({ text: "Pinned" });
      this.groupAction(gh, pinned, d, true);
      for (const m of pinned) this.modelRow(g, m, d, target, defaultId, true);
    }
    for (const agent of ["claude", "dsh"]) {
      const rows = rest.filter((m) => m.agent === agent);
      if (!rows.length) continue;
      const g = list.createDiv({ cls: "ad-modelgroup" });
      const gh = g.createDiv({ cls: "ad-modelgroup__head" });
      const a = AGENTS[agent];
      agentIcon(gh.createSpan({ cls: "ad-glyph", attr: { style: `color:${a.color}` } }), agent);
      gh.createSpan({ text: a.name });
      gh.createSpan({ cls: "ad-muted", text: `${rows.filter((m) => enabled.has(m.id)).length} of ${rows.length} on` });
      this.groupAction(gh, rows, d, false);
      for (const m of rows) this.modelRow(g, m, d, target, defaultId, false);
    }
    if (!pinned.length && !rest.length) {
      list.createDiv({ cls: "ad-empty ad-empty--small", text: "\u6CA1\u6709\u7B26\u5408\u6761\u4EF6\u7684\u6A21\u578B" });
    }
    const note = picker.createDiv({ cls: "ad-models-note", text: "Pinned models show first. Reorder from the row menu or with Alt + \u2191/\u2193." });
    const tasks = body.createDiv({ cls: "ad-models-card" });
    const th = tasks.createDiv({ cls: "ad-models-sec" });
    th.createSpan({ cls: "ad-kicker", text: "Task models" });
    th.createSpan({ cls: "ad-models-sec__sub", text: "Smaller jobs that run behind a delegation." });
    for (const [id, label, desc] of [
      ["delegate", "Delegation", "Default for a task delegated from the editor."],
      ["naming", "Chat titles", "Used when the agent names a session it opened."],
      ["summary", "Summaries", "Used for the one-line result written under a task."]
    ]) {
      const row = tasks.createDiv({ cls: "ad-taskrow" });
      const left = row.createDiv({ cls: "ad-taskrow__left" });
      left.createDiv({ cls: "ad-taskrow__name", text: label });
      left.createDiv({ cls: "ad-taskrow__desc", text: desc });
      const sel = row.createEl("select", { cls: "ad-select ad-select--sm" });
      sel.createEl("option", { text: "Auto", attr: { value: "auto" } });
      for (const m of models) sel.createEl("option", { text: m.name, attr: { value: m.id } });
      sel.value = d.taskModels?.[id] || "auto";
      sel.onchange = () => {
        d.taskModels = { ...d.taskModels || {}, [id]: sel.value };
        this.display();
      };
    }
    const foot = tasks.createDiv({ cls: "ad-models-note", text: "Auto lets the chosen agent decide. The model picker above is shared by both Claude Code and DeepSeek Harness." });
  }
  groupAction(head, rows, d, pinned) {
    const allOn = rows.every((m) => d.enabled.includes(m.id));
    const b = head.createEl("button", { cls: "ad-linkbtn", text: allOn ? "Turn all off" : "Turn all on" });
    b.onclick = () => {
      for (const m of rows) {
        const i = d.enabled.indexOf(m.id);
        if (allOn && i >= 0) d.enabled.splice(i, 1);
        if (!allOn && i < 0) d.enabled.push(m.id);
      }
      this.display();
    };
  }
  modelRow(parent, m, d, target, defaultId, pinned) {
    const on = d.enabled.includes(m.id);
    const row = parent.createDiv({ cls: "ad-modelrow" + (on ? "" : " is-off") });
    row.tabIndex = 0;
    row.dataset.id = m.id;
    const left = row.createDiv({ cls: "ad-modelrow__left" });
    const name = left.createDiv({ cls: "ad-modelrow__name" });
    name.createSpan({ text: m.name });
    if (m.id === defaultId) name.createSpan({ cls: "ad-badge", text: "Default" });
    if (m.agent === target) name.createSpan({ cls: "ad-badge ad-badge--soft", text: AGENTS[m.agent].short });
    const meta = left.createDiv({ cls: "ad-modelrow__meta" });
    meta.createSpan({ text: m.context });
    meta.createSpan({ cls: "ad-dot", text: "\xB7" });
    meta.createSpan({ text: strength(m.strength, true) });
    meta.createSpan({ cls: "ad-dot", text: "\xB7" });
    for (const t of m.tags || []) meta.createSpan({ cls: "ad-cap", text: t });
    if (m.cost) meta.createSpan({ cls: "ad-cost", text: m.cost });
    const right = row.createDiv({ cls: "ad-modelrow__right" });
    this.toggle(right, on, (v) => {
      const i = d.enabled.indexOf(m.id);
      if (v && i < 0) d.enabled.push(m.id);
      if (!v && i >= 0) d.enabled.splice(i, 1);
      this.display();
    });
    const more = right.createEl("button", { cls: "ad-morebtn", text: "\u22EF" });
    more.onclick = (e) => {
      e.stopPropagation();
      const menu = new import_obsidian3.Menu();
      menu.addItem((it) => it.setTitle(pinned ? "Unpin" : "Pin").setIcon(pinned ? "pin-off" : "pin").onClick(() => {
        const i = d.pinned.indexOf(m.id);
        if (pinned && i >= 0) d.pinned.splice(i, 1);
        if (!pinned && i < 0) d.pinned.push(m.id);
        this.display();
      }));
      menu.addItem((it) => it.setTitle("Move up").setIcon("arrow-up").onClick(() => this.moveModel(d, m, -1)));
      menu.addItem((it) => it.setTitle("Move down").setIcon("arrow-down").onClick(() => this.moveModel(d, m, 1)));
      menu.addItem((it) => it.setTitle("Make default").setIcon("star").onClick(() => {
        d.defaultByAgent[m.agent] = m.id;
        this.display();
      }));
      if (m.custom || d.custom.some((x) => x.id === m.id)) {
        menu.addItem((it) => it.setTitle("Remove").setIcon("trash").onClick(() => {
          d.custom = d.custom.filter((x) => x.id !== m.id);
          d.enabled = d.enabled.filter((x) => x !== m.id);
          d.pinned = d.pinned.filter((x) => x !== m.id);
          this.display();
        }));
      }
      const ev = e;
      menu.showAtMouseEvent(ev);
    };
    row.addEventListener("keydown", (e) => {
      if (!e.altKey) return;
      if (e.key === "ArrowUp") {
        e.preventDefault();
        this.moveModel(d, m, -1);
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.moveModel(d, m, 1);
      }
    });
  }
  moveModel(d, m, dir) {
    const order = d.order.length ? d.order : this.plugin.allModels(d.custom).map((x) => x.id);
    const i = order.indexOf(m.id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    d.order = order;
    this.display();
  }
  renderDraftBar(parent) {
    const p = this.plugin;
    if (!this.draft) return;
    const a = JSON.stringify(this.draft);
    const b = JSON.stringify(p.settings.models);
    if (a === b) return;
    const bar = document.createElement("div");
    bar.className = "ad-draftbar ad-draftbar--inline";
    bar.createSpan({ cls: "ad-draftbar__text", text: "Unsaved changes" });
    const discard = bar.createEl("button", { cls: "ad-btn ad-btn--ghost", text: "Discard" });
    discard.onclick = () => {
      this.draft = JSON.parse(JSON.stringify(p.settings.models));
      this.display();
    };
    const save = bar.createEl("button", { cls: "ad-btn ad-btn--cta", text: "Save  \u2318S" });
    save.onclick = () => this.saveDraft();
    if (this._draftBar) {
      try {
        this._draftBar.remove();
      } catch {
      }
    }
    this._draftBar = bar;
    (parent || this.containerEl).prepend(bar);
    if (!this._draftKeyHandler) {
      this._draftKeyHandler = (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          this.saveDraft();
        }
      };
      this.app.scope.register(["Mod"], "s", (e) => {
        if (this.tab === "models") {
          e.preventDefault();
          this.saveDraft();
        }
      });
    }
  }
  saveDraft() {
    if (!this.draft) return;
    const p = this.plugin;
    p.settings.models = deepMerge(p.settings.models, this.draft);
    const dc = p.settings.delegate.claude, dd = p.settings.delegate.dsh;
    const cm = p.settings.models.defaultByAgent.claude;
    const dm = p.settings.models.defaultByAgent.dsh;
    if (cm) dc.model = cm;
    if (dm) dd.model = dm;
    if (p.settings.models.effort) {
      if (p.settings.delegate.claude.effort) p.settings.delegate.claude.effort = p.settings.models.effort;
      if (p.settings.delegate.dsh.effort) p.settings.delegate.dsh.effort = p.settings.models.effort;
    }
    p.saveSettings();
    new import_obsidian3.Notice("Models \u5DF2\u4FDD\u5B58");
    this.display();
  }
  // ---------- Tracking ----------
  renderTracking(body) {
    const p = this.plugin;
    const s = p.settings;
    const c = this.card(body, "\u65F6\u95F4\u4E0E\u626B\u63CF");
    const r1 = this.row(c, "\u65E5\u8BB0\u65E5\u671F\u5206\u754C", "\u8FD9\u4E2A\u65F6\u523B\u4E4B\u524D\u7B97\u524D\u4E00\u5929\u3002\u548C\u87BA\u65CB\u65E5\u7A0B\u4FDD\u6301\u4E00\u81F4\u3002", null);
    const cut = this.numberInput(r1.querySelector(":scope > .ad-row__right"), s.dayCutoff, 0, 12, (v) => {
      s.dayCutoff = v;
      p.saveSettings();
      p.scheduleScan();
    });
    const r2 = this.row(c, "\u6BCF\u9694\u51E0\u79D2\u626B\u63CF", "\u672C\u673A\u65E5\u5FD7\u7684\u8F6E\u8BE2\u95F4\u9694\u3002\u4F1A\u8BDD\u5C11\u7684\u65F6\u5019 20\u201330 \u79D2\u5C31\u591F\u3002", null);
    this.numberInput(r2.querySelector(":scope > .ad-row__right"), s.pollSeconds, 5, 300, (v) => {
      s.pollSeconds = v;
      p.saveSettings();
      p.scheduleScan();
    });
    const r3 = this.row(c, "\u591A\u4E45\u6CA1\u52A8\u7B97\u5B89\u9759", "\u548C\u4E0B\u4E00\u6BB5\u4E4B\u95F4\u8D85\u8FC7\u8FD9\u4E48\u591A\u5206\u949F\uFF0C\u5C31\u4E0D\u7B97\u540C\u4E00\u6BB5\u8FDE\u7EED\u5DE5\u4F5C\u3002", null);
    this.numberInput(r3.querySelector(":scope > .ad-row__right"), s.idleMinutes, 1, 120, (v) => {
      s.idleMinutes = v;
      p.saveSettings();
    });
    const r4 = this.row(c, "\u4E3B\u529B\u8BFB\u591A\u5C11\u5929\u5386\u53F2", "\u53EA\u5F71\u54CD\u4E3B\u529B\uFF1B\u975E\u4E3B\u529B\u53EA\u8BFB\u4ECA\u5929\u3002", null);
    this.numberInput(r4.querySelector(":scope > .ad-row__right"), s.fullHistoryDays, 1, 365, (v) => {
      s.fullHistoryDays = v;
      p.saveSettings();
      p.scanNow(true);
    });
    const desk = this.card(body, "Claude \u684C\u9762\u7248", "\u684C\u9762\u7248\u7ED9\u6BCF\u4E2A\u4F1A\u8BDD\u5B58\u4E00\u4EFD\u6E05\u5355\uFF08claude-code-sessions/<\u8D26\u53F7>/<\u7EC4\u7EC7>/local_*.json\uFF09\u3002\u4FA7\u680F\u91CC\u770B\u7740\u540C\u7EA7\u3001\u5176\u5B9E\u662F\u300C\u4ECE\u67D0\u4E2A\u4F1A\u8BDD\u5F00\u51FA\u6765\u300D\u7684 side chat\uFF0C\u53EA\u6709\u8FD9\u4EFD\u6E05\u5355\u91CC\u7684 spawnedFrom \u8BB0\u5F97\uFF1B\u7EC8\u7AEF\u91CC\u7684 claude \u6CA1\u6709\u8FD9\u4E00\u9879\u3002");
    const d1 = this.row(desk, "\u8BC6\u522B side chat \u548C\u6BCD\u5B50\u5173\u7CFB", "\u5B50\u4F1A\u8BDD\u5728\u9762\u677F\u91CC\u7F29\u8FDB\uFF0C\u6807\u51FA\u4ECE\u54EA\u4E2A\u4F1A\u8BDD\u5F00\u51FA\uFF1B\u987A\u624B\u770B\u6709\u54EA\u4E9B\u4F1A\u8BDD\u6B63\u5F00\u7740 side chat\u3002", null);
    this.toggle(d1.querySelector(":scope > .ad-row__right"), s.claudeDesktop !== false, (v) => {
      s.claudeDesktop = v;
      p.saveSettings();
      p.scanNow(true);
    });
    const dc = this.row(desk, "\u7EC8\u7AEF\u91CC\u7684\u4F1A\u8BDD\u70B9\u5F00\u5230\u54EA\u513F", "\u7EC8\u7AEF\u91CC\u8D77\u7684 Claude Code \u4F1A\u8BDD\uFF1A\u56DE\u7EC8\u7AEF\u63A5\u7740\u804A\uFF08\u65B0\u6807\u7B7E\u91CC cd \u5230\u4F1A\u8BDD\u76EE\u5F55\uFF0C\u8DD1 claude --resume\uFF09\uFF0C\u6216\u8005\u4E5F\u5728\u684C\u9762\u7248\u6253\u5F00\u3002\u88C5\u4E86 Warp \u9ED8\u8BA4\u7528 Warp\u3002", null);
    this.segmented(dc.querySelector(":scope > .ad-row__right"), [{ id: "terminal", label: "\u7EC8\u7AEF" }, { id: "desktop", label: "\u684C\u9762\u7248" }], s.cliOpen === "desktop" ? "desktop" : "terminal", (v) => {
      s.cliOpen = v;
      p.saveSettings();
      this.display();
    });
    const d2 = this.row(desk, "\u5F52\u6863\u7684\u4F1A\u8BDD\u4E0D\u518D\u5217\u51FA", "\u684C\u9762\u7248\u91CC\u5F52\u6863 = \u505A\u5B8C\uFF1A\u5F52\u6863\u7684\u4F1A\u8BDD\u4ECE\u300C\u73B0\u5728\u300D\u548C\u300C\u6700\u8FD1\u7684\u4F1A\u8BDD\u300D\u91CC\u6536\u8D77\u6765\uFF0C\u5386\u53F2\u7528\u91CF\u7167\u65E7\u4FDD\u7559\u3002", null);
    this.toggle(d2.querySelector(":scope > .ad-row__right"), s.hideArchived !== false, (v) => {
      s.hideArchived = v;
      p.saveSettings();
      p.refreshUI();
    });
    const jr = this.card(body, "\u81EA\u52A8\u8BB0\u65E5\u8BB0\uFF08\u4EBA\u673A\u5171\u5199\uFF09", "\u628A Agent \u4F1A\u8BDD\u5199\u56DE\u4ECA\u5929\u7684\u65E5\u8BB0\uFF1A\u65B0\u4F1A\u8BDD\u8BB0\u6210 DOING\uFF0C\u505C\u4E86\u4E00\u9635\u6539\u6210 PAUSED \u5E76\u628A\u5B9E\u9645\u65F6\u6BB5\u5199\u5728\u4E0B\u9762\uFF0C\u684C\u9762\u7248\u6216 Codex \u91CC\u5F52\u6863\u4E86\u8BB0\u6210 DONE\u3002\u540D\u5B57\u548C\u300C\u63A5\u5728\u54EA\u4E00\u884C\u300D\u95EE\u672C\u673A\u7684 claude \u547D\u4EE4\u884C\u3002\u53EA\u6539\u5B83\u81EA\u5DF1\u8BB0\u7740\u7684\u90A3\u51E0\u884C\uFF0C\u4F60\u624B\u6539\u8FC7\u7684\u72B6\u6001\u4E0D\u4F1A\u88AB\u4ED6\u63B0\u56DE\u53BB\u3002");
    const jf = this.row(jr, "\u65E5\u8BB0\u76EE\u5F55", "\u4ECA\u5929\u7684\u65E5\u8BB0\u662F\u300C\u76EE\u5F55/YYYY_MM_DD.md\u300D\uFF0C\u548C\u87BA\u65CB\u65E5\u7A0B\u7684\u9ED8\u8BA4\u4E00\u81F4\u3002", null);
    this.textInput(jf.querySelector(":scope > .ad-row__right"), s.journalFolder || "\u65E5\u8BB0", "\u65E5\u8BB0", (v) => {
      s.journalFolder = v.trim() || "\u65E5\u8BB0";
      p.saveSettings();
    });
    const ja = this.row(jr, "\u81EA\u52A8\u6574\u7406\u8FDB\u65E5\u8BB0", "\u6BCF\u9694\u4E00\u9635\u626B\u4E00\u904D\u4ECA\u5929\u5F00\u7740\u7684\u4F1A\u8BDD\uFF1B\u81EA\u52A8\u5173\u7740\u4E5F\u53EF\u4EE5\u7528\u547D\u4EE4\u300C\u6574\u7406 Agent \u4F1A\u8BDD\u8FDB\u4ECA\u5929\u7684\u65E5\u8BB0\u300D\u624B\u52A8\u8DD1\u3002", null);
    this.toggle(ja.querySelector(":scope > .ad-row__right"), s.autoLog === true, (v) => {
      s.autoLog = v;
      p.saveSettings();
    });
    const je = this.row(jr, "\u6BCF\u9694\u51E0\u5206\u949F", "\u81EA\u52A8\u6574\u7406\u7684\u95F4\u9694\uFF0C\u6700\u5C11 5 \u5206\u949F\u3002", null);
    this.numberInput(je.querySelector(":scope > .ad-row__right"), s.autoLogEvery || 20, 5, 240, (v) => {
      s.autoLogEvery = v;
      p.saveSettings();
    });
    const jm = this.row(jr, "\u6574\u7406\u7528\u7684\u6A21\u578B", "\u4F20\u7ED9 claude \u547D\u4EE4\u884C\u7684 --model\uFF1B\u9ED8\u8BA4 haiku\uFF0C\u5FEB\u4E14\u4FBF\u5B9C\u3002", null);
    this.textInput(jm.querySelector(":scope > .ad-row__right"), s.autoLogModel || "haiku", "haiku", (v) => {
      s.autoLogModel = v.trim() || "haiku";
      p.saveSettings();
    });
    const jd = this.row(jr, "\u5F52\u6863\u7684\u4F1A\u8BDD\u8BB0\u6210 DONE", "\u4F60\u5728 Claude \u684C\u9762\u7248\u6216 Codex \u91CC\u5F52\u6863\u4E00\u4E2A\u4F1A\u8BDD = \u8FD9\u4EF6\u4E8B\u505A\u5B8C\u4E86\uFF0C\u5B83\u90A3\u4E00\u884C\u8BB0\u6210 DONE\u3002\u684C\u9762\u7248\u5F00\u4E86\u81EA\u52A8\u5F52\u6863\u7684\u8BDD\u5C31\u5173\u6389\u8FD9\u4E2A\u3002", null);
    this.toggle(jd.querySelector(":scope > .ad-row__right"), s.autoLogArchiveDone !== false, (v) => {
      s.autoLogArchiveDone = v;
      p.saveSettings();
    });
    const js = this.row(jr, "\u56DE\u5199\u65E5\u8BB0", "\u65E5\u8BB0\u91CC \u{1F517} \u7ED1\u7740\u7684\u4F1A\u8BDD\uFF1A\u7B54\u5B8C\u5199 \u{1F4AC}\uFF0C\u72B6\u6001\u8DDF\u7740\u4F1A\u8BDD\u5207\uFF0C\u5F52\u6863\u8BB0 DONE\uFF0C\u5B50\u4F1A\u8BDD\u548C\u5F00\u7740\u7684 side chat \u5199\u6210\u5B50\u5757\u3002\u87BA\u65CB\u65E5\u7A0B\u7684 AI \u8FFD\u8E2A\u8FD8\u5F00\u7740\u65F6\u5148\u4E0D\u5199\uFF0C\u514D\u5F97\u4E24\u5957\u5199\u6CD5\u6253\u67B6\u3002", null);
    this.toggle(js.querySelector(":scope > .ad-row__right"), s.journalSync !== false, (v) => {
      s.journalSync = v;
      p.saveSettings();
    });
    for (const [key, label, desc] of [
      ["resultBack", "\u4F1A\u8BDD\u7ED3\u8BBA\u5199\u56DE\uFF08\u{1F4AC}\uFF09", "\u4F1A\u8BDD\u7B54\u5B8C\u4E00\u8F6E\u6216\u5F52\u6863\u65F6\uFF0C\u628A\u6700\u540E\u90A3\u6761\u56DE\u590D\u5199\u6210\u4EFB\u52A1\u4E0B\u9762\u7684\u4E00\u884C\u3002"],
      ["agentKw", "\u72B6\u6001\u5173\u952E\u8BCD\u8DDF\u7740\u4F1A\u8BDD", "\u5728 DOING / TOREVIEW / NEEDOK / ERRORED / HITLIMIT \u4E4B\u95F4\u8DDF\u7740\u4F1A\u8BDD\u5207\uFF1B\u4F60\u6539\u6210\u522B\u7684\u5C31\u4E0D\u78B0\u3002"],
      ["kidBlocks", "\u5B50\u4F1A\u8BDD\u548C side chat \u5B50\u5757", "\u684C\u9762\u7248\u91CC\u5F00\u51FA\u6765\u7684\u5B50\u4F1A\u8BDD\u3001\u5F00\u7740\u7684 side chat \u5199\u6210\u7F29\u8FDB\u5B50\u5757\u3002"]
    ]) {
      const row = this.row(jr, label, desc, null);
      this.toggle(row.querySelector(":scope > .ad-row__right"), s[key] !== false, (v) => {
        s[key] = v;
        p.saveSettings();
      });
    }
    const jbtn = jr.createDiv({ cls: "ad-btnrow" });
    this.bigButton(jbtn, "\u73B0\u5728\u6574\u7406\u4E00\u6B21", () => p.autoLog.logNow());
    jr.createDiv({ cls: "ad-hint", text: "\u53EA\u8BB0 Claude Code / Codex / WorkBuddy\uFF1B\u6A21\u578B\u95EE\u4E0D\u5230\u65F6\u624B\u52A8\u6574\u7406\u4F1A\u7528\u4F1A\u8BDD\u6807\u9898\u5148\u8BB0\u4E0A\uFF0C\u81EA\u52A8\u6574\u7406\u7B49\u4E0B\u4E00\u8F6E\u3002\u5199\u5165\u524D\u4F1A\u6838\u5BF9\u65E5\u8BB0\u6CA1\u88AB\u540C\u65F6\u6539\u8FC7\uFF0C\u6B63\u5728\u7528\u8F93\u5165\u6CD5\u6253\u5B57\u7684\u90A3\u4E00\u4E0B\u4E0D\u5199\u3002" });
    const ui = this.card(body, "\u754C\u9762");
    const mb = this.row(ui, "macOS \u83DC\u5355\u680F", "\u5728\u7CFB\u7EDF\u6700\u4E0A\u65B9\u663E\u793A\u4E00\u4E2A\u5C0F\u56FE\u6807\u548C\u4E00\u4E32\u7B80\u77ED\u8BF4\u660E\uFF1B\u70B9\u5F00\u662F\u4F1A\u8BDD\u8BE6\u60C5\u548C\u8DF3\u8F6C\u3002Obsidian \u53F3\u4E0B\u89D2\u4E0D\u518D\u663E\u793A Agent \u6C47\u603B\u3002\u7B2C\u4E00\u6B21\u542F\u52A8\u4F1A\u7F16\u8BD1\u4E00\u4E2A Swift \u5C0F\u52A9\u624B\uFF0C\u9700\u8981 Xcode Command Line Tools\u3002", null);
    this.toggle(mb.querySelector(":scope > .ad-row__right"), s.showMenuBar !== false, (v) => {
      s.showMenuBar = v;
      p.saveSettings();
      p.applyUiSettings();
    });
    for (const [key, label, desc, min, max] of [
      ["menuBarPrimaryLimit", "\u83DC\u5355\u680F\uFF1A\u4E3B\u529B\u6700\u591A\u51E0\u4E2A", "\u4E3B\u529B Agent \u5168\u91CF\u8FFD\u8E2A\uFF0C\u6240\u4EE5\u53EF\u4EE5\u591A\u653E\u51E0\u4E2A\u4F1A\u8BDD\u3002", 3, 12],
      ["menuBarOtherLimit", "\u83DC\u5355\u680F\uFF1A\u5176\u5B83 Agent \u6700\u591A\u51E0\u4E2A", "\u5176\u5B83 Agent \u53EA\u663E\u793A\u6B63\u5728\u8FD0\u884C\u7684\u4F1A\u8BDD\u3002", 1, 6]
    ]) {
      const row = this.row(ui, label, desc, null);
      this.numberInput(row.querySelector(":scope > .ad-row__right"), s[key] || (key === "menuBarPrimaryLimit" ? 6 : 3), min, max, (v) => {
        s[key] = v;
        p.saveSettings();
        p.refreshUI();
      });
    }
    const hkRow = this.row(ui, "\u83DC\u5355\u680F\u5FEB\u6377\u952E", "\u83DC\u5355\u680F\u88AB macOS \u85CF\u8D77\u6765\u65F6\uFF0C\u7528\u8FD9\u4E2A\u7EC4\u5408\u5728\u4EFB\u610F App \u5F00\u5408\u9762\u677F\u3002\u70B9\u4E00\u4E0B\u8F93\u5165\u6846\uFF0C\u518D\u6309\u65B0\u7684\u7EC4\u5408\uFF1B\u81F3\u5C11\u5305\u542B \u2303 / \u2325 / \u2318 \u4E4B\u4E00\u3002\u5982\u679C\u6CA1\u53CD\u5E94\uFF0C\u53EF\u80FD\u88AB\u522B\u7684 App \u5360\u7528\uFF0C\u6362\u4E00\u4E2A\u7EC4\u5408\u8BD5\u8BD5\u3002", null);
    const hkRight = hkRow.querySelector(":scope > .ad-row__right");
    const hkInput = hkRight.createEl("input", { cls: "ad-hotkey", attr: { type: "text", spellcheck: "false", tabindex: "0", "aria-label": "\u83DC\u5355\u680F\u5FEB\u6377\u952E" } });
    hkInput.value = hotkeyDisplay(s.menuBarHotkey);
    hkInput.addEventListener("focus", () => {
      hkInput.value = "\u6309\u4E0B\u7EC4\u5408\u952E\u2026";
      hkInput.classList.add("is-capturing");
    });
    hkInput.addEventListener("blur", () => {
      hkInput.value = hotkeyDisplay(s.menuBarHotkey);
      hkInput.classList.remove("is-capturing");
    });
    hkInput.addEventListener("input", () => {
      hkInput.value = hotkeyDisplay(s.menuBarHotkey);
    });
    hkInput.addEventListener("keydown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        hkInput.blur();
        return;
      }
      if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return;
      const key = hotkeyKeyFromEvent(event);
      if (!key) {
        hkInput.value = "\u53EA\u652F\u6301 A\u2013Z / 0\u20139 / F1\u2013F12";
        return;
      }
      if (!event.ctrlKey && !event.altKey && !event.metaKey) {
        hkInput.value = "\u81F3\u5C11\u52A0 \u2303 / \u2325 / \u2318";
        return;
      }
      s.menuBarHotkey = hotkeySpecFromEvent(event, key);
      p.saveSettings();
      p.menubar?.update(true);
      new import_obsidian3.Notice("\u83DC\u5355\u680F\u5FEB\u6377\u952E\u5DF2\u4FDD\u5B58\uFF0C\u7EA6 2 \u79D2\u5185\u751F\u6548");
      hkInput.value = hotkeyDisplay(s.menuBarHotkey);
      hkInput.classList.remove("is-capturing");
      hkInput.blur();
    }, true);
    const hkReset = hkRight.createEl("button", { cls: "ad-btn", text: "\u9ED8\u8BA4" });
    hkReset.onclick = () => {
      s.menuBarHotkey = DEFAULTS.menuBarHotkey;
      p.saveSettings();
      p.menubar?.update(true);
      hkInput.value = hotkeyDisplay(s.menuBarHotkey);
    };
    const mbbtn = this.row(ui, "\u83DC\u5355\u680F\u52A9\u624B", "\u5982\u679C\u83DC\u5355\u680F\u6CA1\u51FA\u73B0\uFF0C\u6216\u8005\u6539\u5B8C\u8BBE\u7F6E\u60F3\u7ACB\u523B\u91CD\u5F00\u3002", null);
    const mbrestart = mbbtn.querySelector(":scope > .ad-row__right").createEl("button", { cls: "ad-btn", text: "\u91CD\u542F\u83DC\u5355\u680F" });
    mbrestart.onclick = () => p.menubar?.restart();
    const nautRow = this.row(ui, "\u5173\u95ED\u87BA\u65CB\u65E5\u7A0B\u53F3\u4E0B\u89D2\u7684 Agent \u6C47\u603B", "Agent Deck \u63A5\u7BA1\u540E\uFF0C\u87BA\u65CB\u65E5\u7A0B\u90A3\u4E00\u683C \u{1F916} \u4F1A\u9690\u85CF\uFF1B\u5B83\u81EA\u5DF1\u7684\u65E5\u7A0B\u72B6\u6001\u680F\u548C\u8BA1\u65F6\u7167\u5E38\u3002", null);
    this.toggle(nautRow.querySelector(":scope > .ad-row__right"), s.menuBarHideNautilus !== false, (v) => {
      s.menuBarHideNautilus = v;
      p.saveSettings();
      if (v) p.hideNautilusAgentBar().catch(() => {
      });
      else p.restoreNautilusAgentBar().catch(() => {
      });
    });
    for (const [key, label, desc, fallback] of [
      ["showEditorPills", "\u4EFB\u52A1\u884C\u4E0A\u7684\u4F1A\u8BDD\u72B6\u6001\u6309\u94AE", "\u53EA\u6709\u5DF2\u7ECF\u7ED1\u5B9A\u4F1A\u8BDD / \u59D4\u6D3E\u51FA\u53BB\u7684\u884C\u624D\u663E\u793A\u72B6\u6001\u548C\u8FDB\u5EA6\uFF1B\u4E0D\u518D\u5728\u6BCF\u4E2A\u6761\u76EE\u4E0A\u653E\u300C\u59D4\u6D3E\u300D\u6309\u94AE\u3002", true],
      ["dragGrip", "\u5217\u8868\u9879\u5C3E\u5DF4\u4E0A\u7684\u62D6\u62FD\u628A\u624B", "\u9762\u677F\u5F00\u7740\u65F6\uFF0C\u5149\u6807\u6240\u5728\u7684\u5217\u8868\u9879\u5C3E\u5DF4\u4E0A\u51FA\u4E00\u4E2A\u5C0F\u628A\u624B\uFF0C\u62D6\u5230\u67D0\u4E2A Agent \u5361\u7247\u4E0A\u5C31\u662F\u59D4\u6D3E\u3002\u9009\u4E2D\u6587\u5B57\u76F4\u63A5\u62D6\u4E5F\u884C\u3002", true],
      ["showRibbonIcon", "\u5DE6\u4FA7\u680F\u56FE\u6807", "\u70B9\u4E00\u4E0B\u6253\u5F00 Agent Deck\u3002", true],
      ["openDashboardOnStartup", "\u542F\u52A8\u65F6\u6253\u5F00\u9762\u677F", "Obsidian \u542F\u52A8\u65F6\u81EA\u52A8\u6253\u5F00 Agent Deck \u4FA7\u680F\u3002", false]
    ]) {
      const row = this.row(ui, label, desc, null);
      this.toggle(row.querySelector(":scope > .ad-row__right"), s[key] === void 0 ? fallback : s[key] !== false, (v) => {
        s[key] = v;
        p.saveSettings();
        p.applyUiSettings();
      });
    }
    const bars = this.row(ui, "\u6700\u8FD1 14 \u5929\u7684\u6761\u5F62\u56FE", "", null);
    this.toggle(bars.querySelector(":scope > .ad-row__right"), s.ui.showUsageBars !== false, (v) => {
      s.ui.showUsageBars = v;
      p.saveSettings();
      p.refreshUI();
    });
    const spark = this.row(ui, "\u6BCF\u4E2A Agent \u7684\u5C0F\u706B\u82B1\u7EBF", "", null);
    this.toggle(spark.querySelector(":scope > .ad-row__right"), s.ui.showSparkline !== false, (v) => {
      s.ui.showSparkline = v;
      p.saveSettings();
      p.refreshUI();
    });
    const data = this.card(body, "\u6570\u636E", "usage.json \u5B58\u5728\u63D2\u4EF6\u76EE\u5F55\u91CC\uFF1B\u65E5\u5FD7\u5220\u4E86\u5386\u53F2\u8FD8\u5728\u3002");
    const btn = data.createDiv({ cls: "ad-btnrow" });
    this.bigButton(btn, "\u91CD\u65B0\u542F\u52A8\u83DC\u5355\u680F\u52A9\u624B", () => p.menubar?.restart());
    this.bigButton(btn, "\u91CD\u65B0\u8BA1\u7B97\u5168\u90E8\u5386\u53F2", () => p.rebuildUsage(), "mod-warning");
    this.bigButton(btn, "\u6253\u5F00\u63D2\u4EF6\u76EE\u5F55", () => p.openPluginDir());
    this.bigButton(btn, "\u5BFC\u5165\u87BA\u65CB\u65E5\u7A0B\u7684\u5386\u53F2", () => p.importNautilus());
    const stats = data.createDiv({ cls: "ad-statline" });
    const days = Object.keys(p.store.days).length;
    stats.createSpan({ text: `${days} \u5929\u8BB0\u5F55` });
    stats.createSpan({ cls: "ad-dot", text: "\xB7" });
    stats.createSpan({ text: `${p.usage.meta.size} \u4E2A\u4F1A\u8BDD\u7D22\u5F15` });
    stats.createSpan({ cls: "ad-dot", text: "\xB7" });
    stats.createSpan({ text: `${p.usage.files.size} \u4E2A\u65E5\u5FD7\u6587\u4EF6` });
    const naut = this.card(body, "\u548C\u87BA\u65CB\u65E5\u7A0B\u5E76\u5B58", "\u87BA\u65CB\u65E5\u7A0B\u4E5F\u4F1A\u8BFB\u540C\u4E00\u6279 \u{1F517} \u4F1A\u8BDD\u3001\u6539\u4EFB\u52A1\u72B6\u6001\u3001\u5199 \u{1F4AC}\u3002\u7528 Agent Deck \u63A5\u7BA1\u540E\uFF0C\u53EF\u4EE5\u53EA\u5173\u6389\u5B83\u7684 AI \u5199\u5165\uFF0C\u65E5\u7A0B\u548C\u5B83\u7684\u8FFD\u8E2A\u5C55\u793A\u7167\u6837\u5728\u3002");
    const nbtn = naut.createDiv({ cls: "ad-btnrow" });
    this.bigButton(nbtn, "\u505C\u7528\u87BA\u65CB\u65E5\u7A0B\u91CC\u7684 AI \u5199\u5165", () => p.pauseNautilus(), "mod-warning");
    naut.createDiv({ cls: "ad-hint", text: "\u53EA\u5173\u81EA\u52A8\u8BB0\u65E5\u8BB0\u3001\u72B6\u6001\u5199\u56DE\u3001\u{1F4AC} \u548C\u5B50\u5757\u5199\u5165\uFF1B\u87BA\u65CB\u81EA\u5DF1\u7684 Agent \u8FFD\u8E2A\u5C55\u793A\u4FDD\u7559\u3002\u4F1A\u5148\u5907\u4EFD\u5B83\u7684 data.json\u3002\u5199\u5165\u540E\u8BF7\u5728 Obsidian \u8BBE\u7F6E\u91CC\u91CD\u65B0\u52A0\u8F7D\u87BA\u65CB\u65E5\u7A0B\uFF08\u6216\u91CD\u542F Obsidian\uFF09\uFF1BAgent Deck \u4E0D\u4F1A\u81EA\u52A8\u542F\u505C\u5176\u5B83\u63D2\u4EF6\u3002" });
    const links = this.card(body, "\u70B9\u51FB\u4F1A\u8BDD\u65F6\u6253\u5F00\u54EA\u513F", "Claude Code \u7528 claude://resume \u56DE\u5230\u684C\u9762\u7248\uFF1BWorkBuddy \u7528 workbuddy://chat/<\u4F1A\u8BDD\u53F7>\uFF1BDeepSeek Harness \u76EE\u524D\u53EA\u6709 dsh://open\uFF08\u805A\u7126\u5BA2\u6237\u7AEF\uFF09\uFF0C\u63D2\u4EF6\u4F1A\u628A\u4F1A\u8BDD\u53F7\u590D\u5236\u5230\u526A\u8D34\u677F\uFF0C\u65B9\u4FBF\u4F60\u5728\u4FA7\u680F\u91CC\u627E\u3002Codex \u6CA1\u6709 URL\uFF0C\u4F1A\u590D\u5236 codex resume \u547D\u4EE4\u3002");
    links.createDiv({ cls: "ad-hint", text: "\u8FD9\u4E9B\u662F\u5BA2\u6237\u7AEF\u81EA\u5DF1\u7684 URL scheme\uFF0C\u63D2\u4EF6\u4E0D\u8BFB\u4E5F\u4E0D\u53D1\u4EFB\u4F55\u7F51\u7EDC\u8BF7\u6C42\u3002" });
  }
  // ---------- About ----------
  renderAbout(body) {
    const p = this.plugin;
    const c = this.card(body, "Agent Deck", "\u667A\u80FD\u4F53\u7532\u677F \xB7 \u5728 Obsidian \u91CC\u8FFD\u8E2A\u548C\u59D4\u6D3E AI Agent\u3002");
    c.createDiv({ cls: "ad-about-p", text: "\u628A\u87BA\u65CB\u65E5\u7A0B\u91CC\u7684\u4EBA\u673A\u534F\u4F5C\u8FFD\u8E2A\u62C6\u51FA\u6765\uFF0C\u505A\u6210\u4E00\u4E2A\u72EC\u7ACB\u63D2\u4EF6\uFF1A\u8BFB\u672C\u673A\u7684 Claude Code\u3001Codex\u3001WorkBuddy \u548C DeepSeek Harness \u4F1A\u8BDD\u65E5\u5FD7\uFF0C\u753B\u51FA\u5728\u8DD1\u3001\u7B49\u4F60\u3001\u5B89\u9759\uFF0C\u7B97\u65F6\u957F\u548C token\uFF0C\u5E76\u4E14\u53EF\u4EE5\u4ECE\u4EFB\u52A1\u884C\u76F4\u63A5\u59D4\u6D3E\u3002" });
    const list = c.createDiv({ cls: "ad-about-list" });
    for (const line of [
      "\u6700\u591A\u4E24\u4E2A\u4E3B\u529B Agent \u5168\u91CF\u8FFD\u8E2A\uFF0C\u5176\u4F59\u53EA\u8BFB\u4ECA\u5929\u3002",
      "Claude Code \u59D4\u6D3E\u652F\u6301\u6A21\u578B\u3001\u5F3A\u5EA6\u3001plan / auto / acceptEdits \u6743\u9650\u6A21\u5F0F\u3002",
      "DeepSeek Harness \u901A\u8FC7 dsh acp \u5F00\u771F\u6B63\u7684\u4F1A\u8BDD\uFF0C\u652F\u6301\u6A21\u578B\u548C\u63A8\u7406\u5F3A\u5EA6\u3002",
      "\u4EFB\u52A1\u884C\u4E0A\u7684\u6309\u94AE\u5C31\u662F\u8FDB\u5EA6\u6761\uFF1A\u59D4\u6D3E\u4E2D\u6CBF\u6309\u94AE\u80CC\u666F\u63A8\u8FDB\uFF0C\u53EF\u53D6\u6D88\u3002",
      "\u6A21\u578B\u8BBE\u7F6E\u5206\u5C42\uFF1A\u9ED8\u8BA4\u6A21\u578B\u3001\u9ED8\u8BA4\u5F3A\u5EA6\u3001\u80FD\u529B\u6807\u7B7E\u3001\u641C\u7D22\u7B5B\u9009\u3001\u7F6E\u9876\u6392\u5E8F\u3001\u4EFB\u52A1\u6A21\u578B\u3002",
      "\u70B9\u4F1A\u8BDD\u7528 deeplink \u6253\u5F00\u5BA2\u6237\u7AEF\uFF1BClaude Code\u3001WorkBuddy \u5DF2\u5B9E\u73B0\uFF0CDeepSeek Harness \u76EE\u524D\u805A\u7126\u5BA2\u6237\u7AEF\u5E76\u590D\u5236\u4F1A\u8BDD\u53F7\u3002"
    ]) {
      const r = list.createDiv({ cls: "ad-about-li" });
      r.createSpan({ cls: "ad-about-dot", text: "\xB7" });
      r.createSpan({ text: line });
    }
    const meta = c.createDiv({ cls: "ad-about-meta" });
    meta.createDiv({ text: "\u7248\u672C 1.0.2 \xB7 MIT License" });
    meta.createDiv({ text: "\u4ECE Nautilus Spiral\uFF08\u87BA\u65CB\u65E5\u7A0B\uFF09\u7684 AI \u8FFD\u8E2A\u90E8\u5206\u62C6\u51FA\uFF1B\u4EA4\u4E92\u53C2\u8003\u4E86\u5C0F\u7EA2\u4E66 @ZZ.X \u7684\u4E24\u6761\u5E16\u5B50\u3002" });
    const btns = c.createDiv({ cls: "ad-btnrow" });
    this.bigButton(btns, "\u6253\u5F00 GitHub \u4ED3\u5E93", () => p.openExternal("https://github.com/MatsuriMW/obsidian-agent-deck"));
    this.bigButton(btns, "\u590D\u5236\u8C03\u8BD5\u4FE1\u606F", async () => {
      const text = JSON.stringify({ version: "1.0.2", settings: p.settings, files: p.usage.files.size, sessions: p.usage.meta.size, errors: p.usage.errors }, null, 2);
      await navigator.clipboard.writeText(text);
      new import_obsidian3.Notice("\u8C03\u8BD5\u4FE1\u606F\u5DF2\u590D\u5236");
    });
  }
};
function strength(n, dots = false) {
  n = Math.max(0, Math.min(5, Number(n) || 0));
  if (dots) return "\u25CF".repeat(n) + "\u25CB".repeat(5 - n);
  return ["", "Very light", "Light", "Balanced", "Strong", "Deepest"][n] || "Balanced";
}
var AddModelModal = class extends import_obsidian3.Modal {
  constructor(app, plugin, onAdd) {
    super(app);
    this.plugin = plugin;
    this.onAdd = onAdd;
    this.agent = "dsh";
    this.name = "";
    this.route = "deepseek-account";
    this.model = "";
    this.context = "128K";
    this.tags = "Reasoning";
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("ad-modal");
    contentEl.createEl("h3", { text: "Add model" });
    contentEl.createDiv({ cls: "ad-muted", text: "\u7ED9\u59D4\u6D3E\u6309\u94AE\u52A0\u4E00\u4E2A\u6A21\u578B\u3002Claude \u7528\u547D\u4EE4\u884C\u7684\u522B\u540D\u6216\u5168\u540D\uFF1BDeepSeek Harness \u7528 ACP \u7684 provider / model\u3002" });
    const form = contentEl.createDiv({ cls: "ad-form" });
    const field = (label, el) => {
      const f = form.createDiv({ cls: "ad-field" });
      f.createDiv({ cls: "ad-field__label", text: label });
      el(f);
    };
    field("\u663E\u793A\u540D", (f) => {
      const i = f.createEl("input", { cls: "ad-input", attr: { placeholder: "\u4F8B\u5982 DeepSeek-V4-Pro" } });
      i.oninput = () => this.name = i.value;
    });
    field("Agent", (f) => {
      const s = f.createEl("select", { cls: "ad-select" });
      for (const id of ["claude", "dsh"]) s.createEl("option", { text: AGENTS[id].name, attr: { value: id } });
      s.value = this.agent;
      s.onchange = () => {
        this.agent = s.value;
      };
    });
    field("Provider route\uFF08DSH\uFF09", (f) => {
      const i = f.createEl("input", { cls: "ad-input", attr: { value: this.route } });
      i.oninput = () => this.route = i.value;
    });
    field("Model / alias", (f) => {
      const i = f.createEl("input", { cls: "ad-input", attr: { placeholder: "\u4F8B\u5982 deepseek-v4-pro \u6216 opus" } });
      i.oninput = () => this.model = i.value;
    });
    field("\u4E0A\u4E0B\u6587", (f) => {
      const i = f.createEl("input", { cls: "ad-input", attr: { value: this.context } });
      i.oninput = () => this.context = i.value;
    });
    field("\u80FD\u529B\u6807\u7B7E", (f) => {
      const i = f.createEl("input", { cls: "ad-input", attr: { value: this.tags, placeholder: "Reasoning, Fast, Vision" } });
      i.oninput = () => this.tags = i.value;
    });
    const bar = contentEl.createDiv({ cls: "ad-btnrow ad-btnrow--end" });
    const cancel = bar.createEl("button", { cls: "ad-btn ad-btn--ghost", text: "Cancel" });
    cancel.onclick = () => this.close();
    const add = bar.createEl("button", { cls: "ad-btn ad-btn--cta", text: "Add" });
    add.onclick = () => {
      const name = this.name.trim() || this.model.trim();
      if (!name || !this.model.trim()) return new import_obsidian3.Notice("\u663E\u793A\u540D\u548C model \u81F3\u5C11\u586B\u4E00\u4E2A");
      const id = `custom-${this.agent}-${this.model.trim().replace(/[^a-z0-9]+/gi, "-")}`;
      const m = {
        id,
        agent: this.agent,
        name,
        cli: this.agent === "claude" ? this.model.trim() : void 0,
        value: this.agent === "dsh" ? JSON.stringify([this.route.trim() || "deepseek-account", this.model.trim()]) : this.model.trim(),
        provider: this.agent === "dsh" ? this.route.trim() || "DeepSeek" : "Claude",
        context: this.context.trim() || "\u2014",
        strength: 3,
        speed: 3,
        tags: this.tags.split(/[,，]/).map((x) => x.trim()).filter(Boolean),
        cost: "",
        note: "Custom model",
        custom: true
      };
      this.onAdd(m);
      this.close();
    };
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/dialog.js
var import_obsidian4 = require("obsidian");
var DelegateOptionsModal = class extends import_obsidian4.Modal {
  constructor(app, plugin, path6, line) {
    super(app);
    this.plugin = plugin;
    this.path = path6;
    this.line = line;
    this.agent = plugin.defaultTarget();
    this.model = plugin.defaultModel(this.agent);
    this.effort = this.agent === "dsh" ? plugin.settings.delegate.dsh.effort || "high" : plugin.settings.delegate.claude.effort || "high";
    this.permission = plugin.settings.delegate.claude.permission || "auto";
    this.cwd = "";
    this.suffix = plugin.settings.delegate.promptSuffix || "";
    this.block = null;
    this.file = null;
  }
  async onOpen() {
    const { contentEl } = this;
    contentEl.addClass("ad-modal");
    contentEl.addClass("ad-delegate");
    const file = this.app.vault.getAbstractFileByPath(this.path);
    if (!file) {
      contentEl.createDiv({ text: "\u627E\u4E0D\u5230\u8FD9\u7BC7\u7B14\u8BB0" });
      return;
    }
    this.file = file;
    const text = await this.app.vault.read(file);
    const lines = text.split("\n");
    this.block = blockAt(lines, this.line);
    this.lines = lines;
    if (!this.block) {
      contentEl.createDiv({ text: "\u5149\u6807\u8981\u653E\u5728\u4E00\u4E2A\u5217\u8868\u9879\u91CC" });
      return;
    }
    this.render();
  }
  render() {
    const { contentEl } = this;
    const p = this.plugin;
    contentEl.empty();
    const head = contentEl.createDiv({ cls: "ad-modalhead" });
    const title = head.createDiv({ cls: "ad-modalhead__title", text: "Delegate this block" });
    const sub = head.createDiv({ cls: "ad-modalhead__sub", text: `${blockTitle(this.block).slice(0, 80)} \xB7 ${this.path}` });
    const preview = contentEl.createDiv({ cls: "ad-preview" });
    const pre = preview.createEl("pre", { cls: "ad-preview__text" });
    pre.textContent = this.block.text.split("\n").slice(0, 6).join("\n") + (this.block.text.split("\n").length > 6 ? "\n\u2026" : "");
    const target = contentEl.createDiv({ cls: "ad-field" });
    target.createDiv({ cls: "ad-field__label", text: "Delegate to" });
    const targets = target.createDiv({ cls: "ad-targetpick" });
    for (const id of ["claude", "dsh"]) {
      const a = AGENTS[id];
      const b = targets.createEl("button", { cls: "ad-target ad-target--sm" + (this.agent === id ? " is-on" : "") });
      b.style.setProperty("--ad-agent", a.color);
      b.style.setProperty("--ad-agent-soft", a.soft);
      agentIcon(b.createSpan({ cls: "ad-glyph" }), id);
      b.createSpan({ text: a.short });
      b.createSpan({ cls: "ad-target__hint", text: id === "claude" ? "\u684C\u9762\u7248" : "ACP" });
      b.onclick = () => {
        this.agent = id;
        this.model = p.defaultModel(id);
        this.effort = id === "dsh" ? p.settings.delegate.dsh.effort || "high" : p.settings.delegate.claude.effort || "high";
        this.render();
      };
    }
    const mf = contentEl.createDiv({ cls: "ad-field" });
    mf.createDiv({ cls: "ad-field__label", text: "Model" });
    const models = p.modelsFor(this.agent).filter((m) => p.modelEnabled(m.id));
    const grid = mf.createDiv({ cls: "ad-modelpick" });
    for (const m of models) {
      const b = grid.createEl("button", { cls: "ad-modelpick__item" + (this.model === m.id ? " is-on" : "") });
      const top = b.createDiv({ cls: "ad-modelpick__top" });
      top.createSpan({ cls: "ad-modelpick__name", text: m.name });
      if (m.cost) top.createSpan({ cls: "ad-modelpick__cost", text: m.cost.replace(" cost", "") });
      const meta = b.createDiv({ cls: "ad-modelpick__meta" });
      meta.createSpan({ text: m.context });
      for (const t of m.tags || []) meta.createSpan({ cls: "ad-cap", text: t });
      b.onclick = () => {
        this.model = m.id;
        this.render();
      };
    }
    const ef = contentEl.createDiv({ cls: "ad-field" });
    ef.createDiv({ cls: "ad-field__label", text: "Effort" });
    const opts = EFFORTS[this.agent] || EFFORTS.claude;
    const ewrap = ef.createDiv({ cls: "ad-effort ad-effort--big" });
    const track = ewrap.createDiv({ cls: "ad-effort__track" });
    const idx = Math.max(0, opts.findIndex((x) => x.id === this.effort));
    track.createDiv({ cls: "ad-effort__fill" }).style.width = `${idx / Math.max(1, opts.length - 1) * 100}%`;
    const stops = track.createDiv({ cls: "ad-effort__stops" });
    opts.forEach((o, i) => {
      const b = stops.createEl("button", { cls: "ad-effort__stop" + (o.id === this.effort ? " is-on" : "") });
      b.createSpan({ cls: "ad-effort__dot" });
      b.onclick = () => {
        this.effort = o.id;
        this.render();
      };
      ewrap.createSpan({ cls: "ad-effort__lab", attr: { style: `left:${i / Math.max(1, opts.length - 1) * 100}%` }, text: o.label });
    });
    if (this.agent === "claude") {
      const pf = contentEl.createDiv({ cls: "ad-field" });
      pf.createDiv({ cls: "ad-field__label", text: "Mode" });
      const seg = pf.createDiv({ cls: "ad-seg" });
      for (const o of CLAUDE_PERMISSIONS) {
        const b = seg.createEl("button", { cls: "ad-seg__btn" + (this.permission === o.id ? " is-on" : ""), text: o.label });
        b.title = o.hint;
        b.onclick = () => {
          this.permission = o.id;
          this.render();
        };
      }
      pf.createDiv({ cls: "ad-hint", text: CLAUDE_PERMISSIONS.find((x) => x.id === this.permission)?.hint || "" });
    } else {
      const af = contentEl.createDiv({ cls: "ad-field" });
      const row = af.createDiv({ cls: "ad-minirow" });
      row.createSpan({ text: "Auto-approve tool calls" });
      const b = row.createEl("button", { cls: "ad-switch" + (p.settings.delegate.dsh.autoApprove ? " is-on" : "") });
      b.createSpan({ cls: "ad-switch__knob" });
      b.onclick = () => {
        p.settings.delegate.dsh.autoApprove = !p.settings.delegate.dsh.autoApprove;
        p.saveSettings();
        this.render();
      };
      af.createDiv({ cls: "ad-hint", text: "ACP \u6A21\u5F0F\u6CA1\u6709 plan/auto \u8FD9\u4E2A\u5207\u6362\uFF1B\u5173\u6389\u81EA\u52A8\u5141\u8BB8\u65F6\uFF0CHarness \u7684\u6743\u9650\u8BF7\u6C42\u4F1A\u88AB\u62D2\u7EDD\u5E76\u63D0\u9192\u4F60\u3002" });
    }
    const cf = contentEl.createDiv({ cls: "ad-field" });
    cf.createDiv({ cls: "ad-field__label", text: "Working directory" });
    const cwd = cf.createEl("input", { cls: "ad-input", attr: { placeholder: p.vaultPath, value: this.cwd } });
    cwd.oninput = () => {
      this.cwd = cwd.value;
    };
    cf.createDiv({ cls: "ad-hint", text: "\u7559\u7A7A = \u63D2\u4EF6\u8BBE\u7F6E\u91CC\u7684\u76EE\u5F55\uFF08\u9ED8\u8BA4\u662F\u5E93\u6839\u76EE\u5F55\uFF09\u3002" });
    const sf = contentEl.createDiv({ cls: "ad-field" });
    sf.createDiv({ cls: "ad-field__label", text: "Prompt suffix" });
    const ta = sf.createEl("textarea", { cls: "ad-textarea", attr: { rows: "2", placeholder: "\u52A0\u5728\u8FD9\u6B21\u59D4\u6D3E\u6700\u540E\u7684\u8BDD" } });
    ta.value = this.suffix;
    ta.oninput = () => {
      this.suffix = ta.value;
    };
    const foot = contentEl.createDiv({ cls: "ad-modalfoot" });
    const cancel = foot.createEl("button", { cls: "ad-btn ad-btn--ghost", text: "Cancel" });
    cancel.onclick = () => this.close();
    const go = foot.createEl("button", { cls: "ad-btn ad-btn--cta ad-btn--delegate" });
    go.createSpan({ cls: "ad-btn__fill" });
    const goIcon = go.createSpan({ cls: "ad-btn__icon" });
    setLucide(goIcon, "send");
    go.createSpan({ cls: "ad-btn__label", text: "Delegate" });
    go.onclick = async () => {
      go.classList.add("is-busy");
      go.setAttr("disabled", "true");
      const label = go.querySelector(".ad-btn__label");
      label.textContent = "Delegating";
      try {
        const job = await p.delegator.delegate({
          file: this.file,
          lines: this.lines,
          block: this.block,
          agent: this.agent,
          model: this.model,
          effort: this.effort,
          permission: this.agent === "claude" ? this.permission : "",
          cwd: this.cwd.trim(),
          promptSuffix: this.suffix,
          name: blockTitle(this.block)
        });
        this.close();
      } catch (e) {
        go.classList.remove("is-busy");
        go.removeAttribute("disabled");
        label.textContent = "Delegate";
        new import_obsidian4.Notice(String(e.message || e), 6e3);
      }
    };
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/menubar.js
var import_fs3 = __toESM(require("fs"), 1);
var import_path3 = __toESM(require("path"), 1);
var import_os3 = __toESM(require("os"), 1);
var import_crypto = __toESM(require("crypto"), 1);
var import_child_process3 = require("child_process");

// src/menubar.swift
var menubar_default = `// Agent Deck menu bar helper.
// Compiled at runtime from the plugin with:
//   swiftc -O -swift-version 5 -framework AppKit -framework SwiftUI -o AgentDeckMenuBar AgentDeckMenuBar.swift
// It reads a JSON snapshot written by the Obsidian plugin and shows a small
// status item with a detailed panel. It never talks to the network.
//
// The panel is a borderless NSPanel with opaque, solid surfaces. It deliberately
// avoids NSPopover / NSVisualEffectView: macOS 26 renders those with a strong
// glass material, which made the old card list washed out and hard to read.

import AppKit
import Carbon
import QuartzCore
import SwiftUI
import Foundation
import Darwin

let lucideWandSVG = """
<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/></svg>
"""

let lucideArrowSVG = """
<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>
"""

func lucideImage(_ svg: String, _ size: CGFloat) -> NSImage? {
    guard let data = svg.data(using: .utf8), let image = NSImage(data: data) else { return nil }
    image.isTemplate = true
    image.size = NSSize(width: size, height: size)
    return image
}

// The exact icons TODOseq puts before a task keyword. Paths and stroke widths
// are copied from its local patch so the menu bar reads as the same language:
// TODO = dashed circle, DOING = loader-circle (spins), DONE = circle-check,
// PAUSED = pause, WAITING = hourglass, NEEDOK = hand, ERRORED = badge-alert,
// HITLIMIT = gauge.
enum TsqIcons {
    private static func wrap(_ body: String) -> String {
        """
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\\(body)</svg>
        """
    }

    static let todo = wrap("""
    <path d="M10.1 2.182a10 10 0 0 1 3.8 0"/><path d="M17.609 3.721a10 10 0 0 1 2.69 2.7"/><path d="M21.818 10.1a10 10 0 0 1 0 3.8"/><path d="M20.279 17.609a10 10 0 0 1-2.7 2.69"/><path d="M13.9 21.818a10 10 0 0 1-3.8 0"/><path d="M6.391 20.279a10 10 0 0 1-2.69-2.7"/><path d="M2.182 13.9a10 10 0 0 1 0-3.8"/><path d="M3.721 6.391a10 10 0 0 1 2.7-2.69"/>
    """)

    static let doing = wrap(#"<path d="M21 12a9 9 0 1 1-6.219-8.56"/>"#)

    static let done = wrap(#"<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>"#)

    static let paused = wrap(#"<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>"#)

    static let waiting = wrap("""
    <path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>
    """)

    static let needok = wrap("""
    <path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
    """)

    static let errored = wrap("""
    <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>
    """)

    static let hitlimit = wrap(#"<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>"#)
}

// MARK: - Snapshot

struct MenuSession: Decodable, Identifiable {
    let id: String
    let agent: String
    let agentName: String
    let agentShort: String?
    let color: String
    let glyph: String
    let title: String
    let detail: String
    let state: String
    let stateLabel: String
    let primary: Bool
    let url: String?
    let copy: String?
    let keyword: String?
    let keywordLabel: String?
    let project: String?
    let step: String?
    let ago: String?

    var keywordCode: String {
        if let keyword = keyword, !keyword.isEmpty { return keyword }
        return DeckKeywords.code(for: state)
    }

    var keywordZh: String {
        if let label = keywordLabel, !label.isEmpty { return label }
        return DeckKeywords.style(for: keywordCode).zh
    }

    // WorkBuddy sometimes stores a bare XML-wrapped tool prompt as the title.
    var displayTitle: String {
        var text = title
        for tag in ["<user_query>", "</user_query>", "<user_request>", "</user_request>"] {
            text = text.replacingOccurrences(of: tag, with: "")
        }
        if let open = text.firstIndex(of: "<"), let close = text[open...].firstIndex(of: ">") {
            text.removeSubrange(open...close)
        }
        text = text.replacingOccurrences(of: "\\n", with: " ")
        text = text.split(separator: " ").joined(separator: " ")
        return text.isEmpty ? title : text
    }

    var hasStructuredMeta: Bool {
        (project?.isEmpty == false) || (step?.isEmpty == false) || (ago?.isEmpty == false)
    }

    var shortAgent: String {
        if let s = agentShort, !s.isEmpty { return s }
        switch agent {
        case "claude": return "Claude"
        case "codex": return "Codex"
        case "workbuddy": return "WorkBuddy"
        case "dsh": return "DSH"
        default: return agentName
        }
    }
}

struct MenuAgent: Decodable, Identifiable {
    let id: String
    let short: String
    let name: String
    let color: String
    let glyph: String
    let running: Int
    let waiting: Int
    let primary: Bool
}

struct MenuState: Decodable {
    let updatedAt: Double
    let short: String
    let summary: String
    let usage: String?
    let hotkey: String?
    let running: Int
    let waiting: Int
    let sessions: [MenuSession]
    let agents: [MenuAgent]?

    static let empty = MenuState(updatedAt: 0, short: "Agent Deck", summary: "\u7B49\u5F85 Agent Deck\u2026", usage: nil, hotkey: nil, running: 0, waiting: 0, sessions: [], agents: [])

    var needsApproval: Int {
        sessions.filter { $0.state == "needs-approval" }.count
    }

    var usageLine: String {
        if let usage = usage, !usage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return usage
        }
        let parts = summary
            .split(separator: "\xB7")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && !$0.contains("\u5728\u8DD1") && !$0.contains("\u7B49\u4F60") }
        if parts.isEmpty {
            return summary.isEmpty ? "\u7B49\u5F85 Agent Deck\u2026" : summary
        }
        return parts.joined(separator: " \xB7 ")
    }
}

final class MenuModel: ObservableObject {
    @Published var state: MenuState = .empty
    @Published var panelVisible = false
    let statePath: String
    let showPath: String
    let parentPid: Int32
    var timer: Timer?
    var onUpdate: (() -> Void)?
    var onShowRequest: (() -> Void)?
    private var lastShowAt = Date().timeIntervalSince1970

    init(statePath: String, parentPid: Int32) {
        self.statePath = statePath
        self.showPath = URL(fileURLWithPath: statePath)
            .deletingLastPathComponent()
            .appendingPathComponent("show-panel").path
        self.parentPid = parentPid
    }

    func start() {
        lastShowAt = Date().timeIntervalSince1970
        reload()
        let t = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.tick()
        }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    func tick() {
        if parentPid > 0 && kill(parentPid, 0) != 0 {
            NSApp.terminate(nil)
            return
        }
        reload()
        checkShowRequest()
    }

    func checkShowRequest() {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: showPath),
              let date = attributes[.modificationDate] as? Date else { return }
        let stamp = date.timeIntervalSince1970
        if stamp > lastShowAt {
            lastShowAt = stamp
            onShowRequest?()
        }
    }

    func reload() {
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: statePath)),
              let next = try? JSONDecoder().decode(MenuState.self, from: data) else { return }
        if next.updatedAt != state.updatedAt {
            state = next
            onUpdate?()
        }
    }
}

// MARK: - Actions

extension Notification.Name {
    static let agentDeckDismiss = Notification.Name("AgentDeckDismissPanel")
}

func openURL(_ string: String?) {
    guard let s = string, let url = URL(string: s) else { return }
    NSWorkspace.shared.open(url)
}

func dismissThen(_ action: () -> Void) {
    action()
    NotificationCenter.default.post(name: .agentDeckDismiss, object: nil)
}

func adOpen(_ string: String) {
    dismissThen { openURL(string) }
}

func openSession(_ session: MenuSession) {
    dismissThen {
        if let copy = session.copy, !copy.isEmpty {
            let pb = NSPasteboard.general
            pb.clearContents()
            pb.setString(copy, forType: .string)
        }
        if let url = session.url, !url.isEmpty {
            openURL(url)
        }
    }
}

// MARK: - Palette

extension NSColor {
    convenience init(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        var value: UInt64 = 0
        Scanner(string: s).scanHexInt64(&value)
        let r = CGFloat((value >> 16) & 0xff) / 255.0
        let g = CGFloat((value >> 8) & 0xff) / 255.0
        let b = CGFloat(value & 0xff) / 255.0
        self.init(srgbRed: r, green: g, blue: b, alpha: 1)
    }
}

extension Color {
    init(hex: String) {
        self.init(nsColor: NSColor(hex: hex))
    }

    /// Opaque colour that still follows light / dark appearance. The solid
    /// surfaces are the whole point here: no material, no vibrancy.
    static func solid(_ light: String, _ dark: String) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            return NSColor(hex: isDark ? dark : light)
        })
    }
}

enum DeckPalette {
    // Solid, near-white surfaces with a slight lavender tint so the panel sits
    // next to the light Obsidian theme instead of reading as parchment.
    static let panel = Color.solid("#F6F5FA", "#17161B")
    static let header = Color.solid("#EFEDF5", "#1E1D23")
    static let panelBorder = Color.solid("#D8D4E1", "#3A3742")

    static let card = Color.solid("#FFFFFF", "#242229")
    static let cardHover = Color.solid("#FDFCFF", "#2B2831")
    static let cardBorder = Color.solid("#E4E1EB", "#3A3742")
    static let cardBorderHover = Color.solid("#C9C4D6", "#595367")

    static let ink = Color.solid("#1B1A22", "#F6F3FA")
    static let secondary = Color.solid("#5F5C6B", "#B5B0BF")
    static let tertiary = Color.solid("#85818F", "#8C8896")
    static let divider = Color.solid("#E3E0EA", "#322F39")
    static let pill = Color.solid("#E7E4EE", "#2D2A33")
    static let brand = Color.solid("#4E43C8", "#7C6DFF")
    static let brandHover = Color.solid("#5B50D8", "#8E81FF")
    static let brandInk = Color.solid("#FFFFFF", "#171512")
}

// MARK: - TODOseq keywords

/// The keyword palette is lifted from the TODOseq plugin's local patch:
/// https://github.com/.../todoseq/styles.css ("\u5173\u952E\u8BCD\u6309\u72B6\u6001\u4E0A\u8272").
/// Accent is the original colour; ink is a darkened variant for chip text so
/// small labels keep a readable contrast on the pale solid chip background.
struct KeywordStyle {
    let code: String
    let zh: String
    let accent: Color
    let ink: Color
    let tint: Color
    let icon: String
    let spins: Bool
}

enum DeckKeywords {
    static let doing = KeywordStyle(
        code: "DOING", zh: "\u5728\u8DD1",
        accent: .solid("#C8635F", "#FF938B"),
        ink: .solid("#A34C48", "#FFB3AC"),
        tint: .solid("#F9E7E5", "#37211F"),
        icon: TsqIcons.doing, spins: true
    )

    static let needok = KeywordStyle(
        code: "NEEDOK?", zh: "\u7B49\u4F60",
        accent: .solid("#BF7A45", "#F2A66B"),
        ink: .solid("#96582B", "#FFC79A"),
        tint: .solid("#FBEDE1", "#3A281C"),
        icon: TsqIcons.needok, spins: false
    )

    static let waiting = KeywordStyle(
        code: "WAITING", zh: "\u7B49\u4F60",
        accent: .solid("#8F7FB6", "#BFAEEA"),
        ink: .solid("#6A5B92", "#D9CEFF"),
        tint: .solid("#F0EBF8", "#2A2438"),
        icon: TsqIcons.waiting, spins: false
    )

    static let paused = KeywordStyle(
        code: "PAUSED", zh: "\u5B89\u9759",
        accent: .solid("#B39A3E", "#E4CB6A"),
        ink: .solid("#846F22", "#F2DF9B"),
        tint: .solid("#F7F0D9", "#332C18"),
        icon: TsqIcons.paused, spins: false
    )

    static let errored = KeywordStyle(
        code: "ERRORED", zh: "\u51FA\u9519",
        accent: .solid("#93606B", "#E18C99"),
        ink: .solid("#70414B", "#F5B5BE"),
        tint: .solid("#F5E7E9", "#37222A"),
        icon: TsqIcons.errored, spins: false
    )

    static let hitlimit = KeywordStyle(
        code: "HITLIMIT!", zh: "\u9650\u989D",
        accent: .solid("#8A5A8C", "#CE93D2"),
        ink: .solid("#673A69", "#E8B9EB"),
        tint: .solid("#F4E8F4", "#332236"),
        icon: TsqIcons.hitlimit, spins: false
    )

    static let done = KeywordStyle(
        code: "DONE", zh: "\u5B8C\u6210",
        accent: .solid("#629C7F", "#83C9A5"),
        ink: .solid("#43705A", "#B1E5C9"),
        tint: .solid("#E8F3EC", "#1D3328"),
        icon: TsqIcons.done, spins: false
    )

    static let later = KeywordStyle(
        code: "LATER", zh: "\u6700\u8FD1",
        accent: .solid("#5C86B4", "#8FB8E8"),
        ink: .solid("#40658D", "#C2DFFF"),
        tint: .solid("#E9F0F9", "#1E2A38"),
        icon: TsqIcons.todo, spins: false
    )

    static let todo = KeywordStyle(
        code: "TODO", zh: "\u7A7A\u95F2",
        accent: .solid("#5C86B4", "#8FB8E8"),
        ink: .solid("#40658D", "#C2DFFF"),
        tint: .solid("#E9F0F9", "#1E2A38"),
        icon: TsqIcons.todo, spins: false
    )

    static func code(for state: String) -> String {
        switch state {
        case "run": return "DOING"
        case "needs-approval": return "NEEDOK"
        case "wait": return "WAITING"
        case "quiet": return "PAUSED"
        case "error": return "ERRORED"
        case "limit": return "HITLIMIT"
        case "done": return "DONE"
        case "recent": return "LATER"
        default: return "TODO"
        }
    }

    static func style(for code: String) -> KeywordStyle {
        let base = code
            .uppercased()
            .trimmingCharacters(in: CharacterSet(charactersIn: "?! "))
        switch base {
        case "DOING", "NOW", "IN-PROGRESS": return doing
        case "NEEDOK": return needok
        case "WAITING", "WAIT": return waiting
        case "PAUSED", "SUSPENDED": return paused
        case "ERRORED", "FAILED": return errored
        case "HITLIMIT": return hitlimit
        case "DONE": return done
        case "LATER", "DELEGATED", "QUEUED", "TOREVIEW": return later
        case "TODO": return todo
        default: return todo
        }
    }
}

// MARK: - Keyword glyph

private struct DeckPanelVisibleKey: EnvironmentKey {
    static let defaultValue = true
}

extension EnvironmentValues {
    var deckPanelVisible: Bool {
        get { self[DeckPanelVisibleKey.self] }
        set { self[DeckPanelVisibleKey.self] = newValue }
    }
}

/// Renders the same SVG TODOseq puts in front of a keyword. DOING keeps
/// spinning, but only while the panel is actually on screen. The rotation runs
/// on a CALayer so SwiftUI is not re-rendered 30 times a second.
struct KeywordGlyph: View {
    let style: KeywordStyle
    var size: CGFloat = 11
    var active: Bool = true

    @Environment(\\.deckPanelVisible) private var panelVisible

    var body: some View {
        if style.spins, panelVisible, active, let image = lucideImage(style.icon, size) {
            SpinningKeywordGlyph(image: image, color: NSColor(style.accent))
                .frame(width: size, height: size)
        } else {
            KeywordGlyphImage(style: style, size: size, active: active)
        }
    }
}

private struct KeywordGlyphImage: View {
    let style: KeywordStyle
    let size: CGFloat
    let active: Bool

    var body: some View {
        Group {
            if let image = lucideImage(style.icon, size) {
                Image(nsImage: image)
                    .renderingMode(.template)
                    .resizable()
                    .frame(width: size, height: size)
            } else {
                Circle()
                    .frame(width: size * 0.7, height: size * 0.7)
            }
        }
        .foregroundColor(active ? style.accent : DeckPalette.tertiary)
    }
}

private struct SpinningKeywordGlyph: NSViewRepresentable {
    let image: NSImage
    let color: NSColor

    func makeNSView(context: Context) -> SpinnerView {
        let view = SpinnerView()
        view.configure(image: image, color: color)
        return view
    }

    func updateNSView(_ view: SpinnerView, context: Context) {
        view.configure(image: image, color: color)
    }
}

private final class SpinnerView: NSView {
    private let spinLayer = CALayer()
    private var tinted: NSImage?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        spinLayer.contentsGravity = .resizeAspect
        spinLayer.anchorPoint = CGPoint(x: 0.5, y: 0.5)
        layer?.addSublayer(spinLayer)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(image: NSImage, color: NSColor) {
        tinted = image.deckTinted(color)
        needsLayout = true
    }

    override func layout() {
        super.layout()
        guard bounds.width > 0, bounds.height > 0 else { return }
        spinLayer.bounds = bounds
        spinLayer.position = CGPoint(x: bounds.midX, y: bounds.midY)
        spinLayer.contentsScale = window?.backingScaleFactor ?? 2
        if let tinted = tinted, let cg = tinted.cgImage(forProposedRect: nil, context: nil, hints: nil) {
            spinLayer.contents = cg
        }
        if spinLayer.animation(forKey: "deck-spin") == nil {
            let spin = CABasicAnimation(keyPath: "transform.rotation.z")
            spin.fromValue = 0.0
            spin.toValue = Double.pi * 2
            spin.duration = 0.8
            spin.repeatCount = .infinity
            spin.timingFunction = CAMediaTimingFunction(name: .linear)
            spinLayer.add(spin, forKey: "deck-spin")
        }
    }
}

private extension NSImage {
    func deckTinted(_ color: NSColor) -> NSImage {
        let scale: CGFloat = 3
        let target = NSSize(
            width: max(1, size.width * scale),
            height: max(1, size.height * scale)
        )
        return NSImage(size: target, flipped: false) { rect in
            self.draw(in: rect)
            guard let context = NSGraphicsContext.current else { return true }
            context.saveGraphicsState()
            context.compositingOperation = .sourceAtop
            color.setFill()
            NSBezierPath(rect: rect).fill()
            context.restoreGraphicsState()
            return true
        }
    }
}

// MARK: - Agents

struct AgentStyle {
    let id: String
    let color: Color
    let tint: Color
    let glyph: String
    let short: String
}

enum DeckAgents {
    static func style(id: String, fallbackColor: String, fallbackGlyph: String, fallbackShort: String) -> AgentStyle {
        switch id {
        case "claude":
            return AgentStyle(
                id: "claude",
                color: .solid("#D97757", "#F09475"),
                tint: .solid("#FBECE4", "#39251E"),
                glyph: "\u2733", short: "Claude"
            )
        case "codex":
            return AgentStyle(
                id: "codex",
                color: .solid("#4C82C3", "#7FB2E8"),
                tint: .solid("#EAF1F9", "#1E2C3B"),
                glyph: "\u2318", short: "Codex"
            )
        case "workbuddy":
            return AgentStyle(
                id: "workbuddy",
                color: .solid("#1C9A78", "#46C9A3"),
                tint: .solid("#E6F5EF", "#1B332B"),
                glyph: "\u2726", short: "WorkBuddy"
            )
        case "dsh":
            return AgentStyle(
                id: "dsh",
                color: .solid("#4A66E8", "#7F95FF"),
                tint: .solid("#EAEDFF", "#232744"),
                glyph: "\u25C8", short: "DSH"
            )
        default:
            let base = Color(hex: fallbackColor)
            return AgentStyle(
                id: id,
                color: base,
                tint: base.opacity(0.14),
                glyph: fallbackGlyph.isEmpty ? "\u2022" : fallbackGlyph,
                short: fallbackShort.isEmpty ? id : fallbackShort
            )
        }
    }

    static func style(for session: MenuSession) -> AgentStyle {
        style(id: session.agent, fallbackColor: session.color, fallbackGlyph: session.glyph, fallbackShort: session.shortAgent)
    }

    static func style(for agent: MenuAgent) -> AgentStyle {
        style(id: agent.id, fallbackColor: agent.color, fallbackGlyph: agent.glyph, fallbackShort: agent.short)
    }
}

// \u5B98\u65B9 App \u56FE\u6807\uFF1A\u63D2\u4EF6\u542F\u52A8\u65F6\u628A PNG \u5199\u5230 ~/.agent-deck/agents/\uFF0C\u8FD9\u91CC\u6309 id \u8BFB
private let deckAgentIcons = NSCache<NSString, NSImage>()
func agentAppIcon(_ id: String) -> NSImage? {
    if let cached = deckAgentIcons.object(forKey: id as NSString) { return cached }
    let path = (NSHomeDirectory() as NSString).appendingPathComponent(".agent-deck/agents/\\(id).png")
    guard let image = NSImage(contentsOfFile: path) else { return nil }
    deckAgentIcons.setObject(image, forKey: id as NSString)
    return image
}

// MARK: - Shared atoms

struct Hairline: View {
    var body: some View {
        Rectangle()
            .fill(DeckPalette.divider)
            .frame(height: 1)
    }
}

struct AgentBadge: View {
    let style: AgentStyle
    var size: CGFloat = 26

    var body: some View {
        if let image = agentAppIcon(style.id) {
            Image(nsImage: image)
                .resizable()
                .interpolation(.high)
                .frame(width: size * 0.82, height: size * 0.82)
                .clipShape(RoundedRectangle(cornerRadius: size * 0.2, style: .continuous))
                .frame(width: size, height: size)
        } else {
            ZStack {
                RoundedRectangle(cornerRadius: size * 0.26, style: .continuous)
                    .fill(style.tint)
                RoundedRectangle(cornerRadius: size * 0.26, style: .continuous)
                    .strokeBorder(style.color.opacity(0.35), lineWidth: 1)
                Text(style.glyph)
                    .font(.system(size: size * 0.44, weight: .bold))
                    .foregroundColor(style.color)
            }
            .frame(width: size, height: size)
        }
    }
}

struct KeywordChip: View {
    let style: KeywordStyle

    var body: some View {
        HStack(spacing: 4) {
            KeywordGlyph(style: style, size: 11)
            Text(style.code)
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .kerning(0.15)
        }
        .foregroundColor(style.ink)
        .padding(.horizontal, 6)
        .padding(.vertical, 2.5)
        .background(
            RoundedRectangle(cornerRadius: 5, style: .continuous)
                .fill(style.tint)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 5, style: .continuous)
                .strokeBorder(style.accent.opacity(0.55), lineWidth: 1)
        )
        .help("\\(style.code) \xB7 \\(style.zh)")
        .fixedSize()
    }
}

// MARK: - Header

struct StatBlock: View {
    let label: String
    let value: Int
    let style: KeywordStyle

    var body: some View {
        VStack(alignment: .trailing, spacing: 0) {
            Text(label)
                .font(.system(size: 7.5, weight: .bold, design: .monospaced))
                .kerning(0.7)
                .foregroundColor(style.accent)
            Text("\\(value)")
                .font(.system(size: 19, weight: .bold, design: .rounded).monospacedDigit())
                .foregroundColor(value > 0 ? style.ink : DeckPalette.tertiary)
        }
        .frame(minWidth: 40, alignment: .trailing)
    }
}

struct AgentPill: View {
    let agent: MenuAgent

    var body: some View {
        let style = DeckAgents.style(for: agent)
        HStack(spacing: 4) {
            if let image = agentAppIcon(agent.id) {
                Image(nsImage: image)
                    .resizable()
                    .interpolation(.high)
                    .frame(width: 12, height: 12)
                    .clipShape(RoundedRectangle(cornerRadius: 3, style: .continuous))
            } else {
                Text(style.glyph)
                    .font(.system(size: 9.5, weight: .bold))
                    .foregroundColor(style.color)
            }
            Text(agent.short.isEmpty ? style.short : agent.short)
                .font(.system(size: 9.5, weight: agent.primary ? .bold : .semibold))
                .foregroundColor(DeckPalette.ink)
                .lineLimit(1)
            Spacer(minLength: 3)
            HStack(spacing: 2) {
                KeywordGlyph(style: DeckKeywords.doing, size: 10, active: agent.running > 0)
                Text("\\(agent.running)")
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .foregroundColor(agent.running > 0 ? DeckKeywords.doing.accent : DeckPalette.tertiary)
            }
            HStack(spacing: 2) {
                KeywordGlyph(style: DeckKeywords.waiting, size: 10, active: agent.waiting > 0)
                Text("\\(agent.waiting)")
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .foregroundColor(agent.waiting > 0 ? DeckKeywords.waiting.accent : DeckPalette.tertiary)
            }
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 3.5)
        .frame(maxWidth: .infinity)
        .background(Capsule(style: .continuous).fill(style.tint))
        .overlay(
            Capsule(style: .continuous)
                .strokeBorder(style.color.opacity(agent.primary ? 0.42 : 0.24), lineWidth: 1)
        )
        .help("\u8DD1 \\(agent.running) \xB7 \u7B49 \\(agent.waiting)")
    }
}

struct HeaderBlock: View {
    let state: MenuState

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .top, spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .fill(DeckPalette.brand)
                    if let image = lucideImage(lucideWandSVG, 15) {
                        Image(nsImage: image)
                            .renderingMode(.template)
                            .foregroundColor(.white)
                    } else {
                        Image(systemName: "sparkles")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundColor(.white)
                    }
                }
                .frame(width: 30, height: 30)
                .shadow(color: DeckPalette.brand.opacity(0.35), radius: 6, x: 0, y: 2)

                VStack(alignment: .leading, spacing: 2) {
                    Text("Agent Deck")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundColor(DeckPalette.ink)
                    Text(state.usageLine)
                        .font(.system(size: 10.5, weight: .medium).monospacedDigit())
                        .foregroundColor(DeckPalette.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 6)

                HStack(alignment: .top, spacing: 12) {
                    StatBlock(label: "DOING", value: state.running, style: DeckKeywords.doing)
                    StatBlock(label: "WAITING", value: state.waiting, style: DeckKeywords.waiting)
                }
            }

            if state.needsApproval > 0 {
                HStack(spacing: 5) {
                    KeywordGlyph(style: DeckKeywords.needok, size: 10)
                    Text("\\(state.needsApproval) \u4E2A NEEDOK? \u9700\u8981\u4F60\u5141\u8BB8")
                        .font(.system(size: 9.5, weight: .semibold))
                }
                .foregroundColor(DeckKeywords.needok.ink)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(
                    Capsule(style: .continuous).fill(DeckKeywords.needok.tint)
                )
                .overlay(
                    Capsule(style: .continuous)
                        .strokeBorder(DeckKeywords.needok.accent.opacity(0.5), lineWidth: 1)
                )
            }

            if let agents = state.agents, !agents.isEmpty {
                LazyVGrid(
                    columns: [
                        GridItem(.flexible(), spacing: 5),
                        GridItem(.flexible(), spacing: 5),
                    ],
                    spacing: 5
                ) {
                    ForEach(agents) { AgentPill(agent: $0) }
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 13)
        .padding(.bottom, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DeckPalette.header)
    }
}

// MARK: - Session list

struct SectionHeader: View {
    let title: String
    let subtitle: String
    let count: Int

    var body: some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                .fill(DeckPalette.brand)
                .frame(width: 3, height: 11)
            Text(title)
                .font(.system(size: 9.5, weight: .bold))
                .kerning(0.6)
                .foregroundColor(DeckPalette.secondary)
            if !subtitle.isEmpty {
                Text(subtitle)
                    .font(.system(size: 9, weight: .medium))
                    .foregroundColor(DeckPalette.tertiary)
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
            Text("\\(count)")
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundColor(DeckPalette.secondary)
                .padding(.horizontal, 5)
                .padding(.vertical, 1)
                .background(Capsule(style: .continuous).fill(DeckPalette.pill))
        }
        .padding(.horizontal, 2)
        .padding(.top, 2)
    }
}

struct MetaText: View {
    let session: MenuSession
    let agent: AgentStyle

    var body: some View {
        HStack(spacing: 4) {
            if session.hasStructuredMeta {
                Text(session.shortAgent)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(agent.color)
                if let project = session.project, !project.isEmpty {
                    Text("\xB7")
                        .foregroundColor(DeckPalette.tertiary)
                    Text(project)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(DeckPalette.secondary)
                        .lineLimit(1)
                        .layoutPriority(1)
                }
                if let step = session.step, !step.isEmpty {
                    Text("\xB7")
                        .foregroundColor(DeckPalette.tertiary)
                    Text(step)
                        .font(.system(size: 10))
                        .foregroundColor(DeckPalette.tertiary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                Spacer(minLength: 4)
                if let ago = session.ago, !ago.isEmpty {
                    Text(ago)
                        .font(.system(size: 9.5, weight: .medium).monospacedDigit())
                        .foregroundColor(DeckPalette.tertiary)
                        .lineLimit(1)
                        .fixedSize(horizontal: true, vertical: false)
                        .layoutPriority(2)
                }
            } else {
                Text(session.detail)
                    .font(.system(size: 10))
                    .foregroundColor(DeckPalette.secondary)
                    .lineLimit(1)
                Spacer(minLength: 4)
            }
            if let image = lucideImage(lucideArrowSVG, 9) {
                Image(nsImage: image)
                    .renderingMode(.template)
                    .foregroundColor(DeckPalette.tertiary)
            } else {
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundColor(DeckPalette.tertiary)
            }
        }
    }
}

struct SessionCardView: View {
    let session: MenuSession
    @State private var hovering = false

    var body: some View {
        let agent = DeckAgents.style(for: session)
        let keyword = DeckKeywords.style(for: session.keywordCode)
        Button(action: { openSession(session) }) {
            HStack(alignment: .center, spacing: 9) {
                AgentBadge(style: agent)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(session.displayTitle)
                            .font(.system(size: 12.5, weight: .semibold))
                            .foregroundColor(DeckPalette.ink)
                            .lineLimit(1)
                            .help(session.title)
                        Spacer(minLength: 4)
                        KeywordChip(style: keyword)
                    }
                    MetaText(session: session, agent: agent)
                }
            }
            .padding(.leading, 12)
            .padding(.trailing, 10)
            .padding(.vertical, 9)
            .frame(maxWidth: .infinity, minHeight: 58, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(hovering ? DeckPalette.cardHover : DeckPalette.card)
            )
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(keyword.accent)
                    .frame(width: 3)
            }
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(hovering ? DeckPalette.cardBorderHover : DeckPalette.cardBorder, lineWidth: 1)
            )
            .shadow(
                color: Color.black.opacity(hovering ? 0.18 : 0.10),
                radius: hovering ? 8 : 5,
                x: 0,
                y: hovering ? 4 : 2
            )
            .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { inside in
            withAnimation(.easeOut(duration: 0.12)) { hovering = inside }
        }
    }
}

struct EmptyState: View {
    var body: some View {
        VStack(spacing: 9) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(DeckKeywords.todo.tint)
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(DeckKeywords.todo.accent.opacity(0.35), lineWidth: 1)
                Image(systemName: "checklist")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundColor(DeckKeywords.todo.accent)
            }
            .frame(width: 40, height: 40)

            HStack(spacing: 5) {
                KeywordChip(style: DeckKeywords.todo)
                Text("\u73B0\u5728\u6CA1\u6709\u8981\u663E\u793A\u7684\u4F1A\u8BDD")
                    .font(.system(size: 12.5, weight: .bold))
                    .foregroundColor(DeckPalette.ink)
            }
            Text("\u4E3B\u529B Agent \u7684\u4F1A\u8BDD\u4F1A\u7559\u5728\u8FD9\u91CC\uFF1B\u5176\u5B83 Agent \u53EA\u5728\u6B63\u5728\u8FD0\u884C\u65F6\u51FA\u73B0\uFF0CWorkBuddy \u7684\u7B49\u5F85\u4F1A\u8BDD\u4E5F\u5217\u3002")
                .font(.system(size: 10))
                .foregroundColor(DeckPalette.secondary)
                .multilineTextAlignment(.center)
                .lineSpacing(2)
                .frame(maxWidth: 300)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, 24)
        .padding(.vertical, 26)
    }
}

struct SessionListView: View {
    let state: MenuState

    var body: some View {
        let primary = state.sessions.filter { $0.primary }
        let others = state.sessions.filter { !$0.primary }

        ScrollView(.vertical, showsIndicators: true) {
            LazyVStack(alignment: .leading, spacing: 8) {
                if !primary.isEmpty {
                    SectionHeader(title: "\u4E3B\u529B AGENT", subtitle: "\u5168\u91CF\u8FFD\u8E2A", count: primary.count)
                    ForEach(primary) { SessionCardView(session: $0) }
                }
                if !others.isEmpty {
                    SectionHeader(title: "\u5176\u5B83 AGENT", subtitle: "\u5728\u8DD1 \xB7 WorkBuddy \u7B49\u4F60", count: others.count)
                        .padding(.top, 4)
                    ForEach(others) { SessionCardView(session: $0) }
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 11)
            .padding(.bottom, 14)
        }
        .scrollIndicators(.visible)
    }
}

// MARK: - Footer

enum FooterKind {
    case primary
    case secondary
    case quiet
}

struct FooterButton: View {
    let title: String
    let kind: FooterKind
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: kind == .quiet ? 9.5 : 10.5, weight: .semibold))
                .foregroundColor(foreground)
                .padding(.horizontal, kind == .quiet ? 6 : 10)
                .padding(.vertical, kind == .quiet ? 4 : 6)
                .background(
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .fill(background)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .strokeBorder(border, lineWidth: 1)
                )
                .shadow(
                    color: kind == .primary ? DeckPalette.brand.opacity(0.32) : .clear,
                    radius: 5,
                    x: 0,
                    y: 2
                )
                .contentShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { inside in
            withAnimation(.easeOut(duration: 0.1)) { hovering = inside }
        }
    }

    private var foreground: Color {
        switch kind {
        case .primary:
            return DeckPalette.brandInk
        case .secondary:
            return DeckPalette.ink
        case .quiet:
            return hovering ? DeckPalette.ink : DeckPalette.secondary
        }
    }

    private var background: Color {
        switch kind {
        case .primary:
            return hovering ? DeckPalette.brandHover : DeckPalette.brand
        case .secondary:
            return hovering ? DeckPalette.cardHover : DeckPalette.card
        case .quiet:
            return hovering ? DeckPalette.pill : .clear
        }
    }

    private var border: Color {
        switch kind {
        case .primary:
            return .clear
        case .secondary:
            return hovering ? DeckPalette.cardBorderHover : DeckPalette.cardBorder
        case .quiet:
            return .clear
        }
    }
}

struct FooterBlock: View {
    let sessionCount: Int

    private var hint: String {
        if sessionCount == 0 { return "\u7B49\u5F85 Agent \u4F1A\u8BDD" }
        return sessionCount > 5 ? "\u5171 \\(sessionCount) \u4E2A \xB7 \u5411\u4E0B\u6ED1\u52A8" : "\u70B9\u51FB\u5361\u7247\u8DF3\u8F6C"
    }

    var body: some View {
        HStack(spacing: 8) {
            Text(hint)
                .font(.system(size: 9))
                .foregroundColor(DeckPalette.tertiary)
                .lineLimit(1)
            FooterButton(title: "\u6253\u5F00\u9762\u677F", kind: .primary) {
                adOpen("obsidian://agent-deck")
            }
            FooterButton(title: "\u91CD\u65B0\u626B\u63CF", kind: .secondary) {
                adOpen("obsidian://agent-deck?do=scan")
            }
            Spacer(minLength: 4)
            FooterButton(title: "\u9690\u85CF", kind: .quiet) {
                adOpen("obsidian://agent-deck?do=hide")
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity)
        .background(DeckPalette.header)
    }
}

// MARK: - Root

struct DeckView: View {
    @ObservedObject var model: MenuModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HeaderBlock(state: model.state)
            Hairline()
            if model.state.sessions.isEmpty {
                EmptyState()
            } else {
                SessionListView(state: model.state)
                    .frame(maxHeight: .infinity)
            }
            Hairline()
            FooterBlock(sessionCount: model.state.sessions.count)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(DeckPalette.panel)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(DeckPalette.panelBorder, lineWidth: 1)
        )
        .environment(\\.deckPanelVisible, model.panelVisible)
    }
}

// MARK: - Panel + app

final class DeckPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

struct DeckHotKey {
    static let defaultSpec = "control+option+command+D"

    let canonical: String
    let keyCode: UInt32
    let modifiers: UInt32

    static func parse(_ raw: String?) -> DeckHotKey? {
        guard let raw = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
        var modifiers: UInt32 = 0
        var keyName: String?

        for token in raw.split(separator: "+") {
            let token = token.trimmingCharacters(in: .whitespaces).lowercased()
            switch token {
            case "control", "ctrl", "\u2303":
                modifiers |= UInt32(controlKey)
            case "option", "alt", "\u2325":
                modifiers |= UInt32(optionKey)
            case "shift", "\u21E7":
                modifiers |= UInt32(shiftKey)
            case "command", "cmd", "\u2318":
                modifiers |= UInt32(cmdKey)
            default:
                if !token.isEmpty { keyName = token.uppercased() }
            }
        }

        guard let keyName = keyName, let keyCode = keyCodes[keyName] else { return nil }
        let required = UInt32(controlKey | optionKey | cmdKey)
        guard modifiers & required != 0 else { return nil }

        var parts: [String] = []
        if modifiers & UInt32(controlKey) != 0 { parts.append("control") }
        if modifiers & UInt32(optionKey) != 0 { parts.append("option") }
        if modifiers & UInt32(shiftKey) != 0 { parts.append("shift") }
        if modifiers & UInt32(cmdKey) != 0 { parts.append("command") }
        parts.append(keyName)

        return DeckHotKey(
            canonical: parts.joined(separator: "+"),
            keyCode: keyCode,
            modifiers: modifiers
        )
    }

    private static let keyCodes: [String: UInt32] = [
        "A": UInt32(kVK_ANSI_A), "B": UInt32(kVK_ANSI_B), "C": UInt32(kVK_ANSI_C),
        "D": UInt32(kVK_ANSI_D), "E": UInt32(kVK_ANSI_E), "F": UInt32(kVK_ANSI_F),
        "G": UInt32(kVK_ANSI_G), "H": UInt32(kVK_ANSI_H), "I": UInt32(kVK_ANSI_I),
        "J": UInt32(kVK_ANSI_J), "K": UInt32(kVK_ANSI_K), "L": UInt32(kVK_ANSI_L),
        "M": UInt32(kVK_ANSI_M), "N": UInt32(kVK_ANSI_N), "O": UInt32(kVK_ANSI_O),
        "P": UInt32(kVK_ANSI_P), "Q": UInt32(kVK_ANSI_Q), "R": UInt32(kVK_ANSI_R),
        "S": UInt32(kVK_ANSI_S), "T": UInt32(kVK_ANSI_T), "U": UInt32(kVK_ANSI_U),
        "V": UInt32(kVK_ANSI_V), "W": UInt32(kVK_ANSI_W), "X": UInt32(kVK_ANSI_X),
        "Y": UInt32(kVK_ANSI_Y), "Z": UInt32(kVK_ANSI_Z),
        "0": UInt32(kVK_ANSI_0), "1": UInt32(kVK_ANSI_1), "2": UInt32(kVK_ANSI_2),
        "3": UInt32(kVK_ANSI_3), "4": UInt32(kVK_ANSI_4), "5": UInt32(kVK_ANSI_5),
        "6": UInt32(kVK_ANSI_6), "7": UInt32(kVK_ANSI_7), "8": UInt32(kVK_ANSI_8),
        "9": UInt32(kVK_ANSI_9),
        "F1": UInt32(kVK_F1), "F2": UInt32(kVK_F2), "F3": UInt32(kVK_F3),
        "F4": UInt32(kVK_F4), "F5": UInt32(kVK_F5), "F6": UInt32(kVK_F6),
        "F7": UInt32(kVK_F7), "F8": UInt32(kVK_F8), "F9": UInt32(kVK_F9),
        "F10": UInt32(kVK_F10), "F11": UInt32(kVK_F11), "F12": UInt32(kVK_F12),
    ]
}

private func deckHotKeyHandler(
    _ callRef: EventHandlerCallRef?,
    _ event: EventRef?,
    _ userData: UnsafeMutableRawPointer?
) -> OSStatus {
    guard let userData = userData else { return noErr }
    let delegate = Unmanaged<AppDelegate>.fromOpaque(userData).takeUnretainedValue()
    delegate.showPanel()
    return noErr
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var panel: DeckPanel!
    var model: MenuModel!
    var hosting: NSHostingView<DeckView>!
    var container: NSView!
    var statePath: String = NSString(string: "~/.agent-deck/menubar.json").expandingTildeInPath
    var parentPid: Int32 = 0
    var preview = false
    var monitors: [Any] = []
    var dismissObserver: NSObjectProtocol?
    var hotKeyRef: EventHotKeyRef?
    var hotKeyHandler: EventHandlerRef?
    var currentHotKey = ""
    var hotKeySequence: UInt32 = 1

    let panelWidth: CGFloat = 412

    /// Carbon hotkeys work even when the status item is hidden and do not need
    /// Accessibility access. The plugin sends the user's choice in menubar.json.
    func installHotKeyHandler() {
        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )
        _ = InstallEventHandler(
            GetApplicationEventTarget(),
            deckHotKeyHandler,
            1,
            &eventType,
            Unmanaged.passUnretained(self).toOpaque(),
            &hotKeyHandler
        )
        applyHotKey(DeckHotKey.defaultSpec)
    }

    func applyHotKey(_ raw: String?) {
        guard let spec = DeckHotKey.parse(raw) ?? DeckHotKey.parse(DeckHotKey.defaultSpec) else { return }
        if spec.canonical == currentHotKey, hotKeyRef != nil { return }

        hotKeySequence += 1
        let hotKeyID = EventHotKeyID(signature: OSType(0x41444B31), id: hotKeySequence)
        var newRef: EventHotKeyRef?
        let status = RegisterEventHotKey(
            spec.keyCode,
            spec.modifiers,
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &newRef
        )

        if status == noErr, let newRef = newRef {
            if let oldRef = hotKeyRef { UnregisterEventHotKey(oldRef) }
            hotKeyRef = newRef
            currentHotKey = spec.canonical
            return
        }

        // The requested combination is taken. Keep the previous shortcut if we
        // have one; otherwise fall back to the default.
        if hotKeyRef == nil, let fallback = DeckHotKey.parse(DeckHotKey.defaultSpec), fallback.canonical != spec.canonical {
            hotKeySequence += 1
            let fallbackID = EventHotKeyID(signature: OSType(0x41444B31), id: hotKeySequence)
            _ = RegisterEventHotKey(
                fallback.keyCode,
                fallback.modifiers,
                fallbackID,
                GetApplicationEventTarget(),
                0,
                &hotKeyRef
            )
            currentHotKey = fallback.canonical
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--state"), i + 1 < args.count { statePath = args[i + 1] }
        if let i = args.firstIndex(of: "--parent"), i + 1 < args.count { parentPid = Int32(args[i + 1]) ?? 0 }
        if let i = args.firstIndex(of: "--appearance"), i + 1 < args.count {
            NSApp.appearance = NSAppearance(named: args[i + 1] == "dark" ? .darkAqua : .aqua)
        }
        preview = args.contains("--preview")
        var pidPath = ""
        if let i = args.firstIndex(of: "--pidfile"), i + 1 < args.count { pidPath = args[i + 1] }

        model = MenuModel(statePath: statePath, parentPid: parentPid)

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.isVisible = true
        if let button = statusItem.button {
            if let image = lucideImage(lucideWandSVG, 18) {
                button.image = image
            } else {
                let image = NSImage(systemSymbolName: "sparkles", accessibilityDescription: "Agent Deck")
                image?.isTemplate = true
                button.image = image
            }
            button.imagePosition = .imageLeading
            button.title = " Agent Deck"
            button.font = NSFont.systemFont(ofSize: 11, weight: .medium)
            button.target = self
            button.action = #selector(togglePanel)
        }

        hostPanel()
        if !preview { installHotKeyHandler() }

        dismissObserver = NotificationCenter.default.addObserver(
            forName: .agentDeckDismiss, object: nil, queue: .main
        ) { [weak self] _ in
            self?.hidePanel()
        }

        model.onUpdate = { [weak self] in self?.refresh() }
        model.onShowRequest = { [weak self] in self?.showPanel() }
        model.start()
        refresh()
        forceDisplay()
        // Write the pid file only after lastShowAt has been recorded, so an
        // Obsidian command that waits for this pid cannot race the listener.
        if !pidPath.isEmpty {
            try? "\\(getpid())".write(toFile: pidPath, atomically: true, encoding: .utf8)
        }

        if preview {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { [weak self] in
                self?.showPanel()
            }
        }
    }

    func hostPanel() {
        let root = DeckView(model: model)
        hosting = NSHostingView(rootView: root)
        hosting.wantsLayer = true
        hosting.autoresizingMask = [.width, .height]

        // A plain container keeps NSHostingView's intrinsic height from
        // resizing the borderless window (maxHeight: .infinity otherwise asks
        // for the whole screen).
        container = NSView(frame: NSRect(x: 0, y: 0, width: panelWidth, height: 500))
        container.wantsLayer = true
        hosting.frame = container.bounds
        container.addSubview(hosting)

        panel = DeckPanel(
            contentRect: NSRect(x: 0, y: 0, width: panelWidth, height: 500),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.contentView = container
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.isMovable = false
        panel.isReleasedWhenClosed = false
        panel.isFloatingPanel = true
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
    }

    func refresh() {
        let short = model.state.short.trimmingCharacters(in: .whitespacesAndNewlines)
        statusItem.button?.title = short.isEmpty ? " Agent Deck" : " " + short

        let height = panelHeightForScreen()
        let resized = abs(panel.frame.height - height) > 0.5
        if resized {
            panel.setContentSize(NSSize(width: panelWidth, height: height))
        }
        if panel.isVisible {
            layoutPanel()
            if resized { forceDisplay() }
        }
        if hotKeyHandler != nil {
            applyHotKey(model.state.hotkey)
        }
    }

    func panelHeightForScreen() -> CGFloat {
        let desired = desiredHeight()
        if let screen = statusItem.button?.window?.screen ?? NSScreen.main {
            return min(desired, screen.visibleFrame.height - 16)
        }
        return desired
    }

    /// Keep this roughly in sync with the SwiftUI blocks above: a fixed header,
    /// a scrollable card area and a fixed footer. At most five cards are shown
    /// before scrolling; the body ends exactly at the fifth card so a sixth card
    /// never peeks through, while its shadow still has a little room.
    func desiredHeight() -> CGFloat {
        let sessions = model.state.sessions
        if sessions.isEmpty { return 300 }

        let shown = min(5, sessions.count)
        let prefix = sessions.prefix(shown)
        let hasPrimary = prefix.contains { $0.primary }
        let hasOthers = prefix.contains { !$0.primary }

        let agentRows = max(1, ((model.state.agents?.count ?? 0) + 1) / 2)
        let headerBlock: CGFloat = 85 + CGFloat(agentRows - 1) * 23 + (model.state.needsApproval > 0 ? 29 : 0)
        let footer: CGFloat = 49

        var sectionHeaders: CGFloat = 0
        if hasPrimary { sectionHeaders += 15 }
        if hasOthers { sectionHeaders += hasPrimary ? 19 : 15 }

        // LazyVStack spacing sits between every block: headers, cards, headers.
        let sections = (hasPrimary ? 1 : 0) + (hasOthers ? 1 : 0)
        let gaps = sections + shown - 1
        let body = 11 + sectionHeaders + CGFloat(gaps) * 8 + CGFloat(shown) * 58 + 2
        return headerBlock + body + footer + 2
    }

    func layoutPanel() {
        let size = panel.frame.size

        // Preview builds are used for screenshots and can be launched while the
        // menu bar is crowded (the status item's window may not be on screen).
        if preview, let screen = NSScreen.main {
            let x = screen.frame.midX - size.width / 2
            let y = screen.frame.maxY - size.height - 42
            panel.setFrame(NSRect(x: x.rounded(), y: y.rounded(), width: size.width, height: size.height), display: true)
            return
        }

        guard let button = statusItem.button else { return }
        let screen = button.window?.screen ?? NSScreen.main
        let visible = screen?.visibleFrame

        // A status item hidden by a menu-bar manager lives in a tiny off-screen
        // window at (0, -22). Its frame is non-empty, so also check that it is
        // actually up in the menu bar before trusting it.
        var anchorX: CGFloat?
        var anchorTop: CGFloat?
        if let window = button.window {
            let rect = window.convertToScreen(button.convert(button.bounds, to: nil))
            let nearMenuBar = visible.map { rect.midY > $0.maxY - 40 && rect.midX > $0.minX && rect.midX < $0.maxX } ?? true
            if rect.width > 2, rect.height > 2, nearMenuBar {
                anchorX = rect.midX
                anchorTop = rect.minY
            }
        }

        // Fall back to the click position. If the accessibility click did not
        // move the pointer (or the item is hidden), use the top-right corner.
        if anchorX == nil {
            let mouse = NSEvent.mouseLocation
            if let visible = visible, mouse.y > visible.maxY - 40, mouse.x > visible.minX, mouse.x < visible.maxX {
                anchorX = mouse.x
            } else if let visible = visible {
                anchorX = visible.maxX - 120
            }
        }
        if anchorTop == nil { anchorTop = visible?.maxY }

        guard let ax = anchorX, let top = anchorTop else { return }
        var x = ax - size.width / 2
        var y = top - size.height - 6
        if let visible = visible {
            x = min(max(x, visible.minX + 8), visible.maxX - size.width - 8)
            if y < visible.minY + 8 { y = visible.minY + 8 }
            if y + size.height > visible.maxY - 4 { y = visible.maxY - 4 - size.height }
        }
        panel.setFrame(
            NSRect(x: x.rounded(), y: y.rounded(), width: size.width, height: size.height),
            display: true
        )
    }

    func showPanel() {
        if panel.isVisible {
            // The shortcut always opens/focuses; it never closes the panel.
            panel.orderFrontRegardless()
            panel.makeKey()
            NSApp.activate(ignoringOtherApps: true)
            return
        }

        layoutPanel()
        panel.alphaValue = 1
        // Put the panel on screen before asking macOS to activate the app. The
        // visual response should not wait for activation.
        panel.orderFrontRegardless()
        forceDisplay()
        model.panelVisible = true
        statusItem.button?.highlight(true)
        installMonitors()
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
    }

    func forceDisplay() {
        hosting.frame = container.bounds
        hosting.needsLayout = true
        hosting.layoutSubtreeIfNeeded()
        panel.displayIfNeeded()
    }

    func hidePanel() {
        guard panel.isVisible else { return }
        model.panelVisible = false
        removeMonitors()
        statusItem.button?.highlight(false)
        panel.orderOut(nil)
        panel.alphaValue = 1
    }

    func installMonitors() {
        removeMonitors()
        let global = NSEvent.addGlobalMonitorForEvents(
            matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]
        ) { [weak self] _ in
            DispatchQueue.main.async { self?.hidePanel() }
        }
        let local = NSEvent.addLocalMonitorForEvents(
            matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown, .keyDown]
        ) { [weak self] event in
            guard let self = self else { return event }
            if event.type == .keyDown {
                if event.keyCode == 53 {
                    self.hidePanel()
                    return nil
                }
                return event
            }
            let point = NSEvent.mouseLocation
            if let button = self.statusItem.button, let window = button.window {
                let rect = window.convertToScreen(button.convert(button.bounds, to: nil))
                if rect.contains(point) { return event }
            }
            if !self.panel.frame.contains(point) { self.hidePanel() }
            return event
        }
        monitors = [global, local].compactMap { $0 }
    }

    func removeMonitors() {
        for monitor in monitors {
            NSEvent.removeMonitor(monitor)
        }
        monitors.removeAll()
    }

    @objc func togglePanel() {
        if panel.isVisible {
            hidePanel()
        } else {
            showPanel()
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
`;

// src/menubar.js
var fsp3 = import_fs3.default.promises;
var home3 = () => import_os3.default.homedir();
var INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>AgentDeckMenuBar</string>
<key>CFBundleDisplayName</key><string>Agent Deck</string>
<key>CFBundleIdentifier</key><string>com.matsurimw.agentdeck.menubar</string>
<key>CFBundleExecutable</key><string>AgentDeckMenuBar</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>0.2.0</string>
<key>CFBundleShortVersionString</key><string>0.2.0</string>
<key>LSUIElement</key><true/>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
`;
var MenuBarBridge = class {
  constructor(plugin) {
    this.plugin = plugin;
    this.dir = import_path3.default.join(home3(), ".agent-deck");
    this.appPath = import_path3.default.join(this.dir, "AgentDeckMenuBar.app");
    this.binPath = import_path3.default.join(this.appPath, "Contents", "MacOS", "AgentDeckMenuBar");
    this.infoPath = import_path3.default.join(this.appPath, "Contents", "Info.plist");
    this.srcPath = import_path3.default.join(this.dir, "AgentDeckMenuBar.swift");
    this.statePath = import_path3.default.join(this.dir, "menubar.json");
    this.pidPath = import_path3.default.join(this.dir, "menubar.pid");
    this.hashPath = import_path3.default.join(this.dir, "menubar.sha");
    this.timer = null;
    this.lastJson = "";
    this.disabled = false;
    this.starting = null;
  }
  get enabled() {
    return process.platform === "darwin" && this.plugin.settings.showMenuBar !== false;
  }
  isAlive() {
    try {
      const pid = Number(import_fs3.default.readFileSync(this.pidPath, "utf8").trim());
      if (pid > 0) {
        process.kill(pid, 0);
        return true;
      }
    } catch {
    }
    return false;
  }
  async start() {
    if (!this.enabled) return;
    if (this.timer && this.isAlive()) {
      this.update(true);
      return;
    }
    if (this.starting) return this.starting;
    this.starting = this._start().catch((e) => {
      console.error("[agent-deck] menu bar", e);
      this.plugin.notice("macOS \u83DC\u5355\u680F\u542F\u52A8\u5931\u8D25\uFF1A" + (e && e.message || e), 12e3);
    }).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }
  // 官方 App 图标给 SwiftUI 用：和 main.js 里嵌的是同一份 PNG
  writeAgentIcons() {
    const dir = import_path3.default.join(this.dir, "agents");
    try {
      import_fs3.default.mkdirSync(dir, { recursive: true });
    } catch {
      return;
    }
    for (const id of ["claude", "codex", "workbuddy", "dsh"]) {
      try {
        const buf = agentImageBuffer(id);
        if (buf) import_fs3.default.writeFileSync(import_path3.default.join(dir, `${id}.png`), buf);
      } catch {
      }
    }
  }
  async _start() {
    await fsp3.mkdir(this.dir, { recursive: true });
    this.writeAgentIcons();
    const hash = import_crypto.default.createHash("sha256").update(menubar_default).digest("hex").slice(0, 16);
    let oldHash = "";
    try {
      oldHash = (await fsp3.readFile(this.hashPath, "utf8")).trim();
    } catch {
    }
    const hasBinary = import_fs3.default.existsSync(this.binPath);
    if (!hasBinary || oldHash !== hash) {
      await this.compile(hash);
    }
    this.update(true);
    this.launch();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.update(), 1800);
  }
  async compile(hash) {
    if (!import_fs3.default.existsSync("/usr/bin/swiftc")) {
      throw new Error("\u627E\u4E0D\u5230 /usr/bin/swiftc\u3002\u5B89\u88C5 Xcode Command Line Tools\uFF08xcode-select --install\uFF09\u540E\u518D\u8BD5\u3002");
    }
    this.plugin.notice("\u6B63\u5728\u51C6\u5907 macOS \u83DC\u5355\u680F\uFF08\u7B2C\u4E00\u6B21\u8981\u7F16\u8BD1\u4E00\u4E2A\u5C0F\u52A9\u624B\uFF0C\u7EA6\u51E0\u79D2\uFF09\u2026", 6e3);
    this.killExisting();
    await fsp3.mkdir(import_path3.default.join(this.appPath, "Contents", "MacOS"), { recursive: true });
    await fsp3.writeFile(this.srcPath, menubar_default, "utf8");
    await fsp3.writeFile(this.infoPath, INFO_PLIST, "utf8");
    const tmp = this.binPath + ".new";
    try {
      await fsp3.unlink(tmp);
    } catch {
    }
    const res = await new Promise((resolve) => {
      const child = (0, import_child_process3.spawn)("/usr/bin/swiftc", ["-O", "-swift-version", "5", "-framework", "AppKit", "-framework", "SwiftUI", "-framework", "Carbon", "-o", tmp, this.srcPath], { stdio: ["ignore", "pipe", "pipe"] });
      let err2 = "";
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
        }
        resolve({ ok: false, err: "\u7F16\u8BD1\u8D85\u8FC7 90 \u79D2" });
      }, 9e4);
      child.stdout.on("data", () => {
      });
      child.stderr.on("data", (b) => {
        err2 += b.toString();
        if (err2.length > 8e3) err2 = err2.slice(-8e3);
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        resolve({ ok: false, err: String(e && e.message || e) });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ ok: code === 0, err: err2 });
      });
    });
    if (!res.ok) {
      this.disabled = true;
      throw new Error((res.err || "swiftc \u7F16\u8BD1\u5931\u8D25").slice(0, 700));
    }
    try {
      await fsp3.unlink(this.binPath);
    } catch {
    }
    await fsp3.rename(tmp, this.binPath);
    await fsp3.writeFile(this.hashPath, hash, "utf8");
  }
  launch() {
    this.lastLaunch = Date.now();
    this.killExisting();
    const args = ["-n", "-g", this.appPath, "--args", "--state", this.statePath, "--parent", String(process.pid), "--pidfile", this.pidPath];
    try {
      (0, import_child_process3.execFile)("/usr/bin/open", args, () => {
      });
    } catch (e) {
      console.error("[agent-deck] launch menu bar", e);
    }
  }
  killExisting() {
    try {
      const pid = Number(import_fs3.default.readFileSync(this.pidPath, "utf8").trim());
      if (pid > 0) {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
        }
      }
    } catch {
    }
    try {
      (0, import_child_process3.execFile)("/usr/bin/pkill", ["-f", this.binPath], () => {
      });
    } catch {
    }
    try {
      import_fs3.default.unlinkSync(this.pidPath);
    } catch {
    }
  }
  show() {
    try {
      import_fs3.default.mkdirSync(this.dir, { recursive: true });
      import_fs3.default.writeFileSync(import_path3.default.join(this.dir, "show-panel"), String(Date.now()), "utf8");
    } catch (e) {
      console.error("[agent-deck] menu bar show", e);
    }
  }
  update(force = false) {
    if (!this.enabled || this.disabled) return;
    try {
      const state = this.plugin.buildMenuBarState();
      const json = JSON.stringify(state);
      if (!force && json === this.lastJson) return;
      this.lastJson = json;
      const tmp = this.statePath + ".tmp";
      import_fs3.default.mkdirSync(this.dir, { recursive: true });
      import_fs3.default.writeFileSync(tmp, json, "utf8");
      import_fs3.default.renameSync(tmp, this.statePath);
      if (this.timer && !this.isAlive() && Date.now() - (this.lastLaunch || 0) > 1e4) this.launch();
    } catch (e) {
      console.error("[agent-deck] menu bar state", e);
    }
  }
  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.killExisting();
  }
  async restart() {
    this.stop();
    this.disabled = false;
    this.lastJson = "";
    await this.start();
  }
};

// src/autolog.js
var import_obsidian5 = require("obsidian");

// src/llm.js
var import_fs4 = __toESM(require("fs"), 1);
var import_os4 = __toESM(require("os"), 1);
var import_path4 = __toESM(require("path"), 1);
var import_child_process4 = require("child_process");
var home4 = () => import_os4.default.homedir();
function workDir() {
  const dir = import_path4.default.join(import_os4.default.tmpdir(), "agent-deck-autolog");
  try {
    import_fs4.default.mkdirSync(dir, { recursive: true });
  } catch {
  }
  return dir;
}
function judgeBin(configured = "") {
  const c = String(configured || "").trim();
  if (c) return c.replace(/^~(?=\/)/, home4());
  const spots = [import_path4.default.join(home4(), ".local/bin/claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude", "/usr/bin/claude"];
  return spots.find((p) => {
    try {
      return import_fs4.default.existsSync(p);
    } catch {
      return false;
    }
  }) || "claude";
}
function runClaude(prompt, { bin = "claude", model = "haiku", timeout = 120, system = "" } = {}) {
  return new Promise((resolve, reject) => {
    const cwd = workDir();
    const args = ["-p", "--output-format", "json", "--no-session-persistence", "--strict-mcp-config", "--setting-sources", "project", "--tools", "", "--system-prompt", system || "\u4F60\u662F\u4E00\u4E2A\u53EA\u8F93\u51FA JSON \u7684\u6574\u7406\u52A9\u624B\u3002"];
    if (model) args.push("--model", model);
    const env = { ...process.env, PATH: [import_path4.default.join(home4(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", process.env.PATH || ""].join(":") };
    let child;
    try {
      child = (0, import_child_process4.spawn)(bin, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      return reject(new Error(`\u542F\u52A8 claude \u5931\u8D25\uFF1A${e.message}`));
    }
    let out = "", err2 = "";
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.stderr.on("data", (d) => {
      err2 += d;
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`claude \u7B49\u4E86 ${timeout} \u79D2\u6CA1\u56DE\u6765`));
    }, timeout * 1e3);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`\u542F\u52A8 claude \u5931\u8D25\uFF1A${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let d;
      try {
        d = JSON.parse(out);
      } catch {
        return reject(new Error((err2 || out || `claude \u9000\u51FA\u7801 ${code}`).trim().slice(0, 300)));
      }
      if (d.is_error) return reject(new Error(String(d.result || "claude \u8FD4\u56DE\u9519\u8BEF").slice(0, 300)));
      resolve(String(d.result || ""));
    });
    child.stdin.end(prompt);
  });
}
function safeLabel(s, max = 40) {
  const t = String(s || "").replace(/[\r\n←`*=~[\]|]/g, " ").replace(/^\s*(?:[-*+]\s+)?(?:TODO|DOING|DONE|SUSPENDED|PAUSED|TOREVIEW|HITLIMIT|NEEDOK|QUEUED|ERRORED|DELEGATED)\s+/i, "").replace(/(\d)[:：](\d)/g, "$1.$2").replace(/\s+/g, " ").replace(/[。；;，,\s]+$/, "").trim();
  const chars = [...t];
  return (chars.length > max ? chars.slice(0, max).join("").trim() + "\u2026" : t).slice(0, max + 1);
}

// src/autolog.js
var AGENTS_FOR_JOURNAL = ["claude", "codex", "workbuddy", "dsh"];
var AGENT_NAMES = { claude: "Claude", codex: "Codex", workbuddy: "WorkBuddy", dsh: "DSH" };
var AutoLog = class {
  constructor(plugin) {
    this.p = plugin;
    this._busy = false;
    this._at = Date.now();
    this._err = "";
    this._cache = /* @__PURE__ */ new Map();
  }
  get cfg() {
    return this.p.settings;
  }
  get usage() {
    return this.p.usage;
  }
  dayKey() {
    return dayKeyToday(this.cfg);
  }
  nowMin() {
    return (Date.now() - startOfDay(Date.now(), this.cfg)) / 6e4;
  }
  journalPath(day) {
    return `${this.cfg.journalFolder || "\u65E5\u8BB0"}/${day}.md`;
  }
  journalFile(day) {
    const f = this.p.app.vault.getAbstractFileByPath(this.journalPath(day));
    return f && f.extension === "md" ? f : null;
  }
  viewFor(file) {
    let view = null;
    this.p.app.workspace.iterateAllLeaves((leaf) => {
      const v = leaf.view;
      if (!view && v instanceof import_obsidian5.MarkdownView && v.file && v.file.path === file.path && v.getMode && v.getMode() === "source") view = v;
    });
    return view;
  }
  async read(file) {
    const v = this.viewFor(file);
    return v ? v.editor.getValue() : this.p.app.vault.read(file);
  }
  // 只改前后不一样的那几行；这期间日记被改过就不写，返回 false
  async write(file, base, next) {
    if (base === next) return true;
    const v = this.viewFor(file);
    if (v) {
      if (v.editor.getValue() !== base) return false;
      const change = diffLines(base, next);
      if (change) v.editor.transaction({ changes: [change] });
      return true;
    }
    let ok = false;
    await this.p.app.vault.process(file, (cur) => {
      ok = cur === base;
      return ok ? next : cur;
    });
    return ok;
  }
  // 新写一块：装了「任务归位」就按状态进分区，没装就接在最后
  placeBlock(text, blockLines) {
    const core = this.p.app.plugins?.plugins?.["done-to-top"]?.core;
    if (core && core.addBlock) {
      try {
        return core.addBlock(text, blockLines);
      } catch {
      }
    }
    return `${text.replace(/\s*$/, "")}
${blockLines.join("\n")}
`;
  }
  state(day) {
    var _a;
    const all = (_a = this.cfg).autoLogState || (_a.autoLogState = {});
    return all[day] || (all[day] = {});
  }
  archived() {
    const out = /* @__PURE__ */ new Set();
    if (this.cfg.autoLogArchiveDone === false) return out;
    for (const sid of this.usage.archivedClaude || []) out.add(sid);
    for (const sid of this.usage.archived || []) out.add(sid);
    return out;
  }
  autoParked(rec, cur) {
    return cur === "paused" && !!rec && !!rec.autoPaused;
  }
  hasChildren(text, line) {
    const lines = text.split("\n");
    const base = width(lines[line]);
    for (let i = line + 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      return width(lines[i]) > base;
    }
    return false;
  }
  // 这一行现在改写成什么状态
  autoLine(text, rec, x, status) {
    const found = findTask(text, rec.key);
    const segs = x && x.segs || [];
    const first = segs.length ? segs[0][0] : 0;
    const last = segs.length ? segs[segs.length - 1][1] : first;
    const done = (body2) => `DONE ${x ? clock(last) + " " : ""}${body2}`;
    if (!found) {
      if (!rec.fresh) return { text, gone: true };
      const line = status === "doing" ? `- DOING ${clock(first)} ${rec.label}` : status === "done" ? `- ${done(rec.label)}` : `- PAUSED ${rec.label}`;
      return { text: this.placeBlock(text, [line]) };
    }
    const lines = text.split("\n");
    const raw = lines[found.line];
    const p = splitTask(raw);
    if (!p) return { text };
    const body = rec.created ? rec.label : p.rest.replace(/^\d{1,2}[:：]\d{2}\s*[-–~～到至]\s*\d{1,2}[:：]\d{2}\s*/, "");
    const since = rec.created ? clock(first) : segs.length ? clock(first) : p.since || clock(first);
    const next = status === "doing" ? `${p.prefix}DOING ${since} ${body}`.trimEnd() : status === "done" ? (p.prefix + done(body)).trimEnd() : `${p.prefix}PAUSED ${body}`.trimEnd();
    if (next === raw) return { text };
    lines[found.line] = next;
    return { text: lines.join("\n") };
  }
  // 实际时段写在那一行下面第一个 ⏱ 子项里；绑着的会话不用再留 🔗 行，会话号写进 ⏱ 末尾
  autoClock(text, key, segs, who, tok = 0, sid = "") {
    const found = findTask(text, key);
    if (!found || !segs.length) return text;
    const lines = text.split("\n");
    const at = found.line;
    const shown = [];
    for (const [a, b] of segs) {
      const prev = shown[shown.length - 1];
      if (prev && a - prev[1] <= 10) prev[1] = Math.max(prev[1], b);
      else shown.push([a, b]);
    }
    const total = Math.round(segs.reduce((n, [a, b]) => n + b - a, 0));
    const indent = (/^\s*/.exec(lines[at]) || [""])[0] + "	";
    const line = `${indent}- \u23F1 ${shown.length > 8 ? "\u2026 " : ""}${shown.slice(-8).map(([a, b]) => `${clock(a)}\u2013${clock(b)}`).join("\u3001")} \xB7 \u5171 ${durTag(total)}${tok ? ` \xB7 ${fmtTok(tok)} tok` : ""}${who ? " \xB7 " + who : ""}`;
    if (sid) {
      const l = linkUnder(lines, at);
      if (l && l.sid === sid) lines.splice(l.line, 1);
    }
    const base = width(lines[at]);
    for (let i = at + 1; i < lines.length; i++) {
      if (lines[i].trim() && width(lines[i]) <= base) break;
      if (CLOCK_RE.test(lines[i])) {
        if (lines[i] === line) return text;
        lines[i] = line;
        return lines.join("\n");
      }
    }
    lines.splice(at + 1, 0, line);
    return lines.join("\n");
  }
  // 让本机的小模型看一眼这几个会话：起名字、对上日记里哪一行
  async ask(items, open, fallback = false) {
    const blocks = items.map(({ x, active }, i) => {
      const meta = this.usage.meta.get(x.sid) || {};
      const last = String(meta.lastText || "").replace(/\d{12,}/g, "\u2026").replace(/\s+/g, " ").trim().slice(-700);
      return [
        `#s${i + 1} [${AGENT_NAMES[x.agent] || x.agent}] \u6807\u9898\uFF1A${x.title || "\uFF08\u6CA1\u6709\uFF09"}\uFF1B\u7D2F\u8BA1 ${x.min} \u5206\u949F\uFF1B\u73B0\u5728\uFF1A${active ? "\u8FD8\u5728\u8FDB\u884C" : "\u5DF2\u7ECF\u505C\u4E86"}`,
        x.text ? `\u5F00\u5934\u8BF4\u7684\uFF1A${String(x.text).replace(/\d{12,}/g, "\u2026").slice(0, 200)}` : "",
        last ? `\u6700\u540E\u4E00\u6761\u56DE\u590D\u7684\u7ED3\u5C3E\uFF1A${last}` : ""
      ].filter(Boolean).join("\n");
    });
    const prompt = [
      "\u4E0B\u9762\u662F\u7528\u6237\u4ECA\u5929\u548C AI \u52A9\u624B\u7684\u51E0\u4E2A\u5DE5\u4F5C\u4F1A\u8BDD\uFF0C\u4EE5\u53CA\u4ED6\u4ECA\u5929\u65E5\u8BB0\u91CC\u8FD8\u6CA1\u505A\u5B8C\u7684\u4EFB\u52A1\u884C\u3002\u8BF7\u628A\u6BCF\u4E2A\u4F1A\u8BDD\u6574\u7406\u6210\u4E00\u6761\u4EFB\u52A1\u8BB0\u5F55\u3002",
      "",
      "\u3010\u65E5\u8BB0\u91CC\u8FD8\u6CA1\u505A\u5B8C\u7684\u4EFB\u52A1\u884C\u3011\uFF08\u7F16\u53F7: \u72B6\u6001 \u6587\u5B57\uFF09",
      open.length ? open.map((i, n) => `${n + 1}: ${i.doing ? "DOING" : i.paused ? "PAUSED" : "TODO"} ${workKey(i.label)}`).join("\n") : "\uFF08\u6CA1\u6709\uFF09",
      "",
      "\u3010\u4F1A\u8BDD\u3011",
      blocks.join("\n\n"),
      "",
      "\u53EA\u8F93\u51FA\u4E00\u4E2A JSON \u6570\u7EC4\uFF0C\u6BCF\u4E2A\u4F1A\u8BDD\u4E00\u9879\uFF0C\u4E0D\u8981\u89E3\u91CA\u3001\u4E0D\u8981\u4EE3\u7801\u5757\uFF1A",
      '[{"id":"s1","label":"\u2026","match":null,"done":false,"todos":[],"skip":false}]',
      "\u5B57\u6BB5\uFF1A",
      "- label\uFF1A\u8FD9\u4EF6\u4E8B\u662F\u4EC0\u4E48\uFF0C\u4E0D\u8D85\u8FC7 20 \u4E2A\u5B57\u7684\u4E2D\u6587\u77ED\u8BED\uFF08\u52A8\u8BCD\u5F00\u5934\uFF09\uFF0C\u4E0D\u8981\u5E26\u65F6\u95F4\u3001\u65F6\u957F\u3001\u72B6\u6001\u8BCD\u548C\u6807\u70B9\u7ED3\u5C3E\u3002",
      "- match\uFF1A\u53EA\u6709\u5F53\u4E0A\u9762\u67D0\u4E00\u884C\u5199\u7684\u5C31\u662F\u300C\u8FD9\u4E2A\u4F1A\u8BDD\u91CC AI \u5728\u66FF\u7528\u6237\u505A\u7684\u90A3\u4EF6\u5DE5\u4F5C\u672C\u8EAB\u300D\u65F6\uFF0C\u624D\u586B\u90A3\u4E00\u884C\u7684\u7F16\u53F7\u3002\u90A3\u4E00\u884C\u5982\u679C\u662F\u7559\u7ED9\u7528\u6237\u672C\u4EBA\u7684\u52A8\u4F5C\uFF08\u770B\u4E00\u773C\u3001\u770B\u6548\u679C\u3001\u786E\u8BA4\u3001\u62CD\u677F\u3001\u81EA\u5DF1\u8DD1\u547D\u4EE4\u3001\u53D1\u51FA\u53BB\u3001\u9605\u8BFB\u4E4B\u7C7B\uFF09\uFF0C\u54EA\u6015\u8BDD\u9898\u4E00\u6837\u4E5F\u4E0D\u80FD\u5339\u914D\uFF0C\u586B null\u3002\u62FF\u4E0D\u51C6\u4E00\u5F8B\u586B null\u3002",
      "- done\uFF1A\u53EA\u5BF9\u5DF2\u7ECF\u505C\u4E86\u7684\u4F1A\u8BDD\u6709\u610F\u4E49\u3002\u6700\u540E\u7684\u56DE\u590D\u660E\u786E\u8868\u660E\u8FD9\u4EF6\u4E8B\u6574\u4E2A\u505A\u5B8C\u4E86\uFF0C\u586B true\uFF1B\u505A\u5230\u4E00\u534A\u3001\u8FD8\u5728\u7B49\u7528\u6237\u3001\u62A5\u9519\u6CA1\u89E3\u51B3\u3001\u8BF4\u4E86\u4EE5\u540E\u518D\u7EE7\u7EED\uFF0C\u90FD\u586B false\u3002",
      "- todos\uFF1A\u53EA\u5728\u4F1A\u8BDD\u5DF2\u7ECF\u505C\u4E86\u65F6\u586B\u3002\u56DE\u590D\u91CC\u660E\u786E\u8BF4\u4E86\u8981\u7528\u6237\u672C\u4EBA\u53BB\u505A\u6216\u62CD\u677F\u7684\u4E8B\uFF0C\u6BCF\u6761\u4E0D\u8D85\u8FC7 30 \u4E2A\u5B57\uFF0C\u6700\u591A 1 \u6761\uFF0C\u53EA\u5217\u4E0D\u505A\u5C31\u5361\u4F4F\u7684\u90A3\u4E00\u4EF6\uFF1B\u6CA1\u6709\u5C31\u662F\u7A7A\u6570\u7EC4\u3002\u4E0A\u9762\u4EFB\u52A1\u884C\u91CC\u5DF2\u7ECF\u6709\u610F\u601D\u76F8\u540C\u7684\u5C31\u4E0D\u8981\u518D\u5217\u3002",
      "- skip\uFF1A\u4E00\u4E24\u53E5\u95F2\u804A\u6216\u95EE\u7B54\u3001\u6CA1\u6709\u5B9E\u9645\u505A\u4E8B\u7684\u4F1A\u8BDD\u586B true\u3002"
    ].join("\n");
    const out = /* @__PURE__ */ new Map();
    let raw = "";
    try {
      raw = await runClaude(prompt, { bin: judgeBin(this.cfg.autoLogPath || this.cfg.delegate?.claude?.path || ""), model: this.cfg.autoLogModel || "haiku" });
    } catch (e) {
      this._err = String(e.message || e);
      if (fallback) for (const { x } of items) {
        const label = safeLabel(x.title || (x.text || "").split(" / ")[0]);
        if (label) out.set(x.sid, { label, matchKey: null, done: false, todos: [], skip: false });
      }
      return out;
    }
    try {
      const arr = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));
      for (const a of arr) {
        const sid = items[Number(String(a.id).replace(/^s/, "")) - 1]?.x.sid;
        if (!sid) continue;
        const label = safeLabel(a.label);
        const m = Number.isInteger(a.match) && open[a.match - 1] ? open[a.match - 1] : null;
        out.set(sid, {
          label,
          matchKey: m ? workKey(m.label) : null,
          done: a.done === true,
          todos: (Array.isArray(a.todos) ? a.todos : []).map((t) => safeLabel(t, 50)).filter(Boolean).slice(0, 1),
          skip: !!a.skip || !label && !m
        });
      }
      this._err = "";
    } catch (e) {
      this._err = "\u6A21\u578B\u56DE\u7684\u4E0D\u662F JSON";
      if (fallback) for (const { x } of items) {
        const label = safeLabel(x.title || (x.text || "").split(" / ")[0]);
        if (label) out.set(x.sid, { label, matchKey: null, done: false, todos: [], skip: false });
      }
    }
    return out;
  }
  async run({ dry = false, fallback = false } = {}) {
    var _a, _b;
    const report = { asked: 0, changes: [], error: "" };
    if (this._busy) return report;
    this._busy = true;
    let day = "", snap = null, file = null;
    try {
      if (this.p.nautilusOwnsAi && this.p.nautilusOwnsAi()) {
        report.error = "\u87BA\u65CB\u65E5\u7A0B\u7684 AI \u8FFD\u8E2A\u8FD8\u5F00\u7740\uFF0C\u5148\u5728\u8BBE\u7F6E\u91CC\u505C\u7528\u5B83";
        return report;
      }
      day = this.dayKey();
      file = this.journalFile(day);
      if (!file) {
        report.error = `\u4ECA\u5929\u7684\u65E5\u8BB0 ${this.journalPath(day)} \u8FD8\u6CA1\u5EFA`;
        return report;
      }
      const data = this.usage.summary(day);
      if (!data || !data.list || !data.list.length) return report;
      const idle = Math.max(5, this.cfg.autoLogIdle || 40);
      const now = this.nowMin();
      const st = this.state(day);
      snap = JSON.stringify(st);
      const arch = this.archived();
      const base = await this.read(file);
      const linked = linkMap(base);
      const todo = [], live = [];
      for (const x of data.list) {
        if (!x.segs || !x.segs.length) continue;
        if (!AGENTS_FOR_JOURNAL.includes(x.agent)) continue;
        if (linked.has(x.sid)) continue;
        const last = x.segs[x.segs.length - 1][1];
        const active = now - last <= idle;
        const rec = st[x.sid];
        if (rec && (rec.skip || rec.gone)) continue;
        if (!rec) {
          if (x.min < 3 && !arch.has(x.sid)) continue;
          todo.push({ x, active, fresh: true });
        } else if (rec.status === "doing" && !active && !rec.asked && !arch.has(x.sid)) todo.push({ x, active, rec });
        else live.push({ x, active, rec });
      }
      const ask = todo.slice(0, 8);
      let ans = /* @__PURE__ */ new Map();
      if (ask.length) {
        const open = openTasks(base).filter((i) => !this.hasChildren(base, i.line)).slice(0, 60);
        ans = await this.ask(ask, open, fallback);
        report.asked = ask.length;
        report.error = this._err || "";
      }
      const text0 = base;
      let text = text0;
      const digest = { doing: [], paused: [], done: [], archived: [], todo: [] };
      const clocks = /* @__PURE__ */ new Set();
      const work = (_b = (_a = this.cfg).workLog || (_a.workLog = {}))[day] || (_b[day] = {});
      for (const { x, active, fresh } of [...ask, ...todo.slice(8), ...live]) {
        const a = ans.get(x.sid);
        const last = x.segs[x.segs.length - 1][1];
        let rec = st[x.sid];
        if (fresh) {
          if (!a) continue;
          if (a.skip) {
            st[x.sid] = { skip: true };
            continue;
          }
          let m = a.matchKey ? taskItems(text).find((i) => i.state === "open" && i.key === a.matchKey) : null;
          if (m && !active && m.state !== "doing" && m.state !== "paused") m = null;
          if (!m && !a.label) {
            st[x.sid] = { skip: true };
            continue;
          }
          const label = m ? m.body : AUTO_MARK + a.label;
          rec = st[x.sid] = { key: workKey(label), label, created: !m, agent: x.agent, status: m ? m.state : null, fresh: !m };
        }
        rec.min = x.min;
        if (a) rec.asked = !active;
        if (active) delete rec.asked;
        const found = findTask(text, rec.key);
        if (!found && !rec.fresh) {
          rec.gone = true;
          report.changes.push(`\u4E0D\u518D\u7BA1\uFF1A${rec.label}\uFF08\u8FD9\u4E00\u884C\u6CA1\u4E86\uFF09`);
          continue;
        }
        const cur = found ? found.state : null;
        if (cur === "done") {
          if (rec.status !== "done") clocks.add(rec.key);
          rec.status = "done";
          continue;
        }
        if (rec.status && cur !== rec.status && cur) {
          if (cur === "doing") rec.hold = Date.now() + 2 * 36e5;
          else rec.parkedAt = last;
          rec.status = cur;
          delete rec.autoPaused;
        }
        const name = workKey(rec.label).replace(AUTO_MARK, "");
        if (arch.has(x.sid) && (fresh || cur === "doing" || this.autoParked(rec, cur))) {
          text = this.autoLine(text, rec, x, "done").text;
          rec.status = "done";
          delete rec.fresh;
          delete rec.parkedAt;
          delete rec.hold;
          delete rec.autoPaused;
          clocks.add(rec.key);
          digest.archived.push(`${name}\uFF08${x.min}m\uFF09`);
          report.changes.push(`DONE\uFF08\u5DF2\u5F52\u6863\uFF09\uFF1A${rec.label}\uFF08${x.min}m\uFF09`);
          continue;
        }
        if (active && cur !== "doing" && !(rec.parkedAt != null && last <= rec.parkedAt)) {
          text = this.autoLine(text, rec, x, "doing").text;
          rec.status = "doing";
          delete rec.parkedAt;
          delete rec.fresh;
          delete rec.autoPaused;
          digest.doing.push(name);
          report.changes.push(`DOING\uFF1A${rec.label}`);
        } else if (!active && (cur === "doing" || rec.fresh) && !(rec.hold && Date.now() < rec.hold)) {
          text = this.autoLine(text, rec, x, "paused").text;
          rec.status = "paused";
          rec.autoPaused = true;
          rec.parkedAt = last;
          delete rec.fresh;
          clocks.add(rec.key);
          digest.paused.push(`${name}\uFF08${x.min}m\uFF09`);
          report.changes.push(`PAUSED\uFF1A${rec.label}\uFF08${x.min}m\uFF09`);
        }
        if (a && !active && a.done && !rec.doneHint) {
          rec.doneHint = true;
          digest.done.push(`${name}\uFF08${x.min}m\uFF09`);
          report.changes.push(`\u770B\u7740\u505A\u5B8C\u4E86\uFF1A${rec.label}`);
        }
        if (a && !active && a.todos.length && !rec.todosAdded) {
          const have = taskItems(text).map((i) => i.key);
          for (const t of a.todos) {
            if (have.some((k) => k.includes(t))) continue;
            text = this.placeBlock(text, [`- TODO ${AUTO_MARK}${t}`]);
            digest.todo.push(t);
            report.changes.push(`TODO\uFF1A${t}`);
          }
          rec.todosAdded = true;
        }
      }
      const byKey = /* @__PURE__ */ new Map(), who = /* @__PURE__ */ new Map(), toks = /* @__PURE__ */ new Map(), sids = /* @__PURE__ */ new Map();
      for (const x of data.list) {
        const rec = st[x.sid];
        if (!rec || rec.skip || rec.gone || !rec.key) continue;
        toks.set(rec.key, (toks.get(rec.key) || 0) + (x.out || 0) + (x.fresh || 0));
        (sids.get(rec.key) || sids.set(rec.key, []).get(rec.key)).push(x.agent === "claude" ? x.sid : "");
        (byKey.get(rec.key) || byKey.set(rec.key, []).get(rec.key)).push(...x.segs);
        (who.get(rec.key) || who.set(rec.key, /* @__PURE__ */ new Set()).get(rec.key)).add(AGENT_NAMES[x.agent] || x.agent);
      }
      const merged = /* @__PURE__ */ new Map();
      for (const [k, segs] of byKey) merged.set(k, mergeSegs([...(work[k] || []).filter((s) => s[1] != null), ...segs]));
      for (const k of clocks) if (merged.has(k)) text = this.autoClock(text, k, merged.get(k), [...who.get(k)].join(" / "), toks.get(k) || 0, (sids.get(k) || []).filter(Boolean).length === 1 ? (sids.get(k) || []).filter(Boolean)[0] : "");
      report.diff = diffLines(base, text);
      if (dry) {
        this.cfg.autoLogState[day] = JSON.parse(snap);
        return report;
      }
      if (!await this.write(file, base, text)) {
        this.cfg.autoLogState[day] = JSON.parse(snap);
        report.error = "\u65E5\u8BB0\u6B63\u5728\u88AB\u6539\uFF0C\u8FD9\u4E00\u8F6E\u6CA1\u5199";
        return report;
      }
      for (const [k, segs] of merged) work[k] = segs;
      await this.archivePast(arch, day);
      for (const k of Object.keys(this.cfg.autoLogState).sort().slice(0, -4)) delete this.cfg.autoLogState[k];
      await this.p.saveSettings();
      if (this.cfg.autoLogNotify !== false) this.digest(digest, idle, file);
      return report;
    } catch (e) {
      console.error("[agent-deck] \u81EA\u52A8\u8BB0\u65E5\u8BB0\u5931\u8D25", e);
      if (snap && day) this.cfg.autoLogState[day] = JSON.parse(snap);
      report.error = String(e.message || e);
      return report;
    } finally {
      this._busy = false;
    }
  }
  // 前几天记下、还挂着的行：会话归档了，就在它当天的日记里补成 DONE。
  // 你自己改成 TODO / PAUSED 的不动；日记正好被改过就跳过这一天。
  async archivePast(arch, today) {
    if (!arch.size) return [];
    const out = [];
    for (const day of Object.keys(this.cfg.autoLogState || {})) {
      if (day === today) continue;
      const file = this.journalFile(day);
      if (!file) continue;
      const st = this.cfg.autoLogState[day] || {};
      const hits = Object.entries(st).filter(([sid, r]) => arch.has(sid) && r.key && !r.skip && !r.gone && (r.status === "doing" || this.autoParked(r, r.status)));
      if (!hits.length) continue;
      const base = await this.read(file);
      let text = base;
      const before = new Map(hits.map(([sid, rec]) => [sid, { status: rec.status, autoPaused: rec.autoPaused, gone: rec.gone }]));
      const list = (this.usage.summary(day) || {}).list || [];
      for (const [sid, rec] of hits) {
        const found = findTask(text, rec.key);
        if (!found) {
          rec.gone = true;
          continue;
        }
        if (found.state !== "doing" && !this.autoParked(rec, found.state)) {
          rec.status = found.state;
          delete rec.autoPaused;
          continue;
        }
        const x = list.find((s) => s.sid === sid && s.segs && s.segs.length) || null;
        text = this.autoLine(text, rec, x, "done").text;
        if (x) text = this.autoClock(text, rec.key, x.segs, AGENT_NAMES[x.agent] || x.agent, (x.out || 0) + (x.fresh || 0), x.agent === "claude" ? x.sid : "");
        rec.status = "done";
        delete rec.autoPaused;
        out.push(rec.label);
      }
      if (text !== base && !await this.write(file, base, text)) {
        for (const [sid, rec] of hits) {
          const b = before.get(sid);
          if (!b) continue;
          rec.status = b.status;
          if (b.autoPaused === void 0) delete rec.autoPaused;
          else rec.autoPaused = b.autoPaused;
          if (b.gone === void 0) delete rec.gone;
          else rec.gone = b.gone;
        }
        continue;
      }
    }
    return out;
  }
  digest(d, idle, file) {
    const sec = (head, list) => list.length ? `**${head}\uFF08${list.length} \u4EF6\uFF09**
${list.map((s) => "\xB7 " + s).join("\n")}` : "";
    const parts = [
      sec("\u25B6 \u5728\u505A", d.doing),
      sec(`\u23F8 ${idle} \u5206\u949F\u6CA1\u52A8\uFF0C\u5148\u6682\u505C\u4E86`, d.paused),
      sec("\u{1F4E6} \u4F1A\u8BDD\u5F52\u6863\u4E86\uFF0C\u8BB0\u6210\u505A\u5B8C", d.archived),
      sec("\u2705 \u770B\u7740\u50CF\u662F\u505A\u5B8C\u4E86\uFF0C\u8981\u6807 DONE \u81EA\u5DF1\u6539\u4E00\u4E0B", d.done),
      sec("\u{1F4CC} \u8BB0\u4E86\u8981\u4F60\u505A\u7684", d.todo)
    ].filter(Boolean);
    if (!parts.length) return;
    new import_obsidian5.Notice(`\u{1F916} \u6574\u7406\u4E86\u65E5\u8BB0
${parts.join("\n\n")}`, 9e3);
  }
  // 手动整理：一轮最多问 8 个，接着问到问完
  async logNow() {
    const changes = [];
    let error = "";
    for (let round = 0; round < 5; round++) {
      const r = await this.run({ fallback: true });
      changes.push(...r.changes);
      error = r.error || "";
      if (error || r.asked < 8) break;
    }
    this._at = Date.now();
    const msg = error && !changes.length ? `\u6CA1\u6574\u7406\u6210\uFF1A${error}` : changes.length ? `\u6574\u7406\u8FDB\u65E5\u8BB0\u4E86\uFF1A
${changes.join("\n")}${error ? `
\uFF08\u6A21\u578B\u6CA1\u95EE\u5230\uFF0C\u65B0\u4F1A\u8BDD\u5148\u7528\u5B83\u81EA\u5DF1\u7684\u6807\u9898\u8BB0\u7684\uFF1A${error}\uFF09` : ""}` : "\u6CA1\u6709\u8981\u6539\u7684\uFF1A\u4F1A\u8BDD\u90FD\u5DF2\u7ECF\u8BB0\u8FC7\u4E86\uFF0C\u6216\u8005\u8FD8\u592A\u77ED\uFF08\u4E0D\u5230 3 \u5206\u949F\uFF09";
    new import_obsidian5.Notice(msg, 9e3);
    this.p.refreshUI();
    return { changes, error };
  }
  tick() {
    if (!this.cfg.autoLog) return;
    if (Date.now() - this._at < Math.max(5, this.cfg.autoLogEvery || 20) * 6e4) return;
    this._at = Date.now();
    this.p.scanNow(false).catch(() => {
    }).then(() => this.run().catch((e) => console.error("[agent-deck] autolog", e)));
  }
};
function mergeSegs(segs) {
  const out = [];
  for (const [a, b] of [...segs].sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

// src/sync.js
var import_obsidian6 = require("obsidian");
var STATE_KW = { wait: "TOREVIEW", quiet: "TOREVIEW", "needs-approval": "NEEDOK", error: "ERRORED", limit: "HITLIMIT", queued: "QUEUED" };
var JournalSync = class {
  constructor(plugin) {
    this.p = plugin;
    this._busy = false;
    this._at = 0;
  }
  get usage() {
    return this.p.usage;
  }
  get cfg() {
    return this.p.settings;
  }
  archived(sid) {
    if (this.cfg.autoLogArchiveDone === false) return false;
    return this.usage.archivedClaude && this.usage.archivedClaude.has(sid) || this.usage.archived && this.usage.archived.has(sid);
  }
  dayList() {
    const day = dayKeyToday(this.cfg);
    const data = this.usage.summary(day);
    return data && data.list || [];
  }
  segmentsFor(sid) {
    const x = this.dayList().find((s) => s.sid === sid);
    return x ? { segs: x.segs || [], out: x.out || 0, fresh: x.fresh || 0, agent: x.agent } : null;
  }
  // 开着的笔记里所有带 🔗 的编辑器
  openViews() {
    const out = [];
    this.p.app.workspace.iterateAllLeaves((leaf) => {
      const v = leaf.view;
      if (v instanceof import_obsidian6.MarkdownView && v.file && v.editor && v.editor.cm) {
        try {
          if (v.editor.cm.state.doc.toString().includes("\u{1F517}")) out.push(v);
        } catch {
        }
      }
    });
    return out;
  }
  isOpen(file) {
    return this.openViews().some((v) => v.file.path === file.path);
  }
  todayJournal() {
    const f = this.p.app.vault.getAbstractFileByPath(`${this.cfg.journalFolder || "\u65E5\u8BB0"}/${dayKeyToday(this.cfg)}.md`);
    return f && f.extension === "md" ? f : null;
  }
  replace(view, before, after) {
    const cm = view.editor.cm;
    const change = diffLines(before, after);
    if (change) {
      try {
        view.editor.transaction({ changes: [change] });
        return true;
      } catch {
      }
    }
    return false;
  }
  async run({ force = false } = {}) {
    if (this._busy) return;
    if (!force && Date.now() - this._at < 8e3) return;
    this._at = Date.now();
    if (this.cfg.journalSync === false) return;
    if (this.p.nautilusOwnsAi && this.p.nautilusOwnsAi()) {
      if (!this._warned) {
        this._warned = true;
        console.info("[agent-deck] \u87BA\u65CB\u65E5\u7A0B\u7684 AI \u8FFD\u8E2A\u8FD8\u5F00\u7740\uFF0C\u56DE\u5199\u5148\u505C\u7740");
      }
      return;
    }
    this._busy = true;
    try {
      for (const view of this.openViews()) {
        const cm = view.editor.cm;
        if (!cm || !cm.dom.isConnected || cm.composing) continue;
        const text = cm.state.doc.toString();
        let next = text;
        if (this.cfg.resultBack !== false) next = this.results(next);
        if (this.cfg.agentKw !== false) next = this.keywords(next);
        if (this.cfg.kidBlocks !== false) {
          next = this.spawnAll(next);
          next = this.subsIntoAll(next);
          next = this.sides(next);
        }
        if (next !== text) this.replace(view, text, next);
      }
      const file = this.todayJournal();
      if (file && !this.isOpen(file)) {
        const text = await this.p.app.vault.read(file);
        let next = text;
        if (this.cfg.resultBack !== false) next = this.results(next);
        if (this.cfg.agentKw !== false) next = this.keywords(next);
        next = this.spawnAll(next);
        next = this.sides(next);
        if (next !== text) await this.p.app.vault.process(file, (cur) => cur === text ? next : cur);
      }
    } catch (e) {
      console.error("[agent-deck] \u4F1A\u8BDD\u56DE\u5199\u65E5\u8BB0\u5931\u8D25", e);
    } finally {
      this._busy = false;
    }
  }
  // 答完一轮或者归档了：把会话最后说的话写成 💬
  results(text) {
    const seen = /* @__PURE__ */ new Set();
    for (const line of text.split("\n")) {
      const k = parseLink(line);
      if (k && !seen.has(k.sid)) seen.add(k.sid);
    }
    let out = text;
    for (const sid of seen) {
      const m = this.usage.meta.get(sid);
      if (!m) continue;
      const waiting = m.state === "wait" || m.state === "quiet";
      if (!waiting && !this.archived(sid)) continue;
      const said = String(m.lastText || "").trim();
      if (!said) continue;
      out = resultInto(out, sid, resultText(said, this.cfg.resultMax || 200));
    }
    return out;
  }
  // 关键词跟着会话走：只在 DOING 和中间态之间切，你改成别的就不碰
  keywords(text) {
    let out = text;
    const lines = () => out.split("\n");
    for (let at = lines().length - 1; at >= 0; at--) {
      const line = lines()[at];
      const k = parseLink(line);
      if (!k) continue;
      const ls = lines();
      const n = markOwner(ls, at);
      if (n < 0) continue;
      const cur = kwLine(ls[n]);
      if (!cur) continue;
      if (!(cur.kw === "DOING" || cur.kw === "DELEGATED" || AGENT_KW_RE.test(cur.kw) || !cur.kw)) continue;
      if (this.archived(k.sid)) {
        if (cur.kw === "DOING" || cur.kw === "DELEGATED" || AGENT_KW_RE.test(cur.kw)) out = this.finish(out, k.sid, at);
        continue;
      }
      const m = this.usage.meta.get(k.sid);
      if (!m) continue;
      const want = m.state === "run" ? cur.kw === "DELEGATED" ? "DELEGATED" : "DOING" : STATE_KW[m.state];
      if (!want || want === cur.kw) continue;
      const p = splitTask(ls[n]);
      if (!p) continue;
      const nextLine = `${p.prefix}${want} ${p.since ? p.since + " " : ""}${p.rest}`.trimEnd();
      if (nextLine !== ls[n]) {
        ls[n] = nextLine;
        out = ls.join("\n");
      }
    }
    return out;
  }
  // 归档 = 做完：DONE + 实际时段，收掉 🔗 行
  finish(text, sid, linkAt) {
    const lines = text.split("\n");
    const at = typeof linkAt === "number" ? linkAt : lines.findIndex((l) => {
      const k = parseLink(l);
      return k && k.sid === sid;
    });
    if (at < 0) return text;
    const n = markOwner(lines, at);
    if (n < 0) return text;
    const p = splitTask(lines[n]);
    if (!p) return text;
    const meta = this.usage.meta.get(sid) || {};
    const last = meta.lastAt ? dayMinute(meta.lastAt, this.cfg) : null;
    const body = p.rest.replace(/^\d{1,2}[:：]\d{2}\s*[-–~～到至]\s*\d{1,2}[:：]\d{2}\s*/, "");
    lines[n] = `${p.prefix}DONE ${last != null ? clock(last) + " " : ""}${body}`.trimEnd();
    const info = this.segmentsFor(sid);
    if (info && info.segs.length) {
      const base = width(lines[n]);
      for (let i = n + 1; i < lines.length; i++) {
        if (lines[i].trim() && width(lines[i]) <= base) break;
        if (CLOCK_RE.test(lines[i])) {
          lines.splice(i, 1);
          break;
        }
      }
      const shown = [];
      for (const [a, b] of info.segs) {
        const prev = shown[shown.length - 1];
        if (prev && a - prev[1] <= 10) prev[1] = Math.max(prev[1], b);
        else shown.push([a, b]);
      }
      const total = Math.round(info.segs.reduce((s, [a, b]) => s + b - a, 0));
      const indent = (/^\s*/.exec(lines[n]) || [""])[0] + "	";
      const who = { claude: "Claude", codex: "Codex", workbuddy: "WorkBuddy", dsh: "DSH" }[info.agent] || info.agent;
      const tok = (info.out || 0) + (info.fresh || 0);
      const clock2 = `${indent}- \u23F1 ${shown.slice(-8).map(([a, b]) => `${clock(a)}\u2013${clock(b)}`).join("\u3001")} \xB7 \u5171 ${durTag(total)}${tok ? ` \xB7 ${fmtTok(tok)} tok` : ""}${who ? " \xB7 " + who : ""}`;
      lines.splice(n + 1, 0, clock2);
    }
    const link = linkUnder(lines, n);
    if (link && link.sid === sid) lines.splice(link.line, 1);
    this.p.markBound?.(sid);
    return lines.join("\n");
  }
  // 一篇笔记里所有绑着的 Claude 会话开出来的子会话都挂上；新挂上的继续往下挂
  spawnAll(text) {
    const desk = this.usage.deskBySid;
    if (!desk || !desk.size || !text.includes("\u{1F517}")) return text;
    const q = [], seen = /* @__PURE__ */ new Set();
    const scan = (t) => {
      for (const line of t.split("\n")) {
        const k = parseLink(line);
        if (k && !seen.has(k.sid)) {
          seen.add(k.sid);
          q.push(k.sid);
        }
      }
    };
    scan(text);
    for (let i = 0; i < q.length && i < 200; i++) {
      const next = this.spawnInto(text, q[i]);
      if (next !== text) {
        text = next;
        scan(text);
      }
    }
    return text;
  }
  spawnInto(text, sid) {
    const me = this.usage.deskBySid.get(sid);
    if (!me || !text.includes(sid)) return text;
    const today = dayKeyToday(this.cfg);
    const spawned = [...this.usage.deskBySid.values()].filter((d) => d.parentSid === sid && (dayKey(d.created, this.cfg) === today || dayKey(d.active, this.cfg) === today)).sort((a, b) => a.created - b.created);
    if (!spawned.length) return text;
    const lines = text.split("\n");
    const step = () => {
      const todo = spawned.filter((d2) => !lines.some((l) => {
        const k = parseLink(l);
        return k && k.sid === d2.sid;
      }));
      if (!todo.length) return false;
      const at = lines.findIndex((l) => {
        const k = parseLink(l);
        return k && k.sid === sid;
      });
      const n = at < 0 ? -1 : markOwner(lines, at);
      if (n < 0) return false;
      const base = width(lines[n]), kidW = width(lines[at]), kidInd = (/^\s*/.exec(lines[at]) || [""])[0];
      const unit = kidInd.includes("	") ? "	" : " ".repeat(Math.max(2, kidW - base));
      let end = n;
      for (let i = n + 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        if (width(lines[i]) <= base) break;
        end = i;
      }
      const kids = [];
      for (let i = n + 1; i <= end; i++) if (width(lines[i]) === kidW && LIST_RE.test(lines[i]) && !/^\s*[-*+]\s+(?:🔗|⏱|💬|🤖\s*(?:子代理|side chat))/.test(lines[i])) kids.push(i);
      const d = todo[0];
      const name = String(d.title || "").trim() || "\u6CA1\u8D77\u540D\u7684\u4F1A\u8BDD";
      const mine = kids.find((i) => {
        const kl = kwLine(lines[i]);
        return kl && !DONE_KWS.includes(kl.kw) && !linkUnder(lines, i) && !kidUnder(lines, i) && kidMatch(kl.body, name);
      });
      if (mine != null) {
        const c2 = childMark(lines, mine, () => ({}));
        const ind = c2 ? (/^\s*/.exec(lines[c2.line]) || [""])[0] : (/^\s*/.exec(lines[mine]) || [""])[0] + unit;
        const pt = splitTask(lines[mine]);
        if (pt && !pt.cb && (OPEN_KWS.includes(pt.kw || "") || !pt.kw && this.kidTodos(lines, mine))) lines[mine] = `${pt.prefix}DOING ${this.hm(d.created)} ${pt.rest}`.trimEnd();
        lines.splice(mine + 1, 0, linkLine(ind, "claude", name, d.sid));
        return true;
      }
      lines.splice(
        end + 1,
        0,
        `${kidInd}- DOING ${this.hm(d.created)} ${AUTO_MARK}${resultText(name, 60)}`,
        linkLine(kidInd + unit, "claude", name, d.sid)
      );
      return true;
    };
    let changed = false;
    for (let i = 0; i < 40 && step(); i++) changed = true;
    return changed ? lines.join("\n") : text;
  }
  kidTodos(lines, n) {
    const base = width(lines[n]);
    for (let i = n + 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      return width(lines[i]) > base;
    }
    return false;
  }
  hm(ms) {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  // subagent：会话派出去的子代理，写成「🤖 子代理」子块；跑完换成 DONE / FAILED + ⏱ + 💬
  subsIntoAll(text) {
    if (!this.usage.subs || !this.usage.subs.size || !text.includes("\u{1F517}")) return text;
    const sids = [];
    for (const line of text.split("\n")) {
      const k = parseLink(line);
      if (k && this.usage.subs.has(k.sid)) sids.push(k.sid);
    }
    for (const sid of sids) text = this.subsInto(text, sid);
    return text;
  }
  kidState(r, parentWait) {
    const quiet = (Date.now() - (r.at || r.start || 0)) / 6e4;
    if (r.state === "done") return { st: "done", kw: "DONE" };
    if (r.state === "fail") return { st: "fail", kw: r.end === "failed" ? "FAILED" : "CANCELLED" };
    if (quiet <= 5) return { st: "run", kw: "DOING" };
    if (!r.bg && parentWait) return { st: "fail", kw: "CANCELLED" };
    return { st: "quiet", kw: "DOING" };
  }
  kidTok(r) {
    return [...(r.tok || /* @__PURE__ */ new Map()).values()].reduce((n, v) => n + v, 0);
  }
  finishKid(indent, r) {
    const tok = this.kidTok(r);
    const min = Math.max(1, Math.round(((r.at || r.start) - r.start) / 6e4));
    const out = [`${indent}- \u23F1 ${this.hm(r.start)}\u2013${this.hm(r.at || r.start)} \xB7 \u5171 ${durTag(min)}${tok ? ` \xB7 ${fmtTok(tok)} tok` : ""} \xB7 \u5B50\u4EE3\u7406 \`${r.id.slice(0, 8)}\``];
    const said = String(r.last || "").trim();
    if (said) out.push(`${indent}- \u{1F4AC} ${resultText(said, this.cfg.resultMax || 200)}`);
    return out;
  }
  subsInto(text, sid) {
    const parent = this.usage.meta.get(sid) || {};
    const parentWait = parent.state !== "run";
    const today = dayKeyToday(this.cfg);
    const subs = this.usage.subsOf(sid).filter((r) => (r.desc || r.type) && dayKey(r.start, this.cfg) === today);
    if (!subs.length) return text;
    const lines = text.split("\n");
    const step = () => {
      const at = lines.findIndex((l) => {
        const k = parseLink(l);
        return k && k.sid === sid;
      });
      const n = at < 0 ? -1 : markOwner(lines, at);
      if (n < 0) return false;
      const base = width(lines[n]), kidW = width(lines[at]), kidInd = (/^\s*/.exec(lines[at]) || [""])[0];
      const unit = kidInd.includes("	") ? "	" : " ".repeat(Math.max(2, kidW - base));
      let end = n;
      for (let i = n + 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        if (width(lines[i]) <= base) break;
        end = i;
      }
      const kids = [];
      for (let i = n + 1; i <= end; i++) {
        if (width(lines[i]) !== kidW || !LIST_RE.test(lines[i])) continue;
        if (/^\s*[-*+]\s+(?:🔗|⏱|💬|🤖\s*(?:子代理|side chat))/.test(lines[i])) continue;
        kids.push(i);
      }
      const known = /* @__PURE__ */ new Map(), claimed = /* @__PURE__ */ new Set();
      for (const k of kids) {
        const mark = childMark(lines, k, (l) => {
          const id = kidIdent(l);
          return id && id.kind === "sub" ? id : null;
        });
        if (mark) {
          known.set(String(mark.id), { block: k, mark: mark.line, open: !!mark.open });
          claimed.add(k);
        }
      }
      const setKw = (k, kw, time) => {
        const pt = splitTask(lines[k]);
        if (pt) lines[k] = `${pt.prefix}${kw} ${time} ${pt.rest}`.trimEnd();
      };
      for (const r of subs) {
        const id = r.id.slice(0, 8), k = this.kidState(r, parentWait), over = k.st === "done" || k.st === "fail";
        const had = known.get(id);
        if (had) {
          if (!had.open) continue;
          if (over) {
            const ind = (/^\s*/.exec(lines[had.block]) || [""])[0];
            setKw(had.block, k.kw, this.hm(r.at || r.start));
            const mark = parseKid(lines[had.mark]);
            if (mark) lines[had.mark] = `${ind}	- \u23F1 ${this.hm(r.start)}\u2013${this.hm(r.at || r.start)} \xB7 \u5171 ${durTag(Math.max(1, Math.round(((r.at || r.start) - r.start) / 6e4)))}${this.kidTok(r) ? ` \xB7 ${fmtTok(this.kidTok(r))} tok` : ""} \xB7 \u5B50\u4EE3\u7406 \`${id}\``;
            const said = String(r.last || "").trim();
            if (said) lines.splice(had.mark + 1, 0, `${ind}	- \u{1F4AC} ${resultText(said, this.cfg.resultMax || 200)}`);
            return true;
          }
          continue;
        }
        const mine = kids.find((i) => {
          if (claimed.has(i)) return false;
          const kl = kwLine(lines[i]);
          return kl && !DONE_KWS.includes(kl.kw) && !linkUnder(lines, i) && kidMatch(kl.body, r.desc || r.type);
        });
        if (mine != null) {
          claimed.add(mine);
          const ind = (/^\s*/.exec(lines[mine]) || [""])[0];
          if (over) {
            setKw(mine, k.kw, this.hm(r.at || r.start));
            lines.splice(mine + 1, 0, ...this.finishKid(ind, r));
          } else {
            const pt = splitTask(lines[mine]);
            setKw(mine, "DOING", pt && pt.kw === "DOING" && pt.since ? pt.since : this.hm(r.start));
            lines.splice(mine + 1, 0, `${ind}	- \u{1F517} \u5B50\u4EE3\u7406 \`${id}\``);
          }
          return true;
        }
        const name = resultText(r.desc || r.type || "subagent", 60);
        if (over) {
          lines.splice(end + 1, 0, `${kidInd}- ${k.kw} ${this.hm(r.at || r.start)} ${AUTO_MARK}${name}`, ...this.finishKid(kidInd + unit, r));
        } else {
          lines.splice(end + 1, 0, `${kidInd}- DOING ${this.hm(r.start)} ${AUTO_MARK}${name}`, `${kidInd}${unit}- \u{1F517} \u5B50\u4EE3\u7406 \`${id}\``);
        }
        return true;
      }
      return false;
    };
    let changed = false;
    for (let i = 0; i < 40 && step(); i++) changed = true;
    return changed ? lines.join("\n") : text;
  }
  // side chat：开着的写成子块，进程没了记成 DONE + ⏱
  sides(text) {
    if (!this.usage.sideChats) return text;
    const sids = new Set(this.usage.sideChats.keys());
    for (const line of text.split("\n")) {
      const k = parseLink(line);
      if (k) sids.add(k.sid);
    }
    for (const sid of sids) if (text.includes(sid)) text = this.sideInto(text, sid);
    return text;
  }
  sideInto(text, sid) {
    const lines = text.split("\n");
    const at = lines.findIndex((l) => {
      const k = parseLink(l);
      return k && k.sid === sid;
    });
    if (at < 0) return text;
    const n = markOwner(lines, at);
    if (n < 0) return text;
    const base = width(lines[n]), kidW = width(lines[at]), kidInd = (/^\s*/.exec(lines[at]) || [""])[0];
    const unit = kidInd.includes("	") ? "	" : " ".repeat(Math.max(2, kidW - base));
    let end = n;
    for (let i = n + 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      if (width(lines[i]) <= base) break;
      end = i;
    }
    const known = /* @__PURE__ */ new Map();
    for (let i = n + 1; i <= end; i++) {
      if (width(lines[i]) !== kidW || !LIST_RE.test(lines[i])) continue;
      if (/^\s*[-*+]\s+(?:🔗|⏱|💬|🤖\s*(?:子代理|side chat))/.test(lines[i])) continue;
      const mark = kidUnder(lines, i);
      if (mark && mark.kind === "side") known.set(String(mark.id), { block: i, mark: mark.line, ...mark });
    }
    const open = (this.usage.sideChats.get(sid) || []).map((s) => String(s.pid));
    let changed = false;
    for (const s of this.usage.sideChats.get(sid) || []) {
      if (known.has(String(s.pid))) continue;
      const min = dayMinute(s.since || Date.now(), this.cfg);
      lines.splice(
        end + 1,
        0,
        `${kidInd}- DOING ${clock(min)} ${AUTO_MARK}side chat`,
        `${kidInd}${unit}- \u{1F517} side chat \`pid ${s.pid}\``
      );
      changed = true;
      end += 2;
    }
    for (const c of known.values()) {
      if (open.includes(String(c.id))) continue;
      const cur = splitTask(lines[c.block]);
      const from = cur && cur.since ? cur.since : null;
      const nowMin = dayMinute(Date.now(), this.cfg);
      let mins = 1;
      if (from) {
        const [h, m] = from.split(":").map(Number);
        let start = h * 60 + m - dayOffset();
        if (start < 0) start += 1440;
        if (start > nowMin) start -= 1440;
        mins = Math.max(1, nowMin - start);
      }
      lines[c.block] = `${cur ? cur.prefix : ""}DONE ${clock(nowMin)} ${cur ? cur.rest : "side chat"}`.trimEnd();
      lines[c.mark] = `${kidInd}${unit}- \u23F1 ${from || clock(nowMin - mins)}\u2013${clock(nowMin)} \xB7 \u5171 ${durTag(mins)} \xB7 side chat \`pid ${c.id}\``;
      changed = true;
    }
    return changed ? lines.join("\n") : text;
  }
};

// src/main.js
var fsp4 = import_fs5.default.promises;
var AgentDeckPlugin = class extends import_obsidian7.Plugin {
  async onload() {
    const data = await this.loadData();
    this.settings = deepMerge(DEFAULTS, data || {});
    if (!Array.isArray(this.settings.primaryAgents)) this.settings.primaryAgents = this.settings.aiPrimary ? [this.settings.aiPrimary] : ["claude"];
    this.settings.primaryAgents = this.settings.primaryAgents.filter((x) => AGENTS[x]).slice(0, 2);
    if (!this.settings.primaryAgents.length) this.settings.primaryAgents = ["claude"];
    this.settings.jobs = this.settings.jobs && typeof this.settings.jobs === "object" ? this.settings.jobs : {};
    setDayOffset((Number.isFinite(this.settings.dayCutoff) ? this.settings.dayCutoff : 8) * 60);
    this.jobs = this.settings.jobs;
    this.views = /* @__PURE__ */ new Set();
    this._lineMaps = {};
    this.vaultPath = this.app.vault.adapter.getBasePath ? this.app.vault.adapter.getBasePath() : "";
    this.manifestDir = this.manifest.dir || `.obsidian/plugins/${this.manifest.id}`;
    this.pluginDir = import_path5.default.join(this.vaultPath, this.manifestDir);
    this.usageFile = import_path5.default.join(this.pluginDir, "usage.json");
    this.store = new UsageStore(this, this.settings);
    await this.store.load(this.usageFile);
    this.usage = new AgentUsage({ cfg: this.settings, settings: this.settings });
    this.editorInfoField = import_obsidian7.editorInfoField;
    this.delegator = new Delegator(this);
    this.menubar = new MenuBarBridge(this);
    this.autoLog = new AutoLog(this);
    this.journalSync = new JournalSync(this);
    this.registerView(VIEW_TYPE, (leaf) => new AgentDeckView(leaf, this));
    this.settingTab = new AgentDeckSettingsTab(this.app, this);
    this.addSettingTab(this.settingTab);
    this.registerEditorExtension(createEditorExtension(this));
    this.setupRibbon();
    this.addCommand({ id: "open-dashboard", name: "\u6253\u5F00 Agent Deck \u9762\u677F", callback: () => this.activateView() });
    this.addCommand({
      id: "open-menubar-panel",
      name: "\u6253\u5F00 macOS \u83DC\u5355\u680F\u9762\u677F",
      callback: async () => {
        if (this.settings.showMenuBar === false) return this.notice("macOS \u83DC\u5355\u680F\u5DF2\u5173\u95ED\uFF0C\u8BF7\u5148\u5728\u300C\u8FFD\u8E2A\u300D\u91CC\u6253\u5F00");
        await this.menubar.start();
        const started = Date.now();
        const wait = setInterval(() => {
          if (this.menubar.isAlive() || Date.now() - started > 15e3) {
            clearInterval(wait);
            this.menubar.show();
          }
        }, 300);
      }
    });
    this.addCommand({ id: "open-settings", name: "\u6253\u5F00 Agent Deck \u8BBE\u7F6E", callback: () => this.openSettings() });
    this.addCommand({ id: "open-models", name: "\u6253\u5F00 Agent Deck \u7684 Models \u8BBE\u7F6E", callback: () => this.openSettings("models") });
    this.addCommand({ id: "open-session-line", name: "\u6253\u5F00\u5149\u6807\u8FD9\u4E00\u884C\u7ED1\u5B9A\u7684\u4F1A\u8BDD", editorCallback: (editor, view) => this.openSessionForEditor(editor, view) });
    this.addCommand({ id: "scan-now", name: "\u91CD\u65B0\u626B\u63CF\u672C\u673A Agent \u4F1A\u8BDD", callback: () => this.scanNow(true) });
    this.addCommand({ id: "log-journal", name: "\u6574\u7406 Agent \u4F1A\u8BDD\u8FDB\u4ECA\u5929\u7684\u65E5\u8BB0", callback: () => this.autoLog.logNow() });
    this.addCommand({ id: "import-nautilus", name: "\u5BFC\u5165\u87BA\u65CB\u65E5\u7A0B\u7684\u5386\u53F2\u7528\u91CF", callback: () => this.importNautilus(true) });
    this.addCommand({ id: "clean-jobs", name: "\u6E05\u7406\u5DF2\u7ED3\u675F\u7684\u59D4\u6D3E\u8BB0\u5F55", callback: () => this.cleanJobs() });
    this.registerObsidianProtocolHandler("agent-deck", async (params) => {
      if (params && params.do === "scan") return this.scanNow(true);
      if (params && params.do === "log") return this.autoLog.logNow();
      if (params && params.do === "open" && params.sid) {
        const m = this.usage.meta.get(params.sid) || {};
        return this.openSession(params.agent || m.agent || "claude", params.sid, m.app || params.app || "", m);
      }
      if (params && params.do === "hide") {
        this.settings.showMenuBar = false;
        await this.saveSettings();
        this.menubar?.stop();
        this.notice("\u5DF2\u9690\u85CF macOS \u83DC\u5355\u680F\uFF1B\u53EF\u5728 Agent Deck \u2192 \u8FFD\u8E2A \u91CC\u91CD\u65B0\u6253\u5F00", 8e3);
        return;
      }
      return this.activateView();
    });
    this.app.workspace.onLayoutReady(async () => {
      if (this.settings.openDashboardOnStartup) this.activateView();
      if (this.settings.showMenuBar !== false) this.menubar.start().catch((e) => console.error("[agent-deck] menubar", e));
      if (this.settings.menuBarHideNautilus !== false) setTimeout(() => this.hideNautilusAgentBar().catch(() => {
      }), 2500);
      this.scheduleScan();
      this.registerInterval(window.setInterval(() => this.autoLog.tick(), 60 * 1e3));
      setTimeout(() => this.scanNow(false), 1200);
      if (this.settings.importNautilus !== false && !this.store.imported?.nautilus) {
        setTimeout(() => this.importNautilus(false).catch(() => {
        }), 3500);
      }
      setTimeout(() => this.recoverJobs(), 4e3);
    });
  }
  onunload() {
    clearInterval(this._scanTimer);
    clearTimeout(this._refreshTimer);
    this.menubar?.stop();
    for (const runner of this.delegator?.runners?.values?.() || []) {
      try {
        if (runner.constructor && runner.constructor.name === "DshRunner") runner.cancel();
      } catch {
      }
    }
    try {
      this.ribbonEl?.remove();
    } catch {
    }
  }
  // ---------- setup ----------
  setupRibbon() {
    if (this.ribbonEl) {
      this.ribbonEl.remove();
      this.ribbonEl = null;
    }
    if (this.settings.showRibbonIcon === false) return;
    this.ribbonEl = this.addRibbonIcon("gauge", "Agent Deck", () => this.activateView());
  }
  applyUiSettings() {
    this.setupRibbon();
    if (this.settings.showMenuBar !== false) this.menubar?.start().catch((e) => console.error("[agent-deck] menubar", e));
    else this.menubar?.stop();
    this.refreshUI();
  }
  async activateView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }
  openSettings(tab) {
    try {
      if (tab && this.settingTab) this.settingTab.tab = tab;
      this.app.setting.open();
      this.app.setting.openTabById(this.manifest.id);
      if (tab && this.settingTab) setTimeout(() => {
        try {
          this.settingTab.display();
        } catch {
        }
      }, 120);
    } catch (e) {
      console.error("[agent-deck] open settings", e);
    }
  }
  // ---------- scan ----------
  scheduleScan() {
    clearInterval(this._scanTimer);
    const sec = clamp(Number(this.settings.pollSeconds) || 20, 5, 300);
    this._scanTimer = setInterval(() => this.scanNow(false), sec * 1e3);
  }
  async scanNow(force = false) {
    if (this._scanning) return;
    this._scanning = true;
    try {
      if (force) {
        this.usage.files.clear();
        this.usage.meta.clear();
        this.usage.titles.clear();
        this.usage.lastScan = 0;
      }
      const since = force ? 0 : Math.max(0, (this.usage.lastScan || 0) - 6e4);
      const touched = await this.usage.scan({ since });
      this.store.cfg = this.settings;
      this.store.merge(touched, this.usage);
      this.store.prune();
      await this.store.save();
      this.delegator.resolveHandoffs(this.usage);
      this.refreshUI();
      this.journalSync.run().catch((e) => console.error("[agent-deck] journal sync", e));
      if (force) new import_obsidian7.Notice(`Agent Deck\uFF1A\u8BFB\u5230 ${this.usage.files.size} \u4E2A\u65E5\u5FD7\uFF0C${touched.size} \u5929\u6709\u5185\u5BB9`, 4e3);
    } catch (e) {
      console.error("[agent-deck] scan", e);
      this.notice("\u626B\u63CF\u4F1A\u8BDD\u5931\u8D25\uFF1A" + (e && e.message || e), 8e3);
    } finally {
      this._scanning = false;
    }
  }
  async rebuildUsage() {
    this.store.days = {};
    this.store.imported = {};
    this.usage.files.clear();
    this.usage.meta.clear();
    this.usage.titles.clear();
    await this.store.save();
    await this.scanNow(true);
    new import_obsidian7.Notice("Agent Deck\uFF1A\u5386\u53F2\u5DF2\u91CD\u7B97");
  }
  async importNautilus(manual = false) {
    const dir = import_path5.default.join(this.vaultPath, ".obsidian/plugins/nautilus-spiral");
    let raw;
    try {
      raw = await fsp4.readFile(import_path5.default.join(dir, "ai-usage.json"), "utf8");
    } catch {
      if (manual) new import_obsidian7.Notice("\u6CA1\u6709\u627E\u5230\u87BA\u65CB\u65E5\u7A0B\u7684 ai-usage.json");
      return;
    }
    let src;
    try {
      src = JSON.parse(raw);
    } catch {
      if (manual) new import_obsidian7.Notice("\u87BA\u65CB\u65E5\u7A0B\u7684 ai-usage.json \u89E3\u6790\u5931\u8D25");
      return;
    }
    const days = src.days || {};
    let added = 0;
    for (const [key, day] of Object.entries(days)) {
      if (!day || typeof day !== "object") continue;
      if (this.store.days[key]) continue;
      this.store.days[key] = {
        ...day,
        by: day.by || (day.wall != null ? { claude: { wall: day.wall, agent: day.agent, out: day.out, segs: day.segs } } : {}),
        list: (day.list || []).map((x) => ({ ...x, agent: x.agent || "claude" })),
        imported: "nautilus"
      };
      added++;
    }
    this.store.imported = { ...this.store.imported || {}, nautilus: Date.now() };
    await this.store.save();
    if (manual || added) new import_obsidian7.Notice(`Agent Deck\uFF1A\u4ECE\u87BA\u65CB\u65E5\u7A0B\u5BFC\u5165 ${added} \u5929\u5386\u53F2`);
    this.refreshUI();
  }
  recoverJobs() {
    for (const job of Object.values(this.jobs)) {
      if (job.state === "done" && job.linkWritten && !job.resultWritten) {
        this.delegator.writeResult(job).catch((e) => console.error("[agent-deck] recover result", e));
        continue;
      }
      if (!["starting", "running", "needs-approval"].includes(job.state)) continue;
      if (job.handoff) continue;
      if (this.delegator.runners.has(job.id)) continue;
      const meta = job.sessionId ? this.usage.meta.get(job.sessionId) : null;
      if (meta && meta.lastAt) {
        job.state = meta.state === "run" ? "running" : meta.state === "error" ? "error" : "done";
        job.step = meta.step || job.step || "";
        job.tokens = (meta.out || 0) + (meta.fresh || 0);
        this.saveJobs();
        if (job.state === "done") this.delegator.writeResult(job).catch(() => {
        });
      } else if (Date.now() - (job.startedAt || 0) > 6e4) {
        job.state = "error";
        job.error = "\u63D2\u4EF6\u91CD\u8F7D\u540E\u6CA1\u6709\u63A5\u4E0A\u8FD9\u4E2A\u4F1A\u8BDD";
        job.endedAt = Date.now();
        this.saveJobs();
      }
    }
    this.refreshUI();
  }
  cleanJobs() {
    const cutoff = Date.now() - 7 * 864e5;
    for (const [id, job] of Object.entries(this.jobs)) if (job.endedAt && job.endedAt < cutoff) delete this.jobs[id];
    this.saveSettings();
    this.refreshUI();
  }
  // ---------- settings ----------
  async saveSettings() {
    this.settings.jobs = this.jobs;
    setDayOffset((Number.isFinite(this.settings.dayCutoff) ? this.settings.dayCutoff : 8) * 60);
    await this.saveData(this.settings);
  }
  saveJobs() {
    this.settings.jobs = this.jobs;
    this.saveSettings().catch(() => {
    });
  }
  // ---------- model helpers ----------
  allModels(custom) {
    const list = [...MODEL_CATALOG, ...custom || this.settings.models.custom || []];
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const m of list) if (m && m.id && !seen.has(m.id)) {
      seen.add(m.id);
      out.push(m);
    }
    const order = this.settings.models.order || [];
    out.sort((a, b) => {
      const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
      if (ia < 0 && ib < 0) return 0;
      if (ia < 0) return 1;
      if (ib < 0) return -1;
      return ia - ib;
    });
    return out;
  }
  modelsFor(agent) {
    return this.allModels().filter((m) => m.agent === agent);
  }
  modelById(id) {
    return this.allModels().find((m) => m.id === id) || null;
  }
  modelEnabled(id) {
    return (this.settings.models.enabled || []).includes(id);
  }
  modelLabel(id) {
    const m = this.modelById(id);
    return m ? m.name : id || "";
  }
  primaryAgents() {
    return (this.settings.primaryAgents || []).filter((x) => AGENTS[x]).slice(0, 2);
  }
  isPrimary(agent) {
    return this.primaryAgents().includes(agent);
  }
  agentEnabled(agent) {
    return this.isPrimary(agent) || (this.settings.agents || {})[agent] !== false;
  }
  defaultTarget() {
    return this.settings.delegate?.target === "dsh" ? "dsh" : "claude";
  }
  defaultModel(agent) {
    if (agent === "dsh") return this.settings.delegate?.dsh?.model || this.settings.models?.defaultByAgent?.dsh || "deepseek-v4-pro";
    return this.settings.delegate?.claude?.model || this.settings.models?.defaultByAgent?.claude || "claude-sonnet-5";
  }
  async togglePrimary(agent) {
    var _a;
    if (!AGENTS[agent]) return;
    const list = this.primaryAgents();
    const i = list.indexOf(agent);
    if (i >= 0) list.splice(i, 1);
    else {
      list.push(agent);
      if (list.length > 2) list.shift();
    }
    this.settings.primaryAgents = list.length ? list : [agent];
    ((_a = this.settings).agents || (_a.agents = {}))[agent] = true;
    await this.saveSettings();
    this.scanNow(true);
    this.refreshUI();
    new import_obsidian7.Notice(`Agent Deck \u4E3B\u529B\uFF1A${this.settings.primaryAgents.map((x) => AGENTS[x].short).join(" + ")}`);
  }
  async setAgentEnabled(agent, on) {
    var _a;
    if (this.isPrimary(agent) && !on) {
      new import_obsidian7.Notice("\u4E3B\u529B Agent \u4E0D\u80FD\u5173\u6389\uFF1B\u5148\u628A\u4E3B\u529B\u6362\u6389");
      return;
    }
    ((_a = this.settings).agents || (_a.agents = {}))[agent] = !!on;
    await this.saveSettings();
    this.scanNow(true);
    this.refreshUI();
  }
  // ---------- sessions ----------
  liveSessions({ hours = 24 } = {}) {
    const since = Date.now() - hours * 36e5;
    const list = this.usage.liveSessions({ since, limit: 100 }).filter((x) => this.agentEnabled(x.agent));
    const seen = new Set(list.map((x) => x.sid));
    for (const job of Object.values(this.jobs)) {
      if (!["running", "needs-approval"].includes(job.state)) continue;
      if (!job.sessionId || seen.has(job.sessionId)) continue;
      if (this.usage.hidden(job.sessionId)) continue;
      const sid = job.sessionId;
      list.push({
        sid,
        agent: job.agent,
        title: job.name,
        text: job.blockText,
        cwd: job.cwd || this.vaultPath,
        app: "",
        state: job.state === "needs-approval" ? "needs-approval" : "run",
        step: job.step || "\u6B63\u5728\u542F\u52A8\u4F1A\u8BDD\u2026",
        lastAt: job.endedAt || job.startedAt,
        tokens: job.tokens || 0,
        job,
        model: job.model
      });
      seen.add(sid);
    }
    return list.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
  }
  recentSessions({ days = 7, limit = 100 } = {}) {
    const since = Date.now() - days * 864e5;
    const list = this.usage.sessions({ since, limit: 200 }).filter((x) => this.agentEnabled(x.agent));
    const bySid = new Map(list.map((x) => [x.sid, x]));
    for (const job of Object.values(this.jobs)) {
      const sid = job.sessionId || job.id;
      if (!this.agentEnabled(job.agent)) continue;
      if (job.sessionId && this.usage.hidden(job.sessionId)) {
        bySid.delete(sid);
        continue;
      }
      if (job.handoff && !job.sessionId) continue;
      const cur = bySid.get(sid);
      if (job.state === "bound") {
        if (cur) bySid.set(sid, { ...cur, job });
        continue;
      }
      const row = {
        ...cur || {},
        sid,
        agent: job.agent,
        title: job.name || cur && cur.title || "",
        text: cur && cur.text || job.blockText || "",
        cwd: job.cwd || cur && cur.cwd || this.vaultPath,
        app: cur && cur.app || "",
        state: job.state === "starting" || job.state === "running" ? "run" : job.state,
        step: job.step || cur && cur.step || "",
        lastAt: job.endedAt || job.startedAt || cur && cur.lastAt || 0,
        tokens: job.tokens || cur && cur.tokens || 0,
        job,
        model: job.model || cur && cur.model || "",
        error: job.error,
        result: job.result
      };
      bySid.set(sid, row);
    }
    const out = [...bySid.values()].filter((x) => (x.lastAt || 0) >= since);
    return out.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0)).slice(0, limit);
  }
  openSession(agent, sid, app, session) {
    return openSession(this, agent, sid, app, session);
  }
  openJob(jobId, sid) {
    const job = jobId ? this.jobs[jobId] : null;
    const sessionId = job && job.sessionId || sid;
    if (!sessionId) {
      this.notice("\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u4F1A\u8BDD\u53F7\uFF0C\u7A0D\u7B49\u4E00\u79D2\u518D\u70B9");
      return;
    }
    const meta = this.usage.meta.get(sessionId) || null;
    const agent = job ? job.agent : meta && meta.agent || "claude";
    return openSession(this, agent, sessionId, job && job.app || meta && meta.app || "", meta);
  }
  jobProgress(job) {
    if (!job || !job.sessionId) return null;
    const meta = this.usage.meta.get(job.sessionId);
    const todo = meta && meta.todo;
    return todo && todo.total ? { done: todo.done, total: todo.total } : null;
  }
  pillTitle(info) {
    if (!info) return "";
    if (info.kind === "idle") return "\u59D4\u6D3E\u8FD9\u4E00\u5757\uFF1B\u2304 \u9009\u6A21\u578B\u3001\u5F3A\u5EA6\u3001\u6A21\u5F0F";
    const job = info.job, s = info.session;
    const parts = [];
    if (job) {
      parts.push(`${AGENTS[job.agent]?.name || job.agent} \xB7 ${job.name}`);
      if (job.step) parts.push(job.step);
      if (job.error) parts.push(job.error);
    }
    if (s) {
      parts.push(s.title || s.step || s.sid);
      if (s.tokens) parts.push(`${fmtTok(s.tokens)} tok`);
    }
    return parts.filter(Boolean).join("\n");
  }
  // ---------- note line map ----------
  lineMap(path6, doc) {
    const cached = this._lineMaps[path6];
    if (cached && cached.doc === doc) return cached.map;
    const lines = doc.toString().split("\n");
    const sessionByParent = /* @__PURE__ */ new Map();
    const linkByLine = /* @__PURE__ */ new Map();
    const parentByLine = /* @__PURE__ */ new Map();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!/^\s*[-*+]\s+🔗/.test(line)) continue;
      const indent = (line.match(/^[ \t]*/) || [""])[0].length;
      let parent = -1;
      for (let j = i - 1; j >= 0; j--) {
        if (!lines[j].trim()) continue;
        const ind = (lines[j].match(/^[ \t]*/) || [""])[0].length;
        if (ind < indent) {
          if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[j])) parent = j;
          break;
        }
      }
      if (parent < 0) continue;
      const parsed = parseLinkLine(line);
      if (!parsed.sid) continue;
      const meta = this.usage.meta.get(parsed.sid) || { sid: parsed.sid, agent: parsed.agent, state: "idle", title: "", tokens: 0, lastAt: 0 };
      const live = this.usage.liveSessions({ since: Date.now() - 864e5, limit: 200 }).find((x) => x.sid === parsed.sid);
      const job = Object.values(this.jobs).find((j) => j.sessionId === parsed.sid);
      const session = { ...meta, ...live || {}, agent: parsed.agent || meta.agent, job };
      parentByLine.set(i, parent);
      linkByLine.set(i, { ...parsed, parent });
      sessionByParent.set(parent, session);
    }
    const map = { doc, lines, sessionByParent, linkByLine, parentByLine };
    this._lineMaps[path6] = { doc, map };
    return map;
  }
  jobAtLine(path6, line, text) {
    const jobs = Object.values(this.jobs).filter((j) => j.path === path6);
    let best = null;
    for (const j of jobs) {
      if (j.lineText === text || j.line === line && j.lineText === text) best = j;
    }
    return best;
  }
  // ---------- drag and drop ----------
  // 一个会话绑到了日记里（拖拽、委派、归档收尾）：告诉自动记日记别再替它新写一行
  markBound(sid) {
    var _a, _b;
    if (!sid) return;
    const day = dayKeyToday(this.settings);
    const st = (_b = (_a = this.settings).autoLogState || (_a.autoLogState = {}))[day] || (_b[day] = {});
    if (st[sid] && st[sid].bound) return;
    st[sid] = { ...st[sid] || {}, skip: true, bound: true };
    this.saveSettings().catch(() => {
    });
  }
  // 编辑器里找打开着这篇笔记的那个 MarkdownView（不一定是当前激活的：拖拽时焦点常在面板上）
  viewForPath(path6) {
    let found = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      const v = leaf.view;
      if (!found && v instanceof import_obsidian7.MarkdownView && v.file && v.file.path === path6 && v.editor) found = v;
    });
    return found;
  }
  // 面板里的会话卡片拖到了笔记第 line 行上
  bindSessionAt(cm, line, data, { below = false } = {}) {
    let view = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      const v = leaf.view;
      if (!view && v instanceof import_obsidian7.MarkdownView && v.editor && v.editor.cm === cm) view = v;
    });
    if (!view || !data || !data.sid) return;
    const sid = data.sid;
    const meta = this.usage.meta.get(sid) || {};
    const live = this.liveSessions({ hours: 24 }).find((x) => x.sid === sid);
    const day = dayKeyToday(this.settings);
    const rec = ((this.settings.autoLogState || {})[day] || {})[sid];
    const daySess = ((this.usage.summary(day) || {}).list || []).find((x) => x.sid === sid);
    const first = daySess && daySess.segs && daySess.segs.length ? daySess.segs[0][0] : null;
    const now = /* @__PURE__ */ new Date();
    const since = first != null ? clock(first) : `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const text = cm.state.doc.toString();
    const res = bindInto(text, line, {
      sid,
      agent: data.agent || meta.agent || "claude",
      title: data.title || meta.title || (meta.text || "").split(" / ")[0] || sid.slice(0, 8),
      state: live && live.state || meta.state || "idle",
      since,
      dropKey: rec && rec.created && rec.key ? rec.key : null
    }, { below });
    if (res.error) return this.notice(res.error, 6e3);
    const change = diffLines(text, res.text);
    if (change) view.editor.transaction({ changes: [change] });
    this.markBound(sid);
    const a = AGENTS[data.agent] || AGENTS.claude;
    this.notice(res.kind === "bind" ? `\u{1F517} \u5DF2\u7ED1\u5B9A\uFF1A${a.short} \u4F1A\u8BDD\u7684\u72B6\u6001\u3001\u{1F4AC}\u3001\u23F1 \u548C\u5F52\u6863\u90FD\u4F1A\u8DDF\u7740\u8FD9\u4E00\u9879\u8D70` : `\u{1F517} \u65B0\u5EFA\u4E86\u4E00\u9879\u5E76\u7ED1\u4E0A ${a.short} \u4F1A\u8BDD`, 5e3);
    setTimeout(() => this.journalSync.run({ force: true }).catch(() => {
    }), 300);
    this.refreshUI();
  }
  // 编辑器里开始拖一项（把手或选中的文字）：记下来源，拖到 Agent 卡片上时用
  noteDragItem(src) {
    const item = this._dragItem = { ...src, at: Date.now() };
    document.body.classList.add("ad-dragging-item");
    const off = (e) => {
      document.body.classList.remove("ad-dragging-item");
      document.removeEventListener("dragend", off, true);
      document.removeEventListener("drop", off, true);
      if (e && e.type === "dragend") setTimeout(() => {
        if (this._dragItem && this._dragItem.at === item.at) this._dragItem = null;
      }, 0);
    };
    document.addEventListener("dragend", off, true);
    document.addEventListener("drop", off, true);
  }
  acceptsItemDrag(e) {
    const types = e.dataTransfer ? [...e.dataTransfer.types] : [];
    if (types.includes(ITEM_MIME)) return true;
    return types.includes("text/plain") && this._dragItem && Date.now() - this._dragItem.at < 12e4;
  }
  readItemDrag(e) {
    try {
      const raw = e.dataTransfer.getData(ITEM_MIME);
      if (raw) return JSON.parse(raw);
    } catch {
    }
    return this._dragItem && Date.now() - this._dragItem.at < 12e4 ? this._dragItem : null;
  }
  // 笔记里的一项拖到了某个 Agent 卡片上：Claude / DSH 后台直接跑，Codex / WorkBuddy 打开客户端交接
  async delegateDrop(agent, item, fromEl) {
    this._dragItem = null;
    if (!item || !item.path) return this.notice("\u6CA1\u8BA4\u51FA\u62D6\u7684\u662F\u54EA\u4E00\u9879\uFF1B\u4ECE\u5217\u8868\u9879\u5C3E\u5DF4\u4E0A\u7684\u628A\u624B\u62D6");
    const file = this.app.vault.getAbstractFileByPath(item.path);
    if (!file) return this.notice("\u627E\u4E0D\u5230\u8FD9\u7BC7\u7B14\u8BB0");
    const view = this.viewForPath(item.path);
    const lines = view ? view.editor.getValue().split("\n") : (await this.app.vault.read(file)).split("\n");
    let line = lines[item.line] === item.lineText ? item.line : lines.indexOf(item.lineText);
    if (line < 0) return this.notice("\u8FD9\u4E00\u884C\u521A\u6539\u8FC7\uFF0C\u91CD\u65B0\u62D6\u4E00\u6B21");
    const block = blockAt(lines, line), k = kwLine(lines[line]);
    if (k && k.body.startsWith(AUTO_MARK.trim())) return this.notice("\u8FD9\u4E00\u9879\u662F Agent \u8BB0\u7684\uFF0C\u5DF2\u7ECF\u7531\u673A\u5668\u8FFD\u8E2A\uFF0C\u4E0D\u518D\u59D4\u6D3E");
    if (block && findLink(lines, block)) return this.notice("\u8FD9\u4E00\u9879\u5DF2\u7ECF\u7ED1\u7740\u4F1A\u8BDD\u4E86\uFF0C\u4E0D\u518D\u59D4\u6D3E\uFF1B\u8981\u6362\u4F1A\u8BDD\uFF0C\u628A\u4F1A\u8BDD\u5361\u7247\u62D6\u5230\u5B83\u4E0A\u9762");
    if (block && lines.slice(block.start + 1, block.end + 1).some((l) => CLOCK_RE.test(l))) return this.notice("\u8FD9\u4E00\u9879\u5DF2\u7ECF\u6709 Agent \u7684\u7528\u65F6\u8BB0\u5F55\uFF0C\u4E0D\u518D\u59D4\u6D3E");
    this._flyArmed = { agent, at: Date.now() };
    try {
      const opts = { file, lines, line, agent };
      if (agent === "claude" || agent === "dsh") await this.delegator.delegate(opts);
      else await this.delegator.handoff(opts);
    } catch (e) {
      this.notice(String(e.message || e), 8e3);
    }
    this.refreshUI();
  }
  // 笔记里的一项拖到面板的会话卡片上：把这个会话绑给它（和卡片拖到条目上一样，不委派）
  async bindItemToSession(item, data) {
    this._dragItem = null;
    if (!item || !item.path || !data || !data.sid) return;
    const view = this.viewForPath(item.path);
    if (view) {
      const lines = view.editor.getValue().split("\n");
      const line = lines[item.line] === item.lineText ? item.line : lines.indexOf(item.lineText);
      if (line < 0) return this.notice("\u8FD9\u4E00\u884C\u521A\u6539\u8FC7\uFF0C\u91CD\u65B0\u62D6\u4E00\u6B21");
      return this.bindSessionAt(view.editor.cm, line, data);
    }
    this.notice("\u5148\u628A\u8FD9\u7BC7\u7B14\u8BB0\u6253\u5F00\u518D\u62D6");
  }
  // 委派出去的会话有了会话号（客户端里能打开了）：下一次画面板时，卡片从 Agents 飞进「现在」
  flyFromAgent(job) {
    if (!job || !job.sessionId) return;
    this._fly = { agent: job.agent, sid: job.sessionId, at: Date.now() };
    this.refreshUI();
  }
  openAgentApp(agent) {
    return openAgentApp(agent).then((ok) => {
      if (!ok) this.notice(`\u6CA1\u6253\u5F00 ${AGENTS[agent]?.name || agent}\uFF1A\u672C\u673A\u597D\u50CF\u6CA1\u88C5`);
    });
  }
  // ---------- editor actions ----------
  activeEditor() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian7.MarkdownView);
    if (!view || !view.file) return null;
    return { view, editor: view.editor, file: view.file };
  }
  async delegateFromEditor(editor, agent) {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian7.MarkdownView);
    if (!view || !view.file) return this.notice("\u5148\u6253\u5F00\u4E00\u7BC7\u7B14\u8BB0");
    const line = editor.getCursor().line;
    try {
      await this.delegator.delegate({ file: view.file, lines: editor.getValue().split("\n"), line, agent: agent || this.defaultTarget() });
    } catch (e) {
      this.notice(String(e.message || e), 8e3);
    }
  }
  async delegateAtLine(path6, line) {
    const file = this.app.vault.getAbstractFileByPath(path6);
    if (!file) return this.notice("\u627E\u4E0D\u5230\u8FD9\u7BC7\u7B14\u8BB0");
    const view = this.app.workspace.getActiveViewOfType(import_obsidian7.MarkdownView);
    const lines = view && view.file && view.file.path === path6 ? view.editor.getValue().split("\n") : (await this.app.vault.read(file)).split("\n");
    await this.delegator.delegate({ file, lines, line, agent: this.defaultTarget() });
  }
  openDelegateModal(path6, line) {
    new DelegateOptionsModal(this.app, this, path6, line).open();
  }
  openModalFor(editor, view) {
    if (!view || !view.file) return this.notice("\u5148\u6253\u5F00\u4E00\u7BC7\u7B14\u8BB0");
    this.openDelegateModal(view.file.path, editor.getCursor().line);
  }
  openSessionForEditor(editor, view) {
    if (!view || !view.file) return;
    const path6 = view.file.path, line = editor.getCursor().line;
    const map = this.lineMap(path6, editor.cm.state.doc);
    let s = map.sessionByParent.get(line);
    if (!s) {
      const text = editor.getLine(line);
      const job = this.jobAtLine(path6, line, text);
      if (job) return this.openJob(job.id);
    }
    if (!s) return this.notice("\u8FD9\u4E00\u884C\u4E0B\u9762\u6CA1\u6709 \u{1F517} \u7ED1\u5B9A");
    return this.openSession(s.agent, s.sid, s.app, s);
  }
  cancelJob(id) {
    if (!id) return;
    this.delegator.cancel(id);
    this.refreshUI();
  }
  // ---------- macOS menu bar ----------
  buildMenuBarState() {
    const cfg = this.settings;
    const today = this.store.get(dayKeyToday(cfg));
    const live = this.liveSessions({ hours: 6 });
    const recent = this.recentSessions({ days: 1, limit: 120 });
    const primaries = this.primaryAgents();
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    const add = (s, primary, isLive) => {
      if (!s || !s.sid || seen.has(s.sid)) return false;
      const agent = AGENTS[s.agent] ? s.agent : "claude";
      const a = AGENTS[agent];
      const state = isLive ? s.state || "idle" : "recent";
      const kw = menuKeyword(state);
      const where = agent === "claude" ? s.app === "cli" ? "\u7EC8\u7AEF" : "\u684C\u9762\u7248" : agent === "codex" ? isCodexDesktop(s.app) ? "\u684C\u9762\u7248" : "CLI" : agent === "workbuddy" ? "\u684C\u9762\u7248" : "Harness";
      const url = sessionDeepLink(agent, s.sid);
      seen.add(s.sid);
      out.push({
        id: `${agent}:${s.sid}`,
        agent,
        agentName: a.name,
        agentShort: a.short,
        color: a.color,
        glyph: a.glyph,
        title: (s.parentSid ? "\u21B3 " : "") + truncate(s.title || (s.text || "").split(" / ")[0] || s.step || s.sid, 64),
        detail: `${a.short} ${where} \xB7 ${projectName(s.cwd)}${s.step ? " \xB7 " + truncate(s.step, 32) : ""}${s.sideChats ? " \xB7 side chat \xD7" + s.sideChats : ""} \xB7 ${timeAgo(s.lastAt)}`,
        project: projectName(s.cwd),
        step: s.step ? truncate(s.step, 40) : "",
        ago: timeAgo(s.lastAt),
        keyword: kw.id,
        keywordLabel: kw.zh,
        state,
        stateLabel: menuStateLabel(state),
        primary: !!primary,
        url: agent === "dsh" ? "dsh://open" : isCliSession(agent, s.app) && cfg.cliOpen !== "desktop" ? `obsidian://agent-deck?do=open&agent=${agent}&sid=${encodeURIComponent(s.sid)}` : url,
        copy: agent === "dsh" ? s.sid : agent === "codex" ? `codex resume ${s.sid}` : "",
        _at: s.lastAt || 0
      });
      return true;
    };
    for (const agent of AGENT_ORDER) {
      if (!this.agentEnabled(agent)) continue;
      const primary = primaries.includes(agent);
      const limit = Math.max(1, Number(primary ? cfg.menuBarPrimaryLimit : cfg.menuBarOtherLimit) || (primary ? 8 : 3));
      let count = 0;
      if (primary) {
        const lives = live.filter((x) => x.agent === agent).sort((a, b) => menuRank(a.state) - menuRank(b.state) || (b.lastAt || 0) - (a.lastAt || 0));
        for (const s of lives) if (add(s, true, true) && ++count >= limit) break;
        if (count < limit) {
          const cutoff = Date.now() - 6 * 36e5;
          const recs = recent.filter((x) => x.agent === agent && (x.lastAt || 0) >= cutoff).sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
          for (const s of recs) if (add(s, true, false) && ++count >= limit) break;
        }
      } else {
        const wbWaiting = (state) => agent === "workbuddy" && ["wait", "quiet", "needs-approval"].includes(state);
        const rows = [
          ...live.filter((x) => x.agent === agent && (x.state === "run" || wbWaiting(x.state))),
          ...recent.filter((x) => x.agent === agent && x.state === "run")
        ].sort((a, b) => menuRank(a.state) - menuRank(b.state) || (b.lastAt || 0) - (a.lastAt || 0));
        for (const s of rows) if (add(s, false, true) && ++count >= limit) break;
      }
    }
    out.sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0) || menuRank(a.state) - menuRank(b.state) || (b._at || 0) - (a._at || 0));
    for (const row of out) delete row._at;
    const running = out.filter((x) => x.state === "run").length;
    const waiting = out.filter((x) => ["wait", "quiet", "needs-approval"].includes(x.state)).length;
    const short = running && waiting ? `${running} \u8DD1 \xB7 ${waiting} \u7B49` : running ? `${running} \u5728\u8DD1` : waiting ? `${waiting} \u7B49\u4F60` : "\u7A7A\u95F2";
    const summary = [];
    if (today) summary.push(`\u4ECA\u5929 ${fmtMin(today.wall)} \xB7 ${fmtTok(today.out)} tok`);
    summary.push(`${running} \u4E2A\u5728\u8DD1`);
    if (waiting) summary.push(`${waiting} \u4E2A\u7B49\u4F60`);
    const usage = today ? `\u4ECA\u5929 ${fmtMin(today.wall)} \xB7 ${fmtTok(today.out)} tok` : "\u4ECA\u5929\u8FD8\u6CA1\u6709\u7528\u91CF\u8BB0\u5F55";
    const agents = AGENT_ORDER.filter((x) => this.agentEnabled(x)).map((x) => {
      const rows = live.filter((s) => s.agent === x);
      return {
        id: x,
        short: AGENTS[x].short,
        name: AGENTS[x].name,
        color: AGENTS[x].color,
        glyph: AGENTS[x].glyph,
        running: rows.filter((s) => s.state === "run").length,
        waiting: rows.filter((s) => ["wait", "quiet", "needs-approval"].includes(s.state)).length,
        primary: primaries.includes(x)
      };
    });
    return {
      updatedAt: Date.now(),
      short,
      summary: summary.join(" \xB7 "),
      usage,
      hotkey: cfg.menuBarHotkey || "control+option+command+D",
      running,
      waiting,
      agents,
      sessions: out
    };
  }
  async restoreNautilusAgentBar() {
    const p = import_path5.default.join(this.vaultPath, ".obsidian/plugins/nautilus-spiral/data.json");
    try {
      const data = JSON.parse(await fsp4.readFile(p, "utf8"));
      if (data.agentStatus !== true) {
        data.agentStatus = true;
        await fsp4.writeFile(p, JSON.stringify(data, null, 1), "utf8");
      }
    } catch {
    }
    const naut = this.app.plugins && this.app.plugins.plugins && this.app.plugins.plugins["nautilus-spiral"];
    if (naut && naut.settings) {
      naut.settings.agentStatus = true;
      try {
        await naut.saveData?.(naut.settings);
      } catch {
      }
      try {
        naut.tickAgents?.();
      } catch {
      }
    }
    this.notice("\u5DF2\u6062\u590D\u87BA\u65CB\u65E5\u7A0B\u53F3\u4E0B\u89D2\u7684 Agent \u6C47\u603B", 6e3);
  }
  async hideNautilusAgentBar() {
    if (this.settings.menuBarHideNautilus === false) return;
    const p = import_path5.default.join(this.vaultPath, ".obsidian/plugins/nautilus-spiral/data.json");
    let data = null;
    try {
      data = JSON.parse(await fsp4.readFile(p, "utf8"));
    } catch {
    }
    let changed = false;
    if (data && data.agentStatus !== false) {
      try {
        await fsp4.copyFile(p, p + `.agent-deck-backup-${Date.now()}`);
      } catch {
      }
      data.agentStatus = false;
      try {
        await fsp4.writeFile(p, JSON.stringify(data, null, 1), "utf8");
        changed = true;
      } catch {
      }
    }
    const naut = this.app.plugins && this.app.plugins.plugins && this.app.plugins.plugins["nautilus-spiral"];
    if (naut && naut.settings) {
      if (naut.settings.agentStatus !== false) changed = true;
      naut.settings.agentStatus = false;
      try {
        await naut.saveData?.(naut.settings);
      } catch {
      }
      try {
        naut.tickAgents?.();
      } catch {
      }
    }
    if (changed && !this.settings.menuBarMigrated) {
      this.settings.menuBarMigrated = true;
      await this.saveSettings();
      this.notice("\u5DF2\u628A\u53F3\u4E0B\u89D2\u7684 Agent \u6C47\u603B\u79FB\u5230 macOS \u83DC\u5355\u680F\uFF1B\u87BA\u65CB\u65E5\u7A0B\u7684 Agent \u6C47\u603B\u4E5F\u5DF2\u5173\u95ED\u3002", 9e3);
    } else if (!this.settings.menuBarMigrated) {
      this.settings.menuBarMigrated = true;
      await this.saveSettings();
    }
  }
  // ---------- ui refresh ----------
  refreshUI() {
    clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => {
      for (const view of this.views) {
        try {
          view.render();
        } catch (e) {
          console.error("[agent-deck] view", e);
        }
      }
      try {
        dispatchRefresh(this);
      } catch {
      }
      this.menubar?.update();
    }, 120);
  }
  // ---------- misc ----------
  notice(msg, ms) {
    try {
      new import_obsidian7.Notice(msg, ms);
    } catch {
      console.log("[agent-deck]", msg);
    }
  }
  openExternal(url) {
    return openExternal(url);
  }
  async readNote(path6) {
    const view = this.viewForPath(path6);
    if (view) return view.editor.getValue();
    const file = this.app.vault.getAbstractFileByPath(path6);
    if (!file) throw new Error("\u627E\u4E0D\u5230\u7B14\u8BB0\uFF1A" + path6);
    return await this.app.vault.read(file);
  }
  async writeNote(path6, text) {
    const view = this.viewForPath(path6);
    if (view) {
      const change = diffLines(view.editor.getValue(), text);
      if (change) view.editor.transaction({ changes: [change] });
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(path6);
    if (!file) throw new Error("\u627E\u4E0D\u5230\u7B14\u8BB0\uFF1A" + path6);
    await this.app.vault.process(file, () => text);
  }
  async checkBinary(kind) {
    const bin = kind === "dsh" ? findDshBinary() : findClaudeBinary(this.settings.delegate?.claude?.path || "");
    return await new Promise((resolve) => {
      (0, import_child_process5.execFile)(bin, ["--version"], { timeout: 1e4, env: process.env }, (err2, out, errOut) => {
        if (err2) resolve(`${kind} \u6CA1\u627E\u5230\u6216\u4E0D\u80FD\u8FD0\u884C\uFF1A${String(err2.message || err2)}
${String(errOut || "").slice(0, 300)}`);
        else resolve(`${kind}\uFF1A${String(out || "").trim()}`);
      });
    });
  }
  openTerminalAt(cwd, cmd) {
    const script = `tell application "Terminal"
activate
do script ${JSON.stringify(`cd ${JSON.stringify(cwd)} && ${cmd}`)}
end tell`;
    try {
      (0, import_child_process5.execFile)("/usr/bin/osascript", ["-e", script], () => {
      });
    } catch (e) {
      this.notice(String(e.message || e));
    }
  }
  async pauseNautilus() {
    const p = import_path5.default.join(this.vaultPath, ".obsidian/plugins/nautilus-spiral/data.json");
    let data;
    try {
      data = JSON.parse(await fsp4.readFile(p, "utf8"));
    } catch {
      this.notice("\u6CA1\u6709\u627E\u5230\u87BA\u65CB\u65E5\u7A0B\u7684 data.json");
      return;
    }
    const backup = p + `.agent-deck-backup-${Date.now()}`;
    try {
      await fsp4.copyFile(p, backup);
    } catch {
    }
    data.autoLog = false;
    data.autoLogArchiveDone = false;
    data.agentKw = false;
    data.resultBack = false;
    try {
      await fsp4.writeFile(p, JSON.stringify(data, null, 1), "utf8");
    } catch (e) {
      this.notice("\u5199\u5165\u87BA\u65CB\u65E5\u7A0B\u8BBE\u7F6E\u5931\u8D25\uFF1A" + (e && e.message || e));
      return;
    }
    this.notice(`\u5DF2\u505C\u7528\u87BA\u65CB\u65E5\u7A0B\u7684 AI \u5199\u5165\uFF08\u539F\u8BBE\u7F6E\u5907\u4EFD\u5728 ${import_path5.default.basename(backup)}\uFF09\uFF1A\u81EA\u52A8\u8BB0\u65E5\u8BB0\u3001\u72B6\u6001\u5199\u56DE\u3001\u{1F4AC} \u548C\u5B50\u5757\u90FD\u4E0D\u518D\u5199\uFF1B\u5B83\u7684 Agent \u8FFD\u8E2A\u5C55\u793A\u7167\u5E38\u3002\u8BF7\u5728 Obsidian \u8BBE\u7F6E\u91CC\u91CD\u65B0\u52A0\u8F7D\u87BA\u65CB\u65E5\u7A0B\uFF0C\u6216\u91CD\u542F Obsidian\u3002`, 1e4);
  }
  // 螺旋日程的「写日记」还开着的时候，不让 Agent Deck 也改日记：两套写法会打架。
  // 只看会写笔记的那几个开关；showAi / agentStatus / lineProgress 是它的追踪展示，留着不碍事。
  nautilusOwnsAi() {
    const n = this.app.plugins?.plugins?.["nautilus-spiral"];
    const s = n && n.settings;
    if (!s) return false;
    if (s.showAi === false) return false;
    return s.resultBack !== false || s.agentKw !== false || s.autoLog === true;
  }
  openPluginDir() {
    try {
      const { shell } = require("electron");
      if (shell && shell.openPath) return shell.openPath(this.pluginDir);
    } catch {
    }
    openExternal("file://" + this.pluginDir);
  }
};
function menuStateLabel(state) {
  return { run: "\u5728\u8DD1", wait: "\u7B49\u4F60", quiet: "\u5B89\u9759", "needs-approval": "\u7B49\u4F60\u5141\u8BB8", error: "\u51FA\u9519", limit: "\u9650\u989D", recent: "\u6700\u8FD1", done: "\u5B8C\u6210", idle: "\u7A7A\u95F2" }[state] || "\u7A7A\u95F2";
}
function menuKeyword(state) {
  return {
    run: { id: "DOING", zh: "\u5728\u8DD1" },
    wait: { id: "WAITING", zh: "\u7B49\u4F60" },
    quiet: { id: "PAUSED", zh: "\u5B89\u9759" },
    "needs-approval": { id: "NEEDOK", zh: "\u7B49\u4F60" },
    error: { id: "ERRORED", zh: "\u51FA\u9519" },
    limit: { id: "HITLIMIT", zh: "\u9650\u989D" },
    done: { id: "DONE", zh: "\u5B8C\u6210" },
    recent: { id: "LATER", zh: "\u6700\u8FD1" },
    idle: { id: "TODO", zh: "\u7A7A\u95F2" }
  }[state] || { id: "TODO", zh: "\u7A7A\u95F2" };
}
function menuRank(state) {
  return { run: 0, "needs-approval": 1, wait: 2, quiet: 3, error: 4, limit: 4, recent: 5, done: 6, idle: 7 }[state] ?? 7;
}
function parseLinkLine(line) {
  let agent = "claude";
  let sid = "";
  let m = /claude:\/\/resume\?session=([0-9a-f-]{20,})/i.exec(line);
  if (m) {
    sid = m[1];
    agent = "claude";
  } else if (m = /workbuddy:\/\/chat\/([^\s)\]]+)/i.exec(line)) {
    sid = decodeURIComponent(m[1]);
    agent = "workbuddy";
  } else if (m = /codex:\/\/threads\/([0-9a-f-]{36})/i.exec(line)) {
    sid = m[1];
    agent = "codex";
  } else if (m = /`(session-[0-9a-f-]{20,}|[0-9a-f]{8}-[0-9a-f-]{27})`/i.exec(line)) {
    sid = m[1];
    agent = /dsh|deepseek|harness/i.test(line) ? "dsh" : "claude";
  } else if (m = /`([0-9a-f]{8}-[0-9a-f-]{27})`/i.exec(line)) {
    sid = m[1];
    agent = "dsh";
  } else if (m = /codex\s+resume\s+([0-9a-f-]{20,})/i.exec(line)) {
    sid = m[1];
    agent = "codex";
  }
  if (/DeepSeek Harness|DSH/i.test(line) && !/claude:\/\//i.test(line)) agent = "dsh";
  return { agent, sid };
}
module.exports = module.exports.default;
