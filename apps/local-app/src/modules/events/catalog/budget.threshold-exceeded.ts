import { z } from 'zod';

export const budgetThresholdExceededEvent = {
  name: 'budget.threshold_exceeded',
  schema: z.object({
    budgetId: z.string().min(1),
    projectId: z.string().min(1).nullable(),
    budgetName: z.string().min(1),
    currentSpendUsd: z.number(),
    limitUsd: z.number(),
    thresholdPercent: z.number(),
  }),
} as const;
