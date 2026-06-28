import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { CloudSessionManagerService } from '../services/cloud-session-manager.service';
import { StoreCloudTokensSchema } from '../dtos/cloud-tokens.dto';
import { createLogger } from '../../../common/logging/logger';
import { mapStoreTokensError } from './store-tokens-error';

const logger = createLogger('CloudAuthCallback');

@Controller('api/auth/cloud')
export class AuthCallbackController {
  constructor(private readonly cloudSessionManager: CloudSessionManagerService) {}

  @Post('tokens')
  @HttpCode(HttpStatus.OK)
  async storeTokens(@Body() body: unknown): Promise<{ userId: string; email?: string }> {
    const parsed = StoreCloudTokensSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message).join('; '));
    }

    try {
      const tokens = await this.cloudSessionManager.storeTokens(
        parsed.data.accessToken,
        parsed.data.refreshToken,
      );
      return { userId: tokens.userId, email: tokens.email };
    } catch (error) {
      logger.error({ err: error }, 'storeTokens failed');
      throw mapStoreTokensError(error);
    }
  }

  @Get('status')
  getStatus() {
    return this.cloudSessionManager.getStatus();
  }

  @Delete('session')
  @HttpCode(HttpStatus.NO_CONTENT)
  async disconnect(): Promise<void> {
    await this.cloudSessionManager.disconnect();
  }
}
