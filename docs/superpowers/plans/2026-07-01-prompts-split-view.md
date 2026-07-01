# PromptsPage Split-View Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework `PromptsPage` from a list + modal-dialog editor into a persistent split view (list + full-height scrollable editor), with a fullscreen toggle, explicit save with optimistic-lock conflict handling, and dirty guards.

**Architecture:** A single-page two-pane layout replaces the `<Dialog>`. The left rail lists prompts (title + tags) with create/delete actions. The right pane is a full-height `<Textarea>` bound to the selected prompt, editable in place, with title + tag editors above and Save/Discard below. A fullscreen toggle hides the left rail. All data flows through the existing `/api/prompts` CRUD (no backend changes). Existing inline helpers (`fetchPrompts`, `createPrompt`, `updatePrompt`, `deletePrompt`, `PROMPT_VARIABLES`, `TagInput`) are reused.

**Tech Stack:** React + TanStack Query + Jest + @testing-library/react, shadcn UI primitives.

**Spec:** `docs/superpowers/specs/2026-07-01-prompt-viewer-and-effective-preview-design.md` (Change 1).

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/local-app/src/ui/pages/PromptsPage.tsx` | MODIFY — replace dialog editor with split-view layout; add selection state, dirty tracking, fullscreen toggle. |
| `apps/local-app/src/ui/pages/PromptsPage.spec.tsx` | MODIFY — replace dialog tests with split-view selection/edit/save/fullscreen/conflict tests. |

No new files; no backend changes.

---

## Task 1: Split-view layout + selection state (auto-select first)

**Files:**
- Modify: `apps/local-app/src/ui/pages/PromptsPage.tsx`
- Modify: `apps/local-app/src/ui/pages/PromptsPage.spec.tsx`

This task replaces the dialog-based editor with the two-pane shell. The editor's Save/edit wiring lands in later tasks; for now the textarea is read-only-bound and switching rows is unguarded.

- [ ] **Step 1: Update the failing tests**

Open `apps/local-app/src/ui/pages/PromptsPage.spec.tsx`. The existing `global.fetch` `beforeEach` mock already seeds a list with one prompt (`prompt-1` / title `"Prompt A"`) and a detail response with `content: "Prompt content"` (see lines 73-111). Remove tests that assert on the `<Dialog>` ("Create", "Edit", "Delete" via dialog, Markdown preview toggle) — they are rewritten in later tasks. Replace with a baseline selection test that uses the existing default mock:

```tsx
  it('auto-selects the first prompt and shows its content in the editor on load', async () => {
    render(<PromptsPage />, { wrapper: createWrapper() });
    // The list renders the seeded prompt.
    expect(await screen.findByText('Prompt A')).toBeInTheDocument();
    // The textarea shows the selected prompt's content (auto-selected first row).
    const editor = await screen.findByRole('textbox', { name: /prompt content/i });
    expect(editor).toHaveValue('Prompt content');
  });
```

(No change to the `beforeEach` fetch mock is needed for this task; later tasks that need multiple prompts or PUT/409 branches override `global.fetch` per-test.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter local-app test -- pages/PromptsPage.spec`
Expected: FAIL — no textbox accessible by "prompt content" (current UI is a dialog).

- [ ] **Step 3: Implement the split-view shell**

Edit `apps/local-app/src/ui/pages/PromptsPage.tsx`. Replace the `showDialog`/`editingPrompt`/`formData`/`showPreview` state and the `<Dialog>` JSX (current lines ~550-663) with a split-view. The new component body (replacing from the `return (` of the page down to its closing tag) is:

```tsx
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Keep `selectedId` in sync with the loaded list (auto-select first).
  useEffect(() => {
    if (!selectedId && data?.items && data.items.length > 0) {
      setSelectedId(data.items[0].id);
    }
    if (selectedId && data?.items && !data.items.some((p) => p.id === selectedId)) {
      setSelectedId(data.items[0]?.id ?? null);
    }
  }, [data, selectedId]);

  const selectedSummary = data?.items?.find((p) => p.id === selectedId) ?? null;

  if (!selectedProjectId) {
    return (
      <div className="p-6">
        <PageHeader title="Prompts" description="Manage reusable prompt content." />
        <EmptyState title="Select a project" description="Choose a project to manage its prompts." />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Prompts" description="Manage reusable prompt content." />
      <div className="flex-1 min-h-0 flex gap-4">
        {/* LEFT RAIL — hidden when fullscreen (CSS only, so the editor keeps its state) */}
        <aside
          className={`shrink-0 border-r pr-2 overflow-y-auto ${
            isFullscreen ? 'hidden' : 'w-[280px]'
          }`}
        >
          <Button className="w-full mb-3" onClick={() => handleCreate()} size="sm">
            <Plus className="h-4 w-4 mr-1" /> New
          </Button>
          <ul className="space-y-1">
            {data?.items?.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={`w-full text-left rounded-md px-2 py-2 text-sm ${
                    p.id === selectedId ? 'bg-accent' : 'hover:bg-accent/50'
                  }`}
                >
                  <div className="font-medium truncate">{p.title}</div>
                  {p.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {p.tags.slice(0, 2).map((t) => (
                        <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                      ))}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </aside>
        {/* RIGHT PANE — single editor instance; fullscreen just hides the rail above */}
        <section className="flex-1 min-w-0">
          {selectedSummary ? (
            <PromptEditorPane
              key={selectedSummary.id}
              promptId={selectedSummary.id}
              onDeleted={() => setSelectedId(null)}
              isFullscreen={isFullscreen}
              onToggleFullscreen={() => setIsFullscreen((v) => !v)}
            />
          ) : (
            <EmptyState title="No prompt selected" description="Create one to get started." />
          )}
        </section>
      </div>
    </div>
  );
```

Add these imports at the top of the file (alongside existing ones):

```tsx
import { useState, useEffect } from 'react';
import { PageHeader, EmptyState } from '@/ui/components/shared';
```

Add `import { Maximize2, Minimize2 } from 'lucide-react';` (used in Task 3).

`handleCreate` is a stub for now (Task 4 implements it fully). Add a placeholder that selects nothing yet:

```tsx
  const handleCreate = () => {
    // Implemented in Task 4.
  };
```

Define `PromptEditorPane` as a minimal read-only component below the main component (Task 2 expands it into the full editable pane):

```tsx
function PromptEditorPane({ promptId }: {
  promptId: string;
  onDeleted: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  const { data: detail } = useQuery({
    queryKey: ['prompt', promptId],
    queryFn: () => fetchPromptDetail(promptId),
  });
  if (!detail) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  return (
    <Textarea
      value={detail.content}
      readOnly
      aria-label="Prompt content"
      className="flex-1 min-h-0 font-mono"
    />
  );
}
```

Add the helper at module scope (alongside the existing `fetchPrompts`, `createPrompt`, `updatePrompt`, `deletePrompt`):

```ts
async function fetchPromptDetail(id: string): Promise<PromptDetail> {
  const res = await fetch(`/api/prompts/${id}`);
  if (!res.ok) throw new Error('Failed to fetch prompt');
  return res.json();
}
```

Ensure `useQuery` is imported (Task 2 adds `useMutation`/`useQueryClient` to the same import):

```tsx
import { useQuery } from '@tanstack/react-query';
```

> The pane accepts `onDeleted`/`isFullscreen`/`onToggleFullscreen` in its type signature but does not destructure them yet, so they do not trigger the `--max-warnings=0` unused-variable rule. Task 2 replaces this whole function with the full editable implementation that destructures all props.

> NOTE on what to keep vs. remove during the rework:
> - **KEEP** the module-scope helpers (they are pure, no component state): `fetchPrompts`, `createPrompt`, `updatePrompt`, `deletePrompt`, `PROMPT_VARIABLES`, `TagInput`, `MarkdownPreview`.
> - **KEEP** the `useQuery(['prompts', selectedProjectId])` list query in the parent.
> - **REMOVE** the three component-level mutations the original file defined (`createMutation`/`updateMutation`/`deleteMutation`) AND the dialog state (`showDialog`, `editingPrompt`, `formData`, `showPreview`, `pendingTagInput`, `pendingDeletePromptId`) AND the entire `<Dialog>` JSX. Those mutations referenced the dialog state and will not compile once it is gone. The update mutation is re-introduced inside the pane in Task 2; the create + delete mutations are re-introduced in the parent in Task 4.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter local-app test -- pages/PromptsPage.spec`
Expected: PASS (auto-select + content shown).

- [ ] **Step 5: Commit**

```bash
git add apps/local-app/src/ui/pages/PromptsPage.tsx apps/local-app/src/ui/pages/PromptsPage.spec.tsx
git commit -m "refactor(prompts): replace dialog editor with split-view shell"
```

---

## Task 2: Editor pane — editing, dirty tracking, save with optimistic-lock handling

**Files:**
- Modify: `apps/local-app/src/ui/pages/PromptsPage.tsx`
- Modify: `apps/local-app/src/ui/pages/PromptsPage.spec.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `apps/local-app/src/ui/pages/PromptsPage.spec.tsx`. These tests override `global.fetch` per-test with explicit method+URL branches (the default `beforeEach` mock has no method discrimination and no `.status`).

```tsx
  it('edits content, marks dirty, and saves via PUT with the current version', async () => {
    const putCalls: any[] = [];
    global.fetch = jest.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = typeof input === 'string' ? 'GET' : input.method ?? 'GET';
      if (url.startsWith('/api/prompts?projectId')) {
        return { ok: true, json: async () => ({ items: [{ id: 'prompt-1', title: 'Prompt A', contentPreview: '', version: 3, tags: ['ops'] }] }) } as Response;
      }
      if (method === 'GET' && url === '/api/prompts/prompt-1') {
        return { ok: true, json: async () => ({ id: 'prompt-1', title: 'Prompt A', content: 'Prompt content', version: 3, tags: ['ops'] }) } as Response;
      }
      if (method === 'PUT' && url === '/api/prompts/prompt-1') {
        putCalls.push(JSON.parse(input.body));
        return { ok: true, json: async () => ({ id: 'prompt-1', title: 'Prompt A', content: 'new content', version: 4, tags: ['ops'] }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as any;

    render(<PromptsPage />, { wrapper: createWrapper() });
    const editor = await screen.findByRole('textbox', { name: /prompt content/i });
    await userEvent.clear(editor);
    await userEvent.type(editor, 'new content');

    const saveButton = await screen.findByRole('button', { name: /save/i });
    expect(saveButton).toBeEnabled();
    await userEvent.click(saveButton);

    await waitFor(() => expect(putCalls).toHaveLength(1));
    expect(putCalls[0].version).toBe(3);
    expect(putCalls[0].content).toBe('new content');
  });

  it('on 409 conflict, toasts and refetches while preserving user content', async () => {
    global.fetch = jest.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = typeof input === 'string' ? 'GET' : input.method ?? 'GET';
      if (url.startsWith('/api/prompts?projectId')) {
        return { ok: true, json: async () => ({ items: [{ id: 'prompt-1', title: 'Prompt A', contentPreview: '', version: 5, tags: ['ops'] }] }) } as Response;
      }
      if (method === 'GET' && url === '/api/prompts/prompt-1') {
        return { ok: true, json: async () => ({ id: 'prompt-1', title: 'Prompt A', content: 'Prompt content', version: 5, tags: ['ops'] }) } as Response;
      }
      if (method === 'PUT' && url === '/api/prompts/prompt-1') {
        return { ok: false, status: 409, json: async () => ({ code: 'optimistic_lock_error', message: 'version mismatch' }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as any;

    render(<PromptsPage />, { wrapper: createWrapper() });
    const editor = await screen.findByRole('textbox', { name: /prompt content/i });
    await userEvent.clear(editor);
    await userEvent.type(editor, 'my local edit');

    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText(/Someone else edited/i)).toBeInTheDocument();
    // User content is preserved after the conflict refetch.
    expect(editor).toHaveValue('my local edit');
  });

  it('fullscreen toggle hides the left rail', async () => {
    // Uses the default beforeEach fetch mock (seeds prompt-1 / 'Prompt A').
    render(<PromptsPage />, { wrapper: createWrapper() });
    expect(await screen.findByRole('button', { name: /^new$/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /enter fullscreen/i }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^new$/i })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /exit fullscreen/i })).toBeInTheDocument();
  });
```

> The conflict toast text "Someone else edited" must match the `onError` toast title in `updatePromptVersioned`'s mutation (set in Step 3). Adjust the string in one place if you rename it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter local-app test -- pages/PromptsPage.spec`
Expected: FAIL — no Save button / no conflict handling.

- [ ] **Step 3: Implement `PromptEditorPaneImpl`**

Replace the `PromptEditorPane` stub from Task 1 with the full implementation. The pane fetches its own detail, holds a local `draft`, and saves through a dedicated mutation that handles 409.

In `PromptsPage.tsx`, replace the stub `function PromptEditorPane(...)` block with:

```tsx
function PromptEditorPane({
  promptId,
  onDeleted,
  isFullscreen,
  onToggleFullscreen,
}: {
  promptId: string;
  onDeleted: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: detail } = useQuery({
    queryKey: ['prompt', promptId],
    queryFn: () => fetchPromptDetail(promptId),
  });

  const [draft, setDraft] = useState<PromptDetail | null>(null);
  useEffect(() => {
    if (detail) setDraft(detail);
  }, [detail, promptId]);

  const dirty =
    draft != null && detail != null && (draft.title !== detail.title || draft.content !== detail.content || JSON.stringify(draft.tags) !== JSON.stringify(detail.tags));

  const updateMutation = useMutation({
    mutationFn: (data: { id: string; payload: Partial<PromptDetail> & { version: number } }) =>
      updatePromptVersioned(data.id, data.payload, data.version),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prompts'] });
      queryClient.invalidateQueries({ queryKey: ['prompt', promptId] });
      toast({ title: 'Saved' });
    },
    onError: async (error: unknown) => {
      if (error instanceof OptimisticLockError) {
        toast({
          title: 'Someone else edited this prompt. Refetched. Your edits are preserved.',
          variant: 'destructive',
        });
        // Refetch to bump version; keep the user's draft content.
        const fresh = await fetchPromptDetail(promptId);
        setDraft((prev) => (prev ? { ...fresh, content: prev.content, title: prev.title, tags: prev.tags } : fresh));
        return;
      }
      toast({ title: 'Save failed', variant: 'destructive' });
    },
  });

  if (!draft) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const save = () => {
    updateMutation.mutate({
      id: promptId,
      payload: { title: draft.title, content: draft.content, tags: draft.tags, version: detail?.version ?? draft.version },
      version: detail?.version ?? draft.version,
    });
  };

  const discard = () => {
    if (detail) setDraft(detail);
  };

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex items-center gap-2">
        <Input
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          className="flex-1"
          aria-label="Prompt title"
        />
        <Button variant="ghost" size="icon" onClick={onToggleFullscreen} aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>
      </div>

      <TagInput
        tags={draft.tags}
        suggestions={[]}
        onAddTag={(t) => setDraft({ ...draft, tags: [...draft.tags, t] })}
        onRemoveTag={(t) => setDraft({ ...draft, tags: draft.tags.filter((x) => x !== t) })}
        onInputChange={() => {}}
      />

      <Textarea
        value={draft.content}
        onChange={(e) => setDraft({ ...draft, content: e.target.value })}
        className="flex-1 min-h-0 font-mono"
        aria-label="Prompt content"
      />

      {isFullscreen && (
        <aside className="text-xs text-muted-foreground border-t pt-2">
          <p className="font-medium mb-1">Variables</p>
          <ul className="grid grid-cols-2 gap-x-4">
            {PROMPT_VARIABLES.map((v) => (
              <li key={v.token}>
                <code>{v.token}</code> — {v.description}
              </li>
            ))}
          </ul>
        </aside>
      )}

      <div className="flex items-center justify-end gap-2">
        {dirty && <span className="h-2 w-2 rounded-full bg-yellow-500" aria-label="unsaved changes" />}
        <Button variant="ghost" onClick={discard} disabled={!dirty}>Discard</Button>
        <Button onClick={save} disabled={!dirty || updateMutation.isPending}>
          {updateMutation.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
```

Add the helper next to the existing ones at module scope (`fetchPromptDetail` was already added in Task 1):

```ts
async function updatePromptVersioned(
  id: string,
  data: Partial<PromptDetail>,
  version: number,
): Promise<PromptDetail> {
  const res = await fetch(`/api/prompts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...data, version }),
  });
  if (res.status === 409) {
    throw new OptimisticLockError('Prompt', id);
  }
  if (!res.ok) throw new Error('Failed to update prompt');
  return res.json();
}
```

Update the imports at the top — extend the existing `useQuery` import (added in Task 1) and add the error import:

```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { OptimisticLockError } from '@/common/errors/error-types';
```

> Verify the `OptimisticLockError` import path: it is exported from `apps/local-app/src/common/errors/error-types.ts`. If the `@/common/...` alias does not resolve in this file (other modules use a relative path), import via `../../common/errors/error-types`. The class is only used as a sentinel for `instanceof`; its constructor `(resource, identifier, details?)` is fine to call as `new OptimisticLockError('Prompt', id)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter local-app test -- pages/PromptsPage.spec`
Expected: PASS (save + conflict tests green).

- [ ] **Step 5: Commit**

```bash
git add apps/local-app/src/ui/pages/PromptsPage.tsx apps/local-app/src/ui/pages/PromptsPage.spec.tsx
git commit -m "feat(prompts): inline editor with explicit save + optimistic-lock handling"
```

---

## Task 3: Dirty guard on row switch

**Files:**
- Modify: `apps/local-app/src/ui/pages/PromptsPage.tsx`
- Modify: `apps/local-app/src/ui/pages/PromptsPage.spec.tsx`

- [ ] **Step 1: Write the failing test**

Append to `PromptsPage.spec.tsx`:

```tsx
  it('warns before switching rows when there are unsaved changes', async () => {
    global.fetch = jest.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.startsWith('/api/prompts?projectId')) {
        return {
          ok: true,
          json: async () => ({
            items: [
              { id: 'prompt-1', title: 'First Prompt', contentPreview: '', version: 1, tags: [] },
              { id: 'prompt-2', title: 'Second Prompt', contentPreview: '', version: 1, tags: [] },
            ],
          }),
        } as Response;
      }
      if (url === '/api/prompts/prompt-1' || url === '/api/prompts/prompt-2') {
        const isFirst = url === '/api/prompts/prompt-1';
        return {
          ok: true,
          json: async () => ({
            id: isFirst ? 'prompt-1' : 'prompt-2',
            title: isFirst ? 'First Prompt' : 'Second Prompt',
            content: 'body',
            version: 1,
            tags: [],
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as any;

    render(<PromptsPage />, { wrapper: createWrapper() });
    const editor = await screen.findByRole('textbox', { name: /prompt content/i });
    await userEvent.clear(editor);
    await userEvent.type(editor, 'unsaved');

    // Click the second prompt in the list.
    await userEvent.click(screen.getByText('Second Prompt'));

    expect(await screen.findByText(/Discard unsaved changes/i)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fail**

Run: `pnpm --filter local-app test -- pages/PromptsPage.spec`
Expected: FAIL — clicking the second row switches immediately with no prompt.

- [ ] **Step 3: Add the dirty guard**

The dirty state lives inside `PromptEditorPane`, so the parent cannot query it directly. Lift a `dirtySignal` via a ref callback. Ensure these imports are present in `PromptsPage.tsx` (add `useRef` to the React import; add `ConfirmDialog` to the shared import):

```tsx
import { useState, useEffect, useRef } from 'react';
import { ConfirmDialog } from '@/ui/components/shared';
```

In `PromptsPage.tsx` parent component, add:

```tsx
  const isDirtyRef = useRef(false);
  const [pendingSwitchId, setPendingSwitchId] = useState<string | null>(null);

  const selectRow = (id: string) => {
    if (isDirtyRef.current) {
      setPendingSwitchId(id);
    } else {
      setSelectedId(id);
    }
  };
```

Replace the left-rail `onClick={() => setSelectedId(p.id)}` with `onClick={() => selectRow(p.id)}`.

Pass the dirty signal into the pane:

```tsx
            <PromptEditorPane
              key={selectedSummary.id}
              promptId={selectedSummary.id}
              onDirtyChange={(d) => (isDirtyRef.current = d)}
              onDeleted={() => setSelectedId(null)}
              isFullscreen={isFullscreen}
              onToggleFullscreen={() => setIsFullscreen((v) => !v)}
            />
```

(Do the same for the fullscreen overlay pane.)

Inside `PromptEditorPane`, add the prop and an effect:

```tsx
  onDirtyChange,
}: { /* add */ onDirtyChange: (dirty: boolean) => void; /* ...rest */ },
  // ...
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
```

Add the confirm UI at the bottom of the parent's returned JSX (before the closing `</div>`):

```tsx
      <ConfirmDialog
        open={pendingSwitchId !== null}
        title="Discard unsaved changes?"
        description="Switching prompts will lose your unsaved edits."
        confirmText="Discard"
        cancelText="Cancel"
        onConfirm={() => {
          isDirtyRef.current = false;
          setSelectedId(pendingSwitchId);
          setPendingSwitchId(null);
        }}
        onOpenChange={(open) => { if (!open) setPendingSwitchId(null); }}
      />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter local-app test -- pages/PromptsPage.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/local-app/src/ui/pages/PromptsPage.tsx apps/local-app/src/ui/pages/PromptsPage.spec.tsx
git commit -m "feat(prompts): dirty guard before switching selected prompt"
```

---

## Task 4: Create (`+ New`) and Delete flows

**Files:**
- Modify: `apps/local-app/src/ui/pages/PromptsPage.tsx`
- Modify: `apps/local-app/src/ui/pages/PromptsPage.spec.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `PromptsPage.spec.tsx`:

```tsx
  it('creates a new prompt via + New and selects it', async () => {
    let createCalls = 0;
    let created = false;
    global.fetch = jest.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = typeof input === 'string' ? 'GET' : input.method ?? 'GET';
      if (method === 'POST' && url === '/api/prompts') {
        createCalls += 1;
        created = true;
        return { ok: true, json: async () => ({ id: 'new-1', title: 'Untitled', content: '', version: 1, tags: [] }) } as Response;
      }
      if (method === 'GET' && url === '/api/prompts/prompt-1') {
        return { ok: true, json: async () => ({ id: 'prompt-1', title: 'Prompt A', content: 'Prompt content', version: 1, tags: [] }) } as Response;
      }
      if (method === 'GET' && url === '/api/prompts/new-1') {
        return { ok: true, json: async () => ({ id: 'new-1', title: 'Untitled', content: '', version: 1, tags: [] }) } as Response;
      }
      // list reflects whether the create has happened yet
      if (url.startsWith('/api/prompts?projectId')) {
        const items = created
          ? [
              { id: 'prompt-1', title: 'Prompt A', contentPreview: '', version: 1, tags: [] },
              { id: 'new-1', title: 'Untitled', contentPreview: '', version: 1, tags: [] },
            ]
          : [{ id: 'prompt-1', title: 'Prompt A', contentPreview: '', version: 1, tags: [] }];
        return { ok: true, json: async () => ({ items }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as any;

    render(<PromptsPage />, { wrapper: createWrapper() });
    await screen.findByText('Prompt A');
    await userEvent.click(screen.getByRole('button', { name: /^new$/i }));

    await waitFor(() => expect(createCalls).toBe(1));
    // The new prompt becomes selected and its title loads into the editor.
    expect(await screen.findByDisplayValue('Untitled')).toBeInTheDocument();
  });

  it('deletes a prompt via the row delete button after confirm', async () => {
    let deletedId = '';
    global.fetch = jest.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = typeof input === 'string' ? 'GET' : input.method ?? 'GET';
      if (method === 'DELETE' && url.startsWith('/api/prompts/')) {
        deletedId = url.split('/').pop()!;
        return { ok: true, json: async () => ({}) } as Response;
      }
      if (method === 'GET' && url === '/api/prompts/prompt-1') {
        return { ok: true, json: async () => ({ id: 'prompt-1', title: 'Prompt A', content: 'Prompt content', version: 1, tags: [] }) } as Response;
      }
      if (url.startsWith('/api/prompts?projectId')) {
        return { ok: true, json: async () => ({ items: [{ id: 'prompt-1', title: 'Prompt A', contentPreview: '', version: 1, tags: [] }] }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as any;

    render(<PromptsPage />, { wrapper: createWrapper() });
    await screen.findByText('Prompt A');
    await userEvent.click(screen.getByRole('button', { name: /delete prompt a/i }));
    await userEvent.click(screen.getByRole('button', { name: /^confirm$/i }));
    await waitFor(() => expect(deletedId).toBe('prompt-1'));
  });
```

> The delete button's accessible name is `delete ${title}` (set via `aria-label` in Step 3), so query with `/delete prompt a/i`. The confirm button label is the raw `confirmText` value (`"Confirm"`) rendered by the `ConfirmDialog` mock at `PromptsPage.spec.tsx:16-43`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter local-app test -- pages/PromptsPage.spec`
Expected: FAIL — no delete button in the row; `+ New` is a no-op.

- [ ] **Step 3: Implement create + delete**

In the parent component, define fresh `createMutation` + `deleteMutation` (the original ones were removed in Task 1 because they referenced dialog state). `queryClient`, `toast`, `selectedProjectId`, `selectedId`, and `setSelectedId` are already in scope. Wire `handleCreate` (replacing the Task 1 stub):

```tsx
  const createMutation = useMutation({
    mutationFn: (data: { projectId: string; title: string; content: string; tags?: string[] }) =>
      createPrompt(data),
    onSuccess: (created: PromptDetail) => {
      queryClient.invalidateQueries({ queryKey: ['prompts', selectedProjectId] });
      setSelectedId(created.id);
      toast({ title: 'Prompt created' });
    },
    onError: () => toast({ title: 'Create failed', variant: 'destructive' }),
  });

  const handleCreate = () => {
    if (!selectedProjectId) return;
    createMutation.mutate({ projectId: selectedProjectId, title: 'Untitled', content: '' });
  };
```

Add a per-row delete affordance inside the left-rail `<li>` (after the title `<button>`), guarded so clicking delete does not also trigger row selection:

```tsx
                <button
                  type="button"
                  aria-label={`delete ${p.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPendingDeleteId(p.id);
                  }}
                  className="text-muted-foreground hover:text-destructive mt-1 text-xs"
                >
                  <X className="h-3 w-3 inline" /> Delete
                </button>
```

Add delete state + confirm dialog in the parent:

```tsx
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePrompt(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prompts', selectedProjectId] });
      if (pendingDeleteId === selectedId) setSelectedId(null);
      setPendingDeleteId(null);
      toast({ title: 'Prompt deleted' });
    },
  });
```

Add the delete confirm dialog next to the dirty-guard dialog:

```tsx
      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="Delete prompt?"
        description="This cannot be undone."
        confirmText="Confirm"
        cancelText="Cancel"
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={() => pendingDeleteId && deleteMutation.mutate(pendingDeleteId)}
        onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}
      />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter local-app test -- pages/PromptsPage.spec`
Expected: PASS.

- [ ] **Step 5: Run full lint + tests**

Run: `pnpm --filter local-app lint && pnpm --filter local-app test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add apps/local-app/src/ui/pages/PromptsPage.tsx apps/local-app/src/ui/pages/PromptsPage.spec.tsx
git commit -m "feat(prompts): inline create + delete with confirmation"
```

---

## Notes for the implementer

- The original `PromptsPage.tsx` (680 lines) has reusable module-scope helpers (`fetchPrompts`, `createPrompt`, `updatePrompt`, `deletePrompt`, `PROMPT_VARIABLES`, `TagInput`, `MarkdownPreview`). Keep all of them; only the component body + the dialog JSX are replaced.
- `ConfirmDialog` props (`open`, `onOpenChange`, `onConfirm`, `title`, `description`, `confirmText`, `cancelText`, `variant`, `loading`) — verified at `apps/local-app/src/ui/components/shared/ConfirmDialog.tsx:13-23`. The component auto-closes via `onOpenChange(false)` after `onConfirm` unless `loading` is true; this plan wires `onOpenChange` to clear the pending state on cancel.
- The existing spec mocks `ConfirmDialog` (at `PromptsPage.spec.tsx:16-43`) as a stub that renders the `title` plus two buttons labelled with the raw `cancelText`/`confirmText` prop values; it ignores `description`/`variant`/`loading`. Query by those exact strings. The mock's cancel button calls `onOpenChange(false)`; the confirm button calls `onConfirm()`.
- The existing `global.fetch` mock has no method discrimination and no `.status` field; the new tests re-set `global.fetch` per-test to add method/`status` branches (as shown in the test code).
- `OptimisticLockError` constructor: confirm signature in `apps/local-app/src/common/errors/error-types.ts`; if it takes different args, adapt.
