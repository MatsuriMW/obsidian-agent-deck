import { updateNote } from "./note-updates.js";
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
import { AGENTS, dayKey, dayKeyToday, dayMinute, fmtTok, fmtClock, journalPath, resolveRecordRules, trackedRounds, seenSessions, startOfDay } from "./constants.js";
import * as J from "./journal.js";
import { runJournalModel, safeLabel } from "./llm.js";
import { ensureTopRule } from "./organize-journal.js";

// Non-journal notes have no layout markers; ensureTopRule is journal-specific
// and may throw on a broken layout. Never let that abort the live sync loop.
function safeTopRule(text) {
  try { return ensureTopRule(text); } catch { return text; }
}
import { detailForRound } from "./log-detail.js";
import { condenseUserPrompt } from "./prompt-text.js";

const STATE_KW = J.STATE_KW;

export class JournalSync {
  constructor(plugin) {
    this.p = plugin;
    this._running = null;
    this._at = 0;
    this._refining = new Set();
    this._polishing = new WeakSet();
    this._merging = new Set();
    this._mergeAt = new Map();
  }

  get usage() { return this.p.usage; }
  get cfg() { return this.p.settings; }

  archived(sid) {
    if (this.cfg.autoLogArchiveDone === false) return false;
    if (typeof this.usage?.isArchived === "function") return this.usage.isArchived(sid);
    return Boolean(this.usage.archivedClaude?.has(sid) || this.usage.archived?.has(sid) || this.usage.meta?.get?.(sid)?.archived);
  }

  archivedDoneRec(sid) {
    if (!sid) return null;
    for (const d of Object.keys(this.cfg.autoLogState || {}).sort().reverse()) {
      const rec = this.cfg.autoLogState[d]?.[sid];
      if (rec?.archivedDone) return rec;
    }
    return null;
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

  sessionTimeSpan(sid, p, lines, ownerLine, kw, segs) {
    const meta = (sid && this.usage?.meta?.get(sid)) || {};
    return J.sessionRecordSpan({
      segs, meta, saved: p, clockSpan: J.clockSpanFromLines(lines, ownerLine),
      kw, idleMinutes: Math.max(5, this.cfg.autoLogIdle || 10),
    });
  }

  // 开着的笔记里所有带 🔗 或 ^ad- 块 ID 的编辑器
  openViews() {
    const out = [];
    this.p.app.workspace.iterateAllLeaves((leaf) => {
      const v = leaf.view;
      if (v instanceof MarkdownView && v.file && v.editor && v.editor.cm) {
        try {
          const doc = v.editor.cm.state.doc.toString();
          if (doc.includes("🔗") || (doc.includes("^") && J.taskItems(doc).some(task => J.isDeckBlockId(task.blockId)))) out.push(v);
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
    if (this._stopped) return;
    if (this._running) {
      if (!force) return;
      await this._running;
      return this.run({ force });
    }
    if (!force && Date.now() - this._at < 8000) return;
    this._at = Date.now();
    if (this.cfg.journalSync === false || this.cfg.journalAutoWrite === false) return;
    this._running = this.syncNotes();
    try { return await this._running; }
    finally { this._running = null; }
  }

  async syncNotes() {
    let updated = false;
    let stateDirty = false;
    try {
      for (const view of this.openViews()) {
        const cm = view.editor.cm;
        if (!cm || !cm.dom.isConnected || cm.composing) continue;
        const text = cm.state.doc.toString();
        const taskIds = this.cfg.resultBack !== false ? await this.prepareTaskIds(text) : new Map();
        if (this.cfg.journalAutoWrite === false || this._stopped) return;
        let next = text;
        this._reopenedInPass = false;
        if (this.cfg.resultBack !== false) next = this.results(next, taskIds);
        if (this.cfg.agentKw !== false) next = this.keywords(next);
        if (this._reopenedInPass) stateDirty = true;
        if (this._reopenedInPass && this.cfg.resultBack !== false) next = this.results(next, taskIds);
        if (this.cfg.kidBlocks !== false) { next = this.spawnAll(next); next = this.subsIntoAll(next); next = this.sides(next); }
        next = J.clocksLast(next);   // ⏱ 永远排在 ❓ / 💬 之后
        next = safeTopRule(J.cleanCompletedIdentifiers(next));
        if (next !== text && this.replace(view, text, next)) updated = true;
      }
      const file = this.todayJournal();
      if (file && !this.isOpen(file)) {
        // 今天的日记没开着也要跟上：客户端里归档了，这边照样记 DONE
        const taskIds = this.p.taskBlockId && this.cfg.resultBack !== false
          ? await this.prepareTaskIds(await this.p.readNote(file.path)) : new Map();
        await updateNote(this.p, file.path, text => {
          if (this.cfg.journalAutoWrite === false || this._stopped) return text;
          let next = text;
          this._reopenedInPass = false;
          if (this.cfg.resultBack !== false) next = this.results(next, taskIds);
          if (this.cfg.agentKw !== false) next = this.keywords(next);
          if (this._reopenedInPass) stateDirty = true;
          if (this._reopenedInPass && this.cfg.resultBack !== false) next = this.results(next, taskIds);
          next = this.spawnAll(next);
          next = this.sides(next);
          next = J.clocksLast(next);   // ⏱ 永远排在 ❓ / 💬 之后
          next = safeTopRule(J.cleanCompletedIdentifiers(next));
          if (next !== text) updated = true;
          return next;
        });
      }
      if (stateDirty) this.p.saveSettings?.().catch?.(() => {});
    } catch (e) {
      console.error("[agent-deck] 会话回写日记失败", e);
      return { updated, error: String(e?.message || e) };
    }
    return { updated };
  }

  // 新轮次可先在后台润色后落笔；不回头替换已经保存的历史记录。
  queueRefineTurn(sid, roundObj, rawSaid) {
    if (this.cfg.roundPolish === false || detailForRound(this.cfg.autoLogDetail, this.cfg.autoLogDetailHistory, roundObj || {}) === "detailed") return;
    if (!roundObj || roundObj.summary || roundObj._asked || !rawSaid || rawSaid.length < 40) return;
    const key = `${sid}:${roundObj.n || 1}:${rawSaid.length}`;
    if (this._refining.has(key)) return;
    roundObj._asked = true;
    this._polishing.add(roundObj);
    this._refining.add(key);
    const brief = detailForRound(this.cfg.autoLogDetail, this.cfg.autoLogDetailHistory, roundObj) === "brief";
    const cleanAsk = condenseUserPrompt(roundObj.ask || this.usage.meta.get(sid)?.title || "");
    const prompt = [
      brief ? '把本轮任务和回复分别浓缩成高信息密度的关键词或短语，只输出 JSON：{"task":"任务要点，最多 30 字","result":"结论要点","kind":"code|qa"}。'
        + 'kind：这一轮在改代码、跑命令、动文件就填 code，result 最多 40 字，写做了什么、现在什么状态（通过 / 待验证 / 失败）；这一轮在解释概念、回答知识问题就填 qa，result 最多 140 字，先给判断再给依据，可以两句。'
        + 'result 写这一轮最后的落点，不要摘回复开头的过渡铺垫或复述计划。自动过滤用户话语中的口语废话、语气词与寒暄，保留具体动作、对象和失败/待验证等状态，不编造事实，不要代码块。'
        : '把下面 AI 助手这一轮的回复提炼成结论，只输出 JSON：{"result":"结论","kind":"code|qa"}。kind：改代码 / 跑命令 / 动文件填 code，result 一句话不超过 40 字，写做了什么和现在的状态；解释概念、回答知识问题填 qa，不超过 140 字，取这一轮最后的落点，不要摘开头那句过渡话，不要口语废话、不要前缀、不要引号、不要代码块。',
      brief ? `任务：${String(cleanAsk).slice(-600)}` : "",
      "",
      String(rawSaid).slice(-900),
    ].join("\n");
    runJournalModel(prompt, this.cfg, { polish: true, automatic: true })
      .then((res) => {
        let data = null;
        try { data = JSON.parse(String(res || "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim()); } catch { /* older plain-text answer */ }
        if (data && (data.kind === "qa" || data.kind === "code")) roundObj.kind = data.kind;
        if (brief) {
          // 模型偶尔会把 kind 写进 result（例如 "result":"qa"），太短的当没给，回落到本地规则。
          const taskText = String(data?.task || "").trim();
          const resultText = String(data?.result || "").trim();
          if (taskText) roundObj.taskSummary = taskText;
          if ([...resultText].length >= 4 && !/^(?:code|qa|json)$/i.test(resultText)) roundObj.summary = resultText;
          return;
        }
        const text = data && typeof data.result === "string" ? data.result : "";
        const clean = text.trim() ? J.oneSentenceConclusion(safeLabel(text.trim(), 65) || text, data?.kind === "qa" ? 120 : 80) : "";
        if (clean && clean.length >= 4) roundObj.summary = clean;
      })
      .catch(() => {})
      .finally(() => { this._polishing.delete(roundObj); this._refining.delete(key); this.run({ force: true }).catch(() => {}); });
  }

  async queueMerge(sid, rounds, day = dayKeyToday(this.cfg)) {
    if (!this.cfg.autoLogMerge || this.cfg.journalAutoWrite === false || this._stopped) return;
    const key = `${day}:${sid}`;
    if (this._merging.has(key) || Date.now() - (this._mergeAt.get(key) || 0) < 60000) return;
    const previous = this.cfg.autoLogSummaries?.[day]?.[sid];
    const pending = rounds.filter((r) => r.n > (previous?.through || 0) && (r.summary || r.said) && (!r.doneAt || dayKey(r.doneAt, this.cfg) === day));
    if (pending.length < Math.max(2, Number(this.cfg.autoLogMergeThreshold) || 10)) return;
    this._merging.add(key); this._mergeAt.set(key, Date.now());
    try {
      const prompt = ["把同一任务以下工作记录合并成 1 到 2 句完整的中文句子，写进日记直接当结论用。"
        + "每句都要有主语和谓语，读起来是一句完整的话；不要「已完成」「搞定了」这种没有主语的碎片。"
        + "先说做成了什么、结果如何，再说还差什么没解决；不要逐轮复述用户的要求，也不要把没做完的说成做完了。"
        + "不要前缀、不要引号、不要代码块，总长不超过 120 字。只输出总结本身。",
        previous?.text ? `此前总结：${previous.text}` : "",
        ...pending.map((r) => `第 ${r.n} 轮：${String(r.summary || r.said).slice(-600)}`)].filter(Boolean).join("\n");
      const raw = await runJournalModel(prompt, this.cfg, { automatic: true });
      // resultText cuts on a sentence boundary instead of mid-word.
      const text = J.summaryText(raw, 200);
      if (!text || !this.cfg.autoLogMerge || this.cfg.journalAutoWrite === false || this._stopped) return;
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
  async prepareTaskIds(text) {
    const ids = new Map();
    if (!this.p.taskBlockId) return ids;
    for (const raw of text.split("\n")) {
      const link = J.parseLink(raw);
      if (!link || ids.has(link.sid)) continue;
      const task = J.findTask(text, "", "", link.sid);
      if (!task || task.blockId || task.state === "done") continue;
      ids.set(link.sid, await this.p.taskBlockId(link.sid, link.agent, task.body.replace(/^🤖\s*/, "")));
    }
    return ids;
  }

  results(text, taskIds = new Map()) {
    const targets = new Map(); // sid -> { blockId, key }
    for (const line of text.split("\n")) {
      const k = J.parseLink(line);
      if (k && !targets.has(k.sid)) targets.set(k.sid, { blockId: "", key: "" });
    }
    const daySt = (this.cfg.autoLogState && this.cfg.autoLogState[dayKeyToday(this.cfg)]) || {};
    for (const [sid, rec] of Object.entries(daySt)) {
      if (!rec || rec.skip || rec.gone || this.usage?.isSubagentSession?.(sid)) continue;
      const selfAgent = rec.agent || this.usage?.meta?.get?.(sid)?.agent || "";
      if (this.usage?.delegatedOwnerOf?.(sid, selfAgent) || (selfAgent && selfAgent !== "t3code" && this.usage?.t3OwnerOf?.(sid))) continue;
      if ((rec.blockId && text.includes(`^${rec.blockId}`)) || (rec.key && J.findTask(text, rec.key, rec.blockId, sid))) {
        if (!targets.has(sid)) targets.set(sid, { blockId: rec.blockId || "", key: rec.key || "" });
      }
    }
    const backgroundJobs = new Map(Object.values(this.p.jobs || {}).filter(job => job.destination === "background").map(job => [job.sessionId, job]));
    // 「见过的会话」与当天起点每次回写只算一遍，别放进逐会话循环
    const seen = seenSessions(this.cfg);
    const todayStart = startOfDay(Date.now(), this.cfg);
    let out = text;
    for (const [sid, info] of targets) {
      const m = this.usage.meta.get(sid);
      if (!m) continue;
      const background = backgroundJobs.get(sid);
      if (background) {
        // A live scan may contain partial output. Let the owning runner finish first.
        if (["starting", "running", "needs-approval"].includes(background.state)) continue;
        const rounds = m.rounds || [];
        const completed = ["wait", "quiet"].includes(m.state) || this.archived(sid) ? rounds : rounds.slice(0, -1);
        if (completed.length) this.p.delegator?.writeResult(background, { rounds: completed })
          .catch(error => console.info("[agent-deck] background result pending", error.message));
        continue;
      }
      const waiting = m.state === "wait" || m.state === "quiet";
      const isDone = this.archived(sid);
      if (this.cfg.autoLogGranularity === "paused" && !isDone && daySt[sid]?.status !== "paused") continue;
      const allRounds = Array.isArray(m.rounds) ? m.rounds : [];
      const first = seen[sid] == null;
      // 第一次接入只补最近几轮；之后只补当天产生的轮次，之前的历史不再重复写进来
      const rounds = trackedRounds(allRounds, { first, since: todayStart, max: this.cfg.autoLogFirstRounds });
      if (first) seen[sid] = Date.now();
      if (allRounds.length && !rounds.length) continue;
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
      const completed = ((waiting || isDone) ? rounds : rounds.slice(0, -1)).filter(r => !this._polishing.has(r));
      if (rounds.at(-1) && this._polishing.has(rounds.at(-1))) summary = "";
      const taskTodo = m.agent === "claude" && (waiting || isDone) && completed.at(-1) === rounds.at(-1) ? (m.todo || null) : null;
      if (!summary && !taskTodo && !completed.length) continue;
      this.queueMerge(sid, completed);
      const synced = J.syncSessionEntry(out, {
        granularity: this.cfg.autoLogGranularity,
        compact: this.cfg.autoLogSummaries?.[dayKeyToday(this.cfg)]?.[sid],
        detail: this.cfg.autoLogDetail,
        detailHistory: this.cfg.autoLogDetailHistory,
        sid, agent: m.agent,
        blockId: info.blockId || taskIds.get(sid) || (daySt[sid] && daySt[sid].blockId) || "",
        key: info.key || (daySt[sid] && daySt[sid].key) || "",
        said: summary,
        rounds: completed,
        taskTodo,
        codeMax: Number(this.cfg.conclusionMaxCode) || 65,
        qaMax: Number(this.cfg.conclusionMaxQA) || 160,
        ensureId: true,
      });
      out = synced.text;
      if (synced.blockId && daySt[sid]) daySt[sid].blockId = synced.blockId;
    }
    return out;
  }

  // 关键词跟着会话走：只在 DOING 和中间态之间切，你改成别的就不碰
  keywords(text) {
    // Split once: this used to split the whole note for every line, so a long
    // journal was quadratic in characters. The pass still runs bottom-up so the
    // line numbers above stay valid when a row is rewritten.
    let ls = text.split("\n");
    const owner = J.ownersOf(ls);
    const activeJobStates = new Set(["starting", "running", "needs-approval", "bound"]);
    const jobBySid = new Map();
    for (const j of Object.values(this.p?.jobs || {})) {
      if (!j?.sessionId) continue;
      const prev = jobBySid.get(j.sessionId);
      const isAct = activeJobStates.has(j.state);
      const prevAct = prev ? activeJobStates.has(prev.state) : false;
      if (!prev || (isAct && !prevAct) || (isAct === prevAct && (j.startedAt || 0) > (prev.startedAt || 0))) {
        jobBySid.set(j.sessionId, j);
      }
    }
    const linksByOwner = new Map();
    for (let i = 0; i < ls.length; i++) {
      const link = J.parseLink(ls[i]);
      if (!link || owner[i] < 0) continue;
      const list = linksByOwner.get(owner[i]) || [];
      list.push({ line: i, sid: link.sid });
      linksByOwner.set(owner[i], list);
    }
    const primaryLinkByOwner = new Map();
    for (const [ownerIdx, list] of linksByOwner.entries()) {
      if (list.length <= 1) {
        if (list[0]) primaryLinkByOwner.set(ownerIdx, list[0].line);
        continue;
      }
      let best = list[0];
      let bestScore = [-1, -1];
      for (const entry of list) {
        const j = jobBySid.get(entry.sid);
        const m = this.usage.meta.get(entry.sid);
        const isArch = this.archived(entry.sid);
        const tier = j && activeJobStates.has(j.state)
          ? 3
          : (!isArch && m?.state === "run" ? 2 : (!isArch && m ? 1 : 0));
        const ts = Math.max(m?.lastAt || 0, j?.startedAt || 0);
        if (tier > bestScore[0] || (tier === bestScore[0] && ts > bestScore[1])) {
          best = entry;
          bestScore = [tier, ts];
        }
      }
      primaryLinkByOwner.set(ownerIdx, best.line);
    }
    let segsBySid;
    const spanFor = (sid, p, lines, n, kw) => {
      segsBySid ||= new Map(this.dayList().map(row => [row.sid, row.segs]));
      return this.sessionTimeSpan(sid, p, lines, n, kw, segsBySid.get(sid));
    };
    for (let at = ls.length - 1; at >= 0; at--) {
      const k = J.parseLink(ls[at]);
      if (!k) continue;
      const n = owner[at];
      if (n < 0) continue;
      if (primaryLinkByOwner.has(n) && primaryLinkByOwner.get(n) !== at) continue;
      const cur = J.kwLine(ls[n]);
      if (!cur || J.isManualTask(this.cfg, ls[n])) continue;
      if (this.archived(k.sid)) {
        const sessions = [];
        let latestSid = k.sid, latestAt = at, bestTime = this.usage.meta.get(k.sid)?.lastAt || 0;
        for (let i = 0; i < ls.length; i++) {
          if (owner[i] !== n) continue;
          const link = J.parseLink(ls[i]);
          if (!link) continue;
          sessions.push(link.sid);
          const t = this.usage.meta.get(link.sid)?.lastAt || 0;
          if (t > bestTime) { bestTime = t; latestSid = link.sid; latestAt = i; }
        }
        if (!J.DONE_KWS.includes(cur.kw) && sessions.every(sid => this.archived(sid))) ls = this.finish(ls.join("\n"), latestSid, latestAt, sessions).split("\n");
        continue;
      }
      const archRec = cur.kw === "DONE" ? this.archivedDoneRec(k.sid) : null;
      const canReopen = Boolean(archRec && !(archRec.blockId && this.cfg.manualTaskStates?.[archRec.blockId]));
      if (!(cur.kw === "DOING" || cur.kw === "DELEGATED" || J.AGENT_KW_RE.test(cur.kw) || !cur.kw || canReopen)) continue;
      const m = this.usage.meta.get(k.sid);
      const want = canReopen
        ? (m ? (m.state === "run" ? "DOING" : (STATE_KW[m.state] || "PAUSED")) : "PAUSED")
        : (m ? (m.state === "run" ? (cur.kw === "DELEGATED" ? "DELEGATED" : "DOING") : STATE_KW[m.state]) : null);
      const p = J.splitTask(ls[n]);
      if (!p) continue;
      if (!want && !p.auto) continue;
      const kw = want || cur.kw || "DOING";
      const span = spanFor(k.sid, p, ls, n, kw);
      const showTimeRange = resolveRecordRules(this.cfg).showTimeRange;
      let nextLine = J.formatSessionTaskLine(p, { ...span, kw, showTimeRange });
      if (canReopen) {
        const restored = J.ensureBlockId(nextLine, archRec.blockId || J.makeBlockId(k.sid, m?.agent || k.agent));
        nextLine = restored.line;
        archRec.blockId = restored.blockId;
        delete archRec.archivedDone;
        delete archRec.doneEndMs;
        delete archRec.doneRounds;
        archRec.status = kw === "DOING" ? "doing" : "paused";
        this._reopenedInPass = true;
      }
      if (nextLine !== ls[n]) ls[n] = nextLine;
      if (!showTimeRange && !J.DONE_KWS.includes(kw)) {
        const info = this.segmentsFor(k.sid);
        if (info?.segs?.length) {
          const who = AGENTS[info.agent]?.short || info.agent;
          J.upsertClockLine(ls, n, info.segs, who, (info.out || 0) + (info.fresh || 0));
        }
      }
    }
    let out = ls.join("\n");
    if (this.cfg.autoLogKw !== false) out = this.autoKeywords(out, spanFor);
    return J.cleanCompletedIdentifiers(out);
  }

  // 自动记日记建的条目没有 🔗 行，靠 ^blockId / 名字认：也跟着会话在 DOING 和中间态之间切。
  // 只动 DOING 和 TOREVIEW 这类中间态；PAUSED / DONE 归 AutoLog 管，你改成别的不碰；归档的交给 AutoLog 记 DONE。
  // 同一行挂了几个会话：有一个在跑就是 DOING，否则取第一个停下来的状态
  autoKeywords(text, spanFor) {
    const daySt = (this.cfg.autoLogState || {})[dayKeyToday(this.cfg)] || {};
    const linked = J.linkMap(text);
    const want = new Map();   // 行号 → { kw, sid }
    for (const [sid, rec] of Object.entries(daySt)) {
      if (!rec || rec.skip || rec.gone || !rec.key || linked.has(sid) || this.archived(sid) || this.usage?.isSubagentSession?.(sid)) continue;
      const m = this.usage.meta.get(sid);
      if (!m) continue;
      if (this.usage?.delegatedOwnerOf?.(sid, m.agent) || (m.agent && m.agent !== "t3code" && this.usage?.t3OwnerOf?.(sid))) continue;
      const found = J.findTask(text, rec.key, rec.blockId || "", sid);
      if (found && J.isManualTask(this.cfg, text.split("\n")[found.line])) continue;
      const canReopen = Boolean(found && found.kw === "DONE" && rec.archivedDone && !(rec.blockId && this.cfg.manualTaskStates?.[rec.blockId]));
      if (!found || !(found.kw === "DOING" || (J.AGENT_KW_RE.test(found.kw) && found.kw !== "DELEGATED") || canReopen)) continue;
      const kw = m.state === "run" ? "DOING" : (STATE_KW[m.state] || (canReopen ? "PAUSED" : ""));
      if (!kw) continue;
      if (kw === "DOING" || !want.has(found.line)) want.set(found.line, { kw, sid, canReopen, rec, agent: m.agent });
    }
    if (!want.size) return text;
    const ls = text.split("\n");
    const showTimeRange = resolveRecordRules(this.cfg).showTimeRange;
    let changed = false;
    for (const [n, { kw, sid, canReopen, rec, agent }] of [...want.entries()].sort((a, b) => b[0] - a[0])) {
      const p = J.splitTask(ls[n]);
      if (!p || p.cb || !p.kw) continue;
      const span = spanFor(sid, p, ls, n, kw);
      let nextLine = J.formatSessionTaskLine(p, { ...span, kw, showTimeRange });
      if (canReopen) {
        const restored = J.ensureBlockId(nextLine, rec.blockId || J.makeBlockId(sid, agent));
        nextLine = restored.line;
        rec.blockId = restored.blockId;
        delete rec.archivedDone;
        delete rec.doneEndMs;
        delete rec.doneRounds;
        rec.status = kw === "DOING" ? "doing" : "paused";
        this._reopenedInPass = true;
      }
      if (nextLine !== ls[n]) {
        ls[n] = nextLine;
        changed = true;
      }
      if (!showTimeRange && !J.DONE_KWS.includes(kw)) {
        const info = this.segmentsFor(sid);
        if (info?.segs?.length) {
          const who = AGENTS[info.agent]?.short || info.agent;
          if (J.upsertClockLine(ls, n, info.segs, who, (info.out || 0) + (info.fresh || 0))) changed = true;
        }
      }
    }
    return changed ? ls.join("\n") : text;
  }

  // 归档 = 做完：DONE + 实际时段，收掉 🔗 行
  finish(text, sid, linkAt, allSids = null) {
    const lines = text.split("\n");
    const at = typeof linkAt === "number" ? linkAt : lines.findIndex((l) => { const k = J.parseLink(l); return k && k.sid === sid; });
    if (at < 0) return text;
    const n = J.markOwner(lines, at);
    if (n < 0) return text;
    const p = J.splitTask(lines[n]);
    if (!p || J.isManualTask(this.cfg, lines[n])) return text;
    const info = this.segmentsFor(sid);
    const span = this.sessionTimeSpan(sid, p, lines, n, "DONE", info?.segs);
    const showTimeRange = resolveRecordRules(this.cfg).showTimeRange;
    if ((p.auto && !p.cb) || p.until) {
      lines[n] = J.formatSessionTaskLine(p, { ...span, kw: "DONE", showTimeRange });
    } else {
      lines[n] = showTimeRange === false
        ? `${p.prefix}DONE ${p.rest}`.trimEnd()
        : `${p.prefix}DONE ${span.end ? span.end + " " : ""}${p.rest}`.trimEnd();
    }
    if (info && info.segs.length) {
      // 先收掉旧的 ⏱
      const base = J.width(lines[n]);
      for (let i = n + 1; i < lines.length; i++) {
        if (lines[i].trim() && J.width(lines[i]) <= base) break;
        if (J.CLOCK_RE.test(lines[i]) && J.markOwner(lines, i) === n && J.mutableClock(lines, i)) { lines.splice(i, 1); break; }
      }
      const who = AGENTS[info.agent]?.short || info.agent;
      lines.splice(n + 1, 0, J.clockLine((/^\s*/.exec(lines[n]) || [""])[0] + "\t", info.segs, who, (info.out || 0) + (info.fresh || 0)));
    }
    // Keep the session link usable after removing the finished task's IDs.
    const targetSids = Array.isArray(allSids) && allSids.length ? allSids : [sid];
    for (const targetSid of new Set(targetSids.filter(Boolean))) {
      const meta = this.usage?.meta?.get?.(targetSid);
      this.p.markBound?.(targetSid, p.blockId || "", J.workKey(p.body || ""), {
        archivedDone: true,
        status: "done",
        doneEndMs: meta?.lastAt || Date.now(),
        doneRounds: Array.isArray(meta?.rounds) ? meta.rounds.length : 0,
      });
    }
    return J.cleanCompletedIdentifiers(lines.join("\n"));
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
      for (let i = n + 1; i <= end; i++) if (J.width(lines[i]) === kidW && J.LIST_RE.test(lines[i]) && !/^\s*[-*+]\s+(?:🔗|⏱|💬|(?:第\d+轮|Round\s+\d+)[：:]|🤖\s*(?:子代理|side chat))/.test(lines[i])) kids.push(i);
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
        J.formatAutoTaskLine({
          prefix: `${kidInd}- `,
          kw: "DOING",
          start: fmtClock(d.created),
          end: fmtClock(d.active || d.created),
          title: J.summarizeAutoTitle(name),
          boldTitle: false,
        }),
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
    if (r.state === "fail" || r.state === "error") return { st: "fail", kw: r.state === "error" || r.end === "failed" ? "FAILED" : "CANCELLED" };
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
    if (said) out.push(`${indent}- 💬 ${J.summaryText(said, this.cfg.resultMax || 200)}`);
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
        if (/^\s*[-*+]\s+(?:🔗|⏱|💬|(?:第\d+轮|Round\s+\d+)[：:]|🤖\s*(?:子代理|side chat))/.test(lines[i])) continue;
        kids.push(i);
      }
      const known = new Map(), claimed = new Set();
      for (const k of kids) {
        const mark = J.childMark(lines, k, (l) => { const id = J.kidIdent(l); return id && id.kind === "sub" ? id : null; });
        if (mark) { known.set(String(mark.id), { block: k, mark: mark.line, open: !!mark.open }); claimed.add(k); }
      }
      const setKw = (k, kw, time, startTime = "") => {
        const pt = J.splitTask(lines[k]);
        if (!pt) return;
        lines[k] = pt.auto
          ? J.formatAutoTaskLine({ prefix: pt.prefix, kw, start: startTime || pt.since || time, end: time || pt.until || pt.since, title: pt.title, preserveTitle: true, blockId: pt.blockId })
          : `${pt.prefix}${kw} ${time} ${pt.rest}`.trimEnd();
      };
      for (const r of subs) {
        const id = r.id.slice(0, 8), k = this.kidState(r, parentWait), over = k.st === "done" || k.st === "fail";
        const had = known.get(id);
        if (had) {
          if (!had.open) continue;
          if (over) {
            const ind = (/^\s*/.exec(lines[had.block]) || [""])[0];
            setKw(had.block, k.kw, fmtClock(r.at || r.start), fmtClock(r.start));
            const mark = J.parseKid(lines[had.mark]);
            if (mark) lines[had.mark] = `${ind}\t- ⏱ ${fmtClock(r.start)}–${fmtClock(r.at || r.start)} · 共 ${J.durTag(Math.max(1, Math.round(((r.at || r.start) - r.start) / 60e3)))}${this.kidTok(r) ? ` · ${fmtTok(this.kidTok(r))} tok` : ""} · 子代理 \`${id}\``;
            const said = String(r.last || "").trim();
            if (said) lines.splice(had.mark + 1, 0, `${ind}\t- 💬 ${J.summaryText(said, this.cfg.resultMax || 200)}`);
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
            setKw(mine, k.kw, fmtClock(r.at || r.start), fmtClock(r.start));
            lines.splice(mine + 1, 0, ...this.finishKid(ind, r));
          } else {
            const pt = J.splitTask(lines[mine]);
            setKw(mine, "DOING", pt && pt.kw === "DOING" && pt.since ? pt.since : fmtClock(r.start), fmtClock(r.start));
            lines.splice(mine + 1, 0, `${ind}\t- 🔗 子代理 \`${id}\``);
          }
          return true;
        }
        const name = J.summarizeAutoTitle(r.desc || r.type || "subagent");
        if (over) {
          lines.splice(end + 1, 0, J.formatAutoTaskLine({ prefix: `${kidInd}- `, kw: k.kw, start: fmtClock(r.start), end: fmtClock(r.at || r.start), title: name, boldTitle: false }), ...this.finishKid(kidInd + unit, r));
        } else {
          lines.splice(end + 1, 0, J.formatAutoTaskLine({ prefix: `${kidInd}- `, kw: "DOING", start: fmtClock(r.start), end: fmtClock(r.at || r.start), title: name, boldTitle: false }), `${kidInd}${unit}- 🔗 子代理 \`${id}\``);
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
      if (/^\s*[-*+]\s+(?:🔗|⏱|💬|(?:第\d+轮|Round\s+\d+)[：:]|🤖\s*(?:子代理|side chat))/.test(lines[i])) continue;
      const mark = J.kidUnder(lines, i);
      if (mark && mark.kind === "side") known.set(String(mark.id), { block: i, mark: mark.line, ...mark });
    }
    const open = (this.usage.sideChats.get(sid) || []).map((s) => String(s.pid));
    let changed = false;
    for (const s of this.usage.sideChats.get(sid) || []) {
      if (known.has(String(s.pid))) continue;
      const min = dayMinute(s.since || Date.now(), this.cfg);
      lines.splice(end + 1, 0,
        J.formatAutoTaskLine({ prefix: `${kidInd}- `, kw: "DOING", start: J.clock(min), end: J.clock(min), title: "side chat", boldTitle: false }),
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
      const startStr = from || J.clock(nowMin - mins);
      const endStr = J.clock(nowMin);
      lines[c.block] = cur && cur.auto
        ? J.formatAutoTaskLine({ prefix: cur.prefix, kw: "DONE", start: startStr, end: endStr, title: cur.title, preserveTitle: true, blockId: cur.blockId })
        : `${cur ? cur.prefix : ""}DONE ${endStr} ${cur ? cur.rest : "side chat"}`.trimEnd();
      lines[c.mark] = `${kidInd}${unit}- ⏱ ${startStr}–${endStr} · 共 ${J.durTag(mins)} · side chat \`pid ${c.id}\``;
      changed = true;
    }
    return changed ? lines.join("\n") : text;
  }
}
