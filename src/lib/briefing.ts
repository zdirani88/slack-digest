import { BriefingData, BriefingStory, DigestData, DigestGroup, DigestItem } from "@/types";

const SECTION_TITLES: Record<string, string> = {
  product_updates: "Product",
  engineering_updates: "Engineering",
  sales_updates: "Customer & Sales",
  partnership_updates: "Partnerships",
  system_issues: "Incidents & Risks",
  automated_alerts: "Operations Wire",
  ideas_and_innovations: "Ideas & Signals",
  leadership_attention: "Leadership Watch",
};

export function buildBriefing(digest: DigestData): BriefingData {
  const stories = digest.groups
    .flatMap((group) => group.items.map((item) => storyFromItem(group, item)))
    .sort((a, b) => b.score - a.score);

  const leadStory = stories[0];
  const secondaryStories = stories.slice(1, 5);
  const usedIds = new Set([leadStory?.id, ...secondaryStories.map((story) => story.id)].filter(Boolean));
  const sections = digest.groups
    .map((group) => {
      const sectionStories = stories
        .filter((story) => story.section === sectionTitle(group) && !usedIds.has(story.id))
        .slice(0, 3);

      return {
        id: group.id,
        title: sectionTitle(group),
        stories: sectionStories,
      };
    })
    .filter((section) => section.stories.length > 0);

  return {
    generatedAt: digest.generatedAt,
    timeWindow: digest.timeWindow,
    leadStory,
    secondaryStories,
    sections,
    totalStories: stories.length,
    progressMessage: digest.progressMessage,
  };
}

function storyFromItem(group: DigestGroup, item: DigestItem): BriefingStory {
  const text = item.threadSummary || item.summary || item.preview || item.rawExcerpt || item.title;
  const body = buildBody(item, text);
  const channel = item.channel ? [{ name: item.channel, url: item.channelUrl }] : [];
  const score = (item.rankingScore ?? 0) + (item.graphContext?.score ?? 0);

  return {
    id: item.id,
    section: sectionTitle(group),
    headline: cleanHeadline(item.summary || item.title),
    dek: item.threadSummary || item.preview || item.reason || "A notable Slack thread surfaced in the digest.",
    body,
    whyItMatters: item.reason || item.scoreExplanation || "This thread ranked highly in the digest.",
    nextStep: item.suggestedActions?.[0]?.label,
    people: item.author ? [item.author] : [],
    channels: channel,
    slackUrls: item.url ? [item.url] : [],
    score,
    sourceItemIds: [item.id],
    timestamp: item.latestActivityTimestamp || item.timestamp || item.originalTimestamp,
  };
}

function buildBody(item: DigestItem, text: string) {
  const paragraphs = [
    text,
    item.graphContext?.notes.length
      ? `Glean context connected this to ${item.graphContext.notes.join(", ").toLowerCase()}.`
      : "",
    item.suggestedActions?.[0]
      ? `Suggested next step: ${item.suggestedActions[0].label}. ${item.suggestedActions[0].rationale}`
      : "",
  ].filter(Boolean);

  return paragraphs.slice(0, 3);
}

function sectionTitle(group: DigestGroup) {
  return SECTION_TITLES[group.id] ?? group.title;
}

function cleanHeadline(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return "Untitled Slack update";
  return text.length > 110 ? `${text.slice(0, 107)}...` : text;
}
