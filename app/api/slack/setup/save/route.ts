/**
 * app/api/slack/setup/save/route.ts
 *
 * Persists Bloom workspace configuration from the web setup UI.
 */

import { NextResponse } from "next/server";

import { getWorkspaceBySetupToken, initDb, upsertWorkspaceConfig } from "@/lib/db";
import { openDm, postMessage } from "@/lib/slack";

/** Returns true if value is a non-null object (not an array). */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * POST /api/slack/setup/save
 *
 * Saves the Bloom API key and brand selection for a workspace.
 * Called by the setup page after the user selects a brand.
 *
 * Body: { token, bloom_api_key, brand_id, brand_name, brand_session_id }
 * Response: { success: boolean, error?: string }
 *
 * After saving:
 *   - Sends a DM to the installer:
 *     "🌸 Bloom is ready! Brand set to {brandName}.
 *      Try it: /bloom-bot generate summer sale hero 16:9"
 */
export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (!isRecord(body)) {
    return NextResponse.json({ success: false, error: "Invalid body" });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  const bloomKeyIn =
    typeof body.bloom_api_key === "string" ? body.bloom_api_key.trim() : "";
  const brandId =
    typeof body.brand_id === "string" ? body.brand_id.trim() : "";
  const brandName =
    typeof body.brand_name === "string" ? body.brand_name.trim() : "";
  const brandSessionId =
    typeof body.brand_session_id === "string"
      ? body.brand_session_id.trim()
      : "";

  if (!token || !brandId || !brandName || !brandSessionId) {
    return NextResponse.json({
      success: false,
      error: "Missing token, brand_id, brand_name, or brand_session_id",
    });
  }

  try {
    await initDb();
  } catch (e) {
    const message = e instanceof Error ? e.message : "Database error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }

  const workspace = await getWorkspaceBySetupToken(token);
  if (!workspace) {
    return NextResponse.json({
      success: false,
      error: "Invalid or expired setup link",
    });
  }

  const bloomApiKey =
    bloomKeyIn.length > 0
      ? bloomKeyIn
      : workspace.bloom_api_key.trim().length > 0
        ? workspace.bloom_api_key.trim()
        : "";

  if (!bloomApiKey) {
    return NextResponse.json({
      success: false,
      error: "Bloom API key is required",
    });
  }

  try {
    await upsertWorkspaceConfig({
      team_id: workspace.team_id,
      bloom_api_key: bloomApiKey,
      brand_id: brandId,
      brand_name: brandName,
      brand_session_id: brandSessionId,
      setup_completed: true,
      setup_token: null,
    });

    const installerId = workspace.installed_by?.trim();
    if (installerId && workspace.bot_token) {
      try {
        const dm = await openDm(workspace.bot_token, installerId);
        await postMessage(workspace.bot_token, dm, [
          {
            type: "section",
            text: {
              type: "plain_text",
              text: `🌸 Bloom is ready! Brand set to ${brandName}.\nTry it: /bloom-bot generate summer sale hero 16:9`,
              emoji: true,
            },
          },
        ]);
      } catch {
        /* DM is best-effort */
      }
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to save configuration";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
