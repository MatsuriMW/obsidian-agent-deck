// Linux 派发后端的契约测试：不驱动真实界面，只锁住“平台分流 / 依赖缺失 / 窗口选择 /
// 焦点校验 / 粘贴失败降级 / 填入后不自动提交”这些能用注入依赖验证的行为。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  COMPOSER_POINT_RATIO,
  RUN_POINT_RATIO,
  buildFocusPasteArgs,
  composerLooksFilled,
  detectLinuxDispatchEnvironment,
  dispatchTeleagentLinux,
  resolveActivationHelper,
  findTeleAgentMainWindow,
  geometryIsUsable,
  parsePpm,
  parseWindowGeometry,
  submitTeleAgentDispatch,
  writeClipboard,
} from "../src/teleagent-dispatch-linux.js";
import { DISPATCH_STAGES, runHandoffDispatch } from "../src/teleagent-dispatch.js";

const ok = (stdout = "") => ({ ok: true, code: 0, stdout, stderr: "", error: "" });
const fail = (error = "boom") => ({ ok: false, code: 1, stdout: "", stderr: error, error });

// 跨平台的可执行文件替身：process.execPath 是当前 Node 的绝对路径，每个平台都真实存在且可执行。
// 原先硬编码 /bin/true，Windows 上会被解析成 <盘符>:\bin\true 而不存在，导致三条断言失败。
const HELPER_BIN = process.execPath;

function makeClipboard(initial = "") {
  return {
    text: initial,
    writeText(value) { this.text = String(value); },
    readText() { return this.text; },
  };
}

// 一个可控的 xdotool / xprop 替身：默认让主窗 102 通过所有步骤。
function makeRunner({ focus = "102", pasteOk = true, searchIds = "101\n102\n103" } = {}) {
  const calls = [];
  const run = async (command, args = []) => {
    calls.push([command, ...args]);
    if (command === "/usr/bin/xdotool" || command === "xdotool") {
      if (args[0] === "search") return ok(searchIds);
      if (args[0] === "getwindowname") {
        if (args[1] === "101") return ok("TeleAgent Screenshot");
        if (args[1] === "102") return ok("TeleAgent 星辰超级智能体");
        return ok("teleagent");
      }
      if (args[0] === "getwindowgeometry") {
        const id = args[args.length - 1];
        if (id === "102") return ok("WINDOW=102\nX=176\nY=40\nWIDTH=1513\nHEIGHT=1005\nSCREEN=0\n");
        return ok("WINDOW=10\nX=10\nY=10\nWIDTH=10\nHEIGHT=10\nSCREEN=0\n");
      }
      if (args.includes("ctrl+v")) return pasteOk ? ok() : fail("ctrl+v 失败");
      if (args[0] === "windowfocus") return ok();
      if (args[0] === "getwindowfocus") return ok(focus);
      if (args[0] === "mousemove") return ok();
      if (args[0] === "key") return ok();
    }
    if (command === "/usr/bin/xprop" || command === "xprop") return ok("_NET_WM_PID(CARDINAL) = 50510\n");
    if (command === HELPER_BIN || command === "/usr/bin/treeland-activate") return ok("activated: TeleAgent 星辰超级智能体\n");
    return fail(`unexpected ${command} ${args.join(" ")}`);
  };
  return { run, calls };
}

const which = (name) => {
  if (name === "xdotool") return "/usr/bin/xdotool";
  if (name === "xprop") return "/usr/bin/xprop";
  if (name === "xclip") return "/usr/bin/xclip";
  return "";
};

test("Linux 后端只接受 linux，其他平台明确返回 platform", async () => {
  const result = await dispatchTeleagentLinux({ project: "p", text: "t" }, { platform: "darwin" });
  assert.equal(result.ok, false);
  assert.equal(result.stage, "platform");
});

test("缺 xdotool / 剪贴板时返回 dependency，并列出缺什么", async () => {
  const result = await dispatchTeleagentLinux(
    { project: "p", text: "t" },
    { platform: "linux", env: { DISPLAY: ":1", PATH: "" }, which: () => "", clipboard: null },
  );
  assert.equal(result.ok, false);
  assert.equal(result.stage, "dependency");
  assert.match(result.error, /xdotool/);
  assert.match(result.error, /clipboard/);
  assert.ok(Array.isArray(result.missing) && result.missing.length >= 2);
});

test("依赖探测：DISPLAY + xdotool + Electron 剪贴板都齐时通过", () => {
  const det = detectLinuxDispatchEnvironment({
    env: { DISPLAY: ":1", PATH: "/usr/bin" },
    which: (name) => (name === "xdotool" ? "/usr/bin/xdotool" : ""),
    clipboard: makeClipboard(),
  });
  assert.equal(det.ok, true);
  assert.equal(det.clipboard, "electron");
  assert.deepEqual(det.missing, []);
});

test("窗口定位：排除 Screenshot/小窗，选面积最大的主窗并记录几何与 _NET_WM_PID", async () => {
  const { run } = makeRunner();
  const found = await findTeleAgentMainWindow({ run, xdotool: "/usr/bin/xdotool", which, env: {} });
  assert.equal(found.ok, true);
  assert.equal(found.window.id, "102");
  assert.equal(found.window.title, "TeleAgent 星辰超级智能体");
  assert.deepEqual(found.window.geometry, { x: 176, y: 40, width: 1513, height: 1005 });
  assert.equal(found.window.pid, 50510);
});

test("几何解析与可用性：正常窗口通过，10×10 辅助窗不通过", () => {
  assert.deepEqual(parseWindowGeometry("WINDOW=102\nX=176\nY=40\nWIDTH=1513\nHEIGHT=1005\nSCREEN=0"), { x: 176, y: 40, width: 1513, height: 1005 });
  assert.equal(geometryIsUsable({ x: 0, y: 0, width: 1513, height: 1005 }), true);
  assert.equal(geometryIsUsable({ x: 0, y: 0, width: 10, height: 10 }), false);
});

test("焦点校验失败立即中止，不点输入框、不写剪贴板", async () => {
  const { run, calls } = makeRunner({ focus: "999" });
  const result = await dispatchTeleagentLinux(
    { project: "p", text: "t" },
    { platform: "linux", env: { DISPLAY: ":1", PATH: "/usr/bin" }, which, run, clipboard: makeClipboard() },
  );
  assert.equal(result.ok, false);
  assert.equal(result.stage, "focus");
  assert.equal(calls.some((call) => call.includes("mousemove")), false);
  assert.equal(calls.some((call) => call.includes("ctrl+v")), false);
});

test("Ctrl+V 失败返回 paste，不静默当成已填入", async () => {
  const { run } = makeRunner({ pasteOk: false });
  const result = await dispatchTeleagentLinux(
    { project: "p", text: "t" },
    { platform: "linux", env: { DISPLAY: ":1", PATH: "/usr/bin" }, which, run, clipboard: makeClipboard() },
  );
  assert.equal(result.ok, false);
  assert.equal(result.stage, "paste");
});

test("成功路径：填入后停在 filled/manualSubmit，绝不自动点「运行」", async () => {
  const { run, calls } = makeRunner();
  const clipboard = makeClipboard();
  const result = await dispatchTeleagentLinux(
    { project: "p", text: "请回复：收到" },
    { platform: "linux", env: { DISPLAY: ":1", PATH: "/usr/bin" }, which, run, clipboard, capture: async () => null },
  );
  assert.equal(result.ok, true);
  assert.equal(result.stage, "filled");
  assert.equal(result.manualSubmit, true);
  assert.equal(result.verified, false);
  assert.equal(result.verify.reason, "not-submitted");
  assert.equal(result.chars, "请回复：收到".length);
  assert.equal(clipboard.text, "请回复：收到");

  // 只点了输入框的相对坐标，没有点「运行」的坐标
  const composer = calls.find((call) => call.includes("mousemove"));
  assert.ok(composer, "应该点一次输入框");
  // 单进程批：["/usr/bin/xdotool","windowfocus","102","getwindowfocus","mousemove","--window","102",x,y,"click","1","key","--clearmodifiers","ctrl+v"]
  assert.equal(composer[1], "windowfocus");
  assert.equal(composer[2], "102");
  assert.equal(composer[4], "mousemove");
  assert.equal(composer[6], "102");
  assert.equal(composer[7], String(Math.round(1513 * COMPOSER_POINT_RATIO.x)));
  assert.equal(composer[8], String(Math.round(1005 * COMPOSER_POINT_RATIO.y)));
  assert.ok(composer.includes("ctrl+v"), "批处理里必须包含 Ctrl+V");
  const runX = String(Math.round(1513 * RUN_POINT_RATIO.x));
  const runY = String(Math.round(1005 * RUN_POINT_RATIO.y));
  assert.equal(calls.some((call) => call.includes("mousemove") && call[7] === runX && call[8] === runY), false);
});

test("激活 helper：可显式注入/环境变量/PATH 探测；缺失时返回 focus 且不点不粘", async () => {
  assert.equal(resolveActivationHelper({ explicit: HELPER_BIN, env: {}, which: () => "" }), HELPER_BIN);
  assert.equal(resolveActivationHelper({ env: { AGENT_DECK_TREELAND_ACTIVATE: HELPER_BIN }, which: () => "" }), HELPER_BIN);
  assert.equal(resolveActivationHelper({ env: {}, which: (name) => (name === "treeland-activate" ? HELPER_BIN : "") }), HELPER_BIN);
  assert.equal(resolveActivationHelper({ env: {}, which: () => "" }), "");

  const { run, calls } = makeRunner({ focus: "999" });
  const blocked = await dispatchTeleagentLinux(
    { project: "p", text: "t" },
    { platform: "linux", env: { DISPLAY: ":1", PATH: "/usr/bin" }, which, run, clipboard: makeClipboard(), activationHelper: "" },
  );
  assert.equal(blocked.ok, false);
  assert.equal(blocked.stage, "focus");
  assert.match(blocked.error, /treeland-activate/);
  assert.equal(calls.some((call) => call.includes("mousemove")), false);
  assert.equal(calls.some((call) => call.includes("ctrl+v")), false);

  const { run: run2, calls: calls2 } = makeRunner();
  const ok2 = await dispatchTeleagentLinux(
    { project: "p", text: "t" },
    { platform: "linux", env: { DISPLAY: ":1", PATH: "/usr/bin" }, which, run: run2, clipboard: makeClipboard(), activationHelper: HELPER_BIN, capture: async () => null },
  );
  assert.equal(ok2.ok, true);
  assert.equal(ok2.stage, "filled");
  assert.ok(calls2.some((call) => call[0] === HELPER_BIN), "应先调用激活 helper");
  assert.ok(calls2.some((call) => call.includes("ctrl+v")), "激活后应走单进程粘贴");
});

test("buildFocusPasteArgs 把 focus/点击/粘贴合并成一次 xdotool 调用", () => {
  const args = buildFocusPasteArgs({ id: "102", geometry: { x: 0, y: 0, width: 1513, height: 1005 } });
  assert.deepEqual(args.slice(0, 4), ["windowfocus", "102", "getwindowfocus", "mousemove"]);
  assert.ok(args.includes("click") && args.includes("ctrl+v"));
});

test("提交原语必须显式 confirm:true；未确认时不动鼠标", async () => {
  const calls = [];
  const run = async (command, args) => { calls.push([command, ...args]); return ok(); };
  const window = { id: "102", geometry: { x: 176, y: 40, width: 1513, height: 1005 } };
  const blocked = await submitTeleAgentDispatch(window, { run, xdotool: "/usr/bin/xdotool", env: {} });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.stage, "submit");
  assert.equal(calls.length, 0);

  const done = await submitTeleAgentDispatch(window, { run, xdotool: "/usr/bin/xdotool", env: {}, confirm: true });
  assert.equal(done.ok, true);
  assert.equal(done.point.x, Math.round(1513 * RUN_POINT_RATIO.x));
  assert.equal(done.point.y, Math.round(1005 * RUN_POINT_RATIO.y));
});

test("workbuddy 等其它 Agent 不受影响；linux 只在注入 dispatchLinux 时才派发", async () => {
  let linux = 0;
  let win = 0;
  const dispatchLinux = async (payload) => { linux += 1; return { ok: true, stage: "filled", manualSubmit: true, project: payload.project }; };
  const dispatch = async () => { win += 1; return { ok: true, stage: "sent", verified: true }; };

  assert.deepEqual(await runHandoffDispatch({ agent: "workbuddy", autoSend: true, projectName: "p", text: "t", platform: "linux" }), { skipped: "not-requested" });
  assert.deepEqual(await runHandoffDispatch({ agent: "teleagent", autoSend: true, projectName: "p", text: "t", platform: "linux" }), { skipped: "platform" });
  assert.deepEqual(await runHandoffDispatch({ agent: "teleagent", autoSend: true, projectName: "p", text: "t", platform: "darwin" }), { skipped: "platform" });

  const linuxHit = await runHandoffDispatch({ agent: "teleagent", autoSend: true, projectName: "p", text: "t", platform: "linux", dispatch, dispatchLinux });
  assert.equal(linuxHit.stage, "filled");
  assert.equal(linux, 1);
  assert.equal(win, 0);

  const winHit = await runHandoffDispatch({ agent: "teleagent", autoSend: true, projectName: "p", text: "t", platform: "win32", dispatch, dispatchLinux });
  assert.equal(winHit.stage, "sent");
  assert.equal(win, 1);
});

test("PPM 解析与“输入框是否变化”的判据", () => {
  const ppm = (w, h, fill) => {
    const data = Buffer.alloc(w * h * 3, fill);
    return Buffer.concat([Buffer.from(`P6\n${w} ${h}\n255\n`, "ascii"), data]);
  };
  const before = parsePpm(ppm(200, 200, 0));
  const same = parsePpm(ppm(200, 200, 0));
  const afterBytes = ppm(200, 200, 0);
  // 在输入框区域涂一块亮色，模拟出现文字
  for (let y = 140; y < 160; y += 1) {
    for (let x = 70; x < 180; x += 1) {
      const offset = 16 + (y * 200 + x) * 3;
      afterBytes[offset] = 255;
      afterBytes[offset + 1] = 255;
      afterBytes[offset + 2] = 255;
    }
  }
  const after = parsePpm(afterBytes);
  assert.equal(before.width, 200);
  assert.equal(composerLooksFilled(before, same), false);
  assert.equal(composerLooksFilled(before, after), true);
  assert.equal(composerLooksFilled(null, after), null);

  // 16-bit PPM：每通道 2 字节，采样必须读高字节而不是相邻通道的低字节
  const ppm16 = Buffer.concat([Buffer.from("P6\n2 2\n65535\n", "ascii"), Buffer.from([
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    255, 255, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0,
  ])]);
  const sixteen = parsePpm(ppm16);
  assert.equal(sixteen.channels, 6);
  assert.equal(sixteen.width, 2);
  assert.equal(sixteen.height, 2);
});

test("写剪贴板：Electron 可用时读回一致；缺 xclip 时返回 dependency", async () => {
  const clipboard = makeClipboard();
  const viaElectron = await writeClipboard("中文测试", { clipboard });
  assert.equal(viaElectron.ok, true);
  assert.equal(viaElectron.source, "electron");
  assert.equal(clipboard.text, "中文测试");

  const missing = await writeClipboard("x", { clipboard: null, xclip: "", run: async () => ok() });
  assert.equal(missing.ok, false);
  assert.equal(missing.stage, "dependency");
});

test("失败阶段都登记在 DISPATCH_STAGES，且模块不引入网络请求", () => {
  for (const stage of ["dependency", "focus", "paste", "submit"]) {
    assert.ok(DISPATCH_STAGES.includes(stage), `未登记的阶段：${stage}`);
  }
  const source = fs.readFileSync(path.join(import.meta.dirname, "../src/teleagent-dispatch-linux.js"), "utf8");
  assert.equal(/https?:\/\//.test(source), false);
  assert.equal(/\bfetch\s*\(/.test(source), false);
  assert.equal(/node:https?/.test(source), false);
});
