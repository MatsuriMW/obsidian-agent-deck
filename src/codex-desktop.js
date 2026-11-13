// Persist the first turn through App Server, release it, then continue in Desktop.
import fs from "fs";
import { spawn } from "child_process";
import { createInterface } from "readline";

export function codexDesktopBinary(configured) {
  if (configured) return configured;
  const bundled = ["/Applications/Codex.app/Contents/Resources/codex", "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex"];
  return bundled.find(p => fs.existsSync(p)) || "codex";
}

export class CodexDesktopRunner {
  constructor(delegator, job, openDesktop) {
    this.d = delegator; this.job = job; this.openDesktop = openDesktop;
    this.pending = new Map(); this.nextId = 0; this.finished = false;
  }
  send(message) { this.child.stdin.write(JSON.stringify(message) + "\n"); }
  request(method, params) {
    if (this.finished) return Promise.reject(new Error("Codex 连接已关闭"));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex ${method} 连接超时`)); }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }
  async start({ prompt }) {
    try {
      const cfg = this.d.settings.delegate.codex;
      this.child = spawn(codexDesktopBinary(cfg.path), ["app-server"], { cwd: this.job.cwd, stdio: ["pipe", "pipe", "pipe"] });
      this.closed = new Promise(resolve => this.child.once("close", resolve));
      this.child.on("error", error => this.finish("error", error.message));
      this.child.stdin.on("error", error => { if (!this.finished) this.finish("error", error.message); });
      this.child.on("exit", code => { if (!this.finished) this.finish("error", `Codex App Server 已退出（${code}）`); });
      // stderr can include diagnostics; keep it bounded and never use it as model output.
      this.child.stderr.on("data", data => { this.job.stderr = ((this.job.stderr || "") + data.toString()).slice(-2000); });
      this.reader = createInterface({ input: this.child.stdout });
      this.reader.on("line", line => {
        try { this.receive(JSON.parse(line)); }
        catch (error) { this.finish("error", `Codex 协议响应无效：${error.message}`); }
      });
      await this.request("initialize", { clientInfo: { name: "agent_deck", version: "1.4.2" }, capabilities: { experimentalApi: true } });
      this.send({ method: "initialized" });
      const result = await this.request("thread/start", {
        model: this.job.model, cwd: this.job.cwd, ephemeral: false,
        sandbox: cfg.sandbox || "workspace-write", approvalPolicy: "on-request",
        config: { model_reasoning_effort: this.job.effort },
      });
      if (!result.thread?.id || result.model !== this.job.model) throw new Error("Codex 未确认指定模型，任务未发送");
      this.job.app = "vscode";
      this.job.state = "running";
      this.d.onSession(this.job, result.thread.id);
      await this.request("thread/name/set", { threadId: result.thread.id, name: this.job.name });
      const started = await this.request("turn/start", {
        threadId: result.thread.id, model: this.job.model, effort: this.job.effort,
        input: [{ type: "text", text: prompt }],
      });
      this.turnId = started.turn?.id;
    } catch (error) { await this.finish("error", error.message); }
  }
  receive(message) {
    const pending = this.pending.get(message.id);
    if (pending) {
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message || "Codex 请求失败"));
      else pending.resolve(message.result);
      return;
    }
    if (this.finished) return;
    if (message.id != null && message.method) {
      this.send({ id: message.id, error: { code: -32601, message: "Agent Deck 首轮不处理交互请求，请在 Codex Desktop 继续" } });
      this.finish("error", "首轮需要审批或交互，请在打开的 Codex Desktop 会话中继续");
      return;
    }
    const params = message.params;
    if (params?.threadId !== this.job.sessionId) return;
    if (message.method === "item/completed" && params.item?.type === "agentMessage") {
      this.job.result = params.item.text || "";
      this.job.lastText = this.job.result.slice(-2000);
    }
    if (message.method === "turn/started") this.turnId = params.turn?.id;
    if (message.method === "turn/completed") {
      if (params.turn?.status === "completed") this.finish("done");
      else this.finish("error", params.turn?.error?.message || `Codex 首轮${params.turn?.status || "未完成"}`);
    }
  }
  async finish(state, error = "") {
    if (this.finished) return;
    this.finished = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(error || "Codex 连接已结束")); }
    this.pending.clear();
    this.job.state = state; this.job.endedAt = Date.now();
    if (error) this.job.error = error.slice(0, 500);
    this.d.saveJobs(); this.d.refreshUI();
    if (this.child) {
      if (state !== "done" && this.job.sessionId && this.turnId) {
        try { this.send({ id: ++this.nextId, method: "turn/interrupt", params: { threadId: this.job.sessionId, turnId: this.turnId } }); } catch { /* already closed */ }
      }
      this.child.stdin.end();
      const kill = setTimeout(() => this.child.kill("SIGTERM"), 1500);
      await this.closed;
      clearTimeout(kill); this.reader?.close();
    }
    // Release the session before Desktop resumes it to avoid concurrent writers.
    if (this.job.sessionId && state !== "cancelled") {
      try { await this.openDesktop(); }
      catch (error) { this.job.desktopError = error.message; this.d.saveJobs(); }
    }
    if (state === "done") await this.d.onDone(this.job);
    else if (state === "error") this.d.onError(this.job);
  }
  cancel() { return this.finish("cancelled"); }
}
