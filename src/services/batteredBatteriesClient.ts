import axios, { AxiosInstance } from "axios";
import {
  createApiRequest,
  PreparedSetpoint,
} from "../domain/setpoint";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const DEFAULT_MAX_RETRY_DELAY_MS = 5_000;

type Sleep = (milliseconds: number) => Promise<void>;
type Clock = () => Date;

export interface BatteredBatteriesClientOptions {
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  maxRetryDelayMs?: number;
  httpClient?: AxiosInstance;
  sleep?: Sleep;
  clock?: Clock;
}

export class BatteredBatteriesClient {
  private readonly httpClient: AxiosInstance;
  private readonly maxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly sleep: Sleep;
  private readonly clock: Clock;

  public constructor(options: BatteredBatteriesClientOptions) {
    if (!options.apiKey.trim()) {
      throw new Error("The Battered Batteries API key is required.");
    }

    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.retryBaseDelayMs =
      options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    this.maxRetryDelayMs =
      options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
    this.sleep = options.sleep ?? delay;
    this.clock = options.clock ?? (() => new Date());

    this.httpClient =
      options.httpClient ??
      axios.create({
        baseURL: options.baseUrl,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        headers: {
          "Content-Type": "application/json",
          "Ocp-Apim-Subscription-Key": options.apiKey,
        },
      });
  }

  public async publishSetpoint(setpoint: PreparedSetpoint): Promise<void> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        // Recreate the time window for every attempt. A startTime created before
        // a retry delay could otherwise be rejected for no longer being future.
        const requestBody = createApiRequest(setpoint, this.clock());
        const response = await this.httpClient.post(
          `/${encodeURIComponent(setpoint.deviceId)}/setpoint`,
          requestBody,
        );

        if (response.status !== 204) {
          throw new UnexpectedApiResponseError(response.status);
        }

        return;
      } catch (error: unknown) {
        lastError = error;

        if (attempt === this.maxAttempts || !isRetryable(error)) {
          throw error;
        }

        const retryDelayMs = calculateRetryDelay(
          error,
          attempt,
          this.retryBaseDelayMs,
          this.maxRetryDelayMs,
          this.clock(),
        );

        await this.sleep(retryDelayMs);
      }
    }

    // This is unreachable, but it keeps the method safe if the loop is changed later.
    throw lastError ?? new Error("Publishing the setpoint failed.");
  }
}

export class UnexpectedApiResponseError extends Error {
  public constructor(public readonly status: number) {
    super(`The Battered Batteries API returned unexpected HTTP ${status}.`);
    this.name = "UnexpectedApiResponseError";
  }
}

export function describeHttpError(error: unknown): string {
  if (error instanceof UnexpectedApiResponseError) {
    return error.message;
  }

  if (axios.isAxiosError(error)) {
    if (error.response) {
      return `Battered Batteries API returned HTTP ${error.response.status}.`;
    }

    return `Battered Batteries API request failed (${error.code ?? "network error"}).`;
  }

  return error instanceof Error ? error.message : "Unknown error.";
}

function isRetryable(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }

  const status = error.response?.status;

  // No response normally means a timeout, DNS problem, or network interruption.
  if (status === undefined) {
    return true;
  }

  return status === 429 || status >= 500;
}

function calculateRetryDelay(
  error: unknown,
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  now: Date,
): number {
  const retryAfterMs = readRetryAfterMilliseconds(error, now);

  if (retryAfterMs !== undefined) {
    return Math.min(retryAfterMs, maxDelayMs);
  }

  const exponentialDelay = baseDelayMs * 2 ** (attempt - 1);
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

function readRetryAfterMilliseconds(
  error: unknown,
  now: Date,
): number | undefined {
  if (!axios.isAxiosError(error) || error.response?.status !== 429) {
    return undefined;
  }

  const header = error.response.headers["retry-after"];
  const rawValue = Array.isArray(header) ? header[0] : header;

  if (typeof rawValue !== "string" && typeof rawValue !== "number") {
    return undefined;
  }

  const value = String(rawValue).trim();
  const seconds = Number(value);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1_000;
  }

  const retryDateMs = Date.parse(value);
  if (!Number.isFinite(retryDateMs)) {
    return undefined;
  }

  return Math.max(0, retryDateMs - now.getTime());
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
