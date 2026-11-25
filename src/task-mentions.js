// Task routing is stored in the task's own first line, never in its children.
import { AGENTS, AGENT_ORDER, EFFORTS } from "./constants.js";
import { hasAgentCapability } from "./agent-registry.js";
import { t } from "./i18n.js";

const escapeRegExp = (s) => String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function routableAgents() {
  return AGENT_ORDER.filter((id) => hasAgentCapability(id, "delegate") || hasAgentCapability(id, "terminalHandoff"));
}

export const ROUTABLE_AGENTS = routableAgents();
export function mentionTrigger(plugin) { return plugin.settings.delegate?.mentionTrigger || "@"; }

export function taskMention(line, trigger = "@") {
  // Keep saved @ routes working after changing the completion trigger.
  const markers = [...new Set([trigger, "@"])].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|");
  const agents = [...routableAgents()].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|");
  if (!agents) return null;
  const token = new RegExp(`(?:^|\\s)(${markers})(${agents})(?:/([^\\s\`]+))?(?=\\s|$)`, "g");
  // Inline code and links (including email addresses) are ordinary task content.
  const masked = line.replace(/`[^`]*`|!?\[[^\]]*\]\([^)]*\)/g, (s) => "x".repeat(s.length));
  const found = [...masked.matchAll(token)];
  if (found.length > 1) throw new Error(t("一条任务只能指定一个 Agent 标记"));
  if (!found.length) return null;
  const m = found[0], parts = (m[3] || "").split("/");
  if (parts.length > 2 || (m[3] !== undefined && parts.some((p) => !p))) throw new Error(t("使用 {trigger}agent/model/effort 指定委派", { trigger }));
  const start = m.index + (m[0].startsWith(m[1]) ? 0 : 1);
  return { agent: m[2], trigger: m[1], model: parts[0] || "", effort: parts[1] || "", from: start, to: m.index + m[0].length };
}

export function mentionOptions(plugin, opts) {
  if (opts.mentionResolved) return opts;
  if (opts.ignoreMention) return { agent: plugin.defaultTarget?.() || "claude", ...opts, mentionResolved: true };
  const line = opts.block?.text.split("\n")[0] || opts.lines?.[opts.line] || "";
  const m = taskMention(line, mentionTrigger(plugin));
  if (!m) return { agent: plugin.defaultTarget?.() || "claude", ...opts, mentionResolved: true };
  if (!plugin.agentEnabled(m.agent)) throw new Error(t("{agent} 已关闭，请先在设置中启用", { agent: AGENTS[m.agent].name }));
  if (m.model && !plugin.modelsFor(m.agent).some((x) => x.id === m.model)) throw new Error(t("{trigger}{agent} 的模型不存在，请从 Agent 菜单选择或先添加自定义模型", { trigger: m.trigger, agent: m.agent }));
  if (m.effort && !(EFFORTS[m.agent] || []).some((x) => x.id === m.effort)) throw new Error(t("{trigger}{agent} 不支持强度 {effort}", { trigger: m.trigger, agent: m.agent, effort: m.effort }));
  return { ...opts, agent: m.agent, model: m.model || plugin.defaultModel(m.agent), effort: m.effort || plugin.settings.delegate[m.agent]?.effort, mentionResolved: true };
}

export function stripTaskMention(text, trigger = "@") {
  const lines = text.split("\n");
  try {
    const m = taskMention(lines[0], trigger);
    if (m) lines[0] = (lines[0].slice(0, m.from) + lines[0].slice(m.to)).trimEnd();
  } catch { return text; }
  return lines.join("\n");
}

function modelMatchKeys(m) {
  const keys = new Set();
  for (const raw of [m?.id, m?.model, m?.cli]) {
    const s = String(raw || "").trim().toLowerCase();
    if (s) keys.add(s);
  }
  const val = String(m?.value || "").trim();
  if (val.startsWith("[")) {
    try {
      const pair = JSON.parse(val);
      const rawModel = String(Array.isArray(pair) ? pair[1] : "").trim().toLowerCase();
      if (rawModel) keys.add(rawModel);
    } catch { /* ignore non-JSON ACP pair */ }
  } else if (val) {
    keys.add(val.toLowerCase());
  }
  return keys;
}

function agentModelUsageMap(plugin, agent) {
  const byRaw = new Map();
  const seenSids = new Set();
  const addRaw = (raw, n = 1) => {
    const key = String(raw || "").trim().toLowerCase();
    if (key) byRaw.set(key, (byRaw.get(key) || 0) + n);
  };
  const metas = plugin?.usage?.meta;
  if (metas && typeof metas.values === "function") {
    for (const meta of metas.values()) {
      if (!meta || meta.agent !== agent) continue;
      if (meta.sid) seenSids.add(meta.sid);
      addRaw(meta.model, Math.max(1, Number(meta.turns) || Number(meta.rounds?.length) || 0));
    }
  }
  const jobs = plugin?.jobs;
  if (jobs && typeof jobs === "object") {
    for (const job of Object.values(jobs)) {
      if (!job || job.agent !== agent) continue;
      if (job.sessionId && seenSids.has(job.sessionId)) continue;
      addRaw(job.model, 1);
    }
  }
  return byRaw;
}

export function mentionSuggestions(plugin, query) {
  const parts = query.split("/"), agent = parts[0];
  const routable = routableAgents();
  const alias = { codex: " gpt", dsh: " deepseek", hermes: " hermes-acp", minimax: " mcode mavis", trae: " trae-cn traecli", t3code: " t3 t3-code", kimicode: " kimi kimi-code" };
  if (parts.length === 1) return routable.filter((id) => plugin.agentEnabled(id) && (id + " " + AGENTS[id].name + (alias[id] || "")).toLowerCase().includes(agent.toLowerCase())).map((id) => ({
    value: id,
    label: AGENTS[id].name,
    next: plugin.modelsFor(id).length > 0,
    hint: EFFORTS[id]
      ? t("选择后继续选择具体模型")
      : (hasAgentCapability(id, "acp") ? t("后台 ACP 委派；回车直接选定") : t("客户端交接；模型与强度在客户端设置")),
  }));
  if (!routable.includes(agent) || !plugin.agentEnabled(agent)) return [];
  if (parts.length === 2) {
    const all = plugin.modelsFor(agent), enabled = all.filter(m => plugin.modelEnabled(m.id));
    const base = (enabled.length ? enabled : all).filter(m => (m.id + " " + m.name).toLowerCase().includes(parts[1].toLowerCase()));
    const byRaw = agentModelUsageMap(plugin, agent);
    const callCounts = plugin?.settings?.models?.callCounts || {};
    const isDefault = (m) => m.id === `${agent}-default` || m.value === "";
    const countFor = (m) => {
      let total = Number(callCounts[m.id]) || 0;
      for (const k of modelMatchKeys(m)) total += byRaw.get(k) || 0;
      return total;
    };
    const sorted = [...base].sort((a, b) => {
      const da = isDefault(a) ? 1 : 0, db = isDefault(b) ? 1 : 0;
      if (da !== db) return db - da;
      const ca = countFor(a), cb = countFor(b);
      if (ca !== cb) return cb - ca;
      return 0;
    });
    return sorted.map(m => ({ value: `${agent}/${m.id}`, label: m.name, hint: t("选定模型；可继续输入 / 选择强度") }));
  }
  if (parts.length === 3 && plugin.modelsFor(agent).some((m) => m.id === parts[1])) return (EFFORTS[agent] || []).filter((e) => e.id.startsWith(parts[2])).map((e) => ({ value: `${agent}/${parts[1]}/${e.id}`, label: e.label, hint: e.hint }));
  return [];
}
