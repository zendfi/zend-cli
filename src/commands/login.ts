/**
 * `zend login` — CLI Pairing flow ONLY (Requirement 7.4). There is no flag,
 * option, or prompt that accepts a typed API key or other secret as an
 * alternative login method anywhere in this file.
 */
import { Command } from "commander";
import qrcodeTerminal from "qrcode-terminal";
import { createZendClient } from "pay-with-zend-sdk";
import { getBaseUrl, writeConfig } from "../config-store.js";
import { pollUntilTerminal, retrieveKeyWithRetry } from "../pairing.js";
import { hostname } from "node:os";

export function registerLoginCommand(program: Command): void {
  program
    .command("login")
    .description("Pair this CLI with your Zend account by approving it in the Zend App")
    .action(async () => {
      const client = createZendClient({ apiKey: "", baseUrl: getBaseUrl() });

      const session = await client.createPairingSession({
        cliDisplayName: `zend-cli on ${hostname()}`,
      });

      console.log("");
      console.log("Approve this login in the Zend App:");
      console.log("");
      console.log(`  ${session.approvalUrl}`);
      console.log("");
      qrcodeTerminal.generate(session.approvalUrl, { small: true }, (qr: string) => {
        console.log(qr);
      });
      console.log(`Waiting for approval (expires at ${session.expiresAt})...`);

      const result = await pollUntilTerminal(client, session.sessionId, {
        onTick: () => process.stdout.write("."),
      });
      console.log("");

      if (result.status === "denied") {
        console.error("Login was denied in the Zend App.");
        process.exitCode = 1;
        return;
      }
      if (result.status === "expired") {
        console.error("Pairing session expired before it was approved. Run `zend login` again.");
        process.exitCode = 1;
        return;
      }

      const apiKey = await retrieveKeyWithRetry(client, session.sessionId);
      writeConfig({ apiKey });

      console.log("Logged in! Your API key has been saved to ~/.zend/config.json.");
    });
}
