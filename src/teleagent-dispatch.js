// TeleAgent「人在场的一键派发」：经 Windows UI Automation 驱动正在运行的桌面客户端，
// 走完「新建任务 → 选项目 → 校验默认权限/旗舰 → 填入文本 → 运行」。
//
// 三条设计约束（依据 docs/specs/teleagent-uia-automation.zh-CN.md 的实测结论）：
// 1. 客户端没有 AutomationId，只能按「ControlType + Name」定位，文案变了就要改选择器；
// 2. 输入框是 Slate 富文本，`ValuePattern.SetValue` 只改 DOM、不会让「运行」变可用，
//    必须 SetFocus + SendInput 逐字符注入（中文用 KEYEVENTF_UNICODE，不需要输入法）；
// 3. 派发会抢占前台焦点并占用键盘，因此只做“人在场的一次一条”，不做后台批量。
//
// 本模块只负责“把一次派发跑完并回报结构化结果”，不碰入库、不改设置、不抬版本号。
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { t } from "./i18n.js";
import { teleAgentDatabases } from "./teleagent.js";
import { querySqliteRowsSync } from "./sqlite.js";

// 失败时回报的阶段名，前端/日志按它定位卡点，不要只说“失败了”。
export const DISPATCH_STAGES = [
  "platform", // 当前平台没有派发后端（Windows / Linux 之外）
  "dependency", // Linux：外部依赖缺失（xdotool / 剪贴板）
  "input", // 载荷不合法
  "spawn", // PowerShell 起不来
  "attach", // 找不到主窗口 / 无障碍树没准备好
  "newtask", // 点不到“新建任务”
  "composer", // 撰写面板没出来（找不到输入框）
  "project", // 项目选择器打不开或选不中
  "mode", // 执行模式不是「默认权限」
  "model", // 模型不是「旗舰」
  "focus", // Linux：windowfocus 后 getwindowfocus 校验失败
  "typing", // 注入后文本读不回
  "paste", // Linux：剪贴板写入或 Ctrl+V 失败
  "submit", // 「运行」一直不可用或点不动（Linux 端到端测试才用）
  "timeout", // 整体超时
  "protocol", // 脚本输出不是可解析的结果
];

const MAX_TEXT = 4000;

// 载荷规范化：项目名与文本必填；节奏与超时给默认值；不改用户文本内容（换行保留，
// 由脚本用 Shift+Enter 注入，避免 Enter 直接提交）。
export function normalizePayload(payload, options = {}) {
  const raw = payload || {};
  const project = String(raw.project || "").trim();
  const text = String(raw.text || "");
  if (!project) return { ok: false, error: t("缺少项目名（project）") };
  if (!text.trim()) return { ok: false, error: t("缺少要派发的文本（text）") };
  if (text.length > MAX_TEXT) return { ok: false, error: t("文本超过 {n} 字上限", { n: MAX_TEXT }) };
  const paceMs = Number(raw.paceMs || options.paceMs || 25);
  const stepTimeoutMs = Number(raw.stepTimeoutMs || options.stepTimeoutMs || 15000);
  return {
    ok: true,
    payload: {
      project,
      text,
      mode: String(raw.mode || "default"),
      model: String(raw.model || "flagship"),
      paceMs: Number.isFinite(paceMs) && paceMs > 0 ? Math.min(paceMs, 200) : 25,
      stepTimeoutMs: Number.isFinite(stepTimeoutMs) && stepTimeoutMs > 0 ? stepTimeoutMs : 15000,
    },
  };
}

// 载荷经 Base64 传给 PowerShell：用户文本里可能出现引号、$、反引号、换行，
// 直接拼进脚本会有注入与转义两类事故，Base64 一次性绕开。
export function encodePayload(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

export function buildDispatchArgs(scriptPath, payload) {
  return [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-PayloadB64",
    typeof payload === "string" ? payload : encodePayload(payload),
  ];
}

// PowerShell 侧脚本。要点：
// - 第一次 Attach 时 Chromium 的无障碍引擎是“惰性启用”的，元素树可能不全，所以每步都重试；
// - 选择器按“标签按钮 + 相对位置”或“ControlType + Name”定位，同名元素用坐标消歧；
// - 只在「运行」真正可用（IsEnabled=True）时才提交，这是“输入已进入 React 状态”的唯一可靠信号。
export const POWERSHELL_SCRIPT = `param([Parameter(Mandatory=$true)][string]$PayloadB64)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Send-Result($o) { ($o | ConvertTo-Json -Compress -Depth 6) }

function Fail($stage, $error) {
  Send-Result @{ ok = $false; stage = $stage; error = $error }
  exit 2
}

$json = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($PayloadB64))
$payload = $json | ConvertFrom-Json
$project = [string]$payload.project
$text = [string]$payload.text
$paceMs = [int]$payload.paceMs
$stepMs = [int]$payload.stepTimeoutMs
if ($paceMs -le 0) { $paceMs = 25 }
if ($stepMs -le 0) { $stepMs = 15000 }

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$CT = [System.Windows.Automation.ControlType]
$COND = [System.Windows.Automation.Condition]

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class AdInput {
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public int type; public Union u; }
  [StructLayout(LayoutKind.Explicit)] struct Union { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint flags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk; public ushort scan; public uint flags; public uint time; public IntPtr extra; }
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] p, int cb);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  static void Key(ushort vk, ushort scan, uint flags) {
    INPUT[] a = new INPUT[1];
    a[0].type = 1;
    a[0].u.ki.vk = vk;
    a[0].u.ki.scan = scan;
    a[0].u.ki.flags = flags;
    SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void TypeChar(char c) { Key(0, (ushort)c, 0x0004); Key(0, (ushort)c, 0x0006); }
  public static void ShiftEnter() { Key(0x10, 0, 0); Key(0x0D, 0, 0); Key(0x0D, 0, 0x0002); Key(0x10, 0, 0x0002); }
}
'@

function Find-First($root, $ct) {
  $c = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $ct)
  return $root.FindFirst($TS::Descendants, $c)
}

function Find-Name($root, $ct, $name) {
  $c = New-Object System.Windows.Automation.AndCondition(
    (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $ct)),
    (New-Object System.Windows.Automation.PropertyCondition($AE::NameProperty, $name))
  )
  return $root.FindFirst($TS::Descendants, $c)
}

function Find-All($root, $ct) {
  $c = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $ct)
  return $root.FindAll($TS::Descendants, $c)
}

# React 是分批渲染的：输入框先出现、工具条与标签后出现，单次查找会误判“不存在”，
# 所以每个关键控件都要带超时重试，而不是查一次就 Fail。
function Wait-Name($root, $ct, $name, $timeoutMs) {
  $deadline = [DateTime]::UtcNow.AddMilliseconds($timeoutMs)
  while ([DateTime]::UtcNow -lt $deadline) {
    $el = Find-Name $root $ct $name
    if ($el -ne $null) { return $el }
    Start-Sleep -Milliseconds 250
  }
  return $null
}

# 展开/收起必须幂等：点中下拉条目后浮层会自己关掉，此时再 Collapse 会抛
# “Operation is not valid due to the current state of the object”，整条流程就被这一句打断。
function Safe-Expand($el) {
  try {
    $ec = $el.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
    if ($ec.Current.ExpandCollapseState -ne [System.Windows.Automation.ExpandCollapseState]::Expanded) { $ec.Expand() }
  } catch { }
}

function Safe-Collapse($el) {
  try {
    $ec = $el.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
    if ($ec.Current.ExpandCollapseState -ne [System.Windows.Automation.ExpandCollapseState]::Collapsed) { $ec.Collapse() }
  } catch { }
}

function Get-Rect($el) { return $el.Current.BoundingRectangle }

# 1) 找主窗口：按进程枚举顶层窗口，标题以 TeleAgent 开头（宠物窗“小豆子”是同一进程的另一窗口，要排除）
$main = $null
for ($i = 0; $i -lt 20; $i++) {
  $pids = @(Get-Process -Name 'TeleAgent' -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  if ($pids.Count -gt 0) {
    $wins = $AE::RootElement.FindAll($TS::Children, $COND::TrueCondition)
    for ($k = 0; $k -lt $wins.Count; $k++) {
      $w = $wins.Item($k)
      if (($pids -contains $w.Current.ProcessId) -and ($w.Current.Name -like 'TeleAgent*')) { $main = $w }
    }
  }
  if ($main -ne $null) {
    $doc = $main.FindFirst($TS::Descendants, (New-Object System.Windows.Automation.PropertyCondition($AE::AutomationIdProperty, 'RootWebArea')))
    if ($doc -ne $null) { Start-Sleep -Milliseconds 300; $doc = $main.FindFirst($TS::Descendants, (New-Object System.Windows.Automation.PropertyCondition($AE::AutomationIdProperty, 'RootWebArea'))) }
    if ($doc -ne $null) { break }
  }
  Start-Sleep -Milliseconds 500
}
if ($main -eq $null) { Fail 'attach' '找不到 TeleAgent 主窗口（客户端没开或无障碍树没就绪）' }

# 2) 点侧栏「新建任务」：同名按钮在每组任务行上也有，取 Y 最小的那个（侧栏顶部的全局入口）
$newTask = $null
$minY = 1e9
$btns = Find-All $main $CT::Button
for ($i = 0; $i -lt $btns.Count; $i++) {
  $b = $btns.Item($i)
  if ($b.Current.Name -eq '新建任务') {
    $r = Get-Rect $b
    if ($r.Width -gt 0 -and $r.Y -lt $minY) { $newTask = $b; $minY = $r.Y }
  }
}
if ($newTask -eq $null) { Fail 'newtask' '侧栏没有可见的「新建任务」' }
$newTask.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()

# 3) 等撰写面板：输入框出现
$edit = $null
for ($i = 0; $i -lt 40; $i++) {
  $edit = Find-First $main $CT::Edit
  if ($edit -ne $null) { break }
  Start-Sleep -Milliseconds 250
}
if ($edit -eq $null) { Fail 'composer' '撰写面板没有出现（找不到输入框）' }

# 4) 选项目：项目选择器是「运行环境」标签右侧的那个 ExpandCollapse 按钮，展开后点同名条目
$label = Wait-Name $main $CT::Button '运行环境' $stepMs
if ($label -eq $null) { Fail 'project' '找不到「运行环境」选择器' }
Start-Sleep -Milliseconds 400
$labelRect = Get-Rect $label
$selector = $null
$expandables = Find-All $main $CT::Button
for ($i = 0; $i -lt $expandables.Count; $i++) {
  $b = $expandables.Item($i)
  $pats = $b.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName }
  if ($pats -notcontains 'ExpandCollapsePatternIdentifiers.Pattern') { continue }
  $r = Get-Rect $b
  if ($r.Width -le 0) { continue }
  if ([Math]::Abs($r.Y - $labelRect.Y) -lt 10 -and $r.X -gt $labelRect.X -and $r.X -lt $labelRect.Right + 400) { $selector = $b }
}
if ($selector -eq $null) { Fail 'project' '找不到项目选择器' }
$selRect = Get-Rect $selector
Safe-Expand $selector
Start-Sleep -Milliseconds 800

# 下拉浮层里的条目与侧栏条目同名，用 X > 600（内容区起点）筛掉侧栏那颗；
# 选择器自身的 Name 也等于当前项目名，再按 Y 排除它自己，否则会点到只支持 ExpandCollapse 的按钮上。
$target = $null
$cands = Find-All $main $CT::Button
for ($i = 0; $i -lt $cands.Count; $i++) {
  $b = $cands.Item($i)
  if ($b.Current.Name -ne $project) { continue }
  $r = Get-Rect $b
  if ($r.Width -le 0) { continue }
  if ([Math]::Abs($r.Y - $selRect.Y) -lt 12) { continue }
  if ($r.X -gt 600 -and $r.Y -gt 200) { $target = $b; break }
}
if ($target -eq $null) { Fail 'project' ('下拉里没有项目：' + $project) }
$target.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
Start-Sleep -Milliseconds 800
Safe-Collapse $selector
if ($selector.Current.Name -ne $project) { Fail 'project' ('项目回读不一致：' + $selector.Current.Name) }

# 5) 校验执行模式 = 默认权限（只读校验，不替用户改设置）
$modeBtn = Wait-Name $main $CT::Button '执行模式' $stepMs
if ($modeBtn -eq $null) { Fail 'mode' '找不到「执行模式」' }
Safe-Expand $modeBtn
Start-Sleep -Milliseconds 600
$radios = Find-All $main $CT::RadioButton
$modeOk = $false
for ($i = 0; $i -lt $radios.Count; $i++) {
  $r = $radios.Item($i)
  if ($r.Current.Name -like '默认权限*') {
    $sel = $r.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
    if ($sel.Current.IsSelected) { $modeOk = $true }
  }
}
Safe-Collapse $modeBtn
if (-not $modeOk) { Fail 'mode' '执行模式不是「默认权限」，已中止（不改用户设置）' }

# 6) 校验模型 = 旗舰（Toggle 按钮，真假看 ToggleState）
$modelBtn = Wait-Name $main $CT::Button '选择模型' $stepMs
if ($modelBtn -eq $null) { Fail 'model' '找不到「选择模型」' }
Safe-Expand $modelBtn
Start-Sleep -Milliseconds 600
$toggles = Find-All $main $CT::Button
$modelOk = $false
for ($i = 0; $i -lt $toggles.Count; $i++) {
  $b = $toggles.Item($i)
  if ($b.Current.Name -like '旗舰*') {
    $tp = $b.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
    if ($tp.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On) { $modelOk = $true }
  }
}
Safe-Collapse $modelBtn
if (-not $modelOk) { Fail 'model' '模型不是「旗舰」，已中止（不改用户设置）' }

# 7) 填文本：必须先置前 + SetFocus，再逐字符注入；换行用 Shift+Enter，避免 Enter 直接提交
[void][AdInput]::ShowWindow([IntPtr]$main.Current.NativeWindowHandle, 9)
[void][AdInput]::SetForegroundWindow([IntPtr]$main.Current.NativeWindowHandle)
Start-Sleep -Milliseconds 400
$edit.SetFocus()
Start-Sleep -Milliseconds 300
# 按行注入：行内逐字符 Unicode 直出，行与行之间用 Shift+Enter（Enter 会直接提交）
$lines = $text -split "\r?\n"
for ($li = 0; $li -lt $lines.Count; $li++) {
  if ($li -gt 0) { [AdInput]::ShiftEnter(); Start-Sleep -Milliseconds $paceMs }
  $chars = $lines[$li].ToCharArray()
  for ($ci = 0; $ci -lt $chars.Length; $ci++) {
    [AdInput]::TypeChar($chars[$ci])
    Start-Sleep -Milliseconds $paceMs
  }
}
Start-Sleep -Milliseconds 600

$vp = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
$shown = ([string]$vp.Current.Value).Replace([string][char]0xFEFF, '') -replace "\r", ''
$expect = $text.Trim() -replace "\r", ''
if ($shown.Trim() -ne $expect) { Fail 'typing' ('注入后读回不一致，读到 ' + $shown.Length + ' 字') }

# 8) 提交：等到「运行」可用再点，这是“输入已进入 React 状态”的唯一可靠信号
$runBtn = Wait-Name $main $CT::Button '运行' $stepMs
if ($runBtn -eq $null) { Fail 'submit' '找不到「运行」' }
for ($i = 0; $i -lt 40; $i++) {
  if ($runBtn.Current.IsEnabled) { break }
  Start-Sleep -Milliseconds 250
}
if (-not $runBtn.Current.IsEnabled) { Fail 'submit' '「运行」一直不可用，输入可能没被接受' }
$runBtn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
Start-Sleep -Milliseconds 1200

Send-Result @{ ok = $true; stage = 'sent'; project = $project; chars = $text.Length }
exit 0
`;

// 派发后的回读校验：界面上点了“运行”不等于任务真的落库，所以再用只读 SQL 查一次
// 客户端的会话库，确认「同一项目目录 + 新出现的会话 + 正文包含这次文本」三者同时成立。
// 只读 SELECT，不写库、不发网络请求；查不到就如实回报 found=false，让上层提示“还没查到”。
const sqlQuote = (value) => "'" + String(value).replaceAll("'", "''") + "'";

function defaultRunSql(db, sql) {
  const rows = querySqliteRowsSync(db, sql, { throwOnError: true });
  return rows.map((row) => {
    const vals = Object.values(row || {});
    return vals.length === 1 ? String(vals[0] ?? "") : JSON.stringify(row);
  }).join("\n");
}

function parseJsonLines(output) {
  return String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

export function verifyDispatchedSession({ project, text, sinceMs, dbs, runSql } = {}) {
  const run = runSql || defaultRunSql;
  const proj = String(project || "").trim();
  if (!proj) return { found: false, reason: "no-project" };
  const since = Number.isFinite(Number(sinceMs)) ? Math.max(0, Number(sinceMs)) : Date.now() - 120000;
  const prefix = String(text || "").replace(/\s+/g, " ").trim().slice(0, 40);
  const bases = Array.isArray(dbs) ? dbs : teleAgentDatabases();

  for (const db of bases) {
    let rows = [];
    try {
      rows = parseJsonLines(run(db, `SELECT json_object('id',id,'title',title,'created',time_created) FROM session WHERE time_created >= ${Math.floor(since)} AND directory LIKE ${sqlQuote("%" + proj + "%")} ORDER BY time_created DESC LIMIT 5;`));
    } catch {
      continue; // 这个库读不了就换下一个（可能被占用或还没建）
    }
    for (const row of rows) {
      if (!row || !row.id) continue;
      if (!prefix) return { found: true, db, ...row };
      let body = "";
      try {
        body = run(db, `SELECT replace(coalesce(json_extract(data,'$.text'),''),char(10),' ') FROM part WHERE session_id=${sqlQuote(row.id)} AND json_extract(data,'$.type')='text' ORDER BY time_created LIMIT 2;`);
      } catch {
        continue;
      }
      if (String(body || "").replace(/\s+/g, " ").includes(prefix)) return { found: true, db, ...row };
    }
  }
  return { found: false, reason: "not-found" };
}

// handoff 接线层的可测入口：判断“这次交接要不要顺手自动派发”，并把结果原样带回。
// 只有四个条件同时成立才会真的派发：用户点了自动发送、目标就是 TeleAgent、当前平台有
// 派发后端（Windows / Linux）、并且有项目名——没有项目名就退回复制交接，绝不猜目录。
// Linux 后端由调用方注入（dispatchLinux），本模块不反向依赖它，保持模块图无环。
export async function runHandoffDispatch({
  agent,
  autoSend,
  projectName,
  text,
  platform = process.platform,
  dispatch = dispatchTeleagentTask,
  dispatchLinux = null,
} = {}) {
  if (!autoSend || agent !== "teleagent") return { skipped: "not-requested" };
  if (platform !== "win32" && platform !== "linux") return { skipped: "platform" };
  const project = String(projectName || "").trim();
  if (!project) return { skipped: "no-project" };
  if (platform === "linux") {
    if (typeof dispatchLinux !== "function") return { skipped: "platform" };
    const result = await dispatchLinux({ project, text: String(text || "") });
    return { ...result, project };
  }
  const result = await dispatch({ project, text: String(text || "") });
  return { ...result, project };
}

// 解析脚本输出：取最后一行能解析成 JSON 的对象；前面的噪声（警告等）不算失败。
export function parseDispatchOutput(stdout) {
  const lines = String(stdout || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (parsed && typeof parsed === "object" && "ok" in parsed) return parsed;
    } catch { /* 继续往上找 */ }
  }
  return null;
}

function resolveShell(deps) {
  if (deps.exe) return deps.exe;
  return process.platform === "win32" ? "pwsh.exe" : "pwsh";
}

// 提交成功后再回读数据库确认落地；刚写完可能还没落盘，所以带三次短重试。
async function attachVerification(result, payload, startedAt, deps) {
  const verify = deps.verify || verifyDispatchedSession;
  let check = { found: false, reason: "not-checked" };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      check = verify({ project: payload.project, text: payload.text, sinceMs: startedAt - 5000, dbs: deps.dbs });
    } catch (error) {
      check = { found: false, reason: String((error && error.message) || error) };
      break;
    }
    if (check && check.found) break;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return { verified: Boolean(check && check.found), verify: check };
}

// 执行一次派发。deps 只为测试注入（spawn/fs/os/path/platform/tmpdir），生产不传。
export async function dispatchTeleagentTask(payload, deps = {}) {
  const platform = deps.platform || process.platform;
  if (platform !== "win32") {
    return { ok: false, stage: "platform", error: t("UI Automation 派发只在 Windows 可用") };
  }
  const normalized = normalizePayload(payload);
  if (!normalized.ok) return { ok: false, stage: "input", error: normalized.error };

  const fsMod = deps.fs || fs;
  const pathMod = deps.path || path;
  const tmpBase = deps.tmpdir || os.tmpdir();
  const spawnFn = deps.spawn || spawn;
  const timeoutMs = normalized.payload.stepTimeoutMs * 3;

  let dir = "";
  const startedAt = Date.now();
  try {
    dir = fsMod.mkdtempSync(pathMod.join(tmpBase, "ad-teleagent-dispatch-"));
    const scriptPath = pathMod.join(dir, "dispatch.ps1");
    fsMod.writeFileSync(scriptPath, POWERSHELL_SCRIPT, "utf8");
    const args = buildDispatchArgs(scriptPath, normalized.payload);

    const result = await new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      const done = (value) => { if (!settled) { settled = true; resolve(value); } };
      let child;
      try {
        child = spawnFn(resolveShell(deps), args, { windowsHide: true });
      } catch (error) {
        done({ ok: false, stage: "spawn", error: String(error && error.message || error) });
        return;
      }
      const timer = setTimeout(() => {
        try { child.kill(); } catch { /* 已经退出 */ }
        done({ ok: false, stage: "timeout", error: t("派发超时（{ms}ms）", { ms: timeoutMs }) });
      }, timeoutMs);
      child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
      child.on("error", (error) => {
        clearTimeout(timer);
        done({ ok: false, stage: "spawn", error: String(error && error.message || error) });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        const parsed = parseDispatchOutput(stdout);
        if (parsed) return done(parsed);
        done({ ok: false, stage: "protocol", error: (stderr || stdout || "").slice(-400) || `退出码 ${code}` });
      });
    });
    if (result && result.ok && deps.verify !== false) {
      return { ...result, ...(await attachVerification(result, normalized.payload, startedAt, deps)) };
    }
    return result;
  } catch (error) {
    return { ok: false, stage: "spawn", error: String(error && error.message || error) };
  } finally {
    if (dir) {
      try { fsMod.rmSync(dir, { recursive: true, force: true }); } catch { /* 清理失败不影响结果 */ }
    }
  }
}
