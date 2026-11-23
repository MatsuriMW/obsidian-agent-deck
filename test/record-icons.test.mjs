// node test/record-icons.test.mjs —— AI 日志圆圈轮次 icon、Agent 桌面小图标与新旧格式兼容测试
import assert from "node:assert/strict";
import { register } from "node:module";

// Stub CodeMirror / Obsidian / PNG asset imports for headless Node testing.
register("data:text/javascript," + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier === "@codemirror/view") {
    return {
      url: "data:text/javascript," + encodeURIComponent(\`
        export class WidgetType {}
        export const Decoration = {
          replace(spec) { return { kind: "replace", ...spec }; },
          mark(spec) { return { kind: "mark", ...spec }; },
        };
        export const ViewPlugin = {
          fromClass(cls) { return { cls }; },
        };
      \`),
      shortCircuit: true,
    };
  }
  if (specifier === "@codemirror/state") {
    return {
      url: "data:text/javascript," + encodeURIComponent(\`
        export class RangeSetBuilder {
          constructor() { this.items = []; }
          add(from, to, value) { this.items.push({ from, to, value }); }
          finish() { return this.items; }
        }
      \`),
      shortCircuit: true,
    };
  }
  if (specifier === "@codemirror/language") {
    return {
      url: "data:text/javascript," + encodeURIComponent(\`
        export function syntaxTree() { return { resolveInner() { return null; } }; }
      \`),
      shortCircuit: true,
    };
  }
  if (/\\.png$/.test(specifier)) {
    return {
      url: "data:text/javascript," + encodeURIComponent("export default 'data:image/png;base64,iVBORw0KGgo=';"),
      shortCircuit: true,
    };
  }
  return next(specifier, context);
}
`));

const {
  matchRoundPrefix,
  matchRoundTextPrefix,
  matchBriefLabels,
  matchRobotMark,
  agentFromClockLine,
  resolveLineAgent,
  recordIconsExtension,
} = await import("../src/record-icons.js");
const { syncSessionEntry } = await import("../src/journal.js");
const { isBriefRecord, parseAiRecordRow, aiRecordGroups } = await import("../src/ai-records.js");
const { recordCopyText } = await import("../src/record-menu.js");

// 1. 圆圈轮次前缀匹配：新格式 + 历史 💬 格式，跳过 ❓ / 📋 / 累计总结
{
  const m1 = matchRoundPrefix("\t- 第1轮：**任务**：修日志；**结论**：已完成");
  assert.deepEqual(m1, { from: 3, to: 7, round: 1 });

  const m2 = matchRoundPrefix("  - 💬 第12轮：任务：旧格式；结论：仍渲染圆圈");
  assert.deepEqual(m2, { from: 4, to: 12, round: 12 });

  const m3 = matchRoundPrefix("- Round 3: Done");
  assert.deepEqual(m3, { from: 2, to: 11, round: 3 });

  assert.equal(matchRoundPrefix("  - ❓ 第2轮：用户提问不换圆圈"), null);
  assert.equal(matchRoundPrefix("  - 📋 第2轮：步骤 1/3"), null);
  assert.equal(matchRoundPrefix("  - 💬 累计总结：阶段性汇总"), null);
  assert.equal(matchRoundPrefix("  - 普通笔记：第2轮讨论"), null);

  assert.deepEqual(matchRoundTextPrefix("第4轮：**任务**：测试"), { from: 0, to: 4, round: 4 });
  assert.deepEqual(matchRoundTextPrefix("💬 第5轮：旧记录"), { from: 0, to: 7, round: 5 });
  assert.equal(matchRoundTextPrefix("❓ 第4轮：提问"), null);

  const legacyLine = "\t- 💬 第2轮：任务：旧任务；结论：旧结论";
  const lbls = matchBriefLabels(legacyLine);
  assert.equal(lbls.length, 2);
  assert.equal(legacyLine.slice(lbls[0].from, lbls[0].to), "任务");
  assert.equal(legacyLine.slice(lbls[1].from, lbls[1].to), "结论");
  assert.equal(matchBriefLabels("\t- 第1轮：**任务**：已加粗；**结论**：不重复").length, 0);
}

// 2. 任务行 🤖 定位
{
  const hit1 = matchRobotMark("- DOING 🤖 09:00-09:30 **agent-deck -> 优化日志** ^claude-abc1234567");
  assert.ok(hit1);
  assert.equal("- DOING 🤖 09:00-09:30 **agent-deck -> 优化日志** ^claude-abc1234567".slice(hit1.from, hit1.to), "🤖");

  const hit2 = matchRobotMark("\t- DONE 09:00 🤖 旧格式任务");
  assert.ok(hit2);
  assert.equal("\t- DONE 09:00 🤖 旧格式任务".slice(hit2.from, hit2.to), "🤖");

  assert.equal(matchRobotMark("普通段落里聊到 🤖 图标"), null);
  assert.equal(matchRobotMark("- 普通手写项里提到 🤖 符号"), null);
}

// 3. Agent 归属推断：blockId → 🔗 → ⏱ → autoLogState → 空（保留 🤖）
{
  const byId = resolveLineAgent(["- DOING 🤖 09:00 **任务** ^agy-fix-1234567890"], 0);
  assert.equal(byId, "antigravity");

  const byLink = resolveLineAgent([
    "- DONE 🤖 09:00-09:20 **任务**",
    "\t- 🔗 [Codex：修构建](codex://threads/11111111-2222-3333-4444-555555555555)",
  ], 0);
  assert.equal(byLink, "codex");

  assert.equal(agentFromClockLine("\t- ⏱ 09:00–09:20 · 共 20m · 12k tok · Claude"), "claude");
  assert.equal(agentFromClockLine("\t- ⏱ 09:00–09:20 · 共 20m · DSH"), "dsh");

  const byClockAfterDoneClean = resolveLineAgent([
    "- DONE 🤖 09:00-09:20 **已清理块号的任务**",
    "\t- 第1轮：**任务**：修样式；**结论**：已修复",
    "\t- ⏱ 09:00–09:20 · 共 20m · 8k tok · Cursor",
  ], 0);
  assert.equal(byClockAfterDoneClean, "cursor");

  const byState = resolveLineAgent(["- DONE 🤖 09:00 **状态表里的任务**"], 0, {
    plugin: {
      settings: {
        autoLogState: {
          "2026-11-23": {
            "sid-1": { key: "🤖 **状态表里的任务**", agent: "opencode" },
          },
        },
      },
    },
  });
  assert.equal(byState, "opencode");

  const unknown = resolveLineAgent(["- DONE 🤖 09:00 **未知来源**"], 0);
  assert.equal(unknown, "");
}

// 4. 新格式写入与解析、复制兼容
{
  const out = syncSessionEntry("- DOING 🤖 10:00 **调整日志格式** ^claude-log-1234567890", {
    sid: "s-log",
    agent: "claude",
    blockId: "claude-log-1234567890",
    detail: "brief",
    granularity: "round",
    rounds: [{ n: 1, ask: "调整日志格式", said: "已完成调整。" }],
  }).text;
  const line = out.split("\n")[1];
  assert.ok(line.includes("- 第1轮：**任务**：调整日志格式；**结论**：已完成调整。"), line);
  assert.ok(!line.includes("💬"), line);
  assert.equal(isBriefRecord(line), true);
  const parsed = parseAiRecordRow(line);
  assert.equal(parsed.kind, "result");
  assert.equal(parsed.round, 1);
  assert.equal(parsed.task, "调整日志格式");
  assert.equal(parsed.conclusion, "已完成调整。");
  assert.equal(recordCopyText(line, "conclusion"), "已完成调整。");
  assert.equal(aiRecordGroups(out).length, 1);
}

// 5. CM6 装饰器：替换圆圈与 Agent 桌面 icon，光标落入区间时让位给源码
{
  const lines = [
    "- DOING 🤖 10:00 **任务** ^codex-fix-1234567890",
    "\t- 第1轮：**任务**：改样式；**结论**：已完成",
    "\t- 💬 第2轮：老格式结论",
    "\t- ❓ 第3轮：追问保持原样",
    "- DONE 🤖 11:00 **未知来源保留机器人**",
  ];
  const fullText = lines.join("\n");
  const offsets = [];
  let cursor = 0;
  for (const l of lines) {
    offsets.push({ from: cursor, to: cursor + l.length, text: l });
    cursor += l.length + 1;
  }
  const makeView = (selFrom, selTo) => ({
    state: {
      doc: {
        toString: () => fullText,
        lineAt(pos) {
          for (let i = 0; i < offsets.length; i++) {
            if (pos <= offsets[i].to) return { number: i + 1, ...offsets[i] };
          }
          const last = offsets.length - 1;
          return { number: last + 1, ...offsets[last] };
        },
      },
      selection: { ranges: [{ from: selFrom, to: selTo }] },
      field: () => null,
    },
    visibleRanges: [{ from: 0, to: fullText.length }],
  });

  const ext = recordIconsExtension({}, { codex: "data:image/png;base64,AAA" });
  const inst = new ext.cls(makeView(fullText.length, fullText.length));
  assert.equal(inst.decorations.length, 3, "replaces codex 🤖 + round 1 + legacy round 2, skips ❓ and unknown 🤖");
  assert.equal(inst.decorations[0].value.widget.agent, "codex");
  assert.equal(inst.decorations[1].value.widget.round, 1);
  assert.equal(inst.decorations[2].value.widget.round, 2);

  // 光标停在「第1轮：」内部时，该项退回源码
  const round1From = offsets[1].from + 3;
  const instEditing = new ext.cls(makeView(round1From, round1From));
  assert.equal(instEditing.decorations.length, 2, "selection touching round 1 reveals raw markdown");
}

console.log("PASS record-icons: round badge, agent desktop mark, bold task/conclusion and legacy compatibility");
