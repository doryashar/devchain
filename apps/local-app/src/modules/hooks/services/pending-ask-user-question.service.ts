import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { createLogger } from '../../../common/logging/logger';
import type { NormalizedAskUserQuestion } from '../../events/catalog/claude.hooks.ask_user_question.pending';

const logger = createLogger('PendingAskUserQuestionService');

/** Pending entries live at most ~30min before being treated as stale. */
export const PENDING_ASK_QUESTION_TTL_MS = 30 * 60 * 1000;

export interface PendingAskUserQuestionEntry {
  projectId: string;
  agentId: string | null;
  sessionId: string;
  claudeSessionId: string;
  toolUseId: string;
  questions: NormalizedAskUserQuestion[];
  createdAt: number;
  expiresAt: number;
  status: 'pending';
}

export interface SetPendingAskUserQuestionInput {
  projectId: string;
  agentId: string | null;
  sessionId: string;
  claudeSessionId: string;
  toolUseId: string;
  questions: NormalizedAskUserQuestion[];
  /** Injectable clock for deterministic tests. Defaults to Date.now(). */
  now?: number;
}

/**
 * In-memory store of pending AskUserQuestion calls, keyed by
 * `{sessionId, toolUseId}`. NOT persisted: a restart kills the Claude session,
 * so a persisted row would be zombie state. Runtime cardinality is ≤1 per
 * session (the agent is blocked single-threaded while the picker is open).
 *
 * Entries are cleared on PostToolUse (terminal answer), on TTL expiry, and on
 * `session.stopped` / `session.crashed`.
 */
@Injectable()
export class PendingAskUserQuestionService {
  private readonly entries = new Map<string, PendingAskUserQuestionEntry>();

  private key(sessionId: string, toolUseId: string): string {
    return `${sessionId}::${toolUseId}`;
  }

  set(input: SetPendingAskUserQuestionInput): PendingAskUserQuestionEntry {
    const now = input.now ?? Date.now();
    this.prune(now);
    const entry: PendingAskUserQuestionEntry = {
      projectId: input.projectId,
      agentId: input.agentId,
      sessionId: input.sessionId,
      claudeSessionId: input.claudeSessionId,
      toolUseId: input.toolUseId,
      questions: input.questions,
      createdAt: now,
      expiresAt: now + PENDING_ASK_QUESTION_TTL_MS,
      status: 'pending',
    };
    this.entries.set(this.key(input.sessionId, input.toolUseId), entry);
    return entry;
  }

  /** Non-expired pending entries for a DevChain session (the mobile poll source). */
  getBySession(sessionId: string, now: number = Date.now()): PendingAskUserQuestionEntry[] {
    this.prune(now);
    const result: PendingAskUserQuestionEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.sessionId === sessionId) {
        result.push(entry);
      }
    }
    return result;
  }

  clearByToolUseId(sessionId: string, toolUseId: string): boolean {
    return this.entries.delete(this.key(sessionId, toolUseId));
  }

  clearBySession(sessionId: string): number {
    let cleared = 0;
    for (const [key, entry] of this.entries) {
      if (entry.sessionId === sessionId) {
        this.entries.delete(key);
        cleared += 1;
      }
    }
    return cleared;
  }

  /** Test/observability helper — total live entries after pruning. */
  size(now: number = Date.now()): number {
    this.prune(now);
    return this.entries.size;
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }

  @OnEvent('session.stopped', { async: true })
  onSessionStopped(payload: { sessionId: string }): void {
    const cleared = this.clearBySession(payload.sessionId);
    if (cleared > 0) {
      logger.info(
        { sessionId: payload.sessionId, cleared },
        'Cleared pending AskUserQuestion entries on session stop',
      );
    }
  }

  @OnEvent('session.crashed', { async: true })
  onSessionCrashed(payload: { sessionId: string }): void {
    const cleared = this.clearBySession(payload.sessionId);
    if (cleared > 0) {
      logger.info(
        { sessionId: payload.sessionId, cleared },
        'Cleared pending AskUserQuestion entries on session crash',
      );
    }
  }
}
