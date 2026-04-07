import type { GlmUsageData } from './types.js';
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
export declare function detectGlmEnv(): {
    baseUrl: string;
    authToken: string;
} | null;
export declare function parseGlmResponse(response: GlmApiResponse): Omit<GlmCacheFile, 'fetchedAt'> | null;
export declare function getGlmUsage(): Promise<GlmUsageData | null>;
export {};
//# sourceMappingURL=glm-usage.d.ts.map