import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeVersion,
  compareVersions,
  isNewerVersion,
  shouldAutoCheckUpdate,
  shouldPromptUpdate,
  checkLatestRelease,
  UPDATE_CHECK_INTERVAL_MS,
} from "../src/update-check.js";
import { majorMinorOf, shouldOpenShowcaseForVersion } from "../src/welcome-demo.js";

test("version normalization and comparison", () => {
  assert.equal(normalizeVersion("v1.13.14"), "1.13.14");
  assert.equal(normalizeVersion("1.13.14-beta.1"), "1.13.14");
  assert.equal(compareVersions("1.13.14", "1.13.13"), 1);
  assert.equal(compareVersions("1.14.0", "1.13.99"), 1);
  assert.equal(compareVersions("v1.13.13", "1.13.13"), 0);
  assert.equal(compareVersions("1.13.12", "1.13.13"), -1);
  assert.equal(isNewerVersion("v1.13.14", "1.13.13"), true);
  assert.equal(isNewerVersion("1.13.13", "1.13.13"), false);
});

test("auto-check throttle and skipped-version suppression", () => {
  const now = 1_700_000_000_000;
  assert.equal(shouldAutoCheckUpdate({ updateCheck: false, updateCheckLastAt: 0 }, now), false);
  assert.equal(shouldAutoCheckUpdate({ updateCheck: true, updateCheckLastAt: 0 }, now), true);
  assert.equal(shouldAutoCheckUpdate({ updateCheck: true, updateCheckLastAt: now - 1000 }, now), false);
  assert.equal(shouldAutoCheckUpdate({ updateCheck: true, updateCheckLastAt: now - UPDATE_CHECK_INTERVAL_MS }, now), true);

  assert.equal(shouldPromptUpdate("1.13.14", "1.13.13", { updateSkippedVersion: "1.13.14" }), false);
  assert.equal(shouldPromptUpdate("1.13.14", "1.13.13", { updateSkippedVersion: "1.13.14" }, { manual: true }), true);
  assert.equal(shouldPromptUpdate("1.13.15", "1.13.13", { updateSkippedVersion: "1.13.14" }), true);
  assert.equal(shouldPromptUpdate("1.13.13", "1.13.13", {}), false);
});

test("checkLatestRelease parses GitHub release payload cleanly", async () => {
  const res = await checkLatestRelease({
    currentVersion: "1.13.13",
    fetchJson: async () => ({
      tag_name: "v1.13.14",
      html_url: "https://github.com/MatsuriMW/obsidian-agent-deck/releases/tag/v1.13.14",
      body: "Added custom ACP agents and update check.",
      published_at: "2026-11-22T12:00:00Z",
    }),
  });
  assert.equal(res.latestVersion, "1.13.14");
  assert.equal(res.currentVersion, "1.13.13");
  assert.equal(res.hasUpdate, true);
  assert.equal(res.url, "https://github.com/MatsuriMW/obsidian-agent-deck/releases/tag/v1.13.14");
});

test("showcase auto-opens once on major/minor upgrade, pre-1.13.29 -> 1.13.29 upgrade, and stays quiet on subsequent patch bumps", () => {
  assert.equal(majorMinorOf("1.13.29"), "1.13");
  assert.equal(majorMinorOf("v2.0.0-beta.1"), "2.0");
  assert.equal(shouldOpenShowcaseForVersion("1.13.29", ""), true);
  assert.equal(shouldOpenShowcaseForVersion("1.13.29", "1.10.0"), true);
  assert.equal(shouldOpenShowcaseForVersion("1.13.29", "1.13.13"), true);
  assert.equal(shouldOpenShowcaseForVersion("1.13.29", "1.13.28"), true);
  assert.equal(shouldOpenShowcaseForVersion("1.13.30", "1.12.9"), true);
  assert.equal(shouldOpenShowcaseForVersion("1.13.30", "1.13.28"), true);
  assert.equal(shouldOpenShowcaseForVersion("1.13.30", "1.13.29"), false);
  assert.equal(shouldOpenShowcaseForVersion("1.14.0", "1.13.29"), true);
  assert.equal(shouldOpenShowcaseForVersion("2.0.0", "1.13.29"), true);
  assert.equal(shouldOpenShowcaseForVersion("1.13.29", "1.13.29"), false);
});
