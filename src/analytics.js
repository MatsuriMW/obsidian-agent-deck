// Dashboard calculations use saved day buckets, never lifetime session totals.
import { unionSegs } from "./constants.js";
import * as J from "./journal.js";
import { LIST_RE, fencedLines, ownersOf, subtreeEnd } from "./outline.js";

export function calendarDays(from, to) {
  const days = [];
  const [y, m, d] = from.split("-").map(Number);
  const date = new Date(y, m - 1, d, 12);
  for (let key = from; key <= to; date.setDate(date.getDate() + 1), key = dateKey(date)) days.push(key);
  return days;
}
export function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export const isoDay = key => String(key).replace(/^(\d{4})\D(\d{2})\D(\d{2})$/, "$1-$2-$3");
export function dayFromNotePath(path = "") {
  const m = /(\d{4})[-_/](\d{2})[-_/](\d{2})/.exec(String(path || ""));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}
export function shiftDay(key, n) {
  const [y, m, d] = key.split("-").map(Number);
  return dateKey(new Date(y, m - 1, d + n, 12));
}
export function heatLevel(tokens, max) {
  return tokens > 0 ? Math.max(1, Math.min(4, Math.ceil(4 * Math.sqrt(tokens / Math.max(1, max))))) : 0;
}

export function journalSources(text, path, { autoState = null } = {}) {
  const lines = text.split("\n"), fenced = fencedLines(lines), owners = ownersOf(lines, fenced), out = [];
  const seen = new Set();
  const collectBlock = (owner) => {
    const parents = [];
    for (let p = owners[owner]; p >= 0; p = owners[p]) parents.unshift(lines[p]);
    const end = subtreeEnd(lines, owner);
    const own = lines.slice(owner, end).filter((_, n) => !fenced.has(owner + n) && (n === 0 || owners[owner + n] === owner));
    return { path, line: owner, blockId: J.blockIdOf(lines[owner]), text: [...parents, ...own].join("\n") };
  };
  for (let i = 0; i < lines.length; i++) {
    if (fenced.has(i)) continue;
    const link = J.parseLink(lines[i]);
    if (!link) continue;
    let owner = owners[i];
    while (owner >= 0 && !J.kwLine(lines[owner])) owner = owners[owner];
    if (owner < 0) continue;
    seen.add(`${link.sid}\0${owner}`);
    out.push({ sid: link.sid, ...collectBlock(owner) });
  }
  if (autoState && typeof autoState === "object") {
    const byBlock = new Map(), byKey = new Map();
    const normKey = (v) => J.workKey(String(v || "")).replace(/^🤖\s*/, "").trim();
    const pushMap = (map, k, sid) => { if (k) (map.get(k) || map.set(k, []).get(k)).push(sid); };
    for (const [sid, rec] of Object.entries(autoState)) {
      if (!rec || rec.skip || rec.gone) continue;
      pushMap(byBlock, rec.blockId, sid);
      pushMap(byKey, normKey(rec.key || rec.label), sid);
    }
    for (let i = 0; i < lines.length; i++) {
      if (fenced.has(i) || !LIST_RE.test(lines[i])) continue;
      const kw = J.kwLine(lines[i]);
      if (!kw) continue;
      const id = J.blockIdOf(lines[i]);
      const matched = (id && byBlock.get(id)) || byKey.get(normKey(kw.body)) || [];
      for (const sid of matched) {
        if (seen.has(`${sid}\0${i}`)) continue;
        seen.add(`${sid}\0${i}`);
        out.push({ sid, ...collectBlock(i) });
      }
    }
  }
  return out;
}

const normalized = value => String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
function aliasTest(alias) {
  const key = normalized(alias);
  if (/[\u3400-\u9fff]/.test(alias)) return (_, normalizedText) => normalizedText.includes(key);
  const words = alias.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const pattern = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^\\p{L}\\p{N}]*");
  // Chinese directly around an English project name is a word boundary too.
  const re = new RegExp(`(?:^|[^\\p{Script=Latin}\\p{N}])${pattern}(?=$|[^\\p{Script=Latin}\\p{N}])`, "iu");
  return (text, normalizedText) => normalizedText.includes(key) && re.test(text);
}

export function resolveProjects(rows, pages, overrides = {}) {
  const candidates = pages.map(page => ({ ...page, tests: [...new Set([page.name, ...(page.aliases || [])])].filter(a => /\p{L}/u.test(a) && normalized(a).length >= (/[\u3400-\u9fff]/.test(a) ? 2 : 3)).map(alias => ({ test: aliasTest(alias), length: normalized(alias).length })) }));
  const pageMap = new Map(pages.map(p => [p.path, p]));
  const evidence = rows.map(row => {
    const sources = row.sources || [], text = sources.map(s => s.text || "").join("\n");
    const links = new Set(sources.flatMap(s => s.links || []));
    const title = String(row.title || "").replace(/^\s*(?:[-*+]\s+)?(?:TODO|DOING|DONE|TOREVIEW|PAUSED|DELEGATED)\s+/, "").replace(/[（(]来自 Obsidian[：:][\s\S]*$/, "");
    const titleKey = normalized(title), cwdKey = normalized(row.cwd), textKey = normalized(text);
    const strength = (page, value, key) => {
      let n = 0;
      for (const alias of page.tests) if (alias.length > n && alias.test(value || "", key)) n = alias.length;
      return n;
    };
    return candidates.map(page => {
      if (links.has(page.path)) return [page, 400, 0];
      let n = strength(page, title, titleKey);
      if (n) return [page, 300, n];
      n = strength(page, row.cwd, cwdKey);
      if (n) return [page, 200, n];
      n = strength(page, text, textKey);
      if (n) return [page, 100, n];
      return null;
    }).filter(Boolean);
  });
  const recurring = new Map();
  evidence.forEach((hits, i) => hits.forEach(([page]) => {
    if (!recurring.has(page.path)) recurring.set(page.path, new Set());
    recurring.get(page.path).add(rows[i].sid);
  }));
  return rows.map((row, i) => {
    if (Object.hasOwn(overrides, row.sid)) {
      const project = pageMap.has(overrides[row.sid]) ? overrides[row.sid] : "";
      return { ...row, project, projectName: pageMap.get(project)?.name || "", reason: "manual" };
    }
    const compare = (a, b) => b[1] - a[1] || b[2] - a[2] || (a[1] === 400 ? 0 : recurring.get(b[0].path).size - recurring.get(a[0].path).size);
    const hits = evidence[i].filter(([page, score]) => score > 100 || recurring.get(page.path).size >= 2).sort(compare);
    const hit = hits[0] && (!hits[1] || compare(hits[0], hits[1]) !== 0) ? hits[0] : null;
    return { ...row, project: hit?.[0].path || "", projectName: hit?.[0].name || "", reason: hit ? ({ 400: "link", 300: "title", 200: "cwd", 100: "keyword" })[hit[1]] : "unknown" };
  });
}

const number = n => Math.max(0, Number(n) || 0);
const minutes = segs => unionSegs(segs).reduce((n, [a, b]) => n + b - a, 0);

function parseAggregateOptions(projectOrOpts) {
  if (projectOrOpts && typeof projectOrOpts === "object") {
    return {
      project: projectOrOpts.project ?? null,
      agent: projectOrOpts.agent ?? null,
      model: projectOrOpts.model ?? null,
      dayCutoff: Number.isFinite(Number(projectOrOpts.dayCutoff)) ? Number(projectOrOpts.dayCutoff) : 0,
      onlyJournaled: Boolean(projectOrOpts.onlyJournaled),
      onlyUnclassified: Boolean(projectOrOpts.onlyUnclassified),
      query: String(projectOrOpts.query || "").trim().toLowerCase(),
      sortBy: ["day", "tokens", "wall"].includes(projectOrOpts.sortBy) ? projectOrOpts.sortBy : "day",
      projectSortBy: ["tokens", "wall", "sessions", "name"].includes(projectOrOpts.projectSortBy) ? projectOrOpts.projectSortBy : "tokens",
      projectSortDir: projectOrOpts.projectSortDir === "asc" ? "asc" : "desc",
    };
  }
  return {
    project: projectOrOpts ?? null,
    agent: null,
    model: null,
    dayCutoff: 0,
    onlyJournaled: false,
    onlyUnclassified: false,
    query: "",
    sortBy: "day",
    projectSortBy: "tokens",
    projectSortDir: "desc",
  };
}

function compareProjects(a, b, sortBy, sortDir) {
  const dir = sortDir === "asc" ? 1 : -1;
  if (sortBy === "name") {
    const aEmpty = a.name ? 0 : 1;
    const bEmpty = b.name ? 0 : 1;
    if (aEmpty !== bEmpty) return aEmpty - bEmpty;
    const cmp = String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true, sensitivity: "base" });
    if (cmp !== 0) return cmp * dir;
    return b.tokens - a.tokens || b.wall - a.wall;
  }
  const primary = sortBy === "wall"
    ? a.wall - b.wall
    : sortBy === "sessions"
      ? a.sessions - b.sessions
      : a.tokens - b.tokens;
  if (primary !== 0) return primary * dir;
  return (b.tokens - a.tokens) || (b.wall - a.wall) || String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true, sensitivity: "base" });
}

function clipSegmentToClockHours(a, b, cutoffMinutes) {
  const out = [];
  let cur = a + cutoffMinutes, end = b + cutoffMinutes;
  while (cur < end) {
    const hourAbs = Math.floor(cur / 60);
    const nextBound = Math.min(end, (hourAbs + 1) * 60);
    const h = ((hourAbs % 24) + 24) % 24;
    const m0 = ((cur % 60) + 60) % 60;
    const m1 = m0 + (nextBound - cur);
    out.push([h, m0, m1]);
    cur = nextBound;
  }
  return out;
}

function summarizeHourlyRhythm(dayEvents) {
  const hours = Array.from({ length: 24 }, (_, hour) => {
    const start = String(hour).padStart(2, "0");
    const end = String((hour + 1) % 24).padStart(2, "0");
    return {
      hour,
      label: start,
      range: `${start}:00–${end}:00`,
      minutes: 0,
      concurrentMinutes: 0,
      maxConcurrent: 0,
      sessions: 0,
    };
  });
  for (const perHour of dayEvents.values()) {
    for (let h = 0; h < 24; h++) {
      const slot = perHour[h];
      if (!slot) continue;
      slot.events.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
      let active = 0, prev = 0, deduped = 0, concurrent = 0, peak = 0;
      for (const [pos, delta] of slot.events) {
        if (pos > prev && active > 0) {
          const dx = pos - prev;
          deduped += dx;
          if (active >= 2) concurrent += dx;
          if (active > peak) peak = active;
        }
        active += delta;
        prev = pos;
      }
      hours[h].minutes += deduped;
      hours[h].concurrentMinutes += concurrent;
      if (peak > hours[h].maxConcurrent) hours[h].maxConcurrent = peak;
      hours[h].sessions += slot.rows;
    }
  }
  let peakHour = null, concurrentMinutes = 0, maxConcurrent = 0;
  for (const h of hours) {
    h.minutes = Math.round(h.minutes);
    h.concurrentMinutes = Math.round(h.concurrentMinutes);
    concurrentMinutes += h.concurrentMinutes;
    if (h.maxConcurrent > maxConcurrent) maxConcurrent = h.maxConcurrent;
    if (h.minutes > 0 && (!peakHour || h.minutes > peakHour.minutes)) peakHour = h;
  }
  return { hours, peakHour, concurrentMinutes, maxConcurrent };
}

function rowMatchesQuery(row, query) {
  if (!query) return true;
  if (String(row.title || "").toLowerCase().includes(query)) return true;
  if (String(row.projectName || "").toLowerCase().includes(query)) return true;
  if (String(row.agent || "").toLowerCase().includes(query)) return true;
  if (String(row.model || "").toLowerCase().includes(query)) return true;
  return (row.sources || []).some(s => String(s.text || "").toLowerCase().includes(query) || String(s.path || "").toLowerCase().includes(query));
}

export function aggregateDashboard(rows, from, to, projectOrOpts = null) {
  const opts = parseAggregateOptions(projectOrOpts);
  const cutoffMinutes = (((opts.dayCutoff % 24) + 24) % 24) * 60;
  const result = {
    tokens: 0,
    out: 0,
    fresh: 0,
    cached: 0,
    wall: 0,
    sessions: 0,
    activeDays: 0,
    turns: 0,
    journalLinked: 0,
    unclassifiedCount: 0,
    cacheHitRate: null,
    avgDailyTokens: 0,
    avgDailyWall: 0,
    peakDay: null,
    peakHour: null,
    concurrentMinutes: 0,
    maxConcurrent: 0,
    missingTokens: 0,
    missingSpans: 0,
    days: {},
    hours: [],
    projects: [],
    agents: [],
    models: [],
    rows: [],
  };
  const seen = new Set(), projects = new Map(), agents = new Map(), models = new Map(), sessions = new Set();
  const dayHourEvents = new Map();
  for (const row of rows) {
    if (row.day < from || row.day > to) continue;
    if (opts.project !== null && row.project !== opts.project) continue;
    if (opts.agent !== null && (row.agent || "") !== opts.agent) continue;
    if (opts.model !== null && (row.model || "") !== opts.model) continue;
    if (opts.onlyJournaled && !(row.sources && row.sources.length)) continue;
    if (opts.onlyUnclassified && (row.legacy || row.project)) continue;
    if (!rowMatchesQuery(row, opts.query)) continue;
    const id = `${row.agent}:${row.sid}:${row.day}`;
    if (seen.has(id)) continue;
    seen.add(id); if (!row.legacy) sessions.add(`${row.agent}:${row.sid}`);
    const tokens = number(row.out) + number(row.fresh) + number(row.cached);
    const segs = unionSegs((row.segs || []).filter(s => s.length === 2 && s.every(Number.isFinite) && s[1] > s[0]));
    const hasSources = Boolean(row.sources && row.sources.length);
    const turns = number(row.turns);
    const entry = { ...row, tokens, segs, min: minutes(segs), hasSources, turns };
    result.rows.push(entry);
    const day = (result.days[row.day] ||= { tokens: 0, segs: [], wall: 0 });
    day.tokens += tokens; day.segs.push(...segs);
    if (segs.length) {
      let perHour = dayHourEvents.get(row.day);
      if (!perHour) { perHour = Array(24).fill(null); dayHourEvents.set(row.day, perHour); }
      const touchedHours = new Set();
      for (const [a, b] of segs) {
        for (const [h, m0, m1] of clipSegmentToClockHours(a, b, cutoffMinutes)) {
          const slot = (perHour[h] ||= { events: [], rows: 0 });
          slot.events.push([m0, 1], [m1, -1]);
          touchedHours.add(h);
        }
      }
      for (const h of touchedHours) perHour[h].rows += 1;
    }
    if (!projects.has(row.project)) projects.set(row.project, { path: row.project, name: row.projectName, tokens: 0, wall: 0, sessions: new Set(), agents: new Set(), days: {} });
    const group = projects.get(row.project);
    group.tokens += tokens; if (!row.legacy) group.sessions.add(`${row.agent}:${row.sid}`);
    if (row.agent) group.agents.add(row.agent);
    (group.days[row.day] ||= []).push(...segs);
    if (row.agent) {
      if (!agents.has(row.agent)) agents.set(row.agent, { agent: row.agent, tokens: 0, out: 0, fresh: 0, cached: 0, wall: 0, sessions: new Set(), rows: 0, turns: 0, days: {} });
      const ag = agents.get(row.agent);
      ag.tokens += tokens; ag.out += number(row.out); ag.fresh += number(row.fresh); ag.cached += number(row.cached);
      ag.rows += 1; ag.turns += turns;
      if (!row.legacy) ag.sessions.add(row.sid);
      (ag.days[row.day] ||= []).push(...segs);
    }
    if (!row.legacy) {
      const mKey = String(row.model || "");
      if (!models.has(mKey)) models.set(mKey, { model: mKey, tokens: 0, out: 0, fresh: 0, cached: 0, wall: 0, sessions: new Set(), agents: new Set(), rows: 0, turns: 0, days: {} });
      const md = models.get(mKey);
      md.tokens += tokens; md.out += number(row.out); md.fresh += number(row.fresh); md.cached += number(row.cached);
      md.rows += 1; md.turns += turns;
      md.sessions.add(`${row.agent}:${row.sid}`);
      if (row.agent) md.agents.add(row.agent);
      (md.days[row.day] ||= []).push(...segs);
    }
    result.tokens += tokens; result.out += number(row.out); result.fresh += number(row.fresh); result.cached += number(row.cached);
    result.turns += turns;
    if (hasSources) result.journalLinked++;
    if (!row.legacy && !row.project) result.unclassifiedCount++;
    if (!tokens) result.missingTokens++;
    if (!segs.length) result.missingSpans++;
  }
  for (const [dayKey, day] of Object.entries(result.days)) {
    day.wall = minutes(day.segs);
    result.wall += day.wall;
    if (!result.peakDay || day.tokens > result.peakDay.tokens || (day.tokens === result.peakDay.tokens && (day.wall > result.peakDay.wall || (day.wall === result.peakDay.wall && dayKey > result.peakDay.day)))) {
      result.peakDay = { day: dayKey, tokens: day.tokens, wall: day.wall };
    }
  }
  const rhythm = summarizeHourlyRhythm(dayHourEvents);
  result.hours = rhythm.hours;
  result.peakHour = rhythm.peakHour;
  result.concurrentMinutes = rhythm.concurrentMinutes;
  result.maxConcurrent = rhythm.maxConcurrent;
  result.activeDays = Object.keys(result.days).length;
  result.sessions = sessions.size;
  if (result.fresh + result.cached > 0) result.cacheHitRate = result.cached / (result.fresh + result.cached);
  if (result.activeDays > 0) {
    result.avgDailyTokens = Math.round(result.tokens / result.activeDays);
    result.avgDailyWall = Math.round(result.wall / result.activeDays);
  }
  if (result.peakDay && result.peakDay.tokens === 0 && result.peakDay.wall === 0) result.peakDay = null;
  result.projects = [...projects.values()].map(g => ({
    ...g,
    sessions: g.sessions.size,
    agents: [...g.agents].sort(),
    share: result.tokens > 0 ? g.tokens / result.tokens : 0,
    wall: Object.values(g.days).reduce((n, segs) => n + minutes(segs), 0),
  })).sort((a, b) => compareProjects(a, b, opts.projectSortBy, opts.projectSortDir));
  result.projectsMaxTokens = result.projects.reduce((m, p) => Math.max(m, p.tokens), 0);
  result.agents = [...agents.values()].map(g => ({
    agent: g.agent,
    tokens: g.tokens,
    out: g.out,
    fresh: g.fresh,
    cached: g.cached,
    rows: g.rows,
    turns: g.turns,
    sessions: g.sessions.size,
    share: result.tokens > 0 ? g.tokens / result.tokens : 0,
    wall: Object.values(g.days).reduce((n, segs) => n + minutes(segs), 0),
  })).sort((a, b) => b.tokens - a.tokens || b.wall - a.wall);
  result.models = [...models.values()].map(g => ({
    model: g.model,
    tokens: g.tokens,
    out: g.out,
    fresh: g.fresh,
    cached: g.cached,
    rows: g.rows,
    turns: g.turns,
    sessions: g.sessions.size,
    agents: [...g.agents].sort(),
    cacheHitRate: g.fresh + g.cached > 0 ? g.cached / (g.fresh + g.cached) : null,
    tokensPerTurn: g.turns > 0 ? Math.round(g.tokens / g.turns) : null,
    share: result.tokens > 0 ? g.tokens / result.tokens : 0,
    wall: Object.values(g.days).reduce((n, segs) => n + minutes(segs), 0),
  })).sort((a, b) => Boolean(a.model === "") - Boolean(b.model === "") || b.tokens - a.tokens || b.wall - a.wall);
  result.rows.sort((a, b) => {
    if (opts.sortBy === "tokens") return b.tokens - a.tokens || b.day.localeCompare(a.day) || b.min - a.min;
    if (opts.sortBy === "wall") return b.min - a.min || b.tokens - a.tokens || b.day.localeCompare(a.day);
    return b.day.localeCompare(a.day) || b.tokens - a.tokens;
  });
  return result;
}

export function formatDashboardSummaryMarkdown(data, {
  rangeLabel = "",
  projectName = "",
  agentName = "",
  modelName = "",
  labels = {},
  fmtTokFn = (n) => String(Math.round(Number(n) || 0)),
  fmtMinFn = (n) => `${Math.round(Number(n) || 0)}m`,
  agentLabelFn = (id) => id,
} = {}) {
  const L = {
    title: labels.title || "AI 协作回顾简报",
    range: labels.range || "统计范围",
    project: labels.project || "项目筛选",
    agent: labels.agent || "Agent 筛选",
    model: labels.model || "模型筛选",
    overview: labels.overview || "核心投入",
    tokens: labels.tokens || "总 token",
    wall: labels.wall || "活跃耗时",
    sessions: labels.sessions || "会话数",
    activeDays: labels.activeDays || "活跃天数",
    cacheHit: labels.cacheHit || "缓存读取占比",
    dailyAvg: labels.dailyAvg || "活跃日均",
    peakDay: labels.peakDay || "峰值日",
    peakHour: labels.peakHour || "最活跃时段",
    concurrent: labels.concurrent || "多会话并行",
    journalCoverage: labels.journalCoverage || "日记关联条目",
    agentSection: labels.agentSection || "Agent 分布",
    modelSection: labels.modelSection || "模型分布（Top 10）",
    projectSection: labels.projectSection || "项目投入（Top 10）",
    unclassified: labels.unclassified || "未归类",
    unknownModel: labels.unknownModel || "未记录模型",
    perDay: labels.perDay || "天",
  };
  const lines = [`# ${L.title}`, ""];
  if (rangeLabel) lines.push(`- **${L.range}**：${rangeLabel}`);
  if (projectName) lines.push(`- **${L.project}**：${projectName}`);
  if (agentName) lines.push(`- **${L.agent}**：${agentName}`);
  if (modelName) lines.push(`- **${L.model}**：${modelName}`);
  lines.push(
    "",
    `## ${L.overview}`,
    `- ${L.tokens}：${fmtTokFn(data.tokens)}（${fmtTokFn(data.fresh)} / ${fmtTokFn(data.out)} / ${fmtTokFn(data.cached)}）`,
    `- ${L.wall}：${fmtMinFn(data.wall)}`,
    `- ${L.sessions}：${data.sessions}`,
    `- ${L.activeDays}：${data.activeDays}`,
  );
  if (data.cacheHitRate !== null) lines.push(`- ${L.cacheHit}：${Math.round(data.cacheHitRate * 100)}%`);
  if (data.activeDays > 0) lines.push(`- ${L.dailyAvg}：${fmtTokFn(data.avgDailyTokens)} token/${L.perDay} · ${fmtMinFn(data.avgDailyWall)}/${L.perDay}`);
  if (data.peakDay) lines.push(`- ${L.peakDay}：${data.peakDay.day}（${fmtTokFn(data.peakDay.tokens)} token · ${fmtMinFn(data.peakDay.wall)}）`);
  if (data.peakHour) {
    const range = data.peakHour.range || `${String(data.peakHour.hour).padStart(2, "0")}:00–${String((data.peakHour.hour + 1) % 24).padStart(2, "0")}:00`;
    lines.push(`- ${L.peakHour}：${range}（${fmtMinFn(data.peakHour.minutes)}）`);
  }
  if (data.maxConcurrent >= 2) lines.push(`- ${L.concurrent}：${fmtMinFn(data.concurrentMinutes)}（${data.maxConcurrent}x）`);
  if (data.rows.length) lines.push(`- ${L.journalCoverage}：${data.journalLinked}/${data.rows.length}`);
  if (data.agents?.length) {
    lines.push("", `## ${L.agentSection}`);
    for (const a of data.agents) {
      lines.push(`- **${agentLabelFn(a.agent)}**：${fmtTokFn(a.tokens)}（${Math.round(a.share * 100)}%）· ${fmtMinFn(a.wall)} · ${a.sessions}`);
    }
  }
  if (data.models?.some(m => m.model)) {
    lines.push("", `## ${L.modelSection}`);
    for (const m of data.models.slice(0, 10)) {
      const turnText = m.turns ? ` · ${m.turns}t` : "";
      lines.push(`- **${m.model || L.unknownModel}**：${fmtTokFn(m.tokens)}（${Math.round(m.share * 100)}%）${turnText} · ${fmtMinFn(m.wall)}`);
    }
  }
  if (data.projects?.length) {
    lines.push("", `## ${L.projectSection}`);
    for (const proj of data.projects.slice(0, 10)) {
      lines.push(`- **${proj.name || L.unclassified}**：${fmtTokFn(proj.tokens)}（${Math.round(proj.share * 100)}%）· ${fmtMinFn(proj.wall)} · ${proj.sessions}`);
    }
  }
  return lines.join("\n");
}
