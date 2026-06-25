import Database from 'better-sqlite3';

/**
 * Seeding + mutation helpers for a fixture OpenCode SQLite container.
 *
 * Replicates the OpenCode `session` / `message` / `part` (+ `project`) schema in
 * WAL mode so integration tests can drive the real reader/adapter/cache against a
 * deterministic temp DB — no real `opencode` install required. `data` columns are
 * opaque JSON blobs (mirroring production), so callers pass plain objects:
 *   - message `data`: `{ role: 'user' | 'assistant', modelID?, tokens?, parentID? }`
 *   - part `data`:    `{ type: 'text' | 'reasoning' | 'step-finish' | …, text?, … }`
 */

const SCHEMA_SQL = `
  CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT NOT NULL);
  CREATE TABLE session (
    id TEXT PRIMARY KEY, title TEXT, model TEXT, agent TEXT, parent_id TEXT,
    directory TEXT, project_id TEXT,
    time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL
  );
  CREATE TABLE message (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
    time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
  );
  CREATE TABLE part (
    id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL,
    time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
  );
  CREATE INDEX message_session_time_created_id_idx ON message (session_id, time_created, id);
  CREATE INDEX part_session_idx ON part (session_id);
  CREATE INDEX part_message_id_id_idx ON part (message_id, id);
`;

export interface SeedPart {
  /** Part id (ordering is by id within a message — keep these monotonic). */
  id: string;
  /** Opaque part payload, e.g. `{ type: 'text', text: 'hi' }`. */
  data: Record<string, unknown>;
  timeCreated?: number;
  timeUpdated?: number;
}

export interface SeedMessage {
  id: string;
  /** Opaque message payload, e.g. `{ role: 'assistant', modelID: 'glm-5.1' }`. */
  data: Record<string, unknown>;
  timeCreated: number;
  timeUpdated?: number;
  parts: SeedPart[];
}

export interface SeedSession {
  id: string;
  title?: string;
  model?: string | null;
  agent?: string;
  parentId?: string | null;
  /** Working directory recorded on the session (used by discovery). */
  directory?: string | null;
  projectId?: string | null;
  timeCreated?: number;
  timeUpdated?: number;
  messages: SeedMessage[];
}

export interface SeedProject {
  id: string;
  worktree: string;
}

type WritableDb = ReturnType<typeof Database>;

/** Open a writable WAL connection, run `fn`, and close it. */
export function withWritableOpencodeDb(dbPath: string, fn: (db: WritableDb) => void): void {
  const db = new Database(dbPath);
  try {
    db.pragma('journal_mode = WAL'); // match OpenCode; the reader must read WAL DBs
    fn(db);
  } finally {
    db.close();
  }
}

function insertSession(db: WritableDb, session: SeedSession): void {
  db.prepare(
    `INSERT INTO session (id, title, model, agent, parent_id, directory, project_id, time_created, time_updated)
     VALUES (@id, @title, @model, @agent, @parentId, @directory, @projectId, @timeCreated, @timeUpdated)`,
  ).run({
    id: session.id,
    title: session.title ?? 'Fixture session',
    model: session.model ?? 'glm-5.1',
    agent: session.agent ?? 'build',
    parentId: session.parentId ?? null,
    directory: session.directory ?? null,
    projectId: session.projectId ?? null,
    timeCreated: session.timeCreated ?? 1_000,
    timeUpdated: session.timeUpdated ?? session.timeCreated ?? 1_000,
  });

  const insMsg = db.prepare(
    `INSERT INTO message (id, session_id, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insPart = db.prepare(
    `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  for (const m of session.messages) {
    insMsg.run(
      m.id,
      session.id,
      m.timeCreated,
      m.timeUpdated ?? m.timeCreated,
      JSON.stringify(m.data),
    );
    for (const p of m.parts) {
      insPart.run(
        p.id,
        m.id,
        session.id,
        p.timeCreated ?? m.timeCreated,
        p.timeUpdated ?? p.timeCreated ?? m.timeCreated,
        JSON.stringify(p.data),
      );
    }
  }
}

/**
 * Create + seed a fixture OpenCode DB at `dbPath` (multiple sessions may share the
 * one container, mirroring production). Optionally seed `project` rows so the
 * discovery `project.worktree` join is exercisable.
 */
export function createOpencodeFixtureDb(
  dbPath: string,
  sessions: SeedSession[],
  projects: SeedProject[] = [],
): void {
  withWritableOpencodeDb(dbPath, (db) => {
    db.exec(SCHEMA_SQL);
    const insProject = db.prepare(`INSERT INTO project (id, worktree) VALUES (?, ?)`);
    for (const p of projects) insProject.run(p.id, p.worktree);
    for (const s of sessions) insertSession(db, s);
  });
}

/** Append a new part to an existing message (message count unchanged). */
export function appendPart(
  dbPath: string,
  args: { sessionId: string; messageId: string; part: SeedPart },
): void {
  withWritableOpencodeDb(dbPath, (db) => {
    db.prepare(
      `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      args.part.id,
      args.messageId,
      args.sessionId,
      args.part.timeCreated ?? args.part.timeUpdated ?? 0,
      args.part.timeUpdated ?? args.part.timeCreated ?? 0,
      JSON.stringify(args.part.data),
    );
  });
}

/** Mutate an existing part in place (e.g. streaming tool output / patch rewrite). */
export function updatePartInPlace(
  dbPath: string,
  args: { partId: string; data: Record<string, unknown>; timeUpdated: number },
): void {
  withWritableOpencodeDb(dbPath, (db) => {
    db.prepare(`UPDATE part SET data = ?, time_updated = ? WHERE id = ?`).run(
      JSON.stringify(args.data),
      args.timeUpdated,
      args.partId,
    );
  });
}
