import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AgentMessageDeliveryService } from '../../agent-message-delivery/agent-message-delivery.service';
import { getEventMetadata } from '../../events/services/events.service';
import { EventLogService } from '../../events/services/event-log.service';
import { SettingsService } from '../../settings/services/settings.service';
import { STORAGE_SERVICE, type StorageService } from '../../storage/interfaces/storage.interface';
import { TeamsService } from '../../teams/services/teams.service';
import { renderTemplate } from '../../../common/template/handlebars-renderer';
import type { Epic } from '../../storage/models/domain.models';
import type { EpicUpdatedEventPayload } from '../../events/catalog/epic.updated';
import type { EpicCreatedEventPayload } from '../../events/catalog/epic.created';

const TEMPLATE_SETTING_KEY = 'events.epicAssigned.template';
const DEFAULT_TEMPLATE =
  '[Epic Assignment]\n{epic_title} is now assigned to {agent_name} in {project_name}. (Epic ID: {epic_id})';

const LEGACY_VARIABLES = [
  'epic_id',
  'agent_name',
  'epic_title',
  'project_name',
  'assigner_name',
  'team_name',
  'team_names',
  'is_team_lead',
];

// Per-agent one-active-epic-at-a-time gate. An agent is ever only notified about
// LIMIT active epics; the rest stay queued (assignment_delivered_at IS NULL) and
// are auto-delivered by `pump()` when a currently-active epic is handed off or
// completed. See docs/dispatcher-agent.md (and the assignment_delivered_at column).
const MAX_CONCURRENT_EPICS_PER_AGENT = 1;

// Safety bound on the pump loop; each iteration marks one epic delivered, so the
// loop is naturally bounded by the queue size — this just guards against bugs.
const PUMP_MAX_ITERATIONS = 50;

@Injectable()
export class EpicAssignmentNotifierSubscriber {
  private readonly logger = new Logger(EpicAssignmentNotifierSubscriber.name);

  constructor(
    private readonly eventLogService: EventLogService,
    private readonly settingsService: SettingsService,
    private readonly messageDelivery: AgentMessageDeliveryService,
    private readonly teamsService: TeamsService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  @OnEvent('epic.created', { async: true })
  async handleEpicCreated(payload: EpicCreatedEventPayload): Promise<void> {
    // Only process if an agent is assigned on creation
    if (!payload.agentId) {
      return;
    }

    const metadata = getEventMetadata(payload);
    const eventId = metadata?.id;
    const handler = 'EpicAssignmentNotifier';
    const startedAt = new Date().toISOString();

    try {
      // Self-assignment: the agent already knows (it created the epic for itself).
      // Mark delivered so it counts toward their active set without a notification.
      if (payload.actor?.type === 'agent' && payload.actor.id === payload.agentId) {
        await this.storage.markAssignmentDelivered(payload.epicId);
        this.logger.debug(
          { actorId: payload.actor.id, epicId: payload.epicId },
          'Self-assignment on create; marked delivered, skipping notification',
        );
        await this.recordOk(eventId, handler, startedAt, { selfAssigned: true });
        return;
      }

      // Newly created epic is queued (assignment_delivered_at IS NULL). Pumping the
      // agent delivers it now if the agent is free, otherwise leaves it queued.
      const res = await this.pump(
        payload.agentId,
        payload.projectId,
        payload.actor,
        'epic.created',
      );
      await this.recordOk(eventId, handler, startedAt, {
        deliveredThisEpic: res.deliveredEpicId === payload.epicId,
      });
    } catch (error) {
      this.logger.error(
        { error, payload },
        'Failed to handle epic.created for assignment notification',
      );
      await this.recordFail(eventId, handler, startedAt, error);
    }
  }

  @OnEvent('epic.updated', { async: true })
  async handleEpicUpdated(payload: EpicUpdatedEventPayload): Promise<void> {
    const agentChange = payload.changes.agentId;
    const statusChange = payload.changes.statusId;
    if (!agentChange && !statusChange) {
      return;
    }

    const metadata = getEventMetadata(payload);
    const eventId = metadata?.id;
    const handler = 'EpicAssignmentNotifier';
    const startedAt = new Date().toISOString();

    try {
      let detail: Record<string, unknown> = {};

      if (agentChange) {
        const prev = agentChange.previous;
        const cur = agentChange.current;

        // Assign-in: a (new) agent is now responsible for this epic.
        if (cur !== null) {
          const selfAssignment = payload.actor?.type === 'agent' && payload.actor.id === cur;
          if (selfAssignment) {
            await this.storage.markAssignmentDelivered(payload.epicId);
            detail = { selfAssigned: true };
            this.logger.debug(
              { actorId: payload.actor!.id, epicId: payload.epicId },
              'Self-assignment on update; marked delivered, skipping notification',
            );
          } else {
            // Queue for the new agent: clear any marker left by a previous assignee
            // so `pump` can deliver it (now or when the agent frees up).
            await this.storage.clearAssignmentDelivered(payload.epicId);
            const res = await this.pump(cur, payload.projectId, payload.actor, 'epic.assigned');
            detail = { deliveredThisEpic: res.deliveredEpicId === payload.epicId };
          }
        }

        // Free-out: a previous agent may now have capacity. Pump them so a queued
        // epic (if any) gets delivered. Skip when prev === cur (no real change).
        if (prev !== null && prev !== cur) {
          await this.pump(prev, payload.projectId, payload.actor, 'epic.assigned');
          detail = { ...detail, pumpedPreviousAgent: true };
        }
      } else if (statusChange) {
        // Status changed without an agent change. The epic may have left the active
        // set (e.g. moved to a non-auto-clean "done" status), freeing the agent —
        // pump them so queued work can be delivered. (Moves to auto-clean statuses
        // also clear agent_id, which shows up as an agentChange above.)
        const epic = await this.storage.getEpic(payload.epicId).catch(() => null);
        if (epic?.agentId) {
          await this.pump(epic.agentId, payload.projectId, payload.actor, 'epic.assigned');
          detail = { statusChangePump: true };
        }
      }

      await this.recordOk(eventId, handler, startedAt, detail);
    } catch (error) {
      this.logger.error({ error, payload }, 'Failed to handle epic.updated for assignment');
      await this.recordFail(eventId, handler, startedAt, error);
    }
  }

  /**
   * Deliver queued assignment notifications to `agentId` until it has
   * MAX_CONCURRENT_EPICS_PER_AGENT active delivered epics, or the queue is empty.
   * Returns the id of the last epic it delivered (or null), so callers can report
   * whether the epic that triggered the pump was the one delivered.
   */
  private async pump(
    agentId: string,
    projectId: string,
    actor: { type: 'agent' | 'guest'; id: string } | null | undefined,
    source: string,
  ): Promise<{ deliveredEpicId: string | null }> {
    const terminalStatusIds = this.settingsService.getAutoCleanStatusIds(projectId);
    let deliveredEpicId: string | null = null;

    for (let i = 0; i < PUMP_MAX_ITERATIONS; i++) {
      const deliveredActive = await this.storage.countDeliveredActiveEpicsForAgent(
        agentId,
        projectId,
        terminalStatusIds,
      );
      if (deliveredActive >= MAX_CONCURRENT_EPICS_PER_AGENT) {
        break;
      }

      const next = await this.storage.findOldestUndeliveredActiveEpicForAgent(
        agentId,
        projectId,
        terminalStatusIds,
      );
      if (!next) {
        break;
      }

      try {
        await this.deliverAssignment(next, actor, source);
        await this.storage.markAssignmentDelivered(next.id);
        deliveredEpicId = next.id;
        this.logger.log({ agentId, epicId: next.id }, 'Delivered queued epic assignment to agent');
      } catch (error) {
        // Delivery failed — leave undelivered so a future pump retries. Stop here
        // to preserve FIFO order (don't deliver later epics before this one).
        this.logger.error(
          { error, agentId, epicId: next.id },
          'Failed to deliver queued epic assignment; leaving queued',
        );
        break;
      }
    }

    return { deliveredEpicId };
  }

  /** Render the [Epic Assignment] template for `epic` and deliver it to its agent. */
  private async deliverAssignment(
    epic: Epic,
    actor: { type: 'agent' | 'guest'; id: string } | null | undefined,
    source: string,
  ): Promise<void> {
    const [agent, project, assignerName, teamCtx] = await Promise.all([
      this.storage.getAgent(epic.agentId!).catch(() => null),
      this.storage.getProject(epic.projectId).catch(() => null),
      this.resolveActorName(actor),
      this.resolveTeamTemplateContext(epic.agentId!, epic.projectId),
    ]);

    const template = this.resolveTemplate();
    const message = renderTemplate(
      template,
      {
        epic_id: epic.id,
        agent_name: agent?.name ?? epic.agentId!,
        epic_title: epic.title,
        project_name: project?.name ?? epic.projectId,
        assigner_name: assignerName ?? 'System',
        ...teamCtx,
      },
      LEGACY_VARIABLES,
    );

    await this.messageDelivery.deliver(
      [epic.agentId!],
      {
        kind: 'pooled',
        body: message,
        source,
        projectId: epic.projectId,
        senderName: 'System',
      },
      { submitKeys: ['Enter'] },
    );
  }

  private async recordOk(
    eventId: string | undefined,
    handler: string,
    startedAt: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    if (!eventId) return;
    await this.eventLogService.recordHandledOk({
      eventId,
      handler,
      detail,
      startedAt,
      endedAt: new Date().toISOString(),
    });
  }

  private async recordFail(
    eventId: string | undefined,
    handler: string,
    startedAt: string,
    error: unknown,
  ): Promise<void> {
    if (!eventId) return;
    await this.eventLogService.recordHandledFail({
      eventId,
      handler,
      detail:
        error instanceof Error
          ? { message: error.message }
          : { message: 'Unknown error', value: String(error) },
      startedAt,
      endedAt: new Date().toISOString(),
    });
  }

  private resolveTemplate(): string {
    const raw = this.settingsService.getSetting(TEMPLATE_SETTING_KEY);
    if (!raw) {
      return DEFAULT_TEMPLATE;
    }

    const trimmed = raw.trim();
    if (!trimmed) {
      return DEFAULT_TEMPLATE;
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'string' && parsed.trim().length > 0) {
        return parsed.trim();
      }
    } catch {
      // Value is not JSON encoded, fall back to raw string
    }

    return trimmed;
  }

  /**
   * Resolves the name of the actor who triggered the event.
   */
  private async resolveActorName(
    actor: { type: 'agent' | 'guest'; id: string } | null | undefined,
  ): Promise<string | null> {
    if (!actor) {
      return null;
    }

    try {
      if (actor.type === 'agent') {
        const agent = await this.storage.getAgent(actor.id);
        return agent.name;
      } else if (actor.type === 'guest') {
        const guest = await this.storage.getGuest(actor.id);
        return guest.name;
      }
    } catch {
      return null;
    }

    return null;
  }

  private async resolveTeamTemplateContext(
    agentId: string,
    projectId: string,
  ): Promise<{ team_name: string; team_names: string; is_team_lead: boolean }> {
    const context = await this.teamsService.getRecipientContext(agentId, projectId);
    return {
      team_name: context.teamNames.length === 1 ? context.teamNames[0] : '',
      team_names: context.teamNames.join(', '),
      is_team_lead: context.isTeamLead,
    };
  }
}
