/**
 * CLI device-pairing polling and retrieval logic (Requirements 1.11, 1.13, 1.18).
 */
import type { ZendClient, PairingSessionStatus } from "pay-with-zend-sdk";

const POLL_INTERVAL_MS = 2000; // never faster than 2s (Requirement 1.11)
const MAX_RETRIEVAL_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PollResult {
  status: PairingSessionStatus;
}

/**
 * Polls a pairing session's status at intervals no shorter than
 * {@link POLL_INTERVAL_MS} until it reaches a terminal state
 * (`approved`, `denied`, or `expired`).
 */
export async function pollUntilTerminal(
  client: ZendClient,
  sessionId: string,
  opts: { signal?: AbortSignal; onTick?: (status: PairingSessionStatus) => void } = {},
): Promise<PollResult> {
  while (true) {
    if (opts.signal?.aborted) {
      throw new Error("Polling aborted");
    }
    await sleep(POLL_INTERVAL_MS);
    const { status } = await client.getPairingSessionStatus(sessionId);
    opts.onTick?.(status);
    if (status !== "pending") {
      return { status };
    }
  }
}

function isNetworkOrServerError(err: unknown): boolean {
  if (err instanceof Error) {
    // ZendPaymentError from the SDK carries a statusCode for HTTP errors;
    // treat anything without one (network-level failure) or a 5xx as
    // retryable, and 4xx (e.g. SESSION_INVALIDATED) as non-retryable.
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === undefined) return true;
    return statusCode >= 500;
  }
  return true;
}

/**
 * Retrieves the issued API key for an approved pairing session, retrying up
 * to {@link MAX_RETRIEVAL_ATTEMPTS} times on network/server errors
 * (Requirement 1.18). Does not retry on a definitive rejection (e.g. the
 * key was already retrieved).
 */
export async function retrieveKeyWithRetry(client: ZendClient, sessionId: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIEVAL_ATTEMPTS; attempt++) {
    try {
      const { apiKey } = await client.retrievePairingKey(sessionId);
      return apiKey;
    } catch (err) {
      lastError = err;
      if (!isNetworkOrServerError(err) || attempt >= MAX_RETRIEVAL_ATTEMPTS) {
        throw err;
      }
      await sleep(500 * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Failed to retrieve API key");
}
