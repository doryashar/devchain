import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { ExportSchema } from '@devchain/shared';

interface TemplateAgent {
  name: string;
  profileId: string;
  providerConfigName: string;
  modelOverride: string | null;
}

interface ProviderConfig {
  name: string;
  providerName: string;
  options: string | null;
}

interface ProjectTemplate {
  profiles: Array<{
    id: string;
    providerConfigs: ProviderConfig[];
  }>;
  agents: TemplateAgent[];
}

const EXPECTED_MODEL = 'zai-coding-plan/glm-5.2';
const EXPECTED_PROVIDER = 'opencode';

function loadTemplates(): Array<{ file: string; template: ProjectTemplate }> {
  const templatesDir = resolve(__dirname, '../../templates');
  return readdirSync(templatesDir)
    .filter((f) => f.endsWith('.json'))
    .map((file) => ({
      file,
      template: JSON.parse(readFileSync(resolve(templatesDir, file), 'utf-8')) as ProjectTemplate,
    }));
}

describe('shipped template default agents', () => {
  const templates = loadTemplates();

  it('found the expected template files', () => {
    expect(templates.map((t) => t.file).sort()).toEqual(
      expect.arrayContaining(['3-agents-dev.json', 'teams-dev.json']),
    );
  });

  for (const { file, template } of templates) {
    describe(file, () => {
      it('every default agent uses opencode with glm-5.2', () => {
        for (const agent of template.agents) {
          expect(agent.providerConfigName).toBe(EXPECTED_PROVIDER);
          expect(agent.modelOverride).toBe(EXPECTED_MODEL);
        }
      });

      it('every default agent resolves to a profile opencode config offering glm-5.2', () => {
        for (const agent of template.agents) {
          const profile = template.profiles.find((p) => p.id === agent.profileId);
          expect(profile).toBeDefined();

          const opencodeCfg = profile!.providerConfigs.find(
            (c) => c.name === EXPECTED_PROVIDER && c.providerName === EXPECTED_PROVIDER,
          );
          expect(opencodeCfg).toBeDefined();
          expect(opencodeCfg!.options).toContain(EXPECTED_MODEL);
        }
      });
    });
  }

  describe('Dispatcher in teams-dev.json', () => {
    const teamsDev = templates.find((t) => t.file === 'teams-dev.json');
    if (!teamsDev) throw new Error('teams-dev.json not found');

    it('passes ExportSchema.parse', () => {
      const result = ExportSchema.safeParse(teamsDev.template);
      expect(result.success).toBe(true);
      if (!result.success) {
        console.error(result.error.issues);
      }
    });

    it('has a Dispatch status at position 1, mcpHidden false, not in autoCleanStatusLabels', () => {
      const dispatch = (teamsDev.template as any).statuses.find((s: any) => s.label === 'Dispatch');
      expect(dispatch).toBeDefined();
      expect(dispatch.position).toBe(1);
      expect(dispatch.mcpHidden).toBe(false);
      const autoClean = (teamsDev.template as any).projectSettings?.autoCleanStatusLabels ?? [];
      expect(autoClean).not.toContain('Dispatch');
    });

    it('has a standalone Dispatcher agent + profile with the SOP prompt', () => {
      const agent = (teamsDev.template as any).agents.find((a: any) => a.name === 'Dispatcher');
      expect(agent).toBeDefined();
      const profile = (teamsDev.template as any).profiles.find((p: any) => p.name === 'Dispatcher');
      expect(profile).toBeDefined();
      expect(profile.familySlug).toBe('dispatcher');
      expect(profile.instructions).toBe('[[prompt:Dispatcher — Intake & Triage SOP]]');
      const prompt = (teamsDev.template as any).prompts.find(
        (p: any) => p.title === 'Dispatcher — Intake & Triage SOP',
      );
      expect(prompt).toBeDefined();
      const teams = (teamsDev.template as any).teams ?? [];
      for (const team of teams) {
        expect(team.memberAgentNames).not.toContain('Dispatcher');
        expect(team.teamLeadAgentName).not.toBe('Dispatcher');
      }
    });

    it('ships a Dispatch → Dispatcher auto-assign rule', () => {
      const rules = (teamsDev.template as any).autoAssignRules ?? [];
      const dispatchRule = rules.find(
        (r: any) =>
          r.matchType === 'status' &&
          r.statusLabel === 'Dispatch' &&
          r.targetType === 'agent' &&
          r.targetAgentName === 'Dispatcher',
      );
      expect(dispatchRule).toBeDefined();
    });

    it('every preset agentConfig references a providerConfig that exists on the agent profile', () => {
      const t = teamsDev.template as any;
      const profilesById = new Map((t.profiles as any[]).map((p) => [p.id, p]));
      for (const preset of t.presets ?? []) {
        for (const cfg of preset.agentConfigs) {
          const agent = (t.agents as any[]).find((a) => a.name === cfg.agentName);
          if (!agent) throw new Error(`agent ${cfg.agentName} not found (preset "${preset.name}")`);
          const profile = profilesById.get(agent.profileId);
          if (!profile)
            throw new Error(`profile for ${cfg.agentName} not found (preset "${preset.name}")`);
          const configNames = (profile.providerConfigs as any[]).map((c) => c.name);
          if (!configNames.includes(cfg.providerConfigName)) {
            throw new Error(
              `preset "${preset.name}" references "${cfg.providerConfigName}" for ${cfg.agentName}, ` +
                `available: [${configNames.join(', ')}]`,
            );
          }
        }
      }
    });

    it('has statuses with contiguous positions starting at 0, no gaps or duplicates', () => {
      const positions = ((teamsDev.template as any).statuses as any[])
        .map((s) => s.position)
        .sort((a, b) => a - b);
      expect(positions).toEqual(positions.map((_, i) => i));
    });
  });

  describe('Dispatcher in 3-agents-dev.json', () => {
    const threeAgents = templates.find((t) => t.file === '3-agents-dev.json');
    if (!threeAgents) throw new Error('3-agents-dev.json not found');

    it('passes ExportSchema.parse', () => {
      const result = ExportSchema.safeParse(threeAgents.template);
      expect(result.success).toBe(true);
      if (!result.success) {
        console.error(result.error.issues);
      }
    });

    it('has a Dispatch status at position 1, mcpHidden false, not in autoCleanStatusLabels', () => {
      const dispatch = (threeAgents.template as any).statuses.find(
        (s: any) => s.label === 'Dispatch',
      );
      expect(dispatch).toBeDefined();
      expect(dispatch.position).toBe(1);
      expect(dispatch.mcpHidden).toBe(false);
      const autoClean = (threeAgents.template as any).projectSettings?.autoCleanStatusLabels ?? [];
      expect(autoClean).not.toContain('Dispatch');
    });

    it('has statuses with contiguous positions starting at 0, no gaps or duplicates', () => {
      const positions = ((threeAgents.template as any).statuses as any[])
        .map((s) => s.position)
        .sort((a: number, b: number) => a - b);
      expect(positions).toEqual(positions.map((_, i) => i));
    });

    it('has a Dispatcher agent + profile + SOP prompt', () => {
      const agent = (threeAgents.template as any).agents.find((a: any) => a.name === 'Dispatcher');
      expect(agent).toBeDefined();
      const profile = (threeAgents.template as any).profiles.find(
        (p: any) => p.name === 'Dispatcher',
      );
      expect(profile).toBeDefined();
      expect(profile.familySlug).toBe('dispatcher');
      expect(profile.instructions).toBe('[[prompt:Dispatcher — Intake & Triage SOP]]');
      const prompt = (threeAgents.template as any).prompts.find(
        (p: any) => p.title === 'Dispatcher — Intake & Triage SOP',
      );
      expect(prompt).toBeDefined();
    });

    it('ships a Dispatch → Dispatcher auto-assign rule', () => {
      const rules = (threeAgents.template as any).autoAssignRules ?? [];
      const dispatchRule = rules.find(
        (r: any) =>
          r.matchType === 'status' &&
          r.statusLabel === 'Dispatch' &&
          r.targetAgentName === 'Dispatcher',
      );
      expect(dispatchRule).toBeDefined();
    });

    it('every preset agentConfig references a providerConfig that exists on the agent profile', () => {
      const t = threeAgents.template as any;
      const profilesById = new Map((t.profiles as any[]).map((p) => [p.id, p]));
      for (const preset of t.presets ?? []) {
        for (const cfg of preset.agentConfigs) {
          const agent = (t.agents as any[]).find((a) => a.name === cfg.agentName);
          if (!agent) throw new Error(`agent ${cfg.agentName} not found`);
          const profile = profilesById.get(agent.profileId);
          if (!profile) throw new Error(`profile for ${cfg.agentName} not found`);
          const configNames = (profile.providerConfigs as any[]).map((c) => c.name);
          if (!configNames.includes(cfg.providerConfigName)) {
            throw new Error(
              `preset "${preset.name}" references "${cfg.providerConfigName}" for ${cfg.agentName}, available: [${configNames.join(', ')}]`,
            );
          }
        }
      }
    });
  });
});
