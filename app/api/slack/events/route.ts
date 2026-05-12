import { handleSlackEventsPost } from "@/lib/slack-events-handler";
import { verifySlackSignature } from "@/lib/utils";

/**
 * app/api/slack/events/route.ts
 *
 * Receives all incoming events from Slack:
 *   - Slash commands (/bloom-gen)
 *   - Button interactions (prev, next, regenerate, download)
 *   - URL verification challenge
 *
 * CRITICAL: Must respond to Slack within 3 seconds.
 * Heavy work (generation) is fired in the background.
 */
/**
 * Health check for monitoring (`?test=1`); otherwise 404.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.searchParams.get("test") === "1") {
    return Response.json({ ok: true });
  }
  return new Response("Not found", { status: 404 });
}

/**
 * Verifies Slack signing secret, then delegates to the Slack events router.
 */
export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const valid = await verifySlackSignature(req, rawBody);
  if (!valid) {
    return new Response("invalid signature", { status: 401 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  return handleSlackEventsPost(req.url, rawBody, contentType);
}
