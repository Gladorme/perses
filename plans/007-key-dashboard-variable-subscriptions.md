# Plan 007: Key dashboard variable subscriptions by actual dependency

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. Complete `plans/001-fix-query-readiness-predicates.md` and
> `plans/006-gate-non-time-series-panel-queries.md` first. If
> anything in the "STOP conditions" section occurs, stop and report — do not
> improvise. When done, update the status row for this plan in
> `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite repository root)**:
> `git -C shared diff --stat f8cd4b7..HEAD -- package-lock.json plugin-system/package.json plugin-system/src/runtime/variables.ts plugin-system/src/runtime/variables.test.tsx plugin-system/src/runtime/time-series-queries.ts plugin-system/src/runtime/time-series-queries.test.tsx plugin-system/src/runtime/trace-queries.ts plugin-system/src/runtime/log-queries.ts plugin-system/src/runtime/query-options.test.tsx plugin-system/src/runtime/query-variable-subscriptions.test.tsx dashboards/src/context/VariableProvider/VariableProvider.tsx dashboards/src/context/VariableProvider/VariableProvider.test.tsx dashboards/src/components/Variables/VariableList.tsx dashboards/src/components/Variables/Variable.tsx dashboards/src/components/GridLayout/GridLayout.tsx dashboards/src/components/PanelDrawer/PanelDrawer.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition, with these two allowances only:
> Plans 001 and 006 intentionally change the time-series/trace/log paths and
> create their test files. Confirm their AND-readiness and external-visibility
> postconditions match the excerpts and regression requirements below; that
> known prerequisite drift is expected. Any other semantic drift is a STOP
> condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/001-fix-query-readiness-predicates.md`, `plans/006-gate-non-time-series-panel-queries.md`
- **Category**: perf
- **Planned at**: commit `f8cd4b7`, 2026-07-21

## Why this matters

Variable updates currently fan out twice: each toolbar control subscribes two
or three times with a fresh-object selector, and the plugin bridge publishes a
new whole variable map through React context. A single variable loading or
options update can therefore rerender every variable control and every panel
query consumer, even when a plugin declares one specific dependency. This plan
first removes duplicate dashboard subscriptions and batches list-variable
notifications, then adds an additive store-backed context bridge so internal
query consumers subscribe only to declared variable names while the public
whole-map hook remains compatible.

## Current state

### Dashboard variable controls

- `shared/dashboards/src/context/VariableProvider/VariableProvider.tsx`
  owns the Zustand variable-definition/state store.
- `shared/dashboards/src/components/Variables/VariableList.tsx` maps definitions
  to toolbar controls.
- `shared/dashboards/src/components/Variables/Variable.tsx` renders list/text
  controls and writes query results back to the store.

The keyed selector currently returns a fresh object without equality
(`VariableProvider.tsx:163-179`):

```ts
const store = useVariableDefinitionStoreCtx();
return useStore(store, (s) => {
  const state = s.variableState.get({ name, source });
  // ...find definition...
  return { state, definition };
});
```

The same control then subscribes repeatedly:

```ts
// VariableList.tsx:42-56
const ctx = useVariableDefinitionAndState(spec.name, source);
// ...
<Variable name={spec.name} source={source} />

// Variable.tsx:53-60, 174-178, 345-348
const ctx = useVariableDefinitionAndState(name, source);
// Variable dispatch subscribes, then ListVariable/TextVariable subscribes again.
```

List variables write one render's result through three effects
(`Variable.tsx:199-216`):

```ts
useEffect(() => { if (value) setVariableValue(name, value, source); }, [/* ... */]);
useEffect(() => { setVariableLoading(name, loading, source); }, [/* ... */]);
useEffect(() => { if (options) setVariableOptions(name, options, source); }, [/* ... */]);
```

The correct selector convention already exists in
`DashboardProvider.tsx:70-75`: `useStoreWithEqualityFn(store, selector,
shallow)`.

### Plugin variable context

`shared/plugin-system/src/runtime/variables.ts:116-148` exposes a plain state
object through context and filters names only after consuming that context:

```ts
export type VariableSrv = { state: VariableStateMap };
export const VariableContext = createContext<VariableSrv | undefined>(undefined);

export function useVariableValues(names?: string[]): VariableStateMap {
  const { state } = useVariableContext();
  const values = useMemo(() => {
    const values: VariableStateMap = {};
    names?.forEach((name) => { /* copy from state */ });
    return values;
  }, [state, names]);
  return names === undefined ? state : values;
}
```

Because `useContext` observes the whole provider value, `names` narrows only
the returned object, not the React subscription.

`VariableProvider.tsx:120-155` reconstructs all states and compares complete
maps with `JSON.stringify`. `PluginProvider` then clones every state at
`VariableProvider.tsx:222-249` and publishes a fresh context value at lines
323-326:

```tsx
<VariableContext.Provider value={{ state: values }}>{children}</VariableContext.Provider>
```

Internal repeat overrides also construct raw providers at
`GridLayout.tsx:140-155` and `PanelDrawer.tsx:123-129`.

`PluginProvider` also wraps its memoized builtin-variable array in a fresh
object on every broad variable-state rerender
(`VariableProvider.tsx:323-326`):

```tsx
<BuiltinVariableContext.Provider value={{ variables: allBuiltinVariables }}>
```

That fresh context value can still wake a named `useAllVariableValues()`
consumer even after the user-variable context becomes selector-backed. The
wrapper object must be memoized without changing builtin-variable contents.

### Internal query consumers

- `time-series-queries.ts:154-163` calls `useAllVariableValues()` for every
  time-series panel before filtering by `plugin.dependsOn`.
- `trace-queries.ts:96-105` does the same for traces.
- `log-queries.ts:25-40` consumes the complete map and places it directly in
  every log query key, despite `LogQueryPlugin.dependsOn` existing at
  `model/log-queries.ts:32-38`.
- Existing repository query-plugin `dependsOn` implementations derive variable
  names from the query spec. Before implementing Step 3, re-run the read-only
  search in that step and enforce its STOP condition.

Plan 001's prerequisite must be visible before work begins:

```ts
// time-series single and multi hooks
enabled: (queryOptions?.enabled ?? true) && queryEnabled,
```

Plan 006's external `queryOptions` arguments and `query-options.test.tsx`
visibility truth tables must be present. AND them with the new
plugin/dependency readiness; do not overwrite that work.

## Commands you will need

Use Node `v22.14.0` from `shared/.nvmrc` and npm `10.9.2` from
`shared/package.json`; if those pinned versions cannot be activated, STOP
before installing or testing. On Windows PowerShell, use `npm.cmd` when
`npm.ps1` is policy-blocked.

| Purpose | Command | Expected on success |
|---|---|---|
| Install baseline | `npm --prefix shared ci` | exit 0; the checked-in lockfile is unchanged |
| Add direct dependency | `npm --prefix shared install "zustand@^4.3.3" --workspace=@perses-dev/plugin-system` | exit 0; only plugin-system's manifest and the matching lockfile workspace entry change |
| Plugin focused tests | `npm --prefix shared run test --workspace=@perses-dev/plugin-system -- --runInBand variables.test.tsx time-series-queries.test.tsx query-options.test.tsx query-variable-subscriptions.test.tsx` | exit 0; keyed-store, query-dependency, readiness, and visibility suites pass |
| Dashboard focused tests | `npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand VariableProvider.test.tsx Variable.test.ts` | exit 0; selector, batching, and existing list-state suites pass |
| Plugin typecheck | `npm --prefix shared run type-check -- --filter=@perses-dev/plugin-system` | exit 0 after Turbo runs upstream builds, with no TypeScript errors |
| Dashboard typecheck | `npm --prefix shared run type-check -- --filter=@perses-dev/dashboards` | exit 0 after Turbo runs upstream builds, with no TypeScript errors |
| Plugin lint | `npm --prefix shared run lint --workspace=@perses-dev/plugin-system` | exit 0 |
| Dashboard lint | `npm --prefix shared run lint --workspace=@perses-dev/dashboards` | exit 0 |
| Affected builds | `npm --prefix shared run build -- --filter=@perses-dev/plugin-system --filter=@perses-dev/dashboards` | exit 0; both packages and upstream dependencies emit cleanly |
| Plugin full tests | `npm --prefix shared run test --workspace=@perses-dev/plugin-system -- --runInBand` | exit 0; all plugin-system suites pass |
| Dashboard full tests | `npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand` | exit 0; all dashboard suites pass |

## Suggested executor toolkit

- Use `vercel-react-best-practices` if available, specifically its guidance on
  narrow external-store subscriptions, stable provider values, and avoiding
  effect-driven derived state.
- Use React DevTools only as optional confirmation; the automated render-count
  tests below are the acceptance gate.

## Scope

**In scope** (the only implementation files you should modify):

- `shared/plugin-system/package.json`
- `shared/package-lock.json`
- `shared/plugin-system/src/runtime/variables.ts`
- `shared/plugin-system/src/runtime/variables.test.tsx` (create)
- `shared/plugin-system/src/runtime/time-series-queries.ts`
- `shared/plugin-system/src/runtime/time-series-queries.test.tsx` (extend the
  file created by Plan 001)
- `shared/plugin-system/src/runtime/trace-queries.ts`
- `shared/plugin-system/src/runtime/log-queries.ts`
- `shared/plugin-system/src/runtime/query-options.test.tsx` (extend the file
  created by Plan 006)
- `shared/plugin-system/src/runtime/query-variable-subscriptions.test.tsx`
  (create)
- `shared/dashboards/src/context/VariableProvider/VariableProvider.tsx`
- `shared/dashboards/src/context/VariableProvider/VariableProvider.test.tsx`
  (create)
- `shared/dashboards/src/components/Variables/VariableList.tsx`
- `shared/dashboards/src/components/Variables/Variable.tsx`
- `shared/dashboards/src/components/GridLayout/GridLayout.tsx`
- `shared/dashboards/src/components/PanelDrawer/PanelDrawer.tsx`

`plans/README.md` is an administrative status-only exception after completion.

**Out of scope** (do NOT touch):

- Removing or changing the return shape of public `useVariableValues()` or
  `useAllVariableValues()`.
- Requiring external consumers to replace existing
  `<VariableContext.Provider value={{ state }}>` usage; legacy providers must
  continue to compile and work.
- Builtin-variable context architecture, URL query-parameter semantics, list
  option virtualization, or variable editor UX.
- Profile queries, which do not consume variable state.
- Changing plugin `dependsOn` interfaces or plugin implementations under
  `plugins/`.
- Adding a new state-management library. Reuse the repository's existing
  Zustand 4 line and add it as a direct plugin-system dependency.

## Git workflow

- Work in the nested `shared` repository on branch
  `advisor/007-key-dashboard-variable-subscriptions` after Plans 001 and 006
  are done.
- Because this is a large change, make two reviewable commits:
  1. `[ENHANCEMENT] dashboards: narrow variable control subscriptions`
  2. `[ENHANCEMENT] plugin-system: key variable query subscriptions`
- Rebase or merge both prerequisites before the first commit and preserve Plan
  006's query-option tests. Do not silently resolve semantic conflicts.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 0: Reinstall the locked shared workspace and verify prerequisites

Run `npm --prefix shared ci`; do not rely on an existing `node_modules`. Then
run Plan 001's focused readiness tests and Plan 006's focused visibility tests
unchanged. A failure here is a prerequisite/baseline failure, not something to
fix inside this plan.

**Verify**: `npm --prefix shared ci` exits 0,
`git -C shared diff -- package-lock.json` prints nothing, and
`npm --prefix shared run test --workspace=@perses-dev/plugin-system -- --runInBand variable-model.test.ts time-series-queries.test.tsx DataQueriesProvider.test.tsx query-options.test.tsx`
exits 0. If the test command fails before any Plan 007 edit, STOP and report.

### Step 1: Narrow dashboard-control selectors and batch list updates

In `VariableProvider.tsx`:

1. change `useVariableDefinitionAndState` to
   `useStoreWithEqualityFn(store, selector, shallow)` so an unrelated store
   update does not rerender a consumer whose selected state/definition did not
   change;
2. add one action such as `setVariableState` that accepts a partial update for
   `value`, `loading`, and `options`, locates the same `{ name, source }` state,
   and applies all provided fields inside one Zustand `set` call;
3. expose that action from `useVariableDefinitionActions` without removing the
   existing granular actions, which are public and used by interactions.

In `VariableList.tsx` and `Variable.tsx`:

1. let `VariableListItem` resolve `{ definition, state }` once;
2. introduce an internal presentational dispatcher that receives the resolved
   values and passes them to `ListVariable` or `TextVariable`;
3. keep exported `Variable({ name, source })` as a compatibility wrapper that
   performs one selector call for direct consumers;
4. make the toolbar path call the internal dispatcher, so it has one
   state/definition subscription rather than the current three; retain the
   existing shallow `useVariableDefinitionActions()` action-selector
   subscription, which does not wake for value changes;
5. replace the three query-result effects in `ListVariable` with one effect
   calling the new batch action. Preserve the current guards: do not overwrite
   value when the derived value is absent, and do not change user-driven
   `setVariableValue` handlers.

Create `VariableProvider.test.tsx`. Using `VariableProvider`,
`TimeRangeProviderBasic`, and the existing test render utilities, cover:

- a hook selecting variable `alpha` does not rerender when only `beta` changes;
- it does rerender when `alpha` changes;
- one batched value/loading/options update triggers one store subscription
  notification and commits all three fields;
- the exported direct `Variable` compatibility wrapper still renders.

**Verify**:
`npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand VariableProvider.test.tsx Variable.test.ts`
→ exit 0; render counts, one-notification batching, and existing list-state
behavior all pass.

### Step 2: Add an additive store-backed variable-context bridge

Add `zustand` to `shared/plugin-system/package.json` using the exact command in
the table and the same compatible range already used by dashboards (`^4.3.3`).
Do not run an unscoped install or hand-edit transitive lock entries.

In `plugin-system/src/runtime/variables.ts`, implement these concepts with
explicit exported names and tests:

1. retain the legacy `VariableSrv` shape `{ state: VariableStateMap }` as an
   accepted `VariableContext` value;
2. add a selectable store value backed by Zustand, holding the same `state`
   field and exposing standard `getState`/`subscribe` behavior;
3. export a `VariableStateProvider` component that lazily creates that store
   exactly once per mount (lazy `useState` or an equivalent stable ref), keeps
   the context value referentially stable, and synchronizes a changed `state`
   prop with `store.setState` in a layout effect; render-phase store writes are
   forbidden, while this layout-effect synchronization is explicitly allowed
   so descendants observe the update before paint;
4. update `useVariableValues(names?)` so it always obeys hook ordering and:
   - selects only requested names when `names` is provided;
   - returns/subscribes to the complete map when names are omitted (the
     compatibility whole-map hook);
   - adapts a legacy plain context value internally, so external raw providers
     still work;
5. compare selected maps by key and selected `VariableState` content/reference,
   not by the identity of the newly allocated wrapper map;
6. export an internal-use snapshot helper that reads the current complete map
   without subscribing to every entry. Its documentation must state that it is
   only for calculating a stable dependency-name set before calling the keyed
   hook; it must not be used to render values directly.

Use `useStoreWithEqualityFn`/`shallow` rather than adding a custom subscription
hook. Ensure React 17 compatibility through Zustand's existing traditional API.

Update dashboard internal providers:

- replace the main raw provider at `VariableProvider.tsx:325` with
  `VariableStateProvider`;
- replace raw repeat providers in `GridLayout.tsx:140-155` and
  `PanelDrawer.tsx:123-129` with `VariableStateProvider`;
- preserve unchanged `VariableState` object identities in `PluginProvider`.
  Do not clone every state merely to handle `$__all`; reuse the original state
  when it is not the all sentinel, and cache/reuse the derived all-state object
  while its source state and custom-all definition are unchanged.
- memoize the `BuiltinVariableContext` wrapper as
  `useMemo(() => ({ variables: allBuiltinVariables }),
  [allBuiltinVariables])`; do not change the builtin array or its time-range
  dependencies.

Create `variables.test.tsx` with all of these cases:

- two named consumers under `VariableStateProvider`; updating `beta` rerenders
  the `beta` consumer but not the `alpha` consumer;
- a whole-map consumer rerenders on either update;
- replacing a selected state's object with equal content does not rerender the
  named consumer;
- legacy `<VariableContext.Provider value={{ state }}>` still supports named
  reads, whole-map reads, and provider-value updates;
- updating `VariableStateProvider`'s `state` prop inside one Testing Library
  `act` makes the new selected value observable before the assertion and emits
  no render-phase/update warning; and
- repeat override state shadows only the named variable and retains the other
  values.

Also add an integrated dashboard-provider case to
`VariableProvider.test.tsx`: render a counter consumer of
`useAllVariableValues(['alpha'])` beneath the real internal `PluginProvider`,
update only `beta` through the captured dashboard variable store, and prove the
consumer does not rerender. This catches both the selector-backed user-variable
provider and the memoized builtin-context wrapper.

**Verify**:
`npm --prefix shared run test --workspace=@perses-dev/plugin-system -- --runInBand variables.test.tsx`
→ exit 0; exact render-count and compatibility assertions pass;
`npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand VariableProvider.test.tsx`
→ exit 0, including the integrated named-consumer case; then
`npm --prefix shared run type-check -- --filter=@perses-dev/plugin-system`
→ exit 0 after upstream builds, proving the legacy provider shape remains
accepted.

### Step 3: Subscribe panel-query hooks to declared variable names

First run this read-only check:

`rg -n "dependsOn\s*[:=(]" plugins shared --glob "*.ts" --glob "*.tsx"`

Inspect every time-series, trace, and log query-plugin implementation returned
by the search. Proceed only if its dependency-name set is derived from the
query spec/plugin configuration (the current audited pattern). If a query
plugin changes its dependency names in response to the current value of an
otherwise-undeclared variable, STOP: the non-subscribing snapshot bootstrap is
not safe for that contract.

Refactor all four relevant hooks explicitly:

- `useTimeSeriesQuery` computes the declared names for its one definition;
- `useTimeSeriesQueries` computes one de-duplicated union for all definitions;
- `useTraceQueries` computes the trace-definition union; and
- `useLogQueries` computes the log-definition union.

For each hook:

1. load plugin implementations before selecting reactive variable values;
2. read one non-reactive complete snapshot solely to call each plugin's
   `dependsOn` and calculate the union of declared names for the definitions in
   that hook call;
3. if any loaded plugin lacks `dependsOn`, use `undefined` as the union so that
   family deliberately retains the compatibility whole-map subscription;
4. call `useAllVariableValues(unionNames)` exactly once, unconditionally, and
   use that selected map in query contexts and keys;
5. keep per-definition filtering because different definitions can use
   different subsets of the union;
6. keep plugin-missing and dependency-loading readiness disabled. Preserve the
   AND predicates from Plan 001 and Plan 006's external visibility
   gate.

For logs, use `LogQueryPlugin.dependsOn`, key by
`getVariableValuesKey(filteredState)` rather than the complete state object,
and wait for declared variables to finish loading. Plugins without `dependsOn`
must retain current all-variable semantics.

Extend Plan 001's `time-series-queries.test.tsx`, Plan 006's
`query-options.test.tsx`, and create `query-variable-subscriptions.test.tsx`.
Mock plugin `dependsOn` results and
the variable hooks to assert:

- one definition requests exactly its declared names;
- multiple definitions request the de-duplicated union;
- a plugin without `dependsOn` requests `undefined`/the whole map;
- an unrelated variable is absent from the time-series, trace, and log query
  keys/contexts;
- a declared loading dependency disables the query;
- the single time-series hook selects only its one definition's names, while
  the multi hooks select their de-duplicated unions; and
- Plan 001 readiness and Plan 006 visibility options remain ANDed in all four
  hooks.

**Verify**:
`npm --prefix shared run test --workspace=@perses-dev/plugin-system -- --runInBand time-series-queries.test.tsx query-options.test.tsx query-variable-subscriptions.test.tsx`
→ exit 0; all four hooks prove single/union dependency selection, readiness,
and visibility behavior.

### Step 4: Run both package regression suites

Run all focused tests together, then both packages' typechecks, lints, and full
test suites. Fix only in-scope fallout. Inspect the final diff to ensure no
public variable hook was removed and no raw dashboard provider remains.

**Verify**:
`npm --prefix shared run test --workspace=@perses-dev/plugin-system -- --runInBand variables.test.tsx time-series-queries.test.tsx query-options.test.tsx query-variable-subscriptions.test.tsx`
→ exit 0; and
`npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand VariableProvider.test.tsx Variable.test.ts`
→ exit 0; then both filtered typechecks, both workspace lints, the affected
builds command, and both full `test -- --runInBand` commands listed above exit
0.

## Test plan

- `dashboards/.../VariableProvider.test.tsx`: keyed local selector render
  counts, one-notification batch update, direct `Variable` compatibility.
- `plugin-system/runtime/variables.test.tsx`: store-backed named selectors,
  whole-map compatibility, equal-content stability, legacy raw provider, and
  repeat override.
- Extend `time-series-queries.test.tsx`: dependency union and preservation of
  Plan 001's readiness truth table.
- Extend `query-options.test.tsx`: Plan 006's external `enabled` gate remains
  an AND term for time-series, trace, profile, and log families after variable
  dependency narrowing.
- `query-variable-subscriptions.test.tsx`: trace/log dependency selection,
  query-key narrowing, loading gates, and optional Plan 006 external gate.
- Use `variable-model.test.ts:61-70` as the context-hook mocking exemplar,
  `DataQueriesProvider.test.tsx:21-35` as the query-hook mocking exemplar, and
  `dashboards/src/test/dashboard-provider.tsx:28-49` as the store-capture
  convention.
- Verification: all focused commands in Step 4 exit 0, then both full package
  suites exit 0.

## Done criteria

Machine-checkable; ALL must hold:

- [ ] `rg -n '"zustand": "\^4\.3\.3"' shared/plugin-system/package.json` returns exactly one match, and the scoped install command exits 0 without unrelated manifest changes.
- [ ] `rg -n "useStoreWithEqualityFn" shared/dashboards/src/context/VariableProvider/VariableProvider.tsx` includes `useVariableDefinitionAndState`.
- [ ] `rg -n "useVariableDefinitionAndState" shared/dashboards/src/components/Variables/Variable.tsx` returns exactly one match (the exported compatibility wrapper), and `VariableListItem` performs the toolbar's single keyed read.
- [ ] `rg -n "setVariable(Value|Loading|Options)\(name, (value|loading|options), source\)" shared/dashboards/src/components/Variables/Variable.tsx` finds no three-effect query-result sequence; one batch action is used instead.
- [ ] `rg -n "VariableContext\.Provider" shared/dashboards/src` returns no matches; internal providers use `VariableStateProvider`.
- [ ] `useVariableValues()` with no names remains exported and covered by a whole-map rerender test.
- [ ] A legacy `{ state }` `VariableContext.Provider` typechecks and passes its compatibility test.
- [ ] Named `alpha` consumers do not rerender for `beta` updates in both dashboard-store and plugin-context tests.
- [ ] The integrated dashboard-provider test proves the memoized builtin context does not wake a named `alpha` consumer for a `beta`-only update.
- [ ] Provider-prop synchronization is layout-effect based, visible within the same `act`, and produces no render-phase warning.
- [ ] Single and multi time-series, trace, and log tests prove declared-name selection/unions, exclusion of an unrelated variable, and preservation of Plan 006's visibility gates.
- [ ] Plugin-system and dashboards focused tests, typechecks, lints, and full tests all exit 0.
- [ ] The combined filtered build for plugin-system and dashboards exits 0.
- [ ] Before committing, `git -C shared status --short` contains only the sixteen in-scope paths; after the two Plan 007 commits, `git -C shared diff --name-only HEAD~2..HEAD` lists exactly those sixteen paths and `git -C shared status --short` is empty.
- [ ] `plans/README.md` status row is updated, unless the dispatcher said it maintains the index.

## STOP conditions

Stop and report back without improvising if:

- Preserving external `<VariableContext.Provider value={{ state }}>` usage or
  the return shape of `useVariableValues()` requires a breaking API rather than
  the additive legacy/store bridge described above.
- Any time-series, trace, or log query plugin derives its dependency-name set
  from the live value of an otherwise-undeclared variable; keyed bootstrap
  would miss the change.
- Zustand cannot be added as one direct dependency at the repository's existing
  compatible version without a lockfile-wide upgrade or peer conflict.
- Lazy store creation plus the prescribed layout-effect synchronization causes
  a React 17 incompatibility, tears in tests, or remains stale after the same
  `act`. Render-phase updates remain forbidden; do not suppress warnings.
- Plan 001's AND readiness predicates are absent, Plan 006 is incomplete, or
  dependency narrowing would drop its external visibility gate/tests.
- The fix requires changing plugin interfaces/implementations, builtin
  variables, URL behavior, or a file outside Scope.
- A render-count test is nondeterministic after removing StrictMode and flushing
  updates with `act`, or any verification fails twice after a reasonable
  in-scope attempt.

## Maintenance notes

- `useVariableValues()` without names is intentionally the compatibility escape
  hatch and will rerender on every variable-map change. New internal code should
  pass names whenever it can identify dependencies.
- The non-subscribing snapshot helper is only a dependency-discovery bootstrap;
  rendering or keying directly from it would create stale UI/data.
- Reviewers should scrutinize object identity through `$__all` expansion,
  legacy-provider adaptation, hook ordering, and the fallback when a plugin has
  no `dependsOn`.
- Variable-plugin option queries retain their current broad bootstrap because
  at least one variable plugin consults datasource context while calculating
  dependencies. Narrowing that path is explicitly deferred until its contract
  can be characterized separately.
