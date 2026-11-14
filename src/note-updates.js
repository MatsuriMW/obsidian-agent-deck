import * as J from "./journal.js";

const queues = new WeakMap();

// Queue the whole read/merge/write transaction, independently for each note.
export function serializeNote(plugin, path, task) {
  let pending = queues.get(plugin);
  if (!pending) queues.set(plugin, pending = new Map());
  const next = (pending.get(path) || Promise.resolve()).catch(() => {}).then(task);
  pending.set(path, next);
  return next.finally(() => { if (pending.get(path) === next) pending.delete(path); });
}

export function updateNote(plugin, path, transform) {
  return serializeNote(plugin, path, async () => {
    // Let Chinese/Japanese IME composition finish before touching the editor.
    while (!plugin._unloaded && plugin.viewForPath?.(path)?.editor.cm?.composing) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (plugin._unloaded) return;
    const view = plugin.viewForPath?.(path);
    if (view && (!view.getMode || view.getMode() === "source")) {
      const before = view.editor.getValue();
      const next = transform(before);
      const change = J.diffLines(before, next);
      if (change) view.editor.transaction({ changes: [change] });
      return;
    }
    const file = plugin.app?.vault?.getAbstractFileByPath(path);
    if (file && plugin.app.vault.process) {
      await plugin.app.vault.process(file, transform);
      return;
    }
    const before = plugin.readNote ? await plugin.readNote(path) : await plugin.app.vault.read(file);
    const next = transform(before);
    if (next !== before) {
      if (plugin.writeNote) await plugin.writeNote(path, next);
      else await plugin.app.vault.modify(file, next);
    }
  });
}
