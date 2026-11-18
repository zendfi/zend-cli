# pay-with-zend-cli

The Zend CLI (`zend`): build on Zend, the money network for the internet, from your terminal. Log in with your phone, create and deploy ZApps, manage API keys and webhooks, and test **Pay with Zend** payment requests.

Docs: https://developers.usezend.app/cli/overview

There's no separate "developer" account here — you're just using your existing Zend account programmatically. Anything you create through this CLI settles to your own Zend account, the same one the Zend App uses.

> Building an integration in code instead? See [`pay-with-zend-sdk`](../zend-ts-sdk/README.md) (TypeScript), [`zend-go-sdk`](../zend-go-sdk/README.md) (Go), or [`pay-with-zend-sdk`](../zend-py-sdk/README.md) (Python) — this CLI is a thin wrapper around the TypeScript SDK.

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
3. Tap **Approve** and confirm it's you with Google (or your PIN on older accounts).
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

### `zend apps`

```bash
zend apps create <slug> "<Name>"   # prints ZEND_APP_KEY once
zend apps check [zapp.json]        # check interaction rules without uploading
zend apps deploy [zapp.json]       # runs the same check first, then uploads
zend apps icon <slug> <file>       # square PNG/JPEG/WebP, 256 px+, up to 1 MB; Zend hosts it
zend apps payout <slug> <username> # where your app's share of split payments goes
```

`check` (and `deploy`) stop on interaction-rule mistakes the server would also refuse: unknown
states, a move listed twice, and unknown keys in a transition. A misspelt `serverOnly` would
otherwise leave a move open to every player, so it gets a "did you mean" hint. Both list the moves
only your server can make, for example `challenge: accepted → resolved`.

### `zend bot`

```bash
zend bot create "Match Reminder" --handle matchbot \
  --scopes read,dm_send,post_card,send_money,receive_money   # you approve it in the Zend App
zend bot list                                  # bots on this machine
zend bot me matchbot                           # check it can sign in, and see its limits
zend bot balance matchbot
zend bot chats matchbot
zend bot say matchbot @alice "Your match is at 6"
zend bot post matchbot "Daily check: all quiet."
zend bot pay matchbot @alice 2.50 --note "Thanks"
zend bot deposit matchbot                      # make received funds spendable
```

A bot is a Zend account your code runs, marked **Automated** for everyone else. Making one needs a
Zend account that has passed the verified person check; you can own up to 5. The bot's signing key
is made on this machine and stays in `~/.zend/bots/<handle>.json` (mode `0600`); only its address
is sent to Zend. Its API key (`zbot_live_...`) lasts 90 days.

What a key can do depends on its scopes (`read`, `dm_send`, `post_card`, `send_money`,
`receive_money`), and the owner sets the limits in the Zend App:

- **Messages:** a bot can reply to people who wrote to it first. The owner can let it write first.
  Direct chats only.
- **Payments:** people can pay a bot by @handle. A bot pays within a per-payment limit (at most 499),
  a daily limit and an optional list of allowed recipients. Raising a limit needs the owner to confirm
  it's them. Limits apply to payments sent through Zend.
- **Posts:** up to 280 characters, 6 an hour. Only people who have chatted with or paid the bot, and its
  owner, see them in their Feed. The owner can turn posting off.

HTTP: `Authorization: Bearer zbot_live_...` on `https://api.usezend.app/api/v1/bot/...`. See
`.kiro/specs/bot-accounts/design.md` for the routes.

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
  "amount": 25,
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
  "baseUrl": "https://api.usezend.app"
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
