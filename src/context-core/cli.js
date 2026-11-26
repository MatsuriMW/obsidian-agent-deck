// Pure Node CLI entry bundled into `scripts/memory-query.mjs`.
// Preserves all 6 memory verbs and adds 4 read-only Vault context verbs.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MEMORY_DIR_DEFAULT,
  MEMORY_LOG_FILE,
  MEMORY_ARCHIVE_SUBDIR,
  STOP_LATIN,
  STOP_CJK,
  DATE_RE,
  rawTerms,
  terms,
  deriveProvenance,
  deriveTrustLevel,
  isMemoryStale,
  parseMemory,
  sourceLink,
  readPluginConfig,
  memoryDirOf,
  excludedDirsOf,
  resolveVault,
  classifyAnchorStatus,
  countArchivedMemories,
  loadMemories,
  searchMemories,
  inDateRange,
  buildIndexes,
  linkTarget,
  notePathOf,
  neighborsOf,
  graphOf,
  formatGraph,
  recentMemories,
  findMemory,
  formatEntry,
  formatRead,
  formatIndex,
  formatStats,
  proposeMemory,
  activeMemories,
  withBudget,
} from "./memory-ops.js";
import {
  vaultFind,
  formatVaultFind,
  vaultOutline,
  formatVaultOutline,
  vaultRead,
  formatVaultRead,
  vaultRelated,
  formatVaultRelated,
} from "./vault-ops.js";
import {
  listMcpClients,
  installMcpClient,
  uninstallMcpClient,
  verifyMcpHandshake,
} from "./mcp-clients.js";
import { isMainModule, resolvePluginScriptsDir } from "./config.js";

export {
  MEMORY_DIR_DEFAULT,
  MEMORY_LOG_FILE,
  MEMORY_ARCHIVE_SUBDIR,
  STOP_LATIN,
  STOP_CJK,
  DATE_RE,
  rawTerms,
  terms,
  deriveProvenance,
  deriveTrustLevel,
  isMemoryStale,
  parseMemory,
  sourceLink,
  readPluginConfig,
  memoryDirOf,
  excludedDirsOf,
  resolveVault,
  classifyAnchorStatus,
  countArchivedMemories,
  loadMemories,
  searchMemories,
  inDateRange,
  buildIndexes,
  linkTarget,
  notePathOf,
  neighborsOf,
  graphOf,
  formatGraph,
  recentMemories,
  findMemory,
  formatEntry,
  formatRead,
  formatIndex,
  formatStats,
  proposeMemory,
  vaultFind,
  formatVaultFind,
  vaultOutline,
  formatVaultOutline,
  vaultRead,
  formatVaultRead,
  vaultRelated,
  formatVaultRelated,
};

const usage = () =>
  [
    "用法：",
    '  node memory-query.mjs index [--kind K] [--project P] [--k 30] [--vault /库根]',
    '  node memory-query.mjs search "关键词" [--k 5] [--kind K] [--project P] [--verified] [--trust human|user|ai] [--include-stale] [--all] [--vault /库根]',
    "  node memory-query.mjs graph <记忆文件名/ID/概念名> [--depth 2] [--vault /库根]",
    "  node memory-query.mjs read <记忆文件名或ID> [--vault /库根]",
    "  node memory-query.mjs recent [n] [--kind K] [--project P] [--verified] [--trust human|user|ai] [--vault /库根]",
    "  node memory-query.mjs stats [--vault /库根]",
    '  node memory-query.mjs vault-find "关键词" [--k 8] [--domain D] [--type T] [--tag TG] [--no-fulltext] [--vault /库根]',
    "  node memory-query.mjs vault-outline <笔记名/路径> [--vault /库根]",
    "  node memory-query.mjs vault-read <笔记名/路径/#章节/#^块号> [--start N] [--lines 120] [--hash H] [--include-ai-logs] [--vault /库根]",
    "  node memory-query.mjs vault-related <笔记名/路径> [--k 8] [--vault /库根]",
    "  node memory-query.mjs mcp-clients [--allow-write] [--vault /库根]",
    "  node memory-query.mjs mcp-install <客户端ID|all> [--allow-write] [--vault /库根]",
    "  node memory-query.mjs mcp-uninstall <客户端ID>",
  ].join("\n");

export function run(argv, { start } = {}) {
  const [verb, ...rest] = argv;
  const flags = {
    k: 5,
    kExplicit: false,
    depth: 2,
    vault: "",
    dir: "",
    since: "",
    until: "",
    kind: "",
    project: "",
    verified: false,
    includeStale: false,
    trust: "",
    all: false,
    domain: "",
    type: "",
    tag: "",
    start: 0,
    startChar: 0,
    lines: 120,
    hash: "",
    indexDir: "",
    configDir: "",
    fulltext: true,
    allowWrite: false,
    includeAiLogs: false,
  };
  const args = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--k") { flags.k = Number(rest[++i]) || 5; flags.kExplicit = true; }
    else if (a === "--depth") flags.depth = Number(rest[++i]) || 2;
    else if (a === "--vault") flags.vault = rest[++i] || "";
    else if (a === "--since") flags.since = rest[++i] || "";
    else if (a === "--until") flags.until = rest[++i] || "";
    else if (a === "--kind") flags.kind = rest[++i] || "";
    else if (a === "--project") flags.project = rest[++i] || "";
    else if (a === "--verified") flags.verified = true;
    else if (a === "--include-stale") flags.includeStale = true;
    else if (a === "--trust") flags.trust = rest[++i] || "";
    else if (a === "--all") flags.all = true;
    else if (a === "--no-fulltext") flags.fulltext = false;
    else if (a === "--allow-write") flags.allowWrite = true;
    else if (a === "--include-ai-logs") flags.includeAiLogs = true;
    else if (a === "--domain") flags.domain = rest[++i] || "";
    else if (a === "--type") flags.type = rest[++i] || "";
    else if (a === "--tag") flags.tag = rest[++i] || "";
    else if (a === "--start") flags.start = Number(rest[++i]) || 0;
    else if (a === "--start-char") flags.startChar = Number(rest[++i]) || 0;
    else if (a === "--lines") flags.lines = Number(rest[++i]) || 120;
    else if (a === "--hash") flags.hash = rest[++i] || "";
    else if (a === "--index-dir") flags.indexDir = rest[++i] || "";
    else if (a === "--config-dir") flags.configDir = rest[++i] || "";
    else if (a.startsWith("--k=")) { flags.k = Number(a.slice(4)) || 5; flags.kExplicit = true; }
    else if (a.startsWith("--depth=")) flags.depth = Number(a.slice(8)) || 2;
    else if (a.startsWith("--vault=")) flags.vault = a.slice(8);
    else if (a.startsWith("--since=")) flags.since = a.slice(8);
    else if (a.startsWith("--until=")) flags.until = a.slice(8);
    else if (a.startsWith("--kind=")) flags.kind = a.slice(7);
    else if (a.startsWith("--project=")) flags.project = a.slice(10);
    else if (a.startsWith("--trust=")) flags.trust = a.slice(8);
    else if (a.startsWith("--domain=")) flags.domain = a.slice(9);
    else if (a.startsWith("--type=")) flags.type = a.slice(7);
    else if (a.startsWith("--tag=")) flags.tag = a.slice(6);
    else if (a.startsWith("--start=")) flags.start = Number(a.slice(8)) || 0;
    else if (a.startsWith("--start-char=")) flags.startChar = Number(a.slice(13)) || 0;
    else if (a.startsWith("--lines=")) flags.lines = Number(a.slice(8)) || 120;
    else if (a.startsWith("--hash=")) flags.hash = a.slice(7);
    else if (a.startsWith("--index-dir=")) flags.indexDir = a.slice(12);
    else if (a.startsWith("--config-dir=")) flags.configDir = a.slice(13);
    else args.push(a);
  }
  if (!verb || verb === "-h" || verb === "--help") return { code: verb ? 0 : 2, out: usage() };

  const resolveScriptSibling = (vaultRoot = "") => {
    const sibling = path.join(path.dirname(fileURLToPath(import.meta.url)), "memory-mcp.mjs");
    if (fs.existsSync(sibling)) return sibling;
    return vaultRoot ? path.join(resolvePluginScriptsDir(vaultRoot), "memory-mcp.mjs") : "";
  };

  if (verb === "mcp-uninstall") {
    const id = args[0] || "";
    if (!id) return { code: 2, out: usage() };
    try {
      const res = uninstallMcpClient(id);
      return { code: 0, out: res.removed ? `已移除 ${id}（${res.configPath}）` : `${id} 未写入，无需移除` };
    } catch (e) {
      return { code: 1, out: e?.message || String(e) };
    }
  }

  const vault = flags.vault ? path.resolve(flags.vault) : resolveVault(start);
  if (!vault || !fs.existsSync(vault)) return { code: 2, out: `找不到库根；用 --vault 指过来：${flags.vault || "(未给)"}` };

  const indexOpts = {
    ...(flags.indexDir ? { indexDir: flags.indexDir, persist: true } : {}),
    ...(flags.configDir ? { configDir: flags.configDir } : {}),
  };

  if (verb === "mcp-clients") {
    const mcpScript = resolveScriptSibling(vault);
    const list = listMcpClients({ vaultPath: vault, mcpScript, allowWrite: flags.allowWrite, configDir: flags.configDir });
    const lines = list.map((c) => `- ${c.id} (${c.label})：${c.status}${c.detected ? "" : " [未检测到]"} — ${c.configPath}`);
    return { code: 0, out: lines.join("\n") };
  }

  if (verb === "mcp-install") {
    const target = args[0] || "";
    if (!target) return { code: 2, out: usage() };
    const mcpScript = resolveScriptSibling(vault);
    const list = target === "all"
      ? listMcpClients({ vaultPath: vault, mcpScript, allowWrite: flags.allowWrite, configDir: flags.configDir }).filter((c) => c.detected).map((c) => c.id)
      : [target];
    if (!list.length) return { code: 1, out: "未检测到已安装的外部 MCP 客户端目录" };
    const results = [];
    for (const id of list) {
      const r = installMcpClient(id, { vaultPath: vault, mcpScript, allowWrite: flags.allowWrite, configDir: flags.configDir });
      results.push(`已写入 ${r.label} → ${r.configPath}（${r.restartHint}）`);
    }
    const hs = verifyMcpHandshake({ mcpScript, vaultPath: vault, allowWrite: flags.allowWrite, indexDir: flags.indexDir, configDir: flags.configDir });
    if (hs.ok) results.push(`握手校验通过：${hs.toolsCount} 个工具（${hs.latencyMs}ms）`);
    return { code: hs.ok ? 0 : 1, out: results.join("\n") };
  }

  if (verb === "vault-find") {
    const query = args.join(" ").trim();
    if (!query && !flags.domain && !flags.type && !flags.tag) return { code: 2, out: usage() };
    const k = flags.kExplicit ? flags.k : 8;
    const res = vaultFind(vault, query, { k, domain: flags.domain, type: flags.type, tag: flags.tag, fulltext: flags.fulltext, indexOpts });
    return { code: 0, out: formatVaultFind(res) };
  }

  if (verb === "vault-outline") {
    const target = args.join(" ").trim();
    if (!target) return { code: 2, out: usage() };
    const res = vaultOutline(vault, target, { indexOpts });
    return { code: res.ok ? 0 : 1, out: formatVaultOutline(res) };
  }

  if (verb === "vault-read") {
    const target = args.join(" ").trim();
    if (!target) return { code: 2, out: usage() };
    const res = vaultRead(vault, target, {
      startLine: flags.start,
      startChar: flags.startChar,
      maxLines: flags.lines,
      expectedHash: flags.hash,
      includeAiLogs: flags.includeAiLogs,
      indexOpts,
    });
    return { code: res.ok ? 0 : 1, out: formatVaultRead(res) };
  }

  if (verb === "vault-related") {
    const target = args.join(" ").trim();
    if (!target) return { code: 2, out: usage() };
    const k = flags.kExplicit ? flags.k : 8;
    const res = vaultRelated(vault, target, { k, indexOpts });
    return { code: res.ok ? 0 : 1, out: formatVaultRelated(res) };
  }

  for (const [flag, value] of [["--since", flags.since], ["--until", flags.until]]) {
    if (value && !DATE_RE.test(value)) return { code: 2, out: `${flag} 要写 YYYY-MM-DD，收到的是：${value}` };
  }
  if (flags.since && flags.until && flags.since > flags.until) return { code: 2, out: `--since 比 --until 晚：${flags.since} > ${flags.until}` };

  const includeArchived = Boolean(flags.all) && (verb === "search" || verb === "recent");
  const { dir, entries } = loadMemories(vault, { includeArchived, configDir: flags.configDir });
  const all = flags.all ? entries.filter((e) => !e.private) : activeMemories(entries);
  const pool = all.filter((e) => inDateRange(e, flags));
  const dated = all.length - pool.length;
  const rangeNote = flags.since || flags.until
    ? `（时间过滤 ${flags.since || "…"} → ${flags.until || "…"}：${dated} 条不在区间或无日期，已排除）`
    : "";
  const indexes = buildIndexes(entries);
  const extrasFor = (entry) => ({
    supersedes: (entry.supersedes || []).map((id) => indexes.resolveRef(id) || id),
    supersededBy: indexes.supersededBy.get(entry.id) || indexes.supersededBy.get(entry.name) || [],
    neighbors: neighborsOf(pool, entry, { vault, limit: 2 }),
  });

  if (verb === "index") {
    return { code: 0, out: formatIndex(pool, { kind: flags.kind, project: flags.project, limit: flags.k === 5 ? 30 : flags.k }) };
  }

  if (verb === "stats") {
    return { code: 0, out: formatStats(entries, { vault, archivedCount: countArchivedMemories(vault, { configDir: flags.configDir }) }) };
  }

  if (verb === "graph") {
    const target = args.join(" ").trim();
    if (!target) return { code: 2, out: usage() };
    return { code: 0, out: formatGraph(graphOf(entries, target, { vault, depth: flags.depth })) };
  }

  if (verb === "search") {
    const query = args.join(" ").trim();
    if (!query) return { code: 2, out: usage() };
    const hits = searchMemories(pool, query, flags.k, {
      kind: flags.kind,
      project: flags.project,
      verifiedOnly: flags.verified,
      includeStale: flags.all || flags.includeStale,
      trust: flags.trust,
    });
    if (!hits.length) {
      const scope = pool.length === all.length ? `可查 ${pool.length} 条有效记忆` : `时间过滤后还有 ${pool.length} 条（原 ${all.length} 条）`;
      return { code: 0, out: `没有匹配「${query}」的记忆（${scope}，目录：${dir}）。${rangeNote}` };
    }
    const blocks = hits.map((h, i) => `${i + 1}. ${formatEntry(h.entry, h.why, extrasFor(h.entry))}`);
    return { code: 0, out: withBudget(blocks) + (rangeNote ? `\n${rangeNote}` : "") };
  }

  if (verb === "recent") {
    const n = Number(args[0]) || 10;
    const list = recentMemories(pool, n, {
      kind: flags.kind,
      project: flags.project,
      verifiedOnly: flags.verified,
      includeStale: flags.all || flags.includeStale,
      trust: flags.trust,
    });
    if (!list.length) {
      const empty = all.length ? `这段时间里没有记忆（原 ${all.length} 条）` : "记忆库还是空的";
      return { code: 0, out: `${empty}（目录：${dir}）。${rangeNote}` };
    }
    return { code: 0, out: withBudget(list.map((e, i) => `${i + 1}. ${formatEntry(e, [], extrasFor(e))}`)) + (rangeNote ? `\n${rangeNote}` : "") };
  }

  if (verb === "read") {
    const target = args[0];
    if (!target) return { code: 2, out: usage() };
    let allEntries = entries;
    let hit = findMemory(allEntries, dir, target);
    if (!hit) {
      allEntries = loadMemories(vault, { includeArchived: true, configDir: flags.configDir }).entries;
      hit = findMemory(allEntries, dir, target);
    }
    if (!hit) return { code: 1, out: `找不到记忆：${target}（目录：${dir}）。先用 search 或 recent 取文件名。` };
    const readIndexes = buildIndexes(allEntries);
    const readExtras = {
      supersedes: (hit.supersedes || []).map((id) => readIndexes.resolveRef(id) || id),
      supersededBy: readIndexes.supersededBy.get(hit.id) || readIndexes.supersededBy.get(hit.name) || [],
      neighbors: neighborsOf(pool, hit, { vault, limit: 2 }),
    };
    return { code: 0, out: [formatRead(hit), formatEntry(hit, [], readExtras).split("\n").slice(2).join("\n")].filter(Boolean).join("\n") };
  }

  return { code: 2, out: `不认识的动词：${verb}\n${usage()}` };
}

if (isMainModule(import.meta.url)) {
  const { code, out } = run(process.argv.slice(2));
  (code === 0 ? process.stdout : process.stderr).write(out + "\n");
  process.exitCode = code;
}
