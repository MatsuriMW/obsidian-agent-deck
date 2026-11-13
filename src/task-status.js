import { Menu, Notice } from "obsidian";
import { randomUUID } from "crypto";
import * as J from "./journal.js";
import { t } from "./i18n.js";

const STATUS_TOKEN = /^(\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX/\-]\]\s*)?(?:\*\*\d{1,2}[:：]\d{2}\*\*\s*)?)([A-Z][A-Z0-9_-]*)(?=\s|$)/;

export function replaceTaskStatus(raw, keyword) {
  if (!/^[A-Z][A-Z0-9_-]*$/.test(keyword)) return null;
  const match = STATUS_TOKEN.exec(raw);
  if (!match) return null;
  let prefix = match[1];
  if (/\[[ xX/\-]\]/.test(prefix)) {
    const box = J.DONE_KWS.includes(keyword) ? (keyword.startsWith('CANCEL') ? '-' : 'x') : keyword === 'DOING' ? '/' : ' ';
    prefix = prefix.replace(/\[[ xX/\-]\]/, `[${box}]`);
  }
  return prefix + keyword + raw.slice(match[0].length);
}

export function locateStatusTask(text, target) {
  const lines = text.split('\n'), fenced = J.fencedLines(lines);
  const id = J.blockIdOf(target.raw);
  const hits = lines.flatMap((raw,n) => !fenced.has(n) && J.LIST_RE.test(raw) && (id ? J.blockIdOf(raw) === id : raw === target.raw) ? [n] : []);
  if (hits.length !== 1) return -1;
  return hits[0];
}

export function suggestedStatus(settings, usage, text, n) {
  const lines=text.split('\n'), owners=J.ownersOf(lines), ids=new Set();
  for (let i=n+1;i<lines.length;i++) {
    if (lines[i].trim() && J.width(lines[i])<=J.width(lines[n])) break;
    const link=owners[i]===n && J.parseLink(lines[i]);if(link)ids.add(link.sid);
  }
  const bid=J.blockIdOf(lines[n]);
  if(bid)for(const day of Object.values(settings.autoLogState||{}))for(const [sid,r] of Object.entries(day||{}))if(r?.blockId===bid&&!r.skip&&!r.gone)ids.add(sid);
  if(!ids.size)return '';
  if(settings.autoLogArchiveDone!==false && [...ids].every(sid=>usage.archived?.has(sid)||usage.archivedClaude?.has(sid)))return 'DONE';
  const states=[...ids].map(sid=>usage.meta.get(sid)?.state).filter(Boolean);
  if(states.some(state=>['run','running','starting'].includes(state)))return 'DOING';
  return states.map(state=>J.STATE_KW[state]).find(Boolean)||'';
}

export async function applyStatusChoice(plugin, target, keyword) {
  const settings=plugin.settings, id=J.blockIdOf(target.raw)||randomUUID();
  let previous, changed=false;
  const transform=text=>{
    const n=locateStatusTask(text,target);
    if(n<0)throw new Error(t('任务已变化，请重新点击状态关键词'));
    const lines=text.split('\n');
    const next=keyword || suggestedStatus(settings,plugin.usage,text,n);
    if(!next)throw new Error(t('没有可跟随的会话状态'));
    const raw=replaceTaskStatus(lines[n],next);
    if(!raw)throw new Error(t('任务已变化，请重新点击状态关键词'));
    previous=settings.manualTaskStates?.[id];
    const locks=settings.manualTaskStates ||= {};
    if(keyword)locks[id]=next;else delete locks[id];
    changed=true;
    lines[n]=J.ensureBlockId(raw,id).line;
    return lines.join('\n');
  };
  try {
    const view=plugin.viewForPath(target.path);
    if(view){const before=view.editor.getValue();const after=transform(before);const diff=J.diffLines(before,after);if(diff)view.editor.transaction({changes:[diff]});}
    else {const file=plugin.app.vault.getAbstractFileByPath(target.path);if(!file)throw new Error(t('任务已变化，请重新点击状态关键词'));await plugin.app.vault.process(file,transform);}
  } catch(error) {
    if(changed){if(previous===undefined)delete settings.manualTaskStates[id];else settings.manualTaskStates[id]=previous;}
    throw error;
  }
  await plugin.saveSettings();plugin.refreshUI();
}

async function statusMenu(plugin,target,position) {
  const text=await plugin.readNote(target.path), n=locateStatusTask(text,target);
  if(n<0)return new Notice(t('任务已变化，请重新点击状态关键词'));
  const suggested=suggestedStatus(plugin.settings,plugin.usage,text,n), menu=new Menu();
  const choose=keyword=>applyStatusChoice(plugin,target,keyword).catch(error=>new Notice(error.message));
  menu.addItem(item=>item.setTitle(J.isManualTask(plugin.settings,text.split('\n')[n])?t('人工管理：AI 不覆盖此任务状态'):(suggested?t('状态由会话自动同步'):t('选择一个任务状态'))).setDisabled(true));
  for(const keyword of ['TODO','DOING','PAUSED','DONE','CANCELED'])menu.addItem(item=>item.setTitle(keyword).setChecked(keyword===target.keyword).onClick(()=>choose(keyword)));
  const groups=[
    [t('等待与稍后'),['LATER','WAITING','WAIT','SUSPENDED']],
    [t('AI 状态'),J.AGENT_KWS],
    [t('其他关键词'),['IN-PROGRESS','CANCELLED','FAILED']],
  ];
  const known=new Set(J.TASK_KWS.split('|'));
  for(const p of Object.values(plugin.app.plugins?.plugins||{}))for(const [key,value] of Object.entries(p.settings||{}))if(/^additional.*Keywords$/.test(key)&&Array.isArray(value))for(const kw of value)if(/^[A-Z][A-Z0-9_-]*$/.test(kw)&&!known.has(kw)){groups[2][1].push(kw);known.add(kw);}
  for(const [title,keywords]of groups)menu.addItem(item=>item.setTitle(title).onClick(()=>{const sub=new Menu();for(const kw of keywords)sub.addItem(i=>i.setTitle(kw).setChecked(kw===target.keyword).onClick(()=>choose(kw)));sub.showAtPosition(position);}));
  menu.addSeparator();
  menu.addItem(item=>item.setTitle(suggested?t('恢复自动跟随：{state}',{state:suggested}):t('没有可跟随的会话状态')).setDisabled(!suggested).onClick(()=>choose(null)));
  menu.showAtPosition(position);
}

export function registerTaskStatusMenu(plugin) {
  // Source positions in reading view are attached only when list structures match exactly.
  plugin.registerMarkdownPostProcessor((el,ctx)=>{
    const section=ctx.getSectionInfo(el);if(!section)return;
    const lines=section.text.split('\n'),fenced=J.fencedLines(lines),source=[];
    for(let n=section.lineStart;n<=section.lineEnd;n++)if(!fenced.has(n)&&J.LIST_RE.test(lines[n]||''))source.push(n);
    const items=[...el.querySelectorAll('li')];if(items.length!==source.length)return;
    items.forEach((li,i)=>{li.dataset.adStatusPath=ctx.sourcePath;li.dataset.adStatusRaw=lines[source[i]];});
  });
  const locate=element=>{
    const keyword=element?.closest?.('[data-task-keyword]');if(!keyword)return null;
    let target=null;
    plugin.app.workspace.iterateAllLeaves(leaf=>{
      const view=leaf.view,cm=view.editor?.cm;
      if(!cm||!view.file||!cm.dom.contains(keyword))return;
      const line=cm.state.doc.lineAt(cm.posAtDOM(keyword));
      if(J.fencedLines(cm.state.doc.toString().split('\n')).has(line.number-1))return;
      target={path:view.file.path,raw:line.text,keyword:keyword.dataset.taskKeyword};
    });
    if(!target){const li=keyword.closest('li[data-ad-status-path]');if(li)target={path:li.dataset.adStatusPath,raw:li.dataset.adStatusRaw,keyword:keyword.dataset.taskKeyword};}
    return target && STATUS_TOKEN.exec(target.raw)?.[2]===target.keyword ? target : null;
  };
  for(const type of ['mousedown','click','keydown'])plugin.registerDomEvent(document,type,event=>{
    if(type==='keydown'&&!['Enter',' '].includes(event.key))return;
    if(type!=='keydown'&&event.button!==0)return;
    const target=locate(event.target);if(!target)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(type!=='mousedown'){const rect=event.target.getBoundingClientRect?.();const position={x:event.clientX??rect?.left??0,y:event.clientY??rect?.bottom??0};statusMenu(plugin,target,position).catch(error=>new Notice(error.message));}
  },true);
}
