"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DigestData, DigestGroup, DigestItem } from "@/types";
import ThreadCard from "./ThreadCard";
import { formatDistanceToNow } from "date-fns";
import {
  Archive,
  CheckCircle2,
  ExternalLink,
  Inbox,
  Layers3,
  RotateCcw,
} from "lucide-react";

interface Props {
  digest: DigestData;
  loading: boolean;
}

const DISMISSED_STORAGE_KEY = "slack_digest_dismissed_items";

export default function DigestView({ digest }: Props) {
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set());
  const [activeGroupId, setActiveGroupId] = useState("");
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(DISMISSED_STORAGE_KEY) ?? "[]");
      setDismissedKeys(new Set(Array.isArray(saved) ? saved : []));
    } catch {
      setDismissedKeys(new Set());
    }
  }, []);

  const groups = useMemo(() => {
    return digest.groups.map((group) => ({
      ...group,
      items: group.items.filter((item) => !dismissedKeys.has(getItemKey(item))),
    }));
  }, [digest.groups, dismissedKeys]);

  const visibleGroups = groups.filter((group) => group.items.length > 0);
  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? visibleGroups[0];
  const activeItems = activeGroup?.items ?? [];
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
          <p className="whitespace-pre-wrap text-sm leading-7 text-slate-800">{item.preview}</p>
        </div>

        {item.reason && (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4">
            <p className="text-xs font-semibold uppercase text-amber-700">Why surfaced</p>
            <p className="mt-2 text-sm leading-6 text-amber-950">{item.reason}</p>
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 bg-white px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            {item.author ? <span>{item.author}</span> : null}
            {item.timestamp ? <span>{item.author ? " · " : ""}{item.timestamp}</span> : null}
          </div>
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Open in Slack
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
