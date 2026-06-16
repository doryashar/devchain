import { Injectable, Inject } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  STORAGE_SERVICE,
  type StorageService,
} from '../../storage/interfaces/storage.interface';
import { ConnectorsService } from './connectors.service';
import { TaskimAdapter } from '../adapters/taskim.adapter';
import type { ConnectorAdapter } from '../adapters/connector-adapter.interface';
import { createLogger } from '../../../common/logging/logger';

const logger = createLogger('ConnectorEventListener');

@Injectable()
export class ConnectorEventListener {
  constructor(
    private readonly connectorsService: ConnectorsService,
    private readonly taskimAdapter: TaskimAdapter,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  private getAdapter(type: string): ConnectorAdapter | null {
    if (type === 'taskim') return this.taskimAdapter;
    return null;
  }

  @OnEvent('epic.created', { async: true })
  async handleEpicCreated(payload: { epicId: string; projectId: string }): Promise<void> {
    await this.syncOutbound(payload.epicId, payload.projectId);
  }

  @OnEvent('epic.updated', { async: true })
  async handleEpicUpdated(payload: { epicId: string; projectId: string }): Promise<void> {
    if (this.connectorsService.isSyncingFromRemote(payload.epicId)) {
      logger.debug(
        { epicId: payload.epicId },
        'Skipping outbound sync — change came from remote',
      );
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
            epic,
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
          logger.info(
            { epicId, connectorId: connector.id, externalId: result.externalId },
            'Synced epic to external',
          );
        } else {
          logger.warn(
            { epicId, connectorId: connector.id, error: result.error },
            'Failed to sync epic',
          );
        }
      }
    } catch (e) {
      logger.error({ epicId, error: e }, 'Outbound sync error');
    }
  }
}
