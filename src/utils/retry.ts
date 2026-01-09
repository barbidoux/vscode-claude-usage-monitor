/**
 * Retry configuration options
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  /** Initial delay in milliseconds (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds (default: 10000) */
  maxDelayMs?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Whether to add jitter to delay (default: true) */
  jitter?: boolean;
  /** Function to determine if error is retryable (default: all errors) */
  isRetryable?: (error: unknown) => boolean;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  jitter: true,
  isRetryable: () => true,
};

/**
 * Calculate delay with exponential backoff and optional jitter
 */
function calculateDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  backoffMultiplier: number,
  jitter: boolean
): number {
  // Exponential backoff: delay = initialDelay * (multiplier ^ attempt)
  let delay = initialDelayMs * Math.pow(backoffMultiplier, attempt);

  // Cap at maximum delay
  delay = Math.min(delay, maxDelayMs);

  // Add jitter (0-50% of delay) to prevent thundering herd
  if (jitter) {
    const jitterAmount = delay * 0.5 * Math.random();
    delay = delay + jitterAmount;
  }

  return Math.floor(delay);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute an async function with retry logic and exponential backoff
 *
 * @param fn - The async function to execute
 * @param options - Retry configuration options
 * @returns The result of the function if successful
 * @throws The last error encountered if all retries fail
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  let lastError: unknown;

  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if this error is retryable
      if (!opts.isRetryable(error)) {
        throw error;
      }

      // Don't delay after the last attempt
      if (attempt < opts.maxAttempts - 1) {
        const delay = calculateDelay(
          attempt,
          opts.initialDelayMs,
          opts.maxDelayMs,
          opts.backoffMultiplier,
          opts.jitter
        );

        console.log(`Retry attempt ${attempt + 1}/${opts.maxAttempts - 1}, waiting ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  // All retries exhausted
  throw lastError;
}

/**
 * Determine if an HTTP status code indicates a retryable error
 */
export function isRetryableHttpStatus(statusCode: number): boolean {
  // Retry on:
  // - 408 Request Timeout
  // - 429 Too Many Requests (rate limit)
  // - 500 Internal Server Error
  // - 502 Bad Gateway
  // - 503 Service Unavailable
  // - 504 Gateway Timeout
  return [408, 429, 500, 502, 503, 504].includes(statusCode);
}

/**
 * Determine if an error is a network error that should be retried
 */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('econnrefused') ||
      message.includes('enotfound') ||
      message.includes('network') ||
      message.includes('socket')
    );
  }
  return false;
}
