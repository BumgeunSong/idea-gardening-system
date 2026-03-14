import 'dotenv/config';
import { App } from '@slack/bolt';
import cron from 'node-cron';
import { generateQuestions, followUp, extractSeedAndTags } from './llm';
import { createSession, getSession, addMessage, closeSession, getAllActiveSessions, restoreSessions } from './session';
import { saveHarvest } from './harvest';
import { pullHarvestsFromGitHub } from './github';
import { extractUrls, fetchUrlContent } from './web';
import type { Mode, ParentInfo } from './types';

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

const CHANNEL_ID = process.env.SLACK_CHANNEL_ID!;


// --- Event deduplication ---
const processedEvents = new Set<string>();

// Clear old entries every hour
setInterval(() => processedEvents.clear(), 60 * 60 * 1000);

// --- Detect mode from parent message emoji ---
async function getModeFromParentMessage(channelId: string, threadTs: string): Promise<ParentInfo | null> {
  try {
    const result = await app.client.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: 1,
    });

    const parentMessage = result.messages?.[0];
    if (!parentMessage) return null;

    const text = parentMessage.text || '';
    if (text.includes('🌱') || text.includes(':seedling:')) return { mode: 'harvest', question: text };
    if (text.includes('💎') || text.includes(':gem:')) return { mode: 'crig', question: text };
    if (text.includes('🔀') || text.includes(':twisted_rightwards_arrows:')) return { mode: 'bisociate', question: text };
    return null;
  } catch (e) {
    console.error('Failed to fetch parent message:', (e as Error).message);
    return null;
  }
}

// --- Event: Thread reply ---
app.event('message', async ({ event, client }) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const msg = event as any;

  if (msg.channel !== CHANNEL_ID) return;
  if (!msg.thread_ts) return;
  if (msg.bot_id) return;
  if (msg.subtype) return;

  // Deduplicate events
  const eventKey = `${msg.channel}-${msg.ts}`;
  if (processedEvents.has(eventKey)) return;
  processedEvents.add(eventKey);

  const threadTs: string = msg.thread_ts;
  const userText: string = msg.text || '';

  // Skip empty messages (images, files, etc.)
  if (!userText.trim()) return;

  // Check for "done"
  if (userText.toLowerCase().trim() === 'done') {
    const session = getSession(threadTs);
    if (!session) return;

    try {
      const { seed, tags } = await extractSeedAndTags(session.history);
      const harvestId = saveHarvest(session, seed, tags);
      closeSession(threadTs);

      await client.chat.postMessage({
        channel: CHANNEL_ID,
        thread_ts: threadTs,
        text: `✅ 수확 완료! (${harvestId})\n🌱 씨앗: ${seed}\n🏷️ ${tags.join(', ')}`,
      });
    } catch (e) {
      console.error('Failed to save harvest:', (e as Error).message);
      await client.chat.postMessage({
        channel: CHANNEL_ID,
        thread_ts: threadTs,
        text: '❌ 저장 중 오류가 발생했어. 다시 시도해줘.',
      });
    }
    return;
  }

  // Get or create session
  let session = getSession(threadTs);

  if (!session) {
    const parentInfo = await getModeFromParentMessage(CHANNEL_ID, threadTs);
    if (!parentInfo) {
      await client.chat.postMessage({
        channel: CHANNEL_ID,
        thread_ts: threadTs,
        text: '이 스레드의 질문을 인식하지 못했어. 봇이 올린 질문에 답해줘!',
      });
      return;
    }

    session = createSession(threadTs, CHANNEL_ID, parentInfo.mode, parentInfo.question);
  }

  // Detect URLs and fetch content
  let messageToAdd = userText;
  const urls = extractUrls(userText);
  if (urls.length > 0) {
    const content = await fetchUrlContent(urls[0]);
    if (content) {
      messageToAdd = `${userText}\n\n[링크 내용 요약:\n${content}]`;
    }
  }

  // Add user message
  addMessage(threadTs, 'user', messageToAdd);

  // Compute turn count (LLM fetches harvests via tools when needed)
  const turnCount = session.history.filter(m => m.role === 'user').length;

  // Generate follow-up
  try {
    const response = await followUp(session.history, session.mode, turnCount);
    addMessage(threadTs, 'assistant', response);

    await client.chat.postMessage({
      channel: CHANNEL_ID,
      thread_ts: threadTs,
      text: response,
    });
  } catch (e) {
    console.error('Failed to generate follow-up:', (e as Error).message);
    await client.chat.postMessage({
      channel: CHANNEL_ID,
      thread_ts: threadTs,
      text: '⚠️ 응답 생성에 실패했어. 다시 한번 말해줄래?',
    });
  }
});

// --- Post daily questions ---
async function postDailyQuestions(): Promise<void> {
  console.log('Generating daily questions...');

  try {
    // LLM fetches its own context via tools (read_harvests, list_tags)
    const questions = await generateQuestions();

    for (const q of questions) {
      const label = q.mode.charAt(0).toUpperCase() + q.mode.slice(1);
      await app.client.chat.postMessage({
        channel: CHANNEL_ID,
        text: `${q.emoji} [${label}] ${q.question}`,
      });
    }

    console.log(`Posted ${questions.length} questions to channel`);
  } catch (e) {
    console.error('Failed to post daily questions:', (e as Error).message);
    try {
      await app.client.chat.postMessage({
        channel: CHANNEL_ID,
        text: '❌ 오늘 질문 생성에 실패했어요.',
      });
    } catch {
      // Last resort: can't even post error message
    }
  }
}

// --- Midnight: Auto-save incomplete sessions ---
async function autoSaveAllSessions(): Promise<void> {
  const activeSessions = getAllActiveSessions();
  if (activeSessions.length === 0) return;

  console.log(`Auto-saving ${activeSessions.length} incomplete sessions...`);

  for (const session of activeSessions) {
    try {
      const hasUserMessage = session.history.some(m => m.role === 'user');
      if (!hasUserMessage) {
        closeSession(session.threadTs);
        continue;
      }

      const { seed, tags } = await extractSeedAndTags(session.history);
      const harvestId = saveHarvest(session, seed, tags);
      closeSession(session.threadTs);
      console.log(`Auto-saved session ${session.threadTs} as ${harvestId}`);
    } catch (e) {
      console.error(`Failed to auto-save session ${session.threadTs}:`, (e as Error).message);
    }
  }
}

// --- Slash command: /generate ---
app.command('/generate', async ({ ack, command, client }) => {
  await ack();
  try {
    await postDailyQuestions();
  } catch (e) {
    await client.chat.postEphemeral({
      channel: command.channel_id,
      user: command.user_id,
      text: `❌ 질문 생성 실패: ${(e as Error).message}`,
    });
  }
});

// --- Slash command: /healthcheck ---
app.command('/healthcheck', async ({ ack, command, client }) => {
  await ack();

  const checks: string[] = [];
  const startTime = Date.now();

  // 1. Slack API check
  try {
    const authResult = await client.auth.test();
    checks.push(`✅ Slack: connected as @${authResult.user}`);
  } catch (e) {
    checks.push(`❌ Slack: ${(e as Error).message}`);
  }

  // 2. LLM API check
  try {
    const { followUp } = await import('./llm');
    const testHistory = [{ role: 'user' as const, content: 'test' }];
    await followUp(testHistory, 'harvest');
    checks.push('✅ LLM (DeepSeek): responding');
  } catch (e) {
    checks.push(`❌ LLM (DeepSeek): ${(e as Error).message}`);
  }

  // 3. File system check
  const fs = await import('fs');
  const harvestDir = process.env.HARVEST_DIR || './harvests';
  const harvestCount = fs.existsSync(harvestDir) ? fs.readdirSync(harvestDir).filter(f => f.endsWith('.md')).length : 0;
  const activeSessionCount = getAllActiveSessions().length;
  checks.push(`✅ Storage: ${harvestCount} harvests, ${activeSessionCount} active sessions`);

  // 4. Cron check
  checks.push(`✅ Cron: ${cronSchedule} (${cronTimezone})`);

  const elapsed = Date.now() - startTime;

  await client.chat.postMessage({
    channel: command.channel_id,
    text: `🏥 *Health Check Report* (${elapsed}ms)\n\n${checks.join('\n')}`,
  });
});

// --- Slash commands: /harvest, /crig, /bisociate ---
const MODE_CONFIG: Record<Mode, { opener: (topic: string) => string }> = {
  harvest: {
    opener: (topic) => `🌱 ${topic} — 이 주제에 대해 어떤 생각이 있어?`,
  },
  crig: {
    opener: (topic) => `💎 ${topic} — 어느 정도 이해하고 있어?`,
  },
  bisociate: {
    opener: (topic) => `🔀 ${topic} — 이 둘의 공통점이 뭘까?`,
  },
};

for (const mode of ['harvest', 'crig', 'bisociate'] as Mode[]) {
  app.command(`/${mode}`, async ({ ack, command, client }) => {
    await ack();

    const topic = command.text.trim();
    if (!topic) {
      await client.chat.postEphemeral({
        channel: command.channel_id,
        user: command.user_id,
        text: `주제를 입력해줘! 예: \`/${mode} ${mode === 'bisociate' ? '코딩 vs 글쓰기' : '흥미로운 주제'}\``,
      });
      return;
    }

    const openerText = MODE_CONFIG[mode].opener(topic);

    // Post opener as a new channel message (becomes thread root)
    const result = await client.chat.postMessage({
      channel: CHANNEL_ID,
      text: openerText,
    });

    if (!result.ts) {
      console.error('Slack postMessage did not return a timestamp');
      return;
    }
    createSession(result.ts, CHANNEL_ID, mode, openerText);
  });
}

// --- Bot mention: on-demand harvest thread (fallback) ---
app.event('app_mention', async ({ event, client }) => {
  // Extract topic by removing the bot mention
  const topic = event.text.replace(/<@[A-Za-z0-9]+>/g, '').trim();
  if (!topic) return;

  const openerText = `🌱 ${topic} — 이 주제에 대해 어떤 생각이 있어?`;

  const result = await client.chat.postMessage({
    channel: CHANNEL_ID,
    text: openerText,
  });

  if (!result.ts) {
    console.error('Slack postMessage did not return a timestamp');
    return;
  }
  createSession(result.ts, CHANNEL_ID, 'harvest', openerText);
});

// --- Cron schedules ---
const cronSchedule = process.env.CRON_SCHEDULE || '0 9 * * *';
const cronTimezone = process.env.CRON_TIMEZONE || 'Asia/Seoul';

cron.schedule(cronSchedule, postDailyQuestions, { timezone: cronTimezone });
cron.schedule('55 23 * * *', autoSaveAllSessions, { timezone: cronTimezone });

// --- SIGTERM handler: auto-save before Railway stops container ---
process.on('SIGTERM', async () => {
  console.log('SIGTERM received — auto-saving sessions before shutdown...');
  await autoSaveAllSessions();
  process.exit(0);
});

// --- Startup ---
(async () => {
  restoreSessions();

  // Pull past harvests from GitHub for context
  try {
    await pullHarvestsFromGitHub();
  } catch (e) {
    console.error('Failed to pull harvests from GitHub:', (e as Error).message);
  }

  await app.start();
  console.log('⚡ Idea Gardening bot is running');
})();
