/**
 * `zend keys create|list|revoke` — operates only on User API Keys belonging
 * to the authenticated CLI session's paired user (Requirement 2.9).
 */
import { Command } from "commander";
import { createZendClient } from "pay-with-zend-sdk";
import { getBaseUrl, getStoredApiKey } from "../config-store.js";

const VALID_SCOPES = new Set(["create_payment_request", "read", "manage_webhook"]);

function requireAuthenticatedClient() {
  const apiKey = getStoredApiKey();
  if (!apiKey) {
    console.error("Not logged in. Run `zend login` first.");
    process.exitCode = 1;
    return null;
  }
  return createZendClient({ apiKey, baseUrl: getBaseUrl() });
}

export function registerKeysCommand(program: Command): void {
  const keys = program.command("keys").description("Manage your Pay with Zend API keys");

  keys
    .command("create")
    .description("Create a new API key")
    .option("--scopes <scopes>", "Comma-separated scopes (create_payment_request,read,manage_webhook)", "create_payment_request,read")
    .action(async (opts: { scopes: string }) => {
      const client = requireAuthenticatedClient();
      if (!client) return;

      const scopes = opts.scopes.split(",").map((s) => s.trim());
      for (const scope of scopes) {
        if (!VALID_SCOPES.has(scope)) {
          console.error(`Unknown scope: ${scope}`);
          process.exitCode = 1;
          return;
        }
      }

      const result = await client.createApiKey({
        scopes: scopes as Array<"create_payment_request" | "read" | "manage_webhook">,
      });
      console.log("New API key created (shown once — store it securely):");
      console.log("");
      console.log(`  ${result.apiKey}`);
      console.log("");
      console.log(`Scopes: ${result.scopes.join(", ")}`);
    });

  keys
    .command("list")
    .description("List your API keys")
    .action(async () => {
      const client = requireAuthenticatedClient();
      if (!client) return;

      const list = await client.listApiKeys();
      if (list.length === 0) {
        console.log("No API keys found.");
        return;
      }
      for (const key of list) {
        console.log(`${key.id}  ${key.displayPrefix}  [${key.scopes.join(", ")}]  created ${key.createdAt}`);
      }
    });

  keys
    .command("revoke <id>")
    .description("Revoke an API key by id")
    .action(async (id: string) => {
      const client = requireAuthenticatedClient();
      if (!client) return;

      await client.revokeApiKey(id);
      console.log(`Revoked key ${id}.`);
    });
}
