import { z } from 'zod';

/**
 * Published when a PostToolUse(AskUserQuestion) hook fires — the terminal
 * "answered in the TUI" reconciliation case. The pending entry (if any) is
 * cleared from the store before this is emitted.
 */
export const claudeHooksAskUserQuestionResolvedEvent = {
  name: 'claude.hooks.ask_user_question.resolved',
  schema: z.object({
    projectId: z.string().uuid(),
    sessionId: z.string().uuid().nullable(),
    toolUseId: z.string().min(1),
  }),
} as const;

export type ClaudeHooksAskUserQuestionResolvedEventPayload = z.infer<
  typeof claudeHooksAskUserQuestionResolvedEvent.schema
>;
