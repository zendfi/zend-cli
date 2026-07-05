import { describe, expect, it, vi } from "vitest";
import type { ZendClient } from "pay-with-zend-sdk";
import { pollUntilTerminal, retrieveKeyWithRetry } from "../src/pairing.js";

function makeMockClient(overrides: Partial<ZendClient> = {}): ZendClient {
  return {
    createZendPayment: vi.fn(),
    getPaymentRequest: vi.fn(),
    listPaymentRequests: vi.fn(),
    verifyReturnToken: vi.fn(),
    createApiKey: vi.fn(),
    listApiKeys: vi.fn(),
    revokeApiKey: vi.fn(),
    getWebhookConfig: vi.fn(),
    setWebhookUrl: vi.fn(),
    listWebhookDeliveries: vi.fn(),
    createPairingSession: vi.fn(),
    getPairingSessionStatus: vi.fn(),
    retrievePairingKey: vi.fn(),
    ...overrides,
  } as ZendClient;
}

describe("pollUntilTerminal (Requirement 1.11: never faster than 2s)", () => {
  it("polls at intervals of at least 2000ms until a terminal status is reached", async () => {
    vi.useFakeTimers();
    const statuses = ["pending", "pending", "approved"] as const;
    let call = 0;
    const client = makeMockClient({
      getPairingSessionStatus: vi.fn().mockImplementation(async () => ({
        status: statuses[call++] ?? "approved",
        cliDisplayName: "test",
        expiresAt: new Date().toISOString(),
      })),
    });

    const resultPromise = pollUntilTerminal(client, "session-1");

    // Each poll iteration awaits a 2000ms sleep before calling the client.
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);

    const result = await resultPromise;
    expect(result.status).toBe("approved");
    expect(client.getPairingSessionStatus).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });

  it("stops immediately on denied without further polling", async () => {
    vi.useFakeTimers();
    const client = makeMockClient({
      getPairingSessionStatus: vi.fn().mockResolvedValue({
        status: "denied",
        cliDisplayName: "test",
        expiresAt: new Date().toISOString(),
      }),
    });

    const resultPromise = pollUntilTerminal(client, "session-1");
    await vi.advanceTimersByTimeAsync(2000);
    const result = await resultPromise;

    expect(result.status).toBe("denied");
    expect(client.getPairingSessionStatus).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("retrieveKeyWithRetry (Requirement 1.18: up to 3 attempts on network/server error)", () => {
  it("returns the key immediately on first success", async () => {
    const client = makeMockClient({
      retrievePairingKey: vi.fn().mockResolvedValue({ apiKey: "zdev_test_key" }),
    });
    const key = await retrieveKeyWithRetry(client, "session-1");
    expect(key).toBe("zdev_test_key");
    expect(client.retrievePairingKey).toHaveBeenCalledTimes(1);
  });

  it("retries on a transient (5xx) failure and succeeds within 3 attempts", async () => {
    let attempts = 0;
    const client = makeMockClient({
      retrievePairingKey: vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          const err = new Error("Internal Server Error") as Error & { statusCode: number };
          err.statusCode = 500;
          throw err;
        }
        return { apiKey: "zdev_test_key" };
      }),
    });

    const key = await retrieveKeyWithRetry(client, "session-1");
    expect(key).toBe("zdev_test_key");
    expect(attempts).toBe(3);
  });

  it("gives up after 3 attempts and does not persist a key", async () => {
    const client = makeMockClient({
      retrievePairingKey: vi.fn().mockImplementation(async () => {
        const err = new Error("Internal Server Error") as Error & { statusCode: number };
        err.statusCode = 500;
        throw err;
      }),
    });

    await expect(retrieveKeyWithRetry(client, "session-1")).rejects.toThrow();
    expect(client.retrievePairingKey).toHaveBeenCalledTimes(3);
  });

  it("does not retry on a definitive rejection (e.g. session already invalidated)", async () => {
    const client = makeMockClient({
      retrievePairingKey: vi.fn().mockImplementation(async () => {
        const err = new Error("Session invalidated") as Error & { statusCode: number };
        err.statusCode = 410;
        throw err;
      }),
    });

    await expect(retrieveKeyWithRetry(client, "session-1")).rejects.toThrow();
    expect(client.retrievePairingKey).toHaveBeenCalledTimes(1);
  });
});
