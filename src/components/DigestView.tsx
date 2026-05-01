"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DigestData, DigestGroup, DigestItem } from "@/types";
import ThreadCard from "./ThreadCard";
import { formatDistanceToNow } from "date-fns";
import {
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Hash,
  Inbox,
  Layers3,
  ThumbsDown,
  ThumbsUp,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  User,
} from "lucide-react";

interface Props {
  digest: DigestData;
  loading: boolean;
}

const DISMISSED_STORAGE_KEY = "slack_digest_dismissed_items";
const INTERESTS_STORAGE_KEY = "slack_digest_interests";
const FEEDBACK_STORAGE_KEY = "slack_digest_item_feedback";
const FEEDBACK_PROFILE_STORAGE_KEY = "slack_digest_feedback_profile";
const ALL_GROUP_ID = "all_updates";

type SortMode = "priority" | "recency";
type FeedbackValue = "up" | "down";
type FeedbackMap = Record<string, FeedbackValue>;

export default function DigestView({ digest }: Props) {
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set());
  const [activeGroupId, setActiveGroupId] = useState(ALL_GROUP_ID);
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("priority");
  const [interests, setInterests] = useState<string[]>([]);
  const [interestDraft, setInterestDraft] = useState("");
  const [feedback, setFeedback] = useState<FeedbackMap>({});

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(DISMISSED_STORAGE_KEY) ?? "[]");
      setDismissedKeys(new Set(Array.isArray(saved) ? saved : []));
    } catch {
      setDismissedKeys(new Set());
    }
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(FEEDBACK_STORAGE_KEY) ?? "{}");
      setFeedback(saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {});
    } catch {
      setFeedback({});
    }
  }, []);

  const inferredInterests = useMemo(() => inferInterestsFromDigest(digest), [digest]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(INTERESTS_STORAGE_KEY) ?? "[]");
      const savedInterests = Array.isArray(saved) ? saved : [];
      setInterests(savedInterests.length ? savedInterests : inferredInterests.slice(0, 6));
    } catch {
      setInterests(inferredInterests.slice(0, 6));
    }
  }, [inferredInterests]);

  const groups = useMemo(() => {
    return digest.groups.map((group) => ({
      ...group,
      items: group.items.filter((item) => !dismissedKeys.has(getItemKey(item))),
    }));
  }, [digest.groups, dismissedKeys]);
  const remainingItems = groups.reduce((sum, group) => sum + group.items.length, 0);

  const allGroup = useMemo<DigestGroup>(() => ({
    id: ALL_GROUP_ID,
    title: "All Updates",
    emoji: "🗞️",
    priority: 0,
    summary: `${remainingItems} open item${remainingItems === 1 ? "" : "s"} across all categories.`,
    items: groups.flatMap((group) => group.items),
  }), [groups, remainingItems]);
  const navGroups = [allGroup, ...groups];
  const visibleGroups = navGroups.filter((group) => group.items.length > 0);
  const activeGroup = navGroups.find((group) => group.id === activeGroupId) ?? visibleGroups[0];
  const activeItems = useMemo(() => {
    const items = activeGroup?.items ?? [];
    return rankItems(items, sortMode, interests, feedback);
  }, [activeGroup, sortMode, interests, feedback]);
  const selectedItem =
    activeItems.find((item) => getItemKey(item) === selectedItemKey) ?? activeItems[0] ?? null;
  const dismissedCount = dismissedKeys.size;

  useEffect(() => {
    const firstGroup = visibleGroups[0];
    if (!firstGroup) {
      setActiveGroupId("");
      setSelectedItemKey(null);
      return;
    }

    setActiveGroupId((current) => {
      const stillVisible = visibleGroups.some((group) => group.id === current);
      return stillVisible ? current : firstGroup.id;
    });
  }, [visibleGroups]);

  useEffect(() => {
    if (!selectedItem && activeItems[0]) {
      setSelectedItemKey(getItemKey(activeItems[0]));
      return;
    }

    if (selectedItem && selectedItemKey !== getItemKey(selectedItem)) {
      setSelectedItemKey(getItemKey(selectedItem));
    }
  }, [activeItems, selectedItem, selectedItemKey]);

  const persistDismissed = useCallback((next: Set<string>) => {
    setDismissedKeys(next);
    localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(Array.from(next)));
  }, []);

  const dismissItem = useCallback(
    (item: DigestItem) => {
      const key = getItemKey(item);
      const next = new Set(dismissedKeys);
      next.add(key);
      persistDismissed(next);

      const remaining = activeItems.filter((candidate) => getItemKey(candidate) !== key);
      setSelectedItemKey(remaining[0] ? getItemKey(remaining[0]) : null);
    },
    [activeItems, dismissedKeys, persistDismissed]
  );

  function restoreDismissed() {
    persistDismissed(new Set());
  }

  function setItemFeedback(item: DigestItem, value: FeedbackValue) {
    const key = getItemKey(item);
    const next = { ...feedback };

    if (next[key] === value) {
      delete next[key];
    } else {
      next[key] = value;
    }

    setFeedback(next);
    localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(next));
    updateFeedbackProfile(item, next[key]);
    logEvent("item_feedback", {
      itemId: item.id,
      key,
      feedback: next[key] ?? "cleared",
      topics: item.topics ?? [],
      channel: item.channel,
      author: item.author,
    });

    if (value === "down") {
      dismissItem(item);
    }
  }

  function addInterest() {
    const value = interestDraft.trim();
    if (!value || interests.some((interest) => interest.toLowerCase() === value.toLowerCase())) return;

    const next = [...interests, value];
    setInterests(next);
    localStorage.setItem(INTERESTS_STORAGE_KEY, JSON.stringify(next));
    setInterestDraft("");
  }

  function removeInterest(value: string) {
    const next = interests.filter((interest) => interest !== value);
    setInterests(next);
    localStorage.setItem(INTERESTS_STORAGE_KEY, JSON.stringify(next));
  }

  if (!activeGroup || remainingItems === 0) {
    return (
      <div className="flex flex-1 items-center justify-center bg-slate-50 px-6">
        <div className="max-w-sm text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
          <h2 className="mt-4 text-lg font-semibold text-slate-900">Inbox cleared</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            {dismissedCount > 0
              ? "All surfaced Slack items have been dismissed locally."
              : "No Slack items are available for this digest."}
          </p>
          {dismissedCount > 0 && (
            <button
              onClick={restoreDismissed}
              className="mt-4 inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              <RotateCcw className="h-4 w-4" />
              Restore dismissed
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 bg-slate-50 text-slate-900 xl:grid-cols-[260px_minmax(380px,0.9fr)_minmax(420px,1.1fr)]">
      <aside className="min-h-0 overflow-y-auto border-b border-slate-200 bg-white xl:border-b-0 xl:border-r">
        <div className="border-b border-slate-200 px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">Slack Digest</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">Triage</h2>
            </div>
            <Inbox className="h-5 w-5 text-slate-400" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Metric label="Open" value={remainingItems} />
            <Metric label="Read" value={dismissedCount} />
          </div>
          {dismissedCount > 0 && (
            <button
              onClick={restoreDismissed}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Restore dismissed
            </button>
          )}
        </div>

        <div className="border-b border-slate-200 px-4 py-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase text-slate-500">Sort</p>
            <SlidersHorizontal className="h-4 w-4 text-slate-400" />
          </div>
          <div className="grid grid-cols-2 rounded-md bg-slate-100 p-1">
            {(["priority", "recency"] as SortMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setSortMode(mode)}
                className={`rounded px-2 py-1.5 text-xs font-semibold capitalize ${
                  sortMode === mode ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        <div className="border-b border-slate-200 px-4 py-4">
          <p className="mb-3 text-xs font-semibold uppercase text-slate-500">Interests</p>
          <div className="flex flex-wrap gap-2">
            {interests.map((interest) => (
              <button
                key={interest}
                onClick={() => removeInterest(interest)}
                className="rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                title="Remove interest"
              >
                {interest}
              </button>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              value={interestDraft}
              onChange={(event) => setInterestDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") addInterest();
              }}
              className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-slate-400"
              placeholder="Add topic"
            />
            <button
              onClick={addInterest}
              className="rounded-md border border-slate-200 px-2 text-slate-600 hover:bg-slate-50"
              title="Add interest"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        <nav className="flex gap-2 overflow-x-auto px-3 py-3 xl:block xl:space-y-1 xl:overflow-visible">
          {navGroups.map((group) => (
            <button
              key={group.id}
              onClick={() => {
                setActiveGroupId(group.id);
                setSelectedItemKey(group.items[0] ? getItemKey(group.items[0]) : null);
              }}
              disabled={group.items.length === 0}
              className={`flex min-w-[190px] items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors xl:w-full xl:min-w-0 ${
                activeGroup.id === group.id
                  ? "bg-slate-950 text-white"
                  : "text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35"
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span>{group.emoji}</span>
                <span className="truncate font-medium">{group.title}</span>
              </span>
              <span
                className={`ml-2 rounded px-1.5 py-0.5 text-xs font-semibold ${
                  activeGroup.id === group.id ? "bg-white/15 text-white" : "bg-slate-100 text-slate-500"
                }`}
              >
                {group.items.length}
              </span>
            </button>
          ))}
        </nav>

        <div className="hidden border-t border-slate-200 px-4 py-3 text-xs text-slate-500 xl:block">
          <div className="flex items-center gap-2">
            <Layers3 className="h-3.5 w-3.5" />
            <span>Generated {formatDistanceToNow(new Date(digest.generatedAt), { addSuffix: true })}</span>
          </div>
          {formatDebugMetrics(digest) ? (
            <div className="mt-1 text-[11px] text-slate-400">{formatDebugMetrics(digest)}</div>
          ) : null}
        </div>
      </aside>

      <section className="min-h-0 border-b border-slate-200 bg-white xl:border-b-0 xl:border-r">
        <div className="border-b border-slate-200 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase text-slate-500">{activeGroup.title}</p>
              <h2 className="mt-1 truncate text-xl font-semibold text-slate-950">{activeGroup.summary}</h2>
            </div>
            <span className="rounded-md bg-slate-100 px-2 py-1 text-sm font-semibold text-slate-600">
              {activeItems.length}
            </span>
          </div>
        </div>

        <div className="min-h-[260px] overflow-y-auto p-3 xl:h-[calc(100vh-150px)]">
          <div className="space-y-2">
            {activeItems.map((item) => {
              const key = getItemKey(item);
              return (
                <ThreadCard
                  key={key}
                  item={item}
                  isSelected={selectedItem ? getItemKey(selectedItem) === key : false}
                  onSelect={() => setSelectedItemKey(key)}
                  onDismiss={() => dismissItem(item)}
                  feedback={feedback[key]}
                  onFeedback={(value) => setItemFeedback(item, value)}
                />
              );
            })}
          </div>
        </div>
      </section>

      <section className="min-h-0 bg-slate-50">
        {selectedItem ? (
          <MessagePreview
            item={selectedItem}
            onDismiss={() => dismissItem(selectedItem)}
            feedback={feedback[getItemKey(selectedItem)]}
            onFeedback={(value) => setItemFeedback(selectedItem, value)}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">
            Select a message
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function MessagePreview({
  item,
  onDismiss,
  feedback,
  onFeedback,
}: {
  item: DigestItem;
  onDismiss: () => void;
  feedback?: FeedbackValue;
  onFeedback: (value: FeedbackValue) => void;
}) {
  const [isExcerptExpanded, setIsExcerptExpanded] = useState(false);
  const excerpt = item.rawExcerpt || item.preview || "";
  const fullText = item.fullText || excerpt;
  const canExpandExcerpt = Boolean(fullText && fullText !== excerpt);

  function runAction(prompt: string) {
    const encoded = encodeURIComponent(prompt);
    window.open(`https://app.glean.com/chat?query=${encoded}`, "_blank");
    logEvent("action_selected", { itemId: item.id, prompt });
  }

  return (
    <div className="flex h-full min-h-[360px] flex-col">
      <div className="border-b border-slate-200 bg-white px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-slate-500">{item.channel ?? "Slack"}</p>
            <h2 className="mt-1 text-xl font-semibold leading-7 text-slate-950">{item.title}</h2>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <button
              onClick={() => onFeedback("up")}
              className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${
                feedback === "up"
                  ? "border-blue-200 bg-blue-50 text-blue-700"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <ThumbsUp className="h-4 w-4" />
              Useful
            </button>
            <button
              onClick={() => onFeedback("down")}
              className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${
                feedback === "down"
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <ThumbsDown className="h-4 w-4" />
              Not useful
            </button>
            {item.url && (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                onClick={() => logEvent("go_to_slack_clicked", { itemId: item.id, url: item.url })}
                className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Open thread
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
            <button
              onClick={onDismiss}
              className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              <Archive className="h-4 w-4" />
              Dismiss
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase text-slate-500">
              {isExcerptExpanded ? "Original message" : "Original excerpt"}
            </p>
            {canExpandExcerpt && (
              <button
                onClick={() => setIsExcerptExpanded((value) => !value)}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              >
                {isExcerptExpanded ? "Collapse" : "Expand"}
                {isExcerptExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-800">
            {isExcerptExpanded ? fullText : excerpt || fullText}
          </p>
        </div>

        <div className="mt-4 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase text-slate-500">Thread summary</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-800">{item.threadSummary || item.fullText || item.preview}</p>
        </div>

        {item.reason && (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4">
            <p className="text-xs font-semibold uppercase text-amber-700">Why surfaced</p>
            <p className="mt-2 text-sm leading-6 text-amber-950">{item.reason}</p>
          </div>
        )}

        {item.scoreExplanation && (
          <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-4">
            <p className="text-xs font-semibold uppercase text-blue-700">Priority score</p>
            <p className="mt-2 text-sm leading-6 text-blue-950">
              {item.rankingScore ?? 0} · {item.scoreExplanation}
            </p>
            {item.graphContext?.score ? (
              <div className="mt-3 rounded border border-blue-100 bg-white/70 p-3 text-xs leading-5 text-blue-900">
                <p className="font-semibold uppercase tracking-wide text-blue-700">Glean graph context</p>
                <p className="mt-1">
                  +{item.graphContext.score} graph boost from{" "}
                  {item.graphContext.recommendationCount} related recommendation
                  {item.graphContext.recommendationCount === 1 ? "" : "s"},{" "}
                  {item.graphContext.feedMatchCount} feed match
                  {item.graphContext.feedMatchCount === 1 ? "" : "es"}
                  {item.graphContext.peopleBoost ? `, and people context` : ""}.
                </p>
                {item.graphContext.relatedTitles.length ? (
                  <p className="mt-1 text-blue-700">
                    Related: {item.graphContext.relatedTitles.slice(0, 2).join("; ")}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        )}

        {item.suggestedActions?.length ? (
          <div className="mt-4 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase text-slate-500">Suggested next steps</p>
            <div className="mt-3 space-y-2">
              {item.suggestedActions.map((action) => (
                <button
                  key={action.id}
                  onClick={() => runAction(action.prompt)}
                  className="block w-full rounded-md border border-slate-200 px-3 py-2 text-left hover:bg-slate-50"
                >
                  <span className="text-sm font-semibold text-slate-900">{action.label}</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">{action.rationale}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="border-t border-slate-200 bg-white px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            {item.channel && (
              item.channelUrl ? (
                <a
                  href={item.channelUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 font-medium text-slate-600 hover:bg-slate-200"
                >
                  <Hash className="h-3 w-3" />
                  {item.channel}
                </a>
              ) : (
                <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 font-medium text-slate-600">
                  <Hash className="h-3 w-3" />
                  {item.channel}
                </span>
              )
            )}
            {item.author && (
              item.authorUrl ? (
                <a
                  href={item.authorUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 font-medium text-slate-600 hover:bg-slate-200"
                >
                  <User className="h-3 w-3" />
                  {item.author}
                </a>
              ) : (
                <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 font-medium text-slate-600">
                  <User className="h-3 w-3" />
                  {item.author}
                </span>
              )
            )}
            {item.timestamp ? <span>{formatDisplayTime(item.timestamp)}</span> : null}
          </div>
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              onClick={() => logEvent("go_to_slack_clicked", { itemId: item.id, url: item.url })}
              className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Open message in Slack
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function getItemKey(item: DigestItem) {
  return item.url || `${item.channel ?? "unknown"}:${item.timestamp ?? ""}:${item.title}`;
}

function formatDisplayTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() <= 1971) {
    return "";
  }

  const day = date.toLocaleDateString(undefined, { weekday: "short" });
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(":00", "");
  return `${day} ${time}`;
}

function formatDebugMetrics(digest: DigestData) {
  const debug = digest.debug;
  if (!debug) return "";

  const parts = [
    debug.slackResults !== undefined ? `${debug.slackResults} results` : "",
    debug.searchPages !== undefined ? `${debug.searchPages} pages` : "",
    debug.timingsMs?.search !== undefined ? `search ${formatMs(debug.timingsMs.search)}` : "",
    debug.timingsMs?.ai_digest !== undefined ? `AI ${formatMs(debug.timingsMs.ai_digest)}` : "",
    debug.searchWarnings?.length ? `${debug.searchWarnings.length} search warnings` : "",
  ].filter(Boolean);

  return parts.join(" · ");
}

function formatMs(value: number) {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`;
}

function rankItems(items: DigestItem[], sortMode: SortMode, interests: string[], feedback: FeedbackMap) {
  return [...items].sort((a, b) => {
    if (sortMode === "recency") {
      return getTimeValue(b.latestActivityTimestamp ?? b.timestamp) - getTimeValue(a.latestActivityTimestamp ?? a.timestamp);
    }

    return getPriorityScore(b, interests, feedback) - getPriorityScore(a, interests, feedback);
  });
}

function getPriorityScore(item: DigestItem, interests: string[], feedback: FeedbackMap) {
  const text = `${item.title} ${item.channel ?? ""} ${item.summary ?? ""} ${item.fullText ?? ""}`.toLowerCase();
  const interestBoost = interests.filter((interest) => text.includes(interest.toLowerCase())).length * 6;
  const learnedBoost = getFeedbackBoost(item, feedback);
  const suppressionPenalty = item.isSuppressed ? 10 : 0;
  return (item.rankingScore ?? 0) + interestBoost + learnedBoost + (item.graphContext?.score ?? 0) - suppressionPenalty;
}

function getFeedbackBoost(item: DigestItem, feedback: FeedbackMap) {
  let boost = feedback[getItemKey(item)] === "up" ? 16 : feedback[getItemKey(item)] === "down" ? -24 : 0;
  const itemTopics = new Set((item.topics ?? []).map((topic) => topic.toLowerCase()));
  const itemText = `${item.channel ?? ""} ${item.author ?? ""}`.toLowerCase();

  for (const [key, value] of Object.entries(feedback)) {
    if (key === getItemKey(item)) continue;
    const polarity = value === "up" ? 1 : -1;
    const keyText = key.toLowerCase();
    const topicMatch = Array.from(itemTopics).some((topic) => keyText.includes(topic));
    const channelOrAuthorMatch = itemText && keyText.includes(itemText);

    if (topicMatch) boost += polarity * 3;
    if (channelOrAuthorMatch) boost += polarity * 2;
  }

  return boost;
}

function getTimeValue(value?: string) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function inferInterestsFromDigest(digest: DigestData) {
  const counts = new Map<string, number>();

  for (const group of digest.groups) {
    for (const item of group.items) {
      for (const topic of item.topics ?? []) {
        counts.set(topic, (counts.get(topic) ?? 0) + 1);
      }
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([topic]) => topic);
}

function updateFeedbackProfile(item: DigestItem, value?: FeedbackValue) {
  const profile = readFeedbackProfile();
  const topics = item.topics ?? [];
  const channels = item.channel ? [item.channel] : [];
  const authors = item.author ? [item.author] : [];

  removeTerms(profile.likedTopics, topics);
  removeTerms(profile.dislikedTopics, topics);
  removeTerms(profile.likedChannels, channels);
  removeTerms(profile.dislikedChannels, channels);
  removeTerms(profile.likedAuthors, authors);
  removeTerms(profile.dislikedAuthors, authors);

  if (value === "up") {
    addTerms(profile.likedTopics, topics);
    addTerms(profile.likedChannels, channels);
    addTerms(profile.likedAuthors, authors);
  }

  if (value === "down") {
    addTerms(profile.dislikedTopics, topics);
    addTerms(profile.dislikedChannels, channels);
    addTerms(profile.dislikedAuthors, authors);
  }

  localStorage.setItem(FEEDBACK_PROFILE_STORAGE_KEY, JSON.stringify(profile));
}

function readFeedbackProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(FEEDBACK_PROFILE_STORAGE_KEY) ?? "{}");
    return {
      likedTopics: toStringArray(saved?.likedTopics),
      dislikedTopics: toStringArray(saved?.dislikedTopics),
      likedChannels: toStringArray(saved?.likedChannels),
      dislikedChannels: toStringArray(saved?.dislikedChannels),
      likedAuthors: toStringArray(saved?.likedAuthors),
      dislikedAuthors: toStringArray(saved?.dislikedAuthors),
    };
  } catch {
    return {
      likedTopics: [],
      dislikedTopics: [],
      likedChannels: [],
      dislikedChannels: [],
      likedAuthors: [],
      dislikedAuthors: [],
    };
  }
}

function addTerms(target: string[], terms: string[]) {
  for (const term of terms.map((value) => value.trim()).filter(Boolean)) {
    if (!target.some((entry) => entry.toLowerCase() === term.toLowerCase())) {
      target.push(term);
    }
  }
}

function removeTerms(target: string[], terms: string[]) {
  for (const term of terms) {
    const index = target.findIndex((entry) => entry.toLowerCase() === term.toLowerCase());
    if (index >= 0) {
      target.splice(index, 1);
    }
  }
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function logEvent(name: string, payload: Record<string, unknown>) {
  console.info("[SlackDigest]", name, {
    ...payload,
    at: new Date().toISOString(),
  });

  const token = localStorage.getItem("glean_token");
  const backendUrl = localStorage.getItem("glean_backend_url");
  if (!token || !backendUrl) return;

  fetch("/api/glean/activity", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-glean-token": token,
      "x-glean-backend": backendUrl,
    },
    body: JSON.stringify({
      eventName: name,
      payload,
      timestamp: new Date().toISOString(),
    }),
  }).catch(() => {
    // Analytics should never disrupt the digest UX.
  });
}
