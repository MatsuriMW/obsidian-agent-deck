// A stable Markdown snapshot that other agents can read without Obsidian.
import fs from "fs/promises";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { memoryEntries } from "./dream.js";

const exec = promisify(execFile);
export function externalMemoryPath(value) {
  const target = String(value || "").trim().replace(/^~(?=\/)/, os.homedir());
  if (!path.isAbsolute(target) || path.extname(target).toLowerCase() !== ".md") throw new Error("共享目标必须是外部 Markdown 文件的绝对路径");
  return path.normalize(target);
}

export function sharedMemory(text) {
  const lines = text.split("\n");
  for (const e of memoryEntries(text).reverse()) if (e.state !== "有效") lines.splice(e.line, e.end - e.line);
  return "<!-- Agent Deck shared memory: generated snapshot -->\n" +
    "> 由 Agent Deck 长期记忆生成。仅供参考，用户本次明确表达优先；待验证规律不是事实。来源链接指向原 Obsidian 库。请在原长期记忆笔记中修改，再同步到此文件。\n\n" + lines.join("\n").trim() + "\n";
}

export class DreamSharing {
  constructor(plugin, readMemory) { this.plugin = plugin; this.readMemory = readMemory; this.busy = false; this.status = ""; }
  get cfg() { return this.plugin.settings.dream.share; }
  async tick() {
    const c = this.cfg;
    const hours = Math.max(1, Number(c.intervalHours) || 24);
    const interval = c.lastError ? Math.min(hours, 1) : hours;
    if (!c.enabled || this.busy || Date.now() - (c.lastAttempt || 0) < interval * 3600000) return;
    await this.sync(false);
  }
  async sync(manual = true) {
    if (this.busy) { if (manual) this.plugin.notice("长期记忆正在共享同步"); return this.task; }
    this.task = this.performSync(manual);
    return this.task;
  }
  async performSync(manual) {
    this.busy = true;
    const c = this.cfg;
    try {
      c.lastAttempt = Date.now();
      this.status = "正在读取长期记忆…";
      await this.plugin.saveSettings();
      const target = externalMemoryPath(c.path), gitPush = c.gitPush;
      const text = await this.readMemory();
      if (typeof text !== "string") throw new Error("还没有长期记忆，请先运行 Dreaming");
      if (this.plugin.vaultPath) {
        const source = path.resolve(this.plugin.vaultPath, this.plugin.settings.dream.path);
        const realTarget = await fs.realpath(target).catch(e => { if (e.code !== "ENOENT") throw e; return target; });
        const realSource = await fs.realpath(source).catch(e => { if (e.code !== "ENOENT") throw e; return source; });
        if (realTarget === realSource) throw new Error("共享目标不能覆盖原长期记忆笔记");
      }
      const git = async (args, cwd = path.dirname(target)) => (await exec("git", ["--literal-pathspecs", ...args], { cwd, timeout: 60000, maxBuffer: 1024 * 1024 })).stdout.trim();
      let root, relative, branch;
      if (gitPush) {
        // Validate the repository before writing. Never stage or commit unrelated files.
        root = await git(["rev-parse", "--show-toplevel"]);
        relative = path.relative(await fs.realpath(root), path.join(await fs.realpath(path.dirname(target)), path.basename(target)));
        if (relative.startsWith(".." + path.sep) || path.isAbsolute(relative) || relative.split(path.sep).includes(".git")) throw new Error("共享文件必须位于 Git 仓库工作区内");
        branch = await git(["symbolic-ref", "--short", "HEAD"], root);
        await git(["remote", "get-url", "origin"], root);
      }
      this.status = "正在写入共享 Markdown…";
      const snapshot = sharedMemory(text);
      const old = await fs.readFile(target, "utf8").catch(e => { if (e.code !== "ENOENT") throw e; return null; });
      if (old !== snapshot) {
        await fs.mkdir(path.dirname(target), { recursive: true });
        const temp = `${target}.${randomUUID()}.tmp`;
        try { await fs.writeFile(temp, snapshot, { flag: "wx" }); await fs.rename(temp, target); }
        finally { await fs.rm(temp, { force: true }); }
      }
      if (gitPush) {
        this.status = "正在提交并推送共享记忆…";
        await git(["add", "--", relative], root);
        const changed = await git(["diff", "--cached", "--name-only", "--", relative], root);
        if (changed) await git(["commit", "--only", "-m", "Update Agent Deck shared memory", "--", relative], root);
        // Retry push even when content is unchanged after a previous network failure.
        await git(["push", "origin", `HEAD:refs/heads/${branch}`], root);
      }
      c.lastSuccess = Date.now(); c.lastError = "";
      this.status = gitPush ? "已同步并推送到 origin 当前分支" : "已同步共享 Markdown";
      await this.plugin.saveSettings();
      if (manual) this.plugin.notice(`${this.status}：${target}`, 7000);
      return target;
    } catch (e) {
      c.lastError = e.message;
      this.status = `共享同步失败：${e.message}`;
      await this.plugin.saveSettings();
      this.plugin.notice(this.status, 8000);
    } finally { this.busy = false; }
  }
}
