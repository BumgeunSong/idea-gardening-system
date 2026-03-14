import { describe, it, expect } from 'vitest';
import { parseHarvest } from '../harvest';

describe('parseHarvest', () => {
  it('parses valid frontmatter and body', () => {
    const content = `---
id: h-20260315-001
date: 2026-03-15
mode: harvest
seed: "글쓰기의 진짜 병목은 타이핑이 아니라 생각을 구조화하는 과정이다"
tags: [writing, mental-model, productivity]
connections: []
---

Q: 그게 왜 의외였어?

A: 타이핑 속도가 문제가 아니라는 걸 깨달았어.`;

    const harvest = parseHarvest(content);

    expect(harvest.frontmatter.id).toBe('h-20260315-001');
    expect(harvest.frontmatter.date).toBe('2026-03-15');
    expect(harvest.frontmatter.mode).toBe('harvest');
    expect(harvest.frontmatter.seed).toBe('글쓰기의 진짜 병목은 타이핑이 아니라 생각을 구조화하는 과정이다');
    expect(harvest.frontmatter.tags).toEqual(['writing', 'mental-model', 'productivity']);
    expect(harvest.frontmatter.connections).toEqual([]);
    expect(harvest.body).toContain('타이핑 속도가 문제가 아니라는 걸 깨달았어.');
  });

  it('handles missing frontmatter gracefully', () => {
    const content = 'Just some plain text without frontmatter.';
    const harvest = parseHarvest(content);

    expect(harvest.body).toBe(content);
  });

  it('handles special characters in seed', () => {
    const content = `---
id: h-20260315-002
date: 2026-03-15
mode: crig
seed: "코드 리뷰에서 '왜?'라는 질문이 가장 강력하다"
tags: [code-review]
connections: []
---

Body text.`;

    const harvest = parseHarvest(content);

    expect(harvest.frontmatter.seed).toBe("코드 리뷰에서 '왜?'라는 질문이 가장 강력하다");
  });

  it('handles empty tags array', () => {
    const content = `---
id: h-20260315-003
date: 2026-03-15
mode: bisociate
seed: "테스트 씨앗"
tags: []
connections: []
---

Body.`;

    const harvest = parseHarvest(content);

    expect(harvest.frontmatter.tags).toEqual([]);
  });
});
