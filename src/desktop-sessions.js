// Desktop databases are read in a transaction; no daemon, model call or database write.
import fs from "fs";
import { execFile } from "child_process";
import { resolveSqliteBinary } from "./sqlite.js";
import { stripQwenWorkContext } from "./prompt-text.js";

const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const json = (value, fallback = {}) => { try { return typeof value === "string" ? JSON.parse(value) : value || fallback; } catch { return fallback; } };
export const desktopTime = (value) => typeof value === "number" ? value : Date.parse(value) || 0;
export const hermesTime = (value) => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const modelName = (value) => { const m = json(value, value); return typeof m === "string" ? m : m?.modelID || m?.id || ""; };

function extractMinimaxText(d) {
  if (!d || typeof d !== "object") return "";
  if (typeof d.msg_content === "string") return d.msg_content;
  if (typeof d.text === "string") return d.text;
  if (typeof d.content === "string") return d.content;
  if (Array.isArray(d.content)) {
    return d.content
      .filter((p) => p && (p.type === "text" || p.type === "output_text" || p.type === "input_text") && !p.synthetic && !p.ignored)
      .map((p) => p.text || "")
      .join("\n");
  }
  return "";
}

function extractMinimaxTool(d) {
  if (!d || typeof d !== "object") return "";
  const calls = Array.isArray(d.tool_calls) ? d.tool_calls : [];
  if (calls.length) {
    const last = calls[calls.length - 1];
    return last?.function?.name || last?.name || last?.tool_name || "";
  }
  if (Array.isArray(d.content)) {
    const last = d.content.filter((p) => p && (p.type === "tool_use" || p.type === "tool" || p.name)).at(-1);
    return last?.name || last?.tool || "";
  }
  return "";
}

export function desktopQuery(db, sql) {
  if (!fs.existsSync(db)) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    execFile(resolveSqliteBinary(), ["-readonly", "-json", "-cmd", ".timeout 2000", db, `BEGIN; ${sql}; COMMIT;`], { timeout: 10000, maxBuffer: 64 << 20 }, (err, out) => {
      if (err) return reject(err);
      try { resolve(JSON.parse(out || "[]")); } catch (e) { reject(e); }
    });
  });
}

async function openCodeTables(db) {
  const tables = await desktopQuery(db, "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('session_v2','session')");
  const v2 = tables.some((t) => t.name === "session_v2");
  return v2 ? ["session_v2", "session_message", "session_part"] : ["session", "message", "part"];
}

export async function desktopSessions(db, agent, since) {
  if (agent === "qoder") return desktopQuery(db, `SELECT session_id AS sid,title,cwd,owner_session_id AS parentSid,model,created_at AS startedAt,updated_at AS updatedAt,archived,deleted_at AS deletedAt, max(updated_at, coalesce((SELECT max(updated_at) FROM chat_session_messages m WHERE m.session_id=chat_sessions.session_id),0)) AS revision FROM chat_sessions WHERE revision >= ${Math.floor(since)}`);
  if (agent === "hermes") {
    const sinceSec = since > 0 ? Math.floor(since / 1000) : 0;
    const rows = await desktopQuery(db, `SELECT s.id AS sid, COALESCE(s.title, '') AS title, COALESCE(s.cwd, '') AS cwd, COALESCE(s.parent_session_id, '') AS parentSid,
      COALESCE(s.model, '') AS model, COALESCE(s.source, '') AS source, s.started_at AS startedAt, s.ended_at AS endedAt, COALESCE(s.end_reason, '') AS endReason,
      s.last_activity_at AS updatedAt, COALESCE(s.archived, 0) AS archived,
      COALESCE(s.input_tokens, 0) AS inputTokens, COALESCE(s.output_tokens, 0) AS outputTokens,
      COALESCE(s.cache_read_tokens, 0) AS cacheReadTokens, COALESCE(s.cache_write_tokens, 0) AS cacheWriteTokens,
      COALESCE((SELECT role FROM messages m WHERE m.session_id=s.id AND (m.active=1 OR m.compacted=1) ORDER BY m.id DESC LIMIT 1), '') AS lastRole,
      COALESCE((SELECT finish_reason FROM messages m WHERE m.session_id=s.id AND (m.active=1 OR m.compacted=1) ORDER BY m.id DESC LIMIT 1), '') AS lastFinish,
      CAST(MAX(COALESCE(s.last_activity_at, 0), COALESCE(s.ended_at, 0), COALESCE(s.started_at, 0)) * 1000 AS INTEGER) + COALESCE(s.message_count, 0) + COALESCE(s.output_tokens, 0) + COALESCE(s.archived, 0) * 1000000 AS revision
      FROM sessions s WHERE COALESCE(s.hidden, 0) = 0 AND MAX(COALESCE(s.last_activity_at, 0), COALESCE(s.ended_at, 0), COALESCE(s.started_at, 0)) >= ${sinceSec}`);
    return rows.map((s) => {
      const ended = hermesTime(s.endedAt);
      const startedAt = hermesTime(s.startedAt);
      const updatedAt = hermesTime(s.updatedAt) || ended || startedAt;
      const reason = String(s.endReason || "");
      const running = !ended && !reason && (s.lastRole === "user" || s.lastRole === "tool" || s.lastFinish === "tool_calls");
      return {
        sid: s.sid,
        title: s.title || "",
        cwd: s.cwd || "",
        parentSid: s.parentSid || "",
        model: s.model || "",
        app: /^acp$/i.test(String(s.source || "")) ? "acp" : "cli",
        startedAt,
        updatedAt,
        revision: Number(s.revision) || updatedAt,
        archived: !!s.archived,
        state: ended || reason ? (/error|fail|abort/i.test(reason) ? "error" : "wait") : running ? "run" : "wait",
        out: Number(s.outputTokens) || 0,
        fresh: (Number(s.inputTokens) || 0) + (Number(s.cacheWriteTokens) || 0),
        cached: Number(s.cacheReadTokens) || 0,
      };
    });
  }
  if (agent === "minimax") {
    const sinceMs = Math.max(0, Math.floor(since || 0));
    const rows = await desktopQuery(db, `SELECT s.session_id AS sid,
      COALESCE(s.title, '') AS title,
      COALESCE(NULLIF(s.workspace_dir, ''), NULLIF(s.project_workspace_dir, ''), (SELECT p.workspace_dir FROM local_runtime_projects p WHERE p.project_id = s.project_id LIMIT 1), '') AS cwd,
      COALESCE(s.parent_session_id, '') AS parentSid,
      COALESCE((SELECT t.model FROM local_runtime_token_usage t WHERE t.session_id = s.session_id AND COALESCE(t.model, '') <> '' ORDER BY t.ts DESC, t.id DESC LIMIT 1), '') AS model,
      COALESCE(s.runtime, '') AS runtime,
      COALESCE(s.session_type, '') AS sessionType,
      COALESCE(s.status, '') AS status,
      COALESCE(s.archived, 0) AS archived,
      COALESCE(s.created_at_ms, 0) AS startedAt,
      COALESCE(s.updated_at_ms, s.created_at_ms, 0) AS updatedAt,
      COALESCE(s.error_message, '') AS errorMessage,
      COALESCE((SELECT SUM(t.output_tokens) FROM local_runtime_token_usage t WHERE t.session_id = s.session_id), 0) AS outputTokens,
      COALESCE((SELECT SUM(t.input_tokens + t.cache_write_tokens) FROM local_runtime_token_usage t WHERE t.session_id = s.session_id), 0) AS freshTokens,
      COALESCE((SELECT SUM(t.cache_read_tokens) FROM local_runtime_token_usage t WHERE t.session_id = s.session_id), 0) AS cacheReadTokens,
      MAX(
        COALESCE(s.updated_at_ms, 0),
        COALESCE(s.created_at_ms, 0),
        COALESCE((SELECT MAX(m.created_at_ms) FROM local_runtime_message_rows m WHERE m.session_id = s.session_id), 0),
        COALESCE((SELECT MAX(t.ts) FROM local_runtime_token_usage t WHERE t.session_id = s.session_id), 0)
      ) + COALESCE((SELECT COUNT(*) FROM local_runtime_message_rows m WHERE m.session_id = s.session_id), 0)
        + COALESCE((SELECT SUM(t.output_tokens) FROM local_runtime_token_usage t WHERE t.session_id = s.session_id), 0)
        + COALESCE(s.archived, 0) * 1000000 AS revision
      FROM local_runtime_sessions s
      WHERE COALESCE(s.visibility, 'visible') != 'hidden'
        AND MAX(
          COALESCE(s.updated_at_ms, 0),
          COALESCE(s.created_at_ms, 0),
          COALESCE((SELECT MAX(m.created_at_ms) FROM local_runtime_message_rows m WHERE m.session_id = s.session_id), 0),
          COALESCE((SELECT MAX(t.ts) FROM local_runtime_token_usage t WHERE t.session_id = s.session_id), 0)
        ) >= ${sinceMs}`);
    return rows.map((s) => {
      const startedAt = desktopTime(s.startedAt);
      const updatedAt = desktopTime(s.updatedAt) || startedAt;
      const rt = `${s.runtime || ""} ${s.sessionType || ""}`;
      const status = String(s.status || "");
      const state = /run|busy|stream|working|pending|active/i.test(status)
        ? "run"
        : /error|fail/i.test(status) || s.errorMessage
          ? "error"
          : /cancel|abort/i.test(status)
            ? "cancelled"
            : "";
      return {
        sid: s.sid,
        title: s.title || "",
        cwd: s.cwd || "",
        parentSid: s.parentSid || "",
        model: s.model || "",
        app: /\bacp\b/i.test(rt) ? "acp" : /\bcli\b/i.test(rt) ? "cli" : "desktop",
        startedAt,
        updatedAt,
        revision: Number(s.revision) || updatedAt,
        archived: !!s.archived,
        state,
        out: Number(s.outputTokens) || 0,
        fresh: Number(s.freshTokens) || 0,
        cached: Number(s.cacheReadTokens) || 0,
      };
    });
  }
  const [table, message, part] = await openCodeTables(db);
  const rows = await desktopQuery(db, `SELECT *, max(time_updated, coalesce((SELECT max(time_updated) FROM ${message} m WHERE m.session_id=${table}.id),0), coalesce((SELECT max(time_updated) FROM ${part} p WHERE p.session_id=${table}.id),0)) AS revision FROM ${table} WHERE revision >= ${Math.floor(since)}`);
  return rows.map((s) => ({ sid: s.id, title: s.title || "", cwd: s.directory, parentSid: s.parent_id || "", model: modelName(s.model), startedAt: s.time_created, updatedAt: s.time_updated, revision: s.revision, archived: !!s.time_archived,
    state: s.time_busy > (s.time_idle || 0) ? "run" : s.idle_outcome === "error" ? "error" : "", }));
}

export async function desktopMessages(db, agent, sid) {
  if (agent === "hermes") {
    const rows = await desktopQuery(db, `SELECT id, role, content, tool_calls AS toolCalls, tool_name AS toolName, timestamp AS created, finish_reason AS finishReason FROM messages WHERE session_id=${quote(sid)} AND (active=1 OR compacted=1) ORDER BY id`);
    return rows.flatMap((row) => {
      const role = row.role;
      const calls = json(row.toolCalls, []);
      const lastCall = Array.isArray(calls) && calls.length ? calls[calls.length - 1] : null;
      const tool = lastCall?.function?.name || lastCall?.name || row.toolName || "";
      const at = hermesTime(row.created);
      if (role !== "user" && role !== "assistant") return [];
      const text = typeof row.content === "string" ? row.content : "";
      const state = role === "user" || row.finishReason === "tool_calls" ? "run" : "wait";
      return [{ id: row.id, role, text, at, end: state === "wait" ? at : 0, updated: at, state, step: state === "run" ? tool : "", error: "", model: "", out: 0, fresh: 0, cached: 0 }];
    });
  }
  if (agent === "minimax") {
    let rows = await desktopQuery(db, `SELECT id, msg_id AS msgId, role, turn_id AS turnId, created_at_ms AS created, data_json AS data FROM local_runtime_message_rows WHERE session_id=${quote(sid)} ORDER BY id`);
    if (!rows.length) {
      const legacy = await desktopQuery(db, `SELECT display_messages_json AS display FROM local_runtime_messages WHERE session_id=${quote(sid)} LIMIT 1`);
      const arr = legacy.length ? json(legacy[0].display, []) : [];
      if (Array.isArray(arr)) {
        rows = arr.map((item, idx) => ({
          id: item?.msg_id || `legacy-${idx + 1}`,
          msgId: item?.msg_id || `legacy-${idx + 1}`,
          role: item?.role || "",
          turnId: item?.turn_id || item?.turnId || "",
          created: item?.timestamp || item?.created_at || 0,
          data: item,
        }));
      }
    }
    const tokenRows = await desktopQuery(db, `SELECT turn_id AS turnId, model, ts, input_tokens AS inputTokens, output_tokens AS outputTokens, cache_read_tokens AS cacheReadTokens, cache_write_tokens AS cacheWriteTokens FROM local_runtime_token_usage WHERE session_id=${quote(sid)} ORDER BY ts, id`);
    const usageByTurn = new Map();
    for (const t of tokenRows) {
      const key = String(t.turnId || "");
      if (!key) continue;
      const cur = usageByTurn.get(key) || { out: 0, fresh: 0, cached: 0, model: "" };
      cur.out += Number(t.outputTokens) || 0;
      cur.fresh += (Number(t.inputTokens) || 0) + (Number(t.cacheWriteTokens) || 0);
      cur.cached += Number(t.cacheReadTokens) || 0;
      if (t.model) cur.model = String(t.model);
      usageByTurn.set(key, cur);
    }
    const parsed = [];
    const lastAssistantByTurn = new Map();
    for (const row of rows) {
      const d = json(row.data);
      const rawRole = String(row.role || d.role || "").toLowerCase();
      const role = rawRole === "human" ? "user" : rawRole === "model" ? "assistant" : rawRole;
      if (role !== "user" && role !== "assistant") continue;
      const turnId = String(row.turnId || d.turn_id || d.turnId || "");
      const idx = parsed.length;
      parsed.push({ row, d, role, turnId });
      if (role === "assistant" && turnId) lastAssistantByTurn.set(turnId, idx);
    }
    return parsed.map(({ row, d, role, turnId }, idx) => {
      const text = extractMinimaxText(d);
      const tool = extractMinimaxTool(d);
      const finish = String(d.finish_reason || d.finishReason || "");
      const at = desktopTime(d.timestamp || d.created_at || row.created);
      const state = role === "user"
        ? "run"
        : finish === "error" || d.error
          ? "error"
          : finish === "tool_calls" || finish === "toolUse"
            ? "run"
            : "wait";
      const inlineUsage = d.usage && typeof d.usage === "object" ? d.usage : null;
      const turnUsage = role === "assistant" && turnId && lastAssistantByTurn.get(turnId) === idx ? usageByTurn.get(turnId) : null;
      const out = inlineUsage
        ? Number(inlineUsage.output_tokens ?? inlineUsage.outputTokens) || 0
        : Number(turnUsage?.out) || 0;
      const fresh = inlineUsage
        ? (Number(inlineUsage.input_tokens ?? inlineUsage.inputTokens) || 0) + (Number(inlineUsage.cache_write_tokens ?? inlineUsage.cacheWriteTokens) || 0)
        : Number(turnUsage?.fresh) || 0;
      const cached = inlineUsage
        ? Number(inlineUsage.cache_read_tokens ?? inlineUsage.cacheReadTokens) || 0
        : Number(turnUsage?.cached) || 0;
      const model = modelName(d.model || d.modelID) || turnUsage?.model || "";
      const errText = d.error ? (typeof d.error === "string" ? d.error : JSON.stringify(d.error)).slice(0, 200) : "";
      return {
        id: row.msgId || row.id,
        role,
        text,
        at,
        end: state === "wait" ? at : 0,
        updated: at,
        state,
        step: state === "run" ? tool : "",
        error: errText,
        model,
        out,
        fresh,
        cached,
      };
    });
  }
  let rows;
  if (agent === "qoder") {
    rows = await desktopQuery(db, `SELECT message_id AS id,payload_json AS data,status,created_at AS created,updated_at AS updated FROM chat_session_messages WHERE session_id=${quote(sid)} ORDER BY sequence`);
  } else {
    const [, message, part] = await openCodeTables(db);
    const v2 = message === "session_message";
    rows = await desktopQuery(db, `SELECT m.id,m.data,${v2 ? "m.type" : "''"} AS role,m.time_created AS created,m.time_updated AS updated,
      (SELECT json_group_array(json(p.data)) FROM (SELECT data FROM ${part} WHERE message_id=m.id ORDER BY ${v2 ? "ordinal" : "id"}) p) AS parts
      FROM ${message} m WHERE m.session_id=${quote(sid)} ORDER BY ${v2 ? "m.seq" : "m.time_created,m.id"}`);
  }
  return rows.flatMap((row) => {
    const d = json(row.data), role = row.role || d.role || d.type;
    if (!["user", "assistant"].includes(role)) return [];
    const parts = json(row.parts, []);
    const content = parts.length ? parts : d.content || [];
    const rawText = typeof d.text === "string" ? d.text : (Array.isArray(content) ? content : []).filter((p) => p.type === "text" && !p.synthetic && !p.ignored).map((p) => p.text || "").join("\n");
    const text = agent === "qwenwork" && role === "user" ? stripQwenWorkContext(rawText) : rawText;
    const tool = [...(Array.isArray(content) ? content : []), ...(d.tools || [])].filter((p) => p.type === "tool" || p.name).at(-1);
    const tokens = d.tokens;
    const completed = desktopTime(d.completedAt || d.time?.completed);
    const state = role === "user" ? "run" : row.status === "failed" || d.error ? "error" : row.status === "interrupted" ? "wait" : completed || d.finish && d.finish !== "tool-calls" ? "wait" : "run";
    return [{ id: row.id, role, text, at: desktopTime(d.timestamp || d.time?.created || row.created), end: completed, updated: row.updated, state,
      step: state === "run" ? tool?.name || tool?.tool || "" : "", error: d.error ? JSON.stringify(d.error).slice(0, 200) : "", model: modelName(d.model || d.modelID),
      out: Number(tokens?.output) || 0, fresh: (Number(tokens?.input) || 0) + (Number(tokens?.cache?.write) || 0), cached: Number(tokens?.cache?.read) || 0 }];
  });
}
