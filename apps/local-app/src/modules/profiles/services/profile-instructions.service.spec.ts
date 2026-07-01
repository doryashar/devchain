import { Test, TestingModule } from '@nestjs/testing';
import { STORAGE_SERVICE } from '../../storage/interfaces/storage.interface';
import { ProfileInstructionsService } from './profile-instructions.service';
import { InstructionsResolver } from '../../mcp/services/instructions-resolver';

jest.mock('../../../common/logging/logger', () => ({
  createLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }),
}));

describe('ProfileInstructionsService', () => {
  let service: ProfileInstructionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProfileInstructionsService, { provide: STORAGE_SERVICE, useValue: {} }],
    }).compile();
    service = module.get(ProfileInstructionsService);
  });

  it('exposes a constructed InstructionsResolver', () => {
    expect(service.getResolver()).toBeInstanceOf(InstructionsResolver);
  });
});
