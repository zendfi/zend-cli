/**
 * `zend apps ...` — register and deploy ZApps.
 *
 * Auth: the key saved by `zend login`, or ZEND_APP_KEY (zapp_sk_...) for CI,
 * which can only deploy the manifest of its own app.
 */
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { getBaseUrl, getStoredApiKey } from "../config-store.js";

async function call(method: string, path: string, key: string, body?: unknown): Promise<any> {
  const r = await fetch(`${getBaseUrl()}${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error(`${json.error ?? `HTTP ${r.status}`}: ${json.message ?? ""}`);
    for (const e of json.errors ?? []) console.error(`  - ${e}`);
    process.exit(1);
  }
  return json;
}

function loginKey(): string {
  const k = getStoredApiKey();
  if (!k) {
    console.error("Not logged in. Run `zend login` first.");
    process.exit(1);
  }
  return k;
}

async function appIdForSlug(key: string, slug: string): Promise<string> {
  const { apps } = await call("GET", "/api/v1/dev/apps", key);
  const app = apps.find((a: any) => a.slug === slug);
  if (!app) {
    console.error(`No app "${slug}" on your account. Create it with \`zend apps create ${slug} "<Name>"\`.`);
    process.exit(1);
  }
  return app.id;
}

export function registerAppsCommand(program: Command): void {
  const apps = program.command("apps").description("Register and deploy ZApps");

  apps.command("create <slug> <name>").description("Create a private ZApp")
    .action(async (slug: string, name: string) => {
      const r = await call("POST", "/api/v1/dev/apps", loginKey(), { slug, name });
      console.log(`Created ${r.slug} (${r.id}).\n`);
      console.log("Save these now, they won't be shown again:");
      console.log(`  ZEND_APP_KEY=${r.api_key}`);
      console.log(`  ZEND_WEBHOOK_SECRET=${r.webhook_secret}\n`);
      console.log(`Next: zend apps deploy zapp.json`);
    });

  apps.command("list").description("List your ZApps")
    .action(async () => {
      const { apps: list } = await call("GET", "/api/v1/dev/apps", loginKey());
      if (!list.length) return console.log("No apps yet.");
      for (const a of list) console.log(`${a.slug.padEnd(24)} ${a.status.padEnd(10)} ${a.visibility.padEnd(8)} v${a.manifest_version ?? "-"}`);
    });

  apps.command("deploy [manifest]").description("Upload a manifest (default ./zapp.json)")
    .action(async (file = "zapp.json") => {
      const manifest = JSON.parse(readFileSync(file, "utf8"));
      const appKey = process.env.ZEND_APP_KEY;
      const r = appKey
        ? await call("PUT", "/api/zend/v2/apps/server/manifest", appKey, manifest)
        : await call("PUT", `/api/v1/dev/apps/${await appIdForSlug(loginKey(), manifest.app)}/manifest`, loginKey(), manifest);
      console.log(`Deployed ${manifest.app} v${r.manifest_version} (${r.status}).`);
      console.log(`Open it: https://app.usezend.app/apps/${manifest.app}`);
    });

  apps.command("testers").description("Manage testers")
    .command("add <slug> <username>")
    .action(async (slug: string, username: string) => {
      const key = loginKey();
      await call("POST", `/api/v1/dev/apps/${await appIdForSlug(key, slug)}/testers`, key, { zendtag: username });
      console.log(`Added @${username.replace(/^@/, "")} to ${slug}.`);
    });
}
