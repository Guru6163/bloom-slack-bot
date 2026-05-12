/**
 * internal-auth.ts
 *
 * Protects internal API routes from external access.
 * Internal routes (/api/internal/*) are only called by the app itself,
 * never by Slack or external services.
 *
 * Uses a Bearer token from INTERNAL_SECRET env var.
 */

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

/**
 * Returns true if the request has a valid internal Bearer token.
 * Routes protected by this should return 401 if it returns false.
 */
export function isInternalRequest(req: Request): boolean {
  const secret = process.env.INTERNAL_SECRET;
  if (!secret) {
    return false;
  }

  const auth = req.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!auth.startsWith(prefix)) {
    return false;
  }

  const token = auth.slice(prefix.length).trim();
  if (!token) {
    return false;
  }

  return timingSafeEqual(token, secret);
}

/**
 * Returns the Authorization header value for internal requests.
 * Used when one route needs to call another route internally.
 */
export function getInternalAuthHeader(): string {
  const secret = process.env.INTERNAL_SECRET ?? "";
  return `Bearer ${secret}`;
}
