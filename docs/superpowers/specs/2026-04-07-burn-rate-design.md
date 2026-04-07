# Burn Rate 设计文档

## 概述

在 Claude HUD 中新增会话级别的 Burn Rate 显示行，同时展示 Context Window 和 Rate Limit 的消耗速率，帮助用户预判何时会撞到限制。

## 需求

- **Context 消耗速率**：context window 的消耗速度（%/min），以及预估耗尽时间
- **Usage 消耗速率**：5h rate limit 的消耗速度（%/min），以及预估撞限时间
- **会话平均 + 近期趋势**：同时展示从会话开始到现在的平均速率和最近 5 分钟的滑动窗口速率
- **独立新行展示**：在 Usage 行之后新增一行，参照 sessionTokens 的独立渲染模式

## 方案选择

选择**方案 A：基于 Transcript 历史推算**。

理由：
- transcript 中已有完整的 `assistant` 消息历史（含 timestamp 和 usage），可作为采样点
- 无需引入额外文件持久化
- 与现有 transcript 缓存机制自然集成

## 数据流

### Context Burn Rate

使用**原始百分比**（`getContextPercent`，非 buffered），因为速率应反映真实消耗，不包含 autocompact buffer 估算。

```
stdin.context_window → 当前 context 百分比
transcript.sessionStart → 会话开始时间
→ contextBurnRate = contextPercent / sessionDurationMinutes
→ contextEta = (100 - contextPercent) / contextBurnRate
```

### Token Burn Rate（基于 transcript 采样点）

```
transcript JSONL 中的 assistant 消息序列:
  { timestamp, message.usage.input_tokens, output_tokens }
  → 累计 token 时间序列 (TokenSamplePoint[])
  → 会话平均速率: totalTokenChange / sessionMinutes
  → 滑动窗口速率: recentTokenChange / actualWindowMinutes
```

### Usage Burn Rate（基于 token 时间序列估算）

**不使用** `resets_at` 反推窗口起始（该方法不可靠：rate limit 窗口是滚动的，`resets_at` 只表示最早被计入的 token 过期时间）。

改为从会话内的 token 时间序列估算消耗速率，结合 `rate_limits` 当前百分比计算 ETA：

```
currentUsagePercent = rate_limits.five_hour.used_percentage
sessionTokenRate = token 时间序列算出的 tokens/min

// 从 token 速率估算 usage 百分比消耗速率
// 基于会话内 usage 变化 / 会话时长
usageBurnRate = currentUsagePercent / sessionDurationMinutes
usageEta = (100 - currentUsagePercent) / usageBurnRate
```

## 计算逻辑

### 前置保护

- **最小会话时间**：会话时长 < 2 分钟时不显示 Burn Rate（1 分钟数据不稳定，2 分钟以上才开始有意义）
- **sessionStart 不存在**：不显示 Burn Rate
- **速率为零或负数**：不显示速率和 ETA（可能是 /compact 或 /clear 后的短暂异常）
- **已达到 100%**：不显示 ETA，显示 "FULL" 标记

### 1. Context Burn Rate（会话平均）

```typescript
contextPercent = getContextPercent(stdin)  // 原始百分比，非 buffered
sessionMinutes = (now - sessionStart) / 60000

if (sessionMinutes < 2) return null  // 最小时间保护

contextBurnRate = contextPercent / sessionMinutes  // %/min

if (contextBurnRate <= 0) return null  // 零/负速率保护

if (contextPercent >= 100) {
  contextEtaMinutes = null  // 已满，不显示 ETA
} else {
  contextEtaMinutes = (100 - contextPercent) / contextBurnRate
}
```

### 2. Token Burn Rate（基于 transcript 采样点）

```typescript
// 从 transcript 的 assistant 消息中提取采样点
points: TokenSamplePoint[]  // 每个 assistant 消息一个点

// 限制采样点数量（最多保留最近 200 个，防止内存膨胀）
if (points.length > 200) {
  points = points.slice(-200)
}

if (points.length < 2) return null  // 至少需要 2 个采样点

// 会话平均
totalTokenChange = (points.last.input + points.last.output)
                 - (points.first.input + points.first.output)
sessionMinutes = (points.last.timestamp - points.first.timestamp) / 60000
avgRate = totalTokenChange / sessionMinutes  // tokens/min

// 滑动窗口（最近 N 分钟，默认 5 分钟）
windowStart = now - burnRateWindow * 60000
recentPoints = points.filter(p => p.timestamp >= windowStart)

if (recentPoints.length >= 2) {
  recentTokenChange = (recentPoints.last.input + recentPoints.last.output)
                    - (recentPoints.first.input + recentPoints.first.output)
  actualWindowMinutes = (recentPoints.last.timestamp - recentPoints.first.timestamp) / 60000
  if (actualWindowMinutes > 0.1) {  // 至少 6 秒的实际跨度
    recentRate = recentTokenChange / actualWindowMinutes
  }
}

// 仅当与会话平均差异 > 20% 时才显示 recent
showRecent = recentRate !== null && Math.abs(recentRate - avgRate) / avgRate > 0.2
```

### 3. Usage Burn Rate（基于会话内百分比变化）

```typescript
fiveHourPercent = rate_limits.five_hour?.used_percentage
if (fiveHourPercent === null || sessionMinutes < 2) return null

fiveHourRate = fiveHourPercent / sessionMinutes  // %/min

if (fiveHourPercent >= 100) {
  fiveHourEtaMinutes = null  // 已满
} else {
  fiveHourEtaMinutes = (100 - fiveHourPercent) / fiveHourRate
}
```

## 展示格式

```
Burn +2.3%/m ctx (ETA 42m) │ +0.8%/m 5h (ETA 2h) │ 15k tok/m (recent 22k/m)
```

字段说明：
- `+2.3%/m ctx` — Context window 消耗速率 + ETA
- `+0.8%/m 5h` — 5h rate limit 消耗速率 + ETA
- `15k tok/m` — 会话平均 token 速率
- `(recent 22k/m)` — 近期滑动窗口速率（仅当与会话平均差异 >20% 时显示）

### 颜色阈值

Context rate:
- < 1%/min → 绿色（正常）
- 1-3%/min → 黄色（中等）
- > 3%/min → 红色（快速）

Usage rate:
- 复用现有 `getQuotaColor` 逻辑（基于百分比的绿/黄/红）

### 特殊状态

- **已满 (100%)**：显示 `FULL` 而非 ETA，如 `+2.3%/m ctx [FULL]`
- **无数据**：整个行不渲染（返回 null）

## 架构集成方式

**参照 `sessionTokens` 的独立渲染模式**（`render/index.ts` 第 455-460 行），不加入 `HudElement` 排序系统。

理由：
- 避免修改 `HudElement` 类型、`KNOWN_ELEMENTS` 集合和验证逻辑
- Burn Rate 逻辑上跟随 Usage 行，不需要用户自定义排序
- 更简单，影响范围更小

```typescript
// render/index.ts 中 render() 函数内
if (ctx.config?.display?.showBurnRate) {
  const burnRateLine = renderBurnRateLine(ctx);
  if (burnRateLine) {
    lines.push(burnRateLine);
  }
}
```

## Bedrock / GLM 用户处理

- **Bedrock 用户**：`renderUsageLine` 对 Bedrock 返回 null（无 rate_limits 数据）。Burn Rate 行同样不显示 Usage 部分，只显示 Context 部分（如果有 context_window 数据）。
- **GLM 用户**：GLM 有独立的 usage 显示系统。当检测到 GLM 时，Usage Burn Rate 部分跳过，只显示 Context Burn Rate。

## 缓存兼容性

旧版 transcript 缓存不包含 `tokenSamplePoints` 字段。处理策略：
- 反序列化时 `tokenSamplePoints` 默认为 `undefined`
- `calculateBurnRate()` 检查 `tokenSamplePoints` 是否存在，不存在时跳过 token 相关计算
- 下次 transcript 文件变更时，缓存自动更新（mtimeMs/size 变化触发重新解析）

## 配置项

```typescript
interface HudConfig {
  display: {
    // ... 现有配置
    showBurnRate: boolean;      // 默认 false（opt-in）
    burnRateWindow: number;     // 滑动窗口分钟数，默认 5
  };
}
```

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/types.ts` | 修改 | 新增 `BurnRateData` 接口、`TokenSamplePoint` 类型，扩展 `TranscriptData` |
| `src/transcript.ts` | 修改 | 在解析过程中收集 token 采样时间序列，扩展缓存序列化 |
| `src/burn-rate.ts` | 新增 | Burn Rate 计算逻辑 |
| `src/render/lines/burn-rate.ts` | 新增 | Burn Rate 行渲染 |
| `src/render/lines/index.ts` | 修改 | 导出新渲染器 |
| `src/render/index.ts` | 修改 | 在 render() 中条件调用 burn rate 渲染（参照 sessionTokens 模式） |
| `src/config.ts` | 修改 | 新增 `showBurnRate`、`burnRateWindow` 配置 |
| `src/i18n/*.ts` | 修改 | 新增翻译字符串 |

## 接口定义

```typescript
interface TokenSamplePoint {
  timestamp: Date;
  cumulativeInputTokens: number;
  cumulativeOutputTokens: number;
}

interface BurnRateData {
  // Context burn rate
  contextRatePerMin: number | null;   // %/min
  contextEtaMinutes: number | null;   // minutes until context full, null if full

  // Token burn rate (from transcript)
  tokenRatePerMin: number | null;     // tokens/min (average)
  recentTokenRatePerMin: number | null; // tokens/min (recent window), null if not shown

  // Usage burn rate (from rate_limits + session duration)
  fiveHourRatePerMin: number | null;  // %/min
  fiveHourEtaMinutes: number | null;  // minutes until 100%, null if full
}
```

## 测试策略

1. **单元测试**：`burn-rate.ts` 计算逻辑，覆盖：
   - 正常计算
   - 会话太短（< 2min）
   - 无 sessionStart
   - 无采样点 / 采样点不足
   - 速率 <= 0（/compact 后）
   - 已达 100%
   - 滑动窗口不足 2 个点
2. **渲染测试**：`burn-rate.ts` 渲染输出格式
3. **缓存兼容性测试**：旧缓存不含 tokenSamplePoints 时不崩溃
