"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { DigestData, TimeWindow } from "@/types";
import DigestView from "@/components/DigestView";
import { fetchDigest, formatErrorMessage } from "@/lib/clientDigest";
import { RefreshCw, LogOut, Clock, Newspaper } from "lucide-react";

const TIME_WINDOW_LABELS: Record<TimeWindow, string> = {
  "24h": "Last 24 hours",
  "3d": "Last 3 days",
  "7d": "Last 7 days",
};

export default function DigestPage() {
  const router = useRouter();
  const [digest, setDigest] = useState<DigestData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("24h");

  const generate = useCallback(
    async (tw: TimeWindow) => {
      setLoading(true);
      setError("");

      try {
        setDigest(await fetchDigest({ timeWindow: tw, router }));
      } catch (error) {
        setError(error instanceof Error ? error.message : "Network error. Is the dev server running, and can it reach Glean?");
      } finally {
        setLoading(false);
      }
    },
    [router]
  );

  useEffect(() => {
    const token = localStorage.getItem("glean_token");
    if (!token) {
      router.replace("/setup");
      return;
    }
    generate(timeWindow);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleTimeWindowChange(tw: TimeWindow) {
    setTimeWindow(tw);
    generate(tw);
  }

  function handleLogout() {
    localStorage.removeItem("glean_token");
    localStorage.removeItem("glean_backend_url");
    router.replace("/setup");
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f7f5ef]">
      <header className="flex shrink-0 items-center justify-between border-b border-stone-200/70 bg-white/85 px-5 py-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="text-xl text-amber-600">⚡</span>
          <div>
            <h1 className="font-serif text-xl text-stone-900">Slack Digest</h1>
            <p className="text-xs text-stone-400">Product, engineering, ideas, sales, and partnerships in one morning brief</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-2xl bg-stone-100 p-1">
            {(["24h", "3d", "7d"] as TimeWindow[]).map((tw) => (
              <button
                key={tw}
                onClick={() => handleTimeWindowChange(tw)}
                disabled={loading}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                  timeWindow === tw
                    ? "bg-white text-stone-900 shadow-sm"
                    : "text-stone-500 hover:text-stone-700"
                }`}
              >
                {tw}
              </button>
            ))}
          </div>

          <button
            onClick={() => router.push("/briefing")}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-stone-600 transition-colors hover:bg-stone-100"
          >
            <Newspaper className="h-3.5 w-3.5" />
            Briefing
          </button>

          <button
            onClick={() => generate(timeWindow)}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-stone-600 transition-colors hover:bg-stone-100 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Generating…" : "Refresh"}
          </button>

          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {loading && !digest && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-stone-200 border-t-amber-600" />
            <p className="text-sm text-stone-400">
              Fetching Slack content for {TIME_WINDOW_LABELS[timeWindow]}…
            </p>
          </div>
        )}

        {error && !loading && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <span className="text-3xl">⚠️</span>
            <p className="text-sm font-medium text-stone-700">{error}</p>
            <button
              onClick={() => generate(timeWindow)}
              className="rounded-xl bg-stone-900 px-4 py-2 text-sm text-white hover:bg-stone-700"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && digest && digest.totalItems === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <Clock className="h-8 w-8 text-stone-300" />
            <p className="text-sm font-medium text-stone-500">No Slack activity found</p>
            <p className="text-xs text-stone-400">Try a wider time window</p>
          </div>
        )}

        {digest && digest.totalItems > 0 && (
          <DigestView digest={digest} loading={loading} />
        )}
      </div>
    </div>
  );
}
