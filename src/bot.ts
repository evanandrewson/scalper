/**
 * Main Bot Controller - Functional Style
 */
import { Config } from './config.js';
import {
  AlpacaState,
  createAlpacaClient,
  getAccount,
  getClock,
  subscribeToMarketData,
  closeAllPositions,
  unsubscribeFromMarketData,
  submitOrder,
  closePosition,
  getPositions,
} from './alpaca-client.js';
import { VWAPState, createVWAPState, updateVWAP, getVWAP } from './vwap.js';
import {
  StrategyState,
  createStrategyState,
  evaluateStrategy,
  Position,
} from './strategy.js';
import {
  RiskState,
  createRiskState,
  checkAndResetIfNeeded,
  recordPosition,
} from './risk-manager.js';
import { logger } from './utils/logger.js';

export interface BotState {
  config: Config;
  alpaca: AlpacaState;
  vwapStates: Map<string, VWAPState>;
  strategy: StrategyState;
  risk: RiskState;
  isRunning: boolean;
}

export const createBot = (config: Config): BotState => {
  const alpaca = createAlpacaClient(config);
  const strategy = createStrategyState(config);
  const risk = createRiskState(config);
  const vwapStates = new Map<string, VWAPState>();

  // Create VWAP state for each symbol
  config.trading.symbols.forEach((symbol) => {
    vwapStates.set(symbol, createVWAPState(config.strategy.vwap.period));
  });

  logger.info(
    'Bot initialized with config:',
    `Config(symbols=${config.trading.symbols.join(',')}, timeframe=${config.trading.timeframe}, dry_run=${config.bot.dry_run})`
  );

  return {
    config,
    alpaca,
    vwapStates,
    strategy,
    risk,
    isRunning: false,
  };
};

const handleMarketData = (
  state: BotState,
  symbol: string,
  data: any
): BotState => {
  try {
    // Update VWAP calculator
    const vwapState = state.vwapStates.get(symbol);
    if (!vwapState) {
      return state;
    }

    const updatedVWAPState = updateVWAP(vwapState, data.price, data.volume);
    const vwap = getVWAP(updatedVWAPState);

    if (vwap === null) {
      // Not enough data yet
      const newVWAPStates = new Map(state.vwapStates);
      newVWAPStates.set(symbol, updatedVWAPState);
      return { ...state, vwapStates: newVWAPStates };
    }

    // Check and reset risk state if needed
    let newRisk = checkAndResetIfNeeded(state.risk);

    // Execute trading strategy
    const [newStrategy, updatedRisk] = evaluateStrategy(
      state.strategy,
      newRisk,
      symbol,
      data.price,
      vwap,
      updatedVWAPState
    );

    // DETECT ENTRIES AND EXITS
    const prevPos = state.strategy.positions.get(symbol);
    const newPos = newStrategy.positions.get(symbol);

    if (!prevPos && newPos) {
      // ENTRY DETECTED
      const slippage = state.config.trading.max_slippage_pct || 0.001;
      // Buy: Limit > Price (marketable), Sell: Limit < Price
      const limitPrice =
        newPos.side === 'long'
          ? data.price * (1 + slippage)
          : data.price * (1 - slippage);

      logger.info(
        `🚀 EXECUTING ENTRY for ${symbol}: ${newPos.side.toUpperCase()} ${newPos.quantity} shares @ Limit $${limitPrice.toFixed(2)}`
      );
      submitOrder(state.alpaca, {
        symbol: newPos.symbol,
        qty: newPos.quantity,
        side: newPos.side === 'long' ? 'buy' : 'sell',
        type: 'limit',
        limit_price: Number(limitPrice.toFixed(2)),
        time_in_force: 'day',
      }).catch((err) => logger.error(`Order Failed for ${symbol}`, err));
    } else if (prevPos && !newPos) {
      // EXIT DETECTED
      logger.info(`💰 EXECUTING EXIT for ${symbol}`);
      closePosition(state.alpaca, symbol).catch((err) =>
        logger.error(`Exit Failed for ${symbol}`, err)
      );
    }

    const newVWAPStates = new Map(state.vwapStates);
    newVWAPStates.set(symbol, updatedVWAPState);

    return {
      ...state,
      vwapStates: newVWAPStates,
      strategy: newStrategy,
      risk: updatedRisk,
    };
  } catch (error) {
    logger.error(`Error handling market data for ${symbol}:`, error);
    return state;
  }
};

const syncState = async (state: BotState): Promise<BotState> => {
  logger.info('Syncing state with Alpaca...');
  const alpacaPositions = await getPositions(state.alpaca);

  let newStrategy = state.strategy;
  let newRisk = state.risk;
  const currentTime = Date.now();

  for (const p of alpacaPositions) {
    const symbol = p.symbol;
    const quantity = Math.abs(parseInt(p.qty));
    const side = parseInt(p.qty) > 0 ? 'long' : 'short';
    const entryPrice = parseFloat(p.avg_entry_price);

    // Skip if config doesn't include this symbol
    if (!state.config.trading.symbols.includes(symbol)) {
      logger.warn(`Found position ${symbol} not in config. Ignoring.`);
      continue;
    }

    logger.info(
      `Recovering position: ${side.toUpperCase()} ${symbol} x${quantity} @ $${entryPrice.toFixed(2)}`
    );

    // Reconstruct Strategy Position
    const stopLossPct = state.config.strategy.risk.stop_loss_pct;
    const takeProfitPct = state.config.strategy.risk.take_profit_pct;

    const stopLoss =
      side === 'long'
        ? entryPrice * (1 - stopLossPct)
        : entryPrice * (1 + stopLossPct);

    const takeProfit =
      side === 'long'
        ? entryPrice * (1 + takeProfitPct)
        : entryPrice * (1 - takeProfitPct);

    const position: Position = {
      symbol,
      side: side as 'long' | 'short',
      entryPrice,
      quantity,
      entryTime: currentTime, // Unknown, reset timer
      stopLoss,
      takeProfit,
    };

    // Update Strategy State
    const strategyPositions = new Map(newStrategy.positions);
    strategyPositions.set(symbol, position);
    newStrategy = { ...newStrategy, positions: strategyPositions };

    // Update Risk State
    newRisk = recordPosition(
      newRisk,
      symbol,
      entryPrice,
      side === 'long' ? quantity : -quantity,
      currentTime
    );
  }

  return { ...state, strategy: newStrategy, risk: newRisk };
};

export const runBot = async (initialState: BotState): Promise<void> => {
  let state = { ...initialState, isRunning: true };
  logger.info('Starting VWAP Scalper Bot...');

  try {
    // Verify connection to Alpaca
    const account = await getAccount(state.alpaca);
    logger.info(`Connected to Alpaca account: ${account.account_number}`);
    logger.info(
      `Buying Power: $${parseFloat(account.buying_power).toFixed(2)}`
    );
    logger.info(`Cash: $${parseFloat(account.cash).toFixed(2)}`);

    // Check if market is open
    const clock = await getClock(state.alpaca);
    if (!clock.is_open) {
      logger.warn('Market is currently closed');
      logger.info(`Next open: ${clock.next_open}`);
      logger.info(`Next close: ${clock.next_close}`);
    }

    // Recover state from existing positions
    state = await syncState(state);

    // Subscribe to market data for configured symbols
    logger.info(
      `Subscribing to symbols: ${state.config.trading.symbols.join(', ')}`
    );

    const updatedAlpaca = await subscribeToMarketData(
      state.alpaca,
      state.config.trading.symbols,
      (symbol, data) => {
        state = handleMarketData(state, symbol, data);
      }
    );

    state = { ...state, alpaca: updatedAlpaca };

    logger.info('Bot is now running. Press Ctrl+C to stop.');

    // Keep the process alive
    await new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (!state.isRunning) {
          clearInterval(checkInterval);
          resolve(null);
        }
      }, 1000);
    });
  } catch (error) {
    logger.error('Error running bot:', error);
    throw error;
  }
};

export const stopBot = async (state: BotState): Promise<void> => {
  logger.info('Stopping bot...');

  try {
    // Close all positions
    await closeAllPositions(state.alpaca);
    logger.info('All positions closed');

    // Unsubscribe from market data
    await unsubscribeFromMarketData(state.alpaca);
    logger.info('Unsubscribed from market data');
  } catch (error) {
    logger.error('Error during shutdown:', error);
  }
};
