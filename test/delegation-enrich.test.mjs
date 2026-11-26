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

function makeDelegator(vaultPath = path.join(path.sep, "vault")) {
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

async function enrich(blockText, vaultPath = path.join(path.sep, "vault")) {
  const resolved = { file: { path: "inbox/当前.md" }, block: { text: blockText }, prompt: "原始 prompt" };
  await makeDelegator(vaultPath).enrichPrompt(resolved);
  return resolved.prompt;
}

const v = (...parts) => path.join(path.sep, "vault", ...parts);

// 顶部那行「需要更多背景时…」由另一组用例单独断言，这里只看引用笔记段。
const body = (prompt) => prompt.replace(/^需要更多背景时：.*\n\n/, "");

test("同名笔记：按 metadataCache 解析出的那一个列，且同路径只列一次", async () => {
  const prompt = body(await enrich("- TODO 对照 [[日记]] 和 [[项目A/日记]] @dsh"));
  assert.ok(prompt.startsWith(HEAD), "顶部是引用笔记清单");
  assert.equal(prompt.split(v("项目A", "日记.md")).length - 1, 1, "同一个 resolve 结果不重复列出");
  assert.ok(!prompt.includes(v("日记.md")), "不会把裸名拼成路径");
});

test("非 md 目标（图片、canvas）与解析不到的链接都不算素材", async () => {
  const prompt = body(await enrich("- TODO 看图 [[图片]] 和 [[蓝图]]，还有 [[不存在这篇]] @dsh"));
  assert.ok(prompt.startsWith("原始 prompt"), "没有可用引用时不动 prompt");
  assert.ok(!prompt.includes(v("附件", "图片.png")));
  assert.ok(!prompt.includes(v("看板", "蓝图.canvas")));
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
  assert.ok(prompt.includes(v("参考", "真素材.md")), "代码块外的引用照常列出");
  assert.ok(!prompt.includes(v("参考", "代码块.md")), "代码块里的双链不是引用");
  assert.ok(!prompt.includes(v("参考", "行内.md")), "行内代码里的双链不是引用");
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
  assert.ok(prompt.includes(v("参考", "真素材.md")));
});

test("运行时记忆查询：脚本和记忆目录都在时，prompt 顶部给一行用法", async () => {
  const vault = makeVault();
  const prompt = await enrich("- TODO 查一下以前的结论 @dsh", vault);
  const scriptPath = path.join(vault, ".obsidian", "plugins", "agent-deck", "scripts", "memory-query.mjs");
  assert.equal(prompt.split("\n")[0], `需要更多背景时：node "${scriptPath}" search "关键词"`);
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
  assert.ok(written.includes(path.join(vaultPath, "项目A", "日记.md")), "被引用笔记的绝对路径也在里面");
});

test("问答回灌：笔记里有 ❓ / ✍️ 时，prompt 里出现「问 / 答」段，且不重复，并放在动态末尾（前稳后动）", async () => {
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
  const hintAt = resolved.prompt.indexOf("需要更多背景时：");
  const bodyAt = resolved.prompt.indexOf("原始 prompt");
  const replyAt = resolved.prompt.indexOf("任务里的问答记录");
  assert.ok(hintAt >= 0 && bodyAt > hintAt && replyAt > bodyAt, "前稳后动：稳定工具提示在前、动态问答回灌在末尾");
  const again = { file: resolved.file, lines: resolved.lines, block: resolved.block, prompt: resolved.prompt };
  await makeDelegator(vault).enrichPrompt(again);
  assert.equal(again.prompt, resolved.prompt, "同一段不叠第二遍");
});

test("ContextBundle 联合 enrichPrompt：同时扫描祖先链双链，且稳定段在前、动态问答在末尾", async () => {
  const vault = makeVault();
  const { buildDelegationPayload } = await import("../src/harness.js");
  const files = new Map();
  const lines = [
    "- 项目 [[日记]]",
    "  - TODO 结合 [[真素材]] 处理任务",
    "    - ❓ 第1轮：先改哪块？",
    "    - ✍️ 答：先改 harness",
  ];
  const block = { start: 1, end: 3, indent: 2, text: lines.slice(1).join("\n") };
  const plugin = {
    settings: deepMerge(DEFAULTS, { delegate: { confirmFirst: false, promptPrefix: "GLOBAL_STABLE_PREFIX" } }),
    jobs: {},
    vaultPath: vault,
    app: {
      vault: { getAbstractFileByPath: (p) => files.get(p) || null },
      metadataCache: { getFirstLinkpathDest: (n) => notes[String(n).trim()] || null },
    },
    readNote: async () => "# 笔记正文\n内容行",
  };
  const payload = await buildDelegationPayload({ plugin, file: { path: "inbox/当前.md" }, lines, block });
  const resolved = { file: { path: "inbox/当前.md" }, lines, block, ...payload };
  await new Delegator(plugin).enrichPrompt(resolved);
  assert.ok(resolved.prompt.includes(path.join(vault, "项目A", "日记.md")), "祖先链里的 [[日记]] 也进入绝对路径清单");
  assert.ok(resolved.prompt.includes(path.join(vault, "参考", "真素材.md")));
  assert.equal(resolved.bundle.stats.notePathCount, 2);
  assert.equal(resolved.bundle.stats.hasReply, true);
  const iPrefix = resolved.prompt.indexOf("GLOBAL_STABLE_PREFIX");
  const iHint = resolved.prompt.indexOf("需要更多背景时：");
  const iPaths = resolved.prompt.indexOf(HEAD);
  const iLinked = resolved.prompt.indexOf("关联笔记上下文");
  const iTask = resolved.prompt.indexOf("结合 [[真素材]]");
  const iReply = resolved.prompt.indexOf("任务里的问答记录");
  assert.ok(
    iPrefix >= 0 && iHint > iPrefix && iPaths > iHint && iLinked > iPaths && iTask > iLinked && iReply > iTask,
    "ContextBundle 按前稳后动顺序装配",
  );
});

test("memoryToolHint 读取 索引.md 的有效条数、高频概念并附带 --project 过滤提示", async () => {
  const vault = makeVault();
  const memDir = path.join(vault, "Agent Deck", "记忆");
  fs.writeFileSync(
    path.join(memDir, "索引.md"),
    [
      "# 记忆索引",
      "",
      "共 3 条有效非私密记忆 · 由插件生成。",
      "分布：项目经验 2 · 偏好 1 · 事实 0 · 待验证规律 0 · 已确认 2",
      "高频概念：[[Agent Deck]](3) · [[Obsidian]](2) · [[CodeRabbit]](1)",
    ].join("\n"),
  );
  const d = makeDelegator(vault);
  const hint = await d.memoryToolHint({ projectName: "Agent Deck" });
  const hintLines = hint.split("\n");
  const scriptPath = path.join(vault, ".obsidian", "plugins", "agent-deck", "scripts", "memory-query.mjs");
  assert.equal(hintLines[0], `需要更多背景时：node "${scriptPath}" search "关键词"`, "首行契约保持不变");
  assert.match(hintLines[1], /共 3 条有效记忆/);
  assert.match(hintLines[1], /--project "Agent Deck"/);
  assert.match(hintLines[1], /常见主题：Agent Deck \/ Obsidian \/ CodeRabbit/);

  // 索引里写明 0 条有效非私密记忆时，即使目录内有已拒绝文件也不误报条数。
  fs.writeFileSync(path.join(memDir, "已拒绝条目.md"), "---\nstate: 已拒绝\n---\n拒绝\n");
  fs.writeFileSync(path.join(memDir, "索引.md"), "# 记忆索引\n\n共 0 条有效非私密记忆 · 由插件生成。\n");
  const emptyHint = await d.memoryToolHint();
  assert.equal(emptyHint, `需要更多背景时：node "${scriptPath}" search "关键词"`);
});

test("memoryToolHint 包含全库 vault-* 入口与仓库 AGENTS.md / CLAUDE.md 分工提示", async () => {
  const { detectRepoRuleFiles } = await import("../src/delegation.js");
  const vault = makeVault();
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-repo-rules-"));
  try {
    fs.writeFileSync(path.join(repoDir, "AGENTS.md"), "# rules\n");
    fs.writeFileSync(path.join(repoDir, "CLAUDE.md"), "# claude\n");
    fs.writeFileSync(path.join(vault, "Agent Deck", "记忆", "索引.md"), "# 记忆索引\n\n共 5 条有效非私密记忆 · 由插件生成。\n");

    assert.deepEqual(detectRepoRuleFiles(repoDir, vault), ["AGENTS.md", "CLAUDE.md"]);
    assert.deepEqual(detectRepoRuleFiles(vault, vault), [], "Vault 自身目录不算外部仓库规则");

    const d = makeDelegator(vault);
    const hint = await d.memoryToolHint({ projectName: "agent-deck", repoRuleFiles: ["AGENTS.md"] });
    assert.match(hint, /vault-find "关键词"｜vault-outline <笔记>｜vault-read <笔记#章节>｜vault-related <笔记>/);
    assert.match(hint, /仓内规范以 AGENTS\.md 为准/);

    const noMemVault = makeVault({ script: true, memory: false });
    try {
      const hintEntry = await makeDelegator(noMemVault).memoryToolHint({ hasEntryMap: true });
      assert.match(hintEntry, /vault-outline <笔记>｜vault-read <笔记#章节>/);
    } finally {
      fs.rmSync(noMemVault, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});

test("canAgentReadLocalFiles 与 resolveBlockContext 按 Agent 能力自动启用或关闭 entryMapMode", async () => {
  const { canAgentReadLocalFiles } = await import("../src/agent-registry.js");
  for (const id of ["claude", "codex", "dsh", "antigravity", "opencode", "qoder", "hermes", "minimax", "cursor", "trae", "t3code", "kimicode", "gemini"]) {
    assert.equal(canAgentReadLocalFiles(id, "background"), true, `${id} 后台应支持本地工具/读文件`);
  }
  assert.equal(canAgentReadLocalFiles("workbuddy", "terminal"), true);
  assert.equal(canAgentReadLocalFiles("workbuddy", "desktop"), false);
  for (const id of ["teleagent", "qwenwork", "grokbot", "cindy", "orca", "muse", "doubaowork"]) {
    assert.equal(canAgentReadLocalFiles(id), false, `${id} 桌面交接应保留摘要内联`);
  }
  for (const id of ["qoder", "cursor", "trae", "kimicode"]) {
    assert.equal(canAgentReadLocalFiles(id, "desktop"), false, `${id} 回退桌面粘贴时关闭 entryMapMode`);
  }
  assert.equal(canAgentReadLocalFiles("codex", "clipboard"), false);
  assert.equal(canAgentReadLocalFiles(""), false);

  const vault = makeVault();
  try {
    const noteBody = "---\ntype: 规范\ndef: 自动入口地图测试\n---\n# 第一章\n- SECRET_FULL_INLINE_LINE\n## 第二章\n- 明细\n";
    const plugin = {
      settings: deepMerge(DEFAULTS, {}),
      jobs: {},
      vaultPath: vault,
      app: {
        vault: { getAbstractFileByPath: () => null },
        metadataCache: { getFirstLinkpathDest: (n) => (String(n).trim() === "真素材" ? { path: "参考/真素材.md", extension: "md" } : null) },
      },
      readNote: async () => noteBody,
    };
    const d = new Delegator(plugin);
    const lines = ["- TODO 处理 [[真素材]] @codex"];
    const block = { start: 0, end: 0, indent: 0, text: lines[0] };

    for (const cliAgent of ["codex", "antigravity", "dsh"]) {
      const resolved = await d.resolveBlockContext({ file: { path: "日记/2026_11_27.md" }, lines, block, line: 0, agent: cliAgent, destination: "background" }, "err");
      assert.equal(resolved.bundle.stats.entryMapMode, true, `${cliAgent} 应自动启用 entryMapMode`);
      assert.match(resolved.prompt, /背景参考资料入口地图，正文未内联/);
      assert.match(resolved.prompt, /## 第二章\(L7\)/);
      assert.ok(!resolved.prompt.includes("SECRET_FULL_INLINE_LINE"), `${cliAgent} 入口地图不直接塞入整篇正文`);
    }

    const desktopResolved = await d.resolveBlockContext({ file: { path: "日记/2026_11_27.md" }, lines, block, line: 0, agent: "workbuddy", destination: "desktop" }, "err");
    assert.equal(desktopResolved.bundle.stats.entryMapMode, false, "桌面粘贴端保持正文摘要内联");
    assert.match(desktopResolved.prompt, /SECRET_FULL_INLINE_LINE/);

    const fallbackResolved = await d.resolveBlockContext({ file: { path: "日记/2026_11_27.md" }, lines, block, line: 0, agent: "cursor", destination: "desktop" }, "err");
    assert.equal(fallbackResolved.bundle.stats.entryMapMode, false, "cursor 桌面回退不启用 entryMapMode");
    assert.match(fallbackResolved.prompt, /SECRET_FULL_INLINE_LINE/);
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
  }
});
