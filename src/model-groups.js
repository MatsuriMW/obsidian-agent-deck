import { AGENT_ORDER } from "./constants.js";

// Visibility changes override a manual fold; otherwise keep the user's choice.
export function syncModelGroups(settings, agentEnabled) {
  const ui = (settings.ui ||= {});
  const groups = (ui.modelGroups ||= {});
  let changed = false;
  for (const agent of AGENT_ORDER) {
    const visible = agentEnabled(agent) && !(ui.agentCards?.hidden || []).includes(agent);
    if (!groups[agent] || groups[agent].visible !== visible) {
      groups[agent] = { visible, open: visible };
      changed = true;
    }
  }
  return changed;
}
