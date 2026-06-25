import { ZodError } from 'zod';
import { AppError } from '../../../common/errors/error-types';

/**
 * Shared JSON-RPC error shape used by the cloud tunnel.
 *
 * The top-level `code` stays within the JSON-RPC reserved range so generic
 * clients keep working, while the *domain* error code (e.g. `not_found`,
 * `conflict`, `validation_error`, or a `chat.*` specific code such as
 * `SESSION_NOT_RUNNING`) is preserved under `data.code`. This lets mobile
 * surface actionable errors instead of every failure flattening to `-32603`.
 */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: { code: string; details?: unknown };
}

/** JSON-RPC 2.0 reserved error codes (subset used by the tunnel). */
export const JSON_RPC_INVALID_PARAMS = -32602;
export const JSON_RPC_INTERNAL_ERROR = -32603;

/**
 * Map an `AppError` to a JSON-RPC code. Validation failures map to the
 * dedicated `-32602` ("Invalid params"); every other domain error keeps
 * `-32603` at the JSON-RPC layer with the precise reason carried in `data.code`.
 */
function appErrorToRpcCode(err: AppError): number {
  return err.statusCode === 400 ? JSON_RPC_INVALID_PARAMS : JSON_RPC_INTERNAL_ERROR;
}

/**
 * Convert any thrown value into a JSON-RPC `error` object.
 *
 * - `ZodError` → `-32602` with the formatted issues under `data.details`.
 * - `AppError` → mapped code + `data.code` (domain code) + optional `data.details`.
 * - anything else → `-32603` with the error message (no `data`).
 */
export function toJsonRpcError(err: unknown): JsonRpcError {
  if (err instanceof ZodError) {
    return {
      code: JSON_RPC_INVALID_PARAMS,
      message: 'Invalid params',
      data: { code: 'validation_error', details: err.format() },
    };
  }

  if (err instanceof AppError) {
    const data: JsonRpcError['data'] = { code: err.code };
    if (err.details !== undefined) {
      data.details = err.details;
    }
    return { code: appErrorToRpcCode(err), message: err.message, data };
  }

  return {
    code: JSON_RPC_INTERNAL_ERROR,
    message: err instanceof Error ? err.message : 'Internal error',
  };
}
