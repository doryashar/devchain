import type {
  Budget,
  CreateBudget,
  UpdateBudget,
  SpendRecord,
  CreateSpendRecord,
} from '../../models/domain.models';
import { NotFoundError } from '../../../../common/errors/error-types';
import { BaseStorageDelegate, type StorageDelegateContext } from './base-storage.delegate';

export class BudgetStorageDelegate extends BaseStorageDelegate {
  constructor(context: StorageDelegateContext) {
    super(context);
  }

  async listBudgets(scope?: string, projectId?: string): Promise<Budget[]> {
    const { budgets } = await import('../../db/schema');
    const { eq, and, asc } = await import('drizzle-orm');

    const conditions = [];
    if (scope) conditions.push(eq(budgets.scope, scope));
    if (projectId) conditions.push(eq(budgets.projectId, projectId));

    const rows = await this.db
      .select()
      .from(budgets)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(budgets.createdAt));

    return rows as Budget[];
  }

  async getBudget(id: string): Promise<Budget | null> {
    const { budgets } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');

    const result = await this.db
      .select()
      .from(budgets)
      .where(eq(budgets.id, id))
      .limit(1);

    return (result[0] as Budget) ?? null;
  }

  async createBudget(data: CreateBudget): Promise<Budget> {
    const { randomUUID } = await import('crypto');
    const now = new Date().toISOString();
    const { budgets } = await import('../../db/schema');

    const id = randomUUID();

    await this.db.insert(budgets).values({
      id,
      scope: data.scope,
      projectId: data.projectId ?? null,
      name: data.name,
      description: data.description ?? null,
      enabled: data.enabled ?? true,
      limitUsd: data.limitUsd,
      period: data.period,
      periodStartDate: data.periodStartDate ?? null,
      action: data.action ?? 'notify',
      thresholdPercent: data.thresholdPercent ?? 80,
      currentSpendUsd: 0,
      spendWindowStart: null,
      lastEvaluatedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const created = await this.getBudget(id);
    if (!created) throw new NotFoundError('Budget', id);
    return created;
  }

  async updateBudget(id: string, data: UpdateBudget): Promise<Budget> {
    const { budgets } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');
    const now = new Date().toISOString();

    const existing = await this.getBudget(id);
    if (!existing) throw new NotFoundError('Budget', id);

    await this.db
      .update(budgets)
      .set({ ...data, updatedAt: now })
      .where(eq(budgets.id, id));

    const updated = await this.getBudget(id);
    if (!updated) throw new NotFoundError('Budget', id);
    return updated;
  }

  async deleteBudget(id: string): Promise<void> {
    const { budgets } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');
    await this.db.delete(budgets).where(eq(budgets.id, id));
  }

  async listEnabledBudgetsByProject(projectId: string): Promise<Budget[]> {
    const { budgets } = await import('../../db/schema');
    const { eq, and } = await import('drizzle-orm');

    const rows = await this.db
      .select()
      .from(budgets)
      .where(
        and(
          eq(budgets.projectId, projectId),
          eq(budgets.enabled, true),
        ),
      );

    return rows as Budget[];
  }

  async listEnabledGlobalBudgets(): Promise<Budget[]> {
    const { budgets } = await import('../../db/schema');
    const { eq, and } = await import('drizzle-orm');

    const rows = await this.db
      .select()
      .from(budgets)
      .where(
        and(
          eq(budgets.scope, 'global'),
          eq(budgets.enabled, true),
        ),
      );

    return rows as Budget[];
  }

  async createSpendRecord(data: CreateSpendRecord): Promise<SpendRecord> {
    const { randomUUID } = await import('crypto');
    const { spendRecords } = await import('../../db/schema');

    const id = randomUUID();

    await this.db.insert(spendRecords).values({
      id,
      budgetId: data.budgetId,
      sessionId: data.sessionId ?? null,
      projectId: data.projectId,
      agentId: data.agentId ?? null,
      model: data.model ?? null,
      inputTokens: data.inputTokens ?? null,
      outputTokens: data.outputTokens ?? null,
      costUsd: data.costUsd,
      periodStart: data.periodStart,
      recordedAt: data.recordedAt,
    });

    return {
      id,
      budgetId: data.budgetId,
      sessionId: data.sessionId ?? null,
      projectId: data.projectId,
      agentId: data.agentId ?? null,
      model: data.model ?? null,
      inputTokens: data.inputTokens ?? null,
      outputTokens: data.outputTokens ?? null,
      costUsd: data.costUsd,
      periodStart: data.periodStart,
      recordedAt: data.recordedAt,
    };
  }

  async listSpendRecords(budgetId: string, periodStart?: string): Promise<SpendRecord[]> {
    const { spendRecords } = await import('../../db/schema');
    const { eq, and, desc } = await import('drizzle-orm');

    const conditions = [eq(spendRecords.budgetId, budgetId)];
    if (periodStart) conditions.push(eq(spendRecords.periodStart, periodStart));

    const rows = await this.db
      .select()
      .from(spendRecords)
      .where(and(...conditions))
      .orderBy(desc(spendRecords.recordedAt))
      .limit(100);

    return rows as SpendRecord[];
  }

  async getProjectSpend(projectId: string, since: string): Promise<number> {
    const { sessions, agents } = await import('../../db/schema');
    const { eq, and, sql } = await import('drizzle-orm');

    const rows = await this.db
      .select({ total: sql<number>`COALESCE(SUM(${sessions.costUsd}), 0)` })
      .from(sessions)
      .innerJoin(agents, eq(sessions.agentId, agents.id))
      .where(
        and(
          eq(agents.projectId, projectId),
          sql`${sessions.endedAt} >= ${since}`,
        ),
      );

    return rows[0]?.total ?? 0;
  }

  async getGlobalSpend(since: string): Promise<number> {
    const { sessions } = await import('../../db/schema');
    const { sql } = await import('drizzle-orm');

    const rows = await this.db
      .select({ total: sql<number>`COALESCE(SUM(${sessions.costUsd}), 0)` })
      .from(sessions)
      .where(sql`${sessions.endedAt} >= ${since}`);

    return rows[0]?.total ?? 0;
  }

  async updateSessionCost(
    sessionId: string,
    costUsd: number | null,
    inputTokens: number | null,
    outputTokens: number | null,
    primaryModel: string | null,
  ): Promise<void> {
    const { sessions } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');
    const now = new Date().toISOString();

    await this.db
      .update(sessions)
      .set({ costUsd, inputTokens, outputTokens, primaryModel, updatedAt: now })
      .where(eq(sessions.id, sessionId));
  }
}
