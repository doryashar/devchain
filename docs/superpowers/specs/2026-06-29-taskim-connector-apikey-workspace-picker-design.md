# Taskim Connector — API-key Auth + Cascading Workspace/Project Picker — Design Spec

> **Date:** 2026-06-29
> **Status:** Approved
> **Scope:** Replace the Taskim connector's manual ID-entry form with API-key auth + live-fetched, cascading Workspace → Project dropdowns (with "create new" at save time). Taskim-only.

---

## 1. Purpose

Today the Taskim connector form asks the user to type raw IDs for `workspaceId` and `externalProjectId`, and authenticates via email/password or token. This is error-prone (no validation that IDs exist) and forces the user to leave the app to find IDs.

The new UX: enter an **API key** → click **Connect** → pick a **Workspace** from a live list → pick a **Project** from a live list → save. Each picker offers **Create new** (a name field); new workspace/project are created on Taskim at save time.

**Primary use cases:**
- Configure a new Taskim connector without copy-pasting IDs
- Create a fresh workspace/project from inside Devchain while setting up sync
- Validate the API key (and apiUrl) immediately, before saving

---

## 2. Behavior (decisions)

| Decision | Choice |
|---|---|
| **Selection shape** | Two cascading dropdowns: Workspace → Project |
| **Auth** | API key only (single field). Stored as `config.credentials.token`, sent as `Bearer`. **Email/password branch removed entirely** from adapter + UI. |
| **List source** | Fetched live from Taskim via the adapter (workspaces from `GET /api/v1/workspaces`; projects from `GET /api/v1/workspaces/:wid/projects`) |
| **UI flow** | Guided single form with a **Connect** gate: pickers disabled until Connect succeeds |
| **"Create new"** | Lazy — a name is entered inline; the workspace/project is created on Taskim **at save time** (POST), then the returned ID is stored |
| **Edit existing** | Same form, pre-filled; **auto-Connects on open** using the stored key |
| **Taskim creation API (assumed, to verify at impl)** | `POST /api/v1/workspaces {name}` → `{id,name}`; `POST /api/v1/workspaces/:wid/projects {name}` → `{id,name}` |

### 2.1 Create-new resolution at save

The create request carries, per level, **either** an existing id **or** a new name (XOR):

| Field | Existing | New |
|---|---|---|
| Workspace | `workspaceId: string` | `newWorkspaceName: string` |
| Project | `externalProjectId: string` | `newProjectName: string` |

The controller resolves new-names to ids **before** persisting:
1. If `newWorkspaceName` → `adapter.createWorkspace(config, name)` → `workspaceId`.
2. If `newProjectName` → `adapter.createProject(config, name)` → `externalProjectId` (requires `workspaceId` resolved first).
3. Persist the connector with resolved `config.workspaceId` and top-level `externalProjectId`.

If creation fails, the whole create fails — no half-saved connector.

---

## 3. Data model

No schema migration. Shapes are unchanged; the UI + controller just stop using email/password and resolve new-names to ids at save.

- `Connector.config`: `{ apiUrl: string; credentials: { token: string }; workspaceId?: string }`
  - `credentials` is still typed `Record<string, string>` (DTO) — the UI sends `{ token }`.
- `Connector.externalProjectId: string | null` — the selected/created project id (top-level column).

### 3.1 DTO changes

**`CreateConnectorDtoSchema` / `UpdateConnectorDtoSchema`** (`dtos/connector.dto.ts`):
- Add optional `newWorkspaceName?: string` and `newProjectName?: string` (XOR with `config.workspaceId` / `externalProjectId` respectively). Enforced via `.superRefine` (the same pattern used by the auto-assign DTOs).
- `config.credentials` keeps `z.record(z.string())`; UI sends `{ token }`.

**New inline-credential DTOs** (for the preview endpoints):
```ts
PreviewWorkspacesDto = { apiUrl: z.string().url(); apiKey: z.string().min(1) }
PreviewProjectsDto   = { apiUrl: z.string().url(); apiKey: z.string().min(1); workspaceId: z.string().min(1) }
```

---

## 4. Backend

### 4.1 Adapter (`taskim.adapter.ts`) + interface

`ConnectorAdapter` interface gains:
```ts
listWorkspaces(config): Promise<{ id: string; name: string }[]>;
listProjects(config): Promise<{ id: string; name: string }[]>;   // rename of listRemoteProjects
createWorkspace(config, name: string): Promise<{ id: string; name: string }>;
createProject(config, name: string): Promise<{ id: string; name: string }>;
```

`TaskimAdapter` implementation:
- `authenticate(config)` — **token-only**: read `credentials.token`, cache as Bearer (existing token fast-path). **Remove** the email/password `POST /api/v1/auth/login` branch and its token-cache login logic.
- `listWorkspaces` — `GET /api/v1/workspaces`, reuse the array-or-`{data}` parsing already in `listRemoteProjects`.
- `listProjects` — existing `listRemoteProjects` body, renamed.
- `createWorkspace` — `POST /api/v1/workspaces` `{ name }` → `{ id, name }`.
- `createProject` — `POST /api/v1/workspaces/:wid/projects` `{ name }` → `{ id, name }` (requires `config.workspaceId`).

The existing `testConnection` stays (used by future "test" UI / health checks) but its no-workspace branch already proves the workspaces endpoint works.

### 4.2 Controller (`connectors.controller.ts`)

New preview endpoints (credentials inline, **no saved connector**), mirroring the `:id/test` pattern:
- `POST /api/connectors/taskim/preview-workspaces` body `PreviewWorkspacesDto` → `{id,name}[]`. Builds a transient config `{ apiUrl, credentials: { token: apiKey } }`, calls `adapter.listWorkspaces`.
- `POST /api/connectors/taskim/preview-projects` body `PreviewProjectsDto` → `{id,name}[]`. Same transient config, calls `adapter.listProjects`.

Extended create flow in `POST /api/connectors`:
- After DTO parse, if `newWorkspaceName` or `newProjectName` is present, build the transient config from `{apiUrl, credentials:{token}}` (+ resolved workspaceId for project creation), call the adapter's create methods to resolve ids, then strip the `new*Name` fields and set `config.workspaceId` / `externalProjectId` before delegating to `service.create`.
- The controller already injects `TaskimAdapter` (used by `:id/test`); reuse that. The create-path adapter calls are best-effort-fail-loud (errors propagate as a 4xx/5xx via the global filter).

### 4.3 Non-changes
- `ConnectorsService` stays a CRUD facade (no adapter calls there). Status mappings, sync state, webhook, event listener — untouched.

---

## 5. Frontend (`ConnectorsPage.tsx` + `ui/lib/connectors.ts`)

### 5.1 API client additions (`ui/lib/connectors.ts`)
```ts
previewWorkspaces({ apiUrl, apiKey }): Promise<{id,name}[]>
previewProjects({ apiUrl, apiKey, workspaceId }): Promise<{id,name}[]>
```
`createConnector` payload type gains optional `newWorkspaceName?` / `newProjectName?`.

### 5.2 Form state & flow

State:
- `apiUrl`, `apiKey`
- `connectionState: 'idle' | 'connecting' | 'connected' | 'error'`, `connectionError`
- `workspaces[]`, `workspaceMode: 'select' | 'new'`, `workspaceId`, `newWorkspaceName`
- `projects[]`, `projectMode: 'select' | 'new'`, `projectId`, `newProjectName`
- `name` (connector name)

Flow:
1. **Auth row** — `apiUrl` + API key inputs + **Connect** button. On click → `previewWorkspaces`. On success: `connectionState='connected'`, populate `workspaces`. On failure: `connectionState='error'`, inline message, pickers stay disabled.
2. **Workspace row** (disabled unless `connected`) — a shadcn `<Select>` of workspaces + a "Create new" toggle. Selecting an existing workspace → `previewProjects({apiUrl, apiKey, workspaceId})` → populates `projects`. Toggling "Create new" → shows a name input (`workspaceMode='new'`) and still triggers project fetch after the workspace is resolved at save (project picker stays empty until save in the new-workspace case — see §5.3).
3. **Project row** (disabled unless a workspace is chosen/created) — `<Select>` of projects + "Create new" toggle.
4. **Name + Save** → builds the create payload:
   - `{ workspaceId }` or `{ newWorkspaceName }` (XOR)
   - `{ externalProjectId: projectId }` or `{ newProjectName }` (XOR)
   - `config: { apiUrl, credentials: { token: apiKey } }`

Save button disabled unless `connected && workspace resolved && project resolved && name`.

### 5.3 New-workspace + project interaction
When `workspaceMode='new'`, the project list can't be fetched until the workspace exists on Taskim. Two supported combinations:
- New workspace + **existing project**: not possible (no projects without a workspace). Hide the project picker until the workspace is selected-existing.
- New workspace + **new project**: allowed — both created at save (workspace first, then project under it).
- Existing workspace + new/existing project: fully cascaded as today.

So: **project picker is enabled only when an existing workspace is selected**, OR when `workspaceMode='new'` (project forced to "Create new" mode). This avoids a confusing empty dropdown.

### 5.4 Edit flow (existing connector)
Opening a connector for edit pre-fills `apiUrl` + `apiKey` (from `config.credentials.token`) and **auto-runs Connect** on mount (`useEffect`), so workspaces/projects load and the stored selections are shown. Switching workspace/project re-fetches as in create.

---

## 6. Error handling

| Case | Handling |
|---|---|
| Bad API key / wrong apiUrl at Connect | Inline error on Connect button; pickers stay disabled; no dropdown fetch |
| Workspaces or projects list empty | "No {workspaces\|projects} found" + the Create-new toggle highlighted |
| Save-time createWorkspace/createProject failure | Whole create fails; error surfaces from the global filter; nothing persisted |
| Adapter network error mid-fetch | Dropdown shows "Failed to load — retry" |

---

## 7. Testing

- **Adapter** — unit tests (mock `fetch`): `listWorkspaces` (array + `{data}` shapes), `listProjects`, `createWorkspace`, `createProject` (success + non-2xx → throws), `authenticate` token-only (assert the login POST branch is gone).
- **Controller** — `preview-workspaces` / `preview-projects` (require `apiUrl`+`apiKey`; `preview-projects` requires `workspaceId`); `POST /api/connectors` create with `newWorkspaceName`/`newProjectName` → adapter create called → resolved ids persisted; XOR enforcement (`workspaceId` + `newWorkspaceName` together rejected).
- **UI** — pickers disabled until Connect; successful Connect populates workspaces; selecting workspace fetches projects; Create-new toggle swaps Select→input; save payload correct for all 4 combinations (existing/new × workspace/project).

---

## 8. Non-goals

- monday / jira adapters (still "coming soon").
- Status-mapping UI, webhook flow, sync-state UI — unchanged.
- Token refresh (`POST /api/v1/auth/refresh`) — out of scope; API keys are long-lived.
- Encryption of credentials at rest — out of scope (pre-existing gap).
- Bulk import / migration of existing connectors — N/A (feature is local-only, no deployed connectors to migrate).

---

## 9. Open items (deferred to implementation plan)

- Confirm Taskim's exact response shape for `POST /api/v1/workspaces` and `POST /api/v1/workspaces/:wid/projects` against a live instance (the array-vs-`{data}` defensive parsing is reused regardless).
- Decide whether the removed email/password adapter spec tests are deleted or rewritten for the token path.
- Whether to surface a "Test connection" button on existing connector cards (the `:id/test` endpoint + `testConnection()` client already exist but are unwired) — not required for this feature.
