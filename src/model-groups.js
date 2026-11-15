import { AGENT_ORDER } from "./constants.js";

// Primary/visibility changes restore the default; otherwise retain manual folds.
export function syncModelGroups(settings, agentEnabled) {
  const ui = (settings.ui ||= {});
  let changed = false;
  for (const section of ["modelGroups", "delegateGroups"]) {
    const groups = (ui[section] ||= {});
    for (const agent of AGENT_ORDER) {
      const visible = agentEnabled(agent) && (section === "delegateGroups" || !(ui.agentCards?.hidden || []).includes(agent));
      const primary = (settings.primaryAgents || []).includes(agent);
      if (!groups[agent] || groups[agent].visible !== visible || groups[agent].primary !== primary) {
        groups[agent] = { visible, primary, open: visible && primary };
        changed = true;
      }
    }
  }
  return changed;
}
