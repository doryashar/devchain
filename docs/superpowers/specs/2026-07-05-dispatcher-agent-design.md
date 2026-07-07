# Dispatcher Agent & Dispatch Status — Design Spec

> **Date:** 2026-07-05
> **Status:** Approved (pending written-spec review)
> **Scope:** Add a "Dispatcher" intake/triage agent and a "Dispatch" board status to both built-in templates, plus extend the template export schema so auto-assign rules can ship inside templates. The Dispatcher validates incoming epics against the repo's docs + code, surfaces the underlying user need, splits compound requests into independent tasks, and routes each to the Brainstormer or Architect.

---

## 1. Purpose

Today every new epic flows straight into `New` and is picked up by the Brainstormer (or Epic Manager in 3-agents-dev) as-is — raw, possibly vague, possibly compound, possibly out of scope. There is no intake gate.

The Dispatcher adds a **triage layer *before* planning**:

- **Relevance gate** — reject work that doesn't belong in this repo, with a cited reason.
- **Intent surfacing** — rephrase requests so each task carries the **underlying user need** (the real problem behind the literal ask), not just the WHAT.
- **Decomposition** — split compound requests into genuinely independent tasks.
- **Routing** — send each task to the right downstream agent by ambiguity.

It does **not** plan, design, or implement. It only triages and dispatches.

**Primary use cases:**
- A user drops a vague one-liner ("add dark mode") and wants it turned into an intent-revealing task.
- A user submits a compound request that is actually 3 unrelated changes.
- A user submits a request that doesn't fit the repo's goals and should be rejected with a clear reason.

---

## 2. Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Dispatcher team placement | **Standalone, no team** (like Code Reviewer) |
| Default status for new epics | **`New` stays the default** — `Dispatch` is opt-in via the create-form dropdown |
| Original epic fate (multi-task) | Create **independent top-level epics** in `New`, then **comment + move original to `Done`** |
| Original epic fate (single task) | **Rephrase in place** (same epic), move `Dispatch → New`, assign |
| Routing rule | **Ambiguity-based**: Brainstormer for exploration/design/open ambiguity; Architect for clear technical implementation path. Unsure → Brainstormer |
| Rejection flow | Move to **`Backlog`** with a **reason comment** citing docs/code |
| "Hidden intention" meaning | **Underlying user need** the request is a symptom of |
| Templates | **Both** `teams-dev.json` and `3-agents-dev.json` (3-agents-dev routes all to Brainstormer — no Architect present) |
| Implementation approach | **B — extend `ExportSchema` with `autoAssignRules[]`** so the `Dispatch → Dispatcher` rule ships pre-configured in the template |

---

## 3. Architecture & data flow

**No new backend modules.** Everything reuses existing infrastructure:

```
User creates epic, picks "Dispatch" status (opt-in)
  → auto-assign rule fires (status=Dispatch → Dispatcher)        [existing AutoAssignRulesService]
  → EpicAssignmentNotifierSubscriber delivers [Epic Assignment]   [existing subscriber]
  → Dispatcher loads profile (devchain_get_agent_by_name), runs SOP
      1. Read docs + code (devchain_list_documents, native Read/Grep/Glob)
      2. Validate: relevant ∧ aligned with repo intent ∧ real improvement/fix
      3a. FAIL → move Backlog + reason comment                    [auto-clean clears assignee]
      3b. PASS, single task → rephrase in place, move New, assign
      3c. PASS, multiple tasks → create independent epics in New + assign each,
          then comment + Done on original                          [auto-clean clears assignee]
```

Every primitive the flow needs already exists:
- `devchain_create_epic`, `devchain_update_epic`, `devchain_add_epic_comment` — MCP epic tools
- Auto-assign rule engine — `AutoAssignRulesService.resolveAssignment()`
- Auto-clean on `Backlog`/`Done` — clears `agentId` automatically
- Assignment notification — `EpicAssignmentNotifierSubscriber` fires on any `agentId` change

**No new MCP tools, no new events, no new subscribers, no new DB tables.**

---

## 4. Status layout

`Dispatch` sits between `Draft` and `New` — semantically "pre-triage". Existing statuses shift +1 in position.

| position | label | color | mcpHidden | change |
|----------|-------|-------|-----------|--------|
| 0 | Draft | #f5f5f5 | true | unchanged |
| **1** | **Dispatch** | **#17a2b8** (teal) | **false** | **NEW** |
| 2 | New | #6c757d | false | shifted from 1 |
| 3 | In Progress | #007bff | false | shifted from 2 |
| 4 | Review | #ffc107 | false | shifted from 3 |
| 5 | Done | #28a745 | false | shifted from 4 |
| 6 | Blocked | #dc3545 | false | shifted from 5 |
| 7 | Backlog | #6c757d | false | shifted from 6 |
| 8 | Archive | #000000 | true | shifted from 7 |

- `New` remains the **default** for the create form. `Dispatch` is opt-in via the status dropdown.
- `Dispatch` is **NOT** in `autoCleanStatusLabels` — it must preserve the assignee for the Dispatcher to receive the epic.
- Teal distinguishes it from the grey `New` and green `Done`.
- `mcpHidden: false` so the Dispatcher (and other agents) can see and select it.

---

## 5. The Dispatcher SOP (prompt content)

**Prompt title:** `Dispatcher — Intake & Triage SOP`
**Profile:** "Dispatcher", `familySlug: "dispatcher"`
**Instructions:** `[[prompt:Dispatcher — Intake & Triage SOP]]`

### Role
You are the **Dispatcher**, the intake and triage agent for this repo. You receive raw epic requests in `Dispatch` status, understand their true intention by studying the docs and code, decide whether they belong in this repo, and route them as well-formed, intent-revealing tasks to the right downstream agent.

**You do NOT plan, design, or implement. You triage and dispatch.**

### Trigger
You receive an `[Epic Assignment]` message for an epic in `Dispatch` status. That epic is a raw request — possibly vague, possibly compound, possibly out of scope.

### Step 1 — Understand the intention
Before judging the request, understand what the user actually needs:

1. Read the epic title + description carefully.
2. Call `devchain_list_documents` and read the repo's docs (README, `docs/`, `AGENTS.md`/`CLAUDE.md`) to understand what this repo IS and what it's trying to be.
3. Use your native file tools (Read, Grep, Glob) to inspect the code the request touches. You are building context to judge and phrase — not implementing.
4. Identify the **underlying user need**: what problem is this request actually solving? The literal ask may be a symptom; surface the real need. (e.g. "add dark mode" → underlying need: "reduce eye strain / enable night usage".)

### Step 2 — Validate relevance & alignment
Decide whether this request belongs here. **All three** must pass:

- **Relevant?** Does it touch this repo's actual surface area, or is it about an unrelated system/dependency?
- **Aligned with repo intent?** Does it move the repo toward its stated goals, or pull in a different direction?
- **A real improvement or fix?** Does it add genuine value or fix a real problem — not speculative or yak-shaving?

If **any** check fails → **Step 3a (reject)**.
If **all** pass → **Step 3b (dispatch)**.

### Step 3a — Reject (out of scope / misaligned)
1. `devchain_add_epic_comment` with a clear, specific reason: which check failed and why. Be concrete (cite docs/code), not generic.
2. `devchain_update_epic` → move to `Backlog` status. (Auto-clean clears your assignment.)
3. Stop. Do not create tasks.

### Step 3b — Dispatch (decompose + rephrase)

**Decompose:** Determine if the request is actually multiple **unrelated** tasks masquerading as one. Unrelated = they solve different needs, touch different parts of the code, and could be done independently. If the request is one coherent task, skip decomposition (single-task path).

For **each** task (whether 1 or many):
- **Surface the underlying need** — the task must carry the WHY, not just the WHAT. A downstream agent reading only the task should understand the real problem, not have to re-discover it.
- **Phrase it as a self-contained task** — clear title + description including the need, the relevant context you found in docs/code, and the suggested direction. Do not leave the downstream agent guessing.

**Single-task path (one coherent task, no decomposition):**
- `devchain_update_epic` on the **same** epic: update its title + description to add the underlying need + context. **Do not create a new epic.**
- Move it `Dispatch → New`.
- Assign by routing (below).

**Multi-task path (decomposition into unrelated tasks):**
- For each task: `devchain_create_epic` with status `New`, an intent-revealing title + description, and the assignment per routing. These are **independent top-level epics** — no parent link, no `parentId`.
- After **all** tasks are created: `devchain_add_epic_comment` on the original `Dispatch` epic with a summary of what you dispatched (list the created task titles).
- `devchain_update_epic` → move the original to `Done`. (Auto-clean clears your assignment.)

### Routing (Brainstormer vs Architect)
Assign each output task by ambiguity:

- **Brainstormer** — the task needs exploration, design, or has open ambiguity. "Should we add X?", "how should we handle Y?", new features, product/UX questions, anything where the path isn't clear.
- **Architect** — the task has a clear technical implementation path. Refactors, well-defined fixes, "change X to Y", performance work where the approach is known.
- **Unsure → Brainstormer.** It can pull in the Architect via the existing §1.5 validation loop.
- **3-agents-dev (no Architect available):** always route to **Brainstormer**.

### Constraints
- Never implement, plan, or design solutions. You triage and phrase — that's it.
- Never create tasks in any status other than `New`.
- Never assign to anyone other than the Brainstormer or Architect (3-agents-dev: Brainstormer only).
- Every output task MUST include the underlying need. A task without the WHY is a failed dispatch.
- Rejection comments must cite docs/code so the human can verify your reasoning.

### Tools
- `devchain_get_agent_by_name` — load your own profile (run first)
- `devchain_get_epic_by_id` — load the epic you were assigned
- `devchain_list_documents` + native Read/Grep/Glob — understand the repo
- `devchain_update_epic` — rephrase in place, move status, assign
- `devchain_create_epic` — create independent output tasks (multi-task path)
- `devchain_add_epic_comment` — rejection reason, or dispatch summary

---

## 6. ExportSchema extension

`ExportSchema` (`packages/shared/src/schemas/export-schema.ts`) currently has no field for auto-assign rules — they can't ship inside templates. This spec adds one.

### 6.1 New field: `autoAssignRules[]`

Mirrors the existing portability pattern (labels/names, not raw IDs — same as `teams[]` uses `teamLeadAgentName`/`memberAgentNames`, and `projectSettings.autoCleanStatusLabels` uses labels):

```ts
autoAssignRules: z.array(
  z.object({
    matchType: z.enum(['status', 'tag']),
    statusLabel: z.string().nullable().optional(),     // required when matchType='status'
    tags: z.array(z.string()).nullable().optional(),   // required (non-empty) when matchType='tag'
    targetType: z.enum(['agent', 'team']),
    targetAgentName: z.string().nullable().optional(), // required when targetType='agent'
    targetTeamName: z.string().nullable().optional(),  // required when targetType='team'
    overrideExisting: z.boolean().optional().default(false),
    enabled: z.boolean().optional().default(true),
  }).strict(),
).optional().default([])
```

### 6.2 DTO validation (Zod, in-schema)

- `matchType='status'` ⟹ `statusLabel` required.
- `matchType='tag'` ⟹ `tags` required and non-empty.
- `targetType='agent'` ⟹ `targetAgentName` required.
- `targetType='team'` ⟹ `targetTeamName` required.
- Referential integrity (the named status/agent/team actually exist in this template/project) is **resolved at import**, not enforced by the DTO.

### 6.3 Import logic

In the existing template-import path, **after** statuses, agents, and teams are created (so labels/names can be resolved to IDs):

1. Iterate `autoAssignRules[]` in order.
2. For each rule:
   - Resolve `statusLabel → statusId` (lookup in the just-imported statuses for this project).
   - Resolve `targetAgentName → agentId` OR `targetTeamName → teamId`.
   - **Skip-with-warning** any rule whose reference didn't resolve (a status/agent/team name in the template that doesn't exist in the target project). This matches the stale-tolerance of the rest of the importer. Log the skip; do not fail the whole import.
3. Create via the existing `AutoAssignRulesService.create({ projectId, matchType, statusId, tags, targetType, targetAgentId, targetTeamId, overrideExisting, enabled, priority })`. Assign `priority` sequentially by array order (array index = priority), so template authors control ordering top-to-bottom.

No new endpoint — `POST /api/auto-assign-rules` already exists and the service layer is reused.

### 6.4 Export logic (round-trip)

When exporting a project to template format, reverse-map each `epic_assignment_rules` row:
- `statusId → status.label`
- `targetAgentId → agent.name`
- `targetTeamId → team.name`
- Preserve `priority` order in the array.

This keeps export→import→export stable and lets users author templates by exporting an existing configured project.

---

## 7. Template additions (both templates)

Applied to **both** `apps/local-app/templates/teams-dev.json` and `apps/local-app/templates/3-agents-dev.json`:

1. **New status** `Dispatch` at position 1; renumber all existing statuses' positions +1.
2. **New prompt** titled `Dispatcher — Intake & Triage SOP` with the §5 content.
3. **New profile** `Dispatcher`:
   - `familySlug: "dispatcher"`
   - `instructions: "[[prompt:Dispatcher — Intake & Triage SOP]]"`
   - `providerConfigs` matching the shape used by the other profiles in that template (same provider set, so presets can target it).
4. **New agent** `Dispatcher` referencing that profile. **Standalone — no `teams[]` entry** (same pattern as Code Reviewer in `teams-dev.json`).
5. **New auto-assign rule** in the template's new `autoAssignRules[]` field:
   ```json
   {
     "matchType": "status",
     "statusLabel": "Dispatch",
     "targetType": "agent",
     "targetAgentName": "Dispatcher",
     "overrideExisting": false,
     "enabled": true
   }
   ```
6. **Presets** — every existing preset in `teams-dev.json` gets a `Dispatcher` agentConfig entry. Recommended tier: match the **Epic Manager**'s tier (both are management/triage roles — cheap-ish is fine; top-tier models are not needed for triage). For `3-agents-dev.json` presets, add the same.
7. **`autoCleanStatusLabels` unchanged** — `Dispatch` is deliberately NOT added (it must preserve the assignee).

### 7.1 teams-dev specifics
- Dispatcher is a standalone agent alongside Brainstormer, Architect, Epic Manager, Code Reviewer.
- The Planning team (`Brainstormer` lead, `Architect` member) is **unchanged**. The Dispatcher is not a member.
- Routing in the SOP already references both Brainstormer and Architect — works as-is.

### 7.2 3-agents-dev specifics
- The template has Brainstormer, SubBSM, Coder — **no Architect**.
- The SOP's routing clause ("3-agents-dev: always Brainstormer") handles this. No template-side branching needed beyond the agent existing.
- The `Dispatcher` profile + agent + status + rule are added identically.

---

## 8. Edge cases

| Case | Handling |
|---|---|
| Epic created directly in `Dispatch` by an agent (not a human) | Same flow — auto-assign rule fires regardless of actor. Fine. |
| Dispatcher rejects an epic the user strongly expected to be done | User sees the Backlog move + reason comment and can re-open / rephrase. Rejection is reversible. |
| Multi-task dispatch where one created task fails to save | SOP must create tasks sequentially; if a `devchain_create_epic` errors, the SOP retries/surfaces it. The original stays in `Dispatch` until the Dispatcher completes the Done step (idempotent enough — partial dispatch leaves the original open). |
| `Dispatch` status deleted by user post-import | Auto-assign rule becomes stale → rendered with "invalid" badge, skipped at fire time (existing behavior). No special handling. |
| `Dispatcher` agent deleted by user post-import | Same — rule is stale, skipped, badged "invalid". |
| Template import into a project that already has a `Dispatch` status / `Dispatcher` agent | Importer's existing dedup-by-name behavior applies (status labels and agent names are unique per project). Rule resolves to the existing entity. |
| Auto-clean list edited to include `Dispatch` | The auto-assign rule would still fire on create (auto-clean runs first; on a fresh epic there's no assignee to clear, so the rule then assigns the Dispatcher). But on a status *change* into `Dispatch`, auto-clean would clear the assignee and suppress the rule (auto-clean wins per §2.1 of the auto-assign spec). Document this; do not add `Dispatch` to auto-clean by default. |

---

## 9. Non-goals

Out of scope for this iteration:

- A dedicated MCP tool for the Dispatcher (it uses the existing epic tools).
- Dispatcher-specific event logging or an audit/triage view in the UI.
- Round-robin or load-balanced routing (Brainstormer/Architect are single agents, not pools).
- Auto-promoting epics from `New` into `Dispatch` (Dispatch is opt-in only).
- Making the Dispatcher a team or a team lead.
- UI changes to the board beyond the new status column appearing automatically (the board already renders whatever statuses exist).
- Changing the Brainstormer's SOP to know about the Dispatcher (the Brainstormer doesn't care where `New` tasks came from — its behavior is unchanged).

---

## 10. Testing strategy

Per the repo rule "for every feature added, add a dedicated test that validates it and run the test".

- **`ExportSchema` unit test** — `autoAssignRules[]` parses correctly, defaults to `[]`, and rejects malformed combos (e.g. `matchType='status'` without `statusLabel`; `targetType='team'` without `targetTeamName`). File: alongside the existing schema tests.
- **Import logic test** — given a template payload with `autoAssignRules[]`, the importer resolves labels/names to IDs, creates rules via `AutoAssignRulesService.create` in array order, and **skips-with-warning** rules whose referenced status/agent/team don't exist. Verify priority assignment by array index.
- **Export round-trip test** — export a project with a known rule → re-import → re-export → assert stable equivalence.
- **Template smoke test** — both `teams-dev.json` and `3-agents-dev.json` pass `ExportSchema.parse`; assert the `Dispatch` status (position 1, `mcpHidden: false`), the `Dispatcher` agent, the `Dispatcher` profile referencing `[[prompt:Dispatcher — Intake & Triage SOP]]`, the SOP prompt itself, and the `autoAssignRules[]` entry cross-referencing `statusLabel: "Dispatch"` and `targetAgentName: "Dispatcher"` are all present and consistent.
- **`AutoAssignRulesService` regression** — add one case: a `status` rule targeting the Dispatcher agent fires and assigns correctly (guards the new default rule). The existing test matrix already covers the engine's general behavior.
- **Dispatcher SOP** — a prompt, not directly unit-testable; the template smoke test verifies it is present, referenced by the profile, and embeddable via `[[prompt:...]]`.

No new characterization tests — the existing `epic-assignment-notifier` / `mcp.service.dispatch` characterization specs are untouched because this feature adds **no new events and no new MCP tools**.

---

## 11. Open items (deferred to implementation plan)

- Exact provider config block for the `Dispatcher` profile in each template (copy from the Epic Manager profile in `teams-dev.json` and from the Brainstormer profile in `3-agents-dev.json`).
- Which preset tier each template's Dispatcher agentConfig points at (recommendation: match Epic Manager in teams-dev; match Brainstormer in 3-agents-dev).
- Whether to bump a template `version` field or manifest entry to signal the new agent/status (follow whatever convention the last template change used).
- Migration: **none needed** — statuses/rules are per-project data seeded from templates, not global schema. Existing projects are unaffected unless the user re-imports a template.
- Confirm the exact import code path file/function to hook (the implementation plan will locate the spot where statuses/agents/teams are committed and add the rules loop immediately after).
