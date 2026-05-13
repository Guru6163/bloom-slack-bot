/**
 * lib/internal-auth.ts
 *
 * Protects internal API routes from external access.
 * Internal routes (/api/internal/*) are only called by the app itself,
 * never by Slack or external services.
 *
 * Uses a Bearer token from INTERNAL_SECRET env var.
 */

/**
 * Returns true if the request has a valid internal Bearer token.
 * Routes protected by this should return 401 if it returns false.
 */
export function isInternalRequest(req: Request): boolean {
  const auth = req.headers.get("Authorization");
  if (!auth) {
    return false;
  }
  const token = auth.replace("Bearer ", "").trim();
  return token === process.env.INTERNAL_SECRET;
}

/**
 * Returns the Authorization header value for internal requests.
 * Used when one route needs to call another route internally.
 */
export function getInternalAuthHeader(): string {
  const secret = process.env.INTERNAL_SECRET ?? "";
  return `Bearer ${secret}`;
}
