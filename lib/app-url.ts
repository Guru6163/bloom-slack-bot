/**
 * lib/app-url.ts
 *
 * Resolves the base URL of the deployed app.
 * Used to build setup links, OAuth redirect URLs, etc.
 */

/**
 * Returns the base URL of the app.
 * In production: uses NEXT_PUBLIC_APP_URL env var.
 * In development: falls back to http://localhost:3000.
 */
export function getAppUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/+$/, "");
  }
  return "http://localhost:3000";
}
