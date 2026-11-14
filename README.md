# GiphyFun Whitelist

Single-page whitelist site for [@giphydotfun](https://x.com/giphydotfun). Static files only, no build step.

## Setup

- Open `index.html` and set `CONFIG.POST_URL` to the X post people should like, repost and comment on.
- Host the folder anywhere static (GitHub Pages: Settings → Pages → Deploy from branch → `main` / root).

## Database (Upstash Redis on Vercel)

Sign-ups are saved by the functions in `api/`:

- `POST /api/join` stores username, wallet and who referred them. A username or wallet can only be registered once.
- `GET /api/me?user=name` returns that user's referral count.
- `GET /api/export?key=ADMIN_KEY` downloads every sign-up as CSV.

Setup:

1. Import this repo in Vercel (Add New → Project).
2. In the project: Storage → Create Database → Upstash → Redis, and connect it to the project. This adds `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL` / `KV_REST_API_TOKEN`; both are supported).
3. Settings → Environment Variables → add `ADMIN_KEY` with a long random value.
4. Redeploy.

Usernames are not verified against X: the site records what the visitor types.

## Launchpad (/launch)

Visitors fill in a form (GIF, name, ticker, description, creator fee 0–9%, payout address). `POST /api/launch` pins the GIF to IPFS and launches the coin on Pons (Robinhood Chain) from the site wallet, with no opening buy. The site wallet is the on-chain fee recipient; each visitor's payout address is stored with the coin for later claims.

Environment variables (Vercel → Settings → Environment Variables):

| Name | Purpose |
|---|---|
| `LAUNCH_PRIVATE_KEY` | Private key of a dedicated wallet that pays the launch fee. Keep only a small balance in it. |
| `PINATA_JWT` | Pinata API JWT, used to store GIFs on IPFS. |
| `LAUNCH_ENABLED` | Set to `1` to open launching. Anything else keeps it closed. |
| `LAUNCH_DAILY_CAP` | Launches allowed in total per day (default 50). Each username, and each visitor address, can launch one coin per hour. |
| `ADMIN_KEY` | Protects `/api/export` and `/api/probe`. |

Before setting `LAUNCH_ENABLED=1`, open `/api/probe?key=ADMIN_KEY`. It shows the wallet address and balance and the settings copied from the latest Pons launch, without sending a transaction.
