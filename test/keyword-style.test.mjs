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

const { keywordOf, isAiRecordLine, isDoneKeyword, todoSeqFormatsKeywords, todoSeqRendersIcons, keywordMarksExtension, keywordIconsExtension, applyKeywordStyle } =
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

  // 小写块首关键词识别与规范化，同时忽略 Title Case 与前缀粘连词
  for (const [sample, expectedKw, expectedRaw] of [
    ["- todo 写文档", "TODO", "todo"],
    ["- doing 修 bug", "DOING", "doing"],
    ["- done 已完成", "DONE", "done"],
    ["- later 稍后处理", "LATER", "later"],
    ["- now 立刻开始", "NOW", "now"],
    ["- waiting 等反馈", "WAITING", "waiting"],
    ["- in-progress 推进中", "IN-PROGRESS", "in-progress"],
    ["- canceled 取消", "CANCELED", "canceled"],
    ["- cancelled 取消", "CANCELLED", "cancelled"],
    ["- failed 失败", "FAILED", "failed"],
    ["- toreview 待查看", "TOREVIEW", "toreview"],
    ["- needok 待授权", "NEEDOK", "needok"],
    ["- todoforai 交给 AI", "TODOFORAI", "todoforai"],
    ["- todo4ai 交给 AI", "TODO4AI", "todo4ai"],
    ["> - todo 引用待办", "TODO", "todo"],
    ["## todo 标题任务", "TODO", "todo"],
    ["- [ ] doing 复选框任务", "DOING", "doing"],
    ["- **09:30** doing 接续", "DOING", "doing"],
    ["todo 纯行首任务", "TODO", "todo"],
  ]) {
    const res = keywordOf(sample);
    check(`lowercase recognized: ${sample}`, res && res.keyword === expectedKw && res.raw === expectedRaw, res);
  }
  for (const neg of [
    "- Now we ship",
    "- Wait for CI",
    "- Later we refactor",
    "- Failed to connect",
    "- Todo 标题",
    "Now let's go",
    "- todolist 事项",
    "- nowhere to go",
    "这是一句 todo 说明",
  ]) {
    check(`non-task ignored: ${neg}`, keywordOf(neg) === null, keywordOf(neg));
  }
}

// ---- 标记与豁免 ----
{
  check("AI record marker is detected", isAiRecordLine("- DONE 🤖 10:00-10:12 做事"), true);
  check("hand written line is not an AI record", !isAiRecordLine("- DONE 手写任务"), true);
  check("DONE family counts as completed", ["DONE", "CANCELED", "CANCELLED", "FAILED", "done", "canceled", "cancelled", "failed"].every(isDoneKeyword), true);
  check("DOING is not completed", !isDoneKeyword("DOING") && !isDoneKeyword("doing"), true);
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

  // 编辑器小写装饰 + 图标：保留小写字符长度，属性与图标归一化到大写
  const lowerTodo = decorationFor(["- todo 写文档"]);
  check("lowercase todo is decorated with canonical attr",
    lowerTodo.length === 1 && lowerTodo[0].from === 2 && lowerTodo[0].to === 6 && lowerTodo[0].value.spec.attributes["data-task-keyword"] === "TODO",
    lowerTodo);
  const lowerDone = decorationFor(["- done 手写任务"]);
  check("lowercase hand written done is struck through",
    pick(lowerDone, "todoseq-completed-keyword").length === 1 && pick(lowerDone, "todoseq-completed-task-text").length === 1,
    lowerDone);
  const lowerAiDone = decorationFor(["- done 🤖 10:00-10:12 AI"]);
  check("lowercase AI record done is not struck through",
    pick(lowerAiDone, "todoseq-keyword-formatted").length === 1 && pick(lowerAiDone, "todoseq-completed-task-text").length === 0,
    lowerAiDone);
  const lowerIcons = new IconExt2(makeView(["- doing 修 bug"]));
  check("lowercase doing renders icon with canonical data-kw",
    lowerIcons.decorations.length === 1 && lowerIcons.decorations[0].value.spec.widget.keyword === "DOING",
    lowerIcons.decorations);

  // 阅读视图 applyKeywordStyle：识别小写关键词并保留原小写文本，同时忽略 Title Case
  const mkNode = (tagName, textContent) => {
    const attrs = {};
    const node = {
      nodeType: tagName ? 1 : 3,
      tagName: tagName || "",
      attrs,
      className: "",
      childNodes: [],
      parentNode: null,
      ownerDocument: null,
      get textContent() { return node.nodeType === 3 ? node._text : node.childNodes.map((c) => c.textContent).join(""); },
      set textContent(v) {
        if (node.nodeType === 3) { node._text = v; return; }
        node.childNodes = v ? [mkText(v)] : [];
        node.childNodes.forEach((c) => { c.parentNode = node; c.ownerDocument = node.ownerDocument; });
      },
      _text: textContent || "",
      setAttribute(k, v) { attrs[k] = String(v); },
      closest() { return null; },
      querySelector() { return null; },
      append(...items) {
        for (const it of items) {
          const child = typeof it === "string" ? mkText(it) : it;
          if (child.nodeType === 11) { node.append(...child.childNodes); continue; }
          child.parentNode = node;
          child.ownerDocument = node.ownerDocument;
          node.childNodes.push(child);
        }
      },
      after(newNode) {
        const siblings = node.parentNode.childNodes;
        const idx = siblings.indexOf(node);
        newNode.parentNode = node.parentNode;
        newNode.ownerDocument = node.ownerDocument;
        siblings.splice(idx + 1, 0, newNode);
      },
      replaceWith(newNode) {
        const siblings = node.parentNode.childNodes;
        const idx = siblings.indexOf(node);
        const list = newNode.nodeType === 11 ? newNode.childNodes : [newNode];
        for (const it of list) { it.parentNode = node.parentNode; it.ownerDocument = node.ownerDocument; }
        siblings.splice(idx, 1, ...list);
      },
      get nextSibling() {
        const siblings = node.parentNode?.childNodes || [];
        const idx = siblings.indexOf(node);
        return idx >= 0 && idx + 1 < siblings.length ? siblings[idx + 1] : null;
      },
    };
    return node;
  };
  const mkText = (s) => mkNode(null, s);
  const docStub = {
    createElement: (tag) => Object.assign(mkNode(tag.toUpperCase()), { ownerDocument: docStub }),
    createTextNode: (s) => Object.assign(mkText(s), { ownerDocument: docStub }),
    createDocumentFragment: () => Object.assign(mkNode("#FRAG"), { nodeType: 11, ownerDocument: docStub }),
  };
  const hostItems = [
    ["LI", "todo 写文档"],
    ["LI", "done 完成任务"],
    ["LI", "todo4ai 交给 AI"],
    ["LI", "in-progress 推进中"],
    ["LI", "Now we ship"],
  ].map(([tag, txt]) => {
    const el = mkNode(tag);
    el.ownerDocument = docStub;
    el.append(mkText(txt));
    return el;
  });
  applyKeywordStyle({ querySelectorAll: () => hostItems });
  check("reading view renders lowercase todo preserving lowercase text",
    hostItems[0].childNodes[0].attrs["data-task-keyword"] === "TODO" && hostItems[0].childNodes[0].textContent === "todo",
    hostItems[0].childNodes);
  check("reading view wraps lowercase done text as completed",
    hostItems[1].childNodes[0].attrs["data-task-keyword"] === "DONE" &&
    hostItems[1].childNodes[0].className.includes("todoseq-completed-keyword") &&
    hostItems[1].childNodes[1].className === "todoseq-completed-task-text",
    hostItems[1].childNodes);
  check("reading view handles lowercase digit keyword todo4ai",
    hostItems[2].childNodes[0].attrs["data-task-keyword"] === "TODO4AI" && hostItems[2].childNodes[0].textContent === "todo4ai",
    hostItems[2].childNodes);
  check("reading view handles lowercase hyphenated in-progress",
    hostItems[3].childNodes[0].attrs["data-task-keyword"] === "IN-PROGRESS" && hostItems[3].childNodes[0].textContent === "in-progress",
    hostItems[3].childNodes);
  check("reading view leaves Title Case prose untouched",
    hostItems[4].childNodes.length === 1 && hostItems[4].childNodes[0].nodeType === 3,
    hostItems[4].childNodes);
}

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1); }
console.log("all passed");
