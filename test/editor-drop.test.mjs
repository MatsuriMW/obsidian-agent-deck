import assert from "node:assert/strict";
import { register } from "node:module";

register("data:text/javascript," + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier === "@codemirror/view") {
    return {
      url: "data:text/javascript," + encodeURIComponent(\`
        const NONE = Object.freeze({ specs: [], map() { return NONE; } });
        export class WidgetType {}
        export const Decoration = {
          none: NONE,
          set(items) { return { specs: items, map() { return this; } }; },
          line(spec) { return { kind: "line", ...spec, range(from) { return { kind: "line", from, ...spec }; } }; },
          widget(spec) { return { kind: "widget", ...spec, range(from) { return { kind: "widget", from, ...spec }; } }; },
          replace(spec) { return { kind: "replace", ...spec, range(from) { return { kind: "replace", from, ...spec }; } }; },
          mark(spec) { return { kind: "mark", ...spec, range(from, to) { return { kind: "mark", from, to, ...spec }; } }; },
        };
        export const ViewPlugin = { fromClass(cls) { return { cls }; } };
        export const EditorView = {
          decorations: { from(f) { return f; } },
          atomicRanges: { of() { return {}; } },
          domEventHandlers() { return {}; },
          theme() { return {}; },
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
          finish() { return { specs: this.items }; }
        }
        export const StateEffect = {
          define() {
            const type = {};
            type.of = (value) => ({ type, value, is(target) { return target === type; } });
            return type;
          },
        };
        export const StateField = { define(cfg) { return cfg; } };
        export const Prec = { highest(x) { return x; }, high(x) { return x; }, low(x) { return x; } };
        export const EditorState = {
          transactionFilter: { of(fn) { return fn; } },
        };
      \`),
      shortCircuit: true,
    };
  }
  if (specifier === "@codemirror/language") {
    return {
      url: "data:text/javascript," + encodeURIComponent(\`
        export function syntaxTree() { return { resolveInner() { return null; } }; }
        export function foldedRanges() { return { iter() {} }; }
        export const foldEffect = { is() { return false; } };
        export const unfoldEffect = { is() { return false; } };
      \`),
      shortCircuit: true,
    };
  }
  if (specifier === "obsidian") {
    return {
      url: "data:text/javascript," + encodeURIComponent(\`
        export class Component {}
        export class Menu { addItem() { return this; } addSeparator() { return this; } showAtMouseEvent() {} }
        export class Notice {}
        export const MarkdownRenderer = { async render() {} };
        export function setIcon() {}
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

const { setDrop, dropField } = await import("../src/editor.js");

const mockDoc = {
  line(n) {
    return { from: (n - 1) * 10 };
  },
};

const initial = dropField.create();
assert.equal(initial.specs.length, 0);

const bindResult = dropField.update(initial, {
  changes: {},
  effects: [setDrop.of({ line: 0, kind: "bind" })],
  state: { doc: mockDoc },
});
assert.equal(bindResult.specs.length, 1);
assert.equal(bindResult.specs[0].from, 0);
assert.equal(bindResult.specs[0].class, "ad-drop-line ad-drop-line--bind");
assert.ok(bindResult.specs[0].attributes["data-ad-drop"], "expected non-empty data-ad-drop attribute for bind");

const childResult = dropField.update(initial, {
  changes: {},
  effects: [setDrop.of({ line: 0, kind: "child" })],
  state: { doc: mockDoc },
});
assert.equal(childResult.specs.length, 1);
assert.equal(childResult.specs[0].class, "ad-drop-line ad-drop-line--child");
assert.ok(childResult.specs[0].attributes["data-ad-drop"], "expected non-empty data-ad-drop attribute for child");

const afterResult = dropField.update(bindResult, {
  changes: {},
  effects: [setDrop.of({ line: 1, kind: "after" })],
  state: { doc: mockDoc },
});
assert.equal(afterResult.specs.length, 1);
assert.equal(afterResult.specs[0].from, 10);
assert.equal(afterResult.specs[0].class, "ad-drop-line ad-drop-line--after");
assert.ok(afterResult.specs[0].attributes["data-ad-drop"], "expected non-empty data-ad-drop attribute for after");

const cleared = dropField.update(afterResult, {
  changes: {},
  effects: [setDrop.of(null)],
  state: { doc: mockDoc },
});
assert.equal(cleared.specs.length, 0);

{ // AI 自动记录标题行尾小图标/开关（side 1..4）必须排在全宽进度条/后台进度块（side 6）之前，避免换行
  const { createEditorExtension } = await import("../src/editor.js");
  const { EditorView } = await import("@codemirror/view");
  const lineText = "- DOING 🤖 **优化排版** ^claude-abc";
  const mockView = {
    state: {
      doc: {
        lines: 1,
        toString: () => lineText,
        lineAt: () => ({ number: 1, from: 0, to: lineText.length, length: lineText.length, text: lineText }),
        line: () => ({ number: 1, from: 0, to: lineText.length, length: lineText.length, text: lineText }),
      },
      selection: { main: { empty: true, head: 2 } },
      field: () => ({ file: { path: "日记/2026_11_27.md" } }),
    },
    visibleRanges: [{ from: 0, to: lineText.length }],
  };
  const plugin = {
    _lastEditor: mockView,
    editorInfoField: "editorInfo",
    settings: { showEditorPills: true, dragGrip: true },
    lineMap: () => ({ lines: [lineText], sessionByParent: new Map() }),
    jobAtLine: () => null,
    nautilusOwnsLine: () => false,
    lineProgressInfo: () => ({ pct: 40, mode: "run", agent: "claude", step: "running" }),
  };
  const ext = createEditorExtension(plugin);
  const inst = new ext[0].cls(mockView);
  const items = inst.decorations?.specs || [];
  const gripItem = items.find((it) => it.value?.widget?.constructor?.name === "GripWidget");
  const progItem = items.find((it) => it.value?.widget?.constructor?.name === "LineProgressWidget");
  assert.ok(gripItem && progItem, "both GripWidget and LineProgressWidget should render on active cursor line");
  assert.ok((gripItem.value.side ?? 0) < (progItem.value.side ?? 0), `GripWidget side (${gripItem.value.side}) must be less than LineProgressWidget side (${progItem.value.side}) so title arrows never wrap`);
}

console.log("PASS editor-drop tests");
