export type TimeWindow = "24h" | "3d" | "7d";

export interface GleanSnippet {
  text: string;
  ranges?: Array<{ startIndex: number; endIndex: number; type: string }>;
}

export interface GleanAuthor {
  name?: string;
  email?: string;
  obfuscatedId?: string;
}

export interface GleanDocumentMetadata {
  datasource?: string;
  datasourceInstance?: string;
  container?: string;
  containerId?: string;
  containerUrl?: string;
  updateTime?: string;
  createTime?: string;
  author?: GleanAuthor;
  mimeType?: string;
  objectType?: string;
}

export interface GleanSearchResult {
  title?: string;
  url?: string;
  nativeAppUrl?: string;
  fullTextList?: string[];
  snippets?: GleanSnippet[];
  relatedResults?: Array<{
    relation?: string;
    results?: Array<{
      snippets?: GleanSnippet[];
    }>;
  }>;
  document?: {
    id?: string;
    datasource?: string;
    metadata?: GleanDocumentMetadata;
  };
  clusteredResults?: GleanSearchResult[];
}

export interface GleanSearchResponse {
  results?: GleanSearchResult[];
  totalCount?: number;
  hasMoreResults?: boolean;
  cursor?: string;
  errorInfo?: { errorMessages?: string[] };
}

export interface DigestItem {
  id: string;
  title: string;
  channel?: string;
  channelUrl?: string;
  channelId?: string;
  summary?: string;
  preview: string;
  rawExcerpt?: string;
  threadSummary?: string;
  fullText?: string;
  url?: string;
  reason?: string;
  timestamp?: string;
  originalTimestamp?: string;
  latestActivityTimestamp?: string;
  author?: string;
  authorUrl?: string;
  rankingScore?: number;
  scoreExplanation?: string;
  signals?: DigestSignals;
  suggestedActions?: DigestAction[];
  topics?: string[];
  isSuppressed?: boolean;
  suppressionReason?: string;
  graphContext?: DigestGraphContext;
}

export interface DigestSignals {
  replies: number;
  reactions: number;
  forwards: number;
  engagement: number;
  affinity: number;
  freshness: number;
  visibility: number;
  noisePenalty: number;
  graph: number;
}

export interface DigestGraphContext {
  score: number;
  recommendationCount: number;
  feedMatchCount: number;
  peopleBoost: number;
  relatedTitles: string[];
  notes: string[];
}

export interface DigestAction {
  id: string;
  label: string;
  prompt: string;
  rationale: string;
}

export interface DigestGroup {
  id: string;
  title: string;
  emoji: string;
  summary: string;
  items: DigestItem[];
  priority: number;
}

export interface DigestData {
  groups: DigestGroup[];
  generatedAt: string;
  timeWindow: TimeWindow;
  totalItems: number;
  status?: "partial" | "complete";
  progressMessage?: string;
  debug?: {
    slackResults?: number;
    phase?: string;
  };
}

export interface BriefingStory {
  id: string;
  section: string;
  headline: string;
  dek: string;
  body: string[];
  whyItMatters: string;
  nextStep?: string;
  people: string[];
  channels: Array<{ name: string; url?: string }>;
  slackUrls: string[];
  score: number;
  sourceItemIds: string[];
  timestamp?: string;
}

export interface BriefingData {
  generatedAt: string;
  timeWindow: TimeWindow;
  leadStory?: BriefingStory;
  secondaryStories: BriefingStory[];
  sections: Array<{ id: string; title: string; stories: BriefingStory[] }>;
  totalStories: number;
  progressMessage?: string;
}

export interface GleanConfig {
  token: string;
  backendUrl: string;
}

export interface DigestPreferences {
  interests?: string[];
  likedTopics?: string[];
  dislikedTopics?: string[];
  likedChannels?: string[];
  dislikedChannels?: string[];
  likedAuthors?: string[];
  dislikedAuthors?: string[];
}
