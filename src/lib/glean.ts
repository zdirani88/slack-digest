import {
  TimeWindow,
  GleanSearchResult,
  GleanSearchResponse,
  DigestGroup,
  DigestData,
  DigestItem,
  DigestSignals,
  DigestAction,
  DigestGraphContext,
  DigestPreferences,
} from "@/types";

export function getTimeRange(window: TimeWindow) {
  const now = Math.floor(Date.now() / 1000);
  const hours: Record<TimeWindow, number> = { "24h": 24, "3d": 72, "7d": 168 };
  return { startTimestamp: now - hours[window] * 3600, endTimestamp: now };
}

const GLEAN_TIMEOUT_MS = 25000;
const OPTIONAL_GLEAN_TIMEOUT_MS = 5000;
const SEARCH_TARGET_RESULTS = 190;
const GRAPH_CONTEXT_LIMIT = 16;
const AI_MESSAGE_LIMIT = 60;
const AI_ENRICHMENT_LIMIT = 36;
const PEOPLE_BOOST_CACHE = new Map<string, number>();

type MessageCandidate = {
  id: string;
  title: string;
  channel: string;
  channelUrl: string;
  channelId: string;
  author: string;
  timestamp: string;
  originalTimestamp: string;
  latestActivityTimestamp: string;
  url: string;
  authorUrl: string;
  content: string;
  signals: DigestSignals;
  graphContext: DigestGraphContext;
};

type AiDigestEnrichment = {
  summary?: string;
  threadSummary?: string;
  reason?: string;
  suggestedActions?: DigestAction[];
};

type GraphSeed = {
  text: string;
  urls: Set<string>;
  titles: Set<string>;
};

type SearchQueryPlan = {
  query: string;
  pages: number;
  broad?: boolean;
};

type SearchPageOptions = {
  pageSize?: number;
  maxSnippetSize?: number;
  returnLlmContentOverSnippets?: boolean;
  timeoutMs?: number;
};

export type SearchProgress = {
  results: GleanSearchResult[];
  query: string;
  page: number;
  queryCount: number;
  searchPages: number;
};

export type FastSearchProgress = SearchProgress & {
  source: "fast";
};

export async function searchSlackFast(
  timeWindow: TimeWindow,
  token: string,
  backendUrl: string,
  preferences: DigestPreferences = {},
  onProgress?: (progress: FastSearchProgress) => void
): Promise<GleanSearchResult[]> {
  const url = `${backendUrl.replace(/\/$/, "")}/rest/api/v1/search`;
  const timeRange = getTimeRange(timeWindow);
  const queries = buildFastSearchQueries(preferences);
  const collected: GleanSearchResult[] = [];
  let settledQueries = 0;

  await Promise.allSettled(
    queries.map(async ({ query }, queryIndex) => {
      const data = await fetchSearchPage({
        url,
        token,
        query,
        timeRange,
        options: {
          pageSize: 10,
          maxSnippetSize: 500,
          returnLlmContentOverSnippets: false,
          timeoutMs: 8000,
        },
      });
      const slackResults = (data.results ?? []).filter(isSlackResult);
      const expanded = slackResults.flatMap(expandSlackResult);

      collected.push(...expanded);
      settledQueries += 1;
      onProgress?.({
        source: "fast",
        results: dedupeSlackResults(collected).slice(0, 80),
        query,
        page: 1,
        queryCount: queryIndex + 1,
        searchPages: settledQueries,
      });
    })
  );

  return dedupeSlackResults(collected).slice(0, 80);
}

export async function searchSlack(
  timeWindow: TimeWindow,
  token: string,
  backendUrl: string,
  preferences: DigestPreferences = {},
  onProgress?: (progress: SearchProgress) => void
): Promise<GleanSearchResult[]> {
  const url = `${backendUrl.replace(/\/$/, "")}/rest/api/v1/search`;
  const timeRange = getTimeRange(timeWindow);
  const queries = buildSearchQueries(preferences);

  const collected: GleanSearchResult[] = [];
  const errors: string[] = [];
  let hitRateLimit = false;
  let searchPages = 0;

  for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
    const { query, pages, broad } = queries[queryIndex];
    if (dedupeSlackResults(collected).length >= SEARCH_TARGET_RESULTS) {
      break;
    }

    if (hitRateLimit && broad) {
      continue;
    }

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
        searchPages += 1;

        onProgress?.({
          results: dedupeSlackResults(collected).slice(0, 220),
          query,
          page: page + 1,
          queryCount: queryIndex + 1,
          searchPages,
        });

        if (!data.hasMoreResults || !data.cursor) {
          break;
        }

        cursor = data.cursor;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown Glean search error";
        if (isRateLimitError(message)) {
          hitRateLimit = true;
        }
        errors.push(`query="${query || "<blank>"}" page=${page + 1}: ${summarizeSearchError(message)}`);
        break;
      }
    }
  }

  const deduped = dedupeSlackResults(collected).slice(0, 220);

  if (deduped.length === 0 && errors.length > 0) {
    if (hitRateLimit) {
      throw new Error("Glean's Slack connector is rate limited right now. Wait about a minute, then refresh or use a narrower time window.");
    }

    throw new Error(`Unable to load Slack search results. ${errors.slice(0, 3).join(" | ")}`);
  }

  return deduped;
}

function buildSearchQueries(preferences: DigestPreferences): SearchQueryPlan[] {
  const fastFirstQueries: SearchQueryPlan[] = [
    { query: "", pages: 1, broad: true },
  ];
  const priorityQueries: SearchQueryPlan[] = [
    { query: "@zubin", pages: 1 },
    { query: "arvind", pages: 1 },
    { query: "urgent blocker decision", pages: 1 },
  ];
  const baseQueries: SearchQueryPlan[] = [
    { query: "", pages: 2, broad: true },
    { query: "thread", pages: 2, broad: true },
    { query: "incident regression outage debug", pages: 1 },
    { query: "architecture implementation infra deployment", pages: 1 },
    { query: "idea brainstorm experiment prototype", pages: 1 },
    { query: "deal pipeline customer prospect gtm", pages: 1 },
    { query: "partner partnership nvidia joint", pages: 1 },
  ];
  const preferredQueries = [
    ...(preferences.interests ?? []),
    ...(preferences.likedTopics ?? []),
    ...(preferences.likedChannels ?? []).map((channel) => channel.replace(/^#/, "")),
    ...(preferences.likedAuthors ?? []),
  ]
    .map((query) => query.trim())
    .filter((query) => query.length > 2)
    .slice(0, 5)
    .map((query) => ({ query, pages: 1 }));
  const disliked = new Set(
    [
      ...(preferences.dislikedTopics ?? []),
      ...(preferences.dislikedChannels ?? []).map((channel) => channel.replace(/^#/, "")),
      ...(preferences.dislikedAuthors ?? []),
    ].map((value) => value.toLowerCase())
  );
  const merged = [...fastFirstQueries, ...preferredQueries, ...priorityQueries, ...baseQueries].filter(({ query }) => {
    const normalized = query.toLowerCase();
    return !normalized || !disliked.has(normalized);
  });
  const seen = new Set<string>();

  return merged.filter(({ query }) => {
    const key = query.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildFastSearchQueries(preferences: DigestPreferences): SearchQueryPlan[] {
  const preferredQueries = [
    ...(preferences.interests ?? []),
    ...(preferences.likedTopics ?? []),
    ...(preferences.likedChannels ?? []).map((channel) => channel.replace(/^#/, "")),
    ...(preferences.likedAuthors ?? []),
  ]
    .map((query) => query.trim())
    .filter((query) => query.length > 2)
    .slice(0, 2)
    .map((query) => ({ query, pages: 1 }));

  const queries: SearchQueryPlan[] = [
    ...preferredQueries,
    { query: "@zubin", pages: 1 },
    { query: "thread", pages: 1, broad: true },
    { query: "urgent blocker decision", pages: 1 },
    { query: "", pages: 1, broad: true },
  ];
  const seen = new Set<string>();

  return queries.filter(({ query }) => {
    const key = query.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

  const messages = buildMessageCandidates(results);

  // Keep the AI prompt bounded even when retrieval gets much broader.
  const initialCandidates = prioritizeMessages(messages).slice(0, AI_MESSAGE_LIMIT);
  const graphContexts = await fetchGraphContexts(initialCandidates, token, backendUrl);
  const graphMessages = messages.map((message) => {
    const graphContext = graphContexts.get(message.id) ?? emptyGraphContext();
    return {
      ...message,
      graphContext,
      signals: {
        ...message.signals,
        graph: graphContext.score,
      },
    };
  });
  const aiMessages = prioritizeMessages(graphMessages).slice(0, AI_MESSAGE_LIMIT);
  const itemEnrichments = await generateItemEnrichmentsViaGleanChat(
    aiMessages.slice(0, AI_ENRICHMENT_LIMIT),
    token,
    backendUrl
  ).catch(() => new Map<string, AiDigestEnrichment>());

  const prompt = `You are a Slack digest assistant for Zubin. Below are ${aiMessages.length} Slack messages/threads from the past ${timeLabels[timeWindow]}.

Organize them into these 8 categories. Return ONLY valid JSON, no markdown fences, no explanation.
You must include every provided message exactly once by id. If you are unsure about a category, choose the closest category, but do not omit the item.
For each item, write a fresh one-line AI summary that answers "why should I care?" Do not copy the title unless it is already the clearest possible punchline.
Also write a specific "reason" explaining why the item surfaced; do not use generic category descriptions.

Categories:
- system_issues: Human discussion about important incidents, regressions, bugs, outages, failures, security issues, debugging, root cause analysis
- automated_alerts: Bot/app/system generated alerts, escalation forms, monitoring posts, Jira/GitHub/PagerDuty/Sentry style notifications
- product_updates: Product launches, roadmap movement, feature changes, customer-facing product news
- engineering_updates: Architecture, implementation, infra projects, technical design, non-incident engineering updates
- ideas_and_innovations: Brainstorms, experiments, feature ideas, AI concepts, open-ended ideation
- sales_updates: Pipeline, deals, prospects, revenue discussions, enablement, field asks
- partnership_updates: Partners, partner launches, NVIDIA, customers, vendors, joint work, external collaboration
- leadership_attention: Direct asks to Zubin, VIP/executive mentions, urgent decisions, leadership-visible items that are not primarily system issues or automated alerts

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
          "summary": "one-line punchline, 90 characters max, answers why Zubin should care",
          "preview": "1-2 sentence preview",
          "rawExcerpt": "short excerpt from the original Slack text",
          "threadSummary": "brief gist of the thread/comments",
          "url": "original url or empty string",
          "reason": "specific why surfaced explanation based on engagement, people, topic, channel, or freshness",
          "timestamp": "ISO timestamp or empty string",
          "author": "author name",
          "suggestedActions": [
            {
              "id": "short_snake_case_id",
              "label": "short action label",
              "prompt": "pre-populated Glean prompt for this action",
              "rationale": "why this action is useful"
            }
          ]
        }
      ]
    }
  ]
}

Use these exact group ids: leadership_attention, system_issues, automated_alerts, product_updates, engineering_updates, ideas_and_innovations, sales_updates, partnership_updates.
Include all 8 groups even if empty (empty items array).
Only put each item in the single most relevant group.
Do not put bot/app generated system posts in leadership_attention. Put those in automated_alerts.
If a human on Zubin's team, a VIP, or a key leader is discussing an incident or regression, put it in system_issues.
Put technical design, architecture, implementation, infra, migration, API, backend/frontend, database, schema, performance, or release execution in engineering_updates unless it is primarily an incident.
Put brainstorms, experiments, prototypes, proposals, "what if", "could we", and feature ideas in ideas_and_innovations even when the topic is product-adjacent.

Messages with graph context:
${JSON.stringify(aiMessages, null, 2)}`;

  const chatUrl = `${backendUrl.replace(/\/$/, "")}/rest/api/v1/chat`;

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

    const jsonText = extractJsonObject(rawText);
    parsed = JSON.parse(jsonText);
  } catch {
    const fallbackGroups = buildFallbackGroups(graphMessages, itemEnrichments);
    parsed = {
      groups: fallbackGroups.length > 0
        ? fallbackGroups
        : buildEmptyGroups("Fell back to local grouping because Glean summarization was unavailable."),
    };
  }

  const groupsWithAllMessages = appendMissingMessages(
    parsed.groups ?? [],
    graphMessages,
    itemEnrichments
  );
  const groups = enrichGroups(ensureAllGroups(groupsWithAllMessages), graphMessages, itemEnrichments);
  const totalItems = groups.reduce((sum, g) => sum + g.items.length, 0);

  return {
    groups,
    generatedAt: new Date().toISOString(),
    timeWindow,
    totalItems,
    status: "complete",
  };
}

export function generateFastDigestFromResults(
  results: GleanSearchResult[],
  timeWindow: TimeWindow
): DigestData {
  const messages = buildMessageCandidates(results);
  const groups = enrichGroups(
    ensureAllGroups(buildFallbackGroups(prioritizeMessages(messages).slice(0, AI_MESSAGE_LIMIT))),
    messages
  );
  const totalItems = groups.reduce((sum, group) => sum + group.items.length, 0);

  return {
    groups,
    generatedAt: new Date().toISOString(),
    timeWindow,
    totalItems,
    status: "partial",
    progressMessage: "Showing a fast local ranking while Glean writes better summaries.",
  };
}

function buildMessageCandidates(results: GleanSearchResult[]): MessageCandidate[] {
  return results.map((r, i) => {
    const webUrl = r.url ?? "";
    const appUrl = r.nativeAppUrl ?? "";
    const messageUrl = webUrl || appUrl;
    const originalTimestamp = normalizeTimestamp(r.document?.metadata?.createTime);
    const latestActivityTimestamp = normalizeTimestamp(
      r.document?.metadata?.updateTime,
      r.document?.metadata?.createTime
    );

    return {
      id: getStableResultId(r, i),
      title: r.title ?? "Untitled",
      channel: r.document?.metadata?.container ?? "unknown",
      channelUrl: r.document?.metadata?.containerUrl ?? deriveSlackChannelUrl(webUrl || appUrl),
      channelId: r.document?.metadata?.containerId ?? "",
      author: r.document?.metadata?.author?.name ?? "unknown",
      timestamp: latestActivityTimestamp,
      originalTimestamp,
      latestActivityTimestamp,
      url: messageUrl,
      authorUrl: "",
      content: extractSlackContent(r),
      signals: inferSignals(r),
      graphContext: emptyGraphContext(),
    };
  });
}

function getStableResultId(result: GleanSearchResult, index: number) {
  const metadata = result.document?.metadata;
  const stable =
    result.document?.id ??
    metadata?.documentId ??
    result.nativeAppUrl ??
    result.url ??
    [
      metadata?.container,
      metadata?.createTime,
      metadata?.updateTime,
      result.title,
    ]
      .filter(Boolean)
      .join(":");

  return stable || `result_${index}`;
}

const GROUP_META: Array<{ id: string; title: string; emoji: string; priority: number }> = [
  { id: "leadership_attention", title: "Leadership Attention", emoji: "⚠️", priority: 1 },
  { id: "system_issues", title: "Team Escalations", emoji: "🧯", priority: 2 },
  { id: "automated_alerts", title: "Automated Alerts", emoji: "🤖", priority: 3 },
  { id: "product_updates", title: "Product Updates", emoji: "🚀", priority: 4 },
  { id: "engineering_updates", title: "Engineering Updates", emoji: "🛠️", priority: 5 },
  { id: "ideas_and_innovations", title: "Ideas & Innovation", emoji: "💡", priority: 6 },
  { id: "sales_updates", title: "Sales Updates", emoji: "📈", priority: 7 },
  { id: "partnership_updates", title: "Partnership Updates", emoji: "🤝", priority: 8 },
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
  options = {},
}: {
  url: string;
  token: string;
  query: string;
  timeRange: { startTimestamp: number; endTimestamp: number };
  cursor?: string;
  options?: SearchPageOptions;
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
      pageSize: options.pageSize ?? 35,
      timeRange,
      returnLlmContentOverSnippets: options.returnLlmContentOverSnippets ?? true,
      maxSnippetSize: options.maxSnippetSize ?? 2500,
      ...(cursor ? { cursor } : {}),
    }),
  }, 0, options.timeoutMs);

  if (!res.ok) {
    const body = await readErrorBody(res);
    throw new Error(`Glean search ${res.status}: ${body}`);
  }

  const data: GleanSearchResponse = await res.json();
  if (data.errorInfo?.errorMessages?.length) {
    throw new Error(formatGleanErrorMessages(data.errorInfo.errorMessages));
  }

  return data;
}

function formatGleanErrorMessages(messages: unknown[]) {
  return messages
    .map((message) => {
      if (typeof message === "string") {
        return message;
      }

      if (message && typeof message === "object") {
        const record = message as Record<string, unknown>;
        const useful =
          record.message ??
          record.errorMessage ??
          record.error ??
          record.reason ??
          record.code ??
          record.status;

        return typeof useful === "string" || typeof useful === "number"
          ? String(useful)
          : JSON.stringify(record);
      }

      return String(message);
    })
    .filter(Boolean)
    .join("; ");
}

function isRateLimitError(message: string) {
  const text = message.toLowerCase();
  return text.includes("429") || text.includes("rate limit") || text.includes("retry after");
}

function summarizeSearchError(message: string) {
  const text = message
    .replace(/<[^>]*>/g, " ")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

  if (isRateLimitError(text)) {
    const retry = text.match(/retry after:?\s*([a-z0-9.]+)/i)?.[1];
    return retry ? `Glean Slack rate limit; retry after ${retry}.` : "Glean Slack rate limit.";
  }

  return text.length > 260 ? `${text.slice(0, 257)}...` : text;
}

async function readErrorBody(res: Response) {
  const text = await res.text().catch(() => "");
  if (!text) {
    return res.statusText || "Unknown error";
  }

  try {
    const parsed = JSON.parse(text);
    if (parsed?.errorInfo?.errorMessages?.length) {
      return formatGleanErrorMessages(parsed.errorInfo.errorMessages);
    }

    if (parsed?.message || parsed?.error || parsed?.errorMessage) {
      return String(parsed.message ?? parsed.error ?? parsed.errorMessage);
    }

    return JSON.stringify(parsed);
  } catch {
    return text;
  }
}

async function fetchGraphContexts(
  messages: MessageCandidate[],
  token: string,
  backendUrl: string
): Promise<Map<string, DigestGraphContext>> {
  const feed = await fetchPersonalFeed(token, backendUrl).catch(() => emptyGraphSeed());
  const limited = messages.slice(0, GRAPH_CONTEXT_LIMIT);
  const entries = await Promise.all(
    limited.map(async (message) => {
      const [recommendations, peopleBoost] = await Promise.all([
        fetchRecommendations(message, token, backendUrl).catch(() => []),
        fetchPeopleBoost(message, token, backendUrl).catch(() => 0),
      ]);
      return [message.id, buildGraphContext(message, feed, recommendations, peopleBoost)] as const;
    })
  );

  return new Map(entries);
}

async function fetchPersonalFeed(token: string, backendUrl: string): Promise<GraphSeed> {
  const data = await fetchOptionalJson(`${backendUrl.replace(/\/$/, "")}/rest/api/v1/feed`, token, {
    pageSize: 50,
    categories: ["DOCUMENT_SUGGESTION", "RECENT", "TRENDING"],
  });

  return graphSeedFromUnknown(data);
}

async function fetchRecommendations(
  message: MessageCandidate,
  token: string,
  backendUrl: string
): Promise<string[]> {
  if (!message.url) {
    return [];
  }

  const data = await fetchOptionalJson(`${backendUrl.replace(/\/$/, "")}/rest/api/v1/recommenddocuments`, token, {
    url: message.url,
    document: { url: message.url },
    pageSize: 8,
  });
  const seed = graphSeedFromUnknown(data);

  return Array.from(seed.titles).slice(0, 5);
}

async function fetchPeopleBoost(
  message: MessageCandidate,
  token: string,
  backendUrl: string
): Promise<number> {
  if (!message.author || message.author === "unknown") {
    return 0;
  }

  const cacheKey = message.author.toLowerCase();
  const cached = PEOPLE_BOOST_CACHE.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const data = await fetchOptionalJson(`${backendUrl.replace(/\/$/, "")}/rest/api/v1/listentities`, token, {
    query: message.author,
    entityType: "PEOPLE",
    requestOptions: { facetBucketSize: 5 },
    pageSize: 5,
  });
  const text = normalizeText(JSON.stringify(data)).toLowerCase();
  let boost = 0;

  if (text.includes("executive") || text.includes("founder") || text.includes("vp") || text.includes("chief")) {
    boost += 8;
  }

  if (text.includes("manager") || text.includes("lead") || text.includes("director")) {
    boost += 4;
  }

  PEOPLE_BOOST_CACHE.set(cacheKey, boost);
  return boost;
}

async function fetchOptionalJson(url: string, token: string, body: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPTIONAL_GLEAN_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new Error(`Optional Glean context call failed: ${res.status}`);
  }

  return res.json();
}

function buildGraphContext(
  message: MessageCandidate,
  feed: GraphSeed,
  relatedTitles: string[],
  peopleBoost: number
): DigestGraphContext {
  const haystack = `${message.title} ${message.channel} ${message.author} ${message.content}`.toLowerCase();
  const feedMatchCount = countFeedMatches(haystack, feed);
  const recommendationCount = relatedTitles.length;
  const score = Math.min(24, recommendationCount * 3 + feedMatchCount * 4 + peopleBoost);
  const notes = [
    recommendationCount > 0 ? `${recommendationCount} related Glean recommendation${recommendationCount === 1 ? "" : "s"}` : "",
    feedMatchCount > 0 ? `${feedMatchCount} match${feedMatchCount === 1 ? "" : "es"} in personalized Glean feed context` : "",
    peopleBoost > 0 ? "author appears important in Glean people context" : "",
  ].filter(Boolean);

  return {
    score,
    recommendationCount,
    feedMatchCount,
    peopleBoost,
    relatedTitles,
    notes,
  };
}

function graphSeedFromUnknown(value: unknown): GraphSeed {
  const seed = emptyGraphSeed();
  collectGraphStrings(value, seed);
  seed.text = Array.from(seed.titles).join(" ").toLowerCase();
  return seed;
}

function collectGraphStrings(value: unknown, seed: GraphSeed) {
  if (!value) return;

  if (typeof value === "string") {
    if (value.startsWith("http")) {
      seed.urls.add(value);
    } else if (value.length > 3 && value.length < 180) {
      seed.titles.add(value);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectGraphStrings(entry, seed));
    return;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const title = normalizeText(record.title ?? record.name ?? record.displayName);
    const url = normalizeText(record.url);

    if (title) seed.titles.add(title);
    if (url) seed.urls.add(url);

    Object.values(record).forEach((entry) => collectGraphStrings(entry, seed));
  }
}

function countFeedMatches(haystack: string, feed: GraphSeed) {
  let matches = 0;
  const terms = Array.from(feed.titles)
    .flatMap((title) => title.toLowerCase().split(/[^a-z0-9]+/))
    .filter((term) => term.length > 4);
  const uniqueTerms = Array.from(new Set(terms)).slice(0, 120);

  for (const term of uniqueTerms) {
    if (haystack.includes(term)) matches += 1;
  }

  return Math.min(matches, 5);
}

function emptyGraphSeed(): GraphSeed {
  return { text: "", urls: new Set(), titles: new Set() };
}

async function generateItemEnrichmentsViaGleanChat(
  messages: MessageCandidate[],
  token: string,
  backendUrl: string
): Promise<Map<string, AiDigestEnrichment>> {
  if (messages.length === 0) {
    return new Map();
  }

  const enrichments = new Map<string, AiDigestEnrichment>();
  const batchSize = 15;

  for (let index = 0; index < messages.length; index += batchSize) {
    const batch = messages.slice(index, index + batchSize);
    const batchEnrichments = await generateItemEnrichmentBatchViaGleanChat(batch, token, backendUrl);

    for (const [id, enrichment] of Array.from(batchEnrichments.entries())) {
      enrichments.set(id, enrichment);
    }
  }

  return enrichments;
}

async function generateItemEnrichmentBatchViaGleanChat(
  messages: MessageCandidate[],
  token: string,
  backendUrl: string
): Promise<Map<string, AiDigestEnrichment>> {
  const chatUrl = `${backendUrl.replace(/\/$/, "")}/rest/api/v1/chat`;
  const prompt = `You are creating concise Slack digest entries for Zubin.

For each Slack item below, return ONLY valid JSON. No markdown fences.
Write a real one-line summary from the Slack text. Do not use generic phrases like "human-readable system issue discussion."
Every summary and reason must be specific to that item. Mention the actual topic, decision, customer, incident, person, or next step when available.

JSON format:
{
  "items": [
    {
      "id": "item_0",
      "summary": "one-line punchline, max 90 characters, answers why Zubin should care",
      "threadSummary": "1-2 sentence gist of the post and replies",
      "reason": "specific reason it surfaced, based on topic, people, channel, engagement, or freshness",
      "suggestedActions": [
        {
          "id": "short_snake_case_id",
          "label": "short action label",
          "prompt": "pre-populated Glean prompt for this action",
          "rationale": "why this action is useful"
        }
      ]
    }
  ]
}

Items:
${JSON.stringify(
  messages.map((message) => ({
    id: message.id,
    title: message.title,
    channel: message.channel,
    author: message.author,
    timestamp: message.latestActivityTimestamp || message.originalTimestamp || message.timestamp,
    signals: message.signals,
    content: compactText(message.content).slice(0, 1200),
  })),
  null,
  2
)}`;

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
    const body = await readErrorBody(res);
    throw new Error(`Glean chat ${res.status}: ${body}`);
  }

  const data = await res.json();
  const responseMessages: Array<{ author?: string; fragments?: Array<{ text?: string }>; content?: string }> =
    data.messages ?? data.followUpResults ?? [];
  const aiMessage = responseMessages.find(
    (m) => m.author === "GLEAN_AI" || m.author === "ASSISTANT"
  ) ?? responseMessages[responseMessages.length - 1];

  const rawText =
    aiMessage?.fragments?.map((f) => f.text ?? "").join("") ??
    aiMessage?.content ??
    "";
  const parsed = JSON.parse(extractJsonObject(rawText)) as { items?: Array<AiDigestEnrichment & { id?: string }> };
  const enrichments = new Map<string, AiDigestEnrichment>();

  for (const item of parsed.items ?? []) {
    if (!item.id) continue;

    enrichments.set(item.id, {
      summary: normalizeText(item.summary),
      threadSummary: normalizeText(item.threadSummary),
      reason: normalizeText(item.reason),
      suggestedActions: normalizeActions(item.suggestedActions),
    });
  }

  return enrichments;
}

function extractJsonObject(value: string) {
  const withoutFence = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");

  if (start >= 0 && end > start) {
    return withoutFence.slice(start, end + 1);
  }

  return withoutFence;
}

function normalizeActions(value: unknown): DigestAction[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const actions = value
    .map((action) => {
      if (!action || typeof action !== "object") {
        return null;
      }

      const record = action as Record<string, unknown>;
      const label = normalizeText(record.label);
      const prompt = normalizeText(record.prompt);
      const rationale = normalizeText(record.rationale);

      if (!label || !prompt) {
        return null;
      }

      return {
        id: normalizeText(record.id) || label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
        label,
        prompt,
        rationale,
      };
    })
    .filter((action): action is DigestAction => Boolean(action));

  return actions.length ? actions.slice(0, 3) : undefined;
}

async function fetchWithRetry(url: string, init: RequestInit, attempt = 0, timeoutMs = GLEAN_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (attempt < 1) {
      await sleep(400 * (attempt + 1));
      return fetchWithRetry(url, init, attempt + 1, timeoutMs);
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

function extractSlackContent(result: GleanSearchResult) {
  const parts = [
    ...(result.fullTextList ?? []),
    ...((result.relatedResults ?? [])
      .flatMap((group) => group.results ?? [])
      .flatMap((entry) => entry.snippets?.map((snippet) => snippet.text) ?? [])),
    ...(result.snippets?.map((snippet) => snippet.text) ?? []),
  ];

  return parts
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .filter((part, index, all) => all.indexOf(part) === index)
    .join("\n\n");
}

function normalizeTimestamp(...values: Array<string | undefined>) {
  for (const value of values) {
    if (!value) continue;

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) continue;

    // Glean often uses the Unix epoch as a placeholder for "unknown".
    if (date.getUTCFullYear() <= 1971) continue;

    return value;
  }

  return "";
}

function deriveSlackChannelUrl(value: string) {
  if (!value.includes("slack.com/archives/")) {
    return "";
  }

  const match = value.match(/^(https:\/\/[^/]+\/archives\/[^/?#]+)/);
  return match?.[1] ?? "";
}

function prioritizeMessages(
  messages: MessageCandidate[]
) {
  return [...messages].sort((a, b) => scoreMessage(b) - scoreMessage(a));
}

function scoreMessage(message: {
  title: string;
  author: string;
  channel: string;
  content: string;
  timestamp: string;
  signals?: DigestSignals;
}) {
  const haystack = `${message.title} ${message.channel} ${message.author ?? ""} ${message.content}`.toLowerCase();
  let score = 0;

  if (haystack.includes("@")) score += 6;
  if (haystack.includes("urgent") || haystack.includes("asap") || haystack.includes("blocker")) score += 6;
  if (isHumanSystemDiscussion(message)) score += 8;
  if (isAutomatedAlert(message)) score -= 4;
  if (isSystemIssueText(haystack) || haystack.includes("launch")) score += 5;
  if (isEngineeringUpdateText(haystack)) score += 5;
  if (isIdeaText(haystack)) score += 5;
  if (isSalesText(haystack) || isPartnershipText(haystack)) score += 4;
  if (haystack.includes("thread between") || haystack.includes("thread_ts")) score += 5;
  if (haystack.includes("dm") || haystack.includes("direct message")) score += 4;
  if (isVipOrLeaderText(haystack)) score += 8;
  if (message.timestamp) score += 1;
  score += Math.min(16, message.signals?.graph ?? 0);

  return score;
}

function buildFallbackGroups(
  messages: MessageCandidate[],
  itemEnrichments = new Map<string, AiDigestEnrichment>()
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
    const enrichment = itemEnrichments.get(message.id);
    const preview = compactText(message.content || message.title);
    const topics = inferTopics(`${message.title} ${message.channel} ${message.content}`);
    const score = scoreDigestItem({
      title: message.title,
      channel: message.channel,
      content: message.content,
      timestamp: message.latestActivityTimestamp,
      signals: message.signals,
      topics,
    });
    const item = {
      id: message.id,
      title: message.title || deriveTitleFromPreview(preview),
      channel: message.channel,
      channelUrl: message.channelUrl,
      channelId: message.channelId,
      summary: enrichment?.summary ?? makePunchline(message.title, message.content),
      preview,
      rawExcerpt: preview,
      threadSummary: enrichment?.threadSummary ?? summarizeThread(message.content),
      fullText: message.content || preview,
      url: message.url,
      reason: "",
      timestamp: message.timestamp,
      originalTimestamp: message.originalTimestamp,
      latestActivityTimestamp: message.latestActivityTimestamp,
      author: message.author,
      authorUrl: message.authorUrl,
      rankingScore: score.total,
      scoreExplanation: score.explanation,
      signals: message.signals,
      suggestedActions: enrichment?.suggestedActions ?? suggestActions(message.title, message.content, message.channel),
      topics,
      isSuppressed: score.isSuppressed,
      suppressionReason: score.suppressionReason,
      graphContext: message.graphContext,
    };

    const bucket = chooseGroup(message);
    const target = grouped.get(bucket.id);
    if (target) {
      target.items.push({
        ...item,
        reason: enrichment?.reason ?? bucket.reason,
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

function appendMissingMessages(
  aiGroups: DigestGroup[],
  messages: MessageCandidate[],
  itemEnrichments = new Map<string, AiDigestEnrichment>()
) {
  const seenIds = new Set(
    aiGroups.flatMap((group) => group.items.map((item) => item.id))
  );
  const missingMessages = messages.filter((message) => !seenIds.has(message.id));

  if (missingMessages.length === 0) {
    return aiGroups;
  }

  const fallbackGroups = buildFallbackGroups(missingMessages, itemEnrichments);
  const merged = new Map<string, DigestGroup>();

  for (const group of ensureAllGroups(aiGroups)) {
    merged.set(group.id, {
      ...group,
      items: [...group.items],
    });
  }

  for (const group of fallbackGroups) {
    const target = merged.get(group.id);
    if (!target) {
      merged.set(group.id, group);
      continue;
    }

    target.items.push(...group.items);
  }

  return GROUP_META.map((meta) => merged.get(meta.id) ?? { ...meta, summary: "", items: [] });
}

function enrichGroups(
  groups: DigestGroup[],
  messages: MessageCandidate[],
  itemEnrichments = new Map<string, AiDigestEnrichment>()
): DigestGroup[] {
  const byId = new Map(messages.map((message) => [message.id, message]));

  return groups.map((group) => ({
    ...group,
    items: group.items
      .map((item) => {
        const message = byId.get(item.id);
        if (!message) return enrichStandaloneItem(item);

        const enrichment = itemEnrichments.get(message.id);
        const content = message.content || item.fullText || item.preview || item.title;
        const topics = inferTopics(`${message.title} ${message.channel} ${content}`);
        const score = scoreDigestItem({
          title: message.title,
          channel: message.channel,
          content,
          timestamp: message.latestActivityTimestamp,
          signals: message.signals,
          topics,
        });

        return {
          ...item,
          channel: item.channel ?? message.channel,
          channelUrl: item.channelUrl ?? message.channelUrl,
          channelId: item.channelId ?? message.channelId,
          summary: enrichment?.summary ?? item.summary ?? makePunchline(item.title || message.title, content),
          preview: item.preview || compactText(content),
          rawExcerpt: item.rawExcerpt ?? compactText(content),
          threadSummary: enrichment?.threadSummary ?? item.threadSummary ?? summarizeThread(content),
          fullText: item.fullText ?? content,
          url: item.url ?? message.url,
          timestamp: item.timestamp ?? message.latestActivityTimestamp,
          originalTimestamp: item.originalTimestamp ?? message.originalTimestamp,
          latestActivityTimestamp: item.latestActivityTimestamp ?? message.latestActivityTimestamp,
          author: item.author ?? message.author,
          authorUrl: item.authorUrl ?? message.authorUrl,
          rankingScore: item.rankingScore ?? score.total,
          scoreExplanation: item.scoreExplanation ?? score.explanation,
          reason: enrichment?.reason ?? makeSpecificFallbackReason(message, score.explanation),
          signals: item.signals ?? message.signals,
          graphContext: item.graphContext ?? message.graphContext,
          suggestedActions:
            enrichment?.suggestedActions ??
            item.suggestedActions ??
            suggestActions(item.title || message.title, content, message.channel),
          topics: item.topics ?? topics,
          isSuppressed: item.isSuppressed ?? score.isSuppressed,
          suppressionReason: item.suppressionReason ?? score.suppressionReason,
        };
      })
      .sort((a, b) => (b.rankingScore ?? 0) - (a.rankingScore ?? 0)),
  }));
}

function enrichStandaloneItem(item: DigestItem): DigestItem {
  const content = item.fullText || item.preview || item.title;
  const signals = item.signals ?? emptySignals();
  const topics = item.topics ?? inferTopics(`${item.title} ${item.channel ?? ""} ${content}`);
  const score = scoreDigestItem({
    title: item.title,
    channel: item.channel ?? "",
    content,
    timestamp: item.latestActivityTimestamp ?? item.timestamp ?? "",
    signals,
    topics,
  });

  return {
    ...item,
    summary: item.summary ?? makePunchline(item.title, content),
    rawExcerpt: item.rawExcerpt ?? compactText(content),
    threadSummary: item.threadSummary ?? summarizeThread(content),
    fullText: item.fullText ?? content,
    rankingScore: item.rankingScore ?? score.total,
    scoreExplanation: item.scoreExplanation ?? score.explanation,
    reason: item.reason || score.explanation,
    signals,
    graphContext: item.graphContext ?? emptyGraphContext(),
    suggestedActions: item.suggestedActions ?? suggestActions(item.title, content, item.channel ?? ""),
    topics,
    isSuppressed: item.isSuppressed ?? score.isSuppressed,
    suppressionReason: item.suppressionReason ?? score.suppressionReason,
  };
}

function chooseGroup(message: {
  title: string;
  content: string;
  channel: string;
  author: string;
}) {
  const haystack = `${message.title} ${message.author} ${message.content}`.toLowerCase();

  if (isAutomatedAlert(message)) {
    return {
      id: "automated_alerts",
      reason: "This appears to be generated by an app, bot, or monitoring workflow, so it is separated from human issue discussion.",
    };
  }

  if (isSystemIssueText(haystack)) {
    return {
      id: "system_issues",
      reason: isHumanSystemDiscussion(message)
        ? "A human team member or leader is discussing an incident, bug, regression, or debugging thread."
        : "This is a human-readable system issue discussion rather than a generated alert.",
    };
  }

  if (isIdeaText(haystack)) {
    return {
      id: "ideas_and_innovations",
      reason: "This message is centered on a brainstorm, experiment, prototype, or exploratory product/AI idea.",
    };
  }

  if (isEngineeringUpdateText(haystack)) {
    return {
      id: "engineering_updates",
      reason: "This thread looks like technical design, implementation, architecture, infrastructure, or release execution.",
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

  return {
    id: "product_updates",
    reason: "This is informational but appears closest to the broader product narrative.",
  };
}

function isEngineeringUpdateText(value: string) {
  return [
    "architecture",
    "technical design",
    "implementation",
    "infra",
    "deployment",
    "engineering",
    "migration",
    "refactor",
    "api",
    "backend",
    "frontend",
    "database",
    "schema",
    "performance",
    "scalability",
    "release train",
    "code review",
    "pr ",
    "pull request",
  ].some((term) => value.includes(term));
}

function isIdeaText(value: string) {
  return [
    "idea",
    "brainstorm",
    "experiment",
    "prototype",
    "what if",
    "proposal",
    "concept",
    "explore",
    "exploration",
    "hypothesis",
    "agent idea",
    "feature idea",
    "future",
    "could we",
    "should we",
    "would it be possible",
  ].some((term) => value.includes(term));
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
    "security",
    "sev",
    "p0",
    "p1",
  ].some((term) => value.includes(term));
}

function isAutomatedAlert(message: {
  title: string;
  content: string;
  channel: string;
  author: string;
}) {
  const author = message.author.toLowerCase();
  const text = `${message.title} ${message.channel} ${message.content}`.toLowerCase();

  if (
    author.includes("app") ||
    author.includes("bot") ||
    author.includes("jira") ||
    author.includes("github") ||
    author.includes("pagerduty") ||
    author.includes("sentry") ||
    author.includes("datadog") ||
    author.includes("buildkite") ||
    author.includes("jenkins")
  ) {
    return true;
  }

  return [
    "escalation raised by",
    "created a tracking jira",
    "view the escalation",
    "resolve button",
    "resolve with autofill",
    "automated",
    "workflow",
    "alert:",
    "monitoring",
    "opened issue",
    "opened pr",
    "status changed",
    "new relic",
  ].some((term) => text.includes(term));
}

function isHumanSystemDiscussion(message: {
  title: string;
  content: string;
  channel: string;
  author: string;
}) {
  const text = `${message.title} ${message.channel} ${message.author} ${message.content}`.toLowerCase();
  return !isAutomatedAlert(message) && (isVipOrLeaderText(text) || isTeamDiscussionText(text));
}

function isVipOrLeaderText(value: string) {
  return [
    "arvind",
    "jensen",
    "ceo",
    "cto",
    "cpo",
    "founder",
    "exec",
    "leadership",
    "vp ",
    "svp",
  ].some((term) => value.includes(term));
}

function isTeamDiscussionText(value: string) {
  return [
    "@zubin",
    "zubin",
    "team",
    "oncall",
    "dri",
    "taking a look",
    "can you",
    "please look",
    "need help",
    "blocked",
    "blocker",
    "release testing",
    "ftr",
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

function inferSignals(result: GleanSearchResult): DigestSignals {
  const text = extractSlackContent(result).toLowerCase();
  const relatedCount = (result.relatedResults ?? [])
    .flatMap((group) => group.results ?? [])
    .length;
  const clusteredCount = result.clusteredResults?.length ?? 0;
  const reactions = countMatches(text, [":+", " reacted", "reaction", "👍", "❤️"]);
  const replies = Math.max(relatedCount, countMatches(text, [" replied", " thread ", "comment", "response"]));
  const forwards = Math.max(clusteredCount, countMatches(text, ["forwarded", "reposted", "shared in", "cross-posted"]));

  return {
    replies,
    reactions,
    forwards,
    engagement: replies * 2 + reactions + forwards * 4,
    affinity: 0,
    freshness: 0,
    visibility: 0,
    noisePenalty: 0,
    graph: 0,
  };
}

function scoreDigestItem({
  title,
  channel,
  content,
  timestamp,
  signals,
  topics,
}: {
  title: string;
  channel: string;
  content: string;
  timestamp: string;
  signals: DigestSignals;
  topics: string[];
}) {
  const haystack = `${title} ${channel} ${content}`.toLowerCase();
  const ageHours = getAgeHours(timestamp);
  const freshness = ageHours === null ? 3 : Math.max(0, 20 - Math.min(20, ageHours / 6));
  const affinity = topics.length * 2 + (isVipOrLeaderText(haystack) ? 8 : 0);
  const visibility = getVisibilityScore(channel, haystack);
  const noisePenalty = getNoisePenalty(channel, haystack);
  const engagement = Math.min(24, signals.engagement);
  const forwards = Math.min(12, signals.forwards * 4);
  const graph = Math.min(24, signals.graph);
  const total = Math.round(engagement + affinity + freshness + visibility + forwards + graph - noisePenalty);
  const reasons = [
    engagement > 5 ? "high engagement" : "",
    affinity > 4 ? "matches inferred interests or VIP signals" : "",
    freshness > 12 ? "recent thread activity" : "",
    visibility > 4 ? "broad or important channel" : "",
    forwards > 0 ? "forwarded or reposted signal" : "",
    graph > 0 ? "reinforced by Glean graph context" : "",
    noisePenalty > 0 ? "deweighted noisy channel" : "",
  ].filter(Boolean);

  return {
    total,
    explanation: reasons.length ? sentenceCase(reasons.join(", ")) : "Relevant Slack activity in the selected window.",
    isSuppressed: noisePenalty > 0 && total < 12,
    suppressionReason: noisePenalty > 0 ? "High-volume channel was deweighted." : "",
  };
}

function makeSpecificFallbackReason(message: MessageCandidate, scoreExplanation: string) {
  const topics = inferTopics(`${message.title} ${message.channel} ${message.content}`);
  const signals = [
    message.signals.replies > 0 ? `${message.signals.replies} repl${message.signals.replies === 1 ? "y" : "ies"}` : "",
    message.signals.reactions > 0 ? `${message.signals.reactions} reaction${message.signals.reactions === 1 ? "" : "s"}` : "",
    message.signals.forwards > 0 ? `${message.signals.forwards} repost/forward signal${message.signals.forwards === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  const topicText = topics.length ? ` around ${topics.slice(0, 2).join(" and ")}` : "";
  const signalText = signals.length ? ` with ${signals.join(", ")}` : "";
  const channelText = message.channel ? ` in #${message.channel}` : "";
  const authorText = message.author && message.author !== "unknown" ? ` from ${message.author}` : "";

  return `Surfaced${channelText}${authorText}${topicText}${signalText}; ${scoreExplanation.toLowerCase()}`;
}

function inferTopics(value: string) {
  const text = value.toLowerCase();
  const candidates: Array<[string, string[]]> = [
    ["AI", ["ai", "agent", "llm", "model", "glean assistant"]],
    ["Product", ["product", "launch", "roadmap", "feature", "release"]],
    ["Engineering", ["architecture", "implementation", "infra", "api", "backend", "frontend", "schema"]],
    ["Ideas", ["idea", "brainstorm", "experiment", "prototype", "what if", "proposal"]],
    ["Sales", ["deal", "pipeline", "prospect", "sales", "revenue", "pricing"]],
    ["Partnerships", ["partner", "partnership", "nvidia", "alliance", "co-sell"]],
    ["Reliability", ["incident", "regression", "bug", "latency", "outage", "debug"]],
  ];

  return candidates
    .filter(([, terms]) => terms.some((term) => text.includes(term)))
    .map(([topic]) => topic)
    .slice(0, 5);
}

function makePunchline(title: string, content: string) {
  const text = compactText(content || title);
  if (!text || text === "No preview available.") return title;

  const firstSentence = text.split(/(?<=[.!?])\s+/)[0] ?? text;
  return firstSentence.length > 120 ? `${firstSentence.slice(0, 117)}...` : firstSentence;
}

function summarizeThread(content: string) {
  const normalized = normalizeText(content);
  if (!normalized) return "No thread summary available.";

  const sentences = normalized.split(/(?<=[.!?])\s+/).filter(Boolean);
  return sentences.slice(0, 3).join(" ");
}

function suggestActions(title: string, content: string, channel: string): DigestAction[] {
  const text = `${title} ${channel} ${content}`.toLowerCase();
  const actions: DigestAction[] = [];

  if (isSalesText(text) || isPartnershipText(text)) {
    actions.push({
      id: "share_partner_context",
      label: "Share with partner or GTM lead",
      prompt: `Draft a concise internal note explaining the partner/customer implications of this Slack thread: ${title}`,
      rationale: "The thread appears tied to external collaboration or revenue motion.",
    });
  }

  if (isSystemIssueText(text) || isEngineeringUpdateText(text)) {
    actions.push({
      id: "summarize_implications",
      label: "Summarize implications",
      prompt: `Summarize the technical implications, owner, current status, and suggested follow-up for this Slack thread: ${title}`,
      rationale: "The thread may affect reliability, execution, or engineering priorities.",
    });
  }

  if (text.includes("@") || text.includes("can you") || text.includes("please")) {
    actions.push({
      id: "draft_response",
      label: "Draft a response",
      prompt: `Draft a short Slack response for this thread. Be helpful, direct, and ask one clarifying question only if needed: ${title}`,
      rationale: "The thread looks like it may need a reply from you.",
    });
  }

  return actions.slice(0, 3);
}

function emptySignals(): DigestSignals {
  return {
    replies: 0,
    reactions: 0,
    forwards: 0,
    engagement: 0,
    affinity: 0,
    freshness: 0,
    visibility: 0,
    noisePenalty: 0,
    graph: 0,
  };
}

function emptyGraphContext(): DigestGraphContext {
  return {
    score: 0,
    recommendationCount: 0,
    feedMatchCount: 0,
    peopleBoost: 0,
    relatedTitles: [],
    notes: [],
  };
}

function getAgeHours(value: string) {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return null;
  return Math.max(0, (Date.now() - time) / 36e5);
}

function getVisibilityScore(channel: string, text: string) {
  const value = `${channel} ${text}`.toLowerCase();
  if (value.includes("leadership") || value.includes("company") || value.includes("exec")) return 8;
  if (value.includes("public") || value.includes("announce") || value.includes("general")) return 5;
  return 2;
}

function getNoisePenalty(channel: string, text: string) {
  const value = `${channel} ${text}`.toLowerCase();
  if (value.includes("alerts") || value.includes("notifications") || value.includes("bot")) return 12;
  if (value.includes("help-") || value.includes("triage") || value.includes("escalations")) return 5;
  return 0;
}

function countMatches(value: string, terms: string[]) {
  return terms.reduce((count, term) => count + (value.includes(term) ? 1 : 0), 0);
}

function sentenceCase(value: string) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}.` : value;
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
  const text = normalizeText(value);
  if (!text) {
    return "No preview available.";
  }

  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function deriveTitleFromPreview(preview: string) {
  return preview.length > 80 ? `${preview.slice(0, 77)}...` : preview;
}
