import assert from 'node:assert/strict';
import { planJournal, renderJournal, ensureTopRule, hasBoundedJournalFrame } from '../src/organize-journal.js';
import { JOURNAL_LAYOUT_DEFAULT, JOURNAL_LAYOUT_INCOMPLETE, isJournalLayoutIncompleteError, journalLayout, readJournalLayout, repairJournalLayout, stripJournalLayout } from '../src/journal-layout.js';

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

// 1) 英文环境下抛出的标记不完整错误带稳定错误码，不依赖中文正则匹配。
{
  const prev = process.env.AGENT_DECK_LANG;
  try {
    process.env.AGENT_DECK_LANG = 'en';
    resetLanguage();
    const enLayout = builtinJournalLayout('en');
    const good = renderJournal(planJournal(source, { layout: enLayout }));
    const broken = good.replace('<!-- agent-deck:section:done:end -->', '');
    let caught = null;
    try { readJournalLayout(broken); } catch (e) { caught = e; }
    assert.ok(caught, 'broken English journal throws');
    assert.equal(caught.code, JOURNAL_LAYOUT_INCOMPLETE);
    assert.ok(isJournalLayoutIncompleteError(caught), 'English error is recognized by code');
    assert.ok(isJournalLayoutIncompleteError(caught.message), 'English error message fallback is recognized');
  } finally {
    if (prev === undefined) delete process.env.AGENT_DECK_LANG; else process.env.AGENT_DECK_LANG = prev;
    resetLanguage();
  }
}

// 2) 内联粘连、重复外框、代码块保护：repair 与 strip 都只动非代码块标记，绝不丢正文。
{
  const layout = structuredClone(JOURNAL_LAYOUT_DEFAULT);
  const good = renderJournal(planJournal(source, { layout }));
  const gluedBroken = good
    .replace('<!-- agent-deck:section:active:end -->', '- 紧贴末尾的笔记<!-- agent-deck:section:active:end -->')
    .replace('<!-- agent-deck:section:todo:heading -->\n', '')
    .replace('<!-- agent-deck:layout:end -->', '<!-- agent-deck:layout:end -->\n<!-- agent-deck:layout:end -->');
  const fixed = repairJournalLayout(gluedBroken, layout);
  assert.ok(fixed, 'glued inline marker + missing section open + duplicate layout:end is repairable');
  const parsed = readJournalLayout(fixed);
  assert.ok(parsed.sections.active.text.includes('- 紧贴末尾的笔记'), 'inline text beside marker stays intact');

  const withFence = `${gluedBroken}\n\`\`\`md\n<!-- agent-deck:section:done:end -->\n\`\`\`\n`;
  const stripped = stripJournalLayout(withFence);
  assert.equal(readJournalLayout(stripped), null, 'strip removes glued markers outside fences');
  assert.ok(stripped.includes('- 紧贴末尾的笔记'), 'strip keeps inline text');
  assert.ok(stripped.includes('```md\n<!-- agent-deck:section:done:end -->\n```'), 'strip leaves fenced example markers untouched');
}

// 3) 整块分区的起止标记都被删掉：保留了 ## 标题时原地找回，整块空分区被删时按顺序补回。
{
  const layout = structuredClone(JOURNAL_LAYOUT_DEFAULT);
  const good = renderJournal(planJournal(source, { layout }))
    .replace('## 还要做\n', '## 还要做\n- 手写待办\n');
  const noTodoMarkers = good
    .replace('<!-- agent-deck:section:todo:heading -->\n', '')
    .replace('<!-- agent-deck:section:todo:end -->\n', '');
  const healedByHeading = repairJournalLayout(noTodoMarkers, layout);
  assert.ok(healedByHeading, 'missing both markers of a section heals via visible heading');
  assert.ok(readJournalLayout(healedByHeading).sections.todo.text.includes('- 手写待办'), 'manual item under visible heading stays in todo');

  const deletedWholeTodo = good.replace(/\n---\n<!-- agent-deck:section:todo:heading -->[\s\S]*?<!-- agent-deck:section:todo:end -->/, '');
  const healedEmpty = repairJournalLayout(deletedWholeTodo, layout);
  assert.ok(healedEmpty, 'deleting an entire section heals by reinserting the missing empty section');
  const reparsed = readJournalLayout(healedEmpty);
  assert.deepEqual(reparsed.layout.order, ['active', 'todo', 'done']);
  assert.ok(reparsed.sections.active.text.includes('正在做') && reparsed.sections.done.text.includes('完成任务'));
}

// 4) 标记烂掉但可见 ## 标题 + --- 框架完好时，剥离残余标记后可由标题边界无损接管。
{
  const layout = structuredClone(JOURNAL_LAYOUT_DEFAULT);
  const good = renderJournal(planJournal(source, { layout }))
    .replace('## 还要做\n', '## 还要做\n- 保留在还要做的手写项\n');
  // 模拟用户删得只剩一个孤立且串行的 marker，但 --- 与三个 ## 标题都在
  const shattered = stripJournalLayout(good).replace('## 已完成', '<!-- agent-deck:section:done:end -->## 已完成');
  assert.equal(repairJournalLayout(shattered, layout), null, 'single stray marker cannot be minimally repaired');
  const stripped = stripJournalLayout(shattered);
  assert.equal(hasBoundedJournalFrame(stripped, layout), true, 'visible --- + ## headings still form a bounded frame');
  const rebuilt = renderJournal(planJournal(stripped, { layout }));
  const parsed = readJournalLayout(rebuilt);
  assert.ok(parsed.sections.todo.text.includes('- 保留在还要做的手写项'), 'heading-based fallback preserves per-section manual notes');
  assert.ok(parsed.sections.active.text.includes('正在做') && parsed.sections.done.text.includes('完成任务'));
  assert.equal(hasBoundedJournalFrame('# 普通随笔\n\n- 只有一句话\n', layout), false, 'plain notes without section headings do not trigger bounded frame fallback');
}
console.log('PASS marker recovery: English error code, inline glued markers, deleted sections, and heading-frame fallback');
