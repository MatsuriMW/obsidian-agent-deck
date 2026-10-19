// Agent Deck — the small headless model call used by the journal AI flow.
//
// Sessions are named and matched against journal lines by asking the local
// `claude` CLI in print mode. It uses the CLI's own login, keeps no session
// record, loads no MCP servers and no user hooks, and returns one JSON answer.

import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";

const home = () => os.homedir();

function workDir() {
  const dir = path.join(os.tmpdir(), "agent-deck-autolog");
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* temp unavailable */ }
  return dir;
}

export function judgeBin(configured = "") {
  const c = String(configured || "").trim();
  if (c) return c.replace(/^~(?=\/)/, home());
  const spots = [path.join(home(), ".local/bin/claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude", "/usr/bin/claude"];
  return spots.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || "claude";
}

// 一问一答：-p 打完就退，不写会话记录（否则它自己也会被追踪成一个会话），
// 不加载 MCP、个人设置里的钩子和插件；返回它说的那段文字
export function runClaude(prompt, { bin = "claude", model = "haiku", timeout = 120, system = "" } = {}) {
  return new Promise((resolve, reject) => {
    const cwd = workDir();
    const args = ["-p", "--output-format", "json", "--no-session-persistence", "--strict-mcp-config", "--setting-sources", "project", "--tools", "", "--system-prompt", system || "你是一个只输出 JSON 的整理助手。"];
    if (model) args.push("--model", model);
    const env = { ...process.env, PATH: [path.join(home(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", process.env.PATH || ""].join(":") };
    let child;
    try { child = spawn(bin, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] }); }
    catch (e) { return reject(new Error(`启动 claude 失败：${e.message}`)); }
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`claude 等了 ${timeout} 秒没回来`)); }, timeout * 1000);
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(`启动 claude 失败：${e.message}`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      let d;
      try { d = JSON.parse(out); } catch { return reject(new Error((err || out || `claude 退出码 ${code}`).trim().slice(0, 300))); }
      if (d.is_error) return reject(new Error(String(d.result || "claude 返回错误").slice(0, 300)));
      resolve(String(d.result || ""));
    });
    child.stdin.end(prompt);
  });
}

// 模型没装 / 没登录时的兜底名字：从会话标题或用户第一句话里取一段
export function safeLabel(s, max = 40) {
  const t = String(s || "")
    .replace(/[\r\n←`*=~[\]|]/g, " ")
    .replace(/^\s*(?:[-*+]\s+)?(?:TODO|DOING|DONE|SUSPENDED|PAUSED|TOREVIEW|HITLIMIT|NEEDOK|QUEUED|ERRORED|DELEGATED)\s+/i, "")
    .replace(/(\d)[:：](\d)/g, "$1.$2")
    .replace(/\s+/g, " ")
    .replace(/[。；;，,\s]+$/, "")
    .trim();
  const chars = [...t];
  return (chars.length > max ? chars.slice(0, max).join("").trim() + "…" : t).slice(0, max + 1);
}
