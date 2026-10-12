const finite = (value, label) => {
  const number = Number(value);
  if (!Number.isFinite(number) || Object.is(number, -0)) throw new TypeError(`${label}-invalid`);
  return number;
};
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * Splits a replay path's per-period net returns into hit rate and
 * expectancy -- the trade-level statistics a directional-edge backtest
 * needs (a fused-signal belief edge is only real once it clears this bar
 * out of sample), kept as an additive companion to the existing
 * risk/performance measures rather than folded into them.
 * @param {number[]} netReturns One net return per replayed period.
 * @returns {{hitRate: number, expectancy: number, averageWin: number, averageLoss: number, winCount: number, lossCount: number}}
 *   `hitRate` is the fraction of periods with a strictly positive net
 *   return; `expectancy` is the mean net return per period (the same
 *   quantity a `hitRate*averageWin - (1-hitRate)*averageLoss` decomposition
 *   must reconstruct); `averageWin`/`averageLoss` are the mean positive and
 *   mean absolute-negative net returns (0 when no period of that sign
 *   occurred, never `NaN`).
 */
export function measureHitRateAndExpectancy(netReturns) {
  if (!Array.isArray(netReturns) || netReturns.length === 0) throw new TypeError("net-returns-required");
  netReturns.forEach((value, index) => finite(value, `net-return[${index}]`));
  const wins = netReturns.filter((value) => value > 0);
  const losses = netReturns.filter((value) => value < 0);
  return Object.freeze({
    hitRate: wins.length / netReturns.length,
    expectancy: mean(netReturns),
    averageWin: wins.length > 0 ? mean(wins) : 0,
    averageLoss: losses.length > 0 ? -mean(losses) : 0,
    winCount: wins.length,
    lossCount: losses.length,
  });
}

export function replayTransactionCosts({ periods, transactionCostBps, periodsPerYear = 52 } = {}) {
  if (!Array.isArray(periods) || periods.length < 2) throw new TypeError("replay-periods-required");
  const bps = finite(transactionCostBps, "transaction-cost-bps");
  if (bps < 0) throw new RangeError("negative-transaction-cost-refused");
  let prior = {}, equity = 1, peak = 1, maximumDrawdown = 0, totalTurnover = 0, totalCosts = 0;
  const path = periods.map((period) => {
    if (!period?.weights || !period?.realizedReturns) throw new TypeError("replay-period-invalid");
    const entities = [...new Set([...Object.keys(period.weights), ...Object.keys(period.realizedReturns)])];
    const turnover = entities.reduce((sum, entity) => sum + Math.abs(finite(period.weights[entity] ?? 0, "weight") - finite(prior[entity] ?? 0, "prior-weight")), 0);
    const grossReturn = entities.reduce((sum, entity) => sum + finite(period.weights[entity] ?? 0, "weight") * finite(period.realizedReturns[entity] ?? 0, "realized-return"), 0);
    const cost = turnover * bps / 10_000, netReturn = grossReturn - cost;
    equity *= 1 + netReturn; peak = Math.max(peak, equity); maximumDrawdown = Math.max(maximumDrawdown, 1 - equity / peak);
    totalTurnover += turnover; totalCosts += cost; prior = period.weights;
    return Object.freeze({ at: period.at, grossReturn, turnover, cost, netReturn, equity });
  });
  const returns = path.map(({ netReturn }) => netReturn), average = mean(returns);
  const deviation = Math.sqrt(returns.reduce((sum, value) => sum + (value - average) ** 2, 0) / Math.max(1, returns.length - 1));
  const tradeStatistics = measureHitRateAndExpectancy(returns);
  return Object.freeze({ type: "TransactionCostReplay", version: 1, path: Object.freeze(path), metrics: Object.freeze({ periods: path.length, totalReturn: equity - 1, annualizedReturn: equity ** (periodsPerYear / path.length) - 1, annualizedVolatility: deviation * Math.sqrt(periodsPerYear), informationRatio: deviation > 0 ? average / deviation * Math.sqrt(periodsPerYear) : 0, maximumDrawdown, turnover: totalTurnover, costs: totalCosts, hitRate: tradeStatistics.hitRate, expectancy: tradeStatistics.expectancy, averageWin: tradeStatistics.averageWin, averageLoss: tradeStatistics.averageLoss, winCount: tradeStatistics.winCount, lossCount: tradeStatistics.lossCount }), alphaEstablished: false, effect: "replay-only" });
}
