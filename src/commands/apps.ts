/**
 * `zend apps ...` — register and deploy ZApps.
 *
 * Auth: the key saved by `zend login`, or ZEND_APP_KEY (zapp_sk_...) for CI,
 * which can only deploy the manifest of its own app.
 */
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { getBaseUrl, getStoredApiKey } from "../config-store.js";

/** Network failures worth one more try: slow DNS or connect, reset. */
const RETRYABLE = new Set(["UND_ERR_CONNECT_TIMEOUT", "EAI_AGAIN", "ECONNRESET", "ETIMEDOUT"]);

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(url, init);
    } catch (e: any) {
      // Node reports every network failure as "fetch failed"; the reason is
      // in e.cause. Without it a slow resolver looked like a dead API.
      const code: string | undefined = e?.cause?.code;
      if (attempt < 3 && code && RETRYABLE.has(code)) continue;
      const host = new URL(url).host;
      console.error(`Couldn't reach ${host}: ${code ?? "network error"}${e?.cause?.message ? ` (${e.cause.message})` : ""}`);
      if (code === "UND_ERR_CONNECT_TIMEOUT" || code === "EAI_AGAIN" || code === "ENOTFOUND") {
        console.error("This is usually slow or failing DNS on this machine. Check `getent hosts " + host + "`.");
      }
      process.exit(1);
    }
  }
}

async function call(method: string, path: string, key: string, body?: unknown): Promise<any> {
  const r = await fetchWithRetry(`${getBaseUrl()}${path}`, {
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

  apps.command("rotate-key <slug>").description("Replace the app API key (and optionally the webhook secret)")
    .option("--webhook-secret", "rotate only the webhook secret")
    .option("--both", "rotate the API key and the webhook secret")
    .action(async (slug: string, opts: { webhookSecret?: boolean; both?: boolean }) => {
      const key = loginKey();
      const which = opts.both ? "both" : opts.webhookSecret ? "webhook_secret" : "api_key";
      const r = await call("POST", `/api/v1/dev/apps/${await appIdForSlug(key, slug)}/rotate`, key, { which });
      console.log("Rotated. The old value stopped working just now.\n");
      if (r.api_key) console.log(`  ZEND_APP_KEY=${r.api_key}`);
      if (r.webhook_secret) console.log(`  ZEND_WEBHOOK_SECRET=${r.webhook_secret}`);
      console.log("\nUpdate your server and CI secrets now.");
    });

  apps.command("review <slug>").description("Show listing review status and findings")
    .action(async (slug: string) => {
      const key = loginKey();
      const r = await call("GET", `/api/v1/dev/apps/${await appIdForSlug(key, slug)}/review`, key);
      console.log(`Status: ${r.status}`);
      for (const rv of r.reviews) {
        console.log(`  v${rv.manifest_version}  ${rv.result}  ${rv.at}`);
        for (const f of rv.findings ?? []) console.log(`    - ${f}`);
      }
      if (r.status === "in_review") console.log("\nAutomated checks run within a minute; a Zend admin then approves the listing.");
    });

  apps.command("resolver-key").description("Generate a resolver key for prizes (keep the seed on your server)")
    .action(async () => {
      const { randomBytes, createPrivateKey, createPublicKey } = await import("node:crypto");
      const seed = randomBytes(32);
      const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
      const pub = (createPublicKey(createPrivateKey({ key: der, format: "der", type: "pkcs8" }))
        .export({ format: "der", type: "spki" }) as Buffer).subarray(-32).toString("hex");
      console.log("Put this in zapp.json:\n  \"resolverKey\": \"" + pub + "\"\n");
      console.log("Keep this secret on your server only:\n  ZEND_RESOLVER_SEED=" + seed.toString("hex"));
    });

  apps.command("testers").description("Manage testers")
    .command("add <slug> <username>")
    .action(async (slug: string, username: string) => {
      const key = loginKey();
      await call("POST", `/api/v1/dev/apps/${await appIdForSlug(key, slug)}/testers`, key, { zendtag: username });
      console.log(`Added @${username.replace(/^@/, "")} to ${slug}.`);
    });
}
