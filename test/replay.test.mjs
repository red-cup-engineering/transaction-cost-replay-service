import { test } from "node:test";
import assert from "node:assert/strict";
import { replayTransactionCosts, measureHitRateAndExpectancy } from "../src/replay.mjs";

test("measureHitRateAndExpectancy: computes hit rate, expectancy, average win/loss", () => {
  const stats = measureHitRateAndExpectancy([0.02, -0.01, 0.03, -0.02, 0]);
  assert.equal(stats.winCount, 2);
  assert.equal(stats.lossCount, 2);
  assert.equal(stats.hitRate, 2 / 5);
  assert.ok(Math.abs(stats.expectancy - 0.004) < 1e-9);
  assert.ok(Math.abs(stats.averageWin - 0.025) < 1e-9);
  assert.ok(Math.abs(stats.averageLoss - 0.015) < 1e-9);
});

test("measureHitRateAndExpectancy: all-win series has zero averageLoss, never NaN", () => {
  const stats = measureHitRateAndExpectancy([0.01, 0.02]);
  assert.equal(stats.hitRate, 1);
  assert.equal(stats.averageLoss, 0);
  assert.equal(stats.lossCount, 0);
});

test("measureHitRateAndExpectancy: refuses empty or non-array input", () => {
  assert.throws(() => measureHitRateAndExpectancy([]), TypeError);
  assert.throws(() => measureHitRateAndExpectancy(null), TypeError);
});

test("replayTransactionCosts: metrics carries hitRate/expectancy alongside existing measures", () => {
  const periods = [
    { at: "2026-01-01", weights: { BTC: 1 }, realizedReturns: { BTC: 0.05 } },
    { at: "2026-01-02", weights: { BTC: 1 }, realizedReturns: { BTC: -0.02 } },
    { at: "2026-01-03", weights: { BTC: 1 }, realizedReturns: { BTC: 0.03 } },
  ];
  const result = replayTransactionCosts({ periods, transactionCostBps: 10, periodsPerYear: 365 });
  assert.equal(result.metrics.periods, 3);
  assert.equal(typeof result.metrics.hitRate, "number");
  assert.equal(typeof result.metrics.expectancy, "number");
  assert.equal(result.metrics.winCount + result.metrics.lossCount <= 3, true);
  assert.ok(result.metrics.hitRate >= 0 && result.metrics.hitRate <= 1);
  // existing fields untouched by the additive change
  assert.equal(typeof result.metrics.maximumDrawdown, "number");
  assert.equal(typeof result.metrics.informationRatio, "number");
});

test("replayTransactionCosts: still refuses fewer than two periods (pre-existing behavior)", () => {
  assert.throws(() => replayTransactionCosts({ periods: [{ at: "x", weights: {}, realizedReturns: {} }], transactionCostBps: 0 }), TypeError);
});
