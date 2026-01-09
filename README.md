# Claude Usage Monitor

A VS Code extension that displays real-time Claude usage metrics in an always-visible sidebar dashboard and status bar. Built for Claude Max subscription users who want to track their quota and usage patterns.

![VS Code](https://img.shields.io/badge/VS%20Code-^1.85.0-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)
![License](https://img.shields.io/badge/License-GLWT-brightgreen)

## Features

### Live Quota Monitoring
- **5-Hour Session Limit** - Track your rolling 5-hour usage window
- **7-Day Weekly Limit** - Monitor weekly consumption across all models
- **Sonnet-Specific Limit** - Dedicated tracking for Sonnet model usage
- **Time Until Reset** - See exactly when your quotas refresh

### Dashboard View
- Visual progress bars with color-coded status (green/yellow/red)
- Token usage breakdown by model (Opus, Sonnet, Haiku)
- Daily activity charts showing usage patterns
- Session statistics and historical data

### Status Bar Integration
- Compact quota indicators always visible
- Color-coded warnings as you approach limits
- Quick access to full dashboard

### Flexible Refresh Options
- **Real-time Mode** - Updates every 5 seconds with file watching
- **Periodic Mode** - Configurable interval (5-300 seconds, default 30s)
- **Manual Mode** - Refresh on-demand only

## Screenshots

```
+---------------------------+
|  CLAUDE USAGE DASHBOARD   |
+---------------------------+
| 5-Hour Limit              |
| [==========----] 72%      |
| Resets in: 2h 15m         |
+---------------------------+
| Weekly (All Models)       |
| [======--------] 45%      |
| Resets in: 3d 8h          |
+---------------------------+
| Weekly (Sonnet)           |
| [====---------] 31%       |
| Resets in: 3d 8h          |
+---------------------------+
| TOKEN USAGE               |
| Opus:   127,432 tokens    |
| Sonnet:  31,205 tokens    |
| Haiku:    8,901 tokens    |
+---------------------------+
```

## Installation

### From Source

1. Clone the repository:
   ```bash
   git clone https://github.com/barbidoux/vscode-claude-usage-monitor.git
   cd vscode-claude-usage-monitor
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Compile TypeScript:
   ```bash
   npm run compile
   ```

4. Open in VS Code and press `F5` to launch Extension Development Host

### From VSIX (when available)

```bash
code --install-extension claude-usage-monitor-0.1.0.vsix
```

## Requirements

- **VS Code** version 1.85.0 or higher
- **Claude Code CLI** installed and authenticated (provides the OAuth credentials)
- **Claude Max subscription** (or any subscription with quota limits)

## Configuration

Access settings via `File > Preferences > Settings` and search for "Claude Monitor":

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `claudeMonitor.refreshMode` | string | `"periodic"` | Refresh mode: `"realtime"`, `"periodic"`, or `"manual"` |
| `claudeMonitor.refreshInterval` | number | `30` | Seconds between refreshes in periodic mode (5-300) |
| `claudeMonitor.realtimeInterval` | number | `5` | Seconds between refreshes in realtime mode (3-30) |
| `claudeMonitor.showStatusBar` | boolean | `true` | Show usage indicator in the status bar |
| `claudeMonitor.statusBarPosition` | string | `"right"` | Status bar position: `"left"` or `"right"` |
| `claudeMonitor.claudeDataPath` | string | `""` | Custom path to Claude data directory (default: `~/.claude`) |

## Commands

| Command | Description |
|---------|-------------|
| `Claude Monitor: Refresh Usage Data` | Manually refresh all usage data |
| `Claude Monitor: Open Settings` | Open extension settings |
| `Claude Monitor: Set Refresh Mode` | Quick switch between refresh modes |

## How It Works

### Data Sources

1. **Local Claude Files** (`~/.claude/`)
   - `stats-cache.json` - Historical token usage, sessions, daily activity
   - `.credentials.json` - OAuth tokens for API authentication

2. **Claude OAuth API**
   - Fetches live quota data from `api.anthropic.com/api/oauth/usage`
   - Automatic token refresh when expired
   - Retry logic with exponential backoff for reliability

### Architecture

```
RefreshManager
    |
    +-- ClaudeDataService (reads local files)
    |
    +-- ClaudeAPIService (fetches live quota)
    |
    +-- Emits onMetricsUpdated event
            |
            +-- UsageDashboardProvider (sidebar UI)
            +-- StatusBarManager (status bar)
```

## Development

### Build Commands

```bash
npm run compile    # Compile TypeScript to ./out/
npm run watch      # Watch mode for development
npm run lint       # Run ESLint
npm run test       # Run tests
```

### Project Structure

```
src/
  extension.ts           # Entry point
  models/
    UsageMetrics.ts      # Type definitions
  services/
    ClaudeDataService.ts # Local file reading
    ClaudeAPIService.ts  # API calls with retry
    RefreshManager.ts    # Refresh orchestration
    FileWatcher.ts       # File system monitoring
  views/
    UsageDashboardProvider.ts  # Webview sidebar
    StatusBarManager.ts        # Status bar items
  utils/
    retry.ts             # Exponential backoff
    htmlEscape.ts        # XSS prevention
    logger.ts            # Structured logging
```

## Troubleshooting

### "No OAuth credentials found"
- Ensure Claude Code CLI is installed and you've logged in at least once
- Run `claude --version` to verify installation
- Check that `~/.claude/.credentials.json` exists

### Dashboard shows "Waiting for data..."
- Click the refresh button or wait for automatic refresh
- Check the Output panel (View > Output > "Claude Monitor") for errors
- Verify your internet connection for API calls

### Quota data seems outdated
- Switch to "realtime" refresh mode for more frequent updates
- The API has rate limits; don't set intervals too low

### Custom Claude data path not working
- Use absolute paths (e.g., `C:\Users\name\.claude` on Windows)
- Restart VS Code after changing the path

## Privacy & Security

- All data is read locally from your Claude Code installation
- OAuth tokens are used only for Anthropic's official API
- No data is sent to third parties
- Credentials are never logged or exposed

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

This project is licensed under the GLWT (Good Luck With That) Public License.
See [LICENSE](LICENSE) for details.

## Acknowledgments

- Built for the Claude Code community
- Uses the official Anthropic OAuth API
- Inspired by the need to track Claude Max subscription usage

---

**Note**: This extension is not officially affiliated with Anthropic. It's a community tool that reads data from the official Claude Code CLI installation.
