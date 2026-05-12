import { BudgetsController } from './budgets.controller';
import type { BudgetsService } from '../services/budgets.service';
import type { Budget, SpendRecord, BudgetStatus } from '../../storage/models/domain.models';

describe('BudgetsController', () => {
  let budgetsService: { [K in keyof BudgetsService]: jest.Mock };
  let controller: BudgetsController;

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
      currentSpendUsd: 50,
      spendWindowStart: null,
      lastEvaluatedAt: null,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();

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

    controller = new BudgetsController(budgetsService as unknown as BudgetsService);
  });

  describe('listBudgets', () => {
    it('should return list of budget DTOs', async () => {
      budgetsService.listBudgets.mockResolvedValue([makeBudget()]);

      const result = await controller.listBudgets('project', 'proj-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('budget-1');
      expect(result[0].percentUsed).toBe(50);
      expect(result[0].remainingUsd).toBe(50);
    });
  });

  describe('getBudget', () => {
    it('should return budget with status', async () => {
      const budget = makeBudget();
      budgetsService.getBudgetStatus.mockResolvedValue({
        budget,
        percentUsed: 50,
        remainingUsd: 50,
        isThresholdExceeded: false,
        isLimitExceeded: false,
      } as BudgetStatus);

      const result = await controller.getBudget('budget-1');

      expect(result.id).toBe('budget-1');
    });
  });

  describe('createBudget', () => {
    it('should create and return budget', async () => {
      const created = makeBudget();
      budgetsService.createBudget.mockResolvedValue(created);

      const result = await controller.createBudget({
        scope: 'project',
        projectId: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Test',
        limitUsd: 100,
        period: 'monthly',
      });

      expect(result.id).toBe('budget-1');
    });

    it('should reject invalid input', async () => {
      await expect(
        controller.createBudget({ scope: 'bad' }),
      ).rejects.toThrow();
    });
  });

  describe('updateBudget', () => {
    it('should update and return budget', async () => {
      budgetsService.updateBudget.mockResolvedValue(makeBudget({ name: 'Updated' }));

      const result = await controller.updateBudget('budget-1', { name: 'Updated' });

      expect(result.name).toBe('Updated');
    });
  });

  describe('deleteBudget', () => {
    it('should delete budget', async () => {
      budgetsService.deleteBudget.mockResolvedValue(undefined);

      await controller.deleteBudget('budget-1');

      expect(budgetsService.deleteBudget).toHaveBeenCalledWith('budget-1');
    });
  });

  describe('toggleBudget', () => {
    it('should toggle and return budget', async () => {
      budgetsService.toggleBudget.mockResolvedValue(makeBudget({ enabled: false }));

      const result = await controller.toggleBudget('budget-1', { enabled: false });

      expect(budgetsService.toggleBudget).toHaveBeenCalledWith('budget-1', false);
    });
  });

  describe('listSpend', () => {
    it('should return spend records', async () => {
      const record: SpendRecord = {
        id: 'sr-1',
        budgetId: 'budget-1',
        sessionId: 'sess-1',
        projectId: 'proj-1',
        agentId: 'agent-1',
        model: 'claude-3-opus',
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: 0.5,
        periodStart: '2025-01-01T00:00:00.000Z',
        recordedAt: '2025-01-15T00:00:00.000Z',
      };
      budgetsService.listSpendRecords.mockResolvedValue([record]);

      const result = await controller.listSpend('budget-1');

      expect(result).toHaveLength(1);
      expect(result[0].costUsd).toBe(0.5);
    });
  });

  describe('getSummary', () => {
    it('should return summary for project', async () => {
      const budget = makeBudget();
      budgetsService.listBudgetStatusesForProject.mockResolvedValue([{
        budget,
        percentUsed: 50,
        remainingUsd: 50,
        isThresholdExceeded: false,
        isLimitExceeded: false,
      } as BudgetStatus]);
      budgetsService.computeWindowStart.mockReturnValue('2025-01-01T00:00:00.000Z');

      const result = await controller.getSummary('proj-1');

      expect(result).toHaveLength(1);
      expect(result[0].projectId).toBe('proj-1');
    });

    it('should reject missing projectId', async () => {
      await expect(controller.getSummary(undefined)).rejects.toThrow('projectId');
    });
  });
});
