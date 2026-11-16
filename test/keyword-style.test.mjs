// node test/keyword-style.test.mjs —— 关键词配色/图标渲染：关键词识别、完成态、AI 记录豁免与让位
import { register } from "node:module";
import assert from "node:assert/strict";

// CodeMirror 只在 Obsidian 里真实存在：这里给出足够跑装饰逻辑的最小替身
const cm = `
export class WidgetType {}
export class ViewPlugin { static fromClass(cls) { return class extends cls {}; } }
export class EditorView {}
export class Decoration {
  static mark(spec) { return { type: "mark", spec }; }
  static widget(spec) { return { type: "widget", spec }; }
}
export class RangeSetBuilder {
  constructor() { this.items = []; }
  add(from, to, value) { this.items.push({ from, to, value }); }
  finish() { return this.items; }
}
export function syntaxTree() { return { resolveInner: () => null }; }
`;

register("data:text/javascript," + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === "obsidian") return { url: "data:text/javascript,export class Notice{constructor(){}};export class MarkdownView{}", shortCircuit: true };
  if (spec === "@codemirror/view" || spec === "@codemirror/state" || spec === "@codemirror/language") {
    return { url: "data:text/javascript," + encodeURIComponent(${JSON.stringify(cm)}), shortCircuit: true };
  }
  return next(spec, ctx);
}`));

const { keywordOf, isAiRecordLine, isDoneKeyword, todoSeqFormatsKeywords, todoSeqRendersIcons, keywordMarksExtension, keywordIconsExtension } =
  await import("../src/keyword-style.js");

let fail = 0;
const check = (name, ok, out) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) { fail++; console.log(out); } };

// ---- 关键词识别 ----
{
  const hit = keywordOf("- DONE 🤖 10:00-10:12 agent-deck -> 自动会话记录");
  check("keyword after the list marker", hit && hit.keyword === "DONE" && hit.at === 2, hit);
  check("keyword behind a quote", keywordOf("> - TODO 写文档")?.keyword === "TODO", keywordOf("> - TODO 写文档"));
  check("TODOFORAI wins over TODO", keywordOf("- TODOFORAI 交给 AI")?.keyword === "TODOFORAI", keywordOf("- TODOFORAI 交给 AI"));
  check("keyword after a bold clock", keywordOf("- **09:30** DOING 接续")?.keyword === "DOING", keywordOf("- **09:30** DOING 接续"));
  check("plain prose has no keyword", keywordOf("- 今天没有状态词") === null, keywordOf("- 今天没有状态词"));
  check("inline mention is not a keyword", keywordOf("这是一句 TODO 说明") === null, keywordOf("这是一句 TODO 说明"));
  check("checkbox lines still find the keyword", keywordOf("- [ ] DONE 复核")?.keyword === "DONE", keywordOf("- [ ] DONE 复核"));
}

// ---- 标记与豁免 ----
{
  check("AI record marker is detected", isAiRecordLine("- DONE 🤖 10:00-10:12 做事"), true);
  check("hand written line is not an AI record", !isAiRecordLine("- DONE 手写任务"), true);
  check("DONE family counts as completed", ["DONE", "CANCELED", "CANCELLED", "FAILED"].every(isDoneKeyword), true);
  check("DOING is not completed", !isDoneKeyword("DOING"), true);
}

// ---- 让位判断 ----
{
  const mk = (settings) => ({ app: { plugins: { plugins: { "logseq-style-tasks": { settings } } } } });
  check("yields while TODOseq formats keywords", todoSeqFormatsKeywords(mk({ formatTaskKeywords: true })) === true);
  check("renders once TODOseq formatting is off", todoSeqFormatsKeywords(mk({ formatTaskKeywords: false })) === false);
  check("renders when TODOseq is absent", todoSeqFormatsKeywords({ app: { plugins: { plugins: {} } } }) === false);
  check("icons stay ours while TODOseq only formats text", todoSeqRendersIcons(mk({ keywordIcons: false })) === false);
  check("icons yield when TODOseq renders them", todoSeqRendersIcons(mk({ keywordIcons: true })) === true);
}

// ---- 装饰输出 ----
{
  const makeView = (lines) => {
    const objects = [];
    let offset = 0;
    for (const text of lines) {
      objects.push({ text, from: offset, to: offset + text.length, number: objects.length + 1 });
      offset += text.length + 1;
    }
    const doc = {
      lines: lines.length,
      line: (n) => objects[n - 1],
      lineAt: (pos) => objects.find((o) => pos <= o.to) || objects[objects.length - 1],
    };
    return { state: { doc }, visibleRanges: [{ from: 0, to: objects[objects.length - 1].to }] };
  };
  const decorationFor = (lines, settings = {}) => {
    const plugin = { settings: { keywordStyle: true, ...settings }, app: { plugins: { plugins: {} } } };
    const Ext = keywordMarksExtension(plugin);
    const instance = new Ext(makeView(lines));
    return instance.decorations;
  };
  const pick = (items, cls) => items.filter((d) => String(d.value.spec.class).includes(cls));

  const ai = decorationFor(["- DONE 🤖 10:00-10:12 agent-deck -> 自动会话记录"]);
  check("AI record keeps the keyword coloured", pick(ai, "todoseq-keyword-formatted").length === 1, ai);
  check("AI record keyword is not the completed variant", !String(pick(ai, "todoseq-keyword-formatted")[0].value.spec.class).includes("todoseq-completed-keyword"), ai);
  check("AI record is not struck through", pick(ai, "todoseq-completed-task-text").length === 0, ai);

  const hand = decorationFor(["- DONE 手写任务"]);
  check("hand written DONE is struck through", pick(hand, "todoseq-completed-task-text").length === 1, hand);
  check("completed keyword gets its own class", String(pick(hand, "todoseq-keyword-formatted")[0].value.spec.class).includes("todoseq-completed-keyword"), hand);

  const todo = decorationFor(["- TODO 写文档"]);
  check("open task is coloured but not struck", pick(todo, "todoseq-keyword-formatted").length === 1 && pick(todo, "todoseq-completed-task-text").length === 0, todo);

  const todoIcons = { settings: { keywordStyle: true }, app: { plugins: { plugins: { "logseq-style-tasks": { settings: { keywordIcons: true, formatTaskKeywords: false } } } } } };
  const IconExt = keywordIconsExtension(todoIcons);
  const iconPass = new IconExt(makeView(["- DONE 手写任务"]));
  check("icons are skipped when TODOseq draws them", iconPass.decorations.length === 0, iconPass.decorations);
  const IconExt2 = keywordIconsExtension({ settings: { keywordStyle: true }, app: { plugins: { plugins: {} } } });
  const iconPass2 = new IconExt2(makeView(["- DONE 手写任务"]));
  check("icons are drawn once TODOseq stops drawing them", iconPass2.decorations.length === 1, iconPass2.decorations);

  const off = decorationFor(["- DONE 手写任务"], { keywordStyle: false });
  check("keywordStyle false renders nothing", off.length === 0, off);
  check("keywordStyle false also skips the icons pass", keywordMarksExtension({ settings: { keywordStyle: false }, app: { plugins: { plugins: {} } } }), true);
}

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log("all passed");
