import { VWAPData } from '../vwap.js';

/**
 * Calculate Average True Range (ATR)
 * pure function
 */
export const calculateATR = (
  data: VWAPData[],
  period: number = 14
): number | null => {
  if (data.length < period + 1) return null;

  const relevantData = data.slice(-(period + 1));
  let trSum = 0;

  for (let i = 1; i < relevantData.length; i++) {
    const current = relevantData[i];
    const prev = relevantData[i - 1];

    // TR = Max(High-Low, Abs(High-PrevClose), Abs(Low-PrevClose))
    // Note: VWAPData in vwap.ts currently only stores { price, volume, timestamp }.
    // We need to upgrade VWAPData to store OHLC if we want real ATR.
    // For now, assuming 'price' is close. If we only have close, ATR ~ Standard Deviation of changes?
    // Let's assume we will upgrade the data structure passed to strategy to include OHLC.

    // Wait, the backtest passes 'bars' which have OHLC.
    // But the VWAPState only saves 'price' (close).
    // I need to update VWAPData to include high/low/close.

    // Placeholder using just price (Close) as proxy for High/Low range if real data missing
    // or if we rely on the implementation below updating the types.
    const high = (current as any).high || current.price;
    const low = (current as any).low || current.price;
    const prevClose = (prev as any).close || prev.price;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trSum += tr;
  }

  return trSum / period;
};

/**
 * Calculate VWAP Slope
 * Slope = (CurrentVWAP - VWAP_N_Bars_Ago)
 */
export const calculateVWAPSlope = (
  currentVWAP: number,
  historicalVWAP: number[],
  lookback: number = 5
): number => {
  if (historicalVWAP.length < lookback) return 0;
  const prevVWAP = historicalVWAP[historicalVWAP.length - lookback];
  return currentVWAP - prevVWAP;
};

/**
 * Detect Chop
 * Count crosses of VWAP in last N minutes
 */
export const isChoppy = (
  prices: number[],
  vwaps: number[],
  period: number = 20,
  threshold: number = 3
): boolean => {
  if (prices.length < period || vwaps.length < period) return false;

  const recentPrices = prices.slice(-period);
  const recentVWAPs = vwaps.slice(-period);

  let crosses = 0;
  let wasAbove = recentPrices[0] > recentVWAPs[0];

  for (let i = 1; i < period; i++) {
    const isAbove = recentPrices[i] > recentVWAPs[i];
    if (isAbove !== wasAbove) {
      crosses++;
      wasAbove = isAbove;
    }
  }

  return crosses >= threshold;
};

/**
 * Calculate RSI (Relative Strength Index)
 * @param prices Array of closing prices
 * @param period Lookback period (default 14)
 */
export const calculateRSI = (
  prices: number[],
  period: number = 14
): number | null => {
  if (prices.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  // Initial SMA of gains/losses
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Smoothing
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
};
