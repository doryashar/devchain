import type { UnifiedMessage } from '../../dtos/unified-session.types';

/**
 * A unified message that is ONLY tool result(s) — the tool plumbing that follows an
 * assistant's `tool_use`, with no real user text. These are folded onto the preceding
 * assistant turn rather than counted as their own conversational message, so that
 * `metrics.messageCount` tracks conversational turns (cross-provider parity).
 *
 * A message carrying any real text block is NOT tool-result-only (left alone); a
 * compact-summary entry has no `toolResults` so it never matches.
 *
 * SHARED by the full-parse fold (`claude-jsonl.parser.ts`) and the incremental
 * cache-boundary fold (`session-cache.service.ts`) so both paths classify identically —
 * a single source of truth for the fold predicate.
 */
export function isToolResultOnlyMessage(msg: UnifiedMessage): boolean {
  return (
    msg.role === 'user' &&
    msg.toolResults.length > 0 &&
    !msg.content.some((block) => block.type === 'text')
  );
}
