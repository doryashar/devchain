import { BudgetsService } from './budgets.service';
import type { BudgetStorage } from '../storage/interfaces/storage.interface';
import type { Budget, CreateBudget, BudgetStatus } from '../storage/models/domain.models';

describe('BudgetsService', () => {
  let storage: { [K in keyof BudgetStorage]: jest.Mock };
  let service: BudgetsService;

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
    service = new BudgetsService(storage as unknown as BudgetStorage);
  });

  describe('listBudgets', () => {
    it('should delegate to storage', async () => {
      const budgets = [makeBudget()];
      storage.listBudgets.mockResolvedValue(budgets);

      const result = await service.listBudgets('project', 'proj-1');

      expect(result).toEqual(budgets);
      expect(storage.listBudgets).toHaveBeenCalledWith('project', 'proj-1');
    });
  });

  describe('getBudget', () => {
    it('should return budget when found', async () => {
      const budget = makeBudget();
      storage.getBudget.mockResolvedValue(budget);

      const result = await service.getBudget('budget-1');

      expect(result).toEqual(budget);
    });

    it('should throw NotFoundException when not found', async () => {
      storage.getBudget.mockResolvedValue(null);

      await expect(service.getBudget('missing')).rejects.toThrow('Budget not found: missing');
    });
  });

  describe('createBudget', () => {
    it('should delegate to storage', async () => {
      const data: CreateBudget = {
        scope: 'project',
        projectId: 'proj-1',
        name: 'New Budget',
        description: null,
        enabled: true,
        limitUsd: 50,
        period: 'weekly',
        periodStartDate: null,
        action: 'block',
        thresholdPercent: 90,
      };
      const created = makeBudget(data);
      storage.createBudget.mockResolvedValue(created);

      const result = await service.createBudget(data);

      expect(result).toEqual(created);
      expect(storage.createBudget).toHaveBeenCalledWith(data);
    });
  });

  describe('updateBudget', () => {
    it('should check existence then update', async () => {
      const existing = makeBudget();
      storage.getBudget.mockResolvedValue(existing);
      const updated = makeBudget({ name: 'Updated' });
      storage.updateBudget.mockResolvedValue(updated);

      const result = await service.updateBudget('budget-1', { name: 'Updated' });

      expect(result).toEqual(updated);
      expect(storage.getBudget).toHaveBeenCalledWith('budget-1');
      expect(storage.updateBudget).toHaveBeenCalledWith('budget-1', { name: 'Updated' });
    });

    it('should throw if budget not found', async () => {
      storage.getBudget.mockResolvedValue(null);

      await expect(service.updateBudget('missing', { name: 'X' })).rejects.toThrow();
    });
  });

  describe('deleteBudget', () => {
    it('should check existence then delete', async () => {
      storage.getBudget.mockResolvedValue(makeBudget());

      await service.deleteBudget('budget-1');

      expect(storage.deleteBudget).toHaveBeenCalledWith('budget-1');
    });
  });

  describe('toggleBudget', () => {
    it('should update enabled field', async () => {
      storage.getBudget.mockResolvedValue(makeBudget());
      storage.updateBudget.mockResolvedValue(makeBudget({ enabled: false }));

      const result = await service.toggleBudget('budget-1', false);

      expect(storage.updateBudget).toHaveBeenCalledWith('budget-1', { enabled: false });
    });
  });

  describe('refreshBudgetSpend', () => {
    it('should compute spend for project budget', async () => {
      const budget = makeBudget({ scope: 'project', projectId: 'proj-1' });
      storage.getProjectSpend.mockResolvedValue(42.5);
      storage.updateBudget.mockResolvedValue(makeBudget({ currentSpendUsd: 42.5 }));

      const result = await service.refreshBudgetSpend(budget);

      expect(storage.getProjectSpend).toHaveBeenCalledWith('proj-1', expect.any(String));
      expect(storage.updateBudget).toHaveBeenCalledWith('budget-1', expect.objectContaining({
        currentSpendUsd: 42.5,
      }));
    });

    it('should compute spend for global budget', async () => {
      const budget = makeBudget({ scope: 'global', projectId: null });
      storage.getGlobalSpend.mockResolvedValue(99.9);
      storage.updateBudget.mockResolvedValue(makeBudget({ currentSpendUsd: 99.9 }));

      await service.refreshBudgetSpend(budget);

      expect(storage.getGlobalSpend).toHaveBeenCalledWith(expect.any(String));
    });

    it('should return 0 spend for project budget without projectId', async () => {
      const budget = makeBudget({ scope: 'project', projectId: null });
      storage.updateBudget.mockResolvedValue(makeBudget({ currentSpendUsd: 0 }));

      const result = await service.refreshBudgetSpend(budget);

      expect(storage.getProjectSpend).not.toHaveBeenCalled();
      expect(storage.getGlobalSpend).not.toHaveBeenCalled();
    });
  });

  describe('checkBudgetBlock', () => {
    it('should return blocked when budget exceeded', async () => {
      const budget = makeBudget({ action: 'block', limitUsd: 100 });
      storage.listEnabledBudgetsByProject.mockResolvedValue([budget]);
      storage.listEnabledGlobalBudgets.mockResolvedValue([]);
      storage.getProjectSpend.mockResolvedValue(150);
      storage.updateBudget.mockResolvedValue(makeBudget({ currentSpendUsd: 150 }));

      const result = await service.checkBudgetBlock('proj-1');

      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('Budget exceeded');
    });

    it('should return not blocked when under limit', async () => {
      const budget = makeBudget({ action: 'block', limitUsd: 100 });
      storage.listEnabledBudgetsByProject.mockResolvedValue([budget]);
      storage.listEnabledGlobalBudgets.mockResolvedValue([]);
      storage.getProjectSpend.mockResolvedValue(50);
      storage.updateBudget.mockResolvedValue(makeBudget({ currentSpendUsd: 50 }));

      const result = await service.checkBudgetBlock('proj-1');

      expect(result.blocked).toBe(false);
    });

    it('should skip non-block budgets', async () => {
      const budget = makeBudget({ action: 'notify', limitUsd: 100 });
      storage.listEnabledBudgetsByProject.mockResolvedValue([budget]);
      storage.listEnabledGlobalBudgets.mockResolvedValue([]);

      const result = await service.checkBudgetBlock('proj-1');

      expect(result.blocked).toBe(false);
      expect(storage.getProjectSpend).not.toHaveBeenCalled();
    });

    it('should check global budgets too', async () => {
      const globalBudget = makeBudget({ scope: 'global', projectId: null, action: 'block', limitUsd: 500 });
      storage.listEnabledBudgetsByProject.mockResolvedValue([]);
      storage.listEnabledGlobalBudgets.mockResolvedValue([globalBudget]);
      storage.getGlobalSpend.mockResolvedValue(600);
      storage.updateBudget.mockResolvedValue(makeBudget({ currentSpendUsd: 600 }));

      const result = await service.checkBudgetBlock('proj-1');

      expect(result.blocked).toBe(true);
    });
  });

  describe('listBudgetStatusesForProject', () => {
    it('should return statuses for project and global budgets', async () => {
      const projectBudget = makeBudget({ limitUsd: 100 });
      const globalBudget = makeBudget({ id: 'budget-2', scope: 'global', projectId: null, limitUsd: 500 });
      storage.listEnabledBudgetsByProject.mockResolvedValue([projectBudget]);
      storage.listEnabledGlobalBudgets.mockResolvedValue([globalBudget]);
      storage.getProjectSpend.mockResolvedValue(50);
      storage.getGlobalSpend.mockResolvedValue(200);
      storage.updateBudget.mockImplementation(async (id: string) => {
        if (id === 'budget-1') return makeBudget({ currentSpendUsd: 50 });
        return makeBudget({ id: 'budget-2', scope: 'global', projectId: null, limitUsd: 500, currentSpendUsd: 200 });
      });

      const results = await service.listBudgetStatusesForProject('proj-1');

      expect(results).toHaveLength(2);
      expect(results[0].percentUsed).toBe(50);
      expect(results[1].percentUsed).toBe(40);
    });
  });

  describe('computeStatus', () => {
    it('should compute correct status', () => {
      const budget = makeBudget({ limitUsd: 200, currentSpendUsd: 100, thresholdPercent: 80 });

      const status = service.computeStatus(budget);

      expect(status.percentUsed).toBe(50);
      expect(status.remainingUsd).toBe(100);
      expect(status.isThresholdExceeded).toBe(false);
      expect(status.isLimitExceeded).toBe(false);
    });

    it('should detect threshold exceeded', () => {
      const budget = makeBudget({ limitUsd: 100, currentSpendUsd: 85, thresholdPercent: 80 });

      const status = service.computeStatus(budget);

      expect(status.isThresholdExceeded).toBe(true);
      expect(status.isLimitExceeded).toBe(false);
    });

    it('should detect limit exceeded', () => {
      const budget = makeBudget({ limitUsd: 100, currentSpendUsd: 100 });

      const status = service.computeStatus(budget);

      expect(status.isLimitExceeded).toBe(true);
    });
  });

  describe('computeWindowStart', () => {
    it('should compute daily window start', () => {
      const budget = makeBudget({ period: 'daily' });
      const result = service.computeWindowStart(budget);
      const d = new Date(result);
      expect(d.getHours()).toBe(0);
      expect(d.getMinutes()).toBe(0);
    });

    it('should compute weekly window start (Sunday)', () => {
      const budget = makeBudget({ period: 'weekly' });
      const result = service.computeWindowStart(budget);
      const d = new Date(result);
      expect(d.getDay()).toBe(0);
      expect(d.getHours()).toBe(0);
    });

    it('should compute monthly window start', () => {
      const budget = makeBudget({ period: 'monthly' });
      const result = service.computeWindowStart(budget);
      const d = new Date(result);
      expect(d.getDate()).toBe(1);
    });

    it('should compute lifetime window start as epoch', () => {
      const budget = makeBudget({ period: 'lifetime' });
      const result = service.computeWindowStart(budget);
      expect(new Date(result).getTime()).toBe(0);
    });
  });
});
