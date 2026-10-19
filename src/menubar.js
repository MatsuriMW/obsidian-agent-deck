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

const fsp = fs.promises;
const home = () => os.homedir();

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
    this.starting = this._start().catch((e) => {
      console.error("[agent-deck] menu bar", e);
      this.plugin.notice("macOS 菜单栏启动失败：" + (e && e.message || e), 12000);
    }).finally(() => { this.starting = null; });
    return this.starting;
  }

  async _start() {
    await fsp.mkdir(this.dir, { recursive: true });
    const hash = crypto.createHash("sha256").update(source).digest("hex").slice(0, 16);
    let oldHash = "";
    try { oldHash = (await fsp.readFile(this.hashPath, "utf8")).trim(); } catch { /* first run */ }
    const hasBinary = fs.existsSync(this.binPath);
    if (!hasBinary || oldHash !== hash) {
      await this.compile(hash);
    }
    this.update(true);
    this.launch();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.update(), 1800);
  }

  async compile(hash) {
    if (!fs.existsSync("/usr/bin/swiftc")) {
      throw new Error("找不到 /usr/bin/swiftc。安装 Xcode Command Line Tools（xcode-select --install）后再试。");
    }
    this.plugin.notice("正在准备 macOS 菜单栏（第一次要编译一个小助手，约几秒）…", 6000);
    this.killExisting();
    await fsp.mkdir(path.join(this.appPath, "Contents", "MacOS"), { recursive: true });
    await fsp.writeFile(this.srcPath, source, "utf8");
    await fsp.writeFile(this.infoPath, INFO_PLIST, "utf8");
    const tmp = this.binPath + ".new";
    try { await fsp.unlink(tmp); } catch { /* none */ }
    const res = await new Promise((resolve) => {
      const child = spawn("/usr/bin/swiftc", ["-O", "-swift-version", "5", "-framework", "AppKit", "-framework", "SwiftUI", "-o", tmp, this.srcPath], { stdio: ["ignore", "pipe", "pipe"] });
      let err = "";
      const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } resolve({ ok: false, err: "编译超过 90 秒" }); }, 90000);
      child.stdout.on("data", () => {});
      child.stderr.on("data", (b) => { err += b.toString(); if (err.length > 8000) err = err.slice(-8000); });
      child.on("error", (e) => { clearTimeout(timer); resolve({ ok: false, err: String(e && e.message || e) }); });
      child.on("close", (code) => { clearTimeout(timer); resolve({ ok: code === 0, err }); });
    });
    if (!res.ok) {
      this.disabled = true;
      throw new Error((res.err || "swiftc 编译失败").slice(0, 700));
    }
    try { await fsp.unlink(this.binPath); } catch { /* none */ }
    await fsp.rename(tmp, this.binPath);
    await fsp.writeFile(this.hashPath, hash, "utf8");
  }

  launch() {
    this.lastLaunch = Date.now();
    this.killExisting();
    const args = ["-n", "-g", this.appPath, "--args", "--state", this.statePath, "--parent", String(process.pid), "--pidfile", this.pidPath];
    try { execFile("/usr/bin/open", args, () => {}); } catch (e) { console.error("[agent-deck] launch menu bar", e); }
  }

  killExisting() {
    try {
      const pid = Number(fs.readFileSync(this.pidPath, "utf8").trim());
      if (pid > 0) { try { process.kill(pid, "SIGTERM"); } catch { /* gone */ } }
    } catch { /* no pid */ }
    // A plugin reload can leave an older helper behind even when the pid file
    // already points at the newest one. Kill every helper using this exact binary.
    try { execFile("/usr/bin/pkill", ["-f", this.binPath], () => {}); } catch { /* pkill missing */ }
    try { fs.unlinkSync(this.pidPath); } catch { /* none */ }
  }

  update(force = false) {
    if (!this.enabled || this.disabled) return;
    try {
      const state = this.plugin.buildMenuBarState();
      const json = JSON.stringify(state);
      if (!force && json === this.lastJson) return;
      this.lastJson = json;
      const tmp = this.statePath + ".tmp";
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(tmp, json, "utf8");
      fs.renameSync(tmp, this.statePath);
      if (this.timer && !this.isAlive() && Date.now() - (this.lastLaunch || 0) > 10000) this.launch();
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
