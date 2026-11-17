import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { sandboxFor, codexCliArgs } from "../src/delegation-runners.js";
import { CLAUDE_PERMISSIONS, CODEX_SANDBOXES } from "../src/constants.js";

// dialog.js 依赖 obsidian 的 Modal/Notice，测试里用 data: 模块顶掉。
register("data:text/javascript," + encodeURIComponent(`
  export async function resolve(s,c,n){ if(s==='obsidian') return {url:'data:text/javascript,export class Modal{};export class Notice{};export function setIcon(){};export function setLucide(){}',shortCircuit:true}; return n(s,c) }
  export async function load(u,c,n){ if(/\.png$/.test(u)) return {format:'module', shortCircuit:true, source:'export default "icon.png"'}; return n(u,c) }
`));
const { workModeOptions, defaultWorkMode } = await import("../src/dialog.js");

const plugin = (delegate = {}) => ({ settings: { delegate: { codex: { model: "gpt-6.1-sol", effort: "low", sandbox: "workspace-write", ...(delegate.codex || {}) }, ...delegate } } });

test("工作模式选项按 Agent 分：claude/qoder 是权限，codex 是沙箱，ACP 里的不显示", () => {
  assert.deepEqual(workModeOptions("claude"), CLAUDE_PERMISSIONS);
  assert.deepEqual(workModeOptions("qoder"), CLAUDE_PERMISSIONS);
  assert.deepEqual(workModeOptions("codex"), CODEX_SANDBOXES);
  assert.deepEqual(workModeOptions("dsh"), []);
  assert.deepEqual(workModeOptions("antigravity"), []);
});

test("默认模式来自设置：claude 读 permission，codex 读 sandbox", () => {
  assert.equal(defaultWorkMode("claude", { delegate: { claude: { permission: "manual" } } }), "manual");
  assert.equal(defaultWorkMode("claude", { delegate: { claude: { permission: "" } } }), "auto");
  assert.equal(defaultWorkMode("codex", { delegate: { codex: { sandbox: "read-only" } } }), "read-only");
  assert.equal(defaultWorkMode("dsh", { delegate: {} }), "");
});

test("codex 沙箱映射：Claude 那套词也能落到沙箱上，未知值回退设置默认", () => {
  assert.equal(sandboxFor("plan"), "read-only");
  assert.equal(sandboxFor("manual"), "read-only");
  assert.equal(sandboxFor("auto"), "workspace-write");
  assert.equal(sandboxFor("acceptEdits"), "workspace-write");
  assert.equal(sandboxFor("danger-full-access"), "danger-full-access");
  assert.equal(sandboxFor("", "read-only"), "read-only");
  assert.equal(sandboxFor("nonsense", "workspace-write"), "workspace-write");
});

test("codexCliArgs 用这一次选的模式，没选才用设置默认", () => {
  const args = codexCliArgs(plugin(), { permission: "danger-full-access", model: "gpt-6.1-sol", effort: "low" });
  assert.equal(args[args.indexOf("--sandbox") + 1], "danger-full-access");
  const fallback = codexCliArgs(plugin({ codex: { sandbox: "read-only" } }), { model: "gpt-6.1-sol" });
  assert.equal(fallback[fallback.indexOf("--sandbox") + 1], "read-only");
  const permissionWord = codexCliArgs(plugin(), { permission: "plan" });
  assert.equal(permissionWord[permissionWord.indexOf("--sandbox") + 1], "read-only", "plan 映射成只读");
});
