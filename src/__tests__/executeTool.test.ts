import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { executeTool } from '../tools';

const TEST_HARVEST_DIR = './test-harvests';

function writeHarvest(id: string, date: string, mode: string, seed: string, tags: string[]): void {
  const content = `---
id: ${id}
date: ${date}
mode: ${mode}
seed: "${seed}"
tags: [${tags.join(', ')}]
connections: []
---

Q: Test question?

A: Test answer.
`;
  fs.writeFileSync(path.join(TEST_HARVEST_DIR, `${id}.md`), content);
}

describe('executeTool', () => {
  beforeEach(() => {
    process.env.HARVEST_DIR = TEST_HARVEST_DIR;
    fs.mkdirSync(TEST_HARVEST_DIR, { recursive: true });

    // Create fixture harvests
    writeHarvest('h-20260313-001', '2026-03-13', 'harvest', '습관은 의지가 아니라 환경의 산물이다', ['habit', 'environment', 'psychology']);
    writeHarvest('h-20260314-001', '2026-03-14', 'crig', '피드백 루프가 짧을수록 학습 속도가 빨라진다', ['feedback-loop', 'learning']);
    writeHarvest('h-20260315-001', '2026-03-15', 'harvest', '글쓰기의 병목은 생각의 구조화다', ['writing', 'mental-model']);
    writeHarvest('h-20260315-002', '2026-03-15', 'bisociate', '디버깅과 편집은 같은 근육을 쓴다', ['programming', 'writing']);
  });

  afterEach(() => {
    fs.rmSync(TEST_HARVEST_DIR, { recursive: true, force: true });
    delete process.env.HARVEST_DIR;
  });

  describe('read_harvests', () => {
    it('returns seeds and tags, no body', () => {
      const result = executeTool('read_harvests', { count: 2 }, {});
      expect(result.success).toBe(true);

      const data = JSON.parse(result.data);
      expect(data).toHaveLength(2);
      expect(data[0].seed).toBeDefined();
      expect(data[0].tags).toBeDefined();
      // Should not include body text
      expect(data[0].body).toBeUndefined();
    });

    it('defaults to 5 when no count given', () => {
      const result = executeTool('read_harvests', {}, {});
      expect(result.success).toBe(true);

      const data = JSON.parse(result.data);
      expect(data.length).toBeLessThanOrEqual(5);
    });

    it('caps at 20', () => {
      const result = executeTool('read_harvests', { count: 100 }, {});
      expect(result.success).toBe(true);
      // Should not crash, just returns what exists
    });
  });

  describe('search_harvests', () => {
    it('filters by tag', () => {
      const result = executeTool('search_harvests', { tag: 'writing' }, {});
      expect(result.success).toBe(true);

      const data = JSON.parse(result.data);
      expect(data.length).toBe(2);
      expect(data.every((h: { tags: string[] }) => h.tags.includes('writing'))).toBe(true);
    });

    it('filters by keyword in seed', () => {
      const result = executeTool('search_harvests', { query: '피드백' }, {});
      expect(result.success).toBe(true);

      const data = JSON.parse(result.data);
      expect(data.length).toBe(1);
      expect(data[0].seed).toContain('피드백');
    });

    it('filters by date_from', () => {
      const result = executeTool('search_harvests', { date_from: '2026-03-15' }, {});
      expect(result.success).toBe(true);

      const data = JSON.parse(result.data);
      expect(data.length).toBe(2);
      expect(data.every((h: { date: string }) => h.date >= '2026-03-15')).toBe(true);
    });

    it('combines filters', () => {
      const result = executeTool('search_harvests', { tag: 'writing', date_from: '2026-03-15' }, {});
      expect(result.success).toBe(true);

      const data = JSON.parse(result.data);
      expect(data.length).toBe(2);
    });

    it('returns empty array when no matches', () => {
      const result = executeTool('search_harvests', { query: 'nonexistent' }, {});
      expect(result.success).toBe(true);

      const data = JSON.parse(result.data);
      expect(data).toEqual([]);
    });
  });

  describe('list_tags', () => {
    it('returns tags sorted by frequency', () => {
      const result = executeTool('list_tags', {}, {});
      expect(result.success).toBe(true);

      const data = JSON.parse(result.data) as { tag: string; count: number }[];
      expect(data.length).toBeGreaterThan(0);

      // 'writing' appears in 2 harvests
      const writingTag = data.find(t => t.tag === 'writing');
      expect(writingTag).toBeDefined();
      expect(writingTag!.count).toBe(2);

      // Should be sorted descending
      for (let i = 1; i < data.length; i++) {
        expect(data[i - 1].count).toBeGreaterThanOrEqual(data[i].count);
      }
    });
  });

  describe('unknown tool', () => {
    it('returns error for unknown tool name', () => {
      const result = executeTool('nonexistent_tool', {}, {});
      expect(result.success).toBe(false);
      expect(result.data).toContain('Unknown tool');
    });
  });
});
