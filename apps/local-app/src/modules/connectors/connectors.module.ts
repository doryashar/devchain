import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { EventsCoreModule } from '../events/events-core.module';
import { EpicsModule } from '../epics/epics.module';
import { ConnectorsController } from './controllers/connectors.controller';
import { WebhookController } from './controllers/webhook.controller';
import { ConnectorsService } from './services/connectors.service';
import { ConnectorEventListener } from './services/connector-event-listener.service';
import { TaskimAdapter } from './adapters/taskim.adapter';

@Module({
  imports: [StorageModule, EventsCoreModule, EpicsModule],
  controllers: [ConnectorsController, WebhookController],
  providers: [ConnectorsService, ConnectorEventListener, TaskimAdapter],
  exports: [ConnectorsService],
})
export class ConnectorsModule {}
