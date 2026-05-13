/**
 * app/api/internal/run-generation/route.ts
 *
 * HTTP entry for long-running Bloom image generation (internal only).
 */

import { handleRunGeneration } from "@/lib/run-generation-handler";
import { isInternalRequest } from "@/lib/internal-auth";

export const maxDuration = 300;

export async function POST(req: Request): Promise<Response> {
  if (!isInternalRequest(req)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const body = await req.json();
  return handleRunGeneration(body);
}
