import { Test, TestingModule } from '@nestjs/testing';
import { ValidationError } from '../../../common/errors/error-types';
import { E2eeTrustService } from '../services/e2ee-trust.service';
import { E2eeTrustController } from './e2ee-trust.controller';

describe('E2eeTrustController', () => {
  let controller: E2eeTrustController;
  let service: {
    listDevices: jest.Mock;
    getSafetyNumber: jest.Mock;
    verifyDevice: jest.Mock;
    revokeDevice: jest.Mock;
    adoptPeerKeyTofu: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      listDevices: jest
        .fn()
        .mockReturnValue([
          { kid: 'k', label: 'Pixel', trust: 'unverified', addedAt: '2026-06-20T00:00:00Z' },
        ]),
      getSafetyNumber: jest
        .fn()
        .mockResolvedValue({ kid: 'k', safetyNumber: '00000 00000', trust: 'unverified' }),
      verifyDevice: jest
        .fn()
        .mockReturnValue({ kid: 'k', trust: 'verified', verifiedVia: 'safety-number' }),
      revokeDevice: jest.fn().mockReturnValue({ kid: 'k', removed: true }),
      adoptPeerKeyTofu: jest.fn().mockReturnValue({ kid: 'k', trust: 'unverified' }),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [E2eeTrustController],
      providers: [{ provide: E2eeTrustService, useValue: service }],
    }).compile();
    controller = module.get(E2eeTrustController);
  });

  it('listDevices returns the paired-device metadata list', () => {
    const res = controller.listDevices();
    expect(service.listDevices).toHaveBeenCalled();
    expect(res).toEqual([
      { kid: 'k', label: 'Pixel', trust: 'unverified', addedAt: '2026-06-20T00:00:00Z' },
    ]);
  });

  it('safetyNumber delegates to the service with the kid', async () => {
    const res = await controller.safetyNumber('k');
    expect(service.getSafetyNumber).toHaveBeenCalledWith('k');
    expect(res.safetyNumber).toBe('00000 00000');
  });

  it('verify delegates to the service and returns the verified trust', () => {
    const res = controller.verify('k');
    expect(service.verifyDevice).toHaveBeenCalledWith('k');
    expect(res.trust).toBe('verified');
  });

  it('revokeDevice un-pairs via the service', () => {
    const res = controller.revokeDevice('k');
    expect(service.revokeDevice).toHaveBeenCalledWith('k');
    expect(res).toEqual({ kid: 'k', removed: true });
  });

  it('adopt forwards the relayed key to the service', () => {
    const res = controller.adopt({ kid: 'k', publicKeyB64: 'pub', label: 'Pixel' });
    expect(service.adoptPeerKeyTofu).toHaveBeenCalledWith({
      kid: 'k',
      publicKeyB64: 'pub',
      label: 'Pixel',
    });
    expect(res.trust).toBe('unverified');
  });

  it('adopt rejects when kid or publicKeyB64 is missing', () => {
    expect(() => controller.adopt({ kid: 'k' })).toThrow(ValidationError);
    expect(service.adoptPeerKeyTofu).not.toHaveBeenCalled();
  });
});
