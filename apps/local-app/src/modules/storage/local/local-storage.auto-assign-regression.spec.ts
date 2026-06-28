import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { join } from 'path';
import { LocalStorageService } from './local-storage.service';

/**
 * Regression test for epic_assignment_rules cascade on project delete.
 *
 * The `epic_assignment_rules.project_id` FK is declared `ON DELETE cascade`.
 * This verifies that `LocalStorageService.deleteProject` actually removes the
 * project's rules — either via the FK cascade or via explicit cleanup.
 *
 * Uses real in-memory SQLite with migrations applied — no mocks.
 */
describe('LocalStorageService — epic_assignment_rules cascade on project delete', () => {
  let sqlite: Database.Database;
  let db: BetterSQLite3Database;
  let service: LocalStorageService;
  let projectId: string;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    db = drizzle(sqlite);
    const migrationsFolder = join(__dirname, '../../../../drizzle');
    migrate(db, { migrationsFolder });
    service = new LocalStorageService(db);

    projectId = randomUUID();
    const now = new Date().toISOString();

    sqlite.exec(`
      INSERT INTO projects (id, name, description, root_path, created_at, updated_at)
      VALUES ('${projectId}', 'Test Project', NULL, '/tmp/test', '${now}', '${now}');
    `);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('removes rules when the project is deleted', async () => {
    await service.createEpicAssignmentRule({
      projectId,
      matchType: 'tag',
      statusId: null,
      tags: ['x'],
      targetType: 'agent',
      targetAgentId: 'a',
      targetTeamId: null,
      overrideExisting: false,
      priority: 0,
      enabled: true,
    });

    // Sanity: the rule exists before delete
    expect(await service.listEpicAssignmentRules(projectId)).toHaveLength(1);

    await service.deleteProject(projectId);

    const remaining = await service.listEpicAssignmentRules(projectId);
    expect(remaining).toEqual([]);
  });
});
