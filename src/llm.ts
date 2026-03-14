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
    });
  }
  return client;
}

function loadPrompt(name: string): string {
  return fs.readFileSync(
    path.join(process.cwd(), 'prompts', `${name}.md`),
    'utf-8',
  );
}

export async function generateQuestions(context: QuestionContext = {}): Promise<Question[]> {
  const systemPrompt = loadPrompt('system-base') + '\n\n' + loadPrompt('generate-questions');

  let userContent = '오늘의 9개 질문을 생성해줘.';

  if (context.recentSeeds && context.recentSeeds.length > 0) {
    userContent += `\n\n최근 수확물의 씨앗:\n${context.recentSeeds.map(s => `- ${s}`).join('\n')}`;
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

export async function followUp(history: Message[], mode: Mode): Promise<string> {
  const systemPrompt = loadPrompt('system-base') + '\n\n' + loadPrompt(`mode-${mode}`);

  const response = await getClient().chat.completions.create({
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: systemPrompt },
      ...history,
    ],
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

  const prompt = `아래 대화에서:
1. 핵심 인사이트를 한 문장으로 추출해 (seed)
2. 관련 태그를 3-5개 생성해

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
