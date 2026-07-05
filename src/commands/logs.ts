/**
 * `zend logs tail` — displays up to the 50 most recent Developer Webhook
 * Event deliveries (Requirement 6.15).
 */
import { Command } from "commander";
import { createZendClient } from "pay-with-zend-sdk";
import { getBaseUrl, getStoredApiKey } from "../config-store.js";

export function registerLogsCommand(program: Command): void {
  const logs = program.command("logs").description("View Developer Webhook Event delivery logs");

  logs
    .command("tail")
    .description("Show recent webhook delivery attempts")
    .option("--limit <n>", "Number of entries to show (max 50)", "50")
    .action(async (opts: { limit: string }) => {
      const apiKey = getStoredApiKey();
      if (!apiKey) {
        console.error("Not logged in. Run `zend login` first.");
        process.exitCode = 1;
        return;
      }
      const client = createZendClient({ apiKey, baseUrl: getBaseUrl() });

      const limit = Math.min(50, Math.max(1, Number.parseInt(opts.limit, 10) || 50));
      const deliveries = await client.listWebhookDeliveries(limit);

      if (deliveries.length === 0) {
        console.log("No webhook deliveries yet.");
        return;
      }

      for (const d of deliveries) {
        const code = d.responseCode !== null ? d.responseCode : "-";
        console.log(`${d.createdAt}  ${d.eventType.padEnd(28)}  ${d.status.padEnd(10)}  ${code}  attempts=${d.attempts}  ${d.webhookUrl}`);
      }
    });
}
