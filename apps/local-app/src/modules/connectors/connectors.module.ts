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
