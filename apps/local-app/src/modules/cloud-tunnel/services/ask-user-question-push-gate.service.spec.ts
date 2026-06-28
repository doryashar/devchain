import {
  AskUserQuestionPushGateService,
  AUQ_NATIVE_PUSH_GRACE_MS,
} from './ask-user-question-push-gate.service';
import { CloudSessionManagerService } from '../../cloud/services/cloud-session-manager.service';
import { EgressQueueService } from '../../cloud/services/egress-queue.service';
import { EventMapperService } from '../../cloud/services/event-mapper.service';
import { ProjectEgressConfigService } from '../../cloud/services/project-egress-config.service';
import { TunnelClientService } from './tunnel-client.service';
import type { ClaudeHooksAskUserQuestionPendingEventPayload } from '../../events/catalog/claude.hooks.ask_user_question.pending';

function makePayload(
  overrides: Partial<ClaudeHooksAskUserQuestionPendingEventPayload> = {},
): ClaudeHooksAskUserQuestionPendingEventPayload {
  return {
    projectId: '11111111-1111-1111-1111-111111111111',
    agentId: '22222222-2222-2222-2222-222222222222',
    sessionId: '33333333-3333-3333-3333-333333333333',
    claudeSessionId: 'claude-sess-1',
    toolUseId: 'tool-use-1',
    questions: [
      {
        question: 'Pick one',
        header: 'Choice',
        multiSelect: false,
        options: [{ label: 'A', description: '' }],
      },
    ],
    createdAt: 1,
    expiresAt: 2,
    ...overrides,
  };
}

describe('AskUserQuestionPushGateService', () => {
  let gate: AskUserQuestionPushGateService;
  let cloudSession: { getStatus: jest.Mock };
  let egressQueue: { enqueue: jest.Mock };
  let projectConfig: { isEnabled: jest.Mock };
  let tunnelClient: { querySseLiveness: jest.Mock; getInstanceId: jest.Mock };
  const eventMapper = new EventMapperService();

  beforeEach(() => {
    jest.useFakeTimers();
    cloudSession = {
      getStatus: jest.fn().mockReturnValue({ connected: true, userId: 'user-1' }),
    };
    egressQueue = { enqueue: jest.fn() };
    projectConfig = { isEnabled: jest.fn().mockReturnValue(true) };
    tunnelClient = {
      querySseLiveness: jest.fn().mockResolvedValue({ live: false, lastSeenAt: null }),
      getInstanceId: jest.fn().mockReturnValue('inst-1'),
    };

    gate = new AskUserQuestionPushGateService(
      cloudSession as unknown as CloudSessionManagerService,
      egressQueue as unknown as EgressQueueService,
      eventMapper,
      projectConfig as unknown as ProjectEgressConfigService,
      tunnelClient as unknown as TunnelClientService,
    );
  });

  afterEach(() => {
    gate.onModuleDestroy();
    jest.useRealTimers();
  });

  async function fireAndSettle(payload = makePayload()) {
    await gate.onPending(payload);
    jest.advanceTimersByTime(AUQ_NATIVE_PUSH_GRACE_MS);
    // Flush the async decide() chain (querySseLiveness + branch).
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  it('SUPPRESSES the native push when SSE is live (foreground)', async () => {
    tunnelClient.querySseLiveness.mockResolvedValue({ live: true, lastSeenAt: Date.now() });

    await fireAndSettle();

    expect(tunnelClient.querySseLiveness).toHaveBeenCalledTimes(1);
    expect(egressQueue.enqueue).not.toHaveBeenCalled();
  });

  it('ALLOWS the native push when SSE is down after the grace (background/closed)', async () => {
    tunnelClient.querySseLiveness.mockResolvedValue({ live: false, lastSeenAt: null });

    await fireAndSettle();

    expect(egressQueue.enqueue).toHaveBeenCalledTimes(1);
    const payload = egressQueue.enqueue.mock.calls[0][0];
    expect(payload.sourceEventType).toBe('claude.hooks.ask_user_question.pending');
    // Stable, question-scoped idempotency key.
    expect(payload.sourceEventId).toBe('auq.pending:tool-use-1');
    // Identifiers only — NEVER the question content.
    expect(payload.payload).toMatchObject({
      sessionId: '33333333-3333-3333-3333-333333333333',
      toolUseId: 'tool-use-1',
      instanceId: 'inst-1',
    });
    expect(payload.payload.questions).toBeUndefined();
  });

  it('does not query or enqueue before the grace window elapses', async () => {
    await gate.onPending(makePayload());
    jest.advanceTimersByTime(AUQ_NATIVE_PUSH_GRACE_MS - 1);
    await Promise.resolve();

    expect(tunnelClient.querySseLiveness).not.toHaveBeenCalled();
    expect(egressQueue.enqueue).not.toHaveBeenCalled();
  });

  it('skips entirely when the cloud session is disconnected', async () => {
    cloudSession.getStatus.mockReturnValue({ connected: false });
    await fireAndSettle();
    expect(tunnelClient.querySseLiveness).not.toHaveBeenCalled();
    expect(egressQueue.enqueue).not.toHaveBeenCalled();
  });

  it('skips when the project egress is disabled', async () => {
    projectConfig.isEnabled.mockReturnValue(false);
    await fireAndSettle();
    expect(egressQueue.enqueue).not.toHaveBeenCalled();
  });

  it('delivers native push (fail-open) when the liveness query throws', async () => {
    tunnelClient.querySseLiveness.mockRejectedValue(new Error('tunnel gone'));
    await fireAndSettle();
    expect(egressQueue.enqueue).toHaveBeenCalledTimes(1);
  });

  it('clears pending timers on destroy without firing', async () => {
    await gate.onPending(makePayload());
    gate.onModuleDestroy();
    jest.advanceTimersByTime(AUQ_NATIVE_PUSH_GRACE_MS * 2);
    await Promise.resolve();
    expect(tunnelClient.querySseLiveness).not.toHaveBeenCalled();
    expect(egressQueue.enqueue).not.toHaveBeenCalled();
  });
});
