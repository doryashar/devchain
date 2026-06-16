import {
  Controller,
  Post,
  Param,
  Body,
  HttpCode,
  NotFoundException,
  Inject,
  Logger,
} from '@nestjs/common';
import { ConnectorsService } from '../services/connectors.service';
import { TaskimAdapter } from '../adapters/taskim.adapter';
import {
  STORAGE_SERVICE,
  type StorageService,
} from '../../storage/interfaces/storage.interface';
import { EpicsService } from '../../epics/services/epics.service';

@Controller('api/connectors/webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

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
    this.logger.debug({ connectorId, projectId }, 'Webhook received');

    const connector = await this.storage.getConnector(connectorId);
    if (!connector || !connector.enabled) {
      throw new NotFoundException('Connector not found or disabled');
    }

    const adapter = connector.type === 'taskim' ? this.taskimAdapter : null;
    if (!adapter) {
      return { received: true };
    }

    const event = await adapter.resolveWebhook(body, connector.config);
    if (!event) {
      this.logger.debug({ connectorId }, 'Webhook payload could not be resolved');
      return { received: true };
    }

    await this.handleInboundEvent(connectorId, projectId, event);
    return { received: true };
  }

  private async handleInboundEvent(
    connectorId: string,
    projectId: string,
    event: {
      action: string;
      externalId: string;
      fields?: any;
      comment?: any;
      timestamp: string;
    },
  ): Promise<void> {
    const syncState = await this.storage.findSyncStateByExternalId(
      connectorId,
      event.externalId,
    );
    const now = new Date().toISOString();

    if (event.action === 'deleted') {
      this.logger.log(
        { connectorId, externalId: event.externalId },
        'External task deleted',
      );
      return;
    }

    if (event.action === 'comment_created' && syncState) {
      const commentContent = event.comment?.content ?? 'External comment received';
      try {
        await this.epicsService.addEpicComment(
          syncState.epicId,
          projectId,
          `[via external] ${commentContent}`,
          'connector',
          'guest',
        );
        this.connectorsService.markSyncingFromRemote(syncState.epicId);
      } catch (e) {
        this.logger.error({ error: e }, 'Failed to add comment from webhook');
      }
      return;
    }

    if (syncState) {
      const remoteTime = new Date(event.timestamp).getTime();
      const syncedTime = new Date(syncState.lastSyncedAt).getTime();

      if (remoteTime > syncedTime && event.fields?.title) {
        this.connectorsService.markSyncingFromRemote(syncState.epicId);
        try {
          const epic = await this.storage.getEpic(syncState.epicId);
          if (epic) {
            await this.epicsService.updateEpic(
              syncState.epicId,
              {
                title: event.fields.title,
                description: event.fields.description ?? undefined,
              },
              epic.version,
            );
          }
          await this.storage.updateSyncState(syncState.id, { lastSyncedAt: now });
          this.logger.log({ epicId: syncState.epicId }, 'Updated epic from webhook');
        } catch (e) {
          this.logger.error({ error: e }, 'Failed to update epic from webhook');
        }
      }
    } else {
      if (event.fields?.title) {
        try {
          const epic = await this.epicsService.createEpicForProject(
            projectId,
            {
              title: event.fields.title,
              description: event.fields.description ?? undefined,
            },
          );

          this.connectorsService.markSyncingFromRemote(epic.id);
          await this.storage.createSyncState({
            connectorId,
            epicId: epic.id,
            externalId: event.externalId,
            lastSyncedAt: now,
            lastSyncedHash: null,
          });
          this.logger.log(
            { epicId: epic.id, externalId: event.externalId },
            'Created epic from webhook',
          );
        } catch (e) {
          this.logger.error({ error: e }, 'Failed to create epic from webhook');
        }
      }
    }
  }
}
