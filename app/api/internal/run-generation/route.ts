import { handleRunGeneration } from "@/lib/run-generation-handler";
import { isInternalRequest } from "@/lib/internal-auth";

/**
 * POST /api/internal/run-generation
 *
 * Long-running route that generates Bloom images and updates
 * the Slack message when done.
 *
 * This runs AFTER Slack has already received the 200 response.
 * maxDuration is set to 300 seconds in vercel.json.
 *
 * Protected by Bearer token (INTERNAL_SECRET).
 * Only called by the slack-events-handler — never by Slack directly.
 *
 * Flow:
 * 1. Validate internal auth
 * 2. Get job from database
 * 3. Get workspace config (API key, brand, bot token)
 * 4. Update Slack message to "generating" state
 * 5. Call generateBloomImages() → get image IDs
 * 6. Call pollBloomImages() → wait for completion
 * 7. Save image URLs to database
 * 8. Update Slack message with result blocks + buttons
 * 9. On any error: update Slack message with error blocks
 */
export const maxDuration = 300;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function POST(req: Request): Promise<Response> {
  if (!isInternalRequest(req)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const jobId =
    (isRecord(parsed) && typeof parsed.jobId === "string" && parsed.jobId.trim()) ||
    (isRecord(parsed) && typeof parsed.job_id === "string" && parsed.job_id.trim()) ||
    "";

  return handleRunGeneration({ jobId: jobId || undefined });
}
