// Per-task aggregate metrics across multiple turns and multiple agents.
//
// Combines token usage and wall-clock active minutes (via unionSegs per day so
// concurrent multi-agent sessions never double-count time, and missing data is
// never estimated) for all sessions bound to a single Markdown task block.

import { AGENTS, fmtDur, fmtTok, unionSegs } from "./constants.js";
import { t } from "./i18n.js";

const AI_IDLE = 5;

function tsToSegs(tsList) {
  if (!Array.isArray(tsList) || !tsList.length) return [];
  const sorted = [...tsList].filter((n) => typeof n === "number" && Number.isFinite(n)).sort((a, b) => a - b);
  if (!sorted.length) return [];
  const segs = [];
  let a = sorted[0], b = a + 1;
  for (let i = 1; i < sorted.length; i++) {
    const t = sorted[i];
    if (t - b <= AI_IDLE) b = Math.max(b, t);
    else { segs.push([a, b]); a = t; b = t + 1; }
  }
  segs.push([a, b]);
  return segs;
}

function sumDaySegs(segsByDay) {
  let total = 0;
  for (const segs of segsByDay.values()) {
    if (!segs.length) continue;
    for (const [a, b] of unionSegs(segs)) {
      if (b > a) total += b - a;
    }
  }
  return Math.round(total);
}

/**
 * Compute aggregate token usage and de-duplicated active duration for a task's bound sessions.
 * @param {Array<{sid: string, agent?: string}>} linkedSessions
 * @param {{ meta?: Map, files?: Map }} usage
 */
export function computeTaskMetrics(linkedSessions = [], usage = null) {
  const unique = new Map();
  for (const item of linkedSessions || []) {
    const sid = String(item?.sid || "").trim();
    if (!sid || unique.has(sid)) continue;
    unique.set(sid, String(item?.agent || "").trim());
  }
  if (!unique.size) {
    return {
      sessionCount: 0,
      out: 0,
      fresh: 0,
      cached: 0,
      tokens: 0,
      totalTokens: 0,
      activeMin: 0,
      turns: 0,
      agents: [],
    };
  }

  const metaMap = usage?.meta;
  const files = usage?.files ? [...usage.files.values()] : [];
  const filesBySid = new Map();
  for (const f of files) {
    if (!f || !f.sid || f.sub || !unique.has(f.sid)) continue;
    let list = filesBySid.get(f.sid);
    if (!list) filesBySid.set(f.sid, list = []);
    list.push(f);
  }

  let out = 0;
  let fresh = 0;
  let cached = 0;
  let turns = 0;
  const allSegsByDay = new Map();
  const byAgent = new Map();

  for (const [sid, hintAgent] of unique) {
    const meta = metaMap?.get?.(sid) || {};
    const agent = hintAgent || meta.agent || "claude";
    const sOut = Number(meta.out) || 0;
    const sFresh = Number(meta.fresh) || 0;
    const sCached = Number(meta.cached) || 0;
    const sTurns = Number(meta.turns) || (Array.isArray(meta.rounds) ? meta.rounds.length : 0);

    out += sOut;
    fresh += sFresh;
    cached += sCached;
    turns += sTurns;

    let bucket = byAgent.get(agent);
    if (!bucket) {
      bucket = { agent, sessions: 0, out: 0, fresh: 0, cached: 0, segsByDay: new Map() };
      byAgent.set(agent, bucket);
    }
    bucket.sessions++;
    bucket.out += sOut;
    bucket.fresh += sFresh;
    bucket.cached += sCached;

    for (const f of filesBySid.get(sid) || []) {
      for (const [dayKey, day] of f.days || []) {
        const s = day?.sess?.get?.(sid);
        const segs = Array.isArray(s?.segs) && s.segs.length ? s.segs : tsToSegs(s?.ts);
        if (!segs.length) continue;
        let allDay = allSegsByDay.get(dayKey);
        if (!allDay) allSegsByDay.set(dayKey, allDay = []);
        allDay.push(...segs);
        let agDay = bucket.segsByDay.get(dayKey);
        if (!agDay) bucket.segsByDay.set(dayKey, agDay = []);
        agDay.push(...segs);
      }
    }
  }

  const agents = [...byAgent.values()]
    .map((b) => ({
      agent: b.agent,
      sessions: b.sessions,
      out: b.out,
      fresh: b.fresh,
      cached: b.cached,
      tokens: b.out + b.fresh,
      activeMin: sumDaySegs(b.segsByDay),
    }))
    .sort((a, b) => (b.tokens - a.tokens) || (b.activeMin - a.activeMin));

  const tokens = out + fresh;
  return {
    sessionCount: unique.size,
    out,
    fresh,
    cached,
    tokens,
    totalTokens: tokens + cached,
    activeMin: sumDaySegs(allSegsByDay),
    turns,
    agents,
  };
}

/**
 * Format a concise tooltip summarizing per-task multi-session / multi-agent cost and duration.
 */
export function formatTaskMetricsTooltip(metrics) {
  if (!metrics || !metrics.sessionCount) return "";
  const parts = [];
  if (metrics.sessionCount > 1) parts.push(t("{n} 个会话", { n: metrics.sessionCount }));
  if (metrics.tokens || metrics.cached) {
    const detail = [];
    if (metrics.out) detail.push(`${t("输出")} ${fmtTok(metrics.out)}`);
    if (metrics.fresh) detail.push(`${t("新输入")} ${fmtTok(metrics.fresh)}`);
    if (metrics.cached) detail.push(`${t("缓存")} ${fmtTok(metrics.cached)}`);
    parts.push(`${fmtTok(metrics.tokens)} tok${detail.length ? `（${detail.join(" / ")}）` : ""}`);
  }
  if (metrics.activeMin > 0) parts.push(`${t("活跃")} ${fmtDur(metrics.activeMin * 60000)}`);
  const head = parts.join(" · ");
  if (metrics.agents.length <= 1) return head;
  const breakdown = metrics.agents
    .map((a) => {
      const name = AGENTS[a.agent]?.short || a.agent;
      const segs = [];
      if (a.tokens) segs.push(`${fmtTok(a.tokens)} tok`);
      if (a.activeMin > 0) segs.push(fmtDur(a.activeMin * 60000));
      return `${name}: ${segs.join(" · ") || t("{n} 个会话", { n: a.sessions })}`;
    })
    .join(" · ");
  return head ? `${head}\n${breakdown}` : breakdown;
}
