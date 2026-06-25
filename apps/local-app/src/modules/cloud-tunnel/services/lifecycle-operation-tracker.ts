import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export type LifecycleOperationType = 'launch' | 'restart' | 'restore';
export type LifecycleOperationStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface LifecycleOperation {
  operationId: string;
  type: LifecycleOperationType;
  agentId: string | null;
  sessionId: string | null;
  projectId: string;
  status: LifecycleOperationStatus;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

const MAX_OPERATIONS = 500;

/**
 * In-memory tracker for async session lifecycle operations (launch / restart /
 * restore) that can exceed the bridge relay timeout. The mobile client gets an
 * `operationId` immediately and polls `chat.getOperationStatus` until the op
 * succeeds/fails — presence alone can't distinguish "still launching" from
 * "failed before presence changed".
 *
 * **Non-durable:** state lives only in this process and is cleared on local-app
 * restart. In-flight operationIds become unknown after a restart; clients fall
 * back to presence/agent status. A bounded LRU-ish cap prevents unbounded growth.
 */
@Injectable()
export class LifecycleOperationTracker {
  private readonly operations = new Map<string, LifecycleOperation>();

  create(input: {
    type: LifecycleOperationType;
    projectId: string;
    agentId?: string | null;
    sessionId?: string | null;
  }): LifecycleOperation {
    const now = new Date().toISOString();
    const op: LifecycleOperation = {
      operationId: randomUUID(),
      type: input.type,
      agentId: input.agentId ?? null,
      sessionId: input.sessionId ?? null,
      projectId: input.projectId,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    this.operations.set(op.operationId, op);
    this.evictIfNeeded();
    return op;
  }

  markRunning(operationId: string): void {
    this.patch(operationId, { status: 'running' });
  }

  /** Mark succeeded, optionally recording the resulting session id. */
  succeed(operationId: string, sessionId?: string | null): void {
    this.patch(operationId, {
      status: 'succeeded',
      ...(sessionId ? { sessionId } : {}),
    });
  }

  fail(operationId: string, errorCode: string, errorMessage: string): void {
    this.patch(operationId, { status: 'failed', errorCode, errorMessage });
  }

  get(operationId: string): LifecycleOperation | undefined {
    return this.operations.get(operationId);
  }

  /** Most recently created operation for an agent, if any (for per-agent status). */
  latestForAgent(agentId: string): LifecycleOperation | undefined {
    let latest: LifecycleOperation | undefined;
    for (const op of this.operations.values()) {
      if (op.agentId === agentId && (!latest || op.createdAt >= latest.createdAt)) {
        latest = op;
      }
    }
    return latest;
  }

  private patch(operationId: string, fields: Partial<LifecycleOperation>): void {
    const existing = this.operations.get(operationId);
    if (!existing) return;
    this.operations.set(operationId, {
      ...existing,
      ...fields,
      updatedAt: new Date().toISOString(),
    });
  }

  private evictIfNeeded(): void {
    while (this.operations.size > MAX_OPERATIONS) {
      const oldest = this.operations.keys().next().value;
      if (oldest === undefined) break;
      this.operations.delete(oldest);
    }
  }
}
