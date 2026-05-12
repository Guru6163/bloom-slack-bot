import { NextResponse } from "next/server";

import { listBloomBrands, type BloomBrand } from "@/lib/bloom";
import { getWorkspaceBySetupToken, initDb } from "@/lib/db";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * POST /api/slack/setup/validate-key
 *
 * Validates a Bloom API key and returns the list of brands.
 * Called by the setup page JavaScript before saving.
 *
 * Body: { api_key: string, token: string }
 * Response: { valid: boolean, brands: BloomBrand[] }
 */
export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { valid: false, brands: [] as BloomBrand[] },
      { status: 400 }
    );
  }

  if (!isRecord(body)) {
    return NextResponse.json({ valid: false, brands: [] });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  const apiKeyRaw =
    typeof body.api_key === "string" ? body.api_key.trim() : "";

  if (!token) {
    return NextResponse.json({ valid: false, brands: [] });
  }

  try {
    await initDb();
  } catch {
    return NextResponse.json(
      { valid: false, brands: [] },
      { status: 500 }
    );
  }

  const workspace = await getWorkspaceBySetupToken(token);
  if (!workspace) {
    return NextResponse.json({ valid: false, brands: [] });
  }

  const keyToUse =
    apiKeyRaw.length > 0
      ? apiKeyRaw
      : workspace.bloom_api_key.trim().length > 0
        ? workspace.bloom_api_key.trim()
        : "";

  if (!keyToUse) {
    return NextResponse.json({ valid: false, brands: [] });
  }

  try {
    const brands = await listBloomBrands(keyToUse);
    return NextResponse.json({ valid: true, brands });
  } catch {
    return NextResponse.json({ valid: false, brands: [] });
  }
}
