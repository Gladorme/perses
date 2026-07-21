# Plan 043: Stop rethrowing from mutate() onError in folder dialogs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite workspace root)**:
> `git -C perses diff --stat 06886ac1..HEAD -- ui/app/src/components/dialogs/CreateFolderDialog.tsx ui/app/src/components/dialogs/AddFolderDialog.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: perses commit `06886ac1`, 2026-07-21

## Why this matters

Both folder dialogs call React Query's **`mutate()`** (fire-and-forget, not
`mutateAsync`) and then `throw err;` inside the `onError` callback. With
`mutate`, nothing awaits that throw — it escapes as an unhandled exception
inside React Query's callback invocation, producing uncaught-error noise
(and, depending on the environment, error-boundary/onerror reports) for a
failure that was already handled by the snackbar one line above.

This differs from the dashboard views' pattern, where `mutateAsync`'s
`onError` rethrow is intentional — there the promise is returned to a caller
that handles it. Here there is no caller.

## Current state

- `perses/ui/app/src/components/dialogs/CreateFolderDialog.tsx:82-93`:

```ts
    createFolderMutation.mutate(newFolder, {
      onSuccess: (createdFolder: FolderResource) => {
        successSnackbar(`Folder ${getResourceExtendedDisplayName(createdFolder)} has been successfully created`);
        onClose();
        reset();
        onSuccess?.(createdFolder.metadata.name);
      },
      onError: (err) => {
        exceptionSnackbar(err);
        throw err;
      },
    });
```

- `perses/ui/app/src/components/dialogs/AddFolderDialog.tsx:87-100` — same
  shape with `updateFolderMutation.mutate` and an "updated" message.

## Commands you will need

Node `v22.14.0` / npm `10.9.2` pinned; STOP if not activatable. Windows:
`npm.cmd`.

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm --prefix perses/ui run type-check -- --filter=@perses-dev/app` | exit 0 |
| Lint | `npm --prefix perses/ui run lint --workspace=@perses-dev/app` | exit 0 |
| Related tests | `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand FolderDialog` | exit 0 (or no matching suites) |

## Scope

**In scope**:

- `perses/ui/app/src/components/dialogs/CreateFolderDialog.tsx`
- `perses/ui/app/src/components/dialogs/AddFolderDialog.tsx`

**Out of scope** (do NOT touch):

- Other dialogs, even if they contain the same pattern with `mutateAsync`
  (there the rethrow is part of the returned-promise contract).
- The mutation hooks and snackbar helpers.

## Git workflow

- Nested `perses` repository, branch `advisor/043-folder-dialog-onerror`.
- One commit, e.g. `[BUGFIX] ui: stop rethrowing from folder dialog mutate onError`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Remove the rethrow in both files

Delete the `throw err;` line in each `onError` (keep `exceptionSnackbar`).

**Verify**: `rg -n "throw err" perses/ui/app/src/components/dialogs/CreateFolderDialog.tsx perses/ui/app/src/components/dialogs/AddFolderDialog.tsx`
→ no matches; typecheck, lint, and the related test filter exit 0.

## Test plan

No new tests required — behavior change is removal of an unhandled throw;
existing dialog tests (if any) confirm the success/error snackbar paths.
Optionally assert in an existing test that a rejected mutation does not
produce an unhandled rejection (jest fails on unhandled rejections by
default when configured; do not add config for this).

## Done criteria

- [ ] The grep above returns no matches.
- [ ] Typecheck and lint exit 0.
- [ ] `git -C perses diff --name-only 06886ac1..HEAD` lists only the two in-scope files.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- A caller is found that relies on the throw (e.g. the dialogs were
  refactored to `mutateAsync` with awaiting callers) — drift; report.

## Maintenance notes

- Rule of thumb for reviewers in this codebase: rethrow in `onError` only
  when the call site uses `mutateAsync` and returns the promise to a
  consumer that handles rejection (see `DashboardView.tsx` for the
  legitimate pattern).
