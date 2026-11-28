import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as wait } from "node:timers/promises";

const q = process.argv[2];
const vaultName = "Agent Deck QA";
const vault = path.join(q, vaultName);
const codexHome = process.env.CODEX_HOME;
fs.mkdirSync(codexHome, { recursive: true });
const db = new DatabaseSync(path.join(codexHome, "state_10.sqlite"));
db.exec(`
  PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY, name TEXT, title TEXT, first_user_message TEXT, archived INTEGER, updated_at INTEGER
  );
  PRAGMA wal_checkpoint(TRUNCATE);
  INSERT OR REPLACE INTO threads VALUES ('qa-wal', 'SQLite 正式标题', '原始任务', '原始任务', 1, 1760000000);
`);
fs.writeFileSync(path.join(codexHome, "session_index.jsonl"),
  "\uFEFF" + JSON.stringify({id:"qa-jsonl",thread_name:"JSONL 正式标题",updated_at:"2026-01-01T00:00:00Z"}) + "\r\n");

let target;
for (let i = 0; i < 90 && !target; i++) {
  try {
    const pages = await (await fetch("http://127.0.0.1:9241/json/list")).json();
    target = pages.find(t => t.type === "page" && t.title.includes(vaultName) && !t.title.startsWith("Settings -"));
  } catch {}
  if (!target) await wait(500);
}
assert.ok(target, "isolated Obsidian page missing");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once:true });
  ws.addEventListener("error", reject, { once:true });
});
let seq = 0;
function evaluate(expression) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    function response(event) {
      const msg = JSON.parse(event.data);
      if (msg.id !== id) return;
      cleanup();
      if (msg.error || msg.result?.exceptionDetails) {
        reject(new Error(msg.result?.exceptionDetails?.exception?.description || msg.error?.message || "evaluation failed"));
      } else resolve(msg.result.result.value);
    }
    function cleanup() {
      clearTimeout(timer);
      ws.removeEventListener("message", response);
    }
    const timer = setTimeout(() => { cleanup(); reject(new Error("evaluation timed out")); }, 35000);
    ws.addEventListener("message", response);
    ws.send(JSON.stringify({id, method:"Runtime.evaluate", params:{expression,returnByValue:true,awaitPromise:true}}));
  });
}
const failures = [];
async function check(name, fn) {
  try {
    const evidence = await fn();
    console.log("PASS", process.platform, name, JSON.stringify(evidence ?? true));
  } catch (error) {
    failures.push(name);
    console.error("FAIL", process.platform, name, error.stack);
  }
}
const appRun = (fn, args = null) => evaluate("(" + fn.toString() + ")(" + JSON.stringify(args) + ")");
let ready = false;
try {
  for (let i = 0; i < 60 && !ready; i++) {
    ready = await appRun(async () => {
      if (window.app?.vault?.getName() !== "Agent Deck QA" || !app.workspace.layoutReady) return false;
      if (!app.plugins.plugins["agent-deck"]) {
        await app.plugins.loadManifests();
        if (!app.plugins.manifests["agent-deck"]) throw Error("candidate not installed in scratch vault");
        await app.plugins.setEnable(true);
        await app.plugins.enablePluginAndSave("agent-deck");
      }
      const plugin = app.plugins.plugins["agent-deck"];
      await plugin._usageReady;
      window.qa = {
        p: plugin,
        wait: ms => new Promise(r => setTimeout(r, ms)),
        required: (value, what) => { if (!value) throw Error(what); return value; },
        async write(name, text) {
          for (const d of name.split("/").slice(0,-1).reduce((out, p) => [...out, out.length ? out.at(-1) + "/" + p : p], [])) {
            if (!app.vault.getAbstractFileByPath(d)) await app.vault.createFolder(d);
          }
          const existing = app.vault.getAbstractFileByPath(name);
          return existing ? (await app.vault.modify(existing, text), existing) : app.vault.create(name, text);
        },
        async until(fn, what) {
          for (let i = 0; i < 70; i++) {
            const hit = await fn();
            if (hit) return hit;
            await this.wait(90);
          }
          throw Error(what);
        }
      };
      return true;
    });
    if (!ready) await wait(350);
  }
  assert.ok(ready, "isolated Agent Deck did not initialize");
  console.log("RUNTIME", await appRun(() => {
    const runtime = require("process");
    let sqlite = "";
    try { sqlite = typeof require("node:sqlite").DatabaseSync; } catch (e) { sqlite = e.code || e.message; }
    return {platform:runtime.platform,node:runtime.versions.node,electron:runtime.versions.electron,sqlite};
  }));

  await check("Codex title from a live SQLite WAL and BOM JSONL", async () => {
    const titles = await appRun(async () => {
      await qa.p.usage.readCodexTitles({ force:true });
      await qa.p.usage.readCodexArchived({ force:true });
      return ["qa-wal","qa-jsonl"].map(id => qa.p.usage.titles.get(id) ?? null);
    });
    assert.deepEqual(titles, ["SQLite 正式标题", "JSONL 正式标题"]);
    return titles;
  });

  await check("Spiral mirror updates the indexed source safely and idempotently", async () => {
    const name = "项目 QA/源任务.md";
    const source = "# 原稿\r\n\r\n```md\r\n- TODO 围栏示例 ^ad-qamirror1\r\n```\r\n\r\n- TODO 原任务进度 25% ^ad-qamirror1\r\n";
    const changes = await appRun(async ({name,source}) => {
      await qa.write(name, source);
      await qa.write("镜像.md", "- ![[项目 QA/源任务#^ad-qamirror1]]\n");
      const ref = await qa.until(() => qa.p.resolveMirrorLine("- ![[项目 QA/源任务#^ad-qamirror1]]", "镜像.md"), "Obsidian link resolution failed");
      qa.required(ref.rawLine.includes("25%"), "wrong source line");
      const mutate = line => line.replace("TODO", "DOING");
      const first = await qa.p.updateMirrorBlock(ref, mutate);
      const second = await qa.p.updateMirrorBlock(ref, mutate);
      return [first.changed,second.changed,ref.path];
    }, {name,source});
    assert.deepEqual(changes, [true, false, name]);
    assert.equal(fs.readFileSync(path.join(vault,name),"utf8"), source.replace("TODO 原任务","DOING 原任务"));
    return changes;
  });

  await check("journal setup modal, template variables, AI anchor and repeat creation", async () => {
    const result = await appRun(async () => {
      const {p,wait,until,required} = qa;
      const day = p.autoLog.dayKey();
      const targetPath = p.autoLog.journalPath(day);
      const current = () => document.querySelector(".ad-jsetup");
      const defer = p.promptJournalPolicyIfNeeded({day,targetPath,manualTrigger:true});
      (await until(() => current()?.querySelector(".ad-modalfoot button"),"daily setup did not open")).click();
      const dismissed = await defer;
      required(dismissed.dismissed && !app.vault.getAbstractFileByPath(targetPath), "deferring created the journal");
      await p.updateJournalPolicy({ configured:false, mode:"manual", aiPlacement:"bottom" });
      const configure = p.promptJournalPolicyIfNeeded({day,targetPath,manualTrigger:true});
      const modal = await until(current,"daily setup did not reopen");
      modal.querySelector(".ad-jsetup__choice").click();
      modal.querySelectorAll(".ad-jsetup__seg")[0].querySelectorAll("button")[2].click();
      const input = required(modal.querySelector(".ad-jsetup__textarea"),"custom template input missing");
      input.value = "---\n类别: 原稿\n---\n# {{title}}\n\n日期 {{date:YYYY-MM-DD}}\n\n## AI 区域\n{{ai}}\n\n## 手写\n正文保留\n";
      input.dispatchEvent(new input.ownerDocument.defaultView.Event("input",{bubbles:true}));
      await wait(100);
      required(modal.querySelector(".ad-modalfoot .ad-btn--primary"),"save missing").click();
      const config = await configure;
      required(config.policy.aiPlacement === "placeholder", "custom AI placeholder not selected");
      const file = required(await p.autoLog.createJournal(day), "journal not created");
      await app.vault.append(file,"\n后加手写正文\n");
      await p.autoLog.createJournal(day);
      return {path:file.path,text:await app.vault.read(file)};
    });
    assert.match(result.text,/^---\n类别: 原稿\n---\n# [^\n]+/);
    assert.match(result.text,/日期 \d{4}-\d{2}-\d{2}/);
    assert.match(result.text,/## AI 区域\n\{\{ai\}\}[\s\S]+后加手写正文/);
    return result.path;
  });

  await check("memory graph in Obsidian, source toggle, empty filter and zoom", async () => {
    return appRun(async () => {
      const {p,write,until,required} = qa;
      await write("记忆来源.md", "# 来源\n");
      let src = await p.dreaming.createEntry({text:"原生客户端检查 记忆",kind:"fact",date:"2026-11-28",sources:["[[记忆来源]]"],verified:true});
      required(src,"memory source file not written");
      let leaf = app.workspace.getLeavesOfType("agent-deck-memory-graph")[0];
      if (!leaf) await p.openMemoryGraph();
      leaf = await until(() => app.workspace.getLeavesOfType("agent-deck-memory-graph")[0], "memory graph tab missing");
      const view = leaf.view;
      await view.refresh({fit:true});
      const content = view.contentEl;
      required(content.querySelector("canvas").getContext("2d"),"canvas did not initialize");
      required(view.model.nodes.some(n => n.nodeType === "memory"),"stored memory not displayed");
      if (!view.includeSources) {
        required(view._filterPills.find(p => p.key === "includeSources")?.el,"sources button missing").click();
      }
      const srcNode = required(view.model.nodes.find(n => n.nodeType === "source"),"source note node missing");
      const search = content.querySelector(".ad-mem-graph__search");
      search.value = "zzz_0_hits_zzz";
      search.dispatchEvent(new search.ownerDocument.defaultView.Event("input",{bubbles:true}));
      required(view.model.nodes.length === 0,"search did not narrow to zero");
      const reset = [...content.querySelectorAll("button")].find(b => /重置筛选|Reset filters/i.test(b.textContent));
      required(reset,"reset after zero results missing").click();
      required(view.model.nodes.some(n => n.nodeType === "memory"),"reset did not restore nodes");
      const zoom = [...content.querySelectorAll(".ad-mem-graph__zoombtn")].find(b => b.textContent === "+");
      required(zoom,"zoom button missing").click();
      return {nodes:view.model.nodes.length, source:srcNode.path};
    });
  });

  await check("five settings tabs and actual HTTP summary preview", async () => {
    const requests = [];
    const server = createServer(async (req,res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      requests.push({url:req.url,body:JSON.parse(raw)});
      res.writeHead(200,{"Content-Type":"application/json"});
      res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({kind:"code",task:"适配测试",result:"原生摘要回执 QAPREVIEW"})}}]}));
    });
    await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
    try {
      const result = await appRun(async (port) => {
        Object.assign(qa.p.settings,{autoLogProvider:"api",autoLogApiUrl:"http://127.0.0.1:"+port+"/v1",autoLogModel:"qa-model",autoLogApiKey:"",roundPolish:true,conclusionStyle:"custom",conclusionPromptTemplate:"QACUSTOM {{task}}\n{{reply}}"});
        app.setting.open();
        app.setting.openTabById("agent-deck");
        try {
          const el = await qa.until(() => app.setting.activeTab?.containerEl?.querySelector(".ad-set-tab") && app.setting.activeTab.containerEl,"settings page missing");
          const tabs = [...el.querySelectorAll(".ad-set-tab")];
          qa.required(tabs.length === 5,"expected five settings tabs");
          tabs[1].click();
          const btn = [...el.querySelectorAll("button")].find(b => /用样例试跑总结|sample.*preview|preview.*sample|run.*sample/i.test(b.textContent));
          qa.required(btn,"summary preview action missing").click();
          return await qa.until(() => el.textContent.match(/原生摘要回执 QAPREVIEW|试跑失败[^\n]*/) ?. [0], "summary preview output missing");
        } finally { app.setting.close(); }
      }, server.address().port);
      assert.equal(result,"原生摘要回执 QAPREVIEW");
      assert.equal(requests.length,1);
      assert.equal(requests[0].url,"/v1/chat/completions");
      assert.equal(requests[0].body.model,"qa-model");
      assert.match(JSON.stringify(requests[0].body.messages),/QACUSTOM/);
      assert.doesNotMatch(JSON.stringify(requests[0].body.messages),/\{\{task\}\}/);
      return result;
    } finally { await new Promise(resolve => server.close(resolve)); }
  });

  await check("installed Memory MCP stdio with 9 or 5 tools from on-disk settings", async () => {
    const dir = path.join(vault,".obsidian","plugins","agent-deck");
    const asset = path.join(dir,"scripts","memory-mcp.mjs");
    const settings = path.join(dir,"data.json");
    const old = fs.readFileSync(settings);
    const config = JSON.parse(old);
    const counts = [];
    try {
      for (const toolsMode of ["all","memory-only"]) {
        config.dream = { ...config.dream, mcp:{ ...config.dream?.mcp, toolsMode, allowWrite:false } };
        fs.writeFileSync(settings,JSON.stringify(config));
        const input = [{jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-03-26"}},{jsonrpc:"2.0",id:2,method:"tools/list",params:{}}];
        const res = spawnSync(process.execPath,[asset,"--vault",vault],{input:input.map(o=>JSON.stringify(o)).join("\n")+"\n",encoding:"utf8",timeout:10000});
        assert.equal(res.status,0,res.stderr || res.error?.message);
        const rows = res.stdout.trim().split("\n").map(JSON.parse);
        assert.equal(rows.find(row=>row.id===1)?.result.serverInfo.name,"agent-deck-memory");
        counts.push(rows.find(row=>row.id===2)?.result.tools.length);
      }
    } finally { fs.writeFileSync(settings,old); }
    assert.deepEqual(counts,[9,5]);
    return counts;
  });

  await check("plugin reload keeps the settings usable", async () => {
    const found = await appRun(async () => {
      await app.plugins.disablePluginAndSave("agent-deck");
      await app.plugins.enablePluginAndSave("agent-deck");
      app.setting.open();
      app.setting.openTabById("agent-deck");
      try {
        return (await qa.until(() => app.setting.activeTab?.containerEl?.querySelectorAll(".ad-set-tab").length,"settings did not reopen"));
      } finally { app.setting.close(); }
    });
    assert.equal(found,5);
    return found;
  });
} finally {
  db.close();
  ws.close();
}
assert.deepEqual(failures, [], "native feature checks failed");
