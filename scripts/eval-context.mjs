#!/usr/bin/env node
// Offline evaluation suite for Agent Deck's context engine:
// 1) Memory recall, precision, budget & privacy-gate compliance
// 2) Harness zero-silent-loss & privacy boundary integrity
// 3) ContextBundle KV-cache prefix stability across follow-up turns

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { pickMemoriesFromEntries } from "../src/memory-query-core.js";
import {
  agentText,
  buildDelegationPayload,
  createContextBundle,
  estimateTokens,
  renderContextBundle,
} from "../src/harness.js";
import { parseThread, replyPromptText } from "../src/thread-replies.js";
import { clearVaultIndexCache } from "../src/context-core/index.js";
import { vaultFind } from "../src/context-core/vault-ops.js";

const MEMORY_CORPUS = [
  { id: "m1", kind: "项目经验", type: "经验", state: "有效", text: "使用 esbuild 打包插件时必须保留 obsidian 为 external，否则运行期报错", tags: ["build", "esbuild"], domain: "engineering", sources: ["[[构建规范]]"] },
  { id: "m2", kind: "事实", type: "约束", state: "有效", text: "Windows 端没有 osascript，终端派发需要走 PowerShell 或 Windows Terminal", tags: ["windows", "terminal"], domain: "cross-platform", sources: ["[[跨平台兼容]]"] },
  { id: "m3", kind: "偏好", type: "风格", state: "有效", text: "日志排版偏好简洁时间段加粗与关键记录 Pin 标记", tags: ["journal", "layout"], domain: "workflow", sources: ["[[日记规范]]"] },
  { id: "m4", kind: "事实", type: "密钥", state: "有效", private: true, text: "私有日记里记录的 esbuild 内部调试密钥 sk-secret-12345", tags: ["esbuild"], domain: "private", sources: ["[[私密笔记]]"] },
  { id: "m5", kind: "待验证规律", type: "假设", state: "已拒绝", text: "已经拒绝的旧 esbuild 配置方案不应再注入", tags: ["esbuild"], domain: "engineering", sources: ["[[旧方案]]"] },
  { id: "m6", kind: "lesson", type: "项目经验", state: "有效", text: "修改日志解析或清洗规则后必须递增 USAGE_CACHE_VERSION 避免旧缓存污染", tags: ["sqlite", "cache"], domain: "readers", sources: ["[[缓存迁移]]"] },
  { id: "m7", kind: "preference", type: "约束", state: "有效", text: "缺失 token 或活跃时段时绝不估算数值，保留真实空值", tags: ["metrics", "analytics"], domain: "readers", sources: ["[[口径规范]]"] },
  { id: "m8", kind: "preference", type: "偏好", state: "有效", text: "用户在 A 股投资中偏向科技板块并回避红利股", tags: ["投资"], domain: "finance", sources: ["[[投资笔记]]"] },
  { id: "m9", kind: "fact", type: "事实", state: "有效", text: "用户日常需要 7.5 小时睡眠并按 R90 周期计算作息", tags: ["health"], domain: "life", sources: ["[[作息]]"] },
  { id: "m10", kind: "fact", type: "事实", state: "有效", text: "在设计信息流块的排序与交互时，采用 Pin 置顶、双击 Zoom In 与访问频次加权排序", tags: ["ui", "feed"], sources: ["[[日记/2026_11_20]]（用户日志，第 9—9 行）；原文：排序"] },
  { id: "m11", kind: "fact", type: "事实", state: "有效", staleAfter: "2020-01-01", text: "2020 年早期的旧 esbuild 临时调试参数，已过复核截止期", tags: ["esbuild"], sources: ["[[旧日记]]"] },
  { id: "m12", kind: "lesson", type: "项目经验", state: "有效", verified: false, provenance: "ai-log", text: "AI 记录建议增加自动签名发布流程，该方案尚未实施不能视为已验证", tags: ["release"], sources: ["[[日记/x]]（AI 记录，第 1—1 行）；原文：建议"] },
  { id: "m13", kind: "lesson", type: "项目经验", state: "有效", verified: true, provenance: "user-log", text: "发布安装包前统一校验发布签名与清单版本对齐", tags: ["release"], sources: ["[[日记/y]]（用户日志，第 2—2 行）；原文：签名"] },
  { id: "m14", kind: "preference", type: "偏好", state: "有效", concepts: ["[[视频口播]]"], text: "脚本开头用悬念问题引入可显著提升留存", sources: ["[[日记/z]]（用户日志，第 3—3 行）；原文：悬念"] },
];

const M15_WIN_PREF = { id: "m15", kind: "preference", type: "偏好", state: "有效", project: "agent-deck", text: "用户在多端协作项目（如 Agent Deck）中由合作方主导 Windows 优化，自己负责 macOS 主线", sources: ["[[日记/w1]]（用户日志，第 1—1 行）；原文：Windows"] };
const M16_WIN_LESSON = { id: "m16", kind: "lesson", type: "项目经验", state: "有效", project: "agent-deck", text: "跨平台测试在 Windows 环境下不能手写 POSIX 路径期望值，必须用 path.resolve 与正斜杠归一化", sources: ["[[日记/w2]]（用户日志，第 2—2 行）；原文：POSIX"] };
const M17_ESBUILD_DUP = { id: "m17", kind: "lesson", type: "项目经验", state: "有效", verified: false, trust: "ai-derived", project: "agent-deck", text: "使用 esbuild 打包插件时必须保留 obsidian 为 external，否则构建运行期必然报错", sources: ["[[构建规范2]]"] };

const MEMORY_CASES = [
  { name: "single-latin-term-esbuild", query: "排查 esbuild 打包报错", expected: ["m1"], forbidden: ["m4", "m5", "m11"] },
  { name: "single-latin-term-windows", query: "适配 windows 终端启动", expected: ["m2"], forbidden: ["m4", "m5", "m11"] },
  { name: "chinese-bigram-journal", query: "优化日志排版和Pin标记", expected: ["m3"], forbidden: ["m4", "m5"] },
  { name: "metadata-channel-sqlite", query: "检查 sqlite 缓存逻辑", expected: ["m6"], forbidden: ["m4", "m5"] },
  { name: "chinese-metrics-constraint", query: "处理缺失token的统计口径", expected: ["m7"], forbidden: ["m4", "m5"] },
  { name: "hybrid-term-ashare", query: "梳理 A股 投资偏好", expected: ["m8"], forbidden: ["m4", "m5"] },
  { name: "domain-routing-code-filters-personal-fact", query: "排查 esbuild 睡眠周期 R90 打包", expected: ["m1"], forbidden: ["m4", "m5", "m9", "m11"], opts: { projectName: "agent-deck", isCodeProject: true } },
  { name: "domain-routing-keeps-design-fact-in-code-task", query: "设计信息流 Pin 块排序与双击 Zoom In 交互", expected: ["m10"], forbidden: ["m4", "m5", "m9"], opts: { projectName: "info-feed", isCodeProject: true } },
  { name: "trust-outranks-unverified-proposal", query: "校验安装包发布签名流程", expected: ["m13", "m12"], first: "m13", forbidden: ["m4", "m5", "m11"] },
  { name: "graph-seed-zero-lexical-recall", query: "整理下期视频的开头结构", expected: ["m14"], forbidden: ["m4", "m5", "m11"], opts: { graphHits: new Map([["m14", { hop: 1, via: "视频口播", bonus: 3.2 }]]) } },
  { name: "unrelated-noise-zero-recall", query: "今天中午吃什么拉面", expected: [], forbidden: ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10", "m11", "m12", "m13", "m14"] },
  {
    name: "multiterm-coverage-ranks-lesson-first",
    corpus: [MEMORY_CORPUS[0], MEMORY_CORPUS[3], MEMORY_CORPUS[4], MEMORY_CORPUS[10], M15_WIN_PREF, M16_WIN_LESSON],
    query: "处理 Windows 路径兼容",
    expected: ["m16", "m15"],
    first: "m16",
    forbidden: ["m4", "m5", "m11"],
    opts: { projectName: "agent-deck", isCodeProject: true, limit: 2 },
  },
  {
    name: "near-duplicate-diversity-filter",
    corpus: [{ ...MEMORY_CORPUS[0], verified: true, trust: "human-reviewed", project: "agent-deck" }, M17_ESBUILD_DUP, MEMORY_CORPUS[5], MEMORY_CORPUS[3], MEMORY_CORPUS[4], MEMORY_CORPUS[10]],
    query: "排查 esbuild external 打包运行报错与缓存迁移 sqlite",
    expected: ["m1", "m6"],
    first: "m1",
    forbidden: ["m17", "m4", "m5", "m11"],
    opts: { projectName: "agent-deck", isCodeProject: true, limit: 2 },
  },
];

function evalMemoryRetrieval() {
  let expectedHits = 0;
  let expectedTotal = 0;
  let returnedTotal = 0;
  let relevantReturned = 0;
  let privacyLeaks = 0;
  let budgetViolations = 0;
  let orderMismatches = 0;
  const maxChars = 220;

  for (const c of MEMORY_CASES) {
    const picked = pickMemoriesFromEntries(c.corpus || MEMORY_CORPUS, c.query, { limit: 3, maxChars, ...(c.opts || {}) });
    const ids = picked.map((e) => e.id);
    if (c.first && ids[0] !== c.first) orderMismatches++;
    const totalChars = picked.reduce((sum, e) => sum + `- ${e.type || e.kind || ""}：${e.text}`.length + 1, 0);
    if (totalChars > maxChars) budgetViolations++;

    for (const id of c.expected) {
      expectedTotal++;
      if (ids.includes(id)) expectedHits++;
    }
    for (const id of ids) {
      returnedTotal++;
      if (c.expected.includes(id)) relevantReturned++;
      if (c.forbidden.includes(id)) privacyLeaks++;
    }
  }

  return {
    cases: MEMORY_CASES.length,
    recall: expectedTotal ? expectedHits / expectedTotal : 1,
    precision: returnedTotal ? relevantReturned / returnedTotal : 1,
    privacyLeaks,
    budgetViolations,
    orderMismatches,
  };
}

function makeFakePlugin(notes, excludedDirs = []) {
  return {
    settings: { delegate: { confirmFirst: false, excludedDirs } },
    app: {
      metadataCache: {
        getFirstLinkpathDest: (target) => {
          const hit = notes[target];
          return hit ? { path: hit.path, extension: "md" } : null;
        },
      },
    },
    readNote: async (p) => {
      const hit = Object.values(notes).find((n) => n.path === p);
      if (!hit) throw new Error(`missing:${p}`);
      return hit.content;
    },
  };
}

async function evalHarnessIntegrity() {
  const longBody = [
    "# 总纲",
    ...Array.from({ length: 18 }, (_, i) => `- 第 ${i + 1} 条规范细节，用于验证长文摘录截断与后续标题目录生成。`),
    "## 部署检查",
    "这里是部署检查章节",
    "## 回滚预案",
    "这里是回滚预案章节",
  ].join("\n");

  const notes = {
    Doc1: { path: "docs/Doc1.md", content: longBody },
    Doc2: { path: "docs/Doc2.md", content: "Doc2 正文" },
    Doc3: { path: "docs/Doc3.md", content: "Doc3 正文" },
    Doc4: { path: "docs/Doc4.md", content: "Doc4 第4篇超出内联上限应输出路径指针" },
    SecretNote: { path: "private/SecretNote.md", content: "---\nprivate: true\n---\n绝密内容_DO_NOT_LEAK" },
    ExcludedDirNote: { path: "VaultSecrets/Creds.md", content: "排除目录内容_DO_NOT_LEAK" },
  };
  const plugin = makeFakePlugin(notes, ["VaultSecrets"]);

  let passed = 0;
  let total = 0;
  let privacyLeaks = 0;
  let silentLosses = 0;

  // Case 1: >3 wikilinks should disclose omitted link paths (no silent drop) + TOC on truncated note
  {
    total++;
    const line = "- TODO 参考 [[Doc1]] [[Doc2]] [[Doc3]] [[Doc4]]";
    const { prompt, bundle } = await buildDelegationPayload({
      plugin,
      file: { path: "日记/2026_11_19.md" },
      lines: [line],
      block: { start: 0, end: 0, text: line },
    });
    const okOverflow = prompt.includes("docs/Doc4.md");
    const okToc = prompt.includes("## 部署检查(L");
    if (!okOverflow || !okToc || bundle.stats.omittedLinks !== 1) silentLosses++;
    else passed++;
  }

  // Case 2: missing block-id & missing heading emit explicit warnings
  {
    total++;
    const line = "- TODO 检查 [[Doc2#^ad-missing]] 与 [[Doc2#不存在章节]]";
    const { prompt, bundle } = await buildDelegationPayload({
      plugin,
      file: { path: "日记/2026_11_19.md" },
      lines: [line],
      block: { start: 0, end: 0, text: line },
    });
    if (bundle.warnings.length >= 2 && prompt.includes("#^ad-missing") && prompt.includes("#不存在章节")) passed++;
    else silentLosses++;
  }

  // Case 3: private frontmatter & excludedDirs never leak content or paths
  {
    total++;
    const line = "- TODO 读取 [[SecretNote]] 和 [[ExcludedDirNote]]";
    const { prompt, bundle } = await buildDelegationPayload({
      plugin,
      file: { path: "日记/2026_11_19.md" },
      lines: [line],
      block: { start: 0, end: 0, text: line },
    });
    if (prompt.includes("DO_NOT_LEAK") || prompt.includes("SecretNote.md") || prompt.includes("Creds.md")) {
      privacyLeaks++;
    } else if (bundle.stats.omittedPrivate === 2) {
      passed++;
    } else {
      silentLosses++;
    }
  }

  return { total, passed, privacyLeaks, silentLosses };
}

function evalPrefixCacheStability() {
  const plugin = { settings: { delegate: { confirmFirst: false, promptPrefix: "SYSTEM_PREFIX" } } };
  const mk = (replyText, task) => {
    const b = createContextBundle(plugin, {
      block: { start: 0, end: 0, text: task },
      file: { path: "日记/2026_11_19.md" },
      linkedSection: "关联笔记：[[架构]]",
    });
    b.prefix.memoryHint = "memory-query.mjs hint";
    b.prefix.skillLine = "使用技能：eval（/skills/eval.md）";
    b.entries.notePaths = "- /vault/docs/arch.md";
    b.tail.replyText = replyText;
    return renderContextBundle(b);
  };

  const turn1 = mk("❓ 你想先改哪个文件？\n✍️ 答：先改 harness.js", "- TODO 拆分上下文引擎");
  const turn2 = mk("❓ 下一步还要加测试吗？\n✍️ 答：要，加离线评测", "- TODO 拆分上下文引擎");
  const anchor = "- TODO 拆分上下文引擎";
  const prefix1 = turn1.slice(0, turn1.indexOf(anchor));
  const prefix2 = turn2.slice(0, turn2.indexOf(anchor));
  const driftCount = prefix1.length > 0 && prefix1 === prefix2 ? 0 : 1;
  return { prefixBytes: Buffer.byteLength(prefix1, "utf8"), driftCount };
}

function evalPromptHygiene() {
  const sample = [
    "- TODO **检查** `__init__` 与 %%内部注释%% <!-- ad-pin --> ^ad-abc123",
    "  - 来源锚点保留 ^mem-deadbeef",
    "  ```js",
    "  const keep = '^ad-codeblock'; // **stay**",
    "  ```",
  ].join("\n");
  const cleaned = agentText(sample);
  const strippedOk =
    !cleaned.includes("^ad-abc123") &&
    !cleaned.includes("ad-pin") &&
    !cleaned.includes("内部注释") &&
    cleaned.includes("__init__") &&
    cleaned.includes("^mem-deadbeef") &&
    cleaned.includes("^ad-codeblock") &&
    cleaned.includes("**stay**");

  const lines = [
    "- DOING 派发任务 ^ad-root1",
    "\t- ❓ 要保留兼容性吗？ ^ad-q-11111111",
    "\t- ✍️ 答：保留现有配置字段 ^ad-a-11111111",
  ];
  const block = { start: 0, end: 2, text: lines.join("\n") };
  const replyOut = replyPromptText(parseThread(lines, block));
  const replyOk = replyOut.includes("要保留兼容性吗") && replyOut.includes("保留现有配置字段") && !replyOut.includes("^ad-q-");

  return { ok: strippedOk && replyOk, strippedOk, replyOk };
}

async function evalWeightedBudgetAndEntryMap() {
  const longNote = [
    "---",
    "type: 规范",
    "def: FTS5 与双宿主上下文规范",
    "---",
    "# 第一章：架构目标",
    ...Array.from({ length: 16 }, (_, i) => `- 约束 ${i + 1}：详细正文条款仅需在调用 vault_read 后加载，不应初始全量塞入。`),
    "## 第二章：验收门槛",
    "- 必须保证无静默丢失",
  ].join("\n");
  const plugin = makeFakePlugin({
    SpecDoc: { path: "Concepts/SpecDoc.md", content: longNote },
  });
  const block = { start: 0, end: 0, text: "- TODO 检查 [[SpecDoc]] 并执行改动" };
  const fullRes = await buildDelegationPayload({ plugin, file: { path: "日记/2026_11_26.md" }, lines: [block.text], block });
  const mapRes = await buildDelegationPayload({ plugin, file: { path: "日记/2026_11_26.md" }, lines: [block.text], block, opts: { entryMapMode: true } });
  const ratioOk = estimateTokens("中文预算估算") > estimateTokens("abcd") && mapRes.bundle.stats.injectedTokens < fullRes.bundle.stats.injectedTokens;
  const tocDisclosed = mapRes.prompt.includes("Concepts/SpecDoc.md") && mapRes.prompt.includes("第二章：验收门槛");
  return {
    ok: ratioOk && tocDisclosed,
    fullTokens: fullRes.bundle.stats.injectedTokens,
    entryMapTokens: mapRes.bundle.stats.injectedTokens,
    tocDisclosed,
  };
}

function evalVaultFts() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "ad-eval-fts-v-"));
  const indexDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-eval-fts-i-"));
  try {
    fs.mkdirSync(path.join(vault, ".outline-journal"), { recursive: true });
    fs.mkdirSync(path.join(vault, "Agent Deck", "派发"), { recursive: true });
    fs.writeFileSync(
      path.join(vault, "Guide.md"),
      [
        "# 指南",
        "- 关键短语：纯本地增量倒排检出与零泄漏",
        "- PAUSED 🤖 10:00-10:30 **AI_LOG_EVAL_SHOULD_EXCLUDE**",
        "\t- 第1轮：纯本地增量倒排检出_AI_SUBTREE_LEAK",
      ].join("\n"),
    );
    fs.writeFileSync(path.join(vault, "Secret.md"), "---\nprivate: true\n---\n- 关键短语：纯本地增量倒排检出与零泄漏_PRIVATE\n");
    fs.writeFileSync(path.join(vault, "Agent Deck", "派发", "snap.md"), "---\ntype: 派发载荷\n---\nGEN_DISPATCH_EVAL_LEAK\n");
    const hit = vaultFind(vault, "纯本地增量倒排检出", { indexOpts: { indexDir, persist: true } });
    const priv = vaultFind(vault, "零泄漏_PRIVATE", { indexOpts: { indexDir, persist: true } });
    const aiLogLeak = vaultFind(vault, "AI_LOG_EVAL_SHOULD_EXCLUDE", { indexOpts: { indexDir, persist: true } });
    const aiSubLeak = vaultFind(vault, "AI_SUBTREE_LEAK", { indexOpts: { indexDir, persist: true } });
    const genLeak = vaultFind(vault, "GEN_DISPATCH_EVAL_LEAK", { indexOpts: { indexDir, persist: true } });
    const aiLogLeaks = aiLogLeak.items.length + aiSubLeak.items.length;
    const generatedFileLeaks = genLeak.items.length;
    return {
      ok: hit.engine === "sqlite-fts5" && hit.items.length === 1 && hit.items[0].path === "Guide.md" && priv.items.length === 0 && aiLogLeaks === 0 && generatedFileLeaks === 0,
      engine: hit.engine,
      hits: hit.items.length,
      privacyLeaks: priv.items.length,
      aiLogLeaks,
      generatedFileLeaks,
    };
  } finally {
    clearVaultIndexCache(vault, { indexDir });
    fs.rmSync(vault, { recursive: true, force: true });
    fs.rmSync(indexDir, { recursive: true, force: true });
  }
}

export async function runContextEval() {
  const memory = evalMemoryRetrieval();
  const harness = await evalHarnessIntegrity();
  const cache = evalPrefixCacheStability();
  const hygiene = evalPromptHygiene();
  const budget = await evalWeightedBudgetAndEntryMap();
  const fts = evalVaultFts();

  const ok =
    memory.recall >= 0.9 &&
    memory.precision >= 0.8 &&
    memory.privacyLeaks === 0 &&
    memory.budgetViolations === 0 &&
    memory.orderMismatches === 0 &&
    harness.passed === harness.total &&
    harness.privacyLeaks === 0 &&
    harness.silentLosses === 0 &&
    cache.driftCount === 0 &&
    hygiene.ok &&
    budget.ok &&
    fts.ok;

  return { ok, memory, harness, cache, hygiene, budget, fts };
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const res = await runContextEval();
  console.log(JSON.stringify(res, null, 2));
  if (!res.ok) process.exit(1);
}
