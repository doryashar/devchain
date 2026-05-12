import { z } from 'zod';

export const CreateBudgetSchema = z.object({
  scope: z.enum(['project', 'global']),
  projectId: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  enabled: z.boolean().optional().default(true),
  limitUsd: z.number().positive().max(1000000),
  period: z.enum(['daily', 'weekly', 'monthly', 'lifetime']),
  periodStartDate: z.string().optional().nullable(),
  action: z.enum(['notify', 'block', 'kill']).optional().default('notify'),
  thresholdPercent: z.number().int().min(1).max(100).optional().default(80),
}).refine(
  (data) => data.scope === 'global' || data.projectId,
  { message: 'projectId is required for project-scoped budgets', path: ['projectId'] },
);

export type CreateBudgetData = z.infer<typeof CreateBudgetSchema>;

export const UpdateBudgetSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  enabled: z.boolean().optional(),
  limitUsd: z.number().positive().max(1000000).optional(),
  period: z.enum(['daily', 'weekly', 'monthly', 'lifetime']).optional(),
  periodStartDate: z.string().optional().nullable(),
  action: z.enum(['notify', 'block', 'kill']).optional(),
  thresholdPercent: z.number().int().min(1).max(100).optional(),
});

export type UpdateBudgetData = z.infer<typeof UpdateBudgetSchema>;

export const ToggleBudgetSchema = z.object({
  enabled: z.boolean(),
});

export interface BudgetDto {
  id: string;
  scope: string;
  projectId: string | null;
  name: string;
  description: string | null;
  enabled: boolean;
  limitUsd: number;
  period: string;
  periodStartDate: string | null;
  action: string;
  thresholdPercent: number;
  currentSpendUsd: number;
  spendWindowStart: string | null;
  lastEvaluatedAt: string | null;
  percentUsed: number;
  remainingUsd: number;
  createdAt: string;
  updatedAt: string;
}

export interface SpendRecordDto {
  id: string;
  budgetId: string;
  sessionId: string | null;
  projectId: string;
  agentId: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number;
  periodStart: string;
  recordedAt: string;
}

export interface SpendSummaryDto {
  projectId: string;
  totalSpendUsd: number;
  period: string;
  since: string;
  byModel: Record<string, number>;
}
