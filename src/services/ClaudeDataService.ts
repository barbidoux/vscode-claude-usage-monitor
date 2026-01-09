import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as vscode from 'vscode';
import {
  StatsCache,
  Credentials,
  UsageMetrics,
  createEmptyMetrics
} from '../models/UsageMetrics';

export class ClaudeDataService {
  private readonly claudeDataPath: string;

  constructor() {
    this.claudeDataPath = this.getClaudeDataPath();
  }

  private getClaudeDataPath(): string {
    const config = vscode.workspace.getConfiguration('claudeMonitor');
    const customPath = config.get<string>('claudeDataPath');

    if (customPath && customPath.trim() !== '') {
      return customPath;
    }

    return path.join(os.homedir(), '.claude');
  }

  public getStatsFilePath(): string {
    return path.join(this.claudeDataPath, 'stats-cache.json');
  }

  public getCredentialsFilePath(): string {
    return path.join(this.claudeDataPath, '.credentials.json');
  }

  public async loadMetrics(): Promise<UsageMetrics> {
    const metrics = createEmptyMetrics();

    try {
      if (!fs.existsSync(this.claudeDataPath)) {
        metrics.error = 'Claude data directory not found. Is Claude Code installed?';
        return metrics;
      }

      // Load stats cache
      const statsCache = await this.loadStatsCache();
      if (statsCache) {
        this.populateFromStatsCache(metrics, statsCache);
      }

      // Load credentials for subscription info
      const credentials = await this.loadCredentials();
      if (credentials?.claudeAiOauth) {
        metrics.subscriptionType = credentials.claudeAiOauth.subscriptionType || 'unknown';
        metrics.rateLimitTier = credentials.claudeAiOauth.rateLimitTier || 'unknown';
      }

      metrics.dataAvailable = true;
      metrics.lastUpdated = new Date();

    } catch (error) {
      metrics.error = `Error loading metrics: ${error instanceof Error ? error.message : String(error)}`;
    }

    return metrics;
  }

  private async loadStatsCache(): Promise<StatsCache | null> {
    const filePath = this.getStatsFilePath();

    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(content) as StatsCache;
    } catch (error) {
      console.error('Error reading stats cache:', error);
      return null;
    }
  }

  private async loadCredentials(): Promise<Credentials | null> {
    const filePath = this.getCredentialsFilePath();

    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(content) as Credentials;
    } catch (error) {
      console.error('Error reading credentials:', error);
      return null;
    }
  }

  private populateFromStatsCache(metrics: UsageMetrics, stats: StatsCache): void {
    // Copy model usage
    metrics.modelUsage = stats.modelUsage || {};

    // Copy historical data
    metrics.totalSessions = stats.totalSessions || 0;
    metrics.totalMessages = stats.totalMessages || 0;
    metrics.firstSessionDate = stats.firstSessionDate || null;
    metrics.lastComputedDate = stats.lastComputedDate || null;
    metrics.dailyActivity = stats.dailyActivity || [];
    metrics.dailyModelTokens = stats.dailyModelTokens || [];
    metrics.hourlyDistribution = stats.hourCounts || {};

    // Handle longestSession (it's an object, not a number)
    if (stats.longestSession && typeof stats.longestSession === 'object') {
      metrics.longestSession = stats.longestSession;
    }

    // Calculate total tokens across all models
    for (const usage of Object.values(metrics.modelUsage)) {
      metrics.totalInputTokens += usage.inputTokens || 0;
      metrics.totalOutputTokens += usage.outputTokens || 0;
      metrics.totalCacheReadTokens += usage.cacheReadInputTokens || 0;
      metrics.totalCacheCreationTokens += usage.cacheCreationInputTokens || 0;
    }

    // Calculate today's metrics
    const today = this.getTodayDateString();
    const todayActivity = stats.dailyActivity?.find(d => d.date === today);

    if (todayActivity) {
      metrics.todayMessages = todayActivity.messageCount || 0;
      metrics.todaySessions = todayActivity.sessionCount || 0;
      metrics.todayToolCalls = todayActivity.toolCallCount || 0;
    }

    // Calculate today's tokens from dailyModelTokens
    const todayTokens = stats.dailyModelTokens?.find(d => d.date === today);
    if (todayTokens) {
      metrics.todayTokens = Object.values(todayTokens.tokensByModel || {}).reduce((sum, t) => sum + t, 0);
    }
  }

  private getTodayDateString(): string {
    const now = new Date();
    return now.toISOString().split('T')[0];
  }

  public getTotalTokensByModel(metrics: UsageMetrics): Map<string, number> {
    const totals = new Map<string, number>();

    for (const [modelName, usage] of Object.entries(metrics.modelUsage)) {
      const total = (usage.inputTokens || 0) + (usage.outputTokens || 0);
      totals.set(modelName, total);
    }

    return totals;
  }

  public getWeeklyStats(metrics: UsageMetrics): { messages: number; tokens: number; sessions: number } {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoStr = weekAgo.toISOString().split('T')[0];

    let messages = 0;
    let sessions = 0;
    let tokens = 0;

    for (const activity of metrics.dailyActivity) {
      if (activity.date >= weekAgoStr) {
        messages += activity.messageCount || 0;
        sessions += activity.sessionCount || 0;
      }
    }

    for (const dayTokens of metrics.dailyModelTokens) {
      if (dayTokens.date >= weekAgoStr) {
        tokens += Object.values(dayTokens.tokensByModel || {}).reduce((sum, t) => sum + t, 0);
      }
    }

    return { messages, tokens, sessions };
  }

  public getPeakHours(metrics: UsageMetrics): { hour: number; count: number }[] {
    const hours: { hour: number; count: number }[] = [];

    for (const [hourStr, count] of Object.entries(metrics.hourlyDistribution)) {
      hours.push({ hour: Number.parseInt(hourStr, 10), count });
    }

    return hours.sort((a, b) => b.count - a.count);
  }
}
