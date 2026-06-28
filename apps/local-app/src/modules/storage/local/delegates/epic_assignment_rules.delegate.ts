import type {
  EpicAssignmentRule,
  CreateEpicAssignmentRule,
  UpdateEpicAssignmentRule,
} from '../../models/domain.models';
import { NotFoundError } from '../../../../common/errors/error-types';
import { BaseStorageDelegate, type StorageDelegateContext } from './base-storage.delegate';

export class EpicAssignmentRulesStorageDelegate extends BaseStorageDelegate {
  constructor(context: StorageDelegateContext) {
    super(context);
  }

  async listEpicAssignmentRules(projectId: string): Promise<EpicAssignmentRule[]> {
    const { epicAssignmentRules } = await import('../../db/schema');
    const { eq, asc } = await import('drizzle-orm');

    const rows = await this.db
      .select()
      .from(epicAssignmentRules)
      .where(eq(epicAssignmentRules.projectId, projectId))
      .orderBy(asc(epicAssignmentRules.priority));

    return rows as unknown as EpicAssignmentRule[];
  }

  async getEpicAssignmentRule(id: string): Promise<EpicAssignmentRule | null> {
    const { epicAssignmentRules } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');

    const rows = await this.db
      .select()
      .from(epicAssignmentRules)
      .where(eq(epicAssignmentRules.id, id))
      .limit(1);
    if (rows.length === 0) return null;
    return rows[0] as unknown as EpicAssignmentRule;
  }

  async createEpicAssignmentRule(data: CreateEpicAssignmentRule): Promise<EpicAssignmentRule> {
    const { randomUUID } = await import('crypto');
    const now = new Date().toISOString();
    const { epicAssignmentRules } = await import('../../db/schema');

    const id = randomUUID();
    await this.db.insert(epicAssignmentRules).values({
      id,
      projectId: data.projectId,
      matchType: data.matchType,
      statusId: data.statusId ?? null,
      tags: data.tags ?? null,
      targetType: data.targetType,
      targetAgentId: data.targetAgentId ?? null,
      targetTeamId: data.targetTeamId ?? null,
      overrideExisting: data.overrideExisting,
      priority: data.priority,
      enabled: data.enabled,
      createdAt: now,
      updatedAt: now,
    });

    const created = await this.getEpicAssignmentRule(id);
    if (!created) throw new NotFoundError('EpicAssignmentRule', id);
    return created;
  }

  async updateEpicAssignmentRule(
    id: string,
    data: UpdateEpicAssignmentRule,
  ): Promise<EpicAssignmentRule> {
    const existing = await this.getEpicAssignmentRule(id);
    if (!existing) throw new NotFoundError('EpicAssignmentRule', id);

    const { epicAssignmentRules } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');
    const now = new Date().toISOString();

    const update: Record<string, unknown> = { updatedAt: now };
    for (const key of [
      'matchType',
      'statusId',
      'tags',
      'targetType',
      'targetAgentId',
      'targetTeamId',
      'overrideExisting',
      'priority',
      'enabled',
    ] as const) {
      if (data[key] !== undefined) update[key] = data[key];
    }

    await this.db.update(epicAssignmentRules).set(update).where(eq(epicAssignmentRules.id, id));

    const updated = await this.getEpicAssignmentRule(id);
    if (!updated) throw new NotFoundError('EpicAssignmentRule', id);
    return updated;
  }

  async deleteEpicAssignmentRule(id: string): Promise<void> {
    const existing = await this.getEpicAssignmentRule(id);
    if (!existing) throw new NotFoundError('EpicAssignmentRule', id);
    const { epicAssignmentRules } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');
    await this.db.delete(epicAssignmentRules).where(eq(epicAssignmentRules.id, id));
  }

  async reorderEpicAssignmentRules(
    _projectId: string,
    items: Array<{ id: string; priority: number }>,
  ): Promise<void> {
    const { epicAssignmentRules } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');
    const now = new Date().toISOString();
    for (const item of items) {
      await this.db
        .update(epicAssignmentRules)
        .set({ priority: item.priority, updatedAt: now })
        .where(eq(epicAssignmentRules.id, item.id));
    }
  }
}
