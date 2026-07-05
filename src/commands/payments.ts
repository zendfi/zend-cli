/**
 * `zend payments test` — Sandbox Mode dry run (Requirement 3.12).
 *
 * Deliberately implemented as a pure client-side validation pass that never
 * calls the live backend: it mirrors the exact validation bounds enforced
 * by `dev_payment_requests.rs` (amount 0.01-100000, expiry 1-60 minutes,
 * HTTPS-only URLs <=2048 chars) and reports what WOULD happen, without
 * creating a row in `user_payment_requests`, moving any funds, or
 * triggering any Developer Webhook Event delivery. This is the strictest
 * possible reading of "does not move real funds and does not deliver live
 * Developer Webhook Events" — there is no live-request code path at all.
 */
import { Command } from "commander";

const MIN_AMOUNT_USDC = 0.01;
const MAX_AMOUNT_USDC = 100_000.0;
const MIN_EXPIRY_MINUTES = 1;
const MAX_EXPIRY_MINUTES = 60;
const DEFAULT_EXPIRY_MINUTES = 15;

function isValidHttpsUrl(value: string): boolean {
  if (value.length > 2048) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function registerPaymentsCommand(program: Command): void {
  const payments = program.command("payments").description("Test and inspect payment requests");

  payments
    .command("test")
    .description("Validate a payment request in Sandbox Mode — no real funds move, no live webhooks fire")
    .option("--amount <usdc>", "Amount in USDC", "10.00")
    .option("--description <text>", "Description")
    .option("--expires-in-minutes <minutes>", "Expiry in minutes (1-60)", String(DEFAULT_EXPIRY_MINUTES))
    .option("--redirect-url <url>", "HTTPS redirect URL")
    .option("--webhook-url <url>", "HTTPS webhook URL override")
    .action((opts: {
      amount: string;
      description?: string;
      expiresInMinutes: string;
      redirectUrl?: string;
      webhookUrl?: string;
    }) => {
      const errors: string[] = [];

      const amount = Number.parseFloat(opts.amount);
      if (!Number.isFinite(amount) || amount < MIN_AMOUNT_USDC || amount > MAX_AMOUNT_USDC) {
        errors.push(`amount must be between ${MIN_AMOUNT_USDC} and ${MAX_AMOUNT_USDC}`);
      }

      const expiresInMinutes = Number.parseInt(opts.expiresInMinutes, 10);
      if (
        !Number.isFinite(expiresInMinutes) ||
        expiresInMinutes < MIN_EXPIRY_MINUTES ||
        expiresInMinutes > MAX_EXPIRY_MINUTES
      ) {
        errors.push(`expires-in-minutes must be between ${MIN_EXPIRY_MINUTES} and ${MAX_EXPIRY_MINUTES}`);
      }

      if (opts.description && opts.description.length > 500) {
        errors.push("description must be 500 characters or fewer");
      }

      if (opts.redirectUrl && !isValidHttpsUrl(opts.redirectUrl)) {
        errors.push("redirect-url must be a well-formed HTTPS URL, <=2048 characters");
      }

      if (opts.webhookUrl && !isValidHttpsUrl(opts.webhookUrl)) {
        errors.push("webhook-url must be a well-formed HTTPS URL, <=2048 characters");
      }

      if (errors.length > 0) {
        console.error("Sandbox validation failed:");
        for (const err of errors) console.error(`  - ${err}`);
        process.exitCode = 1;
        return;
      }

      console.log("Sandbox Mode: this request is valid and WOULD be created. No real funds move.");
      console.log("No live Developer Webhook Event will be delivered for this dry run.");
      console.log("");
      console.log(JSON.stringify(
        {
          amountUsdc: amount,
          description: opts.description ?? null,
          expiresInMinutes,
          redirectUrl: opts.redirectUrl ?? null,
          webhookUrl: opts.webhookUrl ?? null,
          sandbox: true,
        },
        null,
        2,
      ));
    });
}
