import { createVWAPState, updateVWAP, getVWAP } from '../vwap.js';
import { evaluateStrategy } from '../strategy.js';
import { createRiskState } from '../risk-manager.js';
import { describe, test, expect } from '@jest/globals';

describe('VWAP - Pure Functional Logic', () => {
  test('createVWAPState returns correct initial state', () => {
    const state = createVWAPState(20);
    expect(state.dataPoints).toEqual([]);
    expect(state.period).toBe(20);
    expect(state.cumulativePriceVolume).toBe(0);
    expect(state.cumulativeVolume).toBe(0);
  });

  test('updateVWAP adds data correctly', () => {
    const initialState = createVWAPState(2);

    const state1 = updateVWAP(initialState, 100, 10);

    expect(state1.dataPoints.length).toBe(1);
    expect(state1.cumulativePriceVolume).toBe(1000);
    expect(state1.cumulativeVolume).toBe(10);
  });

  test('getVWAP respects rolling window', () => {
    let state = createVWAPState(2);

    // Add 3 data points
    state = updateVWAP(state, 100, 10); // PV: 1000, V: 10
    state = updateVWAP(state, 110, 10); // PV: 2100, V: 20

    let vwap = getVWAP(state);
    expect(vwap).toBe(105); // (1000+1100)/20 = 105

    state = updateVWAP(state, 120, 10); // Removes 100, Adds 120. Points: [110, 120].
    // Previous PV (2100) - Removed (1000) + Added (1200) = 2300.
    // Previous Vol (20) - Removed (10) + Added (10) = 20.

    expect(state.dataPoints.length).toBe(2);
    expect(state.dataPoints[0].price).toBe(110);
    expect(state.dataPoints[1].price).toBe(120);

    vwap = getVWAP(state);
    expect(vwap).toBe(115); // 2300 / 20 = 115
  });

  test('getVWAP returns null if not enough data loops', () => {
    // Logic inside getVWAP checks if dataPoints.length < state.period
    let state = createVWAPState(5);
    state = updateVWAP(state, 100, 10);
    expect(getVWAP(state)).toBeNull();
  });
});

describe('Strategy - Pure Functional Logic (Mocked)', () => {
  test('evaluateStrategy accepts valid inputs', () => {
    const mockConfig = {
      alpaca: {} as any,
      trading: { symbols: ['AAPL'] },
      strategy: {
        vwap: { entry_threshold: 0.001, exit_threshold: 0.001 },
        filters: {
          // Add filters which are required now
          max_spread: 0.05,
          min_volume_mult: 1.2,
          chop_threshold: 3,
          vwap_slope_lookback: 5,
          atr_period: 14,
        },
        position: { size: 10, max_positions: 5 },
        risk: {
          max_daily_loss: 500,
          stop_loss_pct: 0.02,
          take_profit_pct: 0.05,
        },
      },
    } as any;

    const mockStrategyState = {
      config: mockConfig,
      positions: new Map(),
      pendingSignals: new Map(), // Added pendingSignals
    } as any;

    const mockRiskState = createRiskState(mockConfig);

    // Create a dummy VWAP state
    const mockVWAPState = createVWAPState(14);

    // Just ensure it doesn't throw and returns array
    const result = evaluateStrategy(
      mockStrategyState,
      mockRiskState,
      'AAPL',
      100, // current price
      100, // current VWAP
      mockVWAPState, // vwapState
      Date.now() // timestamp
    );

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
  });
});
