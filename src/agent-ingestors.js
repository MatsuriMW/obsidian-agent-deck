// Per-agent session log ingestors & extensible dispatcher.
//
// Each ingestor transforms one raw log line/record into updates on the shared
// file-state (`fc`) and `AgentUsage` instance (`ctx.usage`). New JSONL/stream
// agents can be registered without modifying `src/readers.js`.

import { cleanUserPrompt, isPromptText } from "./prompt-text.js";
import { ingestCursorEvent } from "./cursor-sessions.js";
import { ingestTraeEvent } from "./trae-sessions.js";
import { t } from "./i18n.js";

const DSH_TOUCH = new Set([
  "user/message",
  "assistant/message",
  "tool/call",
  "tool/result",
  "turn/start",
  "turn/end",
  "step/start",
  "step/end",
]);

export function unquoteArgs(args) {
  if (!args || typeof args !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string" && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("{") && v.endsWith("}")) || (v.startsWith("[") && v.endsWith("]")))) {
      try { out[k] = JSON.parse(v); continue; } catch { /* keep raw */ }
    }
    out[k] = v;
  }
  return out;
}

export function stepText(name, input) {
  const i = input || {};
  const n = String(name || "");
  const base = (x) => String(x || "").split("/").pop();
  const cut = (x) => { x = String(x || "").replace(/\s+/g, " ").trim(); return x.length > 34 ? x.slice(0, 33) + "…" : x; };
  if (/^(bash|shell|local_shell_call|exec_command|shell_command|run_command)$/i.test(n)) return cut(i.description || i.toolSummary || (Array.isArray(i.command) ? i.command[i.command.length - 1] : i.command || i.cmd || i.CommandLine) || t("跑命令"));
  if (/^(edit|multiedit|notebookedit|apply_patch|str_replace_editor|edit_file|replace_file_content|multi_replace_file_content)$/i.test(n)) return cut(t("改 {file}", { file: base(i.file_path || i.notebook_path || i.path || i.Path || i.TargetFile) || t("文件") }));
  if (/^(write|create_file|write_file|write_to_file)$/i.test(n)) return cut(t("写 {file}", { file: base(i.file_path || i.path || i.Path || i.TargetFile) }));
  if (/^(read|view|read_file|view_file)$/i.test(n)) return cut(t("读 {file}", { file: base(i.file_path || i.path || i.Path || i.AbsolutePath) }));
  if (/^(grep|glob|search|grep_search|find_by_name)$/i.test(n)) return cut(t("找 {pattern}", { pattern: i.pattern || i.query || i.Query || i.Pattern || "" }));
  if (/^(agent|task|subagent|invoke_subagent)$/i.test(n)) return cut(t("派出去：{what}", { what: i.description || i.Role || i.Prompt || "" }));
  if (/^(websearch|web_search|search_web)$/i.test(n)) return cut(t("搜 {query}", { query: i.query || "" }));
  if (/^(webfetch|web_fetch)$/i.test(n)) return t("读网页");
  if (n === "Skill") return cut(t("用技能 {skill}", { skill: i.skill || "" }));
  if (n === "TaskCreate") return cut(t("建待办：{subject}", { subject: i.subject || i.title || "" }));
  if (n === "TaskUpdate") return cut(`${i.status === "completed" ? t("完成待办 #{id}", { id: i.taskId || i.id || "" }) : i.status === "in_progress" ? t("进行待办 #{id}", { id: i.taskId || i.id || "" }) : t("更新待办 #{id}", { id: i.taskId || i.id || "" })}`);
  if (/^todo/i.test(n)) return t("整理待办");
  return cut(n.startsWith("mcp__") ? n.split("__").pop() : n);
}

export function todoOf(pairs) {
  if (!pairs || !pairs.length) return null;
  const cur = (pairs.find(([st]) => st === "in_progress") || pairs.find(([st]) => st === "pending") || [])[1] || "";
  const done = pairs.filter(([st]) => st === "completed" || st === "done").length;
  const items = pairs.map(([st, text], idx) => ({ id: String(idx + 1), text: String(text || "").replace(/\s+/g, " ").trim(), status: st || "pending" }));
  return { done, total: pairs.length, cur: done >= pairs.length ? "" : String(cur).replace(/\s+/g, " ").slice(0, 36), items };
}

function buildTaskTodo(tk) {
  if (!tk || !tk.map.size) return null;
  const list = [...tk.map.values()].filter((t) => t.status !== "deleted");
  if (!list.length) return null;
  const done = list.filter((t) => t.status === "completed" || t.status === "done").length;
  const active = list.find((t) => t.status === "in_progress");
  const next = list.find((t) => t.status === "pending");
  const rawCur = active ? (active.activeForm || active.subject) : (done < list.length && next ? (next.subject || next.activeForm) : "");
  const items = list.map((t) => ({ id: t.id, text: t.subject || t.activeForm || `#${t.id}`, activeForm: t.activeForm || "", status: t.status }));
  return { done, total: list.length, cur: String(rawCur || "").replace(/\s+/g, " ").slice(0, 36), items };
}

export function applyTaskTool(fc, name, input, callId = "") {
  const inp = input || {};
  if (!fc.tasks) fc.tasks = { seq: 0, seen: new Set(), map: new Map() };
  const tk = fc.tasks;
  if (name === "TaskCreate") {
    if (callId && tk.seen.has(callId)) return buildTaskTodo(tk);
    if (callId) tk.seen.add(callId);
    tk.seq += 1;
    const id = String(inp.taskId || inp.id || tk.seq);
    const subject = String(inp.subject || inp.title || inp.description || `#${id}`).replace(/\s+/g, " ").trim();
    const activeForm = String(inp.activeForm || "").replace(/\s+/g, " ").trim();
    tk.map.set(id, { id, subject, activeForm, status: inp.status || "pending" });
  } else if (name === "TaskUpdate") {
    const id = String(inp.taskId || inp.id || "");
    if (!id) return buildTaskTodo(tk);
    const cur = tk.map.get(id) || { id, subject: `#${id}`, activeForm: "", status: "pending" };
    if (inp.status) cur.status = String(inp.status);
    if (inp.subject || inp.title) cur.subject = String(inp.subject || inp.title).replace(/\s+/g, " ").trim();
    if (inp.activeForm) cur.activeForm = String(inp.activeForm).replace(/\s+/g, " ").trim();
    tk.map.set(id, cur);
  }
  return buildTaskTodo(tk);
}

export function startRound(fc, ms, rawAsk, key = "", live = null) {
  if (!fc.rounds) fc.rounds = { seen: new Set(), list: [] };
  if (key && fc.rounds.seen.has(key)) return fc.rounds.list.length;
  if (key) fc.rounds.seen.add(key);
  const ask = cleanUserPrompt(rawAsk).replace(/\s+/g, " ").trim().slice(0, 1000);
  if (!ask) return fc.rounds.list.length;
  const last = fc.rounds.list[fc.rounds.list.length - 1];
  if (last && last.ask === ask && Math.abs(ms - last.at) < 2000) return fc.rounds.list.length;
  fc.rounds.list.push({ n: fc.rounds.list.length + 1, at: ms, doneAt: 0, ask, said: "" });
  // 新的一轮从空白开始：上一轮最后那句话不能漏进这一轮的结论里。
  if (live) live.lastText = "";
  return fc.rounds.list.length;
}

export function finishRound(fc, ms, said, isWait = false) {
  if (!fc.rounds || !fc.rounds.list.length) {
    if (!said || !String(said).trim()) return;
    fc.rounds = { seen: new Set(), list: [{ n: 1, at: ms, doneAt: isWait ? ms : 0, ask: "", said: String(said).trim() }] };
    return;
  }
  const cur = fc.rounds.list[fc.rounds.list.length - 1];
  if (said && String(said).trim()) cur.said = String(said).trim();
  if (isWait && ms >= cur.at) cur.doneAt = ms;
}

// ---- Claude Code & Qoder CLI JSONL ----
export function ingestClaudeLine(ctx, line, fc, touched) {
  const usage = ctx.usage;
  // 父会话正忙时，subagent 的结束通知先进排队（queue-operation），再作为附件塞进下一轮，不是 user 行
  if (line.indexOf("<task-notification>") >= 0 && line.indexOf('"type":"user"') < 0 && line.indexOf('"isSidechain":true') < 0) {
    let q;
    try { q = JSON.parse(line); } catch { return; }
    const text = q.type === "queue-operation" && q.operation === "enqueue" ? q.content
      : q.attachment && q.attachment.type === "queued_command" ? q.attachment.prompt : "";
    if (typeof text === "string" && text.startsWith("<task-notification>") && q.sessionId) usage.subNotice(q.sessionId, text, Date.parse(q.timestamp) || 0);
    return;
  }
  if (line.indexOf('"type":"assistant"') < 0 && line.indexOf('"type":"user"') < 0 && line.indexOf('"type":"custom-title"') < 0 && line.indexOf('"type":"ai-title"') < 0 && line.indexOf('"type":"last-prompt"') < 0) return;
  let d;
  try { d = JSON.parse(line); } catch { return; }
  if (d.type === "custom-title" || d.type === "ai-title") {
    const title = d.type === "custom-title" ? d.customTitle : d.aiTitle;
    const sid = d.sessionId || fc.sid;
    if (title && sid) {
      if (usage.noteClientTitle) usage.noteClientTitle(sid, title, { fc, custom: d.type === "custom-title" });
      else {
        fc.titles.set(sid, title);
        usage.titles.set(sid, title);
        const m = usage.meta.get(sid); if (m) m.title = title;
      }
    }
    fc.sid = sid;
    return;
  }
  if (d.type === "last-prompt") { fc.sid = d.sessionId || fc.sid; return; }
  if (d.type !== "assistant" && d.type !== "user") return;
  const ms = Date.parse(d.timestamp);
  if (!ms || usage.stale(fc.agent, ms)) return;
  fc.sid = d.sessionId || fc.sid;
  fc.cwd = d.cwd || fc.cwd;
  fc.app = d.entrypoint || fc.app || (fc.agent === "qoder" ? "cli" : "");
  const sid = fc.sid;
  const { key, day, s } = usage.touchSess(fc, touched, ms, sid, fc.cwd, fc.app);
  const v = usage.liveOf(fc, sid, ms);
  v.title = usage.titles.get(sid) || fc.titles.get(sid) || v.title;
  v.cwd = fc.cwd; v.app = fc.app;
  if (d.type === "assistant" && d.message) {
    const model = d.message.model && d.message.model !== "unknown" ? d.message.model : "";
    if (model) v.model = model;
    const c = d.message.content;
    for (const b of Array.isArray(c) ? c : []) {
      if (b.type === "tool_use") {
        if (b.name === "TodoWrite" && Array.isArray(b.input && b.input.todos)) v.todo = todoOf(b.input.todos.map((t) => [t.status, t.activeForm || t.content]));
        else if (b.name === "TaskCreate" || b.name === "TaskUpdate") {
          const td = applyTaskTool(fc, b.name, b.input, b.id);
          if (td) v.todo = td;
          v.step = stepText(b.name, b.input);
        } else v.step = stepText(b.name, b.input);
      }
      if (b.type === "text" && b.text) v.lastText = b.text;
    }
    const stop = d.message.stop_reason;
    v.state = stop === "end_turn" || stop === "stop_sequence" ? "wait" : "run";
    if (v.state === "wait") v.step = "";
    if (!d.isSidechain) {
      finishRound(fc, ms, v.lastText, v.state === "wait");
      v.turns = fc.rounds ? fc.rounds.list.length : 0;
      v.rounds = fc.rounds ? fc.rounds.list : [];
    }
    const u = d.message.usage;
    const meta = usage.meta.get(sid) || {};
    if (u && d.message.id && !d.isSidechain) {
      const id = `${d.message.id}:${d.requestId || ""}`;
      const prev = fc.msgs.get(id) || { out: 0, fresh: 0, cached: 0 };
      const m = { key, sid, proj: s.proj, model: (d.message.model && d.message.model !== "unknown" ? d.message.model : "") || v.model || "", out: u.output_tokens || 0, fresh: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0), cached: u.cache_read_input_tokens || 0, at: ms };
      fc.msgs.set(id, m);
      usage.noteMeta(fc, sid, {
        title: v.title, text: s.text, cwd: fc.cwd, app: fc.app, model: v.model,
        lastAt: Math.max(ms, meta.lastAt || 0),
        out: (meta.out || 0) - prev.out + m.out,
        fresh: (meta.fresh || 0) - prev.fresh + m.fresh,
        cached: (meta.cached || 0) - prev.cached + m.cached,
        calls: (meta.calls || 0) + (prev.out || prev.fresh || prev.cached ? 0 : 1),
        state: v.state, step: v.step, todo: v.todo, turns: v.turns, rounds: v.rounds, lastText: v.lastText,
      });
    } else if (!d.isSidechain) {
      usage.noteMeta(fc, sid, { title: v.title, text: s.text, cwd: fc.cwd, app: fc.app, model: v.model, lastAt: Math.max(ms, meta.lastAt || 0), state: v.state, step: v.step, todo: v.todo, turns: v.turns, rounds: v.rounds, lastText: v.lastText });
    }
  } else if (d.type === "user" && !d.isSidechain) {
    const c = d.message && d.message.content;
    const text = cleanUserPrompt(typeof c === "string" ? c : Array.isArray(c) && !c.some((b) => b.type === "tool_result") ? c.filter((b) => b.type === "text").map((b) => b.text).join("") : "");
    if (isPromptText(text)) {
      day.prompts++;
      startRound(fc, ms, text, d.uuid || String(ms), v);
      v.turns = fc.rounds ? fc.rounds.list.length : 0;
      v.rounds = fc.rounds ? fc.rounds.list : [];
      if (s.text.length < 300) s.text += (s.text ? " / " : "") + text.replace(/\s+/g, " ").slice(0, 300 - s.text.length);
      v.state = /^\s*\[Request interrupted/.test(text) ? "wait" : "run";
      usage.noteMeta(fc, sid, { title: v.title, text: s.text, cwd: fc.cwd, app: fc.app, lastAt: Math.max(ms, usage.meta.get(sid)?.lastAt || 0), state: v.state, todo: v.todo, turns: v.turns, rounds: v.rounds });
    }
  }
}

// ---- Codex ----
export function ingestCodexLine(ctx, line, fc, touched) {
  const usage = ctx.usage;
  let d;
  try { d = JSON.parse(line); } catch { return; }
  const p = d.payload || {};
  if (d.type === "session_meta") {
    fc.sid = p.id || fc.sid;
    fc.cwd = p.cwd || fc.cwd;
    fc.app = p.originator || fc.app || "codex";
    // 子代理：parent_thread_id，或 source.subagent（含 thread_spawn.parent_thread_id / review / compact 等）。
    const subSource = p.source && typeof p.source === "object" ? p.source.subagent : null;
    const spawn = subSource && typeof subSource === "object" ? subSource.thread_spawn : null;
    const parent = p.parent_thread_id || (spawn && spawn.parent_thread_id) || "";
    if (subSource) fc.isSubagent = true;
    if (parent && parent !== fc.sid) fc.parentSid = String(parent);
    if (fc.parentSid || fc.isSubagent) {
      usage.noteMeta(fc, fc.sid, {
        ...(fc.parentSid ? { parentSid: fc.parentSid } : {}),
        ...(fc.isSubagent ? { isSubagent: true } : {}),
      });
    }
    return;
  }
  if (d.type === "turn_context") { if (p.model) fc.model = p.model; return; }
  const ms = Date.parse(d.timestamp);
  if (!ms || (d.type !== "event_msg" && d.type !== "response_item")) return;
  const sid = fc.sid;
  const tokUsage = d.type === "event_msg" && p.type === "token_count" && p.info && p.info.total_token_usage;
  const isDialogue = d.type === "response_item"
    ? (p.type === "message" || p.type === "function_call" || p.type === "custom_tool_call" || p.type === "local_shell_call")
    : (d.type === "event_msg" && ["task_started", "user_message", "agent_message", "task_complete", "turn_aborted", "error"].includes(p.type));
  if (usage.stale("codex", ms)) {
    if (tokUsage) fc.tot = { out: tokUsage.output_tokens || 0, fresh: Math.max(0, (tokUsage.input_tokens || 0) - (tokUsage.cached_input_tokens || 0)), cached: tokUsage.cached_input_tokens || 0 };
    return;
  }
  if (!isDialogue && !tokUsage) return;
  let tokMsg = null;
  if (tokUsage) {
    const prev = fc.tot || { out: 0, fresh: 0, cached: 0 };
    const cur = { out: tokUsage.output_tokens || 0, fresh: Math.max(0, (tokUsage.input_tokens || 0) - (tokUsage.cached_input_tokens || 0)), cached: tokUsage.cached_input_tokens || 0 };
    const out = Math.max(0, cur.out - prev.out), fresh = Math.max(0, cur.fresh - prev.fresh), cached = Math.max(0, cur.cached - prev.cached);
    fc.tot = cur;
    if (!out && !fresh && !cached) return;
    tokMsg = { out, fresh, cached };
  }
  const { key, day, s } = usage.touchSess(fc, touched, ms, sid, fc.cwd, fc.app);
  const v = usage.liveOf(fc, sid, ms);
  v.cwd = fc.cwd; v.app = fc.app; v.title = usage.titles.get(sid) || v.title;
  if (d.type === "event_msg") {
    if (p.type === "task_complete") v.state = fc.parentSid ? "done" : "wait";
    else if (p.type === "turn_aborted") v.state = "cancelled";
    else if (p.type === "error") { v.state = "error"; v.err = String(p.message || "").replace(/\s+/g, " ").slice(0, 80); }
    else if (p.type === "task_started" || p.type === "user_message") v.state = "run";
    else if (p.type === "agent_message" && p.message) v.lastText = String(p.message);
  }
  if (d.type === "response_item") {
    if (p.type === "message" && p.role === "user") {
      const text = cleanUserPrompt((Array.isArray(p.content) ? p.content : []).filter((b) => b && b.type === "input_text").map((b) => b.text || "").join(""));
      if (text && isPromptText(text)) {
        day.prompts++;
        startRound(fc, ms, text, String(ms), v);
        v.turns = fc.rounds ? fc.rounds.list.length : 0;
        v.rounds = fc.rounds ? fc.rounds.list : [];
        if (s.text.length < 300) s.text += (s.text ? " / " : "") + text.replace(/\s+/g, " ").slice(0, 300 - s.text.length);
      }
    }
    if (p.type === "message" && p.role === "assistant") {
      const text = (Array.isArray(p.content) ? p.content : []).filter((b) => b && (b.type === "output_text" || b.type === "text")).map((b) => b.text || "").join(" ");
      if (text) v.lastText = text;
    }
    if (p.type === "function_call" || p.type === "custom_tool_call" || p.type === "local_shell_call") {
      let a = {};
      try { a = typeof p.arguments === "string" ? JSON.parse(p.arguments) : p.arguments || p.action || {}; } catch { /* not JSON */ }
      v.step = stepText(p.name || p.type, a);
      v.state = "run";
    }
  }
  if (v.lastText || v.state === "wait" || v.state === "done") {
    finishRound(fc, ms, v.lastText, v.state === "wait" || v.state === "done");
    v.turns = fc.rounds ? fc.rounds.list.length : 0;
    v.rounds = fc.rounds ? fc.rounds.list : [];
  }
  const meta = usage.meta.get(sid) || {};
  if (tokMsg) {
    const m = { key, sid, proj: s.proj, model: fc.model, ...tokMsg, at: ms };
    fc.msgs.set(`codex:${fc.id}:${fc.msgs.size}`, m);
    usage.noteMeta(fc, sid, { title: v.title, text: s.text, cwd: fc.cwd, app: fc.app, model: fc.model, lastAt: Math.max(ms, meta.lastAt || 0), out: (meta.out || 0) + m.out, fresh: (meta.fresh || 0) + m.fresh, cached: (meta.cached || 0) + m.cached, calls: (meta.calls || 0) + 1, state: v.state, step: v.step, todo: v.todo, turns: v.turns, rounds: v.rounds, lastText: v.lastText });
  } else if (isDialogue) {
    usage.noteMeta(fc, sid, { title: v.title, text: s.text, cwd: fc.cwd, app: fc.app, model: fc.model || meta.model, lastAt: Math.max(ms, meta.lastAt || 0), state: v.state, step: v.step, err: v.err, todo: v.todo, turns: v.turns, rounds: v.rounds, lastText: v.lastText });
  }
}

// ---- WorkBuddy ----
export function ingestWorkbuddyLine(ctx, line, fc, touched) {
  const usage = ctx.usage;
  let d;
  try { d = JSON.parse(line); } catch { return; }
  if (d.type === "ai-title") {
    if (d.aiTitle) {
      if (usage.noteClientTitle) usage.noteClientTitle(fc.sid, d.aiTitle, { fc });
      else {
        fc.titles.set(fc.sid, d.aiTitle);
        usage.titles.set(fc.sid, d.aiTitle);
        const m = usage.meta.get(fc.sid); if (m) m.title = d.aiTitle;
      }
    }
    return;
  }
  if (!["message", "reasoning", "function_call", "function_call_result"].includes(d.type) || !+d.timestamp) return;
  const ms = +d.timestamp;
  if (usage.stale("workbuddy", ms)) return;
  if (/(?:^|[\\/])agent-deck-autolog(?:[\\/]|$)/.test(String(d.cwd || fc.cwd || fc.path || ""))) return;
  const wbDb = usage.wbMeta.get(fc.sid);
  const rawCwd = d.cwd || fc.cwd || (wbDb && wbDb.cwd) || "";
  const effCwd = (wbDb && wbDb.groupTitle && (!rawCwd || /\/WorkBuddy\/\d{4}-\d\d-\d\d/.test(rawCwd))) ? wbDb.groupTitle : rawCwd;
  fc.cwd = effCwd || fc.cwd;
  const wbApp = /(?:^|[\\/])\.codebuddy(?:[\\/]|$)/.test(String(fc.path || "")) ? "cli" : "workbuddy";
  const { key, day, s } = usage.touchSess(fc, touched, ms, fc.sid, fc.cwd, wbApp);
  const v = usage.liveOf(fc, fc.sid, ms);
  v.title = usage.titles.get(fc.sid) || fc.titles.get(fc.sid) || (wbDb && wbDb.title) || v.title;
  v.cwd = fc.cwd;
  if (wbDb && wbDb.model && wbDb.model !== "auto" && !v.model) v.model = wbDb.model;
  if (d.type === "message") {
    v.state = d.role === "assistant" ? ((d.status === "failed" || d.status === "error") ? "error" : "wait") : "run";
    if (d.role === "assistant") {
      v.step = "";
      const text = (Array.isArray(d.content) ? d.content : []).filter((b) => b && (b.type === "output_text" || b.type === "text")).map((b) => b.text || "").join(" ").trim();
      if (text) v.lastText = text;
      finishRound(fc, ms, v.lastText, v.state === "wait");
    }
    if (d.role === "user") {
      const raw = (Array.isArray(d.content) ? d.content : []).filter((b) => b && (b.type === "input_text" || b.type === "text")).map((b) => b.text || "").join("\n");
      const text = cleanUserPrompt(raw);
      if (isPromptText(text)) {
        day.prompts++;
        startRound(fc, ms, text, d.id || String(ms), v);
        if (!v.title) {
          const t0 = text.replace(/\s+/g, " ").trim().slice(0, 80);
          if (t0) { fc.titles.set(fc.sid, t0); v.title = t0; }
        }
        if (s.text.length < 300) s.text += (s.text ? " / " : "") + text.replace(/\s+/g, " ").slice(0, 300 - s.text.length);
      }
    }
    v.turns = fc.rounds ? fc.rounds.list.length : 0;
    v.rounds = fc.rounds ? fc.rounds.list : [];
  } else if (d.type === "reasoning") {
    v.state = "run";
    if (!v.step) v.step = t("思考中…");
  } else if (d.type === "function_call") {
    v.state = "run";
    let a = {};
    try { a = typeof d.arguments === "string" ? JSON.parse(d.arguments) : d.arguments || {}; } catch { /* not JSON */ }
    v.step = stepText(d.name, a);
  } else if (d.type === "function_call_result") {
    v.state = (d.status === "failed" || d.status === "error") ? "error" : "run";
  }
  const pd = d.providerData || {}, u = pd.usage;
  const mod = pd.requestModelName || pd.model || v.model;
  if (mod) v.model = mod;
  const meta = usage.meta.get(fc.sid) || {};
  if (u && pd.messageId) {
    const cached = (u.inputTokensDetails || []).reduce((k, x) => k + ((x && x.cached_tokens) || 0), 0);
    const id = "wb:" + pd.messageId;
    const prev = fc.msgs.get(id) || { out: 0, fresh: 0, cached: 0 };
    const m = { key, sid: fc.sid, proj: s.proj, model: v.model, out: u.outputTokens || 0, fresh: Math.max(0, (u.inputTokens || 0) - cached), cached, at: ms };
    fc.msgs.set(id, m);
    usage.noteMeta(fc, fc.sid, {
      title: v.title, text: s.text, cwd: v.cwd, app: wbApp, model: m.model,
      lastAt: Math.max(ms, meta.lastAt || 0),
      out: (meta.out || 0) - prev.out + m.out,
      fresh: (meta.fresh || 0) - prev.fresh + m.fresh,
      cached: (meta.cached || 0) - prev.cached + m.cached,
      calls: (meta.calls || 0) + (prev.out || prev.fresh || prev.cached ? 0 : 1),
      state: v.state, step: v.step, todo: v.todo, turns: v.turns, rounds: v.rounds, lastText: v.lastText,
    });
  } else {
    usage.noteMeta(fc, fc.sid, {
      title: v.title, text: s.text, cwd: v.cwd, app: wbApp, model: v.model || meta.model,
      lastAt: Math.max(ms, meta.lastAt || 0),
      state: v.state, step: v.step, todo: v.todo, turns: v.turns, rounds: v.rounds, lastText: v.lastText,
    });
  }
}

// ---- Antigravity ----
export function ingestAntigravityLine(ctx, line, fc, touched) {
  const usage = ctx.usage;
  let d;
  try { d = JSON.parse(line); } catch { return; }
  const ms = Date.parse(d.created_at);
  if (!ms || usage.stale("antigravity", ms)) return;
  const sid = fc.sid;
  if (d.type === "USER_INPUT") {
    const raw = String(d.content || "");
    const mMod = /Model Selection` from `[^`]*` to `([^`]+)`/.exec(raw);
    if (mMod) fc.model = mMod[1];
    const text = cleanUserPrompt(raw);
    const mPath = /@\[((?:[A-Za-z]:[\\/]|\/)[^\]]+)\]/.exec(text) || /((?:\/Users\/|[A-Za-z]:[\\/])[^\s`"'<>)\]]+)/.exec(text);
    if (mPath && !fc.cwd) {
      fc.cwd = ctx.inferWorkspaceRoot(mPath[1]);
    }
    const { day, s } = usage.touchSess(fc, touched, ms, sid, fc.cwd || "~", "antigravity");
    const v = usage.liveOf(fc, sid, ms);
    v.cwd = fc.cwd || "~"; v.app = "antigravity";
    if (text && isPromptText(text)) {
      day.prompts++;
      startRound(fc, ms, text, String(d.step_index ?? ms), v);
      v.turns = fc.rounds ? fc.rounds.list.length : 0;
      v.rounds = fc.rounds ? fc.rounds.list : [];
      if (!fc.titles.has(sid)) {
        const t0 = text.replace(/^@\[[^\]]+\]\s*/, "").replace(/\s+/g, " ").trim().slice(0, 80);
        if (t0) fc.titles.set(sid, t0);
      }
      if (s.text.length < 300) s.text += (s.text ? " / " : "") + text.replace(/\s+/g, " ").slice(0, 300 - s.text.length);
    }
    v.title = usage.titles.get(sid) || fc.titles.get(sid) || v.title;
    v.state = "run"; v.step = "";
    usage.noteMeta(fc, sid, { title: v.title, text: s.text, cwd: v.cwd, app: "antigravity", model: fc.model || v.model || "antigravity", lastAt: Math.max(ms, usage.meta.get(sid)?.lastAt || 0), state: v.state, step: v.step, todo: v.todo, turns: v.turns, rounds: v.rounds });
    return;
  }
  if (d.type !== "PLANNER_RESPONSE" && d.status !== "ERROR") return;
  const { key, s } = usage.touchSess(fc, touched, ms, sid, fc.cwd || "~", "antigravity");
  const v = usage.liveOf(fc, sid, ms);
  v.title = usage.titles.get(sid) || fc.titles.get(sid) || v.title;
  if (fc.model) v.model = fc.model;
  if (d.type === "PLANNER_RESPONSE") {
    const tools = Array.isArray(d.tool_calls) ? d.tool_calls : [];
    if (tools.length) {
      v.state = "run";
      for (const tc of tools) {
        const inp = unquoteArgs(tc.args);
        const p0 = inp.Path || inp.TargetFile || inp.SearchPath || inp.DirectoryPath || "";
        if (p0 && typeof p0 === "string" && (p0.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p0)) && (!fc.cwd || fc.cwd === "~") && !p0.replace(/\\/g, "/").includes("/.gemini/")) {
          fc.cwd = ctx.inferWorkspaceRoot(p0);
          s.cwd = fc.cwd; s.proj = ctx.projectName(fc.cwd);
        }
        v.step = stepText(tc.name, inp);
      }
    } else {
      v.state = d.status === "ERROR" ? "error" : d.status === "RUNNING" ? "run" : "wait";
      if (v.state === "wait") v.step = "";
      if (typeof d.content === "string" && d.content.trim()) v.lastText = d.content.trim();
      finishRound(fc, ms, v.lastText, v.state === "wait");
      v.turns = fc.rounds ? fc.rounds.list.length : 0;
      v.rounds = fc.rounds ? fc.rounds.list : [];
    }
  } else if (d.status === "ERROR") {
    v.state = "error";
    v.err = String(d.content || "").replace(/\s+/g, " ").slice(0, 120);
  }
  v.cwd = fc.cwd || "~"; v.app = "antigravity";
  const out = d.output_tokens || 0, fresh = d.input_tokens || 0, cached = d.cache_read_tokens || 0;
  const meta = usage.meta.get(sid) || {};
  if (out || fresh || cached) {
    const id = `ag:${sid}:${d.step_index ?? fc.msgs.size}`;
    const prev = fc.msgs.get(id) || { out: 0, fresh: 0, cached: 0 };
    const m = { key, sid, proj: s.proj, model: v.model || "antigravity", out, fresh, cached, at: ms };
    fc.msgs.set(id, m);
    usage.noteMeta(fc, sid, {
      title: v.title, text: s.text, cwd: v.cwd, app: "antigravity", model: m.model,
      lastAt: Math.max(ms, meta.lastAt || 0),
      out: (meta.out || 0) - prev.out + m.out,
      fresh: (meta.fresh || 0) - prev.fresh + m.fresh,
      cached: (meta.cached || 0) - prev.cached + m.cached,
      calls: (meta.calls || 0) + (prev.out || prev.fresh || prev.cached ? 0 : 1),
      state: v.state, step: v.step, todo: v.todo, turns: v.turns, rounds: v.rounds, lastText: v.lastText, err: v.err,
    });
  } else {
    usage.noteMeta(fc, sid, {
      title: v.title, text: s.text, cwd: v.cwd, app: "antigravity", model: v.model || meta.model || "antigravity",
      lastAt: Math.max(ms, meta.lastAt || 0),
      state: v.state, step: v.step, todo: v.todo, turns: v.turns, rounds: v.rounds, lastText: v.lastText, err: v.err,
    });
  }
}

// ---- DeepSeek Harness ----
export function ingestDshLine(ctx, line, fc, touched) {
  if (!line) return;
  const usage = ctx.usage;
  let d;
  try { d = JSON.parse(line); } catch { return; }
  const typ = d.type;
  const ms = +d.time || Date.parse(d.timestamp) || 0;
  if (typ === "session") {
    fc.sid = d.id || fc.sid;
    fc.cwd = d.cwd || fc.cwd;
    fc.app = "dsh";
    fc.createdAt = d.createdAt || fc.createdAt;
    if (d.parentSession) fc.parentSid = String(d.parentSession);   // 子代理（delegationDepth ≥ 1）挂在母会话下面
    if (Number(d.delegationDepth) > 0) fc.isSubagent = true;
    const existing = usage.meta.get(fc.sid);
    usage.noteMeta(fc, fc.sid, { cwd: fc.cwd, app: "dsh", lastAt: existing?.lastAt || ms || d.createdAt || 0, ...(fc.parentSid ? { parentSid: fc.parentSid } : {}), ...(fc.isSubagent ? { isSubagent: true } : {}) });
    return;
  }
  if (!ms) return;
  if (typ === "session/title") {
    const title = d.data && d.data.title;
    if (title) {
      if (usage.noteClientTitle) usage.noteClientTitle(fc.sid, title, { fc });
      else {
        fc.titles.set(fc.sid, title);
        usage.titles.set(fc.sid, title);
        const m = usage.meta.get(fc.sid); if (m) m.title = title;
      }
    }
    return;
  }
  if (!DSH_TOUCH.has(typ) || usage.stale("dsh", ms)) return;
  const sid = fc.sid;
  const { key, day, s } = usage.touchSess(fc, touched, ms, sid, fc.cwd, "dsh");
  const v = usage.liveOf(fc, sid, ms);
  v.cwd = fc.cwd;
  v.title = fc.titles.get(sid) || v.title;
  const data = d.data || {};
  if (typ === "user/message") {
    const content = data.message ? data.message.content : data.content;
    const text = Array.isArray(content) ? content.filter((b) => b && b.type === "text").map((b) => b.text || "").join("") : String(content || "");
    // DSH writes its own bookkeeping as user-role messages (time context, skill
    // catalogue, …). Only what the person typed is a prompt.
    const kind = data.source && data.source.kind;
    if (isPromptText(text) && (!kind || kind === "user")) {
      day.prompts++;
      startRound(fc, ms, text, String(d.seq ?? ms), v);
      v.turns = fc.rounds ? fc.rounds.list.length : 0;
      v.rounds = fc.rounds ? fc.rounds.list : [];
      if (s.text.length < 300) s.text += (s.text ? " / " : "") + text.replace(/\s+/g, " ").slice(0, 300 - s.text.length);
      v.state = "run";
      usage.noteMeta(fc, sid, { title: v.title, text: s.text, cwd: fc.cwd, app: "dsh", lastAt: Math.max(ms, usage.meta.get(sid)?.lastAt || 0), state: "run", turns: v.turns, rounds: v.rounds });
    }
  } else if (typ === "turn/start") {
    v.state = "run"; v.err = "";
  } else if (typ === "step/start") {
    v.state = "run";
  } else if (typ === "tool/call") {
    v.state = "run";
    let a = {};
    try { a = typeof data.arguments === "string" ? JSON.parse(data.arguments) : data.arguments || {}; } catch { /* not JSON */ }
    v.step = stepText(data.name, a);
  } else if (typ === "assistant/message") {
    v.state = "run";
    const msg = data.message || {};
    const content = msg.content || [];
    for (const b of Array.isArray(content) ? content : []) {
      if (b.type === "text" && b.text) v.lastText = b.text;
      if (b.type === "tool-call" || b.type === "tool_use") v.step = stepText(b.name, b.arguments || b.input);
    }
    finishRound(fc, ms, v.lastText, false);
    v.turns = fc.rounds ? fc.rounds.list.length : 0;
    v.rounds = fc.rounds ? fc.rounds.list : [];
    const src = msg.source || {};
    if (src.model) v.model = src.model;
    const u = data.usage;
    const meta = usage.meta.get(sid) || {};
    if (u && (u.outputTokens || u.inputTokens || u.cacheReadTokens)) {
      const id = msg.id || `dsh:${sid}:${d.seq ?? fc.msgs.size}`;
      const m = {
        key, sid, proj: s.proj, model: src.model || v.model,
        out: u.outputTokens || 0,
        fresh: (u.inputTokens || 0) + (u.cacheWriteTokens || 0),
        cached: u.cacheReadTokens || 0,
        at: ms,
      };
      fc.msgs.set(id, m);
      usage.noteMeta(fc, sid, { title: v.title, text: s.text, cwd: fc.cwd, app: "dsh", model: m.model, lastAt: Math.max(ms, meta.lastAt || 0), out: (meta.out || 0) + m.out, fresh: (meta.fresh || 0) + m.fresh, cached: (meta.cached || 0) + m.cached, calls: (meta.calls || 0) + 1, state: v.state, step: v.step, todo: v.todo, turns: v.turns, rounds: v.rounds, lastText: v.lastText });
    } else {
      usage.noteMeta(fc, sid, { title: v.title, text: s.text, cwd: fc.cwd, app: "dsh", model: v.model || meta.model, lastAt: Math.max(ms, meta.lastAt || 0), state: v.state, step: v.step, todo: v.todo, turns: v.turns, rounds: v.rounds, lastText: v.lastText });
    }
  } else if (typ === "turn/end") {
    const reason = data.reason || {};
    const isChild = !!(fc.parentSid || fc.isSubagent);
    const errText = String((reason.error && (reason.error.message || reason.error.code)) || "");
    // 额度不够和普通报错不是一回事：前者要落到 HITLIMIT，而不是 ERRORED。
    const quota = reason.kind === "error" && /ACCOUNT_QUOTA|Insufficient Balance|\b402\b|quota|rate.?limit|额度|余额/i.test(`${errText} ${reason.error?.code || ""}`);
    if (reason.kind === "error") { v.state = quota ? "limit" : "error"; v.err = errText.slice(0, 120); }
    else if (reason.kind === "aborted") v.state = "cancelled";
    else v.state = isChild ? "done" : "wait";
    // 这一轮为什么会没有正文：整轮被中断 / 额度断掉，留给日记显式记一句。
    const cur = fc.rounds && fc.rounds.list[fc.rounds.list.length - 1];
    if (cur) {
      if (reason.kind === "aborted") cur.aborted = true;
      if (quota) cur.quota = true;
    }
    v.step = "";
    finishRound(fc, ms, v.lastText, v.state === "wait" || v.state === "done");
    v.turns = fc.rounds ? fc.rounds.list.length : 0;
    v.rounds = fc.rounds ? fc.rounds.list : [];
    const meta = usage.meta.get(sid) || {};
    usage.noteMeta(fc, sid, { title: v.title, text: s.text, cwd: fc.cwd, app: "dsh", model: v.model || meta.model, state: v.state, step: "", err: v.err, turns: v.turns, rounds: v.rounds, lastAt: Math.max(ms, meta.lastAt || 0) });
  }
}

export function ingestCursorLine(ctx, line, fc, touched) {
  let d;
  try { d = JSON.parse(line); } catch { return; }
  ingestCursorEvent(ctx, d, fc, touched);
}

export function ingestTraeLine(ctx, line, fc, touched) {
  let d;
  try { d = JSON.parse(line); } catch { return; }
  ingestTraeEvent(ctx, d, fc, touched);
}

const CUSTOM_INGESTORS = new Map();

export const BUILTIN_AGENT_INGESTORS = {
  claude: ingestClaudeLine,
  qoder: ingestClaudeLine,
  qwenwork: ingestClaudeLine,
  codex: ingestCodexLine,
  workbuddy: ingestWorkbuddyLine,
  antigravity: ingestAntigravityLine,
  cursor: ingestCursorLine,
  trae: ingestTraeLine,
  dsh: ingestDshLine,
};

export function registerAgentIngestor(agent, ingestFn) {
  const id = String(agent || "").trim();
  if (!id || typeof ingestFn !== "function") throw new Error("Agent ingestor requires agent id and function");
  CUSTOM_INGESTORS.set(id, ingestFn);
  return () => CUSTOM_INGESTORS.delete(id);
}

export function getAgentIngestor(agent) {
  return CUSTOM_INGESTORS.get(agent) || BUILTIN_AGENT_INGESTORS[agent] || null;
}

export function ingestAgentLine(agent, ctx, line, fc, touched) {
  const fn = getAgentIngestor(agent);
  if (fn) return fn(ctx, line, fc, touched);
}
