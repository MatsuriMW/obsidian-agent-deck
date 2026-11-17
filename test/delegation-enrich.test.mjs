import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Delegator } from "../src/delegation.js";
import { DEFAULTS, deepMerge } from "../src/constants.js";

// enrichPrompt：任务行里被引用的笔记 → prompt 顶部列绝对路径。只认「真的会被当素材读」的链接。
const HEAD = "任务里引用的笔记（可直接读全文）：";
const notes = {
  日记: { path: "项目A/日记.md", extension: "md" },
  "项目A/日记": { path: "项目A/日记.md", extension: "md" },
  图片: { path: "附件/图片.png", extension: "png" },
  蓝图: { path: "看板/蓝图.canvas", extension: "canvas" },
  当前笔记: { path: "inbox/当前.md", extension: "md" },
  载荷: { path: "Agent Deck/派发/2026-11-18-^ad-x-测试.md", extension: "md" },
  代码块笔记: { path: "参考/代码块.md", extension: "md" },
  行内代码笔记: { path: "参考/行内.md", extension: "md" },
  真素材: { path: "参考/真素材.md", extension: "md" },
};

// 造一个库根：插件目录里有没有 memory-query.mjs、记忆目录在不在，都由调用方决定。
function makeVault({ script = true, memory = true } = {}) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "ad-enrich-"));
  if (script) {
    const dir = path.join(vault, ".obsidian", "plugins", "agent-deck", "scripts");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "memory-query.mjs"), "// stub\n");
  }
  if (memory) fs.mkdirSync(path.join(vault, "Agent Deck", "记忆"), { recursive: true });
  return vault;
}

function makeDelegator(vaultPath = "/vault") {
  return new Delegator({
    settings: deepMerge(DEFAULTS, {}),
    jobs: {},
    vaultPath,
    app: {
      vault: { getAbstractFileByPath: () => null },
      metadataCache: { getFirstLinkpathDest: (name) => notes[String(name).trim()] || null },
    },
  });
}

async function enrich(blockText, vaultPath = "/vault") {
  const resolved = { file: { path: "inbox/当前.md" }, block: { text: blockText }, prompt: "原始 prompt" };
  await makeDelegator(vaultPath).enrichPrompt(resolved);
  return resolved.prompt;
}

// 顶部那行「需要更多背景时…」由另一组用例单独断言，这里只看引用笔记段。
const body = (prompt) => prompt.replace(/^需要更多背景时：.*\n\n/, "");

test("同名笔记：按 metadataCache 解析出的那一个列，且同路径只列一次", async () => {
  const prompt = body(await enrich("- TODO 对照 [[日记]] 和 [[项目A/日记]] @dsh"));
  assert.ok(prompt.startsWith(HEAD), "顶部是引用笔记清单");
  assert.equal(prompt.split("/vault/项目A/日记.md").length - 1, 1, "同一个 resolve 结果不重复列出");
  assert.ok(!prompt.includes("/vault/日记.md"), "不会把裸名拼成路径");
});

test("非 md 目标（图片、canvas）与解析不到的链接都不算素材", async () => {
  const prompt = body(await enrich("- TODO 看图 [[图片]] 和 [[蓝图]]，还有 [[不存在这篇]] @dsh"));
  assert.ok(prompt.startsWith("原始 prompt"), "没有可用引用时不动 prompt");
  assert.ok(!prompt.includes("/vault/附件/图片.png"));
  assert.ok(!prompt.includes("/vault/看板/蓝图.canvas"));
  assert.ok(!prompt.includes("不存在这篇"));
});

test("代码块与行内代码里的 [[...]] 不算引用", async () => {
  const blockText = [
    "- TODO 按代码块里的写法来 @dsh",
    "\t- 写法：`[[行内代码笔记]]`",
    "\t```md",
    "\t[[代码块笔记]]",
    "\t```",
    "\t- 真素材是 [[真素材]]",
  ].join("\n");
  const prompt = body(await enrich(blockText));
  assert.ok(prompt.includes("/vault/参考/真素材.md"), "代码块外的引用照常列出");
  assert.ok(!prompt.includes("/vault/参考/代码块.md"), "代码块里的双链不是引用");
  assert.ok(!prompt.includes("/vault/参考/行内.md"), "行内代码里的双链不是引用");
});

test("任务块自身与它挂的派发载荷/草稿都不算素材", async () => {
  const blockText = [
    "- TODO 基于 [[当前笔记]] 改 @dsh",
    "\t- 📝 [[载荷|派发草稿]]",
    "\t- 参考 [[真素材]]",
  ].join("\n");
  const prompt = body(await enrich(blockText));
  assert.ok(!prompt.includes("inbox/当前.md"), "不把当前笔记自己当素材");
  assert.ok(!prompt.includes("Agent Deck/派发/"), "不把派发载荷当素材");
  assert.ok(prompt.includes("/vault/参考/真素材.md"));
});

test("运行时记忆查询：脚本和记忆目录都在时，prompt 顶部给一行用法", async () => {
  const vault = makeVault();
  const prompt = await enrich("- TODO 查一下以前的结论 @dsh", vault);
  assert.equal(prompt.split("\n")[0], `需要更多背景时：node "${vault}/.obsidian/plugins/agent-deck/scripts/memory-query.mjs" search "关键词"`);
});

test("运行时记忆查询：脚本没装或还没记忆时，不加这行（不教 Agent 跑不存在的命令）", async () => {
  for (const opts of [{ script: true, memory: false }, { script: false, memory: true }, { script: false, memory: false }]) {
    const prompt = await enrich("- TODO 查一下以前的结论 @dsh", makeVault(opts));
    assert.ok(!prompt.includes("memory-query.mjs"), `不该出现用法行（${JSON.stringify(opts)}）`);
    assert.equal(prompt, "原始 prompt");
  }
});

test("草稿已经带过的行，派发时不再套第二遍", async () => {
  const vault = makeVault();
  const once = await enrich("- TODO 查一下 [[项目A/日记]] @dsh", vault);
  const line = once.split("\n")[0];
  const again = { file: { path: "inbox/当前.md" }, block: { text: "- TODO 查一下 [[项目A/日记]] @dsh" }, prompt: once };
  await makeDelegator(vault).enrichPrompt(again);
  assert.equal(again.prompt, once, "同一份富化内容不会叠两次");
  assert.equal(again.prompt.split(line).length - 1, 1, "用法行只出现一次");
  assert.equal(again.prompt.split(HEAD).length - 1, 1, "引用笔记清单只出现一次");
});

test("载荷快照：没有草稿时，落盘的 payload 里就已经有富化行", async () => {
  const vaultPath = makeVault();
  const files = new Map();
  files.set("inbox/当前.md", { path: "inbox/当前.md", content: "- TODO 看 [[项目A/日记]] @dsh\n" });
  const vault = {
    getAbstractFileByPath: (p) => files.get(p) || null,
    createFolder: async () => {},
    create: async (p, content) => { files.set(p, { path: p, content }); },
    modify: async (file, content) => { file.content = content; },
    read: async (file) => file.content,
  };
  const plugin = {
    settings: deepMerge(DEFAULTS, {}),
    jobs: {},
    vaultPath,
    app: { vault, metadataCache: { getFirstLinkpathDest: (n) => notes[String(n).trim()] || null } },
    viewForPath: () => null,
    readNote: async (p) => files.get(p)?.content || "",
    writeNote: async (p, text) => { const f = files.get(p); if (f) f.content = text; },
  };
  const delegator = new Delegator(plugin);
  const resolved = { file: { path: "inbox/当前.md" }, lines: ["- TODO 看 [[项目A/日记]] @dsh"], block: { start: 0, end: 0, text: "- TODO 看 [[项目A/日记]] @dsh" }, name: "看看日记", prompt: "原始 prompt" };
  const payload = await delegator.payloadSnapshot(resolved, null, "dsh");
  assert.ok(payload?.path, "载荷写出来了");
  const written = files.get(payload.path).content;
  assert.ok(written.includes("需要更多背景时："), "记忆查询用法进了载荷文件");
  assert.ok(written.includes(HEAD), "引用笔记清单进了载荷文件");
  assert.ok(written.includes(`${vaultPath}/项目A/日记.md`), "被引用笔记的绝对路径也在里面");
});

test("问答回灌：笔记里有 ❓ / ✍️ 时，prompt 里出现「问 / 答」段，且不重复", async () => {
  const vault = makeVault();
  const blockText = [
    "- TODO 发布插件 @dsh",
    "  - ❓ 第1轮：版本号用 1.9.6 还是 2.0.0？",
    "  - ✍️ 答：用 1.9.6",
  ].join("\n");
  const resolved = { file: { path: "inbox/当前.md" }, lines: blockText.split("\n"), block: { start: 0, end: 2, text: blockText }, prompt: "原始 prompt" };
  await makeDelegator(vault).enrichPrompt(resolved);
  assert.match(resolved.prompt, /任务里的问答记录/);
  assert.match(resolved.prompt, /第1轮：问「版本号用 1\.9\.6 还是 2\.0\.0？」→ 答「用 1\.9\.6」/);
  const again = { file: resolved.file, lines: resolved.lines, block: resolved.block, prompt: resolved.prompt };
  await makeDelegator(vault).enrichPrompt(again);
  assert.equal(again.prompt, resolved.prompt, "同一段不叠第二遍");
});
