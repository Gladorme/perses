# Plan 036: Move dashboard not-found redirect out of the render phase

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite workspace root)**:
> `git -C perses diff --stat 06886ac1..HEAD -- ui/app/src/views/projects/dashboards/DashboardView.tsx ui/app/src/views/projects/dashboards/EphemeralDashboardView.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. Plan 025 (flow consolidation)
> touches the same files — this plan must land BEFORE 025; if 025 already
> landed, STOP and report (the fix then belongs in the shared hook).

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (must precede plan 025)
- **Category**: bug
- **Planned at**: perses commit `06886ac1`, 2026-07-21

## Why this matters

Both dashboard read views fire side effects **in the render body** when the
resource query errors: they call `exceptionSnackbar(...)` and `navigate(...)`
directly during render. React render must be pure — `navigate` during render
is unsupported in React Router v6 (it warns and can drop the navigation), and
the snackbar re-fires on every re-render while the error is present,
stacking duplicate toasts. React 18 StrictMode double-render doubles both.

## Current state

- `perses/ui/app/src/views/projects/dashboards/DashboardView.tsx:74-77`:

```ts
  if (dashboardNotFoundError !== null) {
    exceptionSnackbar(dashboardNotFoundError);
    navigate(`/projects/${projectName}`);
  }
```

  This sits between the `isLoading` early return (lines 67–73) and the
  `if (!data || ...) return null;` guard (line 78), i.e. in the component's
  render path. `dashboardNotFoundError` is the `error` field of
  `useDashboard(projectName, dashboardName)` (line 36).

- `perses/ui/app/src/views/projects/dashboards/EphemeralDashboardView.tsx:85-88`
  — identical pattern with `ephemeralDashboardNotFoundError` from
  `useEphemeralDashboard` (lines 36–40).

Both files already import `useNavigate`, `useSnackbar`, `useEffect`.

## Commands you will need

Node `v22.14.0` / npm `10.9.2` pinned; STOP if not activatable. Windows:
`npm.cmd`.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix perses/ui ci` | exit 0; lockfile unchanged |
| Focused test | `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand DashboardView` | exit 0 |
| Typecheck | `npm --prefix perses/ui run type-check -- --filter=@perses-dev/app` | exit 0 |
| Lint | `npm --prefix perses/ui run lint --workspace=@perses-dev/app` | exit 0 |

## Scope

**In scope**:

- `perses/ui/app/src/views/projects/dashboards/DashboardView.tsx`
- `perses/ui/app/src/views/projects/dashboards/EphemeralDashboardView.tsx`
- A colocated test file `DashboardView.test.tsx` (create; keep it minimal)

**Out of scope** (do NOT touch):

- `HelperDashboardView.tsx`, the create views (plans 017/025 own those).
- `useDashboard` / `useEphemeralDashboard` model hooks.
- Snackbar wording.

## Git workflow

- Nested `perses` repository, branch `advisor/036-effect-based-notfound-redirect`.
- One commit, e.g. `[BUGFIX] ui: move dashboard not-found redirect into an effect`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Convert to an effect (both files)

Replace the render-phase block with:

```ts
useEffect(() => {
  if (dashboardNotFoundError !== null) {
    exceptionSnackbar(dashboardNotFoundError);
    navigate(`/projects/${projectName}`);
  }
}, [dashboardNotFoundError, exceptionSnackbar, navigate, projectName]);
```

Place it with the other hooks (before any conditional return, to respect the
Rules of Hooks — note the current block sits AFTER the `isLoading` early
return; the effect must move ABOVE it). After removing the render-phase
block, keep the `if (!data || ...) return null;` fallback so the component
renders nothing while the effect performs the redirect.

Apply the same change in `EphemeralDashboardView.tsx` with its error/param
names.

**Verify**: typecheck exits 0 (catches Rules-of-Hooks ordering mistakes via
lint in the next step too).

### Step 2: Regression test

Create `DashboardView.test.tsx`: mock `../../../model/dashboard-client`'s
`useDashboard` to return `{ data: undefined, isLoading: false, error: new Error('not found') }`,
render the view in a `MemoryRouter` at the dashboard route with a probe
route at `/projects/:projectName`, mock `useSnackbar` (spy). Assert:

1. redirect happened (probe route content rendered);
2. `exceptionSnackbar` called exactly once — including after a forced
   rerender of the same tree (this is the assertion that fails against the
   old code).

**Verify**: focused test → exit 0.

### Step 3: Package checks

**Verify**: lint exits 0; focused test and typecheck pass.

## Test plan

The two assertions above in `DashboardView.test.tsx`; model provider/router
wrapping on existing app view tests (e.g.
`perses/ui/app/src/views/projects/ProfileView.test.tsx`). The ephemeral view
is symmetric — testing one view is acceptable; the diff to the other must be
mechanical and identical.

## Done criteria

- [ ] `rg -n "exceptionSnackbar\(" perses/ui/app/src/views/projects/dashboards/DashboardView.tsx perses/ui/app/src/views/projects/dashboards/EphemeralDashboardView.tsx` → matches only inside `useEffect` bodies or mutation callbacks, never in the render path.
- [ ] Focused test passes; typecheck and lint exit 0.
- [ ] `git -C perses diff --name-only 06886ac1..HEAD` lists only in-scope paths.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- Plan 025 already landed and these views no longer contain the pattern —
  report; the fix belongs in the consolidated hook instead.
- The effect-based redirect loops (error persists after navigation because
  the query refires) — unexpected; report with the query behavior you
  observed.
- A verification command fails twice after a reasonable in-scope fix attempt.

## Maintenance notes

- Plan 025 will absorb this effect into `useDashboardSaveFlow`'s sibling
  logic or keep it view-local; either is fine — the invariant to preserve is
  "no snackbar/navigate during render".
- Reviewers: confirm hooks order (effect above the `isLoading` early return).
