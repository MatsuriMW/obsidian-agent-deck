// TeleAgent「人在场的一键派发」——Linux 后端。
//
// 依据 temp/teleagent-linux-probe.md 的本机实测（2026-11-19，Deepin 25 / treeland
// Wayland + XWayland）：
// 1. Linux 客户端由启动器强制 `--ozone-platform=x11`，是 XWayland 客户端，xdotool 能看到；
//    另有两个辅助窗（Screenshot / 10×10 / 200×200），必须按标题+几何排除。
// 2. treeland 下 `windowactivate` / `_NET_ACTIVE_WINDOW` 对主窗无效；`windowfocus` 能设置
//    X 输入焦点，但必须用 `getwindowfocus` 交叉校验，失败就中止（不盲点、不盲打）。
// 3. 字母键会被输入法组合（实测 `zz` 不出字、`a`+空格会提交中文），逐字符打字不可行；
//    文本必须写入剪贴板再 `Ctrl+V`。中文粘贴已实测成功。
// 4. 2026-11-19 22:29 在负责人批准下做过**一次**真实提交：按窗口相对比例点「运行」，
//    前置条件是 getwindowfocus 命中主窗 + 发送按钮蓝色像素 >= 50 + 输入框截图非空；
//    该次提交创建了会话 ses_e0bc97898ffe3NfF3EYllOYSgv 并由 SQLite 只读回读确认。
//    生产默认仍**不自动提交**：dispatchTeleagentLinux 只做到“填入 + 提示用户手动点运行”；
//    submitTeleAgentDispatch 是独立原语，必须显式 confirm:true，且未接入 UI。
//
// 本模块不写库、不发网络请求、不改客户端配置；数据库只在后续提交阶段用只读 SQL 回读校验。

import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { t } from "./i18n.js";
import { normalizePayload } from "./teleagent-dispatch.js";

export const TELEAGENT_MAIN_CLASS = "teleagent";
export const TELEAGENT_MAIN_TITLE = "TeleAgent 星辰超级智能体";
export const TELEAGENT_WINDOW_TITLE_RE = /TeleAgent/i;
export const TELEAGENT_AUX_TITLE_RE = /Screenshot/i;

// 本机实测：主窗 1513×1005+176+40，输入框中心约在窗口内 (700, 780)。
// 这里存的是**窗口相对比例**，不是绝对像素；窗口大小/位置变了按比例换算。
export const COMPOSER_POINT_RATIO = Object.freeze({ x: 700 / 1513, y: 780 / 1005 });
// 「运行」按钮的位置只记录、不点击；2026-11-19 一次获批端到端实测按此比例点击成功，
// 点击前必须做焦点 + 发送按钮蓝色像素 + 输入框非空三重校验（见 submitTeleAgentDispatch）。
export const RUN_POINT_RATIO = Object.freeze({ x: 1358 / 1513, y: 897 / 1005 });

export const GEOMETRY_LIMITS = Object.freeze({
  minWidth: 900,
  minHeight: 500,
  maxWidth: 5000,
  maxHeight: 3500,
  minAspect: 1.1,
  maxAspect: 2.2,
});

// 失败阶段：复用 Windows 的 DISPATCH_STAGES，并新增 Linux 专用阶段（见 teleagent-dispatch.js）。
export const LINUX_DISPATCH_STAGES = Object.freeze(["dependency", "attach", "focus", "composer", "paste", "submit"]);

function defaultRun(command, args, options = {}) {
  return new Promise((resolve) => {
    const timeout = Number(options.timeout) > 0 ? Number(options.timeout) : 8000;
    execFile(
      command,
      args,
      {
        timeout,
        env: options.env || process.env,
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          code: error && typeof error.code === "number" ? error.code : error ? 1 : 0,
          stdout: String(stdout || ""),
          stderr: String(stderr || ""),
          error: error ? String(error.message || error) : "",
        });
      },
    );
  });
}

// 在 PATH 里找可执行文件（不依赖 `which` 命令本身）。
export function findExecutable(name, env = process.env) {
  const dirs = String((env && env.PATH) || "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    try {
      if (!fs.statSync(candidate).isFile()) continue;
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // 继续找下一个目录
    }
  }
  return "";
}

// Obsidian 自带 Electron：插件里能直接拿到 clipboard，比外部 xclip 干净。
// 非 Electron（node 测试/脚本）时返回 null，由调用方回退。
export function resolveElectronClipboard() {
  try {
    const req = typeof require === "function" ? require : null;
    if (!req) return null;
    const electron = req("electron");
    if (electron && electron.clipboard && typeof electron.clipboard.writeText === "function") {
      return electron.clipboard;
    }
  } catch {
    // 不在 Electron 里，或剪贴板不可用
  }
  return null;
}

// 依赖探测：DISPLAY（X11/XWayland）、xdotool、剪贴板（Electron 或 xclip）。
// 缺任何一项都返回结构化 missing，不抛异常。
export function detectLinuxDispatchEnvironment({ env = process.env, which = findExecutable, clipboard = null } = {}) {
  const missing = [];
  const display = String((env && env.DISPLAY) || "").trim();
  if (!display) missing.push("DISPLAY(X11/XWayland)");
  const xdotool = which("xdotool", env);
  if (!xdotool) missing.push("xdotool");
  const electronClipboard = clipboard || resolveElectronClipboard();
  const xclip = electronClipboard ? "" : which("xclip", env);
  if (!electronClipboard && !xclip) missing.push("clipboard(Electron clipboard 或 xclip)");
  return {
    ok: missing.length === 0,
    display,
    xdotool: xdotool || "",
    clipboard: electronClipboard ? "electron" : xclip ? "xclip" : "",
    xclip: xclip || "",
    missing,
  };
}

export function parseWindowGeometry(output) {
  const fields = {};
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = line.trim().match(/^(WINDOW|X|Y|WIDTH|HEIGHT|SCREEN)=(-?\d+)$/);
    if (match) fields[match[1].toLowerCase()] = Number(match[2]);
  }
  if (!Number.isFinite(fields.width) || !Number.isFinite(fields.height)) return null;
  if (fields.width <= 0 || fields.height <= 0) return null;
  return { x: fields.x ?? 0, y: fields.y ?? 0, width: fields.width, height: fields.height };
}

export function geometryIsUsable(geometry) {
  if (!geometry) return false;
  const { width, height } = geometry;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  if (width < GEOMETRY_LIMITS.minWidth || width > GEOMETRY_LIMITS.maxWidth) return false;
  if (height < GEOMETRY_LIMITS.minHeight || height > GEOMETRY_LIMITS.maxHeight) return false;
  const aspect = width / height;
  return aspect >= GEOMETRY_LIMITS.minAspect && aspect <= GEOMETRY_LIMITS.maxAspect;
}

export function pointInWindow(geometry, ratio) {
  const x = Math.round(geometry.width * ratio.x);
  const y = Math.round(geometry.height * ratio.y);
  return {
    x: Math.max(1, Math.min(geometry.width - 2, x)),
    y: Math.max(1, Math.min(geometry.height - 2, y)),
  };
}

function parseWindowPid(output) {
  const match = String(output || "").match(/_NET_WM_PID\(CARDINAL\)\s*=\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

// 按 class 找候选窗，再按标题排除辅助窗、按面积挑主窗；同时记录几何与 _NET_WM_PID。
export async function findTeleAgentMainWindow({ run = defaultRun, xdotool, which = findExecutable, env = process.env } = {}) {
  if (!xdotool) {
    return { ok: false, stage: "dependency", error: t("缺少 Linux 派发依赖：{list}", { list: "xdotool" }) };
  }
  const found = await run(xdotool, ["search", "--class", TELEAGENT_MAIN_CLASS], { env });
  if (!found.ok) {
    return { ok: false, stage: "attach", error: t("找不到 TeleAgent 主窗口（请确认客户端已启动，且在 XWayland/X11 模式下运行）：{error}", { error: String(found.error || found.stderr || "").slice(0, 200) }) };
  }
  const ids = String(found.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line));
  const xprop = which("xprop", env);
  const candidates = [];
  for (const id of ids) {
    const titleRun = await run(xdotool, ["getwindowname", id], { env });
    const title = String(titleRun.stdout || "").trim();
    if (!titleRun.ok || !title) continue;
    if (TELEAGENT_AUX_TITLE_RE.test(title)) continue;
    if (!TELEAGENT_WINDOW_TITLE_RE.test(title)) continue;
    const geoRun = await run(xdotool, ["getwindowgeometry", "--shell", id], { env });
    const geometry = parseWindowGeometry(geoRun.stdout);
    if (!geoRun.ok || !geometryIsUsable(geometry)) {
      candidates.push({ id, title, geometry, usable: false });
      continue;
    }
    let pid = null;
    if (xprop) {
      const pidRun = await run(xprop, ["-id", id, "_NET_WM_PID"], { env });
      pid = parseWindowPid(pidRun.stdout);
    }
    candidates.push({ id, title, geometry, pid, usable: true });
  }
  const usable = candidates.filter((entry) => entry.usable);
  if (!usable.length) {
    return {
      ok: false,
      stage: "attach",
      error: t("找不到可用的 TeleAgent 主窗口（窗口几何异常或只有辅助窗）"),
      candidates,
    };
  }
  // 主窗通常是面积最大的那个；辅助窗已被标题排除，这里再兜一层面积排序。
  usable.sort((a, b) => b.geometry.width * b.geometry.height - a.geometry.width * a.geometry.height);
  const main = usable[0];
  return { ok: true, window: { ...main, candidates: candidates.length } };
}

// treeland 实测：windowactivate 无效，但 windowfocus 能设置 X 输入焦点；
// 必须用 getwindowfocus 交叉校验，失败就中止（不盲点、不盲打）。
export async function focusTeleAgentWindow(window, { run = defaultRun, xdotool, env = process.env } = {}) {
  const id = String(window && window.id || "").trim();
  if (!id) return { ok: false, stage: "attach", error: t("找不到 TeleAgent 主窗口（窗口 id 为空）") };
  const focused = await run(xdotool, ["windowfocus", id], { env });
  if (!focused.ok) {
    return { ok: false, stage: "focus", error: t("无法把焦点切到 TeleAgent 主窗口（当前焦点：{actual}）；请先手动切到该窗口，treeland 下不要依赖 windowactivate", { actual: String(focused.error || focused.stderr || "?").slice(0, 120) }) };
  }
  const check = await run(xdotool, ["getwindowfocus"], { env });
  const actual = String(check.stdout || "").trim();
  if (!check.ok || actual !== id) {
    return { ok: false, stage: "focus", error: t("无法把焦点切到 TeleAgent 主窗口（当前焦点：{actual}）；请先手动切到该窗口，treeland 下不要依赖 windowactivate", { actual: actual || String(check.error || "?").slice(0, 80) }) };
  }
  return { ok: true, id };
}

// treeland 原生窗口激活 helper：源码在 src/native/treeland-activate.c，产物 bin/treeland-activate
// 不入库。运行时只在 PATH / 环境变量里探测；没有就降级为「请先手动切到 TeleAgent」。
export function resolveActivationHelper({ env = process.env, which = findExecutable, explicit = "" } = {}) {
  const candidates = [];
  if (explicit) candidates.push(String(explicit));
  if (env && env.AGENT_DECK_TREELAND_ACTIVATE) candidates.push(String(env.AGENT_DECK_TREELAND_ACTIVATE));
  const onPath = which("treeland-activate", env);
  if (onPath) candidates.push(onPath);
  for (const candidate of candidates) {
    try {
      if (!candidate || !fs.statSync(candidate).isFile()) continue;
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // 继续找下一个
    }
  }
  return "";
}

export async function activateTeleAgentWindow({ run = defaultRun, helper, env = process.env, title = TELEAGENT_MAIN_TITLE } = {}) {
  if (!helper) {
    return { ok: false, stage: "focus", error: t("缺少 treeland 窗口激活 helper（treeland-activate）；treeland 下无法自动把 TeleAgent 切到前台") };
  }
  const result = await run(helper, [title], { env, timeout: 6000 });
  if (!result.ok) {
    return { ok: false, stage: "focus", error: t("treeland-activate 激活 TeleAgent 失败：{error}", { error: String(result.error || result.stderr || "").slice(0, 200) }) };
  }
  return { ok: true, helper };
}

// 把 focus / getwindowfocus / 点输入框 / Ctrl+V 合并成**一次** xdotool 调用：
// treeland 下 X 焦点会在两次独立进程之间被重置，分开调用必然出现竞态。
export function buildFocusPasteArgs(window) {
  const point = pointInWindow(window.geometry, COMPOSER_POINT_RATIO);
  return [
    "windowfocus", String(window.id),
    "getwindowfocus",
    "mousemove", "--window", String(window.id), String(point.x), String(point.y), "click", "1",
    "key", "--clearmodifiers", "ctrl+v",
  ];
}

export async function focusAndPaste(window, { run = defaultRun, xdotool, env = process.env } = {}) {
  if (!geometryIsUsable(window && window.geometry)) {
    return { ok: false, stage: "composer", error: t("窗口几何异常（{width}×{height}），已中止以免点错位置", { width: (window && window.geometry && window.geometry.width) || "?", height: (window && window.geometry && window.geometry.height) || "?" }) };
  }
  const args = buildFocusPasteArgs(window);
  const result = await run(xdotool, args, { env, timeout: 8000 });
  if (!result.ok) {
    return { ok: false, stage: "paste", error: t("单进程粘贴失败：{error}", { error: String(result.error || result.stderr || "").slice(0, 200) }) };
  }
  return { ok: true, point: pointInWindow(window.geometry, COMPOSER_POINT_RATIO) };
}

// 按窗口相对比例点输入框；坐标在运行时用 getwindowgeometry 换算，不写死绝对像素。
export async function clickTeleAgentComposer(window, { run = defaultRun, xdotool, env = process.env } = {}) {
  if (!geometryIsUsable(window && window.geometry)) {
    return { ok: false, stage: "composer", error: t("窗口几何异常（{width}×{height}），已中止以免点错位置", { width: (window && window.geometry && window.geometry.width) || "?", height: (window && window.geometry && window.geometry.height) || "?" }) };
  }
  const point = pointInWindow(window.geometry, COMPOSER_POINT_RATIO);
  const click = await run(xdotool, ["mousemove", "--window", String(window.id), String(point.x), String(point.y), "click", "1"], { env });
  if (!click.ok) {
    return { ok: false, stage: "composer", error: t("点击 TeleAgent 输入框失败：{error}", { error: String(click.error || click.stderr || "").slice(0, 200) }) };
  }
  return { ok: true, point };
}

// PPM(P6) 解析：只用于可选的“粘贴后是否出现文字”截图校验，不引入图像库。
export function parsePpm(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let index = 0;
  const tokens = [];
  const skipSpace = () => {
    while (index < bytes.length) {
      const code = bytes[index];
      if (code === 32 || code === 9 || code === 10 || code === 13) { index += 1; continue; }
      if (code === 35) { while (index < bytes.length && bytes[index] !== 10) index += 1; continue; }
      break;
    }
  };
  while (tokens.length < 4 && index < bytes.length) {
    skipSpace();
    const start = index;
    while (index < bytes.length && bytes[index] !== 32 && bytes[index] !== 9 && bytes[index] !== 10 && bytes[index] !== 13) index += 1;
    tokens.push(String.fromCharCode(...bytes.slice(start, index)));
  }
  if (tokens[0] !== "P6") return null;
  const width = Number(tokens[1]);
  const height = Number(tokens[2]);
  const max = Number(tokens[3]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  index += 1; // 头部与二进制数据之间的单个空白
  const channels = max > 255 ? 6 : 3;
  const need = width * height * channels;
  if (bytes.length - index < need) return null;
  return { width, height, channels, data: bytes.subarray(index, index + need) };
}

function samplePixel(image, x, y) {
  const channels = image.channels || 3;
  const offset = (y * image.width + x) * channels;
  // PPM 的 16-bit 通道是大端：高字节在 0/2/4，低字节紧随其后；
  // 只取高字节比较就够了，不能把相邻通道的低字节当成绿色。
  if (channels === 6) return [image.data[offset], image.data[offset + 2], image.data[offset + 4]];
  return [image.data[offset], image.data[offset + 1], image.data[offset + 2]];
}

// 比较输入框区域“粘贴前/后”的像素变化；截图不可得时返回 null（视为未确认，不假装成功）。
export function composerLooksFilled(before, after) {
  if (!before || !after) return null;
  const width = Math.min(before.width, after.width);
  const height = Math.min(before.height, after.height);
  if (!width || !height) return null;
  const x0 = Math.floor(width * 0.30);
  const x1 = Math.floor(width * 0.97);
  const y0 = Math.floor(height * 0.68);
  const y1 = Math.floor(height * 0.87);
  let changed = 0;
  let total = 0;
  const step = 2;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const a = samplePixel(before, x, y);
      const b = samplePixel(after, x, y);
      total += 1;
      if (Math.abs(a[0] - b[0]) > 16 || Math.abs(a[1] - b[1]) > 16 || Math.abs(a[2] - b[2]) > 16) changed += 1;
    }
  }
  if (!total) return null;
  return changed / total > 0.002;
}

async function captureWindowPpm(window, { run = defaultRun, which = findExecutable, env = process.env, capture = null, tmpdir = os.tmpdir() } = {}) {
  if (typeof capture === "function") return capture(window);
  const importBin = which("import", env);
  if (!importBin) return null;
  const file = path.join(tmpdir, `ad-teleagent-composer-${process.pid}-${Date.now()}.ppm`);
  try {
    const shot = await run(importBin, ["-window", String(window.id), file], { env, timeout: 10000 });
    if (!shot.ok) return null;
    return parsePpm(fs.readFileSync(file));
  } catch {
    return null;
  } finally {
    try { fs.rmSync(file, { force: true }); } catch { /* 清理失败不影响结果 */ }
  }
}

// 写剪贴板：优先 Obsidian 自带 Electron clipboard（无外部依赖），失败回退 xclip。
export async function writeClipboard(text, { clipboard = null, run = defaultRun, xclip = "", env = process.env } = {}) {
  const value = String(text ?? "");
  const electron = clipboard || resolveElectronClipboard();
  if (electron && typeof electron.writeText === "function") {
    try {
      electron.writeText(value);
      const back = typeof electron.readText === "function" ? String(electron.readText() || "") : value;
      if (back !== value) return { ok: false, stage: "paste", error: t("剪贴板内容校验失败（写入后读回不一致）") };
      return { ok: true, source: "electron" };
    } catch (error) {
      return { ok: false, stage: "paste", error: t("写入系统剪贴板失败：{error}", { error: String((error && error.message) || error).slice(0, 200) }) };
    }
  }
  if (!xclip) {
    return { ok: false, stage: "dependency", error: t("缺少 Linux 派发依赖：{list}", { list: "clipboard(Electron clipboard 或 xclip)" }) };
  }
  // xclip 默认会 fork 成常驻的剪贴板 owner（等 close 会永远挂住），
  // 所以这里只等“接管选区”的一小段时间，读回校验通过就返回；
  // 用 -loops 限次，粘贴完成后由调用方 stop() 收尾。
  let child = null;
  let spawnError = "";
  try {
    child = spawn(xclip, ["-selection", "clipboard", "-loops", "32"], { stdio: ["pipe", "ignore", "ignore"], env, windowsHide: true });
    child.on("error", (error) => { spawnError = String((error && error.message) || error); });
  } catch (error) {
    return { ok: false, stage: "paste", error: t("写入系统剪贴板失败：{error}", { error: String((error && error.message) || error).slice(0, 200) }) };
  }
  const stop = () => { try { child.kill(); } catch { /* 已退出 */ } };
  try {
    child.stdin.end(value, "utf8");
  } catch (error) {
    stop();
    return { ok: false, stage: "paste", error: t("写入系统剪贴板失败：{error}", { error: String((error && error.message) || error).slice(0, 200) }) };
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (spawnError) {
    stop();
    return { ok: false, stage: "paste", error: t("写入系统剪贴板失败：{error}", { error: spawnError.slice(0, 200) }) };
  }
  // 读回校验：确认剪贴板里就是这次要粘贴的文本。
  const readBack = await run(xclip, ["-selection", "clipboard", "-o"], { env, timeout: 5000 });
  if (!readBack.ok || String(readBack.stdout || "").trim() !== value.trim()) {
    stop();
    return { ok: false, stage: "paste", error: t("剪贴板内容校验失败（写入后读回不一致）") };
  }
  return { ok: true, source: "xclip", stop };
}

export async function pasteClipboard({ run = defaultRun, xdotool, env = process.env } = {}) {
  const pasted = await run(xdotool, ["key", "--clearmodifiers", "ctrl+v"], { env });
  if (!pasted.ok) {
    return { ok: false, stage: "paste", error: t("粘贴到 TeleAgent 输入框失败：{error}", { error: String(pasted.error || pasted.stderr || "").slice(0, 200) }) };
  }
  return { ok: true };
}

// 执行一次 Linux 派发：定位窗口 → 焦点校验 → 点输入框 → 剪贴板写入 → Ctrl+V。
// 到这里就停：不点「运行」、不回车、不写库；返回 manualSubmit=true 让 UI 提示用户手动提交。
// 成功判据（提交后）仍走 verifyDispatchedSession 的只读 SQL；本阶段没有提交，所以 verified=false。
export async function dispatchTeleagentLinux(payload, deps = {}) {
  const platform = deps.platform || process.platform;
  if (platform !== "linux") {
    return { ok: false, stage: "platform", error: t("Linux 派发只在 Linux 可用") };
  }
  const normalized = normalizePayload(payload);
  if (!normalized.ok) return { ok: false, stage: "input", error: normalized.error };

  const env = deps.env || process.env;
  const run = deps.run || defaultRun;
  const which = deps.which || findExecutable;
  const environment = detectLinuxDispatchEnvironment({ env, which, clipboard: deps.clipboard || null });
  if (!environment.ok) {
    return {
      ok: false,
      stage: "dependency",
      error: t("缺少 Linux 派发依赖：{list}", { list: environment.missing.join("、") }),
      missing: environment.missing,
    };
  }

  const found = await findTeleAgentMainWindow({ run, xdotool: environment.xdotool, which, env });
  if (!found.ok) return found;
  const window = found.window;

  // 1) 合成器级激活：treeland 下 X11 的 windowactivate 无效，只有原生 helper 能真抬前台。
  const helper = deps.activationHelper !== undefined
    ? String(deps.activationHelper || "")
    : resolveActivationHelper({ env, which });
  if (helper) {
    const activated = await activateTeleAgentWindow({ run, helper, env });
    if (!activated.ok) return activated;
  } else {
    // 没有 helper 时只能在“用户已把 TeleAgent 切到前台”这个前提继续；
    // 否则绝不盲点/盲打（会点到 Obsidian 或把文本粘到错误窗口）。
    const focusCheck = await run(environment.xdotool, ["getwindowfocus"], { env });
    // getwindowfocus 在没有 X 焦点时本身会非零退出，那是正常状态，不要把原始命令错误当成焦点信息展示。
    const actual = focusCheck.ok ? String(focusCheck.stdout || "").trim() : "";
    if (!focusCheck.ok || actual !== String(window.id)) {
      return {
        ok: false,
        stage: "focus",
        error: t("缺少 treeland 窗口激活 helper：treeland-activate；treeland 下无法自动把 TeleAgent 切到前台。请先手动切到 TeleAgent 再派发（当前焦点：{actual}）", { actual: actual || t("未知（没有 X 焦点）") }),
      };
    }
  }

  const capture = deps.capture || null;
  const beforeShot = await captureWindowPpm(window, { run, which, env, capture, tmpdir: deps.tmpdir });
  const written = await writeClipboard(normalized.payload.text, {
    clipboard: deps.clipboard || null,
    run,
    xclip: environment.xclip,
    env,
  });
  if (!written.ok) return written;

  // 2) 单进程完成 focus + 点输入框 + Ctrl+V，避免跨进程焦点竞态。
  const pasted = await focusAndPaste(window, { run, xdotool: environment.xdotool, env });
  if (!pasted.ok) {
    if (typeof written.stop === "function") written.stop();
    return pasted;
  }
  // 给客户端一点时间读走剪贴板，再收尾 xclip 常驻进程。
  await new Promise((resolve) => setTimeout(resolve, 350));
  if (typeof written.stop === "function") written.stop();

  const afterShot = await captureWindowPpm(window, { run, which, env, capture, tmpdir: deps.tmpdir });
  const textVerified = composerLooksFilled(beforeShot, afterShot);

  return {
    ok: true,
    stage: "filled",
    manualSubmit: true,
    verified: false, // 没有提交，数据库里不会有新会话；提交后再走 verifyDispatchedSession
    verify: { found: false, reason: "not-submitted" },
    project: normalized.payload.project,
    chars: normalized.payload.text.length,
    window: { id: window.id, title: window.title, geometry: window.geometry, pid: window.pid || null },
    clipboard: written.source,
    textVerified,
    note: textVerified === false
      ? t("已填入，但未能自动确认输入框内容（没有截图工具），请目视确认后再点「运行」")
      : "",
  };
}

// 提交「运行」原语：**只给端到端实测或后续明确获批的调用方**用，必须显式 confirm:true；
// dispatchTeleagentLinux 不会调用它，生产默认行为停在“已填入 + 提示手动提交”。
// 坐标同样走窗口相对比例（RUN_POINT_RATIO），点击前用 geometryIsUsable 校验窗口几何。
export async function submitTeleAgentDispatch(window, options = {}) {
  const { run = defaultRun, xdotool, env = process.env, ratio = RUN_POINT_RATIO, confirm = false } = options;
  if (confirm !== true) return { ok: false, stage: "submit", error: t("提交需要显式确认（confirm:true）") };
  if (!geometryIsUsable(window && window.geometry)) {
    return { ok: false, stage: "submit", error: t("窗口几何异常（{width}×{height}），已中止以免点错位置", { width: (window && window.geometry && window.geometry.width) || "?", height: (window && window.geometry && window.geometry.height) || "?" }) };
  }
  const point = pointInWindow(window.geometry, ratio);
  const click = await run(xdotool, ["mousemove", "--window", String(window.id), String(point.x), String(point.y), "click", "1"], { env });
  if (!click.ok) {
    return { ok: false, stage: "submit", error: t("点击「运行」失败：{error}", { error: String(click.error || click.stderr || "").slice(0, 200) }) };
  }
  return { ok: true, stage: "submitted", point };
}
