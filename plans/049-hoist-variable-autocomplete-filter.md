# Plan 049: Hoist the list-variable Autocomplete filter factory out of render

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite repository root)**:
> `git -C shared diff --stat 472a289..HEAD -- dashboards/src/components/Variables/Variable.tsx`
> If the file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: `shared` repo commit `472a289`, 2026-07-20

## Why this matters

`ListVariable` calls `createFilterOptions<VariableOption>({})` inside its render
body. MUI's `createFilterOptions` returns a **new filter function** on every
call, so `filterOptions` gets a fresh identity every render. That identity is a
dependency of three memoized structures in the same component:

- `filteredOptions` (`useMemo([inputValue, viewOptions, filterOptions])`)
- `listBoxProviderValue` (`useMemo([..., filteredOptions, ...])`)
- `autocompleteComponent` (`useMemo([..., filterOptions, ...])`)

Because `filterOptions` changes every render, all three memos recompute every
render and the memoized `<Autocomplete>` subtree is rebuilt every render —
defeating the memoization the component was clearly written to have. Every
dashboard renders one `ListVariable` per list variable, and these re-render on
every unrelated dashboard update. The factory takes no per-render input, so it
can be created once at module scope, making all three memos effective.

## Current state

Repo **`shared`**, package `@perses-dev/dashboards`, file
`dashboards/src/components/Variables/Variable.tsx`.

The factory is created in render:

```tsx
// Variable.tsx — inside ListVariable (current)
const filterOptions = createFilterOptions<VariableOption>({});

const filteredOptions = useMemo(
  () => filterOptions(viewOptions, { inputValue, getOptionLabel: (o) => o.label }),
  [inputValue, viewOptions, filterOptions]
);
```

`filterOptions` is then referenced again as a dependency of
`listBoxProviderValue` (indirectly, via `filteredOptions`) and directly inside
the `autocompleteComponent` `useMemo` (both as the `filterOptions={filterOptions}`
prop and in that memo's dependency array).

`createFilterOptions` is already imported at the top of the file from
`@mui/material`. `useMemo`/`useCallback` are already imported from `react`.

## Commands you will need

Use Node `v22.14.0` (`shared/.nvmrc`) and npm `10.9.2`; if those pinned
versions cannot be activated, STOP before installing or testing. Run from the
composite repository root. On Windows PowerShell, use `npm.cmd` when `npm.ps1`
is policy-blocked.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix shared ci` | exit 0; `shared/package-lock.json` unchanged |
| Focused test | `npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand Variable` | exit 0; Variable suites pass |
| Typecheck | `npm --prefix shared run type-check -- --filter=@perses-dev/dashboards` | exit 0 |
| Lint | `npm --prefix shared run lint --workspace=@perses-dev/dashboards` | exit 0, exhaustive-deps clean |
| Full package tests | `npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand` | exit 0 |

## Scope

**In scope** (the only implementation files you should modify):

- `shared/dashboards/src/components/Variables/Variable.tsx`
- A colocated test file for `Variable` (create or extend)

`plans/README.md` is an administrative status-only exception after completion.

**Out of scope** (do NOT touch):

- The variable context/provider stability work (plan 027).
- `useListVariableState`, `ListVariableListBox`, `StyledPopper`, `TextVariable`.
- The `renderOption`/`renderTags`/`renderInput` bodies inside
  `autocompleteComponent`.
- Any change to the actual filtering behavior.

## Git workflow

- Work in the nested `shared` repository on branch
  `advisor/049-hoist-variable-autocomplete-filter`.
- Commit as one logical unit after verification, e.g.:
  `[ENHANCEMENT] dashboards: stabilize list-variable filter factory`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 0: Reinstall the locked shared workspace

Run `npm --prefix shared ci`. Do not rely on an existing `node_modules`.

**Verify**: exits 0 and `git -C shared diff -- package-lock.json` prints
nothing.

### Step 1: Add a regression test proving the memo churn

In a colocated test (follow the existing `Variables` test scaffolding — there
are provider helpers under `shared/dashboards/src/test`), render a `ListVariable`
(or `Variable` with a `ListVariable` definition) and assert that the
`filterOptions` passed to `Autocomplete` is reference-stable across a parent
re-render with unchanged variable state. The cleanest seam: mock
`@mui/material`'s `Autocomplete` to capture its `filterOptions` prop, render,
force a re-render, and assert `Object.is(first, second)`.

**Verify**: before the production change, run
`npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand Variable`
→ the new assertion fails (identity differs each render). Do not commit this
intermediate state.

### Step 2: Hoist the factory to module scope

Move the factory out of `ListVariable` to a module-level constant:

```tsx
const filterVariableOptions = createFilterOptions<VariableOption>({});
```

Replace the in-render `const filterOptions = createFilterOptions<VariableOption>({});`
usage with `filterVariableOptions` at all three reference sites
(`filteredOptions` memo, its dependency array, and the `autocompleteComponent`
memo's prop + dependency array). Because the reference is now module-stable,
remove it from the dependency arrays or keep it (a module constant is
referentially stable either way); prefer keeping ESLint happy — if
`react-hooks/exhaustive-deps` no longer requires it, remove it; if it still
lists it, that is harmless. Do not rename any other identifier.

**Verify**:
`npm --prefix shared run type-check -- --filter=@perses-dev/dashboards`
→ exit 0; then
`npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand Variable`
→ exit 0 and the Step 1 assertion now passes.

### Step 3: Lint and full package tests

**Verify**:
`npm --prefix shared run lint --workspace=@perses-dev/dashboards` → exit 0
(exhaustive-deps clean); then
`npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand`
→ exit 0.

## Test plan

- One regression test asserting the `Autocomplete` `filterOptions` prop
  identity is stable across a re-render with unchanged inputs.
- One behavioral assertion that filtering still works: type into the input (or
  set `inputValue`) and assert the rendered option list is filtered as before,
  so the change cannot pass by breaking filtering.
- Verification:
  `npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand Variable`
  → all pass.

## Done criteria

Machine-checkable; ALL must hold (run from composite root):

- [ ] `rg -n "createFilterOptions<VariableOption>\(\{\}\)" shared/dashboards/src/components/Variables/Variable.tsx` matches exactly once, at module scope (outside any function component).
- [ ] `rg -n "const filterOptions = createFilterOptions" shared/dashboards/src/components/Variables/Variable.tsx` returns no matches.
- [ ] Dashboards typecheck, lint, and full tests exit 0.
- [ ] The regression test proves stable `filterOptions` identity and preserved filtering behavior.
- [ ] `git -C shared diff --name-only 472a289..HEAD` lists only in-scope paths, and `git -C shared status --short` is empty after the logical commit.
- [ ] `plans/README.md` status row updated, unless the dispatcher maintains the index.

## STOP conditions

Stop and report back without improvising if:

- Live code already hoists or memoizes `filterOptions` (drift).
- `createFilterOptions` is found to be called with a non-empty, per-render
  config anywhere in this component (then it cannot be a plain module constant
  — report the config).
- Mocking `Autocomplete` to capture the prop requires changing a production
  export.
- Any existing `Variable` test fails in a way that is not a pure identity
  assertion.

## Maintenance notes

- If a future requirement needs a configured filter (e.g. `ignoreCase`,
  `matchFrom`), keep the factory at module scope with a static config; only
  move it back into render (memoized) if the config must depend on props.
- Reviewer: confirm identity-only change; the rendered variable selector must
  behave identically.
- Related but separate: the variable **context** stability is plan 027; this
  plan does not touch it.
