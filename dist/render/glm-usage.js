import { getQuotaColor, quotaBar, RESET } from './colors.js';
function padTwoDigits(value) {
    return String(value).padStart(2, '0');
}
function formatResetTime(resetAt) {
    if (!resetAt)
        return '';
    if (Number.isNaN(resetAt.getTime()))
        return '';
    // GLM API timestamps should be displayed in UTC+8 (China Standard Time)
    const UTC8 = 8 * 3600_000;
    const d = new Date(resetAt.getTime() + UTC8);
    const n = new Date(Date.now() + UTC8);
    const isSameDay = d.getUTCFullYear() === n.getUTCFullYear()
        && d.getUTCMonth() === n.getUTCMonth()
        && d.getUTCDate() === n.getUTCDate();
    const timeText = `${padTwoDigits(d.getUTCHours())}:${padTwoDigits(d.getUTCMinutes())}`;
    if (isSameDay)
        return timeText;
    return `${padTwoDigits(d.getUTCMonth() + 1)}-${padTwoDigits(d.getUTCDate())} ${timeText}`;
}
export function formatGlmUsageParts({ glm, colors, barWidth, usageBarEnabled, showGlmTokenUsage, showGlmMcpUsage, decorateLabelText = text => text, }) {
    const parts = [];
    const tokenReset = formatResetTime(glm.tokenResetAt);
    if (showGlmTokenUsage) {
        const tokenColor = getQuotaColor(glm.tokensPercent, colors);
        let tokenText = usageBarEnabled
            ? `5h: ${quotaBar(glm.tokensPercent, barWidth, colors)} ${tokenColor}${glm.tokensPercent}%${RESET}`
            : `5h: ${tokenColor}${glm.tokensPercent}%${RESET}`;
        if (tokenReset) {
            tokenText += decorateLabelText(` ${tokenReset}`);
        }
        parts.push(tokenText);
    }
    if (showGlmMcpUsage) {
        const mcpColor = getQuotaColor(glm.mcpPercent, colors);
        const mcpReset = formatResetTime(glm.mcpResetAt);
        let mcpText = usageBarEnabled
            ? `MCP: ${quotaBar(glm.mcpPercent, barWidth, colors)} ${mcpColor}${glm.mcpPercent}%${RESET}`
            : `MCP: ${mcpColor}${glm.mcpPercent}%${RESET}`;
        if (mcpReset) {
            mcpText += decorateLabelText(` ${mcpReset}`);
        }
        parts.push(mcpText);
    }
    return parts;
}
//# sourceMappingURL=glm-usage.js.map