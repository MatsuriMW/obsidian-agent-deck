// Agent Deck — 会话回写日记.
//
// 日记里用 🔗 绑着的会话，这一块负责把会话的变化写回任务行：
//   · 答完一轮 / 归档了 → 任务下面一行 💬（会话最后说的话）
//   · 还在跑 → DOING；停下来等你 → TOREVIEW；等你允许 → NEEDOK；出错 → ERRORED；限额 → HITLIMIT
//   · 桌面版里归档 → DONE + ⏱（和自动记日记同一套写法，收掉 🔗 行）
//   · 会话在桌面版里开出来的子会话 → 缩进写成子块，各带自己的 🔗
//   · 开着的 side chat → 一个子块；进程没了 → DONE + ⏱
//
// 只动开着的笔记；今天的日记没开着的话直接改文件。改动按行做，
// 不进撤销记录；正在用输入法打字的那一下不写，等下一轮。

import { MarkdownView } from "obsidian";
import { AGENTS, dayKey, dayKeyToday, dayMinute, fmtTok, fmtClock, journalPath } from "./constants.js";
import * as J from "./journal.js";
import { runJournalModel, safeLabel } from "./llm.js";

const STATE_KW = J.STATE_KW;

export class JournalSync {
  constructor(plugin) {
    this.p = plugin;
    this._busy = false;
    this._at = 0;
    this._refining = new Set();
    this._merging = new Set();
    this._mergeAt = new Map();
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

  // 开着的笔记里所有带 🔗 或 ^ad- 块 ID 的编辑器
  openViews() {
    const out = [];
    this.p.app.workspace.iterateAllLeaves((leaf) => {
      const v = leaf.view;
      if (v instanceof MarkdownView && v.file && v.editor && v.editor.cm) {
        try {
          const doc = v.editor.cm.state.doc.toString();
          if (doc.includes("🔗") || /\s\^ad-[0-9a-z]{6}/i.test(doc)) out.push(v);
        } catch { /* closed */ }
      }
    });
    return out;
  }

  isOpen(file) { return this.openViews().some((v) => v.file.path === file.path); }

  todayJournal() {
    const f = this.p.app.vault.getAbstractFileByPath(journalPath(this.p.app, this.cfg));
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
    if (this.cfg.journalSync === false || this.cfg.journalAutoWrite === false) return;
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
        if (this.cfg.journalAutoWrite === false || this._stopped) return;
        let next = text;
        if (this.cfg.resultBack !== false) next = this.results(next);
        if (this.cfg.agentKw !== false) next = this.keywords(next);
        if (this.cfg.kidBlocks !== false) { next = this.spawnAll(next); next = this.subsIntoAll(next); next = this.sides(next); }
        if (next !== text) this.replace(view, text, next);
      }
      const file = this.todayJournal();
      if (file && !this.isOpen(file)) {
        // 今天的日记没开着也要跟上：客户端里归档了，这边照样记 DONE
        const text = await this.p.app.vault.read(file);
        if (this.cfg.journalAutoWrite === false || this._stopped) return;
        let next = text;
        if (this.cfg.resultBack !== false) next = this.results(next);
        if (this.cfg.agentKw !== false) next = this.keywords(next);
        next = this.spawnAll(next);
        next = this.sides(next);
        if (next !== text) await this.p.app.vault.process(file, (cur) => (cur === text ? next : cur));
      }
    } catch (e) {
      console.error("[agent-deck] 会话回写日记失败", e);
    } finally { this._busy = false; }
  }

  // 后台调本机小模型把一轮回复润色成精炼的一句话结论（混合模式：先用本地规则写回，润色好后再替换）
  queueRefineTurn(sid, roundObj, rawSaid) {
    if (this.cfg.roundPolish === false) return;
    if (!roundObj || roundObj.summary || roundObj._asked || !rawSaid || rawSaid.length < 40) return;
    const key = `${sid}:${roundObj.n || 1}:${rawSaid.length}`;
    if (this._refining.has(key)) return;
    roundObj._asked = true;
    this._refining.add(key);
    const prompt = [
      "把下面 AI 助手这一轮的回复提炼成一句话结论（不超过 40 个字，直接写结论本身，不要前缀、不要引号、不要代码块）：",
      "",
      String(rawSaid).slice(-900),
    ].join("\n");
    runJournalModel(prompt, this.cfg, { polish: true })
      .then((res) => {
        const clean = J.oneSentenceConclusion(safeLabel(res, 65) || res, 80);
        if (clean && clean.length >= 4) {
          roundObj.summary = clean;
          this.run({ force: true }).catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => { this._refining.delete(key); });
  }

  async queueMerge(sid, rounds, day = dayKeyToday(this.cfg)) {
    if (!this.cfg.autoLogMerge || this.cfg.autoLogGranularity !== "round" || this.cfg.journalAutoWrite === false || this._stopped) return;
    const key = `${day}:${sid}`;
    if (this._merging.has(key) || Date.now() - (this._mergeAt.get(key) || 0) < 60000) return;
    const previous = this.cfg.autoLogSummaries?.[day]?.[sid];
    const pending = rounds.filter((r) => r.n > (previous?.through || 0) && (r.summary || r.said) && (!r.doneAt || dayKey(r.doneAt, this.cfg) === day));
    if (pending.length < Math.max(2, Number(this.cfg.autoLogMergeThreshold) || 10)) return;
    this._merging.add(key); this._mergeAt.set(key, Date.now());
    try {
      const prompt = ["把同一任务以下工作记录合并为一段中文总结，不超过 120 字。保留实际成果、决定和未解决事项，不逐轮复述用户要求，不把未完成事项说成已完成。只输出总结。",
        previous?.text ? `此前总结：${previous.text}` : "",
        ...pending.map((r) => `第 ${r.n} 轮：${String(r.summary || r.said).slice(-600)}`)].filter(Boolean).join("\n");
      const raw = await runJournalModel(prompt, this.cfg);
      const text = safeLabel(raw, 160);
      if (!text || !this.cfg.autoLogMerge || this.cfg.autoLogGranularity !== "round" || this.cfg.journalAutoWrite === false || this._stopped) return;
      const through = Math.max(...pending.map((r) => r.n));
      const bucket = ((this.cfg.autoLogSummaries ||= {})[day] ||= {});
      if ((bucket[sid]?.through || 0) >= through) return;
      bucket[sid] = { through, text };
      await this.p.saveSettings();
      await this.run({ force: true });
    } catch (e) { console.info("[agent-deck] 累积总结暂未生成，原记录保留：", e.message || e); }
    finally { this._merging.delete(key); }
  }

  // 答完一轮或者归档了：把每轮的一句话结论 💬、多轮追问 ❓ 以及 TaskCreate 步骤 📋 写回同一个 ^xxxxx 任务条目下
  results(text) {
    const targets = new Map(); // sid -> { blockId, key }
    for (const line of text.split("\n")) {
      const k = J.parseLink(line);
      if (k && !targets.has(k.sid)) targets.set(k.sid, { blockId: "", key: "" });
    }
    const daySt = (this.cfg.autoLogState && this.cfg.autoLogState[dayKeyToday(this.cfg)]) || {};
    for (const [sid, rec] of Object.entries(daySt)) {
      if (!rec || rec.skip || rec.gone) continue;
      if ((rec.blockId && text.includes(`^${rec.blockId}`)) || (rec.key && J.findTask(text, rec.key, rec.blockId, sid))) {
        if (!targets.has(sid)) targets.set(sid, { blockId: rec.blockId || "", key: rec.key || "" });
      }
    }
    let out = text;
    for (const [sid, info] of targets) {
      const m = this.usage.meta.get(sid);
      if (!m) continue;
      const waiting = m.state === "wait" || m.state === "quiet";
      const isDone = this.archived(sid);
      if (this.cfg.autoLogGranularity === "paused" && !isDone && daySt[sid]?.status !== "paused") continue;
      const rounds = Array.isArray(m.rounds) ? m.rounds : [];
      const said = String(m.lastText || "").trim();
      let summary = "";
      if (waiting || isDone) {
        if (rounds.length) {
          const lastRound = rounds[rounds.length - 1];
          if (lastRound && (lastRound.said || said)) {
            this.queueRefineTurn(sid, lastRound, lastRound.said || said);
            summary = lastRound.summary || J.oneSentenceConclusion(lastRound.said || said, this.cfg.resultMax || 90);
          }
        } else if (said) {
          summary = J.oneSentenceConclusion(said, this.cfg.resultMax || 90);
        }
      }
      const taskTodo = m.agent === "claude" ? (m.todo || null) : null;
      if (!summary && !taskTodo && rounds.length <= 1) continue;
      const completed = (waiting || isDone) ? rounds : rounds.slice(0, -1);
      this.queueMerge(sid, completed);
      const synced = J.syncSessionEntry(out, {
        granularity: this.cfg.autoLogGranularity,
        compact: this.cfg.autoLogSummaries?.[dayKeyToday(this.cfg)]?.[sid],
        detail: this.cfg.autoLogDetail,
        sid,
        blockId: info.blockId || (daySt[sid] && daySt[sid].blockId) || "",
        key: info.key || (daySt[sid] && daySt[sid].key) || "",
        said: summary,
        rounds: (waiting || isDone) ? rounds : rounds.slice(0, -1),
        taskTodo,
        ensureId: true,
      });
      out = synced.text;
      if (synced.blockId && daySt[sid]) daySt[sid].blockId = synced.blockId;
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
      if (this.archived(k.sid)) {
        const sessions = ls.flatMap((l, i) => J.markOwner(ls, i) === n && J.parseLink(l) ? [J.parseLink(l).sid] : []);
        if (!J.DONE_KWS.includes(cur.kw) && sessions.every(sid => this.archived(sid))) out = this.finish(out, k.sid, at);
        continue;
      }
      if (!(cur.kw === "DOING" || cur.kw === "DELEGATED" || J.AGENT_KW_RE.test(cur.kw) || !cur.kw)) continue;
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
    if (this.cfg.autoLogKw !== false) out = this.autoKeywords(out);
    return out;
  }

  // 自动记日记建的条目没有 🔗 行，靠 ^blockId / 名字认：也跟着会话在 DOING 和中间态之间切。
  // 只动 DOING 和 TOREVIEW 这类中间态；PAUSED / DONE 归 AutoLog 管，你改成别的不碰；归档的交给 AutoLog 记 DONE。
  // 同一行挂了几个会话：有一个在跑就是 DOING，否则取第一个停下来的状态
  autoKeywords(text) {
    const daySt = (this.cfg.autoLogState || {})[dayKeyToday(this.cfg)] || {};
    const linked = J.linkMap(text);
    const want = new Map();   // 行号 → 关键词
    for (const [sid, rec] of Object.entries(daySt)) {
      if (!rec || rec.skip || rec.gone || !rec.key || linked.has(sid) || this.archived(sid)) continue;
      const m = this.usage.meta.get(sid);
      if (!m) continue;
      const found = J.findTask(text, rec.key, rec.blockId || "", sid);
      if (!found || !(found.kw === "DOING" || (J.AGENT_KW_RE.test(found.kw) && found.kw !== "DELEGATED"))) continue;
      const kw = m.state === "run" ? "DOING" : STATE_KW[m.state];
      if (!kw) continue;
      if (kw === "DOING" || !want.has(found.line)) want.set(found.line, kw);
    }
    if (!want.size) return text;
    const ls = text.split("\n");
    let changed = false;
    for (const [n, kw] of want) {
      const p = J.splitTask(ls[n]);
      if (!p || p.cb || !p.kw || p.kw === kw) continue;
      ls[n] = `${p.prefix}${kw} ${p.since ? p.since + " " : ""}${p.rest}`.trimEnd();
      changed = true;
    }
    return changed ? ls.join("\n") : text;
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
      const who = AGENTS[info.agent]?.short || info.agent;
      lines.splice(n + 1, 0, J.clockLine((/^\s*/.exec(lines[n]) || [""])[0] + "\t", info.segs, who, (info.out || 0) + (info.fresh || 0)));
    }
    // 收掉这一项的 🔗 行；记一笔「绑过」，自动记日记就不会在 🔗 没了之后再替它新写一行
    const link = J.linkUnder(lines, n);
    if (link && link.sid === sid) lines.splice(link.line, 1);
    this.p.markBound?.(sid);
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
        if (pt && !pt.cb && (J.OPEN_KWS.includes(pt.kw || "") || (!pt.kw && this.kidTodos(lines, mine)))) lines[mine] = `${pt.prefix}DOING ${fmtClock(d.created)} ${pt.rest}`.trimEnd();
        lines.splice(mine + 1, 0, J.linkLine(ind, "claude", name, d.sid));
        return true;
      }
      lines.splice(end + 1, 0,
        `${kidInd}- DOING ${fmtClock(d.created)} ${J.AUTO_MARK}${J.resultText(name, 60)}`,
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
    const out = [`${indent}- ⏱ ${fmtClock(r.start)}–${fmtClock(r.at || r.start)} · 共 ${J.durTag(min)}${tok ? ` · ${fmtTok(tok)} tok` : ""} · 子代理 \`${r.id.slice(0, 8)}\``];
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
            setKw(had.block, k.kw, fmtClock(r.at || r.start));
            const mark = J.parseKid(lines[had.mark]);
            if (mark) lines[had.mark] = `${ind}\t- ⏱ ${fmtClock(r.start)}–${fmtClock(r.at || r.start)} · 共 ${J.durTag(Math.max(1, Math.round(((r.at || r.start) - r.start) / 60e3)))}${this.kidTok(r) ? ` · ${fmtTok(this.kidTok(r))} tok` : ""} · 子代理 \`${id}\``;
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
            setKw(mine, k.kw, fmtClock(r.at || r.start));
            lines.splice(mine + 1, 0, ...this.finishKid(ind, r));
          } else {
            const pt = J.splitTask(lines[mine]);
            setKw(mine, "DOING", pt && pt.kw === "DOING" && pt.since ? pt.since : fmtClock(r.start));
            lines.splice(mine + 1, 0, `${ind}\t- 🔗 子代理 \`${id}\``);
          }
          return true;
        }
        const name = J.resultText(r.desc || r.type || "subagent", 60);
        if (over) {
          lines.splice(end + 1, 0, `${kidInd}- ${k.kw} ${fmtClock(r.at || r.start)} ${J.AUTO_MARK}${name}`, ...this.finishKid(kidInd + unit, r));
        } else {
          lines.splice(end + 1, 0, `${kidInd}- DOING ${fmtClock(r.start)} ${J.AUTO_MARK}${name}`, `${kidInd}${unit}- 🔗 子代理 \`${id}\``);
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
        let start = h * 60 + m - J.dayOffset();
        if (start < 0) start += 1440;
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
