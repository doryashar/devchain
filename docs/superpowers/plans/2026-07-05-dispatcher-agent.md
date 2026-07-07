# Dispatcher Agent & Dispatch Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Dispatcher" intake/triage agent and a "Dispatch" board status to both built-in templates, plus extend the template export schema so auto-assign rules ship inside templates (pre-configuring `Dispatch → Dispatcher`).

**Architecture:** Template-driven (Approach B). Extend `ExportSchema` with an `autoAssignRules[]` field; add an import helper that resolves rule labels/names to IDs and creates rules via the existing storage delegate; add an export helper for round-trip; add the Dispatcher agent/profile/SOP prompt + Dispatch status + rule to both template JSON files. No new backend modules, MCP tools, events, or DB tables.

**Tech Stack:** TypeScript, NestJS (local-app), Zod (`@devchain/shared`), Jest (local-app tests), Vitest (shared tests), Drizzle/SQLite (storage — no migration needed), pnpm workspace monorepo.

**Spec:** `docs/superpowers/specs/2026-07-05-dispatcher-agent-design.md`

---

## File Structure

**Modify:**
- `packages/shared/src/schemas/export-schema.ts` — add `autoAssignRules[]` field to `ExportSchema`
- `packages/shared/src/schemas/export-schema.spec.ts` — add parse/validation tests
- `apps/local-app/src/modules/projects/helpers/project-import.ts` — new exported `createImportedAutoAssignRules()` helper + call in `importProjectWithHelper`
- `apps/local-app/src/modules/projects/helpers/project-import.spec.ts` — tests for the new helper
- `apps/local-app/src/modules/projects/helpers/template-loader.ts` — call `createImportedAutoAssignRules` in `createFromTemplateWithHelper`
- `apps/local-app/src/modules/projects/helpers/project-export.ts` — new `buildExportAutoAssignRules()` + wire into return
- `apps/local-app/src/modules/projects/services/projects.export.spec.ts` — export tests
- `apps/local-app/templates/teams-dev.json` — Dispatch status (renumber), Dispatcher prompt/profile/agent, `autoAssignRules[]`, preset entries
- `apps/local-app/templates/3-agents-dev.json` — same additions
- `apps/local-app/src/common/template-default-provider.spec.ts` — smoke test for the new template contents + `ExportSchema.parse`

**Create:**
- `docs/dispatcher-agent.md` — user-facing doc for the Dispatcher + Dispatch status

---

## Task 1: Add `autoAssignRules[]` to ExportSchema

**Files:**
- Modify: `packages/shared/src/schemas/export-schema.ts` (insert before the `_manifest` field, ~line 300)
- Test: `packages/shared/src/schemas/export-schema.spec.ts` (new `describe` block before the final closing `});` at ~line 1072)

- [ ] **Step 1: Write the failing tests**

Open `packages/shared/src/schemas/export-schema.spec.ts`, locate the final closing `});` of the top-level `describe('ExportSchema', ...)` (around line 1072), and insert this block **immediately before** it:

```ts
  describe('autoAssignRules', () => {
    it('defaults to [] when absent', () => {
      const result = ExportSchema.safeParse({ version: 1 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.autoAssignRules).toEqual([]);
      }
    });

    it('parses a valid status→agent rule', () => {
      const result = ExportSchema.safeParse({
        version: 1,
        autoAssignRules: [
          {
            matchType: 'status',
            statusLabel: 'Dispatch',
            tags: null,
            targetType: 'agent',
            targetAgentName: 'Dispatcher',
            targetTeamName: null,
            overrideExisting: false,
            enabled: true,
          },
        ],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.autoAssignRules).toHaveLength(1);
        expect(result.data.autoAssignRules[0]).toMatchObject({
          matchType: 'status',
          statusLabel: 'Dispatch',
          targetType: 'agent',
          targetAgentName: 'Dispatcher',
          overrideExisting: false,
          enabled: true,
        });
      }
    });

    it('parses a valid tag→team rule', () => {
      const result = ExportSchema.safeParse({
        version: 1,
        autoAssignRules: [
          {
            matchType: 'tag',
            tags: ['frontend'],
            targetType: 'team',
            targetTeamName: 'Builders',
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('rejects status rule without statusLabel', () => {
      const result = ExportSchema.safeParse({
        version: 1,
        autoAssignRules: [
          { matchType: 'status', targetType: 'agent', targetAgentName: 'X' },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('rejects tag rule with empty tags', () => {
      const result = ExportSchema.safeParse({
        version: 1,
        autoAssignRules: [
          { matchType: 'tag', tags: [], targetType: 'agent', targetAgentName: 'X' },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('rejects agent target without targetAgentName', () => {
      const result = ExportSchema.safeParse({
        version: 1,
        autoAssignRules: [
          { matchType: 'status', statusLabel: 'New', targetType: 'agent' },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('rejects team target without targetTeamName', () => {
      const result = ExportSchema.safeParse({
        version: 1,
        autoAssignRules: [
          { matchType: 'status', statusLabel: 'New', targetType: 'team' },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('rejects unknown keys (strict)', () => {
      const result = ExportSchema.safeParse({
        version: 1,
        autoAssignRules: [
          {
            matchType: 'status',
            statusLabel: 'New',
            targetType: 'agent',
            targetAgentName: 'X',
            bogus: true,
          },
        ],
      });
      expect(result.success).toBe(false);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter shared test`
Expected: FAIL — the parsed data has no `autoAssignRules` (defaults test fails) and the structural-parse tests fail because the field is unknown to the strict schema.

- [ ] **Step 3: Add the `autoAssignRules` field**

In `packages/shared/src/schemas/export-schema.ts`, find the `scheduledEpics` block (ends ~line 298 with `.optional().default([]),`) and the `_manifest` line (~line 300). Insert this new field **between** them:

```ts
    // Auto-assign rules (uses labels/names for portability, resolved to IDs on import)
    autoAssignRules: z
      .array(
        z
          .object({
            matchType: z.enum(['status', 'tag']),
            statusLabel: z.string().nullable().optional(),
            tags: z.array(z.string()).nullable().optional(),
            targetType: z.enum(['agent', 'team']),
            targetAgentName: z.string().nullable().optional(),
            targetTeamName: z.string().nullable().optional(),
            overrideExisting: z.boolean().optional().default(false),
            enabled: z.boolean().optional().default(true),
          })
          .strict()
          .superRefine((rule, ctx) => {
            if (rule.matchType === 'status' && !rule.statusLabel) {
              ctx.addIssue({
                code: 'custom',
                message: "statusLabel is required when matchType='status'",
                path: ['statusLabel'],
              });
            }
            if (rule.matchType === 'tag' && (!rule.tags || rule.tags.length === 0)) {
              ctx.addIssue({
                code: 'custom',
                message: 'tags (non-empty) is required when matchType=tag',
                path: ['tags'],
              });
            }
            if (rule.targetType === 'agent' && !rule.targetAgentName) {
              ctx.addIssue({
                code: 'custom',
                message: "targetAgentName is required when targetType='agent'",
                path: ['targetAgentName'],
              });
            }
            if (rule.targetType === 'team' && !rule.targetTeamName) {
              ctx.addIssue({
                code: 'custom',
                message: "targetTeamName is required when targetType='team'",
                path: ['targetTeamName'],
              });
            }
          }),
      )
      .optional()
      .default([]),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter shared test`
Expected: PASS — all 8 new cases pass.

- [ ] **Step 5: Lint + build the shared package**

Run: `pnpm --filter shared lint && pnpm --filter shared build`
Expected: no lint errors; build emits updated `dist/` (the local-app consumes `@devchain/shared` from `dist/`, so this build is required before local-app typechecks against the new field).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/schemas/export-schema.ts packages/shared/src/schemas/export-schema.spec.ts packages/shared/dist
git commit -m "feat(shared): add autoAssignRules[] to ExportSchema"
```

---

## Task 2: Import helper `createImportedAutoAssignRules`

**Files:**
- Modify: `apps/local-app/src/modules/projects/helpers/project-import.ts` (new exported function near `createImportedScheduledEpics` ~line 1607; new call block in `importProjectWithHelper` between lines 266–268)
- Modify: `apps/local-app/src/modules/projects/helpers/template-loader.ts` (new call block between lines 407–409)
- Test: `apps/local-app/src/modules/projects/helpers/project-import.spec.ts` (new describe block)

- [ ] **Step 1: Write the failing tests**

Open `apps/local-app/src/modules/projects/helpers/project-import.spec.ts`. At the top, ensure `createImportedAutoAssignRules` is imported (add to the existing import from `./project-import`):

```ts
import {
  // ...existing imports...
  createImportedAutoAssignRules,
} from './project-import';
```

(If `./project-import` is not yet imported in this file, add the import. Check the existing imports first and append `createImportedAutoAssignRules` to them.)

Append this describe block at the end of the file (before the final closing `});` of the outermost describe, or at top level if the file has no wrapping describe):

```ts
describe('createImportedAutoAssignRules', () => {
  function makeStorageMock() {
    return {
      createEpicAssignmentRule: jest.fn().mockResolvedValue({ id: 'rule-1' }),
    };
  }
  function makeTeamsServiceMock(teams: Array<{ id: string; name: string }> = []) {
    return { listTeams: jest.fn().mockResolvedValue(teams) };
  }

  it('creates a status→agent rule resolving label and name to ids, priority by array index', async () => {
    const storage = makeStorageMock();
    const created = await createImportedAutoAssignRules(
      'proj-1',
      [
        {
          matchType: 'status' as const,
          statusLabel: 'Dispatch',
          tags: null,
          targetType: 'agent' as const,
          targetAgentName: 'Dispatcher',
          targetTeamName: null,
          overrideExisting: false,
          enabled: true,
        },
      ],
      {
        statusLabelToId: new Map([['dispatch', 'status-dispatch']]),
        agentNameToId: new Map([['dispatcher', 'agent-dispatcher']]),
      },
      {
        storage: storage as unknown as any,
        teamsService: makeTeamsServiceMock() as unknown as any,
      },
    );

    expect(created).toBe(1);
    expect(storage.createEpicAssignmentRule).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj-1',
        matchType: 'status',
        statusId: 'status-dispatch',
        targetType: 'agent',
        targetAgentId: 'agent-dispatcher',
        targetTeamId: null,
        overrideExisting: false,
        enabled: true,
        priority: 0,
      }),
    );
  });

  it('skips with warning and does not create when status label is unknown', async () => {
    const storage = makeStorageMock();
    const created = await createImportedAutoAssignRules(
      'proj-1',
      [
        {
          matchType: 'status' as const,
          statusLabel: 'Missing',
          tags: null,
          targetType: 'agent' as const,
          targetAgentName: 'Dispatcher',
          targetTeamName: null,
          overrideExisting: false,
          enabled: true,
        },
      ],
      {
        statusLabelToId: new Map([['dispatch', 'status-dispatch']]),
        agentNameToId: new Map([['dispatcher', 'agent-dispatcher']]),
      },
      {
        storage: storage as unknown as any,
        teamsService: makeTeamsServiceMock() as unknown as any,
      },
    );

    expect(created).toBe(0);
    expect(storage.createEpicAssignmentRule).not.toHaveBeenCalled();
  });

  it('skips when agent target name is unknown', async () => {
    const storage = makeStorageMock();
    const created = await createImportedAutoAssignRules(
      'proj-1',
      [
        {
          matchType: 'status' as const,
          statusLabel: 'Dispatch',
          tags: null,
          targetType: 'agent' as const,
          targetAgentName: 'Ghost',
          targetTeamName: null,
          overrideExisting: false,
          enabled: true,
        },
      ],
      {
        statusLabelToId: new Map([['dispatch', 'status-dispatch']]),
        agentNameToId: new Map([['dispatcher', 'agent-dispatcher']]),
      },
      { storage: storage as unknown as any, teamsService: null as unknown as any },
    );

    expect(created).toBe(0);
    expect(storage.createEpicAssignmentRule).not.toHaveBeenCalled();
  });

  it('creates a tag→team rule resolving team name via teamsService', async () => {
    const storage = makeStorageMock();
    const created = await createImportedAutoAssignRules(
      'proj-1',
      [
        {
          matchType: 'tag' as const,
          tags: ['frontend'],
          statusLabel: null,
          targetType: 'team' as const,
          targetTeamName: 'Builders',
          targetAgentName: null,
          overrideExisting: true,
          enabled: true,
        },
      ],
      {
        statusLabelToId: new Map(),
        agentNameToId: new Map(),
      },
      {
        storage: storage as unknown as any,
        teamsService: makeTeamsServiceMock([{ id: 'team-builders', name: 'Builders' }]) as unknown as any,
      },
    );

    expect(created).toBe(1);
    expect(storage.createEpicAssignmentRule).toHaveBeenCalledWith(
      expect.objectContaining({
        matchType: 'tag',
        tags: ['frontend'],
        targetType: 'team',
        targetTeamId: 'team-builders',
        overrideExisting: true,
        priority: 0,
      }),
    );
  });

  it('returns 0 and creates nothing when rules array is empty', async () => {
    const storage = makeStorageMock();
    const created = await createImportedAutoAssignRules(
      'proj-1',
      [],
      { statusLabelToId: new Map(), agentNameToId: new Map() },
      { storage: storage as unknown as any, teamsService: null as unknown as any },
    );
    expect(created).toBe(0);
    expect(storage.createEpicAssignmentRule).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter local-app test -- project-import.spec`
Expected: FAIL — `createImportedAutoAssignRules` is not exported.

- [ ] **Step 3: Implement `createImportedAutoAssignRules`**

In `apps/local-app/src/modules/projects/helpers/project-import.ts`, add this new exported function immediately **after** `createImportedScheduledEpics` (which ends ~line 1607 with `return created;\n}`):

```ts
export async function createImportedAutoAssignRules(
  projectId: string,
  rules: ParsedTemplatePayload['autoAssignRules'],
  maps: {
    statusLabelToId: Map<string, string>;
    agentNameToId: Map<string, string>;
  },
  deps: Pick<ImportProjectDeps, 'storage' | 'teamsService'>,
): Promise<number> {
  if (!rules?.length) return 0;

  // Build team name→id map for team-target rules (best-effort; skip-with-warn if unavailable)
  const teamNameToId = new Map<string, string>();
  if (deps.teamsService) {
    try {
      const teams = await deps.teamsService.listTeams(projectId);
      for (const team of teams) {
        teamNameToId.set(team.name.trim().toLowerCase(), team.id);
      }
    } catch {
      // ignore — team-target rules will skip-with-warn below
    }
  }

  let created = 0;
  let priority = 0;
  for (const rule of rules) {
    const statusId =
      rule.matchType === 'status'
        ? (maps.statusLabelToId.get((rule.statusLabel ?? '').trim().toLowerCase()) ?? null)
        : null;

    if (rule.matchType === 'status' && !statusId) {
      logger.warn(
        { projectId, statusLabel: rule.statusLabel },
        'Auto-assign rule references unknown status; skipping',
      );
      priority++;
      continue;
    }

    let targetAgentId: string | null = null;
    let targetTeamId: string | null = null;
    if (rule.targetType === 'agent') {
      targetAgentId = rule.targetAgentName
        ? (maps.agentNameToId.get(rule.targetAgentName.trim().toLowerCase()) ?? null)
        : null;
      if (!targetAgentId) {
        logger.warn(
          { projectId, agentName: rule.targetAgentName },
          'Auto-assign rule references unknown agent; skipping',
        );
        priority++;
        continue;
      }
    } else {
      targetTeamId = rule.targetTeamName
        ? (teamNameToId.get(rule.targetTeamName.trim().toLowerCase()) ?? null)
        : null;
      if (!targetTeamId) {
        logger.warn(
          { projectId, teamName: rule.targetTeamName },
          'Auto-assign rule references unknown team; skipping',
        );
        priority++;
        continue;
      }
    }

    await deps.storage.createEpicAssignmentRule({
      projectId,
      matchType: rule.matchType,
      statusId,
      tags: rule.tags ?? null,
      targetType: rule.targetType,
      targetAgentId,
      targetTeamId,
      overrideExisting: rule.overrideExisting,
      enabled: rule.enabled,
      priority,
    });

    created++;
    priority++;
  }

  logger.info({ projectId, created }, 'Auto-assign rules imported');
  return created;
}
```

Notes for the implementer:
- `ParsedTemplatePayload` is already defined in this file (`ReturnType<typeof ExportSchema.parse>`), so the new `autoAssignRules` field is automatically typed after Task 1.
- `ImportProjectDeps` is already defined in this file and includes optional `teamsService` and `storage`.
- `logger` is already imported.
- `TeamsService.listTeams(projectId)` returns `Promise<Team[]>`; `Team` has `id` and `name`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter local-app test -- project-import.spec`
Expected: PASS — all 5 new cases pass.

- [ ] **Step 5: Wire the helper into `importProjectWithHelper`**

In `apps/local-app/src/modules/projects/helpers/project-import.ts`, inside `importProjectWithHelper`, find the scheduledEpics import block (around lines 254–266):

```ts
    // Import scheduled epics (after agents and statuses are created)
    let scheduledEpicsImported = 0;
    if (context.payload.scheduledEpics?.length) {
      scheduledEpicsImported = await createImportedScheduledEpics(
        input.projectId,
        context.payload.scheduledEpics,
        {
          agentNameToId: mappingResults.agentNameToId,
          statusLabelToId: templateLabelToStatusId,
        },
        deps,
      );
    }
```

Insert this block **immediately after** it (before the `remapEpicAgentAssignments` call that follows):

```ts
    // Import auto-assign rules (after statuses, agents, and teams are created)
    let autoAssignRulesImported = 0;
    if (context.payload.autoAssignRules?.length) {
      autoAssignRulesImported = await createImportedAutoAssignRules(
        input.projectId,
        context.payload.autoAssignRules,
        {
          statusLabelToId: templateLabelToStatusId,
          agentNameToId: mappingResults.agentNameToId,
        },
        deps,
      );
    }
```

- [ ] **Step 6: Wire the helper into `createFromTemplateWithHelper`**

In `apps/local-app/src/modules/projects/helpers/template-loader.ts`, find the scheduledEpics block (around lines 392–407):

```ts
  let scheduledEpicsCreated = 0;
  if (resolvedPayload.scheduledEpics?.length) {
    scheduledEpicsCreated = await createImportedScheduledEpics(
      result.project.id,
      resolvedPayload.scheduledEpics,
      {
        agentNameToId: agentNameToNewId,
        statusLabelToId,
      },
      {
        storage: deps.storage,
        scheduledEpicsRefresh: deps.scheduledEpicsRefresh,
        computeNextRunAt: deps.computeNextRunAt,
      },
    );
  }
```

Insert this block **immediately after** it (before `await importProviderSettings(...)`):

```ts
  if (resolvedPayload.autoAssignRules?.length) {
    await createImportedAutoAssignRules(
      result.project.id,
      resolvedPayload.autoAssignRules,
      {
        agentNameToId: agentNameToNewId,
        statusLabelToId,
      },
      {
        storage: deps.storage,
        teamsService: deps.teamsService,
      },
    );
  }
```

Then add `createImportedAutoAssignRules` to the import from `./project-import` at the top of `template-loader.ts` (where `createImportedScheduledEpics` is already imported, ~lines 27–28):

```ts
import {
  // ...existing imports (createImportedTeams, createImportedScheduledEpics, etc.)...
  createImportedAutoAssignRules,
} from './project-import';
```

- [ ] **Step 7: Verify `deps.teamsService` exists on the template-loader deps type**

Check the `deps` parameter type of `createFromTemplateWithHelper` in `template-loader.ts`. If `teamsService` is not present on it, the team-target rules will still work for the Dispatcher (agent target) — but to support team targets in this path too, ensure `teamsService` is part of the deps type (mirror how `createImportedTeams` is invoked in the same file). If `deps.teamsService` causes a TS error, pass `teamsService: undefined` instead — the helper handles `undefined` gracefully (team targets skip-with-warn).

Run: `pnpm --filter local-app build`
Expected: build succeeds (this is the typecheck).

- [ ] **Step 8: Commit**

```bash
git add apps/local-app/src/modules/projects/helpers/project-import.ts apps/local-app/src/modules/projects/helpers/project-import.spec.ts apps/local-app/src/modules/projects/helpers/template-loader.ts
git commit -m "feat(projects): import autoAssignRules from templates"
```

---

## Task 3: Export helper `buildExportAutoAssignRules`

**Files:**
- Modify: `apps/local-app/src/modules/projects/helpers/project-export.ts` (new function + wire into `exportProject` return)
- Test: `apps/local-app/src/modules/projects/services/projects.export.spec.ts` (new describe block + mock field)

- [ ] **Step 1: Write the failing tests**

Open `apps/local-app/src/modules/projects/services/projects.export.spec.ts`.

First, add `listEpicAssignmentRules` to the `storage` mock type and setup. In the `let storage: {...}` declaration (starts ~line 27), add this field alongside the other `list*` declarations:

```ts
    listEpicAssignmentRules: jest.Mock;
```

Then in the `beforeEach` that creates the mock storage object (where each method is assigned `jest.fn()`), add:

```ts
      listEpicAssignmentRules: jest.fn(),
```

Now append this describe block at the end of the outer `describe('ProjectsService', ...)` (before its final closing `});`):

```ts
  describe('autoAssignRules export', () => {
    const projectId = 'project-auto';

    beforeEach(() => {
      storage.getProject.mockResolvedValue({
        id: projectId,
        name: 'Auto Project',
        rootPath: '/test',
        isTemplate: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      storage.listPrompts.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
      storage.listAgentProfiles.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
      storage.listAgents.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
      storage.listStatuses.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
      storage.getInitialSessionPrompt.mockResolvedValue(null);
      storage.listWatchers.mockResolvedValue([]);
      storage.listSubscribers.mockResolvedValue([]);
      storage.listProfileProviderConfigsByProfile.mockResolvedValue([]);
      storage.listScheduledEpics.mockResolvedValue({ items: [], total: 0 });
    });

    it('exports empty autoAssignRules when none exist', async () => {
      storage.listEpicAssignmentRules.mockResolvedValue([]);
      const result = await service.exportProject(projectId);
      expect(result.autoAssignRules).toEqual([]);
    });

    it('exports rules with name-based references (status label, agent name)', async () => {
      storage.listStatuses.mockResolvedValue({
        items: [{ id: 'status-dispatch', label: 'Dispatch', color: '#17a2b8', position: 1 }],
        total: 1,
        limit: 100,
        offset: 0,
      });
      storage.listAgents.mockResolvedValue({
        items: [{ id: 'agent-dispatcher', name: 'Dispatcher', profileId: 'p-1' }],
        total: 1,
        limit: 100,
        offset: 0,
      });
      storage.listEpicAssignmentRules.mockResolvedValue([
        {
          id: 'rule-1',
          projectId,
          matchType: 'status',
          statusId: 'status-dispatch',
          tags: null,
          targetType: 'agent',
          targetAgentId: 'agent-dispatcher',
          targetTeamId: null,
          overrideExisting: false,
          priority: 0,
          enabled: true,
          createdAt: '2026-07-05T00:00:00Z',
          updatedAt: '2026-07-05T00:00:00Z',
        },
      ]);

      const result = await service.exportProject(projectId);

      expect(result.autoAssignRules).toHaveLength(1);
      expect(result.autoAssignRules[0]).toEqual(
        expect.objectContaining({
          matchType: 'status',
          statusLabel: 'Dispatch',
          targetType: 'agent',
          targetAgentName: 'Dispatcher',
          overrideExisting: false,
          enabled: true,
        }),
      );
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter local-app test -- projects.export.spec`
Expected: FAIL — `result.autoAssignRules` is `undefined` (export doesn't emit the field yet).

- [ ] **Step 3: Implement `buildExportAutoAssignRules`**

In `apps/local-app/src/modules/projects/helpers/project-export.ts`, add this function (place it near `buildExportScheduledEpics`). First check the existing import of `TeamsService` type at the top; if `TeamsService` is not imported, the `deps.teamsService` access is still fine since `ExportProjectDeps` types it.

```ts
async function buildExportAutoAssignRules(
  projectId: string,
  deps: ExportProjectDeps,
): Promise<unknown[]> {
  const rules = await deps.storage.listEpicAssignmentRules(projectId);
  if (rules.length === 0) return [];

  const { items: statuses } = await deps.storage.listStatuses(projectId);
  const statusIdToLabel = new Map(statuses.map((s) => [s.id, s.label]));

  const { items: agents } = await deps.storage.listAgents(projectId);
  const agentIdToName = new Map(agents.map((a) => [a.id, a.name]));

  const teamIdToName = new Map<string, string>();
  if (deps.teamsService) {
    const teams = await deps.teamsService.listTeams(projectId);
    for (const t of teams) teamIdToName.set(t.id, t.name);
  }

  return rules.map((rule) => ({
    matchType: rule.matchType,
    statusLabel: rule.statusId ? (statusIdToLabel.get(rule.statusId) ?? null) : null,
    tags: rule.tags ?? null,
    targetType: rule.targetType,
    targetAgentName: rule.targetAgentId ? (agentIdToName.get(rule.targetAgentId) ?? null) : null,
    targetTeamName: rule.targetTeamId ? (teamIdToName.get(rule.targetTeamId) ?? null) : null,
    overrideExisting: rule.overrideExisting,
    enabled: rule.enabled,
  }));
}
```

- [ ] **Step 4: Wire it into `exportProject`**

In the same file, in `exportProject` (the function starting ~line 69), find line 92:

```ts
  const scheduledEpics = await buildExportScheduledEpics(projectId, state, deps.storage);
```

Add this line immediately **after** it:

```ts
  const autoAssignRules = await buildExportAutoAssignRules(projectId, deps);
```

Then in the returned object (the `return { ... }` starting ~line 105), find `scheduledEpics,` (~line 123) and add this line immediately **after** it:

```ts
    autoAssignRules,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter local-app test -- projects.export.spec`
Expected: PASS — both new cases pass.

- [ ] **Step 6: Build (typecheck) + lint**

Run: `pnpm --filter local-app build && pnpm --filter local-app lint`
Expected: build + lint succeed.

- [ ] **Step 7: Commit**

```bash
git add apps/local-app/src/modules/projects/helpers/project-export.ts apps/local-app/src/modules/projects/services/projects.export.spec.ts
git commit -m "feat(projects): export autoAssignRules with name-based references"
```

---

## Task 4: Add Dispatcher + Dispatch status to `teams-dev.json`

**Files:**
- Modify: `apps/local-app/templates/teams-dev.json`
- Test: `apps/local-app/src/common/template-default-provider.spec.ts`

- [ ] **Step 1: Renumber existing statuses and insert `Dispatch`**

In `apps/local-app/templates/teams-dev.json`, in the `statuses` array, bump every existing status with `position >= 1` by **+1**, and insert the new `Dispatch` status at position 1. The final `statuses` array must read (in position order):

```json
    {
      "id": "6d8e7e5e-570b-41dd-b801-e26a6ebe8272",
      "label": "Draft",
      "color": "#f5f5f5",
      "position": 0,
      "mcpHidden": true
    },
    {
      "id": "d1spatch-5tatu5-0000-0000-000000000001",
      "label": "Dispatch",
      "color": "#17a2b8",
      "position": 1,
      "mcpHidden": false
    },
    {
      "id": "...",
      "label": "New",
      "color": "#6c757d",
      "position": 2,
      "mcpHidden": false
    },
    {
      "id": "...",
      "label": "In Progress",
      "color": "#007bff",
      "position": 3,
      "mcpHidden": false
    },
    {
      "id": "...",
      "label": "Review",
      "color": "#ffc107",
      "position": 4,
      "mcpHidden": false
    },
    {
      "id": "...",
      "label": "Done",
      "color": "#28a745",
      "position": 5,
      "mcpHidden": false
    },
    {
      "id": "...",
      "label": "Blocked",
      "color": "#dc3545",
      "position": 6,
      "mcpHidden": false
    },
    {
      "id": "...",
      "label": "Backlog",
      "color": "#6c757d",
      "position": 7,
      "mcpHidden": false
    },
    {
      "id": "...",
      "label": "Archive",
      "color": "#000000",
      "position": 8,
      "mcpHidden": true
    }
```

Keep the existing `id` values for the unchanged statuses (Draft, New, In Progress, Review, Done, Blocked, Backlog, Archive) — only their `position` numbers change. Use a fresh UUID for the new `Dispatch` status (the placeholder `d1spatch-...` above is illustrative; generate a real UUID v4 such as `a1b2c3d4-...`).

**Do NOT add `Dispatch` to `autoCleanStatusLabels`** (in `projectSettings`, ~line 478) — leave it as `["Draft", "Archive", "Backlog", "Done"]`.

- [ ] **Step 2: Add the Dispatcher SOP prompt**

In the `prompts` array (near the top of the file), add a new prompt object. Generate a fresh UUID for `id`:

```json
    {
      "id": "<fresh-uuid>",
      "title": "Dispatcher — Intake & Triage SOP",
      "content": "You are the **Dispatcher**, the intake and triage agent for this repo. You receive raw epic requests in `Dispatch` status, understand their true intention by studying the docs and code, decide whether they belong in this repo, and route them as well-formed, intent-revealing tasks to the right downstream agent.\n\n**You do NOT plan, design, or implement. You triage and dispatch.**\n\n## Trigger\nYou receive an `[Epic Assignment]` message for an epic in `Dispatch` status. That epic is a raw request — possibly vague, possibly compound, possibly out of scope.\n\n## Step 1 — Understand the intention\nBefore judging the request, understand what the user actually needs:\n\n1. Read the epic title + description carefully.\n2. Call `devchain_list_documents` and read the repo's docs (README, `docs/`, `AGENTS.md`/`CLAUDE.md`) to understand what this repo IS and what it's trying to be.\n3. Use your native file tools (Read, Grep, Glob) to inspect the code the request touches. You are building context to judge and phrase — not implementing.\n4. Identify the **underlying user need**: what problem is this request actually solving? The literal ask may be a symptom; surface the real need. (e.g. \"add dark mode\" → underlying need: \"reduce eye strain / enable night usage\".)\n\n## Step 2 — Validate relevance & alignment\nDecide whether this request belongs here. **All three** must pass:\n\n- **Relevant?** Does it touch this repo's actual surface area, or is it about an unrelated system/dependency?\n- **Aligned with repo intent?** Does it move the repo toward its stated goals, or pull in a different direction?\n- **A real improvement or fix?** Does it add genuine value or fix a real problem — not speculative or yak-shaving?\n\nIf **any** check fails → **Step 3a (reject)**.\nIf **all** pass → **Step 3b (dispatch)**.\n\n## Step 3a — Reject (out of scope / misaligned)\n1. `devchain_add_epic_comment` with a clear, specific reason: which check failed and why. Be concrete (cite docs/code), not generic.\n2. `devchain_update_epic` → move to `Backlog` status. (Auto-clean clears your assignment.)\n3. Stop. Do not create tasks.\n\n## Step 3b — Dispatch (decompose + rephrase)\n\n**Decompose:** Determine if the request is actually multiple **unrelated** tasks masquerading as one. Unrelated = they solve different needs, touch different parts of the code, and could be done independently. If the request is one coherent task, skip decomposition (single-task path).\n\nFor **each** task (whether 1 or many):\n- **Surface the underlying need** — the task must carry the WHY, not just the WHAT. A downstream agent reading only the task should understand the real problem, not have to re-discover it.\n- **Phrase it as a self-contained task** — clear title + description including the need, the relevant context you found in docs/code, and the suggested direction.\n\n**Single-task path (one coherent task):**\n- `devchain_update_epic` on the **same** epic: update its title + description to add the underlying need + context. **Do not create a new epic.**\n- Move it `Dispatch → New`.\n- Assign by routing (below).\n\n**Multi-task path (decomposition into unrelated tasks):**\n- For each task: `devchain_create_epic` with status `New`, an intent-revealing title + description, and the assignment per routing. These are **independent top-level epics** — no parent link, no `parentId`.\n- After **all** tasks are created: `devchain_add_epic_comment` on the original `Dispatch` epic with a summary of what you dispatched (list the created task titles).\n- `devchain_update_epic` → move the original to `Done`. (Auto-clean clears your assignment.)\n\n## Routing (Brainstormer vs Architect)\n- **Brainstormer** — the task needs exploration, design, or has open ambiguity. \"Should we add X?\", \"how should we handle Y?\", new features, product/UX questions, anything where the path isn't clear.\n- **Architect** — the task has a clear technical implementation path. Refactors, well-defined fixes, \"change X to Y\", performance work where the approach is known.\n- **Unsure → Brainstormer.** It can pull in the Architect via the existing §1.5 validation loop.\n\n## Constraints\n- Never implement, plan, or design solutions. You triage and phrase — that's it.\n- Never create tasks in any status other than `New`.\n- Never assign to anyone other than the Brainstormer or Architect.\n- Every output task MUST include the underlying need. A task without the WHY is a failed dispatch.\n- Rejection comments must cite docs/code so the human can verify your reasoning.\n\n## Tools\n- `devchain_get_agent_by_name` — load your own profile (run first)\n- `devchain_get_epic_by_id` — load the epic you were assigned\n- `devchain_list_documents` + native Read/Grep/Glob — understand the repo\n- `devchain_update_epic` — rephrase in place, move status, assign\n- `devchain_create_epic` — create independent output tasks (multi-task path)\n- `devchain_add_epic_comment` — rejection reason, or dispatch summary",
      "version": 1,
      "tags": []
    }
```

- [ ] **Step 3: Add the Dispatcher profile**

In the `profiles` array, add a new profile. Copy the `providerConfigs` block **verbatim** from the existing **Epic Manager** profile (id `32ff191e-...`) — it already contains the `opus`, `opus46`, `gpt-high`, `gemini3`, `opencode` configs the presets reference. Generate a fresh UUID for the new profile `id`:

```json
    {
      "id": "<fresh-uuid>",
      "name": "Dispatcher",
      "provider": {
        "id": "provider-claude",
        "name": "claude"
      },
      "familySlug": "dispatcher",
      "instructions": "[[prompt:Dispatcher — Intake & Triage SOP]]",
      "temperature": null,
      "maxTokens": null,
      "providerConfigs": [
        {
          "name": "opus",
          "providerName": "claude",
          "description": null,
          "options": "--model opus --effort high --dangerously-skip-permissions",
          "env": null,
          "position": 0
        },
        {
          "name": "opus46",
          "providerName": "claude",
          "description": null,
          "options": "--model claude-opus-4-6[1m] --effort high --dangerously-skip-permissions --disallowed-tools EnterPlanMode",
          "env": null,
          "position": 1
        },
        {
          "name": "gpt-high",
          "providerName": "codex",
          "description": null,
          "options": "--model=gpt-5.5 --config model_reasoning_effort=\"high\" --dangerously-bypass-approvals-and-sandbox",
          "env": null,
          "position": 2
        },
        {
          "name": "gemini3",
          "providerName": "gemini",
          "description": null,
          "options": "--model gemini-3.1-pro-preview -y",
          "env": null,
          "position": 4
        },
        {
          "name": "opencode",
          "providerName": "opencode",
          "description": null,
          "options": "--model zai-coding-plan/glm-5.2",
          "env": null,
          "position": 5
        }
      ]
    }
```

> **Verify the Epic Manager profile's `providerConfigs`** in the current file before copying — if it has a different set of configs (e.g. a `glm` config), mirror exactly what Epic Manager has, so every preset that references a config name resolves. The block above is the canonical set from the Epic Manager profile; adjust if the file differs.

- [ ] **Step 4: Add the Dispatcher agent**

In the `agents` array (alongside Brainstormer/Epic Manager/Code Reviewer/Architect), add:

```json
    {
      "id": "<fresh-uuid>",
      "name": "Dispatcher",
      "profileId": "<the Dispatcher profile id from Step 3>",
      "description": "intake and triage — validates relevance, surfaces underlying need, splits compound requests, routes to Brainstormer or Architect",
      "modelOverride": "zai-coding-plan/glm-5.2",
      "providerConfigName": "opencode"
    }
```

Do **not** add the Dispatcher to any `teams[]` entry — it is standalone (like Code Reviewer).

- [ ] **Step 5: Add the `autoAssignRules` array**

Add a new top-level `autoAssignRules` field to the template root object (place it right after the `scheduledEpics` array, or alongside the other top-level arrays like `presets`). The template currently has no such field:

```json
  "autoAssignRules": [
    {
      "matchType": "status",
      "statusLabel": "Dispatch",
      "tags": null,
      "targetType": "agent",
      "targetAgentName": "Dispatcher",
      "targetTeamName": null,
      "overrideExisting": false,
      "enabled": true
    }
  ],
```

- [ ] **Step 6: Add Dispatcher to every preset**

In the `presets` array, for **each** preset object, append a new entry to its `agentConfigs` array. Match the Epic Manager's config choice in that preset (triage uses the same tier as management). For the preset shown earlier (`Tier-B[opus:opencode:codex]`), add:

```json
        {
          "agentName": "Dispatcher",
          "providerConfigName": "opus",
          "modelOverride": null
        }
```

For each other preset, use the same `providerConfigName` that preset assigns to **Epic Manager**. (E.g. if a preset gives Epic Manager `"providerConfigName": "gpt-high"`, give Dispatcher `"gpt-high"` too.) Find Epic Manager's entry in each preset and mirror it.

- [ ] **Step 7: Write the smoke test for `teams-dev.json`**

Open `apps/local-app/src/common/template-default-provider.spec.ts`. At the top, add this import (if `ExportSchema` is not already imported):

```ts
import { ExportSchema } from '@devchain/shared';
```

Add this describe block (inside the existing top-level describe, or at top level):

```ts
  describe('Dispatcher in teams-dev.json', () => {
    const teamsDev = templates.find((t) => t.file === 'teams-dev.json');
    if (!teamsDev) throw new Error('teams-dev.json not found');

    it('passes ExportSchema.parse', () => {
      const result = ExportSchema.safeParse(teamsDev.template);
      expect(result.success).toBe(true);
      if (!result.success) {
        console.error(result.error.issues);
      }
    });

    it('has a Dispatch status at position 1, mcpHidden false, not in autoCleanStatusLabels', () => {
      const dispatch = (teamsDev.template as any).statuses.find(
        (s: any) => s.label === 'Dispatch',
      );
      expect(dispatch).toBeDefined();
      expect(dispatch.position).toBe(1);
      expect(dispatch.mcpHidden).toBe(false);
      const autoClean = (teamsDev.template as any).projectSettings?.autoCleanStatusLabels ?? [];
      expect(autoClean).not.toContain('Dispatch');
    });

    it('has a standalone Dispatcher agent + profile with the SOP prompt', () => {
      const agent = (teamsDev.template as any).agents.find((a: any) => a.name === 'Dispatcher');
      expect(agent).toBeDefined();
      const profile = (teamsDev.template as any).profiles.find(
        (p: any) => p.name === 'Dispatcher',
      );
      expect(profile).toBeDefined();
      expect(profile.familySlug).toBe('dispatcher');
      expect(profile.instructions).toContain('Dispatcher — Intake & Triage SOP');
      const prompt = (teamsDev.template as any).prompts.find(
        (p: any) => p.title === 'Dispatcher — Intake & Triage SOP',
      );
      expect(prompt).toBeDefined();
      // Dispatcher is NOT in any team
      const teams = (teamsDev.template as any).teams ?? [];
      for (const team of teams) {
        expect(team.memberAgentNames).not.toContain('Dispatcher');
        expect(team.teamLeadAgentName).not.toBe('Dispatcher');
      }
    });

    it('ships a Dispatch → Dispatcher auto-assign rule', () => {
      const rules = (teamsDev.template as any).autoAssignRules ?? [];
      const dispatchRule = rules.find(
        (r: any) =>
          r.matchType === 'status' &&
          r.statusLabel === 'Dispatch' &&
          r.targetType === 'agent' &&
          r.targetAgentName === 'Dispatcher',
      );
      expect(dispatchRule).toBeDefined();
    });
  });
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter local-app test -- template-default-provider.spec`
Expected: PASS.

If `ExportSchema.parse` fails, inspect the logged `result.error.issues` and fix the offending JSON (common causes: a preset references a config name that doesn't exist on the Dispatcher profile, or a leftover `bogus` key).

- [ ] **Step 9: Commit**

```bash
git add apps/local-app/templates/teams-dev.json apps/local-app/src/common/template-default-provider.spec.ts
git commit -m "feat(templates): add Dispatcher agent + Dispatch status to teams-dev"
```

---

## Task 5: Add Dispatcher + Dispatch status to `3-agents-dev.json`

**Files:**
- Modify: `apps/local-app/templates/3-agents-dev.json`
- Test: `apps/local-app/src/common/template-default-provider.spec.ts` (extend)

- [ ] **Step 1: Renumber statuses + insert `Dispatch`**

Same renumber as Task 4 Step 1. Bump every status with `position >= 1` by +1, insert `Dispatch` at position 1 (color `#17a2b8`, `mcpHidden: false`, fresh UUID). Final positions: Draft 0, Dispatch 1, New 2, In Progress 3, Review 4, Done 5, Blocked 6, Backlog 7, Archive 8.

Leave `autoCleanStatusLabels` as `["Draft", "Archive", "Backlog", "Done"]` — **do not** add `Dispatch`.

- [ ] **Step 2: Add the Dispatcher SOP prompt**

Add the **same** prompt object as Task 4 Step 2 (identical `title`, `content`, `version`, `tags`; fresh `id`). The SOP's routing clause ("Unsure → Brainstormer") already covers the no-Architect case; the 3-agents variant will route everything to Brainstormer since no Architect agent exists.

- [ ] **Step 3: Add the Dispatcher profile**

Copy the `providerConfigs` block **verbatim** from the existing **Brainstormer** profile (id `41484055-...`, profile name `Architect/Planner`) in this file — it has the `opus`, `gpt-high`, `gemini3`, `opencode`, `glm` configs. Generate a fresh profile `id`:

```json
    {
      "id": "<fresh-uuid>",
      "name": "Dispatcher",
      "provider": {
        "id": "provider-claude",
        "name": "claude"
      },
      "familySlug": "dispatcher",
      "instructions": "[[prompt:Dispatcher — Intake & Triage SOP]]",
      "temperature": null,
      "maxTokens": null,
      "providerConfigs": [
        { ...copy verbatim from Brainstormer's profile in this file... }
      ]
    }
```

> **Verify the Brainstormer profile's `providerConfigs`** in the current `3-agents-dev.json` and copy that exact array. The 3-agents template uses a slightly different config set than teams-dev (e.g. a `glm` config), so copy from this file, not from teams-dev.

- [ ] **Step 4: Add the Dispatcher agent**

In the `agents` array:

```json
    {
      "id": "<fresh-uuid>",
      "name": "Dispatcher",
      "profileId": "<Dispatcher profile id from Step 3>",
      "description": "intake and triage — validates relevance, surfaces underlying need, splits compound requests, routes to Brainstormer",
      "modelOverride": "zai-coding-plan/glm-5.2",
      "providerConfigName": "opencode"
    }
```

(No `teams[]` section in this template — Dispatcher is standalone by default.)

- [ ] **Step 5: Add the `autoAssignRules` array**

Add to the template root:

```json
  "autoAssignRules": [
    {
      "matchType": "status",
      "statusLabel": "Dispatch",
      "tags": null,
      "targetType": "agent",
      "targetAgentName": "Dispatcher",
      "targetTeamName": null,
      "overrideExisting": false,
      "enabled": true
    }
  ],
```

- [ ] **Step 6: Add Dispatcher to presets (if any)**

If `3-agents-dev.json` has a `presets` array, add a Dispatcher `agentConfig` to each preset, mirroring Brainstormer's config choice in that preset. If it has no presets, skip this step.

- [ ] **Step 7: Extend the smoke test**

In `apps/local-app/src/common/template-default-provider.spec.ts`, add a parallel describe block for the second template:

```ts
  describe('Dispatcher in 3-agents-dev.json', () => {
    const threeAgents = templates.find((t) => t.file === '3-agents-dev.json');
    if (!threeAgents) throw new Error('3-agents-dev.json not found');

    it('passes ExportSchema.parse', () => {
      const result = ExportSchema.safeParse(threeAgents.template);
      expect(result.success).toBe(true);
      if (!result.success) {
        console.error(result.error.issues);
      }
    });

    it('has a Dispatch status at position 1, mcpHidden false', () => {
      const dispatch = (threeAgents.template as any).statuses.find(
        (s: any) => s.label === 'Dispatch',
      );
      expect(dispatch).toBeDefined();
      expect(dispatch.position).toBe(1);
      expect(dispatch.mcpHidden).toBe(false);
    });

    it('has a Dispatcher agent + profile + SOP prompt', () => {
      const agent = (threeAgents.template as any).agents.find((a: any) => a.name === 'Dispatcher');
      expect(agent).toBeDefined();
      const profile = (threeAgents.template as any).profiles.find(
        (p: any) => p.name === 'Dispatcher',
      );
      expect(profile?.familySlug).toBe('dispatcher');
      const prompt = (threeAgents.template as any).prompts.find(
        (p: any) => p.title === 'Dispatcher — Intake & Triage SOP',
      );
      expect(prompt).toBeDefined();
    });

    it('ships a Dispatch → Dispatcher auto-assign rule', () => {
      const rules = (threeAgents.template as any).autoAssignRules ?? [];
      const dispatchRule = rules.find(
        (r: any) =>
          r.matchType === 'status' &&
          r.statusLabel === 'Dispatch' &&
          r.targetAgentName === 'Dispatcher',
      );
      expect(dispatchRule).toBeDefined();
    });
  });
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter local-app test -- template-default-provider.spec`
Expected: PASS (both templates' Dispatcher blocks).

- [ ] **Step 9: Commit**

```bash
git add apps/local-app/templates/3-agents-dev.json apps/local-app/src/common/template-default-provider.spec.ts
git commit -m "feat(templates): add Dispatcher agent + Dispatch status to 3-agents-dev"
```

---

## Task 6: User-facing docs + full validation

**Files:**
- Create: `docs/dispatcher-agent.md`

- [ ] **Step 1: Write the docs**

Create `docs/dispatcher-agent.md`:

```markdown
# Dispatcher Agent & Dispatch Status

The **Dispatcher** is an intake and triage agent. Drop a raw epic into the **Dispatch** status and the Dispatcher picks it up, studies the docs and code, decides whether it belongs in this repo, and routes it as a well-formed, intent-revealing task to the right downstream agent.

## How it works

1. Create an epic and choose **Dispatch** as the status (opt-in — `New` remains the default).
2. An auto-assign rule routes it to the **Dispatcher** agent.
3. The Dispatcher:
   - Reads the docs + code to understand the request's true intention.
   - Validates it's relevant, aligned with the repo's goals, and a real improvement/fix.
   - **If not** → moves it to **Backlog** with a comment explaining why.
   - **If yes, single task** → rephrases it in place (surfacing the underlying need), moves it to **New**, and assigns it.
   - **If yes, multiple unrelated tasks** → creates independent epics in **New** (each with the underlying need), assigns each, then comments on + closes the original.
4. Each output task is assigned by **ambiguity**:
   - **Brainstormer** — needs exploration, design, or has open ambiguity.
   - **Architect** — clear technical implementation path (teams-dev only; 3-agents-dev always routes to Brainstormer).

## Dispatch status

`Dispatch` sits between `Draft` and `New` on the board. It is **not** an auto-clean status, so the assignee is preserved while the Dispatcher works. It is visible to agents (`mcpHidden: false`).

## Shipping in templates

Both `teams-dev` and `3-agents-dev` ship with the Dispatcher agent, the Dispatch status, and a pre-configured auto-assign rule (`Dispatch → Dispatcher`). Templates can carry their own auto-assign rules via the `autoAssignRules[]` field — see `docs/board-auto-assign-rules.md` for rule behavior.

## What the Dispatcher does NOT do

It does not plan, design, or implement. It only triages and dispatches. Planning is the Brainstormer's job; implementation is the Builders' job.
```

- [ ] **Step 2: Run the full local-app test suite**

Run: `pnpm --filter local-app test`
Expected: PASS — no regressions. Pay attention to `project-import.spec`, `projects.export.spec`, `projects.create-from-template.spec`, `projects.import.spec`, and `template-default-provider.spec`.

- [ ] **Step 3: Run the shared test suite**

Run: `pnpm --filter shared test`
Expected: PASS.

- [ ] **Step 4: Lint everything**

Run: `pnpm --filter shared lint && pnpm --filter local-app lint`
Expected: no errors (`--max-warnings=0`).

- [ ] **Step 5: Full build (final typecheck)**

Run: `pnpm build`
Expected: succeeds (builds shared → codebase-overview → local-app, copies templates).

- [ ] **Step 6: Commit**

```bash
git add docs/dispatcher-agent.md
git commit -m "docs: add Dispatcher agent + Dispatch status documentation"
```

---

## Done criteria

- `ExportSchema` accepts `autoAssignRules[]` with XOR validation (Task 1).
- Importing a template (either path) creates rules, resolving labels/names to IDs, skip-with-warn on missing refs (Task 2).
- Exporting a project emits `autoAssignRules[]` with name-based references (Task 3).
- Both templates contain the Dispatch status (position 1, visible), the Dispatcher agent + profile + SOP, the `Dispatch → Dispatcher` rule, and Dispatcher preset entries — and both pass `ExportSchema.parse` (Tasks 4–5).
- Docs written, all tests + lint + build green (Task 6).
- No new DB tables, MCP tools, events, or backend modules.
