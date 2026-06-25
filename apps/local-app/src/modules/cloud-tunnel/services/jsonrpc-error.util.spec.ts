import { z } from 'zod';
import {
  toJsonRpcError,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_INTERNAL_ERROR,
} from './jsonrpc-error.util';
import {
  AppError,
  NotFoundError,
  ConflictError,
  ValidationError,
} from '../../../common/errors/error-types';

describe('toJsonRpcError', () => {
  it('maps a ZodError to -32602 with formatted details and a validation code', () => {
    const result = z.object({ id: z.string().uuid() }).safeParse({ id: 'not-a-uuid' });
    expect(result.success).toBe(false);
    const zodError = (result as { success: false; error: z.ZodError }).error;

    const rpc = toJsonRpcError(zodError);

    expect(rpc.code).toBe(JSON_RPC_INVALID_PARAMS);
    expect(rpc.message).toBe('Invalid params');
    expect(rpc.data?.code).toBe('validation_error');
    expect(rpc.data?.details).toBeDefined();
  });

  it('maps a validation AppError (status 400) to -32602 and preserves the domain code', () => {
    const rpc = toJsonRpcError(new ValidationError('bad input', { field: 'projectId' }));

    expect(rpc.code).toBe(JSON_RPC_INVALID_PARAMS);
    expect(rpc.message).toBe('bad input');
    expect(rpc.data).toEqual({ code: 'validation_error', details: { field: 'projectId' } });
  });

  it('maps a non-400 AppError to -32603 while keeping the domain code in data.code', () => {
    const rpc = toJsonRpcError(new NotFoundError('Session', 'abc'));

    expect(rpc.code).toBe(JSON_RPC_INTERNAL_ERROR);
    expect(rpc.message).toBe('Session with identifier abc not found');
    expect(rpc.data?.code).toBe('not_found');
  });

  it('carries structured AppError details under data.details', () => {
    const rpc = toJsonRpcError(new ConflictError('cannot restore', { code: 'PROVIDER_MISMATCH' }));

    expect(rpc.code).toBe(JSON_RPC_INTERNAL_ERROR);
    expect(rpc.data).toEqual({ code: 'conflict', details: { code: 'PROVIDER_MISMATCH' } });
  });

  it('omits data.details when an AppError has none', () => {
    const rpc = toJsonRpcError(new AppError('boom', 'session_not_running', 409));

    expect(rpc.data).toEqual({ code: 'session_not_running' });
    expect(rpc.data && 'details' in rpc.data).toBe(false);
  });

  it('flattens a plain Error to -32603 with no data', () => {
    const rpc = toJsonRpcError(new Error('unexpected'));

    expect(rpc).toEqual({ code: JSON_RPC_INTERNAL_ERROR, message: 'unexpected' });
  });

  it('flattens a non-Error throwable to -32603 with a generic message', () => {
    const rpc = toJsonRpcError('string failure');

    expect(rpc).toEqual({ code: JSON_RPC_INTERNAL_ERROR, message: 'Internal error' });
  });
});
