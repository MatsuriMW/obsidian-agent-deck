import test from "node:test";
import assert from "node:assert/strict";
import { judgeWave, newFindings, syncSeen, STEWARD_STUCK_MS } from "../src/steward-watch.js";

const NOW = 1_800_000_000_000;
const MIN = 60 * 1000;

const wave = (workers) => ({ id: "w1", state: "waiting", path: "", workers, watchSeen: {} });
const worker = (jobId, extra = {}) => ({ jobId, blockId: "ad-x", title: "写首页", state: "running", ...extra });
const job = (state, extra = {}) => ({ id: "j1", name: "写首页", state, sessionId: "sid-1", ...extra });

test("卡住：运行中且超过阈值没有输出才报", () => {
  const w = wave([worker("j1")]);
  const slow = judgeWave(w, { jobs: { j1: job("running") }, metaMap: new Map([["sid-1", { lastAt: NOW - 20 * MIN }]]), now: NOW });
  assert.equal(slow.length, 1);
  assert.equal(slow[0].kind, "stuck");
  assert.equal(slow[0].minutes, 20);
  assert.equal(slow[0].title, "写首页");

  const fresh = judgeWave(w, { jobs: { j1: job("running") }, metaMap: new Map([["sid-1", { lastAt: NOW - 2 * MIN }]]), now: NOW });
  assert.deepEqual(fresh, [], "刚有动静的不算卡住");

  const threshold = judgeWave(w, { jobs: { j1: job("running") }, metaMap: new Map([["sid-1", { lastAt: NOW - STEWARD_STUCK_MS }]]), now: NOW });
  assert.equal(threshold.length, 1, "正好到阈值也算");
});

test("结束状态不报警，没起会话的 worker 跳过", () => {
  const w = wave([worker("j1"), worker("j2"), worker("j3")]);
  const jobs = { j1: job("done"), j2: job("cancelled") };
  const out = judgeWave(w, { jobs, metaMap: new Map(), now: NOW });
  assert.deepEqual(out, [], "done / cancelled / 没有 job 都不在判定范围");
});

test("出错与等授权各自有主：只分类，交给看板关键字与 attention 去提醒", () => {
  const w = wave([worker("j1"), worker("j2"), worker("j3")]);
  const jobs = {
    j1: job("error", { error: "boom" }),
    j2: job("needs-approval"),
    j3: job("wait", { result: "请确认是否继续？" }),
  };
  const out = judgeWave(w, { jobs, metaMap: new Map(), now: NOW });
  assert.deepEqual(out.map((f) => [f.kind, f.handledBy]).sort(), [["approval", "attention"], ["error", "board"], ["approval", "attention"]].sort());
  assert.ok(out.every((f) => f.kind !== "stuck"));
});

test("错误里带「首轮需要审批」的也算等授权（沿用 attention.js 的口径）", () => {
  const w = wave([worker("j1")]);
  const out = judgeWave(w, { jobs: { j1: job("error", { error: "首轮需要审批或交互" }) }, metaMap: new Map(), now: NOW });
  assert.equal(out[0].kind, "approval");
});

test("同一条件只提醒一次；条件消失后复发可以再提醒", () => {
  const w = wave([worker("j1")]);
  const opts = { jobs: { j1: job("running") }, metaMap: new Map([["sid-1", { lastAt: NOW - 30 * MIN }]]), now: NOW };
  const first = judgeWave(w, opts);
  assert.equal(newFindings(w, first).length, 1, "第一次要提醒");
  syncSeen(w, first, NOW);
  assert.equal(newFindings(w, judgeWave(w, opts)).length, 0, "同一条件不重复提醒");

  // 恢复了（不再卡住）→ 键被清掉
  syncSeen(w, [], NOW + MIN);
  assert.deepEqual(w.watchSeen, {});
  assert.equal(newFindings(w, judgeWave(w, opts)).length, 1, "再次卡住能重新提醒");
});

test("两个 worker 各自记各自的键，不互相吞掉", () => {
  const w = wave([worker("j1"), worker("j2")]);
  const jobs = { j1: job("running"), j2: job("running", { sessionId: "sid-2" }) };
  const metaMap = new Map([["sid-1", { lastAt: NOW - 30 * MIN }], ["sid-2", { lastAt: NOW - 30 * MIN }]]);
  const out = judgeWave(w, { jobs, metaMap, now: NOW });
  assert.equal(out.length, 2);
  syncSeen(w, out, NOW);
  assert.equal(newFindings(w, judgeWave(w, { jobs, metaMap, now: NOW })).length, 0);
});
