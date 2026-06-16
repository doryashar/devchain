# Connectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a connectors system that syncs DevChain epics bidirectionally with external task management services (Taskim first, then Monday/Jira).

**Architecture:** Built-in NestJS adapter modules implementing a shared `ConnectorAdapter` interface. Outbound sync via `@OnEvent` listeners; inbound sync via webhook/WebSocket. Last-write-wins conflict resolution. Full config UI.

**Tech Stack:** NestJS, Drizzle ORM (SQLite), Zod validation, React + TanStack Query + shadcn/ui

**Spec:** `docs/connectors-design.md`

---

## File Structure

```
apps/local-app/src/modules/connectors/
├── connectors.module.ts                  # NestJS module wiring
├── controllers/
│   ├── connectors.controller.ts           # CRUD API for connector configs
│   ├── connectors.controller.spec.ts
│   └── webhook.controller.ts              # Inbound webhook receiver
├── services/
│   ├── connectors.service.ts              # Main orchestrator (CRUD + sync dispatch)
│   ├── connectors.service.spec.ts
│   ├── sync-state-tracker.service.ts      # Tracks last-synced state per epic
│   ├── sync-state-tracker.service.spec.ts
│   └── connector-event-listener.service.ts # @OnEvent subscribers for outbound sync
├── adapters/
│   ├── connector-adapter.interface.ts     # Shared interface all adapters implement
│   ├── taskim.adapter.ts                  # Taskim REST API adapter
│   └── taskim.adapter.spec.ts
├── dtos/
│   └── connector.dto.ts                   # Zod schemas for create/update
└── helpers/
    └── field-mapper.helper.ts             # Shared field/status mapping logic

apps/local-app/src/modules/storage/
├── db/schema.ts                           # +4 tables (append)
├── interfaces/storage.interface.ts        # +ConnectorStorage interface (append)
├── local/delegates/connector.delegate.ts  # Storage delegate CRUD
├── local/local-storage.service.ts         # +passthrough methods (append)
└── models/domain.models.ts               # +Connector types (append)

apps/local-app/drizzle/
└── 0065_connectors.sql                    # DB migration

apps/local-app/src/ui/
├── lib/connectors.ts                      # API client functions
├── pages/ConnectorsPage.tsx               # Config + status UI
├── App.tsx                                # +route (modify)
└── components/Layout.tsx                  # +sidebar entry (modify)
```

---

## Task 1: DB Schema — Add Connector Tables

**Files:**
- Modify: `apps/local-app/src/modules/storage/db/schema.ts` (append at end, before closing)
- Create: `apps/local-app/drizzle/0065_connectors.sql`

- [ ] **Step 1: Add table definitions to schema.ts**

Append these exports to the end of `apps/local-app/src/modules/storage/db/schema.ts`:

```ts
// ============================================
// CONNECTORS - External service sync plugins
// ============================================
export const connectors = sqliteTable(
  'connectors',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // 'taskim' | 'monday' | 'jira'
    name: text('name').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    config: text('config', { mode: 'json' }).notNull(), // type-specific config object
    externalProjectId: text('external_project_id'), // remote board/project ID
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    projectIdIdx: index('connectors_project_id_idx').on(table.projectId),
    typeIdx: index('connectors_type_idx').on(table.type),
  }),
);

export const connectorStatusMappings = sqliteTable(
  'connector_status_mappings',
  {
    id: text('id').primaryKey(),
    connectorId: text('connector_id')
      .notNull()
      .references(() => connectors.id, { onDelete: 'cascade' }),
    devchainStatusLabel: text('devchain_status_label').notNull(),
    externalStatusId: text('external_status_id').notNull(),
    direction: text('direction').notNull().default('both'), // 'both' | 'push' | 'pull'
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    connectorIdIdx: index('connector_status_mappings_connector_id_idx').on(table.connectorId),
  }),
);

export const connectorSyncState = sqliteTable(
  'connector_sync_state',
  {
    id: text('id').primaryKey(),
    connectorId: text('connector_id')
      .notNull()
      .references(() => connectors.id, { onDelete: 'cascade' }),
    epicId: text('epic_id')
      .notNull()
      .references(() => epics.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    lastSyncedAt: text('last_synced_at').notNull(),
    lastSyncedHash: text('last_synced_hash'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    connectorEpicIdx: uniqueIndex('connector_sync_state_connector_epic_idx').on(
      table.connectorId,
      table.epicId,
    ),
    connectorExternalIdx: index('connector_sync_state_connector_external_idx').on(
      table.connectorId,
      table.externalId,
    ),
  }),
);

export const connectorFieldMappings = sqliteTable(
  'connector_field_mappings',
  {
    id: text('id').primaryKey(),
    connectorId: text('connector_id')
      .notNull()
      .references(() => connectors.id, { onDelete: 'cascade' }),
    devchainField: text('devchain_field').notNull(),
    externalField: text('external_field').notNull(),
    transform: text('transform', { mode: 'json' }),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    connectorIdIdx: index('connector_field_mappings_connector_id_idx').on(table.connectorId),
  }),
);
```

- [ ] **Step 2: Create the migration SQL file**

Create `apps/local-app/drizzle/0065_connectors.sql`:

```sql
CREATE TABLE `connectors` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`config` text NOT NULL,
	`external_project_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `connectors_project_id_idx` ON `connectors` (`project_id`);
--> statement-breakpoint
CREATE INDEX `connectors_type_idx` ON `connectors` (`type`);
--> statement-breakpoint
CREATE TABLE `connector_status_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`connector_id` text NOT NULL,
	`devchain_status_label` text NOT NULL,
	`external_status_id` text NOT NULL,
	`direction` text DEFAULT 'both' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`connector_id`) REFERENCES `connectors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `connector_status_mappings_connector_id_idx` ON `connector_status_mappings` (`connector_id`);
--> statement-breakpoint
CREATE TABLE `connector_sync_state` (
	`id` text PRIMARY KEY NOT NULL,
	`connector_id` text NOT NULL,
	`epic_id` text NOT NULL,
	`external_id` text NOT NULL,
	`last_synced_at` text NOT NULL,
	`last_synced_hash` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`connector_id`) REFERENCES `connectors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`epic_id`) REFERENCES `epics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connector_sync_state_connector_epic_idx` ON `connector_sync_state` (`connector_id`,`epic_id`);
--> statement-breakpoint
CREATE INDEX `connector_sync_state_connector_external_idx` ON `connector_sync_state` (`connector_id`,`external_id`);
--> statement-breakpoint
CREATE TABLE `connector_field_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`connector_id` text NOT NULL,
	`devchain_field` text NOT NULL,
	`external_field` text NOT NULL,
	`transform` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`connector_id`) REFERENCES `connectors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `connector_field_mappings_connector_id_idx` ON `connector_field_mappings` (`connector_id`);
```

- [ ] **Step 3: Register migration in journal**

Add entry to `apps/local-app/drizzle/meta/_journal.json` before the closing `]`:

```json
,
{
  "idx": 65,
  "version": "6",
  "when": 1779999999999,
  "tag": "0065_connectors",
  "breakpoints": true
}
```

- [ ] **Step 4: Verify the app starts and migration runs**

Run: `node dist/main.js` (from `apps/local-app/`), check logs for `Database migrations completed successfully`.

- [ ] **Step 5: Commit**

```bash
git add apps/local-app/src/modules/storage/db/schema.ts apps/local-app/drizzle/0065_connectors.sql apps/local-app/drizzle/meta/_journal.json
git commit -m "feat(connectors): add DB schema and migration for connector tables"
```

---

## Task 2: Domain Models + Storage Interface

**Files:**
- Modify: `apps/local-app/src/modules/storage/models/domain.models.ts` (append)
- Modify: `apps/local-app/src/modules/storage/interfaces/storage.interface.ts` (append)

- [ ] **Step 1: Add domain model interfaces**

Append to `apps/local-app/src/modules/storage/models/domain.models.ts`:

```ts
// ============================================
// CONNECTORS
// ============================================

export type ConnectorType = 'taskim' | 'monday' | 'jira';

export interface ConnectorConfig {
  apiUrl: string;
  credentials: Record<string, string>;
  workspaceId?: string;
  [key: string]: unknown;
}

export interface Connector {
  id: string;
  projectId: string;
  type: ConnectorType;
  name: string;
  enabled: boolean;
  config: ConnectorConfig;
  externalProjectId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CreateConnector = Omit<Connector, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateConnector = Partial<Omit<Connector, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>>;

export interface ConnectorStatusMapping {
  id: string;
  connectorId: string;
  devchainStatusLabel: string;
  externalStatusId: string;
  direction: 'both' | 'push' | 'pull';
  createdAt: string;
}

export type CreateConnectorStatusMapping = Omit<ConnectorStatusMapping, 'id' | 'createdAt'>;
export type UpdateConnectorStatusMapping = Partial<Omit<ConnectorStatusMapping, 'id' | 'connectorId' | 'createdAt'>>;

export interface ConnectorSyncState {
  id: string;
  connectorId: string;
  epicId: string;
  externalId: string;
  lastSyncedAt: string;
  lastSyncedHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CreateConnectorSyncState = Omit<ConnectorSyncState, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateConnectorSyncState = Partial<Omit<ConnectorSyncState, 'id' | 'createdAt' | 'updatedAt'>>;

export interface ConnectorFieldMapping {
  id: string;
  connectorId: string;
  devchainField: string;
  externalField: string;
  transform: Record<string, unknown> | null;
  createdAt: string;
}

export type CreateConnectorFieldMapping = Omit<ConnectorFieldMapping, 'id' | 'createdAt'>;
```

- [ ] **Step 2: Add ConnectorStorage interface**

Append to `apps/local-app/src/modules/storage/interfaces/storage.interface.ts` (before the main `StorageService` composition):

```ts
export interface ConnectorStorage {
  listConnectors(projectId: string): Promise<Connector[]>;
  getConnector(id: string): Promise<Connector | null>;
  createConnector(data: CreateConnector): Promise<Connector>;
  updateConnector(id: string, data: UpdateConnector): Promise<Connector>;
  deleteConnector(id: string): Promise<void>;

  listStatusMappings(connectorId: string): Promise<ConnectorStatusMapping[]>;
  createStatusMapping(data: CreateConnectorStatusMapping): Promise<ConnectorStatusMapping>;
  updateStatusMapping(id: string, data: UpdateConnectorStatusMapping): Promise<ConnectorStatusMapping>;
  deleteStatusMapping(id: string): Promise<void>;

  getSyncState(connectorId: string, epicId: string): Promise<ConnectorSyncState | null>;
  findSyncStateByExternalId(connectorId: string, externalId: string): Promise<ConnectorSyncState | null>;
  createSyncState(data: CreateConnectorSyncState): Promise<ConnectorSyncState>;
  updateSyncState(id: string, data: UpdateConnectorSyncState): Promise<ConnectorSyncState>;
  listSyncStates(connectorId: string): Promise<ConnectorSyncState[]>;

  listFieldMappings(connectorId: string): Promise<ConnectorFieldMapping[]>;
  createFieldMapping(data: CreateConnectorFieldMapping): Promise<ConnectorFieldMapping>;
  deleteFieldMapping(id: string): Promise<void>;
}
```

Then add `ConnectorStorage` to the `StorageService extends` list:

```ts
export interface StorageService
  extends ProjectStorage,
    // ... existing ...
    ScheduledEpicStorage,
    ConnectorStorage {}
```

Don't forget to import the new types from `domain.models.ts` at the top of `storage.interface.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/local-app/src/modules/storage/models/domain.models.ts apps/local-app/src/modules/storage/interfaces/storage.interface.ts
git commit -m "feat(connectors): add domain models and storage interface"
```

---

## Task 3: Storage Delegate

**Files:**
- Create: `apps/local-app/src/modules/storage/local/delegates/connector.delegate.ts`
- Create: `apps/local-app/src/modules/storage/local/delegates/connector.delegate.spec.ts`

- [ ] **Step 1: Write the storage delegate**

Create `apps/local-app/src/modules/storage/local/delegates/connector.delegate.ts`:

```ts
import type {
  Connector,
  CreateConnector,
  UpdateConnector,
  ConnectorStatusMapping,
  CreateConnectorStatusMapping,
  UpdateConnectorStatusMapping,
  ConnectorSyncState,
  CreateConnectorSyncState,
  UpdateConnectorSyncState,
  ConnectorFieldMapping,
  CreateConnectorFieldMapping,
  ConnectorConfig,
} from '../../models/domain.models';
import { NotFoundError } from '../../../../common/errors/error-types';
import { BaseStorageDelegate, type StorageDelegateContext } from './base-storage.delegate';

export class ConnectorStorageDelegate extends BaseStorageDelegate {
  constructor(context: StorageDelegateContext) {
    super(context);
  }

  async listConnectors(projectId: string): Promise<Connector[]> {
    const { connectors } = await import('../../db/schema');
    const { eq, desc } = await import('drizzle-orm');

    const rows = await this.db
      .select()
      .from(connectors)
      .where(eq(connectors.projectId, projectId))
      .orderBy(desc(connectors.createdAt));

    return rows.map((row) => ({
      ...row,
      config: row.config as ConnectorConfig,
    })) as Connector[];
  }

  async getConnector(id: string): Promise<Connector | null> {
    const { connectors } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');

    const rows = await this.db.select().from(connectors).where(eq(connectors.id, id)).limit(1);
    if (rows.length === 0) return null;
    const row = rows[0]!;
    return { ...row, config: row.config as ConnectorConfig } as Connector;
  }

  async createConnector(data: CreateConnector): Promise<Connector> {
    const { randomUUID } = await import('crypto');
    const now = new Date().toISOString();
    const { connectors } = await import('../../db/schema');

    const id = randomUUID();
    await this.db.insert(connectors).values({
      id,
      projectId: data.projectId,
      type: data.type,
      name: data.name,
      enabled: data.enabled,
      config: data.config,
      externalProjectId: data.externalProjectId ?? null,
      createdAt: now,
      updatedAt: now,
    });

    const created = await this.getConnector(id);
    if (!created) throw new NotFoundError('Connector', id);
    return created;
  }

  async updateConnector(id: string, data: UpdateConnector): Promise<Connector> {
    const { connectors } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');
    const now = new Date().toISOString();

    const existing = await this.getConnector(id);
    if (!existing) throw new NotFoundError('Connector', id);

    const updateData: Record<string, unknown> = { updatedAt: now };
    if (data.name !== undefined) updateData.name = data.name;
    if (data.enabled !== undefined) updateData.enabled = data.enabled;
    if (data.config !== undefined) updateData.config = data.config;
    if (data.externalProjectId !== undefined) updateData.externalProjectId = data.externalProjectId;

    await this.db.update(connectors).set(updateData).where(eq(connectors.id, id));

    const updated = await this.getConnector(id);
    if (!updated) throw new NotFoundError('Connector', id);
    return updated;
  }

  async deleteConnector(id: string): Promise<void> {
    const { connectors } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');
    await this.db.delete(connectors).where(eq(connectors.id, id));
  }

  async listStatusMappings(connectorId: string): Promise<ConnectorStatusMapping[]> {
    const { connectorStatusMappings } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');

    return this.db
      .select()
      .from(connectorStatusMappings)
      .where(eq(connectorStatusMappings.connectorId, connectorId));
  }

  async createStatusMapping(data: CreateConnectorStatusMapping): Promise<ConnectorStatusMapping> {
    const { randomUUID } = await import('crypto');
    const now = new Date().toISOString();
    const { connectorStatusMappings } = await import('../../db/schema');

    const id = randomUUID();
    await this.db.insert(connectorStatusMappings).values({
      id,
      connectorId: data.connectorId,
      devchainStatusLabel: data.devchainStatusLabel,
      externalStatusId: data.externalStatusId,
      direction: data.direction,
      createdAt: now,
    });

    const rows = await this.db
      .select()
      .from(connectorStatusMappings)
      .where(eq(connectorStatusMappings.id, id))
      .limit(1);
    return rows[0]!;
  }

  async updateStatusMapping(
    id: string,
    data: UpdateConnectorStatusMapping,
  ): Promise<ConnectorStatusMapping> {
    const { connectorStatusMappings } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');

    const updateData: Record<string, unknown> = {};
    if (data.devchainStatusLabel !== undefined) updateData.devchainStatusLabel = data.devchainStatusLabel;
    if (data.externalStatusId !== undefined) updateData.externalStatusId = data.externalStatusId;
    if (data.direction !== undefined) updateData.direction = data.direction;

    if (Object.keys(updateData).length > 0) {
      await this.db
        .update(connectorStatusMappings)
        .set(updateData)
        .where(eq(connectorStatusMappings.id, id));
    }

    const rows = await this.db
      .select()
      .from(connectorStatusMappings)
      .where(eq(connectorStatusMappings.id, id))
      .limit(1);
    if (rows.length === 0) throw new NotFoundError('StatusMapping', id);
    return rows[0]!;
  }

  async deleteStatusMapping(id: string): Promise<void> {
    const { connectorStatusMappings } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');
    await this.db.delete(connectorStatusMappings).where(eq(connectorStatusMappings.id, id));
  }

  async getSyncState(connectorId: string, epicId: string): Promise<ConnectorSyncState | null> {
    const { connectorSyncState } = await import('../../db/schema');
    const { eq, and } = await import('drizzle-orm');

    const rows = await this.db
      .select()
      .from(connectorSyncState)
      .where(
        and(
          eq(connectorSyncState.connectorId, connectorId),
          eq(connectorSyncState.epicId, epicId),
        ),
      )
      .limit(1);
    return rows.length === 0 ? null : rows[0]!;
  }

  async findSyncStateByExternalId(
    connectorId: string,
    externalId: string,
  ): Promise<ConnectorSyncState | null> {
    const { connectorSyncState } = await import('../../db/schema');
    const { eq, and } = await import('drizzle-orm');

    const rows = await this.db
      .select()
      .from(connectorSyncState)
      .where(
        and(
          eq(connectorSyncState.connectorId, connectorId),
          eq(connectorSyncState.externalId, externalId),
        ),
      )
      .limit(1);
    return rows.length === 0 ? null : rows[0]!;
  }

  async createSyncState(data: CreateConnectorSyncState): Promise<ConnectorSyncState> {
    const { randomUUID } = await import('crypto');
    const now = new Date().toISOString();
    const { connectorSyncState } = await import('../../db/schema');

    const id = randomUUID();
    await this.db.insert(connectorSyncState).values({
      id,
      connectorId: data.connectorId,
      epicId: data.epicId,
      externalId: data.externalId,
      lastSyncedAt: data.lastSyncedAt,
      lastSyncedHash: data.lastSyncedHash ?? null,
      createdAt: now,
      updatedAt: now,
    });

    const result = await this.getSyncState(data.connectorId, data.epicId);
    if (!result) throw new NotFoundError('SyncState', id);
    return result;
  }

  async updateSyncState(id: string, data: UpdateConnectorSyncState): Promise<ConnectorSyncState> {
    const { connectorSyncState } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');
    const now = new Date().toISOString();

    const updateData: Record<string, unknown> = { updatedAt: now };
    if (data.externalId !== undefined) updateData.externalId = data.externalId;
    if (data.lastSyncedAt !== undefined) updateData.lastSyncedAt = data.lastSyncedAt;
    if (data.lastSyncedHash !== undefined) updateData.lastSyncedHash = data.lastSyncedHash;

    await this.db.update(connectorSyncState).set(updateData).where(eq(connectorSyncState.id, id));

    const rows = await this.db
      .select()
      .from(connectorSyncState)
      .where(eq(connectorSyncState.id, id))
      .limit(1);
    if (rows.length === 0) throw new NotFoundError('SyncState', id);
    return rows[0]!;
  }

  async listSyncStates(connectorId: string): Promise<ConnectorSyncState[]> {
    const { connectorSyncState } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');

    return this.db
      .select()
      .from(connectorSyncState)
      .where(eq(connectorSyncState.connectorId, connectorId));
  }

  async listFieldMappings(connectorId: string): Promise<ConnectorFieldMapping[]> {
    const { connectorFieldMappings } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');

    return this.db
      .select()
      .from(connectorFieldMappings)
      .where(eq(connectorFieldMappings.connectorId, connectorId));
  }

  async createFieldMapping(data: CreateConnectorFieldMapping): Promise<ConnectorFieldMapping> {
    const { randomUUID } = await import('crypto');
    const now = new Date().toISOString();
    const { connectorFieldMappings } = await import('../../db/schema');

    const id = randomUUID();
    await this.db.insert(connectorFieldMappings).values({
      id,
      connectorId: data.connectorId,
      devchainField: data.devchainField,
      externalField: data.externalField,
      transform: data.transform ?? null,
      createdAt: now,
    });

    const rows = await this.db
      .select()
      .from(connectorFieldMappings)
      .where(eq(connectorFieldMappings.id, id))
      .limit(1);
    return rows[0]!;
  }

  async deleteFieldMapping(id: string): Promise<void> {
    const { connectorFieldMappings } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');
    await this.db.delete(connectorFieldMappings).where(eq(connectorFieldMappings.id, id));
  }
}
```

- [ ] **Step 2: Wire delegate into LocalStorageService**

In `apps/local-app/src/modules/storage/local/local-storage.service.ts`:

1. Add import: `import { ConnectorStorageDelegate } from './delegates/connector.delegate';`
2. Add domain model imports: `Connector, CreateConnector, UpdateConnector, ConnectorStatusMapping, CreateConnectorStatusMapping, UpdateConnectorStatusMapping, ConnectorSyncState, CreateConnectorSyncState, UpdateConnectorSyncState, ConnectorFieldMapping, CreateConnectorFieldMapping` to the existing import block from `'../models/domain.models'`
3. Add field: `private readonly connectorDelegate: ConnectorStorageDelegate;`
4. In constructor (after `this.scheduledEpicDelegate = ...`): `this.connectorDelegate = new ConnectorStorageDelegate(context);`
5. Add passthrough methods at the end (before closing `}`):

```ts
  // ============================================
  // CONNECTORS
  // ============================================

  async listConnectors(projectId: string): Promise<Connector[]> {
    return this.connectorDelegate.listConnectors(projectId);
  }

  async getConnector(id: string): Promise<Connector | null> {
    return this.connectorDelegate.getConnector(id);
  }

  async createConnector(data: CreateConnector): Promise<Connector> {
    return this.connectorDelegate.createConnector(data);
  }

  async updateConnector(id: string, data: UpdateConnector): Promise<Connector> {
    return this.connectorDelegate.updateConnector(id, data);
  }

  async deleteConnector(id: string): Promise<void> {
    return this.connectorDelegate.deleteConnector(id);
  }

  async listStatusMappings(connectorId: string): Promise<ConnectorStatusMapping[]> {
    return this.connectorDelegate.listStatusMappings(connectorId);
  }

  async createStatusMapping(data: CreateConnectorStatusMapping): Promise<ConnectorStatusMapping> {
    return this.connectorDelegate.createStatusMapping(data);
  }

  async updateStatusMapping(id: string, data: UpdateConnectorStatusMapping): Promise<ConnectorStatusMapping> {
    return this.connectorDelegate.updateStatusMapping(id, data);
  }

  async deleteStatusMapping(id: string): Promise<void> {
    return this.connectorDelegate.deleteStatusMapping(id);
  }

  async getSyncState(connectorId: string, epicId: string): Promise<ConnectorSyncState | null> {
    return this.connectorDelegate.getSyncState(connectorId, epicId);
  }

  async findSyncStateByExternalId(connectorId: string, externalId: string): Promise<ConnectorSyncState | null> {
    return this.connectorDelegate.findSyncStateByExternalId(connectorId, externalId);
  }

  async createSyncState(data: CreateConnectorSyncState): Promise<ConnectorSyncState> {
    return this.connectorDelegate.createSyncState(data);
  }

  async updateSyncState(id: string, data: UpdateConnectorSyncState): Promise<ConnectorSyncState> {
    return this.connectorDelegate.updateSyncState(id, data);
  }

  async listSyncStates(connectorId: string): Promise<ConnectorSyncState[]> {
    return this.connectorDelegate.listSyncStates(connectorId);
  }

  async listFieldMappings(connectorId: string): Promise<ConnectorFieldMapping[]> {
    return this.connectorDelegate.listFieldMappings(connectorId);
  }

  async createFieldMapping(data: CreateConnectorFieldMapping): Promise<ConnectorFieldMapping> {
    return this.connectorDelegate.createFieldMapping(data);
  }

  async deleteFieldMapping(id: string): Promise<void> {
    return this.connectorDelegate.deleteFieldMapping(id);
  }
```

- [ ] **Step 3: Write basic delegate spec**

Create `apps/local-app/src/modules/storage/local/delegates/connector.delegate.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { ConnectorStorageDelegate } from './connector.delegate';
import { createStorageDelegateContext } from './base-storage.delegate';
import { randomUUID } from 'crypto';

function createTestDb() {
  const raw = new Database(':memory:');
  const db = drizzle(raw);
  migrate(db, { migrationsFolder: '../../drizzle' });
  return { db, raw };
}

function seedProject(db: any) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [id, 'test', '/tmp/test', now, now],
  );
  return id;
}

describe('ConnectorStorageDelegate', () => {
  let delegate: ConnectorStorageDelegate;
  let raw: Database.Database;
  let projectId: string;

  beforeAll(() => {
    const { db, raw: r } = createTestDb();
    raw = r;
    projectId = seedProject(db);
    delegate = new ConnectorStorageDelegate(createStorageDelegateContext(db));
  });

  afterAll(() => raw.close());

  it('should create and get a connector', async () => {
    const created = await delegate.createConnector({
      projectId,
      type: 'taskim',
      name: 'My Taskim',
      enabled: false,
      config: { apiUrl: 'http://localhost:3000', credentials: {} },
      externalProjectId: null,
    });

    expect(created.id).toBeDefined();
    expect(created.type).toBe('taskim');
    expect(created.config.apiUrl).toBe('http://localhost:3000');

    const fetched = await delegate.getConnector(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe('My Taskim');
  });

  it('should list connectors by project', async () => {
    const list = await delegate.listConnectors(projectId);
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it('should update a connector', async () => {
    const created = await delegate.createConnector({
      projectId,
      type: 'taskim',
      name: 'Test Update',
      enabled: false,
      config: { apiUrl: 'http://localhost:3000', credentials: {} },
      externalProjectId: null,
    });

    const updated = await delegate.updateConnector(created.id, { enabled: true, name: 'Updated' });
    expect(updated.enabled).toBe(true);
    expect(updated.name).toBe('Updated');
  });

  it('should delete a connector', async () => {
    const created = await delegate.createConnector({
      projectId,
      type: 'taskim',
      name: 'Delete Me',
      enabled: false,
      config: { apiUrl: 'http://localhost:3000', credentials: {} },
      externalProjectId: null,
    });

    await delegate.deleteConnector(created.id);
    const fetched = await delegate.getConnector(created.id);
    expect(fetched).toBeNull();
  });

  it('should create and query sync state', async () => {
    const connector = await delegate.createConnector({
      projectId,
      type: 'taskim',
      name: 'Sync Test',
      enabled: false,
      config: { apiUrl: 'http://localhost:3000', credentials: {} },
      externalProjectId: null,
    });

    const now = new Date().toISOString();
    const epicId = randomUUID();
    // Seed an epic for FK
    const statusId = randomUUID();
    raw.prepare(
      `INSERT INTO statuses (id, project_id, label, "order", color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(statusId, projectId, 'New', 0, '#ccc', now, now);
    raw.prepare(
      `INSERT INTO epics (id, project_id, title, status_id, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(epicId, projectId, 'Test Epic', statusId, now, now, 1);

    const syncState = await delegate.createSyncState({
      connectorId: connector.id,
      epicId,
      externalId: 'ext-123',
      lastSyncedAt: now,
      lastSyncedHash: 'abc123',
    });

    expect(syncState.externalId).toBe('ext-123');

    const found = await delegate.getSyncState(connector.id, epicId);
    expect(found).not.toBeNull();
    expect(found!.lastSyncedHash).toBe('abc123');

    const foundByExt = await delegate.findSyncStateByExternalId(connector.id, 'ext-123');
    expect(foundByExt).not.toBeNull();
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run apps/local-app/src/modules/storage/local/delegates/connector.delegate.spec.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/local-app/src/modules/storage/local/delegates/connector.delegate.ts apps/local-app/src/modules/storage/local/delegates/connector.delegate.spec.ts apps/local-app/src/modules/storage/local/local-storage.service.ts
git commit -m "feat(connectors): add storage delegate and wire into LocalStorageService"
```

---

## Task 4: ConnectorAdapter Interface + DTOs

**Files:**
- Create: `apps/local-app/src/modules/connectors/adapters/connector-adapter.interface.ts`
- Create: `apps/local-app/src/modules/connectors/dtos/connector.dto.ts`

- [ ] **Step 1: Define the adapter interface**

Create `apps/local-app/src/modules/connectors/adapters/connector-adapter.interface.ts`:

```ts
import type { Connector, ConnectorStatusMapping } from '../../storage/models/domain.models';
import type { Epic } from '../../storage/models/domain.models';

export interface NormalizedExternalTask {
  externalId: string;
  title: string;
  description: string | null;
  statusId: string | null;
  tags: string[];
  parentId: string | null;
  assigneeName: string | null;
  updatedAt: string;
}

export interface NormalizedExternalComment {
  externalId: string;
  taskExternalId: string;
  content: string;
  authorName: string;
  createdAt: string;
}

export interface InboundEvent {
  action: 'created' | 'updated' | 'deleted' | 'comment_created';
  externalId: string;
  fields?: Partial<NormalizedExternalTask>;
  comment?: NormalizedExternalComment;
  timestamp: string;
}

export interface PushEpicInput {
  epic: Epic;
  statusMappings: ConnectorStatusMapping[];
  syncState: { externalId: string | null; lastSyncedAt: string | null };
}

export interface PushEpicResult {
  externalId: string;
  success: boolean;
  error?: string;
}

export interface PushCommentInput {
  epicExternalId: string;
  commentId: string;
  content: string;
  authorName: string;
}

export interface ConnectorAdapter {
  readonly type: string;

  testConnection(config: Connector['config']): Promise<{ success: boolean; error?: string }>;

  listRemoteProjects(config: Connector['config']): Promise<{ id: string; name: string }[]>;

  pushEpic(input: PushEpicInput, config: Connector['config']): Promise<PushEpicResult>;

  pullEpic(externalId: string, config: Connector['config']): Promise<NormalizedExternalTask | null>;

  pushComment(input: PushCommentInput, config: Connector['config']): Promise<void>;

  resolveWebhook(
    payload: unknown,
    config: Connector['config'],
  ): Promise<InboundEvent | null>;
}
```

- [ ] **Step 2: Create Zod DTOs**

Create `apps/local-app/src/modules/connectors/dtos/connector.dto.ts`:

```ts
import { z } from 'zod';

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
  })
  .strict();

export type CreateConnectorDto = z.infer<typeof CreateConnectorDtoSchema>;

export const UpdateConnectorDtoSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    enabled: z.boolean().optional(),
    config: z
      .object({
        apiUrl: z.string().url(),
        credentials: z.record(z.string()).default({}),
        workspaceId: z.string().optional(),
      })
      .passthrough()
      .optional(),
    externalProjectId: z.string().nullable().optional(),
  })
  .strict();

export type UpdateConnectorDto = z.infer<typeof UpdateConnectorDtoSchema>;

export const CreateStatusMappingDtoSchema = z
  .object({
    connectorId: z.string().uuid(),
    devchainStatusLabel: z.string().min(1),
    externalStatusId: z.string().min(1),
    direction: z.enum(['both', 'push', 'pull']).optional().default('both'),
  })
  .strict();

export type CreateStatusMappingDto = z.infer<typeof CreateStatusMappingDtoSchema>;

export const UpdateStatusMappingDtoSchema = z
  .object({
    devchainStatusLabel: z.string().min(1).optional(),
    externalStatusId: z.string().min(1).optional(),
    direction: z.enum(['both', 'push', 'pull']).optional(),
  })
  .strict();

export type UpdateStatusMappingDto = z.infer<typeof UpdateStatusMappingDtoSchema>;
```

- [ ] **Step 3: Commit**

```bash
git add apps/local-app/src/modules/connectors/adapters/connector-adapter.interface.ts apps/local-app/src/modules/connectors/dtos/connector.dto.ts
git commit -m "feat(connectors): add adapter interface and Zod DTOs"
```

---

## Task 5: ConnectorsService (CRUD + Sync Dispatch)

**Files:**
- Create: `apps/local-app/src/modules/connectors/services/connectors.service.ts`
- Create: `apps/local-app/src/modules/connectors/services/connectors.service.spec.ts`

- [ ] **Step 1: Write the service**

Create `apps/local-app/src/modules/connectors/services/connectors.service.ts`:

```ts
import { Injectable, Inject } from '@nestjs/common';
import {
  STORAGE_SERVICE,
  type StorageService,
} from '../../storage/interfaces/storage.interface';
import type {
  Connector,
  CreateConnector,
  UpdateConnector,
  ConnectorStatusMapping,
  ConnectorSyncState,
} from '../../storage/models/domain.models';
import type { CreateConnectorDto, UpdateConnectorDto } from '../dtos/connector.dto';
import { NotFoundError } from '../../../common/errors/error-types';
import { createLogger } from '../../../common/logging/logger';

const logger = createLogger('ConnectorsService');

@Injectable()
export class ConnectorsService {
  // In-memory set of epicIds currently being synced from remote (loop prevention)
  private readonly syncingFromRemote = new Set<string>();

  constructor(@Inject(STORAGE_SERVICE) private readonly storage: StorageService) {}

  // ── CRUD ──────────────────────────────────────

  async list(projectId: string): Promise<Connector[]> {
    return this.storage.listConnectors(projectId);
  }

  async get(id: string): Promise<Connector> {
    const connector = await this.storage.getConnector(id);
    if (!connector) throw new NotFoundError('Connector', id);
    return connector;
  }

  async create(dto: CreateConnectorDto): Promise<Connector> {
    return this.storage.createConnector({
      projectId: dto.projectId,
      type: dto.type,
      name: dto.name,
      enabled: dto.enabled,
      config: dto.config,
      externalProjectId: dto.externalProjectId ?? null,
    });
  }

  async update(id: string, dto: UpdateConnectorDto): Promise<Connector> {
    return this.storage.updateConnector(id, dto);
  }

  async delete(id: string): Promise<void> {
    return this.storage.deleteConnector(id);
  }

  // ── Status Mappings ───────────────────────────

  async listStatusMappings(connectorId: string): Promise<ConnectorStatusMapping[]> {
    return this.storage.listStatusMappings(connectorId);
  }

  async createStatusMapping(
    connectorId: string,
    devchainStatusLabel: string,
    externalStatusId: string,
    direction: 'both' | 'push' | 'pull' = 'both',
  ): Promise<ConnectorStatusMapping> {
    return this.storage.createStatusMapping({
      connectorId,
      devchainStatusLabel,
      externalStatusId,
      direction,
    });
  }

  async deleteStatusMapping(id: string): Promise<void> {
    return this.storage.deleteStatusMapping(id);
  }

  // ── Sync State Helpers ────────────────────────

  async getSyncState(connectorId: string, epicId: string): Promise<ConnectorSyncState | null> {
    return this.storage.getSyncState(connectorId, epicId);
  }

  async listSyncStates(connectorId: string): Promise<ConnectorSyncState[]> {
    return this.storage.listSyncStates(connectorId);
  }

  // ── Loop Prevention ───────────────────────────

  markSyncingFromRemote(epicId: string): void {
    this.syncingFromRemote.add(epicId);
  }

  isSyncingFromRemote(epicId: string): boolean {
    const val = this.syncingFromRemote.has(epicId);
    if (val) this.syncingFromRemote.delete(epicId);
    return val;
  }

  // ── Enabled Connectors ────────────────────────

  async listEnabledForProject(projectId: string): Promise<Connector[]> {
    const all = await this.storage.listConnectors(projectId);
    return all.filter((c) => c.enabled);
  }
}
```

- [ ] **Step 2: Write service spec**

Create `apps/local-app/src/modules/connectors/services/connectors.service.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { ConnectorsService } from './connectors.service';

function createMockStorage() {
  return {
    listConnectors: vi.fn().mockResolvedValue([
      { id: 'c1', projectId: 'p1', type: 'taskim', enabled: true, config: {}, name: 'T', externalProjectId: null, createdAt: '', updatedAt: '' },
      { id: 'c2', projectId: 'p1', type: 'monday', enabled: false, config: {}, name: 'M', externalProjectId: null, createdAt: '', updatedAt: '' },
    ]),
    getConnector: vi.fn(),
    createConnector: vi.fn(),
    updateConnector: vi.fn(),
    deleteConnector: vi.fn(),
    listStatusMappings: vi.fn().mockResolvedValue([]),
    createStatusMapping: vi.fn(),
    deleteStatusMapping: vi.fn(),
    getSyncState: vi.fn(),
    findSyncStateByExternalId: vi.fn(),
    createSyncState: vi.fn(),
    updateSyncState: vi.fn(),
    listSyncStates: vi.fn().mockResolvedValue([]),
    listFieldMappings: vi.fn(),
    createFieldMapping: vi.fn(),
    deleteFieldMapping: vi.fn(),
  };
}

describe('ConnectorsService', () => {
  it('should list enabled connectors', async () => {
    const storage = createMockStorage();
    const svc = new ConnectorsService(storage as any);
    const result = await svc.listEnabledForProject('p1');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('taskim');
  });

  it('should create a connector', async () => {
    const storage = createMockStorage();
    storage.createConnector = vi.fn().mockResolvedValue({ id: 'new-id', type: 'taskim' });
    const svc = new ConnectorsService(storage as any);
    const result = await svc.create({
      projectId: 'p1',
      type: 'taskim',
      name: 'Test',
      enabled: false,
      config: { apiUrl: 'http://localhost:3000', credentials: {} },
    } as any);
    expect(result.id).toBe('new-id');
  });

  it('should mark and check syncingFromRemote flag', () => {
    const svc = new ConnectorsService(createMockStorage() as any);
    svc.markSyncingFromRemote('epic-1');
    expect(svc.isSyncingFromRemote('epic-1')).toBe(true);
    expect(svc.isSyncingFromRemote('epic-1')).toBe(false); // consumed
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run apps/local-app/src/modules/connectors/services/connectors.service.spec.ts`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add apps/local-app/src/modules/connectors/services/connectors.service.ts apps/local-app/src/modules/connectors/services/connectors.service.spec.ts
git commit -m "feat(connectors): add ConnectorsService with CRUD and sync state helpers"
```

---

## Task 6: ConnectorsController + Module + App Registration

**Files:**
- Create: `apps/local-app/src/modules/connectors/controllers/connectors.controller.ts`
- Create: `apps/local-app/src/modules/connectors/connectors.module.ts`
- Modify: `apps/local-app/src/app.normal.module.ts`

- [ ] **Step 1: Write the controller**

Create `apps/local-app/src/modules/connectors/controllers/connectors.controller.ts`:

```ts
import { Controller, Get, Post, Put, Delete, Body, Param, Query, BadRequestException } from '@nestjs/common';
import { ConnectorsService } from '../services/connectors.service';
import {
  CreateConnectorDtoSchema,
  UpdateConnectorDtoSchema,
  CreateStatusMappingDtoSchema,
} from '../dtos/connector.dto';

@Controller('api/connectors')
export class ConnectorsController {
  constructor(private readonly service: ConnectorsService) {}

  @Get()
  async list(@Query('projectId') projectId?: string) {
    if (!projectId) throw new BadRequestException('projectId is required');
    return this.service.list(projectId);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post()
  async create(@Body() body: unknown) {
    const parsed = CreateConnectorDtoSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ message: 'Validation failed', errors: parsed.error.errors });
    }
    return this.service.create(parsed.data);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const parsed = UpdateConnectorDtoSchema.safeParse(body);
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

  @Get(':id/status-mappings')
  async listStatusMappings(@Param('id') connectorId: string) {
    return this.service.listStatusMappings(connectorId);
  }

  @Post(':id/status-mappings')
  async createStatusMapping(@Param('id') connectorId: string, @Body() body: unknown) {
    const parsed = CreateStatusMappingDtoSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ message: 'Validation failed', errors: parsed.error.errors });
    }
    return this.service.createStatusMapping(
      connectorId,
      parsed.data.devchainStatusLabel,
      parsed.data.externalStatusId,
      parsed.data.direction,
    );
  }

  @Delete(':id/status-mappings/:mappingId')
  async deleteStatusMapping(@Param('mappingId') mappingId: string) {
    await this.service.deleteStatusMapping(mappingId);
    return { success: true };
  }

  @Get(':id/sync-states')
  async listSyncStates(@Param('id') connectorId: string) {
    return this.service.listSyncStates(connectorId);
  }
}
```

- [ ] **Step 2: Write the module**

Create `apps/local-app/src/modules/connectors/connectors.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { EventsCoreModule } from '../events/events-core.module';
import { ConnectorsController } from './controllers/connectors.controller';
import { ConnectorsService } from './services/connectors.service';

@Module({
  imports: [StorageModule, EventsCoreModule],
  controllers: [ConnectorsController],
  providers: [ConnectorsService],
  exports: [ConnectorsService],
})
export class ConnectorsModule {}
```

- [ ] **Step 3: Register in app module**

In `apps/local-app/src/app.normal.module.ts`:
1. Add import: `import { ConnectorsModule } from './modules/connectors/connectors.module';`
2. Add `ConnectorsModule,` to the `imports` array (after `ScheduledEpicsModule`)

- [ ] **Step 4: Build and verify the app starts**

Run: `node_modules/.bin/nest build` from `apps/local-app/`, then `node dist/main.js`
Expected: App starts, no errors about missing module/controller

- [ ] **Step 5: Commit**

```bash
git add apps/local-app/src/modules/connectors/controllers/connectors.controller.ts apps/local-app/src/modules/connectors/connectors.module.ts apps/local-app/src/app.normal.module.ts
git commit -m "feat(connectors): add controller, module, and app registration"
```

---

## Task 7: Taskim Adapter — Auth + Base Operations

**Files:**
- Create: `apps/local-app/src/modules/connectors/adapters/taskim.adapter.ts`
- Create: `apps/local-app/src/modules/connectors/adapters/taskim.adapter.spec.ts`

- [ ] **Step 1: Write the Taskim adapter**

Create `apps/local-app/src/modules/connectors/adapters/taskim.adapter.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { createLogger } from '../../../common/logging/logger';
import type { ConnectorAdapter, InboundEvent, NormalizedExternalTask, PushEpicInput, PushEpicResult, PushCommentInput } from './connector-adapter.interface';
import type { Connector } from '../../storage/models/domain.models';

const logger = createLogger('TaskimAdapter');

interface TaskimConfig extends Connector['config'] {
  apiUrl: string;
  credentials: { email?: string; password?: string; token?: string };
  workspaceId?: string;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

@Injectable()
export class TaskimAdapter implements ConnectorAdapter {
  readonly type = 'taskim';
  private tokenCache = new Map<string, TokenCache>();

  private getConfig(config: Connector['config']): TaskimConfig {
    return config as TaskimConfig;
  }

  private async authenticate(config: TaskimConfig): Promise<string> {
    const cacheKey = config.apiUrl;
    const cached = this.tokenCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.token;
    }

    if (config.credentials.token) {
      this.tokenCache.set(cacheKey, {
        token: config.credentials.token,
        expiresAt: Date.now() + 3600_000,
      });
      return config.credentials.token;
    }

    const response = await fetch(`${config.apiUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: config.credentials.email,
        password: config.credentials.password,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Taskim auth failed: ${error}`);
    }

    const data = await response.json() as { accessToken: string };
    this.tokenCache.set(cacheKey, {
      token: data.accessToken,
      expiresAt: Date.now() + 3600_000,
    });
    return data.accessToken;
  }

  async testConnection(config: Connector['config']): Promise<{ success: boolean; error?: string }> {
    try {
      const cfg = this.getConfig(config);
      const token = await this.authenticate(cfg);
      const url = cfg.workspaceId
        ? `${cfg.apiUrl}/api/v1/workspaces/${cfg.workspaceId}/projects`
        : `${cfg.apiUrl}/api/v1/workspaces`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return { success: response.ok, error: response.ok ? undefined : `HTTP ${response.status}` };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  }

  async listRemoteProjects(config: Connector['config']): Promise<{ id: string; name: string }[]> {
    const cfg = this.getConfig(config);
    const token = await this.authenticate(cfg);
    if (!cfg.workspaceId) return [];

    const response = await fetch(
      `${cfg.apiUrl}/api/v1/workspaces/${cfg.workspaceId}/projects`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) return [];

    const data = await response.json();
    const projects = Array.isArray(data) ? data : (data as any).data ?? [];
    return projects.map((p: any) => ({ id: p.id, name: p.name }));
  }

  async pushEpic(input: PushEpicInput, config: Connector['config']): Promise<PushEpicResult> {
    const cfg = this.getConfig(config);
    try {
      const token = await this.authenticate(cfg);
      const statusMapping = input.statusMappings.find(
        (m) => m.devchainStatusLabel === input.epic.statusName,
      );
      const externalStatus = statusMapping?.externalStatusId ?? undefined;

      const taskBody: Record<string, unknown> = {
        title: input.epic.title,
        description: input.epic.description ?? '',
      };
      if (externalStatus) taskBody.status = externalStatus;
      if (input.epic.parentId) taskBody.parentId = input.epic.parentId;

      if (!input.syncState.externalId) {
        // Create new task
        const response = await fetch(
          `${cfg.apiUrl}/api/v1/workspaces/${cfg.workspaceId}/projects/${cfg.externalProjectId}/tasks`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(taskBody),
          },
        );
        if (!response.ok) {
          const error = await response.text();
          return { externalId: '', success: false, error };
        }
        const created = await response.json() as { id: string };
        return { externalId: created.id, success: true };
      } else {
        // Update existing task
        const response = await fetch(
          `${cfg.apiUrl}/api/v1/workspaces/${cfg.workspaceId}/projects/${cfg.externalProjectId}/tasks/${input.syncState.externalId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(taskBody),
          },
        );
        if (!response.ok) {
          const error = await response.text();
          return { externalId: input.syncState.externalId, success: false, error };
        }
        return { externalId: input.syncState.externalId, success: true };
      }
    } catch (e) {
      logger.error({ error: e }, 'Taskim pushEpic failed');
      return { externalId: input.syncState.externalId ?? '', success: false, error: e instanceof Error ? e.message : 'Unknown' };
    }
  }

  async pullEpic(externalId: string, config: Connector['config']): Promise<NormalizedExternalTask | null> {
    const cfg = this.getConfig(config);
    try {
      const token = await this.authenticate(cfg);
      const response = await fetch(
        `${cfg.apiUrl}/api/v1/workspaces/${cfg.workspaceId}/projects/${cfg.externalProjectId}/tasks/${externalId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok) return null;
      const task = await response.json() as any;
      return {
        externalId: task.id,
        title: task.title,
        description: task.description ?? null,
        statusId: task.status ?? null,
        tags: task.labels ?? [],
        parentId: task.parentId ?? null,
        assigneeName: null,
        updatedAt: task.updatedAt ?? new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  async pushComment(input: PushCommentInput, config: Connector['config']): Promise<void> {
    const cfg = this.getConfig(config);
    const token = await this.authenticate(cfg);
    await fetch(
      `${cfg.apiUrl}/api/v1/workspaces/${cfg.workspaceId}/projects/${cfg.externalProjectId}/tasks/${input.epicExternalId}/comments`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          content: `[${input.authorName} via DevChain] ${input.content}`,
        }),
      },
    );
  }

  async resolveWebhook(payload: unknown, config: Connector['config']): Promise<InboundEvent | null> {
    const data = payload as Record<string, unknown>;
    if (!data || typeof data !== 'object') return null;

    const type = data.type as string | undefined;
    const task = (data.task ?? data.payload ?? data) as Record<string, unknown>;

    const actionMap: Record<string, InboundEvent['action']> = {
      'task.created': 'created',
      'task.updated': 'updated',
      'task.deleted': 'deleted',
      'comment.created': 'comment_created',
    };

    const action = actionMap[type ?? ''] ?? 'updated';
    const externalId = (task.id ?? data.id ?? '') as string;
    if (!externalId) return null;

    return {
      action,
      externalId: String(externalId),
      fields: action === 'deleted' ? undefined : {
        externalId: String(externalId),
        title: (task.title as string) ?? '',
        description: (task.description as string) ?? null,
        statusId: (task.status as string) ?? null,
        tags: (task.labels as string[]) ?? [],
        parentId: (task.parentId as string) ?? null,
        assigneeName: null,
        updatedAt: (task.updatedAt as string) ?? new Date().toISOString(),
      },
      timestamp: (data.timestamp as string) ?? new Date().toISOString(),
    };
  }
}
```

- [ ] **Step 2: Write adapter spec (mocked HTTP)**

Create `apps/local-app/src/modules/connectors/adapters/taskim.adapter.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskimAdapter } from './taskim.adapter';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('TaskimAdapter', () => {
  let adapter: TaskimAdapter;

  beforeEach(() => {
    adapter = new TaskimAdapter();
    mockFetch.mockReset();
  });

  const config = {
    apiUrl: 'http://localhost:3000',
    credentials: { email: 'test@example.com', password: 'pass' },
    workspaceId: 'ws-1',
    externalProjectId: 'proj-1',
  };

  it('should authenticate and cache token', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse({ accessToken: 'jwt-token' }))
      .mockResolvedValueOnce(mockResponse([]));

    const result = await adapter.testConnection(config);
    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Second call should use cached token (no new auth call)
    mockFetch.mockClear();
    mockFetch.mockResolvedValueOnce(mockResponse([]));
    await adapter.testConnection(config);
    expect(mockFetch).toHaveBeenCalledTimes(1); // no re-auth
  });

  it('should test connection and return failure on bad auth', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ message: 'Unauthorized' }, false, 401));
    const result = await adapter.testConnection(config);
    expect(result.success).toBe(false);
  });

  it('should resolve webhook payload for task.updated', async () => {
    const payload = {
      type: 'task.updated',
      task: { id: 'ext-1', title: 'Updated Task', status: 'in_progress' },
      timestamp: '2026-06-16T12:00:00Z',
    };
    const result = await adapter.resolveWebhook(payload, config);
    expect(result).not.toBeNull();
    expect(result!.action).toBe('updated');
    expect(result!.externalId).toBe('ext-1');
    expect(result!.fields!.title).toBe('Updated Task');
  });

  it('should return null for unresolvable webhook payload', async () => {
    const result = await adapter.resolveWebhook(null, config);
    expect(result).toBeNull();
  });

  it('should push a new epic (create task)', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse({ accessToken: 'jwt' })) // auth
      .mockResolvedValueOnce(mockResponse({ id: 'task-999' })); // create

    const result = await adapter.pushEpic(
      {
        epic: { id: 'epic-1', title: 'Test', description: 'desc', statusName: 'New' } as any,
        statusMappings: [{ devchainStatusLabel: 'New', externalStatusId: 'todo' } as any],
        syncState: { externalId: null, lastSyncedAt: null },
      },
      config,
    );

    expect(result.success).toBe(true);
    expect(result.externalId).toBe('task-999');
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run apps/local-app/src/modules/connectors/adapters/taskim.adapter.spec.ts`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add apps/local-app/src/modules/connectors/adapters/taskim.adapter.ts apps/local-app/src/modules/connectors/adapters/taskim.adapter.spec.ts
git commit -m "feat(connectors): add Taskim adapter with auth, push/pull, webhook parsing"
```

---

## Task 8: Outbound Sync — Event Listener

**Files:**
- Create: `apps/local-app/src/modules/connectors/services/connector-event-listener.service.ts`
- Modify: `apps/local-app/src/modules/connectors/connectors.module.ts` (add provider + import EpicsModule)

- [ ] **Step 1: Write the event listener**

Create `apps/local-app/src/modules/connectors/services/connector-event-listener.service.ts`:

```ts
import { Injectable, Inject } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { STORAGE_SERVICE } from '../../storage/interfaces/storage.service-token';
import type { StorageService } from '../../storage/interfaces/storage.interface';
import { ConnectorsService } from './connectors.service';
import { TaskimAdapter } from '../adapters/taskim.adapter';
import { createLogger } from '../../../common/logging/logger';

const logger = createLogger('ConnectorEventListener');

@Injectable()
export class ConnectorEventListener {
      this.connectorsService.markSyncingFromRemote,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  private getAdapter(type: string): TaskimAdapter | null {
    if (type === 'taskim') return this.taskimAdapter;
    // monday, jira — future adapters
    return null;
  }

  @OnEvent('epic.created', { async: true })
  async handleEpicCreated(payload: { epicId: string; projectId: string }): Promise<void> {
    await this.syncOutbound(payload.epicId, payload.projectId);
  }

  @OnEvent('epic.updated', { async: true })
  async handleEpicUpdated(payload: { epicId: string; projectId: string }): Promise<void> {
    // Loop prevention: skip if this change came from a remote sync
    if (this.connectorsService.isSyncingFromRemote(payload.epicId)) {
      logger.debug({ epicId: payload.epicId }, 'Skipping outbound sync — change came from remote');
      return;
    }
    await this.syncOutbound(payload.epicId, payload.projectId);
  }

  private async syncOutbound(epicId: string, projectId: string): Promise<void> {
    try {
      const connectors = await this.connectorsService.listEnabledForProject(projectId);
      if (connectors.length === 0) return;

      const epic = await this.storage.getEpic(epicId);
      if (!epic) return;

      for (const connector of connectors) {
        const adapter = this.getAdapter(connector.type);
        if (!adapter) continue;

        const statusMappings = await this.storage.listStatusMappings(connector.id);
        const syncState = await this.storage.getSyncState(connector.id, epicId);
        const now = new Date().toISOString();

        const result = await adapter.pushEpic(
          {
            epic: epic as any,
            statusMappings,
            syncState: {
              externalId: syncState?.externalId ?? null,
              lastSyncedAt: syncState?.lastSyncedAt ?? null,
            },
          },
          connector.config,
        );

        if (result.success) {
          if (syncState) {
            await this.storage.updateSyncState(syncState.id, {
              externalId: result.externalId,
              lastSyncedAt: now,
            });
          } else {
            await this.storage.createSyncState({
              connectorId: connector.id,
              epicId,
              externalId: result.externalId,
              lastSyncedAt: now,
              lastSyncedHash: null,
            });
          }
          logger.info({ epicId, connectorId: connector.id, externalId: result.externalId }, 'Synced epic to external');
        } else {
          logger.warn({ epicId, connectorId: connector.id, error: result.error }, 'Failed to sync epic');
        }
      }
    } catch (e) {
      logger.error({ epicId, error: e }, 'Outbound sync error');
    }
  }
}
```

- [ ] **Step 2: Update module to include the listener + adapter**

Modify `apps/local-app/src/modules/connectors/connectors.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { EventsCoreModule } from '../events/events-core.module';
import { EpicsModule } from '../epics/epics.module';
import { ConnectorsController } from './controllers/connectors.controller';
import { ConnectorsService } from './services/connectors.service';
import { ConnectorEventListener } from './services/connector-event-listener.service';
import { TaskimAdapter } from './adapters/taskim.adapter';

@Module({
  imports: [StorageModule, EventsCoreModule, EpicsModule],
  controllers: [ConnectorsController],
  providers: [ConnectorsService, ConnectorEventListener, TaskimAdapter],
  exports: [ConnectorsService],
})
export class ConnectorsModule {}
```

- [ ] **Step 3: Build and verify**

Run: `node_modules/.bin/nest build` from `apps/local-app/`
Expected: Compiles (may have pre-existing errors, but new files should be clean)

- [ ] **Step 4: Commit**

```bash
git add apps/local-app/src/modules/connectors/services/connector-event-listener.service.ts apps/local-app/src/modules/connectors/connectors.module.ts
git commit -m "feat(connectors): add outbound sync event listener for epic.created/updated"
```

---

## Task 9: Inbound Sync — Webhook Controller

**Files:**
- Create: `apps/local-app/src/modules/connectors/controllers/webhook.controller.ts`
- Modify: `apps/local-app/src/modules/connectors/connectors.module.ts` (add controller)

- [ ] **Step 1: Write the webhook controller**

Create `apps/local-app/src/modules/connectors/controllers/webhook.controller.ts`:

```ts
import { Controller, Post, Param, Body, HttpCode, NotFoundException } from '@nestjs/common';
import { ConnectorsService } from '../services/connectors.service';
import { TaskimAdapter } from '../adapters/taskim.adapter';
import { Inject } from '@nestjs/common';
import {
  STORAGE_SERVICE,
  type StorageService,
} from '../../storage/interfaces/storage.interface';
import { EpicsService } from '../../epics/services/epics.service';
import { createLogger } from '../../../common/logging/logger';

const logger = createLogger('WebhookController');

@Controller('api/connectors/webhook')
export class WebhookController {
  constructor(
    private readonly connectorsService: ConnectorsService,
    private readonly taskimAdapter: TaskimAdapter,
    private readonly epicsService: EpicsService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  @Post(':connectorId/:projectId')
  @HttpCode(200)
  async handleWebhook(
    @Param('connectorId') connectorId: string,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ): Promise<{ received: boolean }> {
    const connector = await this.storage.getConnector(connectorId);
    if (!connector || !connector.enabled) {
      throw new NotFoundException('Connector not found or disabled');
    }

    const adapter = connector.type === 'taskim' ? this.taskimAdapter : null;
    if (!adapter) {
      return { received: true }; // silently accept for unimplemented types
    }

    const event = await adapter.resolveWebhook(body, connector.config);
    if (!event) {
      logger.debug({ connectorId }, 'Webhook payload could not be resolved');
      return { received: true };
    }

    await this.handleInboundEvent(connectorId, projectId, event);
    return { received: true };
  }

  private async handleInboundEvent(
    connectorId: string,
    projectId: string,
    event: { action: string; externalId: string; fields?: any; timestamp: string },
  ): Promise<void> {
    const syncState = await this.storage.findSyncStateByExternalId(connectorId, event.externalId);
    const now = new Date().toISOString();

    if (event.action === 'deleted') {
      if (syncState) {
        // Just log — don't delete the epic, the sync state becomes stale but that's safe
        logger.info({ connectorId, externalId: event.externalId }, 'External task deleted, clearing sync state');
      }
      return;
    }

    if (event.action === 'comment_created' && syncState) {
      // Push comment to epic
      // For now, add as epic comment
      const commentContent = event.fields?.title ?? 'External comment received';
      try {
        await this.epicsService.addComment(syncState.epicId, commentContent, undefined);
        this.connectorsService.markSyncingFromRemote(syncState.epicId);
      } catch (e) {
        logger.error({ error: e }, 'Failed to add comment from webhook');
      }
      return;
    }

    if (syncState) {
      // Update existing epic — check last-write-wins
      const remoteTime = new Date(event.timestamp).getTime();
      const syncedTime = new Date(syncState.lastSyncedAt).getTime();

      if (remoteTime > syncedTime) {
        // Remote wins
        this.connectorsService.markSyncingFromRemote(syncState.epicId);
        try {
          if (event.fields?.title) {
            await this.epicsService.updateEpic(syncState.epicId, {
              title: event.fields.title,
              description: event.fields.description ?? undefined,
            }, { actor: { type: 'connector', id: connectorId } });
          }
          await this.storage.updateSyncState(syncState.id, { lastSyncedAt: now });
          logger.info({ epicId: syncState.epicId }, 'Updated epic from webhook');
        } catch (e) {
          logger.error({ error: e }, 'Failed to update epic from webhook');
        }
      } else {
        logger.debug({ epicId: syncState.epicId }, 'DevChain version is newer, skipping remote update');
      }
    } else {
      // Create new epic from external task
      if (event.fields?.title) {
        try {
          const epic = await this.epicsService.createEpicForProject(projectId, {
            title: event.fields.title,
            description: event.fields.description ?? undefined,
          }, { actor: { type: 'connector', id: connectorId } });

          this.connectorsService.markSyncingFromRemote(epic.id);
          await this.storage.createSyncState({
            connectorId,
            epicId: epic.id,
            externalId: event.externalId,
            lastSyncedAt: now,
            lastSyncedHash: null,
          });
          logger.info({ epicId: epic.id, externalId: event.externalId }, 'Created epic from webhook');
        } catch (e) {
          logger.error({ error: e }, 'Failed to create epic from webhook');
        }
      }
    }
  }
}
```

**Note:** The webhook controller imports `EpicsService` and calls `this.epicsService.addComment()` and `this.epicsService.updateEpic()`. Verify the exact method signatures in `epics.service.ts` before implementing — they may differ slightly (e.g., `addEpicComment` instead of `addComment`). Adjust the calls accordingly.

- [ ] **Step 2: Add WebhookController to the module**

Modify `apps/local-app/src/modules/connectors/connectors.module.ts` — add import and register:

```ts
import { WebhookController } from './controllers/webhook.controller';
// ...
controllers: [ConnectorsController, WebhookController],
```

- [ ] **Step 3: Build and verify**

Run: `node_modules/.bin/nest build` from `apps/local-app/`
Expected: Compiles successfully

- [ ] **Step 4: Commit**

```bash
git add apps/local-app/src/modules/connectors/controllers/webhook.controller.ts apps/local-app/src/modules/connectors/connectors.module.ts
git commit -m "feat(connectors): add webhook controller for inbound sync"
```

---

## Task 10: UI — API Client + Page + Routing

**Files:**
- Create: `apps/local-app/src/ui/lib/connectors.ts`
- Create: `apps/local-app/src/ui/pages/ConnectorsPage.tsx`
- Modify: `apps/local-app/src/ui/App.tsx` (add route)
- Modify: `apps/local-app/src/ui/components/Layout.tsx` (add sidebar entry)

- [ ] **Step 1: Create API client library**

Create `apps/local-app/src/ui/lib/connectors.ts`:

```ts
export interface Connector {
  id: string;
  projectId: string;
  type: 'taskim' | 'monday' | 'jira';
  name: string;
  enabled: boolean;
  config: {
    apiUrl: string;
    credentials: Record<string, string>;
    workspaceId?: string;
  };
  externalProjectId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StatusMapping {
  id: string;
  connectorId: string;
  devchainStatusLabel: string;
  externalStatusId: string;
  direction: 'both' | 'push' | 'pull';
}

export class ConnectorApiError extends Error {
  public readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ConnectorApiError';
    this.status = status;
  }
}

async function throwOnError(response: Response, fallback: string): Promise<never> {
  const error = await response.json().catch(() => ({ message: fallback }));
  throw new ConnectorApiError(error.message || fallback, response.status);
}

export async function fetchConnectors(projectId: string): Promise<Connector[]> {
  const response = await fetch(`/api/connectors?projectId=${projectId}`);
  if (!response.ok) await throwOnError(response, 'Failed to fetch connectors');
  return response.json();
}

export async function createConnector(data: Partial<Connector> & { projectId: string; type: string; name: string }): Promise<Connector> {
  const response = await fetch('/api/connectors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) await throwOnError(response, 'Failed to create connector');
  return response.json();
}

export async function updateConnector(id: string, data: Partial<Connector>): Promise<Connector> {
  const response = await fetch(`/api/connectors/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) await throwOnError(response, 'Failed to update connector');
  return response.json();
}

export async function deleteConnector(id: string): Promise<void> {
  const response = await fetch(`/api/connectors/${id}`, { method: 'DELETE' });
  if (!response.ok) await throwOnError(response, 'Failed to delete connector');
}

export async function testConnection(id: string): Promise<{ success: boolean; error?: string }> {
  const response = await fetch(`/api/connectors/${id}/test`, { method: 'POST' });
  if (!response.ok) await throwOnError(response, 'Connection test failed');
  return response.json();
}

export async function fetchStatusMappings(connectorId: string): Promise<StatusMapping[]> {
  const response = await fetch(`/api/connectors/${connectorId}/status-mappings`);
  if (!response.ok) await throwOnError(response, 'Failed to fetch status mappings');
  return response.json();
}

export async function createStatusMapping(
  connectorId: string,
  data: { devchainStatusLabel: string; externalStatusId: string; direction?: string },
): Promise<StatusMapping> {
  const response = await fetch(`/api/connectors/${connectorId}/status-mappings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectorId, ...data }),
  });
  if (!response.ok) await throwOnError(response, 'Failed to create status mapping');
  return response.json();
}

export async function deleteStatusMapping(connectorId: string, mappingId: string): Promise<void> {
  const response = await fetch(`/api/connectors/${connectorId}/status-mappings/${mappingId}`, {
    method: 'DELETE',
  });
  if (!response.ok) await throwOnError(response, 'Failed to delete status mapping');
}
```

- [ ] **Step 2: Create the ConnectorsPage component**

Create `apps/local-app/src/ui/pages/ConnectorsPage.tsx`:

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSelectedProject } from '../hooks/useProjectSelection';
import { useToast } from '../hooks/use-toast';
import {
  fetchConnectors,
  createConnector,
  updateConnector,
  deleteConnector,
  type Connector,
} from '../lib/connectors';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Plug, Plus, Trash2, Loader2 } from 'lucide-react';

export function ConnectorsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { selectedProjectId } = useSelectedProject();
  const [showCreate, setShowCreate] = useState(false);

  const { data: connectors, isLoading } = useQuery({
    queryKey: ['connectors', selectedProjectId],
    queryFn: () => fetchConnectors(selectedProjectId as string),
    enabled: !!selectedProjectId,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      updateConnector(id, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors', selectedProjectId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteConnector,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors', selectedProjectId] });
      toast({ title: 'Connector deleted' });
    },
  });

  return (
    <div className="container py-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Plug className="w-6 h-6" />
          <h1 className="text-2xl font-bold">Connectors</h1>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Add Connector
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : !connectors || connectors.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No connectors configured. Click "Add Connector" to sync with an external service.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {connectors.map((connector) => (
            <ConnectorCard
              key={connector.id}
              connector={connector}
              onToggle={(enabled) => toggleMutation.mutate({ id: connector.id, enabled })}
              onDelete={() => deleteMutation.mutate(connector.id)}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateConnectorDialog
          projectId={selectedProjectId!}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ['connectors', selectedProjectId] });
          }}
        />
      )}
    </div>
  );
}

function ConnectorCard({
  connector,
  onToggle,
  onDelete,
}: {
  connector: Connector;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-semibold">{connector.name}</h4>
              <Badge variant={connector.enabled ? 'default' : 'secondary'}>
                {connector.enabled ? 'Enabled' : 'Disabled'}
              </Badge>
              <Badge variant="outline" className="capitalize">{connector.type}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              API: {connector.config.apiUrl}
              {connector.externalProjectId ? ` · Project: ${connector.externalProjectId}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-3 ml-4">
            <Switch checked={connector.enabled} onCheckedChange={onToggle} />
            <Button variant="ghost" size="icon" onClick={onDelete}>
              <Trash2 className="w-4 h-4 text-destructive" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CreateConnectorDialog({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [type, setType] = useState<'taskim' | 'monday' | 'jira'>('taskim');
  const [name, setName] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [externalProjectId, setExternalProjectId] = useState('');

  const createMutation = useMutation({
    mutationFn: () =>
      createConnector({
        projectId,
        type,
        name,
        enabled: false,
        config: {
          apiUrl,
          credentials: type === 'taskim' ? { email, password } : {},
          workspaceId: workspaceId || undefined,
        },
        externalProjectId: externalProjectId || null,
      }),
    onSuccess: () => {
      toast({ title: 'Connector created' });
      onCreated();
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create connector',
        variant: 'destructive',
      });
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Connector</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="taskim">Taskim</SelectItem>
                <SelectItem value="monday">Monday (coming soon)</SelectItem>
                <SelectItem value="jira">Jira (coming soon)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Taskim" />
          </div>
          <div className="space-y-2">
            <Label>API URL</Label>
            <Input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder="http://localhost:3000" />
          </div>
          {type === 'taskim' && (
            <>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="demo@example.com" />
              </div>
              <div className="space-y-2">
                <Label>Password</Label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Workspace ID</Label>
                <Input value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>External Project ID</Label>
                <Input value={externalProjectId} onChange={(e) => setExternalProjectId(e.target.value)} />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !name || !apiUrl}>
            {createMutation.isPending ? 'Creating...' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Add route to App.tsx**

In `apps/local-app/src/ui/App.tsx`, add:
1. Import at top: `import { ConnectorsPage } from './pages/ConnectorsPage';`
2. Add route inside the inner `<Routes>` block (after the automation route):
```tsx
<Route path="/connectors" element={<ConnectorsPage />} />
```

- [ ] **Step 4: Add sidebar entry to Layout.tsx**

In `apps/local-app/src/ui/components/Layout.tsx`:
1. Add `Plug` to the lucide-react import at the top
2. Add to the "project-config" section items array (after Statuses):
```tsx
{ label: 'Connectors', path: '/connectors', icon: Plug },
```

- [ ] **Step 5: Build, run, and verify**

Run: `node_modules/.bin/nest build` then `node dist/main.js` and `node_modules/.bin/vite --port 5175 --host 127.0.0.1`
Open browser at `http://127.0.0.1:5175/connectors` — verify the page renders.

- [ ] **Step 6: Commit**

```bash
git add apps/local-app/src/ui/lib/connectors.ts apps/local-app/src/ui/pages/ConnectorsPage.tsx apps/local-app/src/ui/App.tsx apps/local-app/src/ui/components/Layout.tsx
git commit -m "feat(connectors): add UI page, API client, routing, and sidebar entry"
```

---

## Task 11: Add Test Connection Endpoint

**Files:**
- Modify: `apps/local-app/src/modules/connectors/controllers/connectors.controller.ts`
- Modify: `apps/local-app/src/modules/connectors/connectors.module.ts` (already has adapter)

- [ ] **Step 1: Add test endpoint to controller**

The controller needs the `TaskimAdapter` injected. Update the constructor:

```ts
import { TaskimAdapter } from '../adapters/taskim.adapter';

@Controller('api/connectors')
export class ConnectorsController {
  constructor(
    private readonly service: ConnectorsService,
    private readonly taskimAdapter: TaskimAdapter,
  ) {}
```

Then add the endpoint:

```ts
@Post(':id/test')
async testConnection(@Param('id') id: string) {
  const connector = await this.service.get(id);
  const adapter = connector.type === 'taskim' ? this.taskimAdapter : null;
  if (!adapter) {
    return { success: false, error: `Adapter for type "${connector.type}" not implemented` };
  }
  return adapter.testConnection(connector.config);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/local-app/src/modules/connectors/controllers/connectors.controller.ts
git commit -m "feat(connectors): add test connection endpoint"
```

---

## Task 12: End-to-End Verification

- [ ] **Step 1: Apply migration to running DB**

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database(require('os').homedir() + '/.devchain/devchain.db');
const fs = require('fs');
const sql = fs.readFileSync('apps/local-app/drizzle/0065_connectors.sql', 'utf8');
const statements = sql.split('--> statement-breakpoint').map(s => s.trim()).filter(s => s);
for (const stmt of statements) { db.exec(stmt); }
console.log('Migration applied');
db.close();
"
```

- [ ] **Step 2: Build and start**

```bash
cd apps/local-app
node_modules/.bin/nest build
node dist/main.js &
node_modules/.bin/vite --port 5175 --host 127.0.0.1 &
```

- [ ] **Step 3: Verify CRUD via API**

```bash
# Create a connector
curl -X POST http://localhost:3000/api/connectors \
  -H 'Content-Type: application/json' \
  -d '{"projectId":"<your-project-id>","type":"taskim","name":"My Taskim","enabled":false,"config":{"apiUrl":"http://localhost:3000","credentials":{"email":"test@example.com","password":"pass"}}}'

# List connectors
curl http://localhost:3000/api/connectors?projectId=<your-project-id>

# Delete
curl -X DELETE http://localhost:3000/api/connectors/<connector-id>
```

- [ ] **Step 4: Verify UI**

Open `http://127.0.0.1:5175/connectors`, verify:
- Empty state shows "No connectors configured"
- "Add Connector" dialog works
- Created connector appears in list
- Enable/disable toggle works
- Delete works

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(connectors): complete connectors MVP with Taskim adapter"
```
