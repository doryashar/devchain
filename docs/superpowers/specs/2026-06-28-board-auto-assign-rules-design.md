# Board Auto-assign Rules — Design Spec

> **Date:** 2026-06-28
> **Status:** Approved
> **Scope:** Per-board (per-project) rules that auto-assign epics to an agent or team when the epic is created or moves to a status.

---

## 1. Purpose

Auto-assign rules eliminate manual click-to-assign for predictable workflow stages. A project owner configures rules like "when an epic moves to **Review**, assign it to **Code Reviewer**" or "when an epic is tagged **frontend**, assign it to **Frontend Coder**". Agents then pick the epic up through the existing assignment-notification flow without a human dispatcher.

**Primary use cases:**
- Route work to the right agent/team automatically as epics cross workflow stages
- Ensure tagged specialist work (e.g. `frontend`, `security`) reaches the specialist
- Reduce latency between status change and assignment for agent-driven workflows

---

## 2. Behavior (decisions)

| Decision | Choice |
|---|---|
| **Matcher per rule** | One matcher: **status XOR tag** |
| **Tag matching** | Rule stores a **list of tags**; matches if the epic has **any** of them |
| **Target** | Per rule: an **agent** or a **team** |
| **Team resolution** | Team target resolves to `team.teamLeadAgentId` at fire time |
| **Triggers** | Epic **create** + epic **status change** only. Tag edits do **not** re-fire |
| **Override** | Per-rule flag, default **off** → skip if epic already has an assignee. Irrelevant on create (new epics are unassigned) |
| **Auto-clean interaction** | Auto-clean **wins**: if the target status is an auto-clean status, the rule **skips** (agentId is cleared as today) |
| **Conflict resolution** | **First matching rule in user-defined priority order wins.** (With status-XOR-tag there are no specificity tiers.) |

### 2.1 Fire-time algorithm

On epic create or status change, after the existing auto-clean logic runs:

1. If the target status is in the project's `autoCleanStatusIds` → **stop** (auto-clean already cleared `agentId`; do not auto-assign).
2. Load enabled rules for the project, ordered by `priority` ascending.
3. For each rule, in order:
   - **Status rule**: matches if `rule.statusId === epic.statusId`.
   - **Tag rule**: matches if `epic.tags` intersects `rule.tags`.
   - If the rule matches:
     - If `epic.agentId` is already set **and** `rule.overrideExisting === false` → continue to next rule (this rule declines).
     - Otherwise this rule **wins**. Resolve the target:
       - Agent target → `rule.targetAgentId`.
       - Team target → look up team, use `team.teamLeadAgentId`. If the team has no lead, or the referenced team/agent no longer exists → **rule declines** (continue to next rule; log a warning).
     - Set `epic.agentId` to the resolved value. **Stop.**
4. If no rule wins, `agentId` is left unchanged (whatever auto-clean or the caller set).

---

## 3. Data model

New table `epic_assignment_rules` — one row per rule.

| column | type | notes |
|---|---|---|
| `id` | TEXT PK | uuid |
| `projectId` | TEXT FK → projects | indexed |
| `matchType` | TEXT | `'status'` \| `'tag'` |
| `statusId` | TEXT NULL | required when `matchType = 'status'` |
| `tags` | JSON NULL | string array; required when `matchType = 'tag'` |
| `targetType` | TEXT | `'agent'` \| `'team'` |
| `targetAgentId` | TEXT NULL | required when `targetType = 'agent'` |
| `targetTeamId` | TEXT NULL | required when `targetType = 'team'` |
| `overrideExisting` | INTEGER BOOLEAN | default `0` |
| `priority` | INTEGER | lower fires first; user-reorderable |
| `enabled` | INTEGER BOOLEAN | default `1` |
| `createdAt` | TEXT | ISO timestamp |
| `updatedAt` | TEXT | ISO timestamp |

**Constraints:**
- Exactly one of `statusId` / `tags` is set, consistent with `matchType` (enforced in DTO validation, not by DB CHECK).
- Exactly one of `targetAgentId` / `targetTeamId` is set, consistent with `targetType`.
- Cascade delete on project removal.

**Domain model** (`storage/models/domain.models.ts`):
```ts
export interface EpicAssignmentRule {
  id: string;
  projectId: string;
  matchType: 'status' | 'tag';
  statusId: string | null;
  tags: string[] | null;
  targetType: 'agent' | 'team';
  targetAgentId: string | null;
  targetTeamId: string | null;
  overrideExisting: boolean;
  priority: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CreateEpicAssignmentRule = Omit<EpicAssignmentRule, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateEpicAssignmentRule = Partial<CreateEpicAssignmentRule>;
```

The `StorageService` interface gains CRUD methods (`listEpicAssignmentRules`, `createEpicAssignmentRule`, `updateEpicAssignmentRule`, `deleteEpicAssignmentRule`, `reorderEpicAssignmentRules`), mirroring the existing storage-delegate pattern.

---

## 4. Service layer

### 4.1 `AutoAssignRulesService` (new)

Located in a new `modules/auto-assign-rules` module. Responsibilities:
- CRUD (delegating to `StorageService`) with project-boundary validation and referential checks (status/team/agent must belong to the project).
- `reorder(projectId, [{id, priority}])`.
- **`resolveAssignment(epic, trigger): Promise<{ agentId: string | null; ruleId: string | null; skipped: 'no_match' | 'already_assigned' | 'stale_target' | 'auto_clean_status' | null }>`** — the core fire-time resolver. Returns the resolved agentId (or null with a skip reason) **without** mutating the epic; the caller performs the storage write.

### 4.2 Hook point in `EpicsService`

Auto-assign runs **inside** `EpicsService.createEpic`, `createEpicForProject`, and `updateEpic` (which `bulkUpdateEpics` already delegates through), immediately **after** the existing `applyAutoCleanIfNeeded` call.

On **update** (status change), the sequence is:
1. `applyAutoCleanIfNeeded(projectId, data.statusId, data)` — existing; clears `agentId` if auto-clean.
2. If `data.statusId` is set and is in the project's `autoCleanStatusIds` → skip auto-assign entirely.
3. Else build a transient evaluation snapshot `{ projectId, statusId: data.statusId ?? before.statusId, tags: before.tags, agentId: before.agentId }` and call `autoAssignRulesService.resolveAssignment(snapshot, 'status_change')`. If it returns an `agentId`, set `data.agentId` to that value before `storage.updateEpic`. `overrideExisting` is honored inside `resolveAssignment` per §2.1 (a non-override rule declines when `snapshot.agentId` is already set).

On **create**, `agentId` is null today (the create form has no agent field), so override is moot — the first matching rule wins outright.

The existing `epic.created` / `epic.updated` event publication then fires with the resolved `agentId`, so the `EpicAssignmentNotifierSubscriber` notifies the team lead/agent unchanged. `actor` remains the original caller (not "system"), preserving the existing self-assignment skip.

### 4.3 Order with cascade-clear

The cascade-clear of sub-epic agents (when a parent enters an auto-clean status) is unchanged and runs **after** the main update. Because the parent's auto-clean status skips auto-assign (§2.1 step 1), there is no interaction conflict.

---

## 5. API

All under the existing app routing:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/projects/:projectId/auto-assign-rules` | List rules (priority order) |
| `POST` | `/api/projects/:projectId/auto-assign-rules` | Create rule |
| `PATCH` | `/api/projects/:projectId/auto-assign-rules/:id` | Update rule |
| `DELETE` | `/api/projects/:projectId/auto-assign-rules/:id` | Delete rule |
| `PUT` | `/api/projects/:projectId/auto-assign-rules/reorder` | Body: `{ items: [{ id, priority }] }` |

**DTO validation (Zod)** mirrors the existing `connectors` DTO pattern:
- `matchType` enum; `statusId` required iff `matchType='status'`; `tags` (non-empty array) required iff `matchType='tag'`.
- `targetType` enum; `targetAgentId` required iff `targetType='agent'`; `targetTeamId` required iff `targetType='team'`.
- Referential integrity (status/agent/team belong to project) is enforced in the service, not the DTO.

---

## 6. UI — Statuses page (Option A)

The auto-assign rules editor lives on `StatusesPage`, the same per-project page that already configures **auto-clean**. The board gets only a link affordance, not a second edit surface.

### 6.1 Statuses page

- New collapsible **"Auto-assign rules"** card below the statuses list.
- Each rule row: matcher (status dot + label, or tag chips) → target (agent name, or "👥 Team · {name} (lead: {leadName})") → `override` badge (off / **on**) → enabled toggle → drag handle (`priority`) → edit → delete.
- **Add rule** opens an inline form: match type (status/tag), status picker or tag multi-input, target type (agent/team), agent picker or team picker, override checkbox. New rules append with `priority = max+1`.
- Reorder via drag (calls `PUT .../reorder`).
- Help text: *"Rules fire when an epic is created or moves to a status. They skip on auto-clean statuses. First matching rule wins."*

### 6.2 Board toolbar link

- A new outline button **"Auto-assign"** (with a rule-count badge) in the `BoardToolbar`. Clicking navigates to `/statuses#auto-assign` and scrolls to the card. Read-only affordance; no inline edit on the board.

### 6.3 Stale-rule surfacing

- A rule whose `statusId` / `targetAgentId` / `targetTeamId` no longer exists is rendered with an **"invalid"** badge and a hint ("Status was deleted" / "Team was removed"). Invalid rules are skipped at fire time but not auto-deleted; the user resolves or removes them.

---

## 7. Edge cases

| Case | Handling |
|---|---|
| Team target with no `teamLeadAgentId` (lead removed/unset) | Rule declines → continue to next rule; log warning |
| Referenced status/agent/team deleted | Rule becomes stale → UI badge "invalid"; skipped at fire time. Not cascade-deleted |
| Bulk status change | `bulkUpdateEpics` routes through `updateEpic` → auto-assign fires per epic |
| Agent-initiated status change | Same path; `actor` preserved; self-assignment skip in the notifier still applies |
| Rule references cross-project entity | Rejected at create/update by service-level project-boundary validation |
| Multiple rules match | First by `priority` wins |

---

## 8. Non-goals

Explicitly out of scope for this iteration:
- Team-owned epics (a `teamId` field on `Epic`)
- Round-robin / least-loaded member distribution
- Tag-edit triggers (rules fire on create + status change only)
- Combined status+tag matchers (one matcher per rule)
- Rule audit / history log
- A board-side inline editor (board gets a link only)

---

## 9. Testing strategy

- **`AutoAssignRulesService` unit tests** — resolution matrix: status match, tag match (any-of), override on/off, auto-clean status skip, team-lead resolution, team-without-lead decline, stale-target decline, first-by-priority ordering, disabled-rule skip, empty rule list.
- **`EpicsService` characterization** — auto-assign fires on `createEpic`, `createEpicForProject`, and `updateEpic` (status change); does **not** fire on tag-only edits; auto-clean still wins; cascade-clear path unaffected.
- **Controller DTO tests** — Zod validation for the XOR constraints on `matchType` and `targetType`; project-boundary rejection.
- **`StatusesPage` component test** — render rule rows, add/edit/delete a rule, reorder, invalid-rule badge.
- **Storage delegate test** — CRUD + reorder persistence for `epic_assignment_rules`.

---

## 10. Open items (deferred to implementation plan)

- Migration filename and exact column types (follow the latest migration's conventions).
- Whether to expose auto-assign rule activity in the existing event log (likely yes via the standard `epic.updated` event — no new event type needed).
- Accessibility pass on the new card (drag-handle keyboard alternative, ARIA on the enable toggle).
