/**
 * Risk Management System - Functional Style
 */
import { Config } from './config.js';
import { logger } from './utils/logger.js';

export interface PositionInfo {
  symbol: string;
  entryPrice: number;
  quantity: number;
  entryTime: number;
}

export interface RiskState {
  config: Config;
  dailyPnL: number;
  currentBalance: number; // Added to track equity
  positions: Map<string, PositionInfo>;
  dailyResetTime: number;
  tradesToday: number;
  lossesToday: number;
  lastLossTime: number | null;
}

const getNextResetTime = (fromTime: number = Date.now()): number => {
  const now = new Date(fromTime);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow.getTime();
};

export const createRiskState = (
  config: Config,
  startTime: number = Date.now()
): RiskState => {
  return {
    config,
    dailyPnL: 0,
    currentBalance: config.backtesting?.initial_capital || 10000,
    positions: new Map(),
    dailyResetTime: getNextResetTime(startTime),
    tradesToday: 0,
    lossesToday: 0,
    lastLossTime: null,
  };
};

export const canOpenPosition = (
  state: RiskState,
  currentTime: number = Date.now()
): boolean => {
  // Check for daily reset
  if (currentTime >= state.dailyResetTime) {
    // This is a "check" function, it shouldn't mutate state strictly,
    // but in this FP pattern, we might need to return revised state OR handle reset externally.
    // Ideally backtester calls "updateTime" explicitly.
    // But for now, if we are in a new day, we assume stats are fresh for logic purposes.
    // However, to satisfy the persistent state, the caller needs to reset it.
    // We will assume the caller updates state via `updateDailyReset`.
  }

  // Actually, let's just make `canOpenPosition` return true/false based on current stats.
  // We need a separate function to Reset stats if time passed.

  // Check max positions limit
  if (state.positions.size >= state.config.strategy.position.max_positions) {
    logger.info('Cannot open position: max positions reached');
    return false;
  }

  // Check Max Trades Per Day
  if (state.tradesToday >= state.config.strategy.risk.max_trades_per_day) {
    logger.info('Cannot open position: max daily trades reached');
    return false;
  }

  // Check Max Losses Per Day
  if (state.lossesToday >= state.config.strategy.risk.max_losses_per_day) {
    logger.info('Cannot open position: max daily losses reached');
    return false;
  }

  // Check Cooldown
  if (state.lastLossTime) {
    const minutesSinceLoss = (currentTime - state.lastLossTime) / 60000;
    if (minutesSinceLoss < state.config.strategy.risk.cooldown_minutes) {
      if (Math.random() < 0.001) {
        // Log occasionally
        logger.info(
          `Cannot open position: in cooldown for ${(state.config.strategy.risk.cooldown_minutes - minutesSinceLoss).toFixed(1)} more mins`
        );
      }
      return false;
    }
  }

  // Check daily loss limit
  if (state.dailyPnL <= -state.config.strategy.risk.max_daily_loss) {
    logger.warn(
      `Cannot open position: daily loss limit reached ($${state.dailyPnL.toFixed(2)})`
    );
    return false;
  }

  return true;
};

export const recordPosition = (
  state: RiskState,
  symbol: string,
  entryPrice: number,
  quantity: number,
  currentTime: number = Date.now()
): RiskState => {
  const newPositions = new Map(state.positions);
  newPositions.set(symbol, {
    symbol,
    entryPrice,
    quantity,
    entryTime: currentTime,
  });

  logger.debug(
    `Position recorded: ${symbol} | Qty: ${quantity} | Entry: $${entryPrice.toFixed(2)}`
  );

  return {
    ...state,
    positions: newPositions,
  };
};

export const closePosition = (
  state: RiskState,
  symbol: string,
  pnl: number,
  currentTime: number = Date.now()
): RiskState => {
  const newPositions = new Map(state.positions);
  newPositions.delete(symbol);
  const newDailyPnL = state.dailyPnL + pnl;
  const newBalance = state.currentBalance + pnl; // Update balance

  logger.info(
    `Position closed: ${symbol} | P&L: $${pnl.toFixed(2)} | Daily P&L: $${newDailyPnL.toFixed(2)} | Bal: $${newBalance.toFixed(2)}`
  );

  // Check if daily loss limit reached
  if (newDailyPnL <= -state.config.strategy.risk.max_daily_loss) {
    logger.error(`🚨 DAILY LOSS LIMIT REACHED: $${newDailyPnL.toFixed(2)}`);
    logger.error('No new positions will be opened today');
  }

  const isLoss = pnl < 0;

  return {
    ...state,
    positions: newPositions,
    dailyPnL: newDailyPnL,
    currentBalance: newBalance, // Store new balance
    tradesToday: state.tradesToday + 1,
    lossesToday: isLoss ? state.lossesToday + 1 : state.lossesToday,
    lastLossTime: isLoss ? currentTime : state.lastLossTime,
  };
};

export const getPositionCount = (state: RiskState): number =>
  state.positions.size;

export const getDailyPnL = (state: RiskState): number => state.dailyPnL;

export const getPositionInfo = (
  state: RiskState,
  symbol: string
): PositionInfo | undefined => {
  return state.positions.get(symbol);
};

export const getAllPositions = (state: RiskState): PositionInfo[] => {
  return Array.from(state.positions.values());
};

export const resetDailyPnL = (state: RiskState): RiskState => {
  logger.info(`Daily P&L reset. Previous: $${state.dailyPnL.toFixed(2)}`);
  return {
    ...state,
    dailyPnL: 0,
    dailyResetTime: getNextResetTime(),
    tradesToday: 0,
    lossesToday: 0,
    lastLossTime: null,
  };
};

export const checkAndResetIfNeeded = (state: RiskState): RiskState => {
  if (Date.now() >= state.dailyResetTime) {
    return resetDailyPnL(state);
  }
  return state;
};

export const calculatePositionSize = (
  config: Config,
  accountBalance: number,
  riskPercentage: number,
  stopLossDistance: number,
  currentPrice: number
): number => {
  // Calculate position size based on risk per trade
  const riskAmount = accountBalance * riskPercentage;
  const stopLossDollars = stopLossDistance * currentPrice;

  if (stopLossDollars === 0) {
    return config.strategy.position.size;
  }

  const positionSize = Math.floor(riskAmount / stopLossDollars);

  // Cap at configured max position size
  return Math.min(positionSize, config.strategy.position.size);
};

export const checkDailyReset = (
  state: RiskState,
  currentTime: number = Date.now()
): RiskState => {
  if (currentTime < state.dailyResetTime) return state;

  // It is a new day (or later)
  logger.info(
    `Doing Daily Risk Reset at ${new Date(currentTime).toISOString()}`
  );

  const nextReset = new Date(currentTime);
  nextReset.setDate(nextReset.getDate() + 1);
  nextReset.setHours(0, 0, 0, 0);

  return {
    ...state,
    dailyPnL: 0,
    tradesToday: 0,
    lossesToday: 0,
    dailyResetTime: nextReset.getTime(),
  };
};
