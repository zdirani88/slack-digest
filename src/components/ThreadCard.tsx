"use client";

import { DigestItem } from "@/types";
import { Archive, Clock, Hash, MessageSquare, Repeat2, ThumbsDown, ThumbsUp, User } from "lucide-react";
import { parseISO } from "date-fns";
import { ReactNode } from "react";

interface Props {
  item: DigestItem;
  isSelected: boolean;
  onSelect: () => void;
  onDismiss: () => void;
  feedback?: "up" | "down";
  onFeedback: (value: "up" | "down") => void;
}

function tryFormatTime(ts?: string): string {
  if (!ts) return "";
  try {
    const date = parseISO(ts);
    if (Number.isNaN(date.getTime()) || date.getUTCFullYear() <= 1971) {
      return "";
    }

    const day = date.toLocaleDateString(undefined, { weekday: "short" });
    const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(":00", "");
    return `${day} ${time}`;
  } catch {
    return "";
  }
}

export default function ThreadCard({ item, isSelected, onSelect, onDismiss, feedback, onFeedback }: Props) {
  const contentSummary = item.threadSummary || item.preview || item.rawExcerpt || item.fullText || "";

  return (
    <article
      className={`rounded-md border bg-white shadow-sm transition-colors ${
        isSelected ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-200 hover:border-slate-300"
      }`}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect();
          }
        }}
        className="block w-full px-3 py-3 text-left"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="line-clamp-1 text-sm font-semibold leading-5 text-slate-950">{item.summary || item.title}</p>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{contentSummary}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <FeedbackButton
              active={feedback === "up"}
              label="Useful"
              onClick={() => onFeedback("up")}
              icon={<ThumbsUp className="h-4 w-4" />}
            />
            <FeedbackButton
              active={feedback === "down"}
              label="Not useful"
              onClick={() => onFeedback("down")}
              icon={<ThumbsDown className="h-4 w-4" />}
            />
            <button
              onClick={(event) => {
                event.stopPropagation();
                onDismiss();
              }}
              title="Dismiss"
              aria-label="Dismiss message"
              className="rounded-md p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-700"
            >
              <Archive className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {item.channel && (
            <MetaChip icon={<Hash className="h-3 w-3" />} label={item.channel} href={item.channelUrl} />
          )}
          {item.author && (
            <MetaChip icon={<User className="h-3 w-3" />} label={item.author} />
          )}
          {tryFormatTime(item.timestamp) && (
            <MetaChip icon={<Clock className="h-3 w-3" />} label={tryFormatTime(item.timestamp)} />
          )}
          {item.signals?.replies ? (
            <MetaChip icon={<MessageSquare className="h-3 w-3" />} label={`${item.signals.replies} replies`} />
          ) : null}
          {item.signals?.reactions ? (
            <MetaChip icon={<ThumbsUp className="h-3 w-3" />} label={`${item.signals.reactions} reactions`} />
          ) : null}
          {item.signals?.forwards ? (
            <MetaChip icon={<Repeat2 className="h-3 w-3" />} label={`${item.signals.forwards} reposts`} />
          ) : null}
        </div>
      </div>
    </article>
  );
}

function FeedbackButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      title={label}
      aria-label={label}
      className={`rounded-md p-1.5 ${
        active
          ? "bg-blue-50 text-blue-700"
          : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      }`}
    >
      {icon}
    </button>
  );
}

function MetaChip({ icon, label, href }: { icon: ReactNode; label: string; href?: string }) {
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => event.stopPropagation()}
        className="inline-flex max-w-full items-center gap-1 rounded bg-slate-100 px-1.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-200 hover:text-slate-700"
      >
        {icon}
        <span className="truncate">{label}</span>
      </a>
    );
  }

  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded bg-slate-100 px-1.5 py-1 text-xs font-medium text-slate-500">
      {icon}
      <span className="truncate">{label}</span>
    </span>
  );
}
