"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BriefingData, BriefingStory, DigestData, TimeWindow } from "@/types";
import { buildBriefing } from "@/lib/briefing";
import { fetchDigest } from "@/lib/clientDigest";
import { ArrowLeft, Clock, ExternalLink, RefreshCw } from "lucide-react";

const TIME_LABELS: Record<TimeWindow, string> = {
  "24h": "24 hours",
  "3d": "3 days",
  "7d": "7 days",
};

export default function BriefingPage() {
  const router = useRouter();
  const [digest, setDigest] = useState<DigestData | null>(null);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("24h");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const briefing = useMemo(() => (digest ? buildBriefing(digest) : null), [digest]);

  const generate = useCallback(
    async (tw: TimeWindow) => {
      setLoading(true);
      setError("");

      try {
        setDigest(await fetchDigest({ timeWindow: tw, router }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to generate briefing.");
      } finally {
        setLoading(false);
      }
    },
    [router]
  );

  useEffect(() => {
    generate(timeWindow);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function changeWindow(next: TimeWindow) {
    setTimeWindow(next);
    generate(next);
  }

  return (
    <div className="min-h-screen bg-[#f4efe5] text-stone-950">
      <header className="sticky top-0 z-10 border-b border-stone-300/80 bg-[#f8f3e9]/95 px-5 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <button
            onClick={() => router.push("/digest")}
            className="inline-flex items-center gap-2 rounded-full border border-stone-300 bg-white/60 px-3 py-2 text-sm font-semibold text-stone-700 hover:bg-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to triage
          </button>

          <div className="flex items-center gap-2">
            <div className="flex rounded-full border border-stone-300 bg-stone-100 p-1">
              {(["24h", "3d", "7d"] as TimeWindow[]).map((tw) => (
                <button
                  key={tw}
                  onClick={() => changeWindow(tw)}
                  disabled={loading}
                  className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                    timeWindow === tw ? "bg-stone-950 text-white" : "text-stone-500 hover:text-stone-900"
                  }`}
                >
                  {tw}
                </button>
              ))}
            </div>
            <button
              onClick={() => generate(timeWindow)}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-full bg-stone-950 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-700 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8">
        <div className="border-y-4 border-double border-stone-900 py-5 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.55em] text-amber-800">Slack Digest Special Edition</p>
          <h1 className="mt-2 font-serif text-5xl font-black tracking-tight text-stone-950 md:text-7xl">
            The Morning Briefing
          </h1>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
            <span>{TIME_LABELS[timeWindow]}</span>
            <span>•</span>
            <span>{briefing ? new Date(briefing.generatedAt).toLocaleString() : "Generating"}</span>
            <span>•</span>
            <span>{briefing?.totalStories ?? 0} stories considered</span>
          </div>
        </div>

        {loading && !briefing && (
          <div className="flex min-h-[420px] flex-col items-center justify-center gap-3">
            <div className="h-9 w-9 animate-spin rounded-full border-2 border-stone-300 border-t-stone-950" />
            <p className="text-sm font-semibold text-stone-500">Composing today’s edition…</p>
          </div>
        )}

        {error && !loading && (
          <div className="mx-auto mt-16 max-w-lg rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
            <p className="text-lg font-bold text-red-950">Could not generate the briefing</p>
            <p className="mt-2 text-sm leading-6 text-red-700">{error}</p>
          </div>
        )}

        {!error && briefing && briefing.totalStories === 0 && (
          <div className="mt-20 flex flex-col items-center gap-2 text-stone-500">
            <Clock className="h-8 w-8" />
            <p className="font-semibold">No stories found for this edition.</p>
          </div>
        )}

        {briefing && briefing.totalStories > 0 && <Newspaper briefing={briefing} />}
      </main>
    </div>
  );
}

function Newspaper({ briefing }: { briefing: BriefingData }) {
  return (
    <div className="mt-8">
      {briefing.leadStory && <LeadStory story={briefing.leadStory} />}

      {briefing.secondaryStories.length > 0 && (
        <section className="mt-8 grid gap-5 border-y border-stone-300 py-6 md:grid-cols-2 xl:grid-cols-4">
          {briefing.secondaryStories.map((story) => (
            <SmallStory key={story.id} story={story} />
          ))}
        </section>
      )}

      <section className="mt-8 columns-1 gap-8 md:columns-2 xl:columns-3">
        {briefing.sections.map((section) => (
          <div key={section.id} className="mb-8 break-inside-avoid border-t-2 border-stone-900 pt-3">
            <h2 className="mb-4 text-xs font-black uppercase tracking-[0.3em] text-stone-500">{section.title}</h2>
            <div className="space-y-6">
              {section.stories.map((story) => (
                <ArticleStory key={story.id} story={story} />
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function LeadStory({ story }: { story: BriefingStory }) {
  return (
    <article className="grid gap-6 border-b-2 border-stone-900 pb-8 lg:grid-cols-[1.15fr_0.85fr]">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.35em] text-amber-800">Lead Story · {story.section}</p>
        <h2 className="mt-3 font-serif text-4xl font-black leading-[0.95] text-stone-950 md:text-6xl">{story.headline}</h2>
        <p className="mt-4 max-w-3xl text-xl leading-8 text-stone-700">{story.dek}</p>
      </div>
      <StorySidebar story={story} />
    </article>
  );
}

function SmallStory({ story }: { story: BriefingStory }) {
  return (
    <article className="border-l border-stone-300 pl-4">
      <p className="text-[11px] font-black uppercase tracking-[0.25em] text-stone-500">{story.section}</p>
      <h3 className="mt-2 font-serif text-2xl font-black leading-7">{story.headline}</h3>
      <p className="mt-2 text-sm leading-6 text-stone-600">{story.dek}</p>
      <StoryLinks story={story} compact />
    </article>
  );
}

function ArticleStory({ story }: { story: BriefingStory }) {
  return (
    <article>
      <h3 className="font-serif text-2xl font-black leading-7">{story.headline}</h3>
      <p className="mt-2 text-sm font-semibold leading-6 text-stone-600">{story.dek}</p>
      <div className="mt-3 space-y-3 text-sm leading-7 text-stone-800">
        {story.body.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-xs leading-5 text-amber-950">
        <span className="font-black uppercase tracking-wide text-amber-800">Why it matters: </span>
        {story.whyItMatters}
      </div>
      <StoryLinks story={story} />
    </article>
  );
}

function StorySidebar({ story }: { story: BriefingStory }) {
  return (
    <aside className="rounded-3xl border border-stone-300 bg-white/55 p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.25em] text-stone-500">Article Notes</p>
      <div className="mt-4 space-y-4 text-sm leading-6 text-stone-700">
        <p>
          <span className="font-bold text-stone-950">Why it matters:</span> {story.whyItMatters}
        </p>
        {story.nextStep && (
          <p>
            <span className="font-bold text-stone-950">Next step:</span> {story.nextStep}
          </p>
        )}
        {story.people.length > 0 && (
          <p>
            <span className="font-bold text-stone-950">People:</span> {story.people.join(", ")}
          </p>
        )}
      </div>
      <StoryLinks story={story} />
    </aside>
  );
}

function StoryLinks({ story, compact = false }: { story: BriefingStory; compact?: boolean }) {
  return (
    <div className={`mt-4 flex flex-wrap gap-2 ${compact ? "text-xs" : "text-sm"}`}>
      {story.channels.map((channel) =>
        channel.url ? (
          <a
            key={channel.name}
            href={channel.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-stone-300 bg-white/70 px-3 py-1 font-semibold text-stone-600 hover:bg-white"
          >
            #{channel.name}
          </a>
        ) : (
          <span key={channel.name} className="rounded-full border border-stone-300 bg-white/70 px-3 py-1 font-semibold text-stone-600">
            #{channel.name}
          </span>
        )
      )}
      {story.slackUrls[0] && (
        <a
          href={story.slackUrls[0]}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-full bg-stone-950 px-3 py-1 font-semibold text-white hover:bg-stone-700"
        >
          Open thread
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}
