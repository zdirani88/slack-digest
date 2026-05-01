import { DigestData, DigestItem } from "@/types";

export type PersonalBriefingData = {
  generatedAt: string;
  timeWindow: DigestData["timeWindow"];
  totalSourceItems: number;
  sections: PersonalBriefingSection[];
  progressMessage?: string;
};

export type PersonalBriefingSection = {
  id: string;
  eyebrow: string;
  title: string;
  summary: string;
  bullets: string[];
  whyItMatters?: string;
  followUp?: string;
  sourceCount: number;
  signals: string[];
};

type SectionConfig = {
  id: string;
  eyebrow: string;
  title: string;
  terms: string[];
  groupIds?: string[];
  maxItems?: number;
};

const SECTION_CONFIGS: SectionConfig[] = [
  {
    id: "gtm",
    eyebrow: "Section 1",
    title: "Sales, GTM & Marketing Pulse",
    terms: [
      "sales",
      "gtm",
      "marketing",
      "pipeline",
      "deal",
      "revenue",
      "customer",
      "prospect",
      "launch",
      "field",
      "cargurus",
      "partnership",
      "partner",
    ],
    groupIds: ["sales_updates", "partnership_updates"],
  },
  {
    id: "rnd",
    eyebrow: "Section 2",
    title: "R&D, Engineering & Product Pulse",
    terms: [
      "rnd",
      "r&d",
      "engineering",
      "engineer",
      "product",
      "roadmap",
      "release",
      "architecture",
      "infra",
      "implementation",
      "bug",
      "regression",
      "deployment",
      "assistant",
      "search",
    ],
    groupIds: ["product_updates", "engineering_updates"],
  },
  {
    id: "ideas",
    eyebrow: "Section 3",
    title: "Ideas & Innovation Radar",
    terms: [
      "idea",
      "ideas",
      "brainstorm",
      "prototype",
      "experiment",
      "innovation",
      "feature",
      "proposal",
      "concept",
      "feedback",
      "request",
    ],
    groupIds: ["ideas_and_innovations"],
  },
  {
    id: "incidents",
    eyebrow: "Section 4",
    title: "Outages, Incidents & Customer Impact",
    terms: [
      "incident",
      "outage",
      "p0",
      "p1",
      "sev",
      "severity",
      "escalation",
      "regression",
      "customer impact",
      "blocked",
      "down",
      "degraded",
      "jira",
      "zendesk",
    ],
    groupIds: ["system_issues", "automated_alerts"],
    maxItems: 8,
  },
  {
    id: "watchlist",
    eyebrow: "Section 5",
    title: "What Zubin Should Pay Attention To",
    terms: [],
    maxItems: 7,
  },
];

const CUSTOMER_HINTS = [
  "airbnb",
  "allianz",
  "audax",
  "bcg",
  "cargurus",
  "citadel",
  "ericsson",
  "gm",
  "general motors",
  "lowes",
  "mckinsey",
  "nvidia",
  "nielsen",
  "netsuite",
  "seek",
  "silver lake",
  "t-mobile",
  "thoma bravo",
  "vista",
];

export function buildPersonalBriefing(digest: DigestData): PersonalBriefingData {
  const allItems = digest.groups.flatMap((group) =>
    group.items.map((item) => ({
      groupId: group.id,
      item,
      text: normalize(`${item.title} ${item.summary ?? ""} ${item.threadSummary ?? ""} ${item.preview ?? ""} ${item.fullText ?? ""} ${item.channel ?? ""}`),
    }))
  );

  const sections = SECTION_CONFIGS.map((config) => {
    const sourceItems =
      config.id === "watchlist"
        ? allItems
            .sort((a, b) => scoreItem(b.item) - scoreItem(a.item))
            .slice(0, config.maxItems ?? 7)
            .map((entry) => entry.item)
        : allItems
            .filter((entry) => matchesSection(entry.groupId, entry.text, config))
            .sort((a, b) => scoreItem(b.item) - scoreItem(a.item))
            .slice(0, config.maxItems ?? 10)
            .map((entry) => entry.item);

    return buildSection(config, dedupeItems(sourceItems));
  });

  return {
    generatedAt: digest.generatedAt,
    timeWindow: digest.timeWindow,
    totalSourceItems: allItems.length,
    sections,
    progressMessage: digest.progressMessage,
  };
}

function buildSection(config: SectionConfig, items: DigestItem[]): PersonalBriefingSection {
  if (items.length === 0) {
    return {
      id: config.id,
      eyebrow: config.eyebrow,
      title: config.title,
      summary: "No meaningful signal found in this time window.",
      bullets: ["Nothing surfaced strongly enough to include in this personalized brief."],
      sourceCount: 0,
      signals: [],
    };
  }

  if (config.id === "incidents") {
    return buildIncidentSection(config, items);
  }

  if (config.id === "watchlist") {
    return buildWatchlistSection(config, items);
  }

  const themes = inferThemes(items);
  const actors = topValues(items.map((item) => item.author).filter(Boolean) as string[], 3);
  const channels = topValues(items.map((item) => item.channel).filter(Boolean) as string[], 4);
  const bullets = items.slice(0, 5).map((item) => makeBriefBullet(item));

  return {
    id: config.id,
    eyebrow: config.eyebrow,
    title: config.title,
    summary: summarizeThemes(themes, items.length, channels),
    bullets: compactBullets(bullets),
    whyItMatters: themes.length
      ? `The strongest signals cluster around ${themes.slice(0, 3).join(", ")}.`
      : "This section is based on the highest-ranked Slack activity in the current window.",
    followUp: actors.length ? `If you have time, scan for follow-up from ${actors.join(", ")}.` : undefined,
    sourceCount: items.length,
    signals: makeSignals(items, channels),
  };
}

function buildIncidentSection(config: SectionConfig, items: DigestItem[]): PersonalBriefingSection {
  const incidentRows = items.slice(0, 6).map((item) => {
    const text = `${item.title} ${item.summary ?? ""} ${item.threadSummary ?? ""} ${item.fullText ?? ""}`;
    const severity = extractSeverity(text);
    const customers = extractCustomers(text);
    const status = extractStatus(text);
    const owner = item.author && item.author !== "unknown" ? item.author : "owner unclear";
    const customerText = customers.length ? customers.join(", ") : "customer not named";
    return `${severity}: ${customerText}; ${status}; owner/signal from ${owner}.`;
  });
  const customerNames = topValues(items.flatMap((item) => extractCustomers(`${item.title} ${item.fullText ?? ""}`)), 5);
  const severities = topValues(items.map((item) => extractSeverity(`${item.title} ${item.fullText ?? ""}`)), 3);

  return {
    id: config.id,
    eyebrow: config.eyebrow,
    title: config.title,
    summary: `${items.length} incident or escalation signal${items.length === 1 ? "" : "s"} surfaced. ${
      customerNames.length ? `Named customer impact includes ${customerNames.join(", ")}.` : "Most items do not clearly name a customer."
    }`,
    bullets: compactBullets(incidentRows),
    whyItMatters: severities.length
      ? `Severity markers include ${severities.join(", ")}; prioritize anything tied to a named customer or active regression.`
      : "Customer-impact and reliability signals can become leadership escalations quickly.",
    followUp: "Check whether each customer-impact item has a clear owner, severity, status, and next update.",
    sourceCount: items.length,
    signals: makeSignals(items, customerNames),
  };
}

function buildWatchlistSection(config: SectionConfig, items: DigestItem[]): PersonalBriefingSection {
  const topItems = items.slice(0, 5);
  const bullets = topItems.map((item) => {
    const topic = item.summary || item.threadSummary || item.title;
    const reason = item.reason || item.scoreExplanation || "ranked highly across the digest";
    return `${sentence(topic)} Why it matters: ${sentence(reason)}`;
  });
  const channels = topValues(items.map((item) => item.channel).filter(Boolean) as string[], 4);

  return {
    id: config.id,
    eyebrow: config.eyebrow,
    title: config.title,
    summary: `The highest-priority items are concentrated across ${channels.length ? channels.join(", ") : "a few active conversations"}.`,
    bullets: compactBullets(bullets),
    whyItMatters: "This cuts across the other sections and highlights where your attention may have the most leverage.",
    followUp: "Start with the first two bullets if you only have five minutes.",
    sourceCount: items.length,
    signals: makeSignals(items, channels),
  };
}

function matchesSection(groupId: string, text: string, config: SectionConfig) {
  const groupMatch = config.groupIds?.includes(groupId);
  const termMatch = config.terms.some((term) => text.includes(term.toLowerCase()));
  return Boolean(groupMatch || termMatch);
}

function scoreItem(item: DigestItem) {
  return (item.rankingScore ?? 0) + (item.graphContext?.score ?? 0) + (item.signals?.engagement ?? 0);
}

function makeBriefBullet(item: DigestItem) {
  const summary = sentence(item.summary || item.threadSummary || item.preview || item.title);
  const context = item.channel ? `Signal from #${item.channel}` : "Slack signal";
  const replies = item.signals?.replies ? `${item.signals.replies} repl${item.signals.replies === 1 ? "y" : "ies"}` : "";
  const extra = [context, replies].filter(Boolean).join("; ");
  return extra ? `${summary} (${extra}.)` : summary;
}

function summarizeThemes(themes: string[], count: number, channels: string[]) {
  const themeText = themes.length ? themes.slice(0, 3).join(", ") : "mixed operational updates";
  const channelText = channels.length ? ` across ${channels.slice(0, 3).join(", ")}` : "";
  return `${count} signal${count === 1 ? "" : "s"} point to ${themeText}${channelText}.`;
}

function inferThemes(items: DigestItem[]) {
  const text = normalize(items.map((item) => `${item.title} ${item.summary ?? ""} ${item.threadSummary ?? ""} ${item.topics?.join(" ") ?? ""}`).join(" "));
  const themes = [
    ["customer momentum", ["customer", "prospect", "deal", "pipeline", "revenue", "gtm"]],
    ["launch readiness", ["launch", "release", "rollout", "announcement"]],
    ["product feedback", ["feedback", "feature", "request", "product", "roadmap"]],
    ["engineering execution", ["engineering", "implementation", "infra", "deployment", "architecture"]],
    ["reliability risk", ["incident", "outage", "regression", "bug", "blocked"]],
    ["partner motion", ["partner", "partnership", "nvidia", "alliance"]],
    ["new ideas", ["idea", "prototype", "experiment", "brainstorm"]],
  ];

  return themes
    .map(([label, terms]) => ({
      label,
      score: (terms as string[]).reduce((sum, term) => sum + countOccurrences(text, term), 0),
    }))
    .filter((theme) => theme.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((theme) => theme.label as string);
}

function extractSeverity(text: string) {
  const normalized = normalize(text);
  const match = normalized.match(/\b(p[0-3]|sev[0-3]|high|critical|medium|low)\b/i);
  if (!match) return "Severity unclear";
  const value = match[1].toUpperCase();
  return value.startsWith("SEV") ? value.replace("SEV", "SEV ") : value;
}

function extractStatus(text: string) {
  const normalized = normalize(text);
  if (normalized.includes("closed") || normalized.includes("resolved")) return "reported resolved/closed";
  if (normalized.includes("mitigated")) return "mitigation reported";
  if (normalized.includes("blocked") || normalized.includes("blocker")) return "currently blocked";
  if (normalized.includes("investigating") || normalized.includes("debug")) return "under investigation";
  if (normalized.includes("escalated") || normalized.includes("escalation")) return "escalated";
  return "status unclear";
}

function extractCustomers(text: string) {
  const normalized = normalize(text);
  const matches = CUSTOMER_HINTS.filter((customer) => normalized.includes(customer));
  return topValues(matches.map(titleCase), 4);
}

function makeSignals(items: DigestItem[], extra: string[]) {
  const replies = items.reduce((sum, item) => sum + (item.signals?.replies ?? 0), 0);
  const reposts = items.reduce((sum, item) => sum + (item.signals?.forwards ?? 0), 0);
  return [
    `${items.length} source item${items.length === 1 ? "" : "s"}`,
    replies ? `${replies} repl${replies === 1 ? "y" : "ies"}` : "",
    reposts ? `${reposts} repost signal${reposts === 1 ? "" : "s"}` : "",
    ...extra.slice(0, 3),
  ].filter(Boolean);
}

function compactBullets(values: string[]) {
  const seen = new Set<string>();
  return values
    .map(sentence)
    .filter((value) => {
      const key = normalize(value).slice(0, 80);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);
}

function dedupeItems(items: DigestItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.id || item.url || `${item.channel}:${item.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function topValues(values: string[], limit: number) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const clean = value.trim();
    if (!clean || clean.toLowerCase() === "unknown") continue;
    counts.set(clean, (counts.get(clean) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value]) => value);
}

function sentence(value: string) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const truncated = clean.length > 230 ? `${clean.slice(0, 227)}...` : clean;
  return /[.!?]$/.test(truncated) ? truncated : `${truncated}.`;
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function countOccurrences(text: string, term: string) {
  return text.split(term).length - 1;
}
