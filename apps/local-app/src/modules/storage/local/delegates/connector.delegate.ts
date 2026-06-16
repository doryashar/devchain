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

    return rows.map(
      (row) => ({ ...row, config: row.config as ConnectorConfig }) as Connector,
    );
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

    const rows = await this.db
      .select()
      .from(connectorStatusMappings)
      .where(eq(connectorStatusMappings.connectorId, connectorId));
    return rows as ConnectorStatusMapping[];
  }

  async createStatusMapping(
    data: CreateConnectorStatusMapping,
  ): Promise<ConnectorStatusMapping> {
    const { randomUUID } = await import('crypto');
    const now = new Date().toISOString();
    const { connectorStatusMappings } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');

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
    return rows[0] as ConnectorStatusMapping;
  }

  async updateStatusMapping(
    id: string,
    data: UpdateConnectorStatusMapping,
  ): Promise<ConnectorStatusMapping> {
    const { connectorStatusMappings } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');

    const updateData: Record<string, unknown> = {};
    if (data.devchainStatusLabel !== undefined)
      updateData.devchainStatusLabel = data.devchainStatusLabel;
    if (data.externalStatusId !== undefined)
      updateData.externalStatusId = data.externalStatusId;
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
    return rows[0] as ConnectorStatusMapping;
  }

  async deleteStatusMapping(id: string): Promise<void> {
    const { connectorStatusMappings } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');
    await this.db.delete(connectorStatusMappings).where(eq(connectorStatusMappings.id, id));
  }

  async getSyncState(
    connectorId: string,
    epicId: string,
  ): Promise<ConnectorSyncState | null> {
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

  async updateSyncState(
    id: string,
    data: UpdateConnectorSyncState,
  ): Promise<ConnectorSyncState> {
    const { connectorSyncState } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');
    const now = new Date().toISOString();

    const updateData: Record<string, unknown> = { updatedAt: now };
    if (data.externalId !== undefined) updateData.externalId = data.externalId;
    if (data.lastSyncedAt !== undefined) updateData.lastSyncedAt = data.lastSyncedAt;
    if (data.lastSyncedHash !== undefined) updateData.lastSyncedHash = data.lastSyncedHash;

    await this.db
      .update(connectorSyncState)
      .set(updateData)
      .where(eq(connectorSyncState.id, id));

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

    const rows = await this.db
      .select()
      .from(connectorFieldMappings)
      .where(eq(connectorFieldMappings.connectorId, connectorId));
    return rows as ConnectorFieldMapping[];
  }

  async createFieldMapping(
    data: CreateConnectorFieldMapping,
  ): Promise<ConnectorFieldMapping> {
    const { randomUUID } = await import('crypto');
    const now = new Date().toISOString();
    const { connectorFieldMappings } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');

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
    return rows[0] as ConnectorFieldMapping;
  }

  async deleteFieldMapping(id: string): Promise<void> {
    const { connectorFieldMappings } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');
    await this.db.delete(connectorFieldMappings).where(eq(connectorFieldMappings.id, id));
  }
}
