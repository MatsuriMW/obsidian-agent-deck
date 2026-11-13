// The on-disk parse cache: packing, restoring, and refusing to trust a cache it
// did not write. The point is that a reload does not re-parse every log again.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { AgentUsage, USAGE_CACHE_VERSION } from '../src/readers.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-cache-'));
const cache = path.join(dir, 'usage-cache.json.gz');

function usageWith(sessionCount = 3) {
  const u = new AgentUsage({ settings: { agents: {}, primaryAgents: [] } });
  for (let i = 0; i < sessionCount; i++) {
    const p = `/logs/session-${i}.jsonl`;
    u.files.set(p, {
      path: p, agent: 'claude', size: 1000 + i, offset: 900 + i, mtime: 1700000000000 + i,
      sid: `sid-${i}`, id: `sid-${i}`, cwd: `/work/${i}`, app: 'cli', model: 'claude',
      days: new Map([[`2026-11-0${i + 1}`, {
        sess: new Map([[`sid-${i}`, { proj: `/work/${i}`, cwd: `/work/${i}`, app: 'cli', agent: 'claude', ts: [600, 620], text: '会话' }]]),
        prompts: 2, out: 10 + i, fresh: 2, cached: 0, calls: 1, wall: 5,
      }]]),
      msgs: new Map([['m1', { out: 1, fresh: 0, cached: 0 }]]),
      titles: new Map([[`sid-${i}`, `标题 ${i}`]]),
      tasks: { seq: 3, seen: new Set(['a']), map: new Map([['a', { done: 1 }]]) },
      rounds: { seen: new Set([1]), list: [{ n: 1, at: 1, said: '问' }] },
      live: null, zstd: false, sub: '', parentSid: '', metaRead: false,
    });
    u.meta.set(`sid-${i}`, { sid: `sid-${i}`, agent: 'claude', title: `标题 ${i}`, app: 'cli', lastAt: 1700000000000 + i, out: 10 + i, state: 'idle', segs: [[1, 2]] });
  }
  return u;
}

// --- round trip --------------------------------------------------------------
const first = usageWith();
assert.equal(await first.saveCache(cache), true);
assert.ok(fs.statSync(cache).size > 0);
assert.equal(fs.readFileSync(cache).subarray(0, 2).toString('hex'), '1f8b', 'cache is gzip');

const second = new AgentUsage({ settings: { agents: {}, primaryAgents: [] } });
assert.equal(await second.loadCache(cache), true);
assert.equal(second.files.size, 3);
assert.equal(second.meta.size, 3);
const restored = second.files.get('/logs/session-1.jsonl');
assert.equal(restored.size, 1001);
assert.equal(restored.offset, 901);
assert.equal(restored.mtime, 1700000000001);
assert.deepEqual([...restored.days], [...first.files.get('/logs/session-1.jsonl').days]);
assert.equal(restored.msgs.get('m1').out, 1);
assert.equal(second.meta.get('sid-2').title, '标题 2');
assert.deepEqual(second.meta.get('sid-0').segs, [[1, 2]], 'timeline segments survive');

// Nested containers must come back as Map/Set, not plain objects: the day
// bucket iterates day.sess, and tasks/rounds use .has(). Restoring them as
// objects made every later scan die with "day.sess is not iterable".
const day = restored.days.get('2026-11-02');
assert.ok(day.sess instanceof Map, 'day.sess is a Map again');
assert.deepEqual([...day.sess][0][1].ts, [600, 620], 'per-session minutes survive');
for (const [sid, entry] of day.sess) assert.equal(entry.proj, '/work/1', 'iterating day.sess works');
assert.ok(restored.tasks.seen instanceof Set, 'tasks.seen is a Set again');
assert.ok(restored.tasks.map instanceof Map, 'tasks.map is a Map again');
assert.equal(restored.tasks.seen.has('a'), true);
assert.ok(restored.rounds.seen instanceof Set, 'rounds.seen is a Set again');
assert.equal(restored.rounds.seen.has(1), true);

// A restored cache means an unchanged file is not read again: scan skips it,
// which is what makes the next cold start cheap.
const entry = second.files.get('/logs/session-0.jsonl');
const kept = entry.offset;
await second.readJsonl('/logs/session-0.jsonl', 'claude', { size: entry.size, mtimeMs: entry.mtime }, new Set()).catch(() => {});
assert.equal(second.files.get('/logs/session-0.jsonl').offset, kept, 'unchanged file is not re-read');

// Cached and uncached summaries must agree even after more than ten messages.
{
  const u = usageWith(1), fc = [...u.files.values()][0], key = '2026-11-01';
  fc.msgs = new Map(Array.from({length:25}, (_,i)=>['msg-'+i,{sid:'sid-0',key,proj:'/work/0',out:i+1,fresh:2,cached:3,model:'model'}]));
  fc.live = {at:Date.now(),state:'wait',title:'Waiting for user'};
  const expected=u.summary(key);
  await u.saveCache(cache);
  const v=new AgentUsage(); await v.loadCache(cache);
  assert.deepEqual(v.summary(key),expected,'cache reload must preserve all token totals and calls');
  assert.equal(v.liveSessions().length,1,'unchanged waiting sessions remain available after reload');
}

// --- it must fail open -------------------------------------------------------
const broken = path.join(dir, 'broken.json.gz');
fs.writeFileSync(broken, 'not gzip at all');
const third = new AgentUsage({ settings: { agents: {}, primaryAgents: [] } });
assert.equal(await third.loadCache(broken), false, 'a corrupt cache is ignored');
assert.equal(third.files.size, 0);

const old = path.join(dir, 'old.json.gz');
fs.writeFileSync(old, zlib.gzipSync(JSON.stringify({ v: USAGE_CACHE_VERSION + 1, files: [], meta: [] })));
assert.equal(await third.loadCache(old), false, 'a cache from another version is ignored');

assert.equal(await third.loadCache(path.join(dir, 'missing.json.gz')), false);

// --- throttling --------------------------------------------------------------
const fourth = usageWith();
fourth.dirty = true;
assert.equal(fourth.maybeSaveCache(path.join(dir, 'throttled.json.gz'), 300000), true, 'first save goes through');
fourth.dirty = true;
assert.equal(fourth.maybeSaveCache(path.join(dir, 'throttled.json.gz'), 300000), false, 'a second save is throttled');
fourth.dirty = false;
assert.equal(fourth.maybeSaveCache(path.join(dir, 'throttled.json.gz'), 0), false, 'nothing new, nothing written');

while (fourth.saving) await new Promise((r) => setTimeout(r, 5));
fs.rmSync(dir, { recursive: true, force: true });
console.log('PASS usage cache: gzip round trip, meta and timeline restore, unchanged files skipped, corrupt and stale caches ignored, saves throttled');
