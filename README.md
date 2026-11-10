# GiphyFun Whitelist

Single-page whitelist site for [@giphyfun](https://x.com/giphyfun). Static files only, no build step.

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
