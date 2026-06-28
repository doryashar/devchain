import { Inject, Injectable } from '@nestjs/common';
import { STORAGE_SERVICE, type StorageService } from '../../storage/interfaces/storage.interface';
import type {
  EpicAssignmentRule,
  CreateEpicAssignmentRule,
  UpdateEpicAssignmentRule,
} from '../../storage/models/domain.models';
import type { TeamsService } from '../../teams/services/teams.service';
import { NotFoundError, ValidationError } from '../../../common/errors/error-types';
import { createLogger } from '../../../common/logging/logger';

const logger = createLogger('AutoAssignRulesService');

export type AutoAssignSkipReason = 'no_match' | 'already_assigned' | 'stale_target' | 'no_lead';

export interface ResolveAssignmentInput {
  projectId: string;
  statusId: string;
  tags: readonly string[];
  currentAgentId: string | null;
}

export interface ResolveAssignmentResult {
  agentId: string | null;
  ruleId: string | null;
  skipped: AutoAssignSkipReason | null;
}

@Injectable()
export class AutoAssignRulesService {
  constructor(
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    private readonly teamsService: TeamsService,
  ) {}

  async resolveAssignment(
    input: ResolveAssignmentInput,
    _trigger: 'create' | 'status_change',
  ): Promise<ResolveAssignmentResult> {
    const rules = (await this.storage.listEpicAssignmentRules(input.projectId))
      .filter((r) => r.enabled)
      .sort((a, b) => a.priority - b.priority);

    let declineReason: AutoAssignSkipReason | null = null;

    for (const rule of rules) {
      if (!this.ruleMatches(rule, input)) continue;

      // Rule matches but declines if the epic is already assigned and this rule
      // doesn't override. Per spec §2.1 this is a *decline* — record the reason
      // and continue, so a later override:true rule can still win.
      if (input.currentAgentId !== null && !rule.overrideExisting) {
        if (!declineReason) declineReason = 'already_assigned';
        continue;
      }

      const resolved = await this.resolveTarget(rule);
      if (resolved.agentId === null) {
        if (resolved.reason && !declineReason) declineReason = resolved.reason;
        continue;
      }

      return { agentId: resolved.agentId, ruleId: rule.id, skipped: null };
    }

    return { agentId: null, ruleId: null, skipped: declineReason ?? 'no_match' };
  }

  private ruleMatches(rule: EpicAssignmentRule, input: ResolveAssignmentInput): boolean {
    if (rule.matchType === 'status') {
      return rule.statusId === input.statusId;
    }
    const ruleTags = rule.tags ?? [];
    return ruleTags.some((t) => input.tags.includes(t));
  }

  private async resolveTarget(
    rule: EpicAssignmentRule,
  ): Promise<{ agentId: string | null; reason?: AutoAssignSkipReason }> {
    if (rule.targetType === 'agent') {
      if (!rule.targetAgentId) return { agentId: null, reason: 'stale_target' };
      try {
        await this.storage.getAgent(rule.targetAgentId);
      } catch (error) {
        logger.warn({ ruleId: rule.id, agentId: rule.targetAgentId, error }, 'Stale target agent');
        return { agentId: null, reason: 'stale_target' };
      }
      return { agentId: rule.targetAgentId };
    }

    if (!rule.targetTeamId) return { agentId: null, reason: 'stale_target' };
    const team = await this.teamsService.getTeam(rule.targetTeamId).catch(() => null);
    if (!team) {
      logger.warn({ ruleId: rule.id, teamId: rule.targetTeamId }, 'Stale target team');
      return { agentId: null, reason: 'stale_target' };
    }
    if (!team.teamLeadAgentId) {
      logger.warn({ ruleId: rule.id, teamId: rule.targetTeamId }, 'Team has no lead');
      return { agentId: null, reason: 'no_lead' };
    }
    return { agentId: team.teamLeadAgentId };
  }

  async list(projectId: string): Promise<EpicAssignmentRule[]> {
    return this.storage.listEpicAssignmentRules(projectId);
  }

  async create(
    projectId: string,
    data: Omit<CreateEpicAssignmentRule, 'projectId' | 'priority'> & { priority?: number },
  ): Promise<EpicAssignmentRule> {
    await this.validateRuleReferences(projectId, data as CreateEpicAssignmentRule);
    const existing = await this.storage.listEpicAssignmentRules(projectId);
    const maxPriority = existing.reduce((max, r) => Math.max(max, r.priority), -1);
    return this.storage.createEpicAssignmentRule({
      projectId,
      matchType: data.matchType,
      statusId: data.statusId ?? null,
      tags: data.tags ?? null,
      targetType: data.targetType,
      targetAgentId: data.targetAgentId ?? null,
      targetTeamId: data.targetTeamId ?? null,
      overrideExisting: data.overrideExisting,
      enabled: data.enabled,
      priority: data.priority ?? maxPriority + 1,
    });
  }

  async update(id: string, data: UpdateEpicAssignmentRule): Promise<EpicAssignmentRule> {
    const existing = await this.storage.getEpicAssignmentRule(id);
    if (!existing) throw new NotFoundError('AutoAssignRule', id);
    const merged = { ...existing, ...data } as CreateEpicAssignmentRule;
    await this.validateRuleReferences(existing.projectId, merged);
    return this.storage.updateEpicAssignmentRule(id, data);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.storage.getEpicAssignmentRule(id);
    if (!existing) throw new NotFoundError('AutoAssignRule', id);
    return this.storage.deleteEpicAssignmentRule(id);
  }

  async reorder(projectId: string, items: Array<{ id: string; priority: number }>): Promise<void> {
    return this.storage.reorderEpicAssignmentRules(projectId, items);
  }

  private async validateRuleReferences(
    projectId: string,
    data: CreateEpicAssignmentRule,
  ): Promise<void> {
    if (data.matchType === 'status' && data.statusId) {
      const status = await this.storage.getStatus(data.statusId).catch(() => null);
      if (!status || status.projectId !== projectId) {
        throw new ValidationError('Referenced status does not belong to this project', {
          statusId: data.statusId,
        });
      }
    }
    if (data.targetType === 'team' && data.targetTeamId) {
      const team = await this.teamsService.getTeam(data.targetTeamId).catch(() => null);
      if (!team || team.projectId !== projectId) {
        throw new ValidationError('Referenced team does not belong to this project', {
          teamId: data.targetTeamId,
        });
      }
    }
    if (data.targetType === 'agent' && data.targetAgentId) {
      const agent = await this.storage.getAgent(data.targetAgentId).catch(() => null);
      if (!agent || agent.projectId !== projectId) {
        throw new ValidationError('Referenced agent does not belong to this project', {
          agentId: data.targetAgentId,
        });
      }
    }
  }
}
