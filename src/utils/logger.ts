import * as vscode from 'vscode';

/**
 * Log levels for structured logging
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/**
 * Logger configuration
 */
interface LoggerConfig {
  /** Minimum log level to output */
  minLevel: LogLevel;
  /** Whether to include timestamps */
  timestamps: boolean;
  /** Logger name prefix */
  name: string;
}

/**
 * Structured logger for Claude Usage Monitor
 * Provides consistent logging with timestamps, levels, and VS Code output channel support
 */
export class Logger {
  private static instance: Logger | null = null;
  private static outputChannel: vscode.OutputChannel | null = null;

  private readonly config: LoggerConfig;

  private constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      minLevel: config.minLevel ?? LogLevel.INFO,
      timestamps: config.timestamps ?? true,
      name: config.name ?? 'ClaudeMonitor',
    };
  }

  /**
   * Get the singleton logger instance
   */
  public static getInstance(): Logger {
    Logger.instance ??= new Logger();
    return Logger.instance;
  }

  /**
   * Initialize or get the VS Code output channel
   */
  public static getOutputChannel(): vscode.OutputChannel {
    Logger.outputChannel ??= vscode.window.createOutputChannel('Claude Monitor');
    return Logger.outputChannel;
  }

  /**
   * Dispose of the output channel
   */
  public static dispose(): void {
    if (Logger.outputChannel) {
      Logger.outputChannel.dispose();
      Logger.outputChannel = null;
    }
    Logger.instance = null;
  }

  /**
   * Set the minimum log level
   */
  public setLevel(level: LogLevel): void {
    this.config.minLevel = level;
  }

  /**
   * Format a log message with timestamp and level
   */
  private format(level: string, message: string, context?: string): string {
    const parts: string[] = [];

    if (this.config.timestamps) {
      parts.push(`[${new Date().toISOString()}]`);
    }

    parts.push(
      `[${this.config.name}]`,
      `[${level}]`,
      ...(context ? [`[${context}]`] : []),
      message
    );

    return parts.join(' ');
  }

  /**
   * Log a debug message
   */
  public debug(message: string, context?: string, ...args: unknown[]): void {
    if (this.config.minLevel <= LogLevel.DEBUG) {
      const formatted = this.format('DEBUG', message, context);
      console.debug(formatted, ...args);
      Logger.getOutputChannel().appendLine(formatted + (args.length ? ' ' + JSON.stringify(args) : ''));
    }
  }

  /**
   * Log an info message
   */
  public info(message: string, context?: string, ...args: unknown[]): void {
    if (this.config.minLevel <= LogLevel.INFO) {
      const formatted = this.format('INFO', message, context);
      console.log(formatted, ...args);
      Logger.getOutputChannel().appendLine(formatted + (args.length ? ' ' + JSON.stringify(args) : ''));
    }
  }

  /**
   * Log a warning message
   */
  public warn(message: string, context?: string, ...args: unknown[]): void {
    if (this.config.minLevel <= LogLevel.WARN) {
      const formatted = this.format('WARN', message, context);
      console.warn(formatted, ...args);
      Logger.getOutputChannel().appendLine(formatted + (args.length ? ' ' + JSON.stringify(args) : ''));
    }
  }

  /**
   * Log an error message
   */
  public error(message: string, context?: string, error?: unknown): void {
    if (this.config.minLevel <= LogLevel.ERROR) {
      const formatted = this.format('ERROR', message, context);
      console.error(formatted, error);

      let output = formatted;
      if (error instanceof Error) {
        output += `\n  Error: ${error.message}`;
        if (error.stack) {
          output += `\n  Stack: ${error.stack}`;
        }
      } else if (error !== undefined) {
        output += `\n  Details: ${JSON.stringify(error)}`;
      }

      Logger.getOutputChannel().appendLine(output);
    }
  }

  /**
   * Create a child logger with a specific context
   */
  public child(context: string): ContextLogger {
    return new ContextLogger(this, context);
  }
}

/**
 * Context-aware logger that automatically includes context in all messages
 */
export class ContextLogger {
  constructor(
    private readonly parent: Logger,
    private readonly context: string
  ) {}

  public debug(message: string, ...args: unknown[]): void {
    this.parent.debug(message, this.context, ...args);
  }

  public info(message: string, ...args: unknown[]): void {
    this.parent.info(message, this.context, ...args);
  }

  public warn(message: string, ...args: unknown[]): void {
    this.parent.warn(message, this.context, ...args);
  }

  public error(message: string, error?: unknown): void {
    this.parent.error(message, this.context, error);
  }
}

// Export a default logger instance
export const logger = Logger.getInstance();
