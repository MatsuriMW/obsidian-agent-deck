import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkbenchNote } from "../src/workbench-note.js";

test("工作台总览：列出看板文件、记忆统计、最近规划，并给出生成入口", () => {
  const text = buildWorkbenchNote({
    boardFiles: ["Agent Deck/任务/a.md", "Agent Deck/规格/b.md"],
    memory: { total: 33, pending: 30, noSource: 1 },
    tasks: ["Agent Deck/任务/a.md"],
    at: "2026-11-18T04:00Z",
  });
  assert.match(text, /\[\[Agent Deck\/任务\/a\|a\]\]/);
  assert.match(text, /\| 总数 \| 33 \|/);
  assert.match(text, /\| 待确认 \| 30 \|/);
  assert.match(text, /\| 无来源 \| 1 \|/);
  assert.match(text, /最近任务规划[\s\S]*Agent Deck\/任务\/a/);
  assert.match(text, /命令面板 → 记忆：逐条审阅/);
});

test("工作台总览：没有产物时给可执行的下一步，而不是空白", () => {
  const text = buildWorkbenchNote({ boardFiles: [], memory: {}, tasks: [] });
  assert.match(text, /还没有看板文件/);
  assert.match(text, /还没有生成过任务规划/);
  assert.match(text, /\| 总数 \| 0 \|/);
});

test("技能卡：frontmatter 里的真实路径能被读回，技能双链能被识别", async () => {
  const { skillCardMarkdown, cardPathOf, skillRefIn, describeSkill } = await import("../src/skill-cards.js");
  const skill = { name: "agent-reach", source: "dsh", file: "/Users/x/.dsh/skills/agent-reach/SKILL.md", real: "/Users/x/.config/skillshare/skills/data/agent-reach", description: "联网就用它" };
  const card = skillCardMarkdown(skill, "2026-11-18");
  assert.equal(cardPathOf(card), skill.file);
  assert.match(card, /^type: 技能$/m);
  assert.ok(card.includes("[[技能/agent-reach]]"), "卡片正文给出可复制的双链");
  const draft = `---\nskill: "[[技能/agent-reach]]"\n---\n正文`;
  assert.equal(skillRefIn(draft), "agent-reach");
  assert.equal(skillRefIn("- TODO 用 [[技能/agent-reach|联网]] 查东西"), "agent-reach");
  const meta = describeSkill('---\nname: x\ndescription: >\n  一句话描述\n---\n正文');
  assert.equal(meta.name, "x");
  assert.match(meta.description, /一句话描述/);
});

test("技能卡：人改过正文就不再覆盖，上游路径仍刷新", async () => {
  const { skillCardMarkdown, nextCardContent } = await import("../src/skill-cards.js");
  const skill = { name: "x", source: "dsh", file: "/a/SKILL.md", real: "/a", description: "描述" };
  const first = skillCardMarkdown(skill, "2026-11-18");
  assert.equal(nextCardContent(skill, first, "2026-11-19").edited, false, "没改就正常覆盖");
  const mine = first.replace("描述", "我自己加的批注");
  const kept = nextCardContent(skill, mine, "2026-11-19");
  assert.equal(kept.edited, true);
  assert.match(kept.content, /我自己加的批注/);
  assert.match(kept.content, /^edited: true$/m);
  assert.match(kept.content, /synced_at: 2026-11-19/);
  assert.equal(nextCardContent(skill, kept.content, "2026-11-20").edited, true, "再刷新仍然保留");
});
