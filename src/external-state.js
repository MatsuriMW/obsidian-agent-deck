import fsp from "fs/promises";
import os from "os";
import pathMod from "path";
import { execFile } from "child_process";
import * as J from "./journal.js";
import { AGENTS, dayKey, dayKeyToday, dayMinute, fmtMin, fmtTok, pad, truncate } from "./constants.js";
import { t } from "./i18n.js";

export const AI_IDLE_MIN = 5;
export const TOK_BLOCK_MAX = 30;
export const AGENT_LINE_RE = /^\s*(?:[-*+]|\d+[.)])\s+(?:\*\*\d{1,2}[:：]\d{2}\*\*\s*)?(?:\[\/\]\s|(?:DOING|NOW|IN-PROGRESS|TOREVIEW|HITLIMIT|NEEDOK|QUEUED|ERRORED|DELEGATED)(?=\s|$))/;
export const RESULT_LINE_RE = /^\s*[-*+]\s+💬/;
export const SUB_LINE_RE = /^\s*[-*+]\s+🤖\s*(?:子代理|side chat)/;

const PROG_END = String.raw`(?=$|[\s，,。；;)）])`;
const PROG_PCT_RE = new RegExp(String.raw`(?:^|\s)(\d{1,3})\s*[%％]` + PROG_END);
const PROG_FRAC_RE = new RegExp(String.raw`(?:^|\s)(\d{1,2})\s*\/\s*(\d{1,2})` + PROG_END);
const PROG_CN_RE = /([一二两三四五六七八九十\d]+)分之([一二两三四五六七八九十\d]+)/;
const PROG_HALF_RE = new RegExp(String.raw`(?:^|\s)(?:做了|完成了?)?一半` + PROG_END);
const CN_DIGIT = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

const RANGE_START_RE = /\b(\d{1,2})[:：](\d{2})\s*[-–~～到至]/;
const STAMP_START_RE = /^\s*(?:[-*+]|\d+[.)])\s+\*\*(\d{1,2})[:：](\d{2})\*\*/;
const EST_DUR_RE = /(?<![\d.])(\d+(?:\.\d+)?)\s*(h|hr|hrs|小时|个小时|m|min|mins|分钟)(?![a-zA-Z])/;

function psElapsedSeconds(text) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(String(text || "").trim());
  if (!m) return Infinity;
  return ((+m[1] || 0) * 24 + (+m[2] || 0)) * 3600 + +m[3] * 60 + +m[4];
}

function readProcessList() {
  return new Promise((resolve) => {
    execFile("/bin/ps", ["-A", "-o", "pid=,ppid=,etime=,args="], { maxBuffer: 16e6 }, (err, stdout) => {
      resolve(err ? "" : String(stdout || ""));
    });
  });
}

// Read ~/.local/state/agent-wait/*.json written by external Claude Code hooks.
// Mark entries as released once the parent pid spawns a shell-snapshot command
// after the prompt timestamp so long-running approved commands do not re-alert.
export async function scanAgentWait({
  dir = pathMod.join(os.homedir(), ".local", "state", "agent-wait"),
  prev = new Map(),
  psText = null,
  now = Date.now(),
} = {}) {
  const out = new Map();
  let names = [];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const d = JSON.parse(await fsp.readFile(pathMod.join(dir, name), "utf8"));
      if (d && d.sid && d.at) out.set(d.sid, d);
    } catch { /* partial write */ }
  }
  for (const [sid, d] of out) {
    const was = prev?.get(sid);
    if (was && was.at === d.at && was.released) d.released = true;
  }
  const open = [...out.values()].filter((d) => d.pid && !d.released);
  if (!open.length) return out;
  const ps = psText !== null ? psText : await readProcessList();
  for (const line of String(ps || "").split("\n")) {
    const m = /^\s*\d+\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m || !m[3].includes("shell-snapshots/snapshot-")) continue;
    const ppid = +m[1];
    const startedAt = now - psElapsedSeconds(m[2]) * 1000;
    for (const d of open) {
      if (ppid === d.pid && startedAt >= d.at - 1000) d.released = true;
    }
  }
  return out;
}

// Read ~/.local/state/limit-resume/queue.json to distinguish queued vs waiting-on-limit sessions.
export async function scanLimitQueue({
  file = pathMod.join(os.homedir(), ".local", "state", "limit-resume", "queue.json"),
} = {}) {
  const out = new Map();
  try {
    const list = JSON.parse(await fsp.readFile(file, "utf8"));
    for (const item of Array.isArray(list) ? list : []) {
      if (item && item.session_id && !item.running) out.set(item.session_id, item);
    }
  } catch { /* absent or mid-write */ }
  return out;
}

export function resolveExternalState({ baseState, lastAt = 0, archived = false, resets = 0, perm = null, queue = null, now = Date.now() }) {
  if (baseState === "error") return { state: "error" };
  if (baseState === "limit") {
    if (queue) return { state: "queued", queueResetAt: queue.reset_at || 0 };
    if (resets && now > resets) return { state: "wait" };
    return { state: "limit" };
  }
  if (!archived && perm && !perm.released && baseState !== "wait" && (lastAt || 0) <= perm.at + 1500) {
    return { state: "needs-approval", permTool: perm.tool || "" };
  }
  return { state: baseState || "idle" };
}

export function parseTaskProgress(raw) {
  const s = String(raw || "");
  let m;
  if ((m = PROG_PCT_RE.exec(s)) && +m[1] <= 100) return +m[1] / 100;
  if ((m = PROG_FRAC_RE.exec(s)) && +m[2] > 0 && +m[2] <= 10 && +m[1] <= +m[2]) return +m[1] / +m[2];
  if ((m = PROG_CN_RE.exec(s))) {
    const denom = CN_DIGIT[m[1]] ?? +m[1];
    const num = CN_DIGIT[m[2]] ?? +m[2];
    if (denom > 0 && num <= denom) return num / denom;
  }
  if (PROG_HALF_RE.test(s)) return 0.5;
  return null;
}

function parseEstimatedDuration(raw, cfg, nowMs = Date.now()) {
  const s = J.stripBlockId(String(raw || ""));
  const durM = EST_DUR_RE.exec(s);
  const clockM = STAMP_START_RE.exec(s) || RANGE_START_RE.exec(s);
  if (!durM || !clockM) return null;
  const val = Number(durM[1]);
  const unit = durM[2].toLowerCase();
  const durMin = unit.startsWith("h") || unit.includes("小") ? Math.round(val * 60) : Math.round(val);
  if (!(durMin > 0)) return null;
  const cutoff = Number.isFinite(cfg?.dayCutoff) ? cfg.dayCutoff : 0;
  const toDayMin = (h, min) => ((h * 60 + min - cutoff * 60) % 1440 + 1440) % 1440;
  const startedAt = toDayMin(+clockM[1], +clockM[2]);
  const nowMin = dayMinute(nowMs, cfg);
  if (nowMin < startedAt) return null;
  const spent = nowMin - startedAt;
  return {
    pct: Math.min(1, spent / durMin),
    lead: spent > durMin
      ? t("{spent} / {est} · 超 {over}", { spent: fmtMin(spent), est: fmtMin(durMin), over: fmtMin(spent - durMin) })
      : `${fmtMin(spent)} / ${fmtMin(durMin)}`,
  };
}

function fmtClockHm(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtResetClock(ms) {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay ? fmtClockHm(ms) : `${d.getMonth() + 1}/${d.getDate()} ${fmtClockHm(ms)}`;
}

function kidStatusSummary(plugin, sid, lv, now = Date.now()) {
  const subs = plugin.usage?.subsOf?.(sid) || [];
  if (!subs.length) return "";
  const today = dayKeyToday(plugin.settings);
  const parentWait = !lv || lv.state !== "run";
  let run = 0;
  let done = 0;
  let fail = 0;
  for (const r of subs) {
    if (dayKey(r.start, plugin.settings) !== today) continue;
    if (r.state === "done") done++;
    else if (r.state === "fail" || (!r.bg && parentWait && (now - r.at) / 60e3 > AI_IDLE_MIN)) fail++;
    else if ((now - r.at) / 60e3 <= AI_IDLE_MIN) run++;
  }
  const bits = [];
  if (run) bits.push(t("{n} 跑", { n: run }));
  if (done) bits.push(t("{n} 完", { n: done }));
  if (fail) bits.push(t("{n} 停", { n: fail }));
  return bits.length ? `🤖 ${bits.join(" ")}` : "";
}

function childSubBlockProgress(plugin, kid, now = Date.now()) {
  if (kid.kind === "side") {
    return {
      pct: null,
      mode: "wait",
      agent: "claude",
      sid: "",
      tail: t("side chat · 开着"),
      tok: 0,
      tip: t("Claude 桌面版 side chat"),
    };
  }
  let sub = null;
  let parent = "";
  for (const [sid, m] of plugin.usage?.subs || new Map()) {
    for (const x of m.values()) {
      if (String(x.id || "").startsWith(kid.id)) { sub = x; parent = sid; break; }
    }
    if (sub) break;
  }
  if (!sub) {
    return {
      pct: null,
      mode: "wait",
      agent: "claude",
      sid: "",
      tail: t("子代理 · 还没读到日志"),
      tok: 0,
      tip: "",
    };
  }
  const meta = plugin.usage?.meta?.get(parent);
  const parentWait = !meta || meta.state !== "run";
  const quiet = (now - sub.at) / 60e3;
  let st = "quiet";
  let word = t("{dur} 没动静", { dur: fmtMin(Math.round(quiet)) });
  if (sub.state === "done") { st = "done"; word = t("跑完"); }
  else if (sub.state === "fail") { st = "fail"; word = sub.end === "failed" ? t("出错") : t("停了"); }
  else if (quiet <= AI_IDLE_MIN) { st = "run"; word = t("在跑"); }
  else if (!sub.bg && parentWait) { st = "fail"; word = t("停了"); }
  const tok = [...(sub.tok?.values?.() || [])].reduce((n, v) => n + v, 0);
  return {
    pct: null,
    mode: st === "run" ? "run" : "wait",
    agent: "claude",
    sid: parent,
    tail: [t("子代理"), word, st === "run" ? sub.step : ""].filter(Boolean).join(" · "),
    tok,
    tip: `${sub.desc || "subagent"} (${sub.type || "subagent"}${sub.bg ? ", background" : ""})`,
  };
}

export function buildLineProgressInfo(plugin, rawLine, lines, lineIndex, session = null, job = null, now = Date.now()) {
  if (!AGENT_LINE_RE.test(rawLine)) return null;
  const kid = lines ? J.kidUnder(lines, lineIndex) : null;
  if (kid) return childSubBlockProgress(plugin, kid, now);

  const manualPct = parseTaskProgress(rawLine);
  const est = manualPct == null ? parseEstimatedDuration(rawLine, plugin.settings, now) : null;
  const sid = session?.sid || job?.sessionId || "";
  const archived = !!(sid && plugin.usage?.hidden?.(sid));
  const active = Boolean(session || job);
  if (manualPct == null && !est && !active) return null;

  const meta = (sid && plugin.usage?.meta?.get(sid)) || session || {};
  const enriched = sid && plugin.applyExternalState ? plugin.applyExternalState({ ...meta, ...session, sid }) : (session || meta);
  const jobActive = job && ["starting", "running", "needs-approval"].includes(job.state);
  const state = jobActive ? (job.state === "starting" ? "starting" : job.state === "needs-approval" ? "needs-approval" : "run") : (enriched.state || "idle");
  const agent = job?.agent || session?.agent || enriched.agent || "claude";
  const todo = session?.todo || meta.todo;
  const turns = session?.turns || meta.turns || 0;

  let pct = null;
  let lead = "";
  let mode = "wait";
  if (archived) {
    pct = 1;
  } else if (manualPct != null) {
    pct = manualPct;
  } else if (todo && todo.total > 0) {
    pct = Math.max(0, Math.min(1, todo.done / todo.total));
    lead = t("{done}/{total} 步", { done: todo.done, total: todo.total }) + (turns > 0 ? ` · ${t("第 {turns} 轮", { turns })}` : "");
  } else if (turns > 0) {
    lead = t("第 {turns} 轮", { turns });
  } else if (est) {
    pct = est.pct;
    lead = est.lead;
  }

  const parts = lead ? [lead] : [];
  if (active) {
    const lastAt = enriched.lastAt || job?.endedAt || job?.startedAt || 0;
    const quiet = lastAt ? Math.max(0, Math.round((now - lastAt) / 60e3)) : 0;
    let stateText = "";
    if (archived) {
      stateText = t("已归档");
    } else if (state === "starting") {
      stateText = t("正在建立会话");
      mode = "run";
    } else if (state === "needs-approval") {
      stateText = enriched.permTool ? t("等你允许 · {tool}", { tool: enriched.permTool }) : t("等你允许");
    } else if (state === "queued") {
      stateText = enriched.queueResetAt
        ? t("排队续跑 · {time}", { time: fmtClockHm(enriched.queueResetAt * 1000) })
        : t("排队续跑");
    } else if (state === "limit") {
      stateText = enriched.resets && now > enriched.resets
        ? t("额度已恢复，等你继续")
        : (enriched.resets ? t("撞限额 · {time} 恢复", { time: fmtResetClock(enriched.resets) }) : t("撞限额"));
    } else if (state === "error") {
      const errMsg = truncate(job?.error || enriched.err || "", 24);
      stateText = errMsg ? t("报错停了 · {error}", { error: errMsg }) : t("报错停了");
    } else if (state === "wait") {
      stateText = t("等你回复");
    } else if (state === "run" || state === "running") {
      if (jobActive || quiet <= AI_IDLE_MIN) {
        stateText = t("在跑");
        mode = "run";
      } else {
        stateText = t("{dur} 没动静", { dur: fmtMin(quiet) });
      }
    } else if (state === "quiet") {
      stateText = t("{dur} 没动静", { dur: fmtMin(quiet || AI_IDLE_MIN) });
    }
    if (stateText) parts.push(stateText);
    const step = !archived && mode === "run" ? ((todo && todo.cur) || enriched.step || job?.step || "") : "";
    if (step) parts.push(truncate(step, 36));
    if (!archived && sid) {
      const kidSum = kidStatusSummary(plugin, sid, enriched, now);
      if (kidSum) parts.push(kidSum);
    }
  }

  const tok = session?.tokens ?? job?.tokens ?? ((meta.out || 0) + (meta.fresh || 0));
  const agentName = AGENTS[agent]?.name || agent;
  const tipParts = [
    archived ? t("这个会话归档了")
      : manualPct != null ? t("进度来自当前任务行")
      : (todo && todo.total > 0) ? t("进度按会话待办计算")
      : est ? t("进度按预估时长计算")
      : t("会话暂无步骤总数"),
    sid ? `${agentName} · ${session?.title || meta.title || sid.slice(0, 8)}` : "",
    tok ? t("{tok} tok：实心的一个 100 万，空心的一个 10 万", { tok: fmtTok(tok) }) : "",
  ].filter(Boolean);

  return {
    pct,
    mode: pct != null ? "bar" : mode,
    agent,
    sid,
    jobId: job?.id || "",
    tail: parts.join(" · "),
    tok,
    tip: tipParts.join("\n"),
  };
}
