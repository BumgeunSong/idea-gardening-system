import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { loadRecentHarvests, loadAllHarvests } from './harvest';
import type { ToolContext } from './types';

// --- Tool Result type ---
export interface ToolResult {
  success: boolean;
  data: string;
}

// --- Tool Schemas ---

const readHarvestsTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'read_harvests',
    description: '최근 수확물을 조회합니다. 씨앗(seed)과 태그만 반환합니다.',
    parameters: {
      type: 'object',
      properties: {
        count: {
          type: 'number',
          description: '조회할 수확물 개수 (기본 5, 최대 20)',
        },
      },
      required: [],
    },
  },
};

const searchHarvestsTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'search_harvests',
    description: '수확물을 키워드, 태그, 날짜로 검색합니다. 씨앗(seed)과 태그만 반환합니다.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '검색 키워드 (씨앗 텍스트에서 검색)',
        },
        tag: {
          type: 'string',
          description: '특정 태그로 필터링',
        },
        date_from: {
          type: 'string',
          description: '이 날짜 이후의 수확물만 (YYYY-MM-DD)',
        },
      },
      required: [],
    },
  },
};

const listTagsTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'list_tags',
    description: '전체 태그 목록과 각 태그의 사용 빈도를 반환합니다.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

// --- Exported tool arrays ---
export const CONVERSATION_TOOLS: ChatCompletionTool[] = [
  readHarvestsTool,
  searchHarvestsTool,
  listTagsTool,
];

export const QUESTION_TOOLS: ChatCompletionTool[] = [
  readHarvestsTool,
  searchHarvestsTool,
  listTagsTool,
];

// --- Tool Executors ---

function executeReadHarvests(args: { count?: number }): ToolResult {
  const count = Math.min(Math.max(args.count || 5, 1), 20);
  const harvests = loadRecentHarvests(count);

  const data = harvests.map(h => ({
    id: h.frontmatter.id,
    date: h.frontmatter.date,
    mode: h.frontmatter.mode,
    seed: h.frontmatter.seed,
    tags: h.frontmatter.tags,
  }));

  return { success: true, data: JSON.stringify(data) };
}

function executeSearchHarvests(args: { query?: string; tag?: string; date_from?: string }): ToolResult {
  let harvests = loadAllHarvests();

  if (args.date_from) {
    harvests = harvests.filter(h => h.frontmatter.date >= args.date_from!);
  }

  if (args.tag) {
    const tagLower = args.tag.toLowerCase();
    harvests = harvests.filter(h =>
      (h.frontmatter.tags || []).some(t => t.toLowerCase() === tagLower),
    );
  }

  if (args.query) {
    const queryLower = args.query.toLowerCase();
    harvests = harvests.filter(h =>
      (h.frontmatter.seed || '').toLowerCase().includes(queryLower),
    );
  }

  const data = harvests.slice(0, 10).map(h => ({
    id: h.frontmatter.id,
    date: h.frontmatter.date,
    mode: h.frontmatter.mode,
    seed: h.frontmatter.seed,
    tags: h.frontmatter.tags,
  }));

  return { success: true, data: JSON.stringify(data) };
}

function executeListTags(): ToolResult {
  const harvests = loadAllHarvests();
  const tagCounts: Record<string, number> = {};

  for (const h of harvests) {
    for (const tag of h.frontmatter.tags || []) {
      if (tag) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }
  }

  const sorted = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => ({ tag, count }));

  return { success: true, data: JSON.stringify(sorted) };
}

// --- Dispatcher ---

export function executeTool(name: string, args: Record<string, unknown>, _context: ToolContext): ToolResult {
  try {
    switch (name) {
      case 'read_harvests':
        return executeReadHarvests(args as { count?: number });
      case 'search_harvests':
        return executeSearchHarvests(args as { query?: string; tag?: string; date_from?: string });
      case 'list_tags':
        return executeListTags();
      default:
        return { success: false, data: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { success: false, data: `Tool error: ${(e as Error).message}` };
  }
}
