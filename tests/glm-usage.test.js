import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGlmResponse } from '../dist/glm-usage.js';

test('parseGlmResponse reads nextResetTime for GLM token and time limits', () => {
  const tokenResetAt = Date.now() + (2 * 60 * 60 * 1000);
  const mcpResetAt = Date.now() + (24 * 60 * 60 * 1000);

  const parsed = parseGlmResponse({
    data: {
      limits: [
        {
          type: 'TOKENS_LIMIT',
          unit: 3,
          number: 5,
          percentage: 9,
          nextResetTime: tokenResetAt,
        },
        {
          type: 'TIME_LIMIT',
          unit: 5,
          number: 1,
          usage: 100,
          currentValue: 10,
          percentage: 10,
          nextResetTime: mcpResetAt,
        },
      ],
    },
  });

  assert.deepEqual(parsed, {
    tokensPercent: 9,
    mcpPercent: 10,
    mcpCurrentUsage: 10,
    mcpTotal: 100,
    tokenResetAt,
    mcpResetAt,
  });
});
