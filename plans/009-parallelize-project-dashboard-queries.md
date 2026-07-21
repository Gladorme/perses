# Plan 009: Reuse the project query and parallelize dashboard prerequisites

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git -C perses diff --stat 06886ac1..HEAD -- ui/app/src/model/project-client.ts ui/app/src/model/project-client.test.tsx ui/app/src/guard/GuardedProjectRoute.tsx ui/app/src/guard/GuardedProjectRoute.test.tsx ui/app/src/views/projects/ProjectView.tsx ui/app/src/views/projects/dashboards/DashboardView.tsx ui/app/src/views/projects/dashboards/DashboardView.test.tsx ui/app/src/views/projects/dashboards/HelperDashboardView.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `06886ac1`, 2026-07-21

## Why this matters

A cold dashboard route currently has serial network stages. The route guard
calls `getProject` outside React Query, the mounted view then starts the
dashboard request, and only after that request resolves does
`HelperDashboardView` mount the project, variable, and datasource queries.
This both bypasses cache reuse for project validation and delays five independent
prerequisite queries behind the dashboard response. Reusing the guard's project
query and mounting all dashboard prerequisites together removes the duplicate
request and the inner waterfall without changing the four existing
`HelperDashboardView` call sites.

## Current state

- `ui/app/src/guard/GuardedProjectRoute.tsx` — validates a project before
  rendering nested project routes.
- `ui/app/src/model/project-client.ts` — defines `getProject` and `useProject`.
- `ui/app/src/views/projects/ProjectView.tsx` — observes the same project again
  after the guard resolves.
- `ui/app/src/views/projects/dashboards/DashboardView.tsx` — fetches an existing
  dashboard, then mounts its helper.
- `ui/app/src/views/projects/dashboards/HelperDashboardView.tsx` — fetches the
  project and dashboard prerequisites and renders `ViewDashboard`.

The guard stores an uncached raw request in local state
(`GuardedProjectRoute.tsx:14-45`):

```tsx
import { Await, Outlet, useNavigate, useParams } from 'react-router-dom';
import { ReactElement, Suspense, useEffect, useState } from 'react';
// ...
import { getProject } from '../model/project-client';

const [projectPromise, setProjectPromise] = useState<Promise<ProjectResource>>();

useEffect(() => {
  if (projectName === undefined || projectName === '') {
    return;
  }
  setProjectPromise(
    getProject(projectName).catch((err) => {
      exceptionSnackbar(err);
      navigate('/');
      throw err;
    })
  );
}, [exceptionSnackbar, navigate, projectName]);

return (
  <Suspense fallback={<LinearProgress />}>
    <Await resolve={projectPromise}>
      <Outlet />
    </Await>
  </Suspense>
);
```

`useProject` has the matching cache key, but accepts no consumer options
(`project-client.ts:94-101`):

```tsx
export function useProject(name: string): UseQueryResult<ProjectResource, StatusError> {
  return useQuery<ProjectResource, StatusError>({
    queryKey: [resource, name],
    queryFn: () => {
      return getProject(name);
    },
  });
}
```

The dashboard request gates the helper (`DashboardView.tsx:34-38,67-86`):

```tsx
const { data, isLoading, error: dashboardNotFoundError } = useDashboard(projectName, dashboardName);

if (isLoading) {
  return (
    <Stack width="100%" sx={{ alignItems: 'center', justifyContent: 'center' }}>
      <CircularProgress />
    </Stack>
  );
}

return (
  <HelperDashboardView
    dashboardResource={data}
    onSave={handleDashboardSave}
    isReadonly={isReadonly}
    isEditing={false}
  />
);
```

Only after that helper mounts are the independent prerequisites started
(`HelperDashboardView.tsx:60-85`):

```tsx
const datasourceApi = useDatasourceApi();
const pluginLoader = useRemotePluginLoader();

const { data: project, isLoading: isLoadingProject } = useProject(dashboardResource.metadata.project);
const { data: globalVars, isLoading: isLoadingGlobalVars } = useGlobalVariableList();
const { data: projectVars, isLoading: isLoadingProjectVars } = useVariableList(dashboardResource.metadata.project);

if (isLoadingProject || isLoadingProjectVars || isLoadingGlobalVars) {
  return <CircularProgress />;
}
```

`useDatasourceApi()` independently mounts both the global-datasource list and
the all-project datasource list (`model/datasource-api.ts:40-43`), so together
the helper starts five query observers after the dashboard resolves.

Repository conventions to preserve:

- `ui/ui-guidelines.md` designates React Query for fetched state and recommends
  keeping feature-specific hooks beside the view that needs them.
- Tests are colocated Jest/React Testing Library files and should exercise user
  flows or observable query behavior. Use
  `ui/app/src/views/profile/ProfileView.test.tsx` for application-hook mocking
  and `ui/app/src/model/datasource-api.test.ts` for model test organization.
- Keep named exports for new helper types/functions. Preserve the default exports
  of the existing route/view modules because `Router.tsx` lazy-loads them.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Node toolchain | `node --version` | exactly `v22.14.0`, matching `perses/ui/.nvmrc` |
| npm toolchain | `npm --version` | exactly `10.9.2`, matching `perses/ui/package.json` |
| Install | `npm --prefix perses/ui ci` | exit 0; `perses/ui/package-lock.json` is unchanged |
| Clean baseline | `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand src/model/querykey-builder.spec.ts` | exit 0 before any source edit; Jest config resolves correctly |
| Target tests | `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand src/model/project-client.test.tsx src/guard/GuardedProjectRoute.test.tsx src/views/projects/dashboards/DashboardView.test.tsx` | exit 0; all new tests pass |
| Typecheck | `npm --prefix perses/ui run type-check -- --filter=@perses-dev/app` | exit 0 after Turbo runs upstream builds, with no TypeScript errors |
| Lint | `npm --prefix perses/ui run lint --workspace=@perses-dev/app` | exit 0, no ESLint errors |
| App tests | `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand` | exit 0; all app tests pass |
| Production build | `npm --prefix perses/ui run build --workspace=@perses-dev/app` | exit 0; production bundle compiles |

## Suggested executor toolkit

- Use `vercel-react-best-practices` if available for its guidance on parallel
  data fetching and avoiding request waterfalls.
- Use TanStack Query v4 APIs already installed in `ui/app`; do not add a routing,
  cache, or data-fetching dependency.

## Scope

**In scope** (the only files you should modify):

- `ui/app/src/model/project-client.ts`
- `ui/app/src/model/project-client.test.tsx` (create)
- `ui/app/src/guard/GuardedProjectRoute.tsx`
- `ui/app/src/guard/GuardedProjectRoute.test.tsx` (create)
- `ui/app/src/views/projects/ProjectView.tsx`
- `ui/app/src/views/projects/dashboards/DashboardView.tsx`
- `ui/app/src/views/projects/dashboards/DashboardView.test.tsx` (create)
- `ui/app/src/views/projects/dashboards/HelperDashboardView.tsx`

**Out of scope** (do NOT touch):

- Route definitions or provider construction in `ui/app/src/Router.tsx`.
- The datasource, variable, or dashboard HTTP clients and their query keys.
- `CreateDashboardView`, `CreateEphemeralDashboardView`, and
  `EphemeralDashboardView`; their existing `HelperDashboardView` API must remain
  source-compatible.
- Backend endpoints, dashboard rendering behavior, plugin loading, or global
  React Query defaults.
- Suspense conversion for other routes.

## Git workflow

- Branch: `advisor/009-parallelize-project-dashboard-queries`
- Prefer two logical commits if useful: one for cached route validation, one for
  concurrent dashboard prerequisites. Match the observed message style, e.g.
  `[ENHANCEMENT] Parallelize dashboard prerequisite queries`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 0: Activate the pinned UI toolchain and prove the baseline

From the composite root, verify Node `v22.14.0` and npm `10.9.2`; activate
`perses/ui/.nvmrc` with the operator's installed version manager if needed. On
Windows PowerShell, use `npm.cmd` when `npm.ps1` is policy-blocked. Run the
install and clean-baseline commands from the table before editing. Do not use
Node 24/npm 11: in the audited environment that mismatch failed while loading
`jest.config.ts` before any test could run.

**Verify**: both version commands match exactly, `npm --prefix perses/ui ci`
exits 0, `git -C perses diff -- ui/package-lock.json` prints nothing, and the
clean-baseline Jest command exits 0. Otherwise STOP and report the environment
failure without changing source.

### Step 1: Let downstream project observers opt out of a mount refetch

In `model/project-client.ts`, add a project-query options type equivalent to the
existing `ProjectListOptions`, but for `ProjectResource`. Update `useProject` to
accept optional query options and merge them after the fixed `queryKey` and
`queryFn`.

Do not add a `staleTime` or change global query defaults. The query key must
remain exactly `[resource, name]`, and mutation behavior must remain unchanged.
The guard remains the observer responsible for validating/refetching a route;
its immediate descendants will explicitly use `refetchOnMount: false` to consume
the result it just populated.

Create `model/project-client.test.tsx` with a fresh `QueryClient` per test. Mock
`fetchJson` from `@perses-dev/client`, render a `useProject('project-a')` hook,
wait for success, unmount it, then mount
`useProject('project-a', { refetchOnMount: false })`. Assert the second observer
receives cached data and the mocked request was called once. Also cover
`enabled: false` to prove the new options are honored.

Add a real-query route-switch regression in the same file. Construct the
`QueryClient` with global `defaultOptions.queries.keepPreviousData: true`, use
a deferred `fetchJson` result, and render a small hook harness that calls
`useProject(name, { keepPreviousData: false })`. Resolve project A, rerender
with project B, leave B pending, and assert the observer has no project-A data
and is not in a successful/outlet-admitting state. Resolve B and assert only B
then appears. This proves the explicit option overrides the live router's
global default rather than merely satisfying a mocked guard test.

**Verify**: `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand src/model/project-client.test.tsx` → exit 0; cache reuse and `enabled: false` tests pass.

### Step 2: Move the project guard onto the shared React Query path

Rewrite `GuardedProjectRoute.tsx` to use `useProject` instead of `getProject`,
`useState<Promise<...>>`, `Await`, and `Suspense`:

1. Call
   `useProject(projectName ?? '', { enabled: Boolean(projectName), keepPreviousData: false })`
   unconditionally, in accordance with the Rules of Hooks. The explicit
   `keepPreviousData: false` is required because `Router.tsx` enables
   `keepPreviousData` globally; a guard must not admit a newly selected project
   using the prior project's cached result while the new request is pending.
2. If there is no `projectName`, return `<Outlet />` so the existing index child
   can perform its redirect.
3. While the enabled query is loading, return `<LinearProgress />`.
4. Handle query errors in an effect: show `exceptionSnackbar(error)` and navigate
   to `/`. While an error exists, render no child outlet.
5. On success, render `<Outlet />`.

Do not call a request function directly and do not create a second `QueryClient`.
Downstream consumers will reuse this exact query key in the next steps.

Create `guard/GuardedProjectRoute.test.tsx`. Mock `useProject` and cover: no
project param passes through to the child, a pending query shows progress, a
successful query renders the child, and an error reports through the snackbar
and navigates to `/`. Also change the route from one project param to another and
assert the child is hidden while the second project is pending; this guards the
route UI. For every enabled-param case, assert the mock was called with the
exact second argument `{ enabled: true, keepPreviousData: false }`; after the
route change, assert that exact option object was supplied for project B. The
missing-param case must assert `useProject('', { enabled: false,
keepPreviousData: false })`. Do not treat the mocked pending UI assertion alone
as proof of the option contract; the real QueryClient regression from Step 1
is the semantic gate.

**Verify**: `rg -n "getProject|Await|Suspense|useState<Promise" perses/ui/app/src/guard/GuardedProjectRoute.tsx` → no matches; `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand src/guard/GuardedProjectRoute.test.tsx` → exit 0.

### Step 3: Reuse the guard result in the project overview

In `views/projects/ProjectView.tsx`, change the existing project observer to
`useProject(projectName, { refetchOnMount: false })`. This route is mounted below
`GuardedProjectRoute`, which has just fetched or validated the same exact key.
Keep the existing loading UI as a defensive fallback, and do not move project
data into a new context or prop chain.

**Verify**: `rg -n "useProject\(projectName, \{ refetchOnMount: false \}\)" perses/ui/app/src/views/projects/ProjectView.tsx` → exactly one match; `npm --prefix perses/ui run type-check -- --filter=@perses-dev/app` → exit 0 after upstream builds.

### Step 4: Separate dashboard prerequisites from resolved dashboard rendering

Refactor `HelperDashboardView.tsx` without changing the existing
`GenericDashboardViewProps` or `HelperDashboardView` call signature.

Introduce these named pieces in the same feature file:

1. `DashboardDependencies`, containing the project resource (possibly undefined
   until validated), `DatasourceApi`, the computed external-variable definitions,
   and one `isLoading` boolean.
2. `useDashboardDependencies(projectName: string)`, which calls
   `useDatasourceApi`,
   `useProject(projectName, { refetchOnMount: false })`,
   `useGlobalVariableList`, and `useVariableList(projectName)` together. Build external variable definitions
   from `projectName`, `projectVars`, and `globalVars`; do not require a resolved
   `DashboardResource` to start them.
3. A named resolved/presentational component (use the name
   `ResolvedDashboardView`) that receives `GenericDashboardViewProps` plus the
   prepared dependencies and contains the existing `Box`, error boundaries,
   registry/providers, breadcrumbs, and `ViewDashboard` tree. It must not call
   any of the four data hooks listed above.
4. Keep `HelperDashboardView` as a compatibility wrapper for create/ephemeral
   callers: call `useDashboardDependencies` using
   `dashboardResource.metadata.project`, show the existing centered progress
   state while it loads, then render `ResolvedDashboardView`.

Keep `useRemotePluginLoader`, local preferences, and config feature flags at the
resolved rendering layer unless moving them is required by the Rules of Hooks;
they are not the network waterfall addressed here. Preserve the existing error
when loading completes without a project.

**Verify**: `rg -n "export (interface DashboardDependencies|function useDashboardDependencies|function ResolvedDashboardView|function HelperDashboardView)|use(Project|GlobalVariableList|VariableList|DatasourceApi)" perses/ui/app/src/views/projects/dashboards/HelperDashboardView.tsx` → all four named pieces exist; the data hooks appear only in `useDashboardDependencies`.

### Step 5: Start dashboard and prerequisite queries in the same render

In `DashboardView.tsx`, call `useDashboardDependencies(projectName)` adjacent to
`useDashboard(projectName, dashboardName)`, before any loading return. Treat the
view as loading while either the dashboard or its prepared dependencies is
loading. On success, render `ResolvedDashboardView` directly with the dashboard,
save callback, flags, and dependencies.

Do not keep an additional `HelperDashboardView` under `DashboardView`; that would
mount a duplicate set of observers. Preserve the current not-found navigation,
read-only checks, save mutation, and nav-history effect.

Create `DashboardView.test.tsx`. Mock the dashboard hook and the named helper
exports so the tests can prove:

1. `useDashboardDependencies(projectName)` is called even while `useDashboard`
   reports loading — this is the waterfall regression assertion.
2. The progress state remains until both result groups are ready.
3. The success path renders `ResolvedDashboardView` once with the fetched
   dashboard and prepared dependencies.

Use a `MemoryRouter` route containing both params and mock config, snackbar, and
nav-history hooks following `views/profile/ProfileView.test.tsx` conventions.

**Verify**: `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand src/views/projects/dashboards/DashboardView.test.tsx` → exit 0; all three concurrency/loading assertions pass.

### Step 6: Run all focused and package checks

Run the three new test files together, then typecheck, lint, and the full app test
suite. Finally inspect the worktree for scope.

**Verify**: `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand src/model/project-client.test.tsx src/guard/GuardedProjectRoute.test.tsx src/views/projects/dashboards/DashboardView.test.tsx` → exit 0; `npm --prefix perses/ui run type-check -- --filter=@perses-dev/app`, `npm --prefix perses/ui run lint --workspace=@perses-dev/app`, `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand`, and `npm --prefix perses/ui run build --workspace=@perses-dev/app` → each exits 0.

## Test plan

- `model/project-client.test.tsx`: a remount with `refetchOnMount: false`
  performs one total request; a disabled query performs zero requests; and a
  client whose global default keeps prior data still exposes no project-A data
  while project B is pending when the hook explicitly disables it.
- `guard/GuardedProjectRoute.test.tsx`: missing param, loading, success,
  project-param change, and error/redirect behavior, plus exact `useProject`
  option assertions for both enabled and missing-param calls.
- `views/projects/dashboards/DashboardView.test.tsx`: prerequisites start during
  dashboard loading, combined loading gate, and resolved render props.
- Follow `views/profile/ProfileView.test.tsx` for mocked application contexts and
  `model/datasource-api.test.ts` for focused model assertions.
- Verification: run the combined focused command and then the complete app suite.

## Done criteria

- [ ] The project guard contains no direct `getProject`, `Await`, Suspense, or promise state.
- [ ] The guard test asserts the exact `{ enabled, keepPreviousData: false }` options for each route state, and its route-change test never renders a prior project's child while the new project is pending.
- [ ] A real QueryClient with global `keepPreviousData: true` proves project-A data is unavailable while project B is pending and only B appears after resolution.
- [ ] Two immediate `useProject` observers for the same name, with the descendant mount refetch disabled, are covered by a test that observes one request.
- [ ] `ProjectView` and `useDashboardDependencies` both use `refetchOnMount: false` for the guard-populated project key.
- [ ] `DashboardView` calls `useDashboard` and `useDashboardDependencies` before its first loading return.
- [ ] `ResolvedDashboardView` contains no project, variable-list, global-variable-list, or datasource-list hooks.
- [ ] Existing create and ephemeral callers compile without modification.
- [ ] The pinned-version, clean install, and pre-edit baseline gates in Step 0 all pass.
- [ ] `npm --prefix perses/ui run type-check -- --filter=@perses-dev/app` exits 0.
- [ ] `npm --prefix perses/ui run lint --workspace=@perses-dev/app` exits 0.
- [ ] `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand` exits 0.
- [ ] `npm --prefix perses/ui run build --workspace=@perses-dev/app` exits 0.
- [ ] `git -C perses diff --name-only 06886ac1..HEAD` lists exactly the eight in-scope files, and `git -C perses status --short` is empty after the logical commits.
- [ ] `plans/README.md` status row is updated, unless the dispatcher said it owns the index.

## STOP conditions

Stop and report back (do not improvise) if:

- Node `v22.14.0`/npm `10.9.2` cannot be activated, `npm ci` changes the
  lockfile, or the clean-baseline Jest test fails before any source edit.

- The live guard, dashboard loading gate, or helper hooks no longer match the
  excerpts in "Current state".
- The project overview or dashboard can mount outside `GuardedProjectRoute` with
  a `projectName`; `refetchOnMount: false` relies on the guard owning the route
  validation request.
- Any dashboard prerequisite actually requires the resolved dashboard spec or
  dashboard name rather than only `projectName`.
- Preserving the existing `HelperDashboardView` API for create/ephemeral routes
  requires editing one of those out-of-scope callers.
- The dashboard library cannot tolerate its existing datasource API becoming
  ready after render; that is a separate contract issue and must be reported.
- A focused verification fails twice after one reasonable correction.

## Maintenance notes

- `refetchOnMount: false` is correct only for descendants of the active project
  guard. If routing changes, review these two call sites together with the guard.
- New dashboard prerequisites should be added to `useDashboardDependencies` so
  they start with the dashboard request; do not hide new queries below the
  resolved-dashboard loading gate.
- Reviewers should inspect the initial network timeline: after project guard
  validation, dashboard, project variables, global variables, project/global
  datasources must begin together, and there must be no second project GET.
- Route-loader conversion could remove the remaining guard-before-child stage,
  but it would require broader router/provider work and is intentionally deferred.
