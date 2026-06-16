import { Injectable, Inject } from '@nestjs/common';
import {
  STORAGE_SERVICE,
  type StorageService,
} from '../../storage/interfaces/storage.interface';
import type {
  Connector,
  ConnectorStatusMapping,
  ConnectorSyncState,
} from '../../storage/models/domain.models';
import type { CreateConnectorDto, UpdateConnectorDto } from '../dtos/connector.dto';
import { NotFoundError } from '../../../common/errors/error-types';
import { createLogger } from '../../../common/logging/logger';

const logger = createLogger('ConnectorsService');

@Injectable()
export class ConnectorsService {
  private readonly syncingFromRemote = new Set<string>();

  constructor(@Inject(STORAGE_SERVICE) private readonly storage: StorageService) {}

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

  async getSyncState(connectorId: string, epicId: string): Promise<ConnectorSyncState | null> {
    return this.storage.getSyncState(connectorId, epicId);
  }

  async listSyncStates(connectorId: string): Promise<ConnectorSyncState[]> {
    return this.storage.listSyncStates(connectorId);
  }

  markSyncingFromRemote(epicId: string): void {
    this.syncingFromRemote.add(epicId);
  }

  isSyncingFromRemote(epicId: string): boolean {
    const val = this.syncingFromRemote.has(epicId);
    if (val) this.syncingFromRemote.delete(epicId);
    return val;
  }

  async listEnabledForProject(projectId: string): Promise<Connector[]> {
    const all = await this.storage.listConnectors(projectId);
    return all.filter((c) => c.enabled);
  }
}
