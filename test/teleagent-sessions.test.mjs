import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { resolveSqliteBinary } from '../src/sqlite.js';
import { teleAgentDatabases, teleAgentHome, teleAgentOwners } from '../src/teleagent.js';
import { stripTeleAgentContext } from '../src/prompt-text.js';
import { desktopMessages, desktopSessions } from '../src/desktop-sessions.js';
import { AgentUsage } from '../src/readers.js';
import { AGENTS, DEFAULTS, deepMerge } from '../src/constants.js';
import * as J from '../src/journal.js';
import { Delegator } from '../src/delegation.js';
import { hasAgentCapability, usesDeckSessionLink } from '../src/agent-registry.js';
import { destinations, executionStatus } from '../src/workflow.js';
import { createRequire } from 'node:module';

const quote = (x) => "'" + String(typeof x === 'object' ? JSON.stringify(x) : x).replaceAll("'", "''") + "'";
const sql = (db, s) => execFileSync(resolveSqliteBinary(), [db, s], { stdio: 'pipe' });
const now = Date.now() - 60000;

function makeRoot(owners) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-teleagent-'));
  for (const owner of owners) {
    const dir = path.join(root, 'users', owner);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'teleagent.db'), '');
  }
  return root;
}

test('teleAgentHome honors SUPER_AGENT_APP_DATA_DIR and falls back per platform', () => {
  const home = path.join(os.tmpdir(), 'ad-teleagent-home');
  // 内核注入的环境变量优先
  assert.equal(teleAgentHome({ SUPER_AGENT_APP_DATA_DIR: 'C:\\data\\TA\\' }, 'win32', home).replace(/\\/g, '/'), 'C:/data/TA');
  // Windows 上 LOCALAPPDATA 里真有 users/ 才采用（布局是 %LOCALAPPDATA%\TeleAgent\users\...）
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-teleagent-appdata-'));
  const local = path.join(appData, 'TeleAgent');
  fs.mkdirSync(path.join(local, 'users', 'owner'), { recursive: true });
  assert.equal(teleAgentHome({ LOCALAPPDATA: appData }, 'win32', home).replace(/\\/g, '/'), local.replace(/\\/g, '/'));
  assert.equal(teleAgentHome({ LOCALAPPDATA: path.join(appData, 'nope') }, 'win32', home).replace(/\\/g, '/'), `${home.replace(/\\/g, '/')}/.local/share/TeleAgent`);
  // 没有环境变量时是 ~/.local/share/TeleAgent（macOS/Linux/Windows 同一套布局）
  assert.equal(teleAgentHome({}, 'linux', home).replace(/\\/g, '/'), `${home.replace(/\\/g, '/')}/.local/share/TeleAgent`);
  assert.equal(teleAgentHome({}, 'darwin', home).replace(/\\/g, '/'), `${home.replace(/\\/g, '/')}/.local/share/TeleAgent`);
});

test('teleAgentOwners puts the current account first and keeps the other accounts', () => {
  const root = makeRoot(['v1_public_2', 'v1_public_1']);
  fs.writeFileSync(path.join(root, 'current-owner.json'), JSON.stringify({ ownerDir: 'v1_public_1', tenantId: 'public' }));
  fs.mkdirSync(path.join(root, 'users', '.DS_Store'), { recursive: true });
  assert.deepEqual(teleAgentOwners(root), ['v1_public_1', 'v1_public_2']);
  // 目录名里带分隔符或点号的条目不是账号，跳过避免路径穿越
  fs.writeFileSync(path.join(root, 'current-owner.json'), JSON.stringify({ ownerDir: '../escape' }));
  assert.deepEqual(teleAgentOwners(root), ['v1_public_1', 'v1_public_2']);
});

test('teleAgentDatabases only returns existing account databases', () => {
  const root = makeRoot(['v1_public_1']);
  fs.writeFileSync(path.join(root, 'current-owner.json'), JSON.stringify({ ownerDir: 'v1_public_1' }));
  fs.mkdirSync(path.join(root, 'users', 'v1_public_empty'), { recursive: true });
  const dbs = teleAgentDatabases({ env: { SUPER_AGENT_APP_DATA_DIR: root }, platform: 'win32', homeDir: root });
  assert.equal(dbs.length, 1);
  assert.ok(dbs[0].replace(/\\/g, '/').endsWith('/users/v1_public_1/teleagent.db'));
});

test('TeleAgent sessions are tracked from the real session/message/part schema', async () => {
  const root = makeRoot(['v1_public_owner']);
  fs.writeFileSync(path.join(root, 'current-owner.json'), JSON.stringify({ ownerDir: 'v1_public_owner' }));
  const db = path.join(root, 'users', 'v1_public_owner', 'teleagent.db');
  const sid = 'ses_tele_demo_001';
  sql(db, `CREATE TABLE session(id,title,directory,parent_id,time_created,time_updated,time_archived);
    CREATE TABLE message(id,session_id,time_created,time_updated,data);
    CREATE TABLE part(id,message_id,session_id,time_created,time_updated,data);
    INSERT INTO session VALUES('${sid}','培训 PPT 规划','E:\\Project\\demo',NULL,${now},${now + 1000},NULL);
    INSERT INTO message VALUES('u','${sid}',${now},${now},${quote({ role: 'user', time: { created: now } })}),
      ('a','${sid}',${now + 1000},${now + 1000},${quote({
        role: 'assistant', modelID: 'chat-pro',
        time: { created: now + 1000, completed: now + 2000 },
        tokens: { input: 120, output: 30, cache: { read: 40, write: 10 } },
        finish: 'stop',
      })});
    INSERT INTO part VALUES('p1','u','${sid}',${now},${now},${quote({ type: 'text', text: '<span data-path-name="D:/secret/report.pdf" data-path-kind="file">@report.pdf</span> 帮我看看这份材料' })}),
      ('p2','a','${sid}',${now},${now},${quote({ type: 'text', text: '材料已读完' })});`);

  const prev = process.env.SUPER_AGENT_APP_DATA_DIR;
  process.env.SUPER_AGENT_APP_DATA_DIR = root;
  try {
    const settings = deepMerge(DEFAULTS, { agents: { teleagent: true }, primaryAgents: [] });
    const usage = new AgentUsage({ settings, cfg: settings });
    assert.deepEqual(usage.desktopDatabases().filter(([, a]) => a === 'teleagent').map(([p]) => p.replace(/\\/g, '/')), [db.replace(/\\/g, '/')]);
    // 只读夹具库：不要让扫描去读本机真实的 Claude/Codex 目录和别的桌面库
    usage.roots = () => [];
    usage.desktopDatabases = () => [[db, 'teleagent']];
    await usage.scan({ since: 0 });
    const meta = usage.meta.get(sid);
    assert.ok(meta, 'TeleAgent session must be discovered');
    assert.equal(meta.agent, 'teleagent');
    assert.equal(meta.title, '培训 PPT 规划');
    assert.equal(meta.cwd, 'E:\\Project\\demo');
    assert.equal(meta.out, 30);
    assert.equal(meta.fresh, 130, 'input + cache.write');
    assert.equal(meta.cached, 40, 'cache.read');
    assert.equal(meta.lastText, '材料已读完');
    assert.equal(meta.state, 'wait');
    // 附件 span 的绝对路径不能进会话视图
    const messages = await desktopMessages(db, 'teleagent', sid);
    const user = messages.find((m) => m.role === 'user');
    assert.ok(user.text.startsWith('@report.pdf'));
    assert.ok(!user.text.includes('secret'));
  } finally {
    if (prev === undefined) delete process.env.SUPER_AGENT_APP_DATA_DIR; else process.env.SUPER_AGENT_APP_DATA_DIR = prev;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stripTeleAgentContext keeps the visible attachment name and drops absolute paths', () => {  const raw = '<span data-path-name="C:/Users/x/secret/a.pdf" data-path-kind="file">@a.pdf</span> 请总结这个文件';
  assert.equal(stripTeleAgentContext(raw), '@a.pdf 请总结这个文件');
  assert.equal(stripTeleAgentContext('<span data-path-kind="image"></span>看图'), '看图');
  assert.equal(stripTeleAgentContext('普通提问'), '普通提问');
});

test('TeleAgent is registered as a desktop-only agent with copy handoff', () => {
  assert.equal(AGENTS.teleagent.desktopOnly, true);
  assert.equal(AGENTS.teleagent.trackingOnly, undefined, 'handoff agents are not trackingOnly; that flag blocks drops');
  assert.equal(DEFAULTS.agents.teleagent, true);
});

test('TeleAgent journal links round-trip through the deck scheme and get the ta block prefix', () => {
  const line = J.linkLine('', 'teleagent', '培训 PPT 规划', 'ses_tele_demo_001');
  assert.ok(line.includes('🔗 [TeleAgent：培训 PPT 规划](obsidian://agent-deck?do=open&agent=teleagent&sid=ses_tele_demo_001)'), line);
  assert.deepEqual(J.parseLink(line), { agent: 'teleagent', sid: 'ses_tele_demo_001', title: '培训 PPT 规划' });
  const blockId = J.makeBlockId('ses_tele_demo_001', 'teleagent', 'demo');
  assert.ok(blockId.startsWith('ta-demo-'), blockId);
  assert.equal(J.isDeckBlockId(blockId), true);
});

test('TeleAgent is handoff-only: it accepts desktop drops but never claims background delegation', () => {
  assert.equal(hasAgentCapability('teleagent', 'delegate'), false);
  assert.equal(hasAgentCapability('teleagent', 'desktopHandoffOnly'), true);
  assert.equal(hasAgentCapability('teleagent', 'terminalHandoff'), false);
  assert.equal(usesDeckSessionLink('teleagent'), true, 'no client deep link, so the deck scheme carries the session');
  assert.deepEqual(destinations('teleagent').map((d) => d.id), ['desktop']);
  assert.equal(executionStatus({ agent: 'teleagent', handoff: true, state: 'starting' }), '等待你在客户端粘贴发送');
});

test('dragging a task to TeleAgent copies it, opens the client and claims the new session', async () => {
  const req = createRequire(import.meta.url);
  const opened = [];
  globalThis.require = (s) => (s === 'electron' ? { shell: { openExternal: (u) => opened.push(u) } } : req(s));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-teleagent-handoff-'));
  const note = '- TODO 核对培训材料 ^ta-demo\n';
  const plugin = {
    settings: deepMerge(DEFAULTS, {}),
    jobs: {},
    vaultPath: dir,
    usage: { meta: new Map() },
    saveSettings() {},
    saveJobs() {},
    refreshUI() {},
    notice() {},
    readNote: async () => note,
    writeNote: async () => {},
    agentEnabled: () => true,
    modelsFor: () => [],
    defaultModel: () => '',
    markBound() {},
  };
  try {
    const d = new Delegator(plugin);
    const job = await d.delegate({ agent: 'teleagent', file: { path: 'note.md' }, line: 0 });
    assert.equal(job.agent, 'teleagent');
    assert.equal(job.handoff, true, 'no delegate capability, so the job is a copy handoff');
    assert.ok(opened.includes('teleai-cowork://'), 'the client is opened through its URL scheme');
    assert.ok(plugin.jobs[job.id], 'the job is persisted so a later scan can claim it');

    // 下一轮扫描里出现的新会话：文本开头对得上，就绑回这一行
    plugin.usage.meta.set('ses_claimed', { agent: 'teleagent', sid: 'ses_claimed', lastAt: Date.now(), text: job.prompt.slice(0, 40) });
    d.resolveHandoffs(plugin.usage);
    assert.equal(job.sessionId, 'ses_claimed');
    assert.equal(job.state, 'bound');
  } finally {
    delete globalThis.require;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a message that ended in a tool loop is running, not waiting (tool_calls and tool-calls)', async () => {
  const root = makeRoot(['owner']);
  fs.writeFileSync(path.join(root, 'current-owner.json'), JSON.stringify({ ownerDir: 'owner' }));
  const db = path.join(root, 'users', 'owner', 'teleagent.db');
  try {
    sql(db, `CREATE TABLE session(id,title,directory,parent_id,time_created,time_updated,time_archived);
      CREATE TABLE message(id,session_id,time_created,time_updated,data);
      CREATE TABLE part(id,message_id,session_id,time_created,time_updated,data);
      INSERT INTO session VALUES('ses_loop','工具循环','/p',NULL,${now},${now + 1000},NULL),
        ('ses_stale','客户端关掉的半截会话','/p',NULL,${now - 7200000},${now - 7200000},NULL);
      INSERT INTO message VALUES
        ('a1','ses_loop',${now},${now},${quote({ role: 'assistant', finish: 'tool_calls', time: { created: now, completed: now } })}),
        ('a2','ses_loop',${now + 1},${now + 1},${quote({ role: 'assistant', finish: 'tool-calls', time: { created: now + 1, completed: now + 1 } })}),
        ('a3','ses_loop',${now + 2},${now + 2},${quote({ role: 'assistant', finish: 'stop', time: { created: now + 2, completed: now + 2 } })}),
        ('b1','ses_stale',${now - 7200000},${now - 7200000},${quote({ role: 'assistant', finish: 'tool_calls', time: { created: now - 7200000, completed: now - 7200000 } })});`);
    const messages = await desktopMessages(db, 'teleagent', 'ses_loop');
    assert.deepEqual(messages.map((m) => m.state), ['run', 'run', 'wait'], 'both spellings keep the turn running; stop ends it');
    // 两小时前就停在工具循环里的会话，客户端多半已经关了：不能一直挂在「在跑」
    const stale = await desktopMessages(db, 'teleagent', 'ses_stale');
    assert.equal(stale.at(-1).state, 'wait');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});