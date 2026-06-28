import { AutoAssignRulesService } from './auto-assign-rules.service';
import type { StorageService } from '../../storage/interfaces/storage.interface';
import type { TeamsService } from '../../teams/services/teams.service';
import type { EpicAssignmentRule } from '../../storage/models/domain.models';

function createMockStorage(rules: EpicAssignmentRule[]) {
  return {
    listEpicAssignmentRules: jest.fn().mockResolvedValue(rules),
    getEpicAssignmentRule: jest.fn(),
    createEpicAssignmentRule: jest.fn(),
    updateEpicAssignmentRule: jest.fn(),
    deleteEpicAssignmentRule: jest.fn(),
    reorderEpicAssignmentRules: jest.fn(),
    getStatus: jest.fn(),
    getAgent: jest.fn(),
  };
}

function createMockTeamsService(
  teamById: Record<string, { id: string; teamLeadAgentId: string | null }>,
) {
  return {
    getTeam: jest.fn(async (id: string) => teamById[id] ?? null),
    listTeams: jest.fn(),
  };
}

describe('AutoAssignRulesService.resolveAssignment', () => {
  const baseInput = {
    projectId: 'p',
    statusId: 'st-1',
    tags: [] as string[],
    currentAgentId: null,
  };

  it('returns the agent of the first matching status rule (priority order)', async () => {
    const storage = createMockStorage([
      {
        id: 'r1',
        projectId: 'p',
        matchType: 'status',
        statusId: 'st-1',
        tags: null,
        targetType: 'agent',
        targetAgentId: 'ag-A',
        targetTeamId: null,
        overrideExisting: false,
        priority: 10,
        enabled: true,
      },
    ]);
    const svc = new AutoAssignRulesService(
      storage as unknown as StorageService,
      createMockTeamsService({}) as unknown as TeamsService,
    );
    const res = await svc.resolveAssignment({ ...baseInput }, 'create');
    expect(res).toEqual({ agentId: 'ag-A', ruleId: 'r1', skipped: null });
  });

  it('matches a tag rule when epic has any of the rule tags', async () => {
    const storage = createMockStorage([
      {
        id: 'r1',
        projectId: 'p',
        matchType: 'tag',
        statusId: null,
        tags: ['frontend', 'ui'],
        targetType: 'agent',
        targetAgentId: 'ag-FE',
        targetTeamId: null,
        overrideExisting: false,
        priority: 0,
        enabled: true,
      },
    ]);
    const svc = new AutoAssignRulesService(
      storage as unknown as StorageService,
      createMockTeamsService({}) as unknown as TeamsService,
    );
    const res = await svc.resolveAssignment(
      { ...baseInput, tags: ['ui'], statusId: 'other' },
      'create',
    );
    expect(res.agentId).toBe('ag-FE');
  });

  it('declines when epic already assigned and overrideExisting is false', async () => {
    const storage = createMockStorage([
      {
        id: 'r1',
        projectId: 'p',
        matchType: 'status',
        statusId: 'st-1',
        tags: null,
        targetType: 'agent',
        targetAgentId: 'ag-A',
        targetTeamId: null,
        overrideExisting: false,
        priority: 0,
        enabled: true,
      },
    ]);
    const svc = new AutoAssignRulesService(
      storage as unknown as StorageService,
      createMockTeamsService({}) as unknown as TeamsService,
    );
    const res = await svc.resolveAssignment(
      { ...baseInput, currentAgentId: 'ag-existing' },
      'status_change',
    );
    expect(res).toEqual({ agentId: null, ruleId: null, skipped: 'already_assigned' });
  });

  it('overrides when overrideExisting is true', async () => {
    const storage = createMockStorage([
      {
        id: 'r1',
        projectId: 'p',
        matchType: 'status',
        statusId: 'st-1',
        tags: null,
        targetType: 'agent',
        targetAgentId: 'ag-A',
        targetTeamId: null,
        overrideExisting: true,
        priority: 0,
        enabled: true,
      },
    ]);
    const svc = new AutoAssignRulesService(
      storage as unknown as StorageService,
      createMockTeamsService({}) as unknown as TeamsService,
    );
    const res = await svc.resolveAssignment(
      { ...baseInput, currentAgentId: 'old' },
      'status_change',
    );
    expect(res.agentId).toBe('ag-A');
  });

  it('resolves a team target to the team lead', async () => {
    const storage = createMockStorage([
      {
        id: 'r1',
        projectId: 'p',
        matchType: 'status',
        statusId: 'st-1',
        tags: null,
        targetType: 'team',
        targetAgentId: null,
        targetTeamId: 'team-1',
        overrideExisting: false,
        priority: 0,
        enabled: true,
      },
    ]);
    const teams = createMockTeamsService({ 'team-1': { id: 'team-1', teamLeadAgentId: 'lead-1' } });
    const svc = new AutoAssignRulesService(
      storage as unknown as StorageService,
      teams as unknown as TeamsService,
    );
    const res = await svc.resolveAssignment({ ...baseInput }, 'create');
    expect(res).toEqual({ agentId: 'lead-1', ruleId: 'r1', skipped: null });
  });

  it('declines a team rule when the team has no lead', async () => {
    const storage = createMockStorage([
      {
        id: 'r1',
        projectId: 'p',
        matchType: 'status',
        statusId: 'st-1',
        tags: null,
        targetType: 'team',
        targetAgentId: null,
        targetTeamId: 'team-1',
        overrideExisting: false,
        priority: 0,
        enabled: true,
      },
    ]);
    const teams = createMockTeamsService({ 'team-1': { id: 'team-1', teamLeadAgentId: null } });
    const svc = new AutoAssignRulesService(
      storage as unknown as StorageService,
      teams as unknown as TeamsService,
    );
    const res = await svc.resolveAssignment({ ...baseInput }, 'create');
    expect(res).toEqual({ agentId: null, ruleId: null, skipped: 'no_lead' });
  });

  it('declines a team rule when the team no longer exists (stale)', async () => {
    const storage = createMockStorage([
      {
        id: 'r1',
        projectId: 'p',
        matchType: 'status',
        statusId: 'st-1',
        tags: null,
        targetType: 'team',
        targetAgentId: null,
        targetTeamId: 'team-x',
        overrideExisting: false,
        priority: 0,
        enabled: true,
      },
    ]);
    const svc = new AutoAssignRulesService(
      storage as unknown as StorageService,
      createMockTeamsService({}) as unknown as TeamsService,
    );
    const res = await svc.resolveAssignment({ ...baseInput }, 'create');
    expect(res).toEqual({ agentId: null, ruleId: null, skipped: 'stale_target' });
  });

  it('returns no_match when no rules apply', async () => {
    const storage = createMockStorage([
      {
        id: 'r1',
        projectId: 'p',
        matchType: 'status',
        statusId: 'other',
        tags: null,
        targetType: 'agent',
        targetAgentId: 'ag-A',
        targetTeamId: null,
        overrideExisting: false,
        priority: 0,
        enabled: true,
      },
    ]);
    const svc = new AutoAssignRulesService(
      storage as unknown as StorageService,
      createMockTeamsService({}) as unknown as TeamsService,
    );
    const res = await svc.resolveAssignment({ ...baseInput, statusId: 'st-1' }, 'create');
    expect(res).toEqual({ agentId: null, ruleId: null, skipped: 'no_match' });
  });

  it('skips disabled rules', async () => {
    const storage = createMockStorage([
      {
        id: 'r1',
        projectId: 'p',
        matchType: 'status',
        statusId: 'st-1',
        tags: null,
        targetType: 'agent',
        targetAgentId: 'ag-A',
        targetTeamId: null,
        overrideExisting: false,
        priority: 0,
        enabled: false,
      },
    ]);
    const svc = new AutoAssignRulesService(
      storage as unknown as StorageService,
      createMockTeamsService({}) as unknown as TeamsService,
    );
    const res = await svc.resolveAssignment({ ...baseInput }, 'create');
    expect(res.skipped).toBe('no_match');
  });

  it('picks the first winning rule in priority order when several match', async () => {
    const storage = createMockStorage([
      {
        id: 'r-low',
        projectId: 'p',
        matchType: 'status',
        statusId: 'st-1',
        tags: null,
        targetType: 'agent',
        targetAgentId: 'ag-LOW',
        targetTeamId: null,
        overrideExisting: false,
        priority: 1,
        enabled: true,
      },
      {
        id: 'r-high',
        projectId: 'p',
        matchType: 'status',
        statusId: 'st-1',
        tags: null,
        targetType: 'agent',
        targetAgentId: 'ag-HIGH',
        targetTeamId: null,
        overrideExisting: false,
        priority: 0,
        enabled: true,
      },
    ]);
    const svc = new AutoAssignRulesService(
      storage as unknown as StorageService,
      createMockTeamsService({}) as unknown as TeamsService,
    );
    const res = await svc.resolveAssignment({ ...baseInput }, 'create');
    expect(res.ruleId).toBe('r-high');
  });
});

describe('AutoAssignRulesService CRUD', () => {
  it('create assigns priority = max+1 when caller omits it', async () => {
    const storage = createMockStorage([]);
    storage.listEpicAssignmentRules = jest.fn().mockResolvedValue([
      {
        id: 'a',
        projectId: 'p',
        matchType: 'tag',
        statusId: null,
        tags: ['x'],
        targetType: 'agent',
        targetAgentId: 'a',
        targetTeamId: null,
        overrideExisting: false,
        priority: 3,
        enabled: true,
        createdAt: '',
        updatedAt: '',
      },
    ]);
    storage.createEpicAssignmentRule = jest.fn().mockResolvedValue({ id: 'new' });
    const svc = new AutoAssignRulesService(
      storage as unknown as StorageService,
      createMockTeamsService({}) as unknown as TeamsService,
    );
    await svc.create('p', {
      matchType: 'tag',
      statusId: null,
      tags: ['y'],
      targetType: 'agent',
      targetAgentId: 'b',
      targetTeamId: null,
      overrideExisting: false,
      enabled: true,
    });
    expect(storage.createEpicAssignmentRule).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 4 }),
    );
  });

  it('reorder delegates to storage with projectId guard', async () => {
    const storage = createMockStorage([]);
    const svc = new AutoAssignRulesService(
      storage as unknown as StorageService,
      createMockTeamsService({}) as unknown as TeamsService,
    );
    await svc.reorder('p', [{ id: 'r1', priority: 0 }]);
    expect(storage.reorderEpicAssignmentRules).toHaveBeenCalledWith('p', [
      { id: 'r1', priority: 0 },
    ]);
  });
});
