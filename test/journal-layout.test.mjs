import assert from 'node:assert/strict';
import { planJournal, renderJournal, ensureTopRule } from '../src/organize-journal.js';
import { JOURNAL_LAYOUT_DEFAULT, journalLayout, readJournalLayout, repairJournalLayout, stripJournalLayout } from '../src/journal-layout.js';

const source = '# 随笔\n\n保留上面的文字\n\n---\n## 已完成\n- DONE 完成任务 ^ad-done\n  - ❓ 第1轮：问题\n  - 💬 第1轮：结论\n\n---\n## 进行中\n### DOING\n- DOING 正在做 ^ad-active\n  - 手写子项\n\n---\n\n## 手写原题\n\n\n- DONE 手写完成\n```md\n## 已完成\n\n\n- DONE 示例 ^ad-code\n```\n';
const orders = [['done','active','notes'],['active','done','notes'],['notes','done','active'],['notes','active','done'],['done','notes','active'],['active','notes','done']];
for (const order of orders) {
  const layout = journalLayout({order,titles:{done:'交付完成',active:'待跟进',notes:'我的笔记'}});
  const first = renderJournal(planJournal(source,{layout}));
  const parsed = readJournalLayout(first);
  assert.deepEqual(parsed.layout,layout);
  const positions=order.map(key=>first.indexOf(`## ${layout.titles[key]}`));
  assert.deepEqual(positions,[...positions].sort((a,b)=>a-b));
  assert.equal(renderJournal(planJournal(first)),first,'repeated custom organization is a no-op');
  assert.equal(ensureTopRule(first),first,'writers do not add a default rule into custom layouts');
  assert.ok(first.includes('## 手写原题\n\n\n- DONE 手写完成'),'manual headings, tasks and spacing stay intact');
  assert.ok(first.includes('```md\n## 已完成\n\n\n- DONE 示例 ^ad-code\n```'),'code fences stay intact');
  assert.equal((first.match(/完成任务/g)||[]).length,1);
  assert.equal((first.match(/正在做/g)||[]).length,1);
  assert.ok(first.startsWith('# 随笔\n\n保留上面的文字'));
  const changed = {order:[...order].reverse(),titles:{done:'完成归档',active:'进行任务',notes:''}};
  const second = renderJournal(planJournal(first,{layout:changed}));
  assert.ok(!second.includes('## 交付完成')&&!second.includes('## 待跟进')&&!second.includes('## 我的笔记'),'old generated titles do not remain after changing templates');
  assert.ok(second.includes('## 手写原题'),'a user heading is not treated as an old template title');
  assert.equal(renderJournal(planJournal(second)),second);
  const fallback=renderJournal(planJournal(second,{layout:null}));
  assert.equal(fallback,source.replace(' ^ad-done',''),'restoring defaults preserves content with completed identifiers removed');
  const skipped=renderJournal(planJournal(first),{skip:new Set([planJournal(first).done.find(entry=>entry.text.includes('完成任务')).text])});
  assert.ok(!skipped.includes('完成任务')&&skipped.includes('正在做')&&skipped.includes('手写完成'),'archiving removes only the selected AI block');
  const crlf=first.replace(/\n/g,'\r\n');
  assert.equal(renderJournal(planJournal(crlf)),crlf,'CRLF custom journals stay CRLF');
}
const layout=structuredClone(JOURNAL_LAYOUT_DEFAULT);
assert.throws(()=>journalLayout({...layout,order:['done','done','notes']}));
assert.throws(()=>journalLayout({...layout,titles:{...layout.titles,done:'first\nsecond'}}));
const custom=renderJournal(planJournal(source,{layout}));
assert.throws(()=>planJournal(custom.replace('<!-- agent-deck:section:done:end -->','')),'broken markers never cause content to be discarded');
assert.throws(()=>planJournal(custom.replace('<!-- agent-deck:section:done:end -->','<!-- agent-deck:section:done:end -->\n意外写在分区外的文字')),'unowned text is not silently discarded');
assert.equal(readJournalLayout('```md\n<!-- agent-deck:layout:start -->\n```'),null,'markers inside a code fence are examples');
const tail='\n\n# 区域外的文字\n\n\n- DONE 自己的事情\n';
assert.ok(renderJournal(planJournal(custom+tail)).endsWith(tail.trim()+'\n'),'content after the custom region is preserved');
const strayBetween=custom.replace('<!-- agent-deck:section:active:heading -->\n','<!-- agent-deck:section:active:heading -->\n- 测试 \n');
const strayParsed=readJournalLayout(strayBetween);
assert.ok(strayParsed.sections.active.text.includes('- 测试 '),'text typed between heading comment and ## heading stays in that section');
assert.ok(readJournalLayout(renderJournal(planJournal(strayBetween))).sections.active.text.includes('- 测试 '),'organizing preserves manual items typed before the section heading in that section');
const trimmedEnd=strayBetween.replace('<!-- agent-deck:layout:end -->','');
assert.ok(readJournalLayout(trimmedEnd).sections.active.text.includes('- 测试 '),'missing layout:end is recovered when all three sections are intact');
assert.ok(renderJournal(planJournal(trimmedEnd)).includes('<!-- agent-deck:layout:end -->'),'organizing restores the missing layout:end marker cleanly');
const trimmedBoth=strayBetween.replace('<!-- agent-deck:layout:start -->','').replace('<!-- agent-deck:layout:end -->','');
const recoveredBoth=renderJournal(planJournal(trimmedBoth));
assert.ok(recoveredBoth.includes('<!-- agent-deck:layout:start -->')&&recoveredBoth.includes('<!-- agent-deck:layout:end -->'),'missing layout:start and layout:end are both recovered');
assert.ok(recoveredBoth.startsWith('# 随笔\n\n保留上面的文字'),'head notes survive outer marker recovery');
const glued=custom
  .replace('<!-- agent-deck:section:active:heading -->\n## 正在做','  <!-- agent-deck:section:active:heading -->## 正在做  ')
  .replace('<!-- agent-deck:section:active:end -->','- 紧贴末尾<!-- agent-deck:section:active:end -->')
  .replace('<!-- agent-deck:layout:end -->','<!-- agent-deck:layout:end -->尾注');
const gluedPlan=planJournal(glued);
const gluedOut=renderJournal(gluedPlan);
assert.ok(readJournalLayout(glued).sections.active.text.includes('- 紧贴末尾'),'text glued before :end stays inside that section');
assert.ok(gluedOut.includes('- 紧贴末尾')&&gluedOut.includes('## 正在做')&&gluedOut.includes('尾注'),'glued heading, inline text and tail text are all separated cleanly');
const lostHeading=renderJournal(planJournal('- DOING 跑着 ^ad-run\n',{layout:JOURNAL_LAYOUT_DEFAULT})).replace('## 正在做\n','');
const healedHeading=renderJournal(planJournal(lostHeading));
assert.ok(healedHeading.includes('## 正在做')&&healedHeading.includes('- DOING 跑着 ^ad-run'),'deleted ## heading inside intact markers heals without losing items');
console.log('PASS journal templates: six orders, custom headings, template switching, defaults, idempotence, archiving, fences, CRLF and malformed marker protection');

const {configuredJournalLayout,builtinJournalLayout}=await import('../src/journal-layout.js');
const {resetLanguage}=await import('../src/i18n.js');
const oldLanguage=process.env.AGENT_DECK_LANG;
try {
  process.env.AGENT_DECK_LANG='en';resetLanguage();
  const english=renderJournal(planJournal(source,{layout:configuredJournalLayout({journalLayoutLanguage:'auto'})}));
  assert.ok(english.includes('## Completed')&&english.includes('## In progress'),'English UI selects English built-in headings');
  assert.ok(!english.includes('\n## 已完成\n- DONE 完成任务'),'English template does not add a Chinese generated heading');
  assert.deepEqual(configuredJournalLayout({journalLayoutLanguage:'zh'}),builtinJournalLayout('zh'),'Chinese preset overrides English UI');
  assert.deepEqual(configuredJournalLayout({journalLayout:{order:['active','notes','done'],titles:{active:'My work',notes:'Notes',done:'Done'}}}).titles,{active:'My work',todo:'To do',done:'Done'});
  process.env.AGENT_DECK_LANG='zh';resetLanguage();
  assert.deepEqual(configuredJournalLayout({journalLayoutLanguage:'auto'}),builtinJournalLayout('zh'),'Chinese UI keeps the existing Chinese layout');
  assert.deepEqual(configuredJournalLayout({journalLayoutLanguage:'en'}),builtinJournalLayout('en'),'English preset overrides Chinese UI');
} finally {if(oldLanguage===undefined)delete process.env.AGENT_DECK_LANG;else process.env.AGENT_DECK_LANG=oldLanguage;resetLanguage();}
console.log('PASS built-in templates: language detection, Chinese/English overrides and custom titles');

// 分区标记被删掉一半：补最少的标记救回来，正文一个字不动；补不齐返回 null。
{
  const layout = structuredClone(JOURNAL_LAYOUT_DEFAULT);
  const good = renderJournal(planJournal(source, { layout }));
  const broken = good.split('\n').filter((line) => !line.startsWith('<!-- agent-deck:layout:start -->')
    && line.trim() !== '<!-- agent-deck:section:active:heading -->').join('\n');
  assert.throws(() => readJournalLayout(broken), /分区标记不完整/);
  const fixed = repairJournalLayout(broken);
  assert.ok(fixed, 'repair returns text');
  assert.doesNotThrow(() => readJournalLayout(fixed));
  assert.equal(fixed.split('\n').length, broken.split('\n').length + 2, 'only the two missing markers are added');
  assert.equal(repairJournalLayout('没有标记的普通笔记'), null, 'a note without markers is not repaired');
  const missingEnd = broken.replace('<!-- agent-deck:section:done:end -->', '');
  const endFixed = repairJournalLayout(missingEnd);
  assert.ok(endFixed, 'a single missing :end is repairable');
  assert.doesNotThrow(() => readJournalLayout(endFixed));
  // 「- ---」这种被写成列表项的规则还原成单独的分割线
  const bullet = broken.replace('## 正在做', '- ---\n## 正在做');
  const fixedBullet = repairJournalLayout(bullet);
  assert.ok(fixedBullet.includes('\n---\n'), fixedBullet);
  assert.doesNotThrow(() => readJournalLayout(fixedBullet));
}

// 补不回来的那种（标记之间夹着正文）：repair 拒绝，strip 交给整理重建。
{
  const layout = structuredClone(JOURNAL_LAYOUT_DEFAULT);
  const good = renderJournal(planJournal(source, { layout }));
  const mangled = good.replace('<!-- agent-deck:section:done:heading -->', '- DONE 夹在分区外的条目\n<!-- agent-deck:section:done:heading -->');
  assert.equal(repairJournalLayout(mangled), null, 'content outside any section is refused, not guessed');
  const stripped = stripJournalLayout(mangled);
  assert.equal(readJournalLayout(stripped), null, 'stripped note goes back to the classic rebuild path');
  assert.ok(stripped.includes('DONE 夹在分区外的条目'), 'strip keeps every content line');
}
