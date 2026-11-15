import { journalPath } from "./constants.js";
import { journalSources, resolveProjects, isoDay } from "./analytics.js";

export class DashboardData {
  constructor(plugin) { this.plugin = plugin; this.cache = new Map(); }

  async load() {
    const p = this.plugin, vault = p.app.vault, metadata = p.app.metadataCache;
    const paths = new Set(Object.keys(p.store.days).map(day => journalPath(p.app, p.settings, day)));
    for (const binding of Object.values(p.settings.taskBindings || {})) if (binding.path) paths.add(binding.path);
    for (const job of Object.values(p.jobs || {})) if (job.path) paths.add(job.path);
    if (p.settings.doneArchivePath) paths.add(p.settings.doneArchivePath);
    const sources = new Map();
    let unreadable = 0;
    // Yield between small batches: opening the dashboard must not freeze editors.
    const files = [...paths].map(path => vault.getAbstractFileByPath(path)).filter(f => f?.extension === "md");
    for (let i = 0; i < files.length; i += 6) {
      await Promise.all(files.slice(i, i + 6).map(async file => {
        try {
          const editor = p.autoLog?.viewFor(file)?.editor;
          const signature = `${file.stat.mtime}:${file.stat.size}`;
          const text = editor?.getValue();
          let cached = this.cache.get(file.path);
          if (!cached || cached.signature !== signature || cached.editorText !== text) {
            const entries = journalSources(text ?? await vault.cachedRead(file), file.path);
            cached = { signature, editorText: text, entries };
            this.cache.set(file.path, cached);
          }
          for (const entry of cached.entries) {
            const links = [...entry.text.matchAll(/\[\[([^\]|#]+)(?:[^\]]*)\]\]/g)].map(m => metadata.getFirstLinkpathDest(m[1], file.path)?.path).filter(Boolean);
            if (!sources.has(entry.sid)) sources.set(entry.sid, []);
            sources.get(entry.sid).push({ ...entry, links });
          }
        } catch { unreadable++; }
      }));
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    for (const path of this.cache.keys()) if (!paths.has(path)) this.cache.delete(path);
    const pages = vault.getMarkdownFiles().filter(f => !paths.has(f.path) && !f.path.startsWith("Agent Deck/Conversations/") && !/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(f.basename)).map(file => {
      const aliases = metadata.getFileCache(file)?.frontmatter?.aliases;
      return { path: file.path, name: file.basename, aliases: typeof aliases === "string" ? [aliases] : Array.isArray(aliases) ? aliases.filter(a => typeof a === "string") : [] };
    });
    const rows = [];
    for (const [day, data] of Object.entries(p.store.days)) {
      const list = data.list?.length ? data.list : [{ sid: `legacy:${day}`, out: data.out, fresh: data.fresh, cached: data.cached, segs: data.segs, legacy: true }];
      for (const session of list) {
        const meta = p.usage.meta.get(session.sid);
        rows.push({ ...session, day: isoDay(day), title: session.title || meta?.title || "", sources: sources.get(session.sid) || [] });
      }
      if (data.list?.length) {
        // Older summaries can retain message usage without a corresponding
        // session row. Keep that known usage visible without inventing a session.
        const remainder = Object.fromEntries(["out", "fresh", "cached"].map(key => [key, Math.max(0, (data[key] || 0) - list.reduce((n, row) => n + (row[key] || 0), 0))]));
        if (Object.values(remainder).some(Boolean)) rows.push({ ...remainder, sid: `legacy:${day}`, day: isoDay(day), legacy: true, residual: true, sources: [] });
      }
    }
    const signature = JSON.stringify([rows, pages, p.settings.dashboardProjects]);
    if (this.signature !== signature) {
      this.resolved = resolveProjects(rows, pages, p.settings.dashboardProjects || {});
      this.signature = signature;
    }
    return { rows: this.resolved, pages, unreadable };
  }
}
