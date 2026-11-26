import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

import {
  resolveVault,
  readPluginConfig,
  mcpSettingsOf,
  resolvePluginScriptsDir,
  loadVaultIndex,
  peekVaultIndexStatus,
  clearVaultIndexCache,
  computeAnchorHash,
  loadNodeSqlite,
  isInternalTaskBlockId,
  parseFrontmatter,
  findHeadingRange,
  isMainModule,
} from "../src/context-core/index.js";
import {
  vaultFind,
  formatVaultFind,
  vaultOutline,
  vaultRead,
  vaultRelated,
} from "../src/context-core/vault-ops.js";
import { proposeMemory } from "../src/context-core/memory-ops.js";
import { parseMemoryFile } from "../src/memory-store.js";
import { createMcpServer } from "../src/context-core/mcp.js";

const CLI_SCRIPT = path.join(import.meta.dirname, "..", "scripts", "memory-query.mjs");

test("context-core: 双宿主配置发现（.outline-journal / .obsidian / 纯 Markdown 文件夹）", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ad-cfg-"));
  try {
    // 1. Plain Markdown folder: readPluginConfig returns {} cleanly
    const plain = path.join(tmp, "plain");
    fs.mkdirSync(plain, { recursive: true });
    assert.deepEqual(readPluginConfig(plain), {});
    assert.equal(resolveVault(plain), "");

    // 2. .outline-journal only
    const ojVault = path.join(tmp, "oj-vault");
    const ojScripts = path.join(ojVault, ".outline-journal", "plugins", "agent-deck", "scripts");
    fs.mkdirSync(ojScripts, { recursive: true });
    fs.writeFileSync(path.join(ojVault, ".outline-journal", "plugins", "agent-deck", "data.json"), JSON.stringify({ dream: { dir: "OJ记忆" } }));
    fs.writeFileSync(path.join(ojScripts, "memory-query.mjs"), "// oj\n");
    assert.equal(resolveVault(ojScripts), ojVault);
    assert.equal(readPluginConfig(ojVault).dream.dir, "OJ记忆");
    assert.equal(resolvePluginScriptsDir(ojVault), ojScripts);

    // 3. Both .obsidian and .outline-journal: newer mtime wins
    const dualVault = path.join(tmp, "dual-vault");
    const obsCfg = path.join(dualVault, ".obsidian", "plugins", "agent-deck", "data.json");
    const ojCfg = path.join(dualVault, ".outline-journal", "plugins", "agent-deck", "data.json");
    fs.mkdirSync(path.dirname(obsCfg), { recursive: true });
    fs.mkdirSync(path.dirname(ojCfg), { recursive: true });
    fs.writeFileSync(obsCfg, JSON.stringify({ dream: { dir: "ObsDir" } }));
    fs.writeFileSync(ojCfg, JSON.stringify({ dream: { dir: "OjDir" } }));
    const oldTime = new Date(Date.now() - 60000);
    const newTime = new Date(Date.now());
    fs.utimesSync(obsCfg, oldTime, oldTime);
    fs.utimesSync(ojCfg, newTime, newTime);
    assert.equal(readPluginConfig(dualVault).dream.dir, "OjDir");
    assert.equal(readPluginConfig(dualVault, { configDir: ".obsidian" }).dream.dir, "ObsDir");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("context-core: 增量索引冷建、缓存命中、单文件更新、删除清理、重建与 readOverride", () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "ad-idx-vault-"));
  const indexDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-idx-cache-"));
  try {
    fs.mkdirSync(path.join(vault, ".obsidian"), { recursive: true });
    fs.writeFileSync(path.join(vault, "A.md"), "---\ntype: 概念\ndef: 初始定义\n---\n\n# 标题一\n正文A\n");
    fs.writeFileSync(path.join(vault, "B.md"), "---\nprivate: true\n---\n绝密B\n");

    const cold = loadVaultIndex(vault, { indexDir, persist: true });
    assert.equal(cold.stats.cacheHit, false);
    assert.equal(cold.stats.reindexedFiles, 2);
    assert.equal(cold.stats.indexedFiles, 1);
    assert.equal(cold.stats.privateCount, 1);
    assert.ok(fs.existsSync(cold.cacheFile));

    const warm = loadVaultIndex(vault, { indexDir, persist: true });
    assert.equal(warm.stats.cacheHit, true);
    assert.equal(warm.stats.reindexedFiles, 0);

    // Modify A.md -> only 1 file reindexed
    fs.writeFileSync(path.join(vault, "A.md"), "---\ntype: 概念\ndef: 更新定义\n---\n\n# 标题一\n正文A已修改\n");
    const future = new Date(Date.now() + 2000);
    fs.utimesSync(path.join(vault, "A.md"), future, future);
    const updated = loadVaultIndex(vault, { indexDir, persist: true });
    assert.equal(updated.stats.reindexedFiles, 1);
    assert.equal(updated.byPath.get("A.md").def, "更新定义");

    // Delete cache and rebuild cleanly
    clearVaultIndexCache(vault, { indexDir });
    assert.equal(fs.existsSync(cold.cacheFile), false);
    const rebuilt = loadVaultIndex(vault, { indexDir, persist: true });
    assert.equal(rebuilt.stats.cacheHit, false);
    assert.equal(rebuilt.stats.reindexedFiles, 2);
    assert.equal(rebuilt.stats.indexedFiles, 1);
    assert.equal(rebuilt.stats.privateCount, 1);

    // Delete A.md -> removed from index
    fs.rmSync(path.join(vault, "A.md"));
    const afterDel = loadVaultIndex(vault, { indexDir, persist: true });
    assert.equal(afterDel.byPath.has("A.md"), false);

    // readOverride reads unsaved buffer & detects anchor hash drift
    fs.writeFileSync(path.join(vault, "Draft.md"), "# 节一\n第一版正文\n");
    const firstRead = vaultRead(vault, "Draft", { indexOpts: { indexDir } });
    assert.equal(firstRead.ok, true);
    const driftRead = vaultRead(vault, "Draft", {
      expectedHash: firstRead.anchorHash,
      readOverride: (rel) => (rel === "Draft.md" ? "# 节一\n编辑器里未保存的新正文\n" : null),
      indexOpts: { indexDir },
    });
    assert.equal(driftRead.ok, true);
    assert.equal(driftRead.changedSinceDispatch, true);
    assert.match(driftRead.content, /编辑器里未保存的新正文/);
    assert.notEqual(computeAnchorHash("a"), computeAnchorHash("b"));
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
    fs.rmSync(indexDir, { recursive: true, force: true });
  }
});

test("context-core: CLI 全库 4 动词、宽泛领域词(>30反链)护栏、内部块号剥离与锚点保留", () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "ad-cli-vault-"));
  const indexDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-cli-idx-"));
  try {
    fs.mkdirSync(path.join(vault, ".outline-journal"), { recursive: true });
    fs.mkdirSync(path.join(vault, "Concepts"), { recursive: true });
    fs.mkdirSync(path.join(vault, "日记"), { recursive: true });

    fs.writeFileSync(
      path.join(vault, "Concepts", "心理学.md"),
      "---\ntype: 领域\ndef: 宽泛领域词测试\n---\n\n",
    );
    for (let i = 1; i <= 32; i++) {
      fs.writeFileSync(path.join(vault, "日记", `2026_10_${String(i).padStart(2, "0")}.md`), `- [[心理学]] 笔记 ${i}\n  - 子内容 ${i}\n`);
    }
    fs.writeFileSync(
      path.join(vault, "Concepts", "AnchorTest.md"),
      [
        "---",
        "type: 规范",
        "def: 测试内部标识剥离与定位锚保留",
        "---",
        "",
        "# 第一章",
        "- 任务行 ^ad-task123456",
        "- 记忆行 ^mem-keep1234",
        "- 原生块 ^651b6c",
        "```md",
        "- 代码块内保留 ^ad-in-fence",
        "```",
      ].join("\n"),
    );

    const runCli = (args) => execFileSync(process.execPath, [CLI_SCRIPT, ...args, "--vault", vault, "--index-dir", indexDir], { encoding: "utf8" });

    const findOut = runCli(["vault-find", "AnchorTest"]);
    assert.match(findOut, /AnchorTest\.md/);

    const outlineOut = runCli(["vault-outline", "AnchorTest"]);
    assert.match(outlineOut, /# 第一章/);
    assert.match(outlineOut, /\^mem-keep1234/);
    assert.match(outlineOut, /\^651b6c/);
    assert.ok(!outlineOut.includes("ad-task123456"), "内部任务块号不出现在大纲锚点中");

    const readBroad = runCli(["vault-read", "心理学"]);
    assert.match(readBroad, /宽泛领域词，共 32 条反链/);

    const readAnchor = runCli(["vault-read", "AnchorTest"]);
    assert.ok(!readAnchor.includes("^ad-task123456"));
    assert.ok(readAnchor.includes("^mem-keep1234"));
    assert.ok(readAnchor.includes("^651b6c"));
    assert.ok(readAnchor.includes("^ad-in-fence"));

    const relOut = runCli(["vault-related", "心理学", "--k", "5"]);
    assert.match(relOut, /显示 5 \/ 共 32 篇/);
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
    fs.rmSync(indexDir, { recursive: true, force: true });
  }
});

test("src/settings.js imports path whenever referencing path.* (e.g. manifest._sourceDir)", () => {
  const src = fs.readFileSync(path.resolve("src/settings.js"), "utf8");
  if (/\bpath\.(?:join|resolve|dirname|basename)\b/.test(src)) {
    assert.match(src, /^import\s+(?:\*\s+as\s+path|path)\s+from\s+["'](?:node:)?path["'];?/m);
  }
});

test("context-core: SQLite FTS5 正文短语与中英关键词毫秒检出、隐私同步清除及回退模式", () => {
  const sqlite = loadNodeSqlite();
  assert.ok(sqlite, "Node >=22.5 应内置 node:sqlite");

  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "ad-fts-vault-"));
  const indexDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-fts-idx-"));
  try {
    fs.mkdirSync(path.join(vault, ".outline-journal"), { recursive: true });
    fs.mkdirSync(path.join(vault, "Notes"), { recursive: true });
    fs.writeFileSync(
      path.join(vault, "Notes", "Alpha.md"),
      "---\ntags: [arch]\n---\n\n# 背景\n- 我们在讨论纯手工零外部依赖的流式增量索引方案，用来支撑 hybrid retrieval。\n- 💬 第1轮：这段 AI 内部回声不能进全文索引\n",
    );
    fs.writeFileSync(
      path.join(vault, "Notes", "Beta.md"),
      "---\n---\n\n记录一个两字词条：复盘。\n",
    );
    fs.writeFileSync(
      path.join(vault, "Notes", "FlipPrivate.md"),
      "---\n---\n\n原本公开段落 UniqueFlipToken123\n",
    );

    const resCn = vaultFind(vault, "流式增量索引", { indexOpts: { indexDir, persist: true } });
    assert.equal(resCn.engine, "sqlite-fts5");
    assert.ok(resCn.items.some((x) => x.path === "Notes/Alpha.md"));
    const formattedCn = formatVaultFind(resCn);
    assert.match(formattedCn, /片段：/);
    assert.match(formattedCn, /流式增量索引/);

    const resEn = vaultFind(vault, '"hybrid retrieval"', { indexOpts: { indexDir, persist: true } });
    assert.ok(resEn.items.some((x) => x.path === "Notes/Alpha.md"));

    const resShort = vaultFind(vault, "复盘", { indexOpts: { indexDir, persist: true } });
    assert.ok(resShort.items.some((x) => x.path === "Notes/Beta.md"), "2 字中文短词仍可命中正文");

    // 💬 AI 回声行不入 FTS5
    const resEcho = vaultFind(vault, "AI 内部回声不能进全文索引", { indexOpts: { indexDir, persist: true } });
    assert.equal(resEcho.items.length, 0);

    // 确认公开状态时在 FTS5 表中，随后切为 private: true，必须从 docs_fts 彻底删除
    const resBeforeFlip = vaultFind(vault, "UniqueFlipToken123", { indexOpts: { indexDir, persist: true } });
    assert.ok(resBeforeFlip.items.some((x) => x.path === "Notes/FlipPrivate.md"));

    const flipPath = path.join(vault, "Notes", "FlipPrivate.md");
    const flipMtime = new Date(Date.now() + 2000);
    fs.writeFileSync(flipPath, "---\nprivate: true\n---\n\n原本公开段落 UniqueFlipToken123\n");
    fs.utimesSync(flipPath, flipMtime, flipMtime);

    const idxAfter = loadVaultIndex(vault, { indexDir, persist: true });
    const resAfterFlip = vaultFind(vault, "UniqueFlipToken123", { indexOpts: { indexDir, persist: true } });
    assert.equal(resAfterFlip.items.length, 0, "切为 private: true 后 FTS5 不得返回");

    const db = new sqlite.DatabaseSync(idxAfter.ftsFile, { readOnly: true });
    try {
      const cnt = db.prepare("SELECT count(*) AS n FROM docs_fts WHERE path = ?").get("Notes/FlipPrivate.md")?.n;
      assert.equal(cnt, 0, "docs_fts 中私密笔记记录数为 0");
    } finally {
      db.close();
    }

    // disableFts 回退模式仍保持正常可用
    const fallbackRes = vaultFind(vault, "arch", { indexOpts: { indexDir, persist: true, disableFts: true } });
    assert.equal(fallbackRes.engine, "json-fallback");
    assert.ok(fallbackRes.items.some((x) => x.path === "Notes/Alpha.md"));

    // 打包后的 CLI 产物也必须实际创建 .fts.sqlite 并返回正文短语片段（防 esbuild __require 退化），且 stderr 无 SQLite 实验警告噪音
    clearVaultIndexCache(vault, { indexDir });
    const cliRun = spawnSync(process.execPath, [CLI_SCRIPT, "vault-find", "流式增量索引", "--vault", vault, "--index-dir", indexDir], { encoding: "utf8" });
    assert.equal(cliRun.status, 0);
    assert.match(cliRun.stdout, /Notes\/Alpha\.md/);
    assert.match(cliRun.stdout, /片段：/);
    assert.equal(cliRun.stderr.trim(), "", "CLI stderr 不应出现 ExperimentalWarning");
    assert.ok(fs.readdirSync(indexDir).some((f) => f.endsWith(".fts.sqlite")), "打包 CLI 必须真实生成 .fts.sqlite");

    // 混合不存在独特词的查询不得仅因公共 CJK bigram 误召回无关笔记
    fs.writeFileSync(path.join(vault, "Notes", "Book86.md"), "---\ndef: 日本轻小说\n---\n\n86不存在的战区\n");
    clearVaultIndexCache(vault, { indexDir });
    const falsePos = vaultFind(vault, "不存在的随机字符串xyz999", { indexOpts: { indexDir, persist: true } });
    assert.equal(falsePos.items.length, 0);

    // cacheTtlMs 复用内存已构好的 Map 引用（长驻 MCP 零重复构图），且 stats.cacheHit 准确
    const i1 = loadVaultIndex(vault, { indexDir, persist: true, cacheTtlMs: 2000 });
    const i2 = loadVaultIndex(vault, { indexDir, persist: true, cacheTtlMs: 2000 });
    assert.equal(i1.byPath, i2.byPath);
    assert.equal(i2.stats.cacheHit, true);
  } finally {
    clearVaultIndexCache(vault, { indexDir });
    fs.rmSync(vault, { recursive: true, force: true });
    fs.rmSync(indexDir, { recursive: true, force: true });
  }
});

test("context-core: 严格排除日记 AI 自动记录子树与 Agent Deck 生成文件，保留手写与 ✍️ 答", () => {
  const sqlite = loadNodeSqlite();
  assert.ok(sqlite);

  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "ad-aifilter-v-"));
  const indexDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-aifilter-i-"));
  try {
    fs.mkdirSync(path.join(vault, ".obsidian", "plugins", "agent-deck"), { recursive: true });
    fs.mkdirSync(path.join(vault, "日记"), { recursive: true });
    fs.mkdirSync(path.join(vault, "Concepts"), { recursive: true });
    for (const sub of ["派发", "Answers", "Conversations", "Exports", "任务", "done", "记忆"]) {
      fs.mkdirSync(path.join(vault, "Agent Deck", sub), { recursive: true });
    }

    fs.writeFileSync(path.join(vault, "Concepts", "TargetConcept.md"), "---\ntype: 概念\ndef: 目标概念\n---\n\n");
    fs.writeFileSync(
      path.join(vault, "日记", "2026_11_26.md"),
      [
        "<!-- agent-deck:layout:start -->",
        "## 正在做",
        "- PAUSED 🤖 16:48-20:42 **定位宣传片并制作英文版** ^agy-2m5v4uv1k2",
        "\t- 第19轮：**任务**：AI_LOG_TURN_TOKEN；**结论**：AI_LOG_SUBTREE_TEXT [[TargetConcept]] <!-- ad-turn:2m5v4uv1k2:19 -->",
        "\t\t- AI_NESTED_CHILD_DETAIL 2.5h · 8.5M tok",
        "\t\t```txt",
        "\t\tAI_FENCED_LOG_NOISE",
        "\t\t```",
        "\t- TODO 🤖 AI_AUTO_TODO_LINE",
        "\t- 🔗 [Antigravity](obsidian://ad-open)",
        "\t- ⏱ 16:48–20:42 · 共 2h33m · 8.5M tok · Antigravity <!-- ad-clock:60e23808 -->",
        "- DONE 16:04 🤖 **AI_DONE_LOG_TOKEN**",
        "\t- 💬 AI_DONE_REPLY_TOKEN",
        "- [[UserParentProj]] 手写父项目",
        "\t- PAUSED 🤖 03:13-03:21 **AI_NESTED_UNDER_USER_PARENT** ^agy-033t5hjkpm",
        "\t\t- 第2轮：AI_NESTED_TURN_TEXT",
        "\t- USER_SIBLING_NOTE 手写同级笔记保留 [[TargetConcept]]",
        "- TODO 用户手写委派任务 ^claude-user123456",
        "\t- ❓ 第1轮：AI_ASKED_QUESTION_TOKEN ^ad-q-11112222 <!-- ad-turn:s1:1 -->",
        "\t- ✍️ 答：USER_WRITTEN_ANSWER_KEEP",
        "\t- 💬 第2轮：AI_SECOND_TURN_NOISE <!-- ad-turn:s1:2 -->",
        "- 提问：USER_REGULAR_QUESTION_KEEP 平时手写的问题记录",
        "- USER_REAL_NOTE_KEEP 手写思考关于 [[TargetConcept]] 的真实判断",
        "<!-- agent-deck:layout:end -->",
      ].join("\n"),
    );

    // Generated Agent Deck files & memory store files
    fs.writeFileSync(path.join(vault, "Agent Deck", "派发", "d1.md"), "---\ntype: 派发载荷\n---\nGEN_DISPATCH_TOKEN [[TargetConcept]]\n");
    fs.writeFileSync(path.join(vault, "Agent Deck", "Answers", "a1.md"), "# Q\nGEN_ANSWER_TOKEN\n");
    fs.writeFileSync(path.join(vault, "Agent Deck", "Conversations", "c1.md"), "<!-- agent-deck-conversation sha256:abc -->\n# C\nGEN_CONV_TOKEN\n");
    fs.writeFileSync(path.join(vault, "Agent Deck", "Exports", "e1.md"), "# Export\nGEN_EXPORT_TOKEN\n");
    fs.writeFileSync(path.join(vault, "Agent Deck", "任务", "t1.md"), "# Task\nGEN_TASK_TOKEN\n");
    fs.writeFileSync(path.join(vault, "Agent Deck", "done", "已完成任务.md"), "# Done\n- DONE 🤖 GEN_DONE_ARCHIVE_TOKEN\n");
    fs.writeFileSync(path.join(vault, "Agent Deck", "安全审计.md"), "# 安全审计\nGEN_AUDIT_TOKEN\n");
    fs.writeFileSync(path.join(vault, "Agent Deck", "工作台.md"), "# 工作台\nGEN_WORKBENCH_TOKEN\n");
    fs.writeFileSync(path.join(vault, "Agent Deck", "记忆-体检.md"), "# 记忆体检\nGEN_CHECKUP_TOKEN\n");
    fs.writeFileSync(path.join(vault, "Agent Deck", "功能示例-1.10.0.md"), "# 示例\nGEN_DEMO_TOKEN\n");
    fs.writeFileSync(path.join(vault, "Agent Deck", "长期记忆.md"), "# 长期记忆\n- 偏好：GEN_DREAM_SUMMARY_TOKEN\n");
    fs.writeFileSync(
      path.join(vault, "Agent Deck", "记忆", "2026-11-26-记忆条目.md"),
      [
        "---",
        "id: m-settled-test-1",
        "kind: pattern",
        "type: 项目经验",
        "state: 有效",
        "verified: true",
        "---",
        "SETTLED_DREAM_MEMORY_TOKEN 已沉淀的真实记忆",
      ].join("\n"),
    );
    fs.writeFileSync(path.join(vault, "Agent Deck", "用户手写说明.md"), "# 用户手写\nUSER_MANUAL_UNDER_AD_DIR\n");

    const idx = loadVaultIndex(vault, { indexDir, persist: true });
    assert.ok(idx.stats.generatedCount >= 12, "生成目录与记忆库文件全部纳入 generatedCount");

    // 1. All AI log tokens and generated files must have 0 hits in vaultFind & 0 rows in docs_fts
    const shouldMiss = [
      "AI_LOG_TURN_TOKEN",
      "AI_LOG_SUBTREE_TEXT",
      "AI_NESTED_CHILD_DETAIL",
      "AI_FENCED_LOG_NOISE",
      "AI_AUTO_TODO_LINE",
      "AI_DONE_LOG_TOKEN",
      "AI_DONE_REPLY_TOKEN",
      "AI_NESTED_UNDER_USER_PARENT",
      "AI_NESTED_TURN_TEXT",
      "AI_ASKED_QUESTION_TOKEN",
      "AI_SECOND_TURN_NOISE",
      "GEN_DISPATCH_TOKEN",
      "GEN_ANSWER_TOKEN",
      "GEN_CONV_TOKEN",
      "GEN_EXPORT_TOKEN",
      "GEN_TASK_TOKEN",
      "GEN_DONE_ARCHIVE_TOKEN",
      "GEN_AUDIT_TOKEN",
      "GEN_WORKBENCH_TOKEN",
      "GEN_CHECKUP_TOKEN",
      "GEN_DEMO_TOKEN",
      "GEN_DREAM_SUMMARY_TOKEN",
      "SETTLED_DREAM_MEMORY_TOKEN",
    ];
    for (const tok of shouldMiss) {
      assert.equal(vaultFind(vault, tok, { indexOpts: { indexDir, persist: true } }).items.length, 0, `${tok} 不应出现在 vault_find（FTS5）`);
      assert.equal(vaultFind(vault, tok, { fulltext: false, indexOpts: { indexDir, persist: true } }).items.length, 0, `${tok} 不应出现在 vault_find（metadata）`);
    }

    const db = new sqlite.DatabaseSync(idx.ftsFile, { readOnly: true });
    try {
      const genFtsCount = db.prepare("SELECT count(*) AS n FROM docs_fts WHERE path LIKE 'Agent Deck/%' AND path != 'Agent Deck/用户手写说明.md'").get()?.n;
      assert.equal(genFtsCount, 0, "docs_fts 中生成文件与记忆库记录数为 0");
    } finally {
      db.close();
    }

    // 2. Genuine user content & ✍️ answer & user file under Agent Deck/ must be searchable
    for (const tok of ["UserParentProj", "USER_SIBLING_NOTE", "用户手写委派任务", "USER_WRITTEN_ANSWER_KEEP", "USER_REGULAR_QUESTION_KEEP", "USER_REAL_NOTE_KEEP", "USER_MANUAL_UNDER_AD_DIR"]) {
      const hit = vaultFind(vault, tok, { indexOpts: { indexDir, persist: true } });
      assert.ok(hit.items.length >= 1, `用户手写内容 ${tok} 应正常检索命中`);
    }

    // 3. TargetConcept backlinks only come from user lines, not AI_LOG_SUBTREE_TEXT or GEN_DISPATCH_TOKEN
    const bls = idx.backlinks.get("Concepts/TargetConcept.md") || [];
    assert.equal(bls.length, 2);
    assert.ok(bls.every((b) => b.sourcePath === "日记/2026_11_26.md"));

    // 4. vaultOutline & vaultRead default strip AI logs while preserving user notes + ✍️
    const ol = vaultOutline(vault, "日记/2026_11_26", { indexOpts: { indexDir, persist: true } });
    assert.equal(ol.ok, true);
    assert.ok(ol.skippedAiLines >= 10);
    assert.ok(!ol.anchors.some((a) => a.id.startsWith("ad-q-")));

    const rdDefault = vaultRead(vault, "日记/2026_11_26", { indexOpts: { indexDir, persist: true } });
    assert.equal(rdDefault.ok, true);
    assert.ok(rdDefault.skippedAiLines >= 10);
    assert.ok(!rdDefault.content.includes("AI_LOG_TURN_TOKEN"));
    assert.ok(!rdDefault.content.includes("AI_DONE_LOG_TOKEN"));
    assert.ok(!rdDefault.content.includes("AI_NESTED_UNDER_USER_PARENT"));
    assert.ok(!rdDefault.content.includes("AI_ASKED_QUESTION_TOKEN"));
    assert.match(rdDefault.content, /USER_SIBLING_NOTE/);
    assert.match(rdDefault.content, /USER_WRITTEN_ANSWER_KEEP/);
    assert.match(rdDefault.content, /USER_REAL_NOTE_KEEP/);

    // Explicit includeAiLogs override only when explicitly requested
    const rdRaw = vaultRead(vault, "日记/2026_11_26", { includeAiLogs: true, indexOpts: { indexDir, persist: true } });
    assert.match(rdRaw.content, /AI_LOG_TURN_TOKEN/);

    // 5. Generated & memory-store paths blocked in vaultRead, pointing memory store to memory_*
    const rdAudit = vaultRead(vault, "Agent Deck/安全审计", { indexOpts: { indexDir, persist: true } });
    assert.equal(rdAudit.ok, false);
    assert.equal(rdAudit.blockedGenerated, true);

    const rdMem = vaultRead(vault, "Agent Deck/记忆/2026-11-26-记忆条目", { indexOpts: { indexDir, persist: true } });
    assert.equal(rdMem.ok, false);
    assert.equal(rdMem.blockedGenerated, true);
    assert.match(rdMem.error, /memory_search/);

    // 6. Settled Dream memory still retrieved normally via memory-query.mjs CLI
    const memOut = execFileSync(process.execPath, [CLI_SCRIPT, "search", "SETTLED_DREAM_MEMORY_TOKEN", "--vault", vault], { encoding: "utf8" });
    assert.match(memOut, /SETTLED_DREAM_MEMORY_TOKEN/);
  } finally {
    clearVaultIndexCache(vault, { indexDir });
    fs.rmSync(vault, { recursive: true, force: true });
    fs.rmSync(indexDir, { recursive: true, force: true });
  }
});

test("note-hygiene: 统一 frontmatter / 标题区间 / 内部块号(21家Agent) / isMainModule", () => {
  const { fmEnd, meta } = parseFrontmatter(["---", "type: 概念", "def: \"规范汇总\"", "tags: [a, b]", "---", "正文"]);
  assert.equal(fmEnd, 5);
  assert.equal(meta.type, "概念");
  assert.equal(meta.def, "规范汇总");
  assert.deepEqual(meta.tags, ["a", "b"]);
  assert.equal(parseFrontmatter(["---", "unclosed: true", "正文"]).fmEnd, 0);

  const sec = findHeadingRange(["# H1", "## 子章", "```md", "## 假标题", "```", "正文", "## 下一章"], "子章");
  assert.deepEqual(sec, { start: 1, end: 6, level: 2, title: "子章" });

  assert.equal(isInternalTaskBlockId("hermes-abc1234567"), true);
  assert.equal(isInternalTaskBlockId("minimax-abc1234567"), true);
  assert.equal(isInternalTaskBlockId("qwenwork-abc1234567"), true);
  assert.equal(isInternalTaskBlockId("mem-keep1234"), false);
  assert.equal(isInternalTaskBlockId("651b6c"), false);
  assert.equal(typeof isMainModule, "function");
});

test("security & precision: private注释隔离、YAML换行消毒、越界符号链接拦截、Heading+startChar分段、FTS过滤与disableFts重对齐", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ad-sec-"));
  const vault = path.join(tmp, "vault");
  const outside = path.join(tmp, "secret.md");
  const indexDir = path.join(tmp, "idx");
  try {
    fs.mkdirSync(vault, { recursive: true });
    fs.writeFileSync(outside, "OUTSIDE_SYMLINK_SECRET\n");
    fs.writeFileSync(path.join(vault, "私密带注释.md"), "---\nprivate: true # personal\n---\nCOMMENTED_PRIVATE_SECRET\n");
    fs.writeFileSync(path.join(vault, "长章节笔记.md"), [
      "# 主章",
      "L2_FIRST",
      "L3_SECOND",
      "L4_THIRD",
      "# 超长单行",
      "A".repeat(1200),
      "",
    ].join("\n"));
    for (let i = 1; i <= 5; i++) {
      fs.writeFileSync(path.join(vault, `其他领域${i}.md`), `---\ndomain: life\n---\nCOMMON_FTS_TOKEN repeated `.repeat(6));
    }
    fs.writeFileSync(path.join(vault, "工程命中.md"), "---\ndomain: engineering\n---\nCOMMON_FTS_TOKEN unique target\n");

    const indexOpts = { indexDir, persist: true };

    // 1. private: true # comment & quoted "private": true blocked across index, FTS, read and loadMemories
    fs.writeFileSync(path.join(vault, "引号私密.md"), "---\n\"private\": true # quoted\n---\nQUOTED_PRIVATE_SECRET\n");
    fs.mkdirSync(path.join(vault, "Agent Deck", "记忆"), { recursive: true });
    fs.writeFileSync(path.join(vault, "Agent Deck", "记忆", "私密记忆.md"), "---\nid: mem-priv-1\nstate: 有效\nprivate: true # personal\n---\nPRIVATE_MEM_SECRET\n");
    assert.equal(vaultFind(vault, "COMMENTED_PRIVATE_SECRET", { indexOpts }).items.length, 0);
    assert.equal(vaultFind(vault, "QUOTED_PRIVATE_SECRET", { indexOpts }).items.length, 0);
    assert.equal(vaultRead(vault, "私密带注释", { indexOpts }).blockedPrivate, true);
    assert.equal(vaultRead(vault, "引号私密", { indexOpts }).blockedPrivate, true);
    assert.equal(vaultFind(vault, "PRIVATE_MEM_SECRET", { indexOpts }).items.length, 0);
    assert.equal(loadVaultIndex(vault, { indexDir, persist: true }).byPath.has("引号私密.md"), false);
    const { loadMemories } = await import("../src/context-core/memory-ops.js");
    const { memoryDirOf } = await import("../src/context-core/index.js");
    assert.equal(loadMemories(vault).entries.some((e) => e.id === "mem-priv-1"), false);
    const outMem = path.join(tmp, "out-mem");
    fs.mkdirSync(outMem, { recursive: true });
    fs.mkdirSync(path.join(vault, ".obsidian", "plugins", "agent-deck"), { recursive: true });
    fs.symlinkSync(outMem, path.join(vault, "sym-mem"));
    fs.writeFileSync(path.join(vault, ".obsidian", "plugins", "agent-deck", "data.json"), JSON.stringify({ dream: { dir: "sym-mem" } }));
    assert.throws(() => memoryDirOf(vault, { configDir: ".obsidian" }), /越界/);
    fs.unlinkSync(path.join(vault, "sym-mem"));
    fs.rmSync(path.join(vault, ".obsidian"), { recursive: true, force: true });

    // 2. startLine within #Heading + startChar on >maxChars line
    const rdHeading = vaultRead(vault, "长章节笔记#主章", { startLine: 3, indexOpts });
    assert.equal(rdHeading.ok, true);
    assert.equal(rdHeading.mode, "heading");
    assert.equal(rdHeading.shownFrom, 3);
    assert.match(rdHeading.content, /^L3_SECOND/);

    const rdLong1 = vaultRead(vault, "长章节笔记#超长单行", { startLine: 6, maxChars: 500, indexOpts });
    assert.equal(rdLong1.ok, true);
    assert.equal(rdLong1.truncated, true);
    assert.equal(rdLong1.content.length, 500);
    assert.equal(rdLong1.nextStartLine, 6);
    assert.equal(rdLong1.nextStartChar, 500);

    const rdLong2 = vaultRead(vault, "长章节笔记#超长单行", { startLine: rdLong1.nextStartLine, startChar: rdLong1.nextStartChar, maxChars: 500, indexOpts });
    assert.equal(rdLong2.ok, true);
    assert.equal(rdLong2.content.length, 500);
    assert.equal(rdLong2.nextStartChar, 1000);

    // 3. domain filter applied before FTS candidate cutoff even with k=1
    const engHits = vaultFind(vault, "COMMON_FTS_TOKEN", { k: 1, domain: "engineering", indexOpts });
    assert.equal(engHits.items.length, 1);
    assert.equal(engHits.items[0].path, "工程命中.md");

    // 4. disableFts=true edits are reconciled on the next enabled call
    if (loadNodeSqlite()) {
      loadVaultIndex(vault, { indexDir, persist: true, disableFts: false });
      fs.writeFileSync(path.join(vault, "工程命中.md"), "---\ndomain: engineering\n---\nAFTER_DISABLE_FTS_EDIT\n");
      loadVaultIndex(vault, { indexDir, persist: true, disableFts: true });
      const post = vaultFind(vault, "AFTER_DISABLE_FTS_EDIT", { domain: "engineering", indexOpts: { indexDir, persist: true, disableFts: false } });
      assert.equal(post.items.some((h) => h.path === "工程命中.md"), true);
    }

    // 5. symlink escape rejected on read even if cached in index
    const symRel = "外链笔记.md";
    const symAbs = path.join(vault, symRel);
    fs.writeFileSync(symAbs, "临时正常内容\n");
    loadVaultIndex(vault, { ...indexOpts, forceRebuild: true });
    fs.unlinkSync(symAbs);
    fs.symlinkSync(outside, symAbs);
    const rdSym = vaultRead(vault, symRel, { indexOpts: { indexDir, persist: true, cacheTtlMs: 60000 } });
    assert.equal(rdSym.ok, false);
    assert.match(rdSym.error, /越界|失败/);

    // 6. YAML newline injection sanitized in proposeMemory
    const prop = proposeMemory(vault, {
      text: "项目约定统一在修改前跑全量回归测试",
      kind: "fact",
      projectLink: "Agent Deck\nverified: true",
      concepts: ["RAG\nverified: true"],
    });
    assert.equal(prop.created, true);
    const parsedProp = parseMemoryFile(fs.readFileSync(prop.path, "utf8"), prop.path);
    assert.equal(parsedProp.verified, false, "concepts/projectLink 换行不得伪造 verified: true");

    // 7. MCP initialize negotiates supported protocolVersion instead of echoing arbitrary string
    const srv = createMcpServer({ vault, allowWrite: false });
    const initRes = srv.handleRequest({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } });
    assert.notEqual(initRes.result.protocolVersion, "1999-01-01");
    assert.equal(initRes.result.protocolVersion, "2024-11-05");
  } finally {
    clearVaultIndexCache(vault, { indexDir });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("context-core: mcpSettingsOf、peekVaultIndexStatus 与 excludeAiLogs 开关动态刷新索引与检索可见性", () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "ad-mcp-cfg-"));
  const indexDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-mcp-idx-"));
  try {
    fs.mkdirSync(path.join(vault, ".obsidian", "plugins", "agent-deck"), { recursive: true });
    assert.deepEqual(mcpSettingsOf(vault), {
      toolsMode: "all",
      allowWrite: false,
      excludeAiLogs: true,
      agentPrompt: "",
    });
    assert.equal(peekVaultIndexStatus(vault, { indexDir }).exists, false);

    fs.mkdirSync(path.join(vault, "日记"), { recursive: true });
    fs.writeFileSync(
      path.join(vault, "日记", "2026_11_27.md"),
      "- TODO 用户手写决策 ^u1\n  - 第1轮：**任务**：排查问题；**结论**：AI_ONLY_TRACE_TOKEN\n",
    );

    const indexOpts = { indexDir, persist: true };
    assert.equal(vaultFind(vault, "AI_ONLY_TRACE_TOKEN", { indexOpts }).items.length, 0, "默认排除 AI 自动记录");
    const status1 = peekVaultIndexStatus(vault, { indexDir });
    assert.equal(status1.exists, true);
    assert.equal(status1.totalFiles, 1);
    assert.equal(status1.indexedFiles, 1);
    assert.equal(status1.excludeAiLogs, true);
    assert.ok(status1.updatedAt > 0);

    // Enable include AI logs + switch toolsMode/allowWrite/agentPrompt in data.json
    fs.writeFileSync(
      path.join(vault, ".obsidian", "plugins", "agent-deck", "data.json"),
      JSON.stringify({
        dream: {
          mcp: {
            toolsMode: "memory-only",
            allowWrite: true,
            excludeAiLogs: false,
            agentPrompt: "Custom MCP Prompt",
          },
        },
      }),
    );
    assert.deepEqual(mcpSettingsOf(vault, { configDir: ".obsidian" }), {
      toolsMode: "memory-only",
      allowWrite: true,
      excludeAiLogs: false,
      agentPrompt: "Custom MCP Prompt",
    });

    const foundWithAi = vaultFind(vault, "AI_ONLY_TRACE_TOKEN", { indexOpts });
    assert.equal(foundWithAi.items.length, 1, "关闭 excludeAiLogs 后自动失效缓存并检索到 AI 记录");
    assert.equal(peekVaultIndexStatus(vault, { indexDir }).excludeAiLogs, false);
    const readDefault = vaultRead(vault, "日记/2026_11_27", { indexOpts });
    assert.match(readDefault.content, /AI_ONLY_TRACE_TOKEN/);

    // Toggle back to excludeAiLogs: true -> invalidates cache and hides AI lines again
    fs.writeFileSync(
      path.join(vault, ".obsidian", "plugins", "agent-deck", "data.json"),
      JSON.stringify({ dream: { mcp: { excludeAiLogs: true } } }),
    );
    assert.equal(vaultFind(vault, "AI_ONLY_TRACE_TOKEN", { indexOpts }).items.length, 0);
    assert.ok(!vaultRead(vault, "日记/2026_11_27", { indexOpts }).content.includes("AI_ONLY_TRACE_TOKEN"));
  } finally {
    clearVaultIndexCache(vault, { indexDir });
    fs.rmSync(vault, { recursive: true, force: true });
    fs.rmSync(indexDir, { recursive: true, force: true });
  }
});
