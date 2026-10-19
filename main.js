/* Agent Deck 1.0.6 — MIT — https://github.com/MatsuriMW/obsidian-agent-deck */
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
var import_fs4 = __toESM(require("fs"), 1);
var import_path4 = __toESM(require("path"), 1);
var import_child_process3 = require("child_process");
var import_obsidian5 = require("obsidian");

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
var AGENT_SHORT = (id) => AGENTS[id] ? AGENTS[id].short : id || "Agent";
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
  async readCodexArchived() {
    const dir = import_path.default.join(process.env.CODEX_HOME || import_path.default.join(home(), ".codex"), "archived_sessions");
    try {
      for (const f of await fsp.readdir(dir)) {
        const m = /([0-9a-f]{8}-[0-9a-f-]{27})\.jsonl$/.exec(f);
        if (m) this.archived.add(m[1]);
      }
    } catch {
    }
  }
  // ----- file caches -----
  ensureFile(p, agent) {
    let fc = this.files.get(p);
    if (!fc) {
      const base = import_path.default.basename(p).replace(/\.jsonl(\.zstd|\.zst)?$/, "");
      const sid = base.startsWith("session-") ? base : (/([0-9a-f]{8}-[0-9a-f-]{27})/.exec(base) || [])[1] || base;
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
        sub: ""
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
    if (fc.agent === "claude") return this.ingestClaude(line, fc, touched);
    if (fc.agent === "codex") return this.ingestCodex(line, fc, touched);
    if (fc.agent === "workbuddy") return this.ingestWorkbuddy(line, fc, touched);
  }
  // ---- Claude Code ----
  ingestClaude(line, fc, touched) {
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
      if (p.thread_source === "subagent" && p.parent_thread_id) fc.sid = String(p.parent_thread_id);
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
    fc.mtime = st.mtimeMs;
    fc.size = st.size;
    const raw = await fsp.readFile(p);
    const bytes = decompress(raw);
    const text = Buffer.from(bytes).toString("utf8");
    fc.days = /* @__PURE__ */ new Map();
    fc.msgs = /* @__PURE__ */ new Map();
    fc.titles = /* @__PURE__ */ new Map();
    fc.live = null;
    fc.tot = null;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      this.ingestDsh(lines[i], fc, touched);
      if (i % 2e3 === 1999) await new Promise((r) => setImmediate(r));
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
      const m = this.noteMeta(fc, fc.sid, { cwd: fc.cwd, app: "dsh", lastAt: Math.max(ms || d.createdAt || 0, this.meta.get(fc.sid)?.lastAt || 0) });
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
      seen.add(sid);
      const meta = this.meta.get(sid) || {};
      const live = cleanLive({ ...v }, Date.now());
      if (live.quiet && live.state === "run") live.state = "quiet";
      out.push({ ...meta, ...live, sid, agent: fc.agent, cwd: v.cwd || fc.cwd, app: v.app || fc.app, title: v.title || meta.title || this.titles.get(sid) || "", model: v.model || meta.model || "", tokens: (meta.out || 0) + (meta.fresh || 0), lastAt: v.at });
    }
    return out.sort((a, b) => b.lastAt - a.lastAt).slice(0, limit);
  }
  sessions({ since = 0, limit = 100, agent = "" } = {}) {
    const out = [];
    for (const m of this.meta.values()) {
      if (!m.lastAt || m.lastAt < since) continue;
      if (agent && m.agent !== agent) continue;
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

// src/delegation.js
var import_fs2 = __toESM(require("fs"), 1);
var import_path2 = __toESM(require("path"), 1);
var import_os2 = __toESM(require("os"), 1);
var import_child_process = require("child_process");
var fsp2 = import_fs2.default.promises;
var home2 = () => import_os2.default.homedir();
var norm2 = (p) => String(p || "").replace(/^~(?=\/)/, home2());
var BULLET_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
var LINK_RE = /^\s*[-*+]\s+🔗/;
var RESULT_RE = /^\s*[-*+]\s+💬/;
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
  const back = /`([0-9a-f-]{16,}|session-[0-9a-f-]{20,})`/i.exec(lines[at]);
  return { line: at, sid: m && m[1] || wb && decodeURIComponent(wb[1]) || back && back[1] || "", raw: lines[at] };
}
function markDelegated(line) {
  const m = /^(\s*(?:[-*+]|\d+[.)])\s+(?:\*\*\d{1,2}[:：]\d{2}\*\*\s*)?)(.*)$/.exec(line || "");
  if (!m) return `DELEGATED ${line || ""}`;
  const rest = m[2];
  const s = STATUS_RE.exec(line);
  if (s) return line.replace(s[2], "DELEGATED");
  return `${m[1]}DELEGATED ${rest}`;
}
function linkLine(indent, agent, name, sid) {
  const safe = String(name || "").replace(/[\[\]()`]+/g, " ").slice(0, 48);
  if (agent === "claude") return `${indent}- \u{1F517} [Claude\uFF1A${safe}](claude://resume?session=${sid})`;
  if (agent === "dsh") return `${indent}- \u{1F517} [DeepSeek Harness\uFF1A${safe}](dsh://open) \`${sid}\``;
  return `${indent}- \u{1F517} ${AGENT_SHORT(agent)}\uFF1A${safe} \`${sid}\``;
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
    (0, import_child_process.execFile)("/usr/bin/open", [url], () => {
    });
    return true;
  } catch {
    return false;
  }
}
function openTerminal(command) {
  try {
    const script = `tell application "Terminal"
activate
do script ${JSON.stringify(command)}
end tell`;
    (0, import_child_process.execFile)("/usr/bin/osascript", ["-e", script], () => {
    });
    return true;
  } catch {
    return false;
  }
}
function sessionDeepLink(agent, sid) {
  if (!sid) return "";
  if (agent === "claude") return `claude://resume?session=${sid}`;
  if (agent === "workbuddy") return `workbuddy://chat/${encodeURIComponent(sid)}`;
  if (agent === "dsh") return "dsh://open";
  if (agent === "codex") return "";
  return "";
}
function openSession(plugin, agent, sid, app = "") {
  if (!sid) {
    plugin.notice("\u8FD9\u4E2A\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u4F1A\u8BDD\u53F7\uFF0C\u7A0D\u7B49\u4E00\u79D2\u518D\u70B9");
    return false;
  }
  if (agent === "claude") {
    if (app === "cli") {
      const cmd = `claude --resume ${sid}`;
      if (plugin.settings.delegate?.claude?.terminalInsteadOfDesktop) return openTerminal(cmd);
    }
    openExternal(`claude://resume?session=${sid}`);
    return true;
  }
  if (agent === "workbuddy") {
    openExternal(`workbuddy://chat/${encodeURIComponent(sid)}`);
    return true;
  }
  if (agent === "codex") {
    plugin.notice("Codex \u6CA1\u6709\u81EA\u5DF1\u7684\u4F1A\u8BDD URL\uFF0C\u5DF2\u590D\u5236\u6062\u590D\u547D\u4EE4");
    try {
      navigator.clipboard.writeText(`codex resume ${sid}`);
    } catch {
    }
    return false;
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
    const child = (0, import_child_process.spawn)(bin, args2, { cwd, env: cleanEnv(), stdio: ["ignore", "pipe", "pipe"] });
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
      (0, import_child_process.execFile)(bin, ["stop", this.short], { env: cleanEnv() }, () => {
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
    const child = (0, import_child_process.spawn)(bin, ["acp"], { cwd, env: cleanEnv(), stdio: ["pipe", "pipe", "pipe"] });
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
    job.state = "running";
    this.saveJobs();
    if (job.linkWritten) return;
    job.linkWritten = true;
    job._linkPromise = this.writeLink(job, sid).catch((e) => console.error("[agent-deck] writeLink", e));
    this.refreshUI();
  }
  async writeLink(job, sid) {
    if (!this.C.writeLink) return;
    const path5 = job.path;
    const text = await this.plugin.readNote(path5);
    const lines = text.split("\n");
    let at = lines.findIndex((l) => l === job.lineText);
    if (at < 0) at = lines.findIndex((l) => blockTitle({ text: l }) && l.includes(truncate(job.name, 20)));
    if (at < 0) return;
    const block = blockAt(lines, at);
    if (!block) return;
    if (hasLink(lines, block) >= 0) return;
    const indent = (lines[block.start].match(/^[ \t]*/) || [""])[0] + "	";
    const link = linkLine(indent, job.agent, job.name, sid);
    lines.splice(block.start + 1, 0, link);
    if (this.C.markStatus) lines[block.start] = markDelegated(lines[block.start]);
    await this.plugin.writeNote(path5, lines.join("\n"));
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
    for (let i = block.start + 1; i <= block.end; i++) if (RESULT_RE.test(lines[i])) {
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
  cancelForLine(path5, lineText) {
    for (const job of Object.values(this.jobs)) {
      if (job.path === path5 && (job.lineText === lineText || job.line === lineText) && ["starting", "running", "needs-approval"].includes(job.state)) return job;
    }
    return null;
  }
  jobsFor(path5) {
    return Object.values(this.jobs).filter((j) => j.path === path5 && j.state !== "cancelled").sort((a, b) => b.startedAt - a.startedAt);
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
      child = (0, import_child_process.spawn)(bin, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
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
    (0, import_child_process.execFile)(bin, args, { cwd, env, timeout, maxBuffer: 8 * 1024 * 1024 }, (err2, out, errOut) => {
      resolve({ ok: !err2, out: String(out || ""), err: String(errOut || err2 && err2.message || "") });
    });
  });
}

// src/view.js
var import_obsidian2 = require("obsidian");

// src/icons.js
var import_obsidian = require("obsidian");
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
  return setLucide(el, AGENT_ICONS[agent] || AGENT_ICONS.claude, cls);
}
function stateIcon(el, state, cls = "") {
  return setLucide(el, STATE_ICONS[state] || STATE_ICONS.idle, cls);
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
    if (!nowItems.length) this.empty(nowList, "\u73B0\u5728\u6CA1\u6709\u5728\u8DD1\u7684\u4F1A\u8BDD", "\u4ECE\u4EFB\u52A1\u884C\u70B9\u300C\u59D4\u6D3E\u300D\uFF0C\u6216\u8005\u7B49\u4E0B\u4E00\u6B21\u626B\u63CF\u3002");
    for (const s of nowItems) this.sessionCard(nowList, s, true);
    const agentsSec = dash.createDiv({ cls: "ad-sec" });
    this.secHead(agentsSec, "Agents", "\u70B9\u661F\u6807\u5207\u6362\u4E3B\u529B\uFF08\u6700\u591A\u4E24\u4E2A\uFF09", () => p.openSettings());
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
    card.style.setProperty("--ad-agent", a.color);
    card.style.setProperty("--ad-agent-soft", a.soft);
    const top = card.createDiv({ cls: "ad-agentcard__top" });
    const mark = top.createDiv({ cls: "ad-agentcard__mark" });
    agentIcon(mark.createSpan({ cls: "ad-glyph" }), id);
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
    card.style.setProperty("--ad-agent", a.color);
    card.style.setProperty("--ad-agent-soft", a.soft);
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
    const go = card.createEl("button", { cls: "ad-arrow", attr: { "aria-label": "\u6253\u5F00\u4F1A\u8BDD" } });
    setLucide(go.createSpan({ cls: "ad-arrow__icon" }), "arrow-up-right");
    const open = () => p.openSession(s.agent, s.sid, s.app, s);
    go.onclick = (e) => {
      e.stopPropagation();
      open();
    };
    card.onclick = open;
    if (s.agent === "dsh") card.title = "DeepSeek Harness \u5F53\u524D\u53EA\u63D0\u4F9B dsh://open\uFF08\u805A\u7126\u5BA2\u6237\u7AEF\uFF09\uFF0C\u4F1A\u8BDD\u53F7\u4F1A\u590D\u5236\u5230\u526A\u8D34\u677F";
    if (s.agent === "claude" && s.app === "cli") card.title = "\u7EC8\u7AEF\u91CC\u7684 Claude Code\uFF1A\u4F1A\u5C1D\u8BD5\u5728 Claude \u684C\u9762\u7248\u6253\u5F00\uFF0C\u4E5F\u53EF\u5728\u8BBE\u7F6E\u91CC\u6539\u6210\u7EC8\u7AEF";
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
      const path5 = card.createDiv({ cls: "ad-set-path", text: a.where[0] });
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
    const naut = this.card(body, "\u548C\u87BA\u65CB\u65E5\u7A0B\u5E76\u5B58", "\u87BA\u65CB\u65E5\u7A0B\u4E5F\u4F1A\u8BFB\u540C\u4E00\u6279 \u{1F517} \u4F1A\u8BDD\u3001\u6539\u4EFB\u52A1\u72B6\u6001\u3001\u5199 \u{1F4AC}\u3002\u7528 Agent Deck \u63A5\u7BA1\u540E\uFF0C\u53EF\u4EE5\u628A\u5B83\u7684 AI \u90E8\u5206\u5173\u6389\uFF0C\u65E5\u7A0B\u672C\u8EAB\u4E0D\u52A8\u3002");
    const nbtn = naut.createDiv({ cls: "ad-btnrow" });
    this.bigButton(nbtn, "\u505C\u7528\u87BA\u65CB\u65E5\u7A0B\u91CC\u7684 AI \u8FFD\u8E2A", () => p.pauseNautilus(), "mod-warning");
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
  constructor(app, plugin, path5, line) {
    super(app);
    this.plugin = plugin;
    this.path = path5;
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

// src/editor.js
var import_view = require("@codemirror/view");
var import_state = require("@codemirror/state");
var refreshEffect = import_state.StateEffect.define();
function sigFor(x) {
  if (!x) return "none";
  return [x.kind, x.job && x.job.id, x.job && x.job.state, x.session && x.session.sid, x.session && x.session.state, x.session && x.session.step, x.session && x.session.tokens, x.todo && `${x.todo.done}/${x.todo.total}`].join("|");
}
var PillWidget = class extends import_view.WidgetType {
  constructor(plugin, path5, line, info) {
    super();
    this.plugin = plugin;
    this.path = path5;
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
  const path5 = info && info.file && info.file.path;
  if (!path5 || !plugin.settings.showEditorPills) return builder.finish();
  const doc = view.state.doc;
  const map = plugin.lineMap(path5, doc);
  const seen = /* @__PURE__ */ new Set();
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      const n = line.number - 1;
      if (!seen.has(n)) {
        seen.add(n);
        const text = line.text;
        const job = plugin.jobAtLine(path5, n, text);
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
          const widget = new PillWidget(plugin, path5, n, state);
          builder.add(line.to, line.to, import_view.Decoration.widget({ widget, side: 1, block: false }));
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
      this.decorations = buildDecorations(view, plugin);
    }
    update(update) {
      const refresh = update.transactions.some((tr) => tr.effects.some((e) => e.is(refreshEffect)));
      if (update.docChanged || update.selectionSet || update.viewportChanged || refresh) this.decorations = buildDecorations(update.view, plugin);
    }
  };
  return import_view.ViewPlugin.fromClass(pluginClass, { decorations: (v) => v.decorations });
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

// src/menubar.js
var import_fs3 = __toESM(require("fs"), 1);
var import_path3 = __toESM(require("path"), 1);
var import_os3 = __toESM(require("os"), 1);
var import_crypto = __toESM(require("crypto"), 1);
var import_child_process2 = require("child_process");

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
                color: .solid("#D97757", "#F09475"),
                tint: .solid("#FBECE4", "#39251E"),
                glyph: "\u2733", short: "Claude"
            )
        case "codex":
            return AgentStyle(
                color: .solid("#4C82C3", "#7FB2E8"),
                tint: .solid("#EAF1F9", "#1E2C3B"),
                glyph: "\u2318", short: "Codex"
            )
        case "workbuddy":
            return AgentStyle(
                color: .solid("#1C9A78", "#46C9A3"),
                tint: .solid("#E6F5EF", "#1B332B"),
                glyph: "\u2726", short: "WorkBuddy"
            )
        case "dsh":
            return AgentStyle(
                color: .solid("#4A66E8", "#7F95FF"),
                tint: .solid("#EAEDFF", "#232744"),
                glyph: "\u25C8", short: "DSH"
            )
        default:
            let base = Color(hex: fallbackColor)
            return AgentStyle(
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
            Text(style.glyph)
                .font(.system(size: 9.5, weight: .bold))
                .foregroundColor(style.color)
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
    DispatchQueue.main.async { delegate.togglePanel() }
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
        guard !panel.isVisible else { return }
        layoutPanel()
        panel.alphaValue = 1
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
        panel.orderFrontRegardless()
        forceDisplay()
        model.panelVisible = true
        statusItem.button?.highlight(true)
        installMonitors()
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
  async _start() {
    await fsp3.mkdir(this.dir, { recursive: true });
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
      const child = (0, import_child_process2.spawn)("/usr/bin/swiftc", ["-O", "-swift-version", "5", "-framework", "AppKit", "-framework", "SwiftUI", "-framework", "Carbon", "-o", tmp, this.srcPath], { stdio: ["ignore", "pipe", "pipe"] });
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
      (0, import_child_process2.execFile)("/usr/bin/open", args, () => {
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
      (0, import_child_process2.execFile)("/usr/bin/pkill", ["-f", this.binPath], () => {
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

// src/main.js
var fsp4 = import_fs4.default.promises;
var AgentDeckPlugin = class extends import_obsidian5.Plugin {
  async onload() {
    const data = await this.loadData();
    this.settings = deepMerge(DEFAULTS, data || {});
    if (!Array.isArray(this.settings.primaryAgents)) this.settings.primaryAgents = this.settings.aiPrimary ? [this.settings.aiPrimary] : ["claude"];
    this.settings.primaryAgents = this.settings.primaryAgents.filter((x) => AGENTS[x]).slice(0, 2);
    if (!this.settings.primaryAgents.length) this.settings.primaryAgents = ["claude"];
    this.settings.jobs = this.settings.jobs && typeof this.settings.jobs === "object" ? this.settings.jobs : {};
    this.jobs = this.settings.jobs;
    this.views = /* @__PURE__ */ new Set();
    this._lineMaps = {};
    this.vaultPath = this.app.vault.adapter.getBasePath ? this.app.vault.adapter.getBasePath() : "";
    this.manifestDir = this.manifest.dir || `.obsidian/plugins/${this.manifest.id}`;
    this.pluginDir = import_path4.default.join(this.vaultPath, this.manifestDir);
    this.usageFile = import_path4.default.join(this.pluginDir, "usage.json");
    this.store = new UsageStore(this, this.settings);
    await this.store.load(this.usageFile);
    this.usage = new AgentUsage({ cfg: this.settings, settings: this.settings });
    this.editorInfoField = import_obsidian5.editorInfoField;
    this.delegator = new Delegator(this);
    this.menubar = new MenuBarBridge(this);
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
    this.addCommand({ id: "delegate-current", name: "\u59D4\u6D3E\u5149\u6807\u6240\u5728\u5757\uFF08\u9ED8\u8BA4 Agent\uFF09", editorCallback: (editor) => this.delegateFromEditor(editor) });
    this.addCommand({ id: "delegate-current-claude", name: "\u59D4\u6D3E\u5149\u6807\u6240\u5728\u5757 \u2192 Claude Code", editorCallback: (editor) => this.delegateFromEditor(editor, "claude") });
    this.addCommand({ id: "delegate-current-dsh", name: "\u59D4\u6D3E\u5149\u6807\u6240\u5728\u5757 \u2192 DeepSeek Harness", editorCallback: (editor) => this.delegateFromEditor(editor, "dsh") });
    this.addCommand({ id: "delegate-options", name: "\u59D4\u6D3E\u9009\u9879\u2026\uFF08\u6A21\u578B\u3001\u5F3A\u5EA6\u3001\u6A21\u5F0F\uFF09", editorCallback: (editor, view) => this.openModalFor(editor, view) });
    this.addCommand({ id: "open-session-line", name: "\u6253\u5F00\u5149\u6807\u8FD9\u4E00\u884C\u7ED1\u5B9A\u7684\u4F1A\u8BDD", editorCallback: (editor, view) => this.openSessionForEditor(editor, view) });
    this.addCommand({ id: "scan-now", name: "\u91CD\u65B0\u626B\u63CF\u672C\u673A Agent \u4F1A\u8BDD", callback: () => this.scanNow(true) });
    this.addCommand({ id: "import-nautilus", name: "\u5BFC\u5165\u87BA\u65CB\u65E5\u7A0B\u7684\u5386\u53F2\u7528\u91CF", callback: () => this.importNautilus(true) });
    this.addCommand({ id: "clean-jobs", name: "\u6E05\u7406\u5DF2\u7ED3\u675F\u7684\u59D4\u6D3E\u8BB0\u5F55", callback: () => this.cleanJobs() });
    this.registerObsidianProtocolHandler("agent-deck", async (params) => {
      if (params && params.do === "scan") return this.scanNow(true);
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
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) try {
      leaf.detach();
    } catch {
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
      this.refreshUI();
      if (force) new import_obsidian5.Notice(`Agent Deck\uFF1A\u8BFB\u5230 ${this.usage.files.size} \u4E2A\u65E5\u5FD7\uFF0C${touched.size} \u5929\u6709\u5185\u5BB9`, 4e3);
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
    new import_obsidian5.Notice("Agent Deck\uFF1A\u5386\u53F2\u5DF2\u91CD\u7B97");
  }
  async importNautilus(manual = false) {
    const dir = import_path4.default.join(this.vaultPath, ".obsidian/plugins/nautilus-spiral");
    let raw;
    try {
      raw = await fsp4.readFile(import_path4.default.join(dir, "ai-usage.json"), "utf8");
    } catch {
      if (manual) new import_obsidian5.Notice("\u6CA1\u6709\u627E\u5230\u87BA\u65CB\u65E5\u7A0B\u7684 ai-usage.json");
      return;
    }
    let src;
    try {
      src = JSON.parse(raw);
    } catch {
      if (manual) new import_obsidian5.Notice("\u87BA\u65CB\u65E5\u7A0B\u7684 ai-usage.json \u89E3\u6790\u5931\u8D25");
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
    if (manual || added) new import_obsidian5.Notice(`Agent Deck\uFF1A\u4ECE\u87BA\u65CB\u65E5\u7A0B\u5BFC\u5165 ${added} \u5929\u5386\u53F2`);
    this.refreshUI();
  }
  recoverJobs() {
    for (const job of Object.values(this.jobs)) {
      if (job.state === "done" && job.linkWritten && !job.resultWritten) {
        this.delegator.writeResult(job).catch((e) => console.error("[agent-deck] recover result", e));
        continue;
      }
      if (!["starting", "running", "needs-approval"].includes(job.state)) continue;
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
    new import_obsidian5.Notice(`Agent Deck \u4E3B\u529B\uFF1A${this.settings.primaryAgents.map((x) => AGENTS[x].short).join(" + ")}`);
  }
  async setAgentEnabled(agent, on) {
    var _a;
    if (this.isPrimary(agent) && !on) {
      new import_obsidian5.Notice("\u4E3B\u529B Agent \u4E0D\u80FD\u5173\u6389\uFF1B\u5148\u628A\u4E3B\u529B\u6362\u6389");
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
      if (!["starting", "running", "needs-approval"].includes(job.state)) continue;
      if (job.sessionId && seen.has(job.sessionId)) continue;
      if (!job.sessionId && seen.has(job.id)) continue;
      const sid = job.sessionId || job.id;
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
      const cur = bySid.get(sid);
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
  lineMap(path5, doc) {
    const cached = this._lineMaps[path5];
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
    this._lineMaps[path5] = { doc, map };
    return map;
  }
  jobAtLine(path5, line, text) {
    const jobs = Object.values(this.jobs).filter((j) => j.path === path5);
    let best = null;
    for (const j of jobs) {
      if (j.lineText === text || j.line === line && j.lineText === text) best = j;
    }
    return best;
  }
  // ---------- editor actions ----------
  activeEditor() {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian5.MarkdownView);
    if (!view || !view.file) return null;
    return { view, editor: view.editor, file: view.file };
  }
  async delegateFromEditor(editor, agent) {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian5.MarkdownView);
    if (!view || !view.file) return this.notice("\u5148\u6253\u5F00\u4E00\u7BC7\u7B14\u8BB0");
    const line = editor.getCursor().line;
    try {
      await this.delegator.delegate({ file: view.file, lines: editor.getValue().split("\n"), line, agent: agent || this.defaultTarget() });
    } catch (e) {
      this.notice(String(e.message || e), 8e3);
    }
  }
  async delegateAtLine(path5, line) {
    const file = this.app.vault.getAbstractFileByPath(path5);
    if (!file) return this.notice("\u627E\u4E0D\u5230\u8FD9\u7BC7\u7B14\u8BB0");
    const view = this.app.workspace.getActiveViewOfType(import_obsidian5.MarkdownView);
    const lines = view && view.file && view.file.path === path5 ? view.editor.getValue().split("\n") : (await this.app.vault.read(file)).split("\n");
    await this.delegator.delegate({ file, lines, line, agent: this.defaultTarget() });
  }
  openDelegateModal(path5, line) {
    new DelegateOptionsModal(this.app, this, path5, line).open();
  }
  openModalFor(editor, view) {
    if (!view || !view.file) return this.notice("\u5148\u6253\u5F00\u4E00\u7BC7\u7B14\u8BB0");
    this.openDelegateModal(view.file.path, editor.getCursor().line);
  }
  openSessionForEditor(editor, view) {
    if (!view || !view.file) return;
    const path5 = view.file.path, line = editor.getCursor().line;
    const map = this.lineMap(path5, editor.cm.state.doc);
    let s = map.sessionByParent.get(line);
    if (!s) {
      const text = editor.getLine(line);
      const job = this.jobAtLine(path5, line, text);
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
      const where = agent === "claude" ? s.app === "cli" ? "\u7EC8\u7AEF" : "\u684C\u9762\u7248" : agent === "codex" ? s.app === "desktop" ? "\u684C\u9762\u7248" : "CLI" : agent === "workbuddy" ? "\u684C\u9762\u7248" : "Harness";
      const url = sessionDeepLink(agent, s.sid);
      seen.add(s.sid);
      out.push({
        id: `${agent}:${s.sid}`,
        agent,
        agentName: a.name,
        agentShort: a.short,
        color: a.color,
        glyph: a.glyph,
        title: truncate(s.title || (s.text || "").split(" / ")[0] || s.step || s.sid, 64),
        detail: `${a.short} ${where} \xB7 ${projectName(s.cwd)}${s.step ? " \xB7 " + truncate(s.step, 32) : ""} \xB7 ${timeAgo(s.lastAt)}`,
        project: projectName(s.cwd),
        step: s.step ? truncate(s.step, 40) : "",
        ago: timeAgo(s.lastAt),
        keyword: kw.id,
        keywordLabel: kw.zh,
        state,
        stateLabel: menuStateLabel(state),
        primary: !!primary,
        url: agent === "dsh" ? "dsh://open" : url,
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
    const p = import_path4.default.join(this.vaultPath, ".obsidian/plugins/nautilus-spiral/data.json");
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
    const p = import_path4.default.join(this.vaultPath, ".obsidian/plugins/nautilus-spiral/data.json");
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
      new import_obsidian5.Notice(msg, ms);
    } catch {
      console.log("[agent-deck]", msg);
    }
  }
  openExternal(url) {
    return openExternal(url);
  }
  async readNote(path5) {
    const file = this.app.vault.getAbstractFileByPath(path5);
    if (!file) throw new Error("\u627E\u4E0D\u5230\u7B14\u8BB0\uFF1A" + path5);
    return await this.app.vault.read(file);
  }
  async writeNote(path5, text) {
    const view = this.app.workspace.getActiveViewOfType(import_obsidian5.MarkdownView);
    if (view && view.file && view.file.path === path5) {
      const ed = view.editor;
      const line = clamp(ed.getCursor().line, 0, Math.max(0, ed.lineCount() - 1));
      ed.setValue(text);
      try {
        ed.setCursor({ line: Math.min(line, ed.lineCount() - 1), ch: 0 });
      } catch {
      }
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(path5);
    if (!file) throw new Error("\u627E\u4E0D\u5230\u7B14\u8BB0\uFF1A" + path5);
    await this.app.vault.process(file, () => text);
  }
  async checkBinary(kind) {
    const bin = kind === "dsh" ? findDshBinary() : findClaudeBinary(this.settings.delegate?.claude?.path || "");
    return await new Promise((resolve) => {
      (0, import_child_process3.execFile)(bin, ["--version"], { timeout: 1e4, env: process.env }, (err2, out, errOut) => {
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
      (0, import_child_process3.execFile)("/usr/bin/osascript", ["-e", script], () => {
      });
    } catch (e) {
      this.notice(String(e.message || e));
    }
  }
  async pauseNautilus() {
    const p = import_path4.default.join(this.vaultPath, ".obsidian/plugins/nautilus-spiral/data.json");
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
    data.showAi = false;
    data.autoLog = false;
    data.autoLogArchiveDone = false;
    data.agentKw = false;
    data.agentStatus = false;
    data.agentAlert = false;
    data.resultBack = false;
    data.lineProgress = false;
    try {
      await fsp4.writeFile(p, JSON.stringify(data, null, 1), "utf8");
    } catch (e) {
      this.notice("\u5199\u5165\u87BA\u65CB\u65E5\u7A0B\u8BBE\u7F6E\u5931\u8D25\uFF1A" + (e && e.message || e));
      return;
    }
    this.notice(`\u5DF2\u505C\u7528\u87BA\u65CB\u65E5\u7A0B\u7684 AI \u8FFD\u8E2A\uFF08\u539F\u8BBE\u7F6E\u5907\u4EFD\u5728 ${import_path4.default.basename(backup)}\uFF09\u3002\u91CD\u65B0\u52A0\u8F7D\u87BA\u65CB\u65E5\u7A0B\u6216\u91CD\u542F Obsidian \u540E\u751F\u6548\u3002`, 1e4);
    try {
      if (this.app.plugins && this.app.plugins.disablePlugin && this.app.plugins.enablePlugin) {
        await this.app.plugins.disablePlugin("nautilus-spiral");
        await this.app.plugins.enablePlugin("nautilus-spiral");
      }
    } catch {
    }
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
