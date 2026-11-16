// Project-first concurrency grouping, team presets, copilot task planning, and fractal task boards.

import { AGENTS, AGENT_ORDER, truncate } from "./constants.js";
import { t } from "./i18n.js";
import { hasAgentCapability } from "./agent-registry.js";
import { sessionProjectName, normalizeProjectRoot, disambiguateProjectLabels } from "./readers.js";
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
  {
    id: "deep-research",
    name: "深度研报小队",
    desc: "信源检索 + 交叉求证 + 洞察综合",
    roles: [
      { id: "scout", label: "信源检索", preferredAgent: "opencode", hint: "搜集一手文献、数据口径与正反案例" },
      { id: "verify", label: "交叉求证", preferredAgent: "codex", hint: "核对引文出处、事实边界与逻辑漏洞" },
      { id: "synth", label: "洞察综合", preferredAgent: "claude", hint: "提炼核心论点、搭建论证结构与结论" },
    ],
  },
  {
    id: "editorial",
    name: "深度写作小队",
    desc: "立意大纲 + 正文起草 + 审校润色",
    roles: [
      { id: "outline", label: "立意与大纲", preferredAgent: "claude", hint: "定核心观点、读者视角与章节节奏" },
      { id: "draft", label: "正文起草", preferredAgent: "antigravity", hint: "扩写论据案例、串联段落并保持口吻" },
      { id: "edit", label: "审校润色", preferredAgent: "qoder", hint: "精简冗余表达、打磨金句与标题钩子" },
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
const ATTENTION_STATES = new Set(["needs-approval", "error", "limit"]);
export const WAIT_ACTIVE_MS = 30 * 60e3;

export function isWaitingSession(session, now = Date.now(), { maxWaitAgeMs = WAIT_ACTIVE_MS } = {}) {
  if (!session) return false;
  const st = session.state || "idle";
  if (st === "needs-approval" || st === "queued") return true;
  if (st !== "wait" && st !== "quiet") return false;
  if (session.job && activeJob(session.job)) return true;
  if (session.parentSid) return false;
  if (!session.lastAt) return true;
  return now - session.lastAt <= maxWaitAgeMs;
}

export function isActiveNowSession(session, now = Date.now(), opts = {}) {
  if (!session) return false;
  const st = session.state || "idle";
  if (RUNNING_STATES.has(st) || ATTENTION_STATES.has(st)) return true;
  return isWaitingSession(session, now, opts);
}

function stateRank(state) {
  if (state === "needs-approval") return 0;
  if (RUNNING_STATES.has(state)) return 1;
  if (state === "error" || state === "limit") return 2;
  if (state === "wait" || state === "quiet") return 3;
  if (state === "queued") return 4;
  if (state === "done" || state === "cancelled") return 6;
  return 5;
}

function resolveDirectProjectIdentity(session) {
  const root = normalizeProjectRoot(session?.cwd || "");
  if (root) return { name: sessionProjectName(root), root };
  const raw = String(session?.project || "").trim();
  if (raw && raw !== "?" && raw !== "~") return { name: raw, root: "" };
  return { name: "", root: "" };
}

export function resolveProjectIdentity(session, bySid = null) {
  const direct = resolveDirectProjectIdentity(session);
  if (direct.name) return direct;
  let curSid = session?.parentSid || "";
  const seen = new Set(session?.sid ? [session.sid] : []);
  for (let depth = 0; depth < 4 && curSid && !seen.has(curSid); depth++) {
    seen.add(curSid);
    const parent = bySid?.get?.(curSid);
    if (!parent) break;
    const found = resolveDirectProjectIdentity(parent);
    if (found.name) return found;
    curSid = parent.parentSid || "";
  }
  const pRoot = normalizeProjectRoot(session?.parentCwd || "");
  if (pRoot) return { name: sessionProjectName(pRoot), root: pRoot };
  return { name: "", root: "" };
}

export function resolveSessionProject(session, bySid = null) {
  return resolveProjectIdentity(session, bySid).name;
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
export function buildProjectGroups(sessions = [], { jobs = {}, agentEnabled = () => true, now = Date.now() } = {}) {
  const merged = mergeSessionsWithJobs(sessions, jobs, agentEnabled);
  const bySid = new Map(merged.map((s) => [s.sid, s]));
  const byProj = new Map();
  for (const s of merged) {
    const { name: baseName, root } = resolveProjectIdentity(s, bySid);
    const key = root ? `root:${root}` : (baseName ? `name:${baseName}` : STANDALONE_PROJECT_ID);
    let g = byProj.get(key);
    if (!g) {
      g = {
        id: baseName || STANDALONE_PROJECT_ID,
        name: baseName || t("独立会话"),
        baseName,
        root,
        key,
        isStandalone: !baseName,
        cwds: [],
        agents: [],
        sessions: [],
        activeJobIds: [],
        latestAt: 0,
        counts: { running: 0, waiting: 0, attention: 0, error: 0, limit: 0, queued: 0, total: 0 },
      };
      byProj.set(key, g);
    }
    g.sessions.push(s);
    if (s.cwd && !g.cwds.includes(s.cwd)) g.cwds.push(s.cwd);
    if (s.agent && !g.agents.includes(s.agent)) g.agents.push(s.agent);
    if (s.job && activeJob(s.job) && !g.activeJobIds.includes(s.job.id)) g.activeJobIds.push(s.job.id);
    if ((s.lastAt || 0) > g.latestAt) g.latestAt = s.lastAt || 0;
    const st = s.state || "idle";
    g.counts.total += 1;
    if (RUNNING_STATES.has(st)) g.counts.running += 1;
    if (isWaitingSession(s, now)) g.counts.waiting += 1;
    if (ATTENTION_STATES.has(st)) g.counts.attention += 1;
    if (st === "error") g.counts.error += 1;
    if (st === "limit") g.counts.limit += 1;
    if (st === "queued") g.counts.queued += 1;
  }

  const groups = [...byProj.values()];
  const namedBuckets = groups.filter((g) => !g.isStandalone);
  const nameCounts = new Map();
  for (const g of namedBuckets) nameCounts.set(g.baseName, (nameCounts.get(g.baseName) || 0) + 1);
  const labels = disambiguateProjectLabels(namedBuckets);
  for (const g of namedBuckets) {
    if ((nameCounts.get(g.baseName) || 0) > 1) {
      g.id = g.root || g.key;
      g.name = labels.get(g.key) || g.baseName;
    } else {
      g.id = g.baseName;
      g.name = g.baseName;
    }
  }
  for (const g of groups) {
    delete g.baseName;
    delete g.root;
    delete g.key;
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
    "深度研报小队": t("深度研报小队"),
    "信源检索 + 交叉求证 + 洞察综合": t("信源检索 + 交叉求证 + 洞察综合"),
    "信源检索": t("信源检索"),
    "搜集一手文献、数据口径与正反案例": t("搜集一手文献、数据口径与正反案例"),
    "交叉求证": t("交叉求证"),
    "核对引文出处、事实边界与逻辑漏洞": t("核对引文出处、事实边界与逻辑漏洞"),
    "洞察综合": t("洞察综合"),
    "提炼核心论点、搭建论证结构与结论": t("提炼核心论点、搭建论证结构与结论"),
    "深度写作小队": t("深度写作小队"),
    "立意大纲 + 正文起草 + 审校润色": t("立意大纲 + 正文起草 + 审校润色"),
    "立意与大纲": t("立意与大纲"),
    "定核心观点、读者视角与章节节奏": t("定核心观点、读者视角与章节节奏"),
    "正文起草": t("正文起草"),
    "扩写论据案例、串联段落并保持口吻": t("扩写论据案例、串联段落并保持口吻"),
    "审校润色": t("审校润色"),
    "精简冗余表达、打磨金句与标题钩子": t("精简冗余表达、打磨金句与标题钩子"),
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

function boardCardTitleSource(rawBody = "", trigger = "@") {
  const withoutMention = stripTaskMention(rawBody, trigger);
  return J.stripBlockId(withoutMention)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^🤖\s*/u, "")
    .replace(/^\d{1,2}[:：]\d{2}(?:\s*[-–~～到至]\s*\d{1,2}[:：]\d{2})?\s*/, "")
    .trim();
}

function cleanBoardCardTitle(rawBody = "", trigger = "@") {
  return J.stripInlineTitleMarkup(boardCardTitleSource(rawBody, trigger));
}

/** Card title source with inline Markdown kept for board rendering. */
export function cleanBoardCardTitleMarkdown(rawBody = "", trigger = "@") {
  return boardCardTitleSource(rawBody, trigger).replace(/\s+/g, " ").trim();
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
          const subTitleMarkdown = subMirror
            ? (subMirror.alias || subMirror.target)
            : (cleanBoardCardTitleMarkdown(subKw.body, trigger) || subKw.body);
          subCards.push({
            line: m,
            endLine: subEnd,
            kw: subKw?.kw || "TODO",
            column: classifyTaskStatusColumn(subKw?.kw || "TODO"),
            blockId: subKw?.blockId || "",
            title: subMirror ? (subMirror.alias || subMirror.target) : (cleanBoardCardTitle(subKw.body, trigger) || subTitleMarkdown),
            titleMarkdown: subTitleMarkdown,
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
    const titleMarkdown = mirror
      ? (mirror.alias || `${mirror.target}#^${mirror.blockId}`)
      : (cleanBoardCardTitleMarkdown(bodyText, trigger) || bodyText);
    return {
      line: k,
      endLine: cardEnd,
      kw: childKw?.kw || "TODO",
      column: classifyTaskStatusColumn(childKw?.kw || "TODO"),
      blockId: childKw?.blockId || "",
      title: mirror ? titleMarkdown : (cleanBoardCardTitle(bodyText, trigger) || titleMarkdown),
      titleMarkdown,
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
        titleMarkdown: resolved.titleMarkdown || resolved.title || base.titleMarkdown || base.title,
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

export function boardCardPinId(card) {
  if (!card) return "";
  if (card.isMirror && card.mirror?.blockId) {
    return `mirror:${String(card.mirror.target || "").trim()}#${card.mirror.blockId}`;
  }
  if (card.blockId) return `block:${card.blockId}`;
  const title = String(card.title || "").trim();
  return title ? `title:${title}` : "";
}

export function sortBoardCardsByPins(columns, pinnedIds = []) {
  const pins = new Set(pinnedIds || []);
  if (!columns || !pins.size) return columns;
  for (const col of columns) {
    if (!Array.isArray(col?.cards)) continue;
    col.cards = col.cards
      .map((card, index) => ({ card, index, pinned: pins.has(boardCardPinId(card)) ? 0 : 1 }))
      .sort((a, b) => a.pinned - b.pinned || a.index - b.index)
      .map((item) => item.card);
  }
  return columns;
}

/** Remember display-only pin ids for one board, without touching the Markdown source. */
export function applyTaskBoardPins(settings, boardKey, ids = [], pinned = true) {
  if (!settings || !boardKey) return [];
  const pins = (settings.taskBoardPins ||= {});
  const list = new Set(Array.isArray(pins[boardKey]) ? pins[boardKey] : []);
  for (const id of ids) {
    if (!id) continue;
    if (pinned) list.add(id);
    else list.delete(id);
  }
  if (list.size) pins[boardKey] = [...list];
  else delete pins[boardKey];
  return [...list];
}

export function buildTaskBoardModel(group, plugin = null, { groupBy = "status", resolveMirror = null, pinnedIds = [] } = {}) {
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
  sortBoardCardsByPins(columns, pinnedIds);
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
  if (beforeLine >= 0 && beforeLine <= lines.length) {
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
 * Delete whole board card subtrees (the task line plus its records and child lines).
 * Selected line numbers are resolved against the original text first, so overlapping
 * or nested selections can never shift later deletions onto unrelated lines.
 */
export function deleteTaskBoardCards(text, cardLines = []) {
  const lines = String(text || "").split("\n");
  const unique = [...new Set((cardLines || []).filter((n) => Number.isInteger(n) && n >= 0))];
  const ranges = [];
  for (const line of unique) {
    if (line >= lines.length || !J.LIST_RE.test(lines[line])) continue;
    const width = J.width(lines[line]);
    let end = line + 1;
    while (end < lines.length && (!lines[end].trim() || J.width(lines[end]) > width)) end += 1;
    while (end > line + 1 && !lines[end - 1].trim()) end -= 1;
    ranges.push({ from: line, to: end });
  }
  ranges.sort((a, b) => a.from - b.from);
  const merged = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else merged.push({ ...range });
  }
  for (let i = merged.length - 1; i >= 0; i -= 1) {
    lines.splice(merged[i].from, merged[i].to - merged[i].from);
  }
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
      let title = String(card.title || "");
      const mirrorSub = /#\^([a-z0-9-]+)$/i.exec(title);
      if (mirrorSub && (J.isDeckBlockId(mirrorSub[1]) || J.isLegacyBlockId(mirrorSub[1]))) {
        title = title.slice(0, mirrorSub.index).trim();
      } else {
        const id = J.blockIdOf(title);
        if (id && (J.isDeckBlockId(id) || J.isLegacyBlockId(id))) title = J.stripBlockId(title);
      }
      lines.push(`- [${col.id.toUpperCase()}] ${title}${who}`);
      if (lines.length >= 10) break;
    }
    if (lines.length >= 10) break;
  }
  if (!lines.length) return "";
  const titleId = J.blockIdOf(model.title);
  const cleanTitle = titleId && (J.isDeckBlockId(titleId) || J.isLegacyBlockId(titleId)) ? J.stripBlockId(model.title) : model.title;
  return `${t("同看板协同分工（母任务：{title}）：", { title: cleanTitle })}\n${lines.join("\n")}`;
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

export const MAX_STEWARD_ROUNDS = 2;

export function resolveStewardConfig(
  settings = {},
  { presetId = "", projectName = "", availableAgents = [], limitAgents = new Set(), defaultAgent = "" } = {},
) {
  const stewards = settings?.projectTeams?.stewards || {};
  const byProject = stewards.byProject || {};
  const byPreset = stewards.byPreset || {};
  const cfg = (projectName && byProject[projectName])
    || (presetId && byPreset[presetId])
    || stewards.default
    || {};
  const preferred = cfg.agent || defaultAgent || "claude";
  const resolved = resolveRoleAgent(preferred, {
    availableAgents,
    limitAgents,
    fallbackAgent: defaultAgent || "claude",
  });
  return {
    enabled: cfg.enabled !== false,
    agent: resolved.agent,
    fallbackFrom: resolved.fallbackFrom,
    limited: resolved.limited,
    autoContinue: cfg.autoContinue === true,
  };
}

export function isTerminalWorkerState(state = "") {
  return state === "done" || state === "error" || state === "cancelled";
}

export function createWorkbenchWave({
  id = "",
  path = "",
  parentBlockId = "",
  parentTitle = "",
  projectName = "",
  goal = "",
  cwd = "",
  round = 1,
  steward = {},
  workers = [],
} = {}) {
  const now = Date.now();
  return {
    id: id || `wave-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    path: String(path || ""),
    parentBlockId: String(parentBlockId || ""),
    parentTitle: String(parentTitle || ""),
    projectName: String(projectName || ""),
    goal: String(goal || parentTitle || ""),
    cwd: String(cwd || ""),
    round: Math.max(1, Number(round) || 1),
    state: "waiting",
    createdAt: now,
    updatedAt: now,
    summary: "",
    error: "",
    nextTaskCount: 0,
    steward: {
      enabled: steward.enabled !== false,
      agent: String(steward.agent || "claude"),
      destination: String(steward.destination || "background"),
      autoContinue: steward.autoContinue === true,
      jobId: "",
      blockId: "",
    },
    workers: (workers || []).map((w) => ({
      jobId: String(w.jobId || ""),
      blockId: String(w.blockId || ""),
      line: Number.isInteger(w.line) ? w.line : -1,
      title: String(w.title || ""),
      agent: String(w.agent || ""),
      state: String(w.state || "running"),
      result: String(w.result || ""),
      error: String(w.error || ""),
      sessionId: String(w.sessionId || ""),
      endedAt: Number(w.endedAt) || 0,
    })),
  };
}

function resolveSyncedWorkerState(worker, job, metaMap) {
  if (!job) return { state: worker.state || "running", result: worker.result || "", error: worker.error || "", sessionId: worker.sessionId || "", endedAt: worker.endedAt || 0 };
  const sid = job.sessionId || worker.sessionId || "";
  const meta = sid && metaMap ? metaMap.get(sid) : null;
  let state = job.state || worker.state || "running";
  let result = job.result || worker.result || "";
  let error = job.error || worker.error || "";
  let endedAt = job.endedAt || worker.endedAt || 0;

  if (job.handoff && state === "bound" && meta) {
    const hasReply = Boolean(meta.rounds?.some((r) => r?.said) || meta.lastText);
    if (meta.state === "done" || meta.state === "error" || meta.state === "cancelled" || (meta.state === "wait" && hasReply)) {
      state = meta.state === "error" ? "error" : (meta.state === "cancelled" ? "cancelled" : "done");
      endedAt = endedAt || meta.lastAt || Date.now();
    }
  } else if (state === "starting" || state === "running" || state === "needs-approval" || state === "bound") {
    state = "running";
  }

  if (!result && meta) {
    result = meta.rounds?.at(-1)?.said || meta.lastText || "";
  }
  if (!result && Array.isArray(job.conversation)) {
    const lastAssistant = [...job.conversation].reverse().find((m) => m?.role === "assistant" && m.text);
    if (lastAssistant) result = lastAssistant.text;
  }
  return { state, result, error, sessionId: sid, endedAt };
}

export function syncWaveWithState(wave, jobs = {}, metaMap = null) {
  if (!wave || !Array.isArray(wave.workers)) {
    return { wave, changed: false, allSettled: false, counts: { total: 0, done: 0, error: 0, cancelled: 0, running: 0 } };
  }
  let changed = false;
  for (const worker of wave.workers) {
    const job = worker.jobId ? jobs?.[worker.jobId] : null;
    const next = resolveSyncedWorkerState(worker, job, metaMap);
    if (
      next.state !== worker.state ||
      next.sessionId !== worker.sessionId ||
      (next.result && next.result !== worker.result) ||
      (next.error && next.error !== worker.error)
    ) {
      worker.state = next.state;
      worker.sessionId = next.sessionId;
      if (next.result) worker.result = next.result;
      if (next.error) worker.error = next.error;
      if (next.endedAt) worker.endedAt = next.endedAt;
      changed = true;
    }
  }
  const total = wave.workers.length;
  const done = wave.workers.filter((w) => w.state === "done").length;
  const error = wave.workers.filter((w) => w.state === "error").length;
  const cancelled = wave.workers.filter((w) => w.state === "cancelled").length;
  const running = total - done - error - cancelled;
  if (changed) wave.updatedAt = Date.now();
  return {
    wave,
    changed,
    allSettled: total > 0 && running === 0,
    counts: { total, done, error, cancelled, running },
  };
}

function findParentBlockLine(lines, { parentBlockId = "", parentTitle = "" } = {}) {
  if (parentBlockId) {
    const byId = lines.findIndex((l) => J.blockIdOf(l) === parentBlockId);
    if (byId >= 0) return byId;
  }
  if (parentTitle) {
    const target = cleanBoardCardTitle(parentTitle).toLowerCase();
    return lines.findIndex((l) => {
      const kw = J.kwLine(l);
      return kw && cleanBoardCardTitle(kw.body).toLowerCase() === target;
    });
  }
  return -1;
}

export function extractBlockResultText(noteText = "", { blockId = "", title = "" } = {}) {
  const lines = String(noteText || "").split("\n");
  const idx = findParentBlockLine(lines, { parentBlockId: blockId, parentTitle: title });
  if (idx < 0) return { summary: "", answerLink: "" };
  const baseW = J.width(lines[idx]);
  const comments = [];
  let answerLink = "";
  for (let i = idx + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (J.width(lines[i]) <= baseW) break;
    const trimmed = lines[i].trim();
    const ansMatch = /\[[^\]]+\]\(([^)]*Answers\/[^)]+\.md)\)/i.exec(trimmed);
    if (ansMatch) answerLink = ansMatch[1];
    if (/^[-*+]\s+💬\s/.test(trimmed)) {
      const clean = trimmed
        .replace(/^[-*+]\s+💬\s+(?:第\d+轮[：:]\s*)?/, "")
        .replace(J.RECORD_PROVENANCE_RE, "")
        .trim();
      if (clean) comments.push(clean);
    }
  }
  return { summary: comments.join("\n"), answerLink };
}

export function collectWaveWorkerReports(wave, { jobs = {}, metaMap = null, noteText = "" } = {}) {
  return (wave?.workers || []).map((worker, idx) => {
    const job = worker.jobId ? jobs?.[worker.jobId] : null;
    const synced = resolveSyncedWorkerState(worker, job, metaMap);
    const noteInfo = noteText ? extractBlockResultText(noteText, { blockId: worker.blockId, title: worker.title }) : { summary: "", answerLink: "" };
    const rawOutput = String(synced.result || noteInfo.summary || "").trim();
    return {
      index: idx + 1,
      title: worker.title,
      agent: worker.agent,
      state: synced.state,
      sessionId: synced.sessionId,
      output: truncate(rawOutput, 2000),
      error: String(synced.error || "").trim(),
      answerLink: noteInfo.answerLink,
    };
  });
}

export function buildStewardPrompt({ wave, reports = [], projectName = "", availableAgents = [] } = {}) {
  const agentsList = availableAgents.length
    ? availableAgents.map((id) => `${id} (${AGENTS[id]?.name || id})`).join(", ")
    : "claude";
  const round = Math.max(1, Number(wave?.round) || 1);
  const statusLabels = new Map([
    ["done", "已完成"],
    ["error", "执行失败"],
    ["cancelled", "已取消"],
    ["running", "仍在进行中"],
  ]);
  const workerSections = reports.map((r) => {
    const lines = [`### 队员 ${r.index}：${r.title} (@${r.agent}) — ${statusLabels.get(r.state) || r.state}`];
    if (r.error) lines.push(`- 失败/异常信息：${r.error}`);
    if (r.answerLink) lines.push(`- 完整问答归档：${r.answerLink}`);
    if (r.output) lines.push(`- 执行结果：\n${r.output}`);
    else if (!r.error) lines.push("- 执行结果：（暂无文本输出，请结合工作目录实际变动核查）");
    return lines.join("\n");
  }).join("\n\n");

  return [
    `你是本次多 Agent 协作波次（第 ${round} 轮）的管家 Agent（Coordinator / Steward）。各个队员已经完成本轮执行，请你收集全部结果、核查落地情况并继续推进。`,
    projectName || wave?.projectName ? `项目名称：${projectName || wave.projectName}` : "",
    wave?.cwd ? `工作目录：${wave.cwd}` : "",
    wave?.goal ? `总体目标：\n${wave.goal}` : "",
    workerSections ? `各队员执行结果汇总：\n\n${workerSections}` : "",
    [
      "请你按以下步骤推进并汇报：",
      "1. 对照总体目标与工作目录中的实际文件/代码变动，核查各队员产出是否一致、有无遗漏、冲突或未闭环的失败项；如工作目录中有可直接完成的集成验证、测试或收尾修补，请直接完成并确认结果。",
      "2. 在回答正文给出简明清晰的《本轮验收与汇总结论》（已完成内容、关键产出或文件、待处理风险/卡点）。",
      "3. 在回答最后附一个 JSON 代码块标明下一步决策（nextTasks 最多 6 条，agent 必须从可用 Agent ID 中选择）：",
      `可用 Agent ID：${agentsList}`,
      '```json\n{"status":"done|continue|needs-review","summary":"一句话总结本轮进展与结论","nextTasks":[{"title":"下一步具体子任务标题（不超过28字）","agent":"agent_id","detail":"验收要求或补充说明（不超过80字）"}]}\n```',
      '- 若总体目标已闭环且无需后续派发，设 `"status": "done"` 且 `"nextTasks": []`。',
      '- 若仍需继续推进下一波任务或修复失败子任务，设 `"status": "continue"` 并列出 `"nextTasks"`。',
      '- 若需用户确认权限、方案分歧或人工拍板，设 `"status": "needs-review"`。',
    ].join("\n"),
  ].filter(Boolean).join("\n\n");
}

function extractLastJsonObject(raw = "") {
  const text = String(raw || "").trim();
  const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (let i = blocks.length - 1; i >= 0; i--) {
    try {
      const obj = extractJsonObject(blocks[i][1]);
      if (obj && typeof obj === "object") return obj;
    } catch { /* try previous fenced block */ }
  }
  return extractJsonObject(text);
}

export function parseStewardOutcome(raw = "", { availableAgents = ["claude"], defaultAgent = "claude" } = {}) {
  let parsed = null;
  try { parsed = extractLastJsonObject(raw); } catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  const rawStatus = String(parsed.status || "").trim().toLowerCase();
  const status = ["done", "continue", "needs-review"].includes(rawStatus) ? rawStatus : "";
  const summary = truncate(String(parsed.summary || "").replace(/\s+/g, " ").trim(), 180);
  const pool = availableAgents.length ? availableAgents : [defaultAgent || "claude"];
  const fallback = pool.includes(defaultAgent) ? defaultAgent : pool[0];
  const nextTasks = Array.isArray(parsed.nextTasks)
    ? parsed.nextTasks.slice(0, 6).map((item) => {
        const title = truncate(String(item?.title || "").replace(/\s+/g, " ").trim(), 48);
        if (!title) return null;
        const rawAgent = String(item?.agent || "").trim().toLowerCase();
        const agent = pool.includes(rawAgent) ? rawAgent : fallback;
        const detail = String(item?.detail || "").replace(/\s+/g, " ").trim().slice(0, 160);
        return { checked: true, title, agent, detail };
      }).filter(Boolean)
    : [];
  if (!status && !summary && !nextTasks.length) return null;
  return {
    status: status || (nextTasks.length ? "continue" : "done"),
    summary,
    nextTasks,
  };
}

export function updateTaskBlockStatusById(text = "", { blockId = "", title = "", targetColumn = "", onlyFromColumns = [] } = {}) {
  if (!targetColumn) return text;
  const lines = String(text || "").split("\n");
  const idx = findParentBlockLine(lines, { parentBlockId: blockId, parentTitle: title });
  if (idx < 0) return text;
  if (Array.isArray(onlyFromColumns) && onlyFromColumns.length) {
    const curKw = J.kwLine(lines[idx])?.kw || "TODO";
    const curCol = classifyTaskStatusColumn(curKw);
    if (!onlyFromColumns.includes(curCol)) return text;
  }
  return moveTaskBoardCardStatus(lines.join("\n"), idx, targetColumn);
}

export function setTaskBlockKeywordById(text = "", { blockId = "", title = "", keyword = "", onlyIfKeywords = [] } = {}) {
  if (!keyword) return text;
  const lines = String(text || "").split("\n");
  const idx = findParentBlockLine(lines, { parentBlockId: blockId, parentTitle: title });
  if (idx < 0) return text;
  const raw = lines[idx];
  const m = /^(\s*(?:[-*+]|\d+[.)])\s+)(\*\*\d{1,2}[:：]\d{2}\*\*\s*)?(.*)$/.exec(raw);
  if (!m) return text;
  const prefix = m[1];
  const stamp = m[2] || "";
  let rest = m[3];
  const cb = /^\[([ xX\/\-])\]\s*/.exec(rest);
  let cbStr = "";
  if (cb) {
    const upper = keyword.toUpperCase();
    const mark = upper === "DONE" ? "x" : ["DOING", "DELEGATED"].includes(upper) ? "/" : upper === "CANCELED" || upper === "CANCELLED" ? "-" : " ";
    cbStr = `[${mark}] `;
    rest = rest.slice(cb[0].length);
  }
  const kwMatch = new RegExp(`^(${J.TASK_KWS})(?=\\s|$)\\s*`, "i").exec(rest);
  const currentKw = kwMatch ? kwMatch[1].toUpperCase() : "";
  if (Array.isArray(onlyIfKeywords) && onlyIfKeywords.length && !onlyIfKeywords.map((k) => k.toUpperCase()).includes(currentKw)) {
    return text;
  }
  if (kwMatch) rest = rest.slice(kwMatch[0].length);
  lines[idx] = `${prefix}${stamp}${cbStr}${keyword} ${rest}`.trimEnd();
  return lines.join("\n");
}

export function appendSubtasksToParentBlock(
  text = "",
  { parentBlockId = "", parentTitle = "", subtasks = [], assignBlockIds = true, keyword = "TODO" } = {},
) {
  const active = (subtasks || []).filter((s) => s && s.checked !== false && String(s.title || "").trim());
  const lines = String(text || "").split("\n");
  const parentLine = findParentBlockLine(lines, { parentBlockId, parentTitle });
  if (parentLine < 0 || !active.length) return { text, parentLine, addedLines: [] };
  const parentW = J.width(lines[parentLine]);
  const childIndent = J.childIndent(lines, parentLine);
  const detailIndent = `${childIndent}\t`;
  let insertAt = parentLine + 1;
  while (insertAt < lines.length && (!lines[insertAt].trim() || J.width(lines[insertAt]) > parentW)) {
    insertAt += 1;
  }
  while (insertAt > parentLine + 1 && !lines[insertAt - 1].trim()) insertAt -= 1;

  const inserted = [];
  const addedLines = [];
  let cursor = insertAt;
  for (const item of active) {
    const title = String(item.title || "").trim();
    const agent = String(item.agent || "").trim();
    const blockId = item.blockId || (assignBlockIds ? J.makeBlockId("", agent || "ad", "wb") : "");
    const mention = agent ? ` @${agent}` : "";
    const bid = blockId ? ` ^${blockId}` : "";
    inserted.push(`${childIndent}- ${keyword} ${title}${mention}${bid}`);
    addedLines.push({
      line: cursor,
      blockId,
      agent,
      destination: item.destination || "",
      title,
    });
    cursor += 1;
    if (item.detail && String(item.detail).trim()) {
      inserted.push(`${detailIndent}- ${String(item.detail).trim()}`);
      cursor += 1;
    }
  }
  lines.splice(insertAt, 0, ...inserted);
  return { text: lines.join("\n"), parentLine, addedLines };
}

export function findActiveWaveForBoard(waves = {}, { path = "", parentBlockId = "", parentTitle = "" } = {}) {
  const candidates = Object.values(waves || {}).filter((w) => {
    if (!w || (path && w.path !== path)) return false;
    if (!["waiting", "running", "error"].includes(w.state)) return false;
    if (parentBlockId && w.parentBlockId && w.parentBlockId === parentBlockId) return true;
    if (parentTitle && w.parentTitle && cleanBoardCardTitle(w.parentTitle) === cleanBoardCardTitle(parentTitle)) return true;
    return false;
  });
  candidates.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  return candidates[0] || null;
}
