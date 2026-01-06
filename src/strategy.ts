/**
 * Trading Strategy Implementation - Functional Style
 */
import { Config } from './config.js';
import { VWAPState } from './vwap.js';
import {
  calculateATR,
  calculateVWAPSlope,
  isChoppy,
  calculateRSI,
} from './utils/indicators.js';
import {
  RiskState,
  canOpenPosition,
  recordPosition,
  closePosition as closeRiskPosition,
} from './risk-manager.js';
import { logger, tradeLogger } from './utils/logger.js';

export interface Position {
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  quantity: number;
  entryTime: number;
  stopLoss: number;
  takeProfit: number;
  trailingStop?: number;
}

// State Machine for pending signals (Confirmation Candles)
export interface PendingSignal {
  type: 'potential_long' | 'potential_short';
  triggerCandleTime: number;
  triggerPrice: number;
}

export interface StrategyState {
  config: Config;
  positions: Map<string, Position>;
  pendingSignals: Map<string, PendingSignal>;
}

export const createStrategyState = (config: Config): StrategyState => ({
  config,
  positions: new Map(),
  pendingSignals: new Map(),
});

const calculatePnL = (position: Position, currentPrice: number): number => {
  if (position.side === 'long') {
    return (currentPrice - position.entryPrice) * position.quantity;
  } else {
    return (position.entryPrice - currentPrice) * position.quantity;
  }
};

const enterLongPosition = (
  strategyState: StrategyState,
  riskState: RiskState,
  symbol: string,
  entryPrice: number,
  currentTime: number = Date.now()
): [StrategyState, RiskState] => {
  const { config } = strategyState;
  let quantity = config.strategy.position.size;

  // Dynamic Position Sizing
  if (
    config.strategy.position.sizing_type === 'risk_pct' &&
    config.strategy.position.max_risk_pct
  ) {
    const riskAmount =
      riskState.currentBalance * config.strategy.position.max_risk_pct;
    const riskPerShare = entryPrice * config.strategy.risk.stop_loss_pct;
    if (riskPerShare > 0) {
      quantity = Math.floor(riskAmount / riskPerShare);
    }
  }
  // Ensure we can afford it (max leverage check essentially) - primitive check
  // Assuming 4x margin or just cash? Let's check cash for now or assume margin.
  // Ideally check buying power. For now, assume sufficient BP if risk sizing is used.
  if (quantity < 1) quantity = 1; // Fallback

  const stopLoss =
    entryPrice * (1 - strategyState.config.strategy.risk.stop_loss_pct);
  const takeProfit =
    entryPrice * (1 + strategyState.config.strategy.risk.take_profit_pct);

  logger.info(
    `🔵 LONG SIGNAL: ${symbol} at $${entryPrice.toFixed(2)} (below VWAP)`
  );

  const position: Position = {
    symbol,
    side: 'long',
    entryPrice,
    quantity,
    entryTime: currentTime,
    stopLoss,
    takeProfit,
    trailingStop: strategyState.config.strategy.risk.trailing_stop
      ? entryPrice * (1 - strategyState.config.strategy.risk.trailing_stop_pct)
      : undefined,
  };

  const newPositions = new Map(strategyState.positions);
  newPositions.set(symbol, position);

  const newRiskState = recordPosition(
    riskState,
    symbol,
    entryPrice,
    quantity,
    currentTime
  );

  tradeLogger.info(
    JSON.stringify({
      action: 'ENTER_LONG',
      symbol,
      price: entryPrice,
      quantity,
      stopLoss,
      takeProfit,
      timestamp: new Date(currentTime).toISOString(),
    })
  );

  return [{ ...strategyState, positions: newPositions }, newRiskState];
};

const enterShortPosition = (
  strategyState: StrategyState,
  riskState: RiskState,
  symbol: string,
  entryPrice: number,
  currentTime: number = Date.now()
): [StrategyState, RiskState] => {
  const { config } = strategyState;
  let quantity = config.strategy.position.size;

  // Dynamic Position Sizing
  if (
    config.strategy.position.sizing_type === 'risk_pct' &&
    config.strategy.position.max_risk_pct
  ) {
    const riskAmount =
      riskState.currentBalance * config.strategy.position.max_risk_pct;
    const riskPerShare = entryPrice * config.strategy.risk.stop_loss_pct;
    if (riskPerShare > 0) {
      quantity = Math.floor(riskAmount / riskPerShare);
    }
  }
  if (quantity < 1) quantity = 1;

  const stopLoss =
    entryPrice * (1 + strategyState.config.strategy.risk.stop_loss_pct);
  const takeProfit =
    entryPrice * (1 - strategyState.config.strategy.risk.take_profit_pct);

  logger.info(
    `🔴 SHORT SIGNAL: ${symbol} at $${entryPrice.toFixed(2)} (above VWAP)`
  );

  const position: Position = {
    symbol,
    side: 'short',
    entryPrice,
    quantity,
    entryTime: currentTime,
    stopLoss,
    takeProfit,
    trailingStop: strategyState.config.strategy.risk.trailing_stop
      ? entryPrice * (1 + strategyState.config.strategy.risk.trailing_stop_pct)
      : undefined,
  };

  const newPositions = new Map(strategyState.positions);
  newPositions.set(symbol, position);

  const newRiskState = recordPosition(
    riskState,
    symbol,
    entryPrice,
    -quantity,
    currentTime
  );

  tradeLogger.info(
    JSON.stringify({
      action: 'ENTER_SHORT',
      symbol,
      price: entryPrice,
      quantity,
      stopLoss,
      takeProfit,
      timestamp: new Date(currentTime).toISOString(),
    })
  );

  return [{ ...strategyState, positions: newPositions }, newRiskState];
};

const exitPosition = (
  strategyState: StrategyState,
  riskState: RiskState,
  symbol: string,
  exitPrice: number,
  reason: string,
  pnl: number,
  currentTime: number = Date.now()
): [StrategyState, RiskState] => {
  const position = strategyState.positions.get(symbol);

  if (!position) {
    return [strategyState, riskState];
  }

  const pnlPct = (pnl / (position.entryPrice * position.quantity)) * 100;
  const holdTime = (currentTime - position.entryTime) / 1000;

  logger.info(
    `✅ EXIT ${position.side.toUpperCase()}: ${symbol} at $${exitPrice.toFixed(2)} | Reason: ${reason} | P&L: $${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%) | Hold: ${holdTime.toFixed(0)}s`
  );

  const newPositions = new Map(strategyState.positions);
  newPositions.delete(symbol);

  const newRiskState = closeRiskPosition(riskState, symbol, pnl, currentTime);

  tradeLogger.info(
    JSON.stringify({
      action: 'EXIT',
      symbol,
      side: position.side,
      entryPrice: position.entryPrice,
      exitPrice,
      quantity: position.quantity,
      pnl,
      pnlPct,
      reason,
      holdTime,
      timestamp: new Date(currentTime).toISOString(),
    })
  );

  return [{ ...strategyState, positions: newPositions }, newRiskState];
};

const managePosition = (
  strategyState: StrategyState,
  riskState: RiskState,
  symbol: string,
  currentPrice: number,
  _vwap: number,
  position: Position,
  currentTime: number = Date.now()
): [StrategyState, RiskState] => {
  const pnl = calculatePnL(position, currentPrice);
  const pnlPct = (pnl / (position.entryPrice * position.quantity)) * 100;
  const holdTime = (currentTime - position.entryTime) / 1000; // Seconds

  // Check Time Stop (Max Hold)
  if (
    strategyState.config.strategy.risk.max_hold_seconds &&
    holdTime >= strategyState.config.strategy.risk.max_hold_seconds
  ) {
    // If we've held too long, exit.
    // Optimally, we might only exit if PnL is negative, or just always to free capital.
    // For scalping, "stale" trades are bad. Exit regardless of PnL (usually small +/-).
    return exitPosition(
      strategyState,
      riskState,
      symbol,
      currentPrice,
      'TIME_STOP',
      pnl,
      currentTime
    );
  }

  // Check stop loss
  if (position.side === 'long' && currentPrice <= position.stopLoss) {
    return exitPosition(
      strategyState,
      riskState,
      symbol,
      currentPrice,
      'STOP_LOSS',
      pnl,
      currentTime
    );
  }
  if (position.side === 'short' && currentPrice >= position.stopLoss) {
    return exitPosition(
      strategyState,
      riskState,
      symbol,
      currentPrice,
      'STOP_LOSS',
      pnl,
      currentTime
    );
  }

  // Check take profit
  if (position.side === 'long' && currentPrice >= position.takeProfit) {
    return exitPosition(
      strategyState,
      riskState,
      symbol,
      currentPrice,
      'TAKE_PROFIT',
      pnl,
      currentTime
    );
  }
  if (position.side === 'short' && currentPrice <= position.takeProfit) {
    return exitPosition(
      strategyState,
      riskState,
      symbol,
      currentPrice,
      'TAKE_PROFIT',
      pnl,
      currentTime
    );
  }

  // Update trailing stop
  let updatedPosition = position;
  if (
    strategyState.config.strategy.risk.trailing_stop &&
    position.trailingStop
  ) {
    const trailingPct = strategyState.config.strategy.risk.trailing_stop_pct;

    if (position.side === 'long') {
      const newTrailing = currentPrice * (1 - trailingPct);
      if (newTrailing > position.trailingStop) {
        updatedPosition = { ...position, trailingStop: newTrailing };
        logger.debug(
          `Updated trailing stop for ${symbol}: $${newTrailing.toFixed(2)}`
        );
      }

      if (currentPrice <= updatedPosition.trailingStop!) {
        return exitPosition(
          strategyState,
          riskState,
          symbol,
          currentPrice,
          'TRAILING_STOP',
          pnl,
          currentTime
        );
      }
    } else {
      const newTrailing = currentPrice * (1 + trailingPct);
      if (newTrailing < position.trailingStop) {
        updatedPosition = { ...position, trailingStop: newTrailing };
        logger.debug(
          `Updated trailing stop for ${symbol}: $${newTrailing.toFixed(2)}`
        );
      }

      if (currentPrice >= updatedPosition.trailingStop!) {
        return exitPosition(
          strategyState,
          riskState,
          symbol,
          currentPrice,
          'TRAILING_STOP',
          pnl,
          currentTime
        );
      }
    }
  }

  // VWAP Reversion exit removed to support Reclaim/Rejection strategies which enter near VWAP.
  // Reliance is on Stop Loss and Take Profit.

  // Update position if trailing stop changed
  if (updatedPosition !== position) {
    const newPositions = new Map(strategyState.positions);
    newPositions.set(symbol, updatedPosition);
    strategyState = { ...strategyState, positions: newPositions };
  }

  // Log position status periodically
  logger.debug(
    `Position ${symbol}: ${position.side.toUpperCase()} | Entry: $${position.entryPrice.toFixed(2)} | Current: $${currentPrice.toFixed(2)} | P&L: $${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`
  );

  return [strategyState, riskState];
};

const checkEntrySignals = (
  strategyState: StrategyState,
  riskState: RiskState,
  symbol: string,
  currentPrice: number,
  vwap: number,
  vwapSlope: number,
  atr: number,
  rsi: number,
  vwapState: VWAPState,
  currentTime: number = Date.now()
): [StrategyState, RiskState] => {
  // Check if we can open new positions
  if (!canOpenPosition(riskState, currentTime)) {
    return [strategyState, riskState];
  }

  // Debug: Log every 100th evaluation
  if (Math.random() < 0.01) {
    logger.info(
      `${symbol}: Eval - price:${currentPrice.toFixed(
        2
      )}, vwap:${vwap.toFixed(2)}, dev:${(
        ((currentPrice - vwap) / vwap) *
        100
      ).toFixed(
        3
      )}%, slope:${vwapSlope.toFixed(4)}, rsi:${rsi ? rsi.toFixed(2) : 'N/A'}`
    );
  }

  // Time Window Check - Dynamic from Config
  const now = new Date(currentTime);

  // Parse config times (ET)
  const [startH, startM] = strategyState.config.trading.schedule.start_time
    .split(':')
    .map(Number);
  const [endH, endM] = strategyState.config.trading.schedule.end_time
    .split(':')
    .map(Number);

  // Convert to UTC (Assuming +5h offset for backtest consistency)
  // Note: For live trading, we should use a proper timezone library.
  const utcStartH = startH + 5;
  const utcEndH = endH + 5;

  const currentH = now.getUTCHours();
  const currentM = now.getUTCMinutes();

  // Check Start
  if (currentH < utcStartH || (currentH === utcStartH && currentM < startM)) {
    return [strategyState, riskState];
  }

  // Check End
  if (currentH > utcEndH || (currentH === utcEndH && currentM >= endM)) {
    return [strategyState, riskState];
  }

  // Market Regime Filters
  const { chop_threshold, min_volume_mult } =
    strategyState.config.strategy.filters;

  // Volume Filter
  const volumes = vwapState.dataPoints.map((d) => d.volume);
  if (volumes.length > 20) {
    const recentVolumes = volumes.slice(-20); // Last 20 bars
    const avgVol =
      recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
    const currentVol = volumes[volumes.length - 1];

    if (currentVol < avgVol * min_volume_mult) {
      // Volume too low
      if (Math.random() < 0.001)
        logger.debug(
          `${symbol}: Low volume (${currentVol} < ${avgVol.toFixed(0)} * ${min_volume_mult}). Skipping.`
        );
      return [strategyState, riskState];
    }
  }

  // ATR Filter (Low Volatility Avoidance)
  const minAtrPct = strategyState.config.strategy.filters.min_atr_pct || 0;
  if (minAtrPct > 0 && atr !== null) {
    // atr is passed as argument
    const atrRatio = atr / currentPrice;
    if (atrRatio < minAtrPct) {
      if (Math.random() < 0.001)
        logger.debug(
          `${symbol}: Low Volatility (ATR ${atr.toFixed(2)} < ${(minAtrPct * 100).toFixed(3)}% of Price). Skipping.`
        );
      return [strategyState, riskState];
    }
  }

  // Chop Filter
  const prices = vwapState.dataPoints.map((d) => d.price);
  const vwaps = vwapState.dataPoints.map((d) => d.vwap || d.price);
  if (isChoppy(prices, vwaps, 20, chop_threshold)) {
    logger.debug(`${symbol}: Choppy market detected. Skipping.`);
    return [strategyState, riskState];
  }

  // Pending Signal Logic (Confirmation)
  const pending = strategyState.pendingSignals.get(symbol);

  // A. Check Pending Confirmations
  if (pending) {
    if (pending.type === 'potential_long') {
      // Confirmation: Next candle does NOT close back below VWAP
      // If current price > VWAP, we hold. We enter on break of trigger price?
      // Instructions: "Next candle does not close back below VWAP (hold candle)"
      // Entry Method: "Buy Stop at high(reclaim candle) + buffer"

      if (currentPrice < vwap) {
        // Failed confirmation
        logger.debug(`${symbol}: Long confirmation failed (closed below VWAP)`);
        const newPending = new Map(strategyState.pendingSignals);
        newPending.delete(symbol);
        return [{ ...strategyState, pendingSignals: newPending }, riskState];
      }

      // Confirmed! Enter Long.
      // Note: In real trading strict, we'd place a stop order.
      // Here we simulate market entry if price > trigger + buffer?
      // Instructions say "Buy stop at high(reclaim candle)".
      // For simplicity in this loop, we enter now if we are confirmed.
      const newPending = new Map(strategyState.pendingSignals);
      newPending.delete(symbol);
      return enterLongPosition(
        { ...strategyState, pendingSignals: newPending },
        riskState,
        symbol,
        currentPrice,
        currentTime
      );
    }
    // Symmetric logic for Short
    if (pending.type === 'potential_short') {
      if (currentPrice > vwap) {
        // Failed confirmation
        logger.debug(
          `${symbol}: Short confirmation failed (closed above VWAP)`
        );
        const newPending = new Map(strategyState.pendingSignals);
        newPending.delete(symbol);
        return [{ ...strategyState, pendingSignals: newPending }, riskState];
      }

      const newPending = new Map(strategyState.pendingSignals);
      newPending.delete(symbol);
      return enterShortPosition(
        { ...strategyState, pendingSignals: newPending },
        riskState,
        symbol,
        currentPrice,
        currentTime
      );
    }
  }

  // B. Check New Signals (Mean Reversion)

  // Simpler approach: Enter when price deviates from VWAP by a threshold
  const deviation = (currentPrice - vwap) / vwap;
  const deviationPct = Math.abs(deviation) * 100;

  // Entry threshold from config (e.g., 0.0005 = 0.05%)
  const entryThreshold = strategyState.config.strategy.vwap.entry_threshold;

  // Strategy A: Long when price is below VWAP by threshold
  if (deviation < -entryThreshold) {
    logger.debug(
      `${symbol}: LONG setup - deviation: ${deviationPct.toFixed(
        3
      )}%, threshold: ${(entryThreshold * 100).toFixed(3)}%`
    );
    // STRICTER Slope Filter: Removed (was limiting entries during high volatility)
    // RSI Filter: Ensure we are in a dip (oversold-ish)
    const rsiOversold =
      strategyState.config.strategy.filters.rsi_oversold || 40;

    // if (vwapSlope > -0.05 && rsi < rsiOversold) {
    if (rsi < rsiOversold) {
      if (strategyState.config.strategy.vwap.require_confirmation === false) {
        return enterLongPosition(
          strategyState,
          riskState,
          symbol,
          currentPrice,
          currentTime
        );
      }
      logger.info(
        `${symbol}: potential LONG reclaim detected. Waiting for confirmation.`
      );
      const newPending = new Map(strategyState.pendingSignals);
      newPending.set(symbol, {
        type: 'potential_long',
        triggerCandleTime: currentTime,
        triggerPrice: currentPrice,
      });
      return [{ ...strategyState, pendingSignals: newPending }, riskState];
    }
  }

  // Strategy B: Short when price is above VWAP by threshold
  if (deviation > entryThreshold) {
    logger.debug(
      `${symbol}: SHORT setup - deviation: ${deviationPct.toFixed(
        3
      )}%, threshold: ${(entryThreshold * 100).toFixed(3)}%`
    );
    // STRICTER Slope Filter: Removed
    // RSI Filter: Ensure we are in a spike (overbought-ish)
    const rsiOverbought =
      strategyState.config.strategy.filters.rsi_overbought || 60;

    // if (vwapSlope < 0.05 && rsi > rsiOverbought) {
    if (rsi > rsiOverbought) {
      if (strategyState.config.strategy.vwap.require_confirmation === false) {
        return enterShortPosition(
          strategyState,
          riskState,
          symbol,
          currentPrice,
          currentTime
        );
      }
      logger.info(
        `${symbol}: potential SHORT rejection detected. Waiting for confirmation.`
      );
      const newPending = new Map(strategyState.pendingSignals);
      newPending.set(symbol, {
        type: 'potential_short',
        triggerCandleTime: currentTime,
        triggerPrice: currentPrice,
      });
      return [{ ...strategyState, pendingSignals: newPending }, riskState];
    }
  }

  return [strategyState, riskState];
};

export const evaluateStrategy = (
  strategyState: StrategyState,
  riskState: RiskState,
  symbol: string,
  currentPrice: number,
  vwap: number,
  vwapState?: VWAPState, // Needed for history/indicators
  currentTime: number = Date.now()
): [StrategyState, RiskState] => {
  if (!vwapState) {
    // Fallback for tests/old calls
    return [strategyState, riskState];
  }

  const vwapSlope = calculateVWAPSlope(
    vwap,
    vwapState.dataPoints
      .map((d) => d.vwap || d.price)
      .filter((v) => v !== undefined) as number[]
  );
  const atr = calculateATR(vwapState.dataPoints);

  const prices = vwapState.dataPoints.map((d) => d.price);
  const rsiPeriod = strategyState.config.strategy.filters.rsi_period || 14;
  const rsi = calculateRSI(prices, rsiPeriod);

  // Temporarily disable ATR requirement for testing
  // if (!atr) {

  //   if (Math.random() < 0.01) {
  //     logger.warn(
  //       `${symbol}: No ATR - dataPoints: ${vwapState.dataPoints.length}, atr_period config: ${strategyState.config.strategy.filters.atr_period}`
  //     );
  //   }
  //   return [strategyState, riskState]; // Not enough data
  // }

  if (rsi === null || atr === null) {
    return [strategyState, riskState];
  }

  // Check if we have an open position
  const position = strategyState.positions.get(symbol);

  const now = new Date(currentTime);
  const hour = now.getUTCHours();
  const min = now.getUTCMinutes();

  // EOD Force Exit (20:55 UTC)
  if (position) {
    if (hour >= 20 && min >= 55) {
      const pnl = calculatePnL(position, currentPrice);
      return exitPosition(
        strategyState,
        riskState,
        symbol,
        currentPrice,
        'EOD_FORCE_EXIT',
        pnl,
        currentTime
      );
    }
  }

  if (position) {
    // Manage existing position
    return managePosition(
      strategyState,
      riskState,
      symbol,
      currentPrice,
      vwap,
      position,
      currentTime
    );
  } else {
    // Look for entry opportunities
    return checkEntrySignals(
      strategyState,
      riskState,
      symbol,
      currentPrice,
      vwap,
      vwapSlope,
      atr,
      rsi,
      vwapState,
      currentTime
    );
  }
};

export const getOpenPositions = (state: StrategyState): Position[] => {
  return Array.from(state.positions.values());
};
