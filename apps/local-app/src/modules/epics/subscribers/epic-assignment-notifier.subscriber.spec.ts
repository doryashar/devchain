import { EpicAssignmentNotifierSubscriber } from './epic-assignment-notifier.subscriber';
import type { AgentMessageDeliveryService } from '../../agent-message-delivery/agent-message-delivery.service';
import type { EventLogService } from '../../events/services/event-log.service';
import type { SettingsService } from '../../settings/services/settings.service';
import type { StorageService } from '../../storage/interfaces/storage.interface';
import type { TeamsService } from '../../teams/services/teams.service';

const getEventMetadataMock = jest.fn();

jest.mock('../../events/services/events.service', () => ({
  getEventMetadata: (...args: unknown[]) => getEventMetadataMock(...args),
}));

describe('EpicAssignmentNotifierSubscriber', () => {
  let eventLogService: { recordHandledOk: jest.Mock; recordHandledFail: jest.Mock };
  let settingsService: { getSetting: jest.Mock; getAutoCleanStatusIds: jest.Mock };
  let deliverMock: jest.Mock;
  let messageDelivery: AgentMessageDeliveryService;
  let getRecipientContextMock: jest.Mock;
  let teamsService: TeamsService;
  let getAgentMock: jest.Mock;
  let getProjectMock: jest.Mock;
  let countDeliveredMock: jest.Mock;
  let findOldestMock: jest.Mock;
  let markDeliveredMock: jest.Mock;
  let clearDeliveredMock: jest.Mock;
  let storageService: StorageService;
  let subscriber: EpicAssignmentNotifierSubscriber;

  // The pump delivers the oldest queued epic for the agent. By default the agent
  // is free (0 delivered active) and one epic is queued — so a delivery happens.
  const defaultQueuedEpic = {
    id: 'epic-1',
    projectId: 'project-1',
    title: 'Add Feature',
    description: null,
    statusId: 'status-1',
    parentId: null,
    agentId: 'agent-1',
    version: 2,
    data: null,
    skillsRequired: null,
    tags: [],
    assignmentDeliveredAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const basePayload = {
    epicId: 'epic-1',
    projectId: 'project-1',
    parentId: null,
    version: 2,
    epicTitle: 'Add Feature',
    projectName: 'Demo Project',
    recipientIds: ['agent-1'],
    changes: {
      agentId: {
        previous: null,
        current: 'agent-1',
        currentName: 'Helper Agent',
      },
    },
  } as const;

  beforeEach(() => {
    eventLogService = {
      recordHandledOk: jest.fn().mockResolvedValue({ id: 'handler-ok' }),
      recordHandledFail: jest.fn().mockResolvedValue({ id: 'handler-fail' }),
    };
    settingsService = {
      getSetting: jest.fn().mockReturnValue('[Epic Assignment]\n{epic_title} -> {agent_name}'),
      getAutoCleanStatusIds: jest.fn().mockReturnValue([]),
    };
    deliverMock = jest.fn().mockResolvedValue({ status: 'queued', results: [] });
    messageDelivery = { deliver: deliverMock } as unknown as AgentMessageDeliveryService;
    getRecipientContextMock = jest
      .fn()
      .mockResolvedValue({ isTeamLead: false, teamNames: [], memberRole: null });
    teamsService = { getRecipientContext: getRecipientContextMock } as unknown as TeamsService;
    getAgentMock = jest.fn().mockResolvedValue({ name: 'Helper Agent' });
    getProjectMock = jest.fn().mockResolvedValue({ name: 'Demo Project' });
    // Stateful pump simulation: agent is free until one epic is marked delivered,
    // after which it's at capacity and the queue is empty. Mirrors real behavior so
    // the pump delivers exactly one epic per trigger then stops.
    let delivered = false;
    countDeliveredMock = jest.fn().mockImplementation(() => Promise.resolve(delivered ? 1 : 0));
    findOldestMock = jest
      .fn()
      .mockImplementation(() => Promise.resolve(delivered ? null : defaultQueuedEpic));
    markDeliveredMock = jest.fn().mockImplementation(() => {
      delivered = true;
      return Promise.resolve(undefined);
    });
    clearDeliveredMock = jest.fn().mockImplementation(() => {
      delivered = false;
      return Promise.resolve(undefined);
    });
    storageService = {
      getAgent: getAgentMock,
      getProject: getProjectMock,
      getEpic: jest.fn(),
      getGuest: jest.fn(),
      countDeliveredActiveEpicsForAgent: countDeliveredMock,
      findOldestUndeliveredActiveEpicForAgent: findOldestMock,
      markAssignmentDelivered: markDeliveredMock,
      clearAssignmentDelivered: clearDeliveredMock,
    } as unknown as StorageService;
    getEventMetadataMock.mockReturnValue({ id: 'event-1' });

    subscriber = new EpicAssignmentNotifierSubscriber(
      eventLogService as unknown as EventLogService,
      settingsService as unknown as SettingsService,
      messageDelivery,
      teamsService,
      storageService,
    );
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('renders template placeholders and delivers epic.updated through the pump', async () => {
    await subscriber.handleEpicUpdated(basePayload);

    expect(deliverMock).toHaveBeenCalledWith(
      ['agent-1'],
      expect.objectContaining({
        kind: 'pooled',
        body: expect.stringContaining('Add Feature -> Helper Agent'),
        source: 'epic.assigned',
        projectId: 'project-1',
        senderName: 'System',
      }),
      { submitKeys: ['Enter'] },
    );
    expect(markDeliveredMock).toHaveBeenCalledWith('epic-1');
    expect(eventLogService.recordHandledOk).toHaveBeenCalledWith(
      expect.objectContaining({
        handler: 'EpicAssignmentNotifier',
        eventId: 'event-1',
        detail: { deliveredThisEpic: true },
      }),
    );
  });

  it('leaves the epic queued when AMD delivery throws (retries on next pump)', async () => {
    deliverMock.mockRejectedValue(new Error('delivery failure'));

    await subscriber.handleEpicUpdated(basePayload);

    // The pump caught the failure and left the epic undelivered for retry.
    expect(markDeliveredMock).not.toHaveBeenCalled();
    // The handler still records OK (the pump ran; the epic is queued, not failed).
    expect(eventLogService.recordHandledFail).not.toHaveBeenCalled();
  });

  it('fills names from storage when resolving the queued epic', async () => {
    settingsService.getSetting.mockReturnValue('{epic_title} -> {agent_name} ({project_name})');
    getAgentMock.mockResolvedValue({ name: 'Storage Agent' });
    getProjectMock.mockResolvedValue({ name: 'Storage Project' });

    await subscriber.handleEpicUpdated({
      epicId: 'epic-1',
      projectId: 'project-1',
      parentId: null,
      version: 2,
      epicTitle: 'Add Feature',
      projectName: undefined,
      changes: {
        agentId: { previous: null, current: 'agent-1' },
      },
    });

    expect(getAgentMock).toHaveBeenCalledWith('agent-1');
    expect(getProjectMock).toHaveBeenCalledWith('project-1');
    expect(deliverMock).toHaveBeenCalledWith(
      ['agent-1'],
      expect.objectContaining({
        body: 'Add Feature -> Storage Agent (Storage Project)',
      }),
      expect.any(Object),
    );
  });

  it('ignores events without assignment/status changes, and does not deliver on pure unassignment when nothing is queued', async () => {
    // title-only change → no agent/status change → ignored entirely
    await subscriber.handleEpicUpdated({
      epicId: 'epic-1',
      projectId: 'project-1',
      parentId: null,
      version: 2,
      epicTitle: 'Updated Title',
      changes: { title: { previous: 'Old Title', current: 'Updated Title' } },
    });

    // Pure unassignment (A → null): pumps previous agent, but nothing queued → no delivery.
    findOldestMock.mockResolvedValue(null);
    await subscriber.handleEpicUpdated({
      epicId: 'epic-1',
      projectId: 'project-1',
      parentId: null,
      version: 2,
      epicTitle: 'Add Feature',
      changes: {
        agentId: { previous: 'agent-1', current: null, previousName: 'Helper Agent' },
      },
    });

    expect(deliverMock).not.toHaveBeenCalled();
  });

  it('skips self-assignment but delivers same-agent reassignment by another actor', async () => {
    // Self-assignment: actor is the assignee → mark delivered, no notification.
    await subscriber.handleEpicUpdated({
      epicId: 'epic-1',
      projectId: 'project-1',
      parentId: null,
      version: 2,
      epicTitle: 'Self Assignment',
      actor: { type: 'agent' as const, id: 'agent-1' },
      changes: {
        agentId: { previous: null, current: 'agent-1', currentName: 'Helper Agent' },
      },
    });
    expect(deliverMock).not.toHaveBeenCalled();
    expect(markDeliveredMock).toHaveBeenCalledWith('epic-1');

    // Same-agent reassignment by ANOTHER actor (agent-2): not self-assignment → pump + deliver.
    await subscriber.handleEpicUpdated({
      epicId: 'epic-1',
      projectId: 'project-1',
      parentId: null,
      version: 2,
      epicTitle: 'Re-assigned Epic',
      actor: { type: 'agent' as const, id: 'agent-2' },
      changes: {
        agentId: { previous: 'agent-1', current: 'agent-1', currentName: 'Coder' },
      },
    });

    expect(deliverMock).toHaveBeenCalledTimes(1);
    expect(deliverMock).toHaveBeenCalledWith(
      ['agent-1'],
      expect.objectContaining({ source: 'epic.assigned' }),
      expect.any(Object),
    );
  });

  it('delivers epic.created assignments to the assignee via the pump', async () => {
    findOldestMock.mockResolvedValue({ ...defaultQueuedEpic, title: 'New Epic' });

    await subscriber.handleEpicCreated({
      epicId: 'epic-1',
      projectId: 'project-1',
      title: 'New Epic',
      epicTitle: 'New Epic',
      statusId: 'status-1',
      agentId: 'agent-1',
      actor: { type: 'agent' as const, id: 'agent-2' },
      projectName: 'Demo Project',
      agentName: 'Helper Agent',
    });

    expect(deliverMock).toHaveBeenCalledWith(
      ['agent-1'],
      expect.objectContaining({
        body: '[Epic Assignment]\nNew Epic -> Helper Agent',
        source: 'epic.created',
      }),
      { submitKeys: ['Enter'] },
    );
  });

  describe('team variables', () => {
    it('default template renders without stray team text for teamless agent', async () => {
      settingsService.getSetting.mockReturnValue(null);

      await subscriber.handleEpicUpdated(basePayload);

      expect(deliverMock.mock.calls[0][1].body).toBe(
        '[Epic Assignment]\nAdd Feature is now assigned to Helper Agent in Demo Project. (Epic ID: epic-1)',
      );
    });

    it('custom template resolves team variables from TeamsService.getRecipientContext', async () => {
      settingsService.getSetting.mockReturnValue(
        '{{#if is_team_lead}}LEAD{{else}}MEMBER{{/if}} {team_name}/{team_names}: {epic_title}',
      );
      getRecipientContextMock.mockResolvedValue({
        isTeamLead: true,
        teamNames: ['Backend'],
        memberRole: 'lead',
      });

      await subscriber.handleEpicUpdated(basePayload);

      expect(getRecipientContextMock).toHaveBeenCalledWith('agent-1', 'project-1');
      expect(deliverMock.mock.calls[0][1].body).toBe('LEAD Backend/Backend: Add Feature');
    });

    it('unknown literal tokens are preserved and legacy/native tokens both render', async () => {
      settingsService.getSetting.mockReturnValue('{some_literal} {agent_name} / {{epic_title}}');

      await subscriber.handleEpicUpdated(basePayload);

      expect(deliverMock.mock.calls[0][1].body).toBe('{some_literal} Helper Agent / Add Feature');
    });
  });
});
