/**
 * Alpaca API Client - Functional Style
 */
import Alpaca from '@alpacahq/alpaca-trade-api';
import { Config } from './config.js';
import { logger } from './utils/logger.js';

export interface AlpacaState {
  client: any;
  dataStream: any | null;
  config: Config;
}

export const createAlpacaClient = (config: Config): AlpacaState => {
  const client = new Alpaca({
    keyId: config.apiKey,
    secretKey: config.secretKey,
    paper: config.baseUrl.includes('paper'),
    usePolygon: false,
  });

  logger.info('Alpaca client initialized');

  return {
    client,
    dataStream: null,
    config,
  };
};

export const getAccount = async (state: AlpacaState): Promise<any> => {
  try {
    return await state.client.getAccount();
  } catch (error) {
    logger.error('Error getting account:', error);
    throw error;
  }
};

export const getClock = async (state: AlpacaState): Promise<any> => {
  try {
    return await state.client.getClock();
  } catch (error) {
    logger.error('Error getting clock:', error);
    throw error;
  }
};

export const getPositions = async (state: AlpacaState): Promise<any[]> => {
  try {
    return await state.client.getPositions();
  } catch (error) {
    logger.error('Error getting positions:', error);
    throw error;
  }
};

export const getPosition = async (
  state: AlpacaState,
  symbol: string
): Promise<any> => {
  try {
    return await state.client.getPosition(symbol);
  } catch (error: any) {
    // Position not found is not an error
    if (error.message?.includes('position does not exist')) {
      return null;
    }
    logger.error(`Error getting position for ${symbol}:`, error);
    throw error;
  }
};

export const submitOrder = async (
  state: AlpacaState,
  params: {
    symbol: string;
    qty: number;
    side: 'buy' | 'sell';
    type: 'market' | 'limit';
    time_in_force: 'day' | 'gtc' | 'ioc' | 'fok';
    limit_price?: number;
    stop_loss?: { stop_price: number };
    take_profit?: { limit_price: number };
  }
): Promise<any> => {
  try {
    logger.info(
      `Submitting ${params.side} order for ${params.qty} ${params.symbol}`
    );

    if (state.config.bot.dry_run) {
      logger.warn('[DRY RUN] Order not submitted (dry run mode)');
      return { status: 'dry_run', ...params };
    }

    return await state.client.createOrder(params);
  } catch (error) {
    logger.error('Error submitting order:', error);
    throw error;
  }
};

export const closePosition = async (
  state: AlpacaState,
  symbol: string
): Promise<any> => {
  try {
    logger.info(`Closing position for ${symbol}`);

    if (state.config.bot.dry_run) {
      logger.warn('[DRY RUN] Position not closed (dry run mode)');
      return { status: 'dry_run', symbol };
    }

    return await state.client.closePosition(symbol);
  } catch (error) {
    logger.error(`Error closing position for ${symbol}:`, error);
    throw error;
  }
};

export const closeAllPositions = async (state: AlpacaState): Promise<void> => {
  try {
    const positions = await getPositions(state);

    if (positions.length === 0) {
      logger.info('No positions to close');
      return;
    }

    logger.info(`Closing ${positions.length} position(s)`);

    for (const position of positions) {
      await closePosition(state, position.symbol);
    }
  } catch (error) {
    logger.error('Error closing all positions:', error);
    throw error;
  }
};

export const getBars = async (
  state: AlpacaState,
  symbol: string,
  timeframe: string,
  limit: number = 100
): Promise<any[]> => {
  try {
    const bars = await state.client.getBarsV2(symbol, {
      timeframe,
      limit,
    });

    const result = [];
    for await (const bar of bars) {
      result.push(bar);
    }

    return result;
  } catch (error) {
    logger.error(`Error getting bars for ${symbol}:`, error);
    throw error;
  }
};

export const subscribeToMarketData = async (
  state: AlpacaState,
  symbols: string[],
  callback: (symbol: string, data: any) => void
): Promise<AlpacaState> => {
  try {
    const dataStream = state.client.data_stream_v2;

    dataStream.onError((err: Error) => {
      logger.error('Stream error:', err);
    });

    dataStream.onStateChange((streamState: string) => {
      logger.info(`Stream state changed: ${streamState}`);
    });

    // Subscribe to bars (1-minute) to match backtest
    dataStream.onStockBar((bar: any) => {
      callback(bar.Symbol, {
        price: bar.ClosePrice,
        volume: bar.Volume,
        high: bar.HighPrice,
        low: bar.LowPrice,
        timestamp: bar.Timestamp,
      });
    });

    dataStream.onConnect(() => {
      logger.info('Stream connected. Subscribing to bars...');
      dataStream.subscribeForBars(symbols);
      logger.info(`Subscribed to 1-min bars for: ${symbols.join(', ')}`);
    });

    await dataStream.connect();

    // Note: We don't subscribe here immediately because we must wait for onConnect

    return {
      ...state,
      dataStream,
    };
  } catch (error) {
    logger.error('Error subscribing to market data:', error);
    throw error;
  }
};

export const unsubscribeFromMarketData = async (
  state: AlpacaState
): Promise<void> => {
  try {
    if (state.dataStream) {
      await state.dataStream.disconnect();
      logger.info('Disconnected from market data stream');
    }
  } catch (error) {
    logger.error('Error unsubscribing from market data:', error);
  }
};
