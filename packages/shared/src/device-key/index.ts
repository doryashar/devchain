// @devchain/shared/device-key — Ed25519 device signing key + RFC 7638 JWK thumbprint.
//
// Shared verbatim by Node (identity service) and Hermes (mobile mirror). The private
// key's at-rest storage is platform-specific and lives in the platform apps, NOT here.

export {
  ED25519_PRIVATE_KEY_BYTES,
  ED25519_PUBLIC_KEY_BYTES,
  ED25519_SIGNATURE_BYTES,
  DEVICE_KEY_KTY,
  DEVICE_KEY_CRV,
  fromEd25519PrivateKey,
  generateEd25519KeyPair,
  publicKeyToJwk,
  canonicalJwk,
  computeJwkThumbprint,
  signMessage,
  verifySignature,
  type Ed25519KeyPair,
  type Ed25519PublicJwk,
} from './keypair.js';
