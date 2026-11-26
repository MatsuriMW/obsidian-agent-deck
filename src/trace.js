// Lightweight local run tracing, bounded protocol frame buffering, and diagnostic export.

import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { redactSecrets } from "./security.js";

export const TRACE_SCHEMA_VERSION = 1;
export const DEFAULT_TRACE_DIR = () => path.join(os.homedir(), ".agent-deck", "traces");
const MAX_FRAMES = 30;
const MAX_SPANS = 32;
let lastPrunedAt = 0;

function isTestRuntime() {
  return Boolean(process.env.NODE_TEST_CONTEXT) || process.argv.some((a) => /(?:^|[\\/])test[\\/]|\.test\.mjs$/i.test(String(a)));
}

export function makeTraceId(now = Date.now()) {
  const rand = Math.random().toString(36).slice(2, 7);
  return `tr_${Number(now).toString(36)}_${rand}`;
}

export function classifyError(message) {
  const msg = String(message || "");
  if (!msg) return "";
  if (/超时|timeout|timed out/i.test(msg)) return "timeout";
  if (/限额|额度|余额|quota|rate.?limit|too many requests|\b429\b|overloaded/i.test(msg)) return "quota_or_rate_limit";
  if (/权限|permission|denied|unauthorized|未授权|401|403|拒绝/i.test(msg)) return "permission_denied";
  if (/找不到|ENOENT|not found|未安装/i.test(msg)) return "not_found";
  if (/取消|cancelled|canceled|aborted/i.test(msg)) return "cancelled";
  if (/连接已关闭|连接已结束|Unsupported method|JSON|协议|protocol/i.test(msg)) return "protocol_error";
  if (/退出码|提前退出|exit/i.test(msg)) return "exit_nonzero";
  return "unknown";
}

function dayStamp(ts = Date.now()) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export class RunTrace {
  constructor({
    traceId = makeTraceId(),
    agent = "",
    jobId = "",
    project = "",
    transport = "",
    traceDir = undefined,
    writeEnabled = undefined,
  } = {}) {
    this.traceId = traceId;
    this.agent = agent;
    this.jobId = jobId;
    this.project = project;
    this.transport = transport;
    const explicitDir = traceDir !== undefined;
    this.traceDir = explicitDir ? traceDir : DEFAULT_TRACE_DIR();
    this.writeEnabled = writeEnabled !== undefined ? Boolean(writeEnabled) : (explicitDir || !isTestRuntime());
    this.startedAt = Date.now();
    this.endedAt = 0;
    this.status = "running";
    this.errorCategory = "";
    this.errorMessage = "";
    this.contextStats = null;
    this.usage = null;
    this.permissionDecisions = [];
    this.spans = [];
    this.recentFrames = [];
    this._finalized = false;
  }

  startSpan(name, attrs = {}) {
    return { name: String(name || "span"), startedAt: Date.now(), attrs };
  }

  endSpan(span, status = "ok", attrs = {}) {
    if (!span || this.spans.length >= MAX_SPANS) return null;
    const endedAt = Date.now();
    const record = {
      name: span.name,
      status,
      durationMs: Math.max(0, endedAt - (span.startedAt || endedAt)),
      ...span.attrs,
      ...attrs,
    };
    this.spans.push(record);
    return record;
  }

  recordFrame(kind, summary = "") {
    const clean = redactSecrets(String(summary || "")).slice(0, 180);
    this.recentFrames.push({
      at: Date.now(),
      kind: String(kind || "event"),
      ...(clean ? { summary: clean } : {}),
    });
    if (this.recentFrames.length > MAX_FRAMES) {
      this.recentFrames.splice(0, this.recentFrames.length - MAX_FRAMES);
    }
  }

  recordPermission(decision) {
    if (!decision) return;
    this.permissionDecisions.push({
      at: Date.now(),
      tool: redactSecrets(String(decision.tool || "")).slice(0, 80),
      mode: String(decision.mode || "manual"),
      outcome: String(decision.outcome || ""),
      ...(decision.risk ? { risk: String(decision.risk) } : {}),
    });
    if (this.permissionDecisions.length > MAX_FRAMES) {
      this.permissionDecisions.splice(0, this.permissionDecisions.length - MAX_FRAMES);
    }
  }

  toJSON() {
    const end = this.endedAt || Date.now();
    return {
      schemaVersion: TRACE_SCHEMA_VERSION,
      traceId: this.traceId,
      jobId: this.jobId,
      agent: this.agent,
      transport: this.transport,
      project: this.project,
      status: this.status,
      startedAt: this.startedAt,
      endedAt: end,
      durationMs: Math.max(0, end - this.startedAt),
      ...(this.errorCategory ? { errorCategory: this.errorCategory } : {}),
      ...(this.errorMessage ? { errorMessage: this.errorMessage } : {}),
      ...(this.contextStats ? { contextStats: this.contextStats } : {}),
      ...(this.usage ? { usage: this.usage } : {}),
      ...(this.permissionDecisions.length ? { permissionDecisions: this.permissionDecisions } : {}),
      ...(this.spans.length ? { spans: this.spans } : {}),
      ...(this.recentFrames.length ? { recentFrames: this.recentFrames } : {}),
    };
  }

  async finalize(status, { error = "", usage = null, transport = "" } = {}) {
    if (this._finalized) return this.toJSON();
    this._finalized = true;
    this.endedAt = Date.now();
    this.status = String(status || "done");
    if (transport) this.transport = transport;
    if (usage) this.usage = usage;
    if (error) {
      this.errorMessage = redactSecrets(String(error)).slice(0, 300);
      this.errorCategory = classifyError(this.errorMessage);
    }
    const payload = this.toJSON();
    if (this.writeEnabled && this.traceDir) {
      try {
        await fsp.mkdir(this.traceDir, { recursive: true });
        const file = path.join(this.traceDir, `${dayStamp(this.endedAt)}.jsonl`);
        await fsp.appendFile(file, JSON.stringify(payload) + "\n", "utf8");
        if (Date.now() - lastPrunedAt > 6 * 3600000) {
          lastPrunedAt = Date.now();
          await pruneOldTraces({ traceDir: this.traceDir, keepDays: 14, now: this.endedAt });
        }
      } catch {
        // Tracing must never break delegation lifecycle.
      }
    }
    return payload;
  }
}

/** Delete JSONL trace files older than keepDays to keep local disk usage bounded. */
export async function pruneOldTraces({ traceDir = DEFAULT_TRACE_DIR(), keepDays = 14, now = Date.now() } = {}) {
  try {
    const cutoff = dayStamp(now - Math.max(1, Number(keepDays) || 14) * 86400000);
    const files = await fsp.readdir(traceDir);
    let removed = 0;
    for (const file of files) {
      const m = /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(file);
      if (m && m[1] < cutoff) {
        await fsp.rm(path.join(traceDir, file), { force: true });
        removed++;
      }
    }
    return removed;
  } catch {
    return 0;
  }
}

export async function readRecentTraces({ traceDir = DEFAULT_TRACE_DIR(), limit = 40 } = {}) {
  try {
    const files = (await fsp.readdir(traceDir))
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .sort()
      .reverse();
    const records = [];
    for (const file of files) {
      if (records.length >= limit) break;
      const raw = await fsp.readFile(path.join(traceDir, file), "utf8");
      const lines = raw.trim().split("\n").reverse();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          records.push(JSON.parse(line));
          if (records.length >= limit) break;
        } catch { /* skip malformed trace line */ }
      }
    }
    return records;
  } catch {
    return [];
  }
}

/** Check whether Vault-installed runtime scripts match expected plugin asset versions. */
export function checkExternalAssets(vaultPath, { expectedMemoryQueryVersion = 1, expectedMemoryMcpVersion = null } = {}) {
  const cleanVault = String(vaultPath || "").trim();
  if (!cleanVault) return { checked: false, ok: true, items: [] };
  const scriptsDir = path.join(cleanVault, ".obsidian", "plugins", "agent-deck", "scripts");
  const specs = [{ name: "memory-query.mjs", expectedVersion: expectedMemoryQueryVersion }];
  if (expectedMemoryMcpVersion != null) specs.push({ name: "memory-mcp.mjs", expectedVersion: expectedMemoryMcpVersion });
  const items = [];
  for (const spec of specs) {
    const scriptPath = path.join(scriptsDir, spec.name);
    if (!fs.existsSync(scriptPath)) {
      items.push({ name: spec.name, status: "missing", path: scriptPath, expectedVersion: spec.expectedVersion, actualVersion: null });
    } else {
      let actualVersion = null;
      try {
        const content = fs.readFileSync(scriptPath, "utf8");
        const m = /\bexport\s+const\s+ASSET_VERSION\s*=\s*(\d+)/.exec(content);
        actualVersion = m ? Number(m[1]) : 0;
      } catch {
        actualVersion = -1;
      }
      const status = actualVersion === spec.expectedVersion ? "ok" : "drifted";
      items.push({ name: spec.name, status, path: scriptPath, expectedVersion: spec.expectedVersion, actualVersion });
    }
  }
  return {
    checked: true,
    ok: items.every((i) => i.status === "ok"),
    items,
  };
}

export function buildDiagnosticReport({
  version = "",
  platform = process.platform,
  nodeVersion = process.version,
  storeVersion = null,
  summaryVersion = null,
  usageCacheVersion = null,
  circuitBreakers = {},
  traces = [],
  assetCheck = null,
  providerSummary = [],
} = {}) {
  const byStatus = {};
  const byErrorCategory = {};
  const byAgent = {};
  for (const tr of traces) {
    const s = tr?.status || "unknown";
    byStatus[s] = (byStatus[s] || 0) + 1;
    if (tr?.errorCategory) byErrorCategory[tr.errorCategory] = (byErrorCategory[tr.errorCategory] || 0) + 1;
    if (tr?.agent) byAgent[tr.agent] = (byAgent[tr.agent] || 0) + 1;
  }
  return {
    generatedAt: new Date().toISOString(),
    plugin: { version, storeVersion, summaryVersion, usageCacheVersion },
    runtime: { platform, nodeVersion },
    assets: assetCheck || { checked: false, ok: true, items: [] },
    providers: providerSummary,
    circuitBreakers,
    traceSummary: {
      sampleCount: traces.length,
      byStatus,
      byErrorCategory,
      byAgent,
      recentFailures: traces
        .filter((tr) => tr?.status === "error")
        .slice(0, 10)
        .map((tr) => ({
          traceId: tr.traceId,
          agent: tr.agent,
          errorCategory: tr.errorCategory || "unknown",
          errorMessage: redactSecrets(tr.errorMessage || ""),
          durationMs: tr.durationMs,
        })),
    },
    recentTraces: traces.slice(0, 20),
  };
}
