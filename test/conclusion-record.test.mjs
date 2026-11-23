// 💬 结论取「这一轮最后的落点」，而不是回复开头那段铺垫。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conclusionSentence, answerConclusion, conclusionKind, oneSentenceConclusion, syncSessionEntry } from '../src/journal.js';

const BRIEF = '- DOING 修复缓存 ^ad-tail';

test('explicit conclusion block wins and drops the label the line already carries', () => {
  const reply = '这篇内容不少，我按它的论证顺序讲。原文是 Anthropic Research 的研究博客。\n\n第一节讲上下文容量。\n\n第二节讲记忆分层。\n\n结论：1M 上下文不是记忆，真正缺的是取舍与召回机制。';
  assert.equal(conclusionSentence(reply, 90), '1M 上下文不是记忆，真正缺的是取舍与召回机制。');
});

test('long replies record the tail instead of the opening paragraph', () => {
  const reply = '我先把日志扫了一遍。\n\n发现解析器把多字节字符截断了，已经改成按字符切。\n\n测试全部通过，发布环境还没验证。';
  assert.equal(conclusionSentence(reply, 90), '测试全部通过，发布环境还没验证。');
});

test('closing questions and next-step offers are skipped', () => {
  const reply = '先看日志。\n\n解析器已改成按字符切分，单元测试 12/12 通过。\n\n需要我现在打包发版吗？';
  assert.equal(conclusionSentence(reply, 90), '解析器已改成按字符切分，单元测试 12/12 通过。');
  const nextStep = '先看日志。\n\n单元测试 12/12 通过。\n\n要不要我顺手把旧缓存也清一遍？';
  assert.equal(conclusionSentence(nextStep, 90), '单元测试 12/12 通过。');
});

test('a single-paragraph reply keeps its opening because that is all it has', () => {
  const reply = '这篇内容不少，我按它的论证顺序讲。';
  assert.equal(conclusionSentence(reply, 90), '这篇内容不少，我按它的论证顺序讲。');
});

test('all-tail-noise replies fall back to the last paragraph rather than the opening', () => {
  const reply = '好的。\n\n第一步先看日志。\n\n接下来可以跑一遍测试，需要我继续就说一声。';
  assert.equal(conclusionSentence(reply, 90), '第一步先看日志。');
});

test('unpolished brief records use the tail conclusion, not the reply opening', () => {
  const said = '我先把日志扫了一遍。\n\n发现解析器把多字节字符截断了，已经改成按字符切。\n\n测试全部通过，发布环境还没验证。';
  const note = syncSessionEntry(BRIEF, { sid: 'tail-session', blockId: 'ad-tail', detail: 'brief', granularity: 'round', rounds: [{ n: 1, ask: '修一下日志解析', said }] }).text;
  const line = note.split('\n').find((l) => l.includes('第1轮：'));
  assert.ok(line.includes('**结论**：测试全部通过，发布环境还没验证。'), line);
  assert.ok(!line.includes('我先把日志扫了一遍'), line);
});

test('polished summaries are still recorded verbatim', () => {
  const note = syncSessionEntry(BRIEF, { sid: 'tail-session', blockId: 'ad-tail', detail: 'brief', granularity: 'round', rounds: [{ n: 1, ask: '修一下日志解析', said: '开头铺垫。\n\n结尾。', summary: '日志解析按字符切分，12/12 通过' }] }).text;
  assert.ok(note.includes('**结论**：日志解析按字符切分，12/12 通过'), note);
});

test('user questions still summarize from the beginning', () => {
  const ask = '这篇 Anthropic Research 的博客到底讲了什么？我想知道结论。';
  assert.ok(!oneSentenceConclusion(ask, 90).startsWith('我想知道结论'));
  assert.ok(oneSentenceConclusion(ask, 90).startsWith('这篇 Anthropic Research 的博客到底讲了什么？'));
});

test('rounds are classified from how they were asked, coding when unsure', () => {
  assert.equal(conclusionKind('这个自动记录的 fallback 机制是什么样的？', '只有本地兜底，没有换 CLI。'), 'qa');
  assert.equal(conclusionKind('帮我改一下设置页那三行', '已经加好了。'), 'code');
  assert.equal(conclusionKind('能修一下这个吗？', '已修复，测试通过。'), 'code');
  assert.equal(conclusionKind('这个机制是什么意思？', '看这段代码：\n```js\n1\n```'), 'qa');
  assert.equal(conclusionKind('目前来看，大模型公司没有真正的定价权。', '所以更准确的说法是计价方式的问题。'), 'code');
  assert.equal(conclusionKind('', ''), 'code');
});

test('Q&A conclusions keep the judgement paragraph instead of the closing tangent', () => {
  const reply = '## 一、先说清现状\n\n自动记录现在的兜底只有本地规则。\n\n**推荐：有限 failover，不做无限重试**\n\n- 链路：主 CLI → 第二个 CLI → API。\n\n**没有验证的部分**：真实 CLI 撞限额时的切换、设置页新增那三行的视觉、Windows。\n\n如果你希望我在「马自立」里安装一份并热重载，说一声。';
  assert.equal(answerConclusion(reply, 160), '推荐：有限 failover，不做无限重试');
  const tangent = '## 一\n\n第一个问题低于三成的，基本可以往下聊。\n\n第二个问题低于一成的，基本就是在用公开榜单自嗨。\n\n顺带一句，上一个问题里的链接，群公告确实是常用位置。';
  assert.ok(!answerConclusion(tangent, 160).includes('顺带'), answerConclusion(tangent, 160));
  assert.ok(answerConclusion(tangent, 160).includes('公开榜单'), answerConclusion(tangent, 160));
});

test('Q&A records keep the judgement, coding records keep the status line', () => {
  const long = '先说结论：主号放 github 链接不会直接限流，但会压低初始推荐，而且一旦被判定为导流，后续每条笔记的初始分配都会受影响。\n\n'
    + '要真放，最稳的验证方式是拿小号先试，观察一周笔记的初始播放量有没有异常，再决定要不要放到主号上。';
  const base = '- DOING 小红书限流 ^ad-kind';
  const write = (ask) => syncSessionEntry(base, { sid: 'k1', blockId: 'ad-kind', detail: 'brief', granularity: 'round', rounds: [{ n: 1, ask, said: long }] }).text;
  const qaLine = write('小红书主页放 github 链接会被限流吗').split('\n').find((l) => l.includes('第1轮：'));
  const codeLine = write('帮我改一下首页的链接位置').split('\n').find((l) => l.includes('第1轮：'));
  assert.ok(qaLine.includes('先说结论') && qaLine.includes('初始分配都会受影响'), qaLine);
  assert.ok(!qaLine.includes('小号先试'), qaLine);
  assert.ok(!codeLine.includes('先说结论') && codeLine.includes('小号先试'), codeLine);
});

test('a model-provided kind overrides the local guess and its length budget', () => {
  const note = syncSessionEntry(BRIEF, { sid: 'tail-session', blockId: 'ad-tail', detail: 'brief', granularity: 'round', rounds: [{ n: 1, ask: '帮我修一下缓存', said: '开头铺垫。\n\n这一轮的判断是：缓存 key 少了项目维度，已补上并回归通过。', summary: '缓存 key 少了项目维度，已补上并回归通过', kind: 'qa' }], qaMax: 160 }).text;
  assert.ok(note.includes('**结论**：缓存 key 少了项目维度，已补上并回归通过'), note);
});

test('caveat and closing paragraphs are skipped even when they sit last', () => {
  const reply = '缓存已经改好。\n\n验证：npm test 通过，构建通过。\n\n**没有验证的**：真实 CLI 撞限额时的切换、设置页新增那行的视觉。\n\n要我现在装上吗？';
  const out = conclusionSentence(reply, 65);
  assert.ok(!out.includes('撞限额'), out);
  assert.ok(out.includes('通过'), out);
});

test('a tangent sentence inside the same paragraph is dropped', () => {
  const reply = '不管有没有提醒，都别指望公告本身能通知到人。\n\n改完公告，在群里另发一条消息提醒一下（能 @ 就 @），公告只当「常驻信息位」。顺带一句，上一个问题里提到的链接，群公告确实是运营者常用的位置。';
  const out = answerConclusion(reply, 160);
  assert.ok(!out.includes('顺带'), out);
  assert.ok(out.includes('常驻信息位'), out);
});

test('a model answer that only repeats the kind falls back to the local conclusion', () => {
  const said = '先说结论：1M 上下文不等于记忆，记忆是取舍与召回。\n\n窗口再大，模型也不会自动知道该记住哪一句。';
  const note = syncSessionEntry('- DOING 上下文与记忆 ^ad-kind2', { sid: 'k2', blockId: 'ad-kind2', detail: 'brief', granularity: 'round',
    rounds: [{ n: 1, ask: '1M 上下文等于记忆吗', said, summary: 'qa', kind: 'qa' }] }).text;
  const line = note.split('\n').find((l) => l.includes('第1轮：'));
  assert.ok(!/(?:\*\*结论\*\*|结论)：qa\b/.test(line), line);
  assert.ok(line.includes('不等于记忆'), line);
});
