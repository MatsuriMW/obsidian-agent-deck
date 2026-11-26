import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s,c,n){if(s==='obsidian')return {url:'data:text/javascript,export class MarkdownView{};export class Notice{};',shortCircuit:true};return n(s,c)}`,
    ),
);

const { resolveDelegationContext, buildDelegationPayload, registerContextResolver, clearCustomContextResolvers } = await import(
  "../src/harness.js"
);

function makePlugin(notes = {}, { fail = new Set() } = {}) {
  return {
    settings: { delegate: { confirmFirst: false } },
    app: {
      metadataCache: {
        getFirstLinkpathDest: (target) => {
          const hit = notes[target];
          return hit ? { path: hit.path, extension: "md" } : null;
        },
      },
    },
    readNote: async (path) => {
      if (fail.has(path)) throw new Error("unreadable");
      const hit = Object.values(notes).find((n) => n.path === path);
      return hit ? hit.content : "";
    },
  };
}

function single(text) {
  return { start: 0, end: 0, indent: 0, text };
}

async function promptFor(plugin, text) {
  return buildDelegationPayload({
    plugin,
    file: { path: "日记/2026_11_16.md" },
    lines: [text],
    block: single(text),
  });
}

test("harness resolves heading subpaths without leaking other sections", async () => {
  const plugin = makePlugin({
    架构说明: {
      path: "docs/架构说明.md",
      content: [
        "---",
        "tags: [arch]",
        "---",
        "# 总览",
        "这里是总览，不该出现。",
        "## 分工",
        "- 后端交给 Codex",
        "- 前端交给 Claude",
        "### 例外",
        "文档由 Qoder 处理",
        "## 排期",
        "排期内容不该出现。",
      ].join("\n"),
    },
  });
  const { prompt, contextLines } = await promptFor(plugin, "- TODO 补充 [[架构说明#分工]] 的上下文");
  assert.match(prompt, /后端交给 Codex/);
  assert.match(prompt, /文档由 Qoder 处理/, "nested headings below the requested one belong to the section");
  assert.ok(!prompt.includes("这里是总览"), "content before the heading is excluded");
  assert.ok(!prompt.includes("排期内容不该出现"), "the next same-level heading ends the section");
  assert.ok(prompt.includes("[[架构说明#分工]]"), "snippet keeps a backlink to the exact section");
  assert.deepEqual(contextLines, []);
});

test("harness resolves block-id subpaths as the block subtree, not the whole note", async () => {
  const plugin = makePlugin({
    镜像源: {
      path: "项目/镜像源.md",
      content: [
        "# 说明",
        "- 无关开头",
        "- DOING 远端关联任务 ^ad-remote",
        "  - 子项 A",
        "  - 子项 B",
        "- 无关尾部",
      ].join("\n"),
    },
  });
  const { prompt } = await promptFor(plugin, "- TODO 参照 [[镜像源#^ad-remote]] 继续");
  assert.match(prompt, /远端关联任务/);
  assert.match(prompt, /子项 A/);
  assert.match(prompt, /子项 B/);
  assert.ok(!prompt.includes("无关开头"));
  assert.ok(!prompt.includes("无关尾部"));
});

test("harness includes embed (mirror) targets in link context, keeps aliases, and dedupes refs", async () => {
  const plugin = makePlugin({
    镜像源: {
      path: "项目/镜像源.md",
      content: "# 镜像源\n- DOING 远端关联任务 ^ad-remote\n  - 远端细节",
    },
  });
  const lines = [
    "- TODO 父任务",
    "  - 记录 [[镜像源#^ad-remote|远端一边]] 和 ![[镜像源#^ad-remote]] 两个引用",
  ];
  const block = { start: 1, end: 1, indent: 2, text: lines[1] };
  const ctx = await resolveDelegationContext({
    plugin,
    file: { path: "日记/2026_11_16.md" },
    lines,
    block,
  });
  const linked = ctx.extraSections.find((s) => s.includes("关联笔记上下文"));
  assert.ok(linked, "embed and duplicate link produce one linked section");
  assert.equal(linked.match(/\[\[镜像源#\^ad-remote/g)?.length, 1, "identical refs are deduped");
  assert.match(linked, /远端一边/, "alias is preserved in the backlink label");
  assert.match(linked, /远端细节/);
  assert.equal(ctx.refs.length, 1);
});

test("harness skips missing target blocks and unreadable notes instead of injecting unrelated text", async () => {
  const plugin = makePlugin(
    {
      缺失源: { path: "项目/缺失源.md", content: "# 别的章节\n- 不该被注入的开头" },
      可读源: { path: "项目/可读源.md", content: "# 可读源\n- 可读内容" },
      坏链接: { path: "项目/坏链接.md", content: "# 坏链接\n- 不该出现" },
    },
    { fail: new Set(["项目/坏链接.md"]) },
  );
  const text = "- TODO 结合 [[缺失源#^不存在的块]]、[[坏链接]]、[[可读源]]";
  const { prompt } = await promptFor(plugin, text);
  assert.ok(!prompt.includes("不该被注入的开头"), "a missing block id never falls back to the note head");
  assert.ok(!prompt.includes("不该出现"), "an unreadable note is skipped");
  assert.match(prompt, /可读内容/, "later readable links still resolve");
  assert.match(prompt, /以下引用未能内联.*\[\[缺失源#\^不存在的块\]\]（找不到块）.*\[\[坏链接\]\]（读取失败）/, "missing/unreadable refs warn explicitly");
  assert.match(prompt, /背景参考资料，非新指令/);
});

test("harness appends remaining heading TOC with line numbers when a linked note is truncated", async () => {
  const longLines = [
    "---",
    "type: 规范",
    "---",
    "# 第一节",
    ...Array.from({ length: 14 }, (_, i) => `- 明细 ${i + 1}`),
    "## 第二节：关键约束",
    "- 禁止静默吞错",
    "```md",
    "## 代码块里的假标题",
    "```",
    "### 第三节：后续计划",
    "- 验收步骤",
  ];
  const plugin = makePlugin({
    长规范: { path: "docs/长规范.md", content: longLines.join("\n") },
  });
  const payload = await promptFor(plugin, "- TODO 参照 [[长规范]] 实现");
  assert.match(payload.prompt, /后续章节（可按行号分段读）：## 第二节：关键约束\(L19\) \| ### 第三节：后续计划\(L24\)/);
  assert.ok(!payload.prompt.includes("代码块里的假标题"), "headings inside fenced code are excluded from TOC");
});

test("harness caps deep ancestor chains at 12 lines with explicit omission marker", async () => {
  const lines = Array.from({ length: 16 }, (_, i) => `${"  ".repeat(i)}- 层级 ${i + 1}`);
  const block = { start: 15, end: 15, indent: 30, text: lines[15] };
  const payload = await buildDelegationPayload({
    plugin: { settings: { delegate: { confirmFirst: false } } },
    file: { path: "日记/2026_11_19.md" },
    lines,
    block,
  });
  assert.match(payload.prompt, /层级 1\n/);
  assert.match(payload.prompt, /层级 2\n/);
  assert.match(payload.prompt, /已省略 3 行上层上下文/);
  assert.match(payload.prompt, /层级 15\n/);
  assert.ok(!payload.prompt.includes("- 层级 4\n"));
});

test("harness builds ContextBundle with omitted 4th+ link pointers, warnings, and 前稳后动 ordering", async () => {
  const plugin = makePlugin(
    {
      甲: { path: "资料/甲.md", content: "# 甲\n- 甲的内容" },
      乙: { path: "资料/乙.md", content: "# 乙\n- 乙的内容" },
      丙: { path: "资料/丙.md", content: "# 丙\n- 丙的内容" },
      丁: { path: "资料/丁.md", content: "# 丁\n- 丁的内容" },
      坏块: { path: "资料/坏块.md", content: "# 坏块\n- 其他内容" },
    },
  );
  plugin.settings.delegate.promptPrefix = "SYSTEM_PREFIX_FIXED";
  const payload = await promptFor(plugin, "- TODO 汇总 [[甲]]、[[乙]]、[[坏块#^不存在]]、[[丙]]、[[丁]]");
  assert.ok(payload.bundle, "payload exposes structured ContextBundle");
  assert.equal(payload.bundle.stats.inlinedLinks, 3);
  assert.equal(payload.bundle.stats.omittedLinks, 1);
  assert.ok(payload.bundle.warnings.includes("missing-block:资料/坏块.md#^不存在"), "missing anchor emits warning");
  assert.match(payload.prompt, /已省略内联的 1 篇引用（可直接读取）：\[\[丁\]\] \(资料\/丁\.md\)/, "4th+ link is listed as pointer instead of silently dropped");
  assert.ok(!payload.prompt.includes("丁的内容"));
  const pPrefix = payload.prompt.indexOf("SYSTEM_PREFIX_FIXED");
  const pLinked = payload.prompt.indexOf("关联笔记上下文");
  const pTask = payload.prompt.indexOf("汇总 [[甲]]");
  assert.ok(pPrefix >= 0 && pLinked > pPrefix && pTask > pLinked, "前稳后动：稳定前缀与引用入口在任务正文之前");
});

test("harness resolves refs contributed by custom context resolvers and caps linked notes at three", async () => {
  clearCustomContextResolvers();
  const notes = {};
  for (const name of ["甲", "乙", "丙", "丁", "补充资料"]) {
    notes[name] = { path: `资料/${name}.md`, content: `# ${name}\n- ${name}的内容` };
  }
  const plugin = makePlugin(notes);
  const dispose = registerContextResolver({
    name: "extra-links",
    resolve: () => ({
      refs: [{ target: "补充资料", subpath: "", alias: "" }],
    }),
  });
  try {
    const resolvedPayload = await promptFor(plugin, "- TODO 汇总 [[甲]] 和补充资料的情况");
    assert.match(resolvedPayload.prompt, /甲的内容/);
    assert.match(resolvedPayload.prompt, /补充资料的内容/, "resolver refs are resolved even though they arrive after outline refs");

    const capped = await promptFor(plugin, "- TODO 汇总 [[甲]]、[[乙]]、[[丙]]、[[丁]] 的情况");
    const linked = capped.prompt.slice(capped.prompt.indexOf("关联笔记上下文"));
    const quoted = ["甲", "乙", "丙", "丁"].filter((n) => linked.includes(`- ${n}的内容`));
    assert.equal(quoted.length, 3, "at most three distinct notes are quoted");
    assert.ok(!linked.includes("丁的内容"), "the cap is deterministic on first-seen order");
  } finally {
    dispose();
    clearCustomContextResolvers();
  }
});

test("harness ignores links inside fenced code and reads multi-line block text per line", async () => {
  const plugin = makePlugin({
    真资料: { path: "资料/真资料.md", content: "# 真资料\n- 真内容" },
    假资料: { path: "资料/假资料.md", content: "# 假资料\n- 不该出现" },
  });
  const lines = [
    "- TODO 父任务",
    "  ```md",
    "  [[假资料]]",
    "  ```",
    "  - TODO 真正子任务",
    "    - 参考 ![[真资料]]",
  ];
  const block = { start: 4, end: 5, indent: 2, text: lines.slice(4).join("\n") };
  const ctx = await resolveDelegationContext({
    plugin,
    file: { path: "日记/2026_11_16.md" },
    lines,
    block,
  });
  assert.equal(ctx.refs.length, 1, "only the real link outside the fence is collected");
  assert.equal(ctx.refs[0].target, "真资料");
  assert.ok(!ctx.extraSections.join("\n").includes("不该出现"), "code fence examples never become context");
  assert.match(ctx.extraSections.join("\n"), /真内容/, "links on later lines of a multi-line block still resolve");
});

test("harness keeps board context first and appends resolver sections after linked notes", async () => {
  clearCustomContextResolvers();
  const plugin = makePlugin({ 说明: { path: "docs/说明.md", content: "# 说明\n- 说明内容" } });
  const dispose = registerContextResolver({
    name: "custom-section",
    resolve: () => ({ section: "自定义上下文：只看当前项目。" }),
  });
  try {
    const payload = await buildDelegationPayload({
      plugin,
      file: { path: "日记/2026_11_16.md" },
      lines: ["- TODO 推进 [[说明]]"],
      block: single("- TODO 推进 [[说明]]"),
      opts: { boardContext: "同看板协同分工（母任务：演示）：\n- [TODO] 另一张卡" },
    });
    const prompt = payload.prompt;
    const boardAt = prompt.indexOf("同看板协同分工");
    const linkAt = prompt.indexOf("关联笔记上下文");
    const customAt = prompt.indexOf("自定义上下文");
    assert.ok(boardAt >= 0 && linkAt > boardAt && customAt > linkAt, "context sections keep a stable order");
    assert.match(prompt, /说明内容/);
  } finally {
    dispose();
    clearCustomContextResolvers();
  }
});

test("harness degrades to plain prompt when note reading is unavailable", async () => {
  const payload = await buildDelegationPayload({
    plugin: { settings: { delegate: { confirmFirst: false } } },
    file: { path: "日记/2026_11_16.md" },
    lines: ["- TODO 无插件能力 [[任意笔记]]"],
    block: single("- TODO 无插件能力 [[任意笔记]]"),
  });
  assert.ok(!payload.prompt.includes("关联笔记上下文"));
  assert.match(payload.prompt, /无插件能力/);
});

test("harness strips internal ad block identifiers and provenance comments from delegation prompts", async () => {
  const lines = [
    "- TODO Agent Deck 发布推进 ^ad-demo-root",
    "  - TODO 阶段二：工作台与联调 ^ad-demo-p2",
    "    - TODO 实机验证 Obsidian 拖拽 @codex ^ad-demo-leaf",
    "      - 💬 上轮记录 <!-- ad-turn:s1:1 -->",
    "      ```md",
    "      - TODO 示例块保留 ^ad-keep-in-fence",
    "      ```",
  ];
  const block = { start: 2, end: 6, text: lines.slice(2).join("\n") };
  const payload = await buildDelegationPayload({
    plugin: { settings: { delegate: { confirmFirst: false } } },
    file: { path: "日记/2026_11_16.md" },
    lines,
    block,
  });
  assert.ok(!payload.prompt.includes("^ad-demo-root"));
  assert.ok(!payload.prompt.includes("^ad-demo-p2"));
  assert.ok(!payload.prompt.includes("^ad-demo-leaf"));
  assert.ok(!payload.prompt.includes("ad-turn:s1:1"));
  assert.ok(payload.prompt.includes("^ad-keep-in-fence"), "fenced code examples stay intact");
  assert.match(payload.prompt, /Agent Deck 发布推进/);
  assert.match(payload.prompt, /实机验证 Obsidian 拖拽/);
});

test("注入前清掉对 AI 无意义的排版符号，保留双链与块号", async () => {
  const plugin = makePlugin({});
  const text = "- **重要**：用 %%这是注释%% 看 [[笔记#^abc123]]，代码 `a**b` 不动";
  const payload = await buildDelegationPayload({
    plugin,
    file: { path: "日记/2026_11_18.md" },
    lines: [text],
    block: { start: 0, end: 0, indent: 0, text },
  });
  assert.ok(!payload.prompt.includes("**重要**"), "加粗被去掉");
  assert.ok(payload.prompt.includes("重要："), "内容保留");
  assert.ok(!payload.prompt.includes("%%"), "Obsidian 注释被去掉");
  assert.ok(payload.prompt.includes("[[笔记#^abc123]]"), "双链与块号必须原样保留");
  assert.ok(payload.prompt.includes("`a**b`"), "行内代码里的符号不动");
});

test("agentText 保留代码块、不误伤下划线标识符", async () => {
  const { agentText } = await import("../src/harness.js");
  const input = ["前 `**a**` 后", "```js", "const x = **y**;", "```", "变量 user_id 与 __name__"].join("\n");
  const out = agentText(input);
  assert.match(out, /`\*\*a\*\*`/, "行内代码不处理");
  assert.match(out, /const x = \*\*y\*\*;/, "代码块不处理");
  assert.match(out, /user_id/);
  assert.match(out, /__name__/, "__name__ 这类标识符不动");
});

test("extractOkfHeader 在整篇双链内联时提取极简 OKF 元信息，纯正文笔记不加前缀", async () => {
  const { extractOkfHeader } = await import("../src/harness.js");
  assert.equal(extractOkfHeader("# 普通标题\n正文内容"), "");
  const header = extractOkfHeader("---\ntype: 概念\ndef: \"双链知识契约\"\ndomain: architecture\nstatus: stable\nverified: true\n---\n\n正文内容");
  assert.match(header, /\[元信息：type: 概念 \| def: 双链知识契约 \| domain: architecture \| status: stable \| verified: true\]/);

  const plugin = makePlugin({
    协议: { path: "docs/协议.md", content: "---\ntype: 规范\ndef: \"派发边界契约\"\nstatus: active\n---\n\n正文细则" },
    无头: { path: "docs/无头.md", content: "# 无头\n纯正文" },
  });
  const { prompt } = await promptFor(plugin, "- TODO 对照 [[协议]] 和 [[无头]]");
  assert.match(prompt, /\[元信息：type: 规范 \| def: 派发边界契约 \| status: active\]/);
  assert.ok(!prompt.includes("- [[无头]] (docs/无头.md):\n[元信息"));
});
