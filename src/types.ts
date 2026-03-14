export type Mode = 'harvest' | 'crig' | 'bisociate';

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface Session {
  threadTs: string;
  channelId: string;
  mode: Mode;
  phase: string;
  history: Message[];
  startedAt: number;
}

export interface Question {
  mode: string;
  emoji: string;
  question: string;
}

export interface HarvestFrontmatter {
  id: string;
  date: string;
  mode: string;
  seed: string;
  tags: string[];
  connections: string[];
  [key: string]: string | string[];
}

export interface Harvest {
  frontmatter: HarvestFrontmatter;
  body: string;
}

export interface SeedAndTags {
  seed: string;
  tags: string[];
}

export interface QuestionContext {
  recentSeeds?: string[];
  yesterdaySummary?: string;
}

export interface ParentInfo {
  mode: Mode;
  question: string;
}
