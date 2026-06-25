// CryptoEnvelopeService — the ONE place content is encrypted/decrypted.
//
// Feature code never touches crypto: transport seams call seal()/open(). The same
// instance shape runs on Node (PC) and Hermes (mobile); platform differences are
// injected (key provider + RNG). AEAD is XChaCha20-Poly1305 via @noble/ciphers —
// the library's authenticated mode does encrypt-then-MAC and a constant-time tag
// check; we never hand-roll AEAD composition and never branch on secret bytes.

import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { utf8ToBytes, bytesToUtf8 } from '@noble/hashes/utils';
import { buildAad } from './aad.js';
import { base64ToBytes, bytesToBase64, InvalidBase64Error } from './base64.js';
import {
  E2EE_ALG_XCHACHA20POLY1305,
  E2EE_ENVELOPE_VERSION,
  E2EE_KEY_BYTES,
  E2EE_NONCE_BYTES,
  E2eeAuthenticationError,
  E2eeError,
  E2eeInvalidKeyError,
  E2eeMalformedEnvelopeError,
  E2eeUnknownKeyError,
  E2eeUnsupportedAlgError,
  E2eeUnsupportedVersionError,
  isE2eeEnvelope,
  type E2eeContext,
  type E2eeEnvelope,
  type E2eeKeyProvider,
  type RandomBytes,
} from './envelope.js';

export class CryptoEnvelopeService {
  constructor(
    private readonly keys: E2eeKeyProvider,
    private readonly randomBytes: RandomBytes,
  ) {}

  /**
   * Seal an arbitrary JSON-serializable value into a versioned envelope, binding
   * `ctx` (lane/direction/instance/route[/seq]) into the AEAD's AAD. A fresh random
   * 24-byte nonce is generated per call. Never logs key material or plaintext.
   */
  async seal<T>(plaintext: T, ctx: E2eeContext): Promise<E2eeEnvelope> {
    const { kid, key } = await this.keys.resolveSealKey();
    assertKeyLength(key);

    const nonce = this.randomBytes(E2EE_NONCE_BYTES);
    if (nonce.length !== E2EE_NONCE_BYTES) {
      // A misbehaving RNG must fail loudly, never silently weaken the nonce.
      throw new E2eeError(`RNG returned ${nonce.length} bytes, expected ${E2EE_NONCE_BYTES}`);
    }

    const aad = buildAad(ctx, kid, E2EE_ENVELOPE_VERSION, E2EE_ALG_XCHACHA20POLY1305);
    const pt = utf8ToBytes(JSON.stringify(plaintext));
    const ct = xchacha20poly1305(key, nonce, aad).encrypt(pt);

    return {
      v: E2EE_ENVELOPE_VERSION,
      kid,
      alg: E2EE_ALG_XCHACHA20POLY1305,
      nonce: bytesToBase64(nonce),
      ct: bytesToBase64(ct),
    };
  }

  /**
   * Open an envelope, returning the decoded plaintext object. Fails CLOSED with a
   * typed error — never a crash — on: malformed shape/encoding, unknown version or
   * alg, unknown key id, or authentication failure (tamper or `ctx` mismatch, e.g.
   * a ciphertext replayed onto a different routeKey/lane/direction). The SAME `ctx`
   * used at seal time must be supplied here.
   */
  async open<T = unknown>(envelope: unknown, ctx: E2eeContext): Promise<T> {
    if (!isE2eeEnvelope(envelope)) {
      throw new E2eeMalformedEnvelopeError('shape failed structural validation');
    }
    // Version/alg are checked BEFORE key lookup or decrypt so an unknown protocol is
    // a typed rejection, not an exception from deep inside the cipher.
    if (envelope.v !== E2EE_ENVELOPE_VERSION) {
      throw new E2eeUnsupportedVersionError(envelope.v);
    }
    if (envelope.alg !== E2EE_ALG_XCHACHA20POLY1305) {
      throw new E2eeUnsupportedAlgError(envelope.alg);
    }

    const key = (await this.keys.getKeyById(envelope.kid)) ?? undefined;
    if (!key) throw new E2eeUnknownKeyError(envelope.kid);
    assertKeyLength(key);

    let nonce: Uint8Array;
    let ct: Uint8Array;
    try {
      nonce = base64ToBytes(envelope.nonce);
      ct = base64ToBytes(envelope.ct);
    } catch (err) {
      if (err instanceof InvalidBase64Error) {
        throw new E2eeMalformedEnvelopeError(err.message);
      }
      throw err;
    }
    if (nonce.length !== E2EE_NONCE_BYTES) {
      throw new E2eeMalformedEnvelopeError(
        `nonce must be ${E2EE_NONCE_BYTES} bytes, got ${nonce.length}`,
      );
    }

    // kid/v/alg are taken from the envelope so tampering with any of them also
    // changes the AAD and fails the tag check.
    const aad = buildAad(ctx, envelope.kid, envelope.v, envelope.alg);

    let pt: Uint8Array;
    try {
      pt = xchacha20poly1305(key, nonce, aad).decrypt(ct);
    } catch {
      // Collapse every AEAD failure into ONE error: do not distinguish bad-tag from
      // bad-padding etc., and do not leak which check failed.
      throw new E2eeAuthenticationError();
    }

    try {
      return JSON.parse(bytesToUtf8(pt)) as T;
    } catch {
      // Authenticated bytes that aren't valid JSON: treat as malformed, not auth.
      throw new E2eeMalformedEnvelopeError('decrypted plaintext is not valid JSON');
    }
  }
}

function assertKeyLength(key: Uint8Array): void {
  if (key.length !== E2EE_KEY_BYTES) throw new E2eeInvalidKeyError(key.length);
}
