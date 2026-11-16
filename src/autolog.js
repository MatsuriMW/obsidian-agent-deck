import { serializeNote } from "./note-updates.js";
// Agent Deck — 自动记日记（人机共写）.
//
// 你在日记里写任务，是预计；Agent 的会话日志是自己会写的实际记录。这一块把
// 实际记录写回今天的日记：新会话起个名字记成 DOING，停了一阵改成 PAUSED 并把
// 实际时段写在下面，桌面版里归档了记成 DONE。名字和「接在哪一行」由本机的
// claude 命令行看一眼，接不上就新写一行。机器只在 DOING / PAUSED 之间来回切，
// 不自己判断 DONE；DONE 只来自归档或你自己改。
//
// 状态记在 settings.autoLogState：{ 日记日: { 会话号: { key, label, status, … } } }。

import { Notice, MarkdownView } from "obsidian";
import { AGENTS, AGENT_ORDER, dayKey, dayKeyToday, dayMinute, startOfDay, unionSegs, journalPath, resolveRecordRules } from "./constants.js";
import * as J from "./journal.js";
import { sessionProjectName } from "./readers.js";
import { runJournalModel, safeLabel } from "./llm.js";
import { t } from "./i18n.js";
import { planJournal, renderJournal, ensureTopRule } from "./organize-journal.js";
import { readJournalLayout, configuredJournalLayout } from "./journal-layout.js";
import { condenseUserPrompt } from "./prompt-text.js";

const agentName = (id) => AGENTS[id]?.short || id;
const num = (v, d) => (Number.isFinite(Number(v)) && v !== "" && v != null ? Number(v) : d);
const BLOCKED_KW = {
  "needs-approval": "NEEDOK",
  error: "ERRORED",
  limit: "HITLIMIT",
  queued: "QUEUED",
};

export class AutoLog {
  constructor(plugin) {
    this.p = plugin;
    this._busy = false;
    this._born = Date.now();
    this._at = 0;            // 上一次整理的时刻；0 = 启动后还没整理过
    this._err = "";
  }

  get cfg() { return this.p.settings; }
  get usage() { return this.p.usage; }
  get minMinutes() { return Math.max(0, num(this.cfg.autoLogMinMinutes, 3)); }
  get batch() { return Math.max(1, Math.round(num(this.cfg.autoLogBatch, 8))); }
  agentOn(id) { return AGENT_ORDER.includes(id) && (this.cfg.autoLogAgents || {})[id] !== false; }
  grokDoneMinutes(idle = Math.max(5, this.cfg.autoLogIdle || 10)) {
    const raw = this.cfg.autoLogGrokBotDoneMinutes;
    const n = raw == null ? 120 : Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.max(idle, n) : 0;
  }
  rules() { return resolveRecordRules(this.cfg); }
  blockedKeyword(sid) {
    const meta = (sid && this.usage?.meta?.get(sid)) || {};
    const applied = this.p?.applyExternalState ? this.p.applyExternalState({ ...meta, sid }) : meta;
    return BLOCKED_KW[applied?.state || meta.state || ""] || "";
  }
  projectOf(x) {
    if (!this.rules().projectPrefix) return "";
    const cwd = x?.cwd || this.usage?.meta?.get(x?.sid)?.cwd || "";
    const proj = sessionProjectName(cwd);
    if (proj) return proj;
    if (x?.agent === "grokbot") {
      const meta = x?.sid ? this.usage?.meta?.get(x.sid) : null;
      return String(meta?.title || x?.title || "").trim();
    }
    return "";
  }

  dayKey() { return dayKeyToday(this.cfg); }
  nowMin() { return (Date.now() - startOfDay(Date.now(), this.cfg)) / 60000; }
  journalPath(day) { return journalPath(this.p.app, this.cfg, day); }

  journalFile(day) {
    const f = this.p.app.vault.getAbstractFileByPath(this.journalPath(day));
    return f && f.extension === "md" ? f : null;
  }

  viewFor(file) {
    let view = null;
    this.p.app.workspace.iterateAllLeaves((leaf) => {
      const v = leaf.view;
      if (!view && v instanceof MarkdownView && v.file && v.file.path === file.path && v.getMode && v.getMode() === "source") view = v;
    });
    return view;
  }

  async read(file) {
    const v = this.viewFor(file);
    return v ? v.editor.getValue() : this.p.app.vault.read(file);
  }

  // 只改前后不一样的那几行；这期间日记被改过就不写，返回 false
  async write(file, base, next, { cleanup = true } = {}) {
    if (cleanup) next = ensureTopRule(J.cleanCompletedIdentifiers(next));
    if (base === next) return true;
    const v = this.viewFor(file);
    if (v) {
      if (v.editor.cm?.composing || v.editor.getValue() !== base) return false;
      const change = J.diffLines(base, next);
      if (change) v.editor.transaction({ changes: [change] });
      return true;
    }
    let ok = false;
    await this.p.app.vault.process(file, (cur) => { ok = cur === base; return ok ? next : cur; });
    return ok;
  }

  // 新写一块：AI 区域在的时候一定写进区域里；还没有区域才交给「任务归位」按它的分区放
  placeBlock(text, blockLines) {
    const block = blockLines.join("\n");
    let custom = readJournalLayout(text);
    if (!custom) {
      text = renderJournal(planJournal(text, { layout: configuredJournalLayout(this.cfg) }));
      custom = readJournalLayout(text);
      if (!custom) throw new Error(t("请先关闭笔记中的代码块，再建立日志分区"));
    }
    const crlf = /\r\n/.test(text);
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    lines.splice(custom.sections.active.end, 0, block);
    const next = lines.join("\n");
    return crlf ? next.replace(/\n/g, "\r\n") : next;
  }

  state(day) {
    const all = (this.cfg.autoLogState ||= {});
    return (all[day] ||= {});
  }

  archived() {
    const out = new Set();
    if (this.cfg.autoLogArchiveDone === false) return out;
    for (const sid of this.usage.archivedClaude || []) out.add(sid);
    for (const sid of this.usage.archived || []) out.add(sid);
    return out;
  }

  allArchived(st, sid, rec, arch) {
    return arch.has(sid) && (!rec.blockId || Object.entries(st).every(([other, item]) => item.skip || item.gone || item.blockId !== rec.blockId || arch.has(other)));
  }

  autoParked(rec, cur) { return cur === "paused" && !!rec && !!rec.autoPaused; }

  hasChildren(text, line) {
    const lines = text.split("\n");
    const base = J.width(lines[line]);
    for (let i = line + 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      return J.width(lines[i]) > base;
    }
    return false;
  }

  // 这一行现在改写成什么状态（通过 ^blockId + sid + key 追踪，保留/补齐 ^xxxxx 块 ID）
  autoLine(text, rec, x, status) {
    const sid = (x && x.sid) || "";
    const found = J.findTask(text, rec.key, rec.blockId || "", sid);
    if (found && J.isManualTask(this.cfg, text.split("\n")[found.line])) return { text };
    const segs = (x && x.segs) || [];
    const first = segs.length ? segs[0][0] : null;
    const last = segs.length ? segs[segs.length - 1][1] : first;
    const meta = (sid && this.usage?.meta?.get(sid)) || {};
    const roundDoneAt = Array.isArray(meta.rounds) ? meta.rounds.reduce((best, r) => Math.max(best, r?.doneAt || 0), 0) : 0;
    const endMs = meta.lastAt || roundDoneAt || 0;
    const metaEndClock = endMs ? J.clock(dayMinute(endMs, this.cfg)) : "";
    const metaStartClock = !first && meta.startedAt ? J.clock(dayMinute(meta.startedAt, this.cfg)) : "";
    const preferId = (found && found.blockId) || rec.blockId || J.makeBlockId(sid || rec.key, x?.agent || rec.agent, rec.slug);
    const kw = status === "doing" ? "DOING" : status === "done" ? "DONE" : status === "paused" ? "PAUSED" : J.AGENT_KWS.includes(status) ? status : "PAUSED";
    const startClock = first != null ? J.clock(first) : metaStartClock;
    const endClock = (status === "done" && metaEndClock) ? metaEndClock : (last != null ? J.clock(last) : (metaEndClock || startClock));
    if (!found) {
      if (!rec.fresh) return { text, gone: true };
      const isAuto = rec.created !== false || String(rec.label || "").startsWith("🤖");
      const rules = this.rules();
      const rawLine = isAuto
        ? J.formatAutoTaskLine({
            prefix: "- ",
            kw,
            start: startClock || J.clock(0),
            end: endClock || startClock || J.clock(0),
            title: J.formatProjectAutoTitle(rec.label, rec.proj || this.projectOf(x), rules.titleMax),
            blockId: preferId,
            boldTitle: rules.boldTitle,
            showTimeRange: rules.showTimeRange,
          })
        : status === "doing" ? `- DOING ${startClock || J.clock(0)} ${rec.label}`
        : status === "done" ? `- DONE ${endClock ? endClock + " " : ""}${rec.label}`
        : `- ${kw} ${rec.label}`;
      const eb = J.ensureBlockId(rawLine, preferId);
      rec.blockId = eb.blockId;
      rec.label = J.kwLine(eb.line)?.body || rec.label;
      rec.key = J.workKey(rec.label);
      return { text: this.placeBlock(text, [eb.line]) };
    }
    const lines = text.split("\n");
    const raw = lines[found.line];
    const p = J.splitTask(raw);
    if (!p) return { text };
    const isAuto = Boolean(p.auto);
    if (isAuto) {
      const rules = this.rules();
      const clockSpan = J.clockSpanFromLines(lines, found.line);
      const start = startClock || p.since || clockSpan?.start || "";
      const end = endClock || (p.until && p.until !== p.since ? p.until : clockSpan?.end) || p.until || p.since || start;
      const eb = J.ensureBlockId(J.formatAutoTaskLine({
        prefix: p.prefix,
        kw,
        start,
        end,
        title: p.title, preserveTitle: true,
        showTimeRange: rules.showTimeRange || Boolean(p.since || p.until),
        blockId: preferId,
      }), preferId);
      rec.blockId = eb.blockId;
      rec.label = J.kwLine(eb.line)?.body || rec.label;
      rec.key = J.workKey(rec.label);
      if (eb.line === raw) return { text };
      lines[found.line] = eb.line;
      return { text: lines.join("\n") };
    }
    const cleanRest = J.stripBlockId(p.rest).replace(/^\d{1,2}[:：]\d{2}\s*[-–~～到至]\s*\d{1,2}[:：]\d{2}\s*/, "");
    const body = cleanRest;
    const since = segs.length ? J.clock(first) : (p.since || J.clock(0));
    const nextRaw = status === "doing" ? `${p.prefix}DOING ${since} ${body}`.trimEnd()
      : status === "done" ? `${p.prefix}DONE ${endClock ? endClock + " " : ""}${body}`.trimEnd()
      : `${p.prefix}${kw} ${body}`.trimEnd();
    const eb = J.ensureBlockId(nextRaw, preferId);
    rec.blockId = eb.blockId;
    rec.key = J.workKey(body);
    if (eb.line === raw) return { text };
    lines[found.line] = eb.line;
    return { text: lines.join("\n") };
  }

  // 实际时段写在那一行下面第一个 ⏱ 子项里；绑着的会话不用再留 🔗 行，会话号写进 ⏱ 末尾
  autoClock(text, key, segs, who, tok = 0, sid = "", blockId = "") {
    const found = J.findTask(text, key, blockId, sid);
    if (!found || !segs.length) return text;
    const lines = text.split("\n");
    const at = found.line;
    const line = J.clockLine(J.childIndent(lines, at), segs, who, tok, true);
    if (sid && !J.isDoneLine(lines[at])) { const l = J.linkUnder(lines, at); if (l && l.sid === sid && J.markOwner(lines, l.line) === at && !J.blockIdOf(lines[l.line]) && !J.hasDescendants(lines, l.line)) lines.splice(l.line, 1); }
    const base = J.width(lines[at]);
    let end = at;
    for (let i = at + 1; i < lines.length; i++) {
      if (lines[i].trim() && J.width(lines[i]) <= base) break;
      if (lines[i].trim()) end = i;
      if (J.CLOCK_RE.test(lines[i]) && J.markOwner(lines, i) === at && lines[i] === line.replace(/ <!-- ad-clock:[a-f0-9]+ -->$/, "")) return J.cleanCompletedIdentifiers(lines.join("\n"));
      if (J.CLOCK_RE.test(lines[i]) && J.markOwner(lines, i) === at && J.mutableClock(lines, i)) {
        if (lines[i] === line) return J.cleanCompletedIdentifiers(lines.join("\n"));
        lines[i] = line;
        return J.cleanCompletedIdentifiers(lines.join("\n"));
      }
    }
    lines.splice(end + 1, 0, line);
    return J.cleanCompletedIdentifiers(lines.join("\n"));
  }

  // 让本机的小模型看一眼这几个会话：起名字、对上日记里哪一行、提炼一句话结论
  async ask(items, open, fallback = false) {
    const blocks = items.map(({ x, active }, i) => {
      const meta = this.usage.meta.get(x.sid) || {};
      const last = String(meta.lastText || "").replace(/\d{12,}/g, "…").replace(/\s+/g, " ").trim().slice(-700);
      const opening = condenseUserPrompt(x.text || "").replace(/\d{12,}/g, "…").slice(0, 200);
      return [`#s${i + 1} [${agentName(x.agent)}] 标题：${x.title || "（没有）"}；累计 ${x.min} 分钟；现在：${active ? "还在进行" : "已经停了"}`,
        opening ? `开头说的：${opening}` : "",
        last ? `最后一条回复的结尾：${last}` : ""].filter(Boolean).join("\n");
    });
    const prompt = [
      "下面是用户今天和 AI 助手的几个工作会话，以及他今天日记里还没做完的任务行。请把每个会话整理成高信息密度的任务记录（自动过滤用户话语中的口语废话、语气词与寒暄，只记录事实、动作与结论，且不要在正文中重复写日期）。",
      "",
      "【日记里还没做完的任务行】（编号: 状态 文字）",
      open.length ? open.map((i, n) => `${n + 1}: ${i.doing ? "DOING" : i.paused ? "PAUSED" : "TODO"} ${J.workKey(i.label)}`).join("\n") : "（没有）",
      "",
      "【会话】",
      blocks.join("\n\n"),
      "",
      "只输出一个 JSON 数组，每个会话一项，不要解释、不要代码块：",
      '[{"id":"s1","label":"…","slug":"journal-cleanup","summary":"…","match":null,"done":false,"todos":[],"skip":false}]',
      "字段：",
      "- label：这件事是什么，不超过 18 个字的中文总结标题（动词开头，高信息密度概括核心任务，过滤口语废话，不要照抄原话、路径、链接或日期，不要带时间、时长、状态词和标点结尾）。",
      "- slug：label 对应的一两个简短英文关键词，用小写英文字母、数字和短横线，每词不超过 16 个字符，例如 journal-cleanup；用于首次创建定位标识。",
      "- summary：当前最新一轮对话的一句话结论（不超过 35 个字，去掉口语铺垫，概括 AI 刚做完或得出的结论；没有回复则填空字符串）。",
      "- match：只有当上面某一行写的就是「这个会话里 AI 在替用户做的那件工作本身」时，才填那一行的编号。那一行如果是留给用户本人的动作（看一眼、看效果、确认、拍板、自己跑命令、发出去、阅读之类），哪怕话题一样也不能匹配，填 null。拿不准一律填 null。",
      "- done：只对已经停了的会话有意义。最后的回复明确表明这件事整个做完了，填 true；做到一半、还在等用户、报错没解决、说了以后再继续，都填 false。",
      "- todos：只在会话已经停了时填。回复里明确说了要用户本人去做或拍板的事，每条不超过 30 个字，最多 1 条，只列不做就卡住的那一件；没有就是空数组。上面任务行里已经有意思相同的就不要再列。",
      "- skip：一两句闲聊或问答、没有实际做事的会话填 true。",
    ].join("\n");
    const buildFallback = () => {
      for (const { x } of items) {
        const meta = this.usage.meta.get(x.sid) || {};
        const proj = this.projectOf(x);
        const promptText = condenseUserPrompt((x.text || "").split(" / ")[0]);
        const rawLabel = (x.agent === "grokbot" && x.title === proj) ? (promptText || x.title) : (x.title || promptText);
        const label = String(rawLabel || "").trim() ? J.formatProjectAutoTitle(rawLabel, proj, this.rules().titleMax) : "";
        const summary = J.oneSentenceConclusion(meta.lastText || "", 80);
        if (label) out.set(x.sid, { label, proj, summary, matchKey: null, done: false, todos: [], skip: false });
      }
      return out;
    };
    const out = new Map();
    let raw = "";
    try { raw = await runJournalModel(prompt, this.cfg); }
    catch (e) {
      this._err = String(e.message || e);
      return fallback ? buildFallback() : out;
    }
    try {
      const arr = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));
      for (const a of arr) {
        const item = items[Number(String(a.id).replace(/^s/, "")) - 1];
        const sid = item?.x.sid;
        if (!sid) continue;
        const meta = this.usage.meta.get(sid) || {};
        const proj = this.projectOf(item.x);
        const label = String(a.label || "").trim() ? J.formatProjectAutoTitle(a.label, proj, this.rules().titleMax) : "";
        const summary = safeLabel(a.summary || "", 60) || J.oneSentenceConclusion(meta.lastText || "", 80);
        const m = Number.isInteger(a.match) && open[a.match - 1] ? open[a.match - 1] : null;
        out.set(sid, {
          label,
          proj,
          slug: J.normalizeTaskSlug(a.slug),
          summary,
          matchKey: m ? J.workKey(m.label) : null,
          done: a.done === true,
          todos: (Array.isArray(a.todos) ? a.todos : []).map((t) => safeLabel(t, 50)).filter(Boolean).slice(0, 1),
          skip: !!a.skip || (!label && !m),
        });
      }
      this._err = "";
    } catch (e) {
      this._err = t("模型回的不是 JSON");
      if (fallback) return buildFallback();
    }
    return out;
  }

  dayDiff(fromDay, toDay) {
    if (!fromDay || !toDay || fromDay === toDay) return 0;
    const parse = (d) => new Date(String(d).replace(/^(\d{4})\D(\d{2})\D(\d{2})$/, "$1-$2-$3") + "T12:00:00").getTime();
    return Math.round((parse(toDay) - parse(fromDay)) / 86400000);
  }

  // 跨日期会话留在原起始日日记，过了零点的新会话再记到今天。
  originDayOf(x, today) {
    const sid = x?.sid;
    if (!sid || x?.agent === "grokbot") return today;
    for (const d of Object.keys(this.cfg.autoLogState || {}).sort()) {
      if (d >= today) continue;
      const rec = this.cfg.autoLogState[d]?.[sid];
      if (rec && !rec.gone && (rec.key || rec.blockId || rec.skip)) return d;
    }
    const meta = this.usage?.meta?.get(sid) || {};
    const firstRoundAt = Array.isArray(meta.rounds) && meta.rounds[0]?.at ? meta.rounds[0].at : 0;
    const startMs = meta.startedAt || firstRoundAt || 0;
    if (startMs > 0) {
      const startDay = dayKey(startMs, this.cfg);
      if (startDay && startDay < today && this.journalFile(startDay)) return startDay;
    }
    return today;
  }

  async run({ dry = false, fallback = false, manual = false } = {}) {
    const report = { asked: 0, changes: [], error: "" };
    if (this._busy || (this.cfg.journalAutoWrite === false && !manual)) return report;
    this._busy = true;
    try {
      const day = this.dayKey();
      const file = this.journalFile(day);
      if (!file) { report.error = t("今天的日记 {path} 还没建", { path: this.journalPath(day) }); return report; }
      const data = this.usage.summary(day);
      if (!data || !data.list || !data.list.length) return report;
      const arch = this.archived();
      const todayList = [], crossByOrigin = new Map();
      for (const x of data.list) {
        const origin = this.originDayOf(x, day);
        if (origin < day) {
          (crossByOrigin.get(origin) || crossByOrigin.set(origin, []).get(origin)).push(x);
        } else {
          todayList.push(x);
        }
      }
      const res = await this.processDay(day, file, todayList, day, arch, { dry, fallback, manual }, report);
      if (!res || dry) return report;
      // 跨日延续的会话保留在原起始日日记位置并合并时段与进度
      for (const [originDay, crossList] of crossByOrigin) {
        const originFile = this.journalFile(originDay);
        if (!originFile) continue;
        const shiftMin = Math.round(this.dayDiff(originDay, day) * 1440);
        const originList = ((this.usage.summary(originDay) || {}).list || []).map((s) => ({ ...s }));
        const bySid = new Map(originList.map((s) => [s.sid, s]));
        for (const xToday of crossList) {
          const shiftedSegs = (xToday.segs || []).map(([a, b]) => [a + shiftMin, b + shiftMin]);
          const prev = bySid.get(xToday.sid);
          const mergedSegs = unionSegs([...(prev?.segs || []), ...shiftedSegs]);
          const min = Math.round(mergedSegs.reduce((n, [a, b]) => n + Math.max(0, b - a), 0));
          const merged = {
            ...(prev || xToday),
            segs: mergedSegs,
            min,
            out: (prev?.out || 0) + (xToday.out || 0),
            fresh: (prev?.fresh || 0) + (xToday.fresh || 0),
          };
          if (prev) Object.assign(prev, merged);
          else originList.push(merged);
        }
        await this.processDay(originDay, originFile, originList, day, arch, { dry, fallback, manual }, report, shiftMin);
      }
      await this.archivePast(arch, day);
      for (const k of Object.keys(this.cfg.autoLogState).sort().slice(0, -14)) delete this.cfg.autoLogState[k];
      await this.p.saveSettings();
      return report;
    } catch (e) {
      console.error("[agent-deck] 自动记日记失败", e);
      report.error = String(e.message || e);
      return report;
    } finally { this._busy = false; }
  }

  async processDay(day, file, list, todayDay, arch, { dry = false, fallback = false, manual = false } = {}, report, shiftMin = 0) {
    let snap = null;
    try {
      if (!list.length) return true;
      const idle = Math.max(5, this.cfg.autoLogIdle || 10);
      const grokDone = this.grokDoneMinutes(idle);
      const now = this.nowMin() + shiftMin;
      const st = this.state(day);
      snap = JSON.stringify(st);
      const base = await this.read(file);
      const linked = J.linkMap(base);
      const background = new Set(Object.values(this.p.jobs || {}).filter(job => job.destination === "background").map(job => job.sessionId));
      const todo = [], live = [];
      for (const x of list) {
        if (!x.segs || !x.segs.length) continue;
        if (!this.agentOn(x.agent) || background.has(x.sid)) continue;
        if (linked.has(x.sid)) continue;   // 日记里用 🔗 绑好的，交给回写那一半
        const last = x.segs[x.segs.length - 1][1];
        const active = now - last <= idle;
        const rec = st[x.sid];
        if (rec && (rec.skip || rec.gone)) continue;
        if (!rec) {
          if (x.min < this.minMinutes && !arch.has(x.sid)) continue;
          todo.push({ x, active, fresh: true });
        } else if (x.agent === "grokbot" && rec.status === "done" && rec.doneAtMin != null && last > rec.doneAtMin && active) {
          todo.push({ x, active, fresh: true, sinceMs: rec.doneEndMs || 0 });
        } else if (rec.status === "doing" && !active && !rec.asked && !arch.has(x.sid)) todo.push({ x, active, rec });
        else live.push({ x, active, rec });
      }
      const ask = todo.slice(0, this.batch);
      let ans = new Map();
      if (ask.length) {
        const open = J.openTasks(base).filter((i) => !this.hasChildren(base, i.line)).slice(0, 60);
        ans = await this.ask(ask, open, fallback);
        report.asked += ask.length;
        report.error = this._err || "";
      }
      if (this.cfg.journalAutoWrite === false && !manual) return true;
      await serializeNote(this.p, file.path, async () => {
        const base = await this.read(file);
        const linked = J.linkMap(base);
        let text = base;
        const digest = { doing: [], paused: [], done: [], archived: [], idleDone: [], todo: [] };
        const clocks = new Set();
        const work = ((this.cfg.workLog ||= {})[day] ||= {});
        for (const { x, active, fresh, sinceMs } of [...ask, ...todo.slice(this.batch), ...live]) {
          if (linked.has(x.sid)) continue;
          const a = ans.get(x.sid);
          const last = x.segs[x.segs.length - 1][1];
          let rec = st[x.sid];
          if (fresh) {
            if (!a) continue;
            if (a.skip) { st[x.sid] = { skip: true }; continue; }
            let m = a.matchKey ? J.taskItems(text).find((i) => i.state === "open" && i.key === a.matchKey) : null;
            if (m && !active && m.state !== "doing" && m.state !== "paused") m = null;
            if (!m && !a.label) { st[x.sid] = { skip: true }; continue; }
            const label = m ? m.body : J.AUTO_MARK + a.label;
            const seed = sinceMs ? `${x.sid}:${sinceMs}` : x.sid;
            const blockId = (m && m.blockId) || J.makeBlockId(seed, x.agent, a.slug);
            rec = st[x.sid] = { key: J.workKey(label), label, blockId, created: !m, agent: x.agent, proj: m ? "" : (a.proj || this.projectOf(x)), status: m ? m.state : null, fresh: !m, ...(sinceMs ? { sinceMs } : {}) };
          }
          rec.min = x.min;
          if (a) rec.asked = !active;
          if (active) delete rec.asked;
          const found = J.findTask(text, rec.key, rec.blockId || "", x.sid);
          if (!found && !rec.fresh) {
            rec.gone = true;
            report.changes.push(t("不再管：{name}（这一行没了）", { name: rec.label }));
            continue;
          }
          if (found) {
            if (found.blockId) rec.blockId = found.blockId;
            rec.key = found.key;
          }
          const cur = found ? found.state : null;
          const manualState = found && J.isManualTask(this.cfg, text.split("\n")[found.line]);
          if (manualState) rec.status = cur;
          if (cur === "done" && !manualState) { if (rec.status !== "done") clocks.add(rec.key); rec.status = "done"; continue; }
          if (rec.status && found && (cur !== rec.status || (rec.autoKw && found.kw !== rec.autoKw))) {
            if (cur === "doing") rec.hold = Date.now() + 2 * 3600e3; else rec.parkedAt = last;
            rec.status = cur;
            delete rec.autoPaused;
            delete rec.autoKw;
          }
          const name = J.workKey(rec.label).replace(J.AUTO_MARK, "");
          const grokIdleDone = x.agent === "grokbot" && grokDone > 0 && now - last >= grokDone && !(rec.hold && Date.now() < rec.hold);
          const archDone = this.allArchived(st, x.sid, rec, arch);
          const blockedKw = this.blockedKeyword(x.sid);
          const doneReview = !active && !blockedKw && Boolean((a && a.done) || rec.doneHint);
          if (!manualState && (archDone || grokIdleDone)) {
            text = this.autoLine(text, rec, x, "done").text;
            rec.status = "done";
            if (x.agent === "grokbot") {
              rec.doneAtMin = last;
              rec.doneEndMs = (this.usage.meta.get(x.sid)?.lastAt) || Date.now();
            }
            delete rec.fresh; delete rec.parkedAt; delete rec.hold; delete rec.autoPaused; delete rec.autoKw; delete rec.doneHint;
            clocks.add(rec.key);
            if (archDone) {
              digest.archived.push(`${name}（${x.min}m）`);
              report.changes.push(t("DONE（已归档）：{name}（{min}m）", { name: rec.label, min: x.min }));
            } else {
              digest.idleDone.push(`${name}（${x.min}m）`);
              report.changes.push(t("DONE（长时间无新对话）：{name}（{min}m）", { name: rec.label, min: x.min }));
            }
          } else if (!manualState && blockedKw && !(rec.parkedAt != null && last <= rec.parkedAt && !rec.autoPaused)) {
            const changed = !found || found.kw !== blockedKw;
            text = this.autoLine(text, rec, x, blockedKw).text;
            rec.status = "paused"; rec.autoPaused = true; rec.autoKw = blockedKw; rec.parkedAt = last;
            delete rec.fresh; delete rec.doneHint;
            if (changed) {
              clocks.add(rec.key);
              report.changes.push(t("{kw}：{name}（{min}m）", { kw: blockedKw, name: rec.label, min: x.min }));
            }
          } else if (!manualState && active && cur !== "doing" && !(rec.parkedAt != null && last <= rec.parkedAt)) {
            text = this.autoLine(text, rec, x, "doing").text;
            rec.status = "doing";
            delete rec.parkedAt; delete rec.fresh; delete rec.autoPaused; delete rec.autoKw; delete rec.doneHint;
            digest.doing.push(name);
            report.changes.push(t("DOING：{name}", { name: rec.label }));
          } else if (!manualState && active && cur === "doing") {
            text = this.autoLine(text, rec, x, "doing").text;
            rec.status = "doing";
            delete rec.parkedAt; delete rec.autoPaused; delete rec.autoKw; delete rec.doneHint;
          } else if (!manualState && doneReview && !(rec.hold && Date.now() < rec.hold) && (cur === "doing" || rec.fresh || rec.autoKw === "PAUSED" || rec.autoKw === "TOREVIEW")) {
            const changed = !found || found.kw !== "TOREVIEW";
            text = this.autoLine(text, rec, x, "TOREVIEW").text;
            rec.status = "paused"; rec.autoPaused = true; rec.autoKw = "TOREVIEW"; rec.parkedAt = last; delete rec.fresh;
            if (changed) {
              clocks.add(rec.key);
              report.changes.push(t("{kw}：{name}（{min}m）", { kw: "TOREVIEW", name: rec.label, min: x.min }));
            }
          } else if (!manualState && !active && (cur === "doing" || rec.fresh) && !(rec.hold && Date.now() < rec.hold)) {
            text = this.autoLine(text, rec, x, "paused").text;
            rec.status = "paused"; rec.autoPaused = true; rec.autoKw = "PAUSED"; rec.parkedAt = last; delete rec.fresh;
            clocks.add(rec.key);
            digest.paused.push(`${name}（${x.min}m）`);
            report.changes.push(t("PAUSED：{name}（{min}m）", { name: rec.label, min: x.min }));
          } else if (!manualState && !active && cur === "paused") {
            text = this.autoLine(text, rec, x, "paused").text;
          }
          if (a && !active && a.done && !rec.doneHint) {
            rec.doneHint = true;
            digest.done.push(`${name}（${x.min}m）`);
            if (rec.autoKw !== "TOREVIEW") report.changes.push(t("看着做完了：{name}", { name: rec.label }));
          }
          const meta = this.usage.meta.get(x.sid) || {};
          const rawRounds = Array.isArray(meta.rounds) ? meta.rounds : [];
          const rounds = x.agent === "grokbot"
            ? rawRounds.filter((r) => (!r?.at || dayKey(r.at, this.cfg) === day) && (!rec.sinceMs || !r?.at || r.at > rec.sinceMs))
            : rawRounds;
          const rawSummary = (a && a.summary) || (meta.lastText && (meta.state === "wait" || meta.state === "quiet" || !active) ? J.oneSentenceConclusion(meta.lastText, 90) : "");
          if (a && a.summary && rounds.length) rounds[rounds.length - 1].summary = a.summary;
          const pendingTodos = (a && !active && Array.isArray(a.todos) && !rec.todosAdded) ? a.todos : [];
          const taskTodo = x.agent === "claude" && (!active || meta.state === "wait" || meta.state === "quiet") ? (meta.todo || null) : null;
          if ((this.cfg.autoLogGranularity !== "paused" || !active || arch.has(x.sid)) && (rawSummary || pendingTodos.length || rounds.length > 1 || taskTodo)) {
            const synced = J.syncSessionEntry(text, {
              granularity: this.cfg.autoLogGranularity,
              compact: this.cfg.autoLogSummaries?.[day]?.[x.sid],
              detail: this.cfg.autoLogDetail,
              detailHistory: this.cfg.autoLogDetailHistory,
              sid: x.sid, agent: x.agent,
              blockId: rec.blockId || "",
              key: rec.key,
              said: rawSummary,
              rounds: (!active || meta.state === "wait" || meta.state === "quiet") ? rounds : rounds.slice(0, -1),
              todos: pendingTodos,
              taskTodo,
              ensureId: true,
            });
            text = synced.text;
            if (synced.blockId) rec.blockId = synced.blockId;
            if (pendingTodos.length) {
              for (const todo of pendingTodos) { digest.todo.push(todo); report.changes.push(t("待拍板（挂在 {name} 下）：{text}", { name, text: todo })); }
              rec.todosAdded = true;
            }
          }
        }
        const byKey = new Map(), who = new Map(), toks = new Map(), sids = new Map(), blockIds = new Map();
        for (const x of list) {
          const rec = st[x.sid];
          if (!rec || rec.skip || rec.gone || !rec.key) continue;
          if (rec.blockId && !blockIds.has(rec.key)) blockIds.set(rec.key, rec.blockId);
          toks.set(rec.key, (toks.get(rec.key) || 0) + (x.out || 0) + (x.fresh || 0));
          (sids.get(rec.key) || sids.set(rec.key, []).get(rec.key)).push(x.sid);
          (byKey.get(rec.key) || byKey.set(rec.key, []).get(rec.key)).push(...x.segs);
          (who.get(rec.key) || who.set(rec.key, new Set()).get(rec.key)).add(agentName(x.agent));
        }
        const merged = new Map();
        for (const [k, segs] of byKey) merged.set(k, unionSegs([...(work[k] || []).filter((s) => s[1] != null), ...segs]));
        for (const k of clocks) if (merged.has(k)) text = this.autoClock(text, k, merged.get(k), [...who.get(k)].join(" / "), toks.get(k) || 0, (sids.get(k) || []).filter(Boolean).length === 1 ? (sids.get(k) || []).filter(Boolean)[0] : "", blockIds.get(k) || "");
        text = J.cleanCompletedIdentifiers(J.clocksLast(text));
        if (day === todayDay) report.diff = J.diffLines(base, text);
        if (dry) { this.cfg.autoLogState[day] = JSON.parse(snap); return; }
        if (!(await this.write(file, base, text))) {
          this.cfg.autoLogState[day] = JSON.parse(snap);
          if (day === todayDay) report.error = t("日记正在被改，这一轮没写");
          return;
        }
        for (const [k, segs] of merged) work[k] = segs;
        if (this.cfg.autoLogNotify !== false && day === todayDay) this.digest(digest, idle, file);
      });
      return day !== todayDay || report.error !== t("日记正在被改，这一轮没写");
    } catch (e) {
      if (snap && day) this.cfg.autoLogState[day] = JSON.parse(snap);
      throw e;
    }
  }

  // 前几天记下、还挂着的行：会话归档了（或 Grok Bot 长时间无新对话），就在它当天的日记里补成 DONE。
  // 同一任务的会话全部归档才完成；日记正好被改过就跳过这一天。
  async archivePast(arch, today) {
    const grokDone = this.grokDoneMinutes();
    if (!arch.size && !grokDone) return [];
    const out = [];
    for (const day of Object.keys(this.cfg.autoLogState || {})) {
      if (day === today) continue;
      const file = this.journalFile(day);
      if (!file) continue;
      const st = this.cfg.autoLogState[day] || {};
      const list = (this.usage.summary(day) || {}).list || [];
      const grokIdleDone = (sid, r) => {
        if (r.agent !== "grokbot" || !grokDone) return false;
        const x = list.find((s) => s.sid === sid && s.segs && s.segs.length);
        const lastMin = x ? x.segs[x.segs.length - 1][1] : 0;
        const lastMs = startOfDay(new Date(String(day).replace(/^(\d{4})\D(\d{2})\D(\d{2})$/, "$1-$2-$3") + "T12:00:00").getTime(), this.cfg) + lastMin * 60000;
        return (Date.now() - lastMs) >= grokDone * 60000;
      };
      const hits = Object.entries(st).filter(([sid, r]) => r.key && !r.skip && !r.gone && r.status !== "done" && ((arch.has(sid) && this.allArchived(st, sid, r, arch)) || grokIdleDone(sid, r)));
      if (!hits.length) continue;
      const base = await this.read(file);
      let text = base;
      const before = new Map(hits.map(([sid, rec]) => [sid, { status: rec.status, autoPaused: rec.autoPaused, gone: rec.gone }]));
      for (const [sid, rec] of hits) {
        const found = J.findTask(text, rec.key, rec.blockId || "", sid);
        if (!found) { rec.gone = true; continue; }
        if (J.isManualTask(this.cfg, text.split("\n")[found.line])) continue;
        if (found.state === "done") { rec.status = found.state; delete rec.autoPaused; continue; }
        const x = list.find((s) => s.sid === sid && s.segs && s.segs.length) || null;
        text = this.autoLine(text, rec, x, "done").text;
        if (x) text = this.autoClock(text, rec.key, x.segs, agentName(x.agent), (x.out || 0) + (x.fresh || 0), x.sid, rec.blockId || "");
        rec.status = "done"; delete rec.autoPaused;
        out.push(rec.label);
      }
      if (text !== base && !(await this.write(file, base, text))) {
        // 那一天的日记正在被改：这一轮跳过，状态改回去
        for (const [sid, rec] of hits) {
          const b = before.get(sid);
          if (!b) continue;
          rec.status = b.status;
          if (b.autoPaused === undefined) delete rec.autoPaused; else rec.autoPaused = b.autoPaused;
          if (b.gone === undefined) delete rec.gone; else rec.gone = b.gone;
        }
        continue;
      }
    }
    return out;
  }

  digest(d, idle, file) {
    const sec = (head, list) => (list.length ? t("**{head}（{n} 件）**", { head, n: list.length }) + "\n" + list.map((s) => "· " + s).join("\n") : "");
    const parts = [
      sec(t("▶ 在做"), d.doing),
      sec(t("⏸ {min} 分钟没动，先暂停了", { min: idle }), d.paused),
      sec(t("📦 会话归档了，记成做完"), d.archived),
      sec(t("✅ 长时间无新对话，记成做完"), d.idleDone),
      sec(t("✅ 看着像是做完了，要标 DONE 自己改一下"), d.done),
      sec(t("📌 记了要你做的"), d.todo),
    ].filter(Boolean);
    if (!parts.length) return;
    new Notice(t("🤖 整理了日记") + "\n" + parts.join("\n\n"), 9000);
  }

  // 手动整理：一轮最多问 autoLogBatch 个，接着问到问完
  async logNow() {
    const changes = [];
    let error = "";
    for (let round = 0; round < 5; round++) {
      const r = await this.run({ fallback: true, manual: true });
      changes.push(...r.changes);
      error = r.error || "";
      if (error || r.asked < this.batch) break;
    }
    this._at = Date.now();
    const msg = error && !changes.length ? t("没整理成：{error}", { error })
      : changes.length ? t("整理进日记了：") + "\n" + changes.join("\n") + (error ? "\n" + t("（模型没问到，新会话先用它自己的标题记的：{error}）", { error }) : "")
      : t("没有要改的：会话都已经记过了，或者还太短（不到 {min} 分钟）", { min: this.minMinutes });
    new Notice(msg, 9000);
    this.p.refreshUI();
    return { changes, error };
  }

  // 每分钟看一眼：启动后先等 autoLogStartDelay 分钟整理一次，之后每 autoLogEvery 分钟一次
  tick() {
    if (!this.cfg.autoLog || this.cfg.journalAutoWrite === false) return;
    const wait = this._at ? Math.max(5, num(this.cfg.autoLogEvery, 20)) : Math.max(1, num(this.cfg.autoLogStartDelay, 1));
    if (Date.now() - (this._at || this._born) < wait * 60e3) return;
    this._at = Date.now();
    const fallback = this.cfg.autoLogFallback !== false;
    this.p.scanNow(false).catch(() => {}).then(() => this.run({ fallback }).catch((e) => console.error("[agent-deck] autolog", e)));
  }
}
