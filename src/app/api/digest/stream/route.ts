import { NextRequest } from "next/server";
import {
  generateDigestViaGleanChat,
  generateFastDigestFromResults,
  searchSlack,
  searchSlackFast,
} from "@/lib/glean";
import { DigestData, DigestPreferences, TimeWindow } from "@/types";

type StreamEvent =
  | { type: "status"; message: string; phase: string }
  | { type: "digest"; digest: unknown }
  | { type: "complete"; digest: unknown }
  | { type: "error"; error: string };

const SERVER_CACHE_TTL_MS = 5 * 60 * 1000;
const SERVER_CACHE_VERSION = "recent-v2";
const SERVER_CACHE = new Map<string, { digest: DigestData; cachedAt: number }>();

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-glean-token");
  const backendUrl = req.headers.get("x-glean-backend");

  if (!token || !backendUrl) {
    return Response.json({ error: "Missing x-glean-token or x-glean-backend headers" }, { status: 400 });
  }

  let timeWindow: TimeWindow = "24h";
  let preferences: DigestPreferences = {};
  let force = req.headers.get("x-digest-force") === "true";
  try {
    const body = await req.json();
    if (["24h", "3d", "7d"].includes(body.timeWindow)) {
      timeWindow = body.timeWindow;
    }
    if (body.preferences && typeof body.preferences === "object") {
      preferences = body.preferences;
    }
    if (body.force === true) {
      force = true;
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
        const startedAt = Date.now();
        const phaseStartedAt = new Map<string, number>([["search", startedAt]]);
        const timingsMs: Record<string, number> = {};
        let latestQueryCount: number | undefined;
        let latestSearchPages: number | undefined;
        let latestSearchWarnings: string[] = [];
        let paintedFastDigest = false;
        let lastProgressDigestAt = 0;
        const finishPhase = (phase: string) => {
          const phaseStart = phaseStartedAt.get(phase);
          if (phaseStart !== undefined) {
            timingsMs[phase] = Date.now() - phaseStart;
          }
        };
        const startPhase = (phase: string) => {
          phaseStartedAt.set(phase, Date.now());
        };

        const cached = force ? null : getServerCache(cacheKey);
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
        const fastSearchPromise = searchSlackFast(timeWindow, token, backendUrl, preferences, (progress) => {
          latestQueryCount = progress.queryCount;
          latestSearchPages = progress.searchPages;
          if (progress.results.length === 0 || paintedFastDigest) {
            return;
          }

          paintedFastDigest = true;
          send({
            type: "digest",
            digest: {
              ...generateFastDigestFromResults(progress.results, timeWindow),
              progressMessage: `Showing ${progress.results.length} quick Slack results while deeper search continues...`,
              debug: {
                slackResults: progress.results.length,
                phase: "fast_lane",
                queryCount: progress.queryCount,
                searchPages: progress.searchPages,
              },
            },
          });
        }).catch(() => []);
        const fullSearchPromise = searchSlack(timeWindow, token, backendUrl, preferences, (progress) => {
          latestQueryCount = progress.queryCount;
          latestSearchPages = progress.searchPages;
          latestSearchWarnings = progress.warnings ?? latestSearchWarnings;
          const now = Date.now();
          if (progress.results.length === 0 || now - lastProgressDigestAt < 650) {
            return;
          }

          lastProgressDigestAt = now;
          send({
            type: "digest",
            digest: {
              ...generateFastDigestFromResults(progress.results, timeWindow),
              progressMessage: `Loaded ${progress.results.length} Slack items so far...`,
              debug: {
                slackResults: progress.results.length,
                phase: "search_progress",
                queryCount: progress.queryCount,
                searchPages: progress.searchPages,
                searchWarnings: progress.warnings,
              },
            },
          });
        });

        const fastResults = await fastSearchPromise;
        if (fastResults.length > 0 && !paintedFastDigest) {
          paintedFastDigest = true;
          send({
            type: "digest",
            digest: {
              ...generateFastDigestFromResults(fastResults, timeWindow),
              progressMessage: `Showing ${fastResults.length} quick Slack results while deeper search continues...`,
              debug: {
                slackResults: fastResults.length,
                phase: "fast_lane",
                queryCount: latestQueryCount,
                searchPages: latestSearchPages,
              },
            },
          });
        }

        const results = await fullSearchPromise;
        finishPhase("search");

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

        startPhase("fast_digest");
        send({ type: "status", phase: "fast_digest", message: `Found ${results.length} Slack items. Ranking a first pass...` });
        const fastDigest = generateFastDigestFromResults(results, timeWindow);
        finishPhase("fast_digest");
        send({
          type: "digest",
          digest: {
            ...fastDigest,
            debug: {
              slackResults: results.length,
              phase: "fast_digest",
              queryCount: latestQueryCount,
              searchPages: latestSearchPages,
              searchWarnings: latestSearchWarnings,
              timingsMs: { ...timingsMs },
            },
          },
        });

        startPhase("ai_digest");
        send({ type: "status", phase: "ai_digest", message: "Writing AI summaries and action suggestions..." });
        const digest = await generateDigestViaGleanChat(results, timeWindow, token, backendUrl);
        finishPhase("ai_digest");
        const digestTimings = digest.debug?.timingsMs ?? {};
        timingsMs.total = Date.now() - startedAt;
        const completeDigest: DigestData = {
          ...digest,
          status: "complete",
          progressMessage: "Digest is fully enriched.",
          debug: {
            slackResults: results.length,
            phase: "complete",
            queryCount: latestQueryCount,
            searchPages: latestSearchPages,
            searchWarnings: latestSearchWarnings,
            timingsMs: {
              ...timingsMs,
              ...digestTimings,
            },
          },
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
  return `${SERVER_CACHE_VERSION}:${backendUrl}:${timeWindow}:${token.slice(-12)}:${stableStringify(preferences)}`;
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
