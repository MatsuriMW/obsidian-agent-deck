// 按命令 ID 联动，尊重 Obsidian 的自定义快捷键，不另抢按键。
export const RECORD_FOLD_COMMANDS = {
  "editor:toggle-fold": { open: null },
  "editor:fold-more": { open: false }, "editor:fold-less": { open: true },
  "editor:fold-all": { open: false, all: true }, "editor:unfold-all": { open: true, all: true },
  "bullet:fold": { open: false }, "bullet:unfold": { open: true },
};
export function foldTargets(groups, line, all = false) {
  if (all) return groups;
  return groups.filter((g) => g.line <= line && g.records[g.records.length - 1] >= line).slice(-1);
}
export function recordsAreOpen(mode, toggled, key) {
  return mode === "collapsed" ? toggled.has(key) : !toggled.has(key);
}
