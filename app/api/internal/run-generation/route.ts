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
import { isInternalRequest } from "@/lib/internal-auth";
import {
  buildErrorBlocks,
  buildResultBlocks,
  updateMessage,
} from "@/lib/slack";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
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

/**
 * Runs Bloom generation for a job and updates the Slack message.
 * Long-running; intended to be invoked from a separate serverless invocation.
 */
export async function POST(req: Request): Promise<Response> {
  if (!isInternalRequest(req)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const jobId =
    isRecord(body) && typeof body.job_id === "string" ? body.job_id.trim() : "";
  if (!jobId) {
    return new Response("Missing job_id", { status: 400 });
  }

  try {
    await initDb();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "db error";
    return new Response(msg, { status: 500 });
  }

  const job = await getJob(jobId);
  if (!job) {
    return new Response("Job not found", { status: 404 });
  }

  const workspace = await getWorkspaceConfig(job.team_id);
  if (!workspace?.bot_token) {
    await updateJob(jobId, {
      status: "failed",
      error: "Workspace bot token missing",
    });
    return new Response("No workspace", { status: 400 });
  }

  if (!workspace.bloom_api_key?.trim() || !workspace.brand_session_id?.trim()) {
    await updateJob(jobId, {
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
            jobId
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

  await updateJob(jobId, { status: "generating", error: null });

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

    await updateJob(jobId, {
      status: "completed",
      image_urls: imageUrls,
      current_image_index: 0,
      error: null,
    });

    await updateMessage(
      workspace.bot_token,
      job.channel_id,
      job.message_ts,
      buildResultBlocks(
        job.prompt,
        job.aspect_ratio,
        imageUrls,
        jobId,
        0,
        workspace.brand_name || undefined
      )
    );

    return new Response("OK", { status: 200 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Generation failed";
    await updateJob(jobId, {
      status: "failed",
      error: message,
    });
    try {
      await updateMessage(
        workspace.bot_token,
        job.channel_id,
        job.message_ts,
        buildErrorBlocks(job.prompt, message, jobId)
      );
    } catch {
      /* best-effort */
    }
    return new Response(message, { status: 500 });
  }
}
