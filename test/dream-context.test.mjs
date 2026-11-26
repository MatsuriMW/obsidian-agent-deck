import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s,c,n){if(s==='obsidian')return {url:'data:text/javascript,export class MarkdownView{};export class Notice{};',shortCircuit:true};return n(s,c)}`,
    ),
);

const { pickMemories, memorySection, memoryEntries, Dreaming } = await import("../src/dream.js");
const { registerContextResolver, buildDelegationPayload } = await import("../src/harness.js");

const MEMORY = [
  "# Agent Deck 长期记忆",
  "",
  "- **项目经验**：需求会在执行中变化的任务适合 advisor 策略，让便宜模型执行、强模型只在定方案时出主意。 ^dream-aaa",
  "  - 状态：有效",
  "- **偏好**：写提交信息时喜欢把动机写清楚。 ^dream-bbb",
  "  - 状态：有效",
  "- **待验证规律**：用户可能更喜欢先看结论再看过程。 ^dream-ccc",
  "  - 状态：有效",
  "- **偏好**：不喜欢被反复追问同一个问题。 ^dream-ddd",
  "  - 状态：已拒绝",
  "",
].join("\n");

function makePlugin(memory = MEMORY, { inject = true } = {}) {
  const plugin = {
    settings: { dream: { path: "Agent Deck/长期记忆.md", inject }, delegate: { confirmFirst: false } },
    app: {
      vault: {
        getAbstractFileByPath: (p) => (p === "Agent Deck/长期记忆.md" && memory != null ? { path: p } : null),
        read: async () => memory,
      },
      metadataCache: { getFirstLinkpathDest: () => null },
    },
    readNote: async () => "",
  };
  plugin.dreaming = new Dreaming(plugin);
  return plugin;
}

test("pickMemories 按任务词面挑出相关记忆，跳过已拒绝条目", () => {
  const entries = memoryEntries(MEMORY);
  assert.equal(entries.length, 4);
  const picked = pickMemories(entries, "用 advisor 策略把这块重构一次");
  assert.equal(picked.length, 1);
  assert.match(picked[0].text, /advisor/);
});

test("pickMemories 词面完全不重叠时不注入", () => {
  assert.deepEqual(pickMemories(memoryEntries(MEMORY), "量子色动力学与胶子禁闭"), []);
  assert.deepEqual(pickMemories(memoryEntries(MEMORY), ""), []);
});

test("pickMemories 只共用一个词时不注入（避免功能词巧合）", () => {
  // 真实库实测："设置"这类单词重合基本是噪音，宁可漏也不要塞。
  assert.deepEqual(pickMemories(memoryEntries(MEMORY), "帮我调整一下设置页"), []);
  const one = [{ kind: "lesson", text: "在 RAG 系统里通过设置余弦相似度来拒答", state: "有效" }];
  assert.deepEqual(pickMemories(one, "帮我改一下设置页的样式"), []);
});

test("pickMemories 遵守条数上限", () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ kind: "fact", text: `重构偏好第 ${i} 条`, state: "有效" }));
  assert.equal(pickMemories(many, "重构偏好", { limit: 2 }).length, 2);
});

test("pickMemories 超预算时整条跳过，不截半句", () => {
  const long = [{ kind: "fact", text: "重构偏好" + "很长的补充说明".repeat(40), state: "有效" }];
  assert.deepEqual(pickMemories(long, "重构偏好", { maxChars: 50 }), []);
});

test("memorySection 带出长期记忆说明并标注待验证推断", () => {
  const section = memorySection(pickMemories(memoryEntries(MEMORY), "想先看结论"));
  assert.match(section, /长期记忆/);
  assert.match(section, /待验证推断/);
  assert.match(section, /先看结论/);
});

test("Dreaming.contextSection 在开关关闭或没有重叠时返回空串", async () => {
  const offPlugin = makePlugin(MEMORY, { inject: false });
  assert.equal(await offPlugin.dreaming.contextSection("用 advisor 策略重构"), "");
  const plugin = makePlugin(MEMORY);
  assert.equal(await plugin.dreaming.contextSection("量子色动力学"), "");
  assert.equal(await plugin.dreaming.contextSection(""), "");
  assert.equal(await makePlugin(null).dreaming.contextSection("用 advisor 策略重构"), "");
});

test("派发上下文带上长期记忆段落，关掉开关后不再出现", async () => {
  const text = "用 advisor 策略把这块重构一次";
  const dispatch = async (plugin) => {
    const off = registerContextResolver({
      name: "dream-memory-test",
      resolve: async (ctx) => {
        const section = await plugin.dreaming.contextSection(ctx.block?.text || "");
        return section ? { section } : null;
      },
    });
    try {
      return await buildDelegationPayload({
        plugin,
        file: { path: "日记/2026_11_18.md" },
        lines: [text],
        block: { start: 0, end: 0, indent: 0, text },
      });
    } finally {
      off();
    }
  };
  const on = await dispatch(makePlugin(MEMORY));
  assert.match(on.prompt, /长期记忆/);
  assert.match(on.prompt, /advisor/);
  assert.doesNotMatch(on.prompt, /不喜欢被反复追问/);
  const off = await dispatch(makePlugin(MEMORY, { inject: false }));
  assert.doesNotMatch(off.prompt, /长期记忆/);
});

test("注入的记忆带来源块号，Agent 可以回去核原文", async () => {
  const { serializeMemoryFile, parseMemoryFile } = await import("../src/memory-store.js");
  const entry = parseMemoryFile(serializeMemoryFile({ id: "m-x", kind: "preference", text: "先看结论", state: "有效", date: "2026-11-18", sources: ["[[日记/2026_11_06#^mem-730d323d]]（用户日志，第 15 行）；原文：先看结论"] }));
  const section = memorySection(pickMemories([entry], "先看结论"));
  assert.match(section, /\n来源：\[\[日记\/2026_11_06#\^mem-730d323d\]\]$/, "来源收在文末一行");
  assert.ok(!section.includes("**"), "注入给 AI 的文本不带加粗符号");
  assert.match(section, /^- 偏好：先看结论$/m, "每条仍然是一句干净的话");
});

test("任务域分流与单条剔除：代码项目过滤无关个人事实，同项目经验提权，excludeIds 生效", async () => {
  const corpus = [
    { id: "m-sleep", kind: "fact", type: "事实", state: "有效", text: "用户需要 7.5 小时睡眠并采用 R90 睡眠周期法" },
    { id: "m-proj", kind: "lesson", type: "项目经验", state: "有效", project: "agent-deck", text: "在 agent-deck 项目构建脚本中必须检查 SLEEP 周期常量与构建配置" },
    { id: "m-other", kind: "lesson", type: "项目经验", state: "有效", project: "other-app", text: "other-app 的构建配置采用 webpack" },
  ];
  const plugin = makePlugin(null);
  plugin.settings.dream.store = "files";
  plugin.dreaming.loadEntries = async () => corpus;

  const codeRes = await plugin.dreaming.pickContext("排查 agent-deck 构建周期与 R90 睡眠配置", { projectName: "agent-deck", isCodeProject: true });
  assert.ok(codeRes.picked.some((e) => e.id === "m-proj"), "代码项目命中自身 lesson");
  assert.ok(!codeRes.picked.some((e) => e.id === "m-sleep"), "代码项目过滤个人生活 fact（防噪音）");

  const personalRes = await plugin.dreaming.pickContext("调整 R90 睡眠周期", { projectName: "", isCodeProject: false });
  assert.ok(personalRes.picked.some((e) => e.id === "m-sleep"), "非代码/个人任务可正常召回个人 fact");

  const excludedRes = await plugin.dreaming.pickContext("排查 agent-deck 构建周期", { projectName: "agent-deck", isCodeProject: true, excludeIds: ["m-proj"] });
  assert.ok(!excludedRes.picked.some((e) => e.id === "m-proj"), "确认框取消勾选的条目不再注入");
});

test("OKF 精度与信任分级：代码项目保留设计类事实、屏蔽过期记忆、人工确认高于未确认 AI 提案", async () => {
  const corpus = [
    { id: "m-design", kind: "fact", type: "事实", state: "有效", provenance: "user-log", text: "在设计信息流块的排序与交互时，按自定义 Pin 与双击 Zoom In 排布", sources: ["[[日记/2026_11_20]]（用户日志，第 9—9 行）；原文：排序"] },
    { id: "m-stale", kind: "lesson", type: "项目经验", state: "有效", staleAfter: "2020-01-01", text: "2020 年旧版信息流排序交互草稿已经失效" },
    { id: "m-ai-prop", kind: "lesson", type: "项目经验", state: "有效", verified: false, provenance: "ai-log", text: "AI 记录建议信息流排序增加动画参数，该方案尚未实施" },
    { id: "m-human", kind: "lesson", type: "项目经验", state: "有效", verified: true, provenance: "user-log", text: "信息流排序规则以 Pin 优先并与访问次数联动", project: "info-feed" },
  ];
  const plugin = makePlugin(null);
  plugin.settings.dream.store = "files";
  plugin.dreaming.loadEntries = async () => corpus;

  const res = await plugin.dreaming.pickContext("设计信息流 Pin 块排序与双击 Zoom In 交互", { projectName: "info-feed", isCodeProject: true });
  assert.ok(res.picked.some((e) => e.id === "m-design"), "多维命中的设计类 fact 不被一刀切过滤");
  assert.ok(!res.picked.some((e) => e.id === "m-stale"), "超过 stale_after 的条目默认不注入");
  const idxHuman = res.picked.findIndex((e) => e.id === "m-human");
  const idxAi = res.picked.findIndex((e) => e.id === "m-ai-prop");
  assert.ok(idxHuman >= 0 && (idxAi < 0 || idxHuman < idxAi), "人工已确认经验优先于未确认 AI 提案");
  assert.match(res.section, /已确认/);
  if (idxAi >= 0) assert.match(res.section, /AI提炼·未确认/);
});

test("图谱 2 跳检索：任务通过 [[概念]]/father 连通时，零词面重叠的记忆也能被召回", async () => {
  const corpus = [
    { id: "m-hop1", kind: "preference", type: "偏好", state: "有效", concepts: ["[[视频口播]]"], text: "口播开篇先抛核心问题再展开分析" },
    { id: "m-hop2", kind: "fact", type: "事实", state: "有效", concepts: ["[[视觉隐喻]]"], text: "讲解机制优先采用生活中的具体物件作类比" },
  ];
  const plugin = makePlugin(null);
  plugin.settings.dream.store = "files";
  plugin.dreaming.loadEntries = async () => corpus;
  plugin.dreaming.buildConceptCatalog = () => ({ items: [{ term: "视频口播", low: "视频口播", noteName: "视频口播", path: "Concepts/视频口播.md", tier: "strict", isAscii: false, norm: "视频口播" }], byNorm: new Map([["视频口播", "视频口播"]]) });
  plugin.dreaming.buildConceptParents = () => new Map([["视频口播", ["视觉隐喻"]]]);

  const res = await plugin.dreaming.pickContext("准备下期脚本开头", { refs: ["视频口播"], isCodeProject: false });
  assert.ok(res.picked.some((e) => e.id === "m-hop1"), "1 跳关联记忆被召回");
  assert.ok(res.picked.some((e) => e.id === "m-hop2"), "2 跳 father 概念记忆被召回");
  assert.match(res.details.find((d) => d.entry.id === "m-hop2").why.join(","), /图谱:/);

  // projectName 不应作为零词面图谱种子把无关同项目记忆全量灌入
  const projCorpus = [
    { id: "m-p-unrel", kind: "lesson", state: "有效", project: "Agent Deck", projectLink: "[[Agent Deck]]", text: "多端协作需配置独立工作树分支隔离" },
    { id: "m-p-hit", kind: "lesson", state: "有效", project: "Agent Deck", projectLink: "[[Agent Deck]]", text: "发布检查运行 npm run check:deploy" },
  ];
  plugin.dreaming.loadEntries = async () => projCorpus;
  const projRes = await plugin.dreaming.pickContext("修一个 css 颜色对齐细节", { projectName: "Agent Deck", isCodeProject: true });
  assert.equal(projRes.picked.length, 0, "任务词面与项目无关时，projectName 不得强行灌入无关同项目记忆");
});
