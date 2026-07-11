/**
 * Local config storage for zend-cli, at `~/.zend/config.json`.
 *
 * The file is written with mode `0600` (owner read/write only) since it may
 * contain a plaintext User API Key.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface ZendCliConfig {
  apiKey?: string;
  webhookUrl?: string;
  baseUrl?: string;
}

function configPath(): string {
  return join(homedir(), ".zend", "config.json");
}

/** Reads the local config file. Returns `{}` if it doesn't exist yet. */
export function readConfig(): ZendCliConfig {
  const path = configPath();
  if (!existsSync(path)) {
    return {};
  }
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as ZendCliConfig;
  } catch {
    return {};
  }
}

/**
 * Merges `patch` into the existing config and writes it back with `0600`
 * permissions.
 */
export function writeConfig(patch: Partial<ZendCliConfig>): ZendCliConfig {
  const path = configPath();
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const merged: ZendCliConfig = { ...readConfig(), ...patch };
  writeFileSync(path, JSON.stringify(merged, null, 2), { mode: 0o600 });
  return merged;
}

/** Returns the stored API key, or `undefined` if the CLI has not logged in. */
export function getStoredApiKey(): string | undefined {
  return readConfig().apiKey;
}

/**
 * Returns the configured backend API base URL, defaulting to
 * `https://api-v2.zendfi.tech`. `zdfi.me` is the human-facing web
 * app/link domain only — it has no API routes, so it must never be used
 * here.
 */
export function getBaseUrl(): string {
  return readConfig().baseUrl ?? "https://api-v2.zendfi.tech";
}
