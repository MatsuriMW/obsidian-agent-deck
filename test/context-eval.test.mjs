import test from "node:test";
import assert from "node:assert/strict";
import { runContextEval } from "../scripts/eval-context.mjs";

test("offline context eval meets recall, privacy, zero-silent-loss, and prefix stability thresholds", async () => {
  const result = await runContextEval();
  assert.equal(result.memory.privacyLeaks, 0, "private or rejected memories must never leak");
  assert.equal(result.memory.budgetViolations, 0, "memory injection must respect maxChars");
  assert.ok(result.memory.recall >= 0.9, `recall=${result.memory.recall} < 0.9`);
  assert.ok(result.memory.precision >= 0.8, `precision=${result.memory.precision} < 0.8`);
  assert.equal(result.harness.privacyLeaks, 0, "excluded/private notes must never leak into payload");
  assert.equal(result.harness.silentLosses, 0, "omitted links, missing anchors, and truncated notes must emit explicit declarations");
  assert.equal(result.harness.passed, result.harness.total);
  assert.equal(result.cache.driftCount, 0, "follow-up turns must not invalidate stable KV-cache prefix");
  assert.equal(result.hygiene.ok, true, "internal anchors/comments stripped while preserving code fences, __, and ^mem-*");
  assert.equal(result.ok, true);
});
