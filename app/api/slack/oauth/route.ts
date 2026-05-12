import { NextResponse } from "next/server";

import { getAppUrl } from "@/lib/app-url";
import { generateSetupToken, initDb, upsertWorkspaceConfig } from "@/lib/db";
import { openDm, postMessage } from "@/lib/slack";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlResponse(
  title: string,
  bodyInnerHtml: string,
  status: number
): Response {
  const safeTitle = escapeHtml(title);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
</head>
<body>
${bodyInnerHtml}
</body>
</html>`;

  return new NextResponse(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * GET /api/slack/oauth
 *
 * Handles the OAuth callback from Slack after app installation.
 *
 * Flow:
 * 1. Exchange the code param for a bot token via oauth.v2.access
 * 2. Save workspace to database (team_id, bot_token, team_name)
 * 3. Generate a setup token for this workspace
 * 4. Send a DM to the installer with the setup link
 * 5. Redirect to a success page or return success HTML
 *
 * On error: return a simple error HTML page.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const oauthError = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  if (oauthError) {
    const detail = errorDescription
      ? `${oauthError}: ${errorDescription}`
      : oauthError;
    return htmlResponse(
      "Installation failed",
      `<h1>Installation did not complete</h1><p>${escapeHtml(detail)}</p>`,
      400
    );
  }

  const code = url.searchParams.get("code");
  if (!code) {
    return htmlResponse(
      "Installation failed",
      "<h1>Missing authorization code</h1><p>Slack did not return a <code>code</code> query parameter.</p>",
      400
    );
  }

  const clientId = process.env.SLACK_CLIENT_ID?.trim();
  const clientSecret = process.env.SLACK_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return htmlResponse(
      "Configuration error",
      "<h1>Server misconfiguration</h1><p>Slack OAuth credentials are not configured.</p>",
      500
    );
  }

  const appUrl = getAppUrl();
  const redirectUri = `${appUrl}/api/slack/oauth`;

  let tokenJson: unknown;
  try {
    const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    tokenJson = await tokenRes.json();
  } catch {
    return htmlResponse(
      "Installation failed",
      "<h1>Could not reach Slack</h1><p>The token exchange request failed. Try again in a moment.</p>",
      502
    );
  }

  if (!isRecord(tokenJson) || tokenJson.ok !== true) {
    const err =
      isRecord(tokenJson) && typeof tokenJson.error === "string"
        ? tokenJson.error
        : "unknown_error";
    return htmlResponse(
      "Installation failed",
      `<h1>Could not complete installation</h1><p>Slack returned: <code>${escapeHtml(err)}</code></p>`,
      400
    );
  }

  const accessToken =
    typeof tokenJson.access_token === "string" ? tokenJson.access_token : "";
  if (!accessToken) {
    return htmlResponse(
      "Installation failed",
      "<h1>Invalid Slack response</h1><p>No bot access token was returned.</p>",
      500
    );
  }

  const team = tokenJson.team;
  const teamId =
    isRecord(team) && typeof team.id === "string" ? team.id : undefined;
  const teamName =
    isRecord(team) && typeof team.name === "string" ? team.name : "";

  if (!teamId) {
    return htmlResponse(
      "Installation failed",
      "<h1>Invalid Slack response</h1><p>Missing workspace (team) id from Slack.</p>",
      500
    );
  }

  const botUserId =
    typeof tokenJson.bot_user_id === "string" ? tokenJson.bot_user_id : null;

  const authedUser = tokenJson.authed_user;
  const installerUserId =
    isRecord(authedUser) && typeof authedUser.id === "string"
      ? authedUser.id
      : undefined;

  try {
    await initDb();
    await upsertWorkspaceConfig({
      team_id: teamId,
      team_name: teamName,
      bot_token: accessToken,
      bot_user_id: botUserId,
      installer_user_id: installerUserId ?? null,
    });

    const setupToken = await generateSetupToken(teamId);
    const setupUrl = `${appUrl}/api/slack/setup?token=${encodeURIComponent(setupToken)}`;

    const dmText = `🌸 Bloom is installed! Connect your Bloom account to start
generating on-brand images: ${setupUrl}`;

    if (installerUserId) {
      try {
        const dmChannelId = await openDm(accessToken, installerUserId);
        await postMessage(accessToken, dmChannelId, [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: dmText,
            },
          },
        ]);
      } catch {
        /* DM is best-effort; installation still succeeded */
      }
    }

    return htmlResponse(
      "Bloom installed",
      "<h1>Installation succeeded</h1><p>Bloom has been added to your workspace. Check your Slack DMs for a link to finish setup.</p>",
      200
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "An unexpected error occurred.";
    return htmlResponse(
      "Installation failed",
      `<h1>Could not save installation</h1><p>${escapeHtml(message)}</p>`,
      500
    );
  }
}
