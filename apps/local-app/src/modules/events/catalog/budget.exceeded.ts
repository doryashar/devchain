import { z } from 'zod';

export const budgetExceededEvent = {
  name: 'budget.exceeded',
  schema: z.object({
    budgetId: z.string().min(1),
    projectId: z.string().min(1).nullable(),
    budgetName: z.string().min(1),
    currentSpendUsd: z.number(),
    limitUsd: z.number(),
    action: z.enum(['notify', 'block', 'kill']),
  }),
} as const;
