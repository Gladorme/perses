# Plan 008: Keep dashboard-root callbacks off the full resource subscription

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and report
> — do not improvise. When done, update the status row for this plan in
> `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite repository root)**:
> `git -C shared diff --stat f8cd4b7..HEAD -- dashboards/src/context/useDashboard.tsx dashboards/src/context/useDashboard.test.tsx dashboards/src/views/ViewDashboard/DashboardApp.tsx dashboards/src/views/ViewDashboard/DashboardApp.test.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Plans 001, 002, 006, and 007 should
> not modify these four paths; any diff is unexpected.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `f8cd4b7`, 2026-07-21

## Why this matters

`DashboardApp`, the always-mounted view root, subscribes to and serializes the
complete dashboard resource even though it uses that resource mainly inside
edit/cancel/discard callbacks. Any panel, layout, metadata, datasource, or
variable-definition update therefore rerenders the root and recreates its grid
subtree. A stable action-only API can read the latest stores at event time;
only the leave-confirmation component needs a reactive complete snapshot, and
that broad subscription can be isolated below the root.

## Current state

- `shared/dashboards/src/context/useDashboard.tsx` converts Zustand panel-group
  state plus variable definitions back into a dashboard resource.
- `shared/dashboards/src/views/ViewDashboard/DashboardApp.tsx` is the
  always-mounted toolbar/grid/dialog root.
- `shared/dashboards/src/test/dashboard-provider.tsx:28-49` provides the store
  spy convention for tests.
- `shared/dashboards/src/views/ViewDashboard/tests/panelGroups.test.tsx:21-39`
  is the existing full-provider DashboardApp render exemplar.

The current hook subscribes broadly (`useDashboard.tsx:29-70`):

```ts
const {
  panels,
  panelGroups,
  panelGroupOrder,
  setDashboard: setDashboardResource,
  kind,
  metadata,
  display,
  duration,
  refreshInterval,
  datasources,
  ttl,
} = useDashboardStore(/* selector returning every field above */);
const { setVariableDefinitions } = useVariableDefinitionActions();
const variables = useVariableDefinitions();
const layouts = convertPanelGroupsToLayouts(panelGroups, panelGroupOrder);
```

It then allocates a complete resource and setter on every subscribed render
(`useDashboard.tsx:72-110`). Keep this public hook working for callers that
truly need a reactive complete resource.

The root consumes it at `DashboardApp.tsx:64-70`:

```ts
const { isEditMode, setEditMode } = useEditMode();
const { dashboard, setDashboard } = useDashboard();
const [originalDashboard, setOriginalDashboard] = useState<DashboardResource | EphemeralDashboardResource>();
```

The resource is used in event handlers (`DashboardApp.tsx:76-108`):

```ts
setOriginalDashboard(dashboard);
setSavedDatasources(dashboard.spec.datasources ?? {});
if (JSON.stringify(dashboard) === JSON.stringify(originalDashboard)) { /* ... */ }
```

The only render-time need is the conditional leave dialog
(`DashboardApp.tsx:149-151`):

```tsx
{isLeavingConfirmDialogEnabled && isEditMode && (
  <LeaveDialog original={originalDashboard} current={dashboard} />
)}
```

`DashboardContext` and `useVariableDefinitionStoreCtx` expose stable store
objects. Their `.getState()` methods may be read inside event callbacks without
creating React subscriptions. Preserve the exact dashboard serialization,
`setDashboard` behavior (dashboard state plus variable definitions), edit
snapshot semantics, and `onDiscard` payload.

## Commands you will need

Use Node `v22.14.0` from `shared/.nvmrc` and npm `10.9.2` from
`shared/package.json`; if those pinned versions cannot be activated, STOP
before installing or testing. On Windows PowerShell, use `npm.cmd` when
`npm.ps1` is policy-blocked.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix shared ci` | exit 0; `shared/package-lock.json` is unchanged |
| Focused tests | `npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand useDashboard.test.tsx DashboardApp.test.tsx` | exit 0; action freshness and root render-count suites pass |
| Existing view regression | `npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand panelGroups.test.tsx` | exit 0; panel/group editing behavior passes |
| Typecheck | `npm --prefix shared run type-check -- --filter=@perses-dev/dashboards` | exit 0 after Turbo runs upstream builds, with no TypeScript errors |
| Lint | `npm --prefix shared run lint --workspace=@perses-dev/dashboards` | exit 0, no ESLint errors |
| Build | `npm --prefix shared run build -- --filter=@perses-dev/dashboards` | exit 0; dashboards and upstream packages emit cleanly |
| Full package tests | `npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand` | exit 0; all dashboard suites pass |

## Suggested executor toolkit

- Use `vercel-react-best-practices` if available, especially the guidance to
  read changing state at event time instead of subscribing a parent solely for
  callbacks.

## Scope

**In scope** (the only implementation files you should modify):

- `shared/dashboards/src/context/useDashboard.tsx`
- `shared/dashboards/src/context/useDashboard.test.tsx` (create)
- `shared/dashboards/src/views/ViewDashboard/DashboardApp.tsx`
- `shared/dashboards/src/views/ViewDashboard/DashboardApp.test.tsx` (create)

`plans/README.md` is an administrative status-only exception after completion.

**Out of scope** (do NOT touch):

- Dashboard store slices, provider initialization, or serialization format.
- The public return shape or reactive semantics of existing `useDashboard()`.
- Replacing the JSON equality check with a different dirty-state algorithm.
- Memoizing the entire Dashboard component tree, changing dialog store APIs, or
  changing edit/discard product behavior.
- Moving callbacks into Zustand or changing `onSave`/`onDiscard` contracts.

## Git workflow

- Work in the nested `shared` repository on branch
  `advisor/008-narrow-dashboard-root-subscription`.
- Commit as one logical unit after verification, for example:
  `[ENHANCEMENT] dashboards: narrow dashboard root subscription`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 0: Reinstall the locked shared workspace

Run `npm --prefix shared ci` before collecting the focused-test baseline. Do
not rely on an existing `node_modules`; the audited checkout had an incomplete
install. The command must not rewrite the lockfile.

**Verify**: `npm --prefix shared ci` exits 0 and
`git -C shared diff -- package-lock.json` prints nothing.

### Step 1: Extract one serializer used by reactive and imperative paths

In `useDashboard.tsx`, extract the current resource construction into one pure
function that accepts:

- the current dashboard store fields needed for serialization; and
- the current variable definitions.

It must continue to call `convertPanelGroupsToLayouts` and preserve both
`Dashboard` and `EphemeralDashboard` shapes, including `ttl` only on the latter.
Use this same function from the existing reactive `useDashboard()` hook; do not
duplicate serialization logic.

Create `useDashboard.test.tsx` and add table-driven tests for normal and
ephemeral resources, asserting the output matches the current dashboard shape,
layout conversion, variables, datasources, refresh interval, and TTL behavior.
Use `getTestDashboard()` and create the smallest explicit ephemeral fixture.

**Verify**:
`npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand useDashboard.test.tsx`
→ exit 0; both resource kinds serialize exactly as before.

### Step 2: Add a stable action-only resource API

In `useDashboard.tsx`, export a clearly named hook such as
`useDashboardResourceActions` returning:

```ts
{
  getDashboard: () => DashboardResource | EphemeralDashboardResource;
  setDashboard: (resource: DashboardResource | EphemeralDashboardResource) => void;
}
```

Implementation requirements:

1. read the stable `DashboardContext` store object with `useContext`; throw the
   same missing-provider error style as `useDashboardStore`;
2. read the stable variable store with `useVariableDefinitionStoreCtx`;
3. make `getDashboard` call `.getState()` on both stores at invocation time and
   pass those snapshots through the Step 1 serializer;
4. make `setDashboard` call the current variable action and current dashboard
   action from `.getState()`; preserve the current ordering (variables first,
   dashboard second);
5. return stable callbacks/object via `useCallback`/`useMemo` keyed only by the
   two store objects;
6. refactor existing `useDashboard()` to reuse this setter while retaining its
   broad reactive selector for compatibility.

Extend `useDashboard.test.tsx` with a harness that counts renders of only the
action hook. Capture the dashboard store with `createDashboardProviderSpy`,
mutate one serialized field inside `act`, and assert:

- the action-hook harness did not rerender;
- `getDashboard()` immediately returns the new field;
- `setDashboard()` updates both dashboard state and variable definitions;
- callback identities remain stable across an unrelated parent rerender.

**Verify**:
`npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand useDashboard.test.tsx`
→ exit 0; the imperative API is fresh while its consumer render count stays
unchanged.

### Step 3: Move DashboardApp callbacks to event-time reads

In `DashboardApp.tsx`, replace the root's `useDashboard()` call with the new
action-only hook. Update handlers carefully:

- edit: call `getDashboard()` once, store that exact resource in
  `originalDashboard`, and initialize saved datasources from it;
- cancel: call `getDashboard()` once and compare that snapshot with
  `originalDashboard` using the existing JSON comparison;
- discard confirmation: capture the cancel-time current snapshot in the stored
  callback so `onDiscard` receives the same resource the user chose to discard;
- actual discard: restore `originalDashboard`, exit edit mode, close the
  dialog, and preserve the existing `onDiscard` behavior/type cast.

Do not call `getDashboard()` multiple times in one handler; one event should
operate on one coherent snapshot.

Move the render-time leave-dialog need into a small child component in the same
file. That child alone calls reactive `useDashboard()` and renders
`LeaveDialog`. Mount it only under the existing
`isLeavingConfirmDialogEnabled && isEditMode` condition. Thus leave protection
continues receiving live dashboard state without subscribing `DashboardApp`.

**Verify**:
`npm --prefix shared run type-check -- --filter=@perses-dev/dashboards`
→ exit 0 after Turbo's upstream builds, and
`npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand panelGroups.test.tsx`
→ exit 0; existing edit/delete flows remain intact.

### Step 4: Prove store updates no longer rerender the root

Create `DashboardApp.test.tsx` using the provider structure in
`views/ViewDashboard/tests/panelGroups.test.tsx`. Narrowly mock the exported
`Dashboard` and `LeaveDialog` components while retaining other real exports.
Track their render calls and cover:

1. with leave confirmation disabled, mutate panels/layout/metadata through the
   captured dashboard store; the mocked Dashboard child is not invoked again
   because `DashboardApp` no longer rerenders from the full resource;
2. with leave confirmation enabled and edit mode true, the root Dashboard child
   still does not rerender on a resource mutation, while the isolated
   `LeaveDialog` receives an updated `current` resource;
3. invoke edit and cancel/discard callbacks through a minimal mocked toolbar or
   captured props and assert the snapshot, datasource-save, restore, and
   `onDiscard` semantics from Step 3.

Use `act` for store updates and exact call-count deltas rather than timing or
sleep assertions.

**Verify**:
`npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand DashboardApp.test.tsx`
→ exit 0; root render count stays fixed while the isolated leave snapshot
updates.

### Step 5: Run dashboard package checks

Run both focused suites together, the existing panel-group regression, then
typecheck, lint, and the complete dashboards suite. Fix only in-scope fallout.

**Verify**:
`npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand useDashboard.test.tsx DashboardApp.test.tsx panelGroups.test.tsx`
→ exit 0; then
`npm --prefix shared run type-check -- --filter=@perses-dev/dashboards`
→ exit 0 after Turbo's upstream builds; then
`npm --prefix shared run lint --workspace=@perses-dev/dashboards`
→ exit 0; then
`npm --prefix shared run build -- --filter=@perses-dev/dashboards`
→ exit 0; then
`npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand`
→ exit 0 and all suites pass.

## Test plan

- `useDashboard.test.tsx`:
  - serialization parity for Dashboard and EphemeralDashboard;
  - action-hook render count remains stable across store updates;
  - `getDashboard` reads fresh state;
  - `setDashboard` updates dashboard and variable stores;
  - returned callback identities are stable.
- `DashboardApp.test.tsx`:
  - root/grid child does not rerender for full-resource store updates;
  - isolated leave dialog does receive current updates;
  - edit/cancel/discard snapshots and callbacks retain behavior.
- Use `createDashboardProviderSpy` from
  `dashboards/src/test/dashboard-provider.tsx:28-49` and provider setup from
  `views/ViewDashboard/tests/panelGroups.test.tsx:21-39`.
- Run the existing `panelGroups.test.tsx` unchanged as an integration
  regression.
- Verification: the three-suite command in Step 5 and the full package suite
  both exit 0.

## Done criteria

Machine-checkable; ALL must hold:

- [ ] `rg -n "const \{ dashboard, setDashboard \} = useDashboard\(\)" shared/dashboards/src/views/ViewDashboard/DashboardApp.tsx` returns no matches.
- [ ] `rg -n "useDashboardResourceActions" shared/dashboards/src/context/useDashboard.tsx shared/dashboards/src/views/ViewDashboard/DashboardApp.tsx` returns an exported definition and a root call site.
- [ ] Existing public `useDashboard()` remains exported and uses the shared
  serializer.
- [ ] The action-only hook render-count test stays at its initial count after a
  dashboard store mutation while `getDashboard()` returns the mutation.
- [ ] The DashboardApp test proves the grid child does not rerender and the
  isolated LeaveDialog does update.
- [ ] Edit, cancel, discard, ephemeral serialization, and variable-definition
  setter tests all pass.
- [ ] Focused tests, existing panel-group regression, typecheck, lint, and full
  dashboard tests exit 0.
- [ ] The filtered dashboards build exits 0.
- [ ] `git -C shared diff --name-only f8cd4b7..HEAD` lists exactly the four in-scope paths, and `git -C shared status --short` is empty after the logical commit.
- [ ] `plans/README.md` status row is updated, unless the dispatcher said it maintains the index.

## STOP conditions

Stop and report back without improvising if:

- Reading either dashboard or variable state imperatively requires a new public
  store API or a provider change outside Scope.
- `useDashboard()` has external semantics beyond returning a reactive resource
  and combined setter, or extracting the serializer changes the emitted
  Dashboard/EphemeralDashboard shape.
- Tests show `onDiscard` intentionally receives a different temporal snapshot
  than the one captured when discard confirmation opens.
- Isolating `LeaveDialog` requires changing its props or leave-confirmation
  behavior.
- A root render-count test remains nondeterministic after using `act`, stable
  mocks, and no StrictMode, or a verification fails twice after a reasonable
  in-scope attempt.
- Any fix requires touching DashboardProvider, variable provider, dialogs,
  toolbar, or store slices.

## Maintenance notes

- `getDashboard()` is an event-time snapshot API. Do not call it during render
  as a substitute for reactive `useDashboard()`.
- `useDashboard()` remains the compatibility hook for components that render
  the complete resource; broad subscription is intentional there.
- The leave-dialog child is deliberately the only broad subscriber under
  `DashboardApp`; reviewers should prevent that hook from drifting back to the
  root.
- JSON serialization for dirty checking is preserved, not endorsed. Replacing
  it with revision tracking is a separate change with different product risk.
