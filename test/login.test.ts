import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { registerLoginCommand } from "../src/commands/login.js";

describe("zend login has no typed-credential alternative (Requirement 7.4)", () => {
  it("defines no option accepting an API key or secret", () => {
    const program = new Command();
    registerLoginCommand(program);
    const loginCommand = program.commands.find((c) => c.name() === "login");
    expect(loginCommand).toBeDefined();

    const optionFlags = (loginCommand?.options ?? []).map((o) => o.flags.toLowerCase());
    const forbiddenPatterns = ["api-key", "apikey", "secret", "token", "password"];
    for (const flag of optionFlags) {
      for (const pattern of forbiddenPatterns) {
        expect(flag).not.toContain(pattern);
      }
    }
  });

  it("login command takes no positional arguments (no room for a typed secret)", () => {
    const program = new Command();
    registerLoginCommand(program);
    const loginCommand = program.commands.find((c) => c.name() === "login");
    expect(loginCommand?.registeredArguments?.length ?? 0).toBe(0);
  });
});
