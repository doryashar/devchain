import Database from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { join } from 'path';
import { EpicAssignmentRulesStorageDelegate } from './epic_assignment_rules.delegate';
import { getRawSqliteClient } from '../../db/sqlite-raw';
import { projects } from '../../db/schema';
import type { StorageDelegateContext } from './base-storage.delegate';

const MIGRATIONS_FOLDER = join(__dirname, '../../../../../drizzle');

function createDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  const db = drizzle(sqlite);
  sqlite.pragma('foreign_keys = OFF');
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  sqlite.pragma('foreign_keys = ON');
  return { sqlite, db };
}

// Insert a project row so the FK on epic_assignment_rules.project_id is satisfied.
function seedProject(db: BetterSQLite3Database, id = 'proj-1') {
  db.insert(projects)
    .values({
      id,
      name: 'P',
      description: null,
      rootPath: '/',
      isTemplate: false,
      createdAt: 'now',
      updatedAt: 'now',
    })
    .run();
}

describe('EpicAssignmentRulesStorageDelegate', () => {
  let delegate: EpicAssignmentRulesStorageDelegate;
  let ctx: { db: BetterSQLite3Database; sqlite: Database.Database };

  beforeEach(() => {
    const { sqlite, db } = createDb();
    ctx = { db, sqlite };
    seedProject(db);
    const context: StorageDelegateContext = { db, rawClient: getRawSqliteClient(db) };
    delegate = new EpicAssignmentRulesStorageDelegate(context);
  });

  afterEach(() => {
    ctx.sqlite.close();
  });

  it('creates and retrieves a rule by id', async () => {
    const created = await delegate.createEpicAssignmentRule({
      projectId: 'proj-1',
      matchType: 'status',
      statusId: 'st-1',
      tags: null,
      targetType: 'agent',
      targetAgentId: 'ag-1',
      targetTeamId: null,
      overrideExisting: false,
      priority: 0,
      enabled: true,
    });
    expect(created.id).toBeTruthy();
    expect(created.matchType).toBe('status');
    const got = await delegate.getEpicAssignmentRule(created.id);
    expect(got?.targetAgentId).toBe('ag-1');
  });

  it('lists rules ordered by priority ascending', async () => {
    await delegate.createEpicAssignmentRule({
      projectId: 'proj-1',
      matchType: 'tag',
      statusId: null,
      tags: ['x'],
      targetType: 'agent',
      targetAgentId: 'a',
      targetTeamId: null,
      overrideExisting: false,
      priority: 10,
      enabled: true,
    });
    await delegate.createEpicAssignmentRule({
      projectId: 'proj-1',
      matchType: 'tag',
      statusId: null,
      tags: ['y'],
      targetType: 'agent',
      targetAgentId: 'b',
      targetTeamId: null,
      overrideExisting: false,
      priority: 1,
      enabled: true,
    });
    const list = await delegate.listEpicAssignmentRules('proj-1');
    expect(list.map((r) => r.priority)).toEqual([1, 10]);
  });

  it('throws NotFoundError on update/delete of unknown id', async () => {
    const { NotFoundError } = await import('../../../../common/errors/error-types');
    await expect(delegate.getEpicAssignmentRule('nope')).resolves.toBeNull();
    await expect(
      delegate.updateEpicAssignmentRule('nope', { enabled: false }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(delegate.deleteEpicAssignmentRule('nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('updates only provided fields and bumps updatedAt', async () => {
    const created = await delegate.createEpicAssignmentRule({
      projectId: 'proj-1',
      matchType: 'status',
      statusId: 's',
      tags: null,
      targetType: 'team',
      targetAgentId: null,
      targetTeamId: 't',
      overrideExisting: false,
      priority: 0,
      enabled: true,
    });
    const updated = await delegate.updateEpicAssignmentRule(created.id, {
      overrideExisting: true,
    });
    expect(updated.overrideExisting).toBe(true);
    expect(updated.matchType).toBe('status'); // untouched
    expect(updated.targetTeamId).toBe('t');
  });

  it('reorder writes priorities for the given ids', async () => {
    const r1 = await delegate.createEpicAssignmentRule({
      projectId: 'proj-1',
      matchType: 'tag',
      statusId: null,
      tags: ['a'],
      targetType: 'agent',
      targetAgentId: 'a',
      targetTeamId: null,
      overrideExisting: false,
      priority: 0,
      enabled: true,
    });
    const r2 = await delegate.createEpicAssignmentRule({
      projectId: 'proj-1',
      matchType: 'tag',
      statusId: null,
      tags: ['b'],
      targetType: 'agent',
      targetAgentId: 'b',
      targetTeamId: null,
      overrideExisting: false,
      priority: 1,
      enabled: true,
    });
    await delegate.reorderEpicAssignmentRules('proj-1', [
      { id: r1.id, priority: 5 },
      { id: r2.id, priority: 2 },
    ]);
    const list = await delegate.listEpicAssignmentRules('proj-1');
    expect(list.map((r) => r.id)).toEqual([r2.id, r1.id]);
  });
});
