import { z } from 'zod';

/**
 * Incoming hook event payload from the relay script.
 * The relay script augments Claude Code's hook JSON with env-derived fields.
 *
 * `hookEventName` is the discriminator. Three variants are accepted:
 *  - `SessionStart`  — unchanged; requires `source`.
 *  - `PreToolUse`    — matched to `AskUserQuestion`; carries the pending questions.
 *  - `PostToolUse`   — matched to `AskUserQuestion`; reconciliation (resolved).
 *
 * Each variant is `.strict()`: unknown keys are rejected. SessionStart is
 * byte-for-byte backward compatible with the prior flat schema.
 */

/** Fields injected by the relay script from DEVCHAIN_* env vars + Claude session id. */
const injectedFields = {
  /** Claude Code session ID */
  claudeSessionId: z.string().min(1),
  /** tmux session name where Claude is running */
  tmuxSessionName: z.string().min(1),
  /** DevChain project UUID */
  projectId: z.string().uuid(),
  /** DevChain agent UUID (nullable if not associated) */
  agentId: z.string().uuid().nullable(),
  /** DevChain session UUID (nullable — may not exist yet at hook time) */
  sessionId: z.string().uuid().nullable(),
} as const;

/** Optional Claude-provided metadata shared by all variants. */
const claudeMetaFields = {
  /** Model name (varies across Claude Code versions) */
  model: z.string().max(200).optional(),
  /** Permission mode (e.g. "default", "plan") */
  permissionMode: z.string().max(100).optional(),
  /** Transcript file path */
  transcriptPath: z.string().max(1000).optional(),
} as const;

export const SessionStartHookSchema = z
  .object({
    hookEventName: z.literal('SessionStart'),
    /** Session source — how the session was initiated. Known values: "startup" | "resume" | "clear" | "compact". */
    source: z.string().min(1),
    ...claudeMetaFields,
    ...injectedFields,
  })
  .strict();

export const PreToolUseHookSchema = z
  .object({
    hookEventName: z.literal('PreToolUse'),
    /** Tool about to run (relay matcher restricts this to "AskUserQuestion"). */
    toolName: z.string().min(1),
    /** Raw tool input object — forwarded with --argjson so the questions OBJECT is preserved. */
    toolInput: z.record(z.unknown()),
    /** Claude tool-use id correlating Pre/Post for the same call. */
    toolUseId: z.string().min(1),
    ...claudeMetaFields,
    ...injectedFields,
  })
  .strict();

export const PostToolUseHookSchema = z
  .object({
    hookEventName: z.literal('PostToolUse'),
    toolName: z.string().min(1),
    toolInput: z.record(z.unknown()),
    toolUseId: z.string().min(1),
    /** Tool response — string or object; relay size-caps large values. */
    toolResponse: z.union([z.string(), z.record(z.unknown())]).optional(),
    ...claudeMetaFields,
    ...injectedFields,
  })
  .strict();

export const HookEventSchema = z.discriminatedUnion('hookEventName', [
  SessionStartHookSchema,
  PreToolUseHookSchema,
  PostToolUseHookSchema,
]);

export type SessionStartHookEvent = z.infer<typeof SessionStartHookSchema>;
export type PreToolUseHookEvent = z.infer<typeof PreToolUseHookSchema>;
export type PostToolUseHookEvent = z.infer<typeof PostToolUseHookSchema>;
export type HookEventData = z.infer<typeof HookEventSchema>;

/**
 * Response shape returned to the relay script.
 * Extensible — future enrichments add fields to `data`.
 */
export interface HookEventResponse {
  ok: boolean;
  handled: boolean;
  data: Record<string, unknown>;
}
