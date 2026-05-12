/**
 * db.ts
 *
 * All database queries for the Bloom Slack Bot.
 * Uses Vercel Postgres (@vercel/postgres).
 *
 * Tables:
 *   workspace_configs  — Slack workspace + Bloom API key + brand
 *   generation_jobs    — image generation jobs and their status
 */

import { randomBytes, randomUUID } from "crypto";
import { sql } from "@vercel/postgres";

export interface WorkspaceConfig {
  team_id: string;
  team_name: string;
  bot_token: string;
  bloom_api_key: string;
  brand_id: string;
  brand_name: string;
  brand_session_id: string;
  setup_completed: boolean;
  setup_token: string | null;
  bot_user_id: string | null;
}

export interface GenerationJob {
  id: string;
  team_id: string;
  channel_id: string;
  user_id: string;
  thread_ts: string | null;
  message_ts: string | null;
  prompt: string;
  aspect_ratio: string;
  variants: number;
  status: "pending" | "generating" | "completed" | "failed";
  image_urls: string[];
  current_image_index: number;
  error: string | null;
  created_at: string;
}

function mapWorkspaceRow(row: {
  team_id: string;
  team_name: string;
  bot_token: string;
  bloom_api_key: string;
  brand_id: string;
  brand_name: string;
  brand_session_id: string;
  setup_completed: boolean;
  setup_token: string | null;
  bot_user_id: string | null;
}): WorkspaceConfig {
  return { ...row };
}

function mapJobRow(row: {
  id: string;
  team_id: string;
  channel_id: string;
  user_id: string;
  thread_ts: string | null;
  message_ts: string | null;
  prompt: string;
  aspect_ratio: string;
  variants: number;
  status: string;
  image_urls: unknown;
  current_image_index: number;
  error: string | null;
  created_at: Date | string;
}): GenerationJob {
  let image_urls: string[] = [];
  if (Array.isArray(row.image_urls)) {
    image_urls = row.image_urls.filter((u): u is string => typeof u === "string");
  } else if (typeof row.image_urls === "string") {
    try {
      const parsed = JSON.parse(row.image_urls) as unknown;
      if (Array.isArray(parsed)) {
        image_urls = parsed.filter((u): u is string => typeof u === "string");
      }
    } catch {
      image_urls = [];
    }
  }

  const status = row.status as GenerationJob["status"];
  const created_at =
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at);

  return {
    id: row.id,
    team_id: row.team_id,
    channel_id: row.channel_id,
    user_id: row.user_id,
    thread_ts: row.thread_ts,
    message_ts: row.message_ts,
    prompt: row.prompt,
    aspect_ratio: row.aspect_ratio,
    variants: row.variants,
    status:
      status === "pending" ||
      status === "generating" ||
      status === "completed" ||
      status === "failed"
        ? status
        : "pending",
    image_urls,
    current_image_index: row.current_image_index,
    error: row.error,
    created_at,
  };
}

const emptyWorkspace = (team_id: string): WorkspaceConfig => ({
  team_id,
  team_name: "",
  bot_token: "",
  bloom_api_key: "",
  brand_id: "",
  brand_name: "",
  brand_session_id: "",
  setup_completed: false,
  setup_token: null,
  bot_user_id: null,
});

/**
 * Creates the database tables if they don't exist.
 * Call this once during app initialization or via a setup endpoint.
 * Safe to run multiple times — uses IF NOT EXISTS.
 */
export async function initDb(): Promise<void> {
  await sql`
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
    )
  `;

  await sql`
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
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_workspace_configs_setup_token
    ON workspace_configs (setup_token)
    WHERE setup_token IS NOT NULL
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_generation_jobs_team_id
    ON generation_jobs (team_id)
  `;
}

/**
 * Gets the workspace config for a Slack team.
 * Returns null if the workspace has not installed the app yet.
 */
export async function getWorkspaceConfig(
  teamId: string
): Promise<WorkspaceConfig | null> {
  const result = await sql`
    SELECT
      team_id,
      team_name,
      bot_token,
      bloom_api_key,
      brand_id,
      brand_name,
      brand_session_id,
      setup_completed,
      setup_token,
      bot_user_id
    FROM workspace_configs
    WHERE team_id = ${teamId}
  `;

  if (result.rows.length === 0) {
    return null;
  }

  return mapWorkspaceRow(
    result.rows[0] as Parameters<typeof mapWorkspaceRow>[0]
  );
}

/**
 * Creates or updates a workspace config.
 * Called during OAuth install and setup.
 * Uses upsert on team_id to handle reinstalls.
 */
export async function upsertWorkspaceConfig(
  config: Partial<WorkspaceConfig> & { team_id: string }
): Promise<void> {
  const existing = await getWorkspaceConfig(config.team_id);
  const base = existing ?? emptyWorkspace(config.team_id);

  const merged: WorkspaceConfig = {
    team_id: config.team_id,
    team_name: config.team_name ?? base.team_name,
    bot_token: config.bot_token ?? base.bot_token,
    bloom_api_key: config.bloom_api_key ?? base.bloom_api_key,
    brand_id: config.brand_id ?? base.brand_id,
    brand_name: config.brand_name ?? base.brand_name,
    brand_session_id: config.brand_session_id ?? base.brand_session_id,
    setup_completed: config.setup_completed ?? base.setup_completed,
    setup_token:
      config.setup_token !== undefined ? config.setup_token : base.setup_token,
    bot_user_id:
      config.bot_user_id !== undefined ? config.bot_user_id : base.bot_user_id,
  };

  await sql`
    INSERT INTO workspace_configs (
      team_id,
      team_name,
      bot_token,
      bloom_api_key,
      brand_id,
      brand_name,
      brand_session_id,
      setup_completed,
      setup_token,
      bot_user_id
    )
    VALUES (
      ${merged.team_id},
      ${merged.team_name},
      ${merged.bot_token},
      ${merged.bloom_api_key},
      ${merged.brand_id},
      ${merged.brand_name},
      ${merged.brand_session_id},
      ${merged.setup_completed},
      ${merged.setup_token},
      ${merged.bot_user_id}
    )
    ON CONFLICT (team_id) DO UPDATE SET
      team_name = EXCLUDED.team_name,
      bot_token = EXCLUDED.bot_token,
      bloom_api_key = EXCLUDED.bloom_api_key,
      brand_id = EXCLUDED.brand_id,
      brand_name = EXCLUDED.brand_name,
      brand_session_id = EXCLUDED.brand_session_id,
      setup_completed = EXCLUDED.setup_completed,
      setup_token = EXCLUDED.setup_token,
      bot_user_id = EXCLUDED.bot_user_id
  `;
}

/**
 * Finds a workspace by its setup token.
 * Setup tokens are one-time URLs sent to the installer via DM.
 * Returns null if no workspace has this token.
 */
export async function getWorkspaceBySetupToken(
  token: string
): Promise<WorkspaceConfig | null> {
  const result = await sql`
    SELECT
      team_id,
      team_name,
      bot_token,
      bloom_api_key,
      brand_id,
      brand_name,
      brand_session_id,
      setup_completed,
      setup_token,
      bot_user_id
    FROM workspace_configs
    WHERE setup_token = ${token}
  `;

  if (result.rows.length === 0) {
    return null;
  }

  return mapWorkspaceRow(
    result.rows[0] as Parameters<typeof mapWorkspaceRow>[0]
  );
}

/**
 * Generates a fresh setup token for a workspace.
 * Replaces any existing token.
 * Returns the new token string.
 */
export async function generateSetupToken(teamId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");

  await sql`
    INSERT INTO workspace_configs (team_id, setup_token)
    VALUES (${teamId}, ${token})
    ON CONFLICT (team_id) DO UPDATE SET
      setup_token = EXCLUDED.setup_token
  `;

  return token;
}

/**
 * Creates a new generation job.
 * Returns the job ID (UUID).
 */
export async function createJob(params: {
  team_id: string;
  channel_id: string;
  user_id: string;
  prompt: string;
  aspect_ratio: string;
  variants: number;
  thread_ts?: string;
}): Promise<string> {
  const id = randomUUID();
  const thread_ts = params.thread_ts ?? null;

  await sql`
    INSERT INTO generation_jobs (
      id,
      team_id,
      channel_id,
      user_id,
      thread_ts,
      prompt,
      aspect_ratio,
      variants,
      status,
      image_urls,
      current_image_index,
      error
    )
    VALUES (
      ${id},
      ${params.team_id},
      ${params.channel_id},
      ${params.user_id},
      ${thread_ts},
      ${params.prompt},
      ${params.aspect_ratio},
      ${params.variants},
      'pending',
      '[]'::jsonb,
      0,
      NULL
    )
  `;

  return id;
}

/**
 * Gets a generation job by ID.
 * Returns null if not found.
 */
export async function getJob(jobId: string): Promise<GenerationJob | null> {
  const result = await sql`
    SELECT
      id,
      team_id,
      channel_id,
      user_id,
      thread_ts,
      message_ts,
      prompt,
      aspect_ratio,
      variants,
      status,
      image_urls,
      current_image_index,
      error,
      created_at
    FROM generation_jobs
    WHERE id = ${jobId}
  `;

  if (result.rows.length === 0) {
    return null;
  }

  return mapJobRow(result.rows[0] as Parameters<typeof mapJobRow>[0]);
}

/**
 * Updates fields on a generation job.
 * Used to update status, message_ts, image_urls as the job progresses.
 */
export async function updateJob(
  jobId: string,
  fields: Partial<
    Omit<GenerationJob, "id" | "team_id" | "created_at">
  >
): Promise<void> {
  const current = await getJob(jobId);
  if (!current) {
    return;
  }

  const merged = {
    channel_id: fields.channel_id ?? current.channel_id,
    user_id: fields.user_id ?? current.user_id,
    thread_ts:
      fields.thread_ts !== undefined ? fields.thread_ts : current.thread_ts,
    message_ts:
      fields.message_ts !== undefined ? fields.message_ts : current.message_ts,
    prompt: fields.prompt ?? current.prompt,
    aspect_ratio: fields.aspect_ratio ?? current.aspect_ratio,
    variants: fields.variants ?? current.variants,
    status: fields.status ?? current.status,
    image_urls: fields.image_urls ?? current.image_urls,
    current_image_index:
      fields.current_image_index ?? current.current_image_index,
    error: fields.error !== undefined ? fields.error : current.error,
  };

  const imageUrlsJson = JSON.stringify(merged.image_urls);

  await sql`
    UPDATE generation_jobs
    SET
      channel_id = ${merged.channel_id},
      user_id = ${merged.user_id},
      thread_ts = ${merged.thread_ts},
      message_ts = ${merged.message_ts},
      prompt = ${merged.prompt},
      aspect_ratio = ${merged.aspect_ratio},
      variants = ${merged.variants},
      status = ${merged.status},
      image_urls = ${imageUrlsJson}::jsonb,
      current_image_index = ${merged.current_image_index},
      error = ${merged.error}
    WHERE id = ${jobId}
  `;
}
