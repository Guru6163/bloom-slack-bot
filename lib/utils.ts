/**
 * lib/utils.ts
 *
 * Utility functions for request verification and command parsing.
 */

export type ParsedCommand =
  | { action: "generate"; prompt: string; ratio: string; variants: number }
  | { action: "setup"; apiKey: string }
  | { action: "brands" }
  | { action: "credits" }
  | { action: "help" };

const RATIO_ALIASES: Record<string, string> = {
  square: "1:1",
  landscape: "16:9",
  portrait: "9:16",
  story: "9:16",
};

/** Applies Bloom slash-command ratio aliases (e.g. `square` → `1:1`). */
function resolveRatioToken(token: string): string {
  const key = token.toLowerCase();
  return RATIO_ALIASES[key] ?? token;
}

/** True if the token is an alias or matches `digits:digits` ratio syntax. */
function isKnownRatioShape(token: string): boolean {
  const t = token.toLowerCase();
  if (t in RATIO_ALIASES) {
    return true;
  }
  return /^\d+:\d+$/.test(token);
}

/** Constant-time equality for hex signature strings of equal length. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

/** Lowercase hex encoding of a SHA-256 HMAC digest buffer. */
function hexFromBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Verifies that an incoming request is genuinely from Slack.
 * Computes HMAC-SHA256 of the raw request body using the
 * SLACK_SIGNING_SECRET and compares to the x-slack-signature header.
 * Returns false if the signature is missing or invalid.
 * This prevents anyone from spoofing Slack requests to our endpoint.
 */
export async function verifySlackSignature(
  req: Request,
  rawBody: string
): Promise<boolean> {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    return false;
  }

  const timestamp = req.headers.get("x-slack-request-timestamp");
  const signature = req.headers.get("x-slack-signature");
  if (!timestamp || !signature || !signature.startsWith("v0=")) {
    return false;
  }

  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > 60 * 5) {
    return false;
  }

  const baseString = `v0:${timestamp}:${rawBody}`;

  const enc = new TextEncoder();
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "raw",
      enc.encode(signingSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
  } catch {
    return false;
  }

  let mac: ArrayBuffer;
  try {
    mac = await crypto.subtle.sign("HMAC", key, enc.encode(baseString));
  } catch {
    return false;
  }

  const expected = `v0=${hexFromBuffer(mac)}`;
  return timingSafeEqualHex(
    expected.toLowerCase(),
    signature.toLowerCase()
  );
}

/**
 * Parses a /bloom-gen slash command text into structured parts.
 *
 * Supported commands:
 *   generate {prompt} {ratio}   → { action: 'generate', prompt, ratio }
 *   setup {api_key}             → { action: 'setup', apiKey }
 *   brands                      → { action: 'brands' }
 *   credits                     → { action: 'credits' }
 *   help                        → { action: 'help' }
 *   (empty)                     → { action: 'help' }
 *
 * Ratio aliases:
 *   square = 1:1
 *   landscape = 16:9
 *   portrait = 9:16
 *   story = 9:16
 *
 * Examples:
 *   "generate summer sale banner 16:9" →
 *     { action: 'generate', prompt: 'summer sale banner', ratio: '16:9' }
 *   "generate summer sale banner landscape" →
 *     { action: 'generate', prompt: 'summer sale banner', ratio: '16:9' }
 */
export function parseSlashCommand(text: string): ParsedCommand {
  const raw = text.trim();
  if (!raw) {
    return { action: "help" };
  }

  const tokens = raw.split(/\s+/).filter(Boolean);
  const cmd = tokens[0]?.toLowerCase() ?? "";

  if (cmd === "help") {
    return { action: "help" };
  }

  if (cmd === "brands") {
    return tokens.length === 1 ? { action: "brands" } : { action: "help" };
  }

  if (cmd === "credits") {
    return tokens.length === 1 ? { action: "credits" } : { action: "help" };
  }

  if (cmd === "setup") {
    const apiKey = tokens.slice(1).join(" ").trim();
    if (!apiKey) {
      return { action: "help" };
    }
    return { action: "setup", apiKey };
  }

  if (cmd === "generate") {
    if (tokens.length < 3) {
      return { action: "help" };
    }

    let variants = 1;
    let ratioIndex = tokens.length - 1;

    const last = tokens[tokens.length - 1]!;
    const secondLast = tokens[tokens.length - 2];
    if (
      tokens.length >= 4 &&
      /^[1-5]$/.test(last) &&
      secondLast !== undefined &&
      isKnownRatioShape(secondLast)
    ) {
      variants = Number.parseInt(last, 10);
      ratioIndex = tokens.length - 2;
    }

    const ratioToken = tokens[ratioIndex]!;
    const prompt = tokens.slice(1, ratioIndex).join(" ").trim();
    if (!prompt) {
      return { action: "help" };
    }

    const ratio = resolveRatioToken(ratioToken);
    return { action: "generate", prompt, ratio, variants };
  }

  return { action: "help" };
}
