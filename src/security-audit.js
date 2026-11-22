// Offline historical security replay & audit based on src/security.js rules.
//
// Replays recorded tool calls from local session logs / SQLite databases against
// evaluatePermissionPolicy() and redactSecrets() without proxies or live interception.

import fs from "fs";
import path from "path";
import { decompress } from "fzstd";
import { evaluatePermissionPolicy, matchesAllowlistRule, redactSecrets } from "./security.js";
import { desktopQuery, desktopTime, hermesTime } from "./desktop-sessions.js";
import { AGENTS } from "./constants.js";
import { t } from "./i18n.js";

const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const parseJson = (value, fallback = null) => {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(String(value || "")); } catch { return fallback; }
};

export function inferToolKind(name) {
  const s = String(name || "").toLowerCase();
  if (/bash|shell|exec|command|terminal|run_/.test(s)) return "execute";
  if (/write|edit|patch|delete|remove|move|rename|mkdir|create_file|file_change/.test(s)) return "edit";
  return "read";
}

function toRawInput(val) {
  if (!val) return {};
  if (typeof val === "object") return val;
  const parsed = parseJson(val);
  if (parsed && typeof parsed === "object") return parsed;
  return { command: String(val) };
}

function summarizeToolInput(toolCall, focusRe = null) {
  const raw = toolCall?.rawInput;
  let text = "";
  if (typeof raw === "string") text = raw;
  else if (raw && typeof raw === "object") {
    const pick = raw.command || raw.cmd || raw.script || raw.path || raw.file_path || raw.filePath || raw.target || raw.url;
    if (pick) text = String(pick);
    else { try { text = JSON.stringify(raw); } catch { /* ignore */ } }
  }
  if (!text) text = String(toolCall?.title || "");
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 160) return clean;
  if (focusRe) {
    const m = focusRe.exec(clean);
    if (m && m.index > 60) {
      const start = Math.max(0, m.index - 40);
      const slice = clean.slice(start, start + 160);
      return (start > 0 ? "…" : "") + slice + (start + 160 < clean.length ? "…" : "");
    }
  }
  return clean.slice(0, 160) + "…";
}

const SHELL_SENSITIVE_PATH_RE = /(?:~\/|\/|\b)(?:\.ssh\/|\.aws\/|\.gnupg\/|\.kube\/|secrets\.json|\.credentials\.(?:json|ya?ml)|\.env(?:\.[a-z0-9_-]+)?(?:\b|$)|\/etc\/(?:passwd|shadow|sudoers))/i;
const RISK_FOCUS_RE = {
  destructive_rm: /\brm\s+(?:-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive\s+--force|--no-preserve-root)\b/i,
  pipe_to_shell: /\b(?:curl|wget)\b[^|\n]*\|\s*(?:ba|z|da)?sh\b/i,
  privilege_escalation: /(?:^|[\n;&|]\s*)sudo\b/i,
  disk_format: /\b(?:mkfs(?:\.[a-z0-9]+)?|dd\s+if=)\b/i,
  world_writable: /\bchmod\s+(?:-R\s+)?777\b/i,
  force_push: /\bgit\s+push\b[^\n]*(?:--force(?:-with-lease)?|\s-f\b)/i,
  sensitive_path: SHELL_SENSITIVE_PATH_RE,
  secret_exposure: /\[REDACTED\]/,
};
const RISK_SEVERITY = {
  secret_exposure: 3,
  pipe_to_shell: 3,
  disk_format: 3,
  privilege_escalation: 3,
  force_push: 3,
  sensitive_path: 2,
  destructive_rm: 2,
  world_writable: 2,
  outside_workspace: 1,
};

const TEMP_PATH_RE = /^(?:\/private)?\/tmp(?:\/|$)|^(?:\/private)?\/var\/folders\//i;
const SAFE_RM_TARGET_RE = /^(?:(?:\/private)?\/tmp\/[^\s;|&]+|(?:\/private)?\/var\/folders\/[^\s;|&]+|(?:\.\/)?(?:dist|build|\.next|\.nuxt|out|coverage|node_modules|\.cache|__pycache__|\.pytest_cache|target\/debug|target\/release)(?:\/[^\s;|&]*)?)$/i;

/**
 * Check whether an `outside_workspace` or `destructive_rm` hit is routine temp/build-artifact noise.
 * Never suppresses sensitive paths, privilege escalation, pipe-to-shell, force-push, or secret exposure.
 */
export function isTempOrBuildNoise(risk, toolCall) {
  if (risk === "outside_workspace") {
    const raw = toolCall?.rawInput && typeof toolCall.rawInput === "object" ? toolCall.rawInput : {};
    const paths = [raw.path, raw.filePath, raw.file_path, raw.target, raw.targetPath]
      .map((v) => String(v || "").trim())
      .filter(Boolean);
    return paths.length > 0 && paths.every((p) => TEMP_PATH_RE.test(p));
  }
  if (risk === "destructive_rm") {
    const cmd = String(toolCall?.rawInput?.command || toolCall?.rawInput?.cmd || toolCall?.rawInput?.script || "");
    if (!cmd) return false;
    const matches = [...cmd.matchAll(/\brm\s+(?:-[a-z]+\s+|--(?:recursive|force)\s+)+([^\n;|&]+)/gi)];
    if (!matches.length) return false;
    for (const m of matches) {
      const tokens = m[1].trim().split(/\s+/).map((tok) => tok.replace(/^['"]|['"]$/g, "")).filter((tok) => tok && !tok.startsWith("-"));
      if (!tokens.length || !tokens.every((tok) => SAFE_RM_TARGET_RE.test(tok))) return false;
    }
    return true;
  }
  return false;
}

/**
 * Extract normalized tool calls `{ title, kind, rawInput, at }` from a JSONL transcript.
 */
export function extractToolCallsFromJsonl(agent, source) {
  const calls = [];
  if (!source) return calls;
  for (const line of String(source).split("\n")) {
    if (!line || line[0] !== "{") continue;
    // Fast-path pre-filter before JSON.parse
    if (
      (agent === "claude" || agent === "qoder" || agent === "qwenwork" || agent === "workbuddy") &&
      !line.includes("tool_use")
    ) continue;
    if (agent === "codex" && !line.includes("function_call") && !line.includes("tool_call") && !line.includes("shell_call")) continue;
    if (agent === "dsh" && !line.includes("tool/call")) continue;
    if (agent === "cursor" && !line.includes("beforeShellExecution") && !line.includes("beforeMCPExecution") && !line.includes("preToolUse")) continue;
    if (agent === "antigravity" && !line.includes("tool_calls")) continue;

    const d = parseJson(line);
    if (!d || typeof d !== "object") continue;
    const at = typeof d.time === "number" ? d.time : Date.parse(d.timestamp || d.ts || d.created_at || "") || 0;

    if (agent === "claude" || agent === "qoder" || agent === "qwenwork") {
      if (d.type !== "assistant" || !Array.isArray(d.message?.content)) continue;
      for (const b of d.message.content) {
        if (b?.type !== "tool_use") continue;
        calls.push({ title: b.name || "tool", kind: inferToolKind(b.name), rawInput: toRawInput(b.input), at });
      }
    } else if (agent === "workbuddy") {
      const content = Array.isArray(d.content) ? d.content : Array.isArray(d.message?.content) ? d.message.content : [];
      for (const b of content) {
        if (b?.type !== "tool_use") continue;
        calls.push({ title: b.name || "tool", kind: inferToolKind(b.name), rawInput: toRawInput(b.input), at });
      }
    } else if (agent === "codex") {
      if (d.type !== "response_item" || !d.payload) continue;
      const p = d.payload;
      if (p.type === "function_call" || p.type === "custom_tool_call") {
        const name = p.name || "tool";
        calls.push({ title: name, kind: inferToolKind(name), rawInput: toRawInput(p.arguments ?? p.input), at });
      } else if (p.type === "local_shell_call") {
        const cmd = Array.isArray(p.action?.command) ? p.action.command.join(" ") : (p.action?.command || p.command || "");
        calls.push({ title: "local_shell_call", kind: "execute", rawInput: { command: String(cmd) }, at });
      }
    } else if (agent === "dsh") {
      if (d.type !== "tool/call") continue;
      const data = d.data || {};
      const name = data.name || "tool";
      calls.push({ title: name, kind: inferToolKind(name), rawInput: toRawInput(data.arguments ?? data.input), at });
    } else if (agent === "cursor") {
      const ev = String(d.hook_event_name || d.event || "");
      if (ev === "beforeShellExecution") {
        calls.push({ title: "shell", kind: "execute", rawInput: { command: String(d.command || ""), cwd: d.cwd || "" }, at });
      } else if (ev === "beforeMCPExecution" || ev === "preToolUse") {
        const name = d.tool_name || d.tool || "tool";
        calls.push({ title: name, kind: inferToolKind(name), rawInput: toRawInput(d.tool_input ?? d.input), at });
      }
    } else if (agent === "antigravity") {
      for (const tc of Array.isArray(d.tool_calls) ? d.tool_calls : []) {
        if (!tc || typeof tc !== "object") continue;
        const name = tc.name || "tool";
        const args = toRawInput(tc.args ?? tc.arguments ?? tc.input);
        const normalized = {
          ...args,
          ...(args.CommandLine && !args.command ? { command: String(args.CommandLine) } : {}),
          ...(args.Path && !args.path ? { path: String(args.Path) } : {}),
        };
        calls.push({ title: name, kind: inferToolKind(name), rawInput: normalized, at });
      }
    }
  }
  return calls;
}

/**
 * Extract normalized tool calls from desktop SQLite databases (Hermes / MiniMax / OpenCode / QwenWork / Qoder / T3 Code).
 */
export async function extractToolCallsFromDesktopDb(db, agent, sid) {
  const calls = [];
  if (!db || !sid || !fs.existsSync(db)) return calls;
  try {
    if (agent === "hermes") {
      const rows = await desktopQuery(db, `SELECT tool_calls AS toolCalls, timestamp AS created FROM messages WHERE session_id=${quote(sid)} AND tool_calls IS NOT NULL AND tool_calls <> '' ORDER BY id`);
      for (const r of rows) {
        const at = hermesTime(r.created);
        const arr = parseJson(r.toolCalls, []);
        for (const c of Array.isArray(arr) ? arr : []) {
          const name = c?.function?.name || c?.name || "tool";
          const raw = c?.function?.arguments ?? c?.arguments ?? c?.input;
          calls.push({ title: name, kind: inferToolKind(name), rawInput: toRawInput(raw), at });
        }
      }
    } else if (agent === "minimax") {
      const rows = await desktopQuery(db, `SELECT created_at_ms AS created, data_json AS data FROM local_runtime_message_rows WHERE session_id=${quote(sid)} ORDER BY id`);
      for (const r of rows) {
        const d = parseJson(r.data, {});
        const at = desktopTime(d?.timestamp || d?.created_at || r.created);
        for (const c of Array.isArray(d?.tool_calls) ? d.tool_calls : []) {
          const name = c?.function?.name || c?.name || c?.tool_name || "tool";
          calls.push({ title: name, kind: inferToolKind(name), rawInput: toRawInput(c?.function?.arguments ?? c?.arguments ?? c?.input), at });
        }
        for (const b of Array.isArray(d?.content) ? d.content : []) {
          if (b?.type !== "tool_use") continue;
          calls.push({ title: b.name || "tool", kind: inferToolKind(b.name), rawInput: toRawInput(b.input), at });
        }
      }
    } else if (agent === "qoder") {
      const rows = await desktopQuery(db, `SELECT payload_json AS data, created_at AS created FROM chat_session_messages WHERE session_id=${quote(sid)} ORDER BY sequence`);
      for (const r of rows) {
        const d = parseJson(r.data, {});
        const at = desktopTime(d?.timestamp || r.created);
        for (const item of [...(Array.isArray(d?.tools) ? d.tools : []), ...(Array.isArray(d?.content) ? d.content : [])]) {
          if (!item || (item.type !== "tool" && item.type !== "tool_use" && !item.name)) continue;
          const name = item.name || item.tool || "tool";
          calls.push({ title: name, kind: inferToolKind(name), rawInput: toRawInput(item.input ?? item.arguments ?? item.params), at });
        }
      }
    } else if (agent === "t3code") {
      const tables = await desktopQuery(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='orchestration_v2_projection_turn_items'");
      if (tables.length) {
        const rows = await desktopQuery(db, `SELECT type, created_at AS created, payload_json AS payload FROM orchestration_v2_projection_turn_items WHERE thread_id=${quote(sid)} AND type IN ('command_execution','file_change','dynamic_tool') ORDER BY ordinal`);
        for (const r of rows) {
          const p = parseJson(r.payload, {});
          const at = desktopTime(p?.createdAt || r.created);
          const name = p?.toolName || p?.name || r.type;
          const rawInput = r.type === "command_execution"
            ? { command: p?.command || p?.cmd || "" }
            : toRawInput(p?.input ?? p?.arguments ?? (p?.path ? { path: p.path } : p));
          calls.push({ title: name, kind: inferToolKind(r.type === "file_change" ? "edit" : name), rawInput, at });
        }
      }
    } else if (agent === "opencode" || agent === "qwenwork") {
      const tables = await desktopQuery(db, "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('session_part','part')");
      const partTable = tables.some((x) => x.name === "session_part") ? "session_part" : tables.some((x) => x.name === "part") ? "part" : "";
      if (partTable) {
        const rows = await desktopQuery(db, `SELECT data, time_created AS created FROM ${partTable} WHERE session_id=${quote(sid)} ORDER BY id`);
        for (const r of rows) {
          const d = parseJson(r.data, {});
          if (d?.type !== "tool") continue;
          const name = d.tool || d.name || "tool";
          calls.push({ title: name, kind: inferToolKind(name), rawInput: toRawInput(d.state?.input ?? d.input ?? d.arguments), at: desktopTime(r.created) });
        }
      }
    }
  } catch { /* ignore unreadable/locked db */ }
  return calls;
}

/**
 * Parse YAML frontmatter config (`days`, `agent`, `ignore_temp_noise`, `allowlist`)
 * from an existing `Agent Deck/安全审计.md` report.
 */
export function parseAuditConfig(markdown) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(markdown || ""));
  if (!m) return { days: null, agent: "", ignoreTempNoise: null, allowlist: [] };
  const lines = m[1].split(/\r?\n/);
  const allowlist = [];
  let days = null;
  let agent = "";
  let ignoreTempNoise = null;
  let inList = false;
  for (const line of lines) {
    if (/^\s*allowlist\s*:\s*$/.test(line)) { inList = true; continue; }
    const inline = /^\s*allowlist\s*:\s*\[([^\]]*)\]\s*$/.exec(line);
    if (inline) {
      for (const part of inline[1].split(",")) {
        const clean = part.trim().replace(/^['"]|['"]$/g, "").trim();
        if (clean) allowlist.push(clean);
      }
      inList = false;
      continue;
    }
    const daysM = /^\s*days\s*:\s*(\d+)/.exec(line);
    if (daysM) { days = Math.max(1, Math.min(365, Number(daysM[1]))); inList = false; continue; }
    const agentM = /^\s*agent\s*:\s*(.*)$/.exec(line);
    if (agentM) {
      agent = agentM[1].replace(/\s+#.*$/, "").replace(/^['"]|['"]$/g, "").trim();
      inList = false;
      continue;
    }
    const noiseM = /^\s*ignore_temp_noise\s*:\s*(true|false)\b/i.exec(line);
    if (noiseM) { ignoreTempNoise = noiseM[1].toLowerCase() === "true"; inList = false; continue; }
    if (inList) {
      if (/^\s*#/.test(line) || !line.trim()) continue;
      const item = /^\s*-\s+(.+?)\s*$/.exec(line);
      if (item) {
        const clean = item[1].replace(/\s+#.*$/, "").replace(/^['"]|['"]$/g, "").trim();
        if (clean) allowlist.push(clean);
      } else if (/^\S/.test(line)) {
        inList = false;
      }
    }
  }
  return { days, agent, ignoreTempNoise, allowlist: [...new Set(allowlist)] };
}

export function parseAuditAllowlist(markdown) {
  return parseAuditConfig(markdown).allowlist;
}

/**
 * Evaluate a list of normalized tool calls against src/security.js policy & secret patterns.
 * All returned snippets are redacted via redactSecrets().
 */
export function auditToolCalls(toolCalls, { cwd = "", vaultPath = "", agent = "", sid = "", title = "", allowlist = [], ignoreTempNoise = true, stats = null } = {}) {
  const findings = [];
  for (const call of toolCalls || []) {
    const policy = evaluatePermissionPolicy(call, { cwd, vaultPath, autoApprove: true, allowlist });
    if (policy.reason === "allowlisted") {
      if (stats) stats.suppressedByAllowlist = (stats.suppressedByAllowlist || 0) + 1;
    }
    const serialized = (() => { try { return JSON.stringify(call.rawInput || ""); } catch { return ""; } })();
    const redactedSerialized = redactSecrets(serialized);
    const hasSecret = redactedSerialized !== serialized;

    // Skip outside_workspace when session cwd is unknown (cannot determine allowed root honestly).
    if (policy.escalated && !(policy.risk === "outside_workspace" && !cwd)) {
      if (ignoreTempNoise && isTempOrBuildNoise(policy.risk, call)) {
        if (stats) stats.suppressedNoise = (stats.suppressedNoise || 0) + 1;
      } else {
        const preview = redactSecrets(summarizeToolInput(call, RISK_FOCUS_RE[policy.risk] || null));
        findings.push({
          agent,
          sid,
          title: title || sid,
          at: call.at || 0,
          tool: call.title || "tool",
          risk: policy.risk,
          severity: RISK_SEVERITY[policy.risk] || 2,
          reason: policy.reason,
          preview,
        });
      }
    } else if (!policy.escalated && policy.reason !== "allowlisted" && call.kind === "execute" && SHELL_SENSITIVE_PATH_RE.test(serialized)) {
      const allowMatched = (allowlist || []).some((rule) => matchesAllowlistRule(rule, { text: serialized, risk: "sensitive_path" }));
      if (allowMatched) {
        if (stats) stats.suppressedByAllowlist = (stats.suppressedByAllowlist || 0) + 1;
      } else {
        // Catch sensitive credential paths referenced inside shell command strings.
        const preview = redactSecrets(summarizeToolInput(call, SHELL_SENSITIVE_PATH_RE));
        findings.push({
          agent,
          sid,
          title: title || sid,
          at: call.at || 0,
          tool: call.title || "tool",
          risk: "sensitive_path",
          severity: RISK_SEVERITY.sensitive_path,
          reason: "sensitive_path_in_shell",
          preview,
        });
      }
    }
    if (hasSecret) {
      const fullRedacted = redactSecrets(summarizeToolInput(call));
      const focusPreview = (() => {
        const clean = redactSecrets(String(call.rawInput?.command || call.rawInput?.cmd || serialized || "")).replace(/\s+/g, " ").trim();
        const m = /\[REDACTED\]/.exec(clean);
        if (m && clean.length > 160 && m.index > 60) {
          const start = Math.max(0, m.index - 40);
          return (start > 0 ? "…" : "") + clean.slice(start, start + 160) + (start + 160 < clean.length ? "…" : "");
        }
        return fullRedacted;
      })();
      findings.push({
        agent,
        sid,
        title: title || sid,
        at: call.at || 0,
        tool: call.title || "tool",
        risk: "secret_exposure",
        severity: RISK_SEVERITY.secret_exposure,
        reason: "secret_exposure",
        preview: focusPreview,
      });
    }
  }
  return findings;
}

const RISK_LABELS = () => ({
  destructive_rm: t("高危删除命令 (rm -rf)"),
  pipe_to_shell: t("管道直接执行脚本 (curl/wget | sh)"),
  privilege_escalation: t("提权命令 (sudo)"),
  disk_format: t("磁盘覆写命令 (mkfs / dd)"),
  world_writable: t("全局可写权限 (chmod 777)"),
  force_push: t("强制推送 (git push --force)"),
  sensitive_path: t("访问敏感凭据路径 (.ssh / .env / .aws 等)"),
  outside_workspace: t("工作区外写入/删除"),
  secret_exposure: t("工具参数中出现明文密钥/Token"),
});

function fmtTime(ms) {
  if (!ms) return "—";
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Replay tool calls across sessions in `plugin.usage.files` over the last `days` days.
 */
export async function runSecurityAudit(plugin, { days = 30, agent = "", ignoreTempNoise = true, now = Date.now(), maxFindings = 200, allowlist = null } = {}) {
  const cutoff = days > 0 ? now - days * 86400000 : 0;
  const onlyAgent = String(agent || "").trim();
  const vaultPath = plugin?.app?.vault?.adapter?.basePath || plugin?.vaultPath || "";
  const activeAllowlist = Array.isArray(allowlist) ? allowlist : (plugin?.settings?.securityAllowlist || []);
  const files = [...(plugin?.usage?.files?.values?.() || [])];
  const metaMap = plugin?.usage?.meta || new Map();

  let scannedSessions = 0;
  let totalToolCalls = 0;
  const stats = { suppressedByAllowlist: 0, suppressedNoise: 0 };
  const findings = [];
  const byRisk = new Map();
  const byAgent = new Map();
  const seenSession = new Set();

  let processed = 0;
  for (const fc of files) {
    if (!fc || !fc.path || !fc.agent || fc.sub) continue;
    if (onlyAgent && fc.agent !== onlyAgent) continue;
    const meta = metaMap.get(fc.sid) || {};
    const lastAt = meta.lastAt || fc.mtime || 0;
    if (cutoff && lastAt && lastAt < cutoff) continue;

    if (++processed % 20 === 0) await new Promise((r) => setImmediate(r));

    const sessKey = `${fc.agent}:${fc.sid}`;
    if (!seenSession.has(sessKey)) {
      seenSession.add(sessKey);
      scannedSessions++;
    }

    let calls = [];
    if (fc.path.includes("#")) {
      const db = fc.path.slice(0, fc.path.lastIndexOf("#"));
      if (["hermes", "minimax", "opencode", "qwenwork", "qoder", "t3code"].includes(fc.agent)) {
        calls = await extractToolCallsFromDesktopDb(db, fc.agent, fc.sid);
      }
    } else {
      try {
        const raw = await fs.promises.readFile(fc.path);
        let bytes = raw;
        if (fc.zstd) {
          try { bytes = decompress(raw); }
          catch { bytes = fc.zOff ? decompress(raw.subarray(0, fc.zOff)) : null; }
        }
        if (bytes) calls = extractToolCallsFromJsonl(fc.agent, Buffer.from(bytes).toString("utf8"));
      } catch { /* unreadable file */ }
    }

    if (cutoff) calls = calls.filter((c) => !c.at || c.at >= cutoff);
    totalToolCalls += calls.length;

    const hits = auditToolCalls(calls, {
      cwd: fc.cwd || meta.cwd || "",
      vaultPath,
      agent: fc.agent,
      sid: fc.sid,
      title: meta.title || fc.titles?.get?.(fc.sid) || fc.sid,
      allowlist: activeAllowlist,
      ignoreTempNoise,
      stats,
    });
    for (const h of hits) {
      byRisk.set(h.risk, (byRisk.get(h.risk) || 0) + 1);
      byAgent.set(h.agent, (byAgent.get(h.agent) || 0) + 1);
      findings.push(h);
    }
  }

  // Suggest top recurring outside_workspace directory prefixes as copy-ready allowlist rules.
  const dirCounts = new Map();
  for (const f of findings) {
    if (f.risk !== "outside_workspace") continue;
    const p = String(f.preview || "").trim();
    if (!p.startsWith("/")) continue;
    const dir = path.dirname(p);
    if (!dir || dir === "/") continue;
    const key = `path:${dir}/`;
    if (activeAllowlist.includes(key)) continue;
    dirCounts.set(key, (dirCounts.get(key) || 0) + 1);
  }
  const suggestedAllowlist = [...dirCounts.entries()]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([rule, count]) => ({ rule, count }));

  // Sort by severity descending first so high-risk hits are never crowded out by outside_workspace noise.
  findings.sort((a, b) => ((b.severity || 0) - (a.severity || 0)) || ((b.at || 0) - (a.at || 0)));
  return {
    days,
    agent: onlyAgent,
    ignoreTempNoise,
    generatedAt: now,
    scannedSessions,
    totalToolCalls,
    totalFindings: findings.length,
    suppressedByAllowlist: stats.suppressedByAllowlist,
    suppressedNoise: stats.suppressedNoise,
    allowlist: [...activeAllowlist],
    suggestedAllowlist,
    truncated: findings.length > maxFindings,
    findings: findings.slice(0, maxFindings),
    byRisk: Object.fromEntries([...byRisk.entries()].sort((a, b) => b[1] - a[1])),
    byAgent: Object.fromEntries([...byAgent.entries()].sort((a, b) => b[1] - a[1])),
  };
}

/**
 * Render an offline security replay report as Markdown (safe to store inside Obsidian Vault).
 */
export function renderSecurityAuditReport(result) {
  const labels = RISK_LABELS();
  const activeAllowlist = Array.isArray(result.allowlist) ? result.allowlist : [];
  const fmLines = [
    "---",
    `days: ${Number(result.days) || 30}`,
    `agent: ${JSON.stringify(result.agent || "")}`,
    `ignore_temp_noise: ${result.ignoreTempNoise !== false}`,
    "allowlist:",
    ...(activeAllowlist.length
      ? activeAllowlist.map((r) => `  - ${JSON.stringify(r)}`)
      : [
          `  # ${t("示例（取消注释并重新运行安全回放，即刻降噪并同步到 ACP 实时护栏）：")}`,
          "  # - path:/tmp/",
          "  # - cmd:rm -rf ./dist",
        ]),
    "---",
    "",
  ];
  const extraParts = [];
  if (result.agent) extraParts.push(`Agent：${AGENTS[result.agent]?.name || result.agent}`);
  if (result.suppressedByAllowlist) extraParts.push(`${t("白名单已放行")}：${result.suppressedByAllowlist}`);
  if (result.suppressedNoise) extraParts.push(`${t("已降噪临时/构建目录")}：${result.suppressedNoise}`);
  const extraStr = extraParts.length ? ` · ${extraParts.join(" · ")}` : "";
  const lines = [
    ...fmLines,
    `# ${t("安全回放与审计报告")}`,
    "",
    `> ${t("生成时间")}：${fmtTime(result.generatedAt)} · ${t("统计窗口")}：${t("最近 {n} 天", { n: result.days })} · ${t("已扫描会话")}：${result.scannedSessions} · ${t("回放工具调用")}：${result.totalToolCalls} · ${t("命中风险")}：${result.totalFindings}${extraStr}`,
    "",
    `> ${t("说明：本报告基于 security.js 规则离线回放历史工具调用，仅做只读审计与护栏演练，所有输出片段已自动脱敏。直接修改上方 frontmatter 的 allowlist 并重新运行审计命令，即可同步更新 ACP 实时护栏白名单。")}`,
    "",
  ];

  if (Array.isArray(result.suggestedAllowlist) && result.suggestedAllowlist.length) {
    lines.push(`## ${t("建议加入白名单的高频目录")}`, "");
    for (const s of result.suggestedAllowlist) {
      lines.push(`- \`${s.rule}\`（${t("命中 {n} 次", { n: s.count })}）`);
    }
    lines.push("");
  }

  if (!result.totalFindings) {
    lines.push(t("在最近 {n} 天的已记录工具调用中，未命中任何高危规则或明文密钥泄露。", { n: result.days }), "");
    return lines.join("\n");
  }

  lines.push(`## ${t("按风险类型汇总")}`, "", `| ${t("风险类型")} | ${t("命中次数")} |`, "| --- | ---: |");
  for (const [risk, count] of Object.entries(result.byRisk || {})) {
    lines.push(`| ${labels[risk] || risk} | ${count} |`);
  }
  lines.push("");

  lines.push(`## ${t("按 Agent 汇总")}`, "", `| Agent | ${t("命中次数")} |`, "| --- | ---: |");
  for (const [agent, count] of Object.entries(result.byAgent || {})) {
    lines.push(`| ${AGENTS[agent]?.name || agent} | ${count} |`);
  }
  lines.push("");

  lines.push(`## ${t("命中明细")}${result.truncated ? ` (${t("仅展示最近 {n} 条", { n: result.findings.length })})` : ""}`, "");
  lines.push(`| ${t("时间")} | Agent | ${t("风险")} | ${t("工具")} | ${t("脱敏摘要")} | ${t("会话")} |`);
  lines.push("| --- | --- | --- | --- | --- | --- |");
  const esc = (s) => String(s || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  for (const f of result.findings || []) {
    const agentName = AGENTS[f.agent]?.short || f.agent;
    const riskName = labels[f.risk] || f.risk;
    const link = f.sid
      ? `[${esc(String(f.title || f.sid).slice(0, 28))}](obsidian://agent-deck?do=open&agent=${encodeURIComponent(f.agent)}&sid=${encodeURIComponent(f.sid)})`
      : "—";
    lines.push(`| ${fmtTime(f.at)} | ${esc(agentName)} | ${esc(riskName)} | \`${esc(f.tool)}\` | \`${esc(f.preview)}\` | ${link} |`);
  }
  lines.push("");
  return lines.join("\n");
}
