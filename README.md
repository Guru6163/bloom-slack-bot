# Bloom Slack Bot

Generate on-brand images in Slack with a single slash command.

## How it works

1. Install the app to your Slack workspace
2. Connect your Bloom API key via the setup link
3. Select your brand
4. Type `/bloom-bot generate summer sale hero 16:9`
5. Bloom posts the image back in your channel

## Using the bot in Slack

The Slack app must define the slash command as **`/bloom-bot`** (see Slack configuration below). Bloom credentials are **not** stored in Slack’s UI; they are saved for your workspace in this app’s database after you finish setup.

### First-time setup (per Slack workspace)

1. **Install the app** — Use **Add to Slack** on your deployed app URL, or **Install to Workspace** in the Slack app settings.
2. **Open the setup link** — Right after install, the bot sends the person who installed it a **DM** with a link to the web setup page. If you lost it, run any command (for example `/bloom-bot help`); if Bloom is not configured yet, Slack shows an ephemeral message with the same **setup URL**—open it in the browser.
3. **On the setup page** — Paste your [Bloom API key](https://www.trybloom.ai/developers), validate it, pick a **brand**, then save. Alternatively you can paste the key in Slack first (next step) and only choose the brand on the web page.
4. **Optional: set the API key from Slack** — `/bloom-bot setup YOUR_BLOOM_API_KEY` saves the key and replies with a link to **select your brand** (you must still complete that step in the browser).

Until both an API key and a brand are saved, `/bloom-bot generate` will tell you to finish setup.

### Slash commands

| Command | What it does |
|--------|----------------|
| `/bloom-bot help` | Lists examples and ratio hints (same as sending unknown text). |
| `/bloom-bot generate …` | Starts image generation using the workspace’s connected brand. See syntax below. |
| `/bloom-bot setup YOUR_API_KEY` | Stores the Bloom API key for this workspace, then gives you the link to pick a brand. |
| `/bloom-bot brands` | Lists Bloom brands available for your stored API key. |
| `/bloom-bot credits` | Shows Bloom credit balance (or “Unlimited” when applicable). |

**`generate` syntax**

- Form: `/bloom-bot generate <prompt> [<aspect_ratio>] [<variants>]`
- If you omit the ratio, it defaults to **`1:1`**.
- Put the **ratio last** (before an optional variant count): supported shapes include `1:1`, `4:5`, `9:16`, `16:9`, etc. **Aliases:** `square` → `1:1`, `landscape` → `16:9`, `portrait` / `story` → `9:16`.
- Optional **variants** `1`–`5` after the ratio: e.g. `/bloom-bot generate holiday banner 16:9 3` requests three variants.

Examples:

```text
/bloom-bot help
/bloom-bot generate summer sale hero banner
/bloom-bot generate product launch social portrait
/bloom-bot generate conference keynote slide 16:9
/bloom-bot brands
/bloom-bot credits
/bloom-bot setup paste_your_bloom_api_key_here
```

**After a generation**, the message may include Block Kit buttons (for example regenerate or download). Those require **Interactivity** in the Slack app pointing at the same **`/api/slack/events`** URL as slash commands.

## Run locally

Prerequisites: **Node.js 20+**, **npm**, a [Supabase](https://supabase.com/) project, a [Slack app](https://api.slack.com/apps), and a [Bloom API key](https://www.trybloom.ai/developers).

Slack’s servers **cannot** call `http://localhost:3000`. For full Slack testing you need a **public HTTPS URL** (e.g. [ngrok](https://ngrok.com/) or [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/tunnel-guide/)) and must set **`NEXT_PUBLIC_APP_URL`** to that URL. You can still run the app and init the DB on localhost without Slack.

### 1. Clone and install

```bash
git clone https://github.com/Guru6163/bloom-slack-bot
cd bloom-slack-bot
npm install
```

### 2. Supabase project

1. Create a project at [supabase.com](https://supabase.com/).
2. **Project Settings → API**: copy **Project URL** (`SUPABASE_URL`) and **service_role** key (`SUPABASE_SERVICE_ROLE_KEY`). Use the **service role** key only on the server (never in the browser).
3. **SQL → New query**: paste and run the contents of [`supabase/bloom_slack_init_db.sql`](supabase/bloom_slack_init_db.sql) once to create tables and indexes.

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
| `SUPABASE_URL` | Supabase project URL (Settings → API → Project URL) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase **service_role** secret (server only) |

OAuth, setup links, and background generation all resolve the app base URL via `NEXT_PUBLIC_APP_URL` (see `lib/app-url.ts`).

### 4. Slack app configuration

Create an app at [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → From scratch.

**OAuth & Permissions** → **Bot Token Scopes**: `commands`, `chat:write`, `chat:write.public`, `files:write`

**OAuth & Permissions** → **Redirect URLs** (must match the app):

- Local only: `http://localhost:3000/api/slack/oauth`
- With tunnel: `https://YOUR-TUNNEL/api/slack/oauth`

**Slash Commands** → command `/bloom-bot` → **Request URL**:

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

After creating tables in the Supabase SQL editor (step 2), verify them with the init endpoint:

```bash
curl -sS "http://localhost:3000/api/slack/setup/init"
# or, if using a tunnel:
curl -sS "https://YOUR-TUNNEL/api/slack/setup/init"
```

Expect `{ "ok": true, "message": "Database ready. Both tables exist." }`. Safe to call repeatedly.

### 8. Install and test

1. Open `/api/slack/install` (via localhost or your tunnel, matching how you configured Slack).
2. Finish OAuth; check the installer’s Slack DM for the **setup** link (Bloom API key + brand).
3. In Slack: `/bloom-bot help`

### Troubleshooting

| Symptom | Likely cause |
|--------|----------------|
| `invalid signature` | Wrong `SLACK_SIGNING_SECRET` or a proxy altering the body |
| OAuth redirect mismatch | Slack **Redirect URLs** must exactly match `{APP_URL}/api/slack/oauth` |
| Slash command never hits the server | Request URL still points at localhost, or tunnel stopped |
| Generation issues | Missing/wrong `INTERNAL_SECRET`, or wrong `NEXT_PUBLIC_APP_URL` so the internal `fetch` to `/api/internal/run-generation` fails |
| DB errors | Missing or wrong `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`, SQL file not applied in Supabase, or `/api/slack/setup/init` reports missing tables |

## Deploy to Vercel

End-to-end production setup: Slack app → Vercel → Supabase (this repo uses **Supabase** for Postgres, not Vercel Postgres).

### Step 1 — Clone and install

```bash
git clone https://github.com/Guru6163/bloom-slack-bot
cd bloom-slack-bot
npm install
```

### Step 2 — Create Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**.
2. **App name:** Bloom (or any name you prefer).
3. **Workspace:** pick your test workspace.

### Step 3 — Configure Slack app

**OAuth & Permissions** → **Scopes** → **Bot Token Scopes** — add:

- `commands`
- `chat:write`
- `chat:write.public`
- `files:write`

**Slash Commands** → **Create New Command**:

| Field | Value |
|--------|--------|
| **Command** | `/bloom-bot` |
| **Request URL** | `https://YOUR_APP.vercel.app/api/slack/events` (use your real Vercel URL after deploy) |
| **Short description** | Generate on-brand images with Bloom |
| **Usage hint** | `generate {prompt} {ratio}` |

**Interactivity & Shortcuts** → **Interactivity** → **Request URL**: same as slash commands — `https://YOUR_APP.vercel.app/api/slack/events` (required for Block Kit buttons on generated messages).

**Basic Information** → **App Credentials** — copy these for Vercel (Step 6):

| Slack field | Vercel / env variable |
|-------------|------------------------|
| Client ID | `SLACK_CLIENT_ID` |
| Client Secret | `SLACK_CLIENT_SECRET` |
| Signing Secret | `SLACK_SIGNING_SECRET` |

Optional: **Event Subscriptions** → **Request URL** — same `https://YOUR_APP.vercel.app/api/slack/events` if you enable events (URL verification is supported).

### Step 4 — Deploy to Vercel

```bash
npm install -g vercel
vercel --prod
```

Note the deployment URL Vercel prints (for example `https://bloom-slack-bot-xyz.vercel.app`). Use it everywhere placeholders say `YOUR_APP.vercel.app`.

### Step 5 — Supabase database

This app talks to Postgres through **Supabase** (see `lib/db.ts` and `.env.example`).

1. Create a project at [supabase.com](https://supabase.com/).
2. **SQL** → **New query**: paste and run [`supabase/bloom_slack_init_db.sql`](supabase/bloom_slack_init_db.sql) once (creates tables and indexes).
3. **Project Settings** → **API**: copy **Project URL** and the **service_role** key (server only; never expose to the browser). You will set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in Vercel next.

### Step 6 — Environment variables in Vercel

Vercel → your project → **Settings** → **Environment Variables**. Add:

| Variable | Value |
|----------|--------|
| `SLACK_CLIENT_ID` | From Step 3 |
| `SLACK_CLIENT_SECRET` | From Step 3 |
| `SLACK_SIGNING_SECRET` | From Step 3 |
| `INTERNAL_SECRET` | Any random string (e.g. output of `openssl rand -hex 32`) |
| `NEXT_PUBLIC_APP_URL` | `https://your-app.vercel.app` (no trailing slash) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase **service_role** secret |

Redeploy so variables apply:

```bash
vercel --prod
```

### Step 7 — Update Slack app URLs

After you have the final Vercel URL, return to [api.slack.com/apps](https://api.slack.com/apps) → your app:

- **OAuth & Permissions** → **Redirect URLs** — add  
  `https://YOUR_APP.vercel.app/api/slack/oauth`
- **Slash Commands** → your `/bloom-bot` command → **Request URL** —  
  `https://YOUR_APP.vercel.app/api/slack/events`
- **Interactivity & Shortcuts** → **Request URL** — same events URL.
- **Event Subscriptions** (if enabled) → **Request URL** — same events URL.

### Step 8 — Verify database

Tables are created by the SQL in Step 5. This endpoint only **checks** that `workspace_configs` and `generation_jobs` exist and are reachable:

Open in a browser:

`https://YOUR_APP.vercel.app/api/slack/setup/init`

Expected JSON:

```json
{ "ok": true, "message": "Database ready. Both tables exist." }
```

If `ok` is false, fix Supabase credentials or re-run the SQL file in Supabase, then try again.

### Step 9 — Install app to Slack workspace

**Option A — Landing page**

1. Open `https://YOUR_APP.vercel.app`.
2. Click **Add to Slack**.

**Option B — Slack app settings**

1. [api.slack.com/apps](https://api.slack.com/apps) → your app → **Install App** → **Install to Workspace**.

After installing:

1. Check Slack **DMs** — Bloom should message you with a **setup** link.
2. Open the link, enter your **Bloom API key**, and **select your brand**.

### Step 10 — Test in Slack

In any channel:

```text
/bloom-bot help
```

You should see the help message.

```text
/bloom-bot generate summer sale hero banner 16:9
```

You should see a loading message, then a generated image when the job completes.

## Project structure

app/
  api/slack/events/    ← receives all Slack events
  api/slack/install/   ← starts OAuth flow
  api/slack/oauth/     ← OAuth callback
  api/slack/setup/     ← workspace configuration UI
  api/slack/setup/init/← GET verifies tables exist (see lib/db initDb)
  api/internal/
    run-generation/    ← background image generation
  page.tsx             ← landing page with Add to Slack button

supabase/
  bloom_slack_init_db.sql ← run once in Supabase SQL editor (DDL only)

lib/
  bloom.ts             ← Bloom API client
  slack.ts             ← Slack API + Block Kit builders
  db.ts                ← Supabase Postgres client
  utils.ts             ← signature verification + command parser
  internal-auth.ts     ← protects internal routes
  app-url.ts           ← resolves app base URL
  slack-events-handler.ts ← routes slash commands + interactions
  run-generation-handler.ts ← generation pipeline

## Get your Bloom API key

[trybloom.ai/developers](https://www.trybloom.ai/developers)
