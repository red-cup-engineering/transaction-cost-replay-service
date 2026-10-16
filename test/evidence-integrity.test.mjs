import { test } from "node:test";
import assert from "node:assert/strict";
import { replayTransactionCosts, measureHitRateAndExpectancy } from "../src/replay.mjs";

test("unobserved returns for held positions fail rather than being imputed zero", () => {
  const first = {at: "2026-01-01", weights: {BTC: 1}, realizedReturns: {BTC: 0.03}};
  for (const second of [
    {at: "2026-01-02", weights: {BTC: 1}, realizedReturns: {}},
    {at: "2026-01-02", weights: {BTC: 1}, realizedReturns: {BTC: null}},
  ]) {
    assert.throws(() => replayTransactionCosts({periods: [first, second], transactionCostBps: 5}), /missing-realized-return:BTC/);
  }
});

test("absent return for zero exposure contributes zero by algebra, not imputation", () => {
  const input = {periods: [
    {at: "2026-01-01", weights: {BTC: 0}, realizedReturns: {}},
    {at: "2026-01-02", weights: {BTC: 1}, realizedReturns: {BTC: -0.02}},
  ], transactionCostBps: 10};
  const result = replayTransactionCosts(input);
  assert.equal(result.path[0].grossReturn, 0);
  assert.equal(result.path[1].grossReturn, -0.02);
  assert.equal(result.metrics.turnover, 1);
});

test("missing numeric observations are not coerced into zero or positive", () => {
  const periods = [
    {at: "2026-01-01", weights: {BTC: 1}, realizedReturns: {BTC: 0.03}},
    {at: "2026-01-02", weights: {BTC: 1}, realizedReturns: {BTC: -0.01}},
  ];
  for (const invalid of [null, "", "  ", false, true, [], {}, undefined, "0x10"]) {
    assert.throws(() => replayTransactionCosts({periods, transactionCostBps: invalid}), /transaction-cost-bps-invalid/);
    assert.throws(() => measureHitRateAndExpectancy([0.01, invalid]), /net-return/);
    assert.throws(() => replayTransactionCosts({periods: [{...periods[0], weights: {BTC:invalid}}, periods[1]], transactionCostBps:10}), /weight-invalid/);
  }
});

test("decimal string observations are normalized once for correct expectancy and costs", () => {
  const stats = measureHitRateAndExpectancy(["0.02", "-0.01", "0"]);
  assert.ok(Math.abs(stats.expectancy - 1/300) < 1e-12);
  assert.equal(stats.hitRate, 1/3);
  assert.equal(stats.averageLoss, 0.01);
  const result = replayTransactionCosts({periods:[
    {at:"2026-01-01",weights:{BTC:"1"},realizedReturns:{BTC:"0.02"}},
    {at:"2026-01-02",weights:{BTC:"1"},realizedReturns:{BTC:"-0.01"}},
  ],transactionCostBps:"10"});
  assert.equal(result.path[0].cost, 0.001);
  assert.equal(result.path[1].cost, 0);
  assert.equal(result.metrics.winCount, 1);
  assert.equal(result.metrics.lossCount, 1);
});

test("annualization requires an actual positive period count", () => {
  const periods=[
    {at:"2026-01-01",weights:{BTC:1},realizedReturns:{BTC:0.01}},
    {at:"2026-01-02",weights:{BTC:1},realizedReturns:{BTC:0.02}},
  ];
  for (const periodsPerYear of [0,-1,0.1,1.5,NaN,Infinity,null,"52"]) {
    assert.throws(() => replayTransactionCosts({periods,transactionCostBps:1,periodsPerYear}), /periods-per-year-invalid/);
  }
  assert.equal(replayTransactionCosts({periods, transactionCostBps: 1, periodsPerYear:365}).metrics.periods,2);
});

test("expectancy decomposes using loss frequency when flat periods are present", () => {
  const returns = [0.02, -0.01, 0.03, -0.02, 0];
  const result = measureHitRateAndExpectancy(returns);
  const exact = result.hitRate * result.averageWin -
    (result.lossCount / returns.length) * result.averageLoss;
  assert.ok(Math.abs(result.expectancy - exact) < 1e-12);
  assert.notEqual(result.expectancy,
    result.hitRate * result.averageWin - (1 - result.hitRate) * result.averageLoss);
});
