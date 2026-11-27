import assert from "node:assert/strict";
import { test } from "node:test";
import { register } from "node:module";

register("data:text/javascript," + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === "obsidian") return { url: "data:text/javascript,export class Notice{};export class MarkdownView{}", shortCircuit: true };
  return next(spec, ctx);
}`));

const {
  CONCLUSION_STYLES,
  DEFAULT_CUSTOM_CONCLUSION_PROMPT,
  resolveConclusionConfig,
  prepareReplyForSummary,
  prepareTaskForSummary,
  conclusionGuidanceForAutoLog,
  buildTurnConclusionPrompt,
  buildMergeConclusionPrompt,
  parseConclusionResponse,
  fallbackConclusion,
  summarizeTurn,
  summarizeMerge,
  previewConclusion,
} = await import("../src/conclusion.js");

test("resolveConclusionConfig normalizes style, bounds, and custom fields", () => {
  const def = resolveConclusionConfig({});
  assert.equal(def.style, "balanced");
  assert.equal(def.codeMax, 90);
  assert.equal(def.qaMax, 200);
  assert.equal(def.mergeMax, 180);

  const custom = resolveConclusionConfig({
    conclusionStyle: "structured",
    conclusionMaxCode: 10,
    conclusionMaxQA: 999,
    conclusionMaxMerge: 20,
    summaryPrompt: "  先写状态  ",
    conclusionPromptTemplate: "  {{reply}}  ",
  });
  assert.equal(custom.style, "structured");
  assert.equal(custom.codeMax, 20);
  assert.equal(custom.qaMax, 800);
  assert.equal(custom.mergeMax, 60);
  assert.equal(custom.extraPrompt, "先写状态");
  assert.equal(custom.customTemplate, "{{reply}}");

  assert.equal(resolveConclusionConfig({ conclusionStyle: "unknown" }).style, "balanced");
});

test("prepareReplyForSummary folds long code blocks and large tables while preserving short snippets and head/tail", () => {
  const bigCode = "```js\n" + "const a = 1;\n".repeat(30) + "```";
  const shortErr = "```text\nERR_FAIL: line 12\n```";
  const bigTable = [
    "| ColA | ColB |",
    "| --- | --- |",
    "| r1 | v1 |",
    "| r2 | v2 |",
    "| r3 | v3 |",
    "| r4 | v4 |",
    "| r5 | v5 |",
    "| r6 | v6 |",
  ].join("\n");
  const raw = [
    "先说结论：关键问题在 `src/sync.js`。",
    bigCode,
    shortErr,
    bigTable,
    "最后验证：单测全部通过。",
  ].join("\n\n");

  const prepared = prepareReplyForSummary(raw, { head: 200, tail: 200 });
  assert.ok(prepared.includes("先说结论：关键问题在 `src/sync.js`。"), prepared);
  assert.ok(prepared.includes("[代码块]"), prepared);
  assert.ok(prepared.includes("ERR_FAIL: line 12"), prepared);
  assert.ok(prepared.includes("（略 4 行表格）"), prepared);
  assert.ok(prepared.includes("最后验证：单测全部通过。"), prepared);
});

test("buildTurnConclusionPrompt handles all 4 styles and auto-appends task/reply when custom omits placeholders", () => {
  for (const style of ["balanced", "concise", "structured"]) {
    assert.ok(CONCLUSION_STYLES[style]);
    const p = buildTurnConclusionPrompt({
      ask: "修一下测试",
      reply: "已经改好了 `src/conclusion.js`，单测通过。",
      mode: "brief",
      cfg: { conclusionStyle: style, conclusionMaxCode: 90, conclusionMaxQA: 200, summaryPrompt: "带文件名" },
    });
    assert.ok(p.includes("90 字") && p.includes("200 字"), p);
    assert.ok(p.includes("补充要求：带文件名"), p);
  }

  const withSlots = buildTurnConclusionPrompt({
    ask: "提问A",
    reply: "回复B",
    cfg: {
      conclusionStyle: "custom",
      conclusionPromptTemplate: "任务={{task}}; 上限={{codeMax}}/{{qaMax}}; 回复={{reply}}",
      conclusionMaxCode: 88,
      conclusionMaxQA: 188,
    },
  });
  assert.equal(withSlots, "任务=提问A; 上限=88/188; 回复=回复B");

  const withoutSlots = buildTurnConclusionPrompt({
    ask: "提问A",
    reply: "回复B",
    cfg: { conclusionStyle: "custom", conclusionPromptTemplate: "请用一句话输出核心结论。" },
  });
  assert.ok(withoutSlots.includes("请用一句话输出核心结论。"));
  assert.ok(withoutSlots.includes("【任务】\n提问A"));
  assert.ok(withoutSlots.includes("【AI 回复】\n回复B"));

  const defCustom = buildTurnConclusionPrompt({
    ask: "提问A",
    reply: "回复B",
    cfg: { conclusionStyle: "custom" },
  });
  assert.ok(DEFAULT_CUSTOM_CONCLUSION_PROMPT.includes("{{reply}}"));
  assert.ok(defCustom.includes("提问A") && defCustom.includes("回复B"));
});

test("parseConclusionResponse parses JSON, embedded JSON, plain text in custom mode, and rejects degenerate results", () => {
  const fenced = "```json\n{\"task\":\"修总结层\",\"result\":\"抽出 conclusion.js，单测通过\",\"kind\":\"code\"}\n```";
  const p1 = parseConclusionResponse(fenced, { mode: "brief", cfg: { conclusionMaxCode: 65 } });
  assert.equal(p1.kind, "code");
  assert.equal(p1.task, "修总结层");
  assert.equal(p1.result, "抽出 conclusion.js，单测通过");

  const noisy = "好的，结果如下：{\"result\":\"根因是截断逻辑写死，已改为读取配置上限。\",\"kind\":\"qa\"} 希望有帮助。";
  const p2 = parseConclusionResponse(noisy, { mode: "standard", cfg: { conclusionMaxQA: 160 } });
  assert.equal(p2.kind, "qa");
  assert.equal(p2.task, "");
  assert.equal(p2.result, "根因是截断逻辑写死，已改为读取配置上限。");

  const degenerate = JSON.stringify({ task: "修 bug", result: "已完成", kind: "code" });
  const p3 = parseConclusionResponse(degenerate, { mode: "brief" });
  assert.equal(p3.result, "");

  const plainCustom = parseConclusionResponse("结论：新增了独立总结层，单测全绿。", {
    cfg: { conclusionStyle: "custom", conclusionMaxQA: 160 },
    allowPlainText: true,
  });
  assert.equal(plainCustom.result, "新增了独立总结层，单测全绿。");
});

test("summarizeTurn, summarizeMerge, previewConclusion, conclusionGuidanceForAutoLog, and fallbackConclusion work end-to-end", async () => {
  let seenPrompt = "";
  const mockModel = async (prompt) => {
    seenPrompt = prompt;
    if (prompt.includes("合并成")) return "独立总结层已落地并通过单测，Windows 端尚待实机验证。";
    return JSON.stringify({ task: "抽离总结层", result: "改动：conclusion.js；结果：单测通过；遗留：Windows 未测", kind: "code" });
  };

  const turn = await summarizeTurn({
    ask: "请把结论总结抽象成单独一层",
    reply: "已新增 src/conclusion.js，npm test 通过，Windows 真机未测。",
    mode: "brief",
    cfg: { conclusionStyle: "structured", conclusionMaxCode: 100 },
    runModel: mockModel,
  });
  assert.equal(turn.kind, "code");
  assert.ok(turn.result.includes("改动：conclusion.js"));
  assert.ok(seenPrompt.includes("改动：…；结果：…"));

  const merged = await summarizeMerge({
    previous: "此前完成方案调研。",
    rounds: [{ n: 2, summary: "抽出 conclusion.js 并通过单测" }],
    cfg: { conclusionMaxMerge: 150, summaryPrompt: "保留平台边界" },
    runModel: mockModel,
  });
  assert.ok(seenPrompt.includes("总长不超过 150 字") && seenPrompt.includes("补充要求：保留平台边界"));
  assert.ok(merged.text.includes("独立总结层已落地并通过单测"));

  const preview = await previewConclusion({ conclusionStyle: "balanced" }, { runModel: mockModel });
  assert.equal(preview.mode, "brief");
  assert.ok(preview.ms >= 0 && preview.result.includes("conclusion.js"));

  const guidance = conclusionGuidanceForAutoLog({
    conclusionStyle: "custom",
    conclusionPromptTemplate: "只写改动文件和测试状态\n{{reply}}",
    summaryPrompt: "用中文",
  });
  assert.ok(guidance.includes("只写改动文件和测试状态") && guidance.includes("用中文"));

  const fb = fallbackConclusion({
    ask: "这个为什么会失败？",
    said: "先说结论：因为缺少权限，所以接口返回 403。",
    cfg: { conclusionMaxQA: 160 },
  });
  assert.equal(fb.kind, "qa");
  assert.ok(fb.result.includes("缺少权限"));

  assert.equal(prepareTaskForSummary("   "), "");
});
