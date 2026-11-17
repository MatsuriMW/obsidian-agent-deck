import test from "node:test";
import assert from "node:assert/strict";
import { buildPlanMarkdown, parsePlan, planSlug, plannerPrompt } from "../src/planner.js";
import { extractTaskBoardGroups } from "../src/project-workbench.js";

test("解析规划：容忍代码块与前后废话，过长的步骤被截断", () => {
  const plan = parsePlan('```json\n{"title":"上线看板","steps":[{"step":"写接口","acceptance":"接口文档 + 单测通过"},{"step":"接看板","acceptance":"拖动后 md 变化"}]}\n```');
  assert.equal(plan.title, "上线看板");
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[1].acceptance, "拖动后 md 变化");
  assert.throws(() => parsePlan("没有 JSON"), /格式不正确/);
  assert.throws(() => parsePlan('{"steps":[]}'), /可执行步骤/);
  const many = parsePlan(JSON.stringify({ steps: Array.from({ length: 15 }, (_, i) => ({ step: `第 ${i} 步`, acceptance: "ok" })) }));
  assert.equal(many.steps.length, 10);
});

test("生成的 task.md 能被现有分形看板直接解析成「一个母项 + 多个步骤」", () => {
  const text = buildPlanMarkdown({ title: "上线看板", goal: "让看板绑 task.md", steps: [{ step: "写接口", acceptance: "单测通过" }, { step: "接看板", acceptance: "拖动后 md 变化" }], at: "2026-11-18T00:00:00.000Z" });
  assert.match(text, /^- 任务：让看板绑 task\.md$/m);
  const groups = extractTaskBoardGroups(text, { trackedIds: new Set(), trigger: "@" });
  assert.equal(groups.length, 1, "整份计划正好是一个看板根");
  assert.equal(groups[0].title, "任务：让看板绑 task.md");
  assert.equal(groups[0].cards.length, 2, "两个步骤成为两张卡");
  assert.ok(groups[0].cards.every((c) => c.column));
});

test("文件名 slug 去掉非法字符但不为空", () => {
  assert.equal(planSlug("上线/看板#1"), "上线看板1");
  assert.equal(planSlug(""), "任务");
  assert.ok(plannerPrompt("目标").includes("目标"));
});

test("文件级看板：普通清单（spec/规则）没有母项也能合成一个看板根", () => {
  const spec = [
    "---", "type: 规格", "---", "",
    "# 记忆注入规格", "",
    "- TODO 派发前必须显示注入内容",
    "  - 验收：能看见并删掉某条记忆",
    "- TODO 拒绝后不再注入",
    "  - 验收：拒绝过的记忆不出现在 prompt",
    "",
  ].join("\n");
  assert.equal(extractTaskBoardGroups(spec, { fileBoard: false }).length, 0, "不开文件级看板时不硬造");
  const groups = extractTaskBoardGroups(spec, { fileBoard: true });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].fileBoard, true);
  assert.equal(groups[0].title, "记忆注入规格", "标题取一级标题");
  assert.equal(groups[0].cards.length, 2, "顶层两条直接成为卡片");
  assert.equal(groups[0].line, 5, "锚点落在第一条卡片前一行，标题仍可见");
});

test("规划提示词强制 JSON，并带一次补救提示", async () => {
  const { plannerPrompt, plannerFixPrompt } = await import("../src/planner.js");
  assert.match(plannerPrompt("目标X"), /第一个字符必须是 \{/);
  assert.match(plannerPrompt("目标X"), /\{"title"/);
  assert.match(plannerFixPrompt("我建议先确认工作区"), /不是合法 JSON/);
  assert.match(plannerFixPrompt("我建议先确认工作区"), /我建议先确认工作区/);
});
