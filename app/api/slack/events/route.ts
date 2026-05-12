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
 * Handles Slack POSTs: URL verification first, then signature verification,
 * then the events router.
 *
 * Event Subscriptions URL verification uses `application/json` with
 * `type: url_verification`. That challenge is answered **before** signature
 * verification so Slack can complete initial Events URL setup reliably.
 */
export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      const json: unknown = JSON.parse(rawBody);
      if (
        typeof json === "object" &&
        json !== null &&
        !Array.isArray(json) &&
        (json as { type?: unknown }).type === "url_verification" &&
        typeof (json as { challenge?: unknown }).challenge === "string"
      ) {
        return Response.json({
          challenge: (json as { challenge: string }).challenge,
        });
      }
    } catch {
      // not JSON, continue
    }
  }

  if (!(await verifySlackSignature(req, rawBody))) {
    return new Response("Unauthorized", { status: 401 });
  }

  return handleSlackEventsPost(req.url, rawBody, contentType);
}
