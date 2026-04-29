"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BriefingData, BriefingStory, DigestData, TimeWindow } from "@/types";
import { buildBriefing } from "@/lib/briefing";
import { fetchDigest } from "@/lib/clientDigest";
import { Archive, ArrowLeft, Clock, ExternalLink, RefreshCw, RotateCcw, ThumbsDown } from "lucide-react";

const TIME_LABELS: Record<TimeWindow, string> = {
  "24h": "24 hours",
  "3d": "3 days",
  "7d": "7 days",
};

const READ_STORIES_KEY = "slack_digest_briefing_read_stories";
const FEEDBACK_STORAGE_KEY = "slack_digest_item_feedback";
const FEEDBACK_PROFILE_STORAGE_KEY = "slack_digest_feedback_profile";

export default function BriefingPage() {
  const router = useRouter();
  const [digest, setDigest] = useState<DigestData | null>(null);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("24h");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [readStoryIds, setReadStoryIds] = useState<Set<string>>(new Set());
  const briefing = useMemo(() => (digest ? filterReadStories(buildBriefing(digest), readStoryIds) : null), [digest, readStoryIds]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(READ_STORIES_KEY) ?? "[]");
      setReadStoryIds(new Set(Array.isArray(saved) ? saved : []));
    } catch {
      setReadStoryIds(new Set());
    }
  }, []);

  const generate = useCallback(
    async (tw: TimeWindow, force = false) => {
      setLoading(true);
      setError("");

      try {
        setDigest(await fetchDigest({
          timeWindow: tw,
          router,
          force,
          onProgress: (nextDigest) => setDigest(nextDigest),
        }));
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

  function markRead(story: BriefingStory) {
    const next = new Set(readStoryIds);
    next.add(story.id);
    setReadStoryIds(next);
    localStorage.setItem(READ_STORIES_KEY, JSON.stringify(Array.from(next)));
  }

  function downvoteStory(story: BriefingStory) {
    writeStoryFeedback(story, "down");
    markRead(story);
  }

  function restoreRead() {
    setReadStoryIds(new Set());
    localStorage.removeItem(READ_STORIES_KEY);
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
              onClick={restoreRead}
              disabled={readStoryIds.size === 0}
              className="inline-flex items-center gap-2 rounded-full border border-stone-300 bg-white/60 px-3 py-2 text-sm font-semibold text-stone-600 hover:bg-white disabled:opacity-40"
            >
              <RotateCcw className="h-4 w-4" />
              Restore read
            </button>
            <button
              onClick={() => generate(timeWindow, true)}
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
            <span>{briefing ? formatEditionTime(briefing.generatedAt) : "Generating"}</span>
            <span>•</span>
            <span>{briefing?.totalStories ?? 0} unread stories</span>
            {readStoryIds.size > 0 && (
              <>
                <span>•</span>
                <span>{readStoryIds.size} read</span>
              </>
            )}
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
            <p className="font-semibold">{readStoryIds.size > 0 ? "All briefing stories are marked read." : "No stories found for this edition."}</p>
            {readStoryIds.size > 0 && (
              <button
                onClick={restoreRead}
                className="mt-3 rounded-full bg-stone-950 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-700"
              >
                Restore read stories
              </button>
            )}
          </div>
        )}

        {loading && briefing && (
          <div className="pointer-events-none fixed bottom-5 left-1/2 z-20 -translate-x-1/2 rounded-full border border-stone-300 bg-white/95 px-4 py-2 text-xs font-bold text-stone-600 shadow-lg">
            {briefing.progressMessage ?? "Updating the edition as richer summaries arrive..."}
          </div>
        )}

        {briefing && briefing.totalStories > 0 && (
          <Newspaper briefing={briefing} onRead={markRead} onDownvote={downvoteStory} />
        )}
      </main>
    </div>
  );
}

function Newspaper({
  briefing,
  onRead,
  onDownvote,
}: {
  briefing: BriefingData;
  onRead: (story: BriefingStory) => void;
  onDownvote: (story: BriefingStory) => void;
}) {
  const heroSecondary = briefing.secondaryStories[0];
  const secondaryStories = briefing.secondaryStories.slice(1);

  return (
    <div className="mt-8">
      {briefing.leadStory && (
        <LeadStory
          story={briefing.leadStory}
          secondaryStory={heroSecondary}
          onRead={onRead}
          onDownvote={onDownvote}
        />
      )}

      {secondaryStories.length > 0 && (
        <section className="mt-8 grid gap-5 border-y border-stone-300 py-6 md:grid-cols-2 xl:grid-cols-3">
          {secondaryStories.map((story) => (
            <SmallStory key={story.id} story={story} onRead={onRead} onDownvote={onDownvote} />
          ))}
        </section>
      )}

      <section className="mt-8 grid gap-8 md:grid-cols-2 xl:grid-cols-3">
        {briefing.sections.map((section) => (
          <div key={section.id} className="min-w-0 border-t-2 border-stone-900 pt-3">
            <h2 className="mb-4 text-xs font-black uppercase tracking-[0.3em] text-stone-500">{section.title}</h2>
            <div className="space-y-6">
              {section.stories.map((story) => (
                <ArticleStory key={story.id} story={story} onRead={onRead} onDownvote={onDownvote} />
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function LeadStory({
  story,
  secondaryStory,
  onRead,
  onDownvote,
}: {
  story: BriefingStory;
  secondaryStory?: BriefingStory;
  onRead: (story: BriefingStory) => void;
  onDownvote: (story: BriefingStory) => void;
}) {
  return (
    <section className="grid min-w-0 gap-6 border-b-2 border-stone-900 pb-8 lg:grid-cols-[1.1fr_0.9fr]">
      <article className="flex min-w-0 flex-col">
        <StoryKicker story={story} label={`Lead Story · ${story.section}`} />
        <h2 className="mt-3 max-w-full overflow-hidden break-words font-serif text-3xl font-black leading-[0.98] text-stone-950 md:text-4xl xl:text-5xl">{story.headline}</h2>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-stone-700">{story.dek}</p>
        <div className="mt-5 space-y-3 overflow-hidden break-words text-base leading-8 text-stone-800">
          {story.body.slice(0, 2).map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
        <StoryLinks story={story} onRead={onRead} onDownvote={onDownvote} />
      </article>

      {secondaryStory ? (
        <article className="flex min-w-0 flex-col rounded-3xl border border-stone-300 bg-white/55 p-5 shadow-sm">
          <StoryKicker story={secondaryStory} label={`Also Important · ${secondaryStory.section}`} />
          <h3 className="mt-3 overflow-hidden break-words font-serif text-3xl font-black leading-tight text-stone-950">{secondaryStory.headline}</h3>
          <p className="mt-3 text-base leading-7 text-stone-700">{secondaryStory.dek}</p>
          <div className="mt-4 overflow-hidden break-words rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-sm leading-6 text-amber-950">
            <span className="font-black uppercase tracking-wide text-amber-800">Why it matters: </span>
            {secondaryStory.whyItMatters}
          </div>
          <div className="mt-auto">
            <StoryLinks story={secondaryStory} onRead={onRead} onDownvote={onDownvote} />
          </div>
        </article>
      ) : null}
    </section>
  );
}

function SmallStory({
  story,
  onRead,
  onDownvote,
}: {
  story: BriefingStory;
  onRead: (story: BriefingStory) => void;
  onDownvote: (story: BriefingStory) => void;
}) {
  return (
    <article className="min-w-0 border-l border-stone-300 pl-4">
      <StoryKicker story={story} label={story.section} />
      <h3 className="mt-2 overflow-hidden break-words font-serif text-2xl font-black leading-7">{story.headline}</h3>
      <p className="mt-2 text-sm leading-6 text-stone-600">{story.dek}</p>
      <StoryLinks story={story} compact onRead={onRead} onDownvote={onDownvote} />
    </article>
  );
}

function ArticleStory({
  story,
  onRead,
  onDownvote,
}: {
  story: BriefingStory;
  onRead: (story: BriefingStory) => void;
  onDownvote: (story: BriefingStory) => void;
}) {
  return (
    <article className="min-w-0 overflow-hidden">
      <StoryKicker story={story} label={story.section} />
      <h3 className="mt-1 overflow-hidden break-words font-serif text-2xl font-black leading-7">{story.headline}</h3>
      <p className="mt-2 text-sm font-semibold leading-6 text-stone-600">{story.dek}</p>
      <div className="mt-3 space-y-3 overflow-hidden break-words text-sm leading-7 text-stone-800">
        {story.body.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
      <div className="mt-3 overflow-hidden break-words rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-xs leading-5 text-amber-950">
        <span className="font-black uppercase tracking-wide text-amber-800">Why it matters: </span>
        {story.whyItMatters}
      </div>
      <StoryLinks story={story} onRead={onRead} onDownvote={onDownvote} />
    </article>
  );
}

function StoryLinks({
  story,
  compact = false,
  onRead,
  onDownvote,
}: {
  story: BriefingStory;
  compact?: boolean;
  onRead: (story: BriefingStory) => void;
  onDownvote: (story: BriefingStory) => void;
}) {
  return (
    <div className={`mt-5 flex flex-wrap items-center gap-2 ${compact ? "text-xs" : "text-sm"}`}>
      <button
        onClick={() => onRead(story)}
        className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 font-semibold text-emerald-800 hover:bg-emerald-100"
      >
        <Archive className="h-3.5 w-3.5" />
        Read
      </button>
      <button
        onClick={() => onDownvote(story)}
        className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 font-semibold text-rose-800 hover:bg-rose-100"
      >
        <ThumbsDown className="h-3.5 w-3.5" />
        Not useful
      </button>
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

function StoryKicker({ story, label }: { story: BriefingStory; label: string }) {
  return (
    <p className="text-[11px] font-black uppercase tracking-[0.25em] text-stone-500">
      {label}
      {story.timestamp ? <span className="ml-2 tracking-normal text-stone-400">· {formatStoryTime(story.timestamp)}</span> : null}
    </p>
  );
}

function filterReadStories(briefing: BriefingData, readStoryIds: Set<string>): BriefingData {
  const keep = (story?: BriefingStory) => story && !readStoryIds.has(story.id);
  const leadStory = keep(briefing.leadStory) ? briefing.leadStory : undefined;
  const secondaryStories = briefing.secondaryStories.filter((story) => !readStoryIds.has(story.id));
  const sections = briefing.sections
    .map((section) => ({
      ...section,
      stories: section.stories.filter((story) => !readStoryIds.has(story.id)),
    }))
    .filter((section) => section.stories.length > 0);

  return {
    ...briefing,
    leadStory,
    secondaryStories,
    sections,
    totalStories:
      (leadStory ? 1 : 0) +
      secondaryStories.length +
      sections.reduce((sum, section) => sum + section.stories.length, 0),
  };
}

function formatStoryTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() <= 1971) {
    return "";
  }

  const day = date.toLocaleDateString(undefined, { weekday: "short" });
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(":00", "");
  return `${day} ${time}`;
}

function formatEditionTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Generating";
  return date.toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function writeStoryFeedback(story: BriefingStory, value: "down") {
  try {
    const feedback = JSON.parse(localStorage.getItem(FEEDBACK_STORAGE_KEY) ?? "{}");
    for (const id of story.sourceItemIds.length ? story.sourceItemIds : [story.id]) {
      feedback[id] = value;
    }
    localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(feedback));
  } catch {
    // Feedback is a learning convenience only.
  }

  try {
    const profile = JSON.parse(localStorage.getItem(FEEDBACK_PROFILE_STORAGE_KEY) ?? "{}");
    const dislikedChannels = toUniqueStrings([
      ...(Array.isArray(profile.dislikedChannels) ? profile.dislikedChannels : []),
      ...story.channels.map((channel) => channel.name),
    ]);
    profile.dislikedChannels = dislikedChannels;
    localStorage.setItem(FEEDBACK_PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Profile feedback is best effort.
  }
}

function toUniqueStrings(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}
