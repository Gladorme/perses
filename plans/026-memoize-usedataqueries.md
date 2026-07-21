# Plan 026: Memoize `useDataQueries` so panels get stable result identities

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: in `shared\`, run
> `git diff --stat f8cd4b7..HEAD -- plugin-system/src/runtime/DataQueriesProvider/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: `shared` repo commit `f8cd4b7`, 2026-07-20

## Why this matters

`useDataQueries` is the hook every Perses panel plugin calls to get its query
results. Today it rebuilds its returned arrays and object on every render, so
every consumer receives fresh identities even when nothing changed. Any
downstream `useMemo`/`useEffect` keyed on `queryResults` (e.g. the heavy
series-mapping memo in the timeseries chart panel) recomputes on every parent
render, multiplying wasted work across every panel on a dashboard. Memoizing
the hook's output makes identity stable and unlocks effective memoization in
all panels (see plan 029, which depends on this).

## Current state

This is a multi-repo workspace. This plan targets the **`shared`** repo
(npm monorepo managed by turborepo, workspace package
`@perses-dev/plugin-system`).

- `shared\plugin-system\src\runtime\DataQueriesProvider\DataQueriesProvider.tsx`
  — contains both the `DataQueriesProvider` component (its context value `ctx`
  is already memoized at lines 108–147) and the `useDataQueries` hook, which
  is NOT memoized:

```ts
// DataQueriesProvider.tsx:41-62 (current)
export function useDataQueries<T extends keyof QueryType>(queryType: T): UseDataQueryResults<QueryType[T]> {
  const ctx = useDataQueriesContext();

  // Filter the query results based on the specified query type
  const filteredQueryResults = ctx.queryResults.filter(
    (queryResult) => queryResult?.definition?.kind === queryType
  ) as Array<QueryData<QueryType[T]>>;

  // Filter the errors based on the specified query type
  const filteredErrors = ctx.errors.filter((errors, index) => ctx.queryResults[index]?.definition?.kind === queryType);

  // Create a new context object with the filtered results and errors
  const filteredCtx = {
    queryResults: filteredQueryResults,
    isFetching: filteredQueryResults.some((result) => result.isFetching),
    isLoading: filteredQueryResults.some((result) => result.isLoading),
    refetchAll: ctx.refetchAll,
    errors: filteredErrors,
  };

  return filteredCtx;
}
```

- Repo conventions: React 18 function components, hooks from `react` imported
  at top of file (the file already imports `useCallback`/`useMemo` patterns
  are used elsewhere in the same file, e.g. `ctx` memo at line 108). ESLint
  enforces `react-hooks/exhaustive-deps`. TypeScript strict; functions have
  explicit return types.
- There is an existing test file
  `shared\plugin-system\src\runtime\DataQueriesProvider\DataQueriesProvider.test.tsx`
  — use it as the structural pattern for new tests (it renders hooks with
  `@testing-library/react`).

## Commands you will need

Run all commands from `C:\Users\Guillaume\Documents\Projets\perses\app\shared\plugin-system`.

| Purpose   | Command                                   | Expected on success |
|-----------|-------------------------------------------|---------------------|
| Install   | `npm install` (from `shared\` root, only if node_modules missing) | exit 0 |
| Typecheck | `npm run type-check`                      | exit 0, no errors   |
| Tests     | `npm run test -- DataQueriesProvider`     | all pass            |
| Lint      | `npm run lint`                            | exit 0              |

## Suggested executor toolkit

- If the `vercel-react-best-practices` skill is available, invoke it before
  step 1 for memoization guidance.

## Scope

**In scope** (the only files you should modify):
- `shared\plugin-system\src\runtime\DataQueriesProvider\DataQueriesProvider.tsx`
- `shared\plugin-system\src\runtime\DataQueriesProvider\DataQueriesProvider.test.tsx`

**Out of scope** (do NOT touch, even though they look related):
- The `DataQueriesProvider` component body (lines 64–150) — its `ctx` is
  already memoized; do not refactor `queryDefinitions`/`refetchAll` here.
- `useTimeSeriesQueries` / `useTraceQueries` / `useProfileQueries` /
  `useLogQueries` implementations.
- The public shape of `UseDataQueryResults` — panels across three repos
  depend on it.

## Git workflow

- Work in the `shared` repo. Branch: `advisor/026-memoize-usedataqueries`.
- Commit message style (from `git log`): `[ENHANCEMENT] memoize useDataQueries result (#<PR>)` style prefix tags like `[BUGFIX]`/`[ENHANCEMENT]` are used; use `[ENHANCEMENT]`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Wrap the hook body in `useMemo`

In `DataQueriesProvider.tsx`, rewrite `useDataQueries` so the filtering and
result-object construction happen inside a single `useMemo` keyed on
`[ctx.queryResults, ctx.errors, ctx.refetchAll, queryType]`. Target shape:

```ts
export function useDataQueries<T extends keyof QueryType>(queryType: T): UseDataQueryResults<QueryType[T]> {
  const ctx = useDataQueriesContext();
  const { queryResults, errors, refetchAll } = ctx;

  return useMemo(() => {
    const filteredQueryResults = queryResults.filter(
      (queryResult) => queryResult?.definition?.kind === queryType
    ) as Array<QueryData<QueryType[T]>>;
    const filteredErrors = errors.filter((_, index) => queryResults[index]?.definition?.kind === queryType);
    return {
      queryResults: filteredQueryResults,
      isFetching: filteredQueryResults.some((result) => result.isFetching),
      isLoading: filteredQueryResults.some((result) => result.isLoading),
      refetchAll,
      errors: filteredErrors,
    };
  }, [queryResults, errors, refetchAll, queryType]);
}
```

Add `useMemo` to the `react` import if not present. Keep the exact return
shape — do not rename fields.

**Verify**: `npm run type-check` → exit 0.

### Step 2: Add an identity-stability test

In `DataQueriesProvider.test.tsx`, add a test that renders a hook consumer
via `renderHook` (or a small component) wrapped in the same test providers
already used in that file, calls `rerender()` without changing any inputs,
and asserts the object returned by `useDataQueries('TimeSeriesQuery')` is
reference-equal (`toBe`) across the two renders. Model the setup on the
existing tests in the same file.

**Verify**: `npm run test -- DataQueriesProvider` → all pass, including the new test.

### Step 3: Lint

**Verify**: `npm run lint` → exit 0 (no `react-hooks/exhaustive-deps` warnings introduced).

## Test plan

- New test in `DataQueriesProvider.test.tsx`:
  1. result of `useDataQueries` is reference-stable across a no-op rerender;
  2. existing behavior tests still pass (filtering by query kind unchanged).
- Pattern: existing tests in `DataQueriesProvider.test.tsx`.
- Verification: `npm run test -- DataQueriesProvider` → all pass.

## Done criteria

Machine-checkable. ALL must hold (run in `shared\plugin-system`):

- [ ] `npm run type-check` exits 0
- [ ] `npm run test -- DataQueriesProvider` exits 0; identity-stability test exists and passes
- [ ] `useDataQueries` body contains a `useMemo` (grep: `grep -n "useMemo" src/runtime/DataQueriesProvider/DataQueriesProvider.tsx` shows a match between the hook's declaration and its closing brace)
- [ ] `git status` in `shared` shows only the two in-scope files modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `useDataQueries` code doesn't match the excerpt above (drift).
- The `UseDataQueryResults` type requires fields beyond the five returned
  (would mean an API change happened).
- Memoizing changes any existing test's outcome other than passing.
- ESLint demands deps that reintroduce instability (e.g. whole `ctx`) and you
  cannot satisfy it by destructuring as shown.

## Maintenance notes

- Reviewers should check that `ctx.queryResults` identity itself is stable
  between unrelated renders (it is — `ctx` is memoized in the provider). If
  someone later un-memoizes the provider `ctx`, this hook's memo silently
  loses value.
- plan 029 (timeseries panel memo split) relies on this landing first.
