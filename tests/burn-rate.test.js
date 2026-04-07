import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateBurnRate } from '../dist/burn-rate.js';

const ONE_MINUTE = 60 * 1000;

test('calculateBurnRate returns null when session is too short', () => {
  const sessionStart = new Date(Date.now() - 30 * 1000); // 30s ago
  const result = calculateBurnRate({
    stdin: { context_window: { context_window_size: 200000, current_usage: { input_tokens: 5000 } } },
    sessionStart,
    usageData: { fiveHour: 25, sevenDay: null, fiveHourResetAt: null, sevenDayResetAt: null },
    tokenSamplePoints: [],
    now: () => Date.now(),
  });
  assert.equal(result, null);
});

test('calculateBurnRate returns null when sessionStart is missing', () => {
  const result = calculateBurnRate({
    stdin: { context_window: { context_window_size: 200000, current_usage: { input_tokens: 5000 } } },
    sessionStart: undefined,
    usageData: { fiveHour: 25, sevenDay: null, fiveHourResetAt: null, sevenDayResetAt: null },
    tokenSamplePoints: [],
    now: () => Date.now(),
  });
  assert.equal(result, null);
});

test('calculateBurnRate computes context burn rate and ETA', () => {
  const now = Date.now();
  const sessionStart = new Date(now - 5 * ONE_MINUTE);

  const result = calculateBurnRate({
    stdin: {
      context_window: {
        context_window_size: 200000,
        current_usage: { input_tokens: 40000 },
      },
    },
    sessionStart,
    usageData: null,
    tokenSamplePoints: [],
    now: () => now,
  });

  assert.ok(result);
  // 20% / 5min = 4%/min
  assert.equal(result.contextRatePerMin, 4);
  // (100 - 20) / 4 = 20 minutes
  assert.equal(result.contextEtaMinutes, 20);
});

test('calculateBurnRate returns null contextEta when context is full', () => {
  const now = Date.now();
  const sessionStart = new Date(now - 10 * ONE_MINUTE);

  const result = calculateBurnRate({
    stdin: {
      context_window: {
        context_window_size: 200000,
        current_usage: { input_tokens: 200000 },
      },
    },
    sessionStart,
    usageData: null,
    tokenSamplePoints: [],
    now: () => now,
  });

  assert.ok(result);
  assert.equal(result.contextRatePerMin, 10); // 100% / 10min
  assert.equal(result.contextEtaMinutes, null); // Already full
});

test('calculateBurnRate computes usage burn rate and ETA', () => {
  const now = Date.now();
  const sessionStart = new Date(now - 5 * ONE_MINUTE);

  const result = calculateBurnRate({
    stdin: { context_window: {} },
    sessionStart,
    usageData: { fiveHour: 25, sevenDay: null, fiveHourResetAt: null, sevenDayResetAt: null },
    tokenSamplePoints: [],
    now: () => now,
  });

  assert.ok(result);
  // 25% / 5min = 5%/min
  assert.equal(result.fiveHourRatePerMin, 5);
  // (100 - 25) / 5 = 15 minutes
  assert.equal(result.fiveHourEtaMinutes, 15);
});

test('calculateBurnRate returns null usage fields when usageData is null', () => {
  const now = Date.now();
  const sessionStart = new Date(now - 5 * ONE_MINUTE);

  const result = calculateBurnRate({
    stdin: {
      context_window: {
        context_window_size: 200000,
        current_usage: { input_tokens: 10000 },
      },
    },
    sessionStart,
    usageData: null,
    tokenSamplePoints: [],
    now: () => now,
  });

  assert.ok(result);
  assert.equal(result.fiveHourRatePerMin, null);
  assert.equal(result.fiveHourEtaMinutes, null);
});

test('calculateBurnRate returns null usageEta when fiveHour is 100%', () => {
  const now = Date.now();
  const sessionStart = new Date(now - 5 * ONE_MINUTE);

  const result = calculateBurnRate({
    stdin: { context_window: {} },
    sessionStart,
    usageData: { fiveHour: 100, sevenDay: null, fiveHourResetAt: null, sevenDayResetAt: null },
    tokenSamplePoints: [],
    now: () => now,
  });

  assert.ok(result);
  assert.equal(result.fiveHourRatePerMin, 20);
  assert.equal(result.fiveHourEtaMinutes, null); // Already full
});

test('calculateBurnRate computes token rates from sample points', () => {
  const now = Date.now();
  const sessionStart = new Date(now - 10 * ONE_MINUTE);

  // Points with accelerating rate: slow at first, fast recently
  const points = [
    { timestamp: new Date(now - 10 * ONE_MINUTE), cumulativeInputTokens: 0, cumulativeOutputTokens: 0 },
    { timestamp: new Date(now - 5 * ONE_MINUTE), cumulativeInputTokens: 2000, cumulativeOutputTokens: 500 },
    { timestamp: new Date(now - 1 * ONE_MINUTE), cumulativeInputTokens: 10000, cumulativeOutputTokens: 3000 },
  ];

  const result = calculateBurnRate({
    stdin: { context_window: {} },
    sessionStart,
    usageData: null,
    tokenSamplePoints: points,
    now: () => now,
  });

  assert.ok(result);
  // Average: (13000 - 0) / 9min span = 1444 tok/min
  assert.ok(result.tokenRatePerMin !== null);
  assert.ok(result.tokenRatePerMin > 1400);
  // Recent window (last 5 min): (13000 - 2500) / 4min = 2625 tok/min
  // This is > 20% different from average, so should show
  assert.ok(result.recentTokenRatePerMin !== null);
  assert.ok(result.recentTokenRatePerMin > 2500);
});

test('calculateBurnRate returns null token rates with fewer than 2 points', () => {
  const now = Date.now();
  const sessionStart = new Date(now - 5 * ONE_MINUTE);

  const result = calculateBurnRate({
    stdin: { context_window: { context_window_size: 200000, current_usage: { input_tokens: 10000 } } },
    sessionStart,
    usageData: null,
    tokenSamplePoints: [{ timestamp: new Date(now), cumulativeInputTokens: 100, cumulativeOutputTokens: 50 }],
    now: () => now,
  });

  assert.ok(result);
  assert.equal(result.tokenRatePerMin, null);
  assert.equal(result.recentTokenRatePerMin, null);
});

test('calculateBurnRate suppresses recent rate when within 20% of average', () => {
  const now = Date.now();
  const sessionStart = new Date(now - 10 * ONE_MINUTE);

  // Consistent rate: ~1200 tok/min across all points
  const points = [
    { timestamp: new Date(now - 10 * ONE_MINUTE), cumulativeInputTokens: 0, cumulativeOutputTokens: 0 },
    { timestamp: new Date(now - 5 * ONE_MINUTE), cumulativeInputTokens: 6000, cumulativeOutputTokens: 0 },
    { timestamp: new Date(now - 1 * ONE_MINUTE), cumulativeInputTokens: 10800, cumulativeOutputTokens: 0 },
  ];

  const result = calculateBurnRate({
    stdin: { context_window: {} },
    sessionStart,
    usageData: null,
    tokenSamplePoints: points,
    now: () => now,
  });

  assert.ok(result);
  // Recent rate should be suppressed because it's close to average
  assert.equal(result.recentTokenRatePerMin, null);
});

test('calculateBurnRate returns null when rate is zero or negative', () => {
  const now = Date.now();
  const sessionStart = new Date(now - 5 * ONE_MINUTE);

  const result = calculateBurnRate({
    stdin: {
      context_window: {
        context_window_size: 200000,
        current_usage: { input_tokens: 0 },
      },
    },
    sessionStart,
    usageData: null,
    tokenSamplePoints: [],
    now: () => now,
  });

  assert.equal(result, null);
});
