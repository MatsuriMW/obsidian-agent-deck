#!/usr/bin/env node
// Offline evaluation suite for Agent Deck's context engine:
// 1) Memory recall, precision, budget & privacy-gate compliance
// 2) Harness zero-silent-loss & privacy boundary integrity
// 3) ContextBundle KV-cache prefix stability across follow-up turns

import { pathToFileURL } from "node:url";
import { pickMemoriesFromEntries } from "../src/memory-query-core.js";
import {
  agentText,
  buildDelegationPayload,
  createContextBundle,
  renderContextBundle,
} from "../src/harness.js";
import { parseThread, replyPromptText } from "../src/thread-replies.js";

const MEMORY_CORPUS = [
  { id: "m1", kind: "项目经验", type: "经验", state: "有效", text: "使用 esbuild 打包插件时必须保留 obsidian 为 external，否则运行期报错", tags: ["build", "esbuild"], domain: "engineering", sources: ["[[构建规范]]"] },
  { id: "m2", kind: "事实", type: "约束", state: "有效", text: "Windows 端没有 osascript，终端派发需要走 PowerShell 或 Windows Terminal", tags: ["windows", "terminal"], domain: "cross-platform", sources: ["[[跨平台兼容]]"] },
  { id: "m3", kind: "偏好", type: "风格", state: "有效", text: "日志排版偏好简洁时间段加粗与关键记录 Pin 标记", tags: ["journal", "layout"], domain: "workflow", sources: ["[[日记规范]]"] },
  { id: "m4", kind: "事实", type: "密钥", state: "有效", private: true, text: "私有日记里记录的 esbuild 内部调试密钥 sk-secret-12345", tags: ["esbuild"], domain: "private", sources: ["[[私密笔记]]"] },
  { id: "m5", kind: "待验证规律", type: "假设", state: "已拒绝", text: "已经拒绝的旧 esbuild 配置方案不应再注入", tags: ["esbuild"], domain: "engineering", sources: ["[[旧方案]]"] },
  { id: "m6", kind: "项目经验", type: "经验", state: "有效", text: "修改日志解析或清洗规则后必须递增 USAGE_CACHE_VERSION 避免旧缓存污染", tags: ["sqlite", "cache"], domain: "readers", sources: ["[[缓存迁移]]"] },
  { id: "m7", kind: "偏好", type: "约束", state: "有效", text: "缺失 token 或活跃时段时绝不估算数值，保留真实空值", tags: ["metrics", "analytics"], domain: "readers", sources: ["[[口径规范]]"] },
];

const MEMORY_CASES = [
  { name: "single-latin-term-esbuild", query: "排查 esbuild 打包报错", expected: ["m1"], forbidden: ["m4", "m5"] },
  { name: "single-latin-term-windows", query: "适配 windows 终端启动", expected: ["m2"], forbidden: ["m4", "m5"] },
  { name: "chinese-bigram-journal", query: "优化日志排版和Pin标记", expected: ["m3"], forbidden: ["m4", "m5"] },
  { name: "metadata-channel-sqlite", query: "检查 sqlite 缓存逻辑", expected: ["m6"], forbidden: ["m4", "m5"] },
  { name: "chinese-metrics-constraint", query: "处理缺失token的统计口径", expected: ["m7"], forbidden: ["m4", "m5"] },
  { name: "unrelated-noise-zero-recall", query: "今天中午吃什么拉面", expected: [], forbidden: ["m1", "m2", "m3", "m4", "m5", "m6", "m7"] },
];

function evalMemoryRetrieval() {
  let expectedHits = 0;
  let expectedTotal = 0;
  let returnedTotal = 0;
  let relevantReturned = 0;
  let privacyLeaks = 0;
  let budgetViolations = 0;
  const maxChars = 220;

  for (const c of MEMORY_CASES) {
    const picked = pickMemoriesFromEntries(MEMORY_CORPUS, c.query, { limit: 3, maxChars });
    const ids = picked.map((e) => e.id);
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

export async function runContextEval() {
  const memory = evalMemoryRetrieval();
  const harness = await evalHarnessIntegrity();
  const cache = evalPrefixCacheStability();
  const hygiene = evalPromptHygiene();

  const ok =
    memory.recall >= 0.9 &&
    memory.precision >= 0.8 &&
    memory.privacyLeaks === 0 &&
    memory.budgetViolations === 0 &&
    harness.passed === harness.total &&
    harness.privacyLeaks === 0 &&
    harness.silentLosses === 0 &&
    cache.driftCount === 0 &&
    hygiene.ok;

  return { ok, memory, harness, cache, hygiene };
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const res = await runContextEval();
  console.log(JSON.stringify(res, null, 2));
  if (!res.ok) process.exit(1);
}
