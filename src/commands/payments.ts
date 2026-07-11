/**
 * `zend payments test` — Sandbox Mode dry run (Requirement 3.12).
 *
 * Calls the backend's `/api/v1/dev/payment-requests/test` endpoint, which
 * runs the exact same validation the live `createZendPayment()` call runs,
 * but never creates a payment request, moves funds, or delivers a live
 * Developer Webhook Event. Requires the CLI to be logged in, since the
 * dry-run is scoped to the authenticated Developer's own account (same
 * scope requirement as the live endpoint) rather than being a generic,
 * unauthenticated client-side linter.
 */
import { Command } from "commander";
import { createZendClient } from "pay-with-zend-sdk";
import { getBaseUrl, getStoredApiKey } from "../config-store.js";

export function registerPaymentsCommand(program: Command): void {
  const payments = program.command("payments").description("Test and inspect payment requests");

  payments
    .command("test")
    .description("Validate a payment request in Sandbox Mode — no real funds move, no live webhooks fire")
    .option("--amount <amount>", "Amount in USD", "10.00")
    .option("--description <text>", "Description")
    .option("--expires-in-minutes <minutes>", "Expiry in minutes (1-60)", "15")
    .option("--redirect-url <url>", "HTTPS redirect URL")
    .option("--webhook-url <url>", "HTTPS webhook URL override")
    .action(async (opts: {
      amount: string;
      description?: string;
      expiresInMinutes: string;
      redirectUrl?: string;
      webhookUrl?: string;
    }) => {
      const apiKey = getStoredApiKey();
      if (!apiKey) {
        console.error("Not logged in. Run `zend login` first.");
        process.exitCode = 1;
        return;
      }

      const amount = Number.parseFloat(opts.amount);
      const expiresInMinutes = Number.parseInt(opts.expiresInMinutes, 10);
      if (!Number.isFinite(amount) || !Number.isFinite(expiresInMinutes)) {
        console.error("--amount and --expires-in-minutes must be numbers.");
        process.exitCode = 1;
        return;
      }

      const client = createZendClient({ apiKey, baseUrl: getBaseUrl() });

      try {
        const result = await client.testPaymentRequest({
          amount,
          description: opts.description,
          expiresInMinutes,
          redirectUrl: opts.redirectUrl,
          webhookUrl: opts.webhookUrl,
        });

        console.log("Sandbox Mode: this request is valid and WOULD be created. No real funds move.");
        console.log("No live Developer Webhook Event will be delivered for this dry run.");
        console.log("");
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        console.error("Sandbox validation failed:");
        console.error(`  ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
    });
}
