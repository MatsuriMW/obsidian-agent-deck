import { Notice, MarkdownView } from 'obsidian';
import { dayKeyToday } from './constants.js';
import { t } from './i18n.js';

export function unorganizedRecordKeys(plan) {
  const occurrences = new Map();
  return [...plan.active, ...plan.done.filter(entry => entry.ai)].filter(entry => !entry.organized).map(entry => {
    const key = entry.blockId || entry.sid?.join(',') || entry.text.split('\n')[0];
    const n = occurrences.get(key) || 0;
    occurrences.set(key, n + 1);
    return `${key}:${n}`;
  });
}

export class JournalOrganizer {
  constructor(plugin) {
    this.plugin = plugin;
    const schedule = () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.check().catch(error => console.warn('[agent-deck] journal layout', error)), 2000);
    };
    for (const name of ['file-open', 'active-leaf-change', 'editor-change']) plugin.registerEvent(plugin.app.workspace.on(name, schedule));
    plugin.registerEvent(plugin.app.vault.on('modify', file => { if (file.path === plugin.app.workspace.getActiveFile()?.path) schedule(); }));
    plugin.register(() => { clearTimeout(this.timer); this.notice?.hide(); });
    schedule();
  }

  async check() {
    const p = this.plugin;
    if (this.checking || p._unloaded || p.settings.organizeJournalSuggest === false) return;
    this.checking = true;
    try {
      await p._usageReady;
      if (p._unloaded) return;
      const view = p.app.workspace.getActiveViewOfType(MarkdownView);
      const file = view?.file;
      if (!file || view.editor?.cm?.composing || file.path !== p.journalTarget()?.path) return;
      const day = dayKeyToday(p.settings);
      const previous = p.settings.journalOrganizePrompt || { notes: {} };
      const count = previous.day === day ? previous.count || 0 : 0;
      if (count >= 2) return;
      const base = await p.readNote(file.path);
      const plan = await p.journalPlan(file, base);
      const keys = unorganizedRecordKeys(plan);
      const acknowledged = previous.notes?.[file.path] || [];
      if (keys.filter(key => !acknowledged.includes(key)).length < 4 || p.app.workspace.getActiveFile()?.path !== file.path || p._unloaded || p.settings.organizeJournalSuggest === false) return;
      // Acknowledged task identities survive reloads and midnight. New replies
      // inside the same task never count as another scattered task.
      p.settings.journalOrganizePrompt = { day, count: count + 1, notes: { ...previous.notes, [file.path]: [...new Set([...acknowledged, ...keys])] } };
      await p.saveSettings();
      if (p._unloaded) return;
      this.notice?.hide();
      const fragment = document.createDocumentFragment();
      fragment.createEl('div', { text: t('这篇日记的 AI 记录有些分散或顺序混乱，要整理日志吗？') });
      const actions = fragment.createDiv({ cls: 'ad-btnrow' });
      actions.createEl('button', { text: t('整理日志') }).onclick = async () => {
        this.notice?.hide();
        try { await p.organizeJournal(file); } catch (error) { p.notice(error.message); }
      };
      actions.createEl('button', { text: t('稍后') }).onclick = () => this.notice?.hide();
      this.notice = new Notice(fragment, 20000);
    } finally { this.checking = false; }
  }
}
