import { Injectable, Logger } from '@nestjs/common';
import { ConflictError } from '../../../common/errors/error-types';
import { SessionRuntime } from './session-runtime';
import { SessionsService } from './sessions.service';
import type { SessionDetailDto, SessionDto, SessionHistoryResponseDto } from '../dtos/sessions.dto';

/**
 * Narrow facade over the session lifecycle primitives needed by mobile chat:
 * explicit launch, atomic restart (terminate + launch), restore, and terminate.
 *
 * Exists so the cloud tunnel can drive lifecycle without importing the broad
 * `SessionsModule` (heavy session/terminal graph) — the same narrow-facade
 * pattern the seam uses for reads/delivery. Per-agent serialization is preserved
 * by the underlying launch/restore pipelines' internal `withAgentLock`.
 */
@Injectable()
export class SessionLifecycleFacade {
  private readonly logger = new Logger(SessionLifecycleFacade.name);

  constructor(
    private readonly sessionRuntime: SessionRuntime,
    private readonly sessionsService: SessionsService,
  ) {}

  /** Launch a new independent session for an agent. */
  async launch(agentId: string, projectId: string): Promise<SessionDetailDto> {
    return this.sessionRuntime.launch({ agentId, projectId });
  }

  /**
   * Atomic restart: terminate the agent's current session (best-effort, mirrors
   * the web `restartAgent` semantics) then launch a fresh one. The launch
   * pipeline serializes via its internal per-agent lock — no outer lock here
   * (which would deadlock the non-reentrant lock).
   */
  async restart(agentId: string, projectId: string): Promise<SessionDetailDto> {
    const activeSessions = await this.sessionsService.listActiveSessions(projectId);
    const existing = activeSessions.find((s) => s.agentId === agentId);
    if (existing) {
      try {
        await this.sessionsService.terminateSession(existing.id);
      } catch (error) {
        // Non-fatal: launch below will surface a hard failure if the stale
        // session blocks it; we don't want a terminate hiccup to abort restart.
        this.logger.warn(
          {
            agentId,
            sessionId: existing.id,
            error: error instanceof Error ? error.message : error,
          },
          'Restart: failed to terminate existing session before relaunch',
        );
      }
    }
    return this.sessionRuntime.launch({ agentId, projectId });
  }

  /** Restore a stopped/failed session (provider-session-id replay). */
  async restore(sessionId: string, projectId: string): Promise<SessionDetailDto> {
    return this.sessionRuntime.restore(sessionId, projectId);
  }

  /** Terminate a session. Idempotent: missing/already-stopped is treated as success. */
  async terminate(sessionId: string): Promise<void> {
    return this.sessionsService.terminateSession(sessionId);
  }

  /**
   * Paginated history of an agent's stopped/failed sessions. Project scoping is
   * enforced inside `getAgentSessionHistory` (agent.projectId mismatch → throws).
   */
  async listAgentHistory(
    agentId: string,
    projectId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<SessionHistoryResponseDto> {
    return this.sessionsService.getAgentSessionHistory(agentId, projectId, cursor, limit);
  }

  /**
   * Record-only delete (DB row + chat invites; transcript file preserved). Runs
   * the shared `validateSessionInProject` guard (NotFound / Forbidden), then adds
   * the running-status check on top so a live session is never dropped
   * (ConflictError code `STATUS_RUNNING`).
   */
  async deleteSessionRecord(sessionId: string, projectId: string): Promise<{ deleted: boolean }> {
    const session = await this.sessionsService.validateSessionInProject(sessionId, projectId);
    if (session.status === 'running') {
      throw new ConflictError('Cannot delete a running session', {
        code: 'STATUS_RUNNING',
        sessionId,
      });
    }
    return this.sessionsService.hardDeleteRecord(sessionId);
  }

  /**
   * Rename (or clear, on null/empty) a session name after the shared
   * `validateSessionInProject` guard. `updateName` trims + enforces max 120.
   */
  async renameSession(
    sessionId: string,
    projectId: string,
    name: string | null,
  ): Promise<SessionDto> {
    await this.sessionsService.validateSessionInProject(sessionId, projectId);
    return this.sessionsService.updateName(sessionId, name);
  }
}
