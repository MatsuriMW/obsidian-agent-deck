// Desktop databases are read in a transaction; no daemon, model call or database write.
import fs from "fs";
import { execFile } from "child_process";

const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const json = (value, fallback = {}) => { try { return typeof value === "string" ? JSON.parse(value) : value || fallback; } catch { return fallback; } };
export const desktopTime = (value) => typeof value === "number" ? value : Date.parse(value) || 0;
const modelName = (value) => { const m = json(value, value); return typeof m === "string" ? m : m?.modelID || m?.id || ""; };

export function desktopQuery(db, sql) {
  if (!fs.existsSync(db)) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/sqlite3", ["-readonly", "-json", "-cmd", ".timeout 2000", db, `BEGIN; ${sql}; COMMIT;`], { timeout: 10000, maxBuffer: 64 << 20 }, (err, out) => {
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
  const [table, message, part] = await openCodeTables(db);
  const rows = await desktopQuery(db, `SELECT *, max(time_updated, coalesce((SELECT max(time_updated) FROM ${message} m WHERE m.session_id=${table}.id),0), coalesce((SELECT max(time_updated) FROM ${part} p WHERE p.session_id=${table}.id),0)) AS revision FROM ${table} WHERE revision >= ${Math.floor(since)}`);
  return rows.map((s) => ({ sid: s.id, title: s.title || "", cwd: s.directory, parentSid: s.parent_id || "", model: modelName(s.model), startedAt: s.time_created, updatedAt: s.time_updated, revision: s.revision, archived: !!s.time_archived,
    state: s.time_busy > (s.time_idle || 0) ? "run" : s.idle_outcome === "error" ? "error" : "", }));
}

export async function desktopMessages(db, agent, sid) {
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
    const text = typeof d.text === "string" ? d.text : (Array.isArray(content) ? content : []).filter((p) => p.type === "text" && !p.synthetic && !p.ignored).map((p) => p.text || "").join("\n");
    const tool = [...(Array.isArray(content) ? content : []), ...(d.tools || [])].filter((p) => p.type === "tool" || p.name).at(-1);
    const tokens = d.tokens;
    const completed = desktopTime(d.completedAt || d.time?.completed);
    const state = role === "user" ? "run" : row.status === "failed" || d.error ? "error" : row.status === "interrupted" ? "wait" : completed || d.finish && d.finish !== "tool-calls" ? "wait" : "run";
    return [{ id: row.id, role, text, at: desktopTime(d.timestamp || d.time?.created || row.created), end: completed, updated: row.updated, state,
      step: state === "run" ? tool?.name || tool?.tool || "" : "", error: d.error ? JSON.stringify(d.error).slice(0, 200) : "", model: modelName(d.model || d.modelID),
      out: Number(tokens?.output) || 0, fresh: (Number(tokens?.input) || 0) + (Number(tokens?.cache?.write) || 0), cached: Number(tokens?.cache?.read) || 0 }];
  });
}
