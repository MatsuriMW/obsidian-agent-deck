// Project-first concurrency grouping, team presets, copilot task planning, and fractal task boards.

import { AGENTS, AGENT_ORDER, truncate } from "./constants.js";
import { t } from "./i18n.js";
import { hasAgentCapability } from "./agent-registry.js";
import { sessionProjectName } from "./readers.js";
import { activeJob, destinations } from "./workflow.js";
import * as J from "./journal.js";
import { parseMirrorRef } from "./outline.js";
import { taskMention, stripTaskMention } from "./task-mentions.js";

export const STANDALONE_PROJECT_ID = "__standalone__";

export const DEFAULT_TEAM_PRESETS = [
  {
    id: "fullstack",
    name: "全栈开发小队",
    desc: "架构与后端 + 功能与集成 + 探索与批处理",
    roles: [
      { id: "arch", label: "架构与后端", preferredAgent: "codex", hint: "接口设计、核心逻辑、单测验证" },
      { id: "impl", label: "功能与集成", preferredAgent: "claude", hint: "端到端实现、重构与联调收尾" },
      { id: "explore", label: "探索与批处理", preferredAgent: "opencode", hint: "代码检索、辅助脚本、文档草稿" },
    ],
  },
  {
    id: "debug",
    name: "排错重构小队",
    desc: "根因定位 + 补丁与测试 + 交叉复核",
    roles: [
      { id: "triage", label: "根因定位", preferredAgent: "claude", hint: "复现问题、梳理调用链与边界" },
      { id: "fix", label: "补丁与测试", preferredAgent: "codex", hint: "最小化修复并补齐回归测试" },
      { id: "review", label: "交叉复核", preferredAgent: "dsh", hint: "边界检查与回归风险审查" },
    ],
  },
  {
    id: "research",
    name: "调研与文档小队",
    desc: "方案设计 + 资料整理 + 校对执行",
    roles: [
      { id: "design", label: "方案设计", preferredAgent: "claude", hint: "拆解思路、梳理结构与关键结论" },
      { id: "gather", label: "资料整理", preferredAgent: "antigravity", hint: "对比分析、信息提炼与补充" },
      { id: "polish", label: "校对与执行", preferredAgent: "qoder", hint: "细节检查与规范输出" },
    ],
  },
];

export const BOARD_COLUMNS = [
  { id: "todo", label: "TODO", targetKw: "TODO" },
  { id: "doing", label: "DOING", targetKw: "DOING" },
  { id: "review", label: "待确认", targetKw: "NEEDOK" },
  { id: "done", label: "DONE", targetKw: "DONE" },
];

const RUNNING_STATES = new Set(["run", "starting", "running", "busy"]);
const WAITING_STATES = new Set(["wait", "quiet", "needs-approval", "queued"]);
const ATTENTION_STATES = new Set(["needs-approval", "error", "limit"]);

function stateRank(state) {
  if (state === "needs-approval") return 0;
  if (RUNNING_STATES.has(state)) return 1;
  if (state === "error" || state === "limit") return 2;
  if (state === "wait" || state === "quiet") return 3;
  if (state === "queued") return 4;
  if (state === "done" || state === "cancelled") return 6;
  return 5;
}

export function resolveSessionProject(session) {
  const cwdName = sessionProjectName(session?.cwd || "");
  if (cwdName) return cwdName;
  const raw = String(session?.project || "").trim();
  return raw && raw !== "?" && raw !== "~" ? raw : "";
}

function normalizeJobState(job) {
  if (!job) return "idle";
  if (job.state === "needs-approval") return "needs-approval";
  if (job.state === "starting" || job.state === "running") return "run";
  return job.state || "idle";
}

export function mergeSessionsWithJobs(sessions = [], jobs = {}, agentEnabled = () => true) {
  const out = [];
  const seenKey = new Set();
  const jobBySid = new Map();
  for (const job of Object.values(jobs || {})) {
    if (!job || !agentEnabled(job.agent)) continue;
    if (job.sessionId) jobBySid.set(`${job.agent}:${job.sessionId}`, job);
  }
  for (const s of sessions || []) {
    if (!s || !agentEnabled(s.agent)) continue;
    const key = `${s.agent}:${s.sid}`;
    const job = s.job || jobBySid.get(key) || null;
    const state = job && activeJob(job) ? normalizeJobState(job) : (s.state || "idle");
    out.push({ ...s, state, job: job || s.job || null });
    seenKey.add(key);
  }
  for (const job of Object.values(jobs || {})) {
    if (!job || !agentEnabled(job.agent)) continue;
    if (!activeJob(job)) continue;
    const sid = job.sessionId || job.id;
    const key = `${job.agent}:${sid}`;
    if (seenKey.has(key)) continue;
    seenKey.add(key);
    out.push({
      sid,
      agent: job.agent,
      title: job.name || AGENTS[job.agent]?.name || job.agent,
      text: job.blockText || job.question || "",
      cwd: job.cwd || "",
      app: job.app || "",
      state: normalizeJobState(job),
      step: job.step || (job.handoff ? t("等你在客户端发出") : t("正在启动会话…")),
      lastAt: job.endedAt || job.startedAt || Date.now(),
      tokens: job.tokens || 0,
      model: job.model || "",
      job,
      isPendingJob: true,
    });
  }
  return out;
}

/**
 * Group live/recent sessions and active jobs by workspace project for P0 process management.
 */
export function buildProjectGroups(sessions = [], { jobs = {}, agentEnabled = () => true } = {}) {
  const merged = mergeSessionsWithJobs(sessions, jobs, agentEnabled);
  const byProj = new Map();
  for (const s of merged) {
    const proj = resolveSessionProject(s);
    const id = proj || STANDALONE_PROJECT_ID;
    let g = byProj.get(id);
    if (!g) {
      g = {
        id,
        name: proj || t("独立会话"),
        isStandalone: !proj,
        cwds: [],
        agents: [],
        sessions: [],
        activeJobIds: [],
        latestAt: 0,
        counts: { running: 0, waiting: 0, attention: 0, error: 0, limit: 0, queued: 0, total: 0 },
      };
      byProj.set(id, g);
    }
    g.sessions.push(s);
    if (s.cwd && !g.cwds.includes(s.cwd)) g.cwds.push(s.cwd);
    if (s.agent && !g.agents.includes(s.agent)) g.agents.push(s.agent);
    if (s.job && activeJob(s.job) && !g.activeJobIds.includes(s.job.id)) g.activeJobIds.push(s.job.id);
    if ((s.lastAt || 0) > g.latestAt) g.latestAt = s.lastAt || 0;
    const st = s.state || "idle";
    g.counts.total += 1;
    if (RUNNING_STATES.has(st)) g.counts.running += 1;
    if (WAITING_STATES.has(st)) g.counts.waiting += 1;
    if (ATTENTION_STATES.has(st)) g.counts.attention += 1;
    if (st === "error") g.counts.error += 1;
    if (st === "limit") g.counts.limit += 1;
    if (st === "queued") g.counts.queued += 1;
  }

  const groups = [...byProj.values()];
  for (const g of groups) {
    g.agents.sort((a, b) => AGENT_ORDER.indexOf(a) - AGENT_ORDER.indexOf(b));
    g.sessions.sort((a, b) => stateRank(a.state) - stateRank(b.state) || (b.lastAt || 0) - (a.lastAt || 0));
  }
  groups.sort((a, b) => {
    const att = (b.counts.attention > 0 ? 1 : 0) - (a.counts.attention > 0 ? 1 : 0);
    if (att) return att;
    const run = (b.counts.running > 0 ? 1 : 0) - (a.counts.running > 0 ? 1 : 0);
    if (run) return run;
    if (a.isStandalone !== b.isStandalone) return a.isStandalone ? 1 : -1;
    const wait = (b.counts.waiting > 0 ? 1 : 0) - (a.counts.waiting > 0 ? 1 : 0);
    if (wait) return wait;
    return (b.latestAt || 0) - (a.latestAt || 0) || a.name.localeCompare(b.name);
  });
  return groups;
}

/**
 * Plan collapsed/expanded recent session cards grouped by project under a strict card cap.
 */
export function planRecentProjectDisplay(rows = [], { expanded = new Set(), maxCards = 30, jobs = {}, agentEnabled = () => true } = {}) {
  const groups = buildProjectGroups(rows, { jobs, agentEnabled }).slice(0, maxCards);
  let extraBudget = Math.max(0, maxCards - groups.length);
  let renderedCount = 0;
  const planned = groups.map((g) => {
    const isSingle = g.sessions.length === 1;
    const isExpanded = !isSingle && expanded.has(g.id);
    const extra = isExpanded ? Math.min(g.sessions.length - 1, extraBudget) : 0;
    extraBudget -= extra;
    const visibleItems = g.sessions.slice(0, 1 + extra);
    renderedCount += visibleItems.length;
    return {
      ...g,
      items: g.sessions,
      visibleItems,
      expanded: isExpanded,
      stacked: !isSingle && !isExpanded,
      unshownCount: Math.max(0, g.sessions.length - visibleItems.length),
    };
  });
  return {
    mode: "project",
    total: rows.length,
    renderedCount,
    hiddenCount: Math.max(0, rows.length - renderedCount),
    groups: planned,
  };
}

export function delegableAgents(plugin) {
  return AGENT_ORDER.filter((id) => (plugin?.agentEnabled ? plugin.agentEnabled(id) : true) && hasAgentCapability(id, "delegate"));
}

export function limitAgentsFromSessions(sessions = []) {
  const limited = new Set();
  for (const s of sessions || []) {
    if (s?.agent && s.state === "limit") limited.add(s.agent);
  }
  return limited;
}

export function resolveTeamPresets(settings = {}) {
  const custom = settings?.projectTeams?.presets || {};
  const labelOf = (s) => ({
    "全栈开发小队": t("全栈开发小队"),
    "架构与后端 + 功能与集成 + 探索与批处理": t("架构与后端 + 功能与集成 + 探索与批处理"),
    "架构与后端": t("架构与后端"),
    "接口设计、核心逻辑、单测验证": t("接口设计、核心逻辑、单测验证"),
    "功能与集成": t("功能与集成"),
    "端到端实现、重构与联调收尾": t("端到端实现、重构与联调收尾"),
    "探索与批处理": t("探索与批处理"),
    "代码检索、辅助脚本、文档草稿": t("代码检索、辅助脚本、文档草稿"),
    "排错重构小队": t("排错重构小队"),
    "根因定位 + 补丁与测试 + 交叉复核": t("根因定位 + 补丁与测试 + 交叉复核"),
    "根因定位": t("根因定位"),
    "复现问题、梳理调用链与边界": t("复现问题、梳理调用链与边界"),
    "补丁与测试": t("补丁与测试"),
    "最小化修复并补齐回归测试": t("最小化修复并补齐回归测试"),
    "交叉复核": t("交叉复核"),
    "边界检查与回归风险审查": t("边界检查与回归风险审查"),
    "调研与文档小队": t("调研与文档小队"),
    "方案设计 + 资料整理 + 校对执行": t("方案设计 + 资料整理 + 校对执行"),
    "方案设计": t("方案设计"),
    "拆解思路、梳理结构与关键结论": t("拆解思路、梳理结构与关键结论"),
    "资料整理": t("资料整理"),
    "对比分析、信息提炼与补充": t("对比分析、信息提炼与补充"),
    "校对与执行": t("校对与执行"),
    "细节检查与规范输出": t("细节检查与规范输出"),
  }[s] || s);
  return DEFAULT_TEAM_PRESETS.map((preset) => {
    const saved = custom[preset.id];
    const roleOverrides = saved?.roleAgents || {};
    return {
      ...preset,
      name: labelOf(preset.name),
      desc: labelOf(preset.desc),
      roles: preset.roles.map((r) => ({
        ...r,
        label: labelOf(r.label),
        hint: labelOf(r.hint),
        preferredAgent: roleOverrides[r.id] || r.preferredAgent,
      })),
    };
  });
}

export function resolveRoleAgent(preferredAgent, { availableAgents = [], limitAgents = new Set(), fallbackAgent = "" } = {}) {
  const pool = availableAgents.length ? availableAgents : ["claude"];
  if (preferredAgent && pool.includes(preferredAgent) && !limitAgents.has(preferredAgent)) {
    return { agent: preferredAgent, fallbackFrom: "", limited: false };
  }
  const healthy = pool.find((id) => !limitAgents.has(id));
  if (healthy) {
    return {
      agent: healthy,
      fallbackFrom: preferredAgent && preferredAgent !== healthy ? preferredAgent : "",
      limited: Boolean(preferredAgent && limitAgents.has(preferredAgent)),
    };
  }
  const kept = preferredAgent && pool.includes(preferredAgent) ? preferredAgent : (fallbackAgent && pool.includes(fallbackAgent) ? fallbackAgent : pool[0]);
  return { agent: kept, fallbackFrom: "", limited: limitAgents.has(kept) };
}

export function assignTeamToRoles(preset, { availableAgents = [], limitAgents = new Set(), overrides = {}, defaultDestinationFn } = {}) {
  return (preset?.roles || []).map((role) => {
    const chosen = overrides[role.id] || role.preferredAgent;
    const resolved = resolveRoleAgent(chosen, { availableAgents, limitAgents });
    const dests = destinations(resolved.agent);
    const defaultDest = defaultDestinationFn ? defaultDestinationFn(resolved.agent) : (dests.find((d) => d.id === "background")?.id || dests[0]?.id || "background");
    return {
      ...role,
      agent: resolved.agent,
      fallbackFrom: resolved.fallbackFrom,
      limited: resolved.limited,
      destination: defaultDest,
    };
  });
}

export function buildCopilotPlanPrompt({ goal = "", projectName = "", cwd = "", contextLines = [], roles = [], availableAgents = [] } = {}) {
  const roleDesc = roles.map((r) => `- ${r.label} (建议 ${r.agent}): ${r.hint}`).join("\n");
  const agentsDesc = availableAgents.map((id) => `${id} (${AGENTS[id]?.name || id})`).join(", ");
  const ctx = contextLines.filter((l) => l && l.trim()).slice(-6).join("\n");
  return [
    "你是项目工作台的任务拆解副驾。请根据项目目标，拆解出 2 到 5 个可并行或分步委派给不同 Agent 的清晰子任务，只输出合法 JSON，不要输出 Markdown 解释或多余文字。",
    'JSON 格式：{"summary":"一句话项目目标","subtasks":[{"title":"简洁可执行子任务标题（不超过28字）","role":"角色名","agent":"agent_id","detail":"验收要求或补充说明（不超过80字）"}]}',
    projectName ? `项目名：${projectName}` : "",
    cwd ? `工作目录：${cwd}` : "",
    `可用 Agent ID（agent 字段必须从这里选）：${agentsDesc || "claude"}`,
    roleDesc ? `当前小队分工：\n${roleDesc}` : "",
    ctx ? `相关父级上下文：\n${ctx}` : "",
    `待拆解目标：\n${String(goal || "").trim()}`,
  ].filter(Boolean).join("\n\n");
}

function extractJsonObject(raw) {
  const text = String(raw || "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1].trim() : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return JSON.parse(candidate.slice(start, end + 1));
}

export function parseCopilotPlanResponse(raw, { availableAgents = ["claude"], roles = [], defaultAgent = "claude" } = {}) {
  let parsed = null;
  try { parsed = extractJsonObject(raw); } catch { return null; }
  if (!parsed || !Array.isArray(parsed.subtasks) || !parsed.subtasks.length) return null;
  const pool = availableAgents.length ? availableAgents : [defaultAgent || "claude"];
  const fallback = pool.includes(defaultAgent) ? defaultAgent : pool[0];
  const subtasks = parsed.subtasks
    .slice(0, 8)
    .map((item, idx) => {
      const title = truncate(String(item?.title || "").replace(/\s+/g, " ").trim(), 48);
      if (!title) return null;
      const roleName = String(item?.role || "").trim();
      const matchedRole = roles.find((r) => r.label === roleName || r.id === roleName) || roles[idx % Math.max(1, roles.length)];
      const rawAgent = String(item?.agent || "").trim().toLowerCase();
      const agent = pool.includes(rawAgent) ? rawAgent : (matchedRole && pool.includes(matchedRole.agent) ? matchedRole.agent : fallback);
      return {
        checked: true,
        title,
        role: roleName || matchedRole?.label || t("协作任务"),
        agent,
        detail: String(item?.detail || "").replace(/\s+/g, " ").trim().slice(0, 160),
      };
    })
    .filter(Boolean);
  if (!subtasks.length) return null;
  return {
    summary: String(parsed.summary || "").trim(),
    subtasks,
  };
}

export function fallbackCopilotPlan({ goal = "", roles = [], defaultAgent = "claude" } = {}) {
  const lines = String(goal || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
  const activeRoles = roles.length ? roles : [{ label: t("主责执行"), agent: defaultAgent || "claude" }];
  if (lines.length >= 2) {
    return {
      summary: lines[0],
      subtasks: lines.slice(0, 8).map((line, i) => {
        const role = activeRoles[i % activeRoles.length];
        return { checked: true, title: truncate(line, 48), role: role.label, agent: role.agent || defaultAgent, detail: "" };
      }),
    };
  }
  const core = truncate(lines[0] || t("推进项目开发"), 36);
  return {
    summary: core,
    subtasks: activeRoles.map((role) => ({
      checked: true,
      title: `${role.label}：${core}`,
      role: role.label,
      agent: role.agent || defaultAgent,
      detail: role.hint || "",
    })),
  };
}

export function formatWorkbenchTasksMarkdown({ parentTitle = "", subtasks = [], indent = "", childIndentStr = "\t", includeParent = true, assignBlockIds = false } = {}) {
  const lines = [];
  const subIndent = includeParent ? `${indent}${childIndentStr}` : indent;
  const detailIndent = `${subIndent}\t`;
  if (includeParent) {
    const parentId = assignBlockIds ? ` ^${J.makeBlockId("", "ad", "wb")}` : "";
    lines.push(`${indent}- TODO ${String(parentTitle || t("项目协同任务")).trim()}${parentId}`);
  }
  for (const item of subtasks) {
    if (!item || item.checked === false) continue;
    const title = String(item.title || "").trim();
    if (!title) continue;
    const mention = item.agent ? ` @${item.agent}` : "";
    const bid = assignBlockIds ? ` ^${J.makeBlockId("", item.agent || "ad", "wb")}` : "";
    lines.push(`${subIndent}- TODO ${title}${mention}${bid}`);
    if (item.detail && item.detail.trim()) {
      lines.push(`${detailIndent}- ${item.detail.trim()}`);
    }
  }
  return lines.join("\n");
}

/**
 * Insert a new top-level workbench task block into a journal/note:
 * places inside the active bounded section when present, otherwise appends cleanly at EOF.
 */
export function insertWorkbenchBlockLines(lines = [], inserted = []) {
  const out = [...lines];
  const activeEndIdx = out.findIndex((l) => l.trim() === "<!-- agent-deck:section:active:end -->");
  if (activeEndIdx >= 0) {
    let insertAt = activeEndIdx;
    while (insertAt > 0 && !out[insertAt - 1].trim()) insertAt -= 1;
    out.splice(insertAt, 0, ...inserted);
    return { lines: out, parentLine: insertAt };
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  if (out.length) out.push("");
  const parentLine = out.length;
  out.push(...inserted);
  return { lines: out, parentLine };
}

export function classifyTaskStatusColumn(kw = "", state = "") {
  const upper = String(kw || "").toUpperCase();
  if (["DONE", "CANCELED", "CANCELLED", "FAILED"].includes(upper) || state === "done" || state === "cancelled") return "done";
  if (["DOING", "NOW", "IN-PROGRESS", "DELEGATED"].includes(upper) || state === "run") return "doing";
  if (["NEEDOK", "TOREVIEW", "WAITING", "WAIT", "PAUSED", "SUSPENDED", "ERRORED", "HITLIMIT"].includes(upper) || state === "needs-approval" || state === "error" || state === "limit") return "review";
  return "todo";
}

function cleanBoardCardTitle(rawBody = "", trigger = "@") {
  const withoutMention = stripTaskMention(rawBody, trigger);
  return J.stripInlineTitleMarkup(
    J.stripBlockId(withoutMention)
      .replace(/^🤖\s*/u, "")
      .replace(/^\d{1,2}[:：]\d{2}(?:\s*[-–~～到至]\s*\d{1,2}[:：]\d{2})?\s*/, "")
      .trim(),
  );
}

/**
 * Extract parent task blocks that contain >= 2 direct child task items for in-place Fractal Kanban projection.
 */
export function extractTaskBoardGroups(text, { trackedIds = new Set(), trigger = "@" } = {}) {
  if (!text) return [];
  const lines = String(text).split("\n");
  const fenced = J.fencedLines(lines);
  const titleCounts = new Map();
  const out = [];

  const parseChildCard = (k, endLine, directChildIndent) => {
    const mirror = parseMirrorRef(lines[k]);
    const childKw = J.kwLine(lines[k]);
    if (!mirror && (!childKw || !childKw.kw)) return null;

    let cardEnd = k;
    for (let m = k + 1; m <= endLine; m++) {
      if (!lines[m].trim()) continue;
      if (J.width(lines[m]) <= directChildIndent) break;
      cardEnd = m;
    }

    let mention = null;
    try { mention = taskMention(lines[k], trigger); } catch { mention = null; }
    let link = null;
    let latestConclusion = "";
    const subCards = [];
    let subIndent = -1;
    for (let m = k + 1; m <= cardEnd; m++) {
      if (fenced.has(m)) continue;
      if (!lines[m].trim()) continue;
      const w = J.width(lines[m]);
      if (subIndent < 0) subIndent = w;
      if (!link) {
        const parsedLink = J.parseLink(lines[m]);
        if (parsedLink) link = parsedLink;
      }
      const trimmed = lines[m].trim();
      if (/^[-*+]\s+💬\s/.test(trimmed)) {
        latestConclusion = trimmed.replace(/^[-*+]\s+💬\s+(?:第\d+轮[：:])?\s*/, "").replace(J.RECORD_PROVENANCE_RE, "").trim();
      }
      if (w === subIndent && J.LIST_RE.test(lines[m]) && !J.RECORD_LINE_RE.test(lines[m])) {
        const subKw = J.kwLine(lines[m]);
        const subMirror = parseMirrorRef(lines[m]);
        if (subMirror || (subKw && subKw.kw)) {
          let subMention = null;
          try { subMention = taskMention(lines[m], trigger); } catch { subMention = null; }
          let subLink = null;
          let subEnd = m;
          for (let s = m + 1; s <= cardEnd; s++) {
            if (!lines[s].trim()) continue;
            if (J.width(lines[s]) <= subIndent) break;
            subEnd = s;
            if (!fenced.has(s) && !subLink) subLink = J.parseLink(lines[s]);
          }
          subCards.push({
            line: m,
            endLine: subEnd,
            kw: subKw?.kw || "TODO",
            column: classifyTaskStatusColumn(subKw?.kw || "TODO"),
            blockId: subKw?.blockId || "",
            title: subMirror ? (subMirror.alias || subMirror.target) : (cleanBoardCardTitle(subKw.body, trigger) || subKw.body),
            agent: subLink?.agent || subMention?.agent || "",
            sid: subLink?.sid || "",
            hasLink: Boolean(subLink),
            latestConclusion: "",
            mirror: subMirror,
            isMirror: Boolean(subMirror),
            parentLine: k,
          });
        }
      }
    }

    const bodyText = childKw?.body || mirror?.alias || mirror?.target || "";
    return {
      line: k,
      endLine: cardEnd,
      kw: childKw?.kw || "TODO",
      column: classifyTaskStatusColumn(childKw?.kw || "TODO"),
      blockId: childKw?.blockId || "",
      title: mirror ? (mirror.alias || `${mirror.target}#^${mirror.blockId}`) : (cleanBoardCardTitle(bodyText, trigger) || bodyText),
      agent: link?.agent || mention?.agent || "",
      sid: link?.sid || "",
      hasLink: Boolean(link),
      latestConclusion,
      mirror,
      isMirror: Boolean(mirror),
      subCards,
      childCardCount: subCards.length,
      childDoneCount: subCards.filter((c) => c.column === "done").length,
      subBoardKey: "",
    };
  };

  for (let i = 0; i < lines.length; i++) {
    if (fenced.has(i) || !J.LIST_RE.test(lines[i])) continue;
    if (J.RECORD_LINE_RE.test(lines[i])) continue;
    const parentKw = J.kwLine(lines[i]);
    if (!parentKw) continue;
    const parentIndent = J.width(lines[i]);
    let endLine = i;
    for (let k = i + 1; k < lines.length; k++) {
      if (!lines[k].trim()) continue;
      if (J.width(lines[k]) <= parentIndent) break;
      endLine = k;
    }
    if (endLine === i) continue;

    let directChildIndent = -1;
    for (let k = i + 1; k <= endLine; k++) {
      if (fenced.has(k) || !lines[k].trim()) continue;
      directChildIndent = J.width(lines[k]);
      break;
    }
    if (directChildIndent <= parentIndent) continue;

    const cards = [];
    for (let k = i + 1; k <= endLine; k++) {
      if (fenced.has(k) || !lines[k].trim()) continue;
      if (J.width(lines[k]) !== directChildIndent) continue;
      if (!J.LIST_RE.test(lines[k]) || J.RECORD_LINE_RE.test(lines[k])) continue;
      const card = parseChildCard(k, endLine, directChildIndent);
      if (!card) continue;
      cards.push(card);
      k = card.endLine;
    }

    if (cards.length < 2) continue;
    const baseTitle = cleanBoardCardTitle(parentKw.body, trigger) || parentKw.body;
    const occ = (titleCounts.get(baseTitle) || 0) + 1;
    titleCounts.set(baseTitle, occ);
    const stableKey = `board:${baseTitle}${occ > 1 ? `#${occ}` : ""}`;
    const key = parentKw.blockId || stableKey;
    out.push({
      key,
      stableKey,
      line: i,
      endLine,
      indent: parentIndent,
      title: baseTitle,
      kw: parentKw.kw,
      tracked: Boolean(J.isDeckBlockId(parentKw.blockId) || trackedIds.has(parentKw.blockId) || parentKw.body.startsWith("🤖")),
      cards,
      topLevel: true,
    });
  }

  const byLine = new Map(out.map((g) => [g.line, g]));
  for (const g of out) {
    g.topLevel = !out.some((outer) => outer !== g && outer.line < g.line && g.line <= outer.endLine);
    for (const card of g.cards) {
      const sub = byLine.get(card.line);
      if (sub) card.subBoardKey = sub.key;
    }
  }
  return out;
}

function enrichCardWithRuntime(card, plugin, resolveMirror = null) {
  let base = { ...card };
  if (base.isMirror && base.mirror && typeof resolveMirror === "function") {
    const resolved = resolveMirror(base.mirror);
    if (resolved) {
      base = {
        ...base,
        title: resolved.title || base.title,
        kw: resolved.kw || base.kw,
        column: resolved.column || base.column,
        agent: resolved.agent || base.agent,
        sid: resolved.sid || base.sid,
        hasLink: Boolean(resolved.hasLink || base.hasLink),
        latestConclusion: resolved.latestConclusion || base.latestConclusion,
        mirrorTarget: resolved.mirrorTarget || null,
      };
    }
  }
  const jobs = Object.values(plugin?.jobs || {});
  const job = jobs.find((j) =>
    (base.blockId && j.blockId === base.blockId) ||
    (base.sid && j.sessionId === base.sid) ||
    (j.line === base.line && j.name && base.title.includes(j.name.slice(0, 12))),
  );
  const liveMeta = base.sid ? plugin?.usage?.meta?.get?.(base.sid) : null;
  const effectiveState = job && activeJob(job) ? normalizeJobState(job) : (liveMeta?.state || "");
  const colId = effectiveState ? classifyTaskStatusColumn(base.kw, effectiveState) : base.column;
  return {
    ...base,
    column: colId,
    agent: job?.agent || base.agent,
    activeJob: job && activeJob(job) ? job : null,
    liveState: effectiveState,
    step: job?.step || liveMeta?.step || "",
  };
}

export function buildTaskBoardModel(group, plugin = null, { groupBy = "status", resolveMirror = null } = {}) {
  const enriched = (group?.cards || []).map((c) => enrichCardWithRuntime(c, plugin, resolveMirror));
  const groupedCards = enriched.filter((c) => (c.subCards || []).length > 0);
  const canGroupByChildren = groupedCards.length > 0;
  const activeGroupBy = groupBy === "children" && canGroupByChildren ? "children" : "status";

  let columns;
  if (activeGroupBy === "children") {
    columns = groupedCards.map((parent) => ({
      id: `parent:${parent.line}`,
      label: truncate(parent.title, 26),
      targetParentLine: parent.line,
      cards: (parent.subCards || []).map((sc) => enrichCardWithRuntime(sc, plugin, resolveMirror)),
    }));
    const leaves = enriched.filter((c) => !(c.subCards || []).length);
    if (leaves.length) {
      columns.push({
        id: `parent:${group.line}`,
        label: t("未分组"),
        targetParentLine: group.line,
        cards: leaves,
      });
    }
  } else {
    columns = BOARD_COLUMNS.map((col) => ({ ...col, cards: [] }));
    const byCol = new Map(columns.map((c) => [c.id, c]));
    for (const card of enriched) {
      const col = byCol.get(card.column) || columns[0];
      col.cards.push(card);
    }
  }

  const allCards = activeGroupBy === "children" ? columns.flatMap((c) => c.cards) : enriched;
  const doneCount = allCards.filter((c) => c.column === "done").length;
  const doingCount = allCards.filter((c) => c.column === "doing").length;
  const reviewCount = allCards.filter((c) => c.column === "review").length;
  const todoCount = allCards.filter((c) => c.column === "todo").length;

  return {
    key: group.key,
    stableKey: group.stableKey,
    line: group.line,
    title: group.title,
    groupBy: activeGroupBy,
    canGroupByChildren,
    columns,
    stats: {
      total: allCards.length,
      done: doneCount,
      doing: doingCount,
      review: reviewCount,
      todo: todoCount,
      progressPct: allCards.length ? Math.round((doneCount / allCards.length) * 100) : 0,
    },
    todoDispatchCount: allCards.filter((c) => c.column === "todo" && !c.hasLink && !c.activeJob && !c.isMirror).length,
  };
}

/**
 * Insert a new child task card cleanly under a parent task block in Markdown.
 */
export function insertTaskBoardCard(text, parentLine, { title = "", column = "todo", agent = "" } = {}) {
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) return text;
  const lines = String(text || "").split("\n");
  if (parentLine < 0 || parentLine >= lines.length) return text;
  const col = BOARD_COLUMNS.find((c) => c.id === column) || BOARD_COLUMNS[0];
  const indent = J.childIndent(lines, parentLine);
  let insertAt = parentLine + 1;
  const parentW = J.width(lines[parentLine]);
  while (insertAt < lines.length && (!lines[insertAt].trim() || J.width(lines[insertAt]) > parentW)) {
    insertAt += 1;
  }
  const mention = agent ? ` @${agent}` : "";
  lines.splice(insertAt, 0, `${indent}- ${col.targetKw} ${cleanTitle}${mention}`);
  return lines.join("\n");
}

/**
 * Set or clear the @agent mention on a board card line without touching block IDs or status.
 */
export function setTaskBoardCardAgent(text, cardLine, agent = "", trigger = "@") {
  const lines = String(text || "").split("\n");
  if (cardLine < 0 || cardLine >= lines.length) return text;
  const raw = lines[cardLine];
  const blockId = J.blockIdOf(raw);
  const withoutId = J.stripBlockId(raw);
  const cleaned = stripTaskMention(withoutId, trigger).trimEnd();
  const nextBody = agent ? `${cleaned} ${trigger}${agent}` : cleaned;
  lines[cardLine] = blockId ? `${nextBody} ^${blockId}` : nextBody;
  return lines.join("\n");
}

/**
 * Move a card subtree in Markdown: supports status change, reordering within/across columns,
 * and re-parenting when moving across child-group columns.
 */
export function moveTaskBoardCardSubtree(text, cardLine, { targetColumn = "", beforeLine = -1, targetParentLine = -1 } = {}) {
  let working = text;
  if (targetColumn) {
    working = moveTaskBoardCardStatus(working, cardLine, targetColumn);
  }
  if (beforeLine < 0 && targetParentLine < 0) return working;

  const lines = working.split("\n");
  if (cardLine < 0 || cardLine >= lines.length) return working;
  const srcW = J.width(lines[cardLine]);
  let srcEnd = cardLine + 1;
  while (srcEnd < lines.length && (!lines[srcEnd].trim() || J.width(lines[srcEnd]) > srcW)) srcEnd += 1;
  while (srcEnd > cardLine + 1 && !lines[srcEnd - 1].trim()) srcEnd -= 1;

  const chunk = lines.slice(cardLine, srcEnd);
  let targetIndent = (/^\s*/.exec(lines[cardLine]) || [""])[0];
  if (targetParentLine >= 0 && targetParentLine < lines.length) {
    targetIndent = J.childIndent(lines, targetParentLine);
  }
  const srcIndent = (/^\s*/.exec(chunk[0]) || [""])[0];
  const reindented = chunk.map((l) => {
    if (!l.trim()) return l;
    return l.startsWith(srcIndent) ? targetIndent + l.slice(srcIndent.length) : l;
  });

  let insertAt = -1;
  if (beforeLine >= 0 && beforeLine < lines.length) {
    insertAt = beforeLine;
  } else if (targetParentLine >= 0 && targetParentLine < lines.length) {
    const pW = J.width(lines[targetParentLine]);
    let pEnd = targetParentLine + 1;
    while (pEnd < lines.length && (!lines[pEnd].trim() || J.width(lines[pEnd]) > pW)) pEnd += 1;
    while (pEnd > targetParentLine + 1 && !lines[pEnd - 1].trim()) pEnd -= 1;
    insertAt = pEnd;
  }
  if (insertAt < 0 || (insertAt >= cardLine && insertAt <= srcEnd)) return working;

  const count = srcEnd - cardLine;
  lines.splice(cardLine, count);
  const adjustedAt = insertAt > cardLine ? insertAt - count : insertAt;
  lines.splice(adjustedAt, 0, ...reindented);
  return lines.join("\n");
}

/**
 * Build a concise sibling division-of-labor summary for Harness delegation context (Stage B).
 */
export function buildBoardSiblingContext(model, activeCardLine = -1) {
  if (!model || !Array.isArray(model.columns)) return "";
  const lines = [];
  for (const col of model.columns) {
    for (const card of col.cards) {
      if (card.line === activeCardLine) continue;
      const who = card.agent ? ` (${AGENTS[card.agent]?.short || card.agent})` : "";
      lines.push(`- [${col.id.toUpperCase()}] ${card.title}${who}`);
      if (lines.length >= 10) break;
    }
    if (lines.length >= 10) break;
  }
  if (!lines.length) return "";
  return `${t("同看板协同分工（母任务：{title}）：", { title: model.title })}\n${lines.join("\n")}`;
}

/**
 * Atomically update a child task card's standard Markdown keyword when moving across Fractal Board columns.
 */
export function moveTaskBoardCardStatus(text, cardLine, targetColumn) {
  const col = BOARD_COLUMNS.find((c) => c.id === targetColumn);
  if (!col) return text;
  const lines = String(text || "").split("\n");
  if (cardLine < 0 || cardLine >= lines.length) return text;
  const raw = lines[cardLine];
  const m = /^(\s*(?:[-*+]|\d+[.)])\s+)(\*\*\d{1,2}[:：]\d{2}\*\*\s*)?(.*)$/.exec(raw);
  if (!m) return text;
  const prefix = m[1];
  const stamp = m[2] || "";
  let rest = m[3];

  const cb = /^\[([ xX\/\-])\]\s*/.exec(rest);
  let cbStr = "";
  if (cb) {
    const mark = targetColumn === "done" ? "x" : targetColumn === "doing" ? "/" : " ";
    cbStr = `[${mark}] `;
    rest = rest.slice(cb[0].length);
  }

  const kwMatch = new RegExp(`^(${J.TASK_KWS})(?=\\s|$)\\s*`, "i").exec(rest);
  if (kwMatch) {
    rest = rest.slice(kwMatch[0].length);
    lines[cardLine] = `${prefix}${stamp}${cbStr}${col.targetKw} ${rest}`.trimEnd();
  } else if (cb) {
    lines[cardLine] = `${prefix}${stamp}${cbStr}${rest}`.trimEnd();
  } else {
    lines[cardLine] = `${prefix}${stamp}${col.targetKw} ${rest}`.trimEnd();
  }
  return lines.join("\n");
}
