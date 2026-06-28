import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ValidationError } from '../../../common/errors/error-types';
import {
  E2eeTrustService,
  type DeviceSafetyNumberResult,
  type DeviceTrustResult,
  type PairedDeviceSummary,
} from '../services/e2ee-trust.service';

interface AdoptBody {
  kid?: string;
  publicKeyB64?: string;
  label?: string;
}

/**
 * Renderer-facing endpoints for the shared E2EE trust surface (Phase-1 Task:8):
 *   GET    /api/e2ee/devices                     → paired devices (metadata only) for the UI list
 *   GET    /api/e2ee/devices/:kid/safety-number  → the compare fingerprint (QrDisplayPanel)
 *   POST   /api/e2ee/devices/:kid/verify         → mark VERIFIED after a matching compare
 *   DELETE /api/e2ee/devices/:kid                → un-pair (remove a stale/old device)
 *   POST   /api/e2ee/devices/adopt               → email-TOFU adopt / re-pair seam
 * QR pairing (Task:4) already verifies on the visual channel; these add the email-TOFU +
 * on-demand-verify legs so both login paths converge on one trust model.
 */
@Controller('api/e2ee/devices')
export class E2eeTrustController {
  constructor(private readonly trust: E2eeTrustService) {}

  @Get()
  listDevices(): PairedDeviceSummary[] {
    return this.trust.listDevices();
  }

  @Get(':kid/safety-number')
  async safetyNumber(@Param('kid') kid: string): Promise<DeviceSafetyNumberResult> {
    return this.trust.getSafetyNumber(kid);
  }

  @Post(':kid/verify')
  verify(@Param('kid') kid: string): DeviceTrustResult {
    return this.trust.verifyDevice(kid);
  }

  @Delete(':kid')
  revokeDevice(@Param('kid') kid: string): { kid: string; removed: boolean } {
    return this.trust.revokeDevice(kid);
  }

  @Post('adopt')
  adopt(@Body() body: AdoptBody): DeviceTrustResult {
    if (!body?.kid || !body.publicKeyB64) {
      throw new ValidationError('kid and publicKeyB64 are required');
    }
    return this.trust.adoptPeerKeyTofu({
      kid: body.kid,
      publicKeyB64: body.publicKeyB64,
      ...(body.label !== undefined ? { label: body.label } : {}),
    });
  }
}
