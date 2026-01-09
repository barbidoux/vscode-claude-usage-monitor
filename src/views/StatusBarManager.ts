import * as vscode from 'vscode';
import { UsageMetrics, formatTokenCount, formatNumber, getSonnetQuota } from '../models/UsageMetrics';

export class StatusBarManager implements vscode.Disposable {
  private readonly quotaBarItem: vscode.StatusBarItem;
  private readonly statsBarItem: vscode.StatusBarItem;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    const config = vscode.workspace.getConfiguration('claudeMonitor');
    const position = config.get<string>('statusBarPosition', 'right');

    const alignment = position === 'left'
      ? vscode.StatusBarAlignment.Left
      : vscode.StatusBarAlignment.Right;

    // Quota bar (shows 5h and weekly limits) - higher priority = more left
    this.quotaBarItem = vscode.window.createStatusBarItem(alignment, 101);
    this.quotaBarItem.command = 'workbench.view.extension.claude-usage-monitor';
    this.quotaBarItem.name = 'Claude Quota';

    // Stats bar (shows messages/tokens)
    this.statsBarItem = vscode.window.createStatusBarItem(alignment, 100);
    this.statsBarItem.command = 'workbench.view.extension.claude-usage-monitor';
    this.statsBarItem.name = 'Claude Stats';

    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('claudeMonitor.showStatusBar')) {
          this.applyVisibilityConfiguration();
        }
      })
    );

    this.applyVisibilityConfiguration();
  }

  private applyVisibilityConfiguration(): void {
    const config = vscode.workspace.getConfiguration('claudeMonitor');
    const showStatusBar = config.get<boolean>('showStatusBar', true);

    if (showStatusBar) {
      this.quotaBarItem.show();
      this.statsBarItem.show();
    } else {
      this.quotaBarItem.hide();
      this.statsBarItem.hide();
    }
  }

  public update(metrics: UsageMetrics): void {
    this.updateQuotaBar(metrics);
    this.updateStatsBar(metrics);
  }

  private updateQuotaBar(metrics: UsageMetrics): void {
    if (!metrics.quota) {
      if (metrics.quotaError) {
        this.quotaBarItem.text = '$(warning) Quota: Error';
        this.quotaBarItem.tooltip = metrics.quotaError;
        this.quotaBarItem.backgroundColor = undefined;
      } else {
        this.quotaBarItem.text = '$(sync~spin) Quota...';
        this.quotaBarItem.tooltip = 'Loading quota data...';
        this.quotaBarItem.backgroundColor = undefined;
      }
      return;
    }

    // Get quotas - use helper for Sonnet which may be in different fields
    const fiveHour = metrics.quota.five_hour?.utilization ?? 0;
    const sevenDay = metrics.quota.seven_day?.utilization ?? 0;
    const sonnetQuota = getSonnetQuota(metrics.quota);
    const sonnetUsage = sonnetQuota?.utilization ?? 0;

    // Display format: "5h: 25% | 7d: 40% | Sonnet: 30%"
    const parts: string[] = [];

    if (metrics.quota.five_hour) {
      parts.push(`5h: ${fiveHour.toFixed(0)}%`);
    }
    if (metrics.quota.seven_day) {
      parts.push(`7d: ${sevenDay.toFixed(0)}%`);
    }
    if (sonnetQuota) {
      parts.push(`Sonnet: ${sonnetUsage.toFixed(0)}%`);
    }

    // Determine color based on highest usage
    const maxUsage = Math.max(fiveHour, sevenDay, sonnetUsage);
    let icon = '$(check)';
    let bgColor: vscode.ThemeColor | undefined = undefined;

    if (maxUsage >= 80) {
      icon = '$(flame)';
      bgColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (maxUsage >= 50) {
      icon = '$(warning)';
      bgColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }

    this.quotaBarItem.text = `${icon} ${parts.join(' | ')}`;
    this.quotaBarItem.backgroundColor = bgColor;
    this.quotaBarItem.tooltip = this.createQuotaTooltip(metrics);
  }

  private updateStatsBar(metrics: UsageMetrics): void {
    if (!metrics.dataAvailable) {
      this.statsBarItem.text = '$(warning) Claude';
      this.statsBarItem.tooltip = metrics.error || 'Unable to load Claude usage data';
      this.statsBarItem.backgroundColor = undefined;
      return;
    }

    // Show weekly messages and total sessions
    const weeklyMessages = this.getWeeklyMessages(metrics);
    const totalSessions = metrics.totalSessions;

    this.statsBarItem.text = `$(comment-discussion) ${formatNumber(weeklyMessages)} | $(window) ${totalSessions}`;
    this.statsBarItem.tooltip = this.createStatsTooltip(metrics);
    this.statsBarItem.backgroundColor = undefined;
  }

  private getWeeklyMessages(metrics: UsageMetrics): number {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoStr = weekAgo.toISOString().split('T')[0];

    let messages = 0;
    for (const activity of metrics.dailyActivity) {
      if (activity.date >= weekAgoStr) {
        messages += activity.messageCount || 0;
      }
    }
    return messages;
  }

  private createQuotaTooltip(metrics: UsageMetrics): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;

    md.appendMarkdown('### Claude Rate Limits\n\n');

    if (metrics.quota?.five_hour) {
      const q = metrics.quota.five_hour;
      const resetTime = q.resets_at ? this.formatResetTime(q.resets_at) : 'Unknown';
      md.appendMarkdown(`**5-Hour Session:** ${q.utilization.toFixed(0)}% used\n`);
      md.appendMarkdown(`- Resets in: ${resetTime}\n\n`);
    }

    if (metrics.quota?.seven_day) {
      const q = metrics.quota.seven_day;
      const resetTime = q.resets_at ? this.formatResetTime(q.resets_at) : 'Unknown';
      md.appendMarkdown(`**Weekly (All Models):** ${q.utilization.toFixed(0)}% used\n`);
      md.appendMarkdown(`- Resets in: ${resetTime}\n\n`);
    }

    if (metrics.quota) {
      const sonnetQ = getSonnetQuota(metrics.quota);
      if (sonnetQ) {
        const resetTime = sonnetQ.resets_at ? this.formatResetTime(sonnetQ.resets_at) : 'Unknown';
        md.appendMarkdown(`**Weekly (Sonnet):** ${sonnetQ.utilization.toFixed(0)}% used\n`);
        md.appendMarkdown(`- Resets in: ${resetTime}\n\n`);
      }
    }

    md.appendMarkdown('---\n');
    md.appendMarkdown('*Click to open dashboard*');

    return md;
  }

  private createStatsTooltip(metrics: UsageMetrics): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;

    const subType = metrics.subscriptionType || 'unknown';
    md.appendMarkdown(`### Claude ${subType.charAt(0).toUpperCase() + subType.slice(1)}\n\n`);

    // This week stats
    const weeklyMessages = this.getWeeklyMessages(metrics);
    md.appendMarkdown('**This Week**\n');
    md.appendMarkdown(`- Messages: ${formatNumber(weeklyMessages)}\n\n`);

    // All time stats
    md.appendMarkdown('**All Time**\n');
    md.appendMarkdown(`- Sessions: ${formatNumber(metrics.totalSessions)}\n`);
    md.appendMarkdown(`- Messages: ${formatNumber(metrics.totalMessages)}\n`);
    md.appendMarkdown(`- Input: ${formatTokenCount(metrics.totalInputTokens)}\n`);
    md.appendMarkdown(`- Output: ${formatTokenCount(metrics.totalOutputTokens)}\n\n`);

    md.appendMarkdown('---\n');
    md.appendMarkdown(`*Updated: ${metrics.lastUpdated.toLocaleTimeString()}*\n\n`);
    md.appendMarkdown('*Click to open dashboard*');

    return md;
  }

  private formatResetTime(resetAt: string): string {
    const resetTime = new Date(resetAt).getTime();
    const now = Date.now();
    const diff = resetTime - now;

    if (diff <= 0) return 'Resetting...';

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 24) {
      const days = Math.floor(hours / 24);
      const remainingHours = hours % 24;
      return `${days}d ${remainingHours}h`;
    }

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }

    return `${minutes}m`;
  }

  public showRefreshing(): void {
    this.quotaBarItem.text = '$(sync~spin) Updating...';
  }

  public dispose(): void {
    this.quotaBarItem.dispose();
    this.statsBarItem.dispose();

    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }
}
