# Plan 001: Make query enablement require every readiness gate

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite repository root)**:
> `git -C shared diff --stat f8cd4b7..HEAD -- plugin-system/src/components/Variables/variable-model.ts plugin-system/src/components/Variables/variable-model.test.ts plugin-system/src/runtime/time-series-queries.ts plugin-system/src/runtime/time-series-queries.test.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `f8cd4b7`, 2026-07-21

## Why this matters

Two React Query hooks combine readiness flags with logical OR where all gates
must be true. A list-variable request can therefore execute while an upstream
variable is still loading, and the exported single time-series hook is enabled
by default even before its plugin exists. Correct AND composition prevents
stale duplicate requests, avoids the plugin-not-loaded error path, and makes an
explicit caller-supplied `enabled: false` authoritative.

## Current state

- `shared/plugin-system/src/components/Variables/variable-model.ts` builds the
  query for plugin-backed list-variable options.
- `shared/plugin-system/src/runtime/time-series-queries.ts` contains both the
  single-query and multi-query hooks.
- `shared/plugin-system/src/components/Variables/variable-model.test.ts` is the
  existing hook-test exemplar: it mocks runtime hooks at lines 61–70 and uses
  `renderHookWithContext` at lines 108 and 149.
- `shared/plugin-system/src/runtime/DataQueriesProvider/DataQueriesProvider.test.tsx:14-35`
  is the local exemplar for Jest-mocking query hooks and inspecting hook calls.

Current list-variable predicate (`variable-model.ts:64-83`):

```ts
let waitToLoad = false;
if (dependsOnVariables) {
  waitToLoad = dependsOnVariables.some((v) => variables[v]?.loading);
}

return useQuery({
  // ...
  enabled: !!variablePlugin || waitToLoad,
});
```

`waitToLoad === true` means at least one required upstream variable is still
loading, so it is a reason to disable the query, not enable it.

Current single-query predicate (`time-series-queries.ts:92-107`):

```ts
const { data: plugin } = usePlugin(TIME_SERIES_QUERY_KEY, definition.spec.plugin.kind);
const context = useTimeSeriesQueryContext();
const { queryEnabled, queryKey } = getQueryOptions({ plugin, definition, context });
return useQuery({
  enabled: (queryOptions?.enabled ?? true) || queryEnabled,
  queryKey: queryKey,
  queryFn: ({ signal }) => {
    if (plugin === undefined) {
      throw new Error('Expected plugin to be loaded');
    }
    // ...
  },
});
```

The correct in-repo convention is already present in the multi-query hook at
`time-series-queries.ts:129-146`:

```ts
return {
  ...queryOptions,
  enabled: (queryOptions?.enabled ?? true) && queryEnabled,
  // ...
};
```

Preserve the current query keys, query functions, dependency detection, and
public hook signatures. This plan changes only readiness composition and its
regression coverage.

## Commands you will need

Use Node `v22.14.0` from `shared/.nvmrc` and npm `10.9.2` from
`shared/package.json`; if those pinned versions cannot be activated, STOP
before installing or testing. On Windows PowerShell, use `npm.cmd` when
`npm.ps1` is policy-blocked.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix shared ci` | exit 0; `shared/package-lock.json` is unchanged |
| Focused tests | `npm --prefix shared run test --workspace=@perses-dev/plugin-system -- --runInBand variable-model.test.ts time-series-queries.test.tsx` | exit 0; both suites pass |
| Typecheck | `npm --prefix shared run type-check -- --filter=@perses-dev/plugin-system` | exit 0 after Turbo runs upstream builds, with no TypeScript errors |
| Lint | `npm --prefix shared run lint --workspace=@perses-dev/plugin-system` | exit 0, no ESLint errors |
| Build | `npm --prefix shared run build -- --filter=@perses-dev/plugin-system` | exit 0; plugin-system and upstream packages emit cleanly |
| Full package tests | `npm --prefix shared run test --workspace=@perses-dev/plugin-system -- --runInBand` | exit 0; all plugin-system suites pass |

## Suggested executor toolkit

- If available, use `vercel-react-best-practices` to review the final hook
  readiness composition; do not broaden this plan into unrelated memoization.

## Scope

**In scope** (the only implementation files you should modify):

- `shared/plugin-system/src/components/Variables/variable-model.ts`
- `shared/plugin-system/src/components/Variables/variable-model.test.ts`
- `shared/plugin-system/src/runtime/time-series-queries.ts`
- `shared/plugin-system/src/runtime/time-series-queries.test.tsx` (create)

`plans/README.md` is an administrative status-only exception after completion.

**Out of scope** (do NOT touch):

- The multi-query implementation beyond using it as the correct predicate
  exemplar.
- Query keys, retry/stale-time behavior, plugin dependency contracts, or query
  result transformation.
- Dashboard visibility gating; that is handled by
  `plans/006-gate-non-time-series-panel-queries.md`.
- Any plugin implementation under `plugins/`.

## Git workflow

- Work in the nested `shared` repository on branch
  `advisor/001-fix-query-readiness-predicates`.
- Commit as one logical unit after all verification passes. Match the observed
  shared-repo style, for example:
  `[BUGFIX] plugin-system: fix query readiness predicates`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 0: Reinstall the locked shared workspace

Run `npm --prefix shared ci` before collecting the focused-test baseline. Do
not rely on an existing `node_modules`; the audited checkout had an incomplete
install. The command must not rewrite the lockfile.

**Verify**: `npm --prefix shared ci` exits 0 and
`git -C shared diff -- package-lock.json` prints nothing.

### Step 1: Correct and cover list-variable readiness

In `variable-model.test.ts`, extend the existing
`useListVariablePluginValues` suite with these cases:

1. plugin loaded + declared dependency loading: `getVariableOptions` is not
   called;
2. plugin absent + dependency loading: the optional query function is not
   called and no empty result is fetched;
3. plugin loaded + all declared dependencies ready: the existing successful
   call behavior remains.

Use the existing `usePlugin` and `useAllVariableValues` mocks. Use
`waitFor`/React Query result state where necessary rather than sleeping. Then
change the production predicate to:

```ts
enabled: variablePlugin !== undefined && !waitToLoad,
```

Do not alter the self-dependency filtering or query key.

**Verify**:
`npm --prefix shared run test --workspace=@perses-dev/plugin-system -- --runInBand variable-model.test.ts`
→ exit 0; the original tests and the three readiness cases pass, with no
unhandled React Query error.

### Step 2: Correct and cover the single time-series hook

Create `runtime/time-series-queries.test.tsx`. Mock the narrow runtime
dependencies and React Query's `useQuery` so the test can inspect the options
passed by `useTimeSeriesQuery`; follow the mocking style in
`DataQueriesProvider.test.tsx`. Cover this truth table:

| Plugin/internal readiness | External `enabled` | Expected final `enabled` |
|---|---:|---:|
| not ready | omitted | `false` |
| ready | omitted | `true` |
| ready | `false` | `false` |
| not ready | `true` | `false` |

Change only the single-hook predicate to:

```ts
enabled: (queryOptions?.enabled ?? true) && queryEnabled,
```

The existing multi-query predicate must remain unchanged.

**Verify**:
`npm --prefix shared run test --workspace=@perses-dev/plugin-system -- --runInBand time-series-queries.test.tsx`
→ exit 0; all four truth-table cases pass.

### Step 3: Run package-level static and regression checks

Run typecheck and lint first, then the full plugin-system suite. Fix only
failures caused by the in-scope changes.

**Verify**:
`npm --prefix shared run type-check -- --filter=@perses-dev/plugin-system`
→ exit 0 after Turbo's upstream builds with no errors; then
`npm --prefix shared run lint --workspace=@perses-dev/plugin-system`
→ exit 0; then
`npm --prefix shared run build -- --filter=@perses-dev/plugin-system`
→ exit 0; then
`npm --prefix shared run test --workspace=@perses-dev/plugin-system -- --runInBand`
→ exit 0 and all suites pass.

## Test plan

- Extend `variable-model.test.ts` for upstream-loading, plugin-loading, and
  ready states.
- Create `time-series-queries.test.tsx` for the four Boolean combinations
  above; assert the exact final `enabled` value supplied to React Query.
- Model hook setup after `variable-model.test.ts:61-70` and query-hook mocks
  after `DataQueriesProvider.test.tsx:21-35`.
- Verification:
  `npm --prefix shared run test --workspace=@perses-dev/plugin-system -- --runInBand variable-model.test.ts time-series-queries.test.tsx`
  → both suites pass with the new cases.

## Done criteria

Machine-checkable; ALL must hold:

- [ ] `rg -n "enabled:.*\|\|.*(waitToLoad|queryEnabled)" shared/plugin-system/src/components/Variables/variable-model.ts shared/plugin-system/src/runtime/time-series-queries.ts` returns no matches.
- [ ] `rg -n "enabled: variablePlugin !== undefined && !waitToLoad" shared/plugin-system/src/components/Variables/variable-model.ts` returns exactly one match.
- [ ] `rg -n "enabled: \(queryOptions\?\.enabled \?\? true\) && queryEnabled" shared/plugin-system/src/runtime/time-series-queries.ts` returns two matches: the single- and multi-query hooks.
- [ ] The focused test command exits 0 and includes all readiness truth-table cases.
- [ ] Plugin-system typecheck, lint, and full tests exit 0.
- [ ] The filtered plugin-system build exits 0.
- [ ] `git -C shared diff --name-only f8cd4b7..HEAD` lists exactly the four in-scope paths above, and `git -C shared status --short` is empty after the logical commit.
- [ ] `plans/README.md` status row is updated, unless the dispatcher said it maintains the index.

## STOP conditions

Stop and report back without improvising if:

- The live code no longer computes `waitToLoad` as “a required variable is
  loading,” or no longer computes `queryEnabled` as internal plugin/dependency
  readiness.
- A caller or test demonstrates that external `enabled: true` is intentionally
  allowed to bypass a missing plugin; that would require an API decision, not a
  predicate patch.
- Correct coverage requires changing React Query versions, query keys, or a
  plugin implementation.
- An in-scope source file has drift beyond the exact predicate changes expected
  here.
- A verification command fails twice after a reasonable in-scope fix attempt.

## Maintenance notes

- Future query hooks should compose caller enablement and internal readiness
  with AND; use `useTimeSeriesQueries` as the exemplar.
- Reviewers should scrutinize the false/undefined cases, because default-true
  options are where the original OR bug was hidden.
- Plan 006 assumes these readiness predicates are correct before adding another
  external visibility gate.
