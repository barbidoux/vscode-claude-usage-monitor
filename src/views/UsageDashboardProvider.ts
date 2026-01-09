import * as vscode from 'vscode';
import * as crypto from 'node:crypto';
import {
  UsageMetrics,
  formatTokenCount,
  formatNumber,
  formatDuration,
  getModelDisplayName,
  getModelColor
} from '../models/UsageMetrics';
import { ClaudeDataService } from '../services/ClaudeDataService';
import { escapeHtml } from '../utils/htmlEscape';

export class UsageDashboardProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'claudeUsageOverview';

  private _view?: vscode.WebviewView;
  private _metrics?: UsageMetrics;
  private readonly _dataService: ClaudeDataService;
  private _nonce: string = '';

  constructor(
    private readonly _extensionUri: vscode.Uri,
    dataService: ClaudeDataService
  ) {
    this._dataService = dataService;
  }

  private _generateNonce(): string {
    return crypto.randomBytes(16).toString('base64');
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    // Generate nonce for CSP
    this._nonce = this._generateNonce();
    webviewView.webview.html = this._getHtmlContent(this._nonce);

    webviewView.webview.onDidReceiveMessage(message => {
      // Validate message structure
      if (!message || typeof message !== 'object') {
        console.warn('Invalid message received from webview: not an object');
        return;
      }

      if (typeof message.command !== 'string') {
        console.warn('Invalid message received from webview: missing command');
        return;
      }

      switch (message.command) {
        case 'refresh':
          vscode.commands.executeCommand('claudeMonitor.refresh');
          break;
        case 'openSettings':
          vscode.commands.executeCommand('claudeMonitor.openSettings');
          break;
        default:
          console.warn(`Unknown webview command: ${escapeHtml(message.command)}`);
      }
    });
  }

  public updateMetrics(metrics: UsageMetrics): void {
    this._metrics = metrics;

    if (this._view) {
      this._view.webview.postMessage({
        type: 'update',
        data: this._prepareData(metrics)
      });
    }
  }

  private _prepareData(metrics: UsageMetrics) {
    // Prepare model data with colors
    const models = Object.entries(metrics.modelUsage).map(([id, usage]) => {
      const inputOutput = (usage.inputTokens || 0) + (usage.outputTokens || 0);
      const cached = (usage.cacheReadInputTokens || 0) + (usage.cacheCreationInputTokens || 0);
      return {
        id,
        name: getModelDisplayName(id),
        color: getModelColor(id),
        inputTokens: usage.inputTokens || 0,
        outputTokens: usage.outputTokens || 0,
        cacheReadTokens: usage.cacheReadInputTokens || 0,
        cacheCreationTokens: usage.cacheCreationInputTokens || 0,
        totalDirect: inputOutput,
        totalCached: cached,
        total: inputOutput + cached
      };
    }).sort((a, b) => b.totalDirect - a.totalDirect);

    // Weekly stats
    const weeklyStats = this._dataService.getWeeklyStats(metrics);

    // Daily activity for chart (last 7 days)
    const sortedActivity = [...metrics.dailyActivity].sort((a, b) => a.date.localeCompare(b.date));
    const dailyData = sortedActivity
      .slice(-7)
      .map(d => ({
        date: new Date(d.date).toLocaleDateString('en-US', { weekday: 'short' }),
        fullDate: d.date,
        messages: d.messageCount,
        sessions: d.sessionCount,
        tools: d.toolCallCount
      }));

    // Check if today has data, otherwise use most recent day
    const todayHasData = metrics.todayMessages > 0 || metrics.todayTokens > 0 || metrics.todaySessions > 0;
    const lastActivityDay = sortedActivity.at(-1) ?? null;
    const lastCacheDate = metrics.lastComputedDate || (lastActivityDay?.date);

    // Get the data to display in "Recent" section
    let recentActivity = {
      messages: metrics.todayMessages,
      tokens: metrics.todayTokens,
      sessions: metrics.todaySessions,
      toolCalls: metrics.todayToolCalls,
      dateLabel: 'Today',
      isToday: true
    };

    if (!todayHasData && lastActivityDay) {
      // Find tokens for that day
      const dayTokens = metrics.dailyModelTokens.find(d => d.date === lastActivityDay.date);
      const tokensForDay = dayTokens
        ? Object.values(dayTokens.tokensByModel || {}).reduce((sum, t) => sum + t, 0)
        : 0;

      recentActivity = {
        messages: lastActivityDay.messageCount || 0,
        tokens: tokensForDay,
        sessions: lastActivityDay.sessionCount || 0,
        toolCalls: lastActivityDay.toolCallCount || 0,
        dateLabel: this._formatDateLabel(lastActivityDay.date),
        isToday: false
      };
    }

    // Calculate total tokens
    const totalTokens = metrics.totalInputTokens + metrics.totalOutputTokens;
    const totalCacheTokens = metrics.totalCacheReadTokens + metrics.totalCacheCreationTokens;

    return {
      subscription: {
        type: metrics.subscriptionType,
        tier: metrics.rateLimitTier,
        tierFormatted: this._formatTier(metrics.rateLimitTier)
      },
      recent: {
        ...recentActivity,
        messagesFormatted: formatNumber(recentActivity.messages),
        tokensFormatted: formatTokenCount(recentActivity.tokens),
        toolCallsFormatted: formatNumber(recentActivity.toolCalls)
      },
      totals: {
        sessions: metrics.totalSessions,
        sessionsFormatted: formatNumber(metrics.totalSessions),
        messages: metrics.totalMessages,
        messagesFormatted: formatNumber(metrics.totalMessages),
        inputTokens: metrics.totalInputTokens,
        inputTokensFormatted: formatTokenCount(metrics.totalInputTokens),
        outputTokens: metrics.totalOutputTokens,
        outputTokensFormatted: formatTokenCount(metrics.totalOutputTokens),
        totalTokens,
        totalTokensFormatted: formatTokenCount(totalTokens),
        cacheRead: metrics.totalCacheReadTokens,
        cacheReadFormatted: formatTokenCount(metrics.totalCacheReadTokens),
        cacheCreation: metrics.totalCacheCreationTokens,
        cacheCreationFormatted: formatTokenCount(metrics.totalCacheCreationTokens),
        totalCache: totalCacheTokens,
        totalCacheFormatted: formatTokenCount(totalCacheTokens)
      },
      weekly: {
        messages: weeklyStats.messages,
        messagesFormatted: formatNumber(weeklyStats.messages),
        tokens: weeklyStats.tokens,
        tokensFormatted: formatTokenCount(weeklyStats.tokens),
        sessions: weeklyStats.sessions
      },
      models: models.map(m => ({
        ...m,
        inputTokensFormatted: formatTokenCount(m.inputTokens),
        outputTokensFormatted: formatTokenCount(m.outputTokens),
        cacheReadFormatted: formatTokenCount(m.cacheReadTokens),
        cacheCreationFormatted: formatTokenCount(m.cacheCreationTokens),
        totalDirectFormatted: formatTokenCount(m.totalDirect),
        totalCachedFormatted: formatTokenCount(m.totalCached),
        totalFormatted: formatTokenCount(m.total)
      })),
      longestSession: metrics.longestSession ? {
        duration: formatDuration(metrics.longestSession.duration),
        messages: metrics.longestSession.messageCount,
        messagesFormatted: formatNumber(metrics.longestSession.messageCount)
      } : null,
      firstSession: metrics.firstSessionDate
        ? new Date(metrics.firstSessionDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : null,
      dailyData,
      lastCacheDate: lastCacheDate ? this._formatDateLabel(lastCacheDate) : 'Unknown',
      lastCacheDateRaw: lastCacheDate,
      lastUpdated: metrics.lastUpdated.toLocaleTimeString(),
      dataAvailable: metrics.dataAvailable,
      error: metrics.error,
      // Quota data from API
      quota: metrics.quota ? {
        fiveHour: metrics.quota.five_hour ? {
          utilization: metrics.quota.five_hour.utilization,
          resetsAt: metrics.quota.five_hour.resets_at,
          resetsIn: this._formatTimeUntilReset(metrics.quota.five_hour.resets_at)
        } : null,
        sevenDay: metrics.quota.seven_day ? {
          utilization: metrics.quota.seven_day.utilization,
          resetsAt: metrics.quota.seven_day.resets_at,
          resetsIn: this._formatTimeUntilReset(metrics.quota.seven_day.resets_at)
        } : null,
        sevenDayOpus: metrics.quota.seven_day_opus ? {
          utilization: metrics.quota.seven_day_opus.utilization,
          resetsAt: metrics.quota.seven_day_opus.resets_at,
          resetsIn: this._formatTimeUntilReset(metrics.quota.seven_day_opus.resets_at)
        } : null
      } : null,
      quotaError: metrics.quotaError
    };
  }

  private _formatTimeUntilReset(resetAt: string | null): string {
    if (!resetAt) return 'Unknown';

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

  private _formatDateLabel(dateStr: string): string {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (dateStr === today.toISOString().split('T')[0]) {
      return 'Today';
    } else if (dateStr === yesterday.toISOString().split('T')[0]) {
      return 'Yesterday';
    } else {
      return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }
  }

  private _formatTier(tier: string): string {
    if (!tier || tier === 'unknown') return 'Standard';
    if (tier.includes('max_20x')) return 'Max 20x';
    if (tier.includes('max')) return 'Max';
    return tier.replaceAll('_', ' ').replaceAll('default claude ', '');
  }

  private _getHtmlContent(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Claude Usage</title>
  <style>
    :root {
      --claude-orange: #D97706;
      --claude-orange-dim: rgba(217, 119, 6, 0.15);
      --claude-purple: #8B5CF6;
      --claude-purple-dim: rgba(139, 92, 246, 0.15);
      --claude-green: #10B981;
      --claude-green-dim: rgba(16, 185, 129, 0.15);
      --claude-blue: #3B82F6;
      --claude-blue-dim: rgba(59, 130, 246, 0.15);
      --claude-red: #EF4444;
      --claude-yellow: #F59E0B;
      --bg-primary: var(--vscode-sideBar-background);
      --bg-secondary: var(--vscode-editor-background);
      --bg-tertiary: var(--vscode-input-background);
      --text-primary: var(--vscode-foreground);
      --text-secondary: var(--vscode-descriptionForeground);
      --text-muted: color-mix(in srgb, var(--text-secondary) 70%, transparent);
      --border-color: var(--vscode-panel-border);
      --accent: var(--claude-orange);
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: var(--vscode-font-family);
      font-size: 12px;
      color: var(--text-primary);
      background: var(--bg-primary);
      padding: 12px;
      line-height: 1.5;
    }

    /* Header */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border-color);
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .logo {
      width: 22px;
      height: 22px;
      background: linear-gradient(135deg, var(--claude-orange), #B45309);
      border-radius: 5px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 12px;
      color: white;
    }

    .header h1 {
      font-size: 14px;
      font-weight: 600;
    }

    .badge {
      background: var(--claude-orange-dim);
      color: var(--claude-orange);
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      border: 1px solid var(--claude-orange);
    }

    .header-actions {
      display: flex;
      gap: 6px;
    }

    .btn {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      color: var(--text-primary);
      width: 28px;
      height: 28px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
    }

    .btn:hover {
      background: var(--bg-secondary);
      border-color: var(--accent);
      transform: scale(1.05);
    }

    .btn:focus {
      outline: none;
    }

    .btn:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
      border-color: var(--accent);
    }

    .btn:active {
      transform: scale(0.95);
    }

    /* Accessibility: Ensure all interactive elements are keyboard accessible */
    *:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    /* Section */
    .section {
      margin-bottom: 16px;
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
    }

    .section-header-left {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .section-title {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .section-badge {
      font-size: 9px;
      padding: 2px 6px;
      border-radius: 8px;
      background: var(--bg-tertiary);
      color: var(--text-muted);
    }

    .section-badge.stale {
      background: var(--claude-yellow);
      color: #000;
    }

    .section-icon {
      font-size: 13px;
    }

    /* Quota Section */
    .quota-container {
      margin-bottom: 16px;
    }

    .quota-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 14px;
      margin-bottom: 10px;
    }

    .quota-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }

    .quota-title {
      font-weight: 600;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .quota-reset {
      font-size: 10px;
      color: var(--text-muted);
    }

    .quota-progress {
      height: 8px;
      background: var(--bg-tertiary);
      border-radius: 4px;
      overflow: hidden;
      margin-bottom: 8px;
    }

    .quota-progress-bar {
      height: 100%;
      border-radius: 4px;
      transition: width 0.3s ease;
    }

    .quota-progress-bar.green { background: linear-gradient(90deg, #10B981, #34D399); }
    .quota-progress-bar.yellow { background: linear-gradient(90deg, #F59E0B, #FBBF24); }
    .quota-progress-bar.red { background: linear-gradient(90deg, #EF4444, #F87171); }

    .quota-stats {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
    }

    .quota-percent {
      font-weight: 700;
    }

    .quota-percent.green { color: var(--claude-green); }
    .quota-percent.yellow { color: var(--claude-yellow); }
    .quota-percent.red { color: var(--claude-red); }

    .quota-error {
      background: var(--claude-orange-dim);
      border: 1px solid var(--claude-orange);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 16px;
      font-size: 11px;
      color: var(--text-secondary);
    }

    .quota-error-title {
      font-weight: 600;
      color: var(--claude-orange);
      margin-bottom: 4px;
    }

    /* Stats Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
    }

    .stats-grid.cols-3 {
      grid-template-columns: repeat(3, 1fr);
    }

    .stats-grid.cols-4 {
      grid-template-columns: repeat(4, 1fr);
    }

    .stat-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 12px;
      text-align: center;
    }

    .stat-card.highlight {
      border-color: var(--accent);
      background: var(--claude-orange-dim);
    }

    .stat-card.wide {
      grid-column: span 2;
    }

    .stat-value {
      font-size: 22px;
      font-weight: 700;
      color: var(--text-primary);
      line-height: 1.2;
    }

    .stat-value.accent {
      color: var(--accent);
    }

    .stat-value.small {
      font-size: 16px;
    }

    .stat-value.xs {
      font-size: 14px;
    }

    .stat-label {
      font-size: 10px;
      color: var(--text-secondary);
      margin-top: 4px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .stat-sub {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 2px;
    }

    /* Model Card */
    .model-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 14px;
      margin-bottom: 10px;
      border-left: 3px solid var(--model-color, var(--border-color));
    }

    .model-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 12px;
    }

    .model-info {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .model-icon {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      font-weight: bold;
      color: white;
    }

    .model-name {
      font-weight: 600;
      font-size: 13px;
    }

    .model-subtitle {
      font-size: 10px;
      color: var(--text-secondary);
      margin-top: 2px;
    }

    .model-total {
      text-align: right;
    }

    .model-total-value {
      font-size: 18px;
      font-weight: 700;
    }

    .model-total-label {
      font-size: 9px;
      color: var(--text-secondary);
      text-transform: uppercase;
    }

    /* Token Grid */
    .token-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
    }

    .token-stat {
      background: var(--bg-tertiary);
      border-radius: 6px;
      padding: 8px 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .token-label {
      font-size: 10px;
      color: var(--text-secondary);
    }

    .token-value {
      font-size: 12px;
      font-weight: 600;
    }

    /* Chart */
    .chart-container {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 14px;
    }

    .chart-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .chart-stat {
      text-align: center;
      flex: 1;
    }

    .chart-stat-value {
      font-size: 18px;
      font-weight: 700;
    }

    .chart-stat-label {
      font-size: 10px;
      color: var(--text-secondary);
    }

    .chart-bars {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      height: 50px;
      gap: 6px;
      margin-top: 8px;
    }

    .bar-col {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }

    .bar {
      width: 100%;
      max-width: 28px;
      background: linear-gradient(to top, var(--accent), var(--claude-orange));
      border-radius: 3px 3px 0 0;
      min-height: 4px;
      transition: height 0.3s ease;
    }

    .bar-label {
      font-size: 9px;
      color: var(--text-muted);
    }

    /* Info Box */
    .info-box {
      background: var(--bg-tertiary);
      border-radius: 6px;
      padding: 10px 12px;
      font-size: 10px;
      color: var(--text-secondary);
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-top: 12px;
    }

    .info-icon {
      font-size: 12px;
      flex-shrink: 0;
    }

    /* Quick Stats Footer */
    .quick-stats {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 6px;
      padding: 12px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      margin-bottom: 12px;
    }

    .quick-stat {
      text-align: center;
    }

    .quick-stat-value {
      font-size: 14px;
      font-weight: 700;
      color: var(--text-primary);
    }

    .quick-stat-label {
      font-size: 9px;
      color: var(--text-muted);
      text-transform: uppercase;
    }

    /* Footer */
    .footer {
      margin-top: 12px;
      padding: 10px 12px;
      border-radius: 6px;
      background: var(--bg-tertiary);
      font-size: 10px;
      color: var(--text-muted);
    }

    .footer-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .footer-row + .footer-row {
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px solid var(--border-color);
    }

    .cache-warning {
      color: var(--claude-yellow);
    }

    /* Error & Loading */
    .error-container, .loading {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 30px 20px;
      text-align: center;
    }

    .error-container {
      border-color: #EF4444;
    }

    .error-icon, .loading-icon {
      font-size: 32px;
      margin-bottom: 12px;
    }

    .error-text {
      color: #EF4444;
      font-size: 12px;
    }

    .spinner {
      width: 28px;
      height: 28px;
      border: 3px solid var(--border-color);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 12px;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--text-secondary); }
  </style>
</head>
<body>
  <div id="app" role="main" aria-label="Claude Usage Dashboard">
    <div class="loading" role="status" aria-label="Loading">
      <div class="spinner" aria-hidden="true"></div>
      <div>Loading usage data...</div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    function formatSub(type) {
      if (!type || type === 'unknown') return 'Claude';
      return type.charAt(0).toUpperCase() + type.slice(1);
    }

    function getModelIcon(name) {
      if (name.includes('Opus')) return 'O';
      if (name.includes('Sonnet')) return 'S';
      if (name.includes('Haiku')) return 'H';
      return 'C';
    }

    function getQuotaColor(utilization) {
      if (utilization < 50) return 'green';
      if (utilization < 80) return 'yellow';
      return 'red';
    }

    function renderQuotaBar(quota, title, icon) {
      if (!quota) return '';
      const color = getQuotaColor(quota.utilization);
      return \`
        <div class="quota-card">
          <div class="quota-header">
            <div class="quota-title">\${icon} \${title}</div>
            <div class="quota-reset">Resets in \${quota.resetsIn}</div>
          </div>
          <div class="quota-progress">
            <div class="quota-progress-bar \${color}" style="width: \${Math.min(quota.utilization, 100)}%"></div>
          </div>
          <div class="quota-stats">
            <span class="quota-percent \${color}">\${quota.utilization.toFixed(0)}% used</span>
            <span>\${(100 - quota.utilization).toFixed(0)}% remaining</span>
          </div>
        </div>
      \`;
    }

    function render(data) {
      if (!data.dataAvailable) {
        document.getElementById('app').innerHTML = \`
          <div class="error-container">
            <div class="error-icon">⚠️</div>
            <div class="error-text">\${data.error || 'Unable to load Claude usage data'}</div>
            <button class="btn" style="margin-top: 16px; width: auto; padding: 8px 16px;" onclick="refresh()" aria-label="Retry loading data">
              🔄 Retry
            </button>
          </div>
        \`;
        return;
      }

      const maxMsg = Math.max(...data.dailyData.map(d => d.messages), 1);
      const isStale = !data.recent.isToday;

      document.getElementById('app').innerHTML = \`
        <div class="header">
          <div class="header-left">
            <div class="logo">C</div>
            <h1>Claude Usage</h1>
            <span class="badge">\${formatSub(data.subscription.type)}</span>
          </div>
          <div class="header-actions" role="toolbar" aria-label="Dashboard actions">
            <button class="btn" onclick="refresh()" title="Refresh usage data" aria-label="Refresh usage data">🔄</button>
            <button class="btn" onclick="openSettings()" title="Open settings" aria-label="Open Claude Monitor settings">⚙️</button>
          </div>
        </div>

        <!-- Quota Section -->
        \${data.quota ? \`
          <div class="section">
            <div class="section-header">
              <div class="section-header-left">
                <span class="section-icon">⚡</span>
                <span class="section-title">Rate Limits</span>
              </div>
              <span class="section-badge">\${data.subscription.tierFormatted}</span>
            </div>
            <div class="quota-container">
              \${renderQuotaBar(data.quota.fiveHour, '5-Hour Session', '⏱️')}
              \${renderQuotaBar(data.quota.sevenDay, 'Weekly (All Models)', '📅')}
              \${renderQuotaBar(data.quota.sevenDayOpus, 'Weekly (Sonnet)', '🎯')}
            </div>
          </div>
        \` : data.quotaError ? \`
          <div class="quota-error">
            <div class="quota-error-title">⚠️ Could not fetch rate limits</div>
            <div>\${data.quotaError}</div>
          </div>
        \` : \`
          <div class="quota-error">
            <div class="quota-error-title">⏳ Loading rate limits...</div>
          </div>
        \`}

        <!-- Recent Activity -->
        <div class="section">
          <div class="section-header">
            <div class="section-header-left">
              <span class="section-icon">📊</span>
              <span class="section-title">\${data.recent.dateLabel}</span>
            </div>
            \${isStale ? '<span class="section-badge stale">Cache from ' + data.lastCacheDate + '</span>' : ''}
          </div>
          <div class="stats-grid">
            <div class="stat-card highlight">
              <div class="stat-value accent">\${data.recent.messagesFormatted}</div>
              <div class="stat-label">Messages</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">\${data.recent.tokensFormatted}</div>
              <div class="stat-label">Tokens</div>
            </div>
            <div class="stat-card">
              <div class="stat-value small">\${data.recent.sessions}</div>
              <div class="stat-label">Sessions</div>
            </div>
            <div class="stat-card">
              <div class="stat-value small">\${data.recent.toolCallsFormatted}</div>
              <div class="stat-label">Tool Calls</div>
            </div>
          </div>
        </div>

        <!-- This Week -->
        <div class="section">
          <div class="section-header">
            <div class="section-header-left">
              <span class="section-icon">📈</span>
              <span class="section-title">This Week</span>
            </div>
          </div>
          <div class="chart-container">
            <div class="chart-header">
              <div class="chart-stat">
                <div class="chart-stat-value">\${data.weekly.messagesFormatted}</div>
                <div class="chart-stat-label">Messages</div>
              </div>
              <div class="chart-stat">
                <div class="chart-stat-value">\${data.weekly.tokensFormatted}</div>
                <div class="chart-stat-label">Tokens</div>
              </div>
              <div class="chart-stat">
                <div class="chart-stat-value">\${data.weekly.sessions}</div>
                <div class="chart-stat-label">Sessions</div>
              </div>
            </div>
            <div class="chart-bars">
              \${data.dailyData.map(d => \`
                <div class="bar-col">
                  <div class="bar" style="height: \${Math.max((d.messages / maxMsg) * 40, 4)}px" title="\${d.messages} messages"></div>
                  <div class="bar-label">\${d.date}</div>
                </div>
              \`).join('')}
            </div>
          </div>
        </div>

        <!-- Models -->
        <div class="section">
          <div class="section-header">
            <div class="section-header-left">
              <span class="section-icon">🤖</span>
              <span class="section-title">Token Usage by Model</span>
            </div>
            <span class="section-badge">All-time</span>
          </div>
          \${data.models.map(m => \`
            <div class="model-card" style="--model-color: \${m.color}">
              <div class="model-header">
                <div class="model-info">
                  <div class="model-icon" style="background: \${m.color}">\${getModelIcon(m.name)}</div>
                  <div>
                    <div class="model-name">\${m.name}</div>
                    <div class="model-subtitle">Input + Output tokens</div>
                  </div>
                </div>
                <div class="model-total">
                  <div class="model-total-value" style="color: \${m.color}">\${m.totalDirectFormatted}</div>
                  <div class="model-total-label">Total</div>
                </div>
              </div>
              <div class="token-grid">
                <div class="token-stat">
                  <span class="token-label">Input</span>
                  <span class="token-value">\${m.inputTokensFormatted}</span>
                </div>
                <div class="token-stat">
                  <span class="token-label">Output</span>
                  <span class="token-value">\${m.outputTokensFormatted}</span>
                </div>
                <div class="token-stat">
                  <span class="token-label">Cache Read</span>
                  <span class="token-value">\${m.cacheReadFormatted}</span>
                </div>
                <div class="token-stat">
                  <span class="token-label">Cache Write</span>
                  <span class="token-value">\${m.cacheCreationFormatted}</span>
                </div>
              </div>
            </div>
          \`).join('')}
        </div>

        <!-- All Time Summary -->
        <div class="section">
          <div class="section-header">
            <div class="section-header-left">
              <span class="section-icon">🏆</span>
              <span class="section-title">All Time Stats</span>
            </div>
          </div>
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-value small">\${data.totals.sessionsFormatted}</div>
              <div class="stat-label">Sessions</div>
            </div>
            <div class="stat-card">
              <div class="stat-value small">\${data.totals.messagesFormatted}</div>
              <div class="stat-label">Messages</div>
            </div>
            <div class="stat-card">
              <div class="stat-value small">\${data.totals.inputTokensFormatted}</div>
              <div class="stat-label">Input Tokens</div>
            </div>
            <div class="stat-card">
              <div class="stat-value small">\${data.totals.outputTokensFormatted}</div>
              <div class="stat-label">Output Tokens</div>
            </div>
            <div class="stat-card">
              <div class="stat-value small">\${data.totals.cacheReadFormatted}</div>
              <div class="stat-label">Cache Read</div>
            </div>
            <div class="stat-card">
              <div class="stat-value small">\${data.totals.cacheCreationFormatted}</div>
              <div class="stat-label">Cache Write</div>
            </div>
          </div>
          \${data.longestSession ? \`
            <div class="info-box">
              <span class="info-icon">⏱️</span>
              <span>Longest session: <strong>\${data.longestSession.duration}</strong> (\${data.longestSession.messagesFormatted} messages)</span>
            </div>
          \` : ''}
          \${data.firstSession ? \`
            <div class="info-box">
              <span class="info-icon">📅</span>
              <span>Using Claude Code since <strong>\${data.firstSession}</strong></span>
            </div>
          \` : ''}
        </div>

        <!-- Quick Stats -->
        <div class="quick-stats">
          <div class="quick-stat">
            <div class="quick-stat-value">\${data.totals.totalTokensFormatted}</div>
            <div class="quick-stat-label">Total Tokens</div>
          </div>
          <div class="quick-stat">
            <div class="quick-stat-value">\${data.totals.totalCacheFormatted}</div>
            <div class="quick-stat-label">Cached</div>
          </div>
          <div class="quick-stat">
            <div class="quick-stat-value">\${data.totals.sessionsFormatted}</div>
            <div class="quick-stat-label">Sessions</div>
          </div>
          <div class="quick-stat">
            <div class="quick-stat-value">\${data.models.length}</div>
            <div class="quick-stat-label">Models</div>
          </div>
        </div>

        <!-- Footer -->
        <div class="footer">
          <div class="footer-row">
            <span>Last refresh: \${data.lastUpdated}</span>
            <span>Cache: \${data.lastCacheDate}</span>
          </div>
          <div class="footer-row">
            <span class="cache-warning">\${isStale ? '⚠️ Cache is stale - Claude updates on session end' : '✓ Cache is current'}</span>
          </div>
        </div>
      \`;
    }

    function refresh() {
      vscode.postMessage({ command: 'refresh' });
    }

    function openSettings() {
      vscode.postMessage({ command: 'openSettings' });
    }

    window.addEventListener('message', event => {
      if (event.data.type === 'update') render(event.data.data);
    });
  </script>
</body>
</html>`;
  }
}
