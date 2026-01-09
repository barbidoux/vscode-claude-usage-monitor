# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
npm run compile    # Compile TypeScript to JavaScript (outputs to ./out/)
npm run watch      # Watch mode for development
npm run lint       # Run ESLint on src/**/*.ts
npm run test       # Run tests (requires test infrastructure setup)
```

To test the extension: Press F5 in VS Code to launch Extension Development Host.

## Architecture Overview

This is a VS Code extension that monitors Claude usage for Claude Max subscription users. It displays quota/rate limits, token usage, and statistics in a sidebar dashboard and status bar.

### Data Sources

**Local Files** (`~/.claude/` or custom path via `claudeMonitor.claudeDataPath` setting):
- `stats-cache.json` - Token usage, sessions, daily activity, model breakdown (updated only when Claude Code sessions end)
- `.credentials.json` - OAuth tokens, subscription type, rate limit tier

**Claude OAuth API** (`https://api.anthropic.com/api/oauth/usage`):
- Fetches live quota data: `five_hour`, `seven_day` (all models), `seven_day_opus` (actually Sonnet despite the name)
- Requires OAuth token from credentials file; handles token refresh automatically

### Service Layer

- **ClaudeDataService** - Reads and parses local Claude data files
- **ClaudeAPIService** - Fetches live quota from Claude's OAuth API with retry logic and token refresh
- **RefreshManager** - Orchestrates data refresh with three modes: realtime (5s file watcher + polling), periodic (30s default), manual. Includes concurrency guard to prevent overlapping refreshes.
- **FileWatcher** - Watches stats-cache.json for real-time updates with debouncing

### View Layer

- **UsageDashboardProvider** - WebviewViewProvider that renders the sidebar HTML dashboard with quota bars, token stats, and charts. Uses nonce-based CSP for security.
- **StatusBarManager** - Two status bar items showing live quota percentages and session stats

### Utilities

- **retry.ts** - `withRetry()` function with exponential backoff for API calls
- **htmlEscape.ts** - XSS prevention utilities for webview content
- **logger.ts** - Structured logging with VS Code output channel support

### Data Flow

```
RefreshManager.refresh()
  -> ClaudeDataService.loadMetrics()     (local files)
  -> ClaudeAPIService.fetchQuota()       (API call with retry)
  -> Fires onMetricsUpdated event
     -> UsageDashboardProvider.updateMetrics()
     -> StatusBarManager.update()
```

## Key Types

`UsageMetrics` (src/models/UsageMetrics.ts) is the central data structure passed through the system, containing subscription info, token counts, daily activity, and quota data. `QuotaData` and `QuotaUsage` types are also defined here for API response handling.

## Configuration Settings

All settings prefixed with `claudeMonitor.`:
- `refreshMode`: "realtime" | "periodic" | "manual"
- `refreshInterval`: seconds for periodic mode (5-300)
- `realtimeInterval`: seconds for realtime mode (3-30)
- `claudeDataPath`: custom path to ~/.claude directory

## Quota API Notes

The API field `seven_day_opus` is actually for Sonnet model usage (API name is outdated). The three rate limit metrics are:
1. `five_hour` - 5-hour session limit
2. `seven_day` - Weekly limit (all models)
3. `seven_day_opus` - Weekly Sonnet-specific limit
