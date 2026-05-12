import { z } from 'zod';

export const sessionCostRecordedEvent = {
  name: 'session.cost_recorded',
  schema: z.object({
    sessionId: z.string().min(1),
    agentId: z.string().min(1).nullable(),
    projectId: z.string().min(1),
    costUsd: z.number(),
    inputTokens: z.number().nullable(),
    outputTokens: z.number().nullable(),
    primaryModel: z.string().nullable(),
  }),
} as const;
