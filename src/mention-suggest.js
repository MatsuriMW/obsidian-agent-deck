import { EditorSuggest } from "obsidian";
import { mentionSuggestions } from "./task-mentions.js";

export class TaskAgentSuggest extends EditorSuggest {
  constructor(plugin) { super(plugin.app); this.plugin = plugin; }
  onTrigger(cursor, editor) {
    const line = editor.getLine(cursor.line), head = line.slice(0, cursor.ch);
    if (!/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) return null;
    // Do not offer routing inside fenced code blocks or inline code.
    let fence = "";
    for (let n = 0; n < cursor.line; n++) {
      const m = /^\s*(`{3,}|~{3,})/.exec(editor.getLine(n));
      if (m) { if (!fence) fence = m[1][0]; else if (m[1][0] === fence) fence = ""; }
    }
    if (fence || (head.match(/`/g) || []).length % 2) return null;
    const m = /(?:^|\s)@([a-zA-Z0-9._/-]*)$/.exec(head);
    if (!m) return null;
    return { start: { line: cursor.line, ch: cursor.ch - m[1].length - 1 }, end: cursor, query: m[1] };
  }
  getSuggestions(context) { return mentionSuggestions(this.plugin, context.query); }
  renderSuggestion(item, el) { el.createDiv({ text: item.label }); el.createDiv({ cls: "ad-muted", text: `@${item.value} · ${item.hint}` }); }
  selectSuggestion(item) {
    if (!this.context) return;
    const { editor, start, end } = this.context;
    const text = `@${item.value}`;
    editor.replaceRange(text, start, end);
    editor.setCursor({ line: start.line, ch: start.ch + text.length });
    this.close();
  }
}
