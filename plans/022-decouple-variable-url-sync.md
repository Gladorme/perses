# Plan 022: Decouple URL synchronization from the variable store's mutations

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite workspace root)**:
> `git -C shared diff --stat f8cd4b7..HEAD -- dashboards/src/context/VariableProvider/VariableProvider.tsx dashboards/src/context/VariableProvider/query-params.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. In particular, check whether
> `plans/027-stable-variable-contexts.md` or
> `plans/032-variable-selector-equality.md` already landed — they touch
> the same file; rebase your understanding on the live code if so.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: 021 (same-area, land the small fix first)
- **Category**: tech-debt
- **Planned at**: shared commit `f8cd4b7`, 2026-07-21

## Why this matters

The variable Zustand store performs URL writes *inside* its `set()` mutation
and captures URL state *at store creation*:

1. `setVariableValue` calls `setQueryParams(...)` inside the immer `set()`
   callback — a side effect inside a state reducer, coupling store mutations
   to routing and risking re-entrancy (URL change → provider re-render →
   store read) mid-mutation.
2. `initialParams` is computed once from `queryParams[0]` when the store is
   created. `setVariableDefinitions` — called whenever variable definitions
   are edited — re-hydrates ALL variable state with those *stale initial* URL
   values, so editing one variable's definition can silently reset other
   variables to what the URL said at page-load time, discarding the user's
   current selections.
3. The `setQueryParams` function itself (`queryParams[1]`) is captured at
   creation and never refreshed; if `use-query-params` ever returns a
   location-bound setter, writes go through a stale closure.

After this plan, the store is pure (no routing side effects, no captured URL
state) and the provider owns URL synchronization explicitly.

## Current state

All in `shared/dashboards/src/context/VariableProvider/VariableProvider.tsx`.

Store creation captures URL state once (`VariableProvider.tsx:336-341`):

```ts
function createVariableDefinitionStore({
  initialVariableDefinitions = [],
  externalVariableDefinitions = [],
  queryParams,
}: VariableDefinitionStoreArgs): StoreApi<VariableDefinitionStore> {
  const initialParams = getInitalValuesFromQueryParameters(queryParams ? queryParams[0] : {});
```

`setVariableDefinitions` re-hydrates with the stale `initialParams`
(`VariableProvider.tsx:352-365`):

```ts
setVariableDefinitions(definitions: VariableDefinition[]): void {
  set(
    (state) => {
      state.variableDefinitions = definitions;
      state.variableState = hydrateVariableDefinitionStates(
        definitions,
        initialParams,
        externalVariableDefinitions
      );
    },
    ...
```

`setVariableValue` writes the URL inside `set()`
(`VariableProvider.tsx:392-417`, side effect at 409-412):

```ts
setVariableValue: (name, value, source?: string): void =>
  set(
    (state) => {
      let val = value;
      ...
      if (queryParams) {
        const setQueryParams = queryParams[1];
        setQueryParams({ [getURLQueryParamName(name)]: val });
      }
      varState.value = val;
    },
    ...
```

Providers (`VariableProvider.tsx:488-522`): `VariableProvider` (no URL) and
`VariableProviderWithQueryParams` both create the store lazily via
`useState(() => createVariableDefinitionStore(...))`; the WithQueryParams
variant obtains `queryParams` from `useVariableQueryParams(allVariableDefs)`
each render but the store only ever sees the first render's tuple.

Supporting API (`query-params.ts`): `useVariableQueryParams(defs)` returns
`useQueryParams(config, { updateType: 'replaceIn' })`;
`getURLQueryParamName(name)` prefixes `var-`;
`getInitalValuesFromQueryParameters(params)` strips the prefix.

Store consumers to keep working unchanged: `useVariableDefinitionStates`,
`useVariableDefinitionActions`, `useVariableDefinitions`,
`useExternalVariableDefinitions`, `useVariableDefinitionAndState` (same file,
lines 120–215), and the `PluginProvider` component (lines 222–328).

Conventions: Zustand store per provider mount via context
(`StoreApi` + `useStoreWithEqualityFn`) — see
`DashboardProvider/DashboardProvider.tsx` in the same package as the exemplar.
Tests colocated, Jest + RTL; `shared/dashboards/src/test/` hosts provider
render helpers.

## Target design

Keep the store pure and make the provider the URL-sync owner:

1. **Remove `queryParams` from `VariableDefinitionStoreArgs`.** The store
   takes `initialValues: Record<string, VariableValue>` (already-extracted
   param values) instead, used only for first hydration.
2. **`setVariableValue` mutates state only** (keep the ALL_VALUE
   normalization). No URL access.
3. **`setVariableDefinitions` re-hydrates from CURRENT variable state**, not
   from page-load URL params: build
   `currentValues: Record<string, VariableValue>` from the existing
   `state.variableState` (local, non-overridden entries) and pass that as the
   `initialValues` argument of `hydrateVariableDefinitionStates`, so
   re-defining variables preserves the user's live selections. (Preserving a
   selection whose variable was just removed is naturally handled: hydration
   only reads values for names that exist in the new definitions.)
4. **URL writes move to the provider**: in `VariableProviderWithQueryParams`,
   subscribe to the store and push value changes to the URL in an effect:

```ts
const [store] = useState(() => createVariableDefinitionStore({ initialVariableDefinitions, externalVariableDefinitions, initialValues }));
const setQueryParams = queryParams[1];
useEffect(() => {
  return store.subscribe((state, prevState) => {
    if (state.variableState === prevState.variableState) return;
    const updates: Record<string, VariableValue> = {};
    // local, non-overridden variables only — mirror what setVariableValue used to write
    state.variableDefinitions.forEach((def) => {
      const name = def.spec.name;
      const next = state.variableState.get({ name })?.value;
      const prev = prevState.variableState.get({ name })?.value;
      if (next !== prev) updates[getURLQueryParamName(name)] = next ?? null;
    });
    if (Object.keys(updates).length > 0) setQueryParams(updates);
  });
}, [store, setQueryParams]);
```

   Note the previous behavior wrote the URL for external-source variables too
   (the old code wrote `var-<name>` regardless of `source`). Preserve that:
   also diff external definitions' states (`state.variableState.get({ name,
   source })`) using the same `var-<name>` param name.
5. `VariableProvider` (non-URL variant) needs no effect and passes
   `initialValues: {}`.

This keeps one source of truth (the store) with the URL as a write-behind
mirror, hydrated once on load — the same net behavior as today minus the
stale-capture bugs.

## Commands you will need

Node `v22.14.0` / npm `10.9.2` pinned; STOP if not activatable. Windows:
`npm.cmd`.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix shared ci` | exit 0; lockfile unchanged |
| Focused tests | `npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand VariableProvider` | exit 0 |
| Typecheck | `npm --prefix shared run type-check -- --filter=@perses-dev/dashboards` | exit 0 |
| Lint | `npm --prefix shared run lint --workspace=@perses-dev/dashboards` | exit 0 |
| Full package tests | `npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand` | exit 0 |
| Downstream check | `npm --prefix shared run test --workspace=@perses-dev/plugin-system -- --runInBand` | exit 0 |

## Scope

**In scope**:

- `shared/dashboards/src/context/VariableProvider/VariableProvider.tsx`
- A new colocated test file, e.g.
  `shared/dashboards/src/context/VariableProvider/VariableProvider.test.tsx`
  (create if absent; extend if present)

**Out of scope** (do NOT touch):

- `query-params.ts` / `hydrationUtils.ts` beyond consuming their existing
  exports (plan 021 owns those files).
- The store's public hook API (`useVariableDefinitionStates`,
  `useVariableDefinitionActions`, etc.) — signatures must not change.
- `PluginProvider` internals and the `JSON.stringify` selector equality —
  owned by plans 027 and 032.
- Callers in `shared/dashboards/src/views/` and the Perses app.

## Git workflow

- Nested `shared` repository, branch
  `advisor/022-decouple-variable-url-sync`.
- One commit, e.g. `[ENHANCEMENT] dashboards: decouple URL sync from variable store mutations`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Characterization tests for today's contract

Write tests (RTL, wrapping `VariableProviderWithQueryParams`; mock
`use-query-params` module or wrap with its `QueryParamProvider` test adapter —
follow whatever existing tests in this package do for URL params, see
`query-params.test.ts` and the `shared/dashboards/src/test/` helpers):

1. initial URL `?var-foo=bar` hydrates variable `foo` to `bar`;
2. `setVariableValue('foo', 'baz')` updates store state AND results in a URL
   write of `{ 'var-foo': 'baz' }`;
3. ALL_VALUE normalization: setting `['a', '$__all']` (all last) collapses to
   `$__all`; setting `['$__all', 'a']` filters out the all-value;
4. `setVariableDefinitions` with an added variable keeps `foo`'s CURRENT value
   (this test FAILS today when the current value differs from the initial URL
   value — it pins the fixed behavior, mark it accordingly).

**Verify**: focused tests → 1–3 pass against current code; 4 fails. Do not
commit yet.

### Step 2: Purify the store

Implement items 1–3 of "Target design" in `createVariableDefinitionStore`.
Delete the `queryParams` field from `VariableDefinitionStoreArgs`, delete the
`initialParams` capture, and remove the `setQueryParams` block from
`setVariableValue`.

**Verify**: typecheck fails only in the two provider components (expected,
fixed next step) or passes if you adjust them in the same step — either way
proceed; tests not yet green.

### Step 3: Provider-owned URL sync

Implement items 4–5. Compute
`initialValues = getInitalValuesFromQueryParameters(queryParams[0])` in
`VariableProviderWithQueryParams` before store creation. Add the subscribe
effect exactly once per store; make sure the subscription is disposed on
unmount (return value of `store.subscribe`).

**Verify**: focused tests → all four pass. Full dashboards suite passes.

### Step 4: Downstream verification

**Verify**: typecheck, lint, full dashboards tests, and the plugin-system
package tests all exit 0 (plugin-system consumes the variable context).

## Test plan

Four tests from Step 1 in `VariableProvider.test.tsx`. Use existing helpers in
`shared/dashboards/src/test/` for provider wrapping; keep tests independent of
plugin registry by using Text/StaticList variables only.

## Done criteria

- [ ] `rg -n "setQueryParams" shared/dashboards/src/context/VariableProvider/VariableProvider.tsx` → matches only inside the provider effect, none inside `createVariableDefinitionStore`.
- [ ] `rg -n "initialParams" shared/dashboards/src/context/VariableProvider/VariableProvider.tsx` → no matches.
- [ ] All four new tests pass; full dashboards + plugin-system suites pass; typecheck and lint exit 0.
- [ ] `git -C shared diff --name-only f8cd4b7..HEAD` lists only in-scope paths.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- Plan 027 or 032 landed and restructured
  `VariableProvider.tsx` beyond the excerpts — re-read and report before
  proceeding.
- The URL-sync effect causes an update loop (URL write → param change →
  re-render → store write). The design avoids it because params never write
  back into the store after initial hydration — if you find a code path where
  they do, stop and report it.
- Preserving current values in `setVariableDefinitions` breaks an existing
  test that expects reset-to-URL behavior — report; the team may rely on it.
- A verification command fails twice after a reasonable in-scope fix attempt.

## Maintenance notes

- Follow-up (deferred): browser back/forward currently does NOT re-hydrate
  variable state (params are only read at store creation) — unchanged by this
  plan. If back-button support is added later, the provider effect is the
  place to diff params→store, with a guard flag against echo loops.
- Reviewers: scrutinize the subscribe diff for external-source variables and
  the `null` encoding of cleared values (must match `encodeVariableValue`).
