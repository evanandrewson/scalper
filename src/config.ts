/**
 * Configuration management for the VWAP Scalper Bot - Functional Style
 */
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

export interface TradingConfig {
  symbols: string[];
  timeframe: string;
  max_slippage_pct?: number;
  schedule: {
    start_time: string;
    end_time: string;
    days: number[];
  };
}

export interface StrategyConfig {
  vwap: {
    period: number; // If 0, use full day (standard VWAP)
    entry_threshold: number;
    exit_threshold: number;
    require_confirmation?: boolean;
  };
  filters: {
    max_spread: number;
    min_volume_mult: number;
    chop_threshold: number;
    vwap_slope_lookback: number;
    atr_period: number;
    rsi_period?: number;
    rsi_oversold?: number;
    rsi_overbought?: number;
    min_atr_pct?: number; // Minimum ATR as percentage of price (e.g. 0.02)
  };
  position: {
    size: number;
    sizing_type?: 'fixed' | 'risk_pct';
    max_risk_pct?: number;
    max_positions: number;
  };
  risk: {
    stop_loss_pct: number;
    take_profit_pct: number;
    max_daily_loss: number;
    max_position_loss: number;
    max_hold_seconds?: number;
    trailing_stop: boolean;
    trailing_stop_pct: number;
    max_trades_per_day: number;
    max_losses_per_day: number;
    cooldown_minutes: number;
  };
}

export interface BotConfig {
  dry_run: boolean;
  log_level: string;
  log_to_file: boolean;
}

export interface BacktestingConfig {
  start_date: string;
  end_date: string;
  initial_capital: number;
}

export interface YAMLConfig {
  trading: TradingConfig;
  strategy: StrategyConfig;
  bot: BotConfig;
  backtesting: BacktestingConfig;
}

export interface Config {
  apiKey: string;
  secretKey: string;
  baseUrl: string;
  dataUrl: string;
  trading: TradingConfig;
  strategy: StrategyConfig;
  bot: BotConfig;
  backtesting: BacktestingConfig;
}

export const loadConfig = (configPath: string = 'config.yaml'): Config => {
  // Load Alpaca credentials from environment
  const apiKey = process.env.ALPACA_API_KEY || '';
  const secretKey = process.env.ALPACA_SECRET_KEY || '';
  const baseUrl =
    process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
  const dataUrl = process.env.ALPACA_DATA_URL || 'https://data.alpaca.markets';

  if (!apiKey || !secretKey) {
    throw new Error('Alpaca API credentials not found in .env file');
  }

  // Load YAML configuration
  const yamlPath = join(__dirname, '..', configPath);
  const yamlContent = readFileSync(yamlPath, 'utf8');
  let yamlConfig: YAMLConfig = YAML.parse(yamlContent);

  // Extend strategy config with defaults for new fields if not present in YAML
  yamlConfig.strategy = {
    ...yamlConfig.strategy,
    filters: {
      max_spread: 0.05,
      min_volume_mult: 1.2,
      chop_threshold: 3,
      vwap_slope_lookback: 5,
      atr_period: 14,
      ...((yamlConfig.strategy as any).filters || {}),
    },
    risk: {
      ...yamlConfig.strategy.risk,
      max_trades_per_day: 3,
      max_losses_per_day: 2,
      cooldown_minutes: 5,
      ...((yamlConfig.strategy.risk as any) || {}),
    },
  };

  return {
    apiKey,
    secretKey,
    baseUrl,
    dataUrl,
    trading: {
      ...yamlConfig.trading,
      max_slippage_pct: yamlConfig.trading.max_slippage_pct || 0.001, // Default 0.1%
    },
    strategy: yamlConfig.strategy,
    bot: yamlConfig.bot,
    backtesting: yamlConfig.backtesting,
  };
};

export const configToString = (config: Config): string => {
  return `Config(symbols=${config.trading.symbols.join(',')}, timeframe=${config.trading.timeframe}, dry_run=${config.bot.dry_run})`;
};
