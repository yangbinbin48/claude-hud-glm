import type { StdinData, UsageData, TokenSamplePoint } from './types.js';
import { getContextPercent } from './stdin.js';

const MIN_SESSION_MINUTES = 2;

export interface BurnRateInput {
  stdin: StdinData;
  sessionStart?: Date;
  usageData: UsageData | null;
  tokenSamplePoints?: TokenSamplePoint[];
  burnRateWindow?: number;
  now?: () => number;
}

export interface BurnRateData {
  contextRatePerMin: number | null;
  contextEtaMinutes: number | null;
  tokenRatePerMin: number | null;
  recentTokenRatePerMin: number | null;
  fiveHourRatePerMin: number | null;
  fiveHourEtaMinutes: number | null;
}

export function calculateBurnRate(input: BurnRateInput): BurnRateData | null {
  const { stdin, sessionStart, usageData, tokenSamplePoints, burnRateWindow = 5 } = input;
  const now = input.now ?? (() => Date.now());

  if (!sessionStart) {
    return null;
  }

  const sessionMs = now() - sessionStart.getTime();
  const sessionMinutes = sessionMs / 60000;

  if (sessionMinutes < MIN_SESSION_MINUTES) {
    return null;
  }

  const contextPercent = getContextPercent(stdin);

  // Context burn rate
  let contextRatePerMin: number | null = null;
  let contextEtaMinutes: number | null = null;

  if (contextPercent > 0) {
    contextRatePerMin = contextPercent / sessionMinutes;

    if (contextPercent >= 100) {
      contextEtaMinutes = null; // Already full
    } else {
      contextEtaMinutes = (100 - contextPercent) / contextRatePerMin;
    }
  }

  // Token burn rate from sample points
  let tokenRatePerMin: number | null = null;
  let recentTokenRatePerMin: number | null = null;

  const points = tokenSamplePoints ?? [];
  if (points.length >= 2) {
    const first = points[0];
    const last = points[points.length - 1];
    const firstTokens = first.cumulativeInputTokens + first.cumulativeOutputTokens;
    const lastTokens = last.cumulativeInputTokens + last.cumulativeOutputTokens;
    const pointSpanMs = last.timestamp.getTime() - first.timestamp.getTime();
    const pointSpanMinutes = pointSpanMs / 60000;

    if (pointSpanMinutes > 0.1 && lastTokens > firstTokens) {
      tokenRatePerMin = (lastTokens - firstTokens) / pointSpanMinutes;
    }

    // Recent sliding window
    const windowMs = burnRateWindow * 60000;
    const windowStartMs = now() - windowMs;
    const recentPoints = points.filter(p => p.timestamp.getTime() >= windowStartMs);

    if (recentPoints.length >= 2) {
      const rFirst = recentPoints[0];
      const rLast = recentPoints[recentPoints.length - 1];
      const rFirstTokens = rFirst.cumulativeInputTokens + rFirst.cumulativeOutputTokens;
      const rLastTokens = rLast.cumulativeInputTokens + rLast.cumulativeOutputTokens;
      const rSpanMs = rLast.timestamp.getTime() - rFirst.timestamp.getTime();
      const rSpanMinutes = rSpanMs / 60000;

      if (rSpanMinutes > 0.1 && rLastTokens > rFirstTokens) {
        const rawRecentRate = (rLastTokens - rFirstTokens) / rSpanMinutes;

        // Only show recent if it differs from average by > 20%
        if (
          tokenRatePerMin === null
          || Math.abs(rawRecentRate - tokenRatePerMin) / tokenRatePerMin > 0.2
        ) {
          recentTokenRatePerMin = rawRecentRate;
        }
      }
    }
  }

  // Usage burn rate
  let fiveHourRatePerMin: number | null = null;
  let fiveHourEtaMinutes: number | null = null;

  const fiveHour = usageData?.fiveHour;
  if (typeof fiveHour === 'number' && fiveHour > 0) {
    fiveHourRatePerMin = fiveHour / sessionMinutes;

    if (fiveHour >= 100) {
      fiveHourEtaMinutes = null;
    } else {
      fiveHourEtaMinutes = (100 - fiveHour) / fiveHourRatePerMin;
    }
  }

  // If everything is null, return null
  if (
    contextRatePerMin === null
    && tokenRatePerMin === null
    && fiveHourRatePerMin === null
  ) {
    return null;
  }

  return {
    contextRatePerMin,
    contextEtaMinutes,
    tokenRatePerMin,
    recentTokenRatePerMin,
    fiveHourRatePerMin,
    fiveHourEtaMinutes,
  };
}
