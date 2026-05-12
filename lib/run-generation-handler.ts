/**
 * run-generation-handler.ts
 *
 * Core generation logic called by the internal route.
 * Separated from the route file for clarity and testability.
 */

import {
  generateBloomImages,
  getBloomImageUrl,
  pollBloomImages,
  type BloomAspectRatio,
} from "@/lib/bloom";
import {
  getJob,
  getWorkspaceConfig,
  initDb,
  updateJob,
} from "@/lib/db";
import {
  buildErrorBlocks,
  buildResultBlocks,
  updateMessage,
} from "@/lib/slack";

function escapeMrkdwn(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) {
    return s;
  }
  return `${s.slice(0, max - 1)}…`;
}

function toAspectRatio(ratio: string): BloomAspectRatio {
  const allowed = new Set<string>([
    "1:1",
    "2:3",
    "3:2",
    "3:4",
    "4:3",
    "4:5",
    "5:4",
    "9:16",
    "16:9",
    "21:9",
  ]);
  if (allowed.has(ratio)) {
    return ratio as BloomAspectRatio;
  }
  return "1:1";
}

function buildGeneratingStageBlocks(prompt: string): unknown[] {
  const p = escapeMrkdwn(truncate(prompt, 600));
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*⏳ Generating your images...*\n_${p}_`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "_Hang tight — Bloom is creating your variants._",
        },
      ],
    },
  ];
}

/**
 * Runs the full generation pipeline for a job:
 * load config → update to generating → generate → poll → update result
 *
 * Updates the Slack message at each stage:
 *   Stage 1: "⏳ Generating your images..."
 *   Stage 2: "✅ Done" with image + buttons
 *   On error: "❌ Generation failed" with retry button
 */
export async function handleRunGeneration(body: {
  jobId?: string;
}): Promise<Response> {
  const rawId = body.jobId?.trim() ?? "";
  if (!rawId) {
    return new Response("Missing jobId", { status: 400 });
  }

  try {
    await initDb();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    return new Response(msg, { status: 500 });
  }

  const job = await getJob(rawId);
  if (!job) {
    return new Response("Job not found", { status: 404 });
  }

  const workspace = await getWorkspaceConfig(job.team_id);
  if (!workspace?.bot_token) {
    await updateJob(rawId, {
      status: "failed",
      error: "Workspace bot token missing",
    });
    return new Response("No workspace", { status: 400 });
  }

  if (!workspace.bloom_api_key?.trim() || !workspace.brand_session_id?.trim()) {
    await updateJob(rawId, {
      status: "failed",
      error: "Bloom is not configured for this workspace",
    });
    if (job.message_ts) {
      try {
        await updateMessage(
          workspace.bot_token,
          job.channel_id,
          job.message_ts,
          buildErrorBlocks(
            job.prompt,
            "Bloom is not configured for this workspace.",
            rawId,
            "❌ Generation failed"
          )
        );
      } catch {
        /* best-effort */
      }
    }
    return new Response("Not configured", { status: 400 });
  }

  if (!job.message_ts) {
    return new Response("Job missing message_ts", { status: 400 });
  }

  await updateJob(rawId, { status: "generating", error: null });

  try {
    await updateMessage(
      workspace.bot_token,
      job.channel_id,
      job.message_ts,
      buildGeneratingStageBlocks(job.prompt)
    );
  } catch {
    /* Slack update is best-effort; continue with Bloom work */
  }

  try {
    const aspect = toAspectRatio(job.aspect_ratio);
    const imageIds = await generateBloomImages(
      workspace.bloom_api_key.trim(),
      workspace.brand_session_id.trim(),
      job.prompt,
      aspect,
      job.variants
    );
    const images = await pollBloomImages(
      workspace.bloom_api_key.trim(),
      imageIds
    );
    const imageUrls = images.map((img) => getBloomImageUrl(img));

    await updateJob(rawId, {
      status: "completed",
      image_urls: imageUrls,
      current_image_index: 0,
      error: null,
    });

    const resultBlocks = buildResultBlocks(
      job.prompt,
      job.aspect_ratio,
      imageUrls,
      rawId,
      0,
      workspace.brand_name || undefined
    );

    await updateMessage(workspace.bot_token, job.channel_id, job.message_ts, [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*✅ Done*",
        },
      },
      ...resultBlocks,
    ]);

    return new Response("OK", { status: 200 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Generation failed";
    await updateJob(rawId, {
      status: "failed",
      error: message,
    });
    try {
      await updateMessage(
        workspace.bot_token,
        job.channel_id,
        job.message_ts,
        buildErrorBlocks(job.prompt, message, rawId, "❌ Generation failed")
      );
    } catch {
      /* best-effort */
    }
    return new Response(message, { status: 500 });
  }
}
