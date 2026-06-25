import { Injectable, Inject, Optional } from '@nestjs/common';
import { randomBytes as nodeRandomBytes } from 'crypto';
import {
  CryptoEnvelopeService,
  base64ToBytes,
  deriveSharedKey,
  buildE2eeCapability,
  negotiateE2ee,
  X25519_PUBLIC_KEY_BYTES,
  type E2eeCapability,
  type E2eeContext,
  type E2eeEnvelope,
  type E2eeKeyProvider,
  type E2eeNegotiationReason,
  type ViewportScreen,
} from '@devchain/shared';
import { createLogger } from '../../../common/logging/logger';
import { E2eeKeypairService } from '../../e2ee/services/e2ee-keypair.service';
import {
  E2eeDeviceStoreService,
  type E2eePeerDevice,
} from '../../e2ee/services/e2ee-device-store.service';
import { E2EE_REQUIRED_POLICY } from './tunnel-rpc-crypto.service';

const logger = createLogger('TunnelViewportCrypto');

/**
 * How a viewport frame may travel to the paired mobile RIGHT NOW:
 *  - `encrypted` — both sides E2EE-capable: the full screen is sealed (`sealScreen` present).
 *  - `plaintext` — no E2EE-capable peer / no prior key: stream the existing plaintext
 *    full/diff frames (back-compat for non-paired clients).
 *  - `blocked`   — the PC `e2eeRequired` policy faces an incapable peer: withhold the frame
 *    entirely (terminal content must never ship plaintext when E2EE is required).
 */
export type ViewportChannelMode = 'encrypted' | 'plaintext' | 'blocked';

export interface ViewportChannel {
  mode: ViewportChannelMode;
  reason: E2eeNegotiationReason;
  /**
   * Present iff `mode === 'encrypted'`: seal a full {@link ViewportScreen}, binding
   * `lane:'viewport'` + `routeKey:sessionId` + the frame `seq` into the AEAD's AAD.
   */
  sealScreen?: (sessionId: string, seq: number, screen: ViewportScreen) => Promise<E2eeEnvelope>;
}

/**
 * PC-side viewport transport-encryption seam (Phase 4, Task:1).
 *
 * The live tmux screen can contain secrets, so the viewport `body` is sealed before it leaves
 * the local-app — the bridge then routes/buffers the latest OPAQUE full frame and never reads
 * screen content. This mirrors {@link TunnelPushCryptoService} / {@link TunnelRpcCryptoService}
 * (same key model: the pairwise shared key is re-derived on demand from the PC private key +
 * the paired device public key, never persisted; sealed under THIS PC's kid so the phone
 * resolves the same key). v1 encrypted viewport is FULL-FRAME-ONLY — the streamer seals each
 * full screen; bridge-side diff folding is dropped for encrypted frames.
 *
 * NOTE: the paired-device selection + capability negotiation mirrors `TunnelPushCryptoService`;
 * a future refactor could extract a shared `paired-device channel` resolver (see ADDITIONAL
 * TODOs in the Phase-3 / Phase-4 reports).
 */
@Injectable()
export class TunnelViewportCryptoService {
  constructor(
    private readonly keypair: E2eeKeypairService,
    private readonly deviceStore: E2eeDeviceStoreService,
    @Optional() @Inject(E2EE_REQUIRED_POLICY) private readonly e2eeRequired: boolean = false,
  ) {}

  /** node:crypto CSPRNG, adapted to the injected `(n) => Uint8Array` contract. */
  private readonly randomBytes = (n: number): Uint8Array => new Uint8Array(nodeRandomBytes(n));

  /**
   * Decide how the viewport may travel to the paired mobile and, when encrypted, return a
   * per-frame `sealScreen`. `instanceId` (the bridge-assigned id this tunnel belongs to) binds
   * the AEAD's AAD; without it (pre-`ready`) the lane can't seal → `plaintext`. Never throws —
   * a crypto lookup failure fails toward `plaintext` (back-compat), never leaking a half-seal.
   */
  async resolveViewportChannel(instanceId: string | null): Promise<ViewportChannel> {
    if (!instanceId) {
      return { mode: 'plaintext', reason: 'plaintext-mixed' };
    }

    let pcKid: string;
    let pcPrivateKey: Uint8Array;
    let selfCap: E2eeCapability;
    try {
      const kp = await this.keypair.getOrCreate();
      pcKid = kp.kid;
      pcPrivateKey = kp.privateKey;
      selfCap = buildE2eeCapability({
        e2eeRequired: this.e2eeRequired,
        key: { kid: kp.kid, publicKeyB64: Buffer.from(kp.publicKey).toString('base64') },
      });
    } catch (err) {
      // Our own key is unavailable → we cannot seal. Under the strict `e2eeRequired`
      // policy this MUST fail closed (`blocked` → the streamer withholds the frame):
      // a broken keypair must NEVER cause terminal content to ship in plaintext. Only
      // when E2EE is optional do we fall back to the plaintext full/diff frames
      // (mixed-client back-compat), mirroring the negotiated incapable-peer path below.
      if (this.e2eeRequired) {
        logger.warn({ err }, 'E2EE keypair unavailable — viewport BLOCKED (E2EE required)');
        return { mode: 'blocked', reason: 'peer-incapable-required' };
      }
      logger.warn({ err }, 'E2EE keypair unavailable — viewport falls back to plaintext');
      return { mode: 'plaintext', reason: 'plaintext-mixed' };
    }

    const device = this.selectPeerDevice();
    const peerCap: E2eeCapability | null = device
      ? { v: 1, envelopeVersion: 1, e2eeSupported: true, e2eeRequired: false }
      : null;

    const neg = negotiateE2ee(selfCap, peerCap, { hasExistingKey: !!device });

    if (neg.mode !== 'encrypted' || !device) {
      return { mode: neg.mode, reason: neg.reason };
    }

    const devicePub = base64ToBytes(device.publicKeyB64);
    const sharedKey = deriveSharedKey(pcPrivateKey, devicePub);
    const provider: E2eeKeyProvider = {
      resolveSealKey: () => ({ kid: pcKid, key: sharedKey }),
      getKeyById: (kid) => (kid === pcKid || kid === device.kid ? sharedKey : undefined),
    };
    const service = new CryptoEnvelopeService(provider, this.randomBytes);

    return {
      mode: 'encrypted',
      reason: neg.reason,
      sealScreen: (sessionId, seq, screen) =>
        service.seal(screen, this.ctx(instanceId, sessionId, seq)),
    };
  }

  private ctx(instanceId: string, sessionId: string, seq: number): E2eeContext {
    return {
      lane: 'viewport',
      direction: 'pc-to-mobile',
      instanceId,
      // The viewport lane's natural routing key is the sessionId; the per-stream monotonic
      // `seq` is bound too so a frame can't be replayed at a different position.
      routeKey: sessionId,
      seq,
    };
  }

  /**
   * Choose the single peer device to seal for (v1 envelopes are single-recipient; multi-device
   * fanout is OUT of scope). Picks the most recently added usable device when more than one is
   * paired. Returns `null` when none is usable.
   */
  private selectPeerDevice(): E2eePeerDevice | null {
    const usable = this.deviceStore.list().filter((d) => this.isUsable(d));
    if (usable.length === 0) return null;
    if (usable.length === 1) return usable[0];
    const [latest] = [...usable].sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1));
    logger.debug(
      { count: usable.length, kid: latest.kid },
      'Multiple paired devices — sealing viewport for the most recently added (v1 single-recipient)',
    );
    return latest;
  }

  private isUsable(device: E2eePeerDevice): boolean {
    if (device.trust === 'revoked') return false;
    try {
      return base64ToBytes(device.publicKeyB64).length === X25519_PUBLIC_KEY_BYTES;
    } catch {
      return false;
    }
  }
}
