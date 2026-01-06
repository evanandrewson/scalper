import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const generateData = () => {
  const bars = [];
  const period = 20;
  const numBars = 200;
  let price = 100;

  // Sine wave parameters to force crossovers
  for (let i = 0; i < numBars; i++) {
    // Create a trend that crosses a moving average (VWAP)
    // Math.sin provides the oscillation
    const trend = Math.sin(i / 20) * 5; // Slower wave, bigger amplitude
    const noise = (Math.random() - 0.5) * 0.1; // Less noise to allow clean candles

    let close = 100 + trend + noise;
    let open = close - (Math.random() - 0.5) * 0.2; // Small candles

    // Ensure some candles clearly cross VWAP and HOLD
    // VWAP in our loop is just the avg price roughly
    const vwapEstimate = 100 + Math.sin((i - 5) / 20) * 5;

    // Manipulate price to force a setup
    if (i === 50) {
      // Force a "Was Below" -> "Cross Above" scenario
      // Previous candles were low. This one closes high.
      close = vwapEstimate + 0.5;
      open = vwapEstimate - 0.2;
    }
    if (i === 51) {
      // Force "Confirmation"
      // Open above VWAP, Close higher
      open = vwapEstimate + 0.1;
      close = vwapEstimate + 0.6;
    }

    const high = Math.max(open, close) + 0.1;
    const low = Math.min(open, close) - 0.1;

    bars.push({
      Timestamp: new Date(Date.now() + i * 60000).toISOString(),
      OpenPrice: open,
      HighPrice: high,
      LowPrice: low,
      ClosePrice: close,
      Volume: 1000 + Math.random() * 500,
      TradeCount: 10,
      VWAP: vwapEstimate,
    });
  }

  const filePath = path.join(__dirname, '../data/SPY_backtest.json');
  fs.writeFileSync(filePath, JSON.stringify(bars, null, 2));
  console.log(`Generated ${numBars} bars of synthetic data at ${filePath}`);
};

generateData();
