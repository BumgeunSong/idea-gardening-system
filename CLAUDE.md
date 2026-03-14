# Idea Gardening System

## Stack
- Runtime: Node.js + TypeScript (ES2022, commonjs)
- Slack SDK: `@slack/bolt` (Socket Mode)
- LLM: DeepSeek V3 via `openai` npm package (OpenAI-compatible API)
- Scheduler: `node-cron`
- Storage: Local filesystem (Markdown + YAML frontmatter), synced to GitHub
- Infra: Railway (auto-deploys from `main` branch)

## Commands
```bash
npm run build    # tsc → dist/
npm run dev      # tsx --watch src/bot.ts
npm start        # node dist/bot.js
```

## Deploy
Push to `main` → Railway auto-deploys. Procfile: `worker: npm run build && npm start`

## Env Vars (Railway)
- `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_CHANNEL_ID`
- `DEEPSEEK_API_KEY`
- `GITHUB_TOKEN` (repo scope), `GITHUB_REPO` (e.g. `BumgeunSong/idea-gardening-system`)
- `CRON_SCHEDULE` (default: `0 9 * * *`), `CRON_TIMEZONE` (default: `Asia/Seoul`)

## Architecture
- `src/bot.ts` — Slack event handlers, cron scheduling, startup
- `src/llm.ts` — DeepSeek client, prompt composition, all LLM calls
- `src/harvest.ts` — Harvest persistence (local fs + GitHub push)
- `src/session.ts` — In-memory sessions with disk backup
- `src/github.ts` — GitHub Contents API (push/pull harvests)
- `src/web.ts` — URL content fetching via Jina Reader
- `src/types.ts` — TypeScript interfaces
- `prompts/` — System prompts and mode-specific interview guides

## Key Patterns
- Session key = Slack `thread_ts`
- Mode detected from parent message emoji: 🌱=harvest, 💎=crig, 🔀=bisociate
- Harvests saved as Markdown with YAML frontmatter in `harvests/`
- Railway filesystem is ephemeral → harvests pushed to GitHub on save, pulled on startup
- All prompts in Korean
