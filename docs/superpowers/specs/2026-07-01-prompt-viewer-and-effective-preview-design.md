# Prompt Viewer & Effective-Prompt Preview — Design Spec

> **Date:** 2026-07-01
> **Status:** Approved
> **Scope:** Two UX changes that make agent instructions visible without opening a modal: (1) rework `PromptsPage` into an always-visible split-view editor; (2) add a read-only, byte-accurate "Effective prompt" preview to agent profile details.

---

## 1. Purpose

Today, viewing or editing a prompt's content requires clicking **Edit** to open a modal dialog (`PromptsPage.tsx`). And an agent profile's `instructions` field shows a *reference* like `[[prompt:Worker AI - Task Execution SOP]]` — never the actual content the agent receives.

This spec removes both frictions:

- **PromptsPage** becomes a persistent list + editor so content is always visible, scrollable, and directly editable, with a one-click fullscreen expand.
- **ProfilesPage** shows the *effective* prompt (references resolved) so a user can read what the agent actually receives at session start, and surfaces a silent footgun (assigned-but-unreferenced prompts that never reach the agent).

**Primary use cases:**
- Browse and read long SOP prompts without opening a dialog.
- Inline-edit prompt content quickly, with a fullscreen mode for long-form editing.
- Inspect an agent to see exactly what instructions it will execute, including the real resolution quirks (free-text drop, dedup, byte cap).

---

## 2. Key constraints discovered (shape the design)

These are verified facts of the current system; the design must respect them.

1. **Effective prompt comes ONLY from `profile.instructions`.** The `agent_profile_prompts` junction table (`orderedPromptIds`) is **metadata only** — it is not merged into what the agent receives. Verified: `agent-tools.ts:166-193` (`handleGetAgentByName`) resolves only `profile.instructions`; the junction is never read on the resolution path.
2. **Free-text around a `[[...]]` reference is silently dropped.** If `instructions = "Preamble\n[[prompt:SOP]]\nFooter"` and `SOP` resolves, the agent receives *only* the SOP snippet — "Preamble"/"Footer" vanish. Source: `instructions-resolver.ts:78` (`contentMd = refContent.trim() ? refContent : instructions`).
3. **Resolution is by title**, case-insensitive exact match, project-scope then global. Source: `instructions-resolver.ts:332` (`loadPromptByTitle`).
4. **Resolver caps:** `maxDocuments = 10` (docs + prompts combined), `maxBytes = 64 * 1024`, dedup per-category (prompt title / doc slug / tag key), UTF-8-safe truncation by code point. Source: `instructions-resolver.ts:34-35`, `:107-109`.
5. **Two distinct variable scopes** exist at the two resolution sites. For a profile-instructions preview, the **MCP scope** applies (`agent_name`, `project_name`, `team_name`, `team_names`, `is_team_lead`). `session_id`, `epic_title`, etc. are NOT available in this scope. Source: `agent-tools.ts:160-164` vs. `session-launch-pipeline.service.ts:498-510`.
6. **`profile.systemPrompt` is vestigial** — stored but never read by any resolver. Not surfaced in this design.
7. **`InstructionsResolver` is a pure, injectable class** taking `DocumentStorage & PromptStorage`. The only way to produce a byte-accurate preview is to reuse it; client-side re-derivation would drift (dedup, caps, Handlebars rendering, free-text drop).

---

## 3. Behavior (decisions)

| Decision | Choice |
|---|---|
| **PromptsPage layout** | Split view: left rail (list) + right pane (full-height scrollable editor). Replaces list+modal. |
| **Selection model** | Single selection. First prompt selected by default when the page loads (if any). |
| **Editing model** | Direct, in-place. No "Edit" button, no modal. |
| **Save semantics** | **Explicit Save** button (with dirty indicator). Debounce is NOT used. |
| **Optimistic locking** | Save passes current `version`; on `OptimisticLockError` → toast + refetch, preserve user input in a buffer for re-save. |
| **"Gets large" interaction** | Fullscreen toggle on the editor pane: hides left rail, textarea fills the page. Toggle to return. |
| **Dirty guard** | Switching rows or toggling fullscreen while dirty → confirm-discard prompt. |
| **Effective-prompt preview** | Read-only, backend-resolved via real `InstructionsResolver` (MCP-scope vars). |
| **Editing effective prompt** | NOT in profiles. Editing stays in PromptsPage (canonical source). |
| **Footgun surfacing** | Preview lists junction-assigned prompts NOT referenced inline (`unreferencedAssigned`) as a warning. |
| **Reused APIs** | `/api/prompts` (unchanged). New `/api/profiles/:id/effective-prompt`. |

---

## 4. Change 1 — `PromptsPage` split-view rework

### 4.1 Layout

```
┌─ PageHeader: "Prompts" ──────────────────────────────────────────┐
├──────────────┬───────────────────────────────────────────────────┤
│ [+ New]      │ [title input]  [fullscreen ⇲]                      │
│ ───────────  │ [tag editor chips]                                 │
│ ▸ Worker AI  │ ─────────────────────────────────────────────────  │
│   SOP        │                                                    │
│ ▸ Epic Master│  <Textarea full-height, scrollable, monospace>     │
│   SOP        │  ...actual prompt content, editable...             │
│ ▸ Code       │                                                    │
│   Reviewer   │                                                    │
│   (tag chip) │                                                    │
│ ...          │ [Discard]              [Save] (dirty ●)            │
└──────────────┴───────────────────────────────────────────────────┘
```

- **Left rail (~280px):** scrollable list. Each row: prompt title (truncated) + up to 2 tag chips. Row actions: delete (with `ConfirmDialog`). Header: `[+ New]` button (creates a prompt then selects it).
- **Right pane (fills remaining width):**
  - Top: title text input, fullscreen toggle icon button, tag editor (reuse existing `TagInput` pattern from current `PromptsPage.tsx:140-233`).
  - Middle: full-height `<Textarea>` (`font-mono`, scrollable), bound to selected prompt `content`.
  - Bottom: `[Discard]` and `[Save]` actions. `Save` shows a dirty dot when there are unsaved changes; disabled when not dirty.
- **Empty states:**
  - No project selected → centered empty state (matches today's behavior).
  - Project selected but no prompts → empty list with a prominent "Create your first prompt" CTA in the right pane.
- **Responsive:** on narrow viewports, the split stacks (list collapses to a dropdown or a top bar) following the existing `SubNavLayout` stacking convention.

### 4.2 Selection & dirty state

- Local state: `selectedId`, `draft` (a working copy of the selected prompt), `dirty` (draft ≠ persisted).
- Switching rows with unsaved draft → `ConfirmDialog` ("Discard unsaved changes?").
- Toggling fullscreen with unsaved draft → no prompt (draft is preserved, just the layout changes).
- After successful save: `dirty = false`, refetch list (title may have changed), keep selection.

### 4.3 Save & conflict handling

- `Save` → `PUT /api/prompts/:id` with `{ title, content, tags, version: draft.version }`.
- Success → toast "Saved", update local `version`, invalidate `['prompts', projectId]`.
- `OptimisticLockError` (HTTP 409) → toast "Someone else edited this prompt. Refetched. Your edits are preserved." Refetch, bump `version`, keep the user's `draft.content` in the buffer so they can re-save.

### 4.4 Create / delete

- **Create:** `[+ New]` → POST with a default title "Untitled", empty content → select the new row and focus the title input.
- **Delete:** row delete icon → `ConfirmDialog` → DELETE → on success remove from list; if the deleted row was selected, select the next row (or none).

### 4.5 Reuse / cleanup

- Reuse the inline `PROMPT_VARIABLES` sidebar help (`PromptsPage.tsx:43-51`) — render it beside/below the editor in fullscreen mode.
- Extract a `usePrompts(projectId)` hook (query + create/update/delete mutations + toasts) modeled on `useSettingsData`. Replaces the inline fetch logic in `PromptsPage.tsx:247-374`. (Optional but recommended cleanup — see §8.)
- No new backend; existing `/api/prompts` CRUD is sufficient.

---

## 5. Change 2 — Effective-prompt preview in `ProfilesPage`

### 5.1 New backend endpoint

**`GET /api/profiles/:profileId/effective-prompt`**

- Returns the byte-accurate effective prompt for the profile by reusing the real `InstructionsResolver`. **Profile-scoped** (not agent-scoped): the `ProfilesPage` edit dialog edits a profile (`editingProfile: AgentProfile` at `ProfilesPage.tsx:936`) and no `agentId` is in scope (a profile only carries `agentCount`). The endpoint keys on `profileId` and resolves `agent_name` internally.
- The handler loads the profile (with its junction prompts via `getAgentProfileWithPrompts`), resolves `agent_name` from the first agent using that profile (`listAgents(projectId)` then filter by `profileId`), falling back to the profile name, then resolves `instructions`.
- Implementation reuses, verbatim:
  - `InstructionsResolver.resolve(projectId, profile.instructions, { maxBytes, render: { vars, legacyVariables } })` (`instructions-resolver.ts:49`).
  - `loadAgentRecipientContext` (`agent-recipient-context.ts:13`) for the MCP-scope team variable set (`team_name`, `team_names`, `is_team_lead`), using the resolved agent's id (empty team context when no agent uses the profile).
  - `agent_name`/`project_name` are added to `renderVars` directly (mirroring `agent-tools.ts:160-170`).

**Response shape:**

```ts
interface EffectivePromptResponse {
  contentMd: string;            // resolved, rendered, truncated-to-maxBytes
  truncated: boolean;           // true if the 64KB cap was hit
  maxBytes: number;             // 64 * 1024
  references: Array<{           // one per inline [[prompt:Title]] encountered
    title: string;
    resolved: boolean;          // false if lookup failed (project + global)
  }>;
  unreferencedAssigned: Array<{ // footgun: junction prompts NOT referenced inline
    title: string;
  }>;
}
```

**Semantics:**
- `references` mirrors the left-to-right order of inline references (dedup applies: each title once).
- `unreferencedAssigned` = prompts in `agent_profile_prompts` for this profile whose titles do NOT appear as a `[[prompt:Title]]` reference in `instructions`. This is the silent footgun the preview exposes.
- For a profile with empty `instructions`: `{ contentMd: "", truncated: false, references: [], unreferencedAssigned: [...] }`.

### 5.2 Frontend

- In the profile edit dialog, add an **"Effective prompt"** section (collapsible block alongside the existing `instructions` editor), driven by `editingProfile.id`.
- Renders `contentMd` read-only via the shared `MarkdownRenderer` (`apps/local-app/src/ui/components/shared/MarkdownRenderer.tsx`). A toggle to switch to a monospace raw view is optional.
- **Banners:**
  - If `truncated` → yellow banner: "Effective prompt was truncated at 64 KB."
  - If `references` contains any `{ resolved: false }` → red banner listing the unresolved titles: "Unresolved references (prompt not found)."
  - If `unreferencedAssigned.length > 0` → orange warning banner: "These assigned prompts are not referenced inline and won't reach the agent:" + the title list. (This is the key footgun surfacing.)
- **Editing:** none here. A line under the preview: "Edit these in PromptsPage." The existing `instructions` editor (the `[[prompt:...]]` field) remains separate and is where references are added/removed.

### 5.3 Wiring `InstructionsResolver` into the profiles module

`InstructionsResolver` is currently `new`-constructed inside `McpService` (`mcp.service.ts:155-159`) and held `private readonly`. To reuse it from the profiles module **without coupling to `McpFullModule`** (which has heavy `forwardRef` imports):

- Add a self-contained `ProfileInstructionsService` in the profiles module that constructs its own `InstructionsResolver` the same way `McpService` does: `new InstructionsResolver(storage, (doc, cache, depth, bytes) => buildInlineResolution(storage, doc, cache, depth, bytes))`, importing `buildInlineResolution` from `mcp/services/utils/document-link-resolver`.
- `ProfilesController` injects `ProfileInstructionsService` + `TeamsService` (profiles module imports `TeamsModule`) and exposes `getResolver()`.
- `McpService` is untouched; no shared-provider refactor needed (minimal blast radius).

This is a non-functional refactor that unlocks reuse; behavior of existing MCP resolution is unchanged (covered by existing `instructions-resolver.spec.ts`).

---

## 6. Edge cases

| Case | Handling |
|---|---|
| No project selected (PromptsPage) | Empty state, no list, no editor. |
| Project has zero prompts | List empty; right pane CTA "Create your first prompt". |
| Dirty draft + row switch | `ConfirmDialog` to discard. |
| Dirty draft + route away | `beforeunload`-style confirm via React Router's navigation blocker (match existing pattern if present; else a simple confirm). |
| Optimistic lock on save | 409 → toast + refetch + preserve user content buffer. |
| Profile with no `instructions` | Effective-prompt returns empty `contentMd`; preview shows "This agent's profile has no instructions." |
| Profile `instructions` has a `[[prompt:Title]]` with no match | `references[i].resolved = false`; red banner. |
| Junction has assigned prompts not referenced | `unreferencedAssigned` populates; orange banner. |
| Effective prompt hits 64 KB | `truncated = true`; yellow banner. |
| Effective-prompt endpoint called for a profile attached to no agent | `agent_name` falls back to profile name; `team_*` values are empty. |

---

## 7. Testing (per project rule: dedicated tests per feature)

### 7.1 Backend
- `profiles.controller.spec.ts` — new tests on the effective-prompt handler:
  - Returns resolved `contentMd` identical to what `InstructionsResolver.resolve` produces for a known `instructions` string (parity test).
  - `unreferencedAssigned` correctly lists junction prompts whose titles are absent from inline references.
  - `references` marks a missing title as `resolved: false`.
  - `truncated` is true when content exceeds `maxBytes`.
  - Empty `instructions` → empty `contentMd`, empty `references`.
- Existing `instructions-resolver.spec.ts` must remain green (refactor must not change resolver behavior).

### 7.2 Frontend
- `PromptsPage.spec.tsx` — rework/extend:
  - First prompt auto-selected on load.
  - Editing + Save → calls `PUT /api/prompts/:id` with correct `version`; success toast; dirty flag clears.
  - Optimistic-lock 409 → toast + refetch + buffer preserved.
  - Fullscreen toggle hides the left rail.
  - Switching rows while dirty shows the discard confirm.
  - Create via `[+ New]` and Delete via row action work and update selection.
- `ProfilesPage.spec.tsx` — add:
  - "Effective prompt" section renders `contentMd`.
  - `unreferencedAssigned` renders the orange warning with titles.
  - `truncated` renders the yellow banner; unresolved references render the red banner.

---

## 8. Non-goals (YAGNI)

- Editing the canonical template files (`templates/*.json`) from the UI. (DB is the runtime source of truth; templates seed only at project creation.)
- Resolving effective prompt client-side.
- Auto-save / debounced save for prompts (explicit Save chosen for predictability + optimistic-lock clarity).
- Unifying PromptsPage + ProfilesPage + initial-session-prompt picker into a single "Instructions" page. (Follow-up if desired.)
- Surfacing the launch-site variable scope (`session_id`, `epic_title`) in the preview — out of scope; MCP scope only.
- Making `profile.systemPrompt` editable/visible (vestigial field).

---

## 9. File map (planned touch points)

| File | Change |
|---|---|
| `apps/local-app/src/ui/pages/PromptsPage.tsx` | Rework to split view (list + editor + fullscreen). |
| `apps/local-app/src/ui/hooks/usePrompts.ts` | NEW — extracted query+mutations hook (mirrors `useSettingsData`). |
| `apps/local-app/src/ui/hooks/useEffectivePrompt.ts` | NEW — `useQuery(['effective-prompt', profileId])`. |
| `apps/local-app/src/ui/pages/ProfilesPage.tsx` | Add read-only Effective-prompt preview section + banners. |
| `apps/local-app/src/modules/profiles/controllers/profiles.controller.ts` | NEW `GET /:id/effective-prompt`. |
| `apps/local-app/src/modules/profiles/profiles.module.ts` | Register `ProfileInstructionsService`; import `TeamsModule`. |
| `apps/local-app/src/modules/profiles/services/profile-instructions.service.ts` | NEW — constructs `InstructionsResolver` (mirrors `mcp.service.ts:155-159`). |
| `apps/local-app/src/modules/mcp/mcp.service.ts` | Unchanged (no refactor). |
| `apps/local-app/src/modules/profiles/controllers/profiles.controller.spec.ts` | NEW effective-prompt tests. |
| `apps/local-app/src/ui/pages/PromptsPage.spec.tsx`, `ProfilesPage.spec.tsx` | New/updated tests per §7. |
| `docs/instructions-viewer.md` | NEW — user-facing doc (per repo convention to document features). |

---

## 10. Implementation details (resolved in the plan)

- **Dirty + route-away:** not handled via a router blocker. The dirty guard is a row-switch confirm only (matching the existing UI's simplicity). See Plan 1 Task 3.
- **`ProfilesPage` details surface:** it is a shadcn `<Dialog>` (`ProfilesPage.tsx:1325`); the preview is a block inside that dialog, driven by `editingProfile.id`.
- **Resolver placement:** a self-contained `ProfileInstructionsService` in the profiles module (no `McpFullModule` coupling, no shared-provider refactor) — see Plan 2 Task 1.
