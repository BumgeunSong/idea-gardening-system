import { loadAllHarvests, updateHarvestConnections, loadHarvestFile } from './harvest';
import { findConnections } from './llm';
import type { Connection } from './llm';
import { pushHarvestToGitHub } from './github';

export interface ConnectionResult {
  sourceId: string;
  connections: Connection[];
  threadTs?: string;
}

export async function connectHarvest(harvestId: string, threadTs?: string): Promise<ConnectionResult> {
  const allHarvests = loadAllHarvests();

  const sourceHarvest = allHarvests.find(h => h.frontmatter.id === harvestId);
  if (!sourceHarvest) {
    return { sourceId: harvestId, connections: [], threadTs };
  }

  if (allHarvests.length <= 1) {
    return { sourceId: harvestId, connections: [], threadTs };
  }

  const sourceSummary = {
    id: sourceHarvest.frontmatter.id,
    seed: sourceHarvest.frontmatter.seed,
    tags: Array.isArray(sourceHarvest.frontmatter.tags) ? sourceHarvest.frontmatter.tags : [],
  };

  const allSummaries = allHarvests.map(h => ({
    id: h.frontmatter.id,
    seed: h.frontmatter.seed,
    tags: Array.isArray(h.frontmatter.tags) ? h.frontmatter.tags : [],
  }));

  const connections = await findConnections(sourceSummary, allSummaries);

  if (connections.length > 0) {
    const targetIds = connections.map(c => c.targetId);
    updateHarvestConnections(harvestId, targetIds);
    for (const targetId of targetIds) {
      updateHarvestConnections(targetId, [harvestId]);
    }
  }

  return { sourceId: harvestId, connections, threadTs };
}

export async function batchConnectAll(): Promise<ConnectionResult[]> {
  const allHarvests = loadAllHarvests();

  const unconnected = allHarvests.filter(
    h => !h.frontmatter.connections || h.frontmatter.connections.length === 0,
  );

  if (unconnected.length === 0) {
    return [];
  }

  const results: ConnectionResult[] = [];
  const modifiedIds = new Set<string>();

  for (const harvest of unconnected) {
    try {
      const result = await connectHarvest(harvest.frontmatter.id);
      if (result.connections.length > 0) {
        results.push(result);
        modifiedIds.add(harvest.frontmatter.id);
        for (const conn of result.connections) {
          modifiedIds.add(conn.targetId);
        }
      }
    } catch (err) {
      console.error(`Failed to connect harvest ${harvest.frontmatter.id}:`, (err as Error).message);
    }
  }

  // GitHub retry pass: re-push all modified files with fresh content to resolve SHA conflicts
  for (const harvestId of modifiedIds) {
    try {
      const content = loadHarvestFile(harvestId);
      if (content !== null) {
        await pushHarvestToGitHub(`${harvestId}.md`, content);
      }
    } catch (err) {
      console.error(`GitHub retry push failed for ${harvestId}:`, (err as Error).message);
    }
  }

  return results;
}
