"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DigestData, DigestGroup, DigestItem } from "@/types";
import ThreadCard from "./ThreadCard";
import { formatDistanceToNow } from "date-fns";
import {
  Archive,
  CheckCircle2,
  ExternalLink,
  Hash,
  Inbox,
  Layers3,
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

type SortMode = "priority" | "recency";

export default function DigestView({ digest }: Props) {
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set());
  const [activeGroupId, setActiveGroupId] = useState("");
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("priority");
  const [interests, setInterests] = useState<string[]>([]);
  const [interestDraft, setInterestDraft] = useState("");

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(DISMISSED_STORAGE_KEY) ?? "[]");
      setDismissedKeys(new Set(Array.isArray(saved) ? saved : []));
    } catch {
      setDismissedKeys(new Set());
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

  const visibleGroups = groups.filter((group) => group.items.length > 0);
  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? visibleGroups[0];
  const activeItems = useMemo(() => {
    const items = activeGroup?.items ?? [];
    return rankItems(items, sortMode, interests);
  }, [activeGroup, sortMode, interests]);
  const selectedItem =
    activeItems.find((item) => getItemKey(item) === selectedItemKey) ?? activeItems[0] ?? null;
  const remainingItems = groups.reduce((sum, group) => sum + group.items.length, 0);
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
      <aside className="min-h-0 border-b border-slate-200 bg-white xl:border-b-0 xl:border-r">
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

        <nav className="flex gap-2 overflow-x-auto px-3 py-3 xl:block xl:space-y-1 xl:overflow-y-auto">
          {groups.map((group) => (
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
                />
              );
            })}
          </div>
        </div>
      </section>

      <section className="min-h-0 bg-slate-50">
        {selectedItem ? (
          <MessagePreview item={selectedItem} onDismiss={() => dismissItem(selectedItem)} />
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

function MessagePreview({ item, onDismiss }: { item: DigestItem; onDismiss: () => void }) {
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
          <button
            onClick={onDismiss}
            className="inline-flex shrink-0 items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            <Archive className="h-4 w-4" />
            Dismiss
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase text-slate-500">Original excerpt</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-800">{item.rawExcerpt || item.fullText || item.preview}</p>
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

  return formatDistanceToNow(date, { addSuffix: true });
}

function rankItems(items: DigestItem[], sortMode: SortMode, interests: string[]) {
  return [...items].sort((a, b) => {
    if (sortMode === "recency") {
      return getTimeValue(b.latestActivityTimestamp ?? b.timestamp) - getTimeValue(a.latestActivityTimestamp ?? a.timestamp);
    }

    return getPriorityScore(b, interests) - getPriorityScore(a, interests);
  });
}

function getPriorityScore(item: DigestItem, interests: string[]) {
  const text = `${item.title} ${item.channel ?? ""} ${item.summary ?? ""} ${item.fullText ?? ""}`.toLowerCase();
  const interestBoost = interests.filter((interest) => text.includes(interest.toLowerCase())).length * 6;
  const suppressionPenalty = item.isSuppressed ? 10 : 0;
  return (item.rankingScore ?? 0) + interestBoost - suppressionPenalty;
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

function logEvent(name: string, payload: Record<string, unknown>) {
  console.info("[SlackDigest]", name, {
    ...payload,
    at: new Date().toISOString(),
  });
}
