import { ValidationError } from '../../../common/errors/error-types';
import type { StorageService } from '../../storage/interfaces/storage.interface';

export function ensureNoDuplicateAgentNames(templateAgents: Array<{ name: string }>): void {
  const seen = new Map<string, string>();
  const duplicates: string[] = [];
  for (const a of templateAgents) {
    const lower = a.name.trim().toLowerCase();
    if (seen.has(lower)) duplicates.push(a.name);
    else seen.set(lower, a.name);
  }
  if (duplicates.length > 0) {
    throw new ValidationError('Template has duplicate agent names', {
      duplicates,
      hint: 'Template agent names (case-insensitive) must be unique for session preservation to work deterministically.',
    });
  }
}

export async function planAndApplySessionPreservation(
  parkedByOldAgentId: Map<string, string[]>,
  oldAgents: Array<{ id: string; name: string }>,
  newAgentNameToId: Record<string, string>,
  storage: Pick<StorageService, 'applySessionPlan'>,
): Promise<{ preservedCount: number; removedCount: number }> {
  const oldAgentIdToNameLower = new Map<string, string>();
  for (const a of oldAgents) oldAgentIdToNameLower.set(a.id, a.name.trim().toLowerCase());

  const toReassign: Array<{ sessionId: string; newAgentId: string }> = [];
  const toDelete: string[] = [];

  for (const [oldAgentId, sessionIds] of parkedByOldAgentId) {
    const oldNameLower = oldAgentIdToNameLower.get(oldAgentId);
    if (!oldNameLower) {
      toDelete.push(...sessionIds);
      continue;
    }
    const newAgentId = newAgentNameToId[oldNameLower];
    if (newAgentId) {
      for (const sessionId of sessionIds) toReassign.push({ sessionId, newAgentId });
    } else {
      toDelete.push(...sessionIds);
    }
  }

  await storage.applySessionPlan(toReassign, toDelete);
  return { preservedCount: toReassign.length, removedCount: toDelete.length };
}
