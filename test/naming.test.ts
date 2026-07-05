import { describe, expect, it } from "vitest";
import pkg from "../package.json" assert { type: "json" };
import { Command } from "commander";
import { registerLoginCommand } from "../src/commands/login.js";
import { registerKeysCommand } from "../src/commands/keys.js";
import { registerConfigCommand } from "../src/commands/config.js";
import { registerPaymentsCommand } from "../src/commands/payments.js";
import { registerLogsCommand } from "../src/commands/logs.js";

const FORBIDDEN_SUBSTRINGS = ["create-zendfi-app", "zendfi-toolkit"];

describe("package/command naming does not collide with the legacy merchant CLI (Requirement 7.3)", () => {
  it("package.json name contains none of the forbidden substrings", () => {
    for (const forbidden of FORBIDDEN_SUBSTRINGS) {
      expect(pkg.name).not.toContain(forbidden);
      expect(pkg.name).not.toEqual(forbidden);
    }
  });

  it("bin executable name contains none of the forbidden substrings", () => {
    const binNames = Object.keys(pkg.bin ?? {});
    expect(binNames.length).toBeGreaterThan(0);
    for (const name of binNames) {
      for (const forbidden of FORBIDDEN_SUBSTRINGS) {
        expect(name).not.toContain(forbidden);
        expect(name).not.toEqual(forbidden);
      }
    }
  });

  it("no top-level subcommand name equals or contains a forbidden substring", () => {
    const program = new Command();
    registerLoginCommand(program);
    registerKeysCommand(program);
    registerConfigCommand(program);
    registerPaymentsCommand(program);
    registerLogsCommand(program);

    const subcommandNames = program.commands.map((c) => c.name());
    expect(subcommandNames.length).toBeGreaterThan(0);
    for (const name of subcommandNames) {
      for (const forbidden of FORBIDDEN_SUBSTRINGS) {
        expect(name).not.toContain(forbidden);
        expect(name).not.toEqual(forbidden);
      }
    }
  });
});
