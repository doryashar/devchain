import { Inject, Injectable } from '@nestjs/common';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { DB_CONNECTION } from '../../storage/db/db.provider';
import { getRawSqliteClient } from '../../storage/db/sqlite-raw';
import type { ActiveSessionInfo } from '../dtos/active-session-info.dto';

interface ActiveSessionRow {
  id: string;
  agent_id: string;
  project_id: string;
  tmux_session_id: string | null;
  status: 'running';
  started_at: string;
  last_activity_at: string | null;
  activity_state: 'idle' | 'busy' | null;
  name: string | null;
}

@Injectable()
export class ActiveSessionLookup {
  private readonly sqlite: ReturnType<typeof getRawSqliteClient>;

  constructor(@Inject(DB_CONNECTION) db: BetterSQLite3Database) {
    this.sqlite = getRawSqliteClient(db);
  }

  async getActiveSession(agentId: string, projectId: string): Promise<ActiveSessionInfo | null> {
    const row = this.sqlite
      .prepare(
        `
        SELECT s.id, s.agent_id, a.project_id, s.tmux_session_id, s.status,
               s.started_at, s.last_activity_at, s.activity_state, s.name
        FROM sessions s
        JOIN agents a ON s.agent_id = a.id
        WHERE s.status = 'running' AND s.agent_id = ? AND a.project_id = ?
        ORDER BY s.started_at DESC
        LIMIT 1
      `,
      )
      .get(agentId, projectId) as ActiveSessionRow | undefined;

    return row ? this.toActiveSessionInfo(row) : null;
  }

  /**
   * Resolve a session's owning project via `session → agent → project`,
   * regardless of session status (running OR ended) — ownership applies to
   * historical transcripts too. Returns null when the session does not exist.
   *
   * Used to enforce project scoping on session-ID-centric reads (e.g. mobile
   * chat transcript RPCs) so a caller cannot read another project's session by
   * guessing its id.
   */
  async getSessionProjectScope(
    sessionId: string,
  ): Promise<{ sessionId: string; agentId: string | null; projectId: string } | null> {
    const row = this.sqlite
      .prepare(
        `
        SELECT s.id, s.agent_id, a.project_id
        FROM sessions s
        JOIN agents a ON s.agent_id = a.id
        WHERE s.id = ?
        LIMIT 1
      `,
      )
      .get(sessionId) as { id: string; agent_id: string | null; project_id: string } | undefined;

    return row ? { sessionId: row.id, agentId: row.agent_id, projectId: row.project_id } : null;
  }

  async listActiveSessions(projectId: string): Promise<ActiveSessionInfo[]> {
    const rows = this.sqlite
      .prepare(
        `
        SELECT s.id, s.agent_id, a.project_id, s.tmux_session_id, s.status,
               s.started_at, s.last_activity_at, s.activity_state, s.name
        FROM sessions s
        JOIN agents a ON s.agent_id = a.id
        WHERE s.status = 'running' AND a.project_id = ?
        ORDER BY s.started_at DESC
      `,
      )
      .all(projectId) as ActiveSessionRow[];

    return rows.map((row) => this.toActiveSessionInfo(row));
  }

  private toActiveSessionInfo(row: ActiveSessionRow): ActiveSessionInfo {
    return {
      sessionId: row.id,
      agentId: row.agent_id,
      projectId: row.project_id,
      status: row.status,
      tmuxSessionId: row.tmux_session_id,
      startedAt: row.started_at,
      lastActivityAt: row.last_activity_at,
      activityState: row.activity_state,
      name: row.name,
    };
  }
}
