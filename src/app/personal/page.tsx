"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, BriefcaseBusiness, Clock, Compass, FlaskConical, Lightbulb, RefreshCw, Siren } from "lucide-react";
import { DigestData, TimeWindow } from "@/types";
import { buildPersonalBriefing, PersonalBriefingSection } from "@/lib/personalBriefing";
import { enrichDigestInBackground, fetchDigest } from "@/lib/clientDigest";

const TIME_LABELS: Record<TimeWindow, string> = {
  "24h": "Last 24 hours",
  "3d": "Last 3 days",
  "7d": "Last 7 days",
};

const SECTION_ICONS: Record<string, typeof BriefcaseBusiness> = {
  gtm: BriefcaseBusiness,
  rnd: FlaskConical,
  ideas: Lightbulb,
  incidents: Siren,
  watchlist: Compass,
};

export default function PersonalBriefingPage() {
  const router = useRouter();
  const [digest, setDigest] = useState<DigestData | null>(null);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("24h");
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Preparing your personal brief...");
  const [error, setError] = useState("");
  const requestIdRef = useRef(0);
  const enrichmentKeysRef = useRef<Set<string>>(new Set());
  const briefing = useMemo(() => (digest ? buildPersonalBriefing(digest) : null), [digest]);

  const generate = useCallback(
    async (tw: TimeWindow, force = false) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setLoading(true);
      setError("");
      setLoadingMessage("Preparing your personal brief...");

      try {
        const nextDigest = await fetchDigest({
          timeWindow: tw,
          router,
          force,
          onProgress: (progressDigest) => {
            if (requestIdRef.current === requestId) {
              setDigest(progressDigest);
              setLoadingMessage(progressDigest.progressMessage ?? "Synthesizing the first pass...");
            }
          },
          onStatus: (status) => {
            if (requestIdRef.current === requestId) {
              setLoadingMessage(status.message);
            }
          },
        });
        if (requestIdRef.current === requestId) {
          setDigest(nextDigest);
        }
      } catch (err) {
        if (requestIdRef.current === requestId) {
          setError(err instanceof Error ? err.message : "Unable to build your personal brief.");
        }
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false);
        }
      }
    },
    [router]
  );

  useEffect(() => {
    generate(timeWindow);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!digest || digest.status !== "complete" || loading) return;

    const key = `${digest.timeWindow}:${digest.generatedAt}:${digest.totalItems}`;
    if (enrichmentKeysRef.current.has(key)) return;
    enrichmentKeysRef.current.add(key);

    const timer = window.setTimeout(() => {
      enrichDigestInBackground({
        digest,
        onProgress: (enrichedDigest) => {
          setDigest((current) => {
            if (!current || current.generatedAt !== digest.generatedAt) return current;
            return enrichedDigest;
          });
        },
      }).catch(() => {
        // This page should remain useful even if richer AI summaries fail.
      });
    }, 1500);

    return () => window.clearTimeout(timer);
  }, [digest?.generatedAt, digest?.status, digest?.timeWindow, digest?.totalItems, loading]);

  function changeWindow(next: TimeWindow) {
    setTimeWindow(next);
    generate(next);
  }

  return (
    <div className="min-h-screen bg-[#eef2ed] text-slate-950">
      <header className="sticky top-0 z-20 border-b border-emerald-950/10 bg-[#f8faf6]/90 px-5 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <button
            onClick={() => router.push("/digest")}
            className="inline-flex items-center gap-2 rounded-full border border-emerald-950/15 bg-white/70 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to triage
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => router.push("/briefing")}
              className="rounded-full border border-emerald-950/15 bg-white/70 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-white"
            >
              Newspaper view
            </button>
            <div className="flex rounded-full border border-emerald-950/15 bg-white/70 p-1">
              {(["24h", "3d", "7d"] as TimeWindow[]).map((tw) => (
                <button
                  key={tw}
                  onClick={() => changeWindow(tw)}
                  disabled={loading}
                  className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                    timeWindow === tw ? "bg-emerald-950 text-white" : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  {tw}
                </button>
              ))}
            </div>
            <button
              onClick={() => generate(timeWindow, true)}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-950 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8">
        <section className="rounded-[2rem] border border-emerald-950/10 bg-white/75 p-7 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.35em] text-emerald-800">Personal Brief</p>
          <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_320px] lg:items-end">
            <div>
              <h1 className="font-serif text-4xl font-black tracking-tight text-slate-950 md:text-6xl">
                What Zubin Should Know
              </h1>
              <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
                A synthesized view across GTM, product, engineering, ideas, and customer-impact threads. No Slack firehose, just the shape of what changed.
              </p>
            </div>
            <div className="rounded-3xl border border-emerald-950/10 bg-[#f4f7ef] p-5">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Edition</p>
              <div className="mt-3 space-y-2 text-sm font-semibold text-slate-700">
                <p>{TIME_LABELS[timeWindow]}</p>
                <p>{briefing ? formatGeneratedAt(briefing.generatedAt) : "Generating..."}</p>
                <p>{briefing?.totalSourceItems ?? 0} source items considered</p>
              </div>
            </div>
          </div>
        </section>

        {loading && !briefing && (
          <div className="flex min-h-[360px] flex-col items-center justify-center gap-3">
            <div className="h-9 w-9 animate-spin rounded-full border-2 border-emerald-100 border-t-emerald-900" />
            <p className="text-sm font-semibold text-slate-500">{loadingMessage}</p>
          </div>
        )}

        {error && !loading && (
          <div className="mx-auto mt-10 max-w-xl rounded-3xl border border-red-200 bg-red-50 p-6 text-center">
            <p className="text-lg font-bold text-red-950">Could not create the personal brief</p>
            <p className="mt-2 text-sm leading-6 text-red-700">{error}</p>
          </div>
        )}

        {loading && briefing && (
          <div className="pointer-events-none fixed bottom-5 left-1/2 z-30 -translate-x-1/2 rounded-full border border-emerald-950/10 bg-white/95 px-4 py-2 text-xs font-bold text-slate-600 shadow-lg">
            {loadingMessage || briefing.progressMessage || "Refreshing your personal brief..."}
          </div>
        )}

        {briefing && (
          <section className="mt-6 grid gap-5">
            {briefing.sections.map((section) => (
              <PersonalSection key={section.id} section={section} />
            ))}
          </section>
        )}
      </main>
    </div>
  );
}

function PersonalSection({ section }: { section: PersonalBriefingSection }) {
  const Icon = SECTION_ICONS[section.id] ?? Compass;

  return (
    <article className="grid gap-5 rounded-[1.75rem] border border-emerald-950/10 bg-white p-5 shadow-sm lg:grid-cols-[280px_1fr]">
      <aside className="rounded-[1.4rem] bg-[#f4f7ef] p-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-950 text-white">
          <Icon className="h-5 w-5" />
        </div>
        <p className="mt-5 text-xs font-black uppercase tracking-[0.25em] text-emerald-800">{section.eyebrow}</p>
        <h2 className="mt-2 font-serif text-2xl font-black leading-tight text-slate-950">{section.title}</h2>
        <div className="mt-5 flex flex-wrap gap-2">
          {section.signals.map((signal) => (
            <span key={signal} className="rounded-full border border-emerald-950/10 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
              {signal}
            </span>
          ))}
        </div>
      </aside>

      <div className="min-w-0 p-1 lg:p-3">
        <p className="text-lg font-semibold leading-8 text-slate-800">{section.summary}</p>
        <ul className="mt-5 space-y-3">
          {section.bullets.map((bullet, index) => (
            <li key={`${section.id}-${index}`} className="flex gap-3 text-sm leading-6 text-slate-700">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-700" />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
        {(section.whyItMatters || section.followUp) && (
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {section.whyItMatters && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
                <span className="font-black uppercase tracking-wide text-amber-800">Why it matters: </span>
                {section.whyItMatters}
              </div>
            )}
            {section.followUp && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950">
                <span className="font-black uppercase tracking-wide text-emerald-800">Suggested follow-up: </span>
                {section.followUp}
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function formatGeneratedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Generating";
  return date.toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}
