# Connectors Design Spec

> **Date:** 2026-06-16
> **Status:** Approved
> **Scope:** Bidirectional real-time sync between DevChain epics and external task management services (Taskim, Monday, Jira)

---

## 1. Purpose

Connectors are plugins that sync DevChain epics (and their comments, statuses, assignments, tags, and parent/child hierarchy) with external task management services in real-time. Changes made in DevChain propagate to the external system, and changes made in the external system propagate back to DevChain.

**Primary use cases:**
- Mirror agent work from DevChain into a shared board (Monday/Jira) for stakeholder visibility
- Pull planning decisions from external systems into DevChain for agent execution
- Keep a personal task manager (Taskim) in sync with agent activity

---

## 2. Architecture

### 2.1 Approach: Built-in Adapters

Each connector is a NestJS module implementing a shared `ConnectorAdapter` interface. This approach was chosen over a dynamic plugin system because:

- Only 3 connectors are planned initially — plugin loader infrastructure isn't justified yet
- Full bidirectional sync requires custom logic per service (field mapping, status resolution, conflict handling)
- Built-in adapters get type safety, direct DI access, and existing test patterns
- The `ConnectorAdapter` interface is designed to be extractable to a plugin system later (see Section 7)

### 2.2 Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     Connectors Module                            │
│                                                                  │
│  ┌──────────────────────────────────────────────────────┐       │
│  │              ConnectorService                         │       │
│  │  (orchestrates sync, manages adapter lifecycle,       │       │
│  │   routes events to adapters, handles webhooks)        │       │
│  └──────────┬───────────────────────┬────────────────────┘       │
│             │                       │                            │
│   ┌─────────▼─────────┐  ┌──────────▼───────────┐               │
│   │  Event Listeners  │  │  Webhook Receiver    │               │
│   │ (epic.created,    │  │  POST /api/connector │               │
│   │  epic.updated,    │  │  /webhook/:connector │               │
│   │  epic.deleted,    │  │  Id/:projectId       │               │
│   │  comment.created) │  │  → parses payload    │               │
│   └─────────┬─────────┘  └──────────┬───────────┘               │
│             │                       │                            │
│             └───────────┬───────────┘                            │
│                         ▼                                        │
│   ┌──────────────────────────────────────────┐                   │
│   │       ConnectorAdapter Interface          │                   │
│   │  pushEpic(), pullEpic(), mapStatus(),     │                   │
│   │  mapFields(), authenticate(), testConn()  │                   │
│   └─────┬──────────┬──────────────┬──────────┘                   │
│         │          │              │                               │
│   ┌─────▼────┐ ┌───▼─────┐ ┌─────▼─────┐                        │
│   │ Taskim   │ │ Monday  │ │  Jira     │                        │
│   │ Adapter  │ │ Adapter │ │  Adapter  │                        │
│   └──────────┘ └─────────┘ └───────────┘                        │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 Key Components

| Component | Responsibility |
|-----------|---------------|
| `ConnectorService` | Orchestrator — manages adapter lifecycle, routes events to adapters, handles inbound webhooks |
| `ConnectorAdapter` interface | Contract each service implements: push/pull epics, comments, status mapping, auth, connection testing |
| `ConnectorEventListener` | NestJS `@OnEvent` subscribers on `epic.created/updated/deleted`, `epic.comment.created` that trigger outbound sync |
| `WebhookController` | Receives `POST /api/connectors/webhook/:connectorId/:projectId`, dispatches to adapter for parsing |
| `SyncStateTracker` | Tracks last-synced timestamps and remote IDs per epic, detects conflicts, prevents sync loops |
| `ConnectorsController` | CRUD API for connector configurations, status mappings, manual sync trigger |

---

## 3. Data Model

### 3.1 `connectors` Table

Connector configurations, one row per project-connector pair.

| Column | Type | Description |
|--------|------|-------------|
| `id` | text PK | UUID |
| `projectId` | text FK → projects | DevChain project |
| `type` | text | `taskim` \| `monday` \| `jira` |
| `name` | text | User-friendly label |
| `enabled` | integer | 0/1 |
| `config` | text (JSON) | Type-specific config (API URL, credentials, workspace/board ID) |
| `externalProjectId` | text | Remote system's project/board ID to sync with |
| `createdAt` | text | ISO timestamp |
| `updatedAt` | text | ISO timestamp |

### 3.2 `connector_status_mappings` Table

Explicit status mapping between DevChain statuses and external statuses.

| Column | Type | Description |
|--------|------|-------------|
| `id` | text PK | UUID |
| `connectorId` | text FK → connectors | Which connector config |
| `devchainStatusLabel` | text | DevChain status label (e.g., "In Progress") |
| `externalStatusId` | text | External status ID or name (e.g., "in_progress") |
| `direction` | text | `both` \| `push` \| `pull` |

### 3.3 `connector_sync_state` Table

Tracks sync state per epic per connector. Used for conflict detection and loop prevention.

| Column | Type | Description |
|--------|------|-------------|
| `id` | text PK | UUID |
| `connectorId` | text FK → connectors | Which connector |
| `epicId` | text FK → epics | DevChain epic |
| `externalId` | text | Remote task ID |
| `lastSyncedAt` | text | Last successful sync timestamp |
| `lastSyncedHash` | text | Hash of synced field values (for change detection) |

### 3.4 `connector_field_mappings` Table

Optional custom field mappings for advanced use.

| Column | Type | Description |
|--------|------|-------------|
| `id` | text PK | UUID |
| `connectorId` | text FK → connectors | |
| `devchainField` | text | `title` \| `description` \| `tags` \| `agentName` |
| `externalField` | text | Remote field name |
| `transform` | text (JSON, nullable) | Optional transform rule |

---

## 4. Sync Flow

### 4.1 Outbound (DevChain → External)

```
Agent calls devchain_update_epic(id, {statusName: "Review"})
  → EpicsService publishes epic.updated event
  → ConnectorEventListener (@OnEvent('epic.updated'))
    → Check: is epic marked syncingFromRemote? If yes, skip (loop prevention)
    → SyncStateTracker.getSyncState(connectorId, epicId)
    → If epic has external mapping:
      → adapter.pushEpic(epic, mapping, syncState)
      → SyncStateTracker.update(connectorId, epicId, hash, timestamp)
    → If no mapping (new epic):
      → adapter.pushEpic() creates remote task
      → SyncStateTracker.create(connectorId, epicId, externalId)
```

### 4.2 Inbound (External → DevChain)

```
External service fires webhook
  → POST /api/connectors/webhook/:connectorId/:projectId
  → WebhookController
    → adapter.resolveWebhook(payload) → normalized event
      → { action: 'created'|'updated'|'deleted', externalId, fields, timestamp }
    → ConnectorService.handleInbound(connectorId, projectId, event)
      → SyncStateTracker.findByExternalId(connectorId, externalId)
      → If found: compare timestamps (last-write-wins)
        → If remote timestamp newer: update DevChain epic (set syncingFromRemote flag)
        → If DevChain newer: push DevChain version back (correction sync)
      → If not found: create new DevChain epic
      → SyncStateTracker.update()
```

### 4.3 Conflict Resolution: Last-Write-Wins

When the same epic/task is edited in both systems since the last sync:

1. Compare the remote event timestamp with `syncState.lastSyncedAt`
2. If remote timestamp is newer → remote wins, update DevChain
3. If DevChain timestamp is newer → DevChain wins, push DevChain version to external
4. Timestamps are compared in UTC milliseconds

### 4.4 Loop Prevention

The `ConnectorService` maintains an in-memory `Set<epicId>` called `syncingFromRemote`. When processing an inbound webhook:

1. Add the epic ID to `syncingFromRemote` before calling `EpicsService.updateEpic()`
2. The outbound event listener checks: `if (syncingFromRemote.has(epicId)) → skip push, delete from set, return`
3. If not in the set → proceed with outbound push as normal

This works because NestJS EventEmitter2 processes events synchronously within the same call stack. The flag only needs to live for the duration of one update cycle. On server restart, the set is empty (which is safe — worst case is one redundant outbound push).

### 4.5 Comment Sync

- **Outbound:** `epic.comment.created` event → `adapter.pushComment()`
- **Inbound:** webhook → `adapter.resolveWebhook()` returns comment event → add epic comment with `[via {connector}]` prefix and author attribution
- Comments are appended, never overwritten

### 4.6 Hierarchy Sync

Parent/child epics map to parent/child tasks in external systems:

| System | Hierarchy Support | Mapping Strategy |
|--------|------------------|-----------------|
| Taskim | `parentId` field | Direct match — DevChain `parentId` → Taskim `parentId` |
| Monday | Subitems | DevChain child epic → Monday subitem of parent item |
| Jira | Epic-story hierarchy | DevChain parent → Jira Epic, DevChain child → Jira Story linked to Epic |

If an external system doesn't support hierarchy, flatten with a tag like `parent:<title>` on child tasks.

---

## 5. UI & Configuration

### 5.1 Connectors Page (route: `/connectors`)

Per project, shows a grid of available connector types. Each connector has:

**Connection setup card:**
- Connector type (Taskim / Monday / Jira)
- Display name
- API URL + credentials (per-connector fields)
- "Test Connection" button → calls `adapter.testConnection()`
- Enable/disable toggle

**Field mapping section:**
- Status mapping table (DevChain status ↔ External status dropdowns)
- Project/board selector (fetches remote projects via adapter)

**Sync status panel:**
- Last sync timestamp
- Number of synced epics
- Errors/warnings log
- Manual "Sync Now" button (full resync)

### 5.2 Sidebar Navigation

Add "Connectors" to the project sidebar (next to Epics, Reviews, Scheduled Epics).

### 5.3 API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/connectors` | List connectors for project |
| `POST` | `/api/connectors` | Create connector config |
| `PUT` | `/api/connectors/:id` | Update config |
| `DELETE` | `/api/connectors/:id` | Delete connector |
| `POST` | `/api/connectors/:id/test` | Test connection |
| `POST` | `/api/connectors/:id/sync` | Manual full resync |
| `GET` | `/api/connectors/:id/status-mappings` | List status mappings |
| `PUT` | `/api/connectors/:id/status-mappings` | Update status mappings |
| `POST` | `/api/connectors/webhook/:connectorId/:projectId` | Incoming webhook receiver |

---

## 6. Connector Implementations

### 6.1 Taskim Adapter (MVP — build first)

**Config fields:**
- `apiUrl` (e.g., `http://localhost:3000`)
- `email` + `password` (or `token`)
- `workspaceId` + `projectId` (resolved via `GET /api/v1/workspaces/:wid/projects`)

**Field mapping:**

| DevChain Epic | Taskim Task | Notes |
|---------------|-------------|-------|
| `title` | `title` | Direct |
| `description` | `description` | Direct |
| `statusName` | `status` | Via status mapping table |
| `tags` | `labels` | Map by name |
| `agentId` (resolved to name) | `assigneeId` | Resolve via Taskim user lookup |
| `parentId` | `parentId` | Direct |
| Epic comments | Taskim comments | With `[via DevChain]` attribution |

**Auth flow:**
1. Login via `POST /api/v1/auth/login` with email/password → receive JWT access + refresh tokens
2. Use access token for all subsequent API calls
3. On 401 response, refresh via `POST /api/v1/auth/refresh`
4. Store tokens in connector config (encrypted at rest)

**Webhook setup:**
- Taskim has an automations system that can fire webhooks on task changes (status changes, label assignment, etc.)
- DevChain does NOT auto-register webhooks with Taskim (no direct webhook registration API)
- Two options for inbound sync:
  1. **WebSocket subscription** (preferred): DevChain connects to `ws://<taskim-host>/ws?token=<jwt>` and listens for task events in the `project:<id>` room. Real-time, no manual setup.
  2. **Manual automation rule**: User configures a Taskim automation rule to POST to DevChain's webhook URL on task changes. More setup, but doesn't require a persistent WebSocket connection.
- MVP uses option 1 (WebSocket) for zero-config inbound sync

**Taskim API endpoints used:**

| Taskim API | Purpose |
|------------|---------|
| `POST /api/v1/auth/login` | Authenticate |
| `POST /api/v1/auth/refresh` | Refresh token |
| `GET /api/v1/workspaces/:wid/projects` | List projects for board selector |
| `GET /api/v1/workspaces/:wid/projects/:pid/tasks` | Pull tasks (sync/resync) |
| `POST /api/v1/workspaces/:wid/projects/:pid/tasks` | Create task (push new epic) |
| `PATCH /api/v1/workspaces/:wid/projects/:pid/tasks/:tid` | Update task (push changes) |
| `DELETE /api/v1/workspaces/:wid/projects/:pid/tasks/:tid` | Delete task (push deletion) |
| `POST /api/v1/workspaces/:wid/projects/:pid/tasks/:tid/comments` | Push comment |
| `GET /api/v1/workspaces/:wid/projects/:pid/tasks/:tid/comments` | Pull comments |

### 6.2 Monday Adapter (Phase 2)

**Config fields:**
- `apiUrl` (always `https://api.monday.com/v2`)
- `apiToken`
- `boardId`

**Notes:**
- Uses Monday's GraphQL API
- DevChain Epic → Monday Item: `title` → `name`, `description` → column value, `statusName` → status column
- Sub-items for hierarchy (requires separate API calls)

### 6.3 Jira Adapter (Phase 2)

**Config fields:**
- `domain` (e.g., `myteam.atlassian.net`)
- `email` + `apiToken`
- `projectKey` (Jira project key)

**Notes:**
- Uses Jira REST API v3
- DevChain Epic → Jira Issue: `title` → `summary`, `description` → `description`, `statusName` → Jira transition
- Jira epic-story hierarchy for parent/child

---

## 7. Future Plugin Path (Approach 2 — for later consideration)

> **This section documents the migration path to a plugin package system. It is NOT part of the current implementation scope.**

When connector count exceeds 5, migrate to a plugin package system similar to Taskim's plugin-sdk. The `ConnectorAdapter` interface is designed to be extractable — it has no DevChain-specific imports.

**A future `ConnectorPluginLoader` would:**
1. Scan a `connectors/` directory for npm packages
2. Load each package's default export (must implement `ConnectorAdapter`)
3. Register with the `ConnectorService` at startup
4. Sandbox plugin errors to prevent system crashes
5. Provide a `PluginContext` with limited access to DevChain services

**The interface contract stays the same; only the loading mechanism changes.** Built-in adapters can be extracted to external packages without breaking the sync logic.

---

## 8. Testing Strategy

### 8.1 Unit Tests

- `ConnectorService` — orchestration logic, event routing, conflict resolution
- Each adapter — `pushEpic()`, `pullEpic()`, `mapStatus()`, `resolveWebhook()` with mocked HTTP
- `SyncStateTracker` — state tracking, hash comparison, loop prevention flag
- Status mapping resolution — bidirectional status lookups

### 8.2 Integration Tests

- Outbound sync: epic event → adapter push → verify HTTP call
- Inbound sync: webhook → epic created/updated in DB
- Loop prevention: inbound change does not trigger outbound push
- Conflict resolution: simultaneous edits resolved by timestamp
- Comment sync: both directions
- Hierarchy sync: parent/child creation and updates

### 8.3 End-to-End (Taskim only)

- Full resync against a real (local) Taskim instance
- Create epic in DevChain → verify it appears in Taskim
- Create task in Taskim → verify it appears in DevChain
- Update in both → verify last-write-wins

---

## 9. Implementation Phases

| Phase | Scope | Deliverable |
|-------|-------|-------------|
| **1. Core infrastructure** | DB tables, ConnectorAdapter interface, ConnectorService, SyncStateTracker, event listeners, WebhookController, ConnectorsController (CRUD API) | Working sync framework with no adapters |
| **2. Taskim adapter** | Full Taskim adapter implementation, auth flow, field mapping, webhook parsing, integration tests | Working bidirectional sync with local Taskim |
| **3. UI** | ConnectorsPage, status mapping editor, sync status panel, sidebar entry | Full configuration UI |
| **4. Monday adapter** | Monday GraphQL adapter, subitem hierarchy | Working bidirectional sync with Monday |
| **5. Jira adapter** | Jira REST adapter, epic-story hierarchy | Working bidirectional sync with Jira |
