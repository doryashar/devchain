# Dispatcher Agent & Dispatch Status

The **Dispatcher** is an intake and triage agent. Drop a raw epic into the **Dispatch** status and the Dispatcher picks it up, studies the docs and code, decides whether it belongs in this repo, and routes it as a well-formed, intent-revealing task to the right downstream agent.

## How it works

1. Create an epic and choose **Dispatch** as the status (opt-in — `New` remains the default).
2. An auto-assign rule routes it to the **Dispatcher** agent.
3. The Dispatcher:
   - Reads the docs + code to understand the request's true intention.
   - Validates it's relevant, aligned with the repo's goals, and a real improvement/fix.
   - **If not** → moves it to **Backlog** with a comment explaining why.
   - **If yes, single task** → rephrases it in place (surfacing the underlying need), moves it to **New**, and assigns it.
   - **If yes, multiple unrelated tasks** → creates independent epics in **New** (each with the underlying need), assigns each, then comments on + closes the original.
4. Each output task is assigned by **ambiguity**:
   - **Brainstormer** — needs exploration, design, or has open ambiguity.
   - **Architect** — clear technical implementation path (teams-dev only; 3-agents-dev always routes to Brainstormer).

## Dispatch status

`Dispatch` sits between `Draft` and `New` on the board. It is **not** an auto-clean status, so the assignee is preserved while the Dispatcher works. It is visible to agents (`mcpHidden: false`).

## Shipping in templates

Both `teams-dev` and `3-agents-dev` ship with the Dispatcher agent, the Dispatch status, and a pre-configured auto-assign rule (`Dispatch → Dispatcher`). Templates can carry their own auto-assign rules via the `autoAssignRules[]` field — see `docs/board-auto-assign-rules.md` for rule behavior.

## What the Dispatcher does NOT do

It does not plan, design, or implement. It only triages and dispatches. Planning is the Brainstormer's job; implementation is the Builders' job.
