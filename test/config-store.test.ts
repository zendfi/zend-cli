import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { existsSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readConfig, writeConfig, getStoredApiKey, getBaseUrl } from "../src/config-store.js";

const configDir = join(homedir(), ".zend");
const configFile = join(configDir, "config.json");

describe("config-store", () => {
  let backup: string | null = null;

  beforeEach(() => {
    if (existsSync(configFile)) {
      backup = require("node:fs").readFileSync(configFile, "utf8");
    }
  });

  afterEach(() => {
    if (backup !== null) {
      require("node:fs").writeFileSync(configFile, backup, { mode: 0o600 });
      backup = null;
    } else if (existsSync(configFile)) {
      rmSync(configFile);
    }
  });

  it("round-trips values written to the config file", () => {
    writeConfig({ apiKey: "zdev_test_abc123" });
    const config = readConfig();
    expect(config.apiKey).toBe("zdev_test_abc123");
  });

  it("merges patches rather than overwriting the whole file", () => {
    writeConfig({ apiKey: "zdev_test_abc123" });
    writeConfig({ webhookUrl: "https://example.com/webhook" });
    const config = readConfig();
    expect(config.apiKey).toBe("zdev_test_abc123");
    expect(config.webhookUrl).toBe("https://example.com/webhook");
  });

  it("writes the config file with 0600 permissions", () => {
    writeConfig({ apiKey: "zdev_test_abc123" });
    const stats = statSync(configFile);
    // Mask to the permission bits only (mode includes file-type bits too).
    const mode = stats.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("getStoredApiKey returns undefined when nothing is stored", () => {
    if (existsSync(configFile)) rmSync(configFile);
    expect(getStoredApiKey()).toBeUndefined();
  });

  it("getBaseUrl defaults to https://api-v2.zendfi.tech", () => {
    if (existsSync(configFile)) rmSync(configFile);
    expect(getBaseUrl()).toBe("https://api-v2.zendfi.tech");
  });
});
