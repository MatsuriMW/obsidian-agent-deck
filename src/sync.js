// Agent Deck — 会话回写日记.
//
// 日记里用 🔗 绑着的会话，这一块负责把会话的变化写回任务行：
//   · 答完一轮 / 归档了 → 任务下面一行 💬（会话最后说的话）
//   · 还在跑 → DOING；停下来等你 → TOREVIEW；等你允许 → NEEDOK；出错 → ERRORED；限额 → HITLIMIT
//   · 桌面版里归档 → DONE + ⏱（和自动记日记同一套写法，收掉 🔗 行）
//   · 会话在桌面版里开出来的子会话 → 缩进写成子块，各带自己的 🔗
//   · 开着的 side chat → 一个子块；进程没了 → DONE + ⏱
//
// 只动开着的笔记（今天的日记没开着的话，子会话那部分直接改文件）。改动按行做，
// 不进撤销记录；正在用输入法打字的那一下不写，等下一轮。

import { MarkdownView } from "obsidian";
import { dayKey, dayKeyToday, dayMinute, fmtTok } from "./constants.js";
import * as J from "./journal.js";

const STATE_KW = { wait: "TOREVIEW", quiet: "TOREVIEW", "needs-approval": "NEEDOK", error: "ERRORED", limit: "HITLIMIT", queued: "QUEUED" };

export class JournalSync {
  constructor(plugin) {
    this.p = plugin;
    this._busy = false;
    this._at = 0;
  }

  get usage() { return this.p.usage; }
  get cfg() { return this.p.settings; }

  archived(sid) {
    if (this.cfg.autoLogArchiveDone === false) return false;
    return (this.usage.archivedClaude && this.usage.archivedClaude.has(sid)) || (this.usage.archived && this.usage.archived.has(sid));
  }

  dayList() {
    const day = dayKeyToday(this.cfg);
    const data = this.usage.summary(day);
    return (data && data.list) || [];
  }

  segmentsFor(sid) {
    const x = this.dayList().find((s) => s.sid === sid);
    return x ? { segs: x.segs || [], out: x.out || 0, fresh: x.fresh || 0, agent: x.agent } : null;
  }

  // 开着的笔记里所有带 🔗 的编辑器
  openViews() {
    const out = [];
    this.p.app.workspace.iterateAllLeaves((leaf) => {
      const v = leaf.view;
      if (v instanceof MarkdownView && v.file && v.editor && v.editor.cm) {
        try { if (v.editor.cm.state.doc.toString().includes("🔗")) out.push(v); } catch { /* closed */ }
      }
    });
    return out;
  }

  isOpen(file) { return this.openViews().some((v) => v.file.path === file.path); }

  todayJournal() {
    const f = this.p.app.vault.getAbstractFileByPath(`${this.cfg.journalFolder || "日记"}/${dayKeyToday(this.cfg)}.md`);
    return f && f.extension === "md" ? f : null;
  }

  replace(view, before, after) {
    const cm = view.editor.cm;
    const change = J.diffLines(before, after);
    if (change) {
      try { view.editor.transaction({ changes: [change] }); return true; } catch { /* fall through */ }
    }
    return false;
  }

  async run({ force = false } = {}) {
    if (this._busy) return;
    if (!force && Date.now() - this._at < 8000) return;
    this._at = Date.now();
    if (this.cfg.journalSync === false) return;
    if (this.p.nautilusOwnsAi && this.p.nautilusOwnsAi()) {
      if (!this._warned) { this._warned = true; console.info("[agent-deck] 螺旋日程的 AI 追踪还开着，回写先停着"); }
      return;
    }
    this._busy = true;
    try {
      for (const view of this.openViews()) {
        const cm = view.editor.cm;
        if (!cm || !cm.dom.isConnected || cm.composing) continue;
        const text = cm.state.doc.toString();
        let next = text;
        if (this.cfg.resultBack !== false) next = this.results(next);
        if (this.cfg.agentKw !== false) next = this.keywords(next);
        if (this.cfg.kidBlocks !== false) { next = this.spawnAll(next); next = this.subsIntoAll(next); next = this.sides(next); }
        if (next !== text) this.replace(view, text, next);
      }
      const file = this.todayJournal();
      if (file && !this.isOpen(file)) {
        const text = await this.p.app.vault.read(file);
        let next = this.spawnAll(text);
        next = this.sides(next);
        if (next !== text) await this.p.app.vault.process(file, (cur) => (cur === text ? next : cur));
      }
    } catch (e) {
      console.error("[agent-deck] 会话回写日记失败", e);
    } finally { this._busy = false; }
  }

  // 答完一轮或者归档了：把会话最后说的话写成 💬
  results(text) {
    const seen = new Set();
    for (const line of text.split("\n")) {
      const k = J.parseLink(line);
      if (k && !seen.has(k.sid)) seen.add(k.sid);
    }
    let out = text;
    for (const sid of seen) {
      const m = this.usage.meta.get(sid);
      if (!m) continue;
      const waiting = m.state === "wait" || m.state === "quiet";
      if (!waiting && !this.archived(sid)) continue;
      const said = String(m.lastText || "").trim();
      if (!said) continue;
      out = J.resultInto(out, sid, J.resultText(said, this.cfg.resultMax || 200));
    }
    return out;
  }

  // 关键词跟着会话走：只在 DOING 和中间态之间切，你改成别的就不碰
  keywords(text) {
    let out = text;
    const lines = () => out.split("\n");
    // 从下往上改，行号不会因为插入而错
    for (let at = lines().length - 1; at >= 0; at--) {
      const line = lines()[at];
      const k = J.parseLink(line);
      if (!k) continue;
      const ls = lines();
      const n = J.markOwner(ls, at);
      if (n < 0) continue;
      const cur = J.kwLine(ls[n]);
      if (!cur) continue;
      if (!(cur.kw === "DOING" || cur.kw === "DELEGATED" || J.AGENT_KW_RE.test(cur.kw) || !cur.kw)) continue;
      if (this.archived(k.sid)) {
        if (cur.kw === "DOING" || cur.kw === "DELEGATED" || J.AGENT_KW_RE.test(cur.kw)) out = this.finish(out, k.sid, at);
        continue;
      }
      const m = this.usage.meta.get(k.sid);
      if (!m) continue;
      const want = m.state === "run" ? (cur.kw === "DELEGATED" ? "DELEGATED" : "DOING") : STATE_KW[m.state];
      if (!want || want === cur.kw) continue;
      const p = J.splitTask(ls[n]);
      if (!p) continue;
      const nextLine = `${p.prefix}${want} ${p.since ? p.since + " " : ""}${p.rest}`.trimEnd();
      if (nextLine !== ls[n]) {
        ls[n] = nextLine;
        out = ls.join("\n");
      }
    }
    return out;
  }

  // 归档 = 做完：DONE + 实际时段，收掉 🔗 行
  finish(text, sid, linkAt) {
    const lines = text.split("\n");
    const at = typeof linkAt === "number" ? linkAt : lines.findIndex((l) => { const k = J.parseLink(l); return k && k.sid === sid; });
    if (at < 0) return text;
    const n = J.markOwner(lines, at);
    if (n < 0) return text;
    const p = J.splitTask(lines[n]);
    if (!p) return text;
    const meta = this.usage.meta.get(sid) || {};
    const last = meta.lastAt ? dayMinute(meta.lastAt, this.cfg) : null;
    const body = p.rest.replace(/^\d{1,2}[:：]\d{2}\s*[-–~～到至]\s*\d{1,2}[:：]\d{2}\s*/, "");
    lines[n] = `${p.prefix}DONE ${last != null ? J.clock(last) + " " : ""}${body}`.trimEnd();
    const info = this.segmentsFor(sid);
    if (info && info.segs.length) {
      // 先收掉旧的 ⏱
      const base = J.width(lines[n]);
      for (let i = n + 1; i < lines.length; i++) {
        if (lines[i].trim() && J.width(lines[i]) <= base) break;
        if (J.CLOCK_RE.test(lines[i])) { lines.splice(i, 1); break; }
      }
      const shown = [];
      for (const [a, b] of info.segs) {
        const prev = shown[shown.length - 1];
        if (prev && a - prev[1] <= 10) prev[1] = Math.max(prev[1], b);
        else shown.push([a, b]);
      }
      const total = Math.round(info.segs.reduce((s, [a, b]) => s + b - a, 0));
      const indent = (/^\s*/.exec(lines[n]) || [""])[0] + "\t";
      const who = { claude: "Claude", codex: "Codex", workbuddy: "WorkBuddy", dsh: "DSH" }[info.agent] || info.agent;
      const tok = (info.out || 0) + (info.fresh || 0);
      const clock = `${indent}- ⏱ ${shown.slice(-8).map(([a, b]) => `${J.clock(a)}–${J.clock(b)}`).join("、")} · 共 ${J.durTag(total)}${tok ? ` · ${fmtTok(tok)} tok` : ""}${who ? " · " + who : ""}`;
      lines.splice(n + 1, 0, clock);
    }
    // 收掉这一项的 🔗 行
    const link = J.linkUnder(lines, n);
    if (link && link.sid === sid) lines.splice(link.line, 1);
    return lines.join("\n");
  }

  // 一篇笔记里所有绑着的 Claude 会话开出来的子会话都挂上；新挂上的继续往下挂
  spawnAll(text) {
    const desk = this.usage.deskBySid;
    if (!desk || !desk.size || !text.includes("🔗")) return text;
    const q = [], seen = new Set();
    const scan = (t) => { for (const line of t.split("\n")) { const k = J.parseLink(line); if (k && !seen.has(k.sid)) { seen.add(k.sid); q.push(k.sid); } } };
    scan(text);
    for (let i = 0; i < q.length && i < 200; i++) {
      const next = this.spawnInto(text, q[i]);
      if (next !== text) { text = next; scan(text); }
    }
    return text;
  }

  spawnInto(text, sid) {
    const me = this.usage.deskBySid.get(sid);
    if (!me || !text.includes(sid)) return text;
    const today = dayKeyToday(this.cfg);
    const spawned = [...this.usage.deskBySid.values()]
      .filter((d) => d.parentSid === sid && (dayKey(d.created, this.cfg) === today || dayKey(d.active, this.cfg) === today))
      .sort((a, b) => a.created - b.created);
    if (!spawned.length) return text;
    const lines = text.split("\n");
    const step = () => {
      const todo = spawned.filter((d) => !lines.some((l) => { const k = J.parseLink(l); return k && k.sid === d.sid; }));
      if (!todo.length) return false;
      const at = lines.findIndex((l) => { const k = J.parseLink(l); return k && k.sid === sid; });
      const n = at < 0 ? -1 : J.markOwner(lines, at);
      if (n < 0) return false;
      const base = J.width(lines[n]), kidW = J.width(lines[at]), kidInd = (/^\s*/.exec(lines[at]) || [""])[0];
      const unit = kidInd.includes("\t") ? "\t" : " ".repeat(Math.max(2, kidW - base));
      let end = n;
      for (let i = n + 1; i < lines.length; i++) { if (!lines[i].trim()) continue; if (J.width(lines[i]) <= base) break; end = i; }
      const kids = [];
      for (let i = n + 1; i <= end; i++) if (J.width(lines[i]) === kidW && J.LIST_RE.test(lines[i]) && !/^\s*[-*+]\s+(?:🔗|⏱|💬|🤖\s*(?:子代理|side chat))/.test(lines[i])) kids.push(i);
      const d = todo[0];
      const name = String(d.title || "").trim() || "没起名的会话";
      const mine = kids.find((i) => {
        const kl = J.kwLine(lines[i]);
        return kl && !J.DONE_KWS.includes(kl.kw) && !J.linkUnder(lines, i) && !J.kidUnder(lines, i) && J.kidMatch(kl.body, name);
      });
      if (mine != null) {
        const c2 = J.childMark(lines, mine, () => ({}));
        const ind = c2 ? (/^\s*/.exec(lines[c2.line]) || [""])[0] : (/^\s*/.exec(lines[mine]) || [""])[0] + unit;
        const pt = J.splitTask(lines[mine]);
        if (pt && !pt.cb && (J.OPEN_KWS.includes(pt.kw || "") || (!pt.kw && this.kidTodos(lines, mine)))) lines[mine] = `${pt.prefix}DOING ${this.hm(d.created)} ${pt.rest}`.trimEnd();
        lines.splice(mine + 1, 0, J.linkLine(ind, "claude", name, d.sid));
        return true;
      }
      lines.splice(end + 1, 0,
        `${kidInd}- DOING ${this.hm(d.created)} ${J.AUTO_MARK}${J.resultText(name, 60)}`,
        J.linkLine(kidInd + unit, "claude", name, d.sid));
      return true;
    };
    let changed = false;
    for (let i = 0; i < 40 && step(); i++) changed = true;
    return changed ? lines.join("\n") : text;
  }

  kidTodos(lines, n) {
    const base = J.width(lines[n]);
    for (let i = n + 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      return J.width(lines[i]) > base;
    }
    return false;
  }

  hm(ms) {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  // subagent：会话派出去的子代理，写成「🤖 子代理」子块；跑完换成 DONE / FAILED + ⏱ + 💬
  subsIntoAll(text) {
    if (!this.usage.subs || !this.usage.subs.size || !text.includes("🔗")) return text;
    const sids = [];
    for (const line of text.split("\n")) {
      const k = J.parseLink(line);
      if (k && this.usage.subs.has(k.sid)) sids.push(k.sid);
    }
    for (const sid of sids) text = this.subsInto(text, sid);
    return text;
  }

  kidState(r, parentWait) {
    const quiet = (Date.now() - (r.at || r.start || 0)) / 60e3;
    if (r.state === "done") return { st: "done", kw: "DONE" };
    if (r.state === "fail") return { st: "fail", kw: r.end === "failed" ? "FAILED" : "CANCELLED" };
    if (quiet <= 5) return { st: "run", kw: "DOING" };
    if (!r.bg && parentWait) return { st: "fail", kw: "CANCELLED" };
    return { st: "quiet", kw: "DOING" };
  }

  kidTok(r) { return [...(r.tok || new Map()).values()].reduce((n, v) => n + v, 0); }

  finishKid(indent, r) {
    const tok = this.kidTok(r);
    const min = Math.max(1, Math.round(((r.at || r.start) - r.start) / 60e3));
    const out = [`${indent}- ⏱ ${this.hm(r.start)}–${this.hm(r.at || r.start)} · 共 ${J.durTag(min)}${tok ? ` · ${fmtTok(tok)} tok` : ""} · 子代理 \`${r.id.slice(0, 8)}\``];
    const said = String(r.last || "").trim();
    if (said) out.push(`${indent}- 💬 ${J.resultText(said, this.cfg.resultMax || 200)}`);
    return out;
  }

  subsInto(text, sid) {
    const parent = this.usage.meta.get(sid) || {};
    const parentWait = parent.state !== "run";
    const today = dayKeyToday(this.cfg);
    const subs = this.usage.subsOf(sid).filter((r) => (r.desc || r.type) && dayKey(r.start, this.cfg) === today);
    if (!subs.length) return text;
    const lines = text.split("\n");
    const step = () => {
      const at = lines.findIndex((l) => { const k = J.parseLink(l); return k && k.sid === sid; });
      const n = at < 0 ? -1 : J.markOwner(lines, at);
      if (n < 0) return false;
      const base = J.width(lines[n]), kidW = J.width(lines[at]), kidInd = (/^\s*/.exec(lines[at]) || [""])[0];
      const unit = kidInd.includes("\t") ? "\t" : " ".repeat(Math.max(2, kidW - base));
      let end = n;
      for (let i = n + 1; i < lines.length; i++) { if (!lines[i].trim()) continue; if (J.width(lines[i]) <= base) break; end = i; }
      const kids = [];
      for (let i = n + 1; i <= end; i++) {
        if (J.width(lines[i]) !== kidW || !J.LIST_RE.test(lines[i])) continue;
        if (/^\s*[-*+]\s+(?:🔗|⏱|💬|🤖\s*(?:子代理|side chat))/.test(lines[i])) continue;
        kids.push(i);
      }
      const known = new Map(), claimed = new Set();
      for (const k of kids) {
        const mark = J.childMark(lines, k, (l) => { const id = J.kidIdent(l); return id && id.kind === "sub" ? id : null; });
        if (mark) { known.set(String(mark.id), { block: k, mark: mark.line, open: !!mark.open }); claimed.add(k); }
      }
      const setKw = (k, kw, time) => {
        const pt = J.splitTask(lines[k]);
        if (pt) lines[k] = `${pt.prefix}${kw} ${time} ${pt.rest}`.trimEnd();
      };
      for (const r of subs) {
        const id = r.id.slice(0, 8), k = this.kidState(r, parentWait), over = k.st === "done" || k.st === "fail";
        const had = known.get(id);
        if (had) {
          if (!had.open) continue;
          if (over) {
            const ind = (/^\s*/.exec(lines[had.block]) || [""])[0];
            setKw(had.block, k.kw, this.hm(r.at || r.start));
            const mark = J.parseKid(lines[had.mark]);
            if (mark) lines[had.mark] = `${ind}\t- ⏱ ${this.hm(r.start)}–${this.hm(r.at || r.start)} · 共 ${J.durTag(Math.max(1, Math.round(((r.at || r.start) - r.start) / 60e3)))}${this.kidTok(r) ? ` · ${fmtTok(this.kidTok(r))} tok` : ""} · 子代理 \`${id}\``;
            const said = String(r.last || "").trim();
            if (said) lines.splice(had.mark + 1, 0, `${ind}\t- 💬 ${J.resultText(said, this.cfg.resultMax || 200)}`);
            return true;
          }
          continue;
        }
        const mine = kids.find((i) => {
          if (claimed.has(i)) return false;
          const kl = J.kwLine(lines[i]);
          return kl && !J.DONE_KWS.includes(kl.kw) && !J.linkUnder(lines, i) && J.kidMatch(kl.body, r.desc || r.type);
        });
        if (mine != null) {
          claimed.add(mine);
          const ind = (/^\s*/.exec(lines[mine]) || [""])[0];
          if (over) {
            setKw(mine, k.kw, this.hm(r.at || r.start));
            lines.splice(mine + 1, 0, ...this.finishKid(ind, r));
          } else {
            const pt = J.splitTask(lines[mine]);
            setKw(mine, "DOING", pt && pt.kw === "DOING" && pt.since ? pt.since : this.hm(r.start));
            lines.splice(mine + 1, 0, `${ind}\t- 🔗 子代理 \`${id}\``);
          }
          return true;
        }
        const name = J.resultText(r.desc || r.type || "subagent", 60);
        if (over) {
          lines.splice(end + 1, 0, `${kidInd}- ${k.kw} ${this.hm(r.at || r.start)} ${J.AUTO_MARK}${name}`, ...this.finishKid(kidInd + unit, r));
        } else {
          lines.splice(end + 1, 0, `${kidInd}- DOING ${this.hm(r.start)} ${J.AUTO_MARK}${name}`, `${kidInd}${unit}- 🔗 子代理 \`${id}\``);
        }
        return true;
      }
      return false;
    };
    let changed = false;
    for (let i = 0; i < 40 && step(); i++) changed = true;
    return changed ? lines.join("\n") : text;
  }

  // side chat：开着的写成子块，进程没了记成 DONE + ⏱
  sides(text) {
    if (!this.usage.sideChats) return text;
    const sids = new Set(this.usage.sideChats.keys());
    for (const line of text.split("\n")) { const k = J.parseLink(line); if (k) sids.add(k.sid); }
    for (const sid of sids) if (text.includes(sid)) text = this.sideInto(text, sid);
    return text;
  }

  sideInto(text, sid) {
    const lines = text.split("\n");
    const at = lines.findIndex((l) => { const k = J.parseLink(l); return k && k.sid === sid; });
    if (at < 0) return text;
    const n = J.markOwner(lines, at);
    if (n < 0) return text;
    const base = J.width(lines[n]), kidW = J.width(lines[at]), kidInd = (/^\s*/.exec(lines[at]) || [""])[0];
    const unit = kidInd.includes("\t") ? "\t" : " ".repeat(Math.max(2, kidW - base));
    let end = n;
    for (let i = n + 1; i < lines.length; i++) { if (!lines[i].trim()) continue; if (J.width(lines[i]) <= base) break; end = i; }
    const known = new Map();
    for (let i = n + 1; i <= end; i++) {
      if (J.width(lines[i]) !== kidW || !J.LIST_RE.test(lines[i])) continue;
      if (/^\s*[-*+]\s+(?:🔗|⏱|💬|🤖\s*(?:子代理|side chat))/.test(lines[i])) continue;
      const mark = J.kidUnder(lines, i);
      if (mark && mark.kind === "side") known.set(String(mark.id), { block: i, mark: mark.line, ...mark });
    }
    const open = (this.usage.sideChats.get(sid) || []).map((s) => String(s.pid));
    let changed = false;
    for (const s of this.usage.sideChats.get(sid) || []) {
      if (known.has(String(s.pid))) continue;
      const min = dayMinute(s.since || Date.now(), this.cfg);
      lines.splice(end + 1, 0,
        `${kidInd}- DOING ${J.clock(min)} ${J.AUTO_MARK}side chat`,
        `${kidInd}${unit}- 🔗 side chat \`pid ${s.pid}\``);
      changed = true;
      end += 2;
    }
    for (const c of known.values()) {
      if (open.includes(String(c.id))) continue;
      const cur = J.splitTask(lines[c.block]);
      const from = cur && cur.since ? cur.since : null;
      const nowMin = dayMinute(Date.now(), this.cfg);
      let mins = 1;
      if (from) {
        const [h, m] = from.split(":").map(Number);
        let start = h * 60 + m;
        if (start > nowMin) start -= 1440;
        mins = Math.max(1, nowMin - start);
      }
      lines[c.block] = `${cur ? cur.prefix : ""}DONE ${J.clock(nowMin)} ${cur ? cur.rest : "side chat"}`.trimEnd();
      lines[c.mark] = `${kidInd}${unit}- ⏱ ${from || J.clock(nowMin - mins)}–${J.clock(nowMin)} · 共 ${J.durTag(mins)} · side chat \`pid ${c.id}\``;
      changed = true;
    }
    return changed ? lines.join("\n") : text;
  }
}
