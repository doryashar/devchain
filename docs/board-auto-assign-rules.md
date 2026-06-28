# Board Auto-assign Rules

Auto-assign rules automatically route epics to an agent or a team's lead as epics move through your board. Configure them per project on the **Statuses** page.

## How rules work

- Each rule matches on **either a status (column) or a tag** — not both.
- A rule's target is **either a specific agent or a team** (the team lead takes the epic).
- Rules fire when an epic is **created** or **moves to a new status**. Editing tags alone does not re-fire rules.
- If an epic is already assigned, a rule with **Override existing assignment** off will skip it; turning override on forces re-assignment.
- **Auto-clean statuses win**: when an epic moves to an auto-clean status its assignee is cleared and rules do not fire.
- When several rules match, the **first one in priority order** wins (reorder by drag).

## Configuring

1. Open a project and go to **Statuses**.
2. Find the **Auto-assign rules** card and click **Add rule**.
3. Choose match by **Status** or **Tag**, pick the target, and save.

To change an existing rule, click its **edit** (pencil) button, adjust the fields, and save — this sends a `PATCH` to that rule.

To change the order in which rules are evaluated, **drag a rule row by its grip handle** to a new position. The new order is saved automatically (`PUT /api/auto-assign-rules/reorder`) with sequential priorities; the first matching rule wins.

You can also jump to the rules card from the board: the **Auto-assign** button in the board toolbar links straight to it.

## Stale rules

If a rule references a status, agent, or team that has since been deleted, it shows an **invalid** badge and is skipped at fire time. Delete it or re-point it.

## REST API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/auto-assign-rules?projectId=X` | List rules (priority order) |
| `POST` | `/api/auto-assign-rules?projectId=X` | Create rule |
| `PATCH` | `/api/auto-assign-rules/:id` | Update rule |
| `DELETE` | `/api/auto-assign-rules/:id` | Delete rule |
| `PUT` | `/api/auto-assign-rules/reorder?projectId=X` | Reorder (`{ items: [{ id, priority }] }`) |

See the design spec at `docs/superpowers/specs/2026-06-28-board-auto-assign-rules-design.md` for full details.
