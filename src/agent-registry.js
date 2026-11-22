// Declarative Agent capability registry for Open-Closed extensibility.
import { AGENTS, AGENT_ORDER } from "./constants.js";

const CAPABILITIES = new Map([
  ["claude", {
    delegate: true,
    runnerKind: "claude",
    acp: false,
    desktopHandoffOnly: false,
    terminalHandoff: true,
    continueInApp: false,
    permissionControl: true,
    archiveDetection: true,
    modelCatalog: true,
    autoOpenDesktopOnDone: true,
    waitDesktopUntilDone: true,
    sessionLinkScheme: "claude",
  }],
  ["codex", {
    delegate: true,
    runnerKind: "codex",
    acp: false,
    desktopHandoffOnly: false,
    terminalHandoff: true,
    continueInApp: false,
    permissionControl: false,
    archiveDetection: true,
    modelCatalog: true,
    autoOpenDesktopOnDone: false,
    waitDesktopUntilDone: true,
    sessionLinkScheme: "codex",
  }],
  ["workbuddy", {
    delegate: false,
    runnerKind: "handoff",
    acp: false,
    desktopHandoffOnly: true,
    terminalHandoff: true,
    continueInApp: false,
    permissionControl: false,
    archiveDetection: false,
    modelCatalog: false,
    sessionLinkScheme: "workbuddy",
  }],
  ["dsh", {
    delegate: true,
    runnerKind: "acp",
    acp: true,
    acpArgs: ["acp"],
    acpAutoApprove: true,
    acpDefaultModel: "dsh-default",
    acpDefaultEffort: "high",
    acpModelOptional: true,
    acpEffortOptional: false,
    acpAllowUnknownEffort: true,
    desktopHandoffOnly: false,
    terminalHandoff: false,
    continueInApp: true,
    permissionControl: false,
    archiveDetection: false,
    modelCatalog: true,
    sessionLinkScheme: "dsh",
  }],
  ["antigravity", {
    delegate: true,
    runnerKind: "acp",
    acp: true,
    acpArgs: ["acp"],
    acpAutoApprove: true,
    acpDefaultModel: "antigravity-default",
    acpDefaultEffort: "",
    acpModelOptional: true,
    acpEffortOptional: false,
    acpAllowUnknownEffort: false,
    desktopHandoffOnly: false,
    terminalHandoff: false,
    continueInApp: true,
    continueRequiresAcp: true,
    permissionControl: false,
    archiveDetection: false,
    modelCatalog: true,
    sessionLinkScheme: "antigravity",
  }],
  ["opencode", {
    delegate: true,
    runnerKind: "acp",
    acp: true,
    acpArgs: ["acp"],
    acpAutoApprove: true,
    acpDefaultModel: "opencode-default",
    acpDefaultEffort: "",
    acpModelOptional: true,
    acpEffortOptional: true,
    acpAllowUnknownEffort: true,
    desktopHandoffOnly: false,
    terminalHandoff: true,
    continueInApp: true,
    permissionControl: false,
    archiveDetection: false,
    modelCatalog: true,
    autoOpenDesktopOnDone: true,
    waitDesktopUntilDone: false,
    sessionLinkScheme: "obsidian",
  }],
  ["qoder", {
    delegate: true,
    runnerKind: "qoder",
    acp: false,
    desktopHandoffOnly: false,
    terminalHandoff: true,
    continueInApp: false,
    permissionControl: true,
    archiveDetection: false,
    modelCatalog: true,
    autoOpenDesktopOnDone: false,
    waitDesktopUntilDone: true,
    sessionLinkScheme: "obsidian",
  }],
  ["hermes", {
    delegate: true,
    runnerKind: "acp",
    acp: true,
    acpArgs: [],
    acpAutoApprove: true,
    acpDefaultModel: "hermes-default",
    acpDefaultEffort: "",
    acpModelOptional: true,
    acpEffortOptional: true,
    acpAllowUnknownEffort: true,
    desktopHandoffOnly: false,
    terminalHandoff: true,
    continueInApp: true,
    permissionControl: false,
    archiveDetection: true,
    modelCatalog: true,
    autoOpenDesktopOnDone: false,
    waitDesktopUntilDone: false,
    sessionLinkScheme: "obsidian",
  }],
  ["minimax", {
    delegate: true,
    runnerKind: "acp",
    acp: true,
    acpArgs: ["acp"],
    acpAutoApprove: true,
    acpDefaultModel: "minimax-default",
    acpDefaultEffort: "",
    acpModelOptional: true,
    acpEffortOptional: true,
    acpAllowUnknownEffort: true,
    desktopHandoffOnly: false,
    terminalHandoff: true,
    continueInApp: true,
    permissionControl: false,
    archiveDetection: true,
    modelCatalog: true,
    autoOpenDesktopOnDone: true,
    waitDesktopUntilDone: false,
    sessionLinkScheme: "obsidian",
  }],
  ["qwenwork", {
    delegate: false,
    runnerKind: "handoff",
    acp: false,
    desktopHandoffOnly: true,
    terminalHandoff: false,
    continueInApp: false,
    permissionControl: false,
    archiveDetection: false,
    modelCatalog: false,
    sessionLinkScheme: "qwenwork",
  }],
  ["cursor", {
    delegate: false,
    runnerKind: "handoff",
    acp: false,
    desktopHandoffOnly: true,
    terminalHandoff: false,
    continueInApp: false,
    permissionControl: false,
    archiveDetection: false,
    modelCatalog: false,
    sessionLinkScheme: "cursor",
  }],
  ["grokbot", {
    delegate: false,
    runnerKind: "handoff",
    acp: false,
    desktopHandoffOnly: true,
    terminalHandoff: false,
    continueInApp: false,
    permissionControl: false,
    archiveDetection: false,
    modelCatalog: false,
    sessionLinkScheme: "grokbot",
  }],
  ["t3code", {
    delegate: true,
    runnerKind: "t3code",
    acp: false,
    desktopHandoffOnly: false,
    terminalHandoff: false,
    continueInApp: true,
    permissionControl: false,
    archiveDetection: true,
    modelCatalog: false,
    autoOpenDesktopOnDone: true,
    waitDesktopUntilDone: false,
    sessionLinkScheme: "obsidian",
  }],
  ["muse", {
    delegate: false,
    runnerKind: "handoff",
    acp: false,
    desktopHandoffOnly: true,
    terminalHandoff: false,
    continueInApp: false,
    permissionControl: false,
    archiveDetection: false,
    modelCatalog: false,
    sessionLinkScheme: "muse",
  }],
]);

export function registerAgentCapability(id, capability = {}) {
  if (!id || typeof id !== "string") throw new Error("Agent id is required");
  const prev = CAPABILITIES.get(id) || {};
  const next = { ...prev, ...capability };
  CAPABILITIES.set(id, next);
  return next;
}

export function unregisterAgentCapability(id) {
  if (!id || typeof id !== "string") return false;
  return CAPABILITIES.delete(id);
}

export function getAgentCapability(id) {
  const base = CAPABILITIES.get(id) || {};
  const meta = AGENTS[id] || {};
  return {
    id,
    delegate: false,
    runnerKind: "handoff",
    acp: false,
    acpArgs: ["acp"],
    acpAutoApprove: false,
    acpDefaultModel: "",
    acpDefaultEffort: "",
    acpModelOptional: true,
    acpEffortOptional: true,
    acpAllowUnknownEffort: true,
    desktopHandoffOnly: !!meta.trackingOnly,
    terminalHandoff: false,
    continueInApp: false,
    continueRequiresAcp: false,
    permissionControl: false,
    archiveDetection: false,
    modelCatalog: false,
    autoOpenDesktopOnDone: false,
    waitDesktopUntilDone: false,
    sessionLinkScheme: meta.deep || id,
    ...base,
  };
}

export function hasAgentCapability(id, cap) {
  return Boolean(getAgentCapability(id)[cap]);
}

export function listAgentsByCapability(cap) {
  const ids = [...new Set([...AGENT_ORDER, ...CAPABILITIES.keys()])];
  return ids.filter((id) => hasAgentCapability(id, cap));
}

export const delegateAgents = () => listAgentsByCapability("delegate");
export const acpAgents = () => listAgentsByCapability("acp");
export const acpAutoApproveAgents = () => listAgentsByCapability("acpAutoApprove");
export const cliHandoffAgents = () => listAgentsByCapability("terminalHandoff");
export const canContinueInApp = (id) => hasAgentCapability(id, "continueInApp");
export function canContinueSession(session, jobs = null, { requireSid = true } = {}) {
  if (!session?.agent || !canContinueInApp(session.agent)) return false;
  const sid = session.sid || session.sessionId || "";
  if (requireSid && !sid) return false;
  if (getAgentCapability(session.agent).continueRequiresAcp) {
    const owned = sid && jobs ? Object.values(jobs).find((j) => j.agent === session.agent && j.sessionId === sid) : null;
    return (session.transport || owned?.transport) === "acp";
  }
  return true;
}
export const archiveCapableAgents = () => listAgentsByCapability("archiveDetection");
export const permissionCapableAgents = () => listAgentsByCapability("permissionControl");
export const usesDeckSessionLink = (id) => {
  const cap = getAgentCapability(id);
  return !!AGENTS[id]?.trackingOnly || cap.sessionLinkScheme === "obsidian";
};
