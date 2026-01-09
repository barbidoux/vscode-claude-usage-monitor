import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as vscode from 'vscode';
import { withRetry, isRetryableHttpStatus, isNetworkError } from '../utils/retry';
import type { QuotaData } from '../models/UsageMetrics';

// Re-export for consumers that import from this module
export type { QuotaUsage, QuotaData } from '../models/UsageMetrics';

export interface QuotaResult {
  success: boolean;
  data?: QuotaData;
  error?: string;
}

interface OAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  subscriptionType: string;
  rateLimitTier: string;
}

interface CredentialsFile {
  claudeAiOauth?: OAuthCredentials;
}

/**
 * Error thrown for retryable API failures
 */
class RetryableAPIError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'RetryableAPIError';
  }
}

export class ClaudeAPIService {
  private readonly credentialsPath: string;

  constructor() {
    const config = vscode.workspace.getConfiguration('claudeMonitor');
    const customPath = config.get<string>('claudeDataPath');

    const basePath = (customPath && customPath.trim() !== '')
      ? customPath
      : path.join(os.homedir(), '.claude');

    this.credentialsPath = path.join(basePath, '.credentials.json');
  }

  private async getCredentials(): Promise<OAuthCredentials | null> {
    try {
      if (!fs.existsSync(this.credentialsPath)) {
        console.log('Credentials file not found:', this.credentialsPath);
        return null;
      }

      const content = await fs.promises.readFile(this.credentialsPath, 'utf-8');
      const creds: CredentialsFile = JSON.parse(content);

      if (!creds.claudeAiOauth) {
        console.log('No OAuth credentials found in file');
        return null;
      }

      return creds.claudeAiOauth;
    } catch (error) {
      console.error('Error reading credentials:', error);
      return null;
    }
  }

  private isTokenExpired(expiresAt: number): boolean {
    // Add 5 minute buffer
    return Date.now() > (expiresAt - 5 * 60 * 1000);
  }

  private static readonly REQUEST_TIMEOUT_MS = 10000; // 10 seconds

  private async refreshToken(refreshToken: string): Promise<OAuthCredentials | null> {
    return new Promise((resolve) => {
      const postData = JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: 'claude-code'
      });

      const options = {
        hostname: 'api.anthropic.com',
        port: 443,
        path: '/api/oauth/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'anthropic-beta': 'oauth-2025-04-20'
        }
      };

      let resolved = false;
      const safeResolve = (value: OAuthCredentials | null) => {
        if (!resolved) {
          resolved = true;
          resolve(value);
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', async () => {
          try {
            if (res.statusCode === 200) {
              const response = JSON.parse(data);
              const newCreds: OAuthCredentials = {
                accessToken: response.access_token,
                refreshToken: response.refresh_token || refreshToken,
                expiresAt: Date.now() + (response.expires_in * 1000),
                scopes: response.scope?.split(' ') || [],
                subscriptionType: response.subscription_type || 'unknown',
                rateLimitTier: response.rate_limit_tier || 'unknown'
              };

              // Save updated credentials
              await this.saveCredentials(newCreds);
              safeResolve(newCreds);
            } else {
              console.error('Token refresh failed:', res.statusCode, data);
              safeResolve(null);
            }
          } catch (error) {
            console.error('Error parsing token response:', error);
            safeResolve(null);
          }
        });
      });

      // Add timeout
      req.setTimeout(ClaudeAPIService.REQUEST_TIMEOUT_MS, () => {
        console.error('Token refresh request timeout');
        req.destroy();
        safeResolve(null);
      });

      req.on('error', (error) => {
        console.error('Token refresh request error:', error);
        safeResolve(null);
      });

      req.write(postData);
      req.end();
    });
  }

  private async saveCredentials(creds: OAuthCredentials): Promise<void> {
    try {
      const content = await fs.promises.readFile(this.credentialsPath, 'utf-8');
      const file: CredentialsFile = JSON.parse(content);
      file.claudeAiOauth = creds;
      await fs.promises.writeFile(this.credentialsPath, JSON.stringify(file), 'utf-8');
    } catch (error) {
      console.error('Error saving credentials:', error);
    }
  }

  public async fetchQuota(): Promise<QuotaResult> {
    let creds = await this.getCredentials();

    if (!creds) {
      return {
        success: false,
        error: 'No OAuth credentials found. Please log in to Claude Code first.'
      };
    }

    // Check if token is expired and refresh if needed
    if (this.isTokenExpired(creds.expiresAt)) {
      console.log('Token expired, refreshing...');
      const newCreds = await this.refreshToken(creds.refreshToken);
      if (!newCreds) {
        return {
          success: false,
          error: 'Failed to refresh OAuth token. Please log in to Claude Code again.'
        };
      }
      creds = newCreds;
    }

    // Use retry with exponential backoff for transient failures
    const accessToken = creds.accessToken;
    try {
      return await withRetry(
        () => this.callUsageAPIWithRetry(accessToken),
        {
          maxAttempts: 3,
          initialDelayMs: 1000,
          maxDelayMs: 5000,
          isRetryable: (error) => {
            if (error instanceof RetryableAPIError) {
              return true;
            }
            return isNetworkError(error);
          }
        }
      );
    } catch (error) {
      // All retries exhausted or non-retryable error
      if (error instanceof RetryableAPIError) {
        return {
          success: false,
          error: error.message
        };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Process API response and return appropriate result or throw RetryableAPIError
   */
  private processUsageApiResponse(statusCode: number | undefined, data: string): QuotaResult {
    if (statusCode === 200) {
      const quotaData: QuotaData = JSON.parse(data);
      return { success: true, data: quotaData };
    }

    if (statusCode === 401) {
      return { success: false, error: 'Authentication failed. Please log in to Claude Code again.' };
    }

    if (statusCode && isRetryableHttpStatus(statusCode)) {
      const message = statusCode === 429
        ? 'Rate limited. Please try again later.'
        : `Server error: ${statusCode}`;
      throw new RetryableAPIError(message, statusCode);
    }

    console.error('Usage API error:', statusCode, data);
    return { success: false, error: `API error: ${statusCode}` };
  }

  /**
   * Internal API call that throws RetryableAPIError for transient failures
   */
  private callUsageAPIWithRetry(accessToken: string): Promise<QuotaResult> {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.anthropic.com',
        port: 443,
        path: '/api/oauth/usage',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'Content-Type': 'application/json'
        }
      };

      let settled = false;
      const settle = <T>(fn: () => T): T | undefined => {
        if (!settled) {
          settled = true;
          return fn();
        }
        return undefined;
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => this.handleUsageApiEnd(res.statusCode, data, settle, resolve, reject));
      });

      req.setTimeout(ClaudeAPIService.REQUEST_TIMEOUT_MS, () => {
        console.error('Usage API request timeout');
        req.destroy();
        settle(() => reject(new RetryableAPIError('Request timeout', undefined)));
      });

      req.on('error', (error) => {
        console.error('Usage API request error:', error);
        settle(() => reject(new RetryableAPIError(`Network error: ${error.message}`, undefined)));
      });

      req.end();
    });
  }

  /**
   * Handle the end of API response - extracted to reduce nesting
   */
  private handleUsageApiEnd(
    statusCode: number | undefined,
    data: string,
    settle: <T>(fn: () => T) => T | undefined,
    resolve: (value: QuotaResult) => void,
    reject: (reason: Error) => void
  ): void {
    try {
      const result = this.processUsageApiResponse(statusCode, data);
      settle(() => resolve(result));
    } catch (error) {
      if (error instanceof RetryableAPIError) {
        settle(() => reject(error));
      } else {
        console.error('Error parsing usage response:', error);
        settle(() => resolve({ success: false, error: 'Failed to parse quota data' }));
      }
    }
  }

  public formatTimeUntilReset(resetAt: string | null): string {
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
}
