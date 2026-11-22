import assert from 'node:assert/strict';
import { TERMINAL_REGISTRY, TERMINAL_NAME, getTerminalOptions, createTerminalController } from '../src/terminals.js';

// 1. Registry & UI select options
{
  const ids = TERMINAL_REGISTRY.map((t) => t.id);
  for (const required of ['terminal', 'iterm', 'warp', 'ghostty', 'cmux', 'tmux', 'wezterm', 'kitty', 'alacritty', 'tern', 'herdr']) {
    assert.ok(ids.includes(required), `missing terminal in registry: ${required}`);
    assert.ok(TERMINAL_NAME[required], `missing TERMINAL_NAME for ${required}`);
  }
  const opts = getTerminalOptions();
  assert.equal(opts[0].id, 'auto');
  assert.deepEqual(opts.slice(1).map((o) => o.id), ids);
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

// 6. terminalHost & focusCliSession (tmux & wezterm)
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
