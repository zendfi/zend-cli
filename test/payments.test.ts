import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";

const configFile = join(homedir(), ".zend", "config.json");

vi.mock("pay-with-zend-sdk", async () => {
  const actual = await vi.importActual<typeof import("pay-with-zend-sdk")>("pay-with-zend-sdk");
  return {
    ...actual,
    createZendClient: vi.fn(),
  };
});

describe("zend payments test (Requirement 3.12: Sandbox Mode)", () => {
  let backup: string | null = null;

  beforeEach(() => {
    backup = existsSync(configFile) ? readFileSync(configFile, "utf8") : null;
    vi.resetModules();
  });

  afterEach(() => {
    if (backup !== null) {
      writeFileSync(configFile, backup, { mode: 0o600 });
    } else if (existsSync(configFile)) {
      rmSync(configFile);
    }
  });

  it("rejects the command when not logged in, without calling the backend", async () => {
    if (existsSync(configFile)) rmSync(configFile);
    const { createZendClient } = await import("pay-with-zend-sdk");
    const { registerPaymentsCommand } = await import("../src/commands/payments.js");

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const program = new Command();
    registerPaymentsCommand(program);

    await program.parseAsync(["node", "zend", "payments", "test"]);

    expect(errorSpy).toHaveBeenCalledWith("Not logged in. Run `zend login` first.");
    expect(createZendClient).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("calls testPaymentRequest with parsed options when logged in", async () => {
    writeFileSync(configFile, JSON.stringify({ apiKey: "zdev_test_key" }), { mode: 0o600 });

    const testPaymentRequest = vi.fn().mockResolvedValue({
      sandbox: true,
      valid: true,
      amountUsdc: 25.5,
      description: "test payment",
      expiresInMinutes: 15,
      redirectUrl: null,
      webhookUrl: null,
    });
    const { createZendClient } = await import("pay-with-zend-sdk");
    (createZendClient as ReturnType<typeof vi.fn>).mockReturnValue({ testPaymentRequest });

    const { registerPaymentsCommand } = await import("../src/commands/payments.js");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = new Command();
    registerPaymentsCommand(program);

    await program.parseAsync([
      "node", "zend", "payments", "test",
      "--amount", "25.50",
      "--description", "test payment",
    ]);

    expect(testPaymentRequest).toHaveBeenCalledWith({
      amountUsdc: 25.5,
      description: "test payment",
      expiresInMinutes: 15,
      redirectUrl: undefined,
      webhookUrl: undefined,
    });
    logSpy.mockRestore();
  });

  it("surfaces a validation failure from the backend as a non-zero exit", async () => {
    writeFileSync(configFile, JSON.stringify({ apiKey: "zdev_test_key" }), { mode: 0o600 });

    const testPaymentRequest = vi.fn().mockRejectedValue(new Error("amount_usdc must be between 0.01 and 100000"));
    const { createZendClient } = await import("pay-with-zend-sdk");
    (createZendClient as ReturnType<typeof vi.fn>).mockReturnValue({ testPaymentRequest });

    const { registerPaymentsCommand } = await import("../src/commands/payments.js");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const program = new Command();
    registerPaymentsCommand(program);

    await program.parseAsync(["node", "zend", "payments", "test", "--amount", "999999"]);

    expect(errorSpy).toHaveBeenCalledWith("Sandbox validation failed:");
    errorSpy.mockRestore();
  });
});
