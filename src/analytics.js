// Dashboard calculations use saved day buckets, never lifetime session totals.
import { unionSegs } from "./constants.js";
import * as J from "./journal.js";

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
export function shiftDay(key, n) {
  const [y, m, d] = key.split("-").map(Number);
  return dateKey(new Date(y, m - 1, d + n, 12));
}
export function heatLevel(tokens, max) {
  return tokens > 0 ? Math.max(1, Math.min(4, Math.ceil(4 * Math.sqrt(tokens / Math.max(1, max))))) : 0;
}

export function journalSources(text, path) {
  const lines = text.split("\n"), fenced = J.fencedLines(lines), owners = J.ownersOf(lines.map((line, i) => fenced.has(i) ? "" : line)), out = [];
  for (let i = 0; i < lines.length; i++) {
    if (fenced.has(i)) continue;
    const link = J.parseLink(lines[i]);
    if (!link) continue;
    let owner = owners[i];
    while (owner >= 0 && !J.kwLine(lines[owner])) owner = owners[owner];
    if (owner < 0) continue;
    const parents = [];
    for (let p = owners[owner]; p >= 0; p = owners[p]) parents.unshift(lines[p]);
    let end = owner + 1;
    while (end < lines.length && (!lines[end].trim() || J.width(lines[end]) > J.width(lines[owner]))) end++;
    const own = lines.slice(owner, end).filter((_, n) => !fenced.has(owner + n) && (n === 0 || owners[owner + n] === owner));
    out.push({ sid: link.sid, path, line: owner, blockId: J.blockIdOf(lines[owner]), text: [...parents, ...own].join("\n") });
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
export function aggregateDashboard(rows, from, to, project = null) {
  const result = { tokens: 0, out: 0, fresh: 0, cached: 0, wall: 0, sessions: 0, activeDays: 0, missingTokens: 0, missingSpans: 0, days: {}, projects: [], rows: [] };
  const seen = new Set(), projects = new Map(), sessions = new Set();
  for (const row of rows) {
    if (row.day < from || row.day > to || project !== null && row.project !== project) continue;
    const id = `${row.agent}:${row.sid}:${row.day}`;
    if (seen.has(id)) continue;
    seen.add(id); if (!row.legacy) sessions.add(`${row.agent}:${row.sid}`);
    const tokens = number(row.out) + number(row.fresh) + number(row.cached);
    const segs = (row.segs || []).filter(s => s.length === 2 && s.every(Number.isFinite) && s[1] > s[0]);
    const entry = { ...row, tokens, segs, min: minutes(segs) };
    result.rows.push(entry);
    const day = (result.days[row.day] ||= { tokens: 0, segs: [], wall: 0 });
    day.tokens += tokens; day.segs.push(...segs);
    if (!projects.has(row.project)) projects.set(row.project, { path: row.project, name: row.projectName, tokens: 0, wall: 0, sessions: new Set(), days: {} });
    const group = projects.get(row.project);
    group.tokens += tokens; if (!row.legacy) group.sessions.add(`${row.agent}:${row.sid}`);
    (group.days[row.day] ||= []).push(...segs);
    result.tokens += tokens; result.out += number(row.out); result.fresh += number(row.fresh); result.cached += number(row.cached);
    if (!tokens) result.missingTokens++;
    if (!segs.length) result.missingSpans++;
  }
  for (const day of Object.values(result.days)) { day.wall = minutes(day.segs); result.wall += day.wall; }
  result.activeDays = Object.keys(result.days).length;
  result.sessions = sessions.size;
  result.projects = [...projects.values()].map(g => ({ ...g, sessions: g.sessions.size, wall: Object.values(g.days).reduce((n, segs) => n + minutes(segs), 0) })).sort((a, b) => b.tokens - a.tokens || b.wall - a.wall);
  result.rows.sort((a, b) => b.day.localeCompare(a.day) || b.tokens - a.tokens);
  return result;
}
