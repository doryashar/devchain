import { Inject, Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createLogger } from '../../../common/logging/logger';
import { STORAGE_SERVICE, type StorageService } from '../../storage/interfaces/storage.interface';
import type { Budget } from '../../storage/models/domain.models';
import { BudgetsService } from './budgets.service';
import { EventsService } from '../../events/services/events.service';
import { SessionsService } from '../../sessions/services/sessions.service';

const EVALUATION_INTERVAL_MS = 60_000;

@Injectable()
export class BudgetEvaluatorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger('BudgetEvaluatorService');
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    private readonly budgetsService: BudgetsService,
    private readonly eventsService: EventsService,
    private readonly sessionsService: SessionsService,
  ) {}

  onModuleInit() {
    this.logger.info('Starting budget evaluator');
    this.timer = setInterval(() => this.periodicEvaluation(), EVALUATION_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async onCostRecorded(payload: {
    sessionId: string;
    agentId: string | null;
    projectId: string;
    costUsd: number;
    inputTokens: number | null;
    outputTokens: number | null;
    primaryModel: string | null;
  }): Promise<void> {
    try {
      const [projectBudgets, globalBudgets] = await Promise.all([
        this.storage.listEnabledBudgetsByProject(payload.projectId),
        this.storage.listEnabledGlobalBudgets(),
      ]);

      for (const budget of [...projectBudgets, ...globalBudgets]) {
        await this.evaluateBudget(budget, payload);
      }
    } catch (error) {
      this.logger.error({ error, projectId: payload.projectId }, 'Budget evaluation failed on cost recorded');
    }
  }

  private async evaluateBudget(
    budget: Budget,
    costPayload?: {
      sessionId: string;
      agentId: string | null;
      projectId: string;
      costUsd: number;
      inputTokens: number | null;
      outputTokens: number | null;
      primaryModel: string | null;
    },
  ): Promise<void> {
    const refreshed = await this.budgetsService.refreshBudgetSpend(budget);
    const status = this.budgetsService.computeStatus(refreshed);

    if (costPayload) {
      const windowStart = this.budgetsService.computeWindowStart(refreshed);
      await this.storage.createSpendRecord({
        budgetId: refreshed.id,
        sessionId: costPayload.sessionId,
        projectId: costPayload.projectId,
        agentId: costPayload.agentId,
        model: costPayload.primaryModel,
        inputTokens: costPayload.inputTokens,
        outputTokens: costPayload.outputTokens,
        costUsd: costPayload.costUsd,
        periodStart: windowStart,
        recordedAt: new Date().toISOString(),
      });
    }

    if (status.isLimitExceeded) {
      try {
        await this.eventsService.publish('budget.exceeded', {
          budgetId: refreshed.id,
          projectId: refreshed.projectId,
          budgetName: refreshed.name,
          currentSpendUsd: refreshed.currentSpendUsd,
          limitUsd: refreshed.limitUsd,
          action: refreshed.action,
        });
      } catch (e) {
        this.logger.warn({ e }, 'Failed to publish budget.exceeded event');
      }

      if (refreshed.action === 'kill' && refreshed.projectId) {
        await this.killProjectSessions(refreshed.projectId, refreshed.name);
      }
    } else if (status.isThresholdExceeded) {
      try {
        await this.eventsService.publish('budget.threshold_exceeded', {
          budgetId: refreshed.id,
          projectId: refreshed.projectId,
          budgetName: refreshed.name,
          currentSpendUsd: refreshed.currentSpendUsd,
          limitUsd: refreshed.limitUsd,
          thresholdPercent: refreshed.thresholdPercent,
        });
      } catch (e) {
        this.logger.warn({ e }, 'Failed to publish budget.threshold_exceeded event');
      }
    }
  }

  private async periodicEvaluation(): Promise<void> {
    try {
      const allBudgets = await this.storage.listBudgets(undefined, undefined);
      const enabled = allBudgets.filter((b) => b.enabled);
      for (const budget of enabled) {
        await this.evaluateBudget(budget);
      }
    } catch (error) {
      this.logger.error({ error }, 'Periodic budget evaluation failed');
    }
  }

  private async killProjectSessions(projectId: string, budgetName: string): Promise<void> {
    this.logger.info({ projectId, budgetName }, 'Budget exceeded with kill action, terminating project sessions');
    try {
      const { agents } = await import('../../storage/db/schema');
      const { sessions } = await import('../../storage/db/schema');
      const { eq, and } = await import('drizzle-orm');
      const { getRawSqliteClient } = await import('../../storage/db/sqlite-raw');

      const db = (this.storage as unknown as {
        db: import('drizzle-orm/better-sqlite3').BetterSQLite3Database;
      }).db;
      if (!db) return;

      const runningSessions = await db
        .select({ id: sessions.id })
        .from(sessions)
        .innerJoin(agents, eq(sessions.agentId, agents.id))
        .where(
          and(
            eq(agents.projectId, projectId),
            eq(sessions.status, 'running'),
          ),
        );

      for (const s of runningSessions) {
        try {
          await this.sessionsService.terminateSession(s.id);
          this.logger.info({ sessionId: s.id }, 'Terminated session due to budget kill');
        } catch (e) {
          this.logger.warn({ e, sessionId: s.id }, 'Failed to terminate session for budget kill');
        }
      }
    } catch (error) {
      this.logger.error({ error, projectId }, 'Failed to kill project sessions for budget');
    }
  }
}
