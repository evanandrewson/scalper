import { Config, loadConfig } from './config.js';
import { createAlpacaClient } from './alpaca-client.js';
import {
  createVWAPState,
  updateVWAP,
  getVWAP,
} from './vwap.js';
import {
  createStrategyState,
  evaluateStrategy,
} from './strategy.js';
import { createRiskState, checkDailyReset } from './risk-manager.js';
import { logger } from './utils/logger.js';
import fs from 'fs';
import path from 'path';

interface TradeRecord {
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  exitPrice: number;
  entryTime: string;
  exitTime: string;
  quantity: number;
  pnl: number;
  pnlPct: number;
  reason: string;
}

interface BacktestResult {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  totalPnL: number;
  winRate: number;
  maxDrawdown: number;
  trades: TradeRecord[];
}

export const runBacktest = async (
  symbol: string,
  bars: any[], // Alpaca Bars
  config: Config
): Promise<BacktestResult> => {
  logger.info(`Starting backtest for ${symbol} with ${bars.length} bars...`);

  // Initialize State
  const startTime =
    bars.length > 0 ? new Date(bars[0].Timestamp).getTime() : Date.now();
  let vwapState = createVWAPState(config.strategy.vwap.period);
  let strategyState = createStrategyState(config);
  let riskState = createRiskState(config, startTime);

  const trades: TradeRecord[] = [];
  let peakPnL = 0;
  let maxDrawdown = 0;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const timestamp = new Date(bar.Timestamp).getTime();
    riskState = checkDailyReset(riskState, timestamp);

    const price = bar.ClosePrice; // Use close price for decision
    const volume = bar.Volume;

    // 4. Reset "Daily" VWAP if new day
    if (i > 0) {
      const prevDay = new Date(bars[i - 1].Timestamp).getDate();
      const currDay = new Date(bar.Timestamp).getDate();
      if (currDay !== prevDay) {
        // Reset VWAP state for new day if using daily VWAP (period 0)
        // But our createVWAPState takes period from config.
        // If config.period is 0, we should reset.
        if (config.strategy.vwap.period === 0) {
          vwapState = createVWAPState(0);
        }
      }
    }

    // 1. Update VWAP
    vwapState = updateVWAP(
      vwapState,
      price,
      volume,
      bar.HighPrice,
      bar.LowPrice
    );
    const currentVWAP = getVWAP(vwapState);

    // Skip strategy evaluation if we don't have enough data for VWAP
    if (currentVWAP === null) continue;

    // Log every 1000 bars
    if (i % 1000 === 0) {
      // logger.info(`Bar ${i}: Price $${price.toFixed(2)} | VWAP $${currentVWAP.toFixed(2)} | Diff ${(price-currentVWAP).toFixed(2)}`);
      console.log(
        `Bar ${i}: Price $${price.toFixed(2)} | VWAP $${currentVWAP.toFixed(2)} | Diff ${(price - currentVWAP).toFixed(2)}`
      );
    }

    // Capture state before evaluation to detect changes
    const prevPositions = new Map(strategyState.positions);
    const prevPnL = riskState.dailyPnL;

    // 2. Evaluate Strategy
    const [newStrategyState, newRiskState] = evaluateStrategy(
      strategyState,
      riskState,
      symbol,
      price,
      currentVWAP,
      vwapState,
      timestamp
    );

    // 3. Trade Detection Logic
    const hadPosition = prevPositions.get(symbol);
    const hasPosition = newStrategyState.positions.get(symbol);

    // Detect Entry
    if (!hadPosition && hasPosition) {
      // Trade Opened
      // We don't need to log this for the result, just internal tracking
    }

    // Detect Exit
    if (hadPosition && !hasPosition) {
      // Trade Closed
      const pnlChange = newRiskState.dailyPnL - prevPnL;

      const trade: TradeRecord = {
        symbol,
        side: hadPosition.side,
        entryPrice: hadPosition.entryPrice,
        exitPrice: price,
        entryTime: new Date(hadPosition.entryTime).toISOString(),
        exitTime: new Date(timestamp).toISOString(),
        quantity: hadPosition.quantity,
        pnl: pnlChange,
        pnlPct:
          (pnlChange / (hadPosition.entryPrice * hadPosition.quantity)) * 100,
        reason: 'Backtest Exit', // Logic in strategy determines this, but we don't capture the string return.
        // Ideally strategy would return an "Action" object, but diffing state is fine.
      };

      trades.push(trade);
    }

    // Update States
    strategyState = newStrategyState;
    riskState = newRiskState;

    // Update Max Drawdown
    if (riskState.dailyPnL > peakPnL) {
      peakPnL = riskState.dailyPnL;
    }
    const currentDrawdown = peakPnL - riskState.dailyPnL;
    if (currentDrawdown > maxDrawdown) {
      maxDrawdown = currentDrawdown;
    }
  }

  // Calculate Statistics
  const winningTrades = trades.filter((t) => t.pnl > 0).length;
  const losingTrades = trades.filter((t) => t.pnl <= 0).length;
  const totalPnL = riskState.dailyPnL;
  const winRate = trades.length > 0 ? (winningTrades / trades.length) * 100 : 0;

  return {
    totalTrades: trades.length,
    winningTrades,
    losingTrades,
    totalPnL,
    winRate,
    maxDrawdown,
    trades,
  };
};

const main = async () => {
  // Determine mode: "fetch" to get data, or "run" to backtest
  const args = process.argv.slice(2);
  const mode = args[0] || 'run';

  const config = loadConfig();
  const symbol = config.trading.symbols[0] || 'SPY';
  const dataFile = path.join(process.cwd(), 'data', `${symbol}_backtest.json`);

  // Ensure data directory exists
  if (!fs.existsSync(path.dirname(dataFile))) {
    fs.mkdirSync(path.dirname(dataFile));
  }

  if (mode === 'fetch') {
    logger.info(`Fetching backtest data for ${symbol}...`);
    const alpacaState = createAlpacaClient(config);

    // Fetch Full Year 2025
    const start = new Date('2025-01-01T00:00:00Z');
    const end = new Date('2025-12-31T23:59:59Z');

    try {
      const bars = [];
      const barIter = alpacaState.client.getBarsV2(symbol, {
        start: start.toISOString(),
        end: end.toISOString(),
        timeframe: '1Min',
      });

      for await (const bar of barIter) {
        bars.push(bar);
      }

      fs.writeFileSync(dataFile, JSON.stringify(bars, null, 2));
      logger.info(`Saved ${bars.length} bars to ${dataFile}`);
    } catch (err) {
      logger.error('Failed to fetch data', err);
    }
  } else {
    // Run Backtest
    if (!fs.existsSync(dataFile)) {
      logger.error(
        `Data file not found: ${dataFile}. Run 'npm run backtest:fetch' first.`
      );
      process.exit(1);
    }

    const rawData = fs.readFileSync(dataFile, 'utf-8');
    const bars = JSON.parse(rawData);

    const results = await runBacktest(symbol, bars, config);

    console.log('\n==========================================');
    console.log(`BACKTEST RESULTS: ${symbol}`);
    console.log('==========================================');
    console.log(`Total Trades: ${results.totalTrades}`);
    console.log(`Win Rate:     ${results.winRate.toFixed(2)}%`);
    console.log(`Total P&L:    $${results.totalPnL.toFixed(2)}`);
    console.log(`Max Drawdown: $${results.maxDrawdown.toFixed(2)}`);
    console.log('==========================================');
    console.table(
      results.trades.map((t) => ({
        Side: t.side,
        Entry: `$${t.entryPrice.toFixed(2)}`,
        Exit: `$${t.exitPrice.toFixed(2)}`,
        PnL: `$${t.pnl.toFixed(2)}`,
      }))
    );
  }
};

// Check if running directly
import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
