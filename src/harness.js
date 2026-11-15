// Extensible Harness pipeline: outline/link context resolvers, payload builder, and runner factory.
import { CONFIRM_FIRST } from "./constants.js";
import * as J from "./journal.js";
import { ancestorLines, extractWikilinkRefs } from "./outline.js";
import { getAgentCapability } from "./agent-registry.js";
import { stripTaskMention, mentionTrigger } from "./task-mentions.js";
import { t } from "./i18n.js";

export { ancestorLines, extractWikilinkRefs };

const CONTEXT_RESOLVERS = [];

// 母项上下文 + 要做的这一块：母项各占一行、保留原缩进，前面一句说明只做最里面那项。
export function withContext(contextLines, task) {
  const ctx = (contextLines || []).filter((l) => l && l.trim());
  if (!ctx.length) return task;
  return `${t("这条任务在笔记里挂的位置，只做最里面这一项：")}\n\n${ctx.join("\n")}\n${task}`;
}

export function freshTaskText(text) {
  return String(text || "").split("\n").map((l, i) => (i === 0 ? J.stripBlockId(l) : l)).join("\n");
}

export function registerContextResolver(resolver) {
  if (!resolver || typeof resolver.resolve !== "function") {
    throw new Error("Context resolver requires a resolve() function");
  }
  const idx = resolver.name ? CONTEXT_RESOLVERS.findIndex((r) => r.name === resolver.name) : -1;
  if (idx >= 0) CONTEXT_RESOLVERS[idx] = resolver;
  else CONTEXT_RESOLVERS.push(resolver);
  return () => {
    const i = CONTEXT_RESOLVERS.indexOf(resolver);
    if (i >= 0) CONTEXT_RESOLVERS.splice(i, 1);
  };
}

export function clearCustomContextResolvers() {
  CONTEXT_RESOLVERS.length = 0;
}

export async function resolveDelegationContext({ file = null, lines = [], block, opts = {}, extraResolvers = [] } = {}) {
  const outlineAncestors = Array.isArray(opts.contextLines)
    ? opts.contextLines
    : (Array.isArray(lines) && block ? ancestorLines(lines, block.start) : []);
  const context = {
    file,
    lines,
    block,
    opts,
    contextLines: [...outlineAncestors],
    refs: extractWikilinkRefs([...outlineAncestors, ...(block ? [block.text] : [])]),
    extraSections: [],
  };
  for (const resolver of [...CONTEXT_RESOLVERS, ...extraResolvers]) {
    if (!resolver || typeof resolver.resolve !== "function") continue;
    try {
      const out = await resolver.resolve(context);
      if (out?.section && typeof out.section === "string" && out.section.trim()) {
        context.extraSections.push(out.section.trim());
      }
      if (Array.isArray(out?.refs) && out.refs.length) {
        context.refs.push(...out.refs);
      }
    } catch (e) {
      console.error(`[agent-deck] context resolver ${resolver.name || "anon"}`, e);
    }
  }
  return context;
}

export function buildPromptFromContext(plugin, { block, file = null, contextLines = [], extraSections = [], newSession = false, promptSuffix = "" } = {}) {
  const c = plugin?.settings?.delegate || {};
  const parts = [];
  if (c.promptPrefix && c.promptPrefix.trim()) parts.push(c.promptPrefix.trim());
  const task = newSession ? freshTaskText(block?.text || "") : (block?.text || "");
  const trigger = mentionTrigger(plugin);
  parts.push(stripTaskMention(withContext(contextLines, task), trigger).trim());
  for (const sec of extraSections) if (sec && sec.trim()) parts.push(sec.trim());
  if (promptSuffix && promptSuffix.trim()) parts.push(promptSuffix.trim());
  else if (c.promptSuffix && c.promptSuffix.trim()) parts.push(c.promptSuffix.trim());
  if (file?.path) parts.push(`\n（来自 Obsidian：${file.path}）`);
  if (c.confirmFirst !== false) {
    const prompt = c.confirmFirstPrompt ?? CONFIRM_FIRST;
    if (prompt.trim()) parts.push(prompt.trim());
  }
  return parts.filter(Boolean).join("\n\n");
}

export async function buildDelegationPayload({ plugin, file, lines, block, opts = {}, extraResolvers = [] }) {
  const resolved = await resolveDelegationContext({ file, lines, block, opts, extraResolvers });
  const trigger = mentionTrigger(plugin);
  const question = stripTaskMention(withContext(resolved.contextLines, freshTaskText(block?.text || "")), trigger);
  const prompt = buildPromptFromContext(plugin, {
    block,
    file,
    contextLines: resolved.contextLines,
    extraSections: resolved.extraSections,
    newSession: opts.newSession,
    promptSuffix: opts.promptSuffix,
  });
  return {
    contextLines: resolved.contextLines,
    refs: resolved.refs,
    question,
    prompt,
  };
}

export function createDelegationRunner(agent, delegator, job, classes, openDesktopSession) {
  const cap = getAgentCapability(agent);
  const RunnerClass = classes?.[cap.runnerKind] || classes?.claude;
  if (!RunnerClass) throw new Error(`No runner registered for ${agent} (${cap.runnerKind})`);
  if (cap.runnerKind === "codex" && typeof openDesktopSession === "function") {
    return new RunnerClass(delegator, job, openDesktopSession);
  }
  return new RunnerClass(delegator, job);
}

export class HarnessPipeline {
  constructor() {
    this.hooks = [];
  }

  use(hook) {
    if (!hook || typeof hook !== "object") return () => {};
    this.hooks.push(hook);
    return () => {
      const idx = this.hooks.indexOf(hook);
      if (idx >= 0) this.hooks.splice(idx, 1);
    };
  }

  async run(phase, payload) {
    for (const hook of this.hooks) {
      const fn = hook?.[phase];
      if (typeof fn !== "function") continue;
      try {
        await fn(payload);
      } catch (e) {
        console.error(`[agent-deck] harness hook ${phase}`, e);
      }
    }
    return payload;
  }
}
