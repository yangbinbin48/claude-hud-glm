import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as https from 'node:https';
import * as http from 'node:http';
import { getHudPluginDir } from './claude-config-dir.js';
import type { GlmUsageData } from './types.js';

const GLM_HOSTS = ['open.bigmodel.cn', 'dev.bigmodel.cn', 'api.z.ai'];
const CACHE_FILENAME = 'glm-cache.json';
const DEFAULT_CACHE_TTL_MS = 60_000; // 60 seconds
const API_TIMEOUT_MS = 5_000;
const FIVE_HOUR_WINDOW_MS = 5 * 60 * 60 * 1000;

const DEBUG = process.env.DEBUG?.includes('claude-hud') || process.env.DEBUG === '*';

function debug(format: string, ...args: unknown[]): void {
  if (DEBUG) console.error(`[claude-hud:glm] ${format}`, ...args);
}

interface GlmCacheFile {
  tokensPercent: number;
  mcpPercent: number;
  mcpCurrentUsage: number | null;
  mcpTotal: number | null;
  tokenResetAt: number | null;
  mcpResetAt: number | null;
  fetchedAt: number;
}

interface GlmApiLimit {
  type: string;
  unit?: number;
  number?: number;
  percentage: number;
  currentValue?: number;
  remaining?: number;
  usage?: number;
  usageDetails?: unknown[];
  nextResetTime?: number | string | null;
}

interface GlmApiResponse {
  data?: {
    limits?: GlmApiLimit[];
  };
}

// --- Detection ---

export function detectGlmEnv(): { baseUrl: string; authToken: string } | null {
  const baseUrl = process.env.ANTHROPIC_BASE_URL?.trim() ?? '';
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN?.trim() ?? '';

  if (!baseUrl || !authToken) return null;

  try {
    const url = new URL(baseUrl);
    const isGlm = GLM_HOSTS.some(
      host => url.hostname === host || url.hostname.endsWith(`.${host}`)
    );
    if (!isGlm) return null;
    return { baseUrl: url.origin, authToken };
  } catch {
    return null;
  }
}

// --- Cache ---

function getCachePath(): string {
  return path.join(getHudPluginDir(os.homedir()), CACHE_FILENAME);
}

function readCache(ttlMs: number): GlmCacheFile | null {
  try {
    const raw = fs.readFileSync(getCachePath(), 'utf-8');
    const cache = JSON.parse(raw) as GlmCacheFile;
    if (typeof cache.tokensPercent !== 'number' || typeof cache.mcpPercent !== 'number') {
      return null;
    }
    if (cache.tokenResetAt !== null && typeof cache.tokenResetAt !== 'number') {
      return null;
    }
    if (cache.mcpResetAt !== null && typeof cache.mcpResetAt !== 'number') {
      return null;
    }
    if (Date.now() - cache.fetchedAt > ttlMs) return null;
    return cache;
  } catch {
    return null;
  }
}

function writeCache(data: GlmCacheFile): void {
  try {
    const cachePath = getCachePath();
    const dir = path.dirname(cachePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(cachePath, JSON.stringify(data), 'utf-8');
  } catch {
    // Silently ignore cache write failures
  }
}

// --- API Client ---

function fetchGlmUsage(baseUrl: string, authToken: string): Promise<GlmApiResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/monitor/usage/quota/limit', baseUrl);
    const transport = url.protocol === 'http:' ? http : https;

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'http:' ? 80 : 443),
      path: url.pathname,
      method: 'GET' as const,
      headers: {
        'Authorization': authToken,
        'Accept': 'application/json',
      },
      timeout: API_TIMEOUT_MS,
    };

    const req = transport.request(options, (res) => {
      let body = '';
      res.setEncoding('utf-8');
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`GLM API HTTP ${res.statusCode}`));
        }
        try {
          resolve(JSON.parse(body) as GlmApiResponse);
        } catch {
          reject(new Error('Invalid JSON response from GLM API'));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('GLM API request timed out'));
    });
    req.end();
  });
}

// --- Response Parsing ---

function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1e12) return Math.trunc(value);
    if (value > 1e9) return Math.trunc(value * 1000);
    return null;
  }

  if (typeof value === 'string') {
    const trimmedValue = value.trim();
    if (!trimmedValue) return null;

    if (/^\d+(\.\d+)?$/.test(trimmedValue)) {
      return parseTimestamp(Number(trimmedValue));
    }

    const parsedMs = Date.parse(trimmedValue);
    return Number.isNaN(parsedMs) ? null : parsedMs;
  }

  return null;
}

function extractResetAt(limit: GlmApiLimit): number | null {
  const timestamp = parseTimestamp(limit.nextResetTime);
  if (timestamp !== null && timestamp > Date.now()) {
    return timestamp;
  }
  return null;
}

function toGlmUsageData(cache: GlmCacheFile): GlmUsageData {
  const tokenResetAtMs = cache.tokenResetAt ?? (cache.fetchedAt + FIVE_HOUR_WINDOW_MS);
  return {
    isGlm: true,
    tokensPercent: cache.tokensPercent,
    mcpPercent: cache.mcpPercent,
    mcpCurrentUsage: cache.mcpCurrentUsage,
    mcpTotal: cache.mcpTotal,
    tokenResetAt: new Date(tokenResetAtMs),
    mcpResetAt: cache.mcpResetAt === null ? null : new Date(cache.mcpResetAt),
    fetchedAt: cache.fetchedAt,
  };
}

export function parseGlmResponse(response: GlmApiResponse): Omit<GlmCacheFile, 'fetchedAt'> | null {
  const limits = response?.data?.limits;
  if (!Array.isArray(limits)) return null;

  const tokenLimit = limits.find(limit => limit.type === 'TOKENS_LIMIT' && limit.number === 5)
    ?? limits.find(limit => limit.type === 'TOKENS_LIMIT')
    ?? null;
  const mcpLimit = limits.find(limit => limit.type === 'TIME_LIMIT') ?? null;

  let tokensPercent = 0;
  let mcpPercent = 0;
  let mcpCurrentUsage: number | null = null;
  let mcpTotal: number | null = null;
  let tokenResetAt: number | null = null;
  let mcpResetAt: number | null = null;

  if (tokenLimit && typeof tokenLimit.percentage === 'number') {
    tokensPercent = Math.round(Math.min(100, Math.max(0, tokenLimit.percentage)));
    tokenResetAt = extractResetAt(tokenLimit);
  }

  if (mcpLimit && typeof mcpLimit.percentage === 'number') {
    mcpPercent = Math.round(Math.min(100, Math.max(0, mcpLimit.percentage)));
    if (typeof mcpLimit.currentValue === 'number') mcpCurrentUsage = mcpLimit.currentValue;
    if (typeof mcpLimit.usage === 'number') mcpTotal = mcpLimit.usage;
    mcpResetAt = extractResetAt(mcpLimit);
  }

  return { tokensPercent, mcpPercent, mcpCurrentUsage, mcpTotal, tokenResetAt, mcpResetAt };
}

// --- Main ---

export async function getGlmUsage(): Promise<GlmUsageData | null> {
  const env = detectGlmEnv();
  if (!env) return null;

  // Try cache first
  const cached = readCache(DEFAULT_CACHE_TTL_MS);
  if (cached) {
    debug('cache hit (age: %dms)', Date.now() - cached.fetchedAt);
    return toGlmUsageData(cached);
  }

  // Cache miss - fetch from API
  debug('cache miss, fetching from %s', env.baseUrl);
  try {
    const response = await fetchGlmUsage(env.baseUrl, env.authToken);
    const parsed = parseGlmResponse(response);
    if (!parsed) {
      debug('failed to parse GLM response');
      return null;
    }

    const fetchedAt = Date.now();
    const cacheData: GlmCacheFile = {
      ...parsed,
      tokenResetAt: parsed.tokenResetAt ?? (fetchedAt + FIVE_HOUR_WINDOW_MS),
      mcpResetAt: parsed.mcpResetAt,
      fetchedAt,
    };
    writeCache(cacheData);
    return toGlmUsageData(cacheData);
  } catch (error) {
    debug('API error: %s', error instanceof Error ? error.message : 'unknown');

    // Try stale cache as fallback
    const stale = readCache(Infinity);
    if (stale) {
      debug('returning stale cache as fallback');
      return toGlmUsageData(stale);
    }
    return null;
  }
}
