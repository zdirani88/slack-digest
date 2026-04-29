import { NextRequest } from "next/server";
import { generateDigestViaGleanChat, generateFastDigestFromResults, searchSlack } from "@/lib/glean";
import { DigestData, DigestPreferences, TimeWindow } from "@/types";

type StreamEvent =
  | { type: "status"; message: string; phase: string }
  | { type: "digest"; digest: unknown }
  | { type: "complete"; digest: unknown }
  | { type: "error"; error: string };

const SERVER_CACHE_TTL_MS = 5 * 60 * 1000;
const SERVER_CACHE = new Map<string, { digest: DigestData; cachedAt: number }>();

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-glean-token");
  const backendUrl = req.headers.get("x-glean-backend");

  if (!token || !backendUrl) {
    return Response.json({ error: "Missing x-glean-token or x-glean-backend headers" }, { status: 400 });
  }

  let timeWindow: TimeWindow = "24h";
  let preferences: DigestPreferences = {};
  try {
    const body = await req.json();
    if (["24h", "3d", "7d"].includes(body.timeWindow)) {
      timeWindow = body.timeWindow;
    }
    if (body.preferences && typeof body.preferences === "object") {
      preferences = body.preferences;
    }
  } catch {
    // Use defaults for malformed or empty bodies.
  }

  const encoder = new TextEncoder();
  const cacheKey = makeServerCacheKey(token, backendUrl, timeWindow, preferences);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        const cached = getServerCache(cacheKey);
        if (cached) {
          send({
            type: "complete",
            digest: {
              ...cached,
              progressMessage: "Loaded from the local server cache.",
              debug: { ...cached.debug, phase: "server_cache" },
            },
          });
          return;
        }

        send({ type: "status", phase: "search", message: "Searching Slack in Glean..." });
        const results = await searchSlack(timeWindow, token, backendUrl, preferences);

        if (results.length === 0) {
          const emptyDigest = {
            groups: [],
            generatedAt: new Date().toISOString(),
            timeWindow,
            totalItems: 0,
            status: "complete",
            progressMessage: "No Slack results found for this time window.",
            debug: { slackResults: 0, phase: "empty" },
          };
          send({ type: "complete", digest: emptyDigest });
          return;
        }

        send({ type: "status", phase: "fast_digest", message: `Found ${results.length} Slack items. Ranking a first pass...` });
        send({
          type: "digest",
          digest: {
            ...generateFastDigestFromResults(results, timeWindow),
            debug: { slackResults: results.length, phase: "fast_digest" },
          },
        });

        send({ type: "status", phase: "ai_digest", message: "Writing AI summaries and action suggestions..." });
        const digest = await generateDigestViaGleanChat(results, timeWindow, token, backendUrl);
        const completeDigest: DigestData = {
          ...digest,
          status: "complete",
          progressMessage: "Digest is fully enriched.",
          debug: { slackResults: results.length, phase: "complete" },
        };
        setServerCache(cacheKey, completeDigest);
        send({
          type: "complete",
          digest: completeDigest,
        });
      } catch (err) {
        send({ type: "error", error: err instanceof Error ? err.message : "Unknown digest stream error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

function makeServerCacheKey(
  token: string,
  backendUrl: string,
  timeWindow: TimeWindow,
  preferences: DigestPreferences
) {
  return `${backendUrl}:${timeWindow}:${token.slice(-12)}:${stableStringify(preferences)}`;
}

function getServerCache(key: string) {
  const entry = SERVER_CACHE.get(key);
  if (!entry || Date.now() - entry.cachedAt > SERVER_CACHE_TTL_MS) {
    SERVER_CACHE.delete(key);
    return null;
  }

  return entry.digest;
}

function setServerCache(key: string, digest: DigestData) {
  SERVER_CACHE.set(key, { digest, cachedAt: Date.now() });
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
