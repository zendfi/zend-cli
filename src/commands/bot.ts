/**
 * `zend bot` — create and use automated accounts.
 *
 * The bot's signing key is made here and stays here (`~/.zend/bots/<handle>.json`, mode 0600).
 * Only its address is sent to Zend. The owner approves the new bot in the Zend App.
 */
import { Command } from "commander";
import qrcodeTerminal from "qrcode-terminal";
import { blake2b } from "@noble/hashes/blake2b";
import { bytesToHex } from "@noble/hashes/utils";
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getBaseUrl } from "../config-store.js";

interface StoredBot {
  handle: string;
  name: string;
  address: string;
  /** PKCS#8 DER, base64. The bot's private signing key. Never leaves this machine. */
  privateKey: string;
  apiKey?: string;
  createdAt: string;
}

const SCOPES = ["read", "dm_send", "post_card", "send_money", "receive_money"];

function botsDir(): string {
  return join(homedir(), ".zend", "bots");
}

function botPath(handle: string): string {
  return join(botsDir(), `${handle}.json`);
}

function saveBot(bot: StoredBot): void {
  if (!existsSync(botsDir())) mkdirSync(botsDir(), { recursive: true, mode: 0o700 });
  writeFileSync(botPath(bot.handle), JSON.stringify(bot, null, 2), { mode: 0o600 });
}

function loadBot(handle: string): StoredBot {
  const path = botPath(handle.replace(/^@/, "").toLowerCase());
  if (!existsSync(path)) throw new Error(`No bot called @${handle} on this machine.`);
  return JSON.parse(readFileSync(path, "utf8")) as StoredBot;
}

/** A Sui address is blake2b-256 of the key scheme byte (0x00 for ed25519) and the public key. */
function newKeypair(): { address: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawPublic = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const input = new Uint8Array(33);
  input[0] = 0x00;
  input.set(rawPublic, 1);
  return {
    address: "0x" + bytesToHex(blake2b(input, { dkLen: 32 })),
    privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
  };
}


/**
 * Signs transaction bytes the way the network expects: ed25519 over blake2b-256 of the intent
 * prefix (0,0,0) and the bytes. The result is a flag byte, the signature and the public key.
 */
function signTransaction(bot: StoredBot, txBase64: string): string {
  const tx = Buffer.from(txBase64, "base64");
  const message = new Uint8Array(3 + tx.length);
  message.set(tx, 3);
  const digest = blake2b(message, { dkLen: 32 });
  const key = createPrivateKey({ key: Buffer.from(bot.privateKey, "base64"), format: "der", type: "pkcs8" });
  const signature = sign(null, Buffer.from(digest), key);
  const publicKey = createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32);
  return Buffer.concat([Buffer.from([0x00]), signature, publicKey]).toString("base64");
}

async function call(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? `Request failed (${res.status})`);
  return body;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function registerBotCommand(program: Command): void {
  const bot = program.command("bot").description("Create and use automated accounts");

  bot
    .command("create <name>")
    .description("Create a bot. You approve it in the Zend App; you need to be a verified person.")
    .requiredOption("--handle <handle>", "the bot's @handle")
    .option("--scopes <list>", `what the key may do (${SCOPES.join(", ")})`, "read")
    .action(async (name: string, opts: { handle: string; scopes: string }) => {
      const handle = opts.handle.replace(/^@/, "").toLowerCase();
      const scopes = opts.scopes.split(",").map((s) => s.trim()).filter(Boolean);
      if (existsSync(botPath(handle))) throw new Error(`@${handle} already exists on this machine.`);
      const { address, privateKey } = newKeypair();
      const session = await call("/api/v1/bots/sessions", {
        method: "POST",
        body: JSON.stringify({ bot_name: name, handle, address, scopes }),
      });
      // Keep the key now: if anything below fails, the bot's address is still recoverable.
      saveBot({ handle, name, address, privateKey, createdAt: new Date().toISOString() });
      console.log("\nApprove this bot in the Zend App:\n");
      console.log(`  ${session.approval_url}\n`);
      qrcodeTerminal.generate(session.approval_url, { small: true }, (qr: string) => console.log(qr));
      console.log(`Waiting for approval (expires ${session.expires_at})...`);
      for (;;) {
        await sleep(2000);
        const { status } = await call(`/api/v1/bots/sessions/${session.session_id}`);
        if (status === "pending") {
          process.stdout.write(".");
          continue;
        }
        console.log("");
        if (status !== "approved") {
          console.error(status === "denied" ? "The bot was not approved." : "The request expired. Run the command again.");
          process.exitCode = 1;
          return;
        }
        break;
      }
      const { api_key } = await call(`/api/v1/bots/sessions/${session.session_id}/key`, { method: "POST" });
      saveBot({ ...loadBot(handle), apiKey: api_key });
      console.log(`@${handle} is ready. Its key is saved in ${botPath(handle)}.`);
    });

  bot
    .command("list")
    .description("Bots on this machine")
    .action(() => {
      if (!existsSync(botsDir())) return console.log("No bots here yet.");
      for (const f of readdirSync(botsDir()).filter((x) => x.endsWith(".json"))) {
        const b = JSON.parse(readFileSync(join(botsDir(), f), "utf8")) as StoredBot;
        console.log(`@${b.handle}  ${b.name}  ${b.apiKey ? "ready" : "waiting for approval"}`);
      }
    });

  bot
    .command("me <handle>")
    .description("Check the bot can sign in, and show its limits")
    .action(async (handle: string) => {
      const b = loadBot(handle);
      if (!b.apiKey) throw new Error("This bot has no key yet. It may not have been approved.");
      console.log(JSON.stringify(await call("/api/v1/bot/me", { headers: { authorization: `Bearer ${b.apiKey}` } }), null, 2));
    });

  const authed = (handle: string) => {
    const b = loadBot(handle);
    if (!b.apiKey) throw new Error("This bot has no key yet. It may not have been approved.");
    return { headers: { authorization: `Bearer ${b.apiKey}` } };
  };

  bot
    .command("balance <handle>")
    .description("The bot's balance")
    .action(async (handle: string) => {
      console.log(JSON.stringify(await call("/api/v1/bot/balance", authed(handle)), null, 2));
    });

  bot
    .command("chats <handle>")
    .description("The bot's conversations")
    .action(async (handle: string) => {
      console.log(JSON.stringify(await call("/api/v1/bot/dm", authed(handle)), null, 2));
    });

  bot
    .command("say <handle> <to> <text...>")
    .description("Send a message as the bot to @someone (they must have written first unless first contact is on)")
    .action(async (handle: string, to: string, text: string[]) => {
      const a = authed(handle);
      const chat = await call(`/api/v1/bot/dm/with/${encodeURIComponent(to.replace(/^@/, ""))}`, { method: "POST", ...a });
      const sent = await call(`/api/v1/bot/dm/${encodeURIComponent(chat.room_id)}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: text.join(" ") }),
        ...a,
      });
      console.log(`Sent (${sent.id}).`);
    });

  bot
    .command("pay <handle> <to> <amount>")
    .description("Pay @someone from the bot, within the limits its owner set")
    .option("--note <text>", "a short note")
    .action(async (handle: string, to: string, amount: string, opts: { note?: string }) => {
      const b = loadBot(handle);
      const a = authed(handle);
      const prep = await call("/api/v1/bot/pay/prepare", {
        method: "POST",
        body: JSON.stringify({ to: to.replace(/^@/, ""), amount: Number(amount) }),
        ...a,
      });
      const result = await call("/api/v1/bot/pay/submit", {
        method: "POST",
        body: JSON.stringify({
          transaction_data_bcs: prep.transaction_data_bcs,
          signature: signTransaction(b, prep.transaction_data_bcs),
          note: opts.note,
        }),
        ...a,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  bot
    .command("deposit <handle>")
    .description("Move funds the bot received into its spendable balance")
    .action(async (handle: string) => {
      const b = loadBot(handle);
      const a = authed(handle);
      const prep = await call("/api/v1/bot/pay/deposit/prepare", { method: "POST", ...a });
      const result = await call("/api/v1/bot/pay/deposit/submit", {
        method: "POST",
        body: JSON.stringify({
          transaction_data_bcs: prep.transaction_data_bcs,
          signature: signTransaction(b, prep.transaction_data_bcs),
        }),
        ...a,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  bot
    .command("post <handle> <text...>")
    .description("Post to the feed as the bot. Only people who have chatted with or paid it see it.")
    .action(async (handle: string, text: string[]) => {
      const out = await call("/api/v1/bot/posts", {
        method: "POST",
        body: JSON.stringify({ text: text.join(" ") }),
        ...authed(handle),
      });
      console.log(`Posted (${out.id}).`);
    });
}
