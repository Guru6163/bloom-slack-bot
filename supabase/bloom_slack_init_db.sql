-- Run once in Supabase: Dashboard → SQL → New query → paste → Run.
-- Then call GET /api/slack/setup/init to verify tables (or rely on initDb() elsewhere).

CREATE TABLE IF NOT EXISTS workspace_configs (
  team_id TEXT PRIMARY KEY,
  team_name TEXT NOT NULL DEFAULT '',
  bot_token TEXT NOT NULL DEFAULT '',
  bloom_api_key TEXT NOT NULL DEFAULT '',
  brand_id TEXT NOT NULL DEFAULT '',
  brand_name TEXT NOT NULL DEFAULT '',
  brand_session_id TEXT NOT NULL DEFAULT '',
  setup_completed BOOLEAN NOT NULL DEFAULT FALSE,
  setup_token TEXT,
  bot_user_id TEXT
);

CREATE TABLE IF NOT EXISTS generation_jobs (
  id UUID PRIMARY KEY,
  team_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  thread_ts TEXT,
  message_ts TEXT,
  prompt TEXT NOT NULL,
  aspect_ratio TEXT NOT NULL,
  variants INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',
  image_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_image_index INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_configs_setup_token
  ON workspace_configs (setup_token)
  WHERE setup_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_generation_jobs_team_id
  ON generation_jobs (team_id);

ALTER TABLE workspace_configs
  ADD COLUMN IF NOT EXISTS installed_by TEXT;
