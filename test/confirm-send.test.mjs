import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class Element {
  constructor(tag = 'div', options = {}) { this.tag = tag; this.cls = options.cls || ''; this.text = options.text || ''; this.children = []; this.style = { setProperty() {} }; }
  addClass() {}
  createEl(tag, options) { const el = new Element(tag, options); this.children.push(el); return el; }
  createDiv(options) { return this.createEl('div', options); }
  createSpan(options) { return this.createEl('span', options); }
  focus() { this.focused = true; }
  empty() { this.children = []; }
  all() { return [this, ...this.children.flatMap(el => el.all())]; }
}
class Modal {
  constructor() { this.contentEl = new Element(); this.modalEl = new Element(); }
  close() { this.closed = true; this.onClose(); }
}
// Execute the actual modal class with a small host shim; no live session is sent.
const source = fs.readFileSync(new URL('../src/dialog.js', import.meta.url), 'utf8');
const start = source.indexOf('export class ConfirmSendModal');
const end = source.indexOf('// 缩进层级', start);
const ConfirmSendModal = vm.runInNewContext(source.slice(start, end).replace('export class', 'class') + '\nConfirmSendModal', {
  Modal, AGENTS: { dsh: { name: 'DeepSeek Harness' } },
  destinations: () => [{ id: 'obsidian' }], agentIcon() {}, setLucide() {},
  t: text => text, BULLET_RE: /^([ \t]*)([-*+] )(.+)$/, kwLine: () => null,
  indentOf: () => 0, setTimeout: fn => fn(), destinationPicker() {},
});
let sends = 0;
const open = () => {
  const modal = new ConfirmSendModal({}, { agent: 'dsh', text: '- 示例任务', path: '日记.md', where: 'model · high' }, destination => { sends++; assert.equal(destination, 'obsidian'); });
  modal.onOpen();
  return modal;
};
const modal = open();
const nodes = modal.contentEl.all();
assert.equal(nodes.filter(el => el.text === '发送').length, 1, 'send appears only once');
assert.equal(nodes.filter(el => el.text === '取消').length, 1, 'cancel appears only once');
assert.equal(nodes.filter(el => el.tag === 'kbd' || el.cls === 'ad-send__keys').length, 0, 'no duplicate shortcut footer');
const buttons = nodes.filter(el => el.tag === 'button');
assert.equal(buttons.length, 2);
assert.ok(buttons[1].focused, 'send retains keyboard focus');
buttons[0].onclick();
assert.ok(modal.closed);
assert.equal(sends, 0, 'cancel never delegates');
const second = open();
second.contentEl.all().find(el => el.cls === 'ad-btn ad-send__go').onclick();
assert.ok(second.closed);
assert.equal(sends, 1, 'send delegates once');
console.log('PASS confirm send: one action pair, cancel and send behavior, keyboard focus');
