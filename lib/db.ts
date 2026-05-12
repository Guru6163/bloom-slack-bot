/**
 * lib/db.ts
 *
 * All database queries for the Bloom Slack Bot.
 * Uses Supabase (Postgres) via @supabase/supabase-js with the service role key.
 *
 * Tables:
 *   workspace_configs  — Slack workspace + Bloom API key + brand
 *   generation_jobs    — image generation jobs and their status
 *
 * Tables must exist before the app runs: create them in the Supabase SQL editor
 * (see `supabase/bloom_slack_init_db.sql`). `initDb()` only verifies they exist.
 */

import { randomBytes, randomUUID } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let supabaseClient: SupabaseClient | undefined;

/**
 * Returns the shared Supabase client (service role), equivalent to:
 * `createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)`.
 * Instantiation is lazy so `next build` can analyze routes when those env vars are absent.
 */
function supabase(): SupabaseClient {
  if (!supabaseClient) {
    const url = process.env.SUPABASE_URL?.trim();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !key) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }
    supabaseClient = createClient(url, key);
  }
  return supabaseClient;
}

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
  /** Slack user id of the installer (OAuth); used for setup completion DMs. */
  installer_user_id: string | null;
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

/** Maps a Postgres row object to a {@link WorkspaceConfig}. */
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
  installer_user_id: string | null;
}): WorkspaceConfig {
  return { ...row };
}

/** Maps a Postgres row object to a {@link GenerationJob}. */
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

/** Builds default {@link WorkspaceConfig} values for a new team id. */
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
  installer_user_id: null,
});

/**
 * Verifies required tables exist (queries each with `limit(1)`).
 * Create tables in the Supabase SQL editor using `supabase/bloom_slack_init_db.sql`.
 * Safe to call on every request; throws if a table is missing or unreachable.
 */
export async function initDb(): Promise<void> {
  const { error: configError } = await supabase()
    .from("workspace_configs")
    .select("team_id")
    .limit(1);

  if (configError) {
    throw new Error(
      `workspace_configs table missing: ${configError.message}`
    );
  }

  const { error: jobsError } = await supabase()
    .from("generation_jobs")
    .select("id")
    .limit(1);

  if (jobsError) {
    throw new Error(`generation_jobs table missing: ${jobsError.message}`);
  }
}

/**
 * Gets the workspace config for a Slack team.
 * Returns null if the workspace has not installed the app yet.
 */
export async function getWorkspaceConfig(
  teamId: string
): Promise<WorkspaceConfig | null> {
  const { data, error } = await supabase()
    .from("workspace_configs")
    .select(
      "team_id, team_name, bot_token, bloom_api_key, brand_id, brand_name, brand_session_id, setup_completed, setup_token, bot_user_id, installer_user_id"
    )
    .eq("team_id", teamId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    return null;
  }

  return mapWorkspaceRow(data as Parameters<typeof mapWorkspaceRow>[0]);
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
    installer_user_id:
      config.installer_user_id !== undefined
        ? config.installer_user_id
        : base.installer_user_id,
  };

  const { error } = await supabase().from("workspace_configs").upsert(
    {
      team_id: merged.team_id,
      team_name: merged.team_name,
      bot_token: merged.bot_token,
      bloom_api_key: merged.bloom_api_key,
      brand_id: merged.brand_id,
      brand_name: merged.brand_name,
      brand_session_id: merged.brand_session_id,
      setup_completed: merged.setup_completed,
      setup_token: merged.setup_token,
      bot_user_id: merged.bot_user_id,
      installer_user_id: merged.installer_user_id,
    },
    { onConflict: "team_id" }
  );

  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Finds a workspace by its setup token.
 * Setup tokens are one-time URLs sent to the installer via DM.
 * Returns null if no workspace has this token.
 */
export async function getWorkspaceBySetupToken(
  token: string
): Promise<WorkspaceConfig | null> {
  const { data, error } = await supabase()
    .from("workspace_configs")
    .select(
      "team_id, team_name, bot_token, bloom_api_key, brand_id, brand_name, brand_session_id, setup_completed, setup_token, bot_user_id, installer_user_id"
    )
    .eq("setup_token", token)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    return null;
  }

  return mapWorkspaceRow(data as Parameters<typeof mapWorkspaceRow>[0]);
}

/**
 * Generates a fresh setup token for a workspace.
 * Replaces any existing token.
 * Returns the new token string.
 */
export async function generateSetupToken(teamId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");

  const { error } = await supabase().from("workspace_configs").upsert(
    {
      team_id: teamId,
      setup_token: token,
    },
    { onConflict: "team_id" }
  );

  if (error) {
    throw new Error(error.message);
  }

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

  const { error } = await supabase().from("generation_jobs").insert({
    id,
    team_id: params.team_id,
    channel_id: params.channel_id,
    user_id: params.user_id,
    thread_ts,
    prompt: params.prompt,
    aspect_ratio: params.aspect_ratio,
    variants: params.variants,
    status: "pending",
    image_urls: [],
    current_image_index: 0,
    error: null,
  });

  if (error) {
    throw new Error(error.message);
  }

  return id;
}

/**
 * Gets a generation job by ID.
 * Returns null if not found.
 */
export async function getJob(jobId: string): Promise<GenerationJob | null> {
  const { data, error } = await supabase()
    .from("generation_jobs")
    .select(
      "id, team_id, channel_id, user_id, thread_ts, message_ts, prompt, aspect_ratio, variants, status, image_urls, current_image_index, error, created_at"
    )
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    return null;
  }

  return mapJobRow(data as Parameters<typeof mapJobRow>[0]);
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

  const { error } = await supabase()
    .from("generation_jobs")
    .update({
      channel_id: merged.channel_id,
      user_id: merged.user_id,
      thread_ts: merged.thread_ts,
      message_ts: merged.message_ts,
      prompt: merged.prompt,
      aspect_ratio: merged.aspect_ratio,
      variants: merged.variants,
      status: merged.status,
      image_urls: merged.image_urls,
      current_image_index: merged.current_image_index,
      error: merged.error,
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(error.message);
  }
}
