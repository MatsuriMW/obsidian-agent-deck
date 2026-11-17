#!/usr/bin/env node
// 运行时记忆查询（只读）。
//
// 形态：CLI 是第一个壳；签名按 docs/specs/harness-roadmap.zh-CN.md D3 冻结，
// 将来换成 MCP 只是同一签名的第二个壳，不改动词、不改输出形状。
//
//   node memory-query.mjs search "关键词" [--k 5] [--since 2026-11-01] [--until 2026-11-18]
//   node memory-query.mjs read <记忆文件名>
//   node memory-query.mjs recent [n] [--since …] [--until …]
//
// 只读：不写库、不建文件、不碰 `记忆.base`。路径含空格由调用方加引号。
// search / recent 只看 `state=有效`（与派发自动注入同一个池子）；read 能打开任何一条。
// search 每条带「命中」当 why，不打印分数。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MEMORY_DIR_DEFAULT = "Agent Deck/记忆";
export const PLUGIN_SUBDIR = path.join(".obsidian", "plugins", "agent-deck");
const MAX_OUTPUT = 6000;

// 与 src/dream.js 的 terms() 同一套切词：拉丁词按 ≥2 字符，中文按二元组。
// 复制而不是 import，是因为这个脚本要能脱离仓库、在库里独立运行。
export const terms = (value) =>
  new Set(
    (String(value || "").toLowerCase().match(/[a-z0-9_-]{2,}|[\u4e00-\u9fff]+/g) || []).flatMap((w) =>
      /^[\u4e00-\u9fff]/.test(w) ? [...w].slice(1).map((c, i) => w[i] + c) : [w],
    ),
  );

const unYamlStr = (value) => {
  const text = String(value ?? "").trim();
  return text.length >= 2 && text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1).replace(/\\(["\\])/g, "$1") : text;
};

// 容忍用户手加的 frontmatter：不认识的键忽略，不报错。
export function parseMemory(content) {
  const lines = String(content || "").replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return null;
  const meta = {};
  let list = "";
  for (const line of lines.slice(1, end)) {
    const m = /^([A-Za-z_][\w-]*):(?:\s*(.*))?$/.exec(line);
    if (m) {
      list = m[2] ? "" : m[1];
      meta[m[1]] = m[2] ? unYamlStr(m[2]) : [];
      continue;
    }
    const item = /^\s+-\s*(.*)$/.exec(line);
    if (item && Array.isArray(meta[list])) meta[list].push(unYamlStr(item[1]));
  }
  const body = lines.slice(end + 1);
  const text = body.find((l) => l.trim() && l.trim() !== "## 证据")?.trim() || "";
  if (!meta.kind || !text) return null;
  const evidence = [];
  const at = body.findIndex((l) => l.trim() === "## 证据");
  if (at >= 0) for (const line of body.slice(at + 1)) {
    const m = /^-\s+(.*)$/.exec(line);
    if (m) evidence.push(m[1].trim());
  }
  return {
    id: meta.id || "",
    kind: meta.kind,
    type: meta.type || "",
    state: ["有效", "已拒绝", "已被替代"].includes(meta.state) ? meta.state : "有效",
    verified: meta.verified === "true",
    date: meta.date || "",
    text,
    sources: Array.isArray(meta.sources) ? meta.sources.filter(Boolean) : [],
    supersedes: Array.isArray(meta.supersedes) ? meta.supersedes.filter(Boolean) : [],
    evidence,
  };
}

// `[[日记/2026_11_03#^mem-04f3aa59]]（用户日志，第 32 行）；原文：…` 只留能跳转的那段。
export const sourceLink = (raw) => (/^\[\[[^\]]+\]\]/.exec(String(raw || "").trim()) || [])[0] || "";

// 记忆目录：优先跟随插件设置 dream.dir，读不到就用默认值。
export function memoryDirOf(vault) {
  try {
    const raw = fs.readFileSync(path.join(vault, PLUGIN_SUBDIR, "data.json"), "utf8");
    const dir = String(JSON.parse(raw)?.settings?.dream?.dir || "").replace(/\/+$/, "");
    if (dir) return path.join(vault, dir);
  } catch {
    /* 没装插件或没设置过 → 默认目录 */
  }
  return path.join(vault, MEMORY_DIR_DEFAULT);
}

// 脚本装在 <库>/.obsidian/plugins/agent-deck/scripts/：向上找到带 .obsidian 的目录就是库根。
export function resolveVault(start) {
  let cur = path.resolve(start || path.dirname(fileURLToPath(import.meta.url)));
  for (;;) {
    if (fs.existsSync(path.join(cur, ".obsidian"))) return cur;
    const up = path.dirname(cur);
    if (up === cur) return "";
    cur = up;
  }
}

export function loadMemories(vault) {
  const dir = memoryDirOf(vault);
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".md"));
  } catch {
    return { dir, entries: [] };
  }
  const entries = [];
  for (const name of names.sort()) {
    try {
      const abs = path.join(dir, name);
      const parsed = parseMemory(fs.readFileSync(abs, "utf8"));
      if (parsed) entries.push({ ...parsed, name: name.replace(/\.md$/, ""), path: abs });
    } catch {
      /* 单条读不了就跳过，不影响其他条目 */
    }
  }
  return { dir, entries };
}

const active = (entries) => entries.filter((e) => e.state === "有效");

// 命中数降序 → 日期降序 → 文件名。
// 门槛：至少要命中查询词的一半（不足一半按 1 算），否则宁可返回空——
// 中文二元组太容易误配（"完全不存在的词"会撞上"存在""在的"），只命中一个词不算相关。
export function searchMemories(entries, query, k = 5) {
  const wanted = terms(query);
  if (!wanted.size) return [];
  const need = Math.max(1, Math.ceil(wanted.size / 2));
  return entries
    .map((e) => ({ entry: e, why: [...terms(e.text)].filter((w) => wanted.has(w)) }))
    .filter((x) => x.why.length >= need)
    .sort((a, b) => b.why.length - a.why.length || String(b.entry.date).localeCompare(String(a.entry.date)) || a.entry.name.localeCompare(b.entry.name))
    .slice(0, Math.max(1, k));
}

// 时间过滤：只认 YYYY-MM-DD；没写日期的条目不参与过滤（在结果尾部说明排除了几条）。
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const inDateRange = (entry, { since = "", until = "" } = {}) => {
  if (!since && !until) return true;
  const day = String(entry?.date || "");
  if (!DATE_RE.test(day)) return false;
  if (since && day < since) return false;
  if (until && day > until) return false;
  return true;
};

// id -> 条；以及"被谁取代"的反查（supersedes 里存的是 id）。
export function buildIndexes(entries = []) {
  const byId = new Map();
  const supersededBy = new Map();
  for (const e of entries) if (e.id) byId.set(e.id, e);
  for (const e of entries) {
    for (const old of e.supersedes || []) {
      if (!supersededBy.has(old)) supersededBy.set(old, []);
      supersededBy.get(old).push(e);
    }
  }
  return { byId, supersededBy };
}

export const linkTarget = (link) => String(link || "").replace(/^\[\[|\]\]$/g, "").split("#")[0].trim();

// `[[日记/2026_11_06#^mem-…]]` → 库里真的能打开的那篇笔记的绝对路径（打不开就不给，不编路径）。
export function notePathOf(vault, target) {
  const rel = String(target || "").trim();
  if (!vault || !rel) return "";
  for (const candidate of [`${rel}.md`, rel]) {
    const abs = path.join(vault, candidate);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  }
  return "";
}

// 一跳邻接：同一来源笔记的其它记忆（同源）+ 来源笔记本身（能读原文）。why 只写事实。
export function neighborsOf(entries = [], entry = null, { vault = "", limit = 2 } = {}) {
  if (!entry) return { coCitation: [], notes: [] };
  const mine = new Set(entry.sources.map(sourceLink).map(linkTarget).filter(Boolean));
  const coCitation = [];
  for (const other of entries) {
    if (other === entry || other.name === entry.name) continue;
    const shared = other.sources.map(sourceLink).map(linkTarget).filter((t) => t && mine.has(t));
    if (shared.length) coCitation.push({ entry: other, shared });
  }
  coCitation.sort((a, b) => b.shared.length - a.shared.length || String(b.entry.date).localeCompare(String(a.entry.date)));
  coCitation.length = Math.min(coCitation.length, limit);
  const notes = [...mine].map((t) => notePathOf(vault, t)).filter(Boolean).slice(0, limit);
  return { coCitation, notes };
}

export function recentMemories(entries, n = 10) {
  return [...entries]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.name.localeCompare(b.name))
    .slice(0, Math.max(1, n));
}

// 只接受记忆目录里的文件名/相对路径，挡住 `../` 越界。
export function findMemory(entries, dir, ref) {
  const want = String(ref || "").trim().replace(/\.md$/, "");
  if (!want) return null;
  const abs = path.resolve(dir, want);
  const inside = abs === path.join(dir, path.basename(abs));
  if (!inside) return null;
  return entries.find((e) => e.path === abs) || entries.find((e) => e.name === path.basename(want)) || null;
}

export const formatEntry = (entry, why = [], extra = {}) => {
  const rows = [
    `${entry.date || "无日期"} [${entry.type || entry.kind}] ${entry.text}`,
    `   文件：${entry.path}`,
  ];
  if (why.length) rows.push(`   命中：${why.join("、")}`);
  const links = entry.sources.map(sourceLink).filter(Boolean);
  if (links.length) rows.push(`   来源：${links.join("、")}`);
  // 取代链：这条换掉了谁 / 它又被谁换掉了 —— 偏好变了就该看见新旧，而不是只看见新的。
  const replaced = (extra.supersedes || []).map((old) => (typeof old === "string" ? old : `[[${old.name}]]（${old.date || "无日期"}）`));
  if (replaced.length) rows.push(`   取代：${replaced.join("、")}`);
  const supersededBy = (extra.supersededBy || []).map((cur) => `[[${cur.name}]]（${cur.date || "无日期"}）`);
  if (supersededBy.length) rows.push(`   已被取代：${supersededBy.join("、")}`);
  const near = extra.neighbors || {};
  const nearBits = [];
  for (const c of near.coCitation || []) nearBits.push(`同源 [[${c.entry.name}]]${c.shared?.length ? `（同引 ${c.shared[0]}）` : ""}`);
  for (const note of near.notes || []) nearBits.push(`原文 ${note}`);
  if (nearBits.length) rows.push(`   邻接：${nearBits.join("；")}`);
  return rows.join("\n");
};

export function formatRead(entry) {
  const rows = [
    `记忆：${entry.text}`,
    `文件：${entry.path}`,
    `类型：${entry.type || entry.kind}　状态：${entry.state}　日期：${entry.date || "无"}${entry.verified ? "　已验证" : ""}`,
  ];
  if (entry.supersedes.length) rows.push(`替代：${entry.supersedes.join("；")}`);
  const links = entry.sources.map(sourceLink).filter(Boolean);
  if (links.length) rows.push("来源：", ...links.map((l) => `- ${l}`));
  rows.push("正文：", entry.text);
  if (entry.evidence.length) rows.push("证据：", ...entry.evidence.map((e) => `- ${e}`));
  return rows.join("\n");
}

const usage = () =>
  ["用法：", '  node memory-query.mjs search "关键词" [--k 5] [--vault /库根]', "  node memory-query.mjs read <记忆文件名> [--vault /库根]", "  node memory-query.mjs recent [n] [--vault /库根]"].join("\n");

// 输出预算：超了要明说省略了几条（静默截断等于骗人）。
function withBudget(blocks) {
  const out = [];
  let size = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (size + blocks[i].length + 1 > MAX_OUTPUT) {
      out.push(`（已省略 ${blocks.length - i} 条，用 --k 缩小范围或直接 read 具体文件）`);
      return out.join("\n");
    }
    out.push(blocks[i]);
    size += blocks[i].length + 1;
  }
  return out.join("\n");
}

export function run(argv, { start } = {}) {
  const [verb, ...rest] = argv;
  const flags = { k: 5, vault: "", dir: "", since: "", until: "" };
  const args = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--k") flags.k = Number(rest[++i]) || 5;
    else if (a === "--vault") flags.vault = rest[++i] || "";
    else if (a === "--since") flags.since = rest[++i] || "";
    else if (a === "--until") flags.until = rest[++i] || "";
    else if (a.startsWith("--k=")) flags.k = Number(a.slice(4)) || 5;
    else if (a.startsWith("--vault=")) flags.vault = a.slice(8);
    else if (a.startsWith("--since=")) flags.since = a.slice(8);
    else if (a.startsWith("--until=")) flags.until = a.slice(8);
    else args.push(a);
  }
  if (!verb || verb === "-h" || verb === "--help") return { code: verb ? 0 : 2, out: usage() };

  // 没给 --vault 就向上找；找不到就报错，不拿当前目录当库根静默跑出空结果。
  const vault = flags.vault ? path.resolve(flags.vault) : resolveVault(start);
  if (!vault || !fs.existsSync(vault)) return { code: 2, out: `找不到库根；用 --vault 指过来：${flags.vault || "(未给)"}` };

  for (const [flag, value] of [["--since", flags.since], ["--until", flags.until]]) {
    if (value && !DATE_RE.test(value)) return { code: 2, out: `${flag} 要写 YYYY-MM-DD，收到的是：${value}` };
  }
  if (flags.since && flags.until && flags.since > flags.until) return { code: 2, out: `--since 比 --until 晚：${flags.since} > ${flags.until}` };

  const { dir, entries } = loadMemories(vault);
  const all = active(entries);
  const pool = all.filter((e) => inDateRange(e, flags));
  const dated = all.length - pool.length;
  const rangeNote = flags.since || flags.until
    ? `（时间过滤 ${flags.since || "…"} → ${flags.until || "…"}：${dated} 条不在区间或无日期，已排除）`
    : "";
  const indexes = buildIndexes(entries);
  const extrasFor = (entry) => ({
    supersedes: (entry.supersedes || []).map((id) => indexes.byId.get(id) || id),
    supersededBy: indexes.supersededBy.get(entry.id) || [],
    neighbors: neighborsOf(pool, entry, { vault, limit: 2 }),
  });

  if (verb === "search") {
    const query = args.join(" ").trim();
    if (!query) return { code: 2, out: usage() };
    const hits = searchMemories(pool, query, flags.k);
    if (!hits.length) {
      const scope = pool.length === all.length ? `可查 ${pool.length} 条有效记忆` : `时间过滤后还有 ${pool.length} 条（原 ${all.length} 条）`;
      return { code: 0, out: `没有匹配「${query}」的记忆（${scope}，目录：${dir}）。${rangeNote}` };
    }
    const blocks = hits.map((h, i) => `${i + 1}. ${formatEntry(h.entry, h.why, extrasFor(h.entry))}`);
    return { code: 0, out: withBudget(blocks) + (rangeNote ? `\n${rangeNote}` : "") };
  }

  if (verb === "recent") {
    const n = Number(args[0]) || 10;
    const list = recentMemories(pool, n);
    if (!list.length) {
      const empty = all.length ? `这段时间里没有记忆（原 ${all.length} 条）` : "记忆库还是空的";
      return { code: 0, out: `${empty}（目录：${dir}）。${rangeNote}` };
    }
    return { code: 0, out: withBudget(list.map((e, i) => `${i + 1}. ${formatEntry(e, [], extrasFor(e))}`)) + (rangeNote ? `\n${rangeNote}` : "") };
  }

  if (verb === "read") {
    const target = args[0];
    if (!target) return { code: 2, out: usage() };
    const hit = findMemory(entries, dir, target);
    if (!hit) return { code: 1, out: `找不到记忆：${target}（目录：${dir}）。先用 search 或 recent 取文件名。` };
    return { code: 0, out: [formatRead(hit), formatEntry(hit, [], extrasFor(hit)).split("\n").slice(2).join("\n")].filter(Boolean).join("\n") };
  }

  return { code: 2, out: `不认识的动词：${verb}\n${usage()}` };
}

const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  const { code, out } = run(process.argv.slice(2));
  (code === 0 ? process.stdout : process.stderr).write(out + "\n");
  process.exitCode = code;
}
