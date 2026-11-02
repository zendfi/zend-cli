#!/usr/bin/env node
/**
 * zend-cli — CLI for "Pay with Zend".
 *
 * Deliberately named and structured with no similarity to the legacy
 * merchant-facing `create-zendfi-app` CLI (Requirement 7.3).
 */
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { registerLoginCommand } from "./commands/login.js";
import { registerKeysCommand } from "./commands/keys.js";
import { registerConfigCommand } from "./commands/config.js";
import { registerPaymentsCommand } from "./commands/payments.js";
import { registerLogsCommand } from "./commands/logs.js";
import { registerAppsCommand } from "./commands/apps.js";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
) as { version: string };

const program = new Command();

program
  .name("zend")
  .description("Pay with Zend — pair your account, manage keys, and create payment requests from the command line")
  .version(pkg.version);

registerLoginCommand(program);
registerKeysCommand(program);
registerConfigCommand(program);
registerPaymentsCommand(program);
registerLogsCommand(program);
registerAppsCommand(program);

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
