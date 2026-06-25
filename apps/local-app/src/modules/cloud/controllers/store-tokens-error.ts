import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  InternalServerErrorException,
} from '@nestjs/common';
import * as jose from 'jose';

/**
 * Maps the underlying cause of a failed `storeTokens` call to an actionable
 * HTTP status + short client message. The full root cause is kept in server
 * logs only (see the controller); these messages are intentionally terse.
 *
 * Status semantics:
 * - 400: the access token itself is bad/expired/tampered.
 * - 502: the cloud identity service / JWKS / JOSE verification infrastructure
 *        is unavailable or misconfigured (the token could not be verified at all).
 * - 500: local persistence failed (token store DB/encryption, or a truly
 *        unknown non-jose error).
 */

const BAD_TOKEN_JOSE_CODES = [
  'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
  'ERR_JWT_EXPIRED',
  'ERR_JWT_CLAIM_VALIDATION_FAILED',
  'ERR_JWS_INVALID',
  'ERR_JWT_INVALID',
  'ERR_JOSE_ALG_NOT_ALLOWED',
];

const IDENTITY_JOSE_CODES = [
  'ERR_JWKS_NO_MATCHING_KEY',
  'ERR_JWKS_TIMEOUT',
  'ERR_JWKS_INVALID',
  'ERR_JWK_INVALID',
  'ERR_JWKS_MULTIPLE_MATCHING_KEYS',
  'ERR_JOSE_NOT_SUPPORTED',
];

const NETWORK_ERROR_CODES = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'];

const BAD_TOKEN_MESSAGE = 'Invalid or expired access token';
const IDENTITY_MESSAGE =
  'Could not verify the access token because the cloud identity service is unavailable or misconfigured';
const PERSIST_MESSAGE = 'Failed to persist cloud session';

/** True when the error carries a string `.code` present in `codes`. */
export function isJoseCode(error: unknown, codes: string[]): boolean {
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && codes.includes(code);
}

/**
 * True when the error looks like a network failure reaching the identity
 * service. `fetch` surfaces the OS error on `error.cause.code` (not the
 * top-level `.code`), so both locations are checked; `'fetch failed'` is the
 * undici fallback message when no code is available.
 */
export function isNetworkError(error: unknown): boolean {
  const topCode = (error as { code?: unknown }).code;
  if (typeof topCode === 'string' && NETWORK_ERROR_CODES.includes(topCode)) {
    return true;
  }

  const causeCode = (error as { cause?: { code?: unknown } }).cause?.code;
  if (typeof causeCode === 'string' && NETWORK_ERROR_CODES.includes(causeCode)) {
    return true;
  }

  return error instanceof Error && error.message === 'fetch failed';
}

function messageIncludes(error: unknown, substring: string): boolean {
  return error instanceof Error && error.message.includes(substring);
}

/**
 * Any jose error not classified above — an unrecognized jose code is more
 * likely a crypto/JWKS-layer break than a bad token, so it maps to 502.
 */
function isUnknownJoseError(error: unknown): boolean {
  if (error instanceof jose.errors.JOSEError) {
    return true;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.startsWith('ERR_J');
}

export function mapStoreTokensError(error: unknown): HttpException {
  // 400 — bad / expired / tampered access token.
  if (
    isJoseCode(error, BAD_TOKEN_JOSE_CODES) ||
    messageIncludes(error, 'JWT') ||
    messageIncludes(error, 'Invalid JWT payload')
  ) {
    return new BadRequestException(BAD_TOKEN_MESSAGE);
  }

  // 502 — identity / JWKS / verification-infrastructure failure.
  if (
    isJoseCode(error, IDENTITY_JOSE_CODES) ||
    messageIncludes(error, 'JWKS fetch failed') ||
    isNetworkError(error) ||
    error instanceof SyntaxError
  ) {
    return new BadGatewayException(IDENTITY_MESSAGE);
  }

  // 502 — unknown jose error fallback.
  if (isUnknownJoseError(error)) {
    return new BadGatewayException(IDENTITY_MESSAGE);
  }

  // 500 — local persistence failure / truly unknown non-jose error.
  return new InternalServerErrorException(PERSIST_MESSAGE);
}
