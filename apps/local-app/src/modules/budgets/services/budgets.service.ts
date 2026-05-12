import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createLogger } from '../../../common/logging/logger';
import {
  STORAGE_SERVICE,
  type BudgetStorage,
} from '../../storage/interfaces/storage.interface';
import type {
  Budget,
  CreateBudget,
  UpdateBudget,
  SpendRecord,
  BudgetStatus,
} from '../../storage/models/domain.models';

@Injectable()
export class BudgetsService {
  private readonly logger = createLogger('BudgetsService');

  constructor(
    @Inject(STORAGE_SERVICE) private readonly storage: BudgetStorage,
  ) {}

  async listBudgets(scope?: string, projectId?: string): Promise<Budget[]> {
    return this.storage.listBudgets(scope, projectId);
  }

  async getBudget(id: string): Promise<Budget> {
    const budget = await this.storage.getBudget(id);
    if (!budget) throw new NotFoundException(`Budget not found: ${id}`);
    return budget;
  }

  async getBudgetStatus(id: string): Promise<BudgetStatus> {
    const budget = await this.getBudget(id);
    return this.computeStatus(budget);
  }

  async createBudget(data: CreateBudget): Promise<Budget> {
    return this.storage.createBudget(data);
  }

  async updateBudget(id: string, data: UpdateBudget): Promise<Budget> {
    await this.getBudget(id);
    return this.storage.updateBudget(id, data);
  }

  async deleteBudget(id: string): Promise<void> {
    await this.getBudget(id);
    await this.storage.deleteBudget(id);
  }

  async toggleBudget(id: string, enabled: boolean): Promise<Budget> {
    return this.updateBudget(id, { enabled });
  }

  async listSpendRecords(budgetId: string, periodStart?: string): Promise<SpendRecord[]> {
    return this.storage.listSpendRecords(budgetId, periodStart);
  }

  async getProjectSpend(projectId: string, since: string): Promise<number> {
    return this.storage.getProjectSpend(projectId, since);
  }

  async getGlobalSpend(since: string): Promise<number> {
    return this.storage.getGlobalSpend(since);
  }

  async refreshBudgetSpend(budget: Budget): Promise<Budget> {
    const windowStart = this.computeWindowStart(budget);
    let spend: number;

    if (budget.scope === 'global') {
      spend = await this.storage.getGlobalSpend(windowStart);
    } else if (budget.projectId) {
      spend = await this.storage.getProjectSpend(budget.projectId, windowStart);
    } else {
      spend = 0;
    }

    const now = new Date().toISOString();
    return this.storage.updateBudget(budget.id, {
      currentSpendUsd: spend,
      spendWindowStart: windowStart,
      lastEvaluatedAt: now,
    });
  }

  async checkBudgetBlock(projectId: string): Promise<{ blocked: boolean; reason?: string }> {
    const [projectBudgets, globalBudgets] = await Promise.all([
      this.storage.listEnabledBudgetsByProject(projectId),
      this.storage.listEnabledGlobalBudgets(),
    ]);

    const allBudgets = [...projectBudgets, ...globalBudgets];

    for (const budget of allBudgets) {
      if (budget.action !== 'block') continue;
      const refreshed = await this.refreshBudgetSpend(budget);
      if (refreshed.currentSpendUsd >= refreshed.limitUsd) {
        return {
          blocked: true,
          reason: `Budget exceeded: "${refreshed.name}" ($${refreshed.currentSpendUsd.toFixed(2)} / $${refreshed.limitUsd.toFixed(2)})`,
        };
      }
    }

    return { blocked: false };
  }

  async listBudgetStatusesForProject(projectId: string): Promise<BudgetStatus[]> {
    const [projectBudgets, globalBudgets] = await Promise.all([
      this.storage.listEnabledBudgetsByProject(projectId),
      this.storage.listEnabledGlobalBudgets(),
    ]);

    const statuses: BudgetStatus[] = [];
    for (const budget of [...projectBudgets, ...globalBudgets]) {
      const refreshed = await this.refreshBudgetSpend(budget);
      statuses.push(this.computeStatus(refreshed));
    }
    return statuses;
  }

  computeStatus(budget: Budget): BudgetStatus {
    const percentUsed = budget.limitUsd > 0 ? (budget.currentSpendUsd / budget.limitUsd) * 100 : 0;
    const remainingUsd = Math.max(0, budget.limitUsd - budget.currentSpendUsd);
    return {
      budget,
      percentUsed,
      remainingUsd,
      isThresholdExceeded: percentUsed >= budget.thresholdPercent,
      isLimitExceeded: budget.currentSpendUsd >= budget.limitUsd,
    };
  }

  computeWindowStart(budget: Budget): string {
    const now = new Date();
    const anchor = budget.periodStartDate ? new Date(budget.periodStartDate) : now;

    switch (budget.period) {
      case 'daily': {
        const d = new Date(now);
        d.setHours(0, 0, 0, 0);
        return d.toISOString();
      }
      case 'weekly': {
        const d = new Date(now);
        d.setDate(d.getDate() - d.getDay());
        d.setHours(0, 0, 0, 0);
        return d.toISOString();
      }
      case 'monthly': {
        return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      }
      case 'lifetime': {
        return new Date(0).toISOString();
      }
      default:
        return now.toISOString();
    }
  }
}
