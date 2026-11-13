import { MarkdownView } from "obsidian";
import { foldedRanges, unfoldEffect } from "@codemirror/language";
import { aiRecordGroups, recordIsOpen } from "./ai-records.js";
import { setRecordsOpenEffect } from "./record-display.js";
import { RECORD_FOLD_COMMANDS, foldTargets } from "./fold-actions.js";

export function integrateRecordFolding(plugin) {
  for (const [id, spec] of Object.entries(RECORD_FOLD_COMMANDS)) {
    const command = plugin.app.commands.commands[id];
    if (!command?.checkCallback) continue;
    const original = command.checkCallback;
    const wrapped = function (checking) {
      const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
      const cm = view?.editor?.cm;
      const value = cm?.state.field(plugin.aiRecordDisplayField, false);
      if (!value) return original.apply(this, arguments);
      const groups = aiRecordGroups(cm.state.doc.toString(), plugin.recordTrackedIds());
      const targets = foldTargets(groups, view.editor.getCursor().line, spec.all);
      if (!targets.length) return original.apply(this, arguments);
      if (checking) return true;
      const open = spec.open ?? !recordIsOpen(plugin.settings, value.mode, targets[0]);
      const result = original.apply(this, arguments);
      const current = aiRecordGroups(cm.state.doc.toString(), plugin.recordTrackedIds());
      const keys = new Set(spec.all ? current.map((g) => g.key) : targets.map((g) => g.key));
      const effects = [];
      // 记录块的显示由本插件负责：原生折叠留下的 “…” 占位会和我们的折叠钮同时出现两个省略号，
      // 所以只要折叠落在记录块里就撤掉，展开和收起都一样。
      foldedRanges(cm.state).between(0, cm.state.doc.length, (from, to) => {
        const hit = current.some((g) => {
          if (!keys.has(g.key) || !g.records.length) return false;
          const start = cm.state.doc.line(g.line + 1).from;
          const end = cm.state.doc.line(g.records[g.records.length - 1] + 1).to;
          return from > start && from <= end;
        });
        if (hit) effects.push(unfoldEffect.of({ from, to }));
      });
      effects.push(setRecordsOpenEffect.of({ keys: [...keys], open }));
      cm.dispatch({ effects });
      if (spec.all && view.getMode?.() === "preview") {
        for (const button of view.containerEl.querySelectorAll("button.ad-records-toggle")) {
          if ((button.getAttribute("aria-expanded") === "true") !== open) button.click();
        }
      }
      return result ?? true;
    };
    command.checkCallback = wrapped;
    plugin.register(() => { if (command.checkCallback === wrapped) command.checkCallback = original; });
  }
}
