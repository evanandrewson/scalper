/**
 * VWAP (Volume Weighted Average Price) Calculator - Functional Style
 */
import { logger } from './utils/logger.js';

export interface VWAPData {
  price: number;
  high: number;
  low: number;
  volume: number;
  timestamp: number;
  vwap?: number; // Store historical VWAP for slope calc
}

export interface VWAPState {
  period: number;
  dataPoints: VWAPData[];
  cumulativePriceVolume: number;
  cumulativeVolume: number;
}

export const createVWAPState = (period: number): VWAPState => {
  logger.debug(`VWAP Calculator initialized with period: ${period}`);
  return {
    period,
    dataPoints: [],
    cumulativePriceVolume: 0,
    cumulativeVolume: 0,
  };
};

export const updateVWAP = (
  state: VWAPState,
  price: number,
  volume: number,
  high?: number,
  low?: number
): VWAPState => {
  const timestamp = Date.now();
  // If high/low not provided, assume close price (approximation for simple ticks)
  const h = high || price;
  const l = low || price;

  // Calculate current VWAP to store in history
  let currentVWAP: number | undefined;
  if (state.cumulativeVolume > 0) {
    currentVWAP =
      (state.cumulativePriceVolume + price * volume) /
      (state.cumulativeVolume + volume);
  }

  const newDataPoint: VWAPData = {
    price,
    high: h,
    low: l,
    volume,
    timestamp,
    vwap: currentVWAP,
  };

  let newDataPoints = [...state.dataPoints, newDataPoint];
  let newCumulativePV = state.cumulativePriceVolume + price * volume;
  let newCumulativeV = state.cumulativeVolume + volume;

  // Maintain rolling window only if period > 0
  if (state.period > 0 && newDataPoints.length > state.period) {
    const removed = newDataPoints[0];
    newDataPoints = newDataPoints.slice(1);
    newCumulativePV -= removed.price * removed.volume;
    newCumulativeV -= removed.volume;
  }

  return {
    ...state,
    dataPoints: newDataPoints,
    cumulativePriceVolume: newCumulativePV,
    cumulativeVolume: newCumulativeV,
  };
};

export const getVWAP = (state: VWAPState): number | null => {
  if (state.cumulativeVolume === 0) return null;
  // If period > 0, ensure we have enough points
  if (state.period > 0 && state.dataPoints.length < state.period) {
    return null;
  }

  return state.cumulativePriceVolume / state.cumulativeVolume;
};

export const getDeviation = (
  state: VWAPState,
  currentPrice: number
): number | null => {
  const vwap = getVWAP(state);

  if (vwap === null) {
    return null;
  }

  return (currentPrice - vwap) / vwap;
};

export const isAboveVWAP = (
  state: VWAPState,
  currentPrice: number
): boolean | null => {
  const vwap = getVWAP(state);

  if (vwap === null) {
    return null;
  }

  return currentPrice > vwap;
};

export const isBelowVWAP = (
  state: VWAPState,
  currentPrice: number
): boolean | null => {
  const vwap = getVWAP(state);

  if (vwap === null) {
    return null;
  }

  return currentPrice < vwap;
};

export const resetVWAP = (period: number): VWAPState => {
  logger.debug('VWAP Calculator reset');
  return createVWAPState(period);
};

export const hasEnoughData = (state: VWAPState): boolean => {
  return state.dataPoints.length >= state.period;
};
