// Agent Deck — macOS menu bar bridge.
//
// Obsidian plugins cannot add an NSStatusItem directly, so the plugin compiles a
// tiny Swift helper on first use. The helper is an LSUIElement app with a status
// item and a SwiftUI popover. It reads a JSON snapshot written by this plugin and
// opens the same deeplinks as the dashboard.

import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { execFile, spawn } from "child_process";
import source from "./menubar.swift";
import { agentImageBuffer } from "./agent-assets.js";
import { t } from "./i18n.js";

const fsp = fs.promises;
const home = () => os.homedir();

// The Swift helper compiles its Chinese literals into the binary and looks each
// one up through L(). These are the keys it can ask for, so the plugin pushes
// the current language's text along with every snapshot.
const LABEL_KEYS = [
  "等待 Agent Deck…",
  "在跑", "等你", "安静", "等你允许", "出错", "限额", "完成", "最近", "空闲",
  "{n} 个 NEEDOK? 需要你允许",
  "现在没有要显示的会话",
  "主力 Agent 的会话会留在这里；其它 Agent 只在正在运行时出现，WorkBuddy 的等待会话也列。",
  "主力 AGENT", "全量追踪", "其它 AGENT", "在跑 · WorkBuddy 等你",
  "等待 Agent 会话", "共 {n} 个 · 向下滑动", "点击卡片跳转",
  "打开面板", "重新扫描", "隐藏", "跑", "等",
];

function menuLabels() {
  const out = {};
  for (const key of LABEL_KEYS) out[key] = t(key);
  return out;
}

const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>AgentDeckMenuBar</string>
<key>CFBundleDisplayName</key><string>Agent Deck</string>
<key>CFBundleIdentifier</key><string>com.matsurimw.agentdeck.menubar</string>
<key>CFBundleExecutable</key><string>AgentDeckMenuBar</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>0.2.0</string>
<key>CFBundleShortVersionString</key><string>0.2.0</string>
<key>LSUIElement</key><true/>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
`;

export class MenuBarBridge {
  constructor(plugin) {
    this.plugin = plugin;
    this.dir = path.join(home(), ".agent-deck");
    this.appPath = path.join(this.dir, "AgentDeckMenuBar.app");
    this.binPath = path.join(this.appPath, "Contents", "MacOS", "AgentDeckMenuBar");
    this.infoPath = path.join(this.appPath, "Contents", "Info.plist");
    this.srcPath = path.join(this.dir, "AgentDeckMenuBar.swift");
    this.statePath = path.join(this.dir, "menubar.json");
    this.pidPath = path.join(this.dir, "menubar.pid");
    this.hashPath = path.join(this.dir, "menubar.sha");
    this.timer = null;
    this.lastJson = "";
    this.disabled = false;
    this.starting = null;
  }

  get enabled() { return process.platform === "darwin" && this.plugin.settings.showMenuBar !== false; }

  isAlive() {
    try {
      const pid = Number(fs.readFileSync(this.pidPath, "utf8").trim());
      if (pid > 0) { process.kill(pid, 0); return true; }
    } catch { /* not running */ }
    return false;
  }

  async start() {
    if (!this.enabled) return;
    if (this.timer && this.isAlive()) { this.update(true); return; }
    if (this.starting) return this.starting;
    this.starting = this._start().catch(async (e) => {
      console.error("[agent-deck] menu bar", e);
      // 起不来就把开关一起关掉，免得设置里亮着、菜单栏却没有图标
      this.plugin.settings.showMenuBar = false;
      this.plugin.settingTab?.mbSwitch?.setOn(false);
      try { await this.plugin.saveSettings(); } catch { /* 下次再存 */ }
      this.plugin.notice(t("macOS 菜单栏启动失败，已把开关关上：{error}", { error: (e && e.message) || e }), 12000);
    }).finally(() => { this.starting = null; });
    return this.starting;
  }

  // 官方 App 图标给 SwiftUI 用：和 main.js 里嵌的是同一份 PNG
  writeAgentIcons() {
    const dir = path.join(this.dir, "agents");
    try { fs.mkdirSync(dir, { recursive: true }); } catch { return; }
    for (const id of ["claude", "codex", "workbuddy", "dsh"]) {
      try {
        const buf = agentImageBuffer(id);
        if (buf) fs.writeFileSync(path.join(dir, `${id}.png`), buf);
      } catch { /* 图标写不出去就退回字形 */ }
    }
  }

  async _start() {
    // 上次编译失败留下的 disabled 会让 update() 永远不写状态；重新打开开关就重新试
    this.disabled = false;
    await fsp.mkdir(this.dir, { recursive: true });
    this.writeAgentIcons();
    const hash = crypto.createHash("sha256").update(source).digest("hex").slice(0, 16);
    let oldHash = "";
    try { oldHash = (await fsp.readFile(this.hashPath, "utf8")).trim(); } catch { /* first run */ }
    const hasBinary = fs.existsSync(this.binPath);
    if (!hasBinary || oldHash !== hash) {
      await this.compile(hash);
    }
    // 编译要几秒；这期间开关被关掉的话，别再把助手拉起来
    if (!this.enabled) return;
    this.update(true);
    this.launch();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.update(), 1800);
  }

  async compile(hash) {
    if (!fs.existsSync("/usr/bin/swiftc")) {
      throw new Error(t("找不到 /usr/bin/swiftc。安装 Xcode Command Line Tools（xcode-select --install）后再试。"));
    }
    this.plugin.notice(t("正在准备 macOS 菜单栏（第一次要编译一个小助手，约几秒）…"), 6000);
    await new Promise((resolve) => this.killExisting(resolve));
    await fsp.mkdir(path.join(this.appPath, "Contents", "MacOS"), { recursive: true });
    await fsp.writeFile(this.srcPath, source, "utf8");
    await fsp.writeFile(this.infoPath, INFO_PLIST, "utf8");
    const tmp = this.binPath + ".new";
    try { await fsp.unlink(tmp); } catch { /* none */ }
    const res = await new Promise((resolve) => {
      const child = spawn("/usr/bin/swiftc", ["-O", "-swift-version", "5", "-framework", "AppKit", "-framework", "SwiftUI", "-framework", "Carbon", "-o", tmp, this.srcPath], { stdio: ["ignore", "pipe", "pipe"] });
      let err = "";
      const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } resolve({ ok: false, err: t("编译超过 90 秒") }); }, 90000);
      child.stdout.on("data", () => {});
      child.stderr.on("data", (b) => { err += b.toString(); if (err.length > 8000) err = err.slice(-8000); });
      child.on("error", (e) => { clearTimeout(timer); resolve({ ok: false, err: String(e && e.message || e) }); });
      child.on("close", (code) => { clearTimeout(timer); resolve({ ok: code === 0, err }); });
    });
    if (!res.ok) {
      this.disabled = true;
      throw new Error((res.err || t("swiftc 编译失败")).slice(0, 700));
    }
    try { await fsp.unlink(this.binPath); } catch { /* none */ }
    await fsp.rename(tmp, this.binPath);
    await fsp.writeFile(this.hashPath, hash, "utf8");
  }

  launch() {
    this.lastLaunch = Date.now();
    const args = ["-n", "-g", this.appPath, "--args", "--state", this.statePath, "--parent", String(process.pid), "--pidfile", this.pidPath];
    // 等 pkill 跑完再 open：两个都是异步的，抢跑时 pkill 会把刚起来的新助手一起杀掉，图标就没了
    this.killExisting(() => {
      if (!this.enabled) return;
      try { execFile("/usr/bin/open", args, () => {}); } catch (e) { console.error("[agent-deck] launch menu bar", e); }
    });
  }

  killExisting(done) {
    try {
      const pid = Number(fs.readFileSync(this.pidPath, "utf8").trim());
      if (pid > 0) { try { process.kill(pid, "SIGTERM"); } catch { /* gone */ } }
    } catch { /* no pid */ }
    // A plugin reload can leave an older helper behind even when the pid file
    // already points at the newest one. Kill every helper using this exact binary.
    try { fs.unlinkSync(this.pidPath); } catch { /* none */ }
    // 只认助手本身（路径后面跟空格或结尾）：不加边界的话，编译时 swiftc 的 -o …AgentDeckMenuBar.new 也会被匹配、被杀
    const pattern = this.binPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "( |$)";
    try { execFile("/usr/bin/pkill", ["-f", pattern], () => done && done()); } catch { done && done(); }
  }

  show() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(path.join(this.dir, "show-panel"), String(Date.now()), "utf8");
    } catch (e) {
      console.error("[agent-deck] menu bar show", e);
    }
  }

  update(force = false) {
    if (!this.enabled || this.disabled) return;
    try {
      // 助手被杀或崩了就拉回来。以前这句在「状态没变就返回」之后，空闲时图标消失了也不会补
      if (this.timer && !this.isAlive() && Date.now() - (this.lastLaunch || 0) > 10000) this.launch();
      const { updatedAt, ...rest } = this.plugin.buildMenuBarState();
      const body = JSON.stringify(rest);
      if (!force && body === this.lastJson) return;
      this.lastJson = body;
      const json = JSON.stringify({ updatedAt, ...rest, labels: menuLabels() });
      const tmp = this.statePath + ".tmp";
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(tmp, json, "utf8");
      fs.renameSync(tmp, this.statePath);
    } catch (e) { console.error("[agent-deck] menu bar state", e); }
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.killExisting();
  }

  async restart() {
    this.stop();
    this.disabled = false;
    this.lastJson = "";
    await this.start();
  }
}
