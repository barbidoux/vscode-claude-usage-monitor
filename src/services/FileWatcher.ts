import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';

export class FileWatcher implements vscode.Disposable {
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private readonly debounceMs: number = 500;

  private readonly _onFileChanged = new vscode.EventEmitter<void>();
  public readonly onFileChanged = this._onFileChanged.event;

  private readonly filePath: string;
  private isWatching: boolean = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  public start(): void {
    if (this.isWatching) {
      return;
    }

    const dir = path.dirname(this.filePath);
    const filename = path.basename(this.filePath);

    if (!fs.existsSync(dir)) {
      console.warn(`Directory does not exist: ${dir}`);
      return;
    }

    try {
      this.watcher = fs.watch(dir, (eventType, changedFilename) => {
        if (changedFilename === filename) {
          this.handleFileChange();
        }
      });

      this.watcher.on('error', (error) => {
        console.error('File watcher error:', error);
        this.stop();
      });

      this.isWatching = true;
    } catch (error) {
      console.error('Failed to start file watcher:', error);
    }
  }

  public stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.isWatching = false;
  }

  private handleFileChange(): void {
    // Debounce rapid changes
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this._onFileChanged.fire();
      this.debounceTimer = null;
    }, this.debounceMs);
  }

  public dispose(): void {
    this.stop();
    this._onFileChanged.dispose();
  }
}
