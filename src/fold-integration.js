import { MarkdownView } from "obsidian";
import { foldedRanges, unfoldEffect } from "@codemirror/language";
import { aiRecordGroups } from "./ai-records.js";
import { setRecordsOpenEffect } from "./record-display.js";
import { RECORD_FOLD_COMMANDS, foldTargets, recordsAreOpen } from "./fold-actions.js";

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
      const open = spec.open ?? !recordsAreOpen(targets[0].summaries.length || value.mode === "latest5" ? "collapsed" : value.mode, value.toggled, targets[0].key);
      const result = original.apply(this, arguments);
      const current = aiRecordGroups(cm.state.doc.toString(), plugin.recordTrackedIds());
      const keys = new Set(spec.all ? current.map((g) => g.key) : targets.map((g) => g.key));
      const effects = [];
      if (open) {
        // 默认已被记录层收起时，原生“切换”可能先生成一次 fold；展开时一并撤掉。
        foldedRanges(cm.state).between(0, cm.state.doc.length, (from, to) => {
          if (current.some((g) => keys.has(g.key) && cm.state.doc.line(g.line + 1).to >= from && cm.state.doc.line(g.line + 1).from <= to)) effects.push(unfoldEffect.of({ from, to }));
        });
      }
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
