# Taskim Connector — API-key + Workspace/Project Picker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Taskim connector's manual ID-entry form with API-key auth + a Connect-gated, cascading Workspace → Project picker (with "create new" resolved on Taskim at save time).

**Architecture:** Add `listWorkspaces`/`listProjects`/`createWorkspace`/`createProject` to the Taskim adapter (and the `ConnectorAdapter` interface), drop the email/password auth path. Add two "preview" controller endpoints that take credentials inline (`/taskim/preview-workspaces`, `/taskim/preview-projects`) and extend the create endpoint to resolve `newWorkspaceName`/`newProjectName` to ids via the adapter before persisting. Rewrite the Taskim section of `ConnectorsPage.tsx` as a guided single form with a Connect gate and cascading shadcn `<Select>` dropdowns + create-new toggles; editing auto-Connects with the stored key.

**Tech Stack:** NestJS · Zod · React + React Query + shadcn/ui · Jest (ts-jest) · `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-06-29-taskim-connector-apikey-workspace-picker-design.md`

---

## Environment notes (READ FIRST)

- **Package filter is `local-app`** (NOT `devchain-local-app`). Run a single test with `pnpm --filter local-app test -- <pattern>`. Run typecheck with `pnpm --filter local-app exec tsc --noEmit`.
- **Pre-existing tsc errors:** the repo currently has ~84 pre-existing `tsc` errors from the v0.15.0 merge (in `packages/shared` e2e/tunnel, sessions, codebase-overview — NOT in connector files). These block `nest start` dev mode but **do not block jest** (ts-jest tolerates them). When verifying typecheck, grep for connector-file errors specifically — do NOT try to fix the 84 unrelated errors.
- **No `as any`** (repo lint forbids it). Use `as unknown as Type`.
- **No `git stash`** during this work.

## Conventions reference (from codebase)

- **Controller style:** `@Controller('api/<resource>')`; inline `Schema.safeParse(body)` → `throw new BadRequestException({ message, errors })`. `Put/Patch/Post/Delete/Get` imported from `@nestjs/common`. No global `/api` prefix.
- **DTO style:** `z.object({...}).strict()` + `.superRefine(...)` for XOR constraints; `export type XDto = z.infer<typeof X>`.
- **Adapter** (`taskim.adapter.ts`): fetch-based; `authenticate(config)` returns a Bearer token; `getConfig(config)` coerces the loose `ConnectorConfig` to the local `TaskimConfig`. Reuse the array-or-`{data}` parsing from `listRemoteProjects`.
- **UI:** React Query (`@tanstack/react-query`), raw `fetch` + a `getJSON` error helper, shadcn primitives via `@/ui/components/ui/*`, `useToast`.
- **Test:** Jest. Service/adapter specs: manual mocks + `new X(mock as unknown as Type)`. UI specs: `MemoryRouter` + `QueryClientProvider` + `global.fetch` mock.

---

## File map

**Modify:**
- `apps/local-app/src/modules/connectors/adapters/connector-adapter.interface.ts` — add 4 methods, rename `listRemoteProjects`→`listProjects`.
- `apps/local-app/src/modules/connectors/adapters/taskim.adapter.ts` — token-only auth; add the 4 methods.
- `apps/local-app/src/modules/connectors/adapters/taskim.adapter.spec.ts` — drop email/password auth tests; add coverage for the 4 methods.
- `apps/local-app/src/modules/connectors/dtos/connector.dto.ts` — add `newWorkspaceName`/`newProjectName` XOR + preview DTOs.
- `apps/local-app/src/modules/connectors/controllers/connectors.controller.ts` — 2 preview endpoints + create-flow resolution.
- `apps/local-app/src/modules/connectors/controllers/connectors.controller.spec.ts` — **new** (none exists today) covering preview + create-resolution.
- `apps/local-app/src/ui/lib/connectors.ts` — `previewWorkspaces`/`previewProjects` client + payload type.
- `apps/local-app/src/ui/pages/ConnectorsPage.tsx` — rewrite the Taskim form section (Connect gate + cascade + create-new + edit auto-Connect).
- `apps/local-app/src/ui/pages/ConnectorsPage.spec.tsx` — **new** (if none exists) OR a new spec `ConnectorsPage.taskim-form.spec.tsx`.

---

## Phase A — Adapter + interface (TDD)

### Task A1: Adapter — token-only auth + 4 new methods + tests

**Files:**
- Modify: `apps/local-app/src/modules/connectors/adapters/connector-adapter.interface.ts`
- Modify: `apps/local-app/src/modules/connectors/adapters/taskim.adapter.ts`
- Test: `apps/local-app/src/modules/connectors/adapters/taskim.adapter.spec.ts`

- [ ] **Step 1: Update the interface**

In `connector-adapter.interface.ts`, rename `listRemoteProjects` → `listProjects` and add three methods. The interface becomes (showing the changed members; leave `pushEpic`/`pullEpic`/`pushComment`/`resolveWebhook` untouched):

```ts
export interface ConnectorAdapter {
  readonly type: string;
  testConnection(config: Connector['config']): Promise<{ success: boolean; error?: string }>;
  listWorkspaces(config: Connector['config']): Promise<{ id: string; name: string }[]>;
  listProjects(config: Connector['config']): Promise<{ id: string; name: string }[]>;
  createWorkspace(config: Connector['config'], name: string): Promise<{ id: string; name: string }>;
  createProject(config: Connector['config'], name: string): Promise<{ id: string; name: string }>;
  pushEpic(input: PushEpicInput, config: Connector['config']): Promise<PushEpicResult>;
  pullEpic(externalId: string, config: Connector['config']): Promise<NormalizedExternalTask | null>;
  pushComment(input: PushCommentInput, config: Connector['config']): Promise<void>;
  resolveWebhook(payload: unknown, config: Connector['config']): Promise<InboundEvent | null>;
}
```

- [ ] **Step 2: Write the failing adapter spec additions**

Open `taskim.adapter.spec.ts`. **Remove** any test that exercises the email/password login path (the `POST /api/v1/auth/login` branch) — those will no longer apply. Keep the token-cache, webhook, and push-create tests.

Add these tests (using the existing spec's `fetch` mock style — read the file first and match how it stubs `global.fetch`):

```ts
function mockFetchSequence(responses: Array<{ ok?: boolean; status?: number; body: unknown }>) {
  const queue = [...responses];
  global.fetch = jest.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error('No more mock responses queued');
    const ok = next.ok ?? true;
    const status = next.status ?? (ok ? 200 : 400);
    return { ok, status, json: async () => next.body } as unknown as Response;
  }) as unknown as typeof fetch;
}

const tokenConfig = {
  apiUrl: 'http://taskim.local',
  credentials: { token: 'tok-123' },
};

describe('TaskimAdapter listWorkspaces/listProjects/createWorkspace/createProject', () => {
  it('listWorkspaces GETs /api/v1/workspaces and returns {id,name}[] (array shape)', async () => {
    const adapter = new TaskimAdapter();
    mockFetchSequence([{ body: [{ id: 'ws-1', name: 'Acme' }, { id: 'ws-2', name: 'Omega' }] }]);
    const result = await adapter.listWorkspaces(tokenConfig);
    expect(result).toEqual([{ id: 'ws-1', name: 'Acme' }, { id: 'ws-2', name: 'Omega' }]);
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('http://taskim.local/api/v1/workspaces');
  });

  it('listWorkspaces handles { data: [...] } shape', async () => {
    const adapter = new TaskimAdapter();
    mockFetchSequence([{ body: { data: [{ id: 'ws-1', name: 'Acme' }] } }]);
    const result = await adapter.listWorkspaces(tokenConfig);
    expect(result).toEqual([{ id: 'ws-1', name: 'Acme' }]);
  });

  it('listProjects requires workspaceId and GETs /api/v1/workspaces/:wid/projects', async () => {
    const adapter = new TaskimAdapter();
    mockFetchSequence([{ body: [{ id: 'p-1', name: 'Board A' }] }]);
    const result = await adapter.listProjects({ ...tokenConfig, workspaceId: 'ws-1' });
    expect(result).toEqual([{ id: 'p-1', name: 'Board A' }]);
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
      'http://taskim.local/api/v1/workspaces/ws-1/projects',
    );
  });

  it('listProjects returns [] when no workspaceId', async () => {
    const adapter = new TaskimAdapter();
    const result = await adapter.listProjects(tokenConfig);
    expect(result).toEqual([]);
  });

  it('createWorkspace POSTs {name} and returns {id,name}', async () => {
    const adapter = new TaskimAdapter();
    mockFetchSequence([{ body: { id: 'ws-new', name: 'Fresh' } }]);
    const result = await adapter.createWorkspace(tokenConfig, 'Fresh');
    expect(result).toEqual({ id: 'ws-new', name: 'Fresh' });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('http://taskim.local/api/v1/workspaces');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: 'Fresh' });
  });

  it('createWorkspace throws on non-2xx', async () => {
    const adapter = new TaskimAdapter();
    mockFetchSequence([{ ok: false, status: 403, body: { message: 'forbidden' } }]);
    await expect(adapter.createWorkspace(tokenConfig, 'X')).rejects.toThrow();
  });

  it('createProject POSTs {name} under the workspace', async () => {
    const adapter = new TaskimAdapter();
    mockFetchSequence([{ body: { id: 'p-new', name: 'Board N' } }]);
    const result = await adapter.createProject({ ...tokenConfig, workspaceId: 'ws-1' }, 'Board N');
    expect(result).toEqual({ id: 'p-new', name: 'Board N' });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('http://taskim.local/api/v1/workspaces/ws-1/projects');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: 'Board N' });
  });

  it('createProject throws when workspaceId is missing', async () => {
    const adapter = new TaskimAdapter();
    await expect(adapter.createProject(tokenConfig, 'Board N')).rejects.toThrow();
  });
});

describe('TaskimAdapter authenticate (token-only)', () => {
  it('uses credentials.token directly as Bearer without any login POST', async () => {
    const adapter = new TaskimAdapter();
    let postedLogin = false;
    global.fetch = jest.fn(async (url: RequestInfo | URL) => {
      const s = String(url);
      if (s.endsWith('/api/v1/auth/login')) postedLogin = true;
      return { ok: true, status: 200, json: async () => ({ id: 'ws-1', name: 'x' }) } as unknown as Response;
    }) as unknown as typeof fetch;
    await adapter.listWorkspaces(tokenConfig);
    expect(postedLogin).toBe(false);
    const authHeader = (global.fetch as jest.Mock).mock.calls[0][1]?.headers?.Authorization;
    expect(authHeader).toBe('Bearer tok-123');
  });
});
```

- [ ] **Step 3: Run the spec to verify the new tests fail**

Run: `pnpm --filter local-app test -- taskim.adapter.spec`
Expected: FAIL — `listWorkspaces is not a function` (and the renamed `listProjects`/create methods missing).

- [ ] **Step 4: Implement — token-only auth + the 4 methods**

In `taskim.adapter.ts`:

**(a) `authenticate`** — replace the whole method body with the token-only path (delete the email/password `POST /api/v1/auth/login` branch):

```ts
private async authenticate(config: TaskimConfig): Promise<string> {
  const cacheKey = `${config.apiUrl}:${config.credentials.token ?? ''}`;
  const cached = this.tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }
  const token = config.credentials.token;
  if (!token) {
    throw new Error('Taskim adapter requires credentials.token (API key)');
  }
  this.tokenCache.set(cacheKey, { token, expiresAt: Date.now() + 3600_000 });
  return token;
}
```

**(b) `listWorkspaces`** — add (mirror `listRemoteProjects` but no workspaceId):

```ts
async listWorkspaces(config: Connector['config']): Promise<{ id: string; name: string }[]> {
  const cfg = this.getConfig(config);
  const token = await this.authenticate(cfg);
  const response = await fetch(`${cfg.apiUrl}/api/v1/workspaces`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return [];
  const data = await response.json();
  const workspaces = Array.isArray(data) ? data : ((data as any).data ?? []);
  return workspaces.map((w: any) => ({ id: w.id, name: w.name }));
}
```

**(c) Rename `listRemoteProjects` → `listProjects`** (keep the existing body unchanged).

**(d) `createWorkspace` + `createProject`** — add (these THROW on failure, unlike the list methods):

```ts
async createWorkspace(
  config: Connector['config'],
  name: string,
): Promise<{ id: string; name: string }> {
  const cfg = this.getConfig(config);
  const token = await this.authenticate(cfg);
  const response = await fetch(`${cfg.apiUrl}/api/v1/workspaces`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    throw new Error(`Failed to create Taskim workspace: HTTP ${response.status}`);
  }
  const created = await response.json();
  const ws = Array.isArray(created) ? created[0] : (created as any);
  return { id: ws.id, name: ws.name };
}

async createProject(
  config: Connector['config'],
  name: string,
): Promise<{ id: string; name: string }> {
  const cfg = this.getConfig(config);
  if (!cfg.workspaceId) {
    throw new Error('Cannot create a Taskim project without a workspaceId');
  }
  const token = await this.authenticate(cfg);
  const response = await fetch(
    `${cfg.apiUrl}/api/v1/workspaces/${cfg.workspaceId}/projects`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to create Taskim project: HTTP ${response.status}`);
  }
  const created = await response.json();
  const proj = Array.isArray(created) ? created[0] : (created as any);
  return { id: proj.id, name: proj.name };
}
```

- [ ] **Step 5: Run the spec to verify all tests pass**

Run: `pnpm --filter local-app test -- taskim.adapter.spec`
Expected: PASS (all tests, including the retained token-cache/webhook/push-create ones).

- [ ] **Step 6: Lint + typecheck (connector files only)**

Run:
```bash
pnpm --filter local-app exec eslint src/modules/connectors --max-warnings=0
pnpm --filter local-app exec tsc --noEmit 2>&1 | grep -E "connectors/adapters|ConnectorAdapter" | head
```
Expected: eslint clean; tsc shows NO connector-adapter errors (ignore the ~84 pre-existing unrelated errors).

- [ ] **Step 7: Commit**

```bash
git add apps/local-app/src/modules/connectors/adapters/connector-adapter.interface.ts apps/local-app/src/modules/connectors/adapters/taskim.adapter.ts apps/local-app/src/modules/connectors/adapters/taskim.adapter.spec.ts
git commit -m "feat(connectors): Taskim adapter — token-only auth + listWorkspaces/listProjects/createWorkspace/createProject"
```

---

## Phase B — DTOs

### Task B1: Add `newWorkspaceName`/`newProjectName` XOR + preview DTOs

**Files:**
- Modify: `apps/local-app/src/modules/connectors/dtos/connector.dto.ts`

- [ ] **Step 1: Extend the schemas**

Edit `connector.dto.ts`. Add `newWorkspaceName` and `newProjectName` (optional, XOR-enforced) to BOTH `CreateConnectorDtoSchema` and `UpdateConnectorDtoSchema`, and add two new preview schemas. Append after the existing exports:

```ts
// At the top, ensure `import { z } from 'zod';` is present (it is).

// Add to the CreateConnectorDtoSchema object (and mirror in Update):
//   newWorkspaceName: z.string().min(1).optional(),
//   newProjectName: z.string().min(1).optional(),
// Then chain a .superRefine for XOR. Concrete full shapes below.
```

Replace the `CreateConnectorDtoSchema` definition with:

```ts
export const CreateConnectorDtoSchema = z
  .object({
    projectId: z.string().uuid(),
    type: z.enum(['taskim', 'monday', 'jira']),
    name: z.string().min(1).max(200),
    enabled: z.boolean().optional().default(false),
    config: z
      .object({
        apiUrl: z.string().url(),
        credentials: z.record(z.string()).default({}),
        workspaceId: z.string().optional(),
      })
      .passthrough(),
    externalProjectId: z.string().nullable().optional(),
    newWorkspaceName: z.string().min(1).optional(),
    newProjectName: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.config.workspaceId && data.newWorkspaceName) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['newWorkspaceName'], message: 'Provide either workspaceId or newWorkspaceName, not both' });
    }
    if (data.externalProjectId && data.newProjectName) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['newProjectName'], message: 'Provide either externalProjectId or newProjectName, not both' });
    }
  });
```

Add the same two optional fields + the same `superRefine` to `UpdateConnectorDtoSchema`.

Append the preview DTOs at the end of the file:

```ts
export const PreviewWorkspacesDtoSchema = z
  .object({
    apiUrl: z.string().url(),
    apiKey: z.string().min(1),
  })
  .strict();
export type PreviewWorkspacesDto = z.infer<typeof PreviewWorkspacesDtoSchema>;

export const PreviewProjectsDtoSchema = z
  .object({
    apiUrl: z.string().url(),
    apiKey: z.string().min(1),
    workspaceId: z.string().min(1),
  })
  .strict();
export type PreviewProjectsDto = z.infer<typeof PreviewProjectsDtoSchema>;
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter local-app exec tsc --noEmit 2>&1 | grep -E "connector.dto" | head`
Expected: empty (no DTO errors).

- [ ] **Step 3: Commit**

```bash
git add apps/local-app/src/modules/connectors/dtos/connector.dto.ts
git commit -m "feat(connectors): add newWorkspaceName/newProjectName XOR + preview DTOs"
```

---

## Phase C — Controller

### Task C1: Preview endpoints + create-flow resolution + controller spec (TDD)

**Files:**
- Modify: `apps/local-app/src/modules/connectors/controllers/connectors.controller.ts`
- Create: `apps/local-app/src/modules/connectors/controllers/connectors.controller.spec.ts`

- [ ] **Step 1: Write the failing controller spec**

Create `connectors.controller.spec.ts`. It uses `Test.createTestingModule` with the controller + a mock service + a mock `TaskimAdapter`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConnectorsController } from './connectors.controller';
import { ConnectorsService } from '../services/connectors.service';
import { TaskimAdapter } from '../adapters/taskim.adapter';

describe('ConnectorsController', () => {
  let controller: ConnectorsController;
  let service: { list: jest.Mock; get: jest.Mock; create: jest.Mock };
  let taskim: {
    listWorkspaces: jest.Mock;
    listProjects: jest.Mock;
    createWorkspace: jest.Mock;
    createProject: jest.Mock;
  };

  beforeEach(async () => {
    service = { list: jest.fn(), get: jest.fn(), create: jest.fn() };
    taskim = {
      listWorkspaces: jest.fn(),
      listProjects: jest.fn(),
      createWorkspace: jest.fn(),
      createProject: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConnectorsController],
      providers: [
        { provide: ConnectorsService, useValue: service },
        { provide: TaskimAdapter, useValue: taskim },
      ],
    }).compile();
    controller = module.get(ConnectorsController);
  });

  it('previewWorkspaces delegates to adapter.listWorkspaces with a transient config', async () => {
    taskim.listWorkspaces.mockResolvedValue([{ id: 'ws-1', name: 'Acme' }]);
    const result = await controller.previewWorkspaces({ apiUrl: 'http://t.local', apiKey: 'k' });
    expect(taskim.listWorkspaces).toHaveBeenCalledWith({
      apiUrl: 'http://t.local',
      credentials: { token: 'k' },
    });
    expect(result).toEqual([{ id: 'ws-1', name: 'Acme' }]);
  });

  it('previewProjects delegates to adapter.listProjects with workspaceId', async () => {
    taskim.listProjects.mockResolvedValue([{ id: 'p-1', name: 'B' }]);
    await controller.previewProjects({ apiUrl: 'http://t.local', apiKey: 'k', workspaceId: 'ws-1' });
    expect(taskim.listProjects).toHaveBeenCalledWith({
      apiUrl: 'http://t.local',
      credentials: { token: 'k' },
      workspaceId: 'ws-1',
    });
  });

  it('create persists as-is when no new*Name given', async () => {
    service.create.mockResolvedValue({ id: 'c1' });
    await controller.create({
      projectId: 'p1', type: 'taskim', name: 'N', enabled: true,
      config: { apiUrl: 'http://t.local', credentials: { token: 'k' }, workspaceId: 'ws-1' },
      externalProjectId: 'pr-1',
    });
    expect(taskim.createWorkspace).not.toHaveBeenCalled();
    expect(taskim.createProject).not.toHaveBeenCalled();
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ workspaceId: 'ws-1' }),
      externalProjectId: 'pr-1',
    }));
  });

  it('create resolves newWorkspaceName via adapter then persists the id', async () => {
    taskim.createWorkspace.mockResolvedValue({ id: 'ws-new', name: 'Fresh' });
    service.create.mockResolvedValue({ id: 'c1' });
    await controller.create({
      projectId: 'p1', type: 'taskim', name: 'N', enabled: true,
      config: { apiUrl: 'http://t.local', credentials: { token: 'k' } },
      newWorkspaceName: 'Fresh',
      externalProjectId: 'pr-1',
    });
    expect(taskim.createWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ apiUrl: 'http://t.local' }),
      'Fresh',
    );
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ workspaceId: 'ws-new' }),
      newWorkspaceName: undefined,
    }));
  });

  it('create resolves newProjectName via adapter after workspace resolved', async () => {
    taskim.createProject.mockResolvedValue({ id: 'p-new', name: 'Board N' });
    service.create.mockResolvedValue({ id: 'c1' });
    await controller.create({
      projectId: 'p1', type: 'taskim', name: 'N', enabled: true,
      config: { apiUrl: 'http://t.local', credentials: { token: 'k' }, workspaceId: 'ws-1' },
      newProjectName: 'Board N',
    });
    expect(taskim.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1' }),
      'Board N',
    );
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({
      externalProjectId: 'p-new',
      newProjectName: undefined,
    }));
  });

  it('rejects workspaceId + newWorkspaceName together', async () => {
    await expect(
      controller.create({
        projectId: 'p1', type: 'taskim', name: 'N', enabled: true,
        config: { apiUrl: 'http://t.local', credentials: { token: 'k' }, workspaceId: 'ws-1' },
        newWorkspaceName: 'Fresh',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm --filter local-app test -- connectors.controller.spec`
Expected: FAIL — methods `previewWorkspaces`/`previewProjects` don't exist; create doesn't resolve new-names.

- [ ] **Step 3: Implement the controller changes**

Edit `connectors.controller.ts`. Import the new schemas:

```ts
import {
  CreateConnectorDtoSchema,
  UpdateConnectorDtoSchema,
  CreateStatusMappingDtoSchema,
  PreviewWorkspacesDtoSchema,
  PreviewProjectsDtoSchema,
} from '../dtos/connector.dto';
```

Add the two preview endpoints (place after the existing `testConnection` method):

```ts
@Post('taskim/preview-workspaces')
async previewWorkspaces(@Body() body: unknown) {
  const parsed = PreviewWorkspacesDtoSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException({ message: 'Validation failed', errors: parsed.error.errors });
  }
  const { apiUrl, apiKey } = parsed.data;
  return this.taskimAdapter.listWorkspaces({ apiUrl, credentials: { token: apiKey } });
}

@Post('taskim/preview-projects')
async previewProjects(@Body() body: unknown) {
  const parsed = PreviewProjectsDtoSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException({ message: 'Validation failed', errors: parsed.error.errors });
  }
  const { apiUrl, apiKey, workspaceId } = parsed.data;
  return this.taskimAdapter.listProjects({
    apiUrl,
    credentials: { token: apiKey },
    workspaceId,
  });
}
```

Replace the existing `create` method with the resolving version:

```ts
@Post()
async create(@Body() body: unknown) {
  const parsed = CreateConnectorDtoSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException({ message: 'Validation failed', errors: parsed.error.errors });
  }
  const data = parsed.data;
  const config = { ...data.config };
  let externalProjectId = data.externalProjectId ?? null;

  if (data.newWorkspaceName) {
    const created = await this.taskimAdapter.createWorkspace(config, data.newWorkspaceName);
    config.workspaceId = created.id;
  }
  if (data.newProjectName) {
    const created = await this.taskimAdapter.createProject(config, data.newProjectName);
    externalProjectId = created.id;
  }

  const { newWorkspaceName: _w, newProjectName: _p, ...rest } = data;
  return this.service.create({ ...rest, config, externalProjectId });
}
```

(For non-taskim types `createWorkspace`/`createProject` would be unreachable because the DTO type is `taskim|monday|jira` and only taskim has an adapter; the create path above only invokes them when `new*Name` is present, which the UI only sends for taskim. If a monday/jira connector somehow carries `new*Name`, the adapter call would throw — acceptable, since those types are "coming soon" and not creatable from the UI.)

- [ ] **Step 4: Run the spec to verify all tests pass**

Run: `pnpm --filter local-app test -- connectors.controller.spec`
Expected: PASS (6 tests).

- [ ] **Step 5: Lint + typecheck (connector files)**

Run:
```bash
pnpm --filter local-app exec eslint src/modules/connectors/controllers --max-warnings=0
pnpm --filter local-app exec tsc --noEmit 2>&1 | grep -E "connectors/controllers" | head
```
Expected: clean / no controller errors.

- [ ] **Step 6: Commit**

```bash
git add apps/local-app/src/modules/connectors/controllers/connectors.controller.ts apps/local-app/src/modules/connectors/controllers/connectors.controller.spec.ts
git commit -m "feat(connectors): preview-workspaces/preview-projects endpoints + create-time workspace/project creation"
```

---

## Phase D — UI client

### Task D1: `previewWorkspaces` / `previewProjects` + payload type

**Files:**
- Modify: `apps/local-app/src/ui/lib/connectors.ts`

- [ ] **Step 1: Add the client functions + extend the create payload type**

Open `connectors.ts`. Find the `createConnector` function and its input type (a `Connector`-shaped payload). Add optional `newWorkspaceName?` / `newProjectName?` to that input type. Then append:

```ts
export async function previewWorkspaces(input: {
  apiUrl: string;
  apiKey: string;
}): Promise<{ id: string; name: string }[]> {
  const res = await fetch('/api/connectors/taskim/preview-workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({ message: 'Failed to load workspaces' }));
    throw new Error(e.message || 'Failed to load workspaces');
  }
  return res.json();
}

export async function previewProjects(input: {
  apiUrl: string;
  apiKey: string;
  workspaceId: string;
}): Promise<{ id: string; name: string }[]> {
  const res = await fetch('/api/connectors/taskim/preview-projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({ message: 'Failed to load projects' }));
    throw new Error(e.message || 'Failed to load projects');
  }
  return res.json();
}
```

(If the existing `createConnector` uses an inline anonymous payload type, add `newWorkspaceName?: string; newProjectName?: string;` to it. Match the existing file's error-helper style — the snippet above inlines the same `res.json().catch(...)` pattern used elsewhere in this file.)

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter local-app exec tsc --noEmit 2>&1 | grep -E "ui/lib/connectors" | head`
Expected: empty.

- [ ] **Step 3: Commit**

```bash
git add apps/local-app/src/ui/lib/connectors.ts
git commit -m "feat(connectors): add previewWorkspaces/previewProjects UI client + new*Name payload fields"
```

---

## Phase E — UI form

### Task E1: Rewrite the Taskim form (Connect gate + cascade + create-new + edit auto-Connect) + spec (TDD)

**Files:**
- Modify: `apps/local-app/src/ui/pages/ConnectorsPage.tsx`
- Test: `apps/local-app/src/ui/pages/ConnectorsPage.taskim-form.spec.tsx` (new)

This is the largest task. Read the current `ConnectorsPage.tsx` form section (the `type === 'taskim'` block ~lines 241–274 and the form-state `useState` ~lines 169–175, plus the `createMutation` ~177–203) before editing.

- [ ] **Step 1: Write the failing UI spec**

Create `ConnectorsPage.taskim-form.spec.tsx`. Mirror the `StatusesPage.archive-protection.spec.tsx` harness (`MemoryRouter` + `QueryClientProvider` with `retry:false` + `global.fetch` mock + `jest.mock('@/ui/hooks/useProjectSelection', ...)`). The spec covers the gate + cascade:

```tsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConnectorsPage } from './ConnectorsPage';

jest.mock('@/ui/hooks/useProjectSelection', () => ({
  useSelectedProject: () => ({ selectedProjectId: 'p1', selectedProject: { id: 'p1', name: 'P' } }),
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

describe('ConnectorsPage Taskim form', () => {
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/api/connectors/taskim/preview-workspaces')) {
        return { ok: true, json: async () => [{ id: 'ws-1', name: 'Acme' }] } as Response;
      }
      if (url.includes('/api/connectors/taskim/preview-projects')) {
        return { ok: true, json: async () => [{ id: 'p-1', name: 'Board A' }] } as Response;
      }
      if (url.includes('/api/connectors') && method === 'GET') {
        return { ok: true, json: async () => [] } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as jest.Mock;
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('disables workspace picker until Connect succeeds', async () => {
    render(<Wrapper><ConnectorsPage /></Wrapper>);
    // open the create form (however the page does — adjust selector to match)
    fireEvent.click(await screen.findByRole('button', { name: /add connector/i }));
    // workspace picker is disabled before Connect
    const workspaceTrigger = await screen.findByLabelText(/workspace/i);
    expect(workspaceTrigger).toBeDisabled();
  });

  it('enables workspace picker after Connect and populates it', async () => {
    render(<Wrapper><ConnectorsPage /></Wrapper>);
    fireEvent.click(await screen.findByRole('button', { name: /add connector/i }));
    fireEvent.change(screen.getByLabelText(/api url/i), { target: { value: 'http://t.local' } });
    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'k' } });
    fireEvent.click(screen.getByRole('button', { name: /connect/i }));
    // after Connect, the workspace select trigger is enabled
    await waitFor(async () => {
      expect(await screen.findByLabelText(/workspace/i)).not.toBeDisabled();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/connectors/taskim/preview-workspaces',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
```

(Adjust selectors/labels to match the actual form once implemented. The assertions capture the required behavior: workspace picker disabled until Connect; Connect calls preview-workspaces.)

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm --filter local-app test -- ConnectorsPage.taskim-form`
Expected: FAIL — current form has no Connect gate / API key field / disabled picker.

- [ ] **Step 3: Rewrite the Taskim form block**

In `ConnectorsPage.tsx`:

**(a) Form state** — replace the `email/password/workspaceId/externalProjectId` state with:

```tsx
const [apiUrl, setApiUrl] = useState('');
const [apiKey, setApiKey] = useState('');
const [connectionState, setConnectionState] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
const [connectionError, setConnectionError] = useState('');
const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([]);
const [workspaceMode, setWorkspaceMode] = useState<'select' | 'new'>('select');
const [workspaceId, setWorkspaceId] = useState('');
const [newWorkspaceName, setNewWorkspaceName] = useState('');
const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
const [projectMode, setProjectMode] = useState<'select' | 'new'>('select');
const [projectId, setProjectId] = useState('');
const [newProjectName, setNewProjectName] = useState('');
const [name, setName] = useState('');
const [type, setType] = useState<'taskim' | 'monday' | 'jira'>('taskim');
```

**(b) Connect handler:**

```tsx
const handleConnect = async () => {
  setConnectionState('connecting');
  setConnectionError('');
  try {
    const ws = await previewWorkspaces({ apiUrl, apiKey });
    setWorkspaces(ws);
    setConnectionState('connected');
  } catch (e) {
    setConnectionError(e instanceof Error ? e.message : 'Connection failed');
    setConnectionState('error');
  }
};

const handleSelectWorkspace = async (id: string) => {
  setWorkspaceId(id);
  setProjects([]);
  setProjectId('');
  try {
    const ps = await previewProjects({ apiUrl, apiKey, workspaceId: id });
    setProjects(ps);
  } catch {
    setProjects([]);
  }
};
```

**(c) Create mutation** — build the XOR payload:

```tsx
const createMutation = useMutation({
  mutationFn: () =>
    createConnector({
      projectId,
      type,
      name,
      enabled: false,
      config: { apiUrl, credentials: { token: apiKey }, workspaceId: workspaceMode === 'select' ? workspaceId || undefined : undefined },
      externalProjectId: projectMode === 'select' ? projectId || null : null,
      ...(workspaceMode === 'new' ? { newWorkspaceName } : {}),
      ...(projectMode === 'new' ? { newProjectName } : {}),
    }),
  onSuccess: () => { /* existing: close form + invalidate */ },
  onError: (e) => { /* existing toast */ },
});
```

**(d) Taskim form JSX** — replace the `type === 'taskim'` block with:

```tsx
{type === 'taskim' && (
  <>
    <div className="space-y-2">
      <Label htmlFor="t-apiurl">API URL</Label>
      <Input id="t-apiurl" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder="http://localhost:3000" />
    </div>
    <div className="space-y-2">
      <Label htmlFor="t-apikey">API key</Label>
      <Input id="t-apikey" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="taskim API key" />
    </div>
    <Button type="button" variant="outline" size="sm" onClick={handleConnect} disabled={!apiUrl || !apiKey || connectionState === 'connecting'}>
      {connectionState === 'connecting' ? 'Connecting…' : 'Connect'}
    </Button>
    {connectionState === 'error' && <p className="text-sm text-destructive">{connectionError}</p>}

    <div className="space-y-2">
      <Label>Workspace</Label>
      {workspaceMode === 'select' ? (
        <>
          <Select value={workspaceId} onValueChange={handleSelectWorkspace} disabled={connectionState !== 'connected'}>
            <SelectTrigger><SelectValue placeholder="Select workspace" /></SelectTrigger>
            <SelectContent>
              {workspaces.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button type="button" variant="link" size="sm" onClick={() => setWorkspaceMode('new')}>+ Create new workspace</Button>
        </>
      ) : (
        <>
          <Input value={newWorkspaceName} onChange={(e) => setNewWorkspaceName(e.target.value)} placeholder="New workspace name" />
          <Button type="button" variant="link" size="sm" onClick={() => setWorkspaceMode('select')}>Use existing</Button>
        </>
      )}
    </div>

    <div className="space-y-2">
      <Label>Project</Label>
      {projectMode === 'select' && workspaceMode === 'select' ? (
        <>
          <Select value={projectId} onValueChange={setProjectId} disabled={!workspaceId}>
            <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
            <SelectContent>
              {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button type="button" variant="link" size="sm" onClick={() => setProjectMode('new')}>+ Create new project</Button>
        </>
      ) : (
        <>
          <Input value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder="New project name" />
          {workspaceMode === 'select' && (
            <Button type="button" variant="link" size="sm" onClick={() => setProjectMode('select')}>Use existing</Button>
          )}
        </>
      )}
    </div>
  </>
)}
```

**(e) Submit gating** — disable the submit button unless `(workspaceMode === 'select' ? workspaceId : newWorkspaceName) && (projectMode === 'select' ? projectId : newProjectName) && name && connectionState === 'connected'`.

**(f) Edit auto-Connect** — if the form is also used for editing (pre-fill from an existing connector), add a `useEffect` that calls `handleConnect()` once when an existing connector is loaded (pre-fill `apiUrl`/`apiKey` from `config.credentials.token` first). If the page has a separate edit path, add the same pre-fill + auto-Connect there. (Read the current edit handling in ConnectorsPage.tsx and wire equivalently.)

- [ ] **Step 4: Run the spec to verify the new tests pass**

Run: `pnpm --filter local-app test -- ConnectorsPage.taskim-form`
Expected: PASS.

- [ ] **Step 5: Lint + typecheck**

Run:
```bash
pnpm --filter local-app exec eslint src/ui/pages/ConnectorsPage.tsx src/ui/pages/ConnectorsPage.taskim-form.spec.tsx --max-warnings=0
pnpm --filter local-app exec tsc --noEmit 2>&1 | grep -E "ConnectorsPage" | head
```
Expected: clean / no errors in these files.

- [ ] **Step 6: Commit**

```bash
git add apps/local-app/src/ui/pages/ConnectorsPage.tsx apps/local-app/src/ui/pages/ConnectorsPage.taskim-form.spec.tsx
git commit -m "feat(connectors): Taskim form — Connect gate + cascading workspace/project pickers + create-new"
```

---

## Phase F — Final verification

### Task F1: Full connectors test + lint pass

- [ ] **Step 1: Run the full connectors + UI test set**

```bash
pnpm --filter local-app test -- connectors ConnectorsPage taskim.adapter
```
Expected: all green (adapter spec, new controller spec, new UI spec, plus any pre-existing connector specs).

- [ ] **Step 2: Lint all touched files**

```bash
pnpm --filter local-app exec eslint src/modules/connectors src/ui/pages/ConnectorsPage.tsx src/ui/lib/connectors.ts --max-warnings=0
```
Expected: clean.

- [ ] **Step 3: Typecheck (connector files only — ignore the ~84 pre-existing unrelated errors)**

```bash
pnpm --filter local-app exec tsc --noEmit 2>&1 | grep -E "connectors|ConnectorsPage|connectors.ts" | head
```
Expected: empty.

- [ ] **Step 4: Final commit (if any cleanup)**

```bash
git add -A
git commit -m "chore(connectors): final lint/type fixes"
```

---

## Self-review notes

**Spec coverage:**
- §2 (auth API-key-only, two dropdowns, create-new at save) → A1 (auth), E1 (UI), C1 (save resolution).
- §2.1 (XOR per level, resolve at save) → B1 (DTO XOR), C1 (controller resolution + test).
- §3/§3.1 (config shape, DTO changes, preview DTOs) → B1.
- §4.1 (adapter 4 methods + remove email/password) → A1.
- §4.2 (preview endpoints + create resolution) → C1.
- §5 (UI client + form flow + edit auto-Connect) → D1, E1.
- §6 (error handling) → A1 (create throws), E1 (Connect error state, empty-list).
- §7 (testing) → covered by the spec steps in A1, C1, E1.
- §8 (non-goals) — respected; no status-mapping/webhook/refresh work.

**Type consistency:**
- Interface method names match across A1 (interface + adapter + tests) and C1 (controller calls `listWorkspaces`/`listProjects`/`createWorkspace`/`createProject`).
- DTO field names `newWorkspaceName`/`newProjectName` match across B1 (DTO), C1 (controller destructure + test), D1 (payload type), E1 (UI sends them).
- Preview DTO names match across B1 (schema), C1 (controller import + parse), D1 (client fn bodies).

**Known risks flagged for the implementer:**
- UI spec selectors (`findByLabelText`, `findByRole`) must match the actual form after implementation — adjust to reality; the assertions capture behavior, not exact DOM.
- `listProjects` rename: confirm nothing else in the repo calls `listRemoteProjects` (the research confirmed it's dead at the HTTP layer; only the adapter implements it).
- Taskim's exact create-response shape is assumed `{id,name}`; the defensive array-or-object parsing in `createWorkspace`/`createProject` handles either.
