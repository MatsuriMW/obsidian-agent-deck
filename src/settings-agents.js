import { AGENT_ORDER } from "./constants.js";

export function settingsAgentOrder(settings, section, enabled) {
  const saved = settings.ui?.agentOrders?.[section];
  const order = [...new Set([...(Array.isArray(saved) ? saved : []), ...AGENT_ORDER])].filter(id => AGENT_ORDER.includes(id));
  return section === "tracking" ? order.filter(enabled).concat(order.filter(id => !enabled(id))) : order;
}

export function moveSettingsAgent(settings, section, id, target, after, enabled) {
  if (id === target || !AGENT_ORDER.includes(id) || !AGENT_ORDER.includes(target)) return false;
  if (section === "tracking" && enabled(id) !== enabled(target)) return false;
  const order = settingsAgentOrder(settings, section, enabled).filter(agent => agent !== id);
  order.splice(order.indexOf(target) + (after ? 1 : 0), 0, id);
  ((settings.ui ||= {}).agentOrders ||= {})[section] = order;
  return true;
}

export function recommendPrimaryAgents(usage, now = Date.now()) {
  const since = now - 30 * 86400000, counts = new Map(), recent = new Map(), seen = new Set();
  const subs = new Set([...usage.files.values()].filter(file => file.sub).map(file => file.sid));
  for (const [id, meta] of usage.meta) {
    const sid = meta.sid || id, key = `${meta.agent}:${sid}`;
    if (!AGENT_ORDER.includes(meta.agent) || meta.parentSid || subs.has(sid) || seen.has(key) || meta.lastAt < since || meta.lastAt > now || !meta.lastAt) continue;
    seen.add(key);
    counts.set(meta.agent, (counts.get(meta.agent) || 0) + 1);
    recent.set(meta.agent, Math.max(recent.get(meta.agent) || 0, meta.lastAt));
  }
  return AGENT_ORDER.filter(id => counts.has(id)).sort((a, b) => counts.get(b) - counts.get(a) || recent.get(b) - recent.get(a)).slice(0, 3);
}
