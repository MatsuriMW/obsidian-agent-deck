import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AGENT_ORDER } from '../src/constants.js';
import { settingsAgentOrder, moveSettingsAgent, recommendPrimaryAgents } from '../src/settings-agents.js';
import { syncModelGroups } from '../src/model-groups.js';

test('two settings orders are independent, validated and survive reload', () => {
  const settings = { ui: { agentOrders: { delegation: ['codex', 'unknown', 'codex'], tracking: ['qoder'] } } };
  const enabled = () => true;
  assert.equal(settingsAgentOrder(settings, 'delegation', enabled)[0], 'codex');
  assert.equal(settingsAgentOrder(settings, 'tracking', enabled)[0], 'qoder');
  assert.equal(settingsAgentOrder(settings, 'delegation', enabled).length, AGENT_ORDER.length);
  assert.ok(moveSettingsAgent(settings, 'delegation', 'claude', 'codex', false, enabled));
  assert.equal(settingsAgentOrder(structuredClone(settings), 'delegation', enabled)[0], 'claude');
  assert.equal(settingsAgentOrder(settings, 'tracking', enabled)[0], 'qoder');
});
test('disabled tracking sources stay at the bottom without changing delegation order', () => {
  const settings = { ui: { agentOrders: { tracking: ['qoder', 'claude', 'codex'], delegation: ['qoder', 'codex'] } } };
  const enabled = id => !['qoder', 'codex'].includes(id);
  const ordered = settingsAgentOrder(settings, 'tracking', enabled);
  assert.deepEqual(ordered.slice(-2), ['qoder', 'codex']);
  assert.equal(moveSettingsAgent(settings, 'tracking', 'qoder', 'claude', false, enabled), false, 'disabled sources cannot cross the enabled boundary');
  assert.equal(settingsAgentOrder(settings, 'delegation', enabled)[0], 'qoder');
});
test('first-use recommendation counts unique recent main sessions, not tokens or turns', () => {
  const now = Date.UTC(2026, 10, 15), day = 86400000;
  const rows = [];
  for (const [agent, count] of [['qoder', 5], ['codex', 4], ['claude', 3], ['dsh', 2]]) {
    for (let i = 0; i < count; i++) rows.push([agent + i, { sid: agent + i, agent, lastAt: now - day, turns: agent === 'dsh' ? 10000 : 1 }]);
  }
  rows.push(['duplicate', { ...rows[0][1] }]);
  rows.push(['old', { sid: 'old', agent: 'dsh', lastAt: now - 31 * day }]);
  rows.push(['sub', { sid: 'sub', agent: 'dsh', lastAt: now, parentSid: 'parent' }]);
  const usage = { meta: new Map(rows), files: new Map() };
  assert.deepEqual(recommendPrimaryAgents(usage, now), ['qoder', 'codex', 'claude']);
  assert.deepEqual(recommendPrimaryAgents({ meta: new Map(), files: new Map() }, now), [], 'empty history never invents popular agents');
});
test('both model sections default to primary-only expansion and remember manual changes', () => {
  const settings = { primaryAgents: ['codex', 'qoder', 'dsh'], ui: {} };
  syncModelGroups(settings, () => true);
  for (const section of ['modelGroups', 'delegateGroups']) {
    assert.equal(settings.ui[section].codex.open, true);
    assert.equal(settings.ui[section].claude.open, false);
    settings.ui[section].claude.open = true;
  }
  const saved = structuredClone(settings);
  syncModelGroups(saved, () => true);
  assert.ok(saved.ui.modelGroups.claude.open && saved.ui.delegateGroups.claude.open);
});
