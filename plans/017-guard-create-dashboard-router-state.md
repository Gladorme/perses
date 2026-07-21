# Plan 017: Guard create-dashboard views against missing router state

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite workspace root)**:
> `git -C perses diff --stat 06886ac1..HEAD -- ui/app/src/views/projects/dashboards/CreateDashboardView.tsx ui/app/src/views/projects/dashboards/CreateEphemeralDashboardView.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: perses commit `06886ac1`, 2026-07-21

## Why this matters

The create-dashboard routes read `location.state` (React Router navigation
state) and immediately dereference a property on it. Navigation state only
exists when the user arrives through the in-app "create dashboard" dialog. On
a hard reload, a bookmarked URL, or any direct navigation to the route,
`location.state` is `null`, so `state.name` throws an unhandled `TypeError`
before the code's own intended `throw new Error(...)` guard can run. The view
crashes into the nearest error boundary with a confusing message instead of a
controlled redirect.

## Current state

- `perses/ui/app/src/views/projects/dashboards/CreateDashboardView.tsx` —
  create view for regular dashboards; unguarded dereference at lines 36–41.
- `perses/ui/app/src/views/projects/dashboards/CreateEphemeralDashboardView.tsx`
  — same pattern for ephemeral dashboards at lines 36–40; also reads
  `state.ttl` and `state.spec` later (lines 53–54).

`CreateDashboardView.tsx:33-41`:

```ts
function CreateDashboardView(): ReactElement | null {
  const { projectName } = useParams();
  const location = useLocation();
  const state: CreateDashboardState = location.state;
  const dashboardName = state.name;

  if (!projectName || !dashboardName) {
    throw new Error('Unable to get the dashboard or project name');
  }
```

`CreateEphemeralDashboardView.tsx:33-40`:

```ts
function CreateEphemeralDashboardView(): ReactElement | null {
  const { projectName } = useParams();
  const location = useLocation();
  const state: CreateEphemeralDashboardState = location.state;

  if (!projectName || !state.name) {
    throw new Error('Unable to get the ephemeralDashboard or project name');
  }
```

`location.state` is typed `any` by React Router, which is why the unsafe cast
compiles. Both views already import `useNavigate` and both have a discard
handler navigating to `` `/projects/${projectName}` `` — reuse that route as
the redirect target for missing state.

Repo conventions: colocated Jest + React Testing Library tests
(`*.test.tsx` next to the source); see
`perses/ui/app/src/views/projects/ProfileView.test.tsx` for a view-level test
exemplar (router + providers wrapping).

## Commands you will need

Use Node `v22.14.0` (`perses/ui/.nvmrc`) and npm `10.9.2`
(`packageManager` in `perses/ui/package.json`); if those pinned versions
cannot be activated, STOP before installing or testing. On Windows
PowerShell, use `npm.cmd` when `npm.ps1` is policy-blocked.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix perses/ui ci` | exit 0; `perses/ui/package-lock.json` unchanged |
| Focused test | `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand CreateDashboardView.test.tsx` | exit 0 |
| Typecheck | `npm --prefix perses/ui run type-check -- --filter=@perses-dev/app` | exit 0 after Turbo runs upstream builds |
| Lint | `npm --prefix perses/ui run lint --workspace=@perses-dev/app` | exit 0 |

## Scope

**In scope** (the only files you should modify):

- `perses/ui/app/src/views/projects/dashboards/CreateDashboardView.tsx`
- `perses/ui/app/src/views/projects/dashboards/CreateEphemeralDashboardView.tsx`
- `perses/ui/app/src/views/projects/dashboards/CreateDashboardView.test.tsx` (create)

`plans/README.md` is an administrative status-only exception after completion.

**Out of scope** (do NOT touch):

- `DashboardView.tsx`, `EphemeralDashboardView.tsx`, `HelperDashboardView.tsx`
  — plan 025 consolidates these flows; do not pre-empt it.
- The dialogs that *send* the navigation state (`CreateDashboardDialog` etc.).
- Route definitions / the app router.

## Git workflow

- Work in the nested `perses` repository on branch
  `advisor/017-guard-create-dashboard-router-state`.
- One logical commit after verification, message style:
  `[BUGFIX] ui: guard create-dashboard views against missing router state`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Add a failing test for direct navigation

Create `CreateDashboardView.test.tsx`. Render `CreateDashboardView` inside a
`MemoryRouter` with `initialEntries` pointing at the create route **without
providing router state** (i.e. plain string entry, no `state`), the route
param `projectName` set (use a `Routes`/`Route` wrapper so `useParams`
resolves), and the app's `SnackbarProvider`/`QueryClientProvider` if the
component tree requires them (model the wrapper after `ProfileView.test.tsx`).
Assert the view redirects to `/projects/<projectName>` (e.g. render a probe
route at that path and assert its content appears) and does not throw.

**Verify**: `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand CreateDashboardView.test.tsx`
→ the new test FAILS with a `TypeError` (cannot read `name` of `null`),
confirming it exercises the bug. Do not commit this state.

### Step 2: Guard both views

In both files, treat `location.state` as possibly absent and redirect instead
of crashing. Target shape (adapt names per file):

```ts
const location = useLocation();
const state = location.state as CreateDashboardState | null;
const dashboardName = state?.name;

if (!projectName) {
  throw new Error('Unable to get the project name');
}

if (!dashboardName) {
  return <Navigate to={`/projects/${projectName}`} replace />;
}
```

Import `Navigate` from `react-router-dom`. In
`CreateEphemeralDashboardView.tsx` also replace later bare `state.spec` /
`state.ttl` reads with reads from the already-narrowed local variables (after
the guard, `state` is non-null — keep TypeScript narrowing intact by reading
via a `const` captured after the guard, not by re-casting).

**Verify**: the Step 1 test now passes; run the same focused test command →
exit 0.

### Step 3: Package checks

**Verify**:
`npm --prefix perses/ui run type-check -- --filter=@perses-dev/app` → exit 0;
`npm --prefix perses/ui run lint --workspace=@perses-dev/app` → exit 0.

## Test plan

- `CreateDashboardView.test.tsx`:
  1. direct navigation without state → redirects to project page, no crash;
  2. navigation with `state: { name: 'my dash' }` → renders the dashboard
     creation view (assert something stable, e.g. the dashboard shell or
     document title — pick whatever minimal assertion the tree allows; heavy
     dashboard internals may be mocked following existing app test patterns).
- Pattern: `perses/ui/app/src/views/projects/ProfileView.test.tsx`.

## Done criteria

- [ ] `rg -n "location.state as .*\| null" perses/ui/app/src/views/projects/dashboards/CreateDashboardView.tsx perses/ui/app/src/views/projects/dashboards/CreateEphemeralDashboardView.tsx` → one match per file (or equivalent explicit null-handling).
- [ ] `rg -n "const dashboardName = state\.name|!state\.name" perses/ui/app/src/views/projects/dashboards/` → no unguarded dereference remains.
- [ ] Focused test passes; typecheck and lint exit 0.
- [ ] `git -C perses diff --name-only 06886ac1..HEAD` lists only the three in-scope paths.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- The views no longer read `location.state` (drift).
- Rendering the view in the test requires mocking more than plugin-registry,
  query-client, snackbar, and config providers — report instead of building a
  large bespoke harness.
- The redirect appears to require changes to route definitions.
- A verification command fails twice after a reasonable in-scope fix attempt.

## Maintenance notes

- Plan 025 (flow consolidation) will move this guard into the shared hook —
  keep the guard logic small and colocated so it migrates cleanly.
- Reviewers: check the ephemeral view's `state.ttl` usage is also null-safe.
