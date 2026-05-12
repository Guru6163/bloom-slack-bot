# Bloom Slack Bot

Generate on-brand images in Slack with a single slash command.

## How it works

1. Install the app to your Slack workspace
2. Connect your Bloom API key via the setup link
3. Select your brand
4. Type /bloom-gen generate summer sale hero 16:9
5. Bloom posts the image back in your channel

## Commands

/bloom-gen generate {prompt} {ratio}  — Generate images
/bloom-gen setup                      — Get setup link
/bloom-gen brands                     — List your brands
/bloom-gen credits                    — Check credit balance
/bloom-gen help                       — Show all commands

Aspect ratio aliases:
  square = 1:1 | landscape = 16:9 | portrait = 9:16 | story = 9:16

## Run locally

Prerequisites: **Node.js 20+**, **npm**, **PostgreSQL** (local Docker or hosted), a [Slack app](https://api.slack.com/apps), and a [Bloom API key](https://www.trybloom.ai/developers).

Slack’s servers **cannot** call `http://localhost:3000`. For full Slack testing you need a **public HTTPS URL** (e.g. [ngrok](https://ngrok.com/) or [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/tunnel-guide/)) and must set **`NEXT_PUBLIC_APP_URL`** to that URL. You can still run the app and init the DB on localhost without Slack.

### 1. Clone and install

```bash
git clone https://github.com/Guru6163/bloom-slack-bot
cd bloom-slack-bot
npm install
```

### 2. PostgreSQL

Set **`POSTGRES_URL`** to any connection string your machine can reach.

Example with Docker:

```bash
docker run --name bloom-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=bloom_slack -p 5432:5432 -d postgres:16
```

Then use:

`POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/bloom_slack`

(Or use Neon, Supabase, Vercel Postgres, etc.)

### 3. Environment variables

```bash
cp .env.example .env.local
```

| Variable | Purpose |
|----------|---------|
| `SLACK_CLIENT_ID` | Slack app → **Basic Information** → App Credentials |
| `SLACK_CLIENT_SECRET` | Same |
| `SLACK_SIGNING_SECRET` | Same — verifies incoming Slack requests |
| `INTERNAL_SECRET` | Random secret; protects `POST /api/internal/run-generation` (Bearer token). Generate e.g. `openssl rand -hex 32` |
| `NEXT_PUBLIC_APP_URL` | Public base URL **without** a trailing slash. Omit or use `http://localhost:3000` for defaults; **with Slack + tunnel**, use `https://YOUR-TUNNEL.example` |
| `POSTGRES_URL` | Postgres connection string |

OAuth, setup links, and background generation all resolve the app base URL via `NEXT_PUBLIC_APP_URL` (see `lib/app-url.ts`).

### 4. Slack app configuration

Create an app at [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → From scratch.

**OAuth & Permissions** → **Bot Token Scopes**: `commands`, `chat:write`, `chat:write.public`, `files:write`

**OAuth & Permissions** → **Redirect URLs** (must match the app):

- Local only: `http://localhost:3000/api/slack/oauth`
- With tunnel: `https://YOUR-TUNNEL/api/slack/oauth`

**Slash Commands** → command `/bloom-gen` → **Request URL**:

- With tunnel: `https://YOUR-TUNNEL/api/slack/events`

**Interactivity & Shortcuts** → **Request URL**: same as slash commands — `https://YOUR-TUNNEL/api/slack/events` (needed for Block Kit buttons on generated messages).

Optional: if you enable **Event Subscriptions** pointing at `/api/slack/events`, URL verification is supported.

### 5. Tunnel (for Slack)

Example with ngrok (dev server on port 3000):

```bash
ngrok http 3000
```

Put the HTTPS origin in `.env.local` as `NEXT_PUBLIC_APP_URL`, then restart the dev server. Use that same host in all Slack Request URLs above.

### 6. Dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) for the landing page; **Add to Slack** goes to `/api/slack/install`.

### 7. Initialize the database (once)

```bash
curl -sS "http://localhost:3000/api/slack/setup/init"
# or, if using a tunnel:
curl -sS "https://YOUR-TUNNEL/api/slack/setup/init"
```

Expect `{ "ok": true }`. Safe to call more than once.

### 8. Install and test

1. Open `/api/slack/install` (via localhost or your tunnel, matching how you configured Slack).
2. Finish OAuth; check the installer’s Slack DM for the **setup** link (Bloom API key + brand).
3. In Slack: `/bloom-gen help`

### Troubleshooting

| Symptom | Likely cause |
|--------|----------------|
| `invalid signature` | Wrong `SLACK_SIGNING_SECRET` or a proxy altering the body |
| OAuth redirect mismatch | Slack **Redirect URLs** must exactly match `{APP_URL}/api/slack/oauth` |
| Slash command never hits the server | Request URL still points at localhost, or tunnel stopped |
| Generation issues | Missing/wrong `INTERNAL_SECRET`, or wrong `NEXT_PUBLIC_APP_URL` so the internal `fetch` to `/api/internal/run-generation` fails |
| DB errors | Bad `POSTGRES_URL`, database not running, or `/api/slack/setup/init` not run |

## Deploy to Vercel

1. Clone this repo

git clone https://github.com/Guru6163/bloom-slack-bot
cd bloom-slack-bot

2. Install dependencies

npm install

3. Create a Slack App

Go to api.slack.com/apps → Create New App → From Scratch

Add these Bot Token Scopes:
  commands, chat:write, chat:write.public, files:write

Add slash command:
  Command: /bloom-gen
  Request URL: https://YOUR_APP.vercel.app/api/slack/events

4. Deploy to Vercel

vercel --prod

5. Set environment variables in Vercel dashboard:

SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_SIGNING_SECRET=
INTERNAL_SECRET=any-random-string
NEXT_PUBLIC_APP_URL=https://YOUR_APP.vercel.app

6. Add Vercel Postgres

Vercel Dashboard → Storage → Create Postgres Database
POSTGRES_URL is set automatically

7. Initialize database

Visit: https://YOUR_APP.vercel.app/api/slack/setup/init
(Creates tables — run once)

8. Install app to Slack workspace

Visit: https://YOUR_APP.vercel.app/api/slack/install

9. Complete setup

Check your Slack DMs for the setup link.
Enter your Bloom API key and select your brand.

10. Test it

/bloom-gen generate summer sale hero banner 16:9

## Project structure

app/
  api/slack/events/    ← receives all Slack events
  api/slack/install/   ← starts OAuth flow
  api/slack/oauth/     ← OAuth callback
  api/slack/setup/     ← workspace configuration UI
  api/slack/setup/init/← creates DB tables (run once)
  api/internal/
    run-generation/    ← background image generation
  page.tsx             ← landing page with Add to Slack button

lib/
  bloom.ts             ← Bloom API client
  slack.ts             ← Slack API + Block Kit builders
  db.ts                ← Postgres queries
  utils.ts             ← signature verification + command parser
  internal-auth.ts     ← protects internal routes
  app-url.ts           ← resolves app base URL
  slack-events-handler.ts ← routes slash commands + interactions
  run-generation-handler.ts ← generation pipeline

## Get your Bloom API key

[trybloom.ai/developers](https://www.trybloom.ai/developers)
