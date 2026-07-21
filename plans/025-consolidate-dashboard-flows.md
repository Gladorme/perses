# Plan 025: Consolidate the four dashboard view/create flows into one hook

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite workspace root)**:
> `git -C perses diff --stat 06886ac1..HEAD -- ui/app/src/views/projects/dashboards/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: 017 (the router-state guard must exist first; this plan
  relocates it)
- **Category**: tech-debt
- **Planned at**: perses commit `06886ac1`, 2026-07-21

## Why this matters

Four route views re-implement the same state plumbing —
mutation + success snackbar + error snackbar + navigation (+ nav-history
dispatch for the two read views, + leave-confirmation toggle for the two
create views): `DashboardView`, `EphemeralDashboardView`,
`CreateDashboardView`, `CreateEphemeralDashboardView`. The bodies are
near-identical (compare `DashboardView.tsx:46-65` with
`EphemeralDashboardView.tsx:50-76` — only the mutation hook, kind string, and
snackbar wording differ). Every state-handling fix must land four times;
the flows have already drifted (the ephemeral views re-wrap `data` into a new
resource object, the dashboard ones don't). One shared hook makes the next
fix land once.

## Current state

All under `perses/ui/app/src/views/projects/dashboards/`:

- `DashboardView.tsx` (90 lines) — loads via
  `useDashboard(projectName, dashboardName)` from
  `../../../model/dashboard-client`, saves via
  `useUpdateDashboardMutation()`, dispatches nav history
  (lines 40–44), renders `HelperDashboardView` with
  `isEditing={false}`.
- `EphemeralDashboardView.tsx` (101 lines) — same shape with
  `useEphemeralDashboard` / `useUpdateEphemeralDashboardMutation` from
  `../../../model/ephemeral-dashboard-client`, plus a
  kind-narrowing re-wrap of the payload (lines 55–59).
- `CreateDashboardView.tsx` (~120 lines) — builds an initial
  `DashboardResource` from router state (lines 47–65), saves via
  `useCreateDashboardMutation()`, navigates to the created dashboard on
  success, discards to `/projects/${projectName}`, manages
  `isLeavingConfirmDialogEnabled` local state (line 67, toggled at 73/93 in
  the ephemeral twin).
- `CreateEphemeralDashboardView.tsx` (~121 lines) — twin with TTL handling.
- All four render `HelperDashboardView` (same directory) which accepts
  `dashboardResource`, `onSave`, `onDiscard?`, `isReadonly`, `isEditing`,
  `isCreating?`, `isLeavingConfirmDialogEnabled?`.

Shared save-handler shape (from `DashboardView.tsx:46-65`):

```ts
const handleDashboardSave = useCallback(
  (data: DashboardResource) => {
    if (data.kind !== 'Dashboard') {
      throw new Error('Invalid kind');
    }
    return updateDashboardMutation.mutateAsync(data, {
      onSuccess: (updatedDashboard: DashboardResource) => {
        successSnackbar(
          `Dashboard ${getResourceExtendedDisplayName(updatedDashboard)} has been successfully updated`
        );
        return updatedDashboard;
      },
      onError: (err) => {
        exceptionSnackbar(err);
        throw err;
      },
    });
  },
  [exceptionSnackbar, successSnackbar, updateDashboardMutation]
);
```

Conventions: hooks live beside views or in `perses/ui/app/src/model/`;
colocated Jest + RTL tests; snackbars from
`@perses-dev/components` `useSnackbar()`.

## Target design

Add one hook file
`perses/ui/app/src/views/projects/dashboards/useDashboardSaveFlow.ts`
(name yours to match repo vocabulary) exporting:

```ts
interface DashboardFlowConfig<R extends DashboardResource | EphemeralDashboardResource> {
  kind: R['kind'];                       // runtime kind guard
  save: (resource: R) => Promise<R>;     // wraps the mutation
  successMessage: (saved: R) => string;
  onSuccessNavigate?: (saved: R) => string | undefined; // create flows navigate; update flows don't
}

function useDashboardSaveFlow<R>(config): {
  handleSave: (data: DashboardResource) => Promise<R>;
  isLeavingConfirmDialogEnabled: boolean; // managed here for create flows
}
```

The hook owns: the kind check, `mutateAsync` orchestration, success snackbar,
error snackbar + rethrow, optional navigation, and the
leave-confirm-dialog enable/disable ordering (disable before navigate,
re-enable on error) currently duplicated in the create views. The four views
shrink to: data loading (read views), resource construction from router state
(create views, keeping plan 017's guard), nav-history dispatch (read views),
and a `HelperDashboardView` render.

Do NOT try to also absorb data loading or nav history into the hook — the
asymmetry (read vs create) would force conditionals worse than the
duplication.

## Commands you will need

Node `v22.14.0` / npm `10.9.2` pinned; STOP if not activatable. Windows:
`npm.cmd`.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix perses/ui ci` | exit 0; lockfile unchanged |
| Focused tests | `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand dashboards` | exit 0 |
| Typecheck | `npm --prefix perses/ui run type-check -- --filter=@perses-dev/app` | exit 0 |
| Lint | `npm --prefix perses/ui run lint --workspace=@perses-dev/app` | exit 0 |

## Scope

**In scope**:

- `perses/ui/app/src/views/projects/dashboards/DashboardView.tsx`
- `perses/ui/app/src/views/projects/dashboards/EphemeralDashboardView.tsx`
- `perses/ui/app/src/views/projects/dashboards/CreateDashboardView.tsx`
- `perses/ui/app/src/views/projects/dashboards/CreateEphemeralDashboardView.tsx`
- `perses/ui/app/src/views/projects/dashboards/useDashboardSaveFlow.ts` (create)
- `perses/ui/app/src/views/projects/dashboards/useDashboardSaveFlow.test.tsx` (create)
- `CreateDashboardView.test.tsx` (from plan 017 — keep green)

**Out of scope** (do NOT touch):

- `HelperDashboardView.tsx` — its props contract is the fixed interface.
- The mutation hooks in `model/dashboard-client.ts` /
  `model/ephemeral-dashboard-client.ts`.
- Snackbar wording (messages must remain byte-identical — copy them).
- Routing table.

## Git workflow

- Nested `perses` repository, branch
  `advisor/025-consolidate-dashboard-flows`.
- One commit, e.g. `[ENHANCEMENT] ui: consolidate dashboard view/create save flows`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Write the hook + unit tests first

Implement `useDashboardSaveFlow` and test it in isolation with a mocked
`save` function: kind mismatch throws; success fires snackbar with the
config's message and navigates when `onSuccessNavigate` returns a path;
error fires exception snackbar, re-enables the leave dialog, and rethrows.
Mock `useSnackbar` and `useNavigate` following existing app test patterns.

**Verify**: `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand useDashboardSaveFlow`
→ all pass.

### Step 2: Migrate one pair (Dashboard read + create)

Rewire `DashboardView.tsx` and `CreateDashboardView.tsx` onto the hook.
Byte-identical snackbar messages; identical navigation targets
(`/projects/${project}/dashboards/${name}` on create success — copy from the
current code); nav-history dispatch stays in the view.

**Verify**: focused dashboards tests + plan 017's
`CreateDashboardView.test.tsx` pass; typecheck exits 0.

### Step 3: Migrate the ephemeral pair

Same for `EphemeralDashboardView.tsx` and
`CreateEphemeralDashboardView.tsx`, preserving the kind-narrowing re-wrap
(move it inside the config's `save` wrapper) and TTL/state handling.

**Verify**: focused dashboards tests pass; typecheck and lint exit 0.

### Step 4: Duplication check

**Verify**:
`rg -n "mutateAsync" perses/ui/app/src/views/projects/dashboards/*.tsx` →
matches only inside the four views' small `save` wrappers (or zero if wrapped
in the hook config inline); no view contains its own
`onSuccess`/`onError` snackbar block:
`rg -n "successSnackbar\(" perses/ui/app/src/views/projects/dashboards/*View.tsx`
→ no matches.

## Test plan

- Hook unit tests (Step 1): kind guard, success path, error path,
  leave-dialog ordering.
- Existing view tests (incl. plan 017's) keep passing unchanged — they are
  the behavioral regression net.

## Done criteria

- [ ] All four views consume `useDashboardSaveFlow`; no view-level
  `onSuccess/onError` snackbar blocks remain (rg checks in Step 4).
- [ ] Hook tests + focused dashboards tests pass; typecheck and lint exit 0.
- [ ] `git -C perses diff --name-only 06886ac1..HEAD` lists only in-scope paths.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- Plan 017 has not landed (the create views still crash on missing state) —
  execute 017 first or report.
- `HelperDashboardView`'s props make the leave-dialog state impossible to
  own in the hook without changing its contract — report; do not modify
  `HelperDashboardView`.
- Snackbar wording differences between flows turn out to be load-bearing for
  e2e tests — keep the per-flow message functions and report nothing; that's
  the design.
- A verification command fails twice after a reasonable in-scope fix attempt.

## Maintenance notes

- New dashboard-like resources (e.g. future "snapshot" kinds) should add a
  config object, not a new view copy — reviewers should enforce this.
- Deferred: unifying the two `model/*-client.ts` mutation hook families;
  larger API surface, separate decision.
