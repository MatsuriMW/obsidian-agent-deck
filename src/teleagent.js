// TeleAgent（星辰超级智能体）本地数据目录探测。只读：不启动客户端、不写库、不发网络请求。
//
// 内核是 OpenCode 派生的 Go 二进制（runtimes/super-agent-code/bin/TeleAgent），
// 它按 SUPER_AGENT_APP_DATA_DIR / SUPER_AGENT_APP_CONFIG_DIR 定位数据与配置目录。
// 这两个变量由 Electron 主进程注入给内核子进程，Obsidian 自己的进程环境里通常是空的，
// 所以「环境变量优先、平台默认路径兜底」两段都要走。
import fs from "fs";
import os from "os";
import path from "path";

const slashes = (value) => String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");

// 数据根目录。顺序：SUPER_AGENT_APP_DATA_DIR → <LOCALAPPDATA>/TeleAgent（仅当里面有 users/）→ ~/.local/share/TeleAgent
export function teleAgentHome(env = process.env, platform = process.platform, homeDir = os.homedir()) {
  const explicit = slashes(env.SUPER_AGENT_APP_DATA_DIR || "");
  if (explicit) return explicit;
  const fallback = slashes(path.join(homeDir, ".local", "share", "TeleAgent"));
  const candidates = [];
  if (platform === "win32") {
    const localAppData = slashes(env.LOCALAPPDATA || "");
    if (localAppData) candidates.push(`${localAppData}/TeleAgent`);
  }
  candidates.push(fallback);
  for (const dir of candidates) {
    try {
      if (fs.existsSync(`${dir}/users`)) return dir;
    } catch { /* next candidate */ }
  }
  return fallback;
}

// 多账号：current-owner.json 给出当前账号的 ownerDir，其余账号也一起读（换过账号的会话不该消失）。
export function teleAgentOwners(homeDir) {
  const root = slashes(homeDir);
  const out = [];
  const push = (name) => {
    const owner = String(name || "").trim();
    if (!owner || owner.includes("/") || owner.includes("\\") || owner.startsWith(".")) return;
    if (!out.includes(owner)) out.push(owner);
  };
  try {
    const current = JSON.parse(fs.readFileSync(`${root}/current-owner.json`, "utf8"));
    push(current?.ownerDir || current?.owner_dir);
  } catch { /* 没有 owner 文件就只扫 users/ */ }
  try {
    for (const entry of fs.readdirSync(`${root}/users`, { withFileTypes: true })) {
      if (entry.isDirectory()) push(entry.name);
    }
  } catch { /* 没装或还没有账号 */ }
  return out;
}

// 每个账号一个 teleagent.db；只返回真实存在的文件，当前账号排在最前。
export function teleAgentDatabases({ env = process.env, platform = process.platform, homeDir = os.homedir() } = {}) {
  const root = teleAgentHome(env, platform, homeDir);
  const out = [];
  for (const owner of teleAgentOwners(root)) {
    const db = `${root}/users/${owner}/teleagent.db`;
    try {
      if (fs.existsSync(db) && fs.statSync(db).isFile() && !out.includes(db)) out.push(db);
    } catch { /* next owner */ }
  }
  return out;
}
