// Pure Node external MCP client auto-detection, surgical install/uninstall, and handshake verification.
// Zero Obsidian / Electron / i18n dependencies. Always backs up existing configs before writing.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mcpSettingsOf } from "./config.js";

export const MCP_SERVER_NAME = "agent-deck-memory";

function defaultHome(homeDir) {
  return homeDir ? path.resolve(homeDir) : os.homedir();
}

function isNodeBinaryFile(filePath, platform = process.platform) {
  if (!filePath) return false;
  const base = path.basename(filePath).toLowerCase();
  if (base !== "node" && base !== "node.exe") return false;
  try {
    if (!fs.statSync(filePath).isFile()) return false;
    if (platform !== "win32") fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function parseSemverTuple(name) {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(String(name || ""));
  return m ? [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)] : null;
}

export function resolveNodeBinary({
  homeDir = "",
  platform = process.platform,
  env = process.env,
  execPath = process.execPath,
} = {}) {
  if (isNodeBinaryFile(execPath, platform)) return execPath;
  const exe = platform === "win32" ? "node.exe" : "node";
  for (const dir of String(env?.PATH || "").split(path.delimiter).filter(Boolean)) {
    const cand = path.join(dir, exe);
    if (isNodeBinaryFile(cand, platform)) return cand;
  }
  const home = defaultHome(homeDir);
  const candidates = [];
  if (platform === "win32") {
    if (env?.NVM_SYMLINK) candidates.push(path.join(env.NVM_SYMLINK, exe));
    if (env?.ProgramFiles) candidates.push(path.join(env.ProgramFiles, "nodejs", exe));
    if (env?.LOCALAPPDATA) candidates.push(path.join(env.LOCALAPPDATA, "Programs", "nodejs", exe));
    candidates.push(path.join(home, "scoop", "shims", exe));
  } else {
    const nvmRoot = path.join(home, ".nvm", "versions", "node");
    try {
      const vers = fs.readdirSync(nvmRoot)
        .map((n) => ({ name: n, semver: parseSemverTuple(n) }))
        .filter((x) => x.semver)
        .sort((a, b) => (b.semver[0] - a.semver[0]) || (b.semver[1] - a.semver[1]) || (b.semver[2] - a.semver[2]));
      for (const v of vers) candidates.push(path.join(nvmRoot, v.name, "bin", exe));
    } catch { /* no nvm */ }
    candidates.push(
      path.join(home, ".volta", "bin", exe),
      path.join(home, ".fnm", "current", "bin", exe),
      path.join(home, ".asdf", "shims", exe),
      path.join(home, ".nodenv", "shims", exe),
      path.join("/opt", "homebrew", "bin", exe),
      path.join("/usr", "local", "bin", exe),
      path.join("/usr", "bin", exe),
    );
  }
  for (const cand of candidates) {
    if (isNodeBinaryFile(cand, platform)) return cand;
  }
  return "";
}

function normPath(p) {
  const s = String(p || "").trim();
  if (!s) return "";
  const clean = path.resolve(s).replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? clean.toLowerCase() : clean;
}

function clientSpecs({ homeDir = "", platform = process.platform, env = process.env, configOverrides = null } = {}) {
  const home = defaultHome(homeDir);
  const codexHome = env?.CODEX_HOME && !homeDir ? path.resolve(env.CODEX_HOME) : path.join(home, ".codex");
  const claudeDesktopPath = platform === "darwin"
    ? path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json")
    : platform === "win32"
      ? path.join(env?.APPDATA && !homeDir ? path.resolve(env.APPDATA) : path.join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json")
      : path.join(home, ".config", "Claude", "claude_desktop_config.json");
  const openCodeDir = env?.XDG_CONFIG_HOME && !homeDir
    ? path.join(path.resolve(env.XDG_CONFIG_HOME), "opencode")
    : path.join(home, ".config", "opencode");
  const dshHome = env?.DSH_HOME && !homeDir ? path.resolve(env.DSH_HOME) : path.join(home, ".dsh");

  const specs = [
    {
      id: "claude-code",
      label: "Claude Code",
      format: "json",
      configPath: path.join(home, ".claude.json"),
      detectPath: path.join(home, ".claude"),
      restartHint: "重开 Claude Code 会话生效",
    },
    {
      id: "codex",
      label: "Codex",
      format: "toml",
      configPath: path.join(codexHome, "config.toml"),
      detectPath: codexHome,
      restartHint: "重开 Codex 会话生效",
    },
    {
      id: "cursor",
      label: "Cursor",
      format: "json",
      configPath: path.join(home, ".cursor", "mcp.json"),
      detectPath: path.join(home, ".cursor"),
      restartHint: "重启 Cursor 或刷新 MCP 生效",
    },
    {
      id: "antigravity",
      label: "Antigravity",
      format: "json",
      configPath: path.join(home, ".gemini", "antigravity", "mcp_config.json"),
      detectPath: path.join(home, ".gemini", "antigravity"),
      restartHint: "刷新 Antigravity MCP 生效",
    },
    {
      id: "claude-desktop",
      label: "Claude Desktop",
      format: "json",
      configPath: claudeDesktopPath,
      detectPath: path.dirname(claudeDesktopPath),
      restartHint: "重启 Claude Desktop 生效",
    },
    {
      id: "gemini-cli",
      label: "Gemini CLI",
      format: "json",
      configPath: path.join(home, ".gemini", "settings.json"),
      detectPath: path.join(home, ".gemini"),
      restartHint: "重开 Gemini CLI 会话生效",
    },
    {
      id: "opencode",
      label: "OpenCode",
      format: "opencode-json",
      configPath: path.join(openCodeDir, "opencode.json"),
      detectPath: openCodeDir,
      altDetectPaths: [path.join(home, ".local", "share", "opencode")],
      restartHint: "重开 OpenCode 会话生效",
    },
    {
      id: "dsh-desktop",
      label: "DeepSeek Harness",
      format: "dsh-cordis-yaml",
      configPath: path.join(dshHome, "profiles", "desktop", "cordis.patch.yml"),
      detectPath: path.join(dshHome, "profiles", "desktop"),
      restartHint: "重启 DeepSeek Harness 生效",
    },
    {
      id: "dsh-acp",
      label: "DeepSeek Harness (ACP)",
      format: "dsh-cordis-yaml",
      configPath: path.join(dshHome, "profiles", "acp", "cordis.patch.yml"),
      detectPath: path.join(dshHome, "profiles", "acp"),
      restartHint: "重开 dsh acp 会话生效",
    },
  ];
  if (configOverrides && typeof configOverrides === "object") {
    for (const spec of specs) {
      if (configOverrides[spec.id]) spec.configPath = path.resolve(configOverrides[spec.id]);
    }
  }
  return specs;
}

function normalizeCfgDir(dir) {
  return String(dir || "").trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
}

function customConfigDirFlag(configDir) {
  return normalizeCfgDir(configDir);
}

export function buildMcpArgs(mcpScript, vaultPath, allowWrite = false, configDir = "") {
  const args = [path.resolve(mcpScript), "--vault", path.resolve(vaultPath)];
  const customCfg = customConfigDirFlag(configDir);
  if (customCfg) args.push("--config-dir", customCfg);
  if (allowWrite) args.push("--allow-write");
  return args;
}

function parseServerArgs(args = []) {
  const list = Array.isArray(args) ? args.map((a) => String(a)) : [];
  let script = list[0] || "";
  let vault = "";
  let configDir = "";
  let allowWrite = false;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a === "--vault" && list[i + 1]) { vault = list[++i]; continue; }
    if (a.startsWith("--vault=")) { vault = a.slice(8); continue; }
    if (a === "--config-dir" && list[i + 1]) { configDir = normalizeCfgDir(list[++i]); continue; }
    if (a.startsWith("--config-dir=")) { configDir = normalizeCfgDir(a.slice(13)); continue; }
    if (a === "--allow-write") allowWrite = true;
  }
  return { script, vault, configDir, allowWrite };
}

function parseTomlStringList(rawArrayText) {
  const out = [];
  const strRe = /"((?:[^"\\]|\\.)*)"|'([^']*)'/g;
  for (const m of String(rawArrayText || "").matchAll(strRe)) {
    if (m[1] !== undefined) {
      try { out.push(JSON.parse(`"${m[1]}"`)); } catch { out.push(m[1]); }
    } else if (m[2] !== undefined) {
      out.push(m[2]);
    }
  }
  return out;
}

function parseTomlSingleString(rawVal) {
  const s = String(rawVal || "").trim();
  if (s.startsWith('"') && s.endsWith('"')) {
    try { return JSON.parse(s); } catch { return s.slice(1, -1); }
  }
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1);
  return s;
}

function parseTomlKeySegments(headerContent) {
  const s = String(headerContent || "").trim();
  const segs = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    const ch = s[i];
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      let key = "";
      while (i < s.length) {
        if (quote === '"' && s[i] === "\\" && i + 1 < s.length) {
          const esc = s[i + 1];
          key += esc === "n" ? "\n" : esc === "t" ? "\t" : esc;
          i += 2;
          continue;
        }
        if (s[i] === quote) { i++; break; }
        key += s[i++];
      }
      segs.push(key);
    } else {
      let key = "";
      while (i < s.length && /[A-Za-z0-9_-]/.test(s[i])) key += s[i++];
      if (!key) return null;
      segs.push(key);
    }
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i < s.length) {
      if (s[i] !== ".") return null;
      i++;
    }
  }
  return segs;
}

function matchTomlServerHeader(line, serverName) {
  const trimmed = String(line || "").trim();
  const hm = /^\[([^\[\]]+)\]\s*(?:#.*)?$/.exec(trimmed);
  if (!hm) return { matched: false, isMain: false };
  const segs = parseTomlKeySegments(hm[1]);
  if (!segs || segs.length < 2 || segs[0] !== "mcp_servers" || segs[1] !== serverName) {
    return { matched: false, isMain: false };
  }
  return { matched: true, isMain: segs.length === 2 };
}

function findTomlSectionRanges(lines, serverName) {
  const anyHeaderRe = /^\s*\[{1,2}[^\]]+\]{1,2}\s*(?:#.*)?$/;
  const ranges = [];
  let i = 0;
  while (i < lines.length) {
    const info = matchTomlServerHeader(lines[i], serverName);
    if (info.matched) {
      const start = i;
      let end = i + 1;
      while (end < lines.length && !anyHeaderRe.test(lines[end])) end++;
      ranges.push({ start, end, isMain: info.isMain });
      i = end;
    } else {
      i++;
    }
  }
  return ranges;
}

export function readTomlServer(text, serverName = MCP_SERVER_NAME) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const ranges = findTomlSectionRanges(lines, serverName);
  const main = ranges.find((r) => r.isMain);
  if (!main) return { found: false, command: "", args: [] };

  const block = lines.slice(main.start + 1, main.end).join("\n");
  const cmdMatch = /^\s*command\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')/m.exec(block);
  const argsMatch = /^\s*args\s*=\s*\[([\s\S]*?)\]/m.exec(block);
  return {
    found: true,
    command: cmdMatch ? parseTomlSingleString(cmdMatch[1]) : "",
    args: argsMatch ? parseTomlStringList(argsMatch[1]) : [],
  };
}

export function upsertTomlServer(text, serverName = MCP_SERVER_NAME, { command = "node", args = [] } = {}) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  const headerName = /^[A-Za-z0-9_-]+$/.test(serverName) ? serverName : JSON.stringify(serverName);
  const blockLines = [
    `[mcp_servers.${headerName}]`,
    `command = ${JSON.stringify(command)}`,
    `args = [${args.map((a) => JSON.stringify(String(a))).join(", ")}]`,
  ];

  if (!normalized.trim()) return `${blockLines.join("\n")}\n`;

  const lines = normalized.split("\n");
  const ranges = findTomlSectionRanges(lines, serverName);
  const main = ranges.find((r) => r.isMain);

  if (!ranges.length) {
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    lines.push("", ...blockLines, "");
    return lines.join("\n");
  }

  const out = [];
  let inserted = false;
  for (let i = 0; i < lines.length; i++) {
    const hit = ranges.find((r) => i >= r.start && i < r.end);
    if (!hit) {
      out.push(lines[i]);
      continue;
    }
    if (!inserted && i === hit.start && (hit.isMain || !main)) {
      out.push(...blockLines);
      // Preserve one trailing blank line if the removed block ended with one before next header.
      if (hit.end < lines.length && lines[hit.end - 1] === "") out.push("");
      inserted = true;
    }
  }
  while (out.length > 1 && out[out.length - 1] === "" && out[out.length - 2] === "") out.pop();
  const joined = out.join("\n");
  return joined.endsWith("\n") ? joined : `${joined}\n`;
}

export function removeTomlServer(text, serverName = MCP_SERVER_NAME) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  if (!normalized.trim()) return normalized;
  const lines = normalized.split("\n");
  const ranges = findTomlSectionRanges(lines, serverName);
  if (!ranges.length) return normalized;

  const out = [];
  let removedJustBefore = false;
  for (let i = 0; i < lines.length; i++) {
    if (ranges.some((r) => i >= r.start && i < r.end)) {
      removedJustBefore = true;
      continue;
    }
    if (removedJustBefore) {
      if (lines[i] === "" && (!out.length || out[out.length - 1] === "")) continue;
      removedJustBefore = false;
    }
    out.push(lines[i]);
  }
  while (out.length && out[out.length - 1] === "" && out[out.length - 2] === "") out.pop();
  const cleaned = out.join("\n");
  if (!cleaned.trim()) return "";
  return cleaned.endsWith("\n") ? cleaned : `${cleaned}\n`;
}

function parseYamlScalar(rawVal) {
  const s = String(rawVal || "").trim();
  if (!s) return "";
  if (s.startsWith('"') && s.endsWith('"')) {
    try { return JSON.parse(s); } catch { return s.slice(1, -1); }
  }
  if (s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s.replace(/\s+#.*$/, "").trim();
}

function parseYamlInlineArray(rawArr) {
  const inner = String(rawArr || "").trim().slice(1, -1).trim();
  if (!inner) return [];
  const out = [];
  let i = 0;
  while (i < inner.length) {
    while (i < inner.length && /[\s,]/.test(inner[i])) i++;
    if (i >= inner.length) break;
    const ch = inner[i];
    if (ch === '"' || ch === "'") {
      const q = ch;
      let val = "";
      i++;
      while (i < inner.length) {
        if (q === '"' && inner[i] === "\\" && i + 1 < inner.length) {
          val += inner[i] + inner[i + 1];
          i += 2;
          continue;
        }
        if (q === "'" && inner[i] === "'" && inner[i + 1] === "'") {
          val += "''";
          i += 2;
          continue;
        }
        if (inner[i] === q) { i++; break; }
        val += inner[i++];
      }
      out.push(parseYamlScalar(`${q}${val}${q}`));
    } else {
      let start = i;
      while (i < inner.length && inner[i] !== ",") i++;
      const token = parseYamlScalar(inner.slice(start, i));
      if (token !== "") out.push(token);
    }
  }
  return out;
}

function validateDshCordisYamlText(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  let firstCodeIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    firstCodeIdx = i;
    break;
  }
  if (firstCodeIdx < 0) return { normalized, lines, isEmptyArray: false, error: "" };
  const firstLine = lines[firstCodeIdx];
  const firstTrim = firstLine.trim();
  if (/^\[\]\s*(?:#.*)?$/.test(firstTrim)) {
    for (let j = firstCodeIdx + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (t && !t.startsWith("#")) {
        return { normalized, lines, isEmptyArray: false, error: "YAML 顶层格式无效：期望列表结构" };
      }
    }
    return { normalized, lines, isEmptyArray: true, emptyIdx: firstCodeIdx, error: "" };
  }
  if (!/^-(\s|$)/.test(firstLine)) {
    return { normalized, lines, isEmptyArray: false, error: "YAML 顶层必须为 Cordis 列表项（以 - 开头或 []）" };
  }
  return { normalized, lines, isEmptyArray: false, error: "" };
}

function extractBracketArray(text) {
  const s = String(text || "");
  if (!s.startsWith("[")) return "";
  let inQuote = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuote) {
      if (inQuote === '"' && ch === "\\" && i + 1 < s.length) { i++; continue; }
      if (inQuote === "'" && ch === "'" && s[i + 1] === "'") { i++; continue; }
      if (ch === inQuote) inQuote = "";
      continue;
    }
    if (ch === '"' || ch === "'") inQuote = ch;
    else if (ch === "]") return s.slice(0, i + 1);
  }
  return "";
}

function findDshEntryRanges(lines, entryId) {
  const ranges = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*-\s+)id\s*:\s*(.+?)\s*$/.exec(lines[i]);
    if (!m) continue;
    const idVal = parseYamlScalar(m[2]);
    if (idVal !== entryId) continue;
    const dashIndent = m[1].indexOf("-");
    let end = i + 1;
    while (end < lines.length) {
      const cur = lines[end];
      const trimmed = cur.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        end++;
        continue;
      }
      const indent = cur.search(/\S/);
      if (indent < dashIndent) break;
      if (indent === dashIndent && trimmed.startsWith("-")) break;
      end++;
    }
    while (end > i + 1 && lines[end - 1].trim() === "") end--;
    let inInsertBlock = false;
    let outerStart = -1;
    let outerEnd = -1;
    // Check if this entry lives inside a top-level `- insert:` wrapper (or explicitly carries DSH MCP client name).
    if (dashIndent > 0) {
      let up = i - 1;
      while (up >= 0 && (!lines[up].trim() || lines[up].trim().startsWith("#"))) up--;
      for (let probe = up; probe >= 0; probe--) {
        const cur = lines[probe];
        const trimmed = cur.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const indent = cur.search(/\S/);
        if (indent < dashIndent) {
          inInsertBlock = indent === 0 && /^-\s+insert\s*:\s*(?:#.*)?$/.test(trimmed);
          up = probe;
          break;
        }
      }
      if (inInsertBlock) {
        let blockEnd = end;
        while (blockEnd < lines.length) {
          const cur = lines[blockEnd];
          const trimmed = cur.trim();
          if (!trimmed || trimmed.startsWith("#")) { blockEnd++; continue; }
          if (cur.search(/\S/) === 0 && trimmed.startsWith("-")) break;
          blockEnd++;
        }
        // Scan if any sibling entry shares this `- insert:` block (outside any duplicate ranges added later)
        let hasSibling = false;
        for (let k = up + 1; k < blockEnd; k++) {
          if (k >= i && k < end) continue;
          const kt = lines[k].trim();
          if (kt && !kt.startsWith("#")) { hasSibling = true; break; }
        }
        if (!hasSibling) {
          outerStart = up;
          outerEnd = end;
        }
      }
    }
    const blockText = lines.slice(i, end).join("\n");
    const hasDshMcpName = /^\s*name\s*:\s*["']?@deepseek-ai\/dsh-mcp-client["']?(?:\s+#.*)?$/m.test(blockText);
    if (!inInsertBlock && !hasDshMcpName) continue;
    ranges.push({ start: i, end, dashIndent, outerStart, outerEnd });
  }
  return ranges;
}

function dshServerId(serverName = MCP_SERVER_NAME) {
  return `mcp-${serverName}`;
}

function buildDshCordisInsertBlock(serverName, { command = "node", args = [] } = {}) {
  const entryId = dshServerId(serverName);
  const formattedArgs = args.map((a) => JSON.stringify(String(a))).join(", ");
  return [
    "- insert:",
    `    - id: ${entryId}`,
    `      name: "@deepseek-ai/dsh-mcp-client"`,
    "      config:",
    `        serverName: ${JSON.stringify(String(serverName))}`,
    `        transport: "stdio"`,
    `        command: ${JSON.stringify(String(command))}`,
    `        args: [${formattedArgs}]`,
  ];
}

function buildDshCordisChildItem(serverName, { command = "node", args = [] } = {}, dashIndent = 4) {
  const pad = " ".repeat(Math.max(0, dashIndent));
  const sub = " ".repeat(Math.max(0, dashIndent + 2));
  const cfgSub = " ".repeat(Math.max(0, dashIndent + 4));
  const formattedArgs = args.map((a) => JSON.stringify(String(a))).join(", ");
  return [
    `${pad}- id: ${dshServerId(serverName)}`,
    `${sub}name: "@deepseek-ai/dsh-mcp-client"`,
    `${sub}config:`,
    `${cfgSub}serverName: ${JSON.stringify(String(serverName))}`,
    `${cfgSub}transport: "stdio"`,
    `${cfgSub}command: ${JSON.stringify(String(command))}`,
    `${cfgSub}args: [${formattedArgs}]`,
  ];
}

export function readDshCordisServer(text, serverName = MCP_SERVER_NAME) {
  const check = validateDshCordisYamlText(text);
  if (check.error) return { found: false, command: "", args: [], error: check.error };
  const ranges = findDshEntryRanges(check.lines, dshServerId(serverName));
  if (!ranges.length) return { found: false, command: "", args: [], error: "" };
  const blockLines = check.lines.slice(ranges[0].start, ranges[0].end);
  let command = "";
  let args = [];
  for (let i = 0; i < blockLines.length; i++) {
    const line = blockLines[i];
    const cmdM = /^\s*command\s*:\s*(.+?)\s*$/.exec(line);
    if (cmdM) {
      command = parseYamlScalar(cmdM[1]);
      continue;
    }
    const argsM = /^(\s*)args\s*:\s*(.*?)\s*$/.exec(line);
    if (argsM) {
      const rawTail = argsM[2].trim();
      const inlineArr = rawTail.startsWith("[") ? extractBracketArray(rawTail) : "";
      if (inlineArr) {
        args = parseYamlInlineArray(inlineArr);
      } else if (!rawTail || rawTail.startsWith("#")) {
        const baseIndent = argsM[1].length;
        const collected = [];
        for (let j = i + 1; j < blockLines.length; j++) {
          const itemLine = blockLines[j];
          const trimmed = itemLine.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const indent = itemLine.search(/\S/);
          if (indent <= baseIndent) break;
          const li = /^\s*-\s+(.*)$/.exec(itemLine);
          if (li) collected.push(parseYamlScalar(li[1]));
          else break;
        }
        args = collected;
      }
    }
  }
  return { found: true, command, args, error: "" };
}

export function upsertDshCordisServer(text, serverName = MCP_SERVER_NAME, { command = "node", args = [] } = {}) {
  const check = validateDshCordisYamlText(text);
  if (check.error) throw new Error(check.error);
  const { lines, isEmptyArray, emptyIdx } = check;
  const fullBlock = buildDshCordisInsertBlock(serverName, { command, args });
  if (isEmptyArray) {
    const next = [...lines];
    next.splice(emptyIdx, 1, ...fullBlock);
    const joined = next.join("\n");
    return joined.endsWith("\n") ? joined : `${joined}\n`;
  }
  const ranges = findDshEntryRanges(lines, dshServerId(serverName));
  if (!ranges.length) {
    const next = [...lines];
    while (next.length && next[next.length - 1] === "") next.pop();
    if (next.length) next.push("");
    next.push(...fullBlock, "");
    return next.join("\n");
  }
  const out = [];
  let replaced = false;
  for (let i = 0; i < lines.length; i++) {
    const hitIdx = ranges.findIndex((r) => {
      if (!replaced) return i >= r.start && i < r.end;
      const s = r.outerStart >= 0 ? r.outerStart : r.start;
      const e = r.outerEnd >= 0 ? r.outerEnd : r.end;
      return i >= s && i < e;
    });
    if (hitIdx < 0) {
      out.push(lines[i]);
      continue;
    }
    const hit = ranges[hitIdx];
    if (!replaced && i === hit.start) {
      out.push(...buildDshCordisChildItem(serverName, { command, args }, hit.dashIndent));
      replaced = true;
    }
  }
  const joined = out.join("\n");
  return joined.endsWith("\n") ? joined : `${joined}\n`;
}

export function removeDshCordisServer(text, serverName = MCP_SERVER_NAME) {
  const check = validateDshCordisYamlText(text);
  if (check.error) throw new Error(check.error);
  if (check.isEmptyArray) return check.normalized;
  const { lines } = check;
  const ranges = findDshEntryRanges(lines, dshServerId(serverName));
  if (!ranges.length) return check.normalized;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const hit = ranges.find((r) => {
      const s = r.outerStart >= 0 ? r.outerStart : r.start;
      const e = r.outerEnd >= 0 ? r.outerEnd : r.end;
      return i >= s && i < e;
    });
    if (hit) continue;
    out.push(lines[i]);
  }
  while (out.length > 1 && out[out.length - 1] === "" && out[out.length - 2] === "") out.pop();
  const hasCode = out.some((l) => l.trim() && !l.trim().startsWith("#"));
  if (!hasCode) {
    while (out.length && out[out.length - 1] === "") out.pop();
    out.push("[]");
  }
  const joined = out.join("\n");
  return joined.endsWith("\n") ? joined : `${joined}\n`;
}

function writeAtomicWithBackup(filePath, content, { backup = true } = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let mode = 0o600;
  if (fs.existsSync(filePath)) {
    try {
      const st = fs.statSync(filePath);
      if (st.mode & 0o777) mode = st.mode & 0o777;
    } catch { /* fallback to restrictive 0o600 */ }
    if (backup) {
      const bakPath = `${filePath}.agent-deck.bak`;
      fs.copyFileSync(filePath, bakPath);
      if (process.platform !== "win32") {
        try { fs.chmodSync(bakPath, mode); } catch { /* ignore */ }
      }
    }
  }
  const tmpPath = `${filePath}.agent-deck.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  fs.writeFileSync(tmpPath, content, { encoding: "utf8", mode, flag: "wx" });
  if (process.platform !== "win32") {
    try { fs.chmodSync(tmpPath, mode); } catch { /* ignore */ }
  }
  try {
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.rmSync(tmpPath, { force: true }); } catch { /* ignore */ }
    throw err;
  }
}

function readClientEntry(spec) {
  if (!fs.existsSync(spec.configPath)) {
    return { exists: false, found: false, command: "", args: [], error: "" };
  }
  let raw = "";
  try {
    raw = fs.readFileSync(spec.configPath, "utf8");
  } catch (e) {
    return { exists: true, found: false, command: "", args: [], error: e?.message || String(e) };
  }
  if (spec.format === "toml") {
    const parsed = readTomlServer(raw, MCP_SERVER_NAME);
    return { exists: true, ...parsed, error: "" };
  }
  if (spec.format === "dsh-cordis-yaml") {
    const parsed = readDshCordisServer(raw, MCP_SERVER_NAME);
    return { exists: true, ...parsed };
  }
  if (!raw.trim()) return { exists: true, found: false, command: "", args: [], error: "" };
  try {
    const json = JSON.parse(raw);
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      return { exists: true, found: false, command: "", args: [], error: "配置文件根节点不是 JSON 对象" };
    }
    if (spec.format === "opencode-json") {
      if (json.mcp !== undefined && (typeof json.mcp !== "object" || json.mcp === null || Array.isArray(json.mcp))) {
        return { exists: true, found: false, command: "", args: [], error: "opencode.json 中 mcp 字段不是对象" };
      }
      if (json.mcp?.servers !== undefined && (typeof json.mcp.servers !== "object" || json.mcp.servers === null || Array.isArray(json.mcp.servers))) {
        return { exists: true, found: false, command: "", args: [], error: "opencode.json 中 mcp.servers 字段不是对象" };
      }
      const entry = json.mcp?.servers?.[MCP_SERVER_NAME] || json.mcp?.[MCP_SERVER_NAME];
      if (!entry || typeof entry !== "object") return { exists: true, found: false, command: "", args: [], error: "" };
      const cmdArr = Array.isArray(entry.command) ? entry.command.map((x) => String(x)) : [];
      return {
        exists: true,
        found: true,
        command: cmdArr.length ? cmdArr[0] : String(entry.command || ""),
        args: cmdArr.length > 1 ? cmdArr.slice(1) : (Array.isArray(entry.args) ? entry.args.map((x) => String(x)) : []),
        error: "",
      };
    }
    const entry = json.mcpServers?.[MCP_SERVER_NAME];
    if (!entry || typeof entry !== "object") return { exists: true, found: false, command: "", args: [], error: "" };
    return {
      exists: true,
      found: true,
      command: String(entry.command || ""),
      args: Array.isArray(entry.args) ? entry.args.map((x) => String(x)) : [],
      error: "",
    };
  } catch (e) {
    return { exists: true, found: false, command: "", args: [], error: `JSON 解析失败：${e?.message || e}` };
  }
}

export function listMcpClients({
  vaultPath = "",
  mcpScript = "",
  allowWrite = false,
  configDir = "",
  homeDir = "",
  platform = process.platform,
  env = process.env,
  configOverrides = null,
} = {}) {
  const specs = clientSpecs({ homeDir, platform, env, configOverrides });
  const home = defaultHome(homeDir);
  const wantScript = mcpScript ? normPath(mcpScript) : "";
  const wantVault = vaultPath ? normPath(vaultPath) : "";
  const wantCfgDir = customConfigDirFlag(configDir);

  return specs.map((spec) => {
    const detected = fs.existsSync(spec.configPath)
      || fs.existsSync(spec.detectPath)
      || (Array.isArray(spec.altDetectPaths) && spec.altDetectPaths.some((p) => fs.existsSync(p)));
    const cur = readClientEntry(spec);
    const parsed = cur.found ? parseServerArgs(cur.args) : { script: "", vault: "", configDir: "", allowWrite: false };
    let status = "not-installed";
    if (cur.error) status = "error";
    else if (cur.found) {
      const sameScript = !wantScript || normPath(parsed.script) === wantScript;
      const sameVault = !wantVault || normPath(parsed.vault) === wantVault;
      const sameCfg = customConfigDirFlag(parsed.configDir) === wantCfgDir;
      const sameMode = parsed.allowWrite === Boolean(allowWrite);
      const baseCmd = path.basename(cur.command || "").toLowerCase();
      const validNodeName = baseCmd === "node" || baseCmd === "node.exe";
      const sameCmd = validNodeName && (!path.isAbsolute(cur.command) || isNodeBinaryFile(cur.command, platform));
      status = sameScript && sameVault && sameCfg && sameMode && sameCmd ? "connected" : "outdated";
    }
    const rawRel = spec.configPath.startsWith(home + path.sep) || spec.configPath === home
      ? `~${spec.configPath.slice(home.length)}`
      : spec.configPath;
    const displayPath = platform === "win32" ? rawRel : rawRel.replace(/\\/g, "/");
    return {
      id: spec.id,
      label: spec.label,
      format: spec.format,
      configPath: spec.configPath,
      displayPath,
      restartHint: spec.restartHint,
      detected,
      installed: cur.found,
      status,
      currentVault: parsed.vault,
      currentScript: parsed.script,
      currentConfigDir: parsed.configDir,
      currentAllowWrite: parsed.allowWrite,
      error: cur.error,
    };
  });
}

export function installMcpClient(clientId, {
  vaultPath,
  mcpScript,
  allowWrite = false,
  configDir = "",
  backup = true,
  homeDir = "",
  platform = process.platform,
  env = process.env,
  execPath = process.execPath,
  configOverrides = null,
} = {}) {
  if (!vaultPath || !fs.existsSync(vaultPath)) throw new Error(`找不到 Vault 目录：${vaultPath || "(未指定)"}`);
  if (!mcpScript || !fs.existsSync(mcpScript)) throw new Error(`找不到 MCP 脚本：${mcpScript || "(未指定)"}`);

  const specs = clientSpecs({ homeDir, platform, env, configOverrides });
  const spec = specs.find((s) => s.id === clientId);
  if (!spec) throw new Error(`不支持的 MCP 客户端：${clientId}`);

  const nodeCmd = resolveNodeBinary({ homeDir, platform, env, execPath }) || "node";
  const args = buildMcpArgs(mcpScript, vaultPath, Boolean(allowWrite), configDir);
  if (spec.format === "toml") {
    const raw = fs.existsSync(spec.configPath) ? fs.readFileSync(spec.configPath, "utf8") : "";
    const next = upsertTomlServer(raw, MCP_SERVER_NAME, { command: nodeCmd, args });
    writeAtomicWithBackup(spec.configPath, next, { backup });
  } else if (spec.format === "dsh-cordis-yaml") {
    const raw = fs.existsSync(spec.configPath) ? fs.readFileSync(spec.configPath, "utf8") : "[]\n";
    const next = upsertDshCordisServer(raw, MCP_SERVER_NAME, { command: nodeCmd, args });
    writeAtomicWithBackup(spec.configPath, next, { backup });
  } else if (spec.format === "opencode-json") {
    let data = {};
    if (fs.existsSync(spec.configPath)) {
      const raw = fs.readFileSync(spec.configPath, "utf8");
      if (raw.trim()) {
        data = JSON.parse(raw);
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          throw new Error(`配置文件不是有效 JSON 对象：${spec.configPath}`);
        }
      }
    }
    if (data.mcp !== undefined && (typeof data.mcp !== "object" || data.mcp === null || Array.isArray(data.mcp))) {
      throw new Error(`配置文件 mcp 字段不是 JSON 对象：${spec.configPath}`);
    }
    const prevMcp = data.mcp ? { ...data.mcp } : {};
    if (prevMcp.servers !== undefined && (typeof prevMcp.servers !== "object" || prevMcp.servers === null || Array.isArray(prevMcp.servers))) {
      throw new Error(`配置文件 mcp.servers 字段不是 JSON 对象：${spec.configPath}`);
    }
    delete prevMcp[MCP_SERVER_NAME];
    const nextServers = prevMcp.servers ? { ...prevMcp.servers } : {};
    nextServers[MCP_SERVER_NAME] = { type: "local", command: [nodeCmd, ...args] };
    const nextObj = { ...data, mcp: { ...prevMcp, servers: nextServers } };
    writeAtomicWithBackup(spec.configPath, JSON.stringify(nextObj, null, 2) + "\n", { backup });
  } else {
    let data = {};
    if (fs.existsSync(spec.configPath)) {
      const raw = fs.readFileSync(spec.configPath, "utf8");
      if (raw.trim()) {
        data = JSON.parse(raw);
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          throw new Error(`配置文件不是有效 JSON 对象：${spec.configPath}`);
        }
      }
    }
    const nextServers = (data.mcpServers && typeof data.mcpServers === "object" && !Array.isArray(data.mcpServers))
      ? { ...data.mcpServers }
      : {};
    nextServers[MCP_SERVER_NAME] = { command: nodeCmd, args };
    const nextObj = { ...data, mcpServers: nextServers };
    writeAtomicWithBackup(spec.configPath, JSON.stringify(nextObj, null, 2) + "\n", { backup });
  }

  return { ok: true, id: spec.id, label: spec.label, configPath: spec.configPath, allowWrite: Boolean(allowWrite), restartHint: spec.restartHint };
}

export function uninstallMcpClient(clientId, {
  backup = true,
  homeDir = "",
  platform = process.platform,
  env = process.env,
  configOverrides = null,
} = {}) {
  const specs = clientSpecs({ homeDir, platform, env, configOverrides });
  const spec = specs.find((s) => s.id === clientId);
  if (!spec) throw new Error(`不支持的 MCP 客户端：${clientId}`);
  if (!fs.existsSync(spec.configPath)) {
    return { ok: true, id: spec.id, removed: false, configPath: spec.configPath };
  }

  if (spec.format === "toml") {
    const raw = fs.readFileSync(spec.configPath, "utf8");
    const next = removeTomlServer(raw, MCP_SERVER_NAME);
    if (next === raw) return { ok: true, id: spec.id, removed: false, configPath: spec.configPath };
    writeAtomicWithBackup(spec.configPath, next, { backup });
    return { ok: true, id: spec.id, removed: true, configPath: spec.configPath };
  }

  if (spec.format === "dsh-cordis-yaml") {
    const raw = fs.readFileSync(spec.configPath, "utf8");
    const next = removeDshCordisServer(raw, MCP_SERVER_NAME);
    if (next === raw) return { ok: true, id: spec.id, removed: false, configPath: spec.configPath };
    writeAtomicWithBackup(spec.configPath, next, { backup });
    return { ok: true, id: spec.id, removed: true, configPath: spec.configPath };
  }

  const raw = fs.readFileSync(spec.configPath, "utf8");
  if (!raw.trim()) return { ok: true, id: spec.id, removed: false, configPath: spec.configPath };
  const data = JSON.parse(raw);
  if (spec.format === "opencode-json") {
    const hasNested = Boolean(data?.mcp?.servers && Object.hasOwn(data.mcp.servers, MCP_SERVER_NAME));
    const hasLegacy = Boolean(data?.mcp && Object.hasOwn(data.mcp, MCP_SERVER_NAME));
    if (!hasNested && !hasLegacy) {
      return { ok: true, id: spec.id, removed: false, configPath: spec.configPath };
    }
    const nextMcp = { ...data.mcp };
    if (hasLegacy) delete nextMcp[MCP_SERVER_NAME];
    if (hasNested) {
      const nextServers = { ...data.mcp.servers };
      delete nextServers[MCP_SERVER_NAME];
      nextMcp.servers = nextServers;
    }
    const nextObj = { ...data, mcp: nextMcp };
    writeAtomicWithBackup(spec.configPath, JSON.stringify(nextObj, null, 2) + "\n", { backup });
    return { ok: true, id: spec.id, removed: true, configPath: spec.configPath };
  }
  if (!data?.mcpServers || !Object.hasOwn(data.mcpServers, MCP_SERVER_NAME)) {
    return { ok: true, id: spec.id, removed: false, configPath: spec.configPath };
  }
  const nextServers = { ...data.mcpServers };
  delete nextServers[MCP_SERVER_NAME];
  const nextObj = { ...data, mcpServers: nextServers };
  writeAtomicWithBackup(spec.configPath, JSON.stringify(nextObj, null, 2) + "\n", { backup });
  return { ok: true, id: spec.id, removed: true, configPath: spec.configPath };
}

const HANDSHAKE_STEP_SCRIPT = `
const fs = require("fs");
const { spawn } = require("child_process");
const cfg = JSON.parse(fs.readFileSync(0, "utf8"));
const supported = new Set(["2025-06-18", "2025-03-26", "2024-11-05"]);
const child = spawn(cfg.bin, cfg.args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
let buf = "";
let errBuf = "";
let initDone = false;
let settled = false;
const finish = (res) => {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  try { child.kill(); } catch {}
  process.stdout.write(JSON.stringify(res));
  process.exit(0);
};
const timer = setTimeout(() => {
  finish({ ok: false, toolsCount: 0, toolNames: [], error: initDone ? "tools/list 超时" : "initialize 握手超时" });
}, cfg.timeoutMs);
child.stderr.on("data", (d) => { errBuf += String(d); });
child.on("error", (e) => finish({ ok: false, toolsCount: 0, toolNames: [], error: e && e.message || String(e) }));
child.stdout.on("data", (chunk) => {
  buf += String(chunk);
  for (;;) {
    const nl = buf.indexOf("\\n");
    if (nl < 0) break;
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (e) { return finish({ ok: false, toolsCount: 0, toolNames: [], error: "无效 JSON 响应" }); }
    if (msg.id === 1) {
      if (msg.error) return finish({ ok: false, toolsCount: 0, toolNames: [], error: msg.error.message || "initialize rejected" });
      const ver = msg.result && msg.result.protocolVersion;
      if (!supported.has(ver) || !msg.result || typeof msg.result.capabilities !== "object") {
        return finish({ ok: false, toolsCount: 0, toolNames: [], error: "不支持的 MCP 协议版本：" + String(ver || "") });
      }
      initDone = true;
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\\n");
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\\n");
    } else if (msg.id === 2) {
      if (!initDone) return finish({ ok: false, toolsCount: 0, toolNames: [], error: "未完成 initialize 即返回 tools/list" });
      if (msg.error) return finish({ ok: false, toolsCount: 0, toolNames: [], error: msg.error.message || "tools/list error" });
      const tools = Array.isArray(msg.result && msg.result.tools) ? msg.result.tools : [];
      const toolNames = tools.map((t) => t.name);
      const hasPropose = toolNames.includes("memory_propose");
      const hasVaultTools = toolNames.includes("vault_find");
      const wantMode = cfg.toolsMode === "memory-only" ? "memory-only" : "all";
      const okCount = wantMode === "memory-only" ? (tools.length >= 5 && !hasVaultTools) : (tools.length >= 9 && hasVaultTools);
      const ok = okCount && (cfg.allowWrite ? hasPropose : !hasPropose);
      try { child.stdin.end(); } catch {}
      return finish({ ok, toolsCount: tools.length, toolNames, error: ok ? "" : "工具列表异常（mode=" + wantMode + ", count=" + tools.length + ", allowWrite=" + Boolean(cfg.allowWrite) + "）" });
    }
  }
});
child.on("close", (code) => {
  if (!settled) finish({ ok: false, toolsCount: 0, toolNames: [], error: errBuf.trim() || ("exit " + code) });
});
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", clientInfo: { name: "agent-deck-check", version: "1" }, capabilities: {} } }) + "\\n");
`;

export function verifyMcpHandshake({
  mcpScript,
  vaultPath,
  allowWrite = false,
  toolsMode = "",
  configDir = "",
  indexDir = "",
  timeoutMs = 6000,
  nodeBin = "",
} = {}) {
  if (!mcpScript || !fs.existsSync(mcpScript)) {
    return { ok: false, toolsCount: 0, toolNames: [], latencyMs: 0, error: `找不到 MCP 脚本：${mcpScript || "(未指定)"}` };
  }
  if (!vaultPath || !fs.existsSync(vaultPath)) {
    return { ok: false, toolsCount: 0, toolNames: [], latencyMs: 0, error: `找不到 Vault 目录：${vaultPath || "(未指定)"}` };
  }
  const resolved = nodeBin && fs.existsSync(nodeBin) ? nodeBin : resolveNodeBinary();
  let bin = resolved;
  let spawnEnv = process.env;
  if (!bin) {
    if (process.versions?.electron && fs.existsSync(process.execPath)) {
      bin = process.execPath;
      spawnEnv = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
    } else {
      bin = "node";
    }
  }
  const wantToolsMode = toolsMode || mcpSettingsOf(vaultPath, { configDir }).toolsMode;
  const args = buildMcpArgs(mcpScript, vaultPath, Boolean(allowWrite), configDir);
  if (indexDir) args.push("--index-dir", path.resolve(indexDir));

  const t0 = Date.now();
  const res = spawnSync(bin, ["-e", HANDSHAKE_STEP_SCRIPT], {
    input: JSON.stringify({ bin, args, allowWrite: Boolean(allowWrite), toolsMode: wantToolsMode, timeoutMs }),
    encoding: "utf8",
    timeout: timeoutMs + 1000,
    env: spawnEnv,
  });
  const latencyMs = Date.now() - t0;
  if (res.error) return { ok: false, toolsCount: 0, toolNames: [], latencyMs, error: res.error.message || String(res.error) };
  if (res.status !== 0 && !String(res.stdout || "").trim()) {
    return { ok: false, toolsCount: 0, toolNames: [], latencyMs, error: (res.stderr || "").trim() || `exit ${res.status}` };
  }

  try {
    const parsed = JSON.parse(String(res.stdout || "").trim());
    return {
      ok: Boolean(parsed.ok),
      toolsCount: Number(parsed.toolsCount) || 0,
      toolNames: Array.isArray(parsed.toolNames) ? parsed.toolNames : [],
      latencyMs,
      error: parsed.error || "",
    };
  } catch (e) {
    return { ok: false, toolsCount: 0, toolNames: [], latencyMs, error: `解析 MCP 响应失败：${e?.message || e}` };
  }
}
