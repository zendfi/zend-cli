/**
 * `zend config set webhookUrl <url>` / `zend config get webhookUrl`.
 */
import { Command } from "commander";
import { createZendClient } from "pay-with-zend-sdk";
import { getBaseUrl, getStoredApiKey, writeConfig, readConfig } from "../config-store.js";

function requireAuthenticatedClient() {
  const apiKey = getStoredApiKey();
  if (!apiKey) {
    console.error("Not logged in. Run `zend login` first.");
    process.exitCode = 1;
    return null;
  }
  return createZendClient({ apiKey, baseUrl: getBaseUrl() });
}

export function registerConfigCommand(program: Command): void {
  const config = program.command("config").description("Configure your Pay with Zend account");

  config
    .command("set <key> <value>")
    .description("Set a config value (currently only webhookUrl is supported)")
    .action(async (key: string, value: string) => {
      if (key !== "webhookUrl") {
        console.error(`Unknown config key: ${key}. Supported keys: webhookUrl`);
        process.exitCode = 1;
        return;
      }
      const client = requireAuthenticatedClient();
      if (!client) return;

      await client.setWebhookUrl(value);
      writeConfig({ webhookUrl: value });
      console.log(`webhookUrl set to ${value}`);
    });

  config
    .command("get <key>")
    .description("Get a config value")
    .action((key: string) => {
      if (key !== "webhookUrl") {
        console.error(`Unknown config key: ${key}. Supported keys: webhookUrl`);
        process.exitCode = 1;
        return;
      }
      const value = readConfig().webhookUrl;
      console.log(value ?? "(not set)");
    });
}
