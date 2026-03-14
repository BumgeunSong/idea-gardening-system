import fs from 'fs';
import path from 'path';
import type { Session, Harvest } from './types';
import { pushHarvestToGitHub } from './github';

const HARVEST_DIR = process.env.HARVEST_DIR || './harvests';

fs.mkdirSync(HARVEST_DIR, { recursive: true });

function generateId(): string {
  const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const existing = fs.readdirSync(HARVEST_DIR).filter(f => f.startsWith(`h-${date}`));
  const seq = String(existing.length + 1).padStart(3, '0');
  return `h-${date}-${seq}`;
}

export function saveHarvest(session: Session, seed: string, tags: string[]): string {
  const id = generateId();
  const date = new Date().toISOString().split('T')[0];

  const frontmatter = [
    '---',
    `id: ${id}`,
    `date: ${date}`,
    `mode: ${session.mode}`,
    `seed: "${seed}"`,
    `tags: [${tags.join(', ')}]`,
    `connections: []`,
    '---',
  ].join('\n');

  const body = session.history
    .map(m => {
      if (m.role === 'assistant') return `Q: ${m.content}`;
      if (m.role === 'user') return `A: ${m.content}`;
      return '';
    })
    .filter(Boolean)
    .join('\n\n');

  const content = `${frontmatter}\n\n${body}\n`;
  const filePath = path.join(HARVEST_DIR, `${id}.md`);
  fs.writeFileSync(filePath, content);

  // Fire-and-forget: push to GitHub for persistence
  pushHarvestToGitHub(`${id}.md`, content).catch(e =>
    console.error(`GitHub push failed for ${id}:`, (e as Error).message),
  );

  console.log(`Saved harvest: ${id}`);
  return id;
}

export function loadRecentHarvests(n = 5): Harvest[] {
  if (!fs.existsSync(HARVEST_DIR)) return [];

  const files = fs.readdirSync(HARVEST_DIR)
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse()
    .slice(0, n);

  return files.map(f => {
    const content = fs.readFileSync(path.join(HARVEST_DIR, f), 'utf-8');
    return parseHarvest(content);
  });
}

export function loadHarvestsByDate(date: string): Harvest[] {
  if (!fs.existsSync(HARVEST_DIR)) return [];

  const dateCompact = date.replace(/-/g, '');
  const files = fs.readdirSync(HARVEST_DIR)
    .filter(f => f.endsWith('.md') && f.includes(dateCompact))
    .sort();

  return files.map(f => {
    const content = fs.readFileSync(path.join(HARVEST_DIR, f), 'utf-8');
    return parseHarvest(content);
  });
}

function parseHarvest(content: string): Harvest {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {} as Harvest['frontmatter'], body: content };

  const frontmatter: Record<string, string | string[]> = {};
  match[1].split('\n').forEach(line => {
    const colonIdx = line.indexOf(': ');
    if (colonIdx === -1) return;
    const key = line.slice(0, colonIdx).trim();
    let value: string | string[] = line.slice(colonIdx + 2).trim();

    if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    }
    if (typeof value === 'string' && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    frontmatter[key] = value;
  });

  return { frontmatter: frontmatter as Harvest['frontmatter'], body: match[2].trim() };
}
