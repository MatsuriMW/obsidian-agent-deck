// Desktop databases are read in a transaction; no daemon, model call or database write.
import fs from "fs";
import path from "path";
import { querySqliteRowsStrict, toSqliteUriPath } from "./sqlite.js";
export { toSqliteUriPath };
import { stripQwenWorkContext, stripTeleAgentContext } from "./prompt-text.js";
import { cleanCindyText } from "./cindy-sessions.js";
import { extractOrcaMessageText } from "./orca-sessions.js";

const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const json = (value, fallback = {}) => { try { return typeof value === "string" ? JSON.parse(value) : value || fallback; } catch { return fallback; } };
export const desktopTime = (value) => typeof value === "number" ? value : Date.parse(value) || 0;
export const hermesTime = (value) => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
// 工具循环没有新 assistant 消息时，靠 part 的更新判断还活着；和 external-state 的 AI_IDLE_MIN 同量级。
const TOOL_LOOP_IDLE_MIN = 10;
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

export async function desktopQuery(db, sql) {
  return querySqliteRowsStrict(db, sql, { timeout: 10000, maxBuffer: 64 << 20, transaction: true });
}

async function openCodeTables(db) {
  const tables = await desktopQuery(db, "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('session_v2','session')");
  const v2 = tables.some((t) => t.name === "session_v2");
  return v2 ? ["session_v2", "session_message", "session_part"] : ["session", "message", "part"];
}

function extractT3TurnUsage(payload) {
  const u = payload?.turnTokenUsage && typeof payload.turnTokenUsage === "object"
    ? payload.turnTokenUsage
    : null;
  if (!u) return { out: 0, fresh: 0, cached: 0 };
  const input = Number(u.inputTokens) || 0;
  const cached = Number(u.cachedInputTokens) || 0;
  const out = Number(u.outputTokens) || 0;
  return { out, fresh: Math.max(0, input - cached), cached };
}

function mapT3RunState(status) {
  const s = String(status || "").toLowerCase();
  if (["queued", "preparing", "starting", "running", "waiting"].includes(s)) return "run";
  if (s === "failed" || s === "error") return "error";
  if (s === "cancelled" || s === "canceled" || s === "interrupted") return "cancelled";
  return "";
}

async function t3CodeHasV2(db) {
  const tables = await desktopQuery(db, "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('orchestration_v2_projection_threads','projection_threads')");
  return {
    hasV2: tables.some((t) => t.name === "orchestration_v2_projection_threads"),
    hasV1: tables.some((t) => t.name === "projection_threads"),
  };
}

const DELEGATED_ID_KEYS = new Set([
  "threadId", "thread_id",
  "nativeThreadId", "native_thread_id",
  "nativeId", "native_id",
  "sessionId", "session_id",
  "sdkSessionId", "sdk_session_id",
  "providerSessionId", "provider_session_id",
  "providerThreadId", "provider_thread_id",
  "conversationId", "conversation_id",
  "agentSessionId", "agent_session_id",
  "acpSessionId", "acp_session_id",
  "codexThreadId", "claudeSessionId",
]);

function decodeTail(raw) {
  try { return decodeURIComponent(raw); } catch { return raw; }
}

function isDelegatedPlaceholder(value) {
  const s = String(value || "").trim();
  if (!s || s === "shared") return true;
  if (s.startsWith("provider-session:provider-instance:")) return true;
  const nativeIdx = s.lastIndexOf(":native-thread:");
  const rawTail = nativeIdx >= 0 ? s.slice(nativeIdx + ":native-thread:".length).trim() : s;
  const tail = decodeTail(rawTail).trim();
  if (!tail || tail === "shared" || /^pending(?:$|[.:_-])/i.test(tail)) return true;
  return false;
}

function extractDelegatedCandidates(raw) {
  const s = String(raw || "").trim();
  if (isDelegatedPlaceholder(s)) return [];
  const nativeIdx = s.lastIndexOf(":native-thread:");
  if (nativeIdx >= 0) {
    const decoded = decodeTail(s.slice(nativeIdx + ":native-thread:".length).trim()).trim();
    if (decoded && !isDelegatedPlaceholder(decoded) && decoded !== s) return [decoded, s];
  }
  return [s];
}

export function extractDelegatedIdsFromObj(obj, depth = 0, out = []) {
  if (!obj || typeof obj !== "object" || depth > 5) return out;
  if (Array.isArray(obj)) {
    for (const item of obj) extractDelegatedIdsFromObj(item, depth + 1, out);
    return out;
  }
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === "string") {
      if (DELEGATED_ID_KEYS.has(key) && val.trim()) out.push(val.trim());
    } else if (val && typeof val === "object") {
      extractDelegatedIdsFromObj(val, depth + 1, out);
    }
  }
  return out;
}

function orcaCwdFromRecord(rec) {
  const launch = String(rec?.launchDirectory || "").trim();
  if (launch) return launch;
  const wsId = String(rec?.location?.workspaceId || "").trim();
  const sep = wsId.indexOf("::");
  if (sep >= 0) {
    const candidate = wsId.slice(sep + 2).trim();
    if (/^(?:\/|~|[A-Za-z]:[\\/]|\\\\)/.test(candidate)) return candidate;
  }
  return "";
}

function addOrcaDelegatedRef(out, raw, ownerSid, { extractedOnly = false } = {}) {
  const v = String(ownerSid || "").trim();
  if (!v) return;
  const push = (val) => {
    for (const k of extractDelegatedCandidates(val)) {
      if (!k || k === v || k.startsWith("structured-agent-session-")) continue;
      out.set(k, v);
    }
  };
  const s = String(raw || "").trim();
  if (!s) return;
  const claudeM = /^claude:([^:]+):/i.exec(s);
  if (claudeM) { push(decodeTail(claudeM[1])); return; }
  const codexM = /^codex:([^:]+):/i.exec(s);
  if (codexM) { push(decodeTail(codexM[1])); return; }
  const promptM = /^(?:legacy:[^:]+:[^:]+:(?:turn-lifecycle|item):)?p:([^:]+):/i.exec(decodeTail(s));
  if (promptM) { push(decodeTail(promptM[1])); return; }
  if (extractedOnly) return;
  if (!s.startsWith("orca:") && !s.startsWith("legacy:")) push(s);
}

// Collect underlying native session/thread IDs launched by Orca so AutoLog
// and all UI surfaces track those sessions only under Orca.
export async function orcaDelegatedSids(db) {
  const out = new Map();
  if (!fs.existsSync(db)) return out;
  const targetTables = ["agent_session_records", "journal_items"];
  const tables = await desktopQuery(
    db,
    `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${targetTables.map(quote).join(",")})`,
  );
  const names = new Set(tables.map((t) => t.name));
  if (!names.has("agent_session_records")) return out;

  const rCols = await tableColumns(db, "agent_session_records");
  const recRows = await desktopQuery(
    db,
    `SELECT session_id AS sid, ${rCols.has("adopted_native_id") ? "adopted_native_id AS adoptedNativeId" : "'' AS adoptedNativeId"}, record_json AS recordJson FROM agent_session_records`,
  );
  const activeSids = new Set();
  for (const r of recRows) {
    const sid = String(r.sid || "").trim();
    if (!sid) continue;
    const rec = json(r.recordJson, null);
    if (rec?.deletedAt) continue;
    activeSids.add(sid);
    if (r.adoptedNativeId) addOrcaDelegatedRef(out, r.adoptedNativeId, sid);
    if (Array.isArray(rec?.providerHandleChain)) {
      for (const link of rec.providerHandleChain) {
        if (!link?.handle) continue;
        for (const candidate of extractDelegatedIdsFromObj(link.handle)) {
          addOrcaDelegatedRef(out, candidate, sid);
        }
      }
    }
  }

  if (names.has("journal_items") && activeSids.size) {
    const jiCols = await tableColumns(db, "journal_items");
    const hasCodexCol = jiCols.has("codex_thread_id");
    const hasTurnCol = jiCols.has("provider_turn_id");
    const itemRows = await desktopQuery(
      db,
      `SELECT DISTINCT session_id AS sid, item_id AS itemId${hasCodexCol ? ", codex_thread_id AS codexThreadId" : ", '' AS codexThreadId"}${hasTurnCol ? ", provider_turn_id AS providerTurnId" : ", '' AS providerTurnId"}
       FROM journal_items
       WHERE ${hasCodexCol ? "codex_thread_id IS NOT NULL OR " : ""}${hasTurnCol ? "provider_turn_id LIKE 'p:%' OR " : ""}item_id LIKE 'claude:%' OR item_id LIKE 'codex:%' OR item_id LIKE 'legacy:%'`,
    );
    for (const r of itemRows) {
      const sid = String(r.sid || "").trim();
      if (!sid || !activeSids.has(sid)) continue;
      if (r.codexThreadId) addOrcaDelegatedRef(out, r.codexThreadId, sid);
      if (r.providerTurnId) addOrcaDelegatedRef(out, r.providerTurnId, sid, { extractedOnly: true });
      if (r.itemId) addOrcaDelegatedRef(out, r.itemId, sid, { extractedOnly: true });
    }
  }
  return out;
}

async function tableColumns(db, table) {
  const rows = await desktopQuery(db, `PRAGMA table_info(${table})`);
  return new Set(rows.map((r) => String(r.name || "").trim()).filter(Boolean));
}

// Collect underlying provider session/thread IDs launched by T3 Code so AutoLog
// records the work once under the T3 Code thread instead of duplicating it under
// the delegated provider (e.g. Codex / Claude Code).
export async function t3CodeDelegatedSids(db) {
  const out = new Map();
  if (!fs.existsSync(db)) return out;
  const targetTables = [
    "orchestration_v2_projection_threads",
    "orchestration_v2_projection_provider_threads",
    "orchestration_v2_projection_provider_sessions",
    "orchestration_v2_projection_provider_session_bindings",
    "orchestration_v2_projection_subagents",
    "provider_session_runtime",
    "projection_thread_sessions",
  ];
  const tables = await desktopQuery(
    db,
    `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${targetTables.map(quote).join(",")})`,
  );
  const names = new Set(tables.map((t) => t.name));
  const hasV2Threads = names.has("orchestration_v2_projection_threads");
  const add = (nativeId, threadId) => {
    const v = String(threadId || "").trim();
    if (!v) return;
    for (const k of extractDelegatedCandidates(nativeId)) {
      if (!k || k === v || k.startsWith("thread:") || k.startsWith("turn:")) continue;
      out.set(k, v);
    }
  };
  const collectFromRows = (rows, ownerFn, idKeys, jsonKeys) => {
    for (const r of rows) {
      const owner = ownerFn(r);
      if (!owner) continue;
      for (const k of idKeys) {
        if (r[k]) add(r[k], owner);
      }
      for (const jk of jsonKeys) {
        if (!r[jk]) continue;
        const parsed = json(r[jk], null);
        if (parsed) {
          for (const candidate of extractDelegatedIdsFromObj(parsed)) add(candidate, owner);
        }
      }
    }
  };
  const queryWithThreadFilter = async (table, alias, idCols, jsonCols) => {
    const cols = await tableColumns(db, table);
    const ownerCol = cols.has("thread_id") ? "thread_id" : cols.has("parent_thread_id") ? "parent_thread_id" : "";
    if (!ownerCol) return [];
    const presentIds = idCols.filter((c) => cols.has(c));
    const presentJsons = jsonCols.filter((c) => cols.has(c));
    if (!presentIds.length && !presentJsons.length) return [];
    const selectCols = [
      `${alias}.${ownerCol} AS ownerId`,
      ...(cols.has("thread_id") && ownerCol !== "thread_id" ? [`${alias}.thread_id AS threadId`] : []),
      ...(cols.has("parent_thread_id") && ownerCol !== "parent_thread_id" ? [`${alias}.parent_thread_id AS parentThreadId`] : []),
      ...presentIds.map((c) => `${alias}.${c} AS ${c}`),
      ...presentJsons.map((c) => `${alias}.${c} AS ${c}`),
    ];
    const conds = [`${alias}.${ownerCol} IS NOT NULL`];
    if (cols.has("deleted_at")) conds.push(`${alias}.deleted_at IS NULL`);
    let joinSql = "";
    if (hasV2Threads && cols.has("thread_id")) {
      joinSql = ` LEFT JOIN orchestration_v2_projection_threads t ON t.thread_id = ${alias}.thread_id`;
      conds.push("(t.thread_id IS NULL OR t.deleted_at IS NULL)");
    }
    return desktopQuery(db, `SELECT ${selectCols.join(", ")} FROM ${table} ${alias}${joinSql} WHERE ${conds.join(" AND ")}`);
  };

  if (names.has("orchestration_v2_projection_provider_threads")) {
    const idCols = ["provider_thread_id", "provider_session_id", "native_id", "native_thread_id"];
    const jsonCols = ["payload_json", "resume_cursor_json", "runtime_payload_json"];
    const rows = await queryWithThreadFilter("orchestration_v2_projection_provider_threads", "pt", idCols, jsonCols);
    collectFromRows(rows, (r) => r.ownerId, idCols, jsonCols);
  }
  if (names.has("orchestration_v2_projection_provider_sessions")) {
    const idCols = ["provider_session_id", "provider_thread_id", "native_id", "native_thread_id", "external_session_id"];
    const jsonCols = ["payload_json", "resume_cursor_json", "runtime_payload_json"];
    const rows = await queryWithThreadFilter("orchestration_v2_projection_provider_sessions", "ps", idCols, jsonCols);
    collectFromRows(rows, (r) => r.ownerId, idCols, jsonCols);
  }
  if (names.has("orchestration_v2_projection_provider_session_bindings")) {
    const idCols = ["provider_session_id", "provider_thread_id", "external_session_id", "session_id", "native_id", "native_thread_id"];
    const jsonCols = ["payload_json", "metadata_json"];
    const rows = await queryWithThreadFilter("orchestration_v2_projection_provider_session_bindings", "pb", idCols, jsonCols);
    collectFromRows(rows, (r) => r.ownerId, idCols, jsonCols);
  }
  if (names.has("orchestration_v2_projection_subagents")) {
    const idCols = ["subagent_thread_id", "provider_thread_id", "provider_session_id", "native_thread_id", "native_id"];
    const jsonCols = ["payload_json", "resume_cursor_json"];
    const rows = await queryWithThreadFilter("orchestration_v2_projection_subagents", "sa", idCols, jsonCols);
    collectFromRows(rows, (r) => r.parentThreadId || r.ownerId, idCols, jsonCols);
  }
  if (names.has("provider_session_runtime")) {
    const idCols = ["provider_session_id", "provider_thread_id"];
    const jsonCols = ["resume_cursor_json", "runtime_payload_json", "payload_json"];
    const rows = await queryWithThreadFilter("provider_session_runtime", "pr", idCols, jsonCols);
    collectFromRows(rows, (r) => r.ownerId, idCols, jsonCols);
  }
  if (names.has("projection_thread_sessions")) {
    const idCols = ["provider_session_id", "provider_thread_id"];
    const jsonCols = ["resume_cursor_json", "runtime_payload_json", "payload_json"];
    const rows = await queryWithThreadFilter("projection_thread_sessions", "pts", idCols, jsonCols);
    collectFromRows(rows, (r) => r.ownerId, idCols, jsonCols);
  }
  return out;
}

// Collect underlying native session/thread IDs launched by Cindy so AutoLog
// and all UI surfaces track those sessions only under Cindy.
export async function cindyDelegatedSids(db) {
  const out = new Map();
  if (!fs.existsSync(db)) return out;
  const targetTables = ["sessions", "messages", "subagent_runs", "skill_usage_sources"];
  const tables = await desktopQuery(
    db,
    `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${targetTables.map(quote).join(",")})`,
  );
  const names = new Set(tables.map((t) => t.name));
  if (!names.has("sessions")) return out;

  const sCols = await tableColumns(db, "sessions");
  const validConds = [];
  if (sCols.has("status")) validConds.push("(s.status IS NULL OR s.status != 'deleted')");
  if (sCols.has("deleted_at")) validConds.push("s.deleted_at IS NULL");
  if (sCols.has("hidden_at")) validConds.push("s.hidden_at IS NULL");
  const validWhere = validConds.length ? validConds.join(" AND ") : "1=1";

  const add = (nativeId, ownerSid) => {
    const v = String(ownerSid || "").trim();
    if (!v) return;
    for (const k of extractDelegatedCandidates(nativeId)) {
      if (!k || k === v) continue;
      out.set(k, v);
    }
  };

  if (sCols.has("sdk_session_id")) {
    const rows = await desktopQuery(db, `SELECT s.id AS sid, s.sdk_session_id AS sdkSid FROM sessions s WHERE ${validWhere} AND s.sdk_session_id IS NOT NULL AND s.sdk_session_id != ''`);
    for (const r of rows) add(r.sdkSid, r.sid);
  }

  if (names.has("messages")) {
    const mCols = await tableColumns(db, "messages");
    const mConds = [validWhere];
    if (mCols.has("rewind_at")) mConds.push("m.rewind_at IS NULL");
    const hasMeta = mCols.has("agent_meta");
    const hasRole = mCols.has("role");
    const hasContent = mCols.has("content");
    if (hasMeta || (hasRole && hasContent)) {
      const cols = [
        "m.session_id AS sid",
        hasRole ? "m.role AS role" : "'' AS role",
        hasMeta ? "m.agent_meta AS agentMeta" : "NULL AS agentMeta",
        hasContent ? "m.content AS content" : "NULL AS content",
      ];
      const filterClause = hasMeta && hasRole
        ? "(m.agent_meta IS NOT NULL OR m.role = 'agent_switch')"
        : hasMeta ? "m.agent_meta IS NOT NULL" : "m.role = 'agent_switch'";
      const rows = await desktopQuery(
        db,
        `SELECT ${cols.join(", ")} FROM messages m INNER JOIN sessions s ON s.id = m.session_id WHERE ${mConds.join(" AND ")} AND ${filterClause}`,
      );
      for (const r of rows) {
        if (r.agentMeta) {
          const meta = json(r.agentMeta, null);
          if (meta && typeof meta === "object") {
            add(meta.sdkSessionId, r.sid);
            add(meta.nativeForkAnchor?.sdkSessionId, r.sid);
            add(meta.failedSamplingAttempt?.threadId, r.sid);
          }
        }
        if (r.role === "agent_switch" && r.content) {
          const sw = json(r.content, null);
          if (sw && typeof sw === "object") {
            add(sw.fromSdkSessionId, r.sid);
            add(sw.toSdkSessionId, r.sid);
          }
        }
      }
    }
  }

  if (names.has("subagent_runs")) {
    const srCols = await tableColumns(db, "subagent_runs");
    if (srCols.has("provider_run_ids") && srCols.has("session_id")) {
      const srConds = [validWhere, "sr.provider_run_ids IS NOT NULL"];
      if (srCols.has("rewind_at")) srConds.push("sr.rewind_at IS NULL");
      if (srCols.has("deleted_at")) srConds.push("sr.deleted_at IS NULL");
      const rows = await desktopQuery(
        db,
        `SELECT sr.session_id AS sid, sr.provider_run_ids AS runIds FROM subagent_runs sr INNER JOIN sessions s ON s.id = sr.session_id WHERE ${srConds.join(" AND ")}`,
      );
      for (const r of rows) {
        const ids = json(r.runIds, []);
        if (Array.isArray(ids)) {
          for (const id of ids) add(id, r.sid);
        }
      }
    }
  }

  if (names.has("skill_usage_sources")) {
    const suCols = await tableColumns(db, "skill_usage_sources");
    if (suCols.has("sdk_session_id") && suCols.has("session_id")) {
      const rows = await desktopQuery(
        db,
        `SELECT su.session_id AS sid, su.sdk_session_id AS sdkSid FROM skill_usage_sources su INNER JOIN sessions s ON s.id = su.session_id WHERE ${validWhere} AND su.sdk_session_id IS NOT NULL AND su.sdk_session_id != ''`,
      );
      for (const r of rows) add(r.sdkSid, r.sid);
    }
  }

  return out;
}

function extractCindyRawText(raw) {
  if (raw == null) return { text: "", syntheticTrigger: false };
  let val = raw;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (!trimmed) return { text: "", syntheticTrigger: false };
    if (trimmed.startsWith("[UI_ACTION_TRIGGER]")) return { text: "", syntheticTrigger: true };
    if (trimmed.startsWith('"') || trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try { val = JSON.parse(trimmed); } catch { return { text: cleanCindyText(raw), syntheticTrigger: false }; }
    } else {
      return { text: cleanCindyText(raw), syntheticTrigger: false };
    }
  }
  const collect = (node) => {
    if (typeof node === "string") return node;
    if (Array.isArray(node)) {
      return node
        .filter((p) => p && (p.type === "text" || p.type === "output_text" || p.type === "input_text") && !p.synthetic && !p.ignored)
        .map((p) => (typeof p.text === "string" ? p.text : ""))
        .join("\n");
    }
    if (node && typeof node === "object") {
      if (typeof node.text === "string") return node.text;
      if (typeof node.message === "string") return node.message;
      if (typeof node.error === "string") return node.error;
      if (typeof node.content === "string") return node.content;
      if (Array.isArray(node.content)) return collect(node.content);
    }
    return "";
  };
  const extracted = collect(val);
  if (extracted.trimStart().startsWith("[UI_ACTION_TRIGGER]")) {
    return { text: "", syntheticTrigger: true };
  }
  return { text: cleanCindyText(extracted), syntheticTrigger: false };
}

function cindyIsInternalCard(meta) {
  return Boolean(
    meta?.autoResume ||
    meta?.goalNotice ||
    meta?.scheduleSkip ||
    meta?.goalCompletion ||
    meta?.cindyMakeCompletion ||
    meta?.reviewRun
  );
}

function extractCindyTurnUsage(tu) {
  if (!tu || typeof tu !== "object") return { out: 0, fresh: 0, cached: 0, model: "" };
  const model = String(tu.model || (Array.isArray(tu.models) ? tu.models[0] : "") || "").trim();
  let input = Number(tu.inputTokens ?? tu.input_tokens) || 0;
  let output = Number(tu.outputTokens ?? tu.output_tokens) || 0;
  let cacheCreate = Number(tu.cacheCreateTokens ?? tu.cacheCreationInputTokens ?? tu.cache_creation_input_tokens) || 0;
  let cacheRead = Number(tu.cacheReadTokens ?? tu.cacheReadInputTokens ?? tu.cache_read_input_tokens) || 0;
  if (input + output + cacheCreate + cacheRead === 0 && tu.perModelTokens && typeof tu.perModelTokens === "object") {
    const entries = Array.isArray(tu.perModelTokens) ? tu.perModelTokens : Object.values(tu.perModelTokens);
    for (const item of entries) {
      if (!item || typeof item !== "object") continue;
      input += Number(item.inputTokens ?? item.input_tokens) || 0;
      output += Number(item.outputTokens ?? item.output_tokens) || 0;
      cacheCreate += Number(item.cacheCreateTokens ?? item.cacheCreationInputTokens ?? item.cache_creation_input_tokens) || 0;
      cacheRead += Number(item.cacheReadTokens ?? item.cacheReadInputTokens ?? item.cache_read_input_tokens) || 0;
    }
  }
  return { out: output, fresh: input + cacheCreate, cached: cacheRead, model };
}

function extractCindyMsgUsage(u) {
  if (!u || typeof u !== "object") return { out: 0, fresh: 0, cached: 0 };
  const input = Number(u.inputTokens ?? u.input_tokens) || 0;
  const output = Number(u.outputTokens ?? u.output_tokens) || 0;
  const cacheCreate = Number(u.cacheCreationInputTokens ?? u.cacheCreateTokens ?? u.cache_creation_input_tokens) || 0;
  const cacheRead = Number(u.cacheReadInputTokens ?? u.cacheReadTokens ?? u.cache_read_input_tokens) || 0;
  return { out: output, fresh: input + cacheCreate, cached: cacheRead };
}

export async function desktopSessions(db, agent, since) {
  if (agent === "qoder") return desktopQuery(db, `SELECT session_id AS sid,title,cwd,owner_session_id AS parentSid,model,created_at AS startedAt,updated_at AS updatedAt,archived,deleted_at AS deletedAt, max(updated_at, coalesce((SELECT max(updated_at) FROM chat_session_messages m WHERE m.session_id=chat_sessions.session_id),0)) AS revision FROM chat_sessions WHERE revision >= ${Math.floor(since)}`);
  if (agent === "cindy") {
    const tables = await desktopQuery(
      db,
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sessions','messages','orca_workers','orca_teams','bot_delegations')",
    );
    const names = new Set(tables.map((t) => t.name));
    if (!names.has("sessions")) return [];
    const sCols = await tableColumns(db, "sessions");
    const mCols = names.has("messages") ? await tableColumns(db, "messages") : new Set();
    const hasOrca = names.has("orca_workers") && names.has("orca_teams");
    const hasBot = names.has("bot_delegations");
    const colOr = (col, alias, fallback = "NULL") => sCols.has(col) ? `s.${col} AS ${alias}` : `${fallback} AS ${alias}`;
    const msgFilter = mCols.has("rewind_at") ? "m.rewind_at IS NULL" : "1=1";
    const selectFields = [
      "s.id AS sid",
      colOr("title", "title", "''"),
      colOr("working_dir", "workingDir", "''"),
      colOr("project_dir", "projectDir", "''"),
      colOr("worktree_path", "worktreePath", "''"),
      colOr("model", "model", "''"),
      colOr("status", "status", "'active'"),
      colOr("created_at", "createdAt", "0"),
      colOr("updated_at", "updatedAt", "0"),
      colOr("deleted_at", "deletedAt", "NULL"),
      colOr("hidden_at", "hiddenAt", "NULL"),
      colOr("last_activity_at", "lastActivityAt", "0"),
      colOr("active_turn_started_at", "activeTurnStartedAt", "0"),
      colOr("last_turn_ended_at", "lastTurnEndedAt", "0"),
      names.has("messages")
        ? `(SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id AND ${msgFilter}) AS msgCount`
        : "0 AS msgCount",
      names.has("messages") && mCols.has("created_at")
        ? `(SELECT MAX(m.created_at) FROM messages m WHERE m.session_id = s.id AND ${msgFilter}) AS lastMsgAt`
        : "0 AS lastMsgAt",
      hasOrca
        ? "(SELECT ot.lead_session_id FROM orca_workers ow INNER JOIN orca_teams ot ON ot.id = ow.team_id WHERE ow.session_id = s.id LIMIT 1) AS orcaParentSid"
        : "'' AS orcaParentSid",
      hasBot
        ? "(SELECT bd.parent_session_id FROM bot_delegations bd WHERE bd.child_session_id = s.id LIMIT 1) AS botParentSid"
        : "'' AS botParentSid",
    ];
    const rows = await desktopQuery(db, `SELECT ${selectFields.join(", ")} FROM sessions s`);
    const sinceMs = Math.floor(Number(since) || 0);
    return rows.map((s) => {
      const startedAt = desktopTime(s.createdAt);
      const activeStart = desktopTime(s.activeTurnStartedAt);
      const lastEnd = desktopTime(s.lastTurnEndedAt);
      const lastActivity = Math.max(desktopTime(s.lastActivityAt), desktopTime(s.lastMsgAt));
      const updatedAt = Math.max(desktopTime(s.updatedAt), lastActivity, lastEnd, activeStart, startedAt);
      const rawStatus = String(s.status || "").toLowerCase();
      const archived = rawStatus === "archived";
      const deletedAt = rawStatus === "deleted"
        ? (desktopTime(s.deletedAt) || updatedAt || Date.now())
        : (desktopTime(s.deletedAt) || desktopTime(s.hiddenAt) || 0);
      const rawTitle = String(s.title || "").trim();
      const title = rawTitle === "New Maker" ? "" : rawTitle;
      const cwd = String(s.worktreePath || s.projectDir || s.workingDir || "").trim();
      const rawParent = String(s.orcaParentSid || s.botParentSid || "").trim();
      const parentSid = rawParent && rawParent !== s.sid ? rawParent : "";
      const recentActive = activeStart > 0 && activeStart > lastEnd &&
        (Date.now() - Math.max(activeStart, lastActivity, updatedAt) <= TOOL_LOOP_IDLE_MIN * 60000);
      return {
        sid: s.sid,
        title,
        cwd,
        parentSid,
        model: String(s.model || "").trim(),
        app: "desktop",
        startedAt,
        updatedAt,
        revision: updatedAt + (Number(s.msgCount) || 0) + (archived ? 1000000 : 0) + (activeStart > lastEnd ? 1 : 0),
        archived,
        deletedAt,
        state: recentActive ? "run" : "",
        out: 0,
        fresh: 0,
        cached: 0,
      };
    }).filter((s) => s.deletedAt || s.updatedAt >= sinceMs);
  }
  if (agent === "orca") {
    const sinceMs = Math.max(0, Math.floor(since || 0));
    const tables = await desktopQuery(
      db,
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('agent_session_records','journal_chat_state','journal_items')",
    );
    const names = new Set(tables.map((t) => t.name));
    if (!names.has("agent_session_records")) return [];
    const hasChatState = names.has("journal_chat_state");
    const hasItems = names.has("journal_items");
    const rows = await desktopQuery(
      db,
      `SELECT r.session_id AS sid, r.record_json AS recordJson
        ${hasChatState ? ", cs.epoch AS epoch, COALESCE(cs.last_activity_at, 0) AS chatLastAt" : ", '' AS epoch, 0 AS chatLastAt"}
        ${hasItems ? `,
          COALESCE((SELECT COUNT(*) FROM journal_items ji WHERE ji.session_id = r.session_id ${hasChatState ? "AND (cs.epoch IS NULL OR ji.epoch = cs.epoch)" : ""} AND COALESCE(ji.hidden, 0) = 0 AND COALESCE(ji.root, 1) = 1 AND COALESCE(ji.subagent_row, 0) = 0), 0) AS msgCount,
          COALESCE((SELECT MAX(MAX(COALESCE(ji.turn_completed_at, 0), COALESCE(CAST(json_extract(ji.payload_json, '$.observedAt') AS INTEGER), 0))) FROM journal_items ji WHERE ji.session_id = r.session_id ${hasChatState ? "AND (cs.epoch IS NULL OR ji.epoch = cs.epoch)" : ""} AND COALESCE(ji.hidden, 0) = 0), 0) AS lastItemAt,
          COALESCE((SELECT MAX(CASE WHEN ji.live_work = 1 OR (ji.kind = 'turn' AND LOWER(COALESCE(ji.lifecycle_state, '')) IN ('running','queued','starting','preparing','waiting')) THEN 1 ELSE 0 END) FROM journal_items ji WHERE ji.session_id = r.session_id ${hasChatState ? "AND (cs.epoch IS NULL OR ji.epoch = cs.epoch)" : ""}), 0) AS hasLiveTurn,
          COALESCE((SELECT json_extract(ji.payload_json, '$.body.outcome') FROM journal_items ji WHERE ji.session_id = r.session_id ${hasChatState ? "AND (cs.epoch IS NULL OR ji.epoch = cs.epoch)" : ""} AND ji.kind = 'turn' ORDER BY ji.ordinal DESC, ji.sequence DESC LIMIT 1), '') AS lastTurnOutcome,
          COALESCE((SELECT json_extract(ji.payload_json, '$.body.contextUsage.used.model') FROM journal_items ji WHERE ji.session_id = r.session_id ${hasChatState ? "AND (cs.epoch IS NULL OR ji.epoch = cs.epoch)" : ""} AND COALESCE(json_extract(ji.payload_json, '$.body.contextUsage.used.model'), '') <> '' ORDER BY ji.ordinal DESC, ji.sequence DESC LIMIT 1), '') AS turnModel`
          : ", 0 AS msgCount, 0 AS lastItemAt, 0 AS hasLiveTurn, '' AS lastTurnOutcome, '' AS turnModel"}
      FROM agent_session_records r
      ${hasChatState ? "LEFT JOIN journal_chat_state cs ON cs.session_id = r.session_id" : ""}`,
    );
    return rows.map((s) => {
      const rec = json(s.recordJson, {});
      const startedAt = desktopTime(rec.createdAt);
      const itemAt = desktopTime(s.lastItemAt);
      const chatAt = desktopTime(s.chatLastAt);
      const lastTurnAt = desktopTime(rec.lastTurn?.at);
      const contentAt = Math.max(itemAt, chatAt, lastTurnAt, startedAt);
      const updatedAt = Math.max(contentAt, desktopTime(rec.updatedAt) && !lastTurnAt && !itemAt ? desktopTime(rec.updatedAt) : 0, startedAt);
      const archived = Boolean(rec.archivedAt || rec.archived);
      const deletedAt = rec.deletedAt ? desktopTime(rec.deletedAt) || 1 : 0;
      const lastTurnState = String(rec.lastTurn?.state || "").toLowerCase();
      const outcome = String(s.lastTurnOutcome || rec.lastTurn?.outcome || "").toLowerCase();
      const recentLive = Boolean(s.hasLiveTurn) || lastTurnState === "running";
      const state = recentLive && (Date.now() - Math.max(contentAt, desktopTime(rec.updatedAt)) <= TOOL_LOOP_IDLE_MIN * 60000)
        ? "run"
        : outcome === "failure" || outcome === "error"
          ? "error"
          : "wait";
      const model = String(rec.options?.model || s.turnModel || rec.provider || "").trim();
      return {
        sid: s.sid,
        title: String(rec.conversationName || "").trim(),
        cwd: orcaCwdFromRecord(rec),
        parentSid: "",
        model,
        app: "desktop",
        startedAt,
        updatedAt,
        revision: contentAt + (Number(s.msgCount) || 0) * 10 + (state === "run" ? 1 : 0) + (archived ? 1000000 : 0),
        archived,
        deletedAt,
        state,
        out: 0,
        fresh: 0,
        cached: 0,
      };
    }).filter((s) => s.deletedAt || s.updatedAt >= sinceMs);
  }
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
  if (agent === "t3code") {
    const sinceMs = Math.max(0, Math.floor(since || 0));
    const { hasV2, hasV1 } = await t3CodeHasV2(db);
    if (hasV2) {
      const rows = await desktopQuery(db, `SELECT t.thread_id AS sid,
        COALESCE(t.title, '') AS title,
        COALESCE(NULLIF(json_extract(t.payload_json, '$.worktreePath'), ''), p.workspace_root, '') AS cwd,
        CASE WHEN json_extract(t.payload_json, '$.lineage.relationshipToParent') = 'subagent'
          THEN COALESCE(json_extract(t.payload_json, '$.lineage.parentThreadId'), '')
          ELSE '' END AS parentSid,
        COALESCE(
          (SELECT json_extract(pt.payload_json, '$.model') FROM orchestration_v2_projection_provider_turns pt
            WHERE pt.thread_id = t.thread_id AND COALESCE(json_extract(pt.payload_json, '$.model'), '') <> ''
            ORDER BY pt.ordinal DESC LIMIT 1),
          (SELECT json_extract(r.payload_json, '$.modelSelection.model') FROM orchestration_v2_projection_runs r
            WHERE r.thread_id = t.thread_id AND COALESCE(json_extract(r.payload_json, '$.modelSelection.model'), '') <> ''
            ORDER BY r.ordinal DESC LIMIT 1),
          json_extract(t.payload_json, '$.modelSelection.model'),
          ''
        ) AS model,
        COALESCE((SELECT r.status FROM orchestration_v2_projection_runs r WHERE r.thread_id = t.thread_id ORDER BY r.ordinal DESC LIMIT 1), '') AS runStatus,
        t.created_at AS startedAt,
        t.updated_at AS updatedAt,
        t.archived_at AS archivedAt,
        t.deleted_at AS deletedAt,
        COALESCE((SELECT MAX(m.updated_at) FROM orchestration_v2_projection_messages m WHERE m.thread_id = t.thread_id), '') AS lastMsgAt,
        COALESCE((SELECT MAX(COALESCE(r.completed_at, r.requested_at)) FROM orchestration_v2_projection_runs r WHERE r.thread_id = t.thread_id), '') AS lastRunAt,
        COALESCE((SELECT COUNT(*) FROM orchestration_v2_projection_messages m WHERE m.thread_id = t.thread_id), 0) AS msgCount,
        COALESCE((SELECT COUNT(*) FROM orchestration_v2_projection_runs r WHERE r.thread_id = t.thread_id), 0) AS runCount,
        COALESCE((SELECT SUM(COALESCE(json_extract(pt.payload_json, '$.turnTokenUsage.outputTokens'), 0)) FROM orchestration_v2_projection_provider_turns pt WHERE pt.thread_id = t.thread_id), 0) AS outTokens,
        COALESCE((SELECT SUM(MAX(0, COALESCE(json_extract(pt.payload_json, '$.turnTokenUsage.inputTokens'), 0) - COALESCE(json_extract(pt.payload_json, '$.turnTokenUsage.cachedInputTokens'), 0))) FROM orchestration_v2_projection_provider_turns pt WHERE pt.thread_id = t.thread_id), 0) AS freshTokens,
        COALESCE((SELECT SUM(COALESCE(json_extract(pt.payload_json, '$.turnTokenUsage.cachedInputTokens'), 0)) FROM orchestration_v2_projection_provider_turns pt WHERE pt.thread_id = t.thread_id), 0) AS cachedTokens
        FROM orchestration_v2_projection_threads t
        LEFT JOIN projection_projects p ON p.project_id = t.project_id`);
      return rows.map((s) => {
        const startedAt = desktopTime(s.startedAt);
        const updatedAt = Math.max(desktopTime(s.updatedAt), desktopTime(s.lastMsgAt), desktopTime(s.lastRunAt), startedAt);
        const archived = Boolean(s.archivedAt);
        const deletedAt = s.deletedAt ? desktopTime(s.deletedAt) || 1 : 0;
        const out = Number(s.outTokens) || 0;
        const fresh = Number(s.freshTokens) || 0;
        const cached = Number(s.cachedTokens) || 0;
        const rawTitle = String(s.title || "").trim();
        return {
          sid: s.sid,
          title: rawTitle === "New thread" ? "" : rawTitle,
          cwd: s.cwd || "",
          parentSid: s.parentSid || "",
          model: String(s.model || ""),
          app: "desktop",
          startedAt,
          updatedAt,
          revision: updatedAt + (Number(s.msgCount) || 0) + (Number(s.runCount) || 0) * 10 + out + (archived ? 1000000 : 0),
          archived,
          deletedAt,
          state: mapT3RunState(s.runStatus),
          out,
          fresh,
          cached,
        };
      }).filter((s) => s.deletedAt || s.updatedAt >= sinceMs);
    }
    if (hasV1) {
      const rows = await desktopQuery(db, `SELECT t.thread_id AS sid,
        COALESCE(t.title, '') AS title,
        COALESCE(NULLIF(t.worktree_path, ''), p.workspace_root, '') AS cwd,
        COALESCE(json_extract(t.model_selection_json, '$.model'), '') AS model,
        COALESCE(s.status, '') AS runStatus,
        t.created_at AS startedAt,
        t.updated_at AS updatedAt,
        t.archived_at AS archivedAt,
        t.deleted_at AS deletedAt,
        COALESCE((SELECT MAX(m.updated_at) FROM projection_thread_messages m WHERE m.thread_id = t.thread_id), '') AS lastMsgAt,
        COALESCE((SELECT COUNT(*) FROM projection_thread_messages m WHERE m.thread_id = t.thread_id), 0) AS msgCount
        FROM projection_threads t
        LEFT JOIN projection_projects p ON p.project_id = t.project_id
        LEFT JOIN projection_thread_sessions s ON s.thread_id = t.thread_id`);
      return rows.map((s) => {
        const startedAt = desktopTime(s.startedAt);
        const updatedAt = Math.max(desktopTime(s.updatedAt), desktopTime(s.lastMsgAt), startedAt);
        const archived = Boolean(s.archivedAt);
        const deletedAt = s.deletedAt ? desktopTime(s.deletedAt) || 1 : 0;
        const rawTitle = String(s.title || "").trim();
        return {
          sid: s.sid,
          title: rawTitle === "New thread" ? "" : rawTitle,
          cwd: s.cwd || "",
          parentSid: "",
          model: String(s.model || ""),
          app: "desktop",
          startedAt,
          updatedAt,
          revision: updatedAt + (Number(s.msgCount) || 0) + (archived ? 1000000 : 0),
          archived,
          deletedAt,
          state: mapT3RunState(s.runStatus),
          out: 0,
          fresh: 0,
          cached: 0,
        };
      }).filter((s) => s.deletedAt || s.updatedAt >= sinceMs);
    }
    return [];
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
  if (agent === "t3code") {
    const { hasV2, hasV1 } = await t3CodeHasV2(db);
    if (hasV2) {
      const rows = await desktopQuery(db, `SELECT message_id AS id, run_id AS runId, role, streaming, created_at AS created, updated_at AS updated, payload_json AS payload, search_text AS searchText FROM orchestration_v2_projection_messages WHERE thread_id=${quote(sid)} ORDER BY created_at, message_id`);
      const runRows = await desktopQuery(db, `SELECT run_id AS runId, status, completed_at AS completedAt, payload_json AS payload FROM orchestration_v2_projection_runs WHERE thread_id=${quote(sid)} ORDER BY ordinal`);
      const turnRows = await desktopQuery(db, `SELECT pt.provider_turn_id AS turnId, a.run_id AS runId, pt.status, pt.completed_at AS completedAt, pt.payload_json AS payload FROM orchestration_v2_projection_provider_turns pt LEFT JOIN orchestration_v2_projection_run_attempts a ON a.attempt_id = pt.run_attempt_id WHERE pt.thread_id=${quote(sid)} ORDER BY pt.ordinal`);

      const runMeta = new Map();
      for (const r of runRows) {
        const p = json(r.payload);
        runMeta.set(String(r.runId || ""), {
          status: String(r.status || ""),
          model: String(p?.modelSelection?.model || ""),
          completedAt: desktopTime(r.completedAt || p?.completedAt),
        });
      }

      const usageByRun = new Map();
      for (const t of turnRows) {
        const key = String(t.runId || "");
        if (!key) continue;
        const p = json(t.payload);
        const u = extractT3TurnUsage(p);
        const cur = usageByRun.get(key) || { out: 0, fresh: 0, cached: 0, model: "", completedAt: 0 };
        cur.out += u.out;
        cur.fresh += u.fresh;
        cur.cached += u.cached;
        if (p?.model) cur.model = String(p.model);
        const doneAt = desktopTime(t.completedAt || p?.completedAt);
        if (doneAt > cur.completedAt) cur.completedAt = doneAt;
        usageByRun.set(key, cur);
      }

      const parsed = [];
      const lastAssistantByRun = new Map();
      for (const row of rows) {
        const p = json(row.payload);
        const role = String(row.role || p.role || "").toLowerCase();
        if (role !== "user" && role !== "assistant") continue;
        if (role === "user" && p.createdBy && p.createdBy !== "user") continue;
        const runId = String(row.runId || p.runId || "");
        const idx = parsed.length;
        parsed.push({ row, p, role, runId });
        if (role === "assistant" && runId) lastAssistantByRun.set(runId, idx);
      }

      return parsed.map(({ row, p, role, runId }, idx) => {
        const text = typeof p.text === "string" ? p.text : String(row.searchText || "");
        const at = desktopTime(p.createdAt || row.created);
        const updated = desktopTime(p.updatedAt || row.updated) || at;
        const rInfo = runId ? runMeta.get(runId) : null;
        const tInfo = role === "assistant" && runId && lastAssistantByRun.get(runId) === idx ? usageByRun.get(runId) : null;
        const streaming = Boolean(row.streaming || p.streaming);
        const runState = mapT3RunState(rInfo?.status);
        const state = role === "user"
          ? "run"
          : streaming
            ? "run"
            : runState === "error"
              ? "error"
              : "wait";
        const end = state === "wait" ? (tInfo?.completedAt || rInfo?.completedAt || updated || at) : 0;
        const model = tInfo?.model || rInfo?.model || "";
        return {
          id: row.id,
          role,
          text,
          at,
          end,
          updated,
          state,
          step: "",
          error: state === "error" ? (String(p.error || rInfo?.status || "failed")).slice(0, 200) : "",
          model,
          out: Number(tInfo?.out) || 0,
          fresh: Number(tInfo?.fresh) || 0,
          cached: Number(tInfo?.cached) || 0,
        };
      });
    }
    if (hasV1) {
      const rows = await desktopQuery(db, `SELECT message_id AS id, role, text, is_streaming AS streaming, created_at AS created, updated_at AS updated FROM projection_thread_messages WHERE thread_id=${quote(sid)} ORDER BY created_at, message_id`);
      return rows.flatMap((row) => {
        const role = String(row.role || "").toLowerCase();
        if (role !== "user" && role !== "assistant") return [];
        const at = desktopTime(row.created);
        const updated = desktopTime(row.updated) || at;
        const state = role === "user" || row.streaming ? "run" : "wait";
        return [{
          id: row.id,
          role,
          text: String(row.text || ""),
          at,
          end: state === "wait" ? updated : 0,
          updated,
          state,
          step: "",
          error: "",
          model: "",
          out: 0,
          fresh: 0,
          cached: 0,
        }];
      });
    }
    return [];
  }
  if (agent === "cindy") {
    const tables = await desktopQuery(
      db,
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sessions','messages')",
    );
    const names = new Set(tables.map((t) => t.name));
    if (!names.has("messages")) return [];
    let sessModel = "";
    let sessActiveTurnStarted = 0;
    let sessLastTurnEnded = 0;
    if (names.has("sessions")) {
      const sCols = await tableColumns(db, "sessions");
      const sFields = [
        sCols.has("model") ? "model" : "'' AS model",
        sCols.has("active_turn_started_at") ? "active_turn_started_at AS activeTurnStartedAt" : "0 AS activeTurnStartedAt",
        sCols.has("last_turn_ended_at") ? "last_turn_ended_at AS lastTurnEndedAt" : "0 AS lastTurnEndedAt",
      ];
      const sRows = await desktopQuery(db, `SELECT ${sFields.join(", ")} FROM sessions WHERE id = ${quote(sid)} LIMIT 1`);
      if (sRows[0]) {
        sessModel = String(sRows[0].model || "").trim();
        sessActiveTurnStarted = desktopTime(sRows[0].activeTurnStartedAt);
        sessLastTurnEnded = desktopTime(sRows[0].lastTurnEndedAt);
      }
    }
    const mCols = await tableColumns(db, "messages");
    const mFields = [
      "id",
      mCols.has("role") ? "role" : "'user' AS role",
      mCols.has("content") ? "content" : "'' AS content",
      mCols.has("agent_meta") ? "agent_meta AS agentMeta" : "NULL AS agentMeta",
      mCols.has("created_at") ? "created_at AS created" : "0 AS created",
    ];
    const conds = [`session_id = ${quote(sid)}`];
    if (mCols.has("rewind_at")) conds.push("rewind_at IS NULL");
    const orderBy = mCols.has("created_at") ? "created_at ASC, rowid ASC" : "rowid ASC";
    const rows = await desktopQuery(db, `SELECT ${mFields.join(", ")} FROM messages WHERE ${conds.join(" AND ")} ORDER BY ${orderBy}`);
    if (!rows.length) return [];

    const turns = [];
    const currentTurn = () => {
      if (!turns.length) {
        turns.push({ userMsg: null, assistants: [], lastTool: "", lastToolAt: 0, hasInteractiveWait: false, turnError: null });
      }
      return turns[turns.length - 1];
    };

    for (const row of rows) {
      const meta = json(row.agentMeta, {});
      const at = desktopTime(row.created);
      const role = String(row.role || "").toLowerCase();

      if (role === "user") {
        if (cindyIsInternalCard(meta)) continue;
        const { text, syntheticTrigger } = extractCindyRawText(row.content);
        if (syntheticTrigger || !text) continue;
        turns.push({
          userMsg: {
            id: row.id,
            role: "user",
            text,
            at,
            end: 0,
            updated: at,
            state: "run",
            step: "",
            error: "",
            model: String(meta?.model || sessModel || "").trim(),
            out: 0,
            fresh: 0,
            cached: 0,
          },
          assistants: [],
          lastTool: "",
          lastToolAt: 0,
          hasInteractiveWait: false,
          turnError: null,
        });
        continue;
      }

      const turn = currentTurn();
      if (role === "tool_use") {
        const toolObj = json(row.content, {});
        const toolName = String(toolObj?.toolName || toolObj?.name || toolObj?.tool || "").trim();
        if (toolName) {
          turn.lastTool = toolName;
          turn.lastToolAt = at;
        }
        continue;
      }
      if (role === "ask_user" || role === "plan_review") {
        turn.hasInteractiveWait = true;
        continue;
      }
      if (role === "error") {
        const errObj = json(row.content, row.content);
        if (errObj && typeof errObj === "object" && errObj.dismissed) continue;
        const { text } = extractCindyRawText(row.content);
        const errMsg = text || (typeof row.content === "string" ? row.content : JSON.stringify(row.content || "")).trim();
        if (errMsg) turn.turnError = { text: errMsg.slice(0, 200), at };
        continue;
      }
      if (role !== "assistant") continue;
      if (meta?.parentToolUseId || meta?.parent_tool_use_id || cindyIsInternalCard(meta)) continue;

      const { text, syntheticTrigger } = extractCindyRawText(row.content);
      if (syntheticTrigger) continue;

      turn.assistants.push({
        id: row.id,
        role: "assistant",
        text,
        at,
        meta,
        model: String(meta?.model || sessModel || "").trim(),
        out: 0,
        fresh: 0,
        cached: 0,
      });
    }

    const out = [];
    for (let ti = 0; ti < turns.length; ti++) {
      const turn = turns[ti];
      const isLastTurn = ti === turns.length - 1;
      if (turn.userMsg) {
        if (!turn.assistants.length && isLastTurn && turn.lastTool) {
          turn.userMsg.step = turn.lastTool;
        }
        out.push(turn.userMsg);
      }

      const tuCandidate = [...turn.assistants].reverse().find((a) => a.meta?.turnUsageDetails && typeof a.meta.turnUsageDetails === "object");
      if (tuCandidate) {
        const tuTokens = extractCindyTurnUsage(tuCandidate.meta.turnUsageDetails);
        const target = [...turn.assistants].reverse().find((a) => a.text) || tuCandidate;
        target.out = tuTokens.out;
        target.fresh = tuTokens.fresh;
        target.cached = tuTokens.cached;
        if (tuTokens.model) target.model = tuTokens.model;
      } else {
        const seenReqIdx = new Map();
        turn.assistants.forEach((a, idx) => {
          const reqId = String(a.meta?.requestId || "").trim();
          if (reqId) seenReqIdx.set(reqId, idx);
        });
        turn.assistants.forEach((a, idx) => {
          const reqId = String(a.meta?.requestId || "").trim();
          if (reqId && seenReqIdx.get(reqId) !== idx) return;
          const u = extractCindyMsgUsage(a.meta?.usage);
          a.out = u.out;
          a.fresh = u.fresh;
          a.cached = u.cached;
        });
      }

      const visible = turn.assistants.filter((a, idx) => {
        if (a.text || a.out + a.fresh + a.cached > 0) return true;
        return isLastTurn && idx === turn.assistants.length - 1 && (Boolean(turn.turnError) || Boolean(turn.lastTool) || Boolean(turn.hasInteractiveWait));
      });

      if (!visible.length) {
        if (isLastTurn && turn.turnError) {
          out.push({
            id: turn.userMsg ? `${turn.userMsg.id}-err` : `cindy-err-${turn.turnError.at}`,
            role: "assistant",
            text: "",
            at: turn.turnError.at,
            end: turn.turnError.at,
            updated: turn.turnError.at,
            state: "error",
            step: "",
            error: turn.turnError.text,
            model: sessModel,
            out: 0,
            fresh: 0,
            cached: 0,
          });
        }
        continue;
      }

      for (let ai = 0; ai < visible.length; ai++) {
        const a = visible[ai];
        const isLastAssistant = isLastTurn && ai === visible.length - 1;
        let state = "wait";
        let end = a.at;
        let step = "";
        let error = "";
        if (isLastAssistant) {
          const stopReason = String(a.meta?.stopReason || "").toLowerCase();
          if (turn.turnError) {
            state = "error";
            error = turn.turnError.text;
            end = turn.turnError.at || a.at;
          } else if (turn.hasInteractiveWait || a.meta?.turnCompleted === true) {
            state = "wait";
            end = Math.max(a.at, sessLastTurnEnded) || a.at;
          } else if (stopReason && stopReason !== "tool_use" && stopReason !== "tool_calls") {
            state = "wait";
            end = Math.max(a.at, sessLastTurnEnded) || a.at;
          } else if (sessLastTurnEnded > sessActiveTurnStarted && sessLastTurnEnded >= a.at) {
            state = "wait";
            end = sessLastTurnEnded;
          } else if (
            sessActiveTurnStarted > sessLastTurnEnded ||
            Date.now() - Math.max(a.at, turn.lastToolAt || 0) <= TOOL_LOOP_IDLE_MIN * 60000
          ) {
            state = "run";
            step = turn.lastTool;
            end = 0;
          }
        }
        out.push({
          id: a.id,
          role: "assistant",
          text: a.text,
          at: a.at,
          end,
          updated: end || a.at,
          state,
          step,
          error,
          model: a.model,
          out: a.out,
          fresh: a.fresh,
          cached: a.cached,
        });
      }
    }
    return out;
  }
  if (agent === "orca") {
    const tables = await desktopQuery(
      db,
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('agent_session_records','journal_chat_state','journal_items')",
    );
    const names = new Set(tables.map((t) => t.name));
    if (!names.has("journal_items")) return [];
    let sessModel = "";
    let activeEpoch = "";
    if (names.has("agent_session_records")) {
      const rRows = await desktopQuery(db, `SELECT record_json AS recordJson FROM agent_session_records WHERE session_id = ${quote(sid)} LIMIT 1`);
      if (rRows[0]) {
        const rec = json(rRows[0].recordJson, {});
        sessModel = String(rec.options?.model || rec.provider || "").trim();
      }
    }
    if (names.has("journal_chat_state")) {
      const csRows = await desktopQuery(db, `SELECT epoch FROM journal_chat_state WHERE session_id = ${quote(sid)} LIMIT 1`);
      if (csRows[0]?.epoch) activeEpoch = String(csRows[0].epoch);
    }
    const conds = [
      `session_id = ${quote(sid)}`,
      "COALESCE(hidden, 0) = 0",
      "COALESCE(root, 1) = 1",
      "COALESCE(subagent_row, 0) = 0",
    ];
    if (activeEpoch) conds.push(`epoch = ${quote(activeEpoch)}`);
    const rows = await desktopQuery(
      db,
      `SELECT item_id AS id, kind, message_role AS role, lifecycle_state AS lifecycleState, live_work AS liveWork, turn_completed_at AS turnCompletedAt, payload_json AS payloadJson
       FROM journal_items WHERE ${conds.join(" AND ")} ORDER BY ordinal ASC, sequence ASC, sequence_index ASC`,
    );
    if (!rows.length) return [];

    const turns = [];
    const byTurnItemId = new Map();
    const ensureLastTurn = () => {
      if (!turns.length) {
        const t = { turnItemId: "", userMsg: null, assistants: [], lastTool: "", turnState: "", outcome: "", completedAt: 0, errorText: "", errorAt: 0, model: sessModel };
        turns.push(t);
      }
      return turns[turns.length - 1];
    };
    const resolveTurn = (payload) => {
      const scopeTurnId = payload?.turnScope?.kind === "turn" ? String(payload.turnScope.turnItemId || "") : "";
      if (scopeTurnId && byTurnItemId.has(scopeTurnId)) return byTurnItemId.get(scopeTurnId);
      return ensureLastTurn();
    };

    for (const row of rows) {
      const payload = json(row.payloadJson, {});
      const body = payload.body && typeof payload.body === "object" ? payload.body : payload;
      const kind = String(row.kind || body.kind || "").toLowerCase();
      const at = desktopTime(payload.observedAt || body.startedAt || body.requestedAt || row.turnCompletedAt);

      if (kind === "message") {
        const role = String(row.role || body.role || "").toLowerCase();
        if (role === "user") {
          if (body.origin === "automation-run") continue;
          const text = extractOrcaMessageText(payload);
          if (!text) continue;
          const t = {
            turnItemId: "",
            userMsg: {
              id: row.id,
              role: "user",
              text,
              at,
              end: 0,
              updated: at,
              state: "run",
              step: "",
              error: "",
              model: sessModel,
              out: 0,
              fresh: 0,
              cached: 0,
            },
            assistants: [],
            lastTool: "",
            turnState: "",
            outcome: "",
            completedAt: 0,
            errorText: "",
            errorAt: 0,
            model: sessModel,
          };
          turns.push(t);
          continue;
        }
        if (role !== "assistant") continue;
        const turn = resolveTurn(payload);
        const blocks = Array.isArray(body.blocks) ? body.blocks : [];
        for (const b of blocks) {
          if (b?.type === "tool-call" && b.name) turn.lastTool = String(b.name).trim();
        }
        const text = extractOrcaMessageText(payload);
        if (!text) continue;
        turn.assistants.push({
          id: row.id,
          role: "assistant",
          text,
          at,
          end: 0,
          updated: at,
          state: "wait",
          step: "",
          error: "",
          model: turn.model || sessModel,
          out: 0,
          fresh: 0,
          cached: 0,
        });
        continue;
      }

      if (kind === "turn") {
        const userItemId = String(body.userItemId || "");
        let target = turns.find((t) => !t.turnItemId && t.userMsg && (!userItemId || t.userMsg.id === userItemId)) || ensureLastTurn();
        target.turnItemId = row.id;
        byTurnItemId.set(row.id, target);
        target.turnState = String(row.lifecycleState || body.state || "").toLowerCase();
        target.outcome = String(body.outcome || "").toLowerCase();
        target.completedAt = desktopTime(row.turnCompletedAt || body.completedAt);
        const ctxModel = String(body.contextUsage?.used?.model || "").trim();
        if (ctxModel) target.model = ctxModel;
        if (row.liveWork) target.turnState = "running";
        continue;
      }

      if (kind === "tool-call") {
        const turn = resolveTurn(payload);
        if (body.name) turn.lastTool = String(body.name).trim();
        continue;
      }

      if (kind === "status" && String(body.tone || "").toLowerCase() === "error") {
        const turn = resolveTurn(payload);
        const errText = String(body.text || "").trim().slice(0, 200);
        if (errText) {
          turn.errorText = errText;
          turn.errorAt = at;
        }
      }
    }

    const out = [];
    for (let ti = 0; ti < turns.length; ti++) {
      const turn = turns[ti];
      const isLastTurn = ti === turns.length - 1;
      const isRunning = turn.turnState === "running";
      const isFailed = turn.outcome === "failure" || turn.outcome === "error" || Boolean(turn.errorText);
      if (turn.userMsg) {
        if (!turn.assistants.length && isLastTurn && turn.lastTool) turn.userMsg.step = turn.lastTool;
        if (!turn.assistants.length && !turn.errorText && !isRunning) {
          turn.userMsg.state = isFailed ? "error" : "wait";
          turn.userMsg.end = turn.completedAt || turn.userMsg.at;
        }
        out.push(turn.userMsg);
      }
      if (!turn.assistants.length) {
        if (isLastTurn && isFailed && turn.errorText) {
          out.push({
            id: turn.userMsg ? `${turn.userMsg.id}-err` : `orca-err-${turn.errorAt || turn.completedAt || ti}`,
            role: "assistant",
            text: "",
            at: turn.errorAt || turn.completedAt || (turn.userMsg?.at || 0),
            end: turn.completedAt || turn.errorAt || 0,
            updated: turn.completedAt || turn.errorAt || 0,
            state: "error",
            step: "",
            error: turn.errorText,
            model: turn.model || sessModel,
            out: 0,
            fresh: 0,
            cached: 0,
          });
        }
        continue;
      }
      for (let ai = 0; ai < turn.assistants.length; ai++) {
        const a = turn.assistants[ai];
        const isLastAssistant = isLastTurn && ai === turn.assistants.length - 1;
        a.model = a.model || turn.model || sessModel;
        if (isLastAssistant) {
          a.state = isRunning ? "run" : isFailed ? "error" : "wait";
          a.error = isFailed ? turn.errorText : "";
          a.step = isRunning ? turn.lastTool : "";
          a.end = isRunning ? 0 : (turn.completedAt || a.at);
          a.updated = a.end || a.at;
        } else {
          a.state = "wait";
          a.end = turn.completedAt || a.at;
          a.updated = a.end || a.at;
        }
        out.push(a);
      }
    }
    return out;
  }
  let rows;
  if (agent === "qoder") {
    rows = await desktopQuery(db, `SELECT message_id AS id,payload_json AS data,status,created_at AS created,updated_at AS updated FROM chat_session_messages WHERE session_id=${quote(sid)} ORDER BY sequence`);
  } else {
    const [, message, part] = await openCodeTables(db);
    const v2 = message === "session_message";
    rows = await desktopQuery(db, `SELECT m.id,m.data,${v2 ? "m.type" : "''"} AS role,m.time_created AS created,m.time_updated AS updated,
      (SELECT json_group_array(json(p.data)) FROM (SELECT data FROM ${part} WHERE message_id=m.id ORDER BY ${v2 ? "ordinal" : "id"}) p) AS parts,
      (SELECT MAX(time_updated) FROM ${part} WHERE message_id=m.id) AS partUpdated
      FROM ${message} m WHERE m.session_id=${quote(sid)} ORDER BY ${v2 ? "m.seq" : "m.time_created,m.id"}`);
  }
  return rows.flatMap((row) => {
    const d = json(row.data), role = row.role || d.role || d.type;
    if (!["user", "assistant"].includes(role)) return [];
    const parts = json(row.parts, []);
    const content = parts.length ? parts : d.content || [];
    const rawText = typeof d.text === "string" ? d.text : (Array.isArray(content) ? content : []).filter((p) => p.type === "text" && !p.synthetic && !p.ignored).map((p) => p.text || "").join("\n");
    const strip = role === "user" ? (agent === "qwenwork" ? stripQwenWorkContext : agent === "teleagent" ? stripTeleAgentContext : null) : null;
    const text = strip ? strip(rawText) : rawText;
    const tool = [...(Array.isArray(content) ? content : []), ...(d.tools || [])].filter((p) => p.type === "tool" || p.name).at(-1);
    const tokens = d.tokens;
    const completed = desktopTime(d.completedAt || d.time?.completed);
    // TeleAgent 写的是 tool_calls（下划线），老 OpenCode 写 tool-calls（连字符），两种都表示「这一轮还在工具循环里」。
    // time.completed 在两种写法下都会置位，所以必须先看 finish，否则正在干活会被判成「等你」。
    const finish = String(d.finish || "").replace(/_/g, "-");
    // 工具循环里的会话靠 part 的更新维持「在跑」；客户端中途关掉时 part 也不再有更新，
    // 超过 TOOL_LOOP_IDLE_MIN 分钟就当作已停，避免 8 小时前的半截会话一直挂在「在跑」。
    const lastActivity = Math.max(desktopTime(row.updated), Number(row.partUpdated) || 0, completed || 0);
    const toolLoopRunning = finish === "tool-calls" && Date.now() - lastActivity <= TOOL_LOOP_IDLE_MIN * 60000;
    const fresh = Date.now() - lastActivity <= TOOL_LOOP_IDLE_MIN * 60000;
    // 没有 finish 也没有 completed，说明这一轮还在跑；但客户端中途关掉时它永远不会补上，
    // 所以同样要求最近 TOOL_LOOP_IDLE_MIN 分钟内还有动静。
    const state = role === "user" ? "run" : row.status === "failed" || d.error ? "error" : row.status === "interrupted" ? "wait" : finish === "tool-calls" ? (toolLoopRunning ? "run" : "wait") : completed || finish ? "wait" : fresh ? "run" : "wait";
    return [{ id: row.id, role, text, at: desktopTime(d.timestamp || d.time?.created || row.created), end: completed, updated: row.updated, state,
      step: state === "run" ? tool?.name || tool?.tool || "" : "", error: d.error ? JSON.stringify(d.error).slice(0, 200) : "", model: modelName(d.model || d.modelID),
      out: Number(tokens?.output) || 0, fresh: (Number(tokens?.input) || 0) + (Number(tokens?.cache?.write) || 0), cached: Number(tokens?.cache?.read) || 0 }];
  });
}
