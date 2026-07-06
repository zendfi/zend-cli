# pay-with-zend-cli

The command-line tool for **Pay with Zend**. Pair your own Zend account, manage API keys, configure webhooks, and test payment requests — all from your terminal.

There's no separate "developer" account here — you're just using your existing Zend account programmatically. Anything you create through this CLI settles to your own wallet, the same one the Zend App uses.

> Building an integration in code instead? See [`pay-with-zend-sdk`](../zend-sdk/README.md) — this CLI is a thin wrapper around it.

## Installation

```bash
npm install -g pay-with-zend-cli
```

Or run it without installing:

```bash
npx pay-with-zend-cli login
```

Requires Node.js 18 or later. The installed binary is `zend`.

## Getting started

```bash
zend login
```

This is the **only** way to authenticate — there is no flag or prompt anywhere in this CLI that accepts a typed API key or secret as an alternative. Here's what happens:

1. The CLI creates a pairing session and prints an approval link, plus a QR code for scanning on your phone.
2. Open the link (or scan the QR code) — it opens directly inside the Zend App, showing an approval screen naming this CLI.
3. Approve it with your existing PIN or biometrics, exactly like confirming a payment.
4. The CLI polls in the background and, once approved, retrieves your API key automatically and saves it to `~/.zend/config.json` (mode `0600` — owner read/write only).

```
$ zend login

Approve this login in the Zend App:

  https://zdfi.me/cli-auth/aB3xK9mP2qR7sT1vW4yZ0

  █▀▀▀▀▀█ ▀ █▀█ █▀▀▀▀▀█
  █ ███ █ ▄▄▄▄▄ █ ███ █
  █ ▀▀▀ █ █▄█▀▀ █ ▀▀▀ █
  ▀▀▀▀▀▀▀ ▀▀▀▀▀ ▀▀▀▀▀▀▀

Waiting for approval (expires at 2026-07-06T14:32:00Z)...
....
Logged in! Your API key has been saved to ~/.zend/config.json.
```

If you deny the request in the app, or the session expires (10 minutes) before you approve it, the CLI reports that and exits without saving anything.

## Commands

### `zend login`

Pairs the CLI with your account. See [Getting started](#getting-started) above.

### `zend keys`

Manage your API keys.

```bash
zend keys create --scopes create_payment_request,read
zend keys list
zend keys revoke <id>
```

`--scopes` accepts a comma-separated list of `create_payment_request`, `read`, `manage_webhook` (defaults to `create_payment_request,read`). The key returned by `zend keys create` is shown exactly once — copy it immediately, it cannot be retrieved again.

You can't create a key with a scope your *current* key doesn't already hold — this prevents a narrowly-scoped key from quietly escalating its own access.

### `zend config`

```bash
zend config set webhookUrl https://yourapp.com/webhooks/zend
zend config get webhookUrl
```

Sets your account's global webhook URL. Individual payment requests created via the SDK can still override this per-request.

### `zend payments test`

Sandbox Mode — validates a payment request against the real backend without creating it, moving any funds, or firing a webhook.

```bash
zend payments test \
  --amount 25.00 \
  --description "Order #1024" \
  --expires-in-minutes 15 \
  --redirect-url https://yourapp.com/checkout/return \
  --webhook-url https://yourapp.com/webhooks/zend
```

```
Sandbox Mode: this request is valid and WOULD be created. No real funds move.
No live Developer Webhook Event will be delivered for this dry run.

{
  "sandbox": true,
  "valid": true,
  "amountUsdc": 25,
  "description": "Order #1024",
  "expiresInMinutes": 15,
  "redirectUrl": "https://yourapp.com/checkout/return",
  "webhookUrl": "https://yourapp.com/webhooks/zend"
}
```

Runs the exact same validation the live `createZendPayment()` call runs — if this passes, your real request will too (and vice versa). Requires you to be logged in, since it exercises your own account's scopes.

### `zend logs tail`

Shows your most recent Developer Webhook Event deliveries (up to 50):

```bash
zend logs tail --limit 20
```

```
2026-07-06T14:20:11Z  PaymentRequestSucceeded       delivered   200  attempts=1  https://yourapp.com/webhooks/zend
2026-07-06T14:15:03Z  PaymentRequestCreated         delivered   200  attempts=1  https://yourapp.com/webhooks/zend
2026-07-06T13:58:47Z  PaymentRequestFailed          failed      502  attempts=3  https://yourapp.com/webhooks/zend
```

Useful for debugging a webhook endpoint that isn't receiving events as expected, without needing to add logging on your own server first.

## Configuration file

All commands (other than `login`) read your API key from `~/.zend/config.json`:

```json
{
  "apiKey": "zdev_live_...",
  "webhookUrl": "https://yourapp.com/webhooks/zend",
  "baseUrl": "https://zdfi.me"
}
```

The file is written with `0600` permissions. If it's missing or has no `apiKey`, every authenticated command fails fast with "Not logged in. Run `zend login` first." rather than attempting a request that will just be rejected.

`baseUrl` is optional and only needed for pointing the CLI at a non-production environment.

## Security notes

- `zend login` never asks for a typed secret. If you ever see a prompt or flag asking for an API key during login, you're not looking at the real CLI.
- Your API key is stored in plaintext in `~/.zend/config.json`, protected only by filesystem permissions (`0600`). Treat that file like any other credential — don't commit it, don't sync it to shared machines.
- `zend keys create` cannot escalate privileges: a key can only create another key with scopes it already holds itself.
- This CLI talks exclusively to `AuthenticatedApiUser`-protected endpoints. It has no knowledge of, and cannot authenticate against, merchant-scoped infrastructure.

## Troubleshooting

**"Pairing session expired before it was approved."**
Sessions expire after 10 minutes. Run `zend login` again and approve promptly.

**"Not logged in. Run `zend login` first."** on a command you just used successfully before
Check that `~/.zend/config.json` still exists and contains an `apiKey` — it's possible the file was deleted or a key was revoked from another device.

**A webhook shows `failed` in `zend logs tail`**
Check the `response_code` — delivery retries follow an exponential backoff (1 min, 5 min, 15 min, 1 hour, 1 day) for up to 5 attempts before an event is marked `exhausted`. Make sure your endpoint returns a `2xx` status and responds within a reasonable time.

## License

MIT
