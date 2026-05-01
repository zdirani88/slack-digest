import { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { DigestData, DigestItem, DigestPreferences, TimeWindow } from "@/types";

export async function fetchDigest({
  timeWindow,
  router,
  force = false,
  onProgress,
  onStatus,
}: {
  timeWindow: TimeWindow;
  router: AppRouterInstance;
  force?: boolean;
  onProgress?: (digest: DigestData) => void;
  onStatus?: (status: { phase?: string; message: string }) => void;
}): Promise<DigestData> {
  const token = localStorage.getItem("glean_token");
  const backendUrl = localStorage.getItem("glean_backend_url");

  if (!token || !backendUrl) {
    router.replace("/setup");
    throw new Error("Missing Glean setup.");
  }

  const preferences = readDigestPreferences();
  const cacheKey = makeDigestCacheKey(timeWindow, backendUrl, preferences);

  if (force) {
    clearCache(cacheKey);
  }

  if (!force) {
    const memoryHit = getMemoryCache(cacheKey);
    if (memoryHit) return memoryHit;

    const storageHit = getStorageCache(cacheKey);
    if (storageHit) {
      setMemoryCache(cacheKey, storageHit);
      return storageHit;
    }

    const inflight = getInflight(cacheKey);
    if (inflight) return inflight;
  }

  const request = requestDigest({ timeWindow, token, backendUrl, preferences, force, onProgress, onStatus }).then((digest) => {
    setMemoryCache(cacheKey, digest);
    setStorageCache(cacheKey, digest);
    return digest;
  });

  setInflight(cacheKey, request);

  try {
    return await request;
  } finally {
    clearInflight(cacheKey);
  }
}

export async function enrichDigestInBackground({
  digest,
  onProgress,
}: {
  digest: DigestData;
  onProgress: (digest: DigestData) => void;
}) {
  if (digest.status !== "complete") return;

  const token = localStorage.getItem("glean_token");
  const backendUrl = localStorage.getItem("glean_backend_url");
  if (!token || !backendUrl) return;

  const items = selectItemsForBackgroundEnrichment(digest);
  if (items.length === 0) return;

  const enrichmentKey = makeBackgroundEnrichmentKey(digest, backendUrl, items);
  if (COMPLETED_ENRICHMENTS.has(enrichmentKey)) return;

  const existing = ENRICHMENT_INFLIGHT.get(enrichmentKey);
  const request = existing ?? requestBackgroundEnrichment({ enrichmentKey, token, backendUrl, items });
  ENRICHMENT_INFLIGHT.set(enrichmentKey, request);

  const enrichedItems = await request;
  if (enrichedItems.length === 0) return;

  COMPLETED_ENRICHMENTS.add(enrichmentKey);

  const enrichedDigest = applyEnrichmentsToDigest(digest, enrichedItems);
  const preferences = readDigestPreferences();
  const cacheKey = makeDigestCacheKey(digest.timeWindow, backendUrl, preferences);
  setMemoryCache(cacheKey, enrichedDigest);
  setStorageCache(cacheKey, enrichedDigest);
  onProgress(enrichedDigest);
}

const DIGEST_CACHE_TTL_MS = 5 * 60 * 1000;
const DIGEST_CACHE_VERSION = "recent-v2";
const BACKGROUND_ENRICHMENT_TIMEOUT_MS = 16000;
const MEMORY_CACHE = new Map<string, { digest: DigestData; cachedAt: number }>();
const INFLIGHT = new Map<string, Promise<DigestData>>();
const ENRICHMENT_INFLIGHT = new Map<string, Promise<Array<Partial<DigestItem> & { id?: string }>>>();
const COMPLETED_ENRICHMENTS = new Set<string>();

async function requestBackgroundEnrichment({
  enrichmentKey,
  token,
  backendUrl,
  items,
}: {
  enrichmentKey: string;
  token: string;
  backendUrl: string;
  items: DigestItem[];
}) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), BACKGROUND_ENRICHMENT_TIMEOUT_MS);

  console.info("[SlackDigestPerf] background_enrichment_start", { items: items.length });

  try {
    const res = await fetch("/api/digest/enrich", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-glean-token": token,
        "x-glean-backend": backendUrl,
      },
      body: JSON.stringify({ items }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.info("[SlackDigestPerf] background_enrichment_failed", {
        durationMs: Date.now() - startedAt,
        status: res.status,
      });
      return [];
    }

    const data = await res.json().catch(() => ({}));
    const enrichedItems = Array.isArray(data.items) ? data.items : [];
    console.info("[SlackDigestPerf] background_enrichment_complete", {
      durationMs: Date.now() - startedAt,
      items: enrichedItems.length,
    });
    return enrichedItems;
  } catch (error) {
    console.info("[SlackDigestPerf] background_enrichment_aborted", {
      durationMs: Date.now() - startedAt,
      reason: error instanceof Error ? error.name : "unknown",
    });
    return [];
  } finally {
    window.clearTimeout(timeout);
    ENRICHMENT_INFLIGHT.delete(enrichmentKey);
  }
}

async function requestDigest({
  timeWindow,
  token,
  backendUrl,
  preferences,
  force,
  onProgress,
  onStatus,
}: {
  timeWindow: TimeWindow;
  token: string;
  backendUrl: string;
  preferences: DigestPreferences;
  force: boolean;
  onProgress?: (digest: DigestData) => void;
  onStatus?: (status: { phase?: string; message: string }) => void;
}) {
  const res = await fetch("/api/digest/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-glean-token": token,
      "x-glean-backend": backendUrl,
      "x-digest-force": force ? "true" : "false",
    },
    body: JSON.stringify({ timeWindow, preferences, force }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(formatErrorMessage(data.error));
  }

  if (!res.body) {
    const data = await res.json();
    return data as DigestData;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let latestDigest: DigestData | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const event = parseStreamEvent(line);
      if (!event) continue;

      if (event.type === "error") {
        throw new Error(formatErrorMessage(event.error));
      }

      if (event.type === "status" && event.message) {
        onStatus?.({ phase: event.phase, message: event.message });
      }

      if ((event.type === "digest" || event.type === "complete") && event.digest) {
        latestDigest = event.digest;
        onProgress?.(latestDigest);
      }
    }
  }

  if (buffer.trim()) {
    const event = parseStreamEvent(buffer);
    if (event?.type === "error") {
      throw new Error(formatErrorMessage(event.error));
    }
    if (event?.type === "status" && event.message) {
      onStatus?.({ phase: event.phase, message: event.message });
    }
    if ((event?.type === "digest" || event?.type === "complete") && event.digest) {
      latestDigest = event.digest;
      onProgress?.(latestDigest);
    }
  }

  if (!latestDigest) {
    throw new Error("Digest stream ended before any digest data was returned.");
  }

  return latestDigest;
}

function parseStreamEvent(line: string): null | {
  type?: string;
  digest?: DigestData;
  error?: string;
  phase?: string;
  message?: string;
} {
  try {
    const value = JSON.parse(line);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function selectItemsForBackgroundEnrichment(digest: DigestData) {
  return digest.groups
    .flatMap((group) => group.items)
    .sort((a, b) => (b.rankingScore ?? 0) - (a.rankingScore ?? 0))
    .filter((item) => item.id && (item.fullText || item.rawExcerpt || item.preview || item.title))
    .slice(0, 4);
}

function makeBackgroundEnrichmentKey(digest: DigestData, backendUrl: string, items: DigestItem[]) {
  return [
    "enrich",
    digest.timeWindow,
    backendUrl,
    digest.generatedAt,
    items.map((item) => `${item.id}:${item.latestActivityTimestamp ?? item.timestamp ?? ""}`).join("|"),
  ].join(":");
}

function applyEnrichmentsToDigest(
  digest: DigestData,
  enrichments: Array<Partial<DigestItem> & { id?: string }>
): DigestData {
  const byId = new Map(enrichments.filter((item) => item.id).map((item) => [item.id!, item]));

  return {
    ...digest,
    progressMessage: "Background AI summaries updated.",
    groups: digest.groups.map((group) => ({
      ...group,
      items: group.items.map((item) => {
        const enrichment = byId.get(item.id);
        if (!enrichment) return item;

        return {
          ...item,
          summary: enrichment.summary ?? item.summary,
          threadSummary: enrichment.threadSummary ?? item.threadSummary,
          reason: enrichment.reason ?? item.reason,
          suggestedActions: enrichment.suggestedActions ?? item.suggestedActions,
        };
      }),
    })),
  };
}

function makeDigestCacheKey(timeWindow: TimeWindow, backendUrl: string, preferences: DigestPreferences) {
  return `digest:${DIGEST_CACHE_VERSION}:${timeWindow}:${backendUrl}:${stableStringify(preferences)}`;
}

function getMemoryCache(key: string) {
  const entry = MEMORY_CACHE.get(key);
  if (!entry || Date.now() - entry.cachedAt > DIGEST_CACHE_TTL_MS) {
    MEMORY_CACHE.delete(key);
    return null;
  }

  return entry.digest;
}

function setMemoryCache(key: string, digest: DigestData) {
  MEMORY_CACHE.set(key, { digest, cachedAt: Date.now() });
}

function getStorageCache(key: string) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;

    const entry = JSON.parse(raw);
    if (!entry?.digest || typeof entry.cachedAt !== "number" || Date.now() - entry.cachedAt > DIGEST_CACHE_TTL_MS) {
      sessionStorage.removeItem(key);
      return null;
    }

    return entry.digest as DigestData;
  } catch {
    return null;
  }
}

function setStorageCache(key: string, digest: DigestData) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ digest, cachedAt: Date.now() }));
  } catch {
    // Cache storage is a convenience only.
  }
}

function clearCache(key: string) {
  MEMORY_CACHE.delete(key);
  INFLIGHT.delete(key);
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Cache storage is a convenience only.
  }
}

function getInflight(key: string) {
  return INFLIGHT.get(key);
}

function setInflight(key: string, request: Promise<DigestData>) {
  INFLIGHT.set(key, request);
}

function clearInflight(key: string) {
  INFLIGHT.delete(key);
}

function readDigestPreferences(): DigestPreferences {
  return {
    interests: readStringArray("slack_digest_interests"),
    ...readFeedbackProfile(),
  };
}

function readStringArray(key: string) {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function readFeedbackProfile() {
  try {
    const value = JSON.parse(localStorage.getItem("slack_digest_feedback_profile") ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

export function formatErrorMessage(error: unknown) {
  if (typeof error !== "string" || error.trim().length === 0) {
    return "Failed to generate digest.";
  }

  if (error === "fetch failed") {
    return "Could not reach Glean. Check your network connection or backend URL and try again.";
  }

  return error;
}
