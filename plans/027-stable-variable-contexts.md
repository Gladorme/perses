# Plan 027: Stabilize variable context provider values (VariableProvider + RepeatGridLayout)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: in `shared\`, run
> `git diff --stat f8cd4b7..HEAD -- dashboards/src/context/VariableProvider/ dashboards/src/components/GridLayout/`
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

Every panel on a Perses dashboard consumes variable state through
`VariableContext` / `BuiltinVariableContext` (used for query interpolation).
Two places pass **freshly created objects** as the provider `value` on every
render, so React treats the context as changed even when the underlying data
is identical — re-rendering every variable consumer (i.e. every panel) on any
unrelated re-render of the provider's parent. Stabilizing these values cuts
dashboard-wide re-render cascades at their source.

## Current state

This plan targets the **`shared`** repo (turborepo monorepo; both files are
in workspace package `@perses-dev/dashboards`).

**Location 1** — `shared\dashboards\src\context\VariableProvider\VariableProvider.tsx`,
`PluginProvider` component. The contents (`values` line 228, `allBuiltinVariables`
line 251) are correctly memoized, but the wrapper objects passed to the
providers are inline literals:

```tsx
// VariableProvider.tsx:323-328 (current)
  return (
    <BuiltinVariableContext.Provider value={{ variables: allBuiltinVariables }}>
      <VariableContext.Provider value={{ state: values }}>{children}</VariableContext.Provider>
    </BuiltinVariableContext.Provider>
  );
}
```

**Location 2** — `shared\dashboards\src\components\GridLayout\GridLayout.tsx`,
`RepeatGridLayout` component. For each repeated row, a new provider value is
built inline (new object, new spread) on **every** render:

```tsx
// GridLayout.tsx:139-143 (current)
      {variable.value.map((value) => (
        <VariableContext.Provider
          key={`${repeatVariableName}-${value}`}
          value={{ state: { ...variables, [repeatVariableName]: { value, loading: false } } }}
        >
```

Also in `GridLayout.tsx` (same component file, `GridLayout` at lines 42–68):
`handleLayoutChange` and `handleWidthChange` are re-created each render and
passed to `Row`. This is secondary — fix it only as described in Step 3
(cheap `useCallback`), do not restructure `Row`.

- `VariableContext` and `BuiltinVariableContext` are defined in
  `shared\plugin-system\src\runtime\template-variables.ts` (imported via
  `@perses-dev/plugin-system`) — do not modify them.
- Conventions: React 18, explicit return types, `useMemo`/`useCallback` with
  `react-hooks/exhaustive-deps` enforced by ESLint. Exemplar: the `ctx` memo
  in `shared\plugin-system\src\runtime\TimeRangeProvider\TimeRangeProvider.tsx:120-138`.

## Commands you will need

Run from `C:\Users\Guillaume\Documents\Projets\perses\app\shared\dashboards`.

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Install   | `npm install` (from `shared\` root, only if node_modules missing) | exit 0 |
| Typecheck | `npm run type-check`             | exit 0              |
| Tests     | `npm run test -- VariableProvider` and `npm run test -- GridLayout` | all pass |
| Lint      | `npm run lint`                   | exit 0              |

## Scope

**In scope** (the only files you should modify):
- `shared\dashboards\src\context\VariableProvider\VariableProvider.tsx`
- `shared\dashboards\src\components\GridLayout\GridLayout.tsx`
- Corresponding `*.test.tsx` files in those folders (add tests)

**Out of scope** (do NOT touch, even though they look related):
- `shared\plugin-system\src\runtime\template-variables.ts` (context definitions)
- The zustand store logic in `VariableProvider.tsx` (lines ~330+) and the
  `useVariableDefinitionStates` selector (that is plan 032)
- `Row.tsx`, `GridItemContent.tsx` — do not add `React.memo` here (larger
  change, separate consideration)

## Git workflow

- Work in the `shared` repo. Branch: `advisor/027-stable-variable-contexts`.
- Commit style: `[ENHANCEMENT] <description>` (matches repo history tags like `[BUGFIX]`, `[ENHANCEMENT]`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Memoize the two provider values in `PluginProvider`

In `VariableProvider.tsx`, above the `return`, add:

```tsx
const builtinCtxValue = useMemo(() => ({ variables: allBuiltinVariables }), [allBuiltinVariables]);
const variableCtxValue = useMemo(() => ({ state: values }), [values]);
```

and use them as the `value` props. `useMemo` is already imported in this file.

**Verify**: `npm run type-check` → exit 0.

### Step 2: Memoize per-row values in `RepeatGridLayout`

In `GridLayout.tsx`, `RepeatGridLayout`: the map runs over `variable.value`
(an array of strings). Hoist a single memo that builds all row values at once:

```tsx
const rowStates = useMemo(() => {
  if (variable === undefined || !Array.isArray(variable.value)) return [];
  return variable.value.map((value) => ({
    value,
    ctx: { state: { ...variables, [repeatVariableName]: { value, loading: false } } },
  }));
}, [variable, variables, repeatVariableName]);
```

Then render `rowStates.map(({ value, ctx }) => <VariableContext.Provider key={...} value={ctx}> ... )`.
Note the early-return for the undefined/empty case currently sits **before**
the map — keep hook order legal: compute `rowStates` before any conditional
return (React hooks must not be behind conditionals). Import `useMemo` from
`react` (the file currently imports `useState` only from react — adjust).

**Verify**: `npm run type-check` → exit 0.

### Step 3: Stabilize `GridLayout` callbacks

In `GridLayout` (same file), wrap `handleLayoutChange` in
`useCallback([hasViewPanel, updatePanelGroupLayouts])` and `handleWidthChange`
in `useCallback([])` (it only calls `setGridColWidth`, which is stable).

**Verify**: `npm run lint` → exit 0 (exhaustive-deps satisfied).

### Step 4: Run the package test suites

**Verify**: `npm run test -- VariableProvider` and `npm run test -- GridLayout`
→ all existing tests pass.

## Test plan

- In the `VariableProvider` test file (or a new
  `VariableProvider.rerender.test.tsx` next to it), add a test: render a
  consumer of `VariableContext` (via `useVariableValues` from
  `@perses-dev/plugin-system`) inside the provider tree, force a parent
  re-render with unchanged variable state, and assert the consumer's context
  value is reference-equal across renders.
- Model test setup on the existing tests in
  `shared\dashboards\src\context\VariableProvider\` (there are `.test.tsx`
  files in that folder — follow their provider scaffolding).
- Verification: `npm run test -- VariableProvider` → all pass including new test.

## Done criteria

ALL must hold (run in `shared\dashboards`):

- [ ] `npm run type-check` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm run test` exits 0; new identity-stability test exists and passes
- [ ] `VariableProvider.tsx` no longer contains `value={{` (grep returns no match in that file)
- [ ] `GridLayout.tsx` no longer contains `value={{ state: { ...variables` inline in JSX
- [ ] `git status` shows only in-scope files modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Excerpts don't match the live code (drift).
- Moving the `rowStates` memo above the early return in `RepeatGridLayout`
  is impossible without changing rendering behavior (e.g. you find the early
  return depends on values computed after the map).
- Any existing `VariableProvider`/`GridLayout` test fails after the change
  and the failure is not a trivial assertion on object identity.

## Maintenance notes

- If a future change adds fields to the variable context value shape, they
  must be added inside these memos, not as new inline literals.
- Reviewer should confirm no behavior change: this is identity-only; snapshot
  of rendered DOM before/after should be identical.
- Deferred: `React.memo` on `Row`/`GridItemContent` — only worth it after
  this and plan 026 land, and needs profiling to justify.
