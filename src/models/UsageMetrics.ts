/**
 * Type definitions for Claude Usage Monitor
 */

export interface QuotaUsage {
  utilization: number; // Percentage 0-100
  resets_at: string | null;
}

export interface QuotaData {
  five_hour: QuotaUsage | null;
  seven_day: QuotaUsage | null;
  seven_day_oauth_apps: QuotaUsage | null;
  seven_day_opus: QuotaUsage | null;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
  costUSD: number;
  contextWindow: number;
}

export interface DailyActivity {
  date: string;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
}

export interface DailyModelTokens {
  date: string;
  tokensByModel: { [modelName: string]: number };
}

export interface LongestSession {
  sessionId: string;
  duration: number;
  messageCount: number;
  timestamp: string;
}

export interface StatsCache {
  version: number;
  lastComputedDate: string;
  dailyActivity: DailyActivity[];
  dailyModelTokens: DailyModelTokens[];
  modelUsage: { [modelName: string]: ModelUsage };
  totalSessions: number;
  totalMessages: number;
  longestSession: LongestSession;
  firstSessionDate: string;
  hourCounts: { [hour: string]: number };
}

export interface Credentials {
  claudeAiOauth?: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes: string[];
    subscriptionType: string;
    rateLimitTier: string;
  };
}

export interface UsageMetrics {
  // Subscription info
  subscriptionType: string;
  rateLimitTier: string;

  // Today's usage
  todayTokens: number;
  todayMessages: number;
  todaySessions: number;
  todayToolCalls: number;

  // Model breakdown
  modelUsage: { [modelName: string]: ModelUsage };

  // Historical data
  totalSessions: number;
  totalMessages: number;
  longestSession: LongestSession | null;
  firstSessionDate: string | null;
  lastComputedDate: string | null;
  dailyActivity: DailyActivity[];
  dailyModelTokens: DailyModelTokens[];
  hourlyDistribution: { [hour: string]: number };

  // Computed totals
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;

  // Quota (from API)
  quota?: QuotaData;
  quotaError?: string;

  // Meta
  lastUpdated: Date;
  dataAvailable: boolean;
  error?: string;
}

export function createEmptyMetrics(): UsageMetrics {
  return {
    subscriptionType: 'unknown',
    rateLimitTier: 'unknown',
    todayTokens: 0,
    todayMessages: 0,
    todaySessions: 0,
    todayToolCalls: 0,
    modelUsage: {},
    totalSessions: 0,
    totalMessages: 0,
    longestSession: null,
    firstSessionDate: null,
    lastComputedDate: null,
    dailyActivity: [],
    dailyModelTokens: [],
    hourlyDistribution: {},
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    lastUpdated: new Date(),
    dataAvailable: false
  };
}

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000_000) {
    return `${(tokens / 1_000_000_000).toFixed(2)}B`;
  }
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(2)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return tokens.toLocaleString();
}

export function formatNumber(num: number): string {
  return num.toLocaleString();
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

export function getModelDisplayName(modelId: string): string {
  if (modelId.includes('opus')) {
    return 'Opus 4.5';
  }
  if (modelId.includes('sonnet')) {
    return 'Sonnet 4.5';
  }
  if (modelId.includes('haiku')) {
    return 'Haiku';
  }
  return modelId.replace('claude-', '').replace(/-\d{8}$/, '');
}

export function getModelColor(modelId: string): string {
  if (modelId.includes('opus')) {
    return '#D97706'; // Amber/Orange for Opus (premium)
  }
  if (modelId.includes('sonnet')) {
    return '#8B5CF6'; // Purple for Sonnet
  }
  if (modelId.includes('haiku')) {
    return '#10B981'; // Green for Haiku (fast)
  }
  return '#6B7280'; // Gray default
}
