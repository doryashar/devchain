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
      expect(profile.instructions).toContain('Dispatcher — Intake & Triage SOP');
      const prompt = (teamsDev.template as any).prompts.find((p: any) => p.title === 'Dispatcher — Intake & Triage SOP');
      expect(prompt).toBeDefined();
      const teams = (teamsDev.template as any).teams ?? [];
      for (const team of teams) {
        expect(team.memberAgentNames).not.toContain('Dispatcher');
        expect(team.teamLeadAgentName).not.toBe('Dispatcher');
      }
    });

    it('ships a Dispatch → Dispatcher auto-assign rule', () => {
      const rules = (teamsDev.template as any).autoAssignRules ?? [];
      const dispatchRule = rules.find((r: any) =>
        r.matchType === 'status' && r.statusLabel === 'Dispatch' && r.targetType === 'agent' && r.targetAgentName === 'Dispatcher');
      expect(dispatchRule).toBeDefined();
    });
  });
});
