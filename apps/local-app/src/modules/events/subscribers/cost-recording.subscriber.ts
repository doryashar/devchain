import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { OnEvent } from '@nestjs/event-emitter';
import { STORAGE_SERVICE, type StorageService } from '../../storage/interfaces/storage.interface';
import type { SessionStoppedEventPayload } from '../catalog/session.stopped';

@Injectable()
export class CostRecordingSubscriber {
  private readonly logger = new Logger(CostRecordingSubscriber.name);
  private sessionReaderServiceRef?: import('../../session-reader/services/session-reader.service').SessionReaderService;
  private budgetsServiceRef?: import('../../budgets/services/budgets.service').BudgetsService;
  private budgetEvaluatorRef?: import('../../budgets/services/budget-evaluator.service').BudgetEvaluatorService;
  private eventsServiceRef?: import('../services/events.service').EventsService;

  constructor(
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    private readonly moduleRef: ModuleRef,
  ) {}

  @OnEvent('session.stopped', { async: true })
  async handleSessionStopped(payload: SessionStoppedEventPayload): Promise<void> {
    const { sessionId } = payload;

    try {
      const { agents } = await import('../../storage/db/schema');
      const { sessions } = await import('../../storage/db/schema');
      const { eq } = await import('drizzle-orm');

      const db = (this.storage as unknown as {
        db: import('drizzle-orm/better-sqlite3').BetterSQLite3Database;
      }).db;
      if (!db) return;

      const sessionRows = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);

      const session = sessionRows[0];
      if (!session || !session.agentId) return;

      const agentRows = await db
        .select()
        .from(agents)
        .where(eq(agents.id, session.agentId))
        .limit(1);

      const agent = agentRows[0];
      if (!agent) return;

      let costUsd: number | null = null;
      let inputTokens: number | null = null;
      let outputTokens: number | null = null;
      let primaryModel: string | null = null;

      try {
        const readerService = this.getSessionReaderService();
        const summary = await readerService.getTranscriptSummary(sessionId);
        if (summary?.metrics) {
          costUsd = summary.metrics.costUsd ?? null;
          inputTokens = summary.metrics.inputTokens ?? null;
          outputTokens = summary.metrics.outputTokens ?? null;
          primaryModel = summary.metrics.primaryModel ?? null;
        }
      } catch (e) {
        this.logger.warn({ e, sessionId }, 'Failed to extract transcript cost on session stop');
      }

      await this.storage.updateSessionCost(sessionId, costUsd, inputTokens, outputTokens, primaryModel);

      if (costUsd !== null && costUsd > 0) {
        const costPayload = {
          sessionId,
          agentId: session.agentId,
          projectId: agent.projectId,
          costUsd,
          inputTokens,
          outputTokens,
          primaryModel,
        };

        try {
          const eventsService = this.getEventsService();
          await eventsService.publish('session.cost_recorded', costPayload);
        } catch (e) {
          this.logger.warn({ e, sessionId }, 'Failed to publish session.cost_recorded event');
        }

        try {
          const evaluator = this.getBudgetEvaluatorService();
          await evaluator.onCostRecorded(costPayload);
        } catch (e) {
          this.logger.warn({ e, sessionId }, 'Failed to evaluate budgets on cost recorded');
        }
      }
    } catch (error) {
      this.logger.error({ error, sessionId }, 'Cost recording failed');
    }
  }

  private getSessionReaderService() {
    if (!this.sessionReaderServiceRef) {
      const { SessionReaderService } = require('../../session-reader/services/session-reader.service');
      this.sessionReaderServiceRef = this.moduleRef.get(SessionReaderService, { strict: false });
    }
    return this.sessionReaderServiceRef!;
  }

  private getBudgetEvaluatorService() {
    if (!this.budgetEvaluatorRef) {
      const { BudgetEvaluatorService } = require('../../budgets/services/budget-evaluator.service');
      this.budgetEvaluatorRef = this.moduleRef.get(BudgetEvaluatorService, { strict: false });
    }
    return this.budgetEvaluatorRef!;
  }

  private getEventsService() {
    if (!this.eventsServiceRef) {
      const { EventsService } = require('../services/events.service');
      this.eventsServiceRef = this.moduleRef.get(EventsService, { strict: false });
    }
    return this.eventsServiceRef!;
  }
}
