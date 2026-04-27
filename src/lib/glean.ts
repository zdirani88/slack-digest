import {
  TimeWindow,
  GleanSearchResult,
  GleanSearchResponse,
  DigestGroup,
  DigestData,
} from "@/types";

export function getTimeRange(window: TimeWindow) {
  const now = Math.floor(Date.now() / 1000);
  const hours: Record<TimeWindow, number> = { "24h": 24, "3d": 72, "7d": 168 };
  return { startTimestamp: now - hours[window] * 3600, endTimestamp: now };
}

const GLEAN_TIMEOUT_MS = 25000;

export async function searchSlack(
  timeWindow: TimeWindow,
  token: string,
  backendUrl: string
): Promise<GleanSearchResult[]> {
  const url = `${backendUrl.replace(/\/$/, "")}/api/v1/search`;
  const timeRange = getTimeRange(timeWindow);
  const queries = [
    { query: "", pages: 2 },
    { query: "@zubin", pages: 2 },
    { query: "thread", pages: 1 },
    { query: "urgent", pages: 1 },
    { query: "incident", pages: 2 },
    { query: "regression", pages: 1 },
    { query: "debug", pages: 1 },
    { query: "launch", pages: 1 },
    { query: "idea", pages: 1 },
    { query: "deal", pages: 2 },
    { query: "pipeline", pages: 1 },
    { query: "prospect", pages: 1 },
    { query: "customer call", pages: 1 },
    { query: "partner", pages: 2 },
    { query: "partnership", pages: 1 },
    { query: "nvidia", pages: 1 },
    { query: "joint", pages: 1 },
    { query: "arvind", pages: 1 },
  ];

  const collected: GleanSearchResult[] = [];
  const errors: string[] = [];

  for (const { query, pages } of queries) {
    let cursor: string | undefined;

    for (let page = 0; page < pages; page += 1) {
      try {
        const data = await fetchSearchPage({
          url,
          token,
          query,
          timeRange,
          cursor,
        });

        const slackResults = (data.results ?? []).filter(isSlackResult);
        const expanded = slackResults.flatMap(expandSlackResult);
        collected.push(...expanded);

        if (!data.hasMoreResults || !data.cursor) {
          break;
        }

        cursor = data.cursor;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown Glean search error";
        errors.push(`query="${query || "<blank>"}" page=${page + 1}: ${message}`);
        break;
      }
    }
  }

  const deduped = dedupeSlackResults(collected).slice(0, 180);

  if (deduped.length === 0 && errors.length > 0) {
    throw new Error(`Unable to load Slack search results. ${errors.slice(0, 3).join(" | ")}`);
  }

  return deduped;
}

export async function generateDigestViaGleanChat(
  results: GleanSearchResult[],
  timeWindow: TimeWindow,
  token: string,
  backendUrl: string
): Promise<DigestData> {
  const timeLabels: Record<TimeWindow, string> = {
    "24h": "24 hours",
    "3d": "3 days",
    "7d": "7 days",
  };

  const messages = results.map((r, i) => ({
    id: `item_${i}`,
    title: r.title ?? "Untitled",
    channel: r.document?.metadata?.container ?? "unknown",
    channelUrl: r.document?.metadata?.containerUrl ?? "",
    author: r.document?.metadata?.author?.name ?? "unknown",
    timestamp: r.document?.metadata?.updateTime ?? r.document?.metadata?.createTime ?? "",
    url: r.nativeAppUrl ?? r.url ?? "",
    content:
      r.fullTextList?.join(" ") ??
      r.relatedResults
        ?.flatMap((group) => group.results ?? [])
        .flatMap((entry) => entry.snippets?.map((snippet) => snippet.text) ?? [])
        .join(" ") ??
      r.snippets?.map((s) => s.text).join(" ") ??
      "",
  }));

  // Keep the AI prompt bounded even when retrieval gets much broader.
  const aiMessages = prioritizeMessages(messages).slice(0, 80);

  const prompt = `You are a Slack digest assistant for Zubin. Below are ${aiMessages.length} Slack messages/threads from the past ${timeLabels[timeWindow]}.

Organize them into these 7 categories. Return ONLY valid JSON, no markdown fences, no explanation.

Categories:
- system_issues: Incidents, regressions, bugs, outages, latency, failures, security issues, debugging, root cause analysis
- product_updates: Product launches, roadmap movement, feature changes, customer-facing product news
- engineering_updates: Architecture, implementation, infra projects, technical design, non-incident engineering updates
- ideas_and_innovations: Brainstorms, experiments, feature ideas, AI concepts, open-ended ideation
- sales_updates: Pipeline, deals, prospects, revenue discussions, enablement, field asks
- partnership_updates: Partners, partner launches, NVIDIA, customers, vendors, joint work, external collaboration
- leadership_attention: Direct asks to Zubin, VIP/executive mentions, urgent decisions, leadership-visible items that are not primarily system issues

JSON format:
{
  "groups": [
    {
      "id": "product_updates",
      "title": "Product Updates",
      "emoji": "🚀",
      "summary": "2-3 sentence overview",
      "items": [
        {
          "id": "item_0",
          "title": "short descriptive title",
          "channel": "channel-name",
          "channelUrl": "url or empty string",
          "preview": "1-2 sentence preview",
          "url": "original url or empty string",
          "reason": "why this belongs here",
          "timestamp": "ISO timestamp or empty string",
          "author": "author name"
        }
      ]
    }
  ]
}

Use these exact group ids: leadership_attention, system_issues, product_updates, engineering_updates, ideas_and_innovations, sales_updates, partnership_updates.
Include all 7 groups even if empty (empty items array).
Only put each item in the single most relevant group.

Messages:
${JSON.stringify(aiMessages, null, 2)}`;

  const chatUrl = `${backendUrl.replace(/\/$/, "")}/api/v1/chat`;

  let parsed: { groups: DigestGroup[] };
  try {
    const res = await fetchWithRetry(chatUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [{ author: "USER", fragments: [{ text: prompt }] }],
        stream: false,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Glean chat ${res.status}: ${body}`);
    }

    const data = await res.json();

    const responseMessages: Array<{ author?: string; fragments?: Array<{ text?: string }>; content?: string }> =
      data.messages ?? data.followUpResults ?? [];
    const aiMessage = responseMessages.find(
      (m) => m.author === "GLEAN_AI" || m.author === "ASSISTANT"
    ) ?? responseMessages[responseMessages.length - 1];

    if (!aiMessage) throw new Error("Empty response from Glean chat");

    const rawText =
      aiMessage.fragments?.map((f) => f.text ?? "").join("") ??
      aiMessage.content ??
      "";

    const jsonText = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    parsed = JSON.parse(jsonText);
  } catch {
    const fallbackGroups = buildFallbackGroups(messages);
    parsed = {
      groups: fallbackGroups.length > 0
        ? fallbackGroups
        : buildEmptyGroups("Fell back to local grouping because Glean summarization was unavailable."),
    };
  }

  const groups = ensureAllGroups(parsed.groups ?? []);
  const totalItems = groups.reduce((sum, g) => sum + g.items.length, 0);

  return {
    groups,
    generatedAt: new Date().toISOString(),
    timeWindow,
    totalItems,
  };
}

const GROUP_META: Array<{ id: string; title: string; emoji: string; priority: number }> = [
  { id: "leadership_attention", title: "Leadership Attention", emoji: "⚠️", priority: 1 },
  { id: "system_issues", title: "System Issues", emoji: "🧯", priority: 2 },
  { id: "product_updates", title: "Product Updates", emoji: "🚀", priority: 3 },
  { id: "engineering_updates", title: "Engineering Updates", emoji: "🛠️", priority: 4 },
  { id: "ideas_and_innovations", title: "Ideas & Innovation", emoji: "💡", priority: 5 },
  { id: "sales_updates", title: "Sales Updates", emoji: "📈", priority: 6 },
  { id: "partnership_updates", title: "Partnership Updates", emoji: "🤝", priority: 7 },
];

function ensureAllGroups(incoming: DigestGroup[]): DigestGroup[] {
  return GROUP_META.map((meta) => {
    const existing = incoming.find((g) => g.id === meta.id);
    return {
      ...meta,
      summary: existing?.summary ?? "",
      items: existing?.items ?? [],
    };
  });
}

function buildEmptyGroups(note: string): DigestGroup[] {
  return GROUP_META.map((meta) => ({
    ...meta,
    summary: meta.priority === 1 ? note : "",
    items: [],
  }));
}

async function fetchSearchPage({
  url,
  token,
  query,
  timeRange,
  cursor,
}: {
  url: string;
  token: string;
  query: string;
  timeRange: { startTimestamp: number; endTimestamp: number };
  cursor?: string;
}) {
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      datasourceFilter: "SLACK",
      pageSize: 60,
      timeRange,
      ...(cursor ? { cursor } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Glean search ${res.status}: ${body}`);
  }

  const data: GleanSearchResponse = await res.json();
  if (data.errorInfo?.errorMessages?.length) {
    throw new Error(data.errorInfo.errorMessages.join("; "));
  }

  return data;
}

async function fetchWithRetry(url: string, init: RequestInit, attempt = 0): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GLEAN_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (attempt < 1) {
      await sleep(400 * (attempt + 1));
      return fetchWithRetry(url, init, attempt + 1);
    }

    throw normalizeFetchError(error);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeFetchError(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return new Error("Request to Glean timed out. Please try again.");
    }

    if (error.message === "fetch failed") {
      return new Error("Could not reach Glean. Check your network connection or backend URL and try again.");
    }

    return error;
  }

  return new Error("Unknown network error while reaching Glean.");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSlackResult(result: GleanSearchResult) {
  const datasource = result.document?.datasource ?? result.document?.metadata?.datasource;
  const url = result.nativeAppUrl ?? result.url ?? "";
  return (
    (typeof datasource === "string" && datasource.toLowerCase() === "slack") ||
    url.startsWith("slack://") ||
    url.includes("slack.com/archives/")
  );
}

function expandSlackResult(result: GleanSearchResult): GleanSearchResult[] {
  const clustered = (result.clusteredResults ?? []).filter(isSlackResult);
  return [result, ...clustered];
}

function dedupeSlackResults(results: GleanSearchResult[]) {
  const seen = new Set<string>();
  const deduped: GleanSearchResult[] = [];

  for (const result of results) {
    const key =
      result.document?.id ??
      result.nativeAppUrl ??
      result.url ??
      `${result.title ?? "untitled"}::${result.document?.metadata?.updateTime ?? result.document?.metadata?.createTime ?? ""}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(result);
  }

  return deduped;
}

function prioritizeMessages(
  messages: Array<{
    id: string;
    title: string;
    channel: string;
    channelUrl: string;
    author: string;
    timestamp: string;
    url: string;
    content: string;
  }>
) {
  return [...messages].sort((a, b) => scoreMessage(b) - scoreMessage(a));
}

function scoreMessage(message: {
  title: string;
  channel: string;
  content: string;
  timestamp: string;
}) {
  const haystack = `${message.title} ${message.channel} ${message.content}`.toLowerCase();
  let score = 0;
  const vipTerms = ["arvind", "jensen", "ceo"];

  if (haystack.includes("@")) score += 6;
  if (haystack.includes("urgent") || haystack.includes("asap") || haystack.includes("blocker")) score += 6;
  if (isSystemIssueText(haystack) || haystack.includes("launch")) score += 5;
  if (isSalesText(haystack) || isPartnershipText(haystack)) score += 4;
  if (haystack.includes("idea") || haystack.includes("ai") || haystack.includes("prototype")) score += 3;
  if (haystack.includes("thread between") || haystack.includes("thread_ts")) score += 5;
  if (haystack.includes("dm") || haystack.includes("direct message")) score += 4;
  if (vipTerms.some((term) => haystack.includes(term))) score += 8;
  if (message.timestamp) score += 1;

  return score;
}

function buildFallbackGroups(
  messages: Array<{
    id: string;
    title: string;
    channel: string;
    channelUrl: string;
    author: string;
    timestamp: string;
    url: string;
    content: string;
  }>
): DigestGroup[] {
  const grouped = new Map<string, DigestGroup>();

  for (const meta of GROUP_META) {
    grouped.set(meta.id, {
      ...meta,
      summary: "",
      items: [],
    });
  }

  const channelBuckets = new Map<string, typeof messages>();

  for (const message of messages) {
    const preview = compactText(message.content || message.title);
    const item = {
      id: message.id,
      title: message.title || deriveTitleFromPreview(preview),
      channel: message.channel,
      channelUrl: message.channelUrl,
      preview,
      url: message.url,
      reason: "",
      timestamp: message.timestamp,
      author: message.author,
    };

    const bucket = chooseGroup(message);
    const target = grouped.get(bucket.id);
    if (target) {
      target.items.push({
        ...item,
        reason: bucket.reason,
      });
    }

    const existing = channelBuckets.get(message.channel) ?? [];
    existing.push(message);
    channelBuckets.set(message.channel, existing);
  }

  const results = GROUP_META.map((meta) => {
    const group = grouped.get(meta.id)!;
    group.summary = summarizeGroup(group);
    return group;
  });

  return results;
}

function chooseGroup(message: {
  title: string;
  content: string;
  channel: string;
  author: string;
}) {
  const haystack = `${message.title} ${message.content}`.toLowerCase();

  if (isSystemIssueText(haystack)) {
    return {
      id: "system_issues",
      reason: "This looks like an incident, bug, regression, or debugging thread that should be separated from leadership asks.",
    };
  }

  if (isSalesText(haystack)) {
    return {
      id: "sales_updates",
      reason: "This thread appears related to pipeline, field work, revenue, or customer-commercial updates.",
    };
  }

  if (isPartnershipText(haystack)) {
    return {
      id: "partnership_updates",
      reason: "This message references partners, customers, external collaborators, or shared go-to-market work.",
    };
  }

  if (
    haystack.includes("@") ||
    haystack.includes("urgent") ||
    haystack.includes("asap") ||
    haystack.includes("please") ||
    haystack.includes("blocker") ||
    haystack.includes("need") ||
    haystack.includes("can you") ||
    haystack.includes("for review") ||
    haystack.includes("exec") ||
    haystack.includes("leadership")
  ) {
    return {
      id: "leadership_attention",
      reason: "This looks like a blocker, direct ask, or leadership-visible thread that may need quick attention.",
    };
  }

  if (
    haystack.includes("launch") ||
    haystack.includes("roadmap") ||
    haystack.includes("feature") ||
    haystack.includes("product") ||
    haystack.includes("release") ||
    haystack.includes("rollout")
  ) {
    return {
      id: "product_updates",
      reason: "This message looks tied to roadmap movement, launches, or product-facing updates.",
    };
  }

  if (
    haystack.includes("infra") ||
    haystack.includes("deployment") ||
    haystack.includes("architecture") ||
    haystack.includes("implementation") ||
    haystack.includes("technical design") ||
    haystack.includes("engineering")
  ) {
    return {
      id: "engineering_updates",
      reason: "This thread looks like engineering work, architecture, infrastructure, or release execution.",
    };
  }

  if (
    haystack.includes("idea") ||
    haystack.includes("brainstorm") ||
    haystack.includes("experiment") ||
    haystack.includes("prototype") ||
    haystack.includes("agent") ||
    haystack.includes("ai") ||
    haystack.includes("what if")
  ) {
    return {
      id: "ideas_and_innovations",
      reason: "This message feels exploratory, inventive, or centered on a new idea worth tracking.",
    };
  }

  return {
    id: "product_updates",
    reason: "This is informational but appears closest to the broader product narrative.",
  };
}

function isSystemIssueText(value: string) {
  return [
    "incident",
    "debug",
    "root cause",
    "outage",
    "latency",
    "regression",
    "bug",
    "failure",
    "failed",
    "error",
    "broken",
    "blocker",
    "escalation",
    "security",
    "sev",
    "p0",
    "p1",
  ].some((term) => value.includes(term));
}

function isSalesText(value: string) {
  return [
    "deal",
    "pipeline",
    "prospect",
    "sales",
    "revenue",
    "customer call",
    "pricing",
    "renewal",
    "expansion",
    "account",
    "ae ",
    "gtm",
    "field",
    "opportunity",
  ].some((term) => value.includes(term));
}

function isPartnershipText(value: string) {
  return [
    "partner",
    "partnership",
    "vendor",
    "nvidia",
    "joint",
    "external",
    "alliance",
    "integration partner",
    "co-sell",
    "launch partner",
    "customer",
  ].some((term) => value.includes(term));
}

function summarizeGroup(group: DigestGroup) {
  if (group.items.length === 0) {
    return "";
  }

  const channels = Array.from(
    new Set(group.items.map((item) => item.channel).filter(Boolean))
  );
  return `${group.items.length} item${group.items.length === 1 ? "" : "s"} surfaced${
    channels.length ? ` across ${channels.slice(0, 3).join(", ")}` : ""
  }.`;
}

function compactText(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) {
    return "No preview available.";
  }

  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

function deriveTitleFromPreview(preview: string) {
  return preview.length > 80 ? `${preview.slice(0, 77)}...` : preview;
}
