# Plan 006: Gate every panel query family until its panel is visible

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. Complete `plans/001-fix-query-readiness-predicates.md` first. If
> anything in the "STOP conditions" section occurs, stop and report — do not
> improvise. When done, update the status row for this plan in
> `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite repository root)**:
> `git -C shared diff --stat f8cd4b7..HEAD -- plugin-system/src/runtime/DataQueriesProvider/DataQueriesProvider.tsx plugin-system/src/runtime/DataQueriesProvider/DataQueriesProvider.test.tsx plugin-system/src/runtime/trace-queries.ts plugin-system/src/runtime/profile-queries.ts plugin-system/src/runtime/log-queries.ts plugin-system/src/runtime/query-options.test.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Plan 001 should not modify these
> paths; any diff here is unexpected.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-fix-query-readiness-predicates.md`
- **Category**: perf
- **Planned at**: commit `f8cd4b7`, 2026-07-21

## Why this matters

Dashboard grid items deliberately stay mounted before they enter the viewport
so layout can be measured, but their query provider currently gates only time
series. Trace, profile, and log panels below the fold fetch immediately and
remain active during refreshes even though their visual panel has never
rendered. Applying the existing `queryOptions.enabled` gate uniformly avoids
offscreen network, parsing, and cache work without changing first-visible
behavior.

## Current state

- `shared/dashboards/src/components/GridLayout/GridItemContent.tsx:43-47`
  derives `inView` with `triggerOnce: true`.
- `GridItemContent.tsx:108-123` always mounts `DataQueriesProvider`, passes
  `queryOptions={{ enabled: inView }}`, and renders `Panel` only when visible.
  This caller is already correct and is out of scope.
- `shared/plugin-system/src/runtime/DataQueriesProvider/DataQueriesProvider.tsx`
  partitions definitions and invokes all four query-family hooks.
- `shared/plugin-system/src/runtime/DataQueriesProvider/DataQueriesProvider.test.tsx:21-35`
  already mocks all four hooks and is the propagation-test exemplar.
- `shared/plugin-system/src/runtime/time-series-queries.ts:129-146` is the
  readiness-composition exemplar established by Plan 001.

Current provider calls (`DataQueriesProvider.tsx:82-99`):

```ts
const timeSeriesResults = useTimeSeriesQueries(timeSeriesQueries, options, queryOptions);

const traceQueries = queryDefinitions.filter(/* ... */) as TraceQueryDefinition[];
const traceResults = useTraceQueries(traceQueries);

const profileQueries = queryDefinitions.filter(/* ... */) as ProfileQueryDefinition[];
const profileResults = useProfileQueries(profileQueries);

const logQueries = queryDefinitions.filter(/* ... */) as LogQueryDefinition[];
const logResults = useLogQueries(logQueries);
```

Current trace hook (`trace-queries.ts:41-58`) has internal plugin/dependency
readiness that must remain authoritative:

```ts
return {
  enabled: queryEnabled,
  queryKey: queryKey,
  // ...
};
```

Profile and log hooks (`profile-queries.ts:38-56`, `log-queries.ts:38-56`) have
no `enabled` field at all. For all families, caller enablement defaults to
`true`; when internal readiness also exists, the final value is logical AND.
Do not change query keys, stale times, refetch defaults, or data shapes.

## Commands you will need

Use Node `v22.14.0` from `shared/.nvmrc` and npm `10.9.2` from
`shared/package.json`; if those pinned versions cannot be activated, STOP
before installing or testing. On Windows PowerShell, use `npm.cmd` when
`npm.ps1` is policy-blocked.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix shared ci` | exit 0; `shared/package-lock.json` is unchanged |
| Focused tests | `npm --prefix shared run test --workspace=@perses-dev/plugin-system -- --runInBand DataQueriesProvider.test.tsx query-options.test.tsx` | exit 0; propagation and hook-option suites pass |
| Typecheck | `npm --prefix shared run type-check -- --filter=@perses-dev/plugin-system` | exit 0 after Turbo runs upstream builds, with no TypeScript errors |
| Lint | `npm --prefix shared run lint --workspace=@perses-dev/plugin-system` | exit 0, no ESLint errors |
| Build | `npm --prefix shared run build -- --filter=@perses-dev/plugin-system` | exit 0; plugin-system and upstream packages emit cleanly |
| Full package tests | `npm --prefix shared run test --workspace=@perses-dev/plugin-system -- --runInBand` | exit 0; all plugin-system suites pass |

## Suggested executor toolkit

- If available, use `vercel-react-best-practices` to review external/internal
  enablement composition and ensure no conditional-hook workaround is added.

## Scope

**In scope** (the only implementation files you should modify):

- `shared/plugin-system/src/runtime/DataQueriesProvider/DataQueriesProvider.tsx`
- `shared/plugin-system/src/runtime/DataQueriesProvider/DataQueriesProvider.test.tsx`
- `shared/plugin-system/src/runtime/trace-queries.ts`
- `shared/plugin-system/src/runtime/profile-queries.ts`
- `shared/plugin-system/src/runtime/log-queries.ts`
- `shared/plugin-system/src/runtime/query-options.test.tsx` (create)

`plans/README.md` is an administrative status-only exception after completion.

**Out of scope** (do NOT touch):

- `shared/dashboards/src/components/GridLayout/GridItemContent.tsx`; it already
  supplies the correct visibility option.
- Time-series query code, readiness predicates, query keys, stale/refetch
  policy, usage-metric semantics, and manual `refetchAll` behavior.
- Unmounting `DataQueriesProvider` while offscreen. Keep it mounted and disable
  its queries so context shape and hook order remain stable.
- Variable-dependency narrowing; that belongs to Plan 007.

## Git workflow

- Work in the nested `shared` repository on branch
  `advisor/006-gate-non-time-series-panel-queries` after Plan 001 is complete.
- Commit as one logical unit after verification, for example:
  `[ENHANCEMENT] plugin-system: gate offscreen panel queries`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 0: Reinstall the locked shared workspace

After Plan 001 is present, run `npm --prefix shared ci` before collecting the
focused-test baseline. Do not rely on an existing `node_modules`; the audited
checkout had an incomplete install. The command must not rewrite the lockfile.

**Verify**: `npm --prefix shared ci` exits 0 and
`git -C shared diff -- package-lock.json` prints nothing.

### Step 1: Propagate the provider's query options to every query family

Change `DataQueriesProvider.tsx` so the calls have these exact shapes:

```ts
useTimeSeriesQueries(timeSeriesQueries, options, queryOptions);
useTraceQueries(traceQueries, queryOptions);
useProfileQueries(profileQueries, queryOptions);
useLogQueries(logQueries, queryOptions);
```

In `DataQueriesProvider.test.tsx`, import the mocked hook functions and add one
test that renders a provider with `{ enabled: false }`. Assert every hook
receives the same options object in the correct argument position; also assert
the time-series hook still receives `options` as its second argument. Reset
mocks between tests so call history cannot leak.

**Verify**:
`npm --prefix shared run test --workspace=@perses-dev/plugin-system -- --runInBand DataQueriesProvider.test.tsx`
→ exit 0; the test proves all four families receive `{ enabled: false }`.

### Step 2: Compose external visibility with each hook's own readiness

Add an optional `queryOptions?: Omit<QueryObserverOptions, 'queryKey'>`
parameter to `useTraceQueries`, `useProfileQueries`, and `useLogQueries`.
Import `QueryObserverOptions` as a type from React Query.

Build each query option object in this order:

1. spread `queryOptions` early;
2. write repository-owned refetch/stale/query-key fields afterward so existing
   policy cannot be overridden accidentally;
3. write the final `enabled` explicitly:
   - trace: `(queryOptions?.enabled ?? true) && queryEnabled`;
   - profile: `queryOptions?.enabled ?? true`;
   - log: `queryOptions?.enabled ?? true`.

Do not conditionally call `useQueries`, and do not drop disabled results from
the returned array.

Create `runtime/query-options.test.tsx`. Mock `useQueries` to capture the
generated query objects and mock only the context/plugin dependencies needed by
the hooks. Cover:

- trace plugin ready + external false → false;
- trace plugin not ready + external true → false;
- trace plugin ready + option omitted → true;
- profile/log external false → false;
- profile/log option omitted → true.

**Verify**:
`npm --prefix shared run test --workspace=@perses-dev/plugin-system -- --runInBand query-options.test.tsx`
→ exit 0; every expected final `enabled` value is asserted from the object
passed to `useQueries`.

### Step 3: Run plugin-system regression checks

Run focused tests once together, then typecheck, lint, and the full suite. Fix
only in-scope failures.

**Verify**:
`npm --prefix shared run test --workspace=@perses-dev/plugin-system -- --runInBand DataQueriesProvider.test.tsx query-options.test.tsx`
→ exit 0; then
`npm --prefix shared run type-check -- --filter=@perses-dev/plugin-system`
→ exit 0 after Turbo's upstream builds; then
`npm --prefix shared run lint --workspace=@perses-dev/plugin-system`
→ exit 0; then
`npm --prefix shared run build -- --filter=@perses-dev/plugin-system`
→ exit 0; then
`npm --prefix shared run test --workspace=@perses-dev/plugin-system -- --runInBand`
→ exit 0 and all suites pass.

## Test plan

- Extend `DataQueriesProvider.test.tsx` to prove one caller option reaches all
  four hooks.
- Create `query-options.test.tsx` to prove the generated React Query options
  combine external and internal gates correctly.
- Model module mocks after `DataQueriesProvider.test.tsx:21-61`; use Testing
  Library `renderHook` as at lines 74-101.
- No browser/intersection-observer test is required because the dashboard
  caller already maps `inView` to `enabled`; this plan tests the broken boundary
  after that call.
- Verification:
  `npm --prefix shared run test --workspace=@perses-dev/plugin-system -- --runInBand DataQueriesProvider.test.tsx query-options.test.tsx`
  → both suites pass.

## Done criteria

Machine-checkable; ALL must hold:

- [ ] `rg -n "use(Trace|Profile|Log)Queries\([^,]+, queryOptions\)" shared/plugin-system/src/runtime/DataQueriesProvider/DataQueriesProvider.tsx` returns three matches.
- [ ] `rg -n "queryOptions\?: Omit<QueryObserverOptions" shared/plugin-system/src/runtime/trace-queries.ts shared/plugin-system/src/runtime/profile-queries.ts shared/plugin-system/src/runtime/log-queries.ts` returns three matches.
- [ ] `rg -n "enabled: \(queryOptions\?\.enabled \?\? true\) && queryEnabled" shared/plugin-system/src/runtime/trace-queries.ts` returns exactly one match.
- [ ] `rg -n "enabled: queryOptions\?\.enabled \?\? true" shared/plugin-system/src/runtime/profile-queries.ts shared/plugin-system/src/runtime/log-queries.ts` returns two matches.
- [ ] Focused tests, plugin-system typecheck, lint, and full tests exit 0.
- [ ] The filtered plugin-system build exits 0.
- [ ] Before the logical commit, `git -C shared status --short` lists only the six in-scope paths; afterward, `git -C shared diff --name-only HEAD^..HEAD` lists exactly those six paths and `git -C shared status --short` is empty.
- [ ] `plans/README.md` status row is updated, unless the dispatcher said it maintains the index.

## STOP conditions

Stop and report back without improvising if:

- Plan 001 is not complete or the shared readiness convention is no longer
  external-enabled AND internal-ready.
- The live dashboard caller no longer passes `queryOptions={{ enabled: inView }}`
  while keeping the provider mounted.
- A query-family hook has gained a different public option type or an internal
  readiness contract not represented above.
- Correct behavior appears to require conditional hook calls, removing disabled
  results, or changing context result ordering.
- An in-scope file has unrelated drift, or a verification command fails twice
  after a reasonable in-scope fix attempt.

## Maintenance notes

- Any future query family added to `DataQueriesProvider` must accept and compose
  the same external query options; add it to the propagation test.
- Reviewers should ensure object spread order cannot let callers bypass plugin
  readiness or repository-owned query policy.
- `triggerOnce: true` means a panel remains enabled after first visibility;
  this plan intentionally preserves that product behavior.
