# Board Auto-assign Rules — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-board (per-project) rules that auto-assign an epic to an agent or team lead when the epic is created or moves to a status; configurable from the Statuses page.

**Architecture:** A new `auto-assign-rules` NestJS module (controller + DTO + service) sits on top of a new central `epic_assignment_rules` storage slice (schema → delegate → `StorageService`). The `AutoAssignRulesService.resolveAssignment()` fire-time resolver is injected into `EpicsService` (`@Optional()`) and called inside `createEpic` / `createEpicForProject` / `updateEpic` after the existing auto-clean logic. The UI is an `AutoAssignRulesCard` on the existing `StatusesPage` plus a link button on the `BoardToolbar`.

**Tech Stack:** NestJS · Drizzle ORM + better-sqlite3 · Zod · React + React Query + shadcn/ui · Jest (ts-jest) · `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-06-28-board-auto-assign-rules-design.md`

---

## Conventions reference (from codebase exploration)

- **Storage = central `StorageService` + one delegate per entity.** New entity → new slice interface in `storage.interface.ts`, appended to the `StorageService extends {…}` list; new delegate file; wire field + pass-throughs in `LocalStorageService`.
- **Delegate style:** `extends BaseStorageDelegate`; lazy `await import('../../db/schema')` + `await import('drizzle-orm')` inside each method; `randomUUID()` IDs; ISO timestamps; throw `NotFoundError`.
- **Service style:** `@Injectable()`, `@Inject(STORAGE_SERVICE) storage: StorageService`; throw `ValidationError` / `NotFoundError` / `ConflictError` from `src/common/errors/error-types`.
- **Controller style:** `@Controller('api/<resource>')`; project-scope via `@Query('projectId')` or `@Param('projectId')`; inline `Schema.safeParse(body)` → `throw new BadRequestException({ message, errors })`. **No global `/api` prefix** — bake it into the decorator.
- **DTO style:** `z.object({...}).strict()` + `export type XDto = z.infer<typeof X>`. Hand-write `.optional()` update variants.
- **Test style:** Jest. Service specs: manual `createMockStorage()` + `new Service(mock as any)`. Controller specs: `Test.createTestingModule({ controllers, providers:[{provide,useValue}] })`, assert by direct method invocation. UI specs: `MemoryRouter` + `QueryClient({retry:false})` + `global.fetch` mock.
- **Schema indexes:** `sqliteTable('name', {...}, (t) => ({ nameIdx: index('name_idx').on(t.col) }))`.
- **Migrations:** edit `schema.ts`, run `pnpm db:generate` (from `apps/local-app`), commit the generated `drizzle/0066_*.sql` + `meta/*`.
- **Errors → HTTP:** the global `AllExceptionsFilter` maps `AppError` subclasses and `ZodError` to status codes. No try/catch needed in controllers/services.

All paths below are relative to repo root unless noted. Frontend `@/ui/...` = `apps/local-app/src/ui/...`.

---

## File map

**New files:**
- `apps/local-app/src/modules/storage/local/delegates/epic_assignment_rules.delegate.ts` (+ `.spec.ts`)
- `apps/local-app/src/modules/auto-assign-rules/auto-assign-rules.module.ts`
- `apps/local-app/src/modules/auto-assign-rules/dtos/auto-assign-rule.dto.ts`
- `apps/local-app/src/modules/auto-assign-rules/services/auto-assign-rules.service.ts` (+ `.spec.ts`)
- `apps/local-app/src/modules/auto-assign-rules/controllers/auto-assign-rules.controller.ts` (+ `.spec.ts`)
- `apps/local-app/src/ui/components/board/AutoAssignRulesCard.tsx` (+ `.spec.tsx`)
- `apps/local-app/drizzle/0066_*.sql` (generated) + `meta/0066_snapshot.json` + journal update

**Modified files:**
- `apps/local-app/src/modules/storage/models/domain.models.ts` — entity + DTOs
- `apps/local-app/src/modules/storage/db/schema.ts` — table definition
- `apps/local-app/src/modules/storage/interfaces/storage.interface.ts` — `EpicAssignmentRuleStorage` slice + extend `StorageService`
- `apps/local-app/src/modules/storage/local/local-storage.service.ts` — wire delegate
- `apps/local-app/src/modules/storage/local/delegates/project.delegate.ts` — explicit cleanup on project delete
- `apps/local-app/src/modules/epics/services/epics.service.ts` — inject resolver + call it
- `apps/local-app/src/modules/epics/epics.module.ts` — import `AutoAssignRulesModule`
- `apps/local-app/src/modules/epics/services/epics.service.spec.ts` — characterization tests
- `apps/local-app/src/app.normal.module.ts` — register `AutoAssignRulesModule`
- `apps/local-app/src/ui/pages/StatusesPage.tsx` — render card + API helpers
- `apps/local-app/src/ui/components/board/BoardToolbar.tsx` — link button
- `docs/board-auto-assign-rules.md` — user-facing feature doc (new)

---

## Phase A — Storage foundation

### Task A1: Domain model + DTOs

**Files:**
- Modify: `apps/local-app/src/modules/storage/models/domain.models.ts` (append after the `Team`/`TeamMember` block, ~line 484)

- [ ] **Step 1: Add the entity + Create/Update types**

Append to `domain.models.ts` (after the `UpdateTeam` type, before the `// CODE REVIEWS` section):

```ts
// ============================================
// EPIC ASSIGNMENT RULES - Auto-assign rules per project
// ============================================

export type EpicAssignmentMatchType = 'status' | 'tag';
export type EpicAssignmentTargetType = 'agent' | 'team';

export interface EpicAssignmentRule {
  id: string;
  projectId: string;
  matchType: EpicAssignmentMatchType;
  statusId: string | null; // required when matchType === 'status'
  tags: string[] | null; // required when matchType === 'tag'; rule matches if epic has any
  targetType: EpicAssignmentTargetType;
  targetAgentId: string | null; // required when targetType === 'agent'
  targetTeamId: string | null; // required when targetType === 'team'; resolves to team lead at fire time
  overrideExisting: boolean; // if false, skip when epic already has an assignee
  priority: number; // lower fires first
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CreateEpicAssignmentRule = Omit<
  EpicAssignmentRule,
  'id' | 'createdAt' | 'updatedAt'
>;
export type UpdateEpicAssignmentRule = Partial<CreateEpicAssignmentRule>;
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm --filter devchain-local-app exec tsc --noEmit -p apps/local-app/tsconfig.json` (if that path differs, use `pnpm --filter <local-app-pkg> typecheck`). Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/local-app/src/modules/storage/models/domain.models.ts
git commit -m "feat(auto-assign): add EpicAssignmentRule domain model"
```

---

### Task A2: Schema table + generate migration

**Files:**
- Modify: `apps/local-app/src/modules/storage/db/schema.ts` (add near the `teams` block, ~line 1050)
- Create (generated): `apps/local-app/drizzle/0066_<auto>.sql` + `meta/0066_snapshot.json` + `meta/_journal.json` update

- [ ] **Step 1: Add the table definition to `schema.ts`**

Insert after the `teamProfileConfigs` table (line ~1049), before the `// CODE REVIEWS` comment:

```ts
// ============================================
// EPIC ASSIGNMENT RULES - Per-project auto-assign rules
// ============================================

export const epicAssignmentRules = sqliteTable(
  'epic_assignment_rules',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    matchType: text('match_type').notNull(), // 'status' | 'tag'
    statusId: text('status_id'), // set when matchType === 'status'
    tags: text('tags', { mode: 'json' }).$type<string[] | null>(), // set when matchType === 'tag'
    targetType: text('target_type').notNull(), // 'agent' | 'team'
    targetAgentId: text('target_agent_id'), // set when targetType === 'agent'
    targetTeamId: text('target_team_id'), // set when targetType === 'team'
    overrideExisting: integer('override_existing', { mode: 'boolean' })
      .notNull()
      .default(false),
    priority: integer('priority').notNull().default(0),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    projectIdIdx: index('epic_assignment_rules_project_id_idx').on(table.projectId),
    statusIdIdx: index('epic_assignment_rules_status_id_idx').on(table.statusId),
  }),
);
```

- [ ] **Step 2: Generate the migration**

Run (from repo root):
```bash
pnpm --filter devchain-local-app db:generate
```
Expected: drizzle-kit prints `1 table added`, writes `apps/local-app/drizzle/0066_<name>.sql`, and updates `meta/_journal.json` + adds `meta/0066_snapshot.json`.

- [ ] **Step 3: Inspect the generated SQL**

Open `apps/local-app/drizzle/0066_*.sql`. It MUST contain `CREATE TABLE \`epic_assignment_rules\` (...)` with a `FOREIGN KEY (\`project_id\`) REFERENCES \`projects\`(\`id\`) ... ON DELETE cascade` and two `CREATE INDEX` statements. If `tags`/`statusId` columns or the project FK are missing, re-check the schema definition and re-run `db:generate`.

- [ ] **Step 4: Verify journal integrity**

Run: `pnpm --filter devchain-local-app check:journal`
Expected: passes (no output / exit 0). This is part of prebuild — must stay green.

- [ ] **Step 5: Commit**

```bash
git add apps/local-app/src/modules/storage/db/schema.ts apps/local-app/drizzle/
git commit -m "feat(auto-assign): add epic_assignment_rules table + migration"
```

---

### Task A3: Storage interface slice

**Files:**
- Modify: `apps/local-app/src/modules/storage/interfaces/storage.interface.ts`

- [ ] **Step 1: Add the `EpicAssignmentRuleStorage` sub-interface**

Add the import to the existing domain-models import block at the top of the file:

```ts
import type {
  // ... existing imports ...
  EpicAssignmentRule,
  CreateEpicAssignmentRule,
  UpdateEpicAssignmentRule,
} from '../models/domain.models';
```

Then add a new sub-interface (place it after the `ConnectorStorage` interface, before the aggregated `StorageService` declaration):

```ts
export interface EpicAssignmentRuleStorage {
  listEpicAssignmentRules(projectId: string): Promise<EpicAssignmentRule[]>;
  getEpicAssignmentRule(id: string): Promise<EpicAssignmentRule | null>;
  createEpicAssignmentRule(data: CreateEpicAssignmentRule): Promise<EpicAssignmentRule>;
  updateEpicAssignmentRule(id: string, data: UpdateEpicAssignmentRule): Promise<EpicAssignmentRule>;
  deleteEpicAssignmentRule(id: string): Promise<void>;
  reorderEpicAssignmentRules(
    projectId: string,
    items: Array<{ id: string; priority: number }>,
  ): Promise<void>;
}
```

- [ ] **Step 2: Append `EpicAssignmentRuleStorage` to the `StorageService extends` list**

In the aggregated interface (`StorageService extends ProjectStorage, … ConnectorStorage {}`), add `EpicAssignmentRuleStorage` to the `extends` list (after `ConnectorStorage`).

- [ ] **Step 3: Verify it compiles**

Run typecheck. Expected: errors only in `LocalStorageService` ("Class incorrectly implements StorageService — missing 6 methods"). That's expected; Task A5 fixes it.

- [ ] **Step 4: Commit**

```bash
git add apps/local-app/src/modules/storage/interfaces/storage.interface.ts
git commit -m "feat(auto-assign): add EpicAssignmentRuleStorage slice to StorageService"
```

---

### Task A4: Storage delegate + unit tests (TDD)

**Files:**
- Create: `apps/local-app/src/modules/storage/local/delegates/epic_assignment_rules.delegate.ts`
- Test: `apps/local-app/src/modules/storage/local/delegates/epic_assignment_rules.delegate.spec.ts`

- [ ] **Step 1: Write the failing delegate spec**

Create `epic_assignment_rules.delegate.spec.ts`. This spins up an in-memory SQLite, runs migrations, and exercises CRUD + reorder:

```ts
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { join } from 'path';
import { EpicAssignmentRulesStorageDelegate } from './epic_assignment_rules.delegate';
import { getRawSqliteClient } from '../../db/sqlite-raw';
import type { StorageDelegateContext } from './base-storage.delegate';

function createDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  const db = drizzle(sqlite);
  const migrationsFolder = join(__dirname, '../../../../../../drizzle');
  sqlite.pragma('foreign_keys = OFF');
  migrate(db, { migrationsFolder });
  sqlite.pragma('foreign_keys = ON');
  return { sqlite, db };
}

// Insert a project row so the FK on epic_assignment_rules.project_id is satisfied.
function seedProject(db: any, id = 'proj-1') {
  db.run(
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    (require('drizzle-orm')).sql`INSERT INTO projects (id, name, description, root_path, is_template, created_at, updated_at) VALUES (${id}, ${'P'}, ${null}, ${'/'}, ${0}, ${'now'}, ${'now'})`,
  );
}

describe('EpicAssignmentRulesStorageDelegate', () => {
  let delegate: EpicAssignmentRulesStorageDelegate;
  let ctx: { db: any; sqlite: any };

  beforeEach(() => {
    const { sqlite, db } = createDb();
    ctx = { db, sqlite };
    seedProject(db);
    const context: StorageDelegateContext = { db, rawClient: getRawSqliteClient(db) };
    delegate = new EpicAssignmentRulesStorageDelegate(context);
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
      projectId: 'proj-1', matchType: 'tag', statusId: null, tags: ['x'],
      targetType: 'agent', targetAgentId: 'a', targetTeamId: null,
      overrideExisting: false, priority: 10, enabled: true,
    });
    await delegate.createEpicAssignmentRule({
      projectId: 'proj-1', matchType: 'tag', statusId: null, tags: ['y'],
      targetType: 'agent', targetAgentId: 'b', targetTeamId: null,
      overrideExisting: false, priority: 1, enabled: true,
    });
    const list = await delegate.listEpicAssignmentRules('proj-1');
    expect(list.map((r) => r.priority)).toEqual([1, 10]);
  });

  it('throws NotFoundError on get/update/delete of unknown id', async () => {
    const { NotFoundError } = await import('../../../../common/errors/error-types');
    await expect(delegate.getEpicAssignmentRule('nope')).resolves.toBeNull();
    await expect(delegate.updateEpicAssignmentRule('nope', { enabled: false })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(delegate.deleteEpicAssignmentRule('nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('updates only provided fields and bumps updatedAt', async () => {
    const created = await delegate.createEpicAssignmentRule({
      projectId: 'proj-1', matchType: 'status', statusId: 's', tags: null,
      targetType: 'team', targetAgentId: null, targetTeamId: 't',
      overrideExisting: false, priority: 0, enabled: true,
    });
    const updated = await delegate.updateEpicAssignmentRule(created.id, { overrideExisting: true });
    expect(updated.overrideExisting).toBe(true);
    expect(updated.matchType).toBe('status'); // untouched
    expect(updated.targetTeamId).toBe('t');
  });

  it('reorder writes priorities for the given ids', async () => {
    const r1 = await delegate.createEpicAssignmentRule({
      projectId: 'proj-1', matchType: 'tag', statusId: null, tags: ['a'],
      targetType: 'agent', targetAgentId: 'a', targetTeamId: null,
      overrideExisting: false, priority: 0, enabled: true,
    });
    const r2 = await delegate.createEpicAssignmentRule({
      projectId: 'proj-1', matchType: 'tag', statusId: null, tags: ['b'],
      targetType: 'agent', targetAgentId: 'b', targetTeamId: null,
      overrideExisting: false, priority: 1, enabled: true,
    });
    await delegate.reorderEpicAssignmentRules('proj-1', [
      { id: r1.id, priority: 5 },
      { id: r2.id, priority: 2 },
    ]);
    const list = await delegate.listEpicAssignmentRules('proj-1');
    expect(list.map((r) => r.id)).toEqual([r2.id, r1.id]);
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm --filter devchain-local-app test -- epic_assignment_rules.delegate.spec`
Expected: FAIL — `Cannot find module './epic_assignment_rules.delegate'`.

- [ ] **Step 3: Implement the delegate**

Create `epic_assignment_rules.delegate.ts`:

```ts
import { randomUUID } from 'crypto';
import { NotFoundError } from '../../../../common/errors/error-types';
import { BaseStorageDelegate, type StorageDelegateContext } from './base-storage.delegate';
import type {
  EpicAssignmentRule,
  CreateEpicAssignmentRule,
  UpdateEpicAssignmentRule,
} from '../../models/domain.models';

export class EpicAssignmentRulesStorageDelegate extends BaseStorageDelegate {
  constructor(context: StorageDelegateContext) {
    super(context);
  }

  async listEpicAssignmentRules(projectId: string): Promise<EpicAssignmentRule[]> {
    const { epicAssignmentRules } = await import('../../db/schema');
    const { eq, asc } = await import('drizzle-orm');
    const rows = await this.db
      .select()
      .from(epicAssignmentRules)
      .where(eq(epicAssignmentRules.projectId, projectId))
      .orderBy(asc(epicAssignmentRules.priority));
    return rows as unknown as EpicAssignmentRule[];
  }

  async getEpicAssignmentRule(id: string): Promise<EpicAssignmentRule | null> {
    const { epicAssignmentRules } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');
    const rows = await this.db
      .select()
      .from(epicAssignmentRules)
      .where(eq(epicAssignmentRules.id, id))
      .limit(1);
    if (rows.length === 0) return null;
    return rows[0] as unknown as EpicAssignmentRule;
  }

  async createEpicAssignmentRule(data: CreateEpicAssignmentRule): Promise<EpicAssignmentRule> {
    const { epicAssignmentRules } = await import('../../db/schema');
    const now = new Date().toISOString();
    const id = randomUUID();
    await this.db.insert(epicAssignmentRules).values({
      id,
      projectId: data.projectId,
      matchType: data.matchType,
      statusId: data.statusId ?? null,
      tags: data.tags ?? null,
      targetType: data.targetType,
      targetAgentId: data.targetAgentId ?? null,
      targetTeamId: data.targetTeamId ?? null,
      overrideExisting: data.overrideExisting,
      priority: data.priority,
      enabled: data.enabled,
      createdAt: now,
      updatedAt: now,
    });
    const created = await this.getEpicAssignmentRule(id);
    if (!created) throw new NotFoundError('EpicAssignmentRule', id);
    return created;
  }

  async updateEpicAssignmentRule(
    id: string,
    data: UpdateEpicAssignmentRule,
  ): Promise<EpicAssignmentRule> {
    const existing = await this.getEpicAssignmentRule(id);
    if (!existing) throw new NotFoundError('EpicAssignmentRule', id);

    const { epicAssignmentRules } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');
    const now = new Date().toISOString();
    const update: Record<string, unknown> = { updatedAt: now };
    for (const key of [
      'matchType',
      'statusId',
      'tags',
      'targetType',
      'targetAgentId',
      'targetTeamId',
      'overrideExisting',
      'priority',
      'enabled',
    ] as const) {
      if (data[key] !== undefined) update[key] = data[key];
    }
    await this.db.update(epicAssignmentRules).set(update).where(eq(epicAssignmentRules.id, id));
    const updated = await this.getEpicAssignmentRule(id);
    if (!updated) throw new NotFoundError('EpicAssignmentRule', id);
    return updated;
  }

  async deleteEpicAssignmentRule(id: string): Promise<void> {
    const existing = await this.getEpicAssignmentRule(id);
    if (!existing) throw new NotFoundError('EpicAssignmentRule', id);
    const { epicAssignmentRules } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');
    await this.db.delete(epicAssignmentRules).where(eq(epicAssignmentRules.id, id));
  }

  async reorderEpicAssignmentRules(
    _projectId: string,
    items: Array<{ id: string; priority: number }>,
  ): Promise<void> {
    const { epicAssignmentRules } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');
    const now = new Date().toISOString();
    for (const item of items) {
      await this.db
        .update(epicAssignmentRules)
        .set({ priority: item.priority, updatedAt: now })
        .where(eq(epicAssignmentRules.id, item.id));
    }
  }
}
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `pnpm --filter devchain-local-app test -- epic_assignment_rules.delegate.spec`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/local-app/src/modules/storage/local/delegates/epic_assignment_rules.delegate.ts apps/local-app/src/modules/storage/local/delegates/epic_assignment_rules.delegate.spec.ts
git commit -m "feat(auto-assign): add EpicAssignmentRules storage delegate + tests"
```

---

### Task A5: Wire the delegate into `LocalStorageService`

**Files:**
- Modify: `apps/local-app/src/modules/storage/local/local-storage.service.ts`

- [ ] **Step 1: Add the delegate import + field + constructor instantiation**

At the top with the other delegate imports:

```ts
import { EpicAssignmentRulesStorageDelegate } from './delegates/epic_assignment_rules.delegate';
```

Add a field alongside the other `private readonly …Delegate` declarations (near `connectorDelegate`):

```ts
private readonly epicAssignmentRulesDelegate: EpicAssignmentRulesStorageDelegate;
```

In the constructor, alongside the other `this.xDelegate = new …(context)` lines:

```ts
this.epicAssignmentRulesDelegate = new EpicAssignmentRulesStorageDelegate(context);
```

- [ ] **Step 2: Add the pass-through methods**

Add near the other connector pass-throughs (the file already has a `listConnectors`/`createConnector` group — put these right after that group):

```ts
async listEpicAssignmentRules(projectId: string): Promise<EpicAssignmentRule[]> {
  return this.epicAssignmentRulesDelegate.listEpicAssignmentRules(projectId);
}
async getEpicAssignmentRule(id: string): Promise<EpicAssignmentRule | null> {
  return this.epicAssignmentRulesDelegate.getEpicAssignmentRule(id);
}
async createEpicAssignmentRule(data: CreateEpicAssignmentRule): Promise<EpicAssignmentRule> {
  return this.epicAssignmentRulesDelegate.createEpicAssignmentRule(data);
}
async updateEpicAssignmentRule(
  id: string,
  data: UpdateEpicAssignmentRule,
): Promise<EpicAssignmentRule> {
  return this.epicAssignmentRulesDelegate.updateEpicAssignmentRule(id, data);
}
async deleteEpicAssignmentRule(id: string): Promise<void> {
  return this.epicAssignmentRulesDelegate.deleteEpicAssignmentRule(id);
}
async reorderEpicAssignmentRules(
  projectId: string,
  items: Array<{ id: string; priority: number }>,
): Promise<void> {
  return this.epicAssignmentRulesDelegate.reorderEpicAssignmentRules(projectId, items);
}
```

Also extend the domain-models import at the top to include `EpicAssignmentRule`, `CreateEpicAssignmentRule`, `UpdateEpicAssignmentRule`.

- [ ] **Step 3: Verify typecheck passes**

Run typecheck. Expected: the `LocalStorageService` "incorrectly implements" error from Task A3 is now gone; full typecheck green.

- [ ] **Step 4: Commit**

```bash
git add apps/local-app/src/modules/storage/local/local-storage.service.ts
git commit -m "feat(auto-assign): wire EpicAssignmentRules delegate into LocalStorageService"
```

---

### Task A6: Explicit cleanup on project delete

**Files:**
- Modify: `apps/local-app/src/modules/storage/local/delegates/project.delegate.ts` (in `deleteProject`, alongside the teams cleanup block ~line 748)
- Test: `apps/local-app/src/modules/storage/local/local-storage.auto-assign-regression.spec.ts` (new)

- [ ] **Step 1: Write a failing regression test**

Create `local-storage.auto-assign-regression.spec.ts` that builds the full `LocalStorageService` against an in-memory DB (mirror the existing `local-storage.teams-regression.spec.ts` setup). Seed a project + a rule, delete the project, then assert `listEpicAssignmentRules('proj-1')` returns `[]`:

```ts
// Mirror the harness in local-storage.teams-regression.spec.ts exactly
// (same in-memory DB + migrate + LocalStorageService construction).
describe('LocalStorageService — epic_assignment_rules cascade on project delete', () => {
  it('removes rules when the project is deleted', async () => {
    const storage = /* build as in teams-regression spec */;
    await storage.createEpicAssignmentRule({
      projectId: 'proj-1', matchType: 'tag', statusId: null, tags: ['x'],
      targetType: 'agent', targetAgentId: 'a', targetTeamId: null,
      overrideExisting: false, priority: 0, enabled: true,
    });
    await storage.deleteProject('proj-1');
    const remaining = await storage.listEpicAssignmentRules('proj-1');
    expect(remaining).toEqual([]);
  });
});
```

(If the FK `ON DELETE cascade` already handles this — it should — the test will PASS immediately even before Step 2. In that case, commit the test as a characterization guard and skip Step 2. The explicit delete in Step 2 is defensive and matches the teams pattern; only add it if the test fails.)

- [ ] **Step 2 (only if Step 1 test fails): Add explicit cleanup to `deleteProject`**

In `project.delegate.ts`, inside `deleteProject`, right after the teams cleanup block, add:

```ts
// Epic assignment rules (cascade-protected; explicit delete for ordering safety)
const { epicAssignmentRules } = await import('../../db/schema');
await this.db.delete(epicAssignmentRules).where(eq(epicAssignmentRules.projectId, id));
```

(`eq` is already imported at the top of that method.)

- [ ] **Step 3: Run the regression test**

Run: `pnpm --filter devchain-local-app test -- local-storage.auto-assign-regression`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/local-app/src/modules/storage/local/delegates/project.delegate.ts apps/local-app/src/modules/storage/local/local-storage.auto-assign-regression.spec.ts
git commit -m "feat(auto-assign): ensure rules cascade on project delete + regression test"
```

---

## Phase B — Auto-assign module

### Task B1: DTOs (Zod)

**Files:**
- Create: `apps/local-app/src/modules/auto-assign-rules/dtos/auto-assign-rule.dto.ts`

- [ ] **Step 1: Write the DTO file**

```ts
import { z } from 'zod';

const matchTypeEnum = z.enum(['status', 'tag']);
const targetTypeEnum = z.enum(['agent', 'team']);

const baseFields = {
  matchType: matchTypeEnum,
  targetType: targetTypeEnum,
  statusId: z.string().min(1).nullable(),
  tags: z.array(z.string().min(1)).nullable(),
  targetAgentId: z.string().min(1).nullable(),
  targetTeamId: z.string().min(1).nullable(),
  overrideExisting: z.boolean(),
  priority: z.number().int(),
  enabled: z.boolean(),
};

// One matcher per rule: status XOR tag.
export const CreateEpicAssignmentRuleDtoSchema = z
  .object(baseFields)
  .strict()
  .superRefine((data, ctx) => {
    if (data.matchType === 'status') {
      if (!data.statusId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['statusId'], message: 'statusId is required when matchType is "status"' });
      }
      if (data.tags !== null && data.tags !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tags'], message: 'tags must be null when matchType is "status"' });
      }
    } else {
      if (!data.tags || data.tags.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tags'], message: 'tags must be a non-empty array when matchType is "tag"' });
      }
      if (data.statusId !== null && data.statusId !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['statusId'], message: 'statusId must be null when matchType is "tag"' });
      }
    }
    if (data.targetType === 'agent') {
      if (!data.targetAgentId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targetAgentId'], message: 'targetAgentId is required when targetType is "agent"' });
      }
    } else {
      if (!data.targetTeamId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targetTeamId'], message: 'targetTeamId is required when targetType is "team"' });
      }
    }
  });

export type CreateEpicAssignmentRuleDto = z.infer<typeof CreateEpicAssignmentRuleDtoSchema>;

export const UpdateEpicAssignmentRuleDtoSchema = z
  .object({
    matchType: matchTypeEnum.optional(),
    targetType: targetTypeEnum.optional(),
    statusId: z.string().min(1).nullable().optional(),
    tags: z.array(z.string().min(1)).nullable().optional(),
    targetAgentId: z.string().min(1).nullable().optional(),
    targetTeamId: z.string().min(1).nullable().optional(),
    overrideExisting: z.boolean().optional(),
    priority: z.number().int().optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.matchType === 'status' && data.tags !== undefined && data.tags !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tags'], message: 'tags must be null when matchType is "status"' });
    }
    if (data.matchType === 'tag' && data.statusId !== undefined && data.statusId !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['statusId'], message: 'statusId must be null when matchType is "tag"' });
    }
  });

export type UpdateEpicAssignmentRuleDto = z.infer<typeof UpdateEpicAssignmentRuleDtoSchema>;

export const ReorderEpicAssignmentRulesDtoSchema = z
  .object({
    items: z.array(z.object({ id: z.string().min(1), priority: z.number().int() })).min(1),
  })
  .strict();

export type ReorderEpicAssignmentRulesDto = z.infer<typeof ReorderEpicAssignmentRulesDtoSchema>;
```

- [ ] **Step 2: Verify typecheck**

Run typecheck. Expected: green (the file is self-contained).

- [ ] **Step 3: Commit**

```bash
git add apps/local-app/src/modules/auto-assign-rules/dtos/auto-assign-rule.dto.ts
git commit -m "feat(auto-assign): add Zod DTOs with status-XOR-tag and agent-XOR-team constraints"
```

---

### Task B2: Resolver + service with full unit tests (TDD)

**Files:**
- Create: `apps/local-app/src/modules/auto-assign-rules/services/auto-assign-rules.service.ts`
- Test: `apps/local-app/src/modules/auto-assign-rules/services/auto-assign-rules.service.spec.ts`

The resolver is the heart of the feature. It must NOT mutate the epic; it returns the resolved agentId (or null + reason). The caller (`EpicsService`) writes the result.

- [ ] **Step 1: Write the failing service spec**

```ts
import { AutoAssignRulesService } from './auto-assign-rules.service';

function createMockStorage(rules: any[]) {
  return {
    listEpicAssignmentRules: jest.fn().mockResolvedValue(rules),
    getEpicAssignmentRule: jest.fn(),
    createEpicAssignmentRule: jest.fn(),
    updateEpicAssignmentRule: jest.fn(),
    deleteEpicAssignmentRule: jest.fn(),
    reorderEpicAssignmentRules: jest.fn(),
    getStatus: jest.fn(),
    getAgent: jest.fn(),
  };
}

function createMockTeamsService(teamById: Record<string, any>) {
  return {
    getTeam: jest.fn(async (id: string) => teamById[id] ?? null),
    listTeams: jest.fn(),
  };
}

describe('AutoAssignRulesService.resolveAssignment', () => {
  const baseInput = { projectId: 'p', statusId: 'st-1', tags: [] as string[], currentAgentId: null };

  it('returns the agent of the first matching status rule (priority order)', async () => {
    const storage = createMockStorage([
      { id: 'r1', projectId: 'p', matchType: 'status', statusId: 'st-1', tags: null, targetType: 'agent', targetAgentId: 'ag-A', targetTeamId: null, overrideExisting: false, priority: 10, enabled: true },
    ]);
    const svc = new AutoAssignRulesService(storage as any, createMockTeamsService({}) as any);
    const res = await svc.resolveAssignment({ ...baseInput }, 'create');
    expect(res).toEqual({ agentId: 'ag-A', ruleId: 'r1', skipped: null });
  });

  it('matches a tag rule when epic has any of the rule tags', async () => {
    const storage = createMockStorage([
      { id: 'r1', projectId: 'p', matchType: 'tag', statusId: null, tags: ['frontend', 'ui'], targetType: 'agent', targetAgentId: 'ag-FE', targetTeamId: null, overrideExisting: false, priority: 0, enabled: true },
    ]);
    const svc = new AutoAssignRulesService(storage as any, createMockTeamsService({}) as any);
    const res = await svc.resolveAssignment({ ...baseInput, tags: ['ui'], statusId: 'other' }, 'create');
    expect(res.agentId).toBe('ag-FE');
  });

  it('declines when epic already assigned and overrideExisting is false', async () => {
    const storage = createMockStorage([
      { id: 'r1', projectId: 'p', matchType: 'status', statusId: 'st-1', tags: null, targetType: 'agent', targetAgentId: 'ag-A', targetTeamId: null, overrideExisting: false, priority: 0, enabled: true },
    ]);
    const svc = new AutoAssignRulesService(storage as any, createMockTeamsService({}) as any);
    const res = await svc.resolveAssignment({ ...baseInput, currentAgentId: 'ag-existing' }, 'status_change');
    expect(res).toEqual({ agentId: null, ruleId: null, skipped: 'already_assigned' });
  });

  it('overrides when overrideExisting is true', async () => {
    const storage = createMockStorage([
      { id: 'r1', projectId: 'p', matchType: 'status', statusId: 'st-1', tags: null, targetType: 'agent', targetAgentId: 'ag-A', targetTeamId: null, overrideExisting: true, priority: 0, enabled: true },
    ]);
    const svc = new AutoAssignRulesService(storage as any, createMockTeamsService({}) as any);
    const res = await svc.resolveAssignment({ ...baseInput, currentAgentId: 'old' }, 'status_change');
    expect(res.agentId).toBe('ag-A');
  });

  it('resolves a team target to the team lead', async () => {
    const storage = createMockStorage([
      { id: 'r1', projectId: 'p', matchType: 'status', statusId: 'st-1', tags: null, targetType: 'team', targetAgentId: null, targetTeamId: 'team-1', overrideExisting: false, priority: 0, enabled: true },
    ]);
    const teams = createMockTeamsService({ 'team-1': { id: 'team-1', teamLeadAgentId: 'lead-1' } });
    const svc = new AutoAssignRulesService(storage as any, teams as any);
    const res = await svc.resolveAssignment({ ...baseInput }, 'create');
    expect(res).toEqual({ agentId: 'lead-1', ruleId: 'r1', skipped: null });
  });

  it('declines a team rule when the team has no lead', async () => {
    const storage = createMockStorage([
      { id: 'r1', projectId: 'p', matchType: 'status', statusId: 'st-1', tags: null, targetType: 'team', targetAgentId: null, targetTeamId: 'team-1', overrideExisting: false, priority: 0, enabled: true },
    ]);
    const teams = createMockTeamsService({ 'team-1': { id: 'team-1', teamLeadAgentId: null } });
    const svc = new AutoAssignRulesService(storage as any, teams as any);
    const res = await svc.resolveAssignment({ ...baseInput }, 'create');
    expect(res).toEqual({ agentId: null, ruleId: null, skipped: 'no_lead' });
  });

  it('declines a team rule when the team no longer exists (stale)', async () => {
    const storage = createMockStorage([
      { id: 'r1', projectId: 'p', matchType: 'status', statusId: 'st-1', tags: null, targetType: 'team', targetAgentId: null, targetTeamId: 'team-x', overrideExisting: false, priority: 0, enabled: true },
    ]);
    const svc = new AutoAssignRulesService(storage as any, createMockTeamsService({}) as any);
    const res = await svc.resolveAssignment({ ...baseInput }, 'create');
    expect(res).toEqual({ agentId: null, ruleId: null, skipped: 'stale_target' });
  });

  it('returns no_match when no rules apply', async () => {
    const storage = createMockStorage([
      { id: 'r1', projectId: 'p', matchType: 'status', statusId: 'other', tags: null, targetType: 'agent', targetAgentId: 'ag-A', targetTeamId: null, overrideExisting: false, priority: 0, enabled: true },
    ]);
    const svc = new AutoAssignRulesService(storage as any, createMockTeamsService({}) as any);
    const res = await svc.resolveAssignment({ ...baseInput, statusId: 'st-1' }, 'create');
    expect(res).toEqual({ agentId: null, ruleId: null, skipped: 'no_match' });
  });

  it('skips disabled rules', async () => {
    const storage = createMockStorage([
      { id: 'r1', projectId: 'p', matchType: 'status', statusId: 'st-1', tags: null, targetType: 'agent', targetAgentId: 'ag-A', targetTeamId: null, overrideExisting: false, priority: 0, enabled: false },
    ]);
    const svc = new AutoAssignRulesService(storage as any, createMockTeamsService({}) as any);
    const res = await svc.resolveAssignment({ ...baseInput }, 'create');
    expect(res.skipped).toBe('no_match');
  });

  it('picks the first winning rule in priority order when several match', async () => {
    const storage = createMockStorage([
      { id: 'r-low', projectId: 'p', matchType: 'status', statusId: 'st-1', tags: null, targetType: 'agent', targetAgentId: 'ag-LOW', targetTeamId: null, overrideExisting: false, priority: 1, enabled: true },
      { id: 'r-high', projectId: 'p', matchType: 'status', statusId: 'st-1', tags: null, targetType: 'agent', targetAgentId: 'ag-HIGH', targetTeamId: null, overrideExisting: false, priority: 0, enabled: true },
    ]);
    const svc = new AutoAssignRulesService(storage as any, createMockTeamsService({}) as any);
    const res = await svc.resolveAssignment({ ...baseInput }, 'create');
    expect(res.ruleId).toBe('r-high');
  });
});

describe('AutoAssignRulesService CRUD', () => {
  it('create assigns priority = max+1 when caller omits it', async () => {
    const storage = createMockStorage([]);
    storage.listEpicAssignmentRules = jest.fn().mockResolvedValue([
      { id: 'a', projectId: 'p', matchType: 'tag', statusId: null, tags: ['x'], targetType: 'agent', targetAgentId: 'a', targetTeamId: null, overrideExisting: false, priority: 3, enabled: true, createdAt: '', updatedAt: '' },
    ]);
    storage.createEpicAssignmentRule = jest.fn().mockResolvedValue({ id: 'new' });
    const svc = new AutoAssignRulesService(storage as any, createMockTeamsService({}) as any);
    await svc.create('p', {
      matchType: 'tag', statusId: null, tags: ['y'], targetType: 'agent',
      targetAgentId: 'b', targetTeamId: null, overrideExisting: false, enabled: true,
    } as any);
    expect(storage.createEpicAssignmentRule).toHaveBeenCalledWith(expect.objectContaining({ priority: 4 }));
  });

  it('reorder delegates to storage with projectId guard', async () => {
    const storage = createMockStorage([]);
    const svc = new AutoAssignRulesService(storage as any, createMockTeamsService({}) as any);
    await svc.reorder('p', [{ id: 'r1', priority: 0 }]);
    expect(storage.reorderEpicAssignmentRules).toHaveBeenCalledWith('p', [{ id: 'r1', priority: 0 }]);
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm --filter devchain-local-app test -- auto-assign-rules.service.spec`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `auto-assign-rules.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import {
  STORAGE_SERVICE,
  type StorageService,
} from '../../storage/interfaces/storage.interface';
import type {
  EpicAssignmentRule,
  CreateEpicAssignmentRule,
  UpdateEpicAssignmentRule,
} from '../../storage/models/domain.models';
import type { TeamsService } from '../../teams/services/teams.service';
import {
  NotFoundError,
  ValidationError,
} from '../../../common/errors/error-types';
import { createLogger } from '../../../common/logging/logger';

const logger = createLogger('AutoAssignRulesService');

export type AutoAssignSkipReason =
  | 'no_match'
  | 'already_assigned'
  | 'stale_target'
  | 'no_lead';

export interface ResolveAssignmentInput {
  projectId: string;
  statusId: string;
  tags: readonly string[];
  currentAgentId: string | null;
}

export interface ResolveAssignmentResult {
  agentId: string | null;
  ruleId: string | null;
  skipped: AutoAssignSkipReason | null;
}

@Injectable()
export class AutoAssignRulesService {
  constructor(
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    private readonly teamsService: TeamsService,
  ) {}

  /**
   * Fire-time resolver. Does NOT mutate the epic. Returns the agentId to assign
   * (or null + a skip reason). The caller performs the storage write.
   *
   * Assumes the caller has already handled auto-clean (an auto-clean target
   * status should NOT call this — see spec §4.2).
   */
  async resolveAssignment(
    input: ResolveAssignmentInput,
    _trigger: 'create' | 'status_change',
  ): Promise<ResolveAssignmentResult> {
    const rules = (await this.storage.listEpicAssignmentRules(input.projectId)).filter(
      (r) => r.enabled,
    ); // already ordered by priority asc

    for (const rule of rules) {
      if (!this.ruleMatches(rule, input)) continue;

      if (input.currentAgentId !== null && !rule.overrideExisting) {
        return { agentId: null, ruleId: null, skipped: 'already_assigned' };
      }

      const agentId = await this.resolveTarget(rule);
      if (agentId === null) continue; // stale target / no lead → decline, try next rule

      return { agentId, ruleId: rule.id, skipped: null };
    }

    return { agentId: null, ruleId: null, skipped: 'no_match' };
  }

  private ruleMatches(rule: EpicAssignmentRule, input: ResolveAssignmentInput): boolean {
    if (rule.matchType === 'status') {
      return rule.statusId === input.statusId;
    }
    const ruleTags = rule.tags ?? [];
    return ruleTags.some((t) => input.tags.includes(t));
  }

  private async resolveTarget(rule: EpicAssignmentRule): Promise<string | null> {
    if (rule.targetType === 'agent') {
      if (!rule.targetAgentId) return null;
      try {
        await this.storage.getAgent(rule.targetAgentId);
      } catch {
        logger.warn({ ruleId: rule.id, agentId: rule.targetAgentId }, 'Stale target agent');
        return null;
      }
      return rule.targetAgentId;
    }
    // team target
    if (!rule.targetTeamId) return null;
    const team = await this.teamsService.getTeam(rule.targetTeamId).catch(() => null);
    if (!team) {
      logger.warn({ ruleId: rule.id, teamId: rule.targetTeamId }, 'Stale target team');
      return null;
    }
    return team.teamLeadAgentId ?? null;
  }

  // ---- CRUD ----

  async list(projectId: string): Promise<EpicAssignmentRule[]> {
    return this.storage.listEpicAssignmentRules(projectId);
  }

  async create(
    projectId: string,
    data: Omit<CreateEpicAssignmentRule, 'projectId' | 'priority'> & { priority?: number },
  ): Promise<EpicAssignmentRule> {
    await this.validateRuleReferences(projectId, data as CreateEpicAssignmentRule);
    const existing = await this.storage.listEpicAssignmentRules(projectId);
    const maxPriority = existing.reduce((m, r) => Math.max(m, r.priority), -1);
    return this.storage.createEpicAssignmentRule({
      projectId,
      matchType: data.matchType,
      statusId: data.statusId ?? null,
      tags: data.tags ?? null,
      targetType: data.targetType,
      targetAgentId: data.targetAgentId ?? null,
      targetTeamId: data.targetTeamId ?? null,
      overrideExisting: data.overrideExisting,
      enabled: data.enabled,
      priority: data.priority ?? maxPriority + 1,
    });
  }

  async update(
    id: string,
    data: UpdateEpicAssignmentRule,
  ): Promise<EpicAssignmentRule> {
    const existing = await this.storage.getEpicAssignmentRule(id);
    if (!existing) throw new NotFoundError('AutoAssignRule', id);
    const merged = { ...existing, ...data } as CreateEpicAssignmentRule;
    await this.validateRuleReferences(existing.projectId, merged);
    return this.storage.updateEpicAssignmentRule(id, data);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.storage.getEpicAssignmentRule(id);
    if (!existing) throw new NotFoundError('AutoAssignRule', id);
    return this.storage.deleteEpicAssignmentRule(id);
  }

  async reorder(
    projectId: string,
    items: Array<{ id: string; priority: number }>,
  ): Promise<void> {
    return this.storage.reorderEpicAssignmentRules(projectId, items);
  }

  private async validateRuleReferences(
    projectId: string,
    data: CreateEpicAssignmentRule,
  ): Promise<void> {
    if (data.matchType === 'status' && data.statusId) {
      const status = await this.storage.getStatus(data.statusId).catch(() => null);
      if (!status || status.projectId !== projectId) {
        throw new ValidationError('Referenced status does not belong to this project', {
          statusId: data.statusId,
        });
      }
    }
    if (data.targetType === 'team' && data.targetTeamId) {
      const team = await this.teamsService.getTeam(data.targetTeamId).catch(() => null);
      if (!team || team.projectId !== projectId) {
        throw new ValidationError('Referenced team does not belong to this project', {
          teamId: data.targetTeamId,
        });
      }
    }
    // Agent existence: best-effort (agent belongs to project via storage.getAgent).
  }
}
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `pnpm --filter devchain-local-app test -- auto-assign-rules.service.spec`
Expected: PASS (all listed tests).

- [ ] **Step 5: Commit**

```bash
git add apps/local-app/src/modules/auto-assign-rules/services/auto-assign-rules.service.ts apps/local-app/src/modules/auto-assign-rules/services/auto-assign-rules.service.spec.ts
git commit -m "feat(auto-assign): add AutoAssignRulesService resolver + CRUD with tests"
```

---

### Task B3: Controller + controller spec

**Files:**
- Create: `apps/local-app/src/modules/auto-assign-rules/controllers/auto-assign-rules.controller.ts`
- Test: `apps/local-app/src/modules/auto-assign-rules/controllers/auto-assign-rules.controller.spec.ts`

- [x] **Step 1: Write the failing controller spec**

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AutoAssignRulesController } from './auto-assign-rules.controller';
import { AutoAssignRulesService } from '../services/auto-assign-rules.service';

describe('AutoAssignRulesController', () => {
  let controller: AutoAssignRulesController;
  let service: { list: jest.Mock; create: jest.Mock; update: jest.Mock; delete: jest.Mock; reorder: jest.Mock };

  beforeEach(async () => {
    service = {
      list: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'r1' }),
      update: jest.fn().mockResolvedValue({ id: 'r1' }),
      delete: jest.fn().mockResolvedValue(undefined),
      reorder: jest.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AutoAssignRulesController],
      providers: [{ provide: AutoAssignRulesService, useValue: service }],
    }).compile();
    controller = module.get(AutoAssignRulesController);
  });

  it('lists rules for a project', async () => {
    await controller.list('p1');
    expect(service.list).toHaveBeenCalledWith('p1');
  });

  it('creates a valid rule', async () => {
    const body = {
      matchType: 'status', statusId: 's1', tags: null,
      targetType: 'agent', targetAgentId: 'a1', targetTeamId: null,
      overrideExisting: false, enabled: true,
    };
    await controller.create('p1', body);
    expect(service.create).toHaveBeenCalledWith('p1', expect.objectContaining({ matchType: 'status' }));
  });

  it('rejects a status rule missing statusId', async () => {
    await expect(
      controller.create('p1', {
        matchType: 'status', statusId: null, tags: null,
        targetType: 'agent', targetAgentId: 'a1', targetTeamId: null,
        overrideExisting: false, enabled: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a rule with both agent and team targets', async () => {
    await expect(
      controller.create('p1', {
        matchType: 'tag', statusId: null, tags: ['x'],
        targetType: 'agent', targetAgentId: 'a1', targetTeamId: 't1',
        overrideExisting: false, enabled: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updates and deletes by id', async () => {
    await controller.update('r1', { enabled: false });
    expect(service.update).toHaveBeenCalledWith('r1', { enabled: false });
    await controller.delete('r1');
    expect(service.delete).toHaveBeenCalledWith('r1');
  });

  it('reorders', async () => {
    await controller.reorder('p1', { items: [{ id: 'r1', priority: 0 }] });
    expect(service.reorder).toHaveBeenCalledWith('p1', [{ id: 'r1', priority: 0 }]);
  });
});
```

- [x] **Step 2: Run the spec to verify it fails**

Run: `pnpm --filter devchain-local-app test -- auto-assign-rules.controller.spec`
Expected: FAIL — module not found.

- [x] **Step 3: Implement the controller**

```ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { AutoAssignRulesService } from '../services/auto-assign-rules.service';
import {
  CreateEpicAssignmentRuleDtoSchema,
  UpdateEpicAssignmentRuleDtoSchema,
  ReorderEpicAssignmentRulesDtoSchema,
} from '../dtos/auto-assign-rule.dto';

@Controller('api/auto-assign-rules')
export class AutoAssignRulesController {
  constructor(private readonly service: AutoAssignRulesService) {}

  @Get()
  async list(@Query('projectId') projectId?: string) {
    if (!projectId) throw new BadRequestException('projectId is required');
    return this.service.list(projectId);
  }

  @Post()
  async create(@Query('projectId') projectId: string, @Body() body: unknown) {
    if (!projectId) throw new BadRequestException('projectId is required');
    const parsed = CreateEpicAssignmentRuleDtoSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ message: 'Validation failed', errors: parsed.error.errors });
    }
    return this.service.create(projectId, parsed.data);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const parsed = UpdateEpicAssignmentRuleDtoSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ message: 'Validation failed', errors: parsed.error.errors });
    }
    return this.service.update(id, parsed.data);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    await this.service.delete(id);
    return { success: true };
  }

  @Put('reorder')
  async reorder(@Query('projectId') projectId: string, @Body() body: unknown) {
    if (!projectId) throw new BadRequestException('projectId is required');
    const parsed = ReorderEpicAssignmentRulesDtoSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ message: 'Validation failed', errors: parsed.error.errors });
    }
    await this.service.reorder(projectId, parsed.data.items);
    return { success: true };
  }
}
```

Note: `Put` needs importing from `@nestjs/common` — add `Put` to the import list above.

- [x] **Step 4: Run the spec to verify it passes**

Run: `pnpm --filter devchain-local-app test -- auto-assign-rules.controller.spec`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/local-app/src/modules/auto-assign-rules/controllers/auto-assign-rules.controller.ts apps/local-app/src/modules/auto-assign-rules/controllers/auto-assign-rules.controller.spec.ts
git commit -m "feat(auto-assign): add REST controller + validation tests"
```

> **Implementation notes (B3):**
> - `Put` is imported from `@nestjs/common` (needed for `@Put('reorder')`).
> - This spec exposed two latent bugs in the B1 DTO (`auto-assign-rule.dto.ts`), fixed in
>   commit `a322dee` ("fix(auto-assign): optional priority + agent-XOR-team enforcement"):
>   1. `priority` is now optional in the create input — the service already auto-defaults it
>      to `max+1` (per `AutoAssignRulesService.create` + service spec). The plan/B1 had it required.
>   2. Enforced true agent-XOR-team mutual exclusivity (the other target id must be null) —
>      B1's `superRefine` only checked the "required" side, not the cross-check, despite
>      commit `6d9f109`'s message claiming "agent-XOR-team constraints".
> - Result: 6 controller tests + 12 service tests pass (18 total); lint clean for all touched
>   files; no new typecheck errors in `auto-assign-rules`.

---

### Task B4: Module + register in app

**Files:**
- Create: `apps/local-app/src/modules/auto-assign-rules/auto-assign-rules.module.ts`
- Modify: `apps/local-app/src/app.normal.module.ts`

- [ ] **Step 1: Create the module**

```ts
import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { TeamsModule } from '../teams/teams.module';
import { AutoAssignRulesController } from './controllers/auto-assign-rules.controller';
import { AutoAssignRulesService } from './services/auto-assign-rules.service';

@Module({
  imports: [StorageModule, TeamsModule],
  controllers: [AutoAssignRulesController],
  providers: [AutoAssignRulesService],
  exports: [AutoAssignRulesService],
})
export class AutoAssignRulesModule {}
```

- [ ] **Step 2: Register in `app.normal.module.ts`**

Add the import at the top (next to `ConnectorsModule`):
```ts
import { AutoAssignRulesModule } from './modules/auto-assign-rules/auto-assign-rules.module';
```
Add `AutoAssignRulesModule,` to the `imports` array (place it right after `ConnectorsModule,`).

- [ ] **Step 3: Verify the app boots in a quick test**

Run: `pnpm --filter devchain-local-app test -- events-domain.registration.integration` (an existing integration spec that boots the full app).
Expected: PASS — the DI graph resolves (proves `AutoAssignRulesService` can be injected and the module is wired).

- [ ] **Step 4: Commit**

```bash
git add apps/local-app/src/modules/auto-assign-rules/auto-assign-rules.module.ts apps/local-app/src/app.normal.module.ts
git commit -m "feat(auto-assign): register AutoAssignRulesModule in the app"
```

---

## Phase C — EpicsService hook

### Task C1: Inject resolver + fire on create

**Files:**
- Modify: `apps/local-app/src/modules/epics/epics.module.ts`
- Modify: `apps/local-app/src/modules/epics/services/epics.service.ts`
- Test: `apps/local-app/src/modules/epics/services/epics.service.spec.ts`

- [ ] **Step 1: Import `AutoAssignRulesModule` in `EpicsModule`**

In `epics.module.ts`, add `import { AutoAssignRulesModule } from '../auto-assign-rules/auto-assign-rules.module';` and add `AutoAssignRulesModule,` to the `imports` array.

- [ ] **Step 2: Write failing characterization tests in `epics.service.spec.ts`**

Append two tests inside the existing `describe('EpicsService', ...)` (or a new `describe` block). The test file already constructs `EpicsService` with mock dependencies — add an `autoAssign` mock to that factory. If the factory is positional, append `autoAssign` as the last arg and update every construction site; if the file uses an object mock, add the field. The two tests:

```ts
it('fires auto-assign on createEpic when not an auto-clean status', async () => {
  // storage.createEpic returns the epic as-is; autoAssign.resolveAssignment returns ag-X
  autoAssign.resolveAssignment.mockResolvedValue({ agentId: 'ag-X', ruleId: 'r1', skipped: null });
  settings.getAutoCleanStatusIds.mockReturnValue([]);
  await service.createEpic({ projectId: 'p', title: 'T', statusId: 'st-1', tags: [], description: null, data: null } as any);
  expect(storage.createEpic).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'ag-X' }));
});

it('does NOT auto-assign when the target status is auto-clean', async () => {
  autoAssign.resolveAssignment.mockResolvedValue({ agentId: 'ag-X', ruleId: 'r1', skipped: null });
  settings.getAutoCleanStatusIds.mockReturnValue(['st-1']); // st-1 is auto-clean
  await service.createEpic({ projectId: 'p', title: 'T', statusId: 'st-1', tags: [], description: null, data: null } as any);
  expect(autoAssign.resolveAssignment).not.toHaveBeenCalled();
  expect(storage.createEpic).toHaveBeenCalledWith(expect.objectContaining({ agentId: null }));
});
```

(`service`, `storage`, `settings`, `autoAssign` refer to the test harness's mocks — wire `autoAssign` as `{ resolveAssignment: jest.fn() }` and inject it.)

- [ ] **Step 3: Run the spec to verify the new tests fail**

Run: `pnpm --filter devchain-local-app test -- epics.service.spec`
Expected: FAIL — `resolveAssignment` not called / `agentId` not set.

- [ ] **Step 4: Implement the hook in `EpicsService`**

In the constructor signature, add (as the LAST parameter, marked optional so existing unit-test construction sites keep working):
```ts
@Optional() private readonly autoAssignRulesService?: AutoAssignRulesService,
```
Add imports at the top:
```ts
import { Optional } from '@nestjs/common';
import { AutoAssignRulesService } from '../../auto-assign-rules/services/auto-assign-rules.service';
```

Add a private helper:
```ts
private async resolveAutoAssign(
  projectId: string,
  statusId: string | undefined,
  tags: string[] | undefined | null,
  currentAgentId: string | null,
): Promise<string | null> {
  if (!this.autoAssignRulesService || !statusId) return currentAgentId;
  const autoCleanIds = this.settingsService.getAutoCleanStatusIds(projectId);
  if (autoCleanIds.includes(statusId)) return currentAgentId; // auto-clean wins
  const res = await this.autoAssignRulesService.resolveAssignment(
    { projectId, statusId, tags: tags ?? [], currentAgentId },
    currentAgentId === null ? 'create' : 'status_change',
  );
  return res.agentId ?? currentAgentId;
}
```

In `createEpic`, right after `this.applyAutoCleanIfNeeded(data.projectId, data.statusId, data);`, add:
```ts
if (data.statusId && !data.agentId) {
  const resolved = await this.resolveAutoAssign(data.projectId, data.statusId, data.tags, data.agentId ?? null);
  if (resolved) data.agentId = resolved;
}
```
Apply the SAME change to `createEpicForProject` (after its `applyAutoCleanIfNeeded` call). For `createEpicForProject`, the tags come from `input.tags`.

- [ ] **Step 5: Run the spec to verify the new tests pass**

Run: `pnpm --filter devchain-local-app test -- epics.service.spec`
Expected: PASS (new tests green; existing tests still green because `autoAssignRulesService` is `undefined` → helper returns `currentAgentId`).

- [ ] **Step 6: Commit**

```bash
git add apps/local-app/src/modules/epics/epics.module.ts apps/local-app/src/modules/epics/services/epics.service.ts apps/local-app/src/modules/epics/services/epics.service.spec.ts
git commit -m "feat(auto-assign): fire resolver on epic create (auto-clean wins)"
```

---

### Task C2: Fire on status change in `updateEpic`

**Files:**
- Modify: `apps/local-app/src/modules/epics/services/epics.service.ts`
- Test: `apps/local-app/src/modules/epics/services/epics.service.spec.ts`

- [ ] **Step 1: Write failing characterization tests**

```ts
it('auto-assigns when status changes to a matching status', async () => {
  storage.getEpic.mockResolvedValue({ id: 'e1', projectId: 'p', statusId: 'old', agentId: null, tags: ['x'], version: 1 });
  storage.updateEpic.mockImplementation(async (_id: string, data: any) => ({ id: 'e1', projectId: 'p', statusId: data.statusId ?? 'old', agentId: data.agentId ?? null, tags: ['x'], version: 2 } as any));
  autoAssign.resolveAssignment.mockResolvedValue({ agentId: 'ag-Y', ruleId: 'r2', skipped: null });
  settings.getAutoCleanStatusIds.mockReturnValue([]);
  await service.updateEpic('e1', { statusId: 'st-2' }, 1);
  expect(autoAssign.resolveAssignment).toHaveBeenCalledWith(expect.objectContaining({ statusId: 'st-2' }), 'status_change');
  expect(storage.updateEpic).toHaveBeenCalledWith('e1', expect.objectContaining({ statusId: 'st-2', agentId: 'ag-Y' }), 1);
});

it('skips auto-assign on status change to an auto-clean status', async () => {
  storage.getEpic.mockResolvedValue({ id: 'e1', projectId: 'p', statusId: 'old', agentId: 'ag-old', tags: [], version: 1 });
  storage.updateEpic.mockResolvedValue({ id: 'e1', projectId: 'p', statusId: 'done', agentId: null, tags: [], version: 2 } as any);
  settings.getAutoCleanStatusIds.mockReturnValue(['done']);
  await service.updateEpic('e1', { statusId: 'done' }, 1);
  expect(autoAssign.resolveAssignment).not.toHaveBeenCalled();
});

it('does not auto-assign when only tags change (no status change)', async () => {
  storage.getEpic.mockResolvedValue({ id: 'e1', projectId: 'p', statusId: 'st-1', agentId: null, tags: [], version: 1 });
  storage.updateEpic.mockResolvedValue({ id: 'e1', projectId: 'p', statusId: 'st-1', agentId: null, tags: ['new'], version: 2 } as any);
  settings.getAutoCleanStatusIds.mockReturnValue([]);
  await service.updateEpic('e1', { tags: ['new'] } as any, 1);
  expect(autoAssign.resolveAssignment).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the spec to verify the new tests fail**

Run: `pnpm --filter devchain-local-app test -- epics.service.spec`
Expected: FAIL.

- [ ] **Step 3: Implement the hook in `updateEpic`**

In `EpicsService.updateEpic`, the existing block is:
```ts
// Clear agentId if moving to an auto-clean status
if (data.statusId !== undefined && data.statusId !== before.statusId) {
  this.applyAutoCleanIfNeeded(before.projectId, data.statusId, data);
}

const updated = await this.storage.updateEpic(id, data, expectedVersion);
```
Replace with:
```ts
const statusChanged = data.statusId !== undefined && data.statusId !== before.statusId;
if (statusChanged) {
  this.applyAutoCleanIfNeeded(before.projectId, data.statusId, data);
}

if (statusChanged && data.agentId === undefined) {
  const resolved = await this.resolveAutoAssign(
    before.projectId,
    data.statusId,
    before.tags,
    data.agentId ?? before.agentId,
  );
  if (resolved !== (data.agentId ?? before.agentId)) {
    data.agentId = resolved;
  }
}

const updated = await this.storage.updateEpic(id, data, expectedVersion);
```

(`data.agentId === undefined` guard ensures an explicit assignment in the same payload isn't clobbered; `before.tags` are used per spec §4.2 — tags edits don't re-fire, so we read the pre-update tags.)

- [ ] **Step 4: Run the spec to verify the new tests pass**

Run: `pnpm --filter devchain-local-app test -- epics.service.spec`
Expected: PASS (all epics service tests green).

- [ ] **Step 5: Commit**

```bash
git add apps/local-app/src/modules/epics/services/epics.service.ts apps/local-app/src/modules/epics/services/epics.service.spec.ts
git commit -m "feat(auto-assign): fire resolver on status change (skip tag-only changes & auto-clean)"
```

---

### Task C3: Verify bulk + cascade paths

- [ ] **Step 1: Confirm `bulkUpdateEpics` routes through `updateEpic`**

`bulkUpdateEpics` already calls `this.updateEpic(...)` per epic (verified in the existing source). So no code change is needed. Add ONE characterization test asserting an auto-assign happens during a bulk status-only change:

```ts
it('bulkUpdateEpics inherits auto-assign via updateEpic', async () => {
  storage.getEpic.mockResolvedValue({ id: 'e1', projectId: 'p', statusId: 'old', agentId: null, tags: [], version: 1 });
  storage.updateEpic.mockResolvedValue({ id: 'e1', projectId: 'p', statusId: 'st-2', agentId: 'ag-Y', tags: [], version: 2 } as any);
  autoAssign.resolveAssignment.mockResolvedValue({ agentId: 'ag-Y', ruleId: 'r3', skipped: null });
  settings.getAutoCleanStatusIds.mockReturnValue([]);
  await service.bulkUpdateEpics([{ id: 'e1', statusId: 'st-2', version: 1 }]);
  expect(autoAssign.resolveAssignment).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the full epics spec + cascade-clear spec**

Run:
```bash
pnpm --filter devchain-local-app test -- epics.service.spec
pnpm --filter devchain-local-app test -- epic-assignment-notifier
```
Expected: PASS (auto-assign and the existing notifier both work; cascade-clear unaffected because the parent's auto-clean status skips auto-assign).

- [ ] **Step 3: Commit**

```bash
git add apps/local-app/src/modules/epics/services/epics.service.spec.ts
git commit -m "test(auto-assign): cover bulkUpdateEpics auto-assign path"
```

---

## Phase D — UI

### Task D1: `AutoAssignRulesCard` component + tests (TDD)

**Files:**
- Create: `apps/local-app/src/ui/components/board/AutoAssignRulesCard.tsx`
- Test: `apps/local-app/src/ui/components/board/AutoAssignRulesCard.spec.tsx`

- [ ] **Step 1: Write the failing component spec**

```tsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AutoAssignRulesCard } from './AutoAssignRulesCard';

const statuses = [
  { id: 'st-1', label: 'In Progress', color: '#3b82f6' },
  { id: 'st-2', label: 'Review', color: '#a855f7' },
];
const agents = [{ id: 'ag-1', name: 'Coder' }];
const teams = [{ id: 'team-1', name: 'Builders', teamLeadAgentName: 'Architect' }];

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

describe('AutoAssignRulesCard', () => {
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/api/auto-assign-rules') && method === 'GET') {
        return { ok: true, json: async () => ([
          { id: 'r1', projectId: 'p', matchType: 'status', statusId: 'st-1', tags: null, targetType: 'team', targetAgentId: null, targetTeamId: 'team-1', overrideExisting: false, priority: 0, enabled: true, createdAt: '', updatedAt: '' },
        ]) } as Response;
      }
      if (url.includes('/api/statuses')) return { ok: true, json: async () => ({ items: statuses }) } as Response;
      if (url.includes('/api/agents')) return { ok: true, json: async () => ({ items: agents }) } as Response;
      if (url.includes('/api/teams')) return { ok: true, json: async () => ({ items: teams }) } as Response;
      return { ok: true, json: async () => ({}) } as Response;
    }) as jest.Mock;
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('renders the card title and one existing rule row', async () => {
    render(<Wrapper><AutoAssignRulesCard projectId="p" /></Wrapper>);
    await waitFor(() => expect(screen.getByText('Auto-assign rules')).toBeInTheDocument());
    expect(await screen.findByText(/Builders/)).toBeInTheDocument();
  });

  it('opens the add-rule form on Add rule click', async () => {
    render(<Wrapper><AutoAssignRulesCard projectId="p" /></Wrapper>);
    await waitFor(() => expect(screen.getByText('Add rule')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Add rule'));
    expect(await screen.findByText('Save rule')).toBeInTheDocument();
  });

  it('shows an "invalid" badge for a stale status rule', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/auto-assign-rules') && !url.includes('method')) {
        return { ok: true, json: async () => ([
          { id: 'r1', projectId: 'p', matchType: 'status', statusId: 'gone', tags: null, targetType: 'agent', targetAgentId: 'ag-1', targetTeamId: null, overrideExisting: false, priority: 0, enabled: true, createdAt: '', updatedAt: '' },
        ]) } as Response;
      }
      if (url.includes('/api/statuses')) return { ok: true, json: async () => ({ items: statuses }) } as Response;
      if (url.includes('/api/agents')) return { ok: true, json: async () => ({ items: agents }) } as Response;
      if (url.includes('/api/teams')) return { ok: true, json: async () => ({ items: teams }) } as Response;
      return { ok: true, json: async () => ({}) } as Response;
    });
    render(<Wrapper><AutoAssignRulesCard projectId="p" /></Wrapper>);
    expect(await screen.findByText(/invalid/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm --filter devchain-local-app test -- AutoAssignRulesCard.spec`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `AutoAssignRulesCard.tsx`. It owns its own `useQuery(['auto-assign-rules', projectId])` + mutations, mirrors the fetch/error pattern from `StatusesPage`, and uses shadcn `Card`, `Button`, `Switch`, `Select`, `Badge`. Skeleton:

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { Switch } from '@/ui/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { useToast } from '@/ui/hooks/use-toast';

interface Rule {
  id: string; projectId: string; matchType: 'status' | 'tag';
  statusId: string | null; tags: string[] | null;
  targetType: 'agent' | 'team'; targetAgentId: string | null; targetTeamId: string | null;
  overrideExisting: boolean; priority: number; enabled: boolean;
  createdAt: string; updatedAt: string;
}
interface Status { id: string; label: string; color: string }
interface Agent { id: string; name: string }
interface TeamLite { id: string; name: string; teamLeadAgentName: string | null }

const err = (m: string) => async () => { const e = await (await Promise.resolve({} as any)).json?.().catch?.(() => ({ message: m })); throw new Error(e?.message || m); };

async function getJSON(res: Response, fallback: string) {
  if (!res.ok) { const e = await res.json().catch(() => ({ message: fallback })); throw new Error(e.message || fallback); }
  return res.json();
}

export function AutoAssignRulesCard({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);

  const { data: rules = [] } = useQuery<Rule[]>({
    queryKey: ['auto-assign-rules', projectId],
    queryFn: async () => getJSON(await fetch(`/api/auto-assign-rules?projectId=${projectId}`), 'Failed to load rules'),
    enabled: !!projectId,
  });
  const { data: statuses = [] } = useQuery<Status[]>({
    queryKey: ['statuses', projectId],
    queryFn: async () => (await getJSON(await fetch(`/api/statuses?projectId=${projectId}`), 'Failed to load statuses')).items,
  });
  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ['agents', projectId],
    queryFn: async () => (await getJSON(await fetch(`/api/agents?projectId=${projectId}`), 'Failed to load agents')).items,
  });
  const { data: teams = [] } = useQuery<TeamLite[]>({
    queryKey: ['teams', projectId],
    queryFn: async () => (await getJSON(await fetch(`/api/teams?projectId=${projectId}`), 'Failed to load teams')).items,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['auto-assign-rules', projectId] });

  const del = useMutation({
    mutationFn: async (id: string) => { const r = await fetch(`/api/auto-assign-rules/${id}`, { method: 'DELETE' }); await getJSON(r, 'Failed to delete rule'); },
    onSuccess: invalidate,
    onError: (e) => toast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed to delete rule', variant: 'destructive' }),
  });
  const toggle = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const r = await fetch(`/api/auto-assign-rules/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
      await getJSON(r, 'Failed to update rule');
    },
    onSuccess: invalidate,
    onError: (e) => toast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed to update rule', variant: 'destructive' }),
  });

  const statusLabel = (id: string | null) => statuses.find((s) => s.id === id)?.label ?? null;
  const teamName = (id: string | null) => teams.find((t) => t.id === id);
  const agentName = (id: string | null) => agents.find((a) => a.id === id)?.name ?? null;
  const isStale = (r: Rule) =>
    (r.matchType === 'status' && r.statusId && !statusLabel(r.statusId)) ||
    (r.targetType === 'agent' && r.targetAgentId && !agentName(r.targetAgentId)) ||
    (r.targetType === 'team' && r.targetTeamId && !teamName(r.targetTeamId));

  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Auto-assign rules</CardTitle>
          <CardDescription>
            Automatically assign epics when they're created or move to a status. Rules skip on auto-clean statuses. First matching rule wins.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowForm((v) => !v)}>
          <Plus className="h-4 w-4 mr-1.5" /> Add rule
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {rules.length === 0 && <p className="text-sm text-muted-foreground">No rules yet.</p>}
        {rules.map((r) => (
          <div key={r.id} className="flex items-center gap-2 p-3 border rounded-md">
            <GripVertical className="h-4 w-4 text-muted-foreground" />
            {r.matchType === 'status' ? (
              <Badge variant="secondary">Status · {statusLabel(r.statusId) ?? '—'}</Badge>
            ) : (
              <Badge variant="secondary">Tag · {(r.tags ?? []).join(', ')}</Badge>
            )}
            <span className="text-muted-foreground">→</span>
            {r.targetType === 'agent' ? (
              <span className="text-sm">{agentName(r.targetAgentId) ?? 'Unknown agent'}</span>
            ) : (
              <span className="text-sm">👥 {teamName(r.targetTeamId)?.name ?? 'Unknown team'}
                {teamName(r.targetTeamId)?.teamLeadAgentName ? ` (lead: ${teamName(r.targetTeamId)!.teamLeadAgentName})` : ''}
              </span>
            )}
            {r.overrideExisting && <Badge variant="outline">override</Badge>}
            {isStale(r) && <Badge variant="destructive">invalid</Badge>}
            <div className="ml-auto flex items-center gap-2">
              <Switch checked={r.enabled} onCheckedChange={(v) => toggle.mutate({ id: r.id, enabled: v })} aria-label="Toggle rule" />
              <Button variant="ghost" size="icon" aria-label="Delete rule" onClick={() => del.mutate(r.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
        {showForm && (
          <AutoAssignRuleForm
            projectId={projectId}
            statuses={statuses}
            agents={agents}
            teams={teams}
            onSaved={() => { setShowForm(false); invalidate(); }}
            onCancel={() => setShowForm(false)}
          />
        )}
      </CardContent>
    </Card>
  );
}

// Internal form component (kept in the same file for cohesion)
function AutoAssignRuleForm({ projectId, statuses, agents, teams, onSaved, onCancel }: {
  projectId: string;
  statuses: Status[]; agents: Agent[]; teams: TeamLite[];
  onSaved: () => void; onCancel: () => void;
}) {
  const { toast } = useToast();
  const [matchType, setMatchType] = useState<'status' | 'tag'>('status');
  const [statusId, setStatusId] = useState<string>(statuses[0]?.id ?? '');
  const [tags, setTags] = useState<string>('');
  const [targetType, setTargetType] = useState<'agent' | 'team'>('agent');
  const [targetAgentId, setTargetAgentId] = useState<string>(agents[0]?.id ?? '');
  const [targetTeamId, setTargetTeamId] = useState<string>(teams[0]?.id ?? '');
  const [overrideExisting, setOverrideExisting] = useState(false);

  const m = useMutation({
    mutationFn: async () => {
      const body = {
        matchType,
        statusId: matchType === 'status' ? statusId : null,
        tags: matchType === 'tag' ? tags.split(',').map((t) => t.trim()).filter(Boolean) : null,
        targetType,
        targetAgentId: targetType === 'agent' ? targetAgentId : null,
        targetTeamId: targetType === 'team' ? targetTeamId : null,
        overrideExisting,
        enabled: true,
      };
      const r = await fetch(`/api/auto-assign-rules?projectId=${projectId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      await getJSON(r, 'Failed to create rule');
    },
    onSuccess: onSaved,
    onError: (e) => toast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed to create rule', variant: 'destructive' }),
  });

  return (
    <div className="p-3 border rounded-md space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Match by</Label>
          <Select value={matchType} onValueChange={(v) => setMatchType(v as 'status' | 'tag')}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="status">Status (column)</SelectItem>
              <SelectItem value="tag">Tag (label)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {matchType === 'status' ? (
          <div>
            <Label>Status</Label>
            <Select value={statusId} onValueChange={setStatusId}>
              <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
              <SelectContent>{statuses.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        ) : (
          <div>
            <Label>Tags (comma-separated; matches any)</Label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="frontend, ui" />
          </div>
        )}
        <div>
          <Label>Assign to</Label>
          <Select value={targetType} onValueChange={(v) => setTargetType(v as 'agent' | 'team')}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="agent">Agent</SelectItem>
              <SelectItem value="team">Team (lead)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {targetType === 'agent' ? (
          <div>
            <Label>Agent</Label>
            <Select value={targetAgentId} onValueChange={setTargetAgentId}>
              <SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger>
              <SelectContent>{agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        ) : (
          <div>
            <Label>Team</Label>
            <Select value={targetTeamId} onValueChange={setTargetTeamId}>
              <SelectTrigger><SelectValue placeholder="Select team" /></SelectTrigger>
              <SelectContent>{teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={overrideExisting} onCheckedChange={setOverrideExisting} />
        Override existing assignment
      </label>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => m.mutate()} disabled={m.isPending}>Save rule</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `pnpm --filter devchain-local-app test -- AutoAssignRulesCard.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/local-app/src/ui/components/board/AutoAssignRulesCard.tsx apps/local-app/src/ui/components/board/AutoAssignRulesCard.spec.tsx
git commit -m "feat(auto-assign): add AutoAssignRulesCard UI with add/delete/toggle"
```

---

### Task D2: Render the card on `StatusesPage`

**Files:**
- Modify: `apps/local-app/src/ui/pages/StatusesPage.tsx`

- [ ] **Step 1: Import and render the card**

Add the import at the top:
```tsx
import { AutoAssignRulesCard } from '@/ui/components/board/AutoAssignRulesCard';
```

Inside the render, in the `selectedProjectId && statusesData` block, right after the `<StatusList ... />` block (around line 607), add:
```tsx
<AutoAssignRulesCard projectId={selectedProjectId} />
```

- [ ] **Step 2: Verify it renders (existing spec still green + quick build)**

Run:
```bash
pnpm --filter devchain-local-app test -- StatusesPage.archive-protection
pnpm --filter devchain-local-app build
```
Expected: existing spec PASS; build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/local-app/src/ui/pages/StatusesPage.tsx
git commit -m "feat(auto-assign): show AutoAssignRulesCard on the Statuses page"
```

---

### Task D3: Board toolbar link button

**Files:**
- Modify: `apps/local-app/src/ui/components/board/BoardToolbar.tsx`

- [ ] **Step 1: Add the link button**

Add imports at the top:
```tsx
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
```
(`Sparkles` is already used elsewhere for auto-clean; reuse it here for visual kinship.)

At the end of the toolbar's returned `<div className="flex items-center gap-2">` (after the Columns popover), add:
```tsx
<Button asChild variant="outline" size="sm" aria-label="Auto-assign rules">
  <Link to="/statuses#auto-assign">
    <Sparkles className="h-4 w-4 mr-1.5" />
    Auto-assign
  </Link>
</Button>
```

- [ ] **Step 2: Add the `id="auto-assign"` anchor target on the card**

In `AutoAssignRulesCard.tsx`, add `id="auto-assign"` to the `<Card>` element so the `#auto-assign` URL fragment scrolls to it.

- [ ] **Step 3: Verify build**

Run: `pnpm --filter devchain-local-app build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/local-app/src/ui/components/board/BoardToolbar.tsx apps/local-app/src/ui/components/board/AutoAssignRulesCard.tsx
git commit -m "feat(auto-assign): add board-toolbar link to the rules card"
```

---

## Phase E — Docs & final verification

### Task E1: User-facing feature doc

**Files:**
- Create: `docs/board-auto-assign-rules.md`

- [ ] **Step 1: Write the doc**

```markdown
# Board Auto-assign Rules

Auto-assign rules automatically route epics to an agent or a team's lead as epics move through your board. Configure them per project on the **Statuses** page.

## How rules work

- Each rule matches on **either a status (column) or a tag** — not both.
- A rule's target is **either a specific agent or a team** (the team lead takes the epic).
- Rules fire when an epic is **created** or **moves to a new status**. Editing tags alone does not re-fire rules.
- If an epic is already assigned, a rule with **Override existing assignment** off will skip it; turning override on forces re-assignment.
- **Auto-clean statuses win**: when an epic moves to an auto-clean status its assignee is cleared and rules do not fire.
- When several rules match, the **first one in priority order** wins (reorder by drag).

## Configuring

1. Open a project and go to **Statuses**.
2. Find the **Auto-assign rules** card and click **Add rule**.
3. Choose match by **Status** or **Tag**, pick the target, and save.

## Stale rules

If a rule references a status, agent, or team that has since been deleted, it shows an **invalid** badge and is skipped at fire time. Delete it or re-point it.
```

- [ ] **Step 2: Commit**

```bash
git add docs/board-auto-assign-rules.md
git commit -m "docs(auto-assign): add user-facing feature doc"
```

---

### Task E2: Full lint, typecheck, test pass

- [ ] **Step 1: Run the project's verification commands**

Run from repo root:
```bash
pnpm --filter devchain-local-app lint
pnpm --filter devchain-local-app typecheck
pnpm --filter devchain-local-app test
```
Expected: all green. Fix any issues introduced by the new code.

- [ ] **Step 2: Smoke-test the running app**

```bash
pnpm --filter devchain-local-app build
```
Expected: build succeeds.

- [ ] **Step 3: Manual smoke test (optional but recommended)**

Start the app, open a project, go to **Statuses**, create a rule (status → an agent), then create an epic in that status on the board and confirm it's auto-assigned. Move the epic to an auto-clean status and confirm the assignee is cleared (rule did not re-fire).

- [ ] **Step 4: Final commit (if any fixes)**

```bash
git add -A
git commit -m "chore(auto-assign): final lint/type fixes"
```

---

## Self-review notes

**Spec coverage check (spec section → task):**
- §2 Behavior (matcher/target/override/auto-clean/conflict) → B2 (resolver tests), C1/C2 (hook tests)
- §3 Data model → A1 (domain), A2 (schema/migration)
- §4 Service layer (resolver + hook + order) → A4/B2 (service), C1/C2 (hook)
- §5 API → B1 (DTO), B3 (controller)
- §6 UI (Statuses card + toolbar link + stale badge) → D1/D2/D3
- §7 Edge cases (stale refs, no-lead, bulk, agent-initiated) → B2 tests + C3
- §8 Non-goals — explicitly excluded; nothing to build
- §9 Testing strategy — covered by the test steps in A4, A6, B2, B3, C1, C2, C3, D1

**Type consistency check:**
- `EpicAssignmentRule` field names (`matchType`, `statusId`, `tags`, `targetType`, `targetAgentId`, `targetTeamId`, `overrideExisting`, `priority`, `enabled`) match across domain model, schema, delegate, service, DTO, and UI.
- Resolver method name is `resolveAssignment` everywhere (service, EpicsService call, tests).
- Controller route prefix is `api/auto-assign-rules` in both controller and UI fetch URLs.
- `listEpicAssignmentRules` orders by priority asc — relied on by the resolver and the "first wins" tests.

**Known plan risks (flag, don't fix here):**
- `epics.service.spec.ts` harness shape (positional vs object mocks) determines exactly how the `autoAssign` mock is injected in C1 — the implementer must match the existing harness; the plan gives the test bodies but the wiring is "append to existing factory."
- Drizzle's generated SQL for `tags` JSON column must store arrays; verify via the delegate spec (A4) which round-trips `tags`.
- The `Put` import in the controller (B3) must be added to the `@nestjs/common` import list — called out inline.
