/**
 * app/api/slack/install/route.ts
 *
 * Slack OAuth "Add to Slack" install entrypoint.
 */

import { NextResponse } from "next/server";

import { getAppUrl } from "@/lib/app-url";

/**
 * GET /api/slack/install
 *
 * Redirects the user to Slack's OAuth authorization page.
 * This is the "Add to Slack" button destination.
 *
 * Slack will redirect back to /api/slack/oauth after the user
 * approves the app installation.
 *
 * @param req Unused; present for the Next.js `Request` route signature.
 */
export async function GET(req: Request): Promise<Response> {
  const clientId = process.env.SLACK_CLIENT_ID?.trim();
  if (!clientId) {
    return new NextResponse("Missing SLACK_CLIENT_ID", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const appUrl = getAppUrl();
  const redirectUri = `${appUrl}/api/slack/oauth`;

  const params = new URLSearchParams({
    client_id: clientId,
    scope: "commands,chat:write,chat:write.public,files:write",
    redirect_uri: redirectUri,
  });

  const authorizeUrl = `https://slack.com/oauth/v2/authorize?${params.toString()}`;
  return NextResponse.redirect(authorizeUrl);
}
