import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { TeamsModule } from '../teams/teams.module';
import { AutoAssignRulesController } from './controllers/auto-assign-rules.controller';
import { AutoAssignRulesService } from './services/auto-assign-rules.service';

@Module({
  imports: [StorageModule, TeamsModule],
  controllers: [AutoAssignRulesController],
  providers: [AutoAssignRulesService],
  exports: [AutoAssignRulesService],
})
export class AutoAssignRulesModule {}
