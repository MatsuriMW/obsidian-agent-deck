import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { register } from "node:module";
import esbuild from "esbuild";

import { AGENT_ORDER, DEFAULTS, deepMerge } from "../src/constants.js";
import {
  detectInstalledHarnesses,
  applyHarnessDetection,
  pickDefaultDelegateTarget,
  HARNESS_DETECTION_VERSION,
} from "../src/harness-detect.js";

function mkTree(root, files = [], dirs = []) {
  for (const d of dirs) fs.mkdirSync(path.join(root, d), { recursive: true });
  for (const f of files) {
    const p = path.join(root, f);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "");
  }
}

class Element {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.options = options;
    this.text = options.text || "";
    this.children = [];
    this.dataset = { ...(options.attr?.["data-agent"] ? { agent: options.attr["data-agent"] } : {}) };
    this.style = { setProperty() {} };
    this.classes = new Set((options.cls || "").split(/\s+/).filter(Boolean));
    this.attrs = { ...(options.attr || {}) };
    this.classList = {
      add: (...v) => v.forEach((x) => this.classes.add(x)),
      remove: (...v) => v.forEach((x) => this.classes.delete(x)),
      contains: (v) => this.classes.has(v),
      toggle: (v, on) => (on ? this.classes.add(v) : this.classes.delete(v)),
    };
    this.open = false;
    this.isConnected = true;
    this.events = {};
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  setAttr(k, v) { this.attrs[k] = v; }
  addClass(...v) { this.classList.add(...v); }
  removeClass(...v) { this.classList.remove(...v); }
  toggleClass(v, on) { this.classList.toggle(v, on); }
  empty() { this.children = []; }
  appendChild(el) {
    if (el.parentElement) el.parentElement.children = el.parentElement.children.filter((c) => c !== el);
    el.parentElement = this;
    this.children.push(el);
    return el;
  }
  createEl(tag, options) { return this.appendChild(new Element(tag, options)); }
  createDiv(options) { return this.createEl("div", options); }
  createSpan(options) { return this.createEl("span", options); }
  addEventListener(name, fn) { this.events[name] = fn; }
  querySelector(sel) {
    if (sel === ":scope > .ad-row__right") return this.children.find((c) => c.classList.contains("ad-row__right"));
    if (sel === ":scope > .ad-row__left") return this.children.find((c) => c.classList.contains("ad-row__left"));
    if (sel.startsWith(".")) return this.all().find((el) => el !== this && el.classList.contains(sel.slice(1)));
    return null;
  }
  querySelectorAll(sel) {
    if (sel.startsWith(".")) return this.all().filter((el) => el !== this && el.classList.contains(sel.slice(1)));
    return [];
  }
  closest(sel) { return sel.startsWith(".") && this.classList.contains(sel.slice(1)) ? this : this.parentElement?.closest?.(sel); }
  contains(el) { return this.all().includes(el); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 30 }; }
  focus() { this.focused = true; }
  all() { return [this, ...this.children.flatMap((c) => c.all())]; }
}

test("detectInstalledHarnesses isolates home/apps/PATH, detects DSH+WorkBuddy, and avoids false positives on bare Claude.app", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ad-detect-"));
  try {
    const homeDir = path.join(tmp, "home");
    const appDir = path.join(tmp, "apps");
    const binDir = path.join(tmp, "bin");
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(appDir, { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });

    // Empty machine: none detected
    const empty = detectInstalledHarnesses({ homeDir, appDirs: [appDir], pathEntries: [binDir], env: { PATH: binDir }, platform: "darwin" });
    assert.deepEqual(empty.installed, []);
    assert.equal(empty.missing.length, AGENT_ORDER.length);

    // Chat-only Claude.app must NOT falsely enable Claude Code; install only WorkBuddy.app and ~/.dsh/sessions
    mkTree(appDir, [], ["Claude.app", "WorkBuddy.app"]);
    mkTree(homeDir, [], [".dsh/sessions"]);

    const res = detectInstalledHarnesses({ homeDir, appDirs: [appDir], pathEntries: [binDir], env: { PATH: binDir }, platform: "darwin" });
    assert.deepEqual(res.installed, ["workbuddy", "dsh"]);
    assert.equal(res.detected.claude, false);
    assert.equal(res.detected.codex, false);
    assert.equal(res.detected.workbuddy, true);
    assert.equal(res.detected.dsh, true);
    assert.deepEqual(res.details.workbuddy.via, ["app"]);
    assert.deepEqual(res.details.dsh.via, ["data"]);

    // Adding `claude` CLI binary enables claude
    mkTree(binDir, ["claude"]);
    const withClaude = detectInstalledHarnesses({ homeDir, appDirs: [appDir], pathEntries: [binDir], env: { PATH: binDir }, platform: "darwin" });
    assert.equal(withClaude.detected.claude, true);
    assert.ok(withClaude.details.claude.via.includes("cli"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("detectInstalledHarnesses supports Windows binaries (.exe/.cmd), Scoop/pnpm shims, and LocalAppData directories", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ad-detect-win-"));
  try {
    const homeDir = path.join(tmp, "user");
    const programs = path.join(tmp, "Programs");
    const binDir = path.join(tmp, "bin");
    const localAppData = path.join(tmp, "Local");
    const appData = path.join(tmp, "Roaming");
    mkTree(binDir, ["codex.cmd"]);
    mkTree(programs, ["Qoder/Qoder.exe"]);
    mkTree(homeDir, [".hermes/state.db", "scoop/shims/dsh.cmd"]);
    mkTree(localAppData, ["WorkBuddy/WorkBuddy.exe"]);

    const res = detectInstalledHarnesses({
      homeDir,
      appDirs: [programs],
      pathEntries: [binDir],
      env: { PATH: binDir, APPDATA: appData, LOCALAPPDATA: localAppData },
      platform: "win32",
    });
    assert.equal(res.detected.codex, true);
    assert.equal(res.detected.qoder, true);
    assert.equal(res.detected.hermes, true);
    assert.equal(res.detected.claude, false);

    // Default Windows appDirs & pathEntries also probe %LOCALAPPDATA% directly and scoop/shims.
    const autoWin = detectInstalledHarnesses({
      homeDir,
      env: { PATH: "", APPDATA: appData, LOCALAPPDATA: localAppData },
      platform: "win32",
    });
    assert.equal(autoWin.detected.workbuddy, true);
    assert.equal(autoWin.detected.dsh, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("applyHarnessDetection handles initial install, legacy migration, and re-detection cleanly", () => {
  const detection = {
    detected: Object.fromEntries(AGENT_ORDER.map((id) => [id, id === "dsh" || id === "workbuddy"])),
    installed: ["workbuddy", "dsh"],
    missing: AGENT_ORDER.filter((id) => id !== "dsh" && id !== "workbuddy"),
  };

  // 1. Fresh install
  const fresh = deepMerge(DEFAULTS, {});
  fresh.primaryAgents = [];
  applyHarnessDetection(fresh, { mode: "initial", detection, now: 1000 });
  assert.equal(fresh.agents.claude, false);
  assert.equal(fresh.agents.codex, false);
  assert.equal(fresh.agents.dsh, true);
  assert.equal(fresh.agents.workbuddy, true);
  assert.equal(fresh.autoLogAgents.claude, false);
  assert.equal(fresh.autoLogAgents.dsh, true);
  assert.equal(fresh.delegate.target, "dsh");
  assert.equal(fresh.harnessesDetected.version, HARNESS_DETECTION_VERSION);
  assert.deepEqual(fresh.harnessesDetected.installed, ["workbuddy", "dsh"]);

  // 2. Legacy upgrade: preserves manual off on an installed agent (e.g. cursor), turns off uninstalled CC/Codex
  const legacy = deepMerge(DEFAULTS, {
    primaryAgents: ["claude"],
    primaryAgentsInitialized: true,
    projectTeams: { stewards: { default: { enabled: true, agent: "codex" } } },
  });
  const withCursor = {
    detected: { ...detection.detected, cursor: true },
    installed: ["workbuddy", "dsh", "cursor"],
    missing: detection.missing.filter((id) => id !== "cursor"),
  };
  legacy.agents.cursor = false;
  applyHarnessDetection(legacy, { mode: "migrate", detection: withCursor, now: 2000 });
  assert.equal(legacy.agents.claude, false);
  assert.equal(legacy.agents.codex, false);
  assert.equal(legacy.agents.cursor, false, "manual off on installed agent survives migration");
  assert.equal(legacy.agents.dsh, true);
  assert.deepEqual(legacy.primaryAgents, [], "uninstalled primary is removed");
  assert.equal(legacy.primaryAgentsInitialized, false, "allows re-recommending primaries from installed agents");
  assert.equal(legacy.delegate.target, "dsh");
  assert.equal(legacy.projectTeams.stewards.default.enabled, false);

  // 3. Explicit re-detect syncs all agents to current disk state
  applyHarnessDetection(legacy, { mode: "redetect", detection: withCursor, now: 3000 });
  assert.equal(legacy.agents.cursor, true, "redetect re-enables newly/currently installed harness");
  assert.equal(legacy.autoLogAgents.cursor, true);
  assert.equal(pickDefaultDelegateTarget(legacy, "claude"), "dsh");
});

test("Settings, Sidebar View, and DelegateOptionsModal stay clean when only DSH + WorkBuddy are enabled", async () => {
  register("data:text/javascript," + encodeURIComponent(`
    export async function resolve(s, c, n) {
      if (s.endsWith(".png")) return { url: "data:text/javascript,export default '';", shortCircuit: true };
      if (s.startsWith("@codemirror/")) {
        return { url: "data:text/javascript,export const EditorView={};export const Decoration={};export const WidgetType=class{};export const ViewPlugin={fromClass:()=>({})};export const EditorState={};export const StateEffect={define:()=>({})};export const StateField={define:()=>({})};export const RangeSetBuilder=class{};export const Prec={high:x=>x,low:x=>x};export const syntaxTree=()=>{};export const foldedRanges=()=>{};export const foldEffect={};export const unfoldEffect={};", shortCircuit: true };
      }
      if (s === "obsidian") return {
        url: "data:text/javascript," + encodeURIComponent(\`
          export class App {}
          export class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; } }
          export class ItemView { constructor(leaf) { Object.assign(this, leaf); } }
          export class MarkdownView {}
          export class Component {}
          export const MarkdownRenderer = {};
          export class Notice {}
          export class Modal { constructor(app) { this.app = app; this.contentEl = new globalThis.__TestEl(); this.modalEl = new globalThis.__TestEl(); } open() { return this.onOpen(); } close() { this.onClose?.(); } }
          export class Menu { addItem() { return this; } showAtMouseEvent() {} }
          export function setIcon() {}
        \`),
        shortCircuit: true,
      };
      return n(s, c);
    }
  `));
  globalThis.__TestEl = Element;
  const prevDoc = globalThis.document;
  globalThis.document = { activeElement: null, createElement: (tag) => new Element(tag), createElementNS: (_ns, tag) => new Element(tag) };

  try {
    const { AgentDeckSettingsTab } = await import("../src/settings.js");
    const { AgentDeckView, AgentCardsModal } = await import("../src/view.js");
    const { DelegateOptionsModal } = await import("../src/dialog.js");

    const settings = deepMerge(DEFAULTS, { primaryAgents: ["dsh"] });
    const fakeDetect = {
      detected: Object.fromEntries(AGENT_ORDER.map((id) => [id, id === "dsh" || id === "workbuddy"])),
      details: {},
      installed: ["workbuddy", "dsh"],
      missing: AGENT_ORDER.filter((id) => id !== "dsh" && id !== "workbuddy"),
    };
    applyHarnessDetection(settings, { mode: "initial", detection: fakeDetect });

    let redetects = 0;
    const plugin = {
      settings,
      views: new Set(),
      jobs: {},
      vaultPath: "/vault",
      usage: { meta: new Map(), files: new Map(), errors: [], liveSessions: () => [] },
      store: { days: {}, get: () => null, range: () => [] },
      app: { vault: { getAbstractFileByPath: () => ({ path: "note.md" }) } },
      readNote: async () => "- TODO task line",
      saveSettings: async () => {},
      agentEnabled: (id) => plugin.isPrimary(id) || settings.agents[id] !== false,
      isPrimary: (id) => settings.primaryAgents.includes(id),
      primaryAgents: () => settings.primaryAgents,
      defaultTarget: () => pickDefaultDelegateTarget(settings, settings.delegate.target),
      defaultModel: (id) => settings.delegate?.[id]?.model || "",
      allModels: () => [
        { id: "claude-opus-5-5", agent: "claude", name: "Claude Opus", tags: [] },
        { id: "gpt-6.1-sol", agent: "codex", name: "GPT-6.1 Sol", tags: [] },
        { id: "deepseek-v4-pro", agent: "dsh", name: "DeepSeek V4 Pro", tags: [] },
      ],
      modelsFor: (id) => plugin.allModels().filter((m) => m.agent === id),
      modelById: (id) => plugin.allModels().find((m) => m.id === id) || null,
      modelEnabled: () => true,
      liveSessions: () => [],
      recentSessions: () => [],
      detectedHarnesses: () => fakeDetect,
      redetectHarnesses: () => { redetects++; },
      refreshUI: () => {},
    };

    const tab = new AgentDeckSettingsTab(plugin.app, plugin);
    tab.display = () => {};

    // 1. Delegation page: only DSH + WorkBuddy in target picker, only DSH delegation card, only DSH + WorkBuddy in Manage Models
    const delBody = new Element();
    tab.renderDelegate(delBody);
    const targetBtns = delBody.all().filter((el) => el.classList.contains("ad-settings-target"));
    assert.deepEqual(targetBtns.map((el) => el.dataset.agent), ["workbuddy", "dsh"]);
    const delCards = delBody.all().filter((el) => el.classList.contains("ad-delegate-agent"));
    assert.deepEqual(delCards.map((el) => el.dataset.agent), ["dsh"]);
    const modelGroups = delBody.all().filter((el) => el.classList.contains("ad-modelgroup"));
    assert.deepEqual(modelGroups.map((el) => el.dataset.agent), ["workbuddy", "dsh"]);
    const redetectDel = delBody.all().find((el) => el.tag === "button" && el.text === "重新检测 Harness");
    assert.ok(redetectDel, "Delegation page exposes Re-detect Harnesses button");
    redetectDel.onclick();

    // 2. Recording page: main grid has only WorkBuddy + DSH; disabled 9 tucked in collapsed details; autoLogAgents only shows WorkBuddy + DSH
    const recBody = new Element();
    tab.renderRecord(recBody);
    const mainGrid = recBody.all().find((el) => el.classList.contains("ad-set-agents") && !el.classList.contains("ad-set-agents--disabled"));
    assert.deepEqual(mainGrid.children.map((c) => c.dataset.agent), ["workbuddy", "dsh"]);
    const disabledDetails = recBody.all().find((el) => el.tag === "details" && el.dataset.section === "disabled-agents");
    assert.ok(disabledDetails, "Disabled/uninstalled harnesses are collapsed into a sub-section");
    assert.equal(disabledDetails.open, false);
    const disabledCards = disabledDetails.all().filter((el) => el.classList.contains("ad-set-agent"));
    assert.equal(disabledCards.length, AGENT_ORDER.length - 2);
    assert.ok(disabledCards.some((c) => c.all().some((x) => x.text === "已关闭 · 未检测到")));
    const autoLogBtns = recBody.all().filter((el) => el.parentElement?.classList.contains("ad-seg--many") && ["WorkBuddy", "DSH", "Claude", "Codex"].includes(el.text));
    assert.deepEqual(autoLogBtns.map((b) => b.text), ["WorkBuddy", "DSH"]);
    const redetectRec = recBody.all().find((el) => el.tag === "button" && el.text === "重新检测 Harness");
    assert.ok(redetectRec, "Recording page exposes Re-detect Harnesses button");
    redetectRec.onclick();
    assert.equal(redetects, 2);

    // 3. Sidebar View: only WorkBuddy + DSH cards and filter chips; AgentCardsModal skips disabled harnesses
    const view = new AgentDeckView({ app: plugin.app, contentEl: new Element(), containerEl: { isShown: () => true } }, plugin);
    view.sparkline = () => {};
    view.render();
    assert.deepEqual(view.visibleAgentIds(), ["workbuddy", "dsh"]);
    const filterWrap = view.contentEl.all().find((el) => el.classList.contains("ad-filters"));
    assert.deepEqual(filterWrap.children.map((b) => b.text), ["全部", "在跑", "等你", "WorkBuddy", "DSH"]);
    settings.ui.agentCards.hidden = ["claude", "workbuddy"];
    const cardModal = new AgentCardsModal(view);
    cardModal.onOpen();
    const addRows = cardModal.contentEl.all().filter((el) => el.classList.contains("ad-cardmanager__row"));
    assert.ok(!addRows.some((r) => r.attrs["data-agent"] === "claude"), "disabled agents do not clutter card manager");

    // 4. DelegateOptionsModal: only shows enabled delegable target (DSH)
    const dm = new DelegateOptionsModal(plugin.app, plugin, "note.md", 0);
    await dm.onOpen();
    const dmTargets = dm.contentEl.all().filter((el) => el.classList.contains("ad-target"));
    assert.equal(dmTargets.length, 1);
    assert.ok(dmTargets[0].all().some((c) => c.text === "DSH"));
  } finally {
    delete globalThis.__TestEl;
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
  }
});

test("AgentDeckPlugin.onload auto-detects harnesses off the startup barrier and supports redetectHarnesses", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const source = fs.readFileSync(path.join(root, "src/main.js"), "utf8");
  const stubs = new Map();
  for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g)) {
    const spec = match[2];
    if (["./constants.js", "./readers.js", "./workflow.js", "./attention.js", "./i18n.js", "./harness-detect.js", "./agent-registry.js", "./settings-agents.js"].includes(spec)) continue;
    const exports = match[1].split(",").map((n) => n.trim().split(/\s+as\s+/)[0]).filter(Boolean);
    stubs.set(spec, [
      ...exports.map((n) =>
        n === "Plugin"
          ? "export class Plugin { register(){} registerView(){} addRibbonIcon(){} addSettingTab(){} registerEditorExtension(){} registerMarkdownPostProcessor(){} addCommand(){} registerObsidianProtocolHandler(){} registerInterval(){} }"
          : /^[A-Z]/.test(n)
            ? `export class ${n} { constructor(){ this.runners = new Map(); } hide(){} stop(){} }`
            : `export function ${n}(){}`
      ),
      ...(spec === "./delegation-runners.js" ? ["export function expandedPathEntries(){ return []; }"] : []),
    ].join("\n"));
  }
  const built = await esbuild.build({
    stdin: { contents: "export { default as AgentDeckPlugin } from './src/main.js';", resolveDir: root },
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [{
      name: "ui-only",
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => stubs.has(args.path) ? { path: args.path, namespace: "ui" } : undefined);
        b.onLoad({ filter: /.*/, namespace: "ui" }, (args) => ({ contents: stubs.get(args.path), loader: "js" }));
      },
    }],
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-detect-plugin-"));
  try {
    const modPath = path.join(dir, "plugin.mjs");
    fs.writeFileSync(modPath, built.outputFiles[0].text);
    const { AgentDeckPlugin } = await import(pathToFileURL(modPath));
    const p = new AgentDeckPlugin();
    const notices = [];
    p.app = { vault: { adapter: { getBasePath: () => "/vault" } }, workspace: { onLayoutReady() {} } };
    p.manifest = { id: "agent-deck" };
    p.loadData = async () => null;
    p.saveData = async () => {};
    p.notice = (msg) => notices.push(msg);
    p.setupRibbon = () => {};
    p.refreshUI = () => {};
    p.scanNow = async () => {};
    await p.onload();

    assert.equal(p.settings.harnessesDetected?.version, HARNESS_DETECTION_VERSION);
    for (const id of AGENT_ORDER) {
      assert.equal(typeof p.settings.agents[id], "boolean");
    }

    const res = await p.redetectHarnesses({ scan: false, notify: true });
    assert.ok(Array.isArray(res.installed));
    assert.equal(notices.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("TeleAgent is detected from its data root on Windows (client lives outside Program Files)", () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-teleagent-detect-"));
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-teleagent-detect-app-"));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-teleagent-detect-bin-"));
  const env = {
    PATH: binDir,
    APPDATA: path.join(homeDir, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(homeDir, "AppData", "Local"),
    ProgramFiles: path.join(homeDir, "PF"),
  };
  const scan = () => detectInstalledHarnesses({ homeDir, appDirs: [appDir], pathEntries: [binDir], env, platform: "win32" });

  assert.equal(scan().detected.teleagent, false, "empty machine must not report TeleAgent");

  // 客户端装在 D:\Program Files\TeleClaw\... ，appDirs 探测不到；数据根在 ~/.local/share/TeleAgent。
  mkTree(homeDir, [], [".local/share/TeleAgent/users/owner"]);
  const hit = scan();
  assert.equal(hit.detected.teleagent, true);
  assert.deepEqual(hit.details.teleagent.via, ["data"]);
  assert.ok(hit.installed.includes("teleagent"), "detection must include teleagent for settings sync");

  // 回归点：detection 缺 teleagent 时 applyHarnessDetection 会把它写成 false（1.13.4 合并后曾发生）。
  const settings = deepMerge(DEFAULTS, { agents: { teleagent: true } });
  applyHarnessDetection(settings, { mode: "redetect", detection: hit });
  assert.equal(settings.agents.teleagent, true);
});

test("插件自建目录不能当成‘Agent 已安装’的证据（Cursor 回归）", () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-self-created-"));
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-self-created-app-"));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-self-created-bin-"));
  const env = {
    PATH: binDir,
    APPDATA: path.join(homeDir, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(homeDir, "AppData", "Local"),
    ProgramFiles: path.join(homeDir, "PF"),
  };
  const scan = () => detectInstalledHarnesses({ homeDir, appDirs: [appDir], pathEntries: [binDir], env, platform: "win32" });

  // 只剩插件自己装 hook 时建的目录：Cursor 已卸载，不能算装了
  mkTree(homeDir, ["11111111-2222-3333-4444-555555555555.jsonl"], [".agent-deck/cursor-events", ".agent-deck/hooks"]);
  const afterUninstall = scan();
  assert.equal(afterUninstall.detected.cursor, false, "插件自建的事件目录不能让 Cursor 判为已安装");
  for (const [id, d] of Object.entries(afterUninstall.details)) {
    if (d.data) assert.ok(!d.data.includes(".agent-deck"), `${id} 的安装证据不该落在插件自己的目录里`);
  }

  // 反向：Cursor 自己的状态库还在时仍要识别
  mkTree(homeDir, ["AppData/Roaming/Cursor/User/globalStorage/state.vscdb"]);
  const withCursor = scan();
  assert.equal(withCursor.detected.cursor, true);
  assert.deepEqual(withCursor.details.cursor.via, ["data"]);
});

test("探测规则升级后用 version 触发一次自动重跑（不是只在首次安装时检测）", async () => {
  const settings = deepMerge(DEFAULTS, { agents: { teleagent: false } });
  // 旧版本记录：装过但没跑过新规则
  settings.harnessesDetected = { version: 1, at: 1, installed: [] };
  const detection = { detected: Object.fromEntries(AGENT_ORDER.map((id) => [id, id === "teleagent"])), details: {}, installed: ["teleagent"], missing: [] };
  applyHarnessDetection(settings, { mode: "redetect", detection });
  assert.equal(settings.harnessesDetected.version, HARNESS_DETECTION_VERSION);
  assert.equal(settings.agents.teleagent, true);
  assert.ok(HARNESS_DETECTION_VERSION >= 2, "v2 才补上 TeleAgent 与自建目录剔除");
});
