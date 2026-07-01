import { Module } from '@nestjs/common';
import { ProfilesController } from './controllers/profiles.controller';
import { ProviderConfigsController } from './controllers/provider-configs.controller';
import { StorageModule } from '../storage/storage.module';
import { SettingsModule } from '../settings/settings.module';
import { TeamsModule } from '../teams/teams.module';
import { ProviderConfigsService } from './services/provider-configs.service';
import { ProfileInstructionsService } from './services/profile-instructions.service';

@Module({
  imports: [StorageModule, SettingsModule, TeamsModule],
  controllers: [ProfilesController, ProviderConfigsController],
  providers: [ProviderConfigsService, ProfileInstructionsService],
})
export class ProfilesModule {}
