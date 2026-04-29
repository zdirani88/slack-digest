import { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { DigestData, DigestPreferences, TimeWindow } from "@/types";

export async function fetchDigest({
  timeWindow,
  router,
  force = false,
}: {
  timeWindow: TimeWindow;
  router: AppRouterInstance;
  force?: boolean;
}): Promise<DigestData> {
  const token = localStorage.getItem("glean_token");
  const backendUrl = localStorage.getItem("glean_backend_url");

  if (!token || !backendUrl) {
    router.replace("/setup");
    throw new Error("Missing Glean setup.");
  }

  const preferences = readDigestPreferences();
  const cacheKey = makeDigestCacheKey(timeWindow, backendUrl, preferences);

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

  const request = requestDigest({ timeWindow, token, backendUrl, preferences }).then((digest) => {
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

const DIGEST_CACHE_TTL_MS = 5 * 60 * 1000;
const MEMORY_CACHE = new Map<string, { digest: DigestData; cachedAt: number }>();
const INFLIGHT = new Map<string, Promise<DigestData>>();

async function requestDigest({
  timeWindow,
  token,
  backendUrl,
  preferences,
}: {
  timeWindow: TimeWindow;
  token: string;
  backendUrl: string;
  preferences: DigestPreferences;
}) {
  const res = await fetch("/api/digest/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-glean-token": token,
      "x-glean-backend": backendUrl,
    },
    body: JSON.stringify({ timeWindow, preferences }),
  });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(formatErrorMessage(data.error));
  }

  return data;
}

function makeDigestCacheKey(timeWindow: TimeWindow, backendUrl: string, preferences: DigestPreferences) {
  return `digest:${timeWindow}:${backendUrl}:${stableStringify(preferences)}`;
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
