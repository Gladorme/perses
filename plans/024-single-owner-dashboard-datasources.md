# Plan 024: Make the dashboard store the single owner of dashboard datasources

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite workspace root)**:
> `git -C shared diff --stat f8cd4b7..HEAD -- dashboards/src/context/DatasourceStoreProvider.tsx dashboards/src/components/Datasources/EditDatasourcesButton.tsx dashboards/src/components/EditJsonDialog/EditJsonDialog.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none (verify no conflict with plan 008 if it landed —
  different files, same package)
- **Category**: tech-debt
- **Planned at**: shared commit `f8cd4b7`, 2026-07-21

## Why this matters

The set of datasources embedded in a dashboard currently lives in THREE
places that must be synchronized by hand:

1. the dashboard Zustand store (`DashboardStoreState.datasources`, updated by
   `setDashboard`);
2. `DatasourceStoreProvider`'s private `useState` copy of the whole
   `dashboardResource` (updated only by `setLocalDatasources`, never resynced
   when the prop changes);
3. the provider's `savedDatasources` state.

Every editing surface must remember to write several of them:
`EditDatasourcesButton.handleChangeDatasources` calls `setDashboard` AND
`setLocalDatasources` AND `setSavedDatasources`; `EditJsonDialog.handleApply`
calls `setDashboard` AND `setLocalDatasources`. Any current or future writer
that forgets one call leaves panels resolving stale datasources — e.g. the
discard-changes flow restores the dashboard store but nothing restores the
`DatasourceStoreProvider` copy. This plan removes copy #2: the provider reads
dashboard datasources from a prop/getter fed by the dashboard store, so a
`setDashboard` is sufficient and `setLocalDatasources` disappears.

## Current state

- `shared/dashboards/src/context/DatasourceStoreProvider.tsx`
  - lines 47–53: `const [dashboardResource, setDashboardResource] =
    useState(props.dashboardResource);` and
    `const [savedDatasources, setSavedDatasources] =
    useState(props.savedDatasources ?? {});` — one-shot prop capture.
  - `findDatasource` (lines 57–100, `useEvent`) resolves selectors against
    `dashboardResource.spec.datasources` first, then project, then global.
  - `getLocalDatasources` (176–178) returns
    `dashboardResource?.spec.datasources ?? {}`.
  - `setLocalDatasources` (184–207) rebuilds the whole `dashboardResource`
    object just to swap `spec.datasources`.
  - `listDatasourceSelectItems` (127–174) iterates
    `dashboardResource?.spec.datasources` and marks entries `saved` when the
    name exists in `savedDatasources` (line 150).
  - context value memoized at 209–229 exposing `getDatasource`,
    `getDatasourceClient`, `getLocalDatasources`, `setLocalDatasources`,
    `setSavedDatasources`, `getSavedDatasources`, `listDatasourceSelectItems`.
- The context type `DatasourceStore` is declared in
  `shared/plugin-system/src/runtime/datasources.ts:35-45` (has
  `getLocalDatasources`, `setLocalDatasources`, `getSavedDatasources`).
- Writers:
  - `shared/dashboards/src/components/Datasources/EditDatasourcesButton.tsx:39-82`
    — filters "saved-usable" datasources, then `setDashboard(...)`,
    `setSavedDatasources(newSavedDatasources)`, `setLocalDatasources(datasources)`.
  - `shared/dashboards/src/components/EditJsonDialog/EditJsonDialog.tsx:47-54`
    — `setDashboard(draftDashboard)` then
    `setLocalDatasources(draftDashboard.spec.datasources ?? {})`.
- The dashboard store already holds `datasources`
  (`DashboardProvider.tsx:64,156`) and `setDashboard` updates it
  (`DashboardProvider.tsx:176`).
- Mounting: find where `DatasourceStoreProvider` is mounted relative to
  `DashboardProvider` before starting — grep `DatasourceStoreProvider` under
  `shared/dashboards/src/views/` and `perses/ui/app/src`. In the shared
  `ViewDashboard` it wraps ABOVE the `DashboardProvider`, which is why it
  cannot simply read the dashboard store via context — this constrains the
  design below.

## Target design

Because the provider sits above `DashboardProvider`, it cannot consume the
store context. Invert the dependency with a **getter prop**:

1. Extend `DatasourceStoreProviderProps` with optional
   `getLocalDatasources?: () => Record<string, DatasourceSpec>` — a live
   accessor. Keep the existing `dashboardResource` prop for initial/project
   metadata (project name, dashboard name for proxy URLs), but stop copying
   it into `useState`: read `props.dashboardResource` directly (it is only
   needed for metadata and the fallback datasource map).
2. Inside the provider, resolve dashboard-level datasources as
   `const localDatasources = getLocalDatasourcesProp?.() ??
   props.dashboardResource?.spec.datasources ?? {}` inside `findDatasource`
   and `listDatasourceSelectItems` (both are `useEvent`, so reading fresh
   values per call is safe and requires no dependency plumbing).
3. Delete the provider's `dashboardResource`/`setLocalDatasources` state.
   Keep `savedDatasources` state (it is genuinely provider-owned) but ALSO
   sync it is not needed — it's set only by the edit flow.
4. Where `ViewDashboard` (in `shared/dashboards/src/views/ViewDashboard/`)
   composes providers, pass a getter that reads the dashboard store:
   the `DashboardProvider` store is created below, so instead pass a getter
   backed by a mutable ref that `DashboardApp`/inner component registers, OR
   move `DatasourceStoreProvider` below `DashboardProvider` if provider order
   permits (check what `DatasourceStoreProvider` consumes — it needs
   `usePluginRegistry` only, and `DashboardProvider` does not consume the
   datasource context at creation time; if reordering is possible it is the
   simpler and preferred option, then the getter can be
   `useDashboardStore`-based). Investigate first; choose reorder if tests
   stay green, ref-registration otherwise.
5. Update the two writers: remove their `setLocalDatasources` calls
   (`setDashboard` is now sufficient). Remove `setLocalDatasources` from the
   `DatasourceStore` type in `shared/plugin-system/src/runtime/datasources.ts`
   and from the provider context value. Keep `getLocalDatasources` in the
   context (both writers read it).

## Commands you will need

Node `v22.14.0` / npm `10.9.2` pinned; STOP if not activatable. Windows:
`npm.cmd`.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix shared ci` | exit 0; lockfile unchanged |
| Provider tests | `npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand DatasourceStoreProvider.test.tsx` | exit 0 |
| Typecheck | `npm --prefix shared run type-check` | exit 0 (run workspace-wide: the type change crosses packages) |
| Lint | `npm --prefix shared run lint` | exit 0 |
| Full tests | `npm --prefix shared run test -- --runInBand` | exit 0 |
| App typecheck | `npm --prefix perses/ui run type-check -- --filter=@perses-dev/app` | exit 0 (app consumes the provider) |

## Scope

**In scope**:

- `shared/dashboards/src/context/DatasourceStoreProvider.tsx` (+ its test)
- `shared/plugin-system/src/runtime/datasources.ts` (type change only)
- `shared/dashboards/src/components/Datasources/EditDatasourcesButton.tsx`
- `shared/dashboards/src/components/EditJsonDialog/EditJsonDialog.tsx`
- `shared/dashboards/src/views/ViewDashboard/` provider composition (only as
  needed for step 4)
- Any OTHER `setLocalDatasources` caller found by
  `rg -n "setLocalDatasources" shared perses plugins` — update mechanically
  (removal), listing them in your report.

**Out of scope** (do NOT touch):

- `savedDatasources` semantics and the direct/proxy filtering logic in
  `EditDatasourcesButton` (lines 41–60) — behavior must be preserved.
- Datasource API clients, `datasourceApi` implementations, proxy URL building.
- The Perses app's own `DatasourceStoreProvider` usages beyond compiling
  (report if the app passes props that conflict).

## Git workflow

- Nested `shared` repository, branch
  `advisor/024-single-owner-dashboard-datasources`.
- Commit per logical unit (type change + provider, then writers), e.g.
  `[ENHANCEMENT] dashboards: make dashboard store the single owner of datasources`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Map the mounting order and all callers

`rg -n "DatasourceStoreProvider" shared perses plugins --type ts --type tsx`
and `rg -n "setLocalDatasources|getLocalDatasources" shared perses plugins`.
Record: where the provider mounts relative to `DashboardProvider` in each
tree, and every context consumer. Decide reorder vs ref-getter per Target
design item 4.

**Verify**: written list in your working notes; existing
`DatasourceStoreProvider.test.tsx` passes as baseline.

### Step 2: Characterization test for the stale-copy bug

Extend `DatasourceStoreProvider.test.tsx`
(`shared/dashboards/src/context/DatasourceStoreProvider.test.tsx` exists —
follow its mocking style for `datasourceApi`): assert that after the
dashboard datasources change through the NEW single-writer path
(`setDashboard` on the dashboard store, or the getter returning new data),
`getDatasource` resolves the updated spec. Against current code (getter
absent), reproduce the bug by rerendering the provider with a changed
`dashboardResource` prop and asserting resolution still returns the OLD spec
— this pins the defect.

**Verify**: the bug-pinning assertion fails-as-expected against current
behavior semantics (old spec returned), then will be inverted after the fix.

### Step 3: Implement the provider change

Target design items 1–3. Keep the context value memoized; `useEvent`-based
functions keep stable identities.

**Verify**: provider tests pass with the new getter path.

### Step 4: Rewire composition and writers

Target design items 4–5. Remove `setLocalDatasources` everywhere; delete it
from the `DatasourceStore` type.

**Verify**: `rg -n "setLocalDatasources" shared perses plugins` → no matches;
workspace typecheck exits 0.

### Step 5: Full verification

**Verify**: full shared test suite, lint, and the app typecheck all exit 0.

## Test plan

- Provider test: datasource resolution follows live dashboard datasources
  (updated via the getter) without remount.
- Provider test: `savedDatasources` marking in `listDatasourceSelectItems`
  unchanged (existing tests should cover; extend if not).
- Writers: existing `EditDatasourcesButton`/`EditJsonDialog` tests (if any)
  still pass with the `setLocalDatasources` calls removed.

## Done criteria

- [ ] `rg -n "setLocalDatasources" shared perses plugins` → no matches.
- [ ] `rg -n "useState\(props.dashboardResource\)" shared/dashboards/src/context/DatasourceStoreProvider.tsx` → no matches.
- [ ] Provider tests, full shared suite, lint, workspace typecheck, and app typecheck exit 0.
- [ ] `git -C shared diff --name-only f8cd4b7..HEAD` lists only in-scope paths.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- The provider CANNOT be reordered below `DashboardProvider` AND the
  ref-getter wiring requires modifying `DashboardProvider`'s public API —
  report with the dependency chain you found.
- A consumer outside `shared` (plugins repo, app) calls
  `setLocalDatasources` for a flow with no `setDashboard` equivalent —
  report it; that flow needs its own design decision.
- `DatasourceStoreProvider` is used in contexts with NO dashboard store at
  all (e.g. explore view, project datasource pages) in a way that breaks the
  getter assumption — the `?? props.dashboardResource?.spec.datasources ?? {}`
  fallback should cover it, but report if tests show otherwise.
- A verification command fails twice after a reasonable in-scope fix attempt.

## Maintenance notes

- After this lands, "dashboard datasources" has exactly one runtime owner
  (the dashboard store) and one edit path (`setDashboard`). Reviewers should
  reject any future PR reintroducing a second copy.
- `savedDatasources` remains provider-owned; if it also grows sync bugs,
  consider moving it into the dashboard store as a follow-up.
- The `DatasourceStore` type change is a breaking API change for external
  consumers of `@perses-dev/plugin-system` — flag it in the changelog.
