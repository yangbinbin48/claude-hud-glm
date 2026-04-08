import type { StdinData, UsageData, TokenSamplePoint } from './types.js';
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
export declare function calculateBurnRate(input: BurnRateInput): BurnRateData | null;
//# sourceMappingURL=burn-rate.d.ts.map