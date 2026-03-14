import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import type { Message, Mode, Question, SeedAndTags, QuestionContext } from './types';

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

export async function generateQuestions(context: QuestionContext = {}): Promise<Question[]> {
  const systemPrompt = loadPrompt('system-base') + '\n\n' + loadPrompt('generate-questions');

  let userContent = '오늘의 9개 질문을 생성해줘.';

  if (context.recentSeeds && context.recentSeeds.length > 0) {
    userContent += `\n\n최근 수확물의 씨앗:\n${context.recentSeeds.map(s => `- ${s}`).join('\n')}`;
  }

  if (context.recentTags && context.recentTags.length > 0) {
    userContent += `\n\n최근 수확물의 태그:\n${context.recentTags.map(t => `- ${t}`).join('\n')}`;
  }

  if (context.yesterdaySummary) {
    userContent += `\n\n어제 대화 요약:\n${context.yesterdaySummary}`;
  }

  const response = await getClient().chat.completions.create({
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: 0.9,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error('Empty response from LLM');

  const result = JSON.parse(content) as { questions: Question[] };
  return result.questions;
}

export async function followUp(
  history: Message[],
  mode: Mode,
  turnCount?: number,
  recentSeeds?: string[],
): Promise<string> {
  const systemPrompt = loadPrompt('system-base') + '\n\n' + loadPrompt(`mode-${mode}`);

  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: systemPrompt },
  ];

  if (turnCount !== undefined) {
    messages.push({ role: 'system', content: `현재 ${turnCount}번째 대화.` });
  }

  if (recentSeeds && recentSeeds.length > 0) {
    messages.push({
      role: 'system',
      content: `최근 수확물의 씨앗 (연결 질문에 활용):\n${recentSeeds.map(s => `- ${s}`).join('\n')}`,
    });
  }

  messages.push(...history);

  const response = await getClient().chat.completions.create({
    model: 'deepseek-chat',
    messages,
    temperature: 0.8,
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error('Empty response from LLM');

  return content;
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
