# Task: Unblock local-app dev startup by fixing 22 pre-existing tsc errors

Goal: `pnpm --filter local-app exec tsc --noEmit` reports 0 errors.

## Findings
- Repo is a pnpm monorepo. Source lives under `apps/local-app/src/...`.
- `@devchain/codebase-overview` types come from the BUILT `packages/codebase-overview/dist/index.d.ts`
  (package has `"types": "dist/index.d.ts"`, no tsconfig path alias in local-app). So editing the
  package's `src/index.ts` REQUIRES rebuilding dist for local-app tsc to pick it up. (dist is gitignored.)
- `@types/ws@8.18.1` was declared in `apps/local-app/package.json` devDeps AND in the lockfile, but
  was NOT installed (stale node_modules). This caused TS7016 for `ws`.
- ROOT CAUSE of the stale install: `pnpm-workspace.yaml` did NOT list `packages/codebase-overview`,
  even though it is committed, symlinked into local-app's node_modules, modeled as `link:` in the
  lockfile, referenced via `workspace:*` in local-app, and filtered by the root `build` script.
  This made EVERY `pnpm install`/`pnpm add` fail with ERR_PNPM_WORKSPACE_PKG_NOT_FOUND. Genuine pre-existing bug.
- Additionally the lockfile was stale vs `packages/codebase-overview/package.json` (lockfile expected
  9 devDeps — typescript/vitest/eslint/etc. — that the package.json no longer declares).

## Fixes applied
- TS18048/TS2488 (optional-field consumption) — `(x ?? [])` at consumption sites:
  - CodebaseOverviewPage.tsx (9 sites: whyRanked/recentCommits/topAuthors/recentActivity)
  - ChangeSection/ChangeSection.tsx, TopContributorsCard.tsx (the latter surfaced after dist rebuild)
  - OwnershipSection.tsx, TopContributorsByDistrictCard.tsx
- TS2578/TS2769 (orchestrator-proxy): installing @types/ws re-exposed the upstream type gap
  (`rewriteRequestHeaders` not on ws `ClientOptions`) that a `@ts-expect-error` was guarding. The
  directive only looked "unused" because the ws types were missing. Restored it, correctly placed
  immediately above `fastify.register(...)`.
- TS2739 Snapshot (codebase-overview-analyzer.service.ts:443) — added `version:1`,
  `timestamp: new Date().toISOString()`, `summary:{}` (matches computeOverview stub pattern).
- TS2739 TargetDetail (evidence-query.service.ts:53) — made `name/displayName/category/description`
  OPTIONAL in `packages/codebase-overview/src/index.ts`. Rationale: the sole builder never populates
  them, no consumer reads them, and there is no source data for `description`. Rebuilt dist.
- TS7016/TS7006 ws (tunnel-client.service.ts) — fixed by installing `@types/ws` (resolves via
  contextual typing; no source edits needed in tunnel-client.service.ts).

## Install repair (necessary enabler)
- Added `'packages/codebase-overview'` to `pnpm-workspace.yaml`.
- Ran `pnpm install` to reconcile the stale lockfile (removed codebase-overview's dead devDep trees;
  resolved @types/ws/ws). Verified `pnpm install --frozen-lockfile` now succeeds (CI-safe).

## Verification
- `pnpm --filter local-app exec tsc --noEmit` => exit 0, ZERO errors.
- `pnpm --filter local-app exec eslint <changed files> --max-warnings=0` => exit 0, clean.
- `pnpm install --frozen-lockfile` => succeeds (lockfile consistent).

## Review / Notes
- The ws TS7006 callback params were left as-is: with @types/ws installed, `this.ws` is typed and
  `.on('message'/'close'/'error', ...)` provides contextual types, so the implicit-any errors
  resolved without redundant annotations (kept changes minimal).
- TargetDetail optional-fields decision is the one judgment call; documented in report. Not a concern.
- Did NOT touch anything under src/modules/auto-assign-rules/. No runtime behavior changes (type +
  defensive null-guards + install repair only).
- Decided NOT to add unit tests: this is a compilation-unblock task with prescribed type-only fixes
  (per explicit task constraints "type fixes only / minimal"). tsc=0 + eslint=0 is the validation.
  The `(x ?? [])` guards also fix a latent runtime crash if those optional fields are ever absent.
