import { z } from 'zod';

/**
 * Canonical normalized AskUserQuestion shape — the ONLY representation that
 * leaves the backend (store + broadcast). Raw `tool_input` is never forwarded,
 * so future Claude tool fields cannot leak to clients.
 */
export const askUserQuestionOptionSchema = z.object({
  label: z.string().min(1),
  description: z.string(),
});

export const askUserQuestionSchema = z.object({
  question: z.string().min(1),
  header: z.string().min(1),
  multiSelect: z.boolean(),
  options: z.array(askUserQuestionOptionSchema).min(1),
});

export type NormalizedAskUserQuestionOption = z.infer<typeof askUserQuestionOptionSchema>;
export type NormalizedAskUserQuestion = z.infer<typeof askUserQuestionSchema>;

/**
 * Published when a PreToolUse(AskUserQuestion) hook fires — i.e. a question is
 * pending and the picker is (about to be) blocking. Carries normalized
 * questions only.
 */
export const claudeHooksAskUserQuestionPendingEvent = {
  name: 'claude.hooks.ask_user_question.pending',
  schema: z.object({
    projectId: z.string().uuid(),
    agentId: z.string().uuid().nullable(),
    sessionId: z.string().uuid().nullable(),
    claudeSessionId: z.string().min(1),
    toolUseId: z.string().min(1),
    questions: z.array(askUserQuestionSchema).min(1),
    createdAt: z.number(),
    expiresAt: z.number(),
  }),
} as const;

export type ClaudeHooksAskUserQuestionPendingEventPayload = z.infer<
  typeof claudeHooksAskUserQuestionPendingEvent.schema
>;
