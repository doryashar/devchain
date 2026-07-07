/**
 * Characterization tests — EpicAssignmentNotifierSubscriber.
 *
 * Layer: backend-unit
 * Justification: direct subscriber tests with mocked storage/delivery
 * collaborators are the cheapest layer that locks notification text and the
 * per-agent one-at-a-time delivery pump.
 */

import { EpicAssignmentNotifierSubscriber } from './epic-assignment-notifier.subscriber';

const getEventMetadataMock = jest.fn();

jest.mock('../../events/services/events.service', () => ({
  getEventMetadata: (...args: unknown[]) => getEventMetadataMock(...args),
}));

describe('EpicAssignmentNotifierSubscriber characterization', () => {
  function createHarness() {
    const eventLog = {
      recordHandledOk: jest.fn().mockResolvedValue({ id: 'ok' }),
      recordHandledFail: jest.fn().mockResolvedValue({ id: 'fail' }),
    };
    const settings = {
      getSetting: jest.fn().mockReturnValue(undefined),
      getAutoCleanStatusIds: jest.fn().mockReturnValue([]),
    };
    const delivery = {
      deliver: jest.fn().mockResolvedValue({ status: 'queued', results: [] }),
    };
    const teams = {
      getRecipientContext: jest
        .fn()
        .mockResolvedValue({ isTeamLead: false, teamNames: [], memberRole: null }),
    };
    const storage = {
      getAgent: jest.fn().mockResolvedValue({ id: 'agent-1', name: 'Coder' }),
      getGuest: jest.fn().mockResolvedValue({ id: 'guest-1', name: 'Guest User' }),
      getProject: jest.fn().mockResolvedValue({ id: 'project-1', name: 'DevChain' }),
      getEpic: jest.fn().mockResolvedValue({ id: 'epic-1', title: 'Epic From Storage' }),
      countDeliveredActiveEpicsForAgent: jest.fn().mockResolvedValue(0),
      findOldestUndeliveredActiveEpicForAgent: jest.fn().mockResolvedValue(null),
      markAssignmentDelivered: jest.fn().mockResolvedValue(undefined),
      clearAssignmentDelivered: jest.fn().mockResolvedValue(undefined),
    };
    const subscriber = new EpicAssignmentNotifierSubscriber(
      eventLog as never,
      settings as never,
      delivery as never,
      teams as never,
      storage as never,
    );

    getEventMetadataMock.mockReturnValue({ id: 'event-1' });
    return { eventLog, settings, delivery, teams, storage, subscriber };
  }

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('delivers the queued epic when the agent is free (epic.created)', async () => {
    const { subscriber, delivery, storage, eventLog } = createHarness();
    // The pump finds epic-1 as the oldest undelivered queued epic for agent-1.
    storage.findOldestUndeliveredActiveEpicForAgent.mockResolvedValue({
      id: 'epic-1',
      projectId: 'project-1',
      title: 'Implement Characterization',
      statusId: 'status-1',
      agentId: 'agent-1',
      assignmentDeliveredAt: null,
    });

    await subscriber.handleEpicCreated({
      epicId: 'epic-1',
      projectId: 'project-1',
      title: 'Implement Characterization',
      statusId: 'status-1',
      agentId: 'agent-1',
      actor: { type: 'guest', id: 'guest-1' },
    } as never);

    expect(delivery.deliver).toHaveBeenCalledWith(
      ['agent-1'],
      {
        kind: 'pooled',
        body: '[Epic Assignment]\nImplement Characterization is now assigned to Coder in DevChain. (Epic ID: epic-1)',
        source: 'epic.created',
        projectId: 'project-1',
        senderName: 'System',
      },
      { submitKeys: ['Enter'] },
    );
    expect(storage.markAssignmentDelivered).toHaveBeenCalledWith('epic-1');
    expect(eventLog.recordHandledOk).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'event-1',
        handler: 'EpicAssignmentNotifier',
        detail: { deliveredThisEpic: true },
      }),
    );
  });

  it('does not deliver when the agent already has an active epic (queues silently)', async () => {
    const { subscriber, delivery, storage } = createHarness();
    // Agent is already at capacity (1 delivered active epic).
    storage.countDeliveredActiveEpicsForAgent.mockResolvedValue(1);

    await subscriber.handleEpicCreated({
      epicId: 'epic-2',
      projectId: 'project-1',
      title: 'Second Epic',
      statusId: 'status-1',
      agentId: 'agent-1',
      actor: { type: 'guest', id: 'guest-1' },
    } as never);

    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(storage.markAssignmentDelivered).not.toHaveBeenCalled();
    // The epic stays queued (no findOldest call since capacity check fails first).
    expect(storage.findOldestUndeliveredActiveEpicForAgent).not.toHaveBeenCalled();
  });

  it('marks self-assignment as delivered without notifying the agent', async () => {
    const { subscriber, delivery, storage, eventLog } = createHarness();

    await subscriber.handleEpicCreated({
      epicId: 'epic-1',
      projectId: 'project-1',
      title: 'Self Assigned',
      statusId: 'status-1',
      agentId: 'agent-1',
      actor: { type: 'agent', id: 'agent-1' },
    } as never);

    // No notification delivered, no pump lookups for queued work.
    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(storage.findOldestUndeliveredActiveEpicForAgent).not.toHaveBeenCalled();
    // ...but the epic is recorded as delivered (the agent already knows).
    expect(storage.markAssignmentDelivered).toHaveBeenCalledWith('epic-1');
    expect(eventLog.recordHandledOk).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { selfAssigned: true } }),
    );
  });

  it('pumps the previous agent when an epic is reassigned away from them', async () => {
    const { subscriber, storage } = createHarness();
    // For the new agent (agent-2): at capacity → no delivery.
    // For the previous agent (agent-1): pump should run and deliver their queued epic.
    storage.countDeliveredActiveEpicsForAgent
      .mockResolvedValueOnce(1) // agent-2 (new) at capacity
      .mockResolvedValueOnce(0) // agent-1 (previous) free
      .mockResolvedValueOnce(1); // agent-1 after delivering one (now at limit)
    storage.findOldestUndeliveredActiveEpicForAgent.mockResolvedValue({
      id: 'epic-old',
      projectId: 'project-1',
      title: 'Queued For Agent One',
      statusId: 'status-1',
      agentId: 'agent-1',
      assignmentDeliveredAt: null,
    });

    await subscriber.handleEpicUpdated({
      epicId: 'epic-9',
      projectId: 'project-1',
      parentId: null,
      version: 2,
      epicTitle: 'Reassigned Epic',
      actor: { type: 'guest', id: 'guest-1' },
      changes: {
        agentId: { previous: 'agent-1', current: 'agent-2' },
      },
    } as never);

    // Previous agent's queued epic was delivered + marked.
    expect(storage.markAssignmentDelivered).toHaveBeenCalledWith('epic-old');
    // The reassigned epic's prior marker was cleared (queued for agent-2).
    expect(storage.clearAssignmentDelivered).toHaveBeenCalledWith('epic-9');
  });
});
