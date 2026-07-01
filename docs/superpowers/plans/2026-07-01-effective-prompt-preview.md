# Effective-Prompt Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only, byte-accurate "Effective prompt" preview to agent profile details, backed by a new `GET /api/profiles/:id/effective-prompt` endpoint that reuses the real `InstructionsResolver`, and surfaces the assigned-but-unreferenced footgun.

**Architecture:** A new self-contained `ProfileInstructionsService` in the profiles module constructs its own `InstructionsResolver` (mirroring `mcp.service.ts:155-159` exactly, using `buildInlineResolution` from `mcp/services/utils/document-link-resolver`). The `ProfilesController` adds `GET /:id/effective-prompt` that loads the profile (with its junction prompts), resolves `agent_name` from the first agent using that profile (via `listAgents(projectId)` then filtering by `profileId`, falling back to the profile name), builds MCP-scope render vars, resolves the instructions, and computes `unreferencedAssigned` by parsing inline `[[prompt:Title]]` references against the junction prompts. The frontend adds a `useEffectivePrompt(profileId)` hook + a read-only preview section in the `ProfilesPage` edit dialog (driven by the already-in-scope `editingProfile.id`) with banners for truncation / unresolved refs / unreferenced-assigned.

**Why profile-scoped (not agent-scoped):** the `ProfilesPage` edit dialog edits a *profile* (`editingProfile: AgentProfile` at `ProfilesPage.tsx:936`) and no `agentId` is in scope (a profile only carries `agentCount`). The endpoint therefore keys on `profileId` and resolves the agent internally.

**Tech Stack:** NestJS (backend), React + TanStack Query + Jest + @testing-library/react (frontend), shared `MarkdownRenderer`.

**Spec:** `docs/superpowers/specs/2026-07-01-prompt-viewer-and-effective-preview-design.md` (Change 2).

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/local-app/src/modules/profiles/services/profile-instructions.service.ts` | NEW — constructs `InstructionsResolver`; exposes `getResolver()`. Self-contained, no McpModule coupling. |
| `apps/local-app/src/modules/profiles/services/profile-instructions.service.spec.ts` | NEW — unit test: resolver construction. |
| `apps/local-app/src/modules/profiles/profiles.module.ts` | MODIFY — register `ProfileInstructionsService`, import `TeamsModule`. |
| `apps/local-app/src/modules/profiles/controllers/profiles.controller.ts` | MODIFY — add `GET /:id/effective-prompt` + DTO. |
| `apps/local-app/src/modules/profiles/controllers/profiles.controller.spec.ts` | MODIFY/CREATE — add effective-prompt tests. |
| `apps/local-app/src/ui/hooks/useEffectivePrompt.ts` | NEW — `useQuery(['effective-prompt', profileId])`. |
| `apps/local-app/src/ui/components/EffectivePromptPreview.tsx` | NEW — presentational component (renders contentMd + banners). |
| `apps/local-app/src/ui/components/EffectivePromptPreview.spec.tsx` | NEW — component tests. |
| `apps/local-app/src/ui/pages/ProfilesPage.tsx` | MODIFY — render `EffectivePromptPreview` in the edit dialog using `editingProfile.id`. |
| `apps/local-app/src/ui/pages/ProfilesPage.spec.tsx` | MODIFY — add preview rendering test. |

---

## Task 1: `ProfileInstructionsService` — resolver construction

**Files:**
- Create: `apps/local-app/src/modules/profiles/services/profile-instructions.service.ts`
- Create: `apps/local-app/src/modules/profiles/services/profile-instructions.service.spec.ts`
- Modify: `apps/local-app/src/modules/profiles/profiles.module.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/local-app/src/modules/profiles/services/profile-instructions.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { STORAGE_SERVICE } from '../../storage/interfaces/storage.interface';
import { ProfileInstructionsService } from './profile-instructions.service';
import { InstructionsResolver } from '../../mcp/services/instructions-resolver';

jest.mock('../../../common/logging/logger', () => ({
  createLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }),
}));

describe('ProfileInstructionsService', () => {
  let service: ProfileInstructionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfileInstructionsService,
        { provide: STORAGE_SERVICE, useValue: {} },
      ],
    }).compile();
    service = module.get(ProfileInstructionsService);
  });

  it('exposes a constructed InstructionsResolver', () => {
    expect(service.getResolver()).toBeInstanceOf(InstructionsResolver);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter local-app test -- profiles/services/profile-instructions.service.spec`
Expected: FAIL — `Cannot find module './profile-instructions.service'`.

- [ ] **Step 3: Write the service**

Create `apps/local-app/src/modules/profiles/services/profile-instructions.service.ts`:

```ts
import { Injectable, Inject } from '@nestjs/common';
import {
  StorageService,
  STORAGE_SERVICE,
} from '../../storage/interfaces/storage.interface';
import { InstructionsResolver } from '../../mcp/services/instructions-resolver';
import { buildInlineResolution } from '../../mcp/services/utils/document-link-resolver';

@Injectable()
export class ProfileInstructionsService {
  private readonly resolver: InstructionsResolver;

  constructor(@Inject(STORAGE_SERVICE) private readonly storage: StorageService) {
    this.resolver = new InstructionsResolver(
      this.storage,
      (document, cache, maxDepth, maxBytes) =>
        buildInlineResolution(this.storage, document, cache, maxDepth, maxBytes),
    );
  }

  getResolver(): InstructionsResolver {
    return this.resolver;
  }
}
```

- [ ] **Step 4: Register the service + import TeamsModule**

Edit `apps/local-app/src/modules/profiles/profiles.module.ts` — replace the full file with:

```ts
import { Module } from '@nestjs/common';
import { ProfilesController } from './controllers/profiles.controller';
import { ProviderConfigsController } from './controllers/provider-configs.controller';
import { StorageModule } from '../storage/storage.module';
import { SettingsModule } from '../settings/settings.module';
import { TeamsModule } from '../teams/teams.module';
import { ProviderConfigsService } from './services/provider-configs.service';
import { ProfileInstructionsService } from './services/profile-instructions.service';

@Module({
  imports: [StorageModule, SettingsModule, TeamsModule],
  controllers: [ProfilesController, ProviderConfigsController],
  providers: [ProviderConfigsService, ProfileInstructionsService],
})
export class ProfilesModule {}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter local-app test -- profiles/services/profile-instructions.service.spec`
Expected: PASS.

- [ ] **Step 6: Verify the app still compiles (no DI cycle)**

Run: `pnpm --filter local-app build`
Expected: build succeeds. If a circular-dependency error references `TeamsModule`, change the import to `forwardRef(() => TeamsModule)` in `profiles.module.ts` (and only if the error specifically complains about the reverse edge, add `forwardRef(() => ProfilesModule)` inside `TeamsModule`'s imports). Re-run build.

- [ ] **Step 7: Commit**

```bash
git add apps/local-app/src/modules/profiles/services/profile-instructions.service.ts \
        apps/local-app/src/modules/profiles/services/profile-instructions.service.spec.ts \
        apps/local-app/src/modules/profiles/profiles.module.ts
git commit -m "feat(profiles): add ProfileInstructionsService wrapping InstructionsResolver"
```

---

## Task 2: `GET /api/profiles/:id/effective-prompt` endpoint

**Files:**
- Modify: `apps/local-app/src/modules/profiles/controllers/profiles.controller.ts`
- Modify or create: `apps/local-app/src/modules/profiles/controllers/profiles.controller.spec.ts`

**DTOs + constants (add at the top of `profiles.controller.ts`, after the existing imports):**

```ts
import { ProfileInstructionsService } from '../services/profile-instructions.service';
import { TeamsService } from '../../teams/services/teams.service';
import { loadAgentRecipientContext } from '../../../common/template/agent-recipient-context';
import { ServiceUnavailableError } from '../../../common/errors/error-types';

export interface EffectivePromptReference {
  title: string;
  resolved: boolean;
}

export interface EffectivePromptResponse {
  contentMd: string;
  truncated: boolean;
  maxBytes: number;
  references: EffectivePromptReference[];
  unreferencedAssigned: { title: string }[];
}

const EFFECTIVE_PROMPT_MAX_BYTES = 64 * 1024;
const PROMPT_REF_PATTERN = /\[\[prompt:([^\]]+)\]\]/gi;
```

- [ ] **Step 1: Write the failing tests**

If `apps/local-app/src/modules/profiles/controllers/profiles.controller.spec.ts` does not exist, create it. Otherwise extend it. The test mirrors the agents.controller.spec.ts pattern (Nest `Test.createTestingModule`, direct method calls, mocked `STORAGE_SERVICE`).

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { STORAGE_SERVICE } from '../../storage/interfaces/storage.interface';
import { ProfilesController } from './profiles.controller';
import { ProfileInstructionsService } from '../services/profile-instructions.service';
import { TeamsService } from '../../teams/services/teams.service';

jest.mock('../../../common/logging/logger', () => ({
  createLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }),
}));

describe('ProfilesController - getEffectivePrompt', () => {
  let controller: ProfilesController;
  let storage: any;
  let fakeResolver: { resolve: jest.Mock };
  let profileInstructionsService: { getResolver: jest.Mock };
  let teamsService: { listTeamsByAgent: jest.Mock };

  beforeEach(async () => {
    storage = {
      getAgentProfileWithPrompts: jest.fn(),
      getProject: jest.fn(),
      listAgents: jest.fn(),
    };
    fakeResolver = { resolve: jest.fn() };
    profileInstructionsService = { getResolver: jest.fn().mockReturnValue(fakeResolver) };
    teamsService = { listTeamsByAgent: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProfilesController],
      providers: [
        { provide: STORAGE_SERVICE, useValue: storage },
        { provide: ProfileInstructionsService, useValue: profileInstructionsService },
        { provide: TeamsService, useValue: teamsService },
      ],
    }).compile();
    controller = module.get(ProfilesController);
  });

  const profile = {
    id: 'profile-1',
    projectId: 'proj-1',
    name: 'coder',
    instructions: '[[prompt:Worker SOP]]',
    prompts: [
      { promptId: 'p-1', title: 'Worker SOP', order: 1 },
      { promptId: 'p-2', title: 'Orphan SOP', order: 2 },
    ],
  };

  it('returns resolved contentMd and flags unreferenced assigned prompts', async () => {
    storage.getAgentProfileWithPrompts.mockResolvedValue(profile);
    storage.getProject.mockResolvedValue({ id: 'proj-1', name: 'My Project' });
    storage.listAgents.mockResolvedValue({ items: [{ id: 'a-1', name: 'Coder', profileId: 'profile-1' }] });
    fakeResolver.resolve.mockResolvedValue({
      contentMd: '## Prompt: Worker SOP\n\ndo work\n---\n',
      bytes: 100,
      truncated: false,
      docs: [],
      prompts: [{ id: 'p-1', title: 'Worker SOP' }],
    });

    const result = await controller.getEffectivePrompt('profile-1');

    expect(result.contentMd).toBe('## Prompt: Worker SOP\n\ndo work\n---\n');
    expect(result.truncated).toBe(false);
    expect(result.maxBytes).toBe(64 * 1024);
    expect(result.references).toEqual([{ title: 'Worker SOP', resolved: true }]);
    expect(result.unreferencedAssigned).toEqual([{ title: 'Orphan SOP' }]);
    // agent_name resolved from the agent using the profile
    expect(fakeResolver.resolve).toHaveBeenCalledWith(
      'proj-1',
      '[[prompt:Worker SOP]]',
      expect.objectContaining({
        render: expect.objectContaining({
          vars: expect.objectContaining({ agent_name: 'Coder', project_name: 'My Project' }),
        }),
      }),
    );
  });

  it('falls back to profile name when no agent uses the profile', async () => {
    storage.getAgentProfileWithPrompts.mockResolvedValue(profile);
    storage.getProject.mockResolvedValue({ id: 'proj-1', name: 'My Project' });
    storage.listAgents.mockResolvedValue({ items: [] });
    fakeResolver.resolve.mockResolvedValue({ contentMd: '', bytes: 0, truncated: false, docs: [], prompts: [{ id: 'p-1', title: 'Worker SOP' }] });

    await controller.getEffectivePrompt('profile-1');

    expect(fakeResolver.resolve).toHaveBeenCalledWith(
      'proj-1',
      '[[prompt:Worker SOP]]',
      expect.objectContaining({
        render: expect.objectContaining({ vars: expect.objectContaining({ agent_name: 'coder' }) }),
      }),
    );
  });

  it('marks a missing inline reference as resolved=false', async () => {
    storage.getAgentProfileWithPrompts.mockResolvedValue({ ...profile, instructions: '[[prompt:Missing SOP]]', prompts: [] });
    storage.getProject.mockResolvedValue({ id: 'proj-1', name: 'P' });
    storage.listAgents.mockResolvedValue({ items: [] });
    fakeResolver.resolve.mockResolvedValue({ contentMd: '', bytes: 0, truncated: false, docs: [], prompts: [] });

    const result = await controller.getEffectivePrompt('profile-1');

    expect(result.references).toEqual([{ title: 'Missing SOP', resolved: false }]);
    expect(result.unreferencedAssigned).toEqual([]);
  });

  it('reports truncated=true and passes maxBytes to the resolver', async () => {
    storage.getAgentProfileWithPrompts.mockResolvedValue(profile);
    storage.getProject.mockResolvedValue({ id: 'proj-1', name: 'P' });
    storage.listAgents.mockResolvedValue({ items: [] });
    fakeResolver.resolve.mockResolvedValue({
      contentMd: 'x'.repeat(100),
      bytes: 64 * 1024,
      truncated: true,
      docs: [],
      prompts: [{ id: 'p-1', title: 'Worker SOP' }],
    });

    const result = await controller.getEffectivePrompt('profile-1');

    expect(result.truncated).toBe(true);
    expect(fakeResolver.resolve).toHaveBeenCalledWith(
      'proj-1',
      '[[prompt:Worker SOP]]',
      expect.objectContaining({ maxBytes: 64 * 1024 }),
    );
  });

  it('returns empty contentMd for a profile with no instructions', async () => {
    storage.getAgentProfileWithPrompts.mockResolvedValue({ ...profile, instructions: null, prompts: [] });
    storage.getProject.mockResolvedValue({ id: 'proj-1', name: 'P' });
    storage.listAgents.mockResolvedValue({ items: [] });
    fakeResolver.resolve.mockResolvedValue({ contentMd: '', bytes: 0, truncated: false, docs: [], prompts: [] });

    const result = await controller.getEffectivePrompt('profile-1');

    expect(result.contentMd).toBe('');
    expect(result.references).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter local-app test -- profiles/controllers/profiles.controller.spec`
Expected: FAIL — `controller.getEffectivePrompt is not a function`.

- [ ] **Step 3: Extend the constructor + add the handler**

Edit `apps/local-app/src/modules/profiles/controllers/profiles.controller.ts`. The current constructor is (line 66):

```ts
  constructor(@Inject(STORAGE_SERVICE) private readonly storage: StorageService) {}
```

Replace it with:

```ts
  constructor(
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    private readonly profileInstructions: ProfileInstructionsService,
    private readonly teamsService: TeamsService,
  ) {}
```

Append this handler inside the `ProfilesController` class (before the closing brace):

```ts
  @Get(':id/effective-prompt')
  async getEffectivePrompt(@Param('id') id: string): Promise<EffectivePromptResponse> {
    logger.info({ id }, 'GET /api/profiles/:id/effective-prompt');

    const profile = await this.storage.getAgentProfileWithPrompts(id);
    const projectId = profile.projectId;
    const project = await this.storage.getProject(projectId);
    const instructions = profile.instructions ?? null;

    // Resolve the first agent using this profile (for agent_name + team context).
    const agents = await this.storage.listAgents(projectId);
    const agent = agents.items.find((a) => a.profileId === id) ?? null;

    let teamCtx = { team_name: '', team_names: '', is_team_lead: false };
    if (agent) {
      try {
        teamCtx = await loadAgentRecipientContext(this.teamsService, agent.id);
      } catch (error) {
        if (!(error instanceof ServiceUnavailableError)) throw error;
      }
    }
    const renderVars: Record<string, unknown> = {
      agent_name: agent?.name ?? profile.name,
      project_name: project.name,
      ...teamCtx,
    };

    const resolver = this.profileInstructions.getResolver();
    const resolved = await resolver.resolve(projectId, instructions, {
      maxBytes: EFFECTIVE_PROMPT_MAX_BYTES,
      render: { vars: renderVars, legacyVariables: Object.keys(renderVars) },
    });

    // Parse inline [[prompt:Title]] references (case-insensitive, deduped, order preserved).
    const inlineTitles: string[] = [];
    if (instructions) {
      let m: RegExpExecArray | null;
      PROMPT_REF_PATTERN.lastIndex = 0;
      while ((m = PROMPT_REF_PATTERN.exec(instructions)) !== null) {
        inlineTitles.push(m[1]);
      }
    }
    const resolvedTitles = new Set((resolved?.prompts ?? []).map((p) => p.title.toLowerCase()));
    const references: EffectivePromptReference[] = inlineTitles
      .filter((title, idx) => inlineTitles.indexOf(title) === idx)
      .map((title) => ({ title, resolved: resolvedTitles.has(title.toLowerCase()) }));

    // Junction-assigned prompts not referenced inline = the footgun.
    const inlineLower = new Set(inlineTitles.map((t) => t.toLowerCase()));
    const unreferencedAssigned = (profile.prompts ?? [])
      .filter((p) => !inlineLower.has(p.title.toLowerCase()))
      .map((p) => ({ title: p.title }));

    return {
      contentMd: resolved?.contentMd ?? '',
      truncated: resolved?.truncated ?? false,
      maxBytes: EFFECTIVE_PROMPT_MAX_BYTES,
      references,
      unreferencedAssigned,
    };
  }
```

> NOTE on `profile.projectId`: the `AgentProfile` domain model (`apps/local-app/src/modules/storage/models/domain.models.ts:150-163`) is project-scoped and carries `projectId` (it is required at creation via `CreateProfileSchema.projectId`). If during implementation TypeScript reports that `projectId` is not on the returned type, read `getAgentProfileWithPrompts`'s return type at `agent-profile.delegate.ts:200-224` and use whichever field exposes the project id (it is the same row). Do not invent a fetch.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter local-app test -- profiles/controllers/profiles.controller.spec`
Expected: PASS (all 5 new tests green).

- [ ] **Step 5: Run lint**

Run: `pnpm --filter local-app lint`
Expected: no errors. Remove any imports flagged as unused.

- [ ] **Step 6: Commit**

```bash
git add apps/local-app/src/modules/profiles/controllers/profiles.controller.ts \
        apps/local-app/src/modules/profiles/controllers/profiles.controller.spec.ts
git commit -m "feat(profiles): add GET /api/profiles/:id/effective-prompt endpoint"
```

---

## Task 3: `EffectivePromptPreview` component

**Files:**
- Create: `apps/local-app/src/ui/components/EffectivePromptPreview.tsx`
- Create: `apps/local-app/src/ui/components/EffectivePromptPreview.spec.tsx`

- [ ] **Step 1: Write the failing component test**

Create `apps/local-app/src/ui/components/EffectivePromptPreview.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { EffectivePromptPreview } from './EffectivePromptPreview';

jest.mock('@/ui/components/shared', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="markdown">{content}</div>
  ),
}));

describe('EffectivePromptPreview', () => {
  it('renders the resolved content', () => {
    render(
      <EffectivePromptPreview
        data={{
          contentMd: 'do the work',
          truncated: false,
          maxBytes: 65536,
          references: [{ title: 'Worker SOP', resolved: true }],
          unreferencedAssigned: [],
        }}
        isLoading={false}
      />,
    );
    expect(screen.getByTestId('markdown')).toHaveTextContent('do the work');
  });

  it('shows the truncation banner when truncated', () => {
    render(
      <EffectivePromptPreview
        data={{
          contentMd: 'x',
          truncated: true,
          maxBytes: 65536,
          references: [],
          unreferencedAssigned: [],
        }}
        isLoading={false}
      />,
    );
    expect(screen.getByText(/truncated at 64 KB/i)).toBeInTheDocument();
  });

  it('lists unresolved references and unreferenced assigned prompts', () => {
    render(
      <EffectivePromptPreview
        data={{
          contentMd: 'x',
          truncated: false,
          maxBytes: 65536,
          references: [{ title: 'Missing', resolved: false }],
          unreferencedAssigned: [{ title: 'Orphan SOP' }],
        }}
        isLoading={false}
      />,
    );
    expect(screen.getByText(/Unresolved references/i)).toBeInTheDocument();
    expect(screen.getByText(/won't reach the agent/i)).toBeInTheDocument();
    expect(screen.getByText('Orphan SOP')).toBeInTheDocument();
  });

  it('renders a loading state', () => {
    render(<EffectivePromptPreview data={null} isLoading={true} />);
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter local-app test -- components/EffectivePromptPreview.spec`
Expected: FAIL — `Cannot find module './EffectivePromptPreview'`.

- [ ] **Step 3: Write the component**

Create `apps/local-app/src/ui/components/EffectivePromptPreview.tsx`:

```tsx
import { MarkdownRenderer } from '@/ui/components/shared';

export interface EffectivePromptData {
  contentMd: string;
  truncated: boolean;
  maxBytes: number;
  references: { title: string; resolved: boolean }[];
  unreferencedAssigned: { title: string }[];
}

export function EffectivePromptPreview({
  data,
  isLoading,
}: {
  data: EffectivePromptData | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading effective prompt…</p>;
  }
  if (!data) {
    return null;
  }

  const unresolved = data.references.filter((r) => !r.resolved);

  return (
    <div className="space-y-3">
      {data.truncated && (
        <div className="rounded-md border border-yellow-500 bg-yellow-500/10 p-3 text-sm text-yellow-900">
          Effective prompt was truncated at 64 KB.
        </div>
      )}
      {unresolved.length > 0 && (
        <div className="rounded-md border border-red-500 bg-red-500/10 p-3 text-sm text-red-900">
          <p className="font-medium">Unresolved references (prompt not found):</p>
          <ul className="ml-4 list-disc">
            {unresolved.map((r) => (
              <li key={r.title}>{r.title}</li>
            ))}
          </ul>
        </div>
      )}
      {data.unreferencedAssigned.length > 0 && (
        <div className="rounded-md border border-orange-500 bg-orange-500/10 p-3 text-sm text-orange-900">
          <p className="font-medium">
            These assigned prompts are not referenced inline and won't reach the agent:
          </p>
          <ul className="ml-4 list-disc">
            {data.unreferencedAssigned.map((p) => (
              <li key={p.title}>{p.title}</li>
            ))}
          </ul>
        </div>
      )}
      {data.contentMd ? (
        <div className="rounded-md border bg-muted/30 p-4 max-h-[480px] overflow-y-auto">
          <MarkdownRenderer content={data.contentMd} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          This profile has no instructions.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter local-app test -- components/EffectivePromptPreview.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/local-app/src/ui/components/EffectivePromptPreview.tsx \
        apps/local-app/src/ui/components/EffectivePromptPreview.spec.tsx
git commit -m "feat(ui): add EffectivePromptPreview component"
```

---

## Task 4: `useEffectivePrompt` hook + wire into `ProfilesPage`

**Files:**
- Create: `apps/local-app/src/ui/hooks/useEffectivePrompt.ts`
- Modify: `apps/local-app/src/ui/pages/ProfilesPage.tsx`
- Modify: `apps/local-app/src/ui/pages/ProfilesPage.spec.tsx`

- [ ] **Step 1: Write the hook**

Create `apps/local-app/src/ui/hooks/useEffectivePrompt.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import type { EffectivePromptData } from '@/ui/components/EffectivePromptPreview';

async function fetchEffectivePrompt(profileId: string): Promise<EffectivePromptData> {
  const res = await fetch(`/api/profiles/${encodeURIComponent(profileId)}/effective-prompt`);
  if (!res.ok) throw new Error('Failed to fetch effective prompt');
  return res.json();
}

export function useEffectivePrompt(profileId: string | null | undefined) {
  return useQuery({
    queryKey: ['effective-prompt', profileId],
    queryFn: () => fetchEffectivePrompt(profileId as string),
    enabled: !!profileId,
    staleTime: 30_000,
  });
}
```

- [ ] **Step 2: Render the preview inside the edit dialog**

Edit `apps/local-app/src/ui/pages/ProfilesPage.tsx`.

Add imports near the top (alongside the existing `MarkdownReferenceInput` import):

```tsx
import { useEffectivePrompt } from '@/ui/hooks/useEffectivePrompt';
import { EffectivePromptPreview } from '@/ui/components/EffectivePromptPreview';
```

Inside the `ProfilesPage` component body (next to the other hooks, after the `editingProfile` state declared at line 936), add:

```tsx
  const effectivePrompt = useEffectivePrompt(editingProfile?.id ?? null);
```

Locate the right-column "Instructions" block — the `<div className="space-y-2">` that wraps the `MarkdownReferenceInput` with `id="instructions"` (around lines 1414-1429). Immediately after that block's closing `</div>` (still inside the dialog grid), add:

```tsx
              <div className="space-y-2 lg:col-span-2">
                <Label>Effective prompt (preview)</Label>
                <p className="text-sm text-muted-foreground">
                  What this profile's agent actually receives at session start — references
                  resolved. Edit the source prompts in PromptsPage.
                </p>
                <EffectivePromptPreview
                  data={effectivePrompt.data ?? null}
                  isLoading={effectivePrompt.isLoading}
                />
              </div>
```

`editingProfile.id` is set by `handleEdit` (`ProfilesPage.tsx:1190`) and cleared to `null` when the dialog closes (the existing dialog `onOpenChange` flow already resets `editingProfile`), so the query enables/disables automatically with the dialog.

- [ ] **Step 3: Write the failing UI test**

The existing spec (`apps/local-app/src/ui/pages/ProfilesPage.spec.tsx`) sets a per-test `fetchMock.mockImplementation` inside each `it`, uses `fireEvent` (not `userEvent`), and the profile list endpoint is `/api/profiles?projectId=project-1`. The profile card opens the edit dialog via the card's `onClick={() => handleEdit(profile)}` (`ProfilesPage.tsx:1284`), so clicking the profile name opens edit and sets `editingProfile`. Append this test, modelling the fetch-mock shape on the existing "confirms profile delete" test:

```tsx
  it('shows the effective-prompt preview with unreferenced warning when editing a profile', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.startsWith('/api/profiles?projectId=project-1')) {
        return {
          ok: true,
          json: async () => ({
            items: [
              {
                id: 'profile-1',
                name: 'Runner',
                provider: null,
                prompts: [{ promptId: 'p1', title: 'Demo', order: 1 }],
                instructions: '[[prompt:Demo]]',
                agentCount: 1,
                createdAt: '',
                updatedAt: '',
              },
            ],
            total: 1,
            limit: 1,
            offset: 0,
          }),
        } as Response;
      }

      if (url === '/api/profiles/profile-1/effective-prompt') {
        return {
          ok: true,
          json: async () => ({
            contentMd: '## Prompt: Demo\n\ndemo body\n',
            truncated: false,
            maxBytes: 65536,
            references: [{ title: 'Demo', resolved: true }],
            unreferencedAssigned: [{ title: 'Orphan SOP' }],
          }),
        } as Response;
      }

      if (url.startsWith('/api/providers')) {
        return { ok: true, json: async () => ({ items: [], total: 0, limit: 0, offset: 0 }) } as Response;
      }
      if (url.startsWith('/api/prompts?projectId=project-1')) {
        return { ok: true, json: async () => ({ items: [], total: 0, limit: 0, offset: 0 }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    const { Wrapper } = createWrapper();
    render(
      <Wrapper>
        <ProfilesPage />
      </Wrapper>,
    );

    // Clicking the profile card opens the edit dialog (handleEdit sets editingProfile).
    const card = await screen.findByText('Runner');
    fireEvent.click(card);

    expect(await screen.findByText(/Effective prompt/i)).toBeInTheDocument();
    expect(await screen.findByText('Orphan SOP')).toBeInTheDocument();
  });
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter local-app test -- pages/ProfilesPage.spec`
Expected: FAIL — "Effective prompt" text not found.

- [ ] **Step 5: Implement until the test passes**

Re-run:

Run: `pnpm --filter local-app test -- pages/ProfilesPage.spec`
Expected: PASS. If the preview does not appear, confirm `editingProfile.id` is truthy when the dialog is open and the fetch mock branch matches the URL the hook calls.

- [ ] **Step 6: Run full lint + tests**

Run: `pnpm --filter local-app lint && pnpm --filter local-app test`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add apps/local-app/src/ui/hooks/useEffectivePrompt.ts \
        apps/local-app/src/ui/pages/ProfilesPage.tsx \
        apps/local-app/src/ui/pages/ProfilesPage.spec.tsx
git commit -m "feat(profiles): show effective-prompt preview in profile details"
```

---

## Task 5: Docs

**Files:**
- Create: `docs/instructions-viewer.md`

- [ ] **Step 1: Write the doc**

Create `docs/instructions-viewer.md` covering: what the "Effective prompt" preview shows; the `[[prompt:Title]]` resolution model (project then global, case-insensitive); the free-text-drop behavior; the assigned-vs-referenced footgun; and that editing happens in PromptsPage. Keep it user-facing and concise.

- [ ] **Step 2: Commit**

```bash
git add docs/instructions-viewer.md
git commit -m "docs: document effective-prompt preview"
```
