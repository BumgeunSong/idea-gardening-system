import fs from 'fs';
import path from 'path';
import type { Session, Mode } from './types';

const SESSION_DIR = process.env.SESSION_DIR || './ops/sessions';
const sessions = new Map<string, Session>();

fs.mkdirSync(SESSION_DIR, { recursive: true });

function getInitialPhase(mode: Mode): string {
  switch (mode) {
    case 'harvest': return 'dig';
    case 'crig': return 'friction';
    case 'bisociate': return 'structure';
  }
}

export function createSession(threadTs: string, channelId: string, mode: Mode, initialQuestion: string): Session {
  const session: Session = {
    threadTs,
    channelId,
    mode,
    phase: getInitialPhase(mode),
    history: [
      { role: 'assistant', content: initialQuestion },
    ],
    startedAt: Date.now(),
  };
  sessions.set(threadTs, session);
  persistSession(threadTs);
  return session;
}

export function getSession(threadTs: string): Session | null {
  return sessions.get(threadTs) || null;
}

export function addMessage(threadTs: string, role: 'user' | 'assistant', content: string): Session | null {
  const session = sessions.get(threadTs);
  if (!session) return null;
  session.history.push({ role, content });
  persistSession(threadTs);
  return session;
}

export function closeSession(threadTs: string): Session | null {
  const session = sessions.get(threadTs) || null;
  sessions.delete(threadTs);

  const filePath = path.join(SESSION_DIR, `${threadTs}.json`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  return session;
}

export function getAllActiveSessions(): Session[] {
  return Array.from(sessions.values());
}

function persistSession(threadTs: string): void {
  const session = sessions.get(threadTs);
  if (!session) return;
  fs.writeFileSync(
    path.join(SESSION_DIR, `${threadTs}.json`),
    JSON.stringify(session, null, 2),
  );
}

export function restoreSessions(): void {
  if (!fs.existsSync(SESSION_DIR)) return;
  const files = fs.readdirSync(SESSION_DIR).filter(f => f.endsWith('.json'));
  for (const file of files) {
    try {
      const data: Session = JSON.parse(fs.readFileSync(path.join(SESSION_DIR, file), 'utf-8'));
      sessions.set(data.threadTs, data);
    } catch (e) {
      console.error(`Failed to restore session ${file}:`, (e as Error).message);
    }
  }
  if (files.length > 0) {
    console.log(`Restored ${files.length} active sessions`);
  }
}
