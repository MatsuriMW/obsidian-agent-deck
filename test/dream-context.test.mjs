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
