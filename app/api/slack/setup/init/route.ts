/**
 * app/api/slack/setup/init/route.ts
 *
 * One-shot database initialization (creates tables via initDb).
 * Safe to call multiple times — uses IF NOT EXISTS.
 */

import { NextResponse } from "next/server";

import { initDb } from "@/lib/db";

/**
 * Runs database migrations / table creation.
 * Intended to be visited once after deploy (see README).
 */
export async function GET(): Promise<Response> {
  try {
    await initDb();
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "init failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
