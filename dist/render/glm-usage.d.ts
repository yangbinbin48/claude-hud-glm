import type { GlmUsageData, RenderContext } from '../types.js';
export declare function formatGlmUsageParts({ glm, colors, barWidth, usageBarEnabled, showGlmTokenUsage, showGlmMcpUsage, decorateLabelText, }: {
    glm: GlmUsageData;
    colors?: RenderContext['config']['colors'];
    barWidth: number;
    usageBarEnabled: boolean;
    showGlmTokenUsage: boolean;
    showGlmMcpUsage: boolean;
    decorateLabelText?: (text: string) => string;
}): string[];
//# sourceMappingURL=glm-usage.d.ts.map