# VWAP Scalper Bot 🤖📈

An automated trading bot that uses VWAP (Volume Weighted Average Price) as the primary indicator for scalping opportunities, integrated with Alpaca's trading API.

## 🎯 Features

- **Real-time VWAP Calculation**: Continuous VWAP calculation using live market data
- **Automated Scalping**: Entry and exit logic based on price deviation from VWAP
- **Risk Management**: Built-in stop-loss, take-profit, and position sizing
- **Paper Trading**: Test strategies without risking real capital
- **Backtesting**: Test strategies on historical data
- **Multi-Symbol Support**: Trade multiple symbols simultaneously
- **Configurable Parameters**: Easily adjust strategy parameters via config files

## 📋 Strategy Overview

The bot uses VWAP as a mean-reversion indicator:

- **Long Entry**: Price drops below VWAP by entry threshold
- **Short Entry**: Price rises above VWAP by entry threshold
- **Exit**: Price reverts to VWAP or hits take-profit/stop-loss

## 🚀 Quick Start

### 1. Installation

```bash
# Clone the repository
cd /Users/evanandrewson/cursorProjects/scalper

# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### 2. Configuration

```bash
# Copy example environment file
cp .env.example .env

# Edit .env with your Alpaca API credentials
nano .env
```

**Important**: Get your API credentials from [Alpaca Dashboard](https://alpaca.markets/)

### 3. Configuration Files

Edit `config.yaml` to customize:

- Trading symbols
- Timeframes
- Entry/exit thresholds
- Risk parameters
- Position sizing

### 4. Run the Bot

```bash
# Paper trading (default)
python main.py

# For live trading (after testing)
# Set dry_run: False in config.yaml
python main.py
```

## 📊 Project Structure

```
scalper/
├── main.py                 # Entry point
├── requirements.txt        # Python dependencies
├── config.yaml            # Strategy configuration
├── .env                   # API credentials (not in git)
├── src/
│   ├── __init__.py
│   ├── config.py          # Configuration loader
│   ├── bot.py             # Main bot logic
│   ├── alpaca_client.py   # Alpaca API integration
│   ├── vwap.py            # VWAP calculation engine
│   ├── strategy.py        # Trading strategy logic
│   ├── risk_manager.py    # Risk management
│   └── utils/
│       ├── logger.py      # Logging setup
│       └── helpers.py     # Helper functions
├── tests/                 # Unit tests
└── logs/                  # Log files
```

## ⚙️ Configuration Parameters

### Trading Parameters

- `symbols`: List of symbols to trade
- `timeframe`: Bar timeframe (1Min, 5Min, 15Min)
- `start_time`: Trading start time (ET)
- `end_time`: Trading end time (ET)

### Strategy Parameters

- `vwap_period`: Number of bars for VWAP calculation
- `entry_threshold`: Price deviation from VWAP for entry (%)
- `exit_threshold`: Price reversion for exit (%)

### Risk Management

- `stop_loss_pct`: Stop loss percentage
- `take_profit_pct`: Take profit percentage
- `max_daily_loss`: Maximum daily loss limit
- `max_positions`: Maximum concurrent positions
- `position_size`: Number of shares per trade

## 🔒 Risk Disclaimer

**THIS BOT IS FOR EDUCATIONAL PURPOSES ONLY.**

- Always test with paper trading first
- Never risk more than you can afford to lose
- Past performance does not guarantee future results
- The authors are not responsible for any financial losses

## 📝 Development Roadmap

- [x] Project setup and structure
- [ ] Alpaca API integration
- [ ] VWAP calculation engine
- [ ] Scalping strategy implementation
- [ ] Risk management system
- [ ] Backtesting framework
- [ ] Paper trading integration
- [ ] Live trading capabilities
- [ ] Performance monitoring
- [ ] Web dashboard (future)

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT License - see LICENSE file for details

## 📧 Support

For questions or issues, please open an issue on GitHub.

---

**Happy Trading! 📈🚀**
