// Extensible Harness pipeline: outline/link context resolvers, payload builder, and runner factory.
import { CONFIRM_FIRST } from "./constants.js";
import * as J from "./journal.js";
import { ancestorLines, extractWikilinkRefs, frontmatterEnd, subtreeEnd } from "./outline.js";
import { getAgentCapability } from "./agent-registry.js";
import { stripTaskMention, mentionTrigger } from "./task-mentions.js";
import { t } from "./i18n.js";

export { ancestorLines, extractWikilinkRefs };

const CONTEXT_RESOLVERS = [];

/** Strip internal Agent Deck block IDs and provenance comments outside fenced code blocks. */
export function stripInternalIdentifiers(text) {
  const lines = String(text || "").split("\n");
  const fenced = J.fencedLines(lines);
  return lines.map((line, idx) => {
    if (fenced.has(idx)) return line;
    let out = line.replace(J.RECORD_PROVENANCE_RE, "");
    const id = J.blockIdOf(out);
    if (id && (J.isDeckBlockId(id) || J.isLegacyBlockId(id))) out = J.stripBlockId(out);
    return out;
  }).join("\n");
}

// 注入给 Agent 的文本：去掉对 AI 没意义的排版符号，保留一切"有信息"的记号。
// 删：加粗/斜体包裹、Obsidian 注释 %%…%%、HTML 注释、零宽与不换行字符、行尾空白。
// 留：代码块与行内代码、[[双链]]、#^块号、列表缩进、状态关键词。
export function agentText(text) {
  const stripped = stripInternalIdentifiers(text);
  const lines = String(stripped ?? "").split("\n");
  const fenced = J.fencedLines(lines);
  return lines
    .map((line, i) => {
      if (fenced.has(i)) return line;
      // 行内代码先遮起来，清理完再放回；只去 ** 加粗（不动 __，避免误伤 __name__ 之类）。
      const spans = [];
      const masked = line.replace(/`[^`]*`/g, (m) => `\u0000${spans.push(m) - 1}\u0000`);
      return masked
        .replace(/%%[^%]*?%%/g, "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/[\u200b-\u200f\u2060\ufeff]/g, "")
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+$/, "")
        .replace(/\u0000(\d+)\u0000/g, (_, n) => spans[Number(n)] ?? "");
    })
    .join("\n");
}

// 母项上下文 + 要做的这一块：母项各占一行、保留原缩进，前面一句说明只做最里面那项。
export function withContext(contextLines, task) {
  const cleanTask = agentText(task);
  const ctx = (contextLines || []).map((l) => agentText(l)).filter((l) => l && l.trim());
  if (!ctx.length) return cleanTask;
  return `${t("这条任务在笔记里挂的位置，只做最里面这一项：")}\n\n${ctx.join("\n")}\n${cleanTask}`;
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

const MAX_LINKED_NOTES = 3;
const LINK_EXCERPT_MAX_LINES = 12;
const LINK_EXCERPT_MAX_CHARS = 600;

function dedupeWikilinkRefs(refs = []) {
  const out = [];
  const seen = new Set();
  for (const raw of refs) {
    const target = String(raw?.target || "").trim();
    if (!target) continue;
    const subpath = String(raw?.subpath || "").trim();
    const alias = String(raw?.alias || "").trim();
    const key = `${target}#${subpath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ target, subpath, alias });
  }
  return out;
}

// Markdown 标题子路径（[[笔记#章节]]）：取该标题到下一个同级或更高级标题之前的内容。
function headingSection(lines, title) {
  const want = String(title || "").trim();
  if (!want) return null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (!m || m[2].replace(/#+\s*$/, "").trim() !== want) continue;
    const level = m[1].length;
    let end = i + 1;
    while (end < lines.length) {
      const next = /^(#{1,6})\s+/.exec(lines[end]);
      if (next && next[1].length <= level) break;
      end++;
    }
    return lines.slice(i, end).join("\n");
  }
  return null;
}

// 按整行截断，避免把列表结构或代码块切在半行。
function clampExcerpt(text, maxLines = LINK_EXCERPT_MAX_LINES, maxChars = LINK_EXCERPT_MAX_CHARS) {
  const picked = [];
  let size = 0;
  for (const line of String(text || "").split("\n")) {
    if (picked.length >= maxLines) break;
    const next = size + (picked.length ? 1 : 0) + line.length;
    if (picked.length && next > maxChars) break;
    picked.push(line);
    size = next;
  }
  const out = picked.join("\n").trim();
  return out.length > maxChars ? out.slice(0, maxChars).trimEnd() : out;
}

async function resolveWikilinkSnippets(plugin, file, refs = []) {
  if (!refs.length || !plugin?.readNote || !plugin?.app?.metadataCache?.getFirstLinkpathDest) return "";
  const snippets = [];
  const seen = new Set();
  const rawCache = new Map();
  for (const ref of refs) {
    if (snippets.length >= MAX_LINKED_NOTES) break;
    const dest = plugin.app.metadataCache.getFirstLinkpathDest(ref.target, file?.path || "");
    if (!dest?.path || dest.extension !== "md") continue;
    if (dest.path === file?.path && !ref.subpath) continue;
    // 技能卡只传路径（由派发侧单独处理），不整段注入卡片内容。
    if (dest.path.startsWith("技能/")) continue;
    const key = `${dest.path}#${ref.subpath || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      let raw = rawCache.get(dest.path);
      if (raw == null) {
        raw = await plugin.readNote(dest.path);
        rawCache.set(dest.path, raw);
      }
      const allLines = String(raw || "").split("\n");
      let excerpt = "";
      if (ref.subpath?.startsWith("^")) {
        const bid = ref.subpath.slice(1);
        const idx = allLines.findIndex((l) => J.blockIdOf(l) === bid);
        // 定点块已不存在时宁可不注入，也不拿整篇开头冒充。
        if (idx < 0) continue;
        const end = subtreeEnd(allLines, idx);
        excerpt = allLines.slice(idx, end).join("\n");
      } else if (ref.subpath) {
        // 标题子路径找不到时同样跳过，避免注入无关正文。
        excerpt = headingSection(allLines, ref.subpath) || "";
        if (!excerpt) continue;
      } else {
        excerpt = allLines.slice(frontmatterEnd(allLines)).join("\n");
      }
      const compact = clampExcerpt(agentText(excerpt));
      if (!compact) continue;
      const label = `[[${ref.target}${ref.subpath ? "#" + ref.subpath : ""}${ref.alias ? "|" + ref.alias : ""}]]`;
      snippets.push(`- ${label} (${dest.path}):\n${compact}`);
    } catch { /* unreadable linked note */ }
  }
  return snippets.length ? `${t("关联笔记上下文（[[双链]]）：")}\n${snippets.join("\n")}` : "";
}

export async function resolveDelegationContext({ plugin = null, file = null, lines = [], block, opts = {}, extraResolvers = [] } = {}) {
  const outlineAncestors = Array.isArray(opts.contextLines)
    ? opts.contextLines
    : (Array.isArray(lines) && block ? ancestorLines(lines, block.start) : []);
  const context = {
    plugin,
    file,
    lines,
    block,
    opts,
    contextLines: [...outlineAncestors],
    refs: extractWikilinkRefs([...outlineAncestors, ...(block ? [block.text] : [])], { embeds: true }),
    extraSections: [],
  };
  if (opts?.boardContext && String(opts.boardContext).trim()) {
    context.extraSections.push(String(opts.boardContext).trim());
  }
  // 先跑扩展解析器，把它们补进来的 [[双链]] 也纳入摘要解析。
  const resolverSections = [];
  for (const resolver of [...CONTEXT_RESOLVERS, ...extraResolvers]) {
    if (!resolver || typeof resolver.resolve !== "function") continue;
    try {
      const out = await resolver.resolve(context);
      if (out?.section && typeof out.section === "string" && out.section.trim()) {
        resolverSections.push(out.section.trim());
      }
      if (Array.isArray(out?.refs) && out.refs.length) {
        context.refs.push(...out.refs);
      }
    } catch (e) {
      console.error(`[agent-deck] context resolver ${resolver.name || "anon"}`, e);
    }
  }
  context.refs = dedupeWikilinkRefs(context.refs);
  const linkedSection = await resolveWikilinkSnippets(plugin, file, context.refs);
  if (linkedSection) context.extraSections.push(linkedSection);
  context.extraSections.push(...resolverSections);
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
  const resolved = await resolveDelegationContext({ plugin, file, lines, block, opts, extraResolvers });
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
