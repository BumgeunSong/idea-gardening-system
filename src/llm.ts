import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import fs from 'fs';
import path from 'path';
import type { Message, Mode, Question, SeedAndTags, ToolContext } from './types';
import { executeTool, CONVERSATION_TOOLS, QUESTION_TOOLS } from './tools';

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      baseURL: 'https://api.deepseek.com',
      apiKey: process.env.DEEPSEEK_API_KEY,
      timeout: 30_000,
      maxRetries: 2,
    });
  }
  return client;
}

function loadPrompt(name: string): string {
  return fs.readFileSync(
    path.join(__dirname, '..', 'prompts', `${name}.md`),
    'utf-8',
  );
}

// --- Core tool-calling loop ---

const MAX_TOOL_ITERATIONS = 3;

interface ChatWithToolsOptions {
  messages: ChatCompletionMessageParam[];
  tools?: ChatCompletionTool[];
  temperature?: number;
  responseFormat?: { type: 'json_object' };
  toolContext?: ToolContext;
}

function safeParseArgs(argsStr: string | undefined): Record<string, unknown> | null {
  try {
    return JSON.parse(argsStr || '{}');
  } catch {
    return null;
  }
}

function normalizeCallKey(name: string, argsStr: string | undefined): string {
  try {
    const parsed = JSON.parse(argsStr || '{}');
    return `${name}:${JSON.stringify(parsed)}`;
  } catch {
    return `${name}:${argsStr || '{}'}`;
  }
}

function getResponseContent(response: OpenAI.Chat.ChatCompletion): OpenAI.Chat.ChatCompletionMessage {
  if (!response.choices || response.choices.length === 0) {
    throw new Error('No choices returned from LLM');
  }
  return response.choices[0].message;
}

export async function chatWithTools(options: ChatWithToolsOptions): Promise<string> {
  const { tools, temperature = 0.8, responseFormat, toolContext = {} } = options;
  const messages = [...options.messages];

  // Track previous tool calls for duplicate detection
  const previousCalls = new Set<string>();

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const hasTools = tools && tools.length > 0;
    const isLastIteration = i === MAX_TOOL_ITERATIONS - 1;

    const requestParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: 'deepseek-chat',
      messages,
      temperature,
    };

    // Strip tools on last iteration to force text output
    if (hasTools && !isLastIteration) {
      requestParams.tools = tools;
    }

    // Only apply response_format when tools are not active (avoids DeepSeek confusion)
    if (responseFormat && !(hasTools && !isLastIteration)) {
      requestParams.response_format = responseFormat;
    }

    const response = await getClient().chat.completions.create(requestParams);
    const assistantMessage = getResponseContent(response);

    // No tool calls → return text content
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      const content = assistantMessage.content;
      if (!content) throw new Error('Empty response from LLM');
      return content;
    }

    // Check for duplicate calls (normalized to handle whitespace differences)
    let hasDuplicate = false;
    for (const toolCall of assistantMessage.tool_calls) {
      const callKey = normalizeCallKey(toolCall.function.name, toolCall.function.arguments);
      if (previousCalls.has(callKey)) {
        hasDuplicate = true;
        break;
      }
      previousCalls.add(callKey);
    }

    // Execute tools and append results
    messages.push({ role: 'assistant', content: assistantMessage.content || '', tool_calls: assistantMessage.tool_calls });

    for (const toolCall of assistantMessage.tool_calls) {
      const args = safeParseArgs(toolCall.function.arguments);
      if (!args) {
        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: 'Error: invalid JSON arguments' });
        continue;
      }
      const result = executeTool(toolCall.function.name, args, toolContext);
      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: result.data });
    }

    if (hasDuplicate) {
      break; // Fall through to final call below
    }
  }

  // Final call without tools — forces text output
  const finalResponse = await getClient().chat.completions.create({
    model: 'deepseek-chat',
    messages,
    temperature,
    ...(responseFormat ? { response_format: responseFormat } : {}),
  });
  const finalMessage = getResponseContent(finalResponse);
  if (!finalMessage.content) throw new Error('Empty response from LLM');
  return finalMessage.content;
}

// --- Public API ---

export async function generateQuestions(): Promise<Question[]> {
  const systemPrompt = loadPrompt('system-base')
    + '\n\n' + loadPrompt('generate-questions')
    + '\n\n' + loadPrompt('tool-guidelines-questions');

  const content = await chatWithTools({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: '오늘의 9개 질문을 생성해줘. 먼저 최근 수확물과 태그를 확인한 후 질문을 만들어.' },
    ],
    tools: QUESTION_TOOLS,
    temperature: 0.9,
    responseFormat: { type: 'json_object' },
  });

  const result = JSON.parse(content) as { questions: Question[] };
  return result.questions;
}

export async function followUp(
  history: Message[],
  mode: Mode,
  turnCount?: number,
): Promise<string> {
  const systemPrompt = loadPrompt('system-base')
    + '\n\n' + loadPrompt(`mode-${mode}`)
    + '\n\n' + loadPrompt('tool-guidelines');

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
  ];

  if (turnCount !== undefined) {
    messages.push({ role: 'system', content: `현재 ${turnCount}번째 대화.` });
  }

  messages.push(...history);

  return chatWithTools({
    messages,
    tools: CONVERSATION_TOOLS,
    temperature: 0.8,
    toolContext: { mode },
  });
}

export async function extractSeedAndTags(history: Message[]): Promise<SeedAndTags> {
  const conversation = history
    .map(m => `${m.role === 'user' ? 'A' : 'Q'}: ${m.content}`)
    .join('\n');

  const prompt = `아래 대화에서 핵심 인사이트를 추출해줘.

## 추출 기준

### seed (씨앗 문장)
- 대화에서 가장 핵심적인 인사이트를 **하나의 완결된 문장**으로 작성
- "~이다", "~한다" 형태의 선언문으로 작성 (질문형 X)
- 구체적이고 독자적인 관점이 드러나야 함
- 나쁜 예: "글쓰기가 중요하다" (너무 일반적)
- 좋은 예: "글쓰기의 진짜 병목은 타이핑이 아니라 생각을 구조화하는 과정이다"

### tags (태그)
- 3~5개, 영어 소문자, 하이픈으로 연결
- 카테고리: 도메인(writing, programming), 개념(mental-model, feedback-loop), 맥락(personal-experience, book-insight)
- 너무 넓은 태그 지양 (예: "life", "thought")

반드시 아래 JSON 형식으로만 응답:
{"seed": "...", "tags": ["...", "..."]}

대화:
${conversation}`;

  const response = await getClient().chat.completions.create({
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error('Empty response from LLM');

  return JSON.parse(content) as SeedAndTags;
}
