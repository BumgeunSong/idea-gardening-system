import 'dotenv/config';
import { App } from '@slack/bolt';
import cron from 'node-cron';
import { generateQuestions, followUp, extractSeedAndTags } from './llm';
import { createSession, getSession, addMessage, closeSession, getAllActiveSessions, restoreSessions } from './session';
import { saveHarvest, loadRecentHarvests } from './harvest';
import type { ParentInfo } from './types';

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

const CHANNEL_ID = process.env.SLACK_CHANNEL_ID!;
const HEALTH_CHANNEL_ID = process.env.SLACK_HEALTH_CHANNEL_ID || CHANNEL_ID;

// --- Detect mode from parent message emoji ---
async function getModeFromParentMessage(channelId: string, threadTs: string): Promise<ParentInfo | null> {
  try {
    const result = await app.client.conversations.history({
      channel: channelId,
      latest: threadTs,
      limit: 1,
      inclusive: true,
    });

    const parentMessage = result.messages?.[0];
    if (!parentMessage) return null;

    const text = parentMessage.text || '';
    if (text.includes('🌱')) return { mode: 'harvest', question: text };
    if (text.includes('💎')) return { mode: 'crig', question: text };
    if (text.includes('🔀')) return { mode: 'bisociate', question: text };
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

  const threadTs: string = msg.thread_ts;
  const userText: string = msg.text || '';

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
    if (!parentInfo) return;

    session = createSession(threadTs, CHANNEL_ID, parentInfo.mode, parentInfo.question);
  }

  // Add user message
  addMessage(threadTs, 'user', userText);

  // Generate follow-up
  try {
    const response = await followUp(session.history, session.mode);
    addMessage(threadTs, 'assistant', response);

    await client.chat.postMessage({
      channel: CHANNEL_ID,
      thread_ts: threadTs,
      text: response,
    });
  } catch (e) {
    console.error('Failed to generate follow-up:', (e as Error).message);
  }
});

// --- Post daily questions ---
async function postDailyQuestions(): Promise<void> {
  console.log('Generating daily questions...');

  try {
    const recentHarvests = loadRecentHarvests(5);
    const recentSeeds = recentHarvests
      .map(h => h.frontmatter.seed)
      .filter(Boolean);

    const questions = await generateQuestions({ recentSeeds });

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

// --- Manual trigger: "generate" in channel ---
app.message(/^generate$/i, async ({ message, client }) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const msg = message as any;
  if (msg.channel !== CHANNEL_ID) return;
  if (msg.bot_id) return;

  await client.chat.postMessage({
    channel: CHANNEL_ID,
    text: '🔄 질문 생성 중...',
  });

  await postDailyQuestions();
});

// --- Health check: "health" in any channel ---
app.message(/^health$/i, async ({ message, client }) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const msg = message as any;
  if (msg.bot_id) return;

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
    channel: HEALTH_CHANNEL_ID,
    text: `🏥 *Health Check Report* (${elapsed}ms)\n\n${checks.join('\n')}`,
  });
});

// --- Cron schedules ---
const cronSchedule = process.env.CRON_SCHEDULE || '0 9 * * *';
const cronTimezone = process.env.CRON_TIMEZONE || 'Asia/Seoul';

cron.schedule(cronSchedule, postDailyQuestions, { timezone: cronTimezone });
cron.schedule('55 23 * * *', autoSaveAllSessions, { timezone: cronTimezone });

// --- Startup ---
(async () => {
  restoreSessions();
  await app.start();
  console.log('⚡ Idea Gardening bot is running');
})();
