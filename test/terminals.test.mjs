import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TERMINAL_REGISTRY, TERMINAL_NAME, getTerminalOptions, createTerminalController } from '../src/terminals.js';

function decodeWindowsCommand(encoded) {
  const script = Buffer.from(encoded, 'base64').toString('utf16le');
  assert.ok(script.includes("'/d /s /k \"' + $command + '\"'"));
  assert.match(script, /\[Diagnostics\.Process\]::Start/);
  const payload = /FromBase64String\('([^']+)'\)/.exec(script)?.[1];
  return Buffer.from(payload, 'base64').toString('utf8');
}

// 1. Registry & UI select options
{
  const ids = TERMINAL_REGISTRY.map((t) => t.id);
  for (const required of ['terminal', 'iterm', 'warp', 'ghostty', 'cmux', 'tmux', 'wezterm', 'kitty', 'alacritty', 'tern', 'herdr']) {
    assert.ok(ids.includes(required), `missing terminal in registry: ${required}`);
    assert.ok(TERMINAL_NAME[required], `missing TERMINAL_NAME for ${required}`);
  }
  const opts = getTerminalOptions('darwin');
  assert.equal(opts[0].id, 'auto');
  assert.deepEqual(opts.slice(1).map((o) => o.id), ids);
  assert.deepEqual(getTerminalOptions('win32').map((o) => o.id),
    ['auto', 'terminal', 'warp', 'tmux', 'wezterm', 'alacritty', 'tern', 'herdr']);
  console.log('PASS terminal registry and dropdown options');
}

// 2. pickTerminal: explicit selection, unavailable fallback, tmux auto-fallback exclusion
{
  const installed = new Set(['/opt/homebrew/bin/tmux', '/Applications/Ghostty.app', '/Applications/cmux.app']);
  const ctrl = createTerminalController({
    platform: 'darwin',
    home: () => '/Users/tester',
    existsSync: (p) => installed.has(p),
    readFile: async () => { throw new Error('ENOENT'); },
    runResult: async () => ({ ok: true, out: '' }),
  });

  assert.equal(await ctrl.pickTerminal('tmux'), 'tmux', 'explicit tmux works when binary exists');
  assert.equal(await ctrl.pickTerminal('cmux'), 'cmux', 'explicit cmux works when app exists');
  assert.equal(await ctrl.pickTerminal('kitty'), 'terminal', 'unavailable explicit terminal falls back to terminal');
  assert.equal(await ctrl.pickTerminal('auto'), 'cmux', 'auto picks highest-priority installed GUI terminal');

  // If only tmux is installed (no other GUI terminals), auto must NOT hijack to tmux; falls back to Terminal.app
  const tmuxOnly = createTerminalController({
    platform: 'darwin',
    home: () => '/Users/tester',
    existsSync: (p) => p === '/opt/homebrew/bin/tmux',
    readFile: async () => { throw new Error('ENOENT'); },
    runResult: async () => ({ ok: true, out: '' }),
  });
  assert.equal(await tmuxOnly.pickTerminal('auto'), 'terminal', 'auto does not pick tmux merely because binary is installed');
  assert.equal(await tmuxOnly.pickTerminal('tmux'), 'tmux', 'explicit tmux still works when only tmux is installed');

  // If a live claude process is running inside tmux, auto detects tmux
  const liveTmux = createTerminalController({
    platform: 'darwin',
    home: () => '/Users/tester',
    existsSync: (p) => p === '/opt/homebrew/bin/tmux',
    readFile: async () => { throw new Error('ENOENT'); },
    mkdir: async () => {},
    writeFile: async () => {},
    runResult: async (bin, args) => {
      if (bin === '/bin/ps' && args.includes('-ax')) return { ok: true, out: '  42 ttys001 claude\n' };
      if (bin === '/bin/ps' && args.includes('42')) return { ok: true, out: '10 /bin/zsh' };
      if (bin === '/bin/ps' && args.includes('10')) return { ok: true, out: '1 tmux: server' };
      return { ok: true, out: '' };
    },
  });
  assert.equal(await liveTmux.pickTerminal('auto'), 'tmux', 'auto detects active claude session inside tmux');
  console.log('PASS pickTerminal selection and tmux auto-detection guard');
}

// 3. openTerminal: cmux (background & foreground retry after app launch)
{
  const calls = [];
  let cmuxAttempts = 0;
  const ctrl = createTerminalController({
    platform: 'darwin',
    home: () => '/Users/tester',
    existsSync: (p) => [
      '/Applications/cmux.app',
      '/Applications/cmux.app/Contents/Resources/bin/cmux',
      '/bin/zsh',
      '/work/proj',
    ].includes(p),
    sleep: async () => {},
    runResult: async (bin, args) => {
      calls.push([bin, args]);
      if (bin.endsWith('/cmux')) {
        cmuxAttempts++;
        return { ok: cmuxAttempts >= 2, out: '' };
      }
      return { ok: true, out: '' };
    },
  });

  const used = await ctrl.openTerminal('claude --resume abc', '/work/proj', 'cmux', 'Fix Bug', { background: true });
  assert.equal(used, 'cmux');
  assert.equal(cmuxAttempts, 2, 'cmux retries once after launching app bundle');
  assert.ok(calls.some(([b, a]) => b === '/usr/bin/open' && a.includes('-g') && a.includes('com.cmuxterm.app')), 'background launch passes -g');
  const cmuxCall = calls.find(([b]) => b.endsWith('/cmux'));
  assert.ok(cmuxCall[1].includes('new-workspace'));
  assert.ok(cmuxCall[1].includes('--focus') && cmuxCall[1].includes('false'));
  assert.ok(cmuxCall[1].includes('--cwd') && cmuxCall[1].includes('/work/proj'));
  assert.ok(cmuxCall[1].includes('--name') && cmuxCall[1].includes('Fix Bug'));
  assert.ok(cmuxCall[1].includes('--command') && cmuxCall[1].includes('claude --resume abc'));
  console.log('PASS openTerminal cmux workspace creation and retry');
}

// 4. openTerminal: tmux (new session vs existing session + foreground attach)
{
  const calls = [];
  const fired = [];
  let sessionExists = false;
  const ctrl = createTerminalController({
    platform: 'darwin',
    home: () => '/Users/tester',
    existsSync: (p) => ['/opt/homebrew/bin/tmux', '/bin/zsh', '/work/proj'].includes(p),
    readFile: async () => { throw new Error('ENOENT'); },
    runResult: async (bin, args) => {
      calls.push([bin, args]);
      if (bin === '/opt/homebrew/bin/tmux' && args[0] === 'has-session') return { ok: sessionExists, out: '' };
      if (bin === '/opt/homebrew/bin/tmux' && args[0] === 'list-clients') return { ok: true, out: '' };
      return { ok: true, out: '' };
    },
    execFire: (bin, args) => { fired.push([bin, args]); return true; },
  });

  // First call: background, session doesn't exist -> new-session -d -s agent-deck
  assert.equal(await ctrl.openTerminal('codex resume 1', '/work/proj', 'tmux', 'Task 1', { background: true }), 'tmux');
  assert.ok(calls.some(([b, a]) => b.endsWith('/tmux') && a[0] === 'new-session' && a.includes('agent-deck')));
  assert.equal(fired.length, 0, 'background tmux does not open host terminal');

  // Second call: foreground, session exists, no attached clients -> new-window + opens Terminal.app running tmux attach-session
  sessionExists = true;
  calls.length = 0;
  assert.equal(await ctrl.openTerminal('codex resume 2', '/work/proj', 'tmux', 'Task 2', { background: false }), 'tmux');
  assert.ok(calls.some(([b, a]) => b.endsWith('/tmux') && a[0] === 'new-window' && a.includes('agent-deck') && !a.includes('-d')));
  assert.ok(fired.some(([b, a]) => b === '/usr/bin/osascript' && a[1].includes('attach-session -t agent-deck')), 'unattached foreground tmux attaches in host terminal');
  console.log('PASS openTerminal tmux session/window and foreground attach');
}

// 5. openTerminal: ghostty, wezterm, kitty, alacritty, and win32 terminal
{
  const calls = [];
  const fired = [];
  const detached = [];
  const ctrl = createTerminalController({
    platform: 'darwin',
    home: () => '/Users/tester',
    existsSync: (p) => [
      '/Applications/Ghostty.app',
      '/Applications/WezTerm.app',
      '/Applications/WezTerm.app/Contents/MacOS/wezterm',
      '/Applications/kitty.app',
      '/Applications/kitty.app/Contents/MacOS/kitty',
      '/Applications/Alacritty.app',
      '/bin/zsh',
      '/work/proj',
    ].includes(p),
    runResult: async (bin, args) => {
      calls.push([bin, args]);
      if (bin.endsWith('/wezterm') && args[0] === 'cli') return { ok: true, out: '1' };
      if (bin.endsWith('/kitty') && args[0] === '@') return { ok: false, out: '' };
      return { ok: true, out: '' };
    },
    execFire: (bin, args) => { fired.push([bin, args]); return true; },
    execDetached: (bin, args) => { detached.push([bin, args]); return true; },
  });

  assert.equal(await ctrl.openTerminal('claude', '/work/proj', 'ghostty', 'G', { background: true }), 'ghostty');
  assert.ok(fired.some(([b, a]) => b === '/usr/bin/open' && a.includes('-g') && a.includes('Ghostty.app') && a.includes('--working-directory=/work/proj')));

  assert.equal(await ctrl.openTerminal('claude', '/work/proj', 'wezterm', 'W', { background: false }), 'wezterm');
  assert.ok(calls.some(([b, a]) => b.endsWith('/wezterm') && a[0] === 'cli' && a[1] === 'spawn'));
  assert.ok(calls.some(([b, a]) => b === '/usr/bin/open' && a.includes('com.github.wez.wezterm')));

  assert.equal(await ctrl.openTerminal('claude', '/work/proj', 'kitty', 'K', { background: false }), 'kitty');
  assert.ok(calls.some(([b, a]) => b.endsWith('/kitty') && a[0] === '@' && a[1] === 'launch'));
  assert.ok(fired.some(([b, a]) => b === '/usr/bin/open' && a.includes('kitty.app')));

  assert.equal(await ctrl.openTerminal('claude', '/work/proj', 'alacritty', 'A', { background: true }), 'alacritty');
  assert.ok(fired.some(([b, a]) => b === '/usr/bin/open' && a.includes('-g') && a.includes('Alacritty.app')));

  // Windows fallback uses wt.exe if available
  const winDetached = [];
  const winCtrl = createTerminalController({
    platform: 'win32',
    home: () => 'C:\\Users\\tester',
    existsSync: (p) => p.endsWith('wt.exe') || p === 'C:\\repo',
    execDetached: (bin, args) => { winDetached.push([bin, args]); return true; },
  });
  assert.equal(await winCtrl.openTerminal('claude', 'C:\\repo', 'auto', 'W'), 'terminal');
  assert.ok(winDetached.some(([b, a]) => b.endsWith('wt.exe') && a.includes('-d') && a.includes('C:\\repo')));
  console.log('PASS openTerminal ghostty, wezterm, kitty, alacritty, and win32');
}

// 6. Windows WezTerm selection, native commands, and system fallback
{
  const installDir = String.raw`D:\Program Files\WezTerm`;
  const wezterm = installDir + '\\wezterm.exe';
  const weztermGui = installDir + '\\wezterm-gui.exe';
  const windowsApps = String.raw`C:\Users\tester\AppData\Local\Microsoft\WindowsApps`;
  const wt = windowsApps + '\\wt.exe';
  const cwd = String.raw`D:\Work Space\项目`;
  const ps1 = String.raw`C:\Users\tester\Agent Deck\任务.ps1`;
  const scriptArgs = ['powershell.exe', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', ps1];
  const task = scriptArgs.slice(0, -1).join(' ') + ' "' + ps1 + '"';
  const installed = new Set([wezterm, cwd]);
  const calls = [];
  let running = true;
  let launchOk = true;
  const ctrl = createTerminalController({
    platform: 'win32',
    home: () => 'C:\\Users\\tester',
    existsSync: (p) => installed.has(p),
    runResult: async (bin, args) => { calls.push([bin, args]); return { ok: running, out: '1' }; },
    spawn: (bin, args, options) => {
      calls.push([bin, args, options.cwd]);
      const child = new EventEmitter();
      child.unref = () => {};
      if (launchOk || bin === wt || bin === 'cmd.exe') child.pid = 1;
      else queueMicrotask(() => child.emit('error', new Error('Could not start WezTerm')));
      return child;
    },
  });
  const oldPath = process.env.PATH;
  process.env.PATH = '"' + installDir + '";' + windowsApps;
  try {
    assert.equal(await ctrl.openTerminal(task, cwd, 'wezterm', 'Task', { background: true }), 'wezterm');
    assert.deepEqual(calls.splice(0), [[wezterm, ['cli', 'spawn', '--cwd', cwd, '--', ...scriptArgs]]]);

    installed.add(wt);
    installed.add(weztermGui);
    running = false;
    for (const command of ['qoder login', '"C:\\Program Files\\Qoder\'s tools\\qoder.cmd" -r "session-id"']) {
      assert.equal(await ctrl.openTerminal(command, cwd, 'wezterm'), 'wezterm');
      const [[cli, cliArgs], [gui, startArgs, dir]] = calls.splice(0);
      assert.equal(cli, wezterm);
      assert.equal(gui, weztermGui);
      assert.equal(dir, cwd);
      assert.deepEqual(cliArgs.slice(0, 5), ['cli', 'spawn', '--cwd', cwd, '--']);
      assert.deepEqual(startArgs.slice(0, 4), ['start', '--cwd', cwd, '--']);
      assert.deepEqual(startArgs.slice(4), cliArgs.slice(5));
      assert.deepEqual(startArgs.slice(4, 7), ['powershell.exe', '-NoProfile', '-EncodedCommand']);
      assert.equal(decodeWindowsCommand(startArgs[7]), command);
    }

    assert.equal(await ctrl.openTerminal(task, cwd, 'auto'), 'terminal');
    assert.deepEqual(calls.splice(0), [[wt, ['-d', cwd, ...scriptArgs], cwd]]);

    installed.delete(weztermGui);
    launchOk = false;
    assert.equal(await ctrl.openTerminal(task, cwd, 'wezterm'), 'terminal');
    assert.deepEqual(calls.splice(0), [
      [wezterm, ['cli', 'spawn', '--cwd', cwd, '--', ...scriptArgs]],
      [wezterm, ['start', '--cwd', cwd, '--', ...scriptArgs], cwd],
      [wt, ['-d', cwd, ...scriptArgs], cwd],
    ]);

    installed.delete(wezterm);
    installed.delete(wt);
    assert.equal(await ctrl.openTerminal(task, cwd, 'wezterm'), 'terminal');
    assert.deepEqual(calls, [['cmd.exe', ['/c', 'start', '', '/D', cwd, ...scriptArgs], cwd]]);
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
  }
  console.log('PASS Windows WezTerm explicit launch and system fallback');
}

// Windows terminals launch in the project directory and retain the native job.
{
  const home = String.raw`C:\Users\tester`;
  const appData = home + String.raw`\AppData\Roaming`;
  const localAppData = home + String.raw`\AppData\Local`;
  const cwd = String.raw`D:\My Project\中文`;
  const script = home + String.raw`\Agent Deck\任务.ps1`;
  const shellArgs = ['powershell.exe', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', script];
  const command = shellArgs.slice(0, -1).join(' ') + ' "' + script + '"';
  const warp = localAppData + String.raw`\Programs\Warp\warp.exe`;
  const alacritty = String.raw`C:\Program Files\Alacritty\alacritty.exe`;
  const customAlacritty = 'E:\\Apps With Spaces\\Alacritty.exe';
  const tern = String.raw`D:\bin\tern.exe`;
  const hc = localAppData + String.raw`\Programs\herdr-core\hc.exe`;
  const herdr = localAppData + String.raw`\Programs\herdr-app\herdr-app.exe`;
  const wsl = String.raw`C:\Windows\System32\wsl.exe`;
  const wt = String.raw`D:\bin\wt.exe`;
  const linuxDir = '/mnt/d/My Project/中文';
  const installed = new Set([cwd, warp, alacritty, tern, hc, herdr, wsl, wt]);
  const calls = [];
  let warpOpen = true;
  let tmuxInstalled = true;
  let tmuxSession = false;
  let ternRunning = true;
  const ctrl = createTerminalController({
    platform: 'win32',
    home: () => home,
    env: { APPDATA: appData, LOCALAPPDATA: localAppData, ProgramFiles: 'C:\\Program Files', SystemRoot: 'C:\\Windows', PATH: 'D:\\bin' },
    existsSync: (p) => installed.has(p),
    mkdirSync: () => {},
    writeFileSync: (file, body) => calls.push(['write', file, body]),
    openExternal: async (url) => { calls.push(['url', url]); return warpOpen; },
    runResult: async (bin, args) => {
      calls.push([bin, args]);
      if (bin === 'reg.exe' && args.at(-1) === 'Icon') return { ok: true, out: '    Icon    REG_SZ    "' + customAlacritty + '",0\n' };
      if (bin === wsl && args.includes('sh')) return { ok: tmuxInstalled, out: tmuxInstalled ? linuxDir + '\n' : '' };
      if (bin === wsl && args.includes('has-session')) return { ok: tmuxSession, out: '' };
      if (bin === wsl) return { ok: tmuxInstalled, out: '' };
      if (bin === hc) return { ok: true, out: '{"address":"t1"}' };
      if (bin === herdr && args[0] === 'ls') return { ok: true, out: calls.at(-2)[1].find((arg) => arg.startsWith('herdr.tab=')) };
      if (bin === tern && args[0] === 'new') return { ok: ternRunning, out: ternRunning ? '{}' : '' };
      return { ok: true, out: '' };
    },
    sleep: async () => {},
    execDetached: (bin, args) => { calls.push([bin, args]); return true; },
  });

  assert.equal(await ctrl.openTerminal(command, cwd, 'alacritty', 'Task'), 'alacritty');
  assert.deepEqual(calls.splice(0), [[alacritty, ['--working-directory', cwd, '--title', 'Task', '-e', ...shellArgs]]]);
  installed.delete(alacritty);
  installed.add(customAlacritty);
  assert.equal(await ctrl.openTerminal(command, cwd, 'alacritty', 'Task'), 'alacritty');
  assert.deepEqual(calls.splice(0), [
    ['reg.exe', ['query', 'HKCR\\Directory\\Background\\shell\\Open Alacritty here', '/v', 'Icon']],
    [customAlacritty, ['--working-directory', cwd, '--title', 'Task', '-e', ...shellArgs]],
  ]);

  assert.equal(await ctrl.openTerminal(command, cwd, 'warp', 'Task'), 'warp');
  const [[, warpFile, warpConfig], [, warpUri]] = calls.splice(0);
  assert.ok(warpFile.startsWith(appData + '\\warp\\Warp\\data\\tab_configs\\agent-deck-task-'));
  assert.ok(warpConfig.includes('directory = ' + JSON.stringify(cwd)));
  assert.ok(warpConfig.includes('shell = "powershell"'));
  const warpPayload = /-EncodedCommand ([A-Za-z0-9+/=]+)"/.exec(warpConfig)?.[1];
  assert.equal(decodeWindowsCommand(warpPayload), command);
  assert.ok(warpUri.startsWith('warp://tab_config/agent-deck-task-'));
  warpOpen = false;
  assert.equal(await ctrl.openTerminal(command, cwd, 'warp'), 'terminal');
  assert.deepEqual(calls.splice(0).at(-1), [wt, ['-d', cwd, ...shellArgs]]);

  assert.equal(await ctrl.openTerminal(command, cwd, 'herdr', 'Task', { background: true }), 'herdr');
  assert.equal(calls[0][0], hc);
  assert.ok(calls[0][1].includes(cwd));
  assert.deepEqual(calls[0][1].slice(-shellArgs.length), shellArgs);
  assert.ok(calls.some(([bin, args]) => bin === herdr && args[1] === 'tab.rename'));
  calls.length = 0;

  assert.equal(await ctrl.openTerminal(command, cwd, 'tern'), 'tern');
  assert.deepEqual(calls.splice(0)[0], [tern, ['new', 'tab', '--json', '--cwd', cwd, '--', ...shellArgs]]);
  ternRunning = false;
  assert.equal(await ctrl.openTerminal(command, cwd, 'tern'), 'tern');
  assert.deepEqual(calls.splice(0).at(-1), [tern, ['-e', ...shellArgs]]);

  assert.equal(await ctrl.openTerminal(command, cwd, 'tmux', 'Task', { background: true }), 'tmux');
  const tmuxCommand = ['env', '-u', 'WSL_INTEROP', ...shellArgs];
  assert.deepEqual(calls.splice(0), [
    [wsl, ['--cd', cwd, '--exec', 'sh', '-c', 'command -v tmux >/dev/null && command -v powershell.exe >/dev/null && pwd']],
    [wsl, ['--exec', 'tmux', 'has-session', '-t', '=agent-deck']],
    [wsl, ['--exec', 'tmux', 'new-session', '-d', '-s', 'agent-deck', '-n', 'Task', '-c', linuxDir, '--', ...tmuxCommand]],
  ]);
  tmuxSession = true;
  assert.equal(await ctrl.openTerminal(command, cwd, 'tmux', 'Resume'), 'tmux');
  assert.deepEqual(calls.splice(0).slice(-2), [
    [wsl, ['--exec', 'tmux', 'new-window', '-t', '=agent-deck:', '-n', 'Resume', '-c', linuxDir, '--', ...tmuxCommand]],
    [wt, ['-d', cwd, wsl, '--exec', 'tmux', 'attach-session', '-t', '=agent-deck']],
  ]);
  tmuxInstalled = false;
  assert.equal(await ctrl.openTerminal(command, cwd, 'tmux'), 'terminal');
  assert.deepEqual(calls.splice(0).at(-1), [wt, ['-d', cwd, ...shellArgs]]);

  assert.equal(await ctrl.openTerminal(command, cwd, 'kitty'), 'terminal');
  assert.deepEqual(calls.splice(0), [[wt, ['-d', cwd, ...shellArgs]]]);
  console.log('PASS Windows Warp, Alacritty, Tern, Herdr and WSL tmux launch and fallback');
}

// Exercise the actual Windows PowerShell/CMD boundary on the Windows runner.
if (process.platform === 'win32') {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'Agent Deck 中文 '));
  try {
    let nativeArgs;
    const ctrl = createTerminalController({
      execDetached: (_bin, args) => { nativeArgs = args.slice(-4); return true; },
    });
    const command = '"' + process.execPath + '" -p "Buffer.from(require(\'node:fs\').realpathSync(process.cwd()).toLowerCase()).toString(\'hex\')"';
    assert.equal(await ctrl.openTerminal(command, cwd, 'terminal'), 'terminal');
    const [bin, ...argv] = nativeArgs;
    const output = execFileSync(bin, argv, { cwd, input: 'exit\r\n', encoding: 'utf8', timeout: 10000, windowsHide: true });
    assert.ok(output.includes(Buffer.from(fs.realpathSync(cwd).toLowerCase()).toString('hex')), JSON.stringify(output));
    console.log('PASS native Windows interactive command quoting and project directory');
  } finally {
    fs.rmdirSync(cwd);
  }
}

// macOS retains user-installed app bundles and reports Tern launch failure.
{
  const dir = '/Users/tester/Applications/Tern.app/Contents/MacOS/tern';
  const calls = [];
  const ctrl = createTerminalController({
    platform: 'darwin',
    home: () => '/Users/tester',
    existsSync: (p) => p === dir || p === '/Users/tester/Applications/Tern.app' || p === '/work',
    runResult: async (bin, args) => { calls.push([bin, args]); return { ok: false, out: '' }; },
    execFire: () => true,
    execDetached: () => false,
  });
  assert.equal(await ctrl.openTerminal('codex resume session-id', '/work', 'tern'), 'terminal');
  assert.ok(calls.some(([bin, args]) => bin === dir && args[0] === 'new'));
  console.log('PASS macOS user Applications terminal and failed Tern fallback');
}

// Terminal host and focus for tmux and WezTerm
{
  const calls = [];
  const ctrl = createTerminalController({
    platform: 'darwin',
    home: () => '/Users/tester',
    existsSync: (p) => ['/opt/homebrew/bin/tmux', '/opt/homebrew/bin/wezterm'].includes(p),
    cliProcess: async (_agent, sid) => (sid === 's-tmux'
      ? { pid: 500, tty: '/dev/ttys009', host: 'tmux' }
      : { pid: 600, tty: '/dev/ttys012', host: 'wezterm' }),
    runResult: async (bin, args) => {
      calls.push([bin, args]);
      if (bin.endsWith('/tmux') && args[0] === 'list-panes') {
        return { ok: true, out: '/dev/ttys009\tagent-deck\t2\t0\n' };
      }
      if (bin.endsWith('/tmux') && args[0] === 'list-clients') {
        return { ok: true, out: '777\n' };
      }
      if (bin === '/bin/ps' && args.includes('777')) {
        return { ok: true, out: '1 /Applications/Ghostty.app/Contents/MacOS/ghostty' };
      }
      if (bin.endsWith('/wezterm') && args[1] === 'list') {
        return { ok: true, out: JSON.stringify([{ pane_id: 42, tty_name: '/dev/ttys012' }]) };
      }
      return { ok: true, out: '' };
    },
  });

  assert.equal(await ctrl.focusCliSession('claude', 's-tmux'), 'tab');
  assert.ok(calls.some(([b, a]) => b.endsWith('/tmux') && a[0] === 'select-window' && a[2] === 'agent-deck:2'));
  assert.ok(calls.some(([b, a]) => b.endsWith('/tmux') && a[0] === 'select-pane' && a[2] === 'agent-deck:2.0'));
  assert.ok(calls.some(([b, a]) => b === '/usr/bin/open' && a.includes('com.mitchellh.ghostty')));

  assert.equal(await ctrl.focusCliSession('claude', 's-wez'), 'tab');
  assert.ok(calls.some(([b, a]) => b.endsWith('/wezterm') && a[1] === 'activate-pane' && a[3] === '42'));
  assert.ok(calls.some(([b, a]) => b === '/usr/bin/open' && a.includes('com.github.wez.wezterm')));
  console.log('PASS focusCliSession tmux and wezterm');
}
