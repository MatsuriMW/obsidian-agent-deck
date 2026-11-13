// Agent Deck — the small headless model call used by the journal AI flow.
//
// Sessions are named and matched against journal lines by asking the local
// `claude` CLI in print mode. It uses the CLI's own login, keeps no session
// record, loads no MCP servers and no user hooks, and returns one JSON answer.

import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { t } from "./i18n.js";

const home = () => os.homedir();

function workDir() {
  const dir = path.join(os.tmpdir(), "agent-deck-autolog");
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* temp unavailable */ }
  return dir;
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
    catch (e) { return reject(new Error(t("启动 claude 失败：{msg}", { msg: e.message }))); }
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(t("claude 等了 {n} 秒没回来", { n: timeout }))); }, timeout * 1000);
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(t("启动 claude 失败：{msg}", { msg: e.message }))); });
    child.on("close", (code) => {
      clearTimeout(timer);
      let d;
      try { d = JSON.parse(out); } catch { return reject(new Error((err || out || t("claude 退出码 {code}", { code })).trim().slice(0, 300))); }
      if (d.is_error) return reject(new Error(String(d.result || t("claude 返回错误")).slice(0, 300)));
      resolve(String(d.result || ""));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });
}

// Codex 只做一次整理，不落会话日志，避免把整理本身再次记进日记。
export async function runCodex(prompt, { bin = "codex", model = "", effort = "low", timeout = 120 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-deck-codex-"));
  const output = path.join(dir, "answer.txt");
  try {
    return await new Promise((resolve, reject) => {
      const args = ["exec", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check", "--sandbox", "read-only", "--color", "never", "--disable", "shell_tool", "-c", 'web_search="disabled"', "-c", 'features.multi_agent=false', "-c", `model_reasoning_effort=${JSON.stringify(effort)}`, "--output-last-message", output];
      if (model) args.push("--model", model);
      args.push("-");
      const env = { ...process.env, PATH: [path.join(home(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", process.env.PATH || ""].join(":") };
      const child = spawn(bin, args, { cwd: dir, env, stdio: ["pipe", "ignore", "pipe"] });
      let err = "";
      child.stderr.on("data", (d) => { err = (err + d).slice(-2000); });
      const timer = setTimeout(() => { child.kill(); reject(new Error(t("codex 等了 {n} 秒没回来", { n: timeout }))); }, timeout * 1000);
      child.on("error", (e) => { clearTimeout(timer); reject(new Error(t("启动 codex 失败：{msg}", { msg: e.message }))); });
      child.stdin.on("error", () => {});
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error((err || t("codex 退出码 {code}", { code })).trim().slice(-500)));
        try {
          const answer = fs.readFileSync(output, "utf8").trim();
          if (!answer) throw new Error(t("codex 没有返回文字"));
          resolve(answer);
        } catch (e) { reject(e); }
      });
      child.stdin.end("仅整理下列文字，直接输出要求的结果，不调用工具。\n\n" + prompt);
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

export function runJournalModel(prompt, cfg, { polish = false } = {}) {
  const codex = cfg.autoLogProvider === "codex";
  const model = (polish && String(cfg.roundPolishModel || "").trim()) || cfg.autoLogModel || (codex ? "" : "haiku");
  const timeout = polish ? Math.max(5, Number(cfg.roundPolishTimeout) || 30) : Math.max(10, Number(cfg.autoLogTimeout) || 120);
  if (codex) return runCodex(prompt, { bin: cfg.autoLogPath || cfg.delegate?.codex?.path || "codex", model, effort: cfg.autoLogEffort || "low", timeout });
  return runClaude(prompt, { bin: cfg.autoLogPath || cfg.delegate?.claude?.path || "claude", model, timeout, system: polish ? "你是整理助手，按要求只输出一句话。" : "" });
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
