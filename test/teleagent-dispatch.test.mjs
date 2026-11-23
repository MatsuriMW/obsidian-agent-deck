// TeleAgent 一键派发模块的静态契约测试。
// 这里刻意不驱动真实界面：脚本能否跑通是端到端验证的事，而“脚本里不该出现什么、
// 关键判据有没有写进去”是纯字符串契约，适合用单元测试长期锁住。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DISPATCH_STAGES,
  POWERSHELL_SCRIPT,
  buildDispatchArgs,
  dispatchTeleagentTask,
  encodePayload,
  normalizePayload,
  parseDispatchOutput,
  runHandoffDispatch,
  verifyDispatchedSession,
} from '../src/teleagent-dispatch.js';

test('normalizePayload 校验必填项并给节奏/超时默认值', () => {
  assert.equal(normalizePayload({}).ok, false);
  assert.equal(normalizePayload({ project: 'p', text: '   ' }).ok, false);
  assert.equal(normalizePayload({ project: '  ', text: 'x' }).ok, false);

  const ok = normalizePayload({ project: ' jifang_data_analysis ', text: '请发送你好' });
  assert.equal(ok.ok, true);
  assert.equal(ok.payload.project, 'jifang_data_analysis');
  assert.equal(ok.payload.text, '请发送你好');
  assert.equal(ok.payload.mode, 'default');
  assert.equal(ok.payload.model, 'flagship');
  assert.equal(ok.payload.paceMs, 25);
  assert.equal(ok.payload.stepTimeoutMs, 15000);

  // 超长文本要挡下来，避免一次注入几千字符把客户端卡住
  assert.equal(normalizePayload({ project: 'p', text: 'x'.repeat(4001) }).ok, false);
  // 换行必须原样保留（脚本用 Shift+Enter 注入），不能被规范化成空格
  assert.equal(normalizePayload({ project: 'p', text: '第一行\n第二行' }).payload.text, '第一行\n第二行');
  // 节奏上限兜底：过慢的注入会让用户等太久
  assert.equal(normalizePayload({ project: 'p', text: 'x', paceMs: 9999 }).payload.paceMs, 200);
});

test('encodePayload 走 Base64，能原样还原含引号/换行/美元的文本', () => {
  const payload = { project: 'p', text: '含\'引号\' 与 "双引号" 以及 $var 和 \n 换行', paceMs: 20, stepTimeoutMs: 1000 };
  const back = JSON.parse(Buffer.from(encodePayload(payload), 'base64').toString('utf8'));
  assert.equal(back.text, payload.text);
  assert.equal(back.project, 'p');
});

test('buildDispatchArgs 把脚本与载荷分别作为参数传入', () => {
  const args = buildDispatchArgs('C:/tmp/dispatch.ps1', { project: 'p', text: 'x' });
  assert.deepEqual(args.slice(0, 6), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'C:/tmp/dispatch.ps1']);
  assert.equal(args[6], '-PayloadB64');
  const decoded = JSON.parse(Buffer.from(args[7], 'base64').toString('utf8'));
  assert.equal(decoded.project, 'p');
});

test('脚本不得回退到 ValuePattern.SetValue（实测只改 DOM，不会让“运行”变可用）', () => {
  assert.equal(POWERSHELL_SCRIPT.includes('SetValue'), false);
  // 反证：正确路径是 SetFocus + SendInput 的 Unicode 注入
  assert.ok(POWERSHELL_SCRIPT.includes('TypeChar'));
  assert.ok(POWERSHELL_SCRIPT.includes('0x0004'));
});

test('脚本保留三条关键判据：模式/模型只校验不修改、提交前看 IsEnabled', () => {
  for (const marker of ['默认权限', '旗舰', 'SelectionItemPattern', 'TogglePattern', 'IsEnabled', 'InvokePattern', 'ExpandCollapsePattern']) {
    assert.ok(POWERSHELL_SCRIPT.includes(marker), `脚本缺少判据：${marker}`);
  }
  // 校验失败要中止，而不是替用户改设置（设置属于用户偏好）
  assert.ok(POWERSHELL_SCRIPT.includes("Fail 'mode'"));
  assert.ok(POWERSHELL_SCRIPT.includes("Fail 'model'"));
});

test('脚本不含 JS 插值标记，避免模板字符串把 PowerShell 变量吃掉', () => {
  const marker = String.fromCharCode(36, 123); // ${
  assert.equal(POWERSHELL_SCRIPT.includes(marker), false);
  // 同时不能出现反引号（PowerShell 的转义符，也是 JS 模板字符串的定界符）
  assert.equal(POWERSHELL_SCRIPT.includes('`'), false);
});

test('每个失败阶段名都在 DISPATCH_STAGES 里，前端可以按 stage 定位卡点', () => {
  const emitted = [...POWERSHELL_SCRIPT.matchAll(/Fail '([a-z]+)'/g)].map((m) => m[1]);
  assert.ok(emitted.length >= 6);
  for (const stage of new Set(emitted)) assert.ok(DISPATCH_STAGES.includes(stage), `未登记的阶段：${stage}`);
});

test('parseDispatchOutput 只认最后一条可解析结果，前面有噪声也不影响', () => {
  const noisy = ['警告：某依赖缺失', '{"ok":false,"stage":"attach"}', '{"ok":true,"stage":"sent","project":"p"}'].join('\r\n');
  assert.deepEqual(parseDispatchOutput(noisy), { ok: true, stage: 'sent', project: 'p' });
  assert.equal(parseDispatchOutput('完全不是 JSON'), null);
  assert.equal(parseDispatchOutput(''), null);
});

test('非 Windows 直接返回 platform，不启动任何子进程', async () => {
  let spawned = 0;
  const result = await dispatchTeleagentTask(
    { project: 'p', text: 'x' },
    { platform: 'darwin', spawn: () => { spawned += 1; throw new Error('不该被调用'); } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'platform');
  assert.equal(spawned, 0);
});

test('载荷不合法时返回 input，不写临时脚本', async () => {
  let wrote = 0;
  const fakeFs = {
    mkdtempSync: () => { throw new Error('不该创建临时目录'); },
    writeFileSync: () => { wrote += 1; },
    rmSync: () => {},
  };
  const result = await dispatchTeleagentTask({ project: 'p', text: '' }, { platform: 'win32', fs: fakeFs });
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'input');
  assert.equal(wrote, 0);
});

test("runHandoffDispatch 只在“用户点了自动发送 + TeleAgent + Windows + 有项目名”四条同时成立时才真的派发", async () => {
  const calls = [];
  const dispatch = async (payload) => { calls.push(payload); return { ok: true, stage: "sent" }; };

  // 没点自动发送 / 目标不是 TeleAgent：一律不派发
  assert.deepEqual(await runHandoffDispatch({ agent: "teleagent", autoSend: false, projectName: "p", text: "t", platform: "win32", dispatch }), { skipped: "not-requested" });
  assert.deepEqual(await runHandoffDispatch({ agent: "workbuddy", autoSend: true, projectName: "p", text: "t", platform: "win32", dispatch }), { skipped: "not-requested" });
  // 非 Windows：不派发（UI Automation 只在 Windows 可用）
  assert.deepEqual(await runHandoffDispatch({ agent: "teleagent", autoSend: true, projectName: "p", text: "t", platform: "darwin", dispatch }), { skipped: "platform" });
  // 没有项目名：退回复制交接，绝不猜目录
  assert.deepEqual(await runHandoffDispatch({ agent: "teleagent", autoSend: true, projectName: "   ", text: "t", platform: "win32", dispatch }), { skipped: "no-project" });
  assert.equal(calls.length, 0, "上述四种情况都不该触发真实派发");

  // 四条成立：真正调用，并把项目名带回给调用方提示
  const ok = await runHandoffDispatch({ agent: "teleagent", autoSend: true, projectName: " jifang_data_analysis ", text: "请发送你好", platform: "win32", dispatch });
  assert.equal(ok.ok, true);
  assert.equal(ok.project, "jifang_data_analysis");
  assert.deepEqual(calls, [{ project: "jifang_data_analysis", text: "请发送你好" }]);

  // 失败时 stage/error 原样透传，不静默降级
  const failed = await runHandoffDispatch({
    agent: "teleagent", autoSend: true, projectName: "p", text: "t", platform: "win32",
    dispatch: async () => ({ ok: false, stage: "project", error: "找不到「运行环境」选择器" }),
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.stage, "project");
  assert.match(failed.error, /运行环境/);
});

test("verifyDispatchedSession 只在“新会话 + 同项目目录 + 正文匹配”三者同时成立时才认账", () => {
  const sessionLine = JSON.stringify({ id: "ses_new", title: "自检", created: 2000 });
  const runSql = (db, sql) => {
    if (db === "db-a") {
      if (sql.includes("FROM session")) return sessionLine + "\n";
      if (sql.includes("FROM part")) return "Agent Deck 派发链路自检 请只回复收到\n";
      return "";
    }
    throw new Error("db locked");
  };

  const hit = verifyDispatchedSession({ project: "jifang_data_analysis", text: "Agent Deck 派发链路自检 请只回复收到", sinceMs: 1000, dbs: ["db-a"], runSql });
  assert.equal(hit.found, true);
  assert.equal(hit.id, "ses_new");

  // 正文对不上：不能因为同目录有新会话就当成成功
  const mismatch = verifyDispatchedSession({ project: "jifang_data_analysis", text: "完全不同的内容", sinceMs: 1000, dbs: ["db-a"], runSql });
  assert.equal(mismatch.found, false);
  assert.equal(mismatch.reason, "not-found");

  // 读不了的库要跳过，继续看下一个
  const skip = verifyDispatchedSession({ project: "p", text: "Agent Deck", sinceMs: 1000, dbs: ["db-locked", "db-a"], runSql });
  assert.equal(skip.found, true);

  // 没有项目名：直接拒绝，不查库
  assert.deepEqual(verifyDispatchedSession({ project: "  ", text: "x", runSql }), { found: false, reason: "no-project" });
});
