/**
 * slack-events-handler.ts
 *
 * Routes incoming Slack requests to the correct handler.
 * Called by the events API route after signature verification.
 */

import { getBloomCredits, listBloomBrands } from "@/lib/bloom";
import { getAppUrl } from "@/lib/app-url";
import {
  createJob,
  generateSetupToken,
  getJob,
  getWorkspaceConfig,
  initDb,
  updateJob,
  upsertWorkspaceConfig,
} from "@/lib/db";
import { getInternalAuthHeader } from "@/lib/internal-auth";
import {
  buildHelpBlocks,
  buildLoadingBlocks,
  buildResultBlocks,
  postMessage,
  updateMessage,
} from "@/lib/slack";
import { parseSlashCommand, type ParsedCommand } from "@/lib/utils";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function emptyOk(): Response {
  return new Response(null, { status: 200 });
}

function fireRunGeneration(jobId: string): void {
  const url = `${getAppUrl()}/api/internal/run-generation`;
  void fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: getInternalAuthHeader(),
    },
    body: JSON.stringify({ job_id: jobId }),
  }).catch(() => {});
}

async function ensureSetupUrl(teamId: string): Promise<string> {
  const ws = await getWorkspaceConfig(teamId);
  if (!ws) {
    throw new Error("Workspace not found");
  }
  let token = ws.setup_token?.trim();
  if (!token) {
    token = await generateSetupToken(teamId);
  }
  return `${getAppUrl()}/api/slack/setup?token=${encodeURIComponent(token)}`;
}

function ephemeralPayload(text: string): Response {
  return jsonResponse({
    response_type: "ephemeral",
    text,
  });
}

function ephemeralBlocks(blocks: unknown[]): Response {
  return jsonResponse({
    response_type: "ephemeral",
    blocks,
  });
}

/**
 * Handles Slack URL verification challenge.
 * Slack sends this when you first configure the Events URL.
 * Must respond with { challenge: "..." } within 3 seconds.
 */
async function handleUrlVerification(body: unknown): Promise<Response> {
  if (!isRecord(body) || typeof body.challenge !== "string") {
    return jsonResponse({ error: "invalid_challenge" }, 400);
  }
  return jsonResponse({ challenge: body.challenge });
}

async function handleSlashGenerate(
  workspace: NonNullable<Awaited<ReturnType<typeof getWorkspaceConfig>>>,
  parsed: Extract<ParsedCommand, { action: "generate" }>,
  channelId: string,
  userId: string,
  threadTs: string | undefined
): Promise<Response> {
  if (
    !workspace.setup_completed ||
    !workspace.bloom_api_key.trim() ||
    !workspace.brand_session_id.trim()
  ) {
    const url = await ensureSetupUrl(workspace.team_id);
    return ephemeralPayload(
      `Bloom is not set up for this workspace yet. Finish setup here: ${url}`
    );
  }

  const jobId = await createJob({
    team_id: workspace.team_id,
    channel_id: channelId,
    user_id: userId,
    prompt: parsed.prompt,
    aspect_ratio: parsed.ratio,
    variants: parsed.variants,
    thread_ts: threadTs,
  });

  const loadingTs = await postMessage(
    workspace.bot_token,
    channelId,
    buildLoadingBlocks(parsed.prompt, parsed.ratio, userId),
    threadTs
  );

  await updateJob(jobId, { message_ts: loadingTs });

  fireRunGeneration(jobId);

  return emptyOk();
}

/**
 * Handles /bloom-gen slash commands.
 *
 * Supported subcommands:
 *
 * generate {prompt} {ratio}:
 *   1. Check workspace is set up (has Bloom API key + brand)
 *   2. Post loading message to channel
 *   3. Create generation job in database
 *   4. Fire /api/internal/run-generation in background (no await)
 *   5. Return empty 200 to Slack immediately
 *
 * setup {api_key}:
 *   Returns setup link for this workspace
 *
 * brands:
 *   Lists brands from Bloom API
 *
 * credits:
 *   Shows credit balance
 *
 * help / empty:
 *   Shows help message
 *
 * If workspace not set up:
 *   Return ephemeral message with setup link
 */
async function handleSlashCommand(params: URLSearchParams): Promise<Response> {
  const command = (params.get("command") ?? "").trim();
  if (command !== "/bloom-gen") {
    return emptyOk();
  }

  const teamId = params.get("team_id")?.trim() ?? "";
  const channelId = params.get("channel_id")?.trim() ?? "";
  const userId = params.get("user_id")?.trim() ?? "";
  const text = params.get("text") ?? "";
  const threadTsRaw = params.get("thread_ts")?.trim();
  const threadTs =
    threadTsRaw && threadTsRaw.length > 0 ? threadTsRaw : undefined;

  if (!teamId || !channelId || !userId) {
    return ephemeralPayload("Missing Slack context on this command.");
  }

  try {
    await initDb();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    return ephemeralPayload(`Server error: ${msg}`);
  }

  const workspace = await getWorkspaceConfig(teamId);
  if (!workspace?.bot_token) {
    return ephemeralPayload(
      "This workspace is not registered with Bloom yet. Install the app from your Slack admin page."
    );
  }

  const parsed = parseSlashCommand(text);

  const needsSetup =
    !workspace.setup_completed ||
    !workspace.bloom_api_key.trim() ||
    !workspace.brand_session_id.trim();

  if (parsed.action === "help") {
    return ephemeralBlocks(buildHelpBlocks());
  }

  if (needsSetup && parsed.action !== "setup") {
    const url = await ensureSetupUrl(workspace.team_id);
    return ephemeralPayload(
      `Bloom needs to be connected for this workspace. Finish setup: ${url}`
    );
  }

  switch (parsed.action) {
    case "generate":
      return handleSlashGenerate(
        workspace,
        parsed,
        channelId,
        userId,
        threadTs
      );
    case "setup": {
      const key = parsed.apiKey?.trim() ?? "";
      if (!key) {
        return ephemeralPayload(
          "Usage: `/bloom-gen setup <your_bloom_api_key>`"
        );
      }
      try {
        await upsertWorkspaceConfig({
          team_id: workspace.team_id,
          bloom_api_key: key,
        });
      } catch {
        return ephemeralPayload("Could not save that API key.");
      }
      const token = await generateSetupToken(workspace.team_id);
      const url = `${getAppUrl()}/api/slack/setup?token=${encodeURIComponent(token)}`;
      return ephemeralPayload(
        `Open this link to choose your Bloom brand (API key saved): ${url}`
      );
    }
    case "brands": {
      try {
        const brands = await listBloomBrands(workspace.bloom_api_key.trim());
        if (!brands.length) {
          return ephemeralPayload("No brands found for this Bloom account.");
        }
        const lines = brands
          .slice(0, 25)
          .map((b) => `• *${b.name || "(unnamed)"}* — \`${b.id}\` (${b.status})`);
        const more =
          brands.length > 25 ? `\n_…and ${brands.length - 25} more._` : "";
        return ephemeralPayload(`*Bloom brands*\n${lines.join("\n")}${more}`);
      } catch {
        return ephemeralPayload(
          "Could not list brands. Check your Bloom API key in setup."
        );
      }
    }
    case "credits": {
      try {
        const { balance, unlimited } = await getBloomCredits(
          workspace.bloom_api_key.trim()
        );
        const bal =
          unlimited === true
            ? "Unlimited"
            : balance !== null
              ? String(balance)
              : "Unknown";
        return ephemeralPayload(`*Bloom credits:* ${bal}`);
      } catch {
        return ephemeralPayload("Could not load Bloom credits.");
      }
    }
    default:
      return ephemeralBlocks(buildHelpBlocks());
  }
}

/**
 * Handles Slack interactive component actions (button clicks).
 *
 * Handles these action IDs:
 *
 * bloom_prev_image / bloom_next_image:
 *   Updates the message to show the previous/next image variant.
 *   Updates current_image_index in the database.
 *
 * bloom_regenerate:
 *   Creates a new job with the same prompt and fires generation.
 *
 * bloom_download:
 *   Slack handles this natively via the URL — no action needed.
 */
async function handleInteraction(
  payload: Record<string, unknown>
): Promise<Response> {
  if (payload.type !== "block_actions") {
    return emptyOk();
  }

  const rawActions = payload.actions;
  if (!Array.isArray(rawActions) || rawActions.length === 0) {
    return emptyOk();
  }

  const act = rawActions[0];
  if (!isRecord(act)) {
    return emptyOk();
  }

  const actionId = typeof act.action_id === "string" ? act.action_id : "";
  const value = typeof act.value === "string" ? act.value : "";

  const teamId =
    isRecord(payload.team) && typeof payload.team.id === "string"
      ? payload.team.id
      : "";
  const channelId =
    isRecord(payload.channel) && typeof payload.channel.id === "string"
      ? payload.channel.id
      : "";
  const messageTs =
    isRecord(payload.message) && typeof payload.message.ts === "string"
      ? payload.message.ts
      : "";

  if (!teamId || !channelId || !messageTs || !actionId) {
    return emptyOk();
  }

  try {
    await initDb();
  } catch {
    return emptyOk();
  }

  const workspace = await getWorkspaceConfig(teamId);
  if (!workspace?.bot_token) {
    return emptyOk();
  }

  if (actionId === "bloom_download") {
    return emptyOk();
  }

  if (actionId === "bloom_prev_image" || actionId === "bloom_next_image") {
    if (!value) {
      return emptyOk();
    }
    const job = await getJob(value);
    if (!job || !job.image_urls.length) {
      return emptyOk();
    }
    let idx = job.current_image_index;
    if (actionId === "bloom_prev_image") {
      idx = Math.max(0, idx - 1);
    } else {
      idx = Math.min(job.image_urls.length - 1, idx + 1);
    }
    await updateJob(value, { current_image_index: idx });
    await updateMessage(
      workspace.bot_token,
      channelId,
      messageTs,
      buildResultBlocks(
        job.prompt,
        job.aspect_ratio,
        job.image_urls,
        value,
        idx,
        workspace.brand_name || undefined
      )
    );
    return emptyOk();
  }

  if (actionId === "bloom_regenerate") {
    if (!value) {
      return emptyOk();
    }
    const old = await getJob(value);
    if (!old) {
      return emptyOk();
    }
    const newId = await createJob({
      team_id: old.team_id,
      channel_id: old.channel_id,
      user_id: old.user_id,
      prompt: old.prompt,
      aspect_ratio: old.aspect_ratio,
      variants: old.variants,
      thread_ts: old.thread_ts ?? undefined,
    });
    await updateMessage(
      workspace.bot_token,
      channelId,
      messageTs,
      buildLoadingBlocks(old.prompt, old.aspect_ratio, old.user_id)
    );
    await updateJob(newId, { message_ts: messageTs });
    fireRunGeneration(newId);
    return emptyOk();
  }

  return emptyOk();
}

/**
 * Main router — parses content type and delegates:
 *   - application/json → handleJsonEvent (URL verification)
 *   - application/x-www-form-urlencoded + payload → handleInteraction
 *   - application/x-www-form-urlencoded + command → handleSlashCommand
 */
export async function handleSlackEventsPost(
  _url: string,
  rawBody: string,
  contentType: string
): Promise<Response> {
  const ct = contentType.toLowerCase();

  if (ct.includes("application/json")) {
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    if (isRecord(body) && body.type === "url_verification") {
      return handleUrlVerification(body);
    }
    if (isRecord(body) && body.type === "event_callback") {
      return emptyOk();
    }
    return emptyOk();
  }

  if (ct.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(rawBody);
    const payloadStr = params.get("payload");
    if (payloadStr !== null) {
      let payload: unknown;
      try {
        payload = JSON.parse(payloadStr);
      } catch {
        return new Response("Invalid payload", { status: 400 });
      }
      if (isRecord(payload)) {
        return handleInteraction(payload);
      }
      return new Response("Invalid payload", { status: 400 });
    }
    if (params.has("command")) {
      return handleSlashCommand(params);
    }
  }

  return new Response("Unsupported content type", { status: 415 });
}
