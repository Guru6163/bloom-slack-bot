/**
 * lib/slack.ts
 *
 * Slack Web API client and Block Kit message builders.
 * All Slack API calls go through slackApi().
 * All message formats are built by the builder functions below.
 */

const SLACK_API_BASE = "https://slack.com/api";

const MAX_PROMPT_PREVIEW = 2800;
const MAX_ALT_TEXT = 2000;

/** Type guard: plain object (not array, not null). */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Escapes characters that break Slack mrkdwn in user-provided strings. */
function escapeMrkdwn(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Truncates a string to a maximum length with an ellipsis suffix. */
function truncate(s: string, max: number): string {
  if (s.length <= max) {
    return s;
  }
  return `${s.slice(0, max - 1)}…`;
}

/**
 * Makes an authenticated call to the Slack Web API.
 * Throws a descriptive error if Slack returns ok: false.
 */
export async function slackApi(
  endpoint: string,
  botToken: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const path = endpoint.replace(/^\/+/, "");
  const url = `${SLACK_API_BASE}/${path}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error(
      `Slack API ${path} returned non-JSON (HTTP ${res.status} ${res.statusText})`
    );
  }

  if (!isRecord(data)) {
    throw new Error(`Slack API ${path} returned an unexpected payload`);
  }

  if (data.ok !== true) {
    const code =
      typeof data.error === "string" ? data.error : "unknown_error";
    const meta = data.response_metadata;
    let extra = "";
    if (isRecord(meta) && Array.isArray(meta.messages)) {
      extra = JSON.stringify(meta.messages).slice(0, 200);
    }
    throw new Error(
      `Slack API ${path} failed: ${code}${extra ? ` (${extra})` : ""}`
    );
  }

  return data;
}

/**
 * Posts a new message to a Slack channel or thread.
 * Returns the message timestamp (ts) needed for later updates.
 */
export async function postMessage(
  botToken: string,
  channel: string,
  blocks: unknown[],
  threadTs?: string
): Promise<string> {
  const body: Record<string, unknown> = {
    channel,
    blocks,
  };
  if (threadTs !== undefined && threadTs !== "") {
    body.thread_ts = threadTs;
  }

  const data = await slackApi("chat.postMessage", botToken, body);
  const ts = data.ts;
  if (typeof ts !== "string" || !ts) {
    throw new Error("Slack chat.postMessage did not return a message ts");
  }
  return ts;
}

/**
 * Updates an existing Slack message in place.
 * Used to replace the loading message with the final result.
 */
export async function updateMessage(
  botToken: string,
  channel: string,
  ts: string,
  blocks: unknown[]
): Promise<void> {
  await slackApi("chat.update", botToken, {
    channel,
    ts,
    blocks,
  });
}

/**
 * Opens a DM channel with a user and returns the channel ID.
 * Used to send the setup link to the workspace installer.
 */
export async function openDm(botToken: string, userId: string): Promise<string> {
  const data = await slackApi("conversations.open", botToken, {
    users: userId,
  });

  const channel = data.channel;
  if (!isRecord(channel) || typeof channel.id !== "string" || !channel.id) {
    throw new Error("Slack conversations.open did not return a DM channel id");
  }

  return channel.id;
}

/**
 * Loading message shown while generation is in progress.
 * Shows prompt, ratio, and who requested it.
 */
export function buildLoadingBlocks(
  prompt: string,
  ratio: string,
  userId: string
): unknown[] {
  const p = escapeMrkdwn(truncate(prompt, MAX_PROMPT_PREVIEW));
  const r = escapeMrkdwn(truncate(ratio, 80));

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Generating image…*\n*Prompt:* ${p}\n*Aspect ratio:* ${r}\n*Requested by:* <@${userId}>`,
      },
    },
    { type: "divider" },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "_Bloom is generating your on-brand image._",
        },
      ],
    },
  ];
}

/**
 * Result message shown when generation completes.
 * Shows the image with navigation (◀ ▶) if multiple variants.
 * Includes: Regenerate, Download buttons.
 * Shows "Image N of M" counter.
 */
export function buildResultBlocks(
  prompt: string,
  ratio: string,
  imageUrls: string[],
  jobId: string,
  currentIndex: number,
  brandName?: string
): unknown[] {
  const total = imageUrls.length;
  const idx = Math.min(Math.max(0, currentIndex), Math.max(0, total - 1));
  const imageUrl = total > 0 ? imageUrls[idx] : "";
  const p = escapeMrkdwn(truncate(prompt, MAX_PROMPT_PREVIEW));
  const r = escapeMrkdwn(truncate(ratio, 80));

  const blocks: unknown[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Prompt:* ${p}\n*Aspect ratio:* ${r}`,
      },
    },
  ];

  if (imageUrl && /^https:\/\//i.test(imageUrl)) {
    blocks.push({
      type: "image",
      image_url: imageUrl,
      alt_text: truncate(
        `Bloom result ${idx + 1} of ${total}: ${prompt}`,
        MAX_ALT_TEXT
      ),
      title: {
        type: "plain_text",
        text: truncate(`Variant ${idx + 1} of ${total}`, 80),
        emoji: true,
      },
    });
  } else if (imageUrl) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `_Image ready — open link manually:_ <${imageUrl}|View image>`,
      },
    });
  }

  const brandEsc =
    brandName !== undefined && brandName.trim() !== ""
      ? escapeMrkdwn(truncate(brandName.trim(), 200))
      : "";

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text:
          total > 0
            ? brandEsc !== ""
              ? `_Brand: ${brandEsc} · Image ${idx + 1} of ${total}_`
              : `_Image ${idx + 1} of ${total}_`
            : "_No image URL available._",
      },
    ],
  });

  const actions: unknown[] = [];

  if (total > 1) {
    if (idx > 0) {
      actions.push({
        type: "button",
        text: { type: "plain_text", text: "◀", emoji: true },
        action_id: "bloom_prev_image",
        value: jobId,
      });
    }
    if (idx < total - 1) {
      actions.push({
        type: "button",
        text: { type: "plain_text", text: "▶", emoji: true },
        action_id: "bloom_next_image",
        value: jobId,
      });
    }
  }

  actions.push({
    type: "button",
    text: { type: "plain_text", text: "Regenerate", emoji: true },
    style: "primary",
    action_id: "bloom_regenerate",
    value: jobId,
  });

  if (imageUrl) {
    if (/^https:\/\//i.test(imageUrl)) {
      actions.push({
        type: "button",
        text: { type: "plain_text", text: "Download", emoji: true },
        action_id: "bloom_download",
        url: imageUrl,
      });
    } else {
      actions.push({
        type: "button",
        text: { type: "plain_text", text: "Download", emoji: true },
        action_id: "bloom_download",
        url: imageUrl.startsWith("http") ? imageUrl : `https://${imageUrl}`,
      });
    }
  }

  if (actions.length > 0) {
    blocks.push({
      type: "actions",
      elements: actions,
    });
  }

  return blocks;
}

/**
 * Error message shown when generation fails.
 * Shows the error with a Try Again button.
 */
/**
 * Builds error / retry blocks for failed generations.
 *
 * @param prompt Original user prompt (shown truncated/escaped).
 * @param error Error message (escaped for inline code).
 * @param jobId Job id passed to the Try Again button value.
 * @param headline Bold headline line (defaults to a generic message).
 */
export function buildErrorBlocks(
  prompt: string,
  error: string,
  jobId: string,
  headline = "Something went wrong"
): unknown[] {
  const p = escapeMrkdwn(truncate(prompt, MAX_PROMPT_PREVIEW));
  const e = escapeMrkdwn(truncate(error, 1500)).replace(/`/g, "'");
  const h = escapeMrkdwn(truncate(headline, 200));

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${h}*\n*Prompt:* ${p}\n*Error:* \`${e}\``,
      },
    },
    { type: "divider" },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Try Again", emoji: true },
          style: "primary",
          action_id: "bloom_regenerate",
          value: jobId,
        },
      ],
    },
  ];
}

/**
 * Help message shown for /bloom-bot help.
 * Lists all available commands with examples.
 */
export function buildHelpBlocks(): unknown[] {
  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Bloom — on-brand images in Slack",
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "Use `/bloom-bot` to generate images that match your connected Bloom brand.",
      },
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          "*Examples*",
          "`/bloom-bot generate summer sale hero 16:9`",
          "`/bloom-bot generate product launch banner` _(ratio defaults to 1:1)_",
          "`/bloom-bot brands`",
          "`/bloom-bot credits`",
          "`/bloom-bot help`",
          "`/bloom-bot setup <your_bloom_api_key>`",
          "",
          "The workspace **brand** from setup is used automatically — no `--brand` flag.",
          "",
          "Optional ratio at end of `generate`: `1:1`, `4:5`, `9:16`, `16:9`, etc. Aliases: `square`, `landscape`, `portrait`, `story`.",
        ].join("\n"),
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "Docs: <https://www.trybloom.ai/api/v1/docs|Bloom API> · Slash command: `/bloom-bot`",
        },
      ],
    },
  ];
}
