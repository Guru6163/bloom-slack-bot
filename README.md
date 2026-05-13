# Bloom Slack Bot

On-brand images in Slack via **`/bloom-bot`**. Slack hits your **deployed** HTTPS app (e.g. Vercel); Bloom API keys are stored per workspace after setup, not in Slack’s settings.

**Prerequisites:** Node.js 20+, npm, [Supabase](https://supabase.com/) project, [Slack app](https://api.slack.com/apps), [Bloom API key](https://www.trybloom.ai/developers).

---

### 1. Clone and install

```bash
git clone https://github.com/Guru6163/bloom-slack-bot
cd bloom-slack-bot
npm install
```

### 2. Supabase database

1. Create a project at [supabase.com](https://supabase.com/).
2. **SQL → New query:** run [`supabase/bloom_slack_init_db.sql`](supabase/bloom_slack_init_db.sql) once.
3. **Project Settings → API:** copy **Project URL** and the **service_role** key (server only).

### 3. Slack app (credentials and scopes)

1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → from scratch.
2. **OAuth & Permissions → Bot Token Scopes:** `commands`, `chat:write`, `chat:write.public`, `files:write`.
3. **Basic Information → App Credentials:** copy **Client ID**, **Client Secret**, and **Signing Secret** (you will paste them into Vercel in step 5).

You will add **Redirect URL**, **slash command URL**, and **Interactivity URL** in step 6 after you know your deployment URL.

### 4. Deploy to Vercel

```bash
npm i -g vercel
vercel --prod
```

Note the **Production URL** with `https` and **no trailing slash** (example: `https://bloom-slack-bot.vercel.app`). Call it `APP_URL` below.

### 5. Environment variables on Vercel

**Vercel → Project → Settings → Environment Variables** — add:

| Variable | Value |
|----------|--------|
| `SLACK_CLIENT_ID` | From Slack app |
| `SLACK_CLIENT_SECRET` | From Slack app |
| `SLACK_SIGNING_SECRET` | From Slack app |
| `INTERNAL_SECRET` | Random string (e.g. `openssl rand -hex 32`) |
| `NEXT_PUBLIC_APP_URL` | Same as `APP_URL` |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase **service_role** secret |

Redeploy (**Deployments → … → Redeploy**) or run `vercel --prod` again so the app picks up the variables.

### 6. Finish Slack URLs (all use `APP_URL`)

In your Slack app settings:

| Where | URL |
|-------|-----|
| **OAuth & Permissions → Redirect URLs** | `APP_URL/api/slack/oauth` |
| **Slash Commands → `/bloom-bot` → Request URL** | `APP_URL/api/slack/events` |
| **Interactivity & Shortcuts → Request URL** | `APP_URL/api/slack/events` |

Optional: **Event Subscriptions → Request URL** — same `APP_URL/api/slack/events` if you turn events on.

### 7. Check database from the browser

Open:

`APP_URL/api/slack/setup/init`

You want: `{"ok":true,"message":"Database ready. Both tables exist."}`

If `ok` is false, fix Supabase credentials or re-run the SQL in step 2.

### 8. Install the app and connect Bloom

1. Open **`APP_URL`** → **Add to Slack** (or Slack → your app → **Install to Workspace**).
2. Check the installer’s **Slack DM** for the **setup** link. If Bloom is not configured yet, running `/bloom-bot help` also surfaces the setup link.
3. On the setup page: paste the Bloom API key, validate, choose a **brand**, save.  
   **Or** run `/bloom-bot setup YOUR_API_KEY` in Slack, then open the link it returns and pick a brand.

### 9. Use `/bloom-bot` in Slack

| Command | Purpose |
|---------|--------|
| `/bloom-bot help` | Examples and hints |
| `/bloom-bot generate <prompt> [ratio] [1-5]` | Generate (default ratio `1:1`; ratio last; aliases: `square`, `landscape`, `portrait`, `story`) |
| `/bloom-bot setup <api_key>` | Save key, then finish brand in the browser |
| `/bloom-bot brands` / `/bloom-bot credits` | List brands / credit balance |

Example: `/bloom-bot generate summer sale hero 16:9`

---

### Troubleshooting

| Issue | Check |
|-------|--------|
| OAuth redirect error | Redirect URL exactly `APP_URL/api/slack/oauth` |
| Slash command does nothing | Request URL is `APP_URL/api/slack/events` and deployment is live |
| `invalid signature` | `SLACK_SIGNING_SECRET` matches the Slack app |
| Generation fails | `INTERNAL_SECRET` set on Vercel; `NEXT_PUBLIC_APP_URL` equals `APP_URL` |
| DB errors | Supabase env vars; SQL file applied; `/api/slack/setup/init` |
