import { CreateBudgetSchema, UpdateBudgetSchema, ToggleBudgetSchema } from './budget.dto';

describe('Budget DTOs', () => {
  describe('CreateBudgetSchema', () => {
    it('should validate a valid project-scoped budget', () => {
      const result = CreateBudgetSchema.safeParse({
        scope: 'project',
        projectId: '550e8400-e29b-41d4-a716-446655440000',
        name: 'My Budget',
        limitUsd: 100,
        period: 'monthly',
      });

      expect(result.success).toBe(true);
    });

    it('should validate a valid global budget without projectId', () => {
      const result = CreateBudgetSchema.safeParse({
        scope: 'global',
        name: 'Global Budget',
        limitUsd: 500,
        period: 'weekly',
      });

      expect(result.success).toBe(true);
    });

    it('should reject project-scoped budget without projectId', () => {
      const result = CreateBudgetSchema.safeParse({
        scope: 'project',
        name: 'No Project Budget',
        limitUsd: 100,
        period: 'monthly',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path.includes('projectId'));
        expect(issue).toBeDefined();
      }
    });

    it('should apply default values', () => {
      const result = CreateBudgetSchema.safeParse({
        scope: 'global',
        name: 'Defaults',
        limitUsd: 100,
        period: 'daily',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.enabled).toBe(true);
        expect(result.data.action).toBe('notify');
        expect(result.data.thresholdPercent).toBe(80);
      }
    });

    it('should reject invalid scope', () => {
      const result = CreateBudgetSchema.safeParse({
        scope: 'team',
        name: 'Bad',
        limitUsd: 100,
        period: 'monthly',
      });

      expect(result.success).toBe(false);
    });

    it('should reject negative limitUsd', () => {
      const result = CreateBudgetSchema.safeParse({
        scope: 'global',
        name: 'Bad',
        limitUsd: -10,
        period: 'monthly',
      });

      expect(result.success).toBe(false);
    });

    it('should reject limitUsd over 1000000', () => {
      const result = CreateBudgetSchema.safeParse({
        scope: 'global',
        name: 'Big',
        limitUsd: 2000000,
        period: 'monthly',
      });

      expect(result.success).toBe(false);
    });

    it('should reject invalid period', () => {
      const result = CreateBudgetSchema.safeParse({
        scope: 'global',
        name: 'Bad',
        limitUsd: 100,
        period: 'yearly',
      });

      expect(result.success).toBe(false);
    });

    it('should reject empty name', () => {
      const result = CreateBudgetSchema.safeParse({
        scope: 'global',
        name: '',
        limitUsd: 100,
        period: 'monthly',
      });

      expect(result.success).toBe(false);
    });

    it('should reject name over 100 chars', () => {
      const result = CreateBudgetSchema.safeParse({
        scope: 'global',
        name: 'x'.repeat(101),
        limitUsd: 100,
        period: 'monthly',
      });

      expect(result.success).toBe(false);
    });

    it('should reject invalid action', () => {
      const result = CreateBudgetSchema.safeParse({
        scope: 'global',
        name: 'Bad',
        limitUsd: 100,
        period: 'monthly',
        action: 'destroy',
      });

      expect(result.success).toBe(false);
    });

    it('should reject thresholdPercent out of range', () => {
      const result = CreateBudgetSchema.safeParse({
        scope: 'global',
        name: 'Bad',
        limitUsd: 100,
        period: 'monthly',
        thresholdPercent: 0,
      });

      expect(result.success).toBe(false);
    });
  });

  describe('UpdateBudgetSchema', () => {
    it('should allow partial updates', () => {
      const result = UpdateBudgetSchema.safeParse({ name: 'Updated' });
      expect(result.success).toBe(true);
    });

    it('should allow empty update', () => {
      const result = UpdateBudgetSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should reject invalid values', () => {
      const result = UpdateBudgetSchema.safeParse({ limitUsd: -5 });
      expect(result.success).toBe(false);
    });
  });

  describe('ToggleBudgetSchema', () => {
    it('should accept enabled: true', () => {
      const result = ToggleBudgetSchema.safeParse({ enabled: true });
      expect(result.success).toBe(true);
    });

    it('should accept enabled: false', () => {
      const result = ToggleBudgetSchema.safeParse({ enabled: false });
      expect(result.success).toBe(true);
    });

    it('should reject missing enabled', () => {
      const result = ToggleBudgetSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});
