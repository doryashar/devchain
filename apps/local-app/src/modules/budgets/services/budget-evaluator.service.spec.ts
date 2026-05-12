jest.mock('../../storage/db/schema', () => ({}));
jest.mock('../../events/services/events.service', () => ({
  EventsService: class {
    publish = jest.fn().mockResolvedValue('evt-1');
  },
}));
jest.mock('../../sessions/services/sessions.service', () => ({
  SessionsService: class {
    terminateSession = jest.fn().mockResolvedValue(undefined);
  },
}));

import { BudgetEvaluatorService } from './budget-evaluator.service';
import type { BudgetStorage, StorageService } from '../../storage/interfaces/storage.interface';
import type { Budget } from '../../storage/models/domain.models';
import type { BudgetsService } from './budgets.service';

describe('BudgetEvaluatorService', () => {
  let storage: { [K in keyof BudgetStorage]: jest.Mock };
  let budgetsService: { [K in keyof BudgetsService]: jest.Mock };
  let eventsService: { publish: jest.Mock };
  let sessionsService: { terminateSession: jest.Mock };
  let service: BudgetEvaluatorService;

  function makeBudget(overrides: Partial<Budget> = {}): Budget {
    return {
      id: 'budget-1',
      scope: 'project',
      projectId: 'proj-1',
      name: 'Test Budget',
      description: null,
      enabled: true,
      limitUsd: 100,
      period: 'monthly',
      periodStartDate: null,
      action: 'notify',
      thresholdPercent: 80,
      currentSpendUsd: 0,
      spendWindowStart: null,
      lastEvaluatedAt: null,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  const costPayload = {
    sessionId: 'sess-1',
    agentId: 'agent-1',
    projectId: 'proj-1',
    costUsd: 10,
    inputTokens: 1000,
    outputTokens: 500,
    primaryModel: 'claude-3-opus',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    storage = {
      listBudgets: jest.fn(),
      getBudget: jest.fn(),
      createBudget: jest.fn(),
      updateBudget: jest.fn(),
      deleteBudget: jest.fn(),
      listEnabledBudgetsByProject: jest.fn(),
      listEnabledGlobalBudgets: jest.fn(),
      createSpendRecord: jest.fn(),
      listSpendRecords: jest.fn(),
      getProjectSpend: jest.fn(),
      getGlobalSpend: jest.fn(),
      updateSessionCost: jest.fn(),
    };

    budgetsService = {
      listBudgets: jest.fn(),
      getBudget: jest.fn(),
      getBudgetStatus: jest.fn(),
      createBudget: jest.fn(),
      updateBudget: jest.fn(),
      deleteBudget: jest.fn(),
      toggleBudget: jest.fn(),
      listSpendRecords: jest.fn(),
      getProjectSpend: jest.fn(),
      getGlobalSpend: jest.fn(),
      refreshBudgetSpend: jest.fn(),
      checkBudgetBlock: jest.fn(),
      listBudgetStatusesForProject: jest.fn(),
      computeStatus: jest.fn(),
      computeWindowStart: jest.fn(),
    };

    eventsService = { publish: jest.fn().mockResolvedValue('evt-1') };
    sessionsService = { terminateSession: jest.fn().mockResolvedValue(undefined) };

    service = new BudgetEvaluatorService(
      storage as unknown as StorageService,
      budgetsService as unknown as BudgetsService,
      eventsService as any,
      sessionsService as any,
    );
  });

  describe('onCostRecorded', () => {
    it('should evaluate project budgets', async () => {
      const budget = makeBudget({ action: 'notify' });
      storage.listEnabledBudgetsByProject.mockResolvedValue([budget]);
      storage.listEnabledGlobalBudgets.mockResolvedValue([]);

      const refreshed = makeBudget({ currentSpendUsd: 50 });
      budgetsService.refreshBudgetSpend.mockResolvedValue(refreshed);
      budgetsService.computeStatus.mockReturnValue({
        budget: refreshed,
        percentUsed: 50,
        remainingUsd: 50,
        isThresholdExceeded: false,
        isLimitExceeded: false,
      });
      budgetsService.computeWindowStart.mockReturnValue('2025-01-01T00:00:00.000Z');

      await service.onCostRecorded(costPayload);

      expect(storage.createSpendRecord).toHaveBeenCalledWith(expect.objectContaining({
        budgetId: 'budget-1',
        sessionId: 'sess-1',
        costUsd: 10,
      }));
    });

    it('should publish budget.exceeded when limit exceeded', async () => {
      const budget = makeBudget({ action: 'notify' });
      storage.listEnabledBudgetsByProject.mockResolvedValue([budget]);
      storage.listEnabledGlobalBudgets.mockResolvedValue([]);

      const refreshed = makeBudget({ currentSpendUsd: 120 });
      budgetsService.refreshBudgetSpend.mockResolvedValue(refreshed);
      budgetsService.computeStatus.mockReturnValue({
        budget: refreshed,
        percentUsed: 120,
        remainingUsd: 0,
        isThresholdExceeded: true,
        isLimitExceeded: true,
      });
      budgetsService.computeWindowStart.mockReturnValue('2025-01-01T00:00:00.000Z');

      await service.onCostRecorded(costPayload);

      expect(eventsService.publish).toHaveBeenCalledWith('budget.exceeded', expect.objectContaining({
        budgetId: 'budget-1',
        currentSpendUsd: 120,
        action: 'notify',
      }));
    });

    it('should publish budget.threshold_exceeded when threshold crossed but not limit', async () => {
      const budget = makeBudget({ thresholdPercent: 80 });
      storage.listEnabledBudgetsByProject.mockResolvedValue([budget]);
      storage.listEnabledGlobalBudgets.mockResolvedValue([]);

      const refreshed = makeBudget({ currentSpendUsd: 85 });
      budgetsService.refreshBudgetSpend.mockResolvedValue(refreshed);
      budgetsService.computeStatus.mockReturnValue({
        budget: refreshed,
        percentUsed: 85,
        remainingUsd: 15,
        isThresholdExceeded: true,
        isLimitExceeded: false,
      });
      budgetsService.computeWindowStart.mockReturnValue('2025-01-01T00:00:00.000Z');

      await service.onCostRecorded(costPayload);

      expect(eventsService.publish).toHaveBeenCalledWith('budget.threshold_exceeded', expect.objectContaining({
        budgetId: 'budget-1',
        thresholdPercent: 80,
      }));
    });

    it('should not publish events when under threshold', async () => {
      const budget = makeBudget();
      storage.listEnabledBudgetsByProject.mockResolvedValue([budget]);
      storage.listEnabledGlobalBudgets.mockResolvedValue([]);

      const refreshed = makeBudget({ currentSpendUsd: 30 });
      budgetsService.refreshBudgetSpend.mockResolvedValue(refreshed);
      budgetsService.computeStatus.mockReturnValue({
        budget: refreshed,
        percentUsed: 30,
        remainingUsd: 70,
        isThresholdExceeded: false,
        isLimitExceeded: false,
      });
      budgetsService.computeWindowStart.mockReturnValue('2025-01-01T00:00:00.000Z');

      await service.onCostRecorded(costPayload);

      expect(eventsService.publish).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      storage.listEnabledBudgetsByProject.mockRejectedValue(new Error('DB error'));

      await expect(service.onCostRecorded(costPayload)).resolves.toBeUndefined();
    });
  });

  describe('onModuleDestroy', () => {
    it('should clear interval', () => {
      jest.useFakeTimers();
      const svc = new BudgetEvaluatorService(
        storage as unknown as StorageService,
        budgetsService as unknown as BudgetsService,
        eventsService as any,
        sessionsService as any,
      );
      svc.onModuleInit();

      svc.onModuleDestroy();

      jest.advanceTimersByTime(60_000);
      expect(storage.listBudgets).not.toHaveBeenCalled();

      jest.useRealTimers();
    });
  });
});
