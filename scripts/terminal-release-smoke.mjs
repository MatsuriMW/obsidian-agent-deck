import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";

const [root, terminal, round] = process.argv.slice(2);
const dir = path.join(root, "项目 QA " + round);
const journal = path.join(dir, "invocations.jsonl");
const vaultName = "Agent Deck QA";
const windows = process.platform === "win32";
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(journal, "");
const probe = path.join(dir, "probe.cjs");
fs.writeFileSync(probe,
  "const fs = require('node:fs');\n" +
  "fs.appendFileSync(" + JSON.stringify(journal) + ", JSON.stringify({cwd:fs.realpathSync(process.cwd()),args:process.argv.slice(2),pane:process.env.WEZTERM_PANE||'',tmux:!!process.env.TMUX})+'\\n');\n");
const quote = windows ? (s) => '"' + s + '"' : (s) => "'" + s.replaceAll("'", "'\\''") + "'";
const bin = path.join(dir, windows ? "QA Gemini.cmd" : "QA Gemini");
fs.writeFileSync(bin, windows
  ? "@echo off\r\n" + quote(process.execPath) + ' "%~dp0probe.cjs" %*\r\n'
  : "#!/bin/sh\nexec " + quote(process.execPath) + " " + quote(probe) + ' "$@"\n',
{ mode: 0o755 });
const basic = quote(process.execPath) + " " + quote(probe);
const token = "ad-smoke-" + terminal + "-" + round;
const note = "Smoke " + token + ".md";

let target;
for (let i = 0; i < 80 && !target; i++) {
  try {
    const response = await fetch("http://127.0.0.1:9241/json/list");
    target = (await response.json()).find(t => t.type === "page" && t.title.includes(vaultName) && !t.title.startsWith("Settings -"));
  } catch {}
  if (!target) await wait(500);
}
assert.ok(target, "isolated Obsidian page did not open");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});
let nextId = 0;
function evaluate(expression) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    function response(event) {
      const msg = JSON.parse(event.data);
      if (msg.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener("message", response);
      if (msg.error || msg.result?.exceptionDetails) {
        return reject(new Error(msg.result?.exceptionDetails?.exception?.description || msg.error?.message || "Obsidian evaluation failed"));
      }
      resolve(msg.result.result.value);
    }
    const timer = setTimeout(() => {
      ws.removeEventListener("message", response);
      reject(new Error("Obsidian evaluation timed out"));
    }, 40000);
    ws.addEventListener("message", response);
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
  });
}
async function invocation(marker) {
  for (let i = 0; i < 90; i++) {
    const rows = fs.existsSync(journal) ? fs.readFileSync(journal, "utf8").trim().split("\n").filter(Boolean) : [];
    const hit = rows.map(JSON.parse).find(row => row.args.some(arg => arg.includes(marker)));
    if (hit) {
      assert.equal(hit.cwd.toLowerCase(), fs.realpathSync(dir).toLowerCase());
      if (terminal === "wezterm") assert.ok(hit.pane, "the process did not run in WezTerm");
      if (terminal === "tmux" && !windows) assert.ok(hit.tmux, "the process did not run in tmux");
      console.log(terminal, round, marker.split("-").at(-1), "PASS");
      return hit;
    }
    await wait(350);
  }
  throw new Error(terminal + " did not execute " + marker);
}
const project = JSON.stringify(dir);
try {
  let ready;
  let attemptedEnable = false;
  for (let i = 0; i < 50 && !ready; i++) {
    ready = await evaluate("window.app?.vault?.getName() === " + JSON.stringify(vaultName) + " && !!window.app?.plugins?.plugins?.['agent-deck']");
    if (!ready && !attemptedEnable) {
      attemptedEnable = await evaluate("(async () => {" +
        "if (window.app?.vault?.getName() !== " + JSON.stringify(vaultName) + " || !app.workspace.layoutReady) return false;" +
        "await app.plugins.loadManifests();if (!app.plugins.manifests['agent-deck']) throw Error('Agent Deck manifest missing from scratch vault');" +
        "await app.plugins.setEnable(true);await app.plugins.enablePluginAndSave('agent-deck');return true;})()");
    }
    if (!ready) await wait(350);
  }
  assert.ok(ready, "Agent Deck was not loaded into the isolated vault");
  const init = await evaluate("(async () => {" +
    "const p = app.plugins.plugins['agent-deck']; await p._usageReady;" +
    "p.settings.agents.gemini = true;p.settings.delegate.gemini.path=" + JSON.stringify(bin) + ";" +
    "p.settings.cliOpen = 'terminal';p.settings.dream.inject=false;" +
    "app.setting.open();app.setting.openTabById('agent-deck');" +
    "await new Promise(r => setTimeout(r, 300));" +
    "const settingRoot = app.setting.activeTab?.containerEl || document;" +
    "const select = [...settingRoot.querySelectorAll('select')].find(s => s.querySelector('option[value=wezterm]') && s.querySelector('option[value=tmux]'));" +
    "if (!select) throw Error('Primary terminal dropdown is missing');" +
    "const options=[...select.options].map(o=>o.value);" +
    "select.value=" + JSON.stringify(terminal) + ";select.dispatchEvent(new select.ownerDocument.defaultView.Event('change',{bubbles:true}));" +
    "app.setting.close();" +
    "const n=" + JSON.stringify(note) + ";const body=" + JSON.stringify("# Smoke\n\n- " + token + "-dispatch 中文\n") + ";" +
    "const f=app.vault.getAbstractFileByPath(n); if(f) await app.vault.modify(f,body);else await app.vault.create(n,body);" +
    "return {selected:p.settings.cliTerminal,options};})()");
  assert.equal(init.selected, terminal);
  assert.equal(init.options.includes("iterm"), !windows);

  const opened = await evaluate("app.plugins.plugins['agent-deck'].openTerminalAt(" + project + ", " + JSON.stringify(basic + " " + token + "-open") + ")");
  assert.equal(opened, terminal, "open-in-terminal fell back to another host");
  await invocation(token + "-open");

  await evaluate("app.plugins.plugins['agent-deck'].delegateAtLine(" + JSON.stringify(note) +
    ", 2, { agent:'gemini', destination:'terminal', confirmed:true, newSession:true, cwd:" + project + " })");
  const handoff = await invocation(token + "-dispatch");
  assert.ok(handoff.args.includes("-i"), "delegation did not use the interactive Agent CLI arguments");

  await evaluate("app.plugins.plugins['agent-deck'].openSession('gemini'," + JSON.stringify(token + "-resume") + ",'cli',{cwd:" + project + "})");
  const resume = await invocation(token + "-resume");
  assert.deepEqual(resume.args, ["--resume", token + "-resume"]);
  console.log(process.platform, terminal, "round", round, "all three Obsidian entry points passed");
} finally {
  ws.close();
}
