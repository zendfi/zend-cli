/**
 * `zend device`: pair and try out ESP32, Arduino and Raspberry Pi boards that take payments.
 *
 * A device holds no money. It asks Zend for a payment request in its owner's name, shows it as a
 * QR, and hears when it's paid. `pair` saves the device's key and signing secret to
 * `~/.zend/devices/<name>.json` (mode 0600), ready to flash onto a board or copy to a Pi.
 */
import { Command } from "commander";
import qrcodeTerminal from "qrcode-terminal";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getBaseUrl } from "../config-store.js";

interface StoredDevice {
  name: string;
  slug: string;
  deviceId: string;
  deviceKey: string;
  signingSecret: string;
  hardware?: string;
  createdAt: string;
}

const dir = () => join(homedir(), ".zend", "devices");
const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "device";
const pathOf = (slug: string) => join(dir(), `${slug}.json`);

function save(d: StoredDevice): void {
  if (!existsSync(dir())) mkdirSync(dir(), { recursive: true, mode: 0o700 });
  writeFileSync(pathOf(d.slug), JSON.stringify(d, null, 2), { mode: 0o600 });
}
function load(name: string): StoredDevice {
  const p = pathOf(slugOf(name));
  if (!existsSync(p)) throw new Error(`No device called "${name}" on this machine. Run \`zend device list\`.`);
  return JSON.parse(readFileSync(p, "utf8")) as StoredDevice;
}

async function call(path: string, init: RequestInit & { key?: string } = {}): Promise<any> {
  const { key, ...rest } = init;
  const res = await fetch(`${getBaseUrl()}${path}`, {
    ...rest,
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}), ...(rest.headers ?? {}) },
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? `Request failed (${res.status})`);
  return body;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The check every board library does: HMAC-SHA256(secret, `signed`) == `sig`, and the last field
 *  of `signed` is sha256(`data_raw`). */
export function verifyDeviceEvent(secret: string, signed: string, sig: string, dataRaw: string): boolean {
  const want = createHmac("sha256", secret).update(signed).digest();
  const got = Buffer.from(sig, "hex");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return false;
  return signed.slice(signed.lastIndexOf("|") + 1) === createHash("sha256").update(dataRaw).digest("hex");
}

export function registerDeviceCommand(program: Command): void {
  const device = program.command("device").description("Pair and test devices (ESP32, Arduino, Raspberry Pi) that take payments");

  device
    .command("pair <name>")
    .description("Add a device. You approve it in the Zend App; payments it asks for go to you.")
    .option("--hardware <kind>", "shown on the approval screen, e.g. esp32, rpi4, uno-r4", "")
    .action(async (name: string, opts: { hardware: string }) => {
      const slug = slugOf(name);
      if (existsSync(pathOf(slug))) throw new Error(`"${name}" is already paired on this machine (${pathOf(slug)}).`);
      const s = await call("/api/v1/devices/sessions", {
        method: "POST",
        body: JSON.stringify({ name, hardware: opts.hardware || undefined }),
      });
      console.log("\nAdd this device in the Zend App: scan the code, or go to Settings → Devices → Add");
      console.log(`and type  ${s.short_code}\n`);
      qrcodeTerminal.generate(s.approval_url, { small: true }, (qr: string) => console.log(qr));
      console.log(`Waiting for approval (expires ${s.expires_at})...`);
      for (;;) {
        await sleep(2000);
        const { status } = await call(`/api/v1/devices/sessions/${s.session_id}`);
        if (status === "pending") {
          process.stdout.write(".");
          continue;
        }
        console.log("");
        if (status !== "approved") {
          console.error(status === "denied" ? "The device was not added." : "The request expired. Run the command again.");
          process.exitCode = 1;
          return;
        }
        break;
      }
      const k = await call(`/api/v1/devices/sessions/${s.session_id}/key`, { method: "POST" });
      save({
        name, slug, deviceId: k.device_id, deviceKey: k.device_key, signingSecret: k.signing_secret,
        hardware: opts.hardware || undefined, createdAt: new Date().toISOString(),
      });
      console.log(`"${name}" is ready. Its key and signing secret are in ${pathOf(slug)}.`);
      console.log("Copy them to the board (ZEND_DEVICE_KEY, ZEND_DEVICE_SECRET). Never commit them.");
    });

  device
    .command("list")
    .description("Devices paired from this machine")
    .action(() => {
      if (!existsSync(dir())) return console.log("No devices on this machine yet. Run `zend device pair <name>`.");
      for (const f of readdirSync(dir()).filter((f) => f.endsWith(".json"))) {
        const d = JSON.parse(readFileSync(join(dir(), f), "utf8")) as StoredDevice;
        console.log(`${d.name}  ${d.deviceKey.slice(0, 16)}...  ${d.hardware ?? ""}`);
      }
    });

  device
    .command("me <name>")
    .description("Check the device can sign in, and show its limits")
    .action(async (name: string) => {
      console.log(JSON.stringify(await call("/api/v1/device/me", { key: load(name).deviceKey }), null, 2));
    });

  device
    .command("request <name> <amountNgn>")
    .description("Ask for a payment as the device and show its QR (what a board would display)")
    .option("--ref <reference>", "your reference, comes back on the payment event")
    .option("--note <text>", "what the payer sees after the device's name")
    .action(async (name: string, amount: string, opts: { ref?: string; note?: string }) => {
      const d = load(name);
      const r = await call("/api/v1/device/requests", {
        method: "POST",
        key: d.deviceKey,
        body: JSON.stringify({ amount_ngn: Number(amount), reference: opts.ref, note: opts.note }),
      });
      console.log(`\n${r.amount_label} · ${r.id} · expires ${r.expires_at}\n  ${r.url}\n`);
      qrcodeTerminal.generate(r.url, { small: true }, (qr: string) => console.log(qr));
      console.log("Pay it from the Zend App. Run `zend device events` in another terminal to watch.");
    });

  device
    .command("events <name>")
    .description("Show the device's events and check each signature")
    .option("--follow", "keep listening (long poll), like a board does")
    .option("--after <seq>", "start after this sequence number", "0")
    .action(async (name: string, opts: { follow?: boolean; after: string }) => {
      const d = load(name);
      let after = Number(opts.after);
      do {
        const r = await call(`/api/v1/device/events?after=${after}&wait=${opts.follow ? 25 : 0}`, { key: d.deviceKey });
        for (const e of r.events) {
          const ok = verifyDeviceEvent(d.signingSecret, e.signed, e.sig, e.data_raw ?? "");
          console.log(`${e.seq}  ${e.type}  ${e.data_raw}  ${ok ? "signature ok" : "BAD SIGNATURE"}`);
        }
        after = r.next;
      } while (opts.follow);
    });

  device
    .command("test <name>")
    .description("Send the device a test event")
    .action(async (name: string) => {
      await call("/api/v1/device/test", { method: "POST", key: load(name).deviceKey });
      console.log("Sent. It shows up in `zend device events` with type \"test\".");
    });

  device
    .command("config <name>")
    .description("Show the settings the device gets from its owner")
    .action(async (name: string) => {
      console.log(JSON.stringify(await call("/api/v1/device/config", { key: load(name).deviceKey }), null, 2));
    });

  device
    .command("checkin <name>")
    .description("Make a check-in code as the device and show its QR; scan it with Zend")
    .option("--ref <reference>", "your reference")
    .option("--note <text>", "shown to the person")
    .action(async (name: string, opts: { ref?: string; note?: string }) => {
      const r = await call("/api/v1/device/checkins", {
        method: "POST", key: load(name).deviceKey, body: JSON.stringify({ reference: opts.ref, note: opts.note }),
      });
      console.log(`\n${r.url}\n`);
      qrcodeTerminal.generate(r.url, { small: true }, (qr: string) => console.log(qr));
    });

  device
    .command("reading <name> <label> [value]")
    .description("Send a reading as the device and print Zend's signed receipt")
    .option("--unit <unit>")
    .option("--ref <reference>")
    .action(async (name: string, label: string, value: string | undefined, opts: { unit?: string; ref?: string }) => {
      const r = await call("/api/v1/device/readings", {
        method: "POST", key: load(name).deviceKey,
        body: JSON.stringify({ label, value: value === undefined ? undefined : Number(value), unit: opts.unit, reference: opts.ref }),
      });
      console.log(JSON.stringify(r, null, 2));
    });

  device
    .command("alert <name> <message...>")
    .description("Send the owner a notification as the device")
    .action(async (name: string, message: string[]) => {
      await call("/api/v1/device/alerts", { method: "POST", key: load(name).deviceKey, body: JSON.stringify({ message: message.join(" ") }) });
      console.log("Sent.");
    });

  device
    .command("ack <name> <commandId>")
    .description("Answer a command as the device")
    .option("--fail <message>", "say it couldn't run")
    .action(async (name: string, id: string, opts: { fail?: string }) => {
      await call(`/api/v1/device/commands/${id}/ack`, {
        method: "POST", key: load(name).deviceKey, body: JSON.stringify({ ok: !opts.fail, message: opts.fail }),
      });
      console.log("Done.");
    });
}
