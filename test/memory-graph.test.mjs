import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVaultConceptCatalog,
  deriveShortMemoryTitle,
  expandGraphMemories,
  extractSourceNotes,
  matchConceptLinks,
  recommendedGraphSettings,
  suggestConceptPromotions,
} from "../src/memory-graph.js";

test("extractSourceNotes 从 sources 提取纯双链供图谱解析", () => {
  const out = extractSourceNotes([
    "[[日记/2026_11_20#^mem-12345678]]（用户日志，第 9—9 行）；原文：排序规则",
    "[[日记/2026_11_20#^mem-12345678]]（用户日志，第 9—9 行）；原文：重复",
    "Claude 记忆导出（/topics/car.md，2026-08-09）；原文：极氪7X",
  ]);
  assert.deepEqual(out, ["[[日记/2026_11_20#^mem-12345678]]"]);
});

test("deriveShortMemoryTitle 去冗余前缀并在句读处生成图谱短命题名", () => {
  const stock = deriveShortMemoryTitle("用户在 A 股投资中不买红利股（“老登股”）与国内消费板块", 18);
  assert.ok(stock.startsWith("A 股投资中不买红利股") && !stock.includes("老登股"));
  const win = deriveShortMemoryTitle("跨平台测试在 Windows runner 上不能手写 POSIX 路径期望值（待验证）", 22);
  assert.ok(!win.includes("2026-"));
  assert.ok(!win.includes("待验证"));
  assert.ok(win.endsWith("Windows runner") || !/[A-Za-z]$/.test(win), "不把英文单词切半");
  assert.equal(deriveShortMemoryTitle("AI 记录建议用 electron-builder 统一配置，尚未实施", 18), "用 electron-builder");
});

test("buildVaultConceptCatalog + matchConceptLinks 排除泛词与超高入链节点", () => {
  const incoming = new Map([["Concepts/高频泛词.md", 120]]);
  const catalog = buildVaultConceptCatalog([
    { path: "Concepts/高频泛词.md" },
    { path: "Concepts/日常.md" },
    { path: "Concepts/口径.md" },
    { path: "Concepts/心智模型.md" },
    { path: "Concepts/叙事.md" },
    { path: "软件与数字工具/Obsidian.md", aliases: ["obsidian-md"] },
    { path: "编程与技术/单元测试.md" },
    { path: "Agent Deck.md" },
    { path: "日记/2026_11_20.md" },
  ], { incomingCounts: incoming });

  const lifeHits = matchConceptLinks("用户的日常座驾为 2025 年购入的极氪 7X，顺便聊业务口径", catalog, { strictAuto: true });
  assert.deepEqual(lifeHits.concepts, [], "2字停用词 日常/口径 不得产生噪音边");

  const techHits = matchConceptLinks("在 agent-deck 里使用 Obsidian 做单元测试并建心智模型", catalog, {
    strictAuto: true,
    projectName: "agent-deck",
  });
  assert.equal(techHits.projectLink, "[[Agent Deck]]");
  assert.ok(techHits.concepts.includes("[[Obsidian]]"));
  assert.ok(techHits.concepts.includes("[[心智模型]]"));
  assert.ok(techHits.concepts.includes("[[单元测试]]"));

  const llmCand = matchConceptLinks("宏观叙事会影响心智模型判断", catalog, { strictAuto: false });
  assert.ok(llmCand.candidateNames.includes("叙事"), "仅严格模式隐藏2字具体概念，LLM候选放行 叙事");
});

test("expandGraphMemories 支持沿 concepts 与 father 的 1-2 跳零词面重叠召回", () => {
  const corpus = [
    {
      id: "m-bridge",
      kind: "preference",
      state: "有效",
      concepts: ["[[视频口播]]", "[[机构概念通俗化]]"],
      text: "把晦涩概念翻译给普通观众时优先采用生活类比",
    },
    {
      id: "m-zero-lex",
      kind: "fact",
      state: "有效",
      concepts: ["[[视频口播]]"],
      text: "每条成片逐字稿都需要先做事实核查",
    },
    {
      id: "m-father",
      kind: "lesson",
      state: "有效",
      concepts: ["[[金融叙事]]"],
      text: "区分预期差与真实加息路径",
    },
  ];
  const conceptParents = new Map([["视频口播", ["金融叙事"]]]);
  const hits = expandGraphMemories(corpus, "帮我看一下这段逐字检查要点", {
    seedRefs: ["视频口播"],
    conceptParents,
  });
  assert.equal(hits.get("m-bridge")?.hop, 1);
  assert.equal(hits.get("m-zero-lex")?.hop, 1);
  assert.equal(hits.get("m-father")?.hop, 2, "通过 [[视频口播]] → [[金融叙事]] 找到 2 跳记忆");
});

test("recommendedGraphSettings 保留既有力学参数并支持自定义目录与双视角预设", () => {
  const next = recommendedGraphSettings({ repelStrength: 15, search: "" }, { memoryDir: "知识库/记忆", preset: "kind" });
  assert.equal(next.repelStrength, 15);
  assert.equal(next.showArrow, true);
  assert.match(next.search, /-file:"索引"/);
  assert.match(next.search, /-path:"知识库\/记忆\/archive"/);
  assert.ok(next.colorGroups.some((g) => g.query.includes('path:"知识库/记忆" ["conflicts_with"]')));
  assert.ok(next.colorGroups.some((g) => g.query.includes('path:"知识库/记忆" ["kind":"lesson"]')));

  const trustPreset = recommendedGraphSettings({ search: "tag:#keep" }, { memoryDir: "知识库/记忆", preset: "trust" });
  assert.ok(trustPreset.search.startsWith("tag:#keep "), "保留已有过滤前缀");
  assert.match(trustPreset.search, /-path:"知识库\/记忆\/archive"/);
  assert.ok(trustPreset.colorGroups.some((g) => g.query.includes('["provenance":"user-log"]')));
  assert.ok(trustPreset.colorGroups.some((g) => g.query.includes('["provenance":"ai-log"]')));
});

test("deriveShortMemoryTitle 避免在未闭合中文引号内截断或留下半边引号", () => {
  const quoted = deriveShortMemoryTitle("在架构评审中必须优先守住「长期记忆绝对无损，不能丢手写正文」这一核心原则", 22);
  assert.ok(!quoted.includes("「") || quoted.includes("」"), `不得残留未闭合「：${quoted}`);
  const shortPrefixBook = deriveShortMemoryTitle("阅读《深入理解计算机系统，尤其是虚拟内存章节》后的笔记总结", 16);
  assert.ok(!shortPrefixBook.includes("《") || shortPrefixBook.includes("》"), `不得残留未闭合《：${shortPrefixBook}`);
  const longPrefixBook = deriveShortMemoryTitle("建议认真阅读《深入理解计算机系统，尤其是虚拟内存章节》后的笔记总结", 18);
  assert.equal(longPrefixBook, "建议认真阅读");
  const framing = deriveShortMemoryTitle("在 RAG 系统中，设置拒答门槛优于强行生成不完整回答", 22);
  assert.ok(framing.includes("设置拒答门槛"), `前置框架不应在 13 字前早断：${framing}`);
  const noDangling = deriveShortMemoryTitle("在 agent-deck 修改记忆解析或部署逻辑前必须执行检查与验证流程", 16);
  assert.ok(!/[的了着和与及或]$/.test(noDangling), `截断不得遗留悬挂虚词：${noDangling}`);
});

test("suggestConceptPromotions 聚合高频概念并区分未建页虚节点与已有概念页", () => {
  const entries = [
    ...Array.from({ length: 5 }, (_, i) => ({
      id: `m-g-${i}`,
      state: "有效",
      concepts: ["[[知识图谱]]", "[[方法]]"],
      path: `Agent Deck/记忆/g-${i}.md`,
    })),
    ...Array.from({ length: 5 }, (_, i) => ({
      id: `m-d-${i}`,
      state: "有效",
      concepts: ["[[Obsidian]]"],
      path: `Agent Deck/记忆/d-${i}.md`,
    })),
    { id: "m-inactive", state: "已被替代", concepts: ["[[知识图谱]]"] },
    { id: "m-priv", state: "有效", private: true, concepts: ["[[知识图谱]]"] },
  ];
  const promo = suggestConceptPromotions(entries, { existingNotes: ["软件/Obsidian.md"], minCount: 5 });
  assert.equal(promo.ghostCandidates.length, 1);
  assert.equal(promo.ghostCandidates[0].name, "知识图谱");
  assert.equal(promo.ghostCandidates[0].count, 5);
  assert.equal(promo.denseConcepts.length, 1);
  assert.equal(promo.denseConcepts[0].name, "Obsidian");
  assert.ok(!promo.all.some((x) => x.name === "方法"), "停用词不进入升格建议");
});
