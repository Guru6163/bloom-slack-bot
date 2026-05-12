/**
 * app/api/slack/setup/init/route.ts
 *
 * Verifies `workspace_configs` and `generation_jobs` exist (see `initDb` in lib/db).
 * Tables are created in the Supabase SQL editor, not by this route.
 */

import { NextResponse } from "next/server";

import { initDb } from "@/lib/db";

/**
 * GET /api/slack/setup/init
 *
 * Returns JSON indicating whether the database tables are reachable.
 */
export async function GET(): Promise<Response> {
  try {
    await initDb();
    return NextResponse.json({
      ok: true,
      message: "Database ready. Both tables exist.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
