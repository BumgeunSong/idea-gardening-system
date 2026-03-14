# Idea Gardening System

A Slack bot that cultivates your thinking through daily Socratic interviews, turning fleeting ideas into structured writing material.

## Vision

AI's real leverage for writing isn't "writing well" — it's **continuously harvesting raw material from everyday life**. The best ideas come not at a desk, but during conversations, while reading, in passing moments. This system captures those moments before they vanish.

## Problem

Writing consistently on LinkedIn (3+ posts/week) is hard. The bottleneck isn't the writing itself — it's **creating the raw material**: generating ideas, connecting them to experience, combining them with insights, and structuring them into something worth saying.

These materials don't appear on command. Inspiration strikes in random moments, and without a system to capture and deepen those thoughts, they disappear.

## Strategy

### 1. Daily Socratic Menu

Every morning at 9AM, the bot posts 9 questions to a Slack channel — a menu of thinking prompts you can browse on your phone. Pick the ones that spark something. Ignore the rest. Zero pressure.

Questions are generated with context from your past harvests — recent seeds and tags feed into question generation, so each day's questions build on what you've been thinking about.

### 2. Three Interview Modes

Each mode uses a different Socratic strategy to deepen your thinking:

| Mode | Purpose | Style |
|------|---------|-------|
| **Harvest** | Extract everyday observations into writing material | Dig into why/how, connect to past ideas, crystallize insight |
| **Crig** | Build the skeleton of a concept and crystallize it | Detect friction in understanding, resolve one by one, compress to a seed sentence |
| **Bisociate** | Discover unexpected connections between two unrelated ideas | Extract core mechanics of each, find hidden intersections, name the shared pattern |

The bot tracks turn count and adjusts its questioning strategy — earlier turns dig deeper, later turns connect and crystallize.

### 3. Context That Compounds

Past harvests feed future conversations:
- **Question generation**: Recent seeds and tags shape the next day's questions
- **Follow-up conversations**: Past harvest seeds are injected as context, enabling the bot to connect current thinking to previous insights
- **URL reading**: Paste a link in a thread and the bot reads the article content, using it as context for the Socratic interview

### 4. Effortless Capture

Reply in a Slack thread. The bot follows up. Say "done" when you're finished. Your conversation is automatically saved as a structured harvest with an extracted seed insight and tags — then pushed to GitHub for permanent storage.

## Architecture

[View interactive diagram](https://excalidraw.com/#json=nnf1cohMSh6DneT1O7hiU,WW2oPmJWiEPO_fSltMxBtA)

```
 Daily 9AM KST
      |
      v
 +----------+     +-----------+     +---------------------------+
 |   Cron   | --> | LLM       | --> | Slack #interview          |
 |          |     | (DeepSeek)|     |  Harvest x3  Crig x3      |
 +----------+     +-----------+     |  Bisociate x3             |
      ^                             +---------------------------+
      |                                        |
      |                                   User replies
      |                                   in thread
      |                                        |
      |                                        v
      |                             +---------------------------+
      |                             | Thread Session            |
      |                             |  Dig/Friction -> Connect  |
      |                             |  -> Crystallize           |
      |                             |  (LLM follow-up each turn)|
      |                             +---------------------------+
      |                                        |
      |                                     "done"
      |                                        |
      |                                        v
      |  Context                    +---------------------------+
      |  Layers                     | Harvest Storage           |
      +----<------------------------| Extract seed + tags       |
         (seeds, tags,              | Save locally + push to    |
          themes feed               | GitHub for persistence    |
          next day's Qs)            +---------------------------+
```

### Tech Stack

| Component | Choice |
|-----------|--------|
| Runtime | Node.js (TypeScript) |
| Slack SDK | `@slack/bolt` (Socket Mode) |
| LLM | DeepSeek V3 via `openai` package |
| Scheduler | `node-cron` |
| Storage | Markdown + YAML frontmatter, synced to GitHub |
| URL Reading | Jina Reader API |
| Hosting | Railway (auto-deploys from `main`) |

### Harvest Format

Each conversation is saved as a Markdown file with structured metadata:

```yaml
---
id: h-20260314-001
date: 2026-03-14
mode: harvest
seed: "The real bottleneck in writing is thinking, not typing"
tags: [writing, creative-process, ai]
connections: []
---

Q: What surprised you most in what you read today?
A: That AI can't mimic human writing because of unconscious patterns...
Q: What does that mean for your own writing process?
A: I should harvest my own thinking first, then use AI to refine...
```

## Commands

| Command | Where | Effect |
|---------|-------|--------|
| `@bot generate` | Channel (mention) | Manually trigger daily question generation |
| `done` | In a thread | Save the conversation as a harvest |
| `@bot health check` | Channel (mention) | System status report (Slack, LLM, storage) |

## Key Features

- **Persistent harvests**: Auto-pushed to GitHub on save, pulled on startup — survives Railway redeploys
- **Error feedback**: LLM failures surface as user-visible messages in Slack threads
- **LLM resilience**: 30s timeout, 2 retries on DeepSeek API
- **Event deduplication**: Prevents duplicate processing of Slack events
- **Turn-aware prompts**: Bot adjusts questioning strategy based on conversation progress
- **URL content reading**: Paste a link and the bot incorporates article content into the conversation
- **Graceful shutdown**: SIGTERM handler auto-saves active sessions before Railway stops the container
- **Auto-save**: Incomplete sessions are automatically harvested at midnight

## Setup

1. Create a Slack App with Socket Mode, `chat:write`, `channels:history` permissions, and `message.channels` + `app_mention` event subscriptions
2. Get a DeepSeek API key from platform.deepseek.com
3. Clone and configure:

```bash
git clone https://github.com/BumgeunSong/idea-gardening-system.git
cp .env.example .env
# Fill in your tokens
npm install
npm run dev
```

4. Deploy to Railway — connect GitHub repo, set env vars in service Variables tab:

```
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_CHANNEL_ID=C...
DEEPSEEK_API_KEY=sk-...
GITHUB_TOKEN=ghp_...          # Personal access token with repo scope
GITHUB_REPO=user/repo-name
```

Railway auto-deploys on push to `main`.
