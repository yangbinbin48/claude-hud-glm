import type { RenderContext } from '../../types.js';
import { calculateBurnRate } from '../../burn-rate.js';
import { label } from '../colors.js';
import { getProviderLabel } from '../../stdin.js';
import { t } from '../../i18n/index.js';

function formatRate(rate: number): string {
  return rate.toFixed(1);
}

function formatEta(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatTokensPerMin(rate: number): string {
  if (rate >= 1000000) return `${(rate / 1000000).toFixed(1)}M`;
  if (rate >= 1000) return `${(rate / 1000).toFixed(0)}k`;
  return rate.toFixed(0);
}

function getRateColor(rate: number, type: 'context' | 'usage'): string {
  // Note: We don't reuse getQuotaColor here because that function takes a
  // percentage (0-100), while burn rates are typically in the 0.1-10 %/min range.
  if (type === 'context') {
    if (rate < 1) return '\x1b[32m'; // green
    if (rate < 3) return '\x1b[33m'; // yellow
    return '\x1b[31m'; // red
  }
  // usage: rate in %/min
  if (rate < 2) return '\x1b[32m';
  if (rate < 5) return '\x1b[33m';
  return '\x1b[31m';
}

export function renderBurnRateLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  if (display?.showBurnRate !== true) {
    return null;
  }

  // Skip for Bedrock users (no usage data to work with)
  if (getProviderLabel(ctx.stdin)) {
    return null;
  }

  // Skip for GLM users (they have their own usage system)
  if (ctx.glmUsage?.isGlm) {
    return null;
  }

  const burnRate = calculateBurnRate({
    stdin: ctx.stdin,
    sessionStart: ctx.transcript.sessionStart,
    usageData: ctx.usageData,
    tokenSamplePoints: ctx.transcript.tokenSamplePoints,
    burnRateWindow: display.burnRateWindow,
  });

  if (!burnRate) {
    return null;
  }

  const colors = ctx.config?.colors;
  const parts: string[] = [];
  const burnLabel = label(t('label.burnRate'), colors);

  // Context burn rate
  if (burnRate.contextRatePerMin !== null) {
    const rateColor = getRateColor(burnRate.contextRatePerMin, 'context');
    let ctxPart = `${rateColor}+${formatRate(burnRate.contextRatePerMin)}${t('format.perMin')} ${t('label.ctx')}\x1b[0m`;

    if (burnRate.contextEtaMinutes !== null) {
      ctxPart += label(` (${t('format.eta')} ${formatEta(burnRate.contextEtaMinutes)})`, colors);
    } else {
      ctxPart += label(` [${t('status.full')}]`, colors);
    }

    parts.push(ctxPart);
  }

  // Usage burn rate (5h)
  if (burnRate.fiveHourRatePerMin !== null) {
    const rateColor = getRateColor(burnRate.fiveHourRatePerMin, 'usage');
    let usagePart = `${rateColor}+${formatRate(burnRate.fiveHourRatePerMin)}${t('format.perMin')} 5h\x1b[0m`;

    if (burnRate.fiveHourEtaMinutes !== null) {
      usagePart += label(` (${t('format.eta')} ${formatEta(burnRate.fiveHourEtaMinutes)})`, colors);
    } else {
      usagePart += label(` [${t('status.full')}]`, colors);
    }

    parts.push(usagePart);
  }

  // Token rate
  if (burnRate.tokenRatePerMin !== null) {
    const tokPart = `${formatTokensPerMin(burnRate.tokenRatePerMin)} ${t('format.tokPerMin')}`;

    let tokDisplay = label(tokPart, colors);

    if (burnRate.recentTokenRatePerMin !== null) {
      tokDisplay += label(` (${t('label.recent')} ${formatTokensPerMin(burnRate.recentTokenRatePerMin)} ${t('format.tokPerMin')})`, colors);
    }

    parts.push(tokDisplay);
  }

  if (parts.length === 0) {
    return null;
  }

  return `${burnLabel} ${parts.join(' │ ')}`;
}
