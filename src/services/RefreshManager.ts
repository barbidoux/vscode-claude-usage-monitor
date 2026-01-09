import * as vscode from 'vscode';
import { FileWatcher } from './FileWatcher';
import { ClaudeDataService } from './ClaudeDataService';
import { ClaudeAPIService } from './ClaudeAPIService';
import { UsageMetrics, createEmptyMetrics } from '../models/UsageMetrics';

export type RefreshModeType = 'realtime' | 'periodic' | 'manual';

// Interval constraints (in milliseconds)
const MIN_INTERVAL_MS = 3000;  // 3 seconds minimum
const MAX_INTERVAL_MS = 300000; // 5 minutes maximum

export class RefreshManager implements vscode.Disposable {
  private readonly dataService: ClaudeDataService;
  private readonly apiService: ClaudeAPIService;
  private fileWatcher: FileWatcher | null = null;
  private periodicTimer: NodeJS.Timeout | null = null;
  private currentMode: RefreshModeType = 'periodic';
  private disposables: vscode.Disposable[] = [];

  // Concurrency control
  private isRefreshing = false;
  private lastMetrics: UsageMetrics | null = null;
  private isDisposed = false;

  private readonly _onMetricsUpdated = new vscode.EventEmitter<UsageMetrics>();
  public readonly onMetricsUpdated = this._onMetricsUpdated.event;

  private readonly _onRefreshStarted = new vscode.EventEmitter<void>();
  public readonly onRefreshStarted = this._onRefreshStarted.event;

  constructor(dataService: ClaudeDataService) {
    this.dataService = dataService;
    this.apiService = new ClaudeAPIService();

    // Listen for configuration changes
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('claudeMonitor.refreshMode') ||
            e.affectsConfiguration('claudeMonitor.refreshInterval') ||
            e.affectsConfiguration('claudeMonitor.realtimeInterval')) {
          this.applyConfiguration();
        }
      })
    );
  }

  public async initialize(): Promise<void> {
    this.applyConfiguration();
    // Do initial refresh
    await this.refresh();
  }

  private applyConfiguration(): void {
    const config = vscode.workspace.getConfiguration('claudeMonitor');
    const mode = config.get<RefreshModeType>('refreshMode', 'periodic');

    this.setMode(mode);
  }

  public setMode(mode: RefreshModeType): void {
    if (this.isDisposed) return;

    // Stop current refresh mechanism
    this.stopCurrentMode();

    this.currentMode = mode;

    const config = vscode.workspace.getConfiguration('claudeMonitor');

    try {
      switch (mode) {
        case 'realtime': {
          const interval = this.clampInterval(config.get<number>('realtimeInterval', 5) * 1000);
          this.startRealtimeMode(interval);
          break;
        }
        case 'periodic': {
          const interval = this.clampInterval(config.get<number>('refreshInterval', 30) * 1000);
          this.startPeriodicMode(interval);
          break;
        }
        case 'manual':
          // No automatic refresh
          break;
      }
    } catch (error) {
      console.error('Error setting refresh mode:', error);
      this.currentMode = 'manual'; // Fall back to safe mode
    }
  }

  /**
   * Clamp interval to safe bounds to prevent CPU/resource issues
   */
  private clampInterval(intervalMs: number): number {
    return Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS, intervalMs));
  }

  private stopCurrentMode(): void {
    // Stop file watcher
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
      this.fileWatcher = null;
    }

    // Stop periodic timer
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }

  private startRealtimeMode(intervalMs: number): void {
    // Use file watcher for realtime updates
    const statsPath = this.dataService.getStatsFilePath();
    this.fileWatcher = new FileWatcher(statsPath);

    this.disposables.push(
      this.fileWatcher.onFileChanged(async () => {
        await this.refresh();
      })
    );

    this.fileWatcher.start();

    // Also use a timer as backup for realtime mode
    this.periodicTimer = setInterval(async () => {
      await this.refresh();
    }, intervalMs);
  }

  private startPeriodicMode(intervalMs: number): void {
    this.periodicTimer = setInterval(async () => {
      await this.refresh();
    }, intervalMs);
  }

  public async refresh(): Promise<UsageMetrics> {
    // Don't refresh if disposed
    if (this.isDisposed) {
      return this.lastMetrics || createEmptyMetrics();
    }

    // Prevent concurrent refreshes - return cached data if already refreshing
    if (this.isRefreshing) {
      return this.lastMetrics || createEmptyMetrics();
    }

    this.isRefreshing = true;
    this._onRefreshStarted.fire();

    try {
      // Load local metrics
      const metrics = await this.dataService.loadMetrics();

      // Fetch quota from API
      try {
        const quotaResult = await this.apiService.fetchQuota();
        if (quotaResult.success && quotaResult.data) {
          metrics.quota = quotaResult.data;
        } else {
          metrics.quotaError = quotaResult.error;
        }
      } catch (error) {
        metrics.quotaError = error instanceof Error ? error.message : 'Failed to fetch quota';
      }

      // Cache the metrics for concurrent request handling
      this.lastMetrics = metrics;

      this._onMetricsUpdated.fire(metrics);

      return metrics;
    } finally {
      this.isRefreshing = false;
    }
  }

  public getMode(): RefreshModeType {
    return this.currentMode;
  }

  public dispose(): void {
    this.isDisposed = true;
    this.stopCurrentMode();
    this._onMetricsUpdated.dispose();
    this._onRefreshStarted.dispose();

    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }
}
