import * as vscode from 'vscode';
import { ClaudeDataService } from './services/ClaudeDataService';
import { RefreshManager, RefreshModeType } from './services/RefreshManager';
import { UsageDashboardProvider } from './views/UsageDashboardProvider';
import { StatusBarManager } from './views/StatusBarManager';
import { Logger, logger } from './utils/logger';

// Track services for proper cleanup
let dataService: ClaudeDataService | undefined;
let refreshManager: RefreshManager | undefined;
let dashboardProvider: UsageDashboardProvider | undefined;
let statusBarManager: StatusBarManager | undefined;

// Track if extension is disposed to prevent operations after deactivation
let isDisposed = false;

export async function activate(context: vscode.ExtensionContext) {
  logger.info('Extension activating...', 'Extension');

  try {
    // Initialize services
    dataService = new ClaudeDataService();
    refreshManager = new RefreshManager(dataService);
    dashboardProvider = new UsageDashboardProvider(context.extensionUri, dataService);
    statusBarManager = new StatusBarManager();

    // Register the dashboard webview provider
    const dashboardView = vscode.window.registerWebviewViewProvider(
      UsageDashboardProvider.viewType,
      dashboardProvider
    );

    // Subscribe to metrics updates
    const metricsSubscription = refreshManager.onMetricsUpdated(metrics => {
      if (isDisposed) return;
      dashboardProvider?.updateMetrics(metrics);
      statusBarManager?.update(metrics);
    });

    // Subscribe to refresh started events
    const refreshStartedSubscription = refreshManager.onRefreshStarted(() => {
      if (isDisposed) return;
      statusBarManager?.showRefreshing();
    });

    // Register commands
    const refreshCommand = vscode.commands.registerCommand('claudeMonitor.refresh', async () => {
      if (isDisposed || !refreshManager) return;
      try {
        await refreshManager.refresh();
        vscode.window.setStatusBarMessage('Claude Usage Monitor: Refreshed', 2000);
      } catch (error) {
        logger.error('Error during manual refresh', 'Extension', error);
        vscode.window.showErrorMessage('Failed to refresh usage data');
      }
    });

    const openSettingsCommand = vscode.commands.registerCommand('claudeMonitor.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'claudeMonitor');
    });

    const setRefreshModeCommand = vscode.commands.registerCommand('claudeMonitor.setRefreshMode', async () => {
      if (isDisposed || !refreshManager) return;

      const currentMode = refreshManager.getMode();

      const modes: { label: string; description: string; mode: RefreshModeType }[] = [
        {
          label: 'Real-time',
          description: 'Update every 5-10 seconds',
          mode: 'realtime'
        },
        {
          label: 'Periodic',
          description: 'Update every 30 seconds (default)',
          mode: 'periodic'
        },
        {
          label: 'Manual',
          description: 'Only update when you click refresh',
          mode: 'manual'
        }
      ];

      const selected = await vscode.window.showQuickPick(
        modes.map(m => ({
          label: m.label + (m.mode === currentMode ? ' (current)' : ''),
          description: m.description,
          mode: m.mode
        })),
        {
          placeHolder: 'Select refresh mode',
          title: 'Claude Monitor: Set Refresh Mode'
        }
      );

      if (selected && !isDisposed) {
        const config = vscode.workspace.getConfiguration('claudeMonitor');
        await config.update('refreshMode', selected.mode, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Refresh mode set to: ${selected.label}`);
      }
    });

    // Add all disposables to context subscriptions
    context.subscriptions.push(
      dashboardView,
      metricsSubscription,
      refreshStartedSubscription,
      refreshCommand,
      openSettingsCommand,
      setRefreshModeCommand,
      refreshManager,
      statusBarManager
    );

    // Initialize the refresh manager (this will do the first data load)
    try {
      await refreshManager.initialize();
    } catch (initError) {
      logger.error('Error initializing refresh manager', 'Extension', initError);
      vscode.window.showWarningMessage(
        'Claude Monitor: Failed to load initial data. Click refresh to retry.'
      );
      // Continue activation - extension should still work with manual refresh
    }

    logger.info('Extension activated successfully', 'Extension');

  } catch (error) {
    logger.error('Failed to activate extension', 'Extension', error);
    vscode.window.showErrorMessage(
      `Claude Usage Monitor failed to activate: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    // Clean up any partially initialized resources
    cleanupResources();
    throw error; // Re-throw to signal failed activation
  }
}

export function deactivate() {
  logger.info('Extension deactivating...', 'Extension');
  isDisposed = true;
  cleanupResources();
  logger.info('Extension deactivated', 'Extension');
  Logger.dispose();
}

/**
 * Clean up all extension resources
 */
function cleanupResources(): void {
  try {
    // Dispose refresh manager first (stops timers and file watchers)
    if (refreshManager) {
      try {
        refreshManager.dispose();
      } catch (e) {
        logger.error('Error disposing refresh manager', 'Cleanup', e);
      }
      refreshManager = undefined;
    }

    // Dispose status bar manager
    if (statusBarManager) {
      try {
        statusBarManager.dispose();
      } catch (e) {
        logger.error('Error disposing status bar manager', 'Cleanup', e);
      }
      statusBarManager = undefined;
    }

    // Clear other references
    dashboardProvider = undefined;
    dataService = undefined;

  } catch (error) {
    logger.error('Error during resource cleanup', 'Cleanup', error);
  }
}
