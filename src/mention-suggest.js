import { EditorSuggest } from "obsidian";
import { mentionSuggestions, mentionTrigger } from "./task-mentions.js";

export class TaskAgentSuggest extends EditorSuggest {
  constructor(plugin) { super(plugin.app); this.plugin = plugin; }
  onTrigger(cursor, editor) {
    if (this.plugin.settings.delegate?.mentionSuggest === false) return null;
    const line = editor.getLine(cursor.line), head = line.slice(0, cursor.ch);
    if (!/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) return null;
    // Do not offer routing inside fenced code blocks or inline code.
    let fence = "";
    for (let n = 0; n < cursor.line; n++) {
      const m = /^\s*(`{3,}|~{3,})/.exec(editor.getLine(n));
      if (m) { if (!fence) fence = m[1][0]; else if (m[1][0] === fence) fence = ""; }
    }
    if (fence || (head.match(/`/g) || []).length % 2) return null;
    const token = /(?:^|\s)(\S*)$/.exec(head)?.[1];
    const trigger = mentionTrigger(this.plugin);
    if (!token?.startsWith(trigger)) return null;
    const query = token.slice(trigger.length);
    if (!/^[a-zA-Z0-9._/-]*$/.test(query)) return null;
    return { start: { line: cursor.line, ch: cursor.ch - token.length }, end: cursor, query };
  }
  getSuggestions(context) { return mentionSuggestions(this.plugin, context.query); }
  renderSuggestion(item, el) { el.createDiv({ text: item.label }); el.createDiv({ cls: "ad-muted", text: `${mentionTrigger(this.plugin)}${item.value} · ${item.hint}` }); }
  selectSuggestion(item) {
    if (!this.context) return;
    const { editor, file, start, end } = this.context;
    const text = `${mentionTrigger(this.plugin)}${item.value}${item.next ? "/" : ""}`;
    editor.replaceRange(text, start, end);
    editor.setCursor({ line: start.line, ch: start.ch + text.length });
    this.close();
    if (item.next && this.plugin.settings.delegate?.mentionSuggest !== false) {
      // Reopen after the editor applies the selection. Obsidian's suggest manager
      // is also what normally opens the next level when a slash is typed.
      setTimeout(() => {
        const cursor = editor.getCursor();
        if (this.plugin.settings.delegate?.mentionSuggest !== false && cursor.line === start.line && cursor.ch === start.ch + text.length && editor.getLine(start.line).slice(start.ch, cursor.ch) === text) this.app.workspace.editorSuggest?.trigger(editor, file, true);
      }, 0);
    }
  }
}

export function registerTaskAgentSuggest(plugin) {
  const suggest = new TaskAgentSuggest(plugin);
  plugin.registerEditorSuggest(suggest);
  // Obsidian stops at the first matching suggester. Tasks may match the
  // entire checkbox line, so check our narrow @ pattern before it.
  const suggests = plugin.app.workspace.editorSuggest?.suggests;
  const index = suggests?.indexOf(suggest);
  if (index > 0) suggests.unshift(...suggests.splice(index, 1));
}
