const GITHUB_API = 'https://api.github.com';

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
