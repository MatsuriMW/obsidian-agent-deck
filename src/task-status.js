import { Menu, Notice } from "obsidian";
import * as J from "./journal.js";
import { collectSelectedRootLines, itemLineFor, parentItem, contentSpan, groupRowsEdit } from "./outline.js";
import { t } from "./i18n.js";

export { itemLineFor, parentItem, contentSpan, groupRowsEdit };

const STATUS_TOKEN = /^(\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX/\-]\]\s*)?(?:\*\*\d{1,2}[:：]\d{2}\*\*\s*)?)([A-Z][A-Z0-9_-]*|[a-z][a-z0-9_-]*)(?=\s|$)/;
const LIST_STATUS_LEAD = /^(\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX/\-]\]\s*)?(?:\*\*\d{1,2}[:：]\d{2}\*\*\s*)?)(.*)$/;
const EXTRA_STATE_KWS = ["YES", "NO", "MAYBE", "ARCHIVED"];

export function knownTaskKeywords(app = null) {
  const words = new Set([...J.TASK_KWS.split("|"), ...EXTRA_STATE_KWS]);
  for (const p of Object.values(app?.plugins?.plugins || {})) {
    for (const [key, value] of Object.entries(p?.settings || {})) {
      if (/^additional.*Keywords$/.test(key) && Array.isArray(value)) {
        for (const kw of value) {
          if (/^[A-Z][A-Z0-9_-]*$/.test(kw)) words.add(kw);
        }
      }
    }
  }
  return words;
}

function updateCheckboxPrefix(prefix, keyword) {
  if (!/\[[ xX/\-]\]/.test(prefix)) return prefix;
  const box = !keyword
    ? " "
    : J.DONE_KWS.includes(keyword)
      ? (keyword.startsWith("CANCEL") ? "-" : "x")
      : keyword === "DOING" ? "/" : " ";
  return prefix.replace(/\[[ xX/\-]\]/, `[${box}]`);
}

export function replaceTaskStatus(raw, keyword, { knownKeywords = null } = {}) {
  if (!/^[A-Z][A-Z0-9_-]*$/.test(keyword)) return null;
  const match = STATUS_TOKEN.exec(raw);
  if (!match) return null;
  if (/^[a-z]/.test(match[2]) && !(knownKeywords || knownTaskKeywords()).has(match[2].toUpperCase())) return null;
  const prefix = updateCheckboxPrefix(match[1], keyword);
  return prefix + keyword + raw.slice(match[0].length);
}

/** Set, replace, or clear ("") a task status keyword on any list item line. */
export function setTaskLineStatus(raw, keyword, { knownKeywords = null } = {}) {
  if (keyword !== "" && !/^[A-Z][A-Z0-9_-]*$/.test(keyword)) return null;
  const lead = LIST_STATUS_LEAD.exec(raw);
  if (!lead) return null;
  const known = knownKeywords || knownTaskKeywords();
  const prefix = updateCheckboxPrefix(lead[1], keyword);
  const rest = lead[2] || "";
  const firstToken = /^([A-Z][A-Z0-9_-]*|[a-z][a-z0-9_-]*)(?=\s|$)(?:\s+)?/.exec(rest);
  if (firstToken && known.has(firstToken[1].toUpperCase())) {
    const tail = rest.slice(firstToken[0].length);
    return keyword ? `${prefix}${keyword}${tail ? " " + tail : ""}` : `${prefix}${tail}`;
  }
  if (!keyword) return null;
  return `${prefix}${keyword}${rest ? " " + rest : ""}`;
}

export function selectionLineRanges(doc, selection) {
  const ranges = selection?.ranges?.length ? selection.ranges : (selection ? [selection] : []);
  return ranges.map((r) => {
    const fromLine = doc.lineAt(r.from).number - 1;
    let toLine = doc.lineAt(r.to).number - 1;
    if (toLine > fromLine && r.to === doc.line(toLine + 1).from) toLine -= 1;
    return { fromLine, toLine };
  });
}

export function selectedTaskLines(doc, selection) {
  if (!doc || !selection) return [];
  const text = doc.toString();
  const lines = text.split("\n");
  const fenced = J.fencedLines(lines);
  return collectSelectedRootLines(lines, selectionLineRanges(doc, selection), {
    fenced,
    skipLine: (line) => J.RECORD_LINE_RE.test(line),
  });
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
  const settings=plugin.settings;
  let id=J.blockIdOf(target.raw);
  if (!id && plugin.taskBlockId && !J.DONE_KWS.includes(keyword)) {
    const text=await plugin.readNote(target.path), n=locateStatusTask(text,target);
    if(n<0)throw new Error(t('任务已变化，请重新点击状态关键词'));
    const link=J.linkUnder(text.split('\n'),n), task=J.kwLine(target.raw);
    if(link || task?.body.startsWith('🤖'))id=await plugin.taskBlockId(link?.sid || "",link?.agent || "",task.body.replace(/^🤖\s*/,""));
  }
  let previous, changed=false;
  const transform=text=>{
    const n=locateStatusTask(text,target);
    if(n<0)throw new Error(t('任务已变化，请重新点击状态关键词'));
    const lines=text.split('\n');
    const link=J.linkUnder(lines,n);
    id ||= J.makeBlockId(link?.sid || "", link?.agent);
    const next=keyword || suggestedStatus(settings,plugin.usage,text,n);
    if(!next)throw new Error(t('没有可跟随的会话状态'));
    const raw=replaceTaskStatus(lines[n],next,{knownKeywords:knownTaskKeywords(plugin.app)});
    if(!raw)throw new Error(t('任务已变化，请重新点击状态关键词'));
    previous=settings.manualTaskStates?.[id];
    const locks=settings.manualTaskStates ||= {};
    if(keyword)locks[id]=next;else delete locks[id];
    changed=true;
    lines[n]=J.ensureBlockId(raw,id).line;
    return J.cleanCompletedIdentifiers(lines.join('\n'));
  };
  try {
    const view=plugin.sourceViewForPath ? plugin.sourceViewForPath(target.path) : plugin.viewForPath(target.path);
    if(view){const before=view.editor.getValue();const after=transform(before);const diff=J.diffLines(before,after);if(diff)view.editor.transaction({changes:[diff]});}
    else {const file=plugin.app.vault.getAbstractFileByPath(target.path);if(!file)throw new Error(t('任务已变化，请重新点击状态关键词'));await plugin.app.vault.process(file,transform);}
  } catch(error) {
    if(changed){if(previous===undefined)delete settings.manualTaskStates[id];else settings.manualTaskStates[id]=previous;}
    throw error;
  }
  await plugin.saveSettings();plugin.refreshUI();
}

export async function applyBatchStatusChoice(plugin, editor, lineNumbers, keyword) {
  const unique = [...new Set((lineNumbers || []).filter((n) => Number.isInteger(n) && n >= 0))].sort((a, b) => a - b);
  if (!unique.length || !editor) return 0;
  const settings = plugin.settings || {};
  const known = knownTaskKeywords(plugin.app);
  const before = editor.getValue();
  const lines = before.split("\n");
  const rollbacks = [];
  let updatedCount = 0;

  for (const n of unique) {
    if (n >= lines.length || !J.LIST_RE.test(lines[n] || "")) continue;
    const rawLine = lines[n];
    const nextKw = keyword === null ? suggestedStatus(settings, plugin.usage, before, n) : keyword;
    if (keyword === null && !nextKw) continue;
    const replaced = setTaskLineStatus(rawLine, nextKw, { knownKeywords: known });
    if (!replaced || replaced === rawLine) continue;

    let id = J.blockIdOf(rawLine);
    const link = J.linkUnder(lines, n);
    const task = J.kwLine(rawLine);
    const isAi = Boolean(id || link || task?.body?.startsWith("🤖"));
    let finalLine = replaced;
    if (isAi) {
      id ||= J.makeBlockId(link?.sid || "", link?.agent);
      rollbacks.push([id, settings.manualTaskStates?.[id]]);
      const locks = (settings.manualTaskStates ||= {});
      if (keyword) locks[id] = nextKw;
      else delete locks[id];
      if (!J.DONE_KWS.includes(nextKw) && nextKw !== "") finalLine = J.ensureBlockId(replaced, id).line;
    }
    lines[n] = finalLine;
    updatedCount += 1;
  }

  if (!updatedCount) {
    if (keyword === null) throw new Error(t("没有可跟随的会话状态"));
    return 0;
  }

  const after = J.cleanCompletedIdentifiers(lines.join("\n"));
  try {
    const diff = J.diffLines(before, after);
    if (diff) {
      if (typeof editor.transaction === "function") editor.transaction({ changes: [diff] });
      else if (editor.cm) editor.cm.dispatch({ changes: { from: editor.posToOffset(diff.from), to: editor.posToOffset(diff.to), insert: diff.text } });
    }
  } catch (error) {
    for (const [id, prev] of rollbacks) {
      if (prev === undefined) delete settings.manualTaskStates[id];
      else settings.manualTaskStates[id] = prev;
    }
    throw error;
  }
  await plugin.saveSettings?.();
  plugin.refreshUI?.();
  return updatedCount;
}

function appendStatusChoices(menu, plugin, { currentKeyword = "", suggested = "", hasSuggested = false, allowClear = false, onChoose, position }) {
  for (const keyword of ["TODO", "DOING", "PAUSED", "DONE", "CANCELED"]) {
    menu.addItem((item) => item.setTitle(keyword).setChecked(Boolean(currentKeyword && keyword === currentKeyword)).onClick(() => onChoose(keyword)));
  }
  const groups = [
    [t("等待与稍后"), ["LATER", "WAITING", "WAIT", "SUSPENDED"]],
    [t("AI 状态"), [...J.AGENT_KWS]],
    [t("其他关键词"), ["IN-PROGRESS", "CANCELLED", "FAILED"]],
  ];
  const known = new Set(J.TASK_KWS.split("|"));
  for (const p of Object.values(plugin.app?.plugins?.plugins || {})) {
    for (const [key, value] of Object.entries(p.settings || {})) {
      if (/^additional.*Keywords$/.test(key) && Array.isArray(value)) {
        for (const kw of value) {
          if (/^[A-Z][A-Z0-9_-]*$/.test(kw) && !known.has(kw)) {
            groups[2][1].push(kw);
            known.add(kw);
          }
        }
      }
    }
  }
  for (const [title, keywords] of groups) {
    menu.addItem((item) => {
      item.setTitle(title);
      if (typeof item.setSubmenu === "function") {
        const sub = item.setSubmenu();
        for (const kw of keywords) sub.addItem((i) => i.setTitle(kw).setChecked(Boolean(currentKeyword && kw === currentKeyword)).onClick(() => onChoose(kw)));
      } else {
        item.onClick(() => {
          const sub = new Menu();
          for (const kw of keywords) sub.addItem((i) => i.setTitle(kw).setChecked(Boolean(currentKeyword && kw === currentKeyword)).onClick(() => onChoose(kw)));
          sub.showAtPosition(position);
        });
      }
    });
  }
  if (allowClear) {
    menu.addItem((item) => item.setTitle(t("清除状态关键词")).onClick(() => onChoose("")));
  }
  menu.addSeparator();
  menu.addItem((item) =>
    item
      .setTitle(suggested ? t("恢复自动跟随：{state}", { state: suggested }) : hasSuggested ? t("恢复自动跟随") : t("没有可跟随的会话状态"))
      .setDisabled(!suggested && !hasSuggested)
      .onClick(() => onChoose(null)),
  );
}

export function populateBatchStatusMenu(menu, plugin, editor, lineNumbers, position = { x: 0, y: 0 }) {
  const before = editor.getValue();
  const hasSuggested = lineNumbers.some((n) => Boolean(suggestedStatus(plugin.settings || {}, plugin.usage || { meta: new Map() }, before, n)));
  appendStatusChoices(menu, plugin, {
    hasSuggested,
    allowClear: true,
    position,
    onChoose: (kw) =>
      applyBatchStatusChoice(plugin, editor, lineNumbers, kw)
        .then((count) => { if (count && lineNumbers.length > 1) new Notice(t("已更新 {n} 个块的状态", { n: count })); })
        .catch((error) => new Notice(error.message)),
  });
}

export function openBatchStatusMenu(plugin, editor, position = null) {
  const cm = editor?.cm;
  const lineNumbers = cm ? selectedTaskLines(cm.state.doc, cm.state.selection) : [];
  if (!lineNumbers.length) {
    new Notice(t("请先选中要调整状态的列表项"));
    return null;
  }
  let pos = position;
  if (!pos && cm) {
    const coords = cm.coordsAtPos?.(cm.state.selection.main.head);
    pos = coords ? { x: coords.left, y: coords.bottom } : { x: 120, y: 120 };
  }
  const menu = new Menu();
  menu.addItem((item) =>
    item.setTitle(lineNumbers.length > 1 ? t("批量调整 {n} 个块的任务状态", { n: lineNumbers.length }) : t("调整当前块的任务状态")).setDisabled(true),
  );
  populateBatchStatusMenu(menu, plugin, editor, lineNumbers, pos);
  menu.showAtPosition(pos || { x: 120, y: 120 });
  return menu;
}

async function statusMenu(plugin,target,position) {
  const text=await plugin.readNote(target.path), n=locateStatusTask(text,target);
  if(n<0)return new Notice(t('任务已变化，请重新点击状态关键词'));
  const view=plugin.viewForPath?.(target.path);
  const cm=view?.editor?.cm;
  const selected=cm ? selectedTaskLines(cm.state.doc, cm.state.selection) : [];
  if (view?.editor && selected.length >= 2 && selected.includes(n)) {
    return openBatchStatusMenu(plugin, view.editor, position);
  }
  const suggested=suggestedStatus(plugin.settings,plugin.usage,text,n), menu=new Menu();
  const choose=keyword=>applyStatusChoice(plugin,target,keyword).catch(error=>new Notice(error.message));
  menu.addItem(item=>item.setTitle(J.isManualTask(plugin.settings,text.split('\n')[n])?t('人工管理：AI 不覆盖此任务状态'):(suggested?t('状态由会话自动同步'):t('选择一个任务状态'))).setDisabled(true));
  appendStatusChoices(menu, plugin, { currentKeyword: target.keyword, suggested, position, onChoose: choose });
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
    const matched = target && STATUS_TOKEN.exec(target.raw)?.[2];
    return matched && matched.toUpperCase() === String(target.keyword || "").toUpperCase() ? target : null;
  };
  for(const type of ['mousedown','click','keydown'])plugin.registerDomEvent(document,type,event=>{
    if(type==='keydown'&&!['Enter',' '].includes(event.key))return;
    if(type!=='keydown'&&event.button!==0)return;
    const target=locate(event.target);if(!target)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(type!=='mousedown'){const rect=event.target.getBoundingClientRect?.();const position={x:event.clientX??rect?.left??0,y:event.clientY??rect?.bottom??0};statusMenu(plugin,target,position).catch(error=>new Notice(error.message));}
  },true);
}
