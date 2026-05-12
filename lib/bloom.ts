/**
 * bloom.ts
 *
 * Bloom REST API client for the Slack Bot.
 * Handles brand management, image generation, and polling.
 *
 * Base URL: https://www.trybloom.ai/api/v1
 * Auth: x-api-key header on every request
 *
 * API docs: https://www.trybloom.ai/api/v1/docs
 */

const BLOOM_BASE = "https://www.trybloom.ai/api/v1";
/** Site origin for short redirect paths such as `/img/{id}` */
const BLOOM_ORIGIN = "https://www.trybloom.ai";

const MAX_IDS_PER_LIST = 50;

export interface BloomBrand {
  id: string;
  name: string;
  url: string;
  status: string;
  brandSessionId?: string;
  brand_session_id?: string;
}

export interface BloomImage {
  id: string;
  status: string;
  imageUrl?: string;
  url?: string;
}

/** Aspect ratios accepted by `POST /images/generations` (OpenAPI). */
export type BloomAspectRatio =
  | "1:1"
  | "2:3"
  | "3:2"
  | "3:4"
  | "4:3"
  | "4:5"
  | "5:4"
  | "9:16"
  | "16:9"
  | "21:9";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePath(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return path.startsWith("/") ? `${BLOOM_BASE}${path}` : `${BLOOM_BASE}/${path}`;
}

function getData(json: unknown): Record<string, unknown> {
  if (!isRecord(json) || !isRecord(json.data)) {
    throw new Error("Bloom API response missing data envelope");
  }
  return json.data;
}

/**
 * Base fetch function for all Bloom API requests.
 * Adds authentication header and handles error responses.
 * Throws a descriptive error if the API returns a non-2xx status.
 */
async function bloomFetch(
  path: string,
  apiKey: string,
  options?: RequestInit
): Promise<Response> {
  const url = normalizePath(path);
  const headers = new Headers(options?.headers);
  headers.set("x-api-key", apiKey);
  if (
    options?.body !== undefined &&
    options.body !== null &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      detail = "";
    }
    const trimmed = detail.replace(/\s+/g, " ").slice(0, 500);
    throw new Error(
      `Bloom API ${res.status} ${res.statusText}${trimmed ? `: ${trimmed}` : ""}`
    );
  }

  return res;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Bloom API returned invalid JSON");
  }
}

/** `GET /brands` → `{ data: { brands, nextCursor, hasMore } }` */
function parseListBrandsResponse(json: unknown): {
  brands: BloomBrand[];
  nextCursor?: string;
  hasMore?: boolean;
} {
  const data = getData(json);
  const brandsRaw = data.brands;
  if (!Array.isArray(brandsRaw)) {
    return { brands: [] };
  }

  const brands: BloomBrand[] = brandsRaw.filter(isRecord).map((b) => ({
    id: String(b.id ?? ""),
    name: String(b.name ?? ""),
    url: String(b.url ?? ""),
    status: String(b.status ?? ""),
    brandSessionId: asString(b.brandSessionId),
    brand_session_id: asString(b.brand_session_id),
  }));

  return {
    brands,
    nextCursor: asString(data.nextCursor),
    hasMore: typeof data.hasMore === "boolean" ? data.hasMore : undefined,
  };
}

/** `GET /brands/{id}` → `{ data: { id, status, name, url, ... } }` */
function parseGetBrandResponse(json: unknown): BloomBrand {
  const data = getData(json);
  return {
    id: String(data.id ?? ""),
    name: String(data.name ?? ""),
    url: String(data.url ?? ""),
    status: String(data.status ?? ""),
    brandSessionId: asString(data.brandSessionId),
    brand_session_id: asString(data.brand_session_id),
  };
}

/** `POST /images/generations` (202) → `{ data: { ids, variantGroupId?, status } }` */
function parseGenerationCreateResponse(json: unknown): string[] {
  const data = getData(json);
  const idsRaw = data.ids;
  if (!Array.isArray(idsRaw)) {
    throw new Error("Bloom API generations response missing data.ids");
  }
  const ids = idsRaw.filter((id): id is string => typeof id === "string" && id.length > 0);
  if (ids.length === 0) {
    throw new Error("Bloom API generations response contained no image ids");
  }
  return ids;
}

/** `GET /images` or `GET /images/{id}` list item / single resource */
function parseBloomImageFromData(data: Record<string, unknown>): BloomImage {
  return {
    id: String(data.id ?? ""),
    status: String(data.status ?? ""),
    imageUrl: asString(data.imageUrl),
    url: asString(data.url),
  };
}

/** `GET /images/{id}` → `{ data: { id, status, imageUrl, ... } }` */
function parseGetImageResponse(json: unknown): BloomImage {
  return parseBloomImageFromData(getData(json));
}

/** `GET /images` → `{ data: { images: [...], nextCursor?, hasMore? } }` */
function parseListImagesResponse(json: unknown): BloomImage[] {
  const data = getData(json);
  const imagesRaw = data.images;
  if (!Array.isArray(imagesRaw)) {
    return [];
  }
  return imagesRaw.filter(isRecord).map((row) => parseBloomImageFromData(row));
}

function isTransientBloomError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  return /\bBloom API (429|500|502|503|504)\b/.test(err.message);
}

async function withRetries<T>(
  fn: () => Promise<T>,
  opts: { deadlineMs: number; label: string }
): Promise<T> {
  let attempt = 0;
  const maxDelayMs = 4000;
  while (Date.now() < opts.deadlineMs) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (!isTransientBloomError(err) || Date.now() >= opts.deadlineMs) {
        throw err;
      }
      const backoff = Math.min(maxDelayMs, 250 * 2 ** Math.min(attempt, 4));
      const jitter = Math.floor(Math.random() * 200);
      await sleep(backoff + jitter);
    }
  }
  throw new Error(`${opts.label}: timed out waiting for Bloom API`);
}

/**
 * Validates a Bloom API key by attempting to list brands.
 * Returns true if the key is valid, false otherwise.
 * Never throws — safe to call in setup flows.
 */
export async function validateBloomKey(apiKey: string): Promise<boolean> {
  if (!apiKey.trim()) {
    return false;
  }
  try {
    await listBloomBrands(apiKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lists all brands for an API key.
 * Parses `GET /brands` → `{ data: { brands, nextCursor, hasMore } }`.
 */
export async function listBloomBrands(apiKey: string): Promise<BloomBrand[]> {
  const all: BloomBrand[] = [];
  let cursor: string | undefined;

  do {
    const qs = new URLSearchParams();
    qs.set("limit", "100");
    if (cursor) {
      qs.set("cursor", cursor);
    }

    const res = await bloomFetch(`/brands?${qs.toString()}`, apiKey);
    const json = await readJson(res);
    const { brands, nextCursor, hasMore } = parseListBrandsResponse(json);
    all.push(...brands);

    if (!nextCursor || hasMore === false) {
      break;
    }
    cursor = nextCursor;
  } while (true);

  return all;
}

/**
 * Gets a single brand by ID.
 * Used during setup to confirm a brand exists.
 * Parses `GET /brands/{id}` → `{ data: { ... } }`.
 */
export async function getBloomBrand(
  apiKey: string,
  brandId: string
): Promise<BloomBrand> {
  const res = await bloomFetch(
    `/brands/${encodeURIComponent(brandId)}`,
    apiKey
  );
  const json = await readJson(res);
  return parseGetBrandResponse(json);
}

/**
 * Resolves the brandSessionId from a brand object.
 * The Bloom API returns this under different field names
 * depending on the endpoint — this normalises it.
 */
export function resolveBrandSessionId(brand: BloomBrand): string {
  const explicit =
    brand.brandSessionId?.trim() || brand.brand_session_id?.trim();

  if (explicit) {
    return explicit;
  }

  if (brand.id?.trim()) {
    return brand.id.trim();
  }

  throw new Error("Bloom brand is missing a brand session id");
}

/**
 * Starts generating images using the Bloom API.
 * Returns image IDs immediately — generation is async.
 * Pass IDs to pollBloomImages() to wait for completion.
 *
 * @param aspectRatio — Bloom `POST /images/generations` enum (see `BloomAspectRatio`).
 * @param variants — Mapped to `variantCount` (1–5 per OpenAPI).
 */
export async function generateBloomImages(
  apiKey: string,
  brandSessionId: string,
  prompt: string,
  aspectRatio: BloomAspectRatio,
  variants: number
): Promise<string[]> {
  const variantCount = Math.min(5, Math.max(1, Math.floor(variants)));

  const body = {
    brandSessionId,
    prompt,
    aspectRatio,
    variantCount,
  };

  const res = await bloomFetch(`/images/generations`, apiKey, {
    method: "POST",
    body: JSON.stringify(body),
  });

  const json = await readJson(res);
  return parseGenerationCreateResponse(json);
}

function isTerminalFailureStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === "failed";
}

function isCompleteStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === "completed";
}

function assertImagesTerminal(
  images: BloomImage[],
  expectedIds: string[]
): void {
  const byId = new Map(images.map((img) => [img.id, img]));
  for (const id of expectedIds) {
    const img = byId.get(id);
    if (!img) {
      throw new Error(`Bloom API did not return image ${id} in list response`);
    }
    if (isTerminalFailureStatus(img.status)) {
      throw new Error(
        `Bloom image ${id} failed with status "${img.status}"`
      );
    }
    if (!isCompleteStatus(img.status)) {
      throw new Error(
        `Bloom image ${id} not completed (status "${img.status}")`
      );
    }
  }
}

/**
 * Polls until all images are complete or timeout is reached.
 * Uses `GET /images?ids=…&wait=true&timeout=…` so the server holds until
 * every id reaches a terminal status (per OpenAPI). Retries on transient errors.
 * Throws if any image fails or if timeout is exceeded (100s).
 */
export async function pollBloomImages(
  apiKey: string,
  imageIds: string[]
): Promise<BloomImage[]> {
  if (imageIds.length === 0) {
    return [];
  }

  const deadline = Date.now() + 100_000;
  const orderedIds = [...imageIds];

  const pollBatch = async (ids: string[]): Promise<BloomImage[]> => {
    while (Date.now() < deadline) {
      const remainingMs = deadline - Date.now();
      const timeoutSec = Math.min(295, Math.max(1, Math.floor(remainingMs / 1000)));

      const qs = new URLSearchParams();
      qs.set("ids", ids.join(","));
      qs.set("wait", "true");
      qs.set("timeout", String(timeoutSec));
      qs.set("includeUrls", "true");

      const res = await withRetries(
        () => bloomFetch(`/images?${qs.toString()}`, apiKey),
        { deadlineMs: deadline, label: `poll images [${ids.length}]` }
      );

      const json = await readJson(res);
      const images = parseListImagesResponse(json);
      try {
        assertImagesTerminal(images, ids);
        return images;
      } catch (err) {
        if (
          err instanceof Error &&
          (err.message.includes("failed with status") ||
            err.message.includes("did not return image"))
        ) {
          throw err;
        }
        if (Date.now() >= deadline) {
          throw err;
        }
        await sleep(400);
      }
    }

    throw new Error(
      `Bloom image polling timed out after 100s (batch: ${ids.join(", ")})`
    );
  };

  const pollOne = async (id: string): Promise<BloomImage> => {
    while (Date.now() < deadline) {
      const remainingMs = deadline - Date.now();
      const timeoutSec = Math.min(295, Math.max(1, Math.floor(remainingMs / 1000)));

      const qs = new URLSearchParams();
      qs.set("wait", "true");
      qs.set("timeout", String(timeoutSec));
      qs.set("includeUrls", "true");

      const res = await withRetries(
        () =>
          bloomFetch(
            `/images/${encodeURIComponent(id)}?${qs.toString()}`,
            apiKey
          ),
        { deadlineMs: deadline, label: `poll image ${id}` }
      );

      const json = await readJson(res);
      const image = parseGetImageResponse(json);

      if (isTerminalFailureStatus(image.status)) {
        throw new Error(
          `Bloom image ${id} failed with status "${image.status}"`
        );
      }

      if (isCompleteStatus(image.status)) {
        return image;
      }

      await sleep(400);
    }

    throw new Error(
      `Bloom image polling timed out after 100s (image id: ${id})`
    );
  };

  const all: BloomImage[] = [];

  for (let i = 0; i < orderedIds.length; i += MAX_IDS_PER_LIST) {
    const chunk = orderedIds.slice(i, i + MAX_IDS_PER_LIST);
    if (chunk.length === 1) {
      all.push(await pollOne(chunk[0]!));
    } else {
      const batch = await pollBatch(chunk);
      const map = new Map(batch.map((img) => [img.id, img]));
      for (const id of chunk) {
        const img = map.get(id);
        if (!img) {
          throw new Error(`Bloom API missing image ${id} in batch response`);
        }
        all.push(img);
      }
    }
  }

  return orderedIds.map((id) => {
    const found = all.find((img) => img.id === id);
    if (!found) {
      throw new Error(`Bloom polling internal error: missing ${id}`);
    }
    return found;
  });
}

/**
 * Resolves a complete image URL from a BloomImage object.
 * Handles relative paths: `/img/{id}` uses the site origin; other paths use the API base.
 */
export function getBloomImageUrl(image: BloomImage): string {
  const raw = image.imageUrl ?? image.url ?? "";
  if (!raw) {
    throw new Error("Bloom image is missing a URL");
  }
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw;
  }
  if (raw.startsWith("/img/")) {
    return `${BLOOM_ORIGIN}${raw}`;
  }
  if (raw.startsWith("/")) {
    return `${BLOOM_ORIGIN}${raw}`;
  }
  return `${BLOOM_BASE}/${raw}`;
}

/**
 * Gets the credit balance for an API key.
 * Parses `GET /credits` → `{ data: { balance, unlimited } }`.
 */
export async function getBloomCredits(apiKey: string): Promise<{
  balance: number | null;
  unlimited: boolean | null;
}> {
  const res = await bloomFetch(`/credits`, apiKey);
  const json = await readJson(res);

  let balance: number | null = null;
  let unlimited: boolean | null = null;

  try {
    const data = getData(json);
    if (typeof data.balance === "number" && Number.isFinite(data.balance)) {
      balance = data.balance;
    }
    if (typeof data.unlimited === "boolean") {
      unlimited = data.unlimited;
    }
  } catch {
    /* leave nulls */
  }

  return { balance, unlimited };
}
