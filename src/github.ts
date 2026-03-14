import fs from 'fs';
import path from 'path';

const GITHUB_API = 'https://api.github.com';

function getConfig() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  return token && repo ? { token, repo } : null;
}

export async function pullHarvestsFromGitHub(): Promise<void> {
  const config = getConfig();
  if (!config) return;

  const harvestDir = process.env.HARVEST_DIR || './harvests';
  fs.mkdirSync(harvestDir, { recursive: true });

  const url = `${GITHUB_API}/repos/${config.repo}/contents/harvests`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/vnd.github.v3+json' },
  });

  if (!res.ok) {
    if (res.status === 404) {
      console.log('No harvests directory in GitHub repo yet');
      return;
    }
    throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  }

  const files = await res.json() as { name: string; download_url: string }[];
  const mdFiles = files.filter(f => f.name.endsWith('.md'));

  let pulled = 0;
  for (const file of mdFiles) {
    const localPath = path.join(harvestDir, file.name);
    if (fs.existsSync(localPath)) continue; // skip existing

    const content = await fetch(file.download_url);
    fs.writeFileSync(localPath, await content.text());
    pulled++;
  }

  console.log(`Pulled ${pulled} new harvests from GitHub (${mdFiles.length} total)`);
}

export async function pushHarvestToGitHub(fileName: string, content: string): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) return;

  const filePath = `harvests/${fileName}`;
  const url = `${GITHUB_API}/repos/${repo}/contents/${filePath}`;

  // Check if file already exists (need sha to update)
  let sha: string | undefined;
  try {
    const existing = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
    });
    if (existing.ok) {
      const data = await existing.json() as { sha: string };
      sha = data.sha;
    }
  } catch {
    // File doesn't exist yet, that's fine
  }

  const body: Record<string, string> = {
    message: `harvest: ${fileName}`,
    content: Buffer.from(content).toString('base64'),
  };
  if (sha) body.sha = sha;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub API ${res.status}: ${err}`);
  }

  console.log(`Pushed ${fileName} to GitHub`);
}
