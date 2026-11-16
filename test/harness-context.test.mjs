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
