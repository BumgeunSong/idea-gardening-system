const URL_REGEX = /https?:\/\/[^\s<>'")\]]+/g;
const MAX_CONTENT_LENGTH = 2000;

export function extractUrls(text: string): string[] {
  return text.match(URL_REGEX) || [];
}

export async function fetchUrlContent(url: string): Promise<string | null> {
  try {
    const res = await fetch(`https://r.jina.ai/${encodeURI(url)}`, {
      headers: { Accept: 'text/plain' },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return null;

    const text = await res.text();
    if (!text.trim()) return null;

    return text.length > MAX_CONTENT_LENGTH
      ? text.slice(0, MAX_CONTENT_LENGTH) + '\n...(truncated)'
      : text;
  } catch (e) {
    console.error(`Failed to fetch URL content: ${(e as Error).message}`);
    return null;
  }
}
