// Mock the logger BEFORE importing the controller: createLogger returns a pino
// child that is silent under Jest, so we swap in an inspectable mock instead.
const mockLogger = {
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};

jest.mock('../../../common/logging/logger', () => ({
  createLogger: () => mockLogger,
}));

import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  InternalServerErrorException,
} from '@nestjs/common';
import { AuthCallbackController } from './auth-callback.controller';
import type { CloudSessionManagerService } from '../services/cloud-session-manager.service';
import type { CloudTokens } from '../types';

function withCode(code: string, message = 'jose failure'): Error {
  return Object.assign(new Error(message), { code });
}

describe('AuthCallbackController.storeTokens', () => {
  let controller: AuthCallbackController;
  let storeTokens: jest.Mock;

  const validBody = { accessToken: 'access', refreshToken: 'refresh' };

  beforeEach(() => {
    jest.clearAllMocks();
    storeTokens = jest.fn();
    const cloudSessionManager = {
      storeTokens,
    } as unknown as CloudSessionManagerService;
    controller = new AuthCallbackController(cloudSessionManager);
  });

  it('returns { userId, email } on success', async () => {
    storeTokens.mockResolvedValue({
      userId: 'user-123',
      email: 'user@example.com',
    } as CloudTokens);

    const result = await controller.storeTokens(validBody);

    expect(result).toEqual({ userId: 'user-123', email: 'user@example.com' });
    expect(storeTokens).toHaveBeenCalledWith('access', 'refresh');
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('maps a bad token to 400 and logs the underlying error', async () => {
    const underlying = withCode('ERR_JWS_SIGNATURE_VERIFICATION_FAILED');
    storeTokens.mockRejectedValue(underlying);

    await expect(controller.storeTokens(validBody)).rejects.toBeInstanceOf(BadRequestException);

    expect(mockLogger.error).toHaveBeenCalledWith({ err: underlying }, 'storeTokens failed');
  });

  it('maps an empty JWKS (ERR_JWKS_NO_MATCHING_KEY) to 502', async () => {
    storeTokens.mockRejectedValue(withCode('ERR_JWKS_NO_MATCHING_KEY'));

    await expect(controller.storeTokens(validBody)).rejects.toBeInstanceOf(BadGatewayException);
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
  });

  it('maps an unknown persistence failure to 500', async () => {
    storeTokens.mockRejectedValue(new Error('encryption key unavailable'));

    await expect(controller.storeTokens(validBody)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid body with a Zod 400 before the try (mapper not used, no error log)', async () => {
    let caught: unknown;
    try {
      await controller.storeTokens({ accessToken: '' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as HttpException).getStatus()).toBe(400);
    expect(storeTokens).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });
});
