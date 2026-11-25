// 管家中途干预：看板波次里的 worker 长时间没有输出时，报一次、写回一次。
//
// 只做"卡住"。另外两类条件早就有自己的路，再报一遍就是噪音：
//   · 出错 → onWorkbenchJobSettled 已经把子卡改成 ERRORED；
//   · 待授权 / 待确认 → attention.js + checkAttention 已经弹通知。
// 判定仍复用 attentionReason，保证"什么算等你"只有一处定义。
//
// 同一条件只提醒一次：键记在 wave.watchSeen 里，条件消失后键会被清掉，
// 下次再卡住能重新提醒（不是"永远不提醒"）。

import { attentionReason } from "./attention.js";

export const STEWARD_STUCK_MS = 15 * 60 * 1000;
export const STEWARD_WATCH_MS = 5 * 60 * 1000;

const RUNNING = new Set(["starting", "running", "bound", "wait"]);

// 最后一次看到它的动静：优先会话元信息（外部客户端的 lastAt），其次 job 自己的时间戳。
const lastActivity = (job, meta) => Number(meta?.lastAt || job?.lastAt || job?.startedAt || 0);

export function judgeWave(wave, { jobs = {}, metaMap = null, now = Date.now(), stuckMs = STEWARD_STUCK_MS } = {}) {
  const out = [];
  const targets = [...(wave?.workers || [])];
  if (wave?.state === "running" && wave.steward?.jobId) {
    targets.push({
      jobId: wave.steward.jobId,
      blockId: wave.steward.blockId || wave.parentBlockId || "",
      title: wave.parentTitle ? `管家汇总：${wave.parentTitle}` : "管家汇总",
      state: "running",
    });
  }
  for (const worker of targets) {
    const job = worker.jobId ? jobs?.[worker.jobId] : null;
    if (!job) continue; // 还没起会话的 worker 不算卡住
    const state = job.state || worker.state || "";
    const sid = job.sessionId || worker.sessionId || "";
    const meta = sid && metaMap ? metaMap.get(sid) : null;
    const base = { waveId: wave.id || "", worker, job, sid, title: worker.title || job.name || "" };
    // 先问 attention：出错里也有一部分其实是"首轮就要你授权"，那该走授权那条路。
    const reason = attentionReason({ ...job, state, lastText: meta?.lastText || job.result || "" });
    if (state === "needs-approval" || reason) { out.push({ ...base, kind: "approval", handledBy: "attention" }); continue; }
    if (state === "error") { out.push({ ...base, kind: "error", handledBy: "board" }); continue; }
    if (!RUNNING.has(state)) continue;
    const at = lastActivity(job, meta) || Number(wave.updatedAt) || now;
    const idle = now - at;
    if (idle < stuckMs) continue;
    out.push({ ...base, kind: "stuck", handledBy: "", idleMs: idle, minutes: Math.max(1, Math.round(idle / 60000)), lastAt: at });
  }
  return out;
}

export const findingKey = (f) => `${f?.waveId || ""}:${f?.worker?.jobId || f?.job?.id || ""}:${f?.kind || ""}`;

// 这一轮里还没报过的（同一 wave 同一 worker 同一条件只报一次）。
export function newFindings(wave, findings = []) {
  const seen = wave?.watchSeen || {};
  return (findings || []).filter((f) => !seen[findingKey(f)]);
}

// 把这一轮仍然成立的条件记下来；消失的键丢掉，复发时还能再提醒。
export function syncSeen(wave, findings = [], now = Date.now()) {
  if (!wave) return {};
  const prev = wave.watchSeen || {};
  const next = {};
  for (const f of findings || []) {
    const key = findingKey(f);
    next[key] = prev[key] || now;
  }
  wave.watchSeen = next;
  return next;
}
