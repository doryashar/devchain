import { LifecycleOperationTracker } from './lifecycle-operation-tracker';

describe('LifecycleOperationTracker', () => {
  it('creates a pending op with a unique id and timestamps', () => {
    const tracker = new LifecycleOperationTracker();
    const a = tracker.create({ type: 'launch', projectId: 'p1', agentId: 'a1' });
    const b = tracker.create({ type: 'restart', projectId: 'p1', agentId: 'a2' });

    expect(a.operationId).not.toBe(b.operationId);
    expect(a).toMatchObject({ type: 'launch', projectId: 'p1', agentId: 'a1', status: 'pending' });
    expect(a.sessionId).toBeNull();
    expect(a.createdAt).toEqual(a.updatedAt);
  });

  it('transitions running → succeeded and records the session id', () => {
    const tracker = new LifecycleOperationTracker();
    const op = tracker.create({ type: 'launch', projectId: 'p1', agentId: 'a1' });

    tracker.markRunning(op.operationId);
    expect(tracker.get(op.operationId)?.status).toBe('running');

    tracker.succeed(op.operationId, 'sess-9');
    expect(tracker.get(op.operationId)).toMatchObject({ status: 'succeeded', sessionId: 'sess-9' });
  });

  it('records failure code + message', () => {
    const tracker = new LifecycleOperationTracker();
    const op = tracker.create({ type: 'restore', projectId: 'p1', sessionId: 's1' });

    tracker.fail(op.operationId, 'PROVIDER_MISMATCH', 'provider changed');

    expect(tracker.get(op.operationId)).toMatchObject({
      status: 'failed',
      errorCode: 'PROVIDER_MISMATCH',
      errorMessage: 'provider changed',
    });
  });

  it('returns undefined for an unknown id and ignores updates to it', () => {
    const tracker = new LifecycleOperationTracker();
    expect(tracker.get('missing')).toBeUndefined();
    expect(() => tracker.succeed('missing')).not.toThrow();
  });

  it('latestForAgent returns the most recent op for an agent', () => {
    const tracker = new LifecycleOperationTracker();
    tracker.create({ type: 'launch', projectId: 'p1', agentId: 'a1' });
    const second = tracker.create({ type: 'restart', projectId: 'p1', agentId: 'a1' });
    tracker.create({ type: 'launch', projectId: 'p1', agentId: 'other' });

    expect(tracker.latestForAgent('a1')?.operationId).toBe(second.operationId);
    expect(tracker.latestForAgent('nope')).toBeUndefined();
  });
});
