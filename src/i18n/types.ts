export type MessageKey =
  // Labels
  | "label.context"
  | "label.usage"
  | "label.weekly"
  | "label.approxRam"
  | "label.rules"
  | "label.hooks"
  | "label.estimatedCost"
  | "label.cost"
  | "label.burnRate"
  | "label.ctx"
  | "label.recent"
  // Status
  | "status.limitReached"
  | "status.allTodosComplete"
  | "status.full"
  // Format
  | "format.resets"
  | "format.resetsIn"
  | "format.in"
  | "format.cache"
  | "format.out"
  | "format.tokPerSec"
  | "format.perMin"
  | "format.eta"
  | "format.tokPerMin"
  // Init
  | "init.initializing"
  | "init.macosNote";

export type Messages = Record<MessageKey, string>;

export type Language = "en" | "zh";
