# Plan 046: Fix the discard-changes dialog title association (a11y)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite workspace root)**:
> `git -C shared diff --stat f8cd4b7..HEAD -- components/src/Dialog/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (a11y)
- **Planned at**: shared commit `f8cd4b7`, 2026-07-21

## Why this matters

The discard-changes confirmation dialog declares
`aria-labelledby="discard-dialog"`, but **no element anywhere in the Dialog
module carries that id** (verified by grep). Screen readers announce the
dialog without its accessible name, degrading a destructive-action
confirmation for assistive-technology users.

## Current state

- `shared/components/src/Dialog/DiscardChangesConfirmationDialog.tsx:28-31`:

```tsx
  return (
    <Dialog open={isOpen} aria-labelledby="discard-dialog">
      <Dialog.Header>Discard Changes</Dialog.Header>
      <Dialog.Content>{description}</Dialog.Content>
```

- `rg -n "discard-dialog" shared` → only this occurrence; the shared
  `Dialog`/`Dialog.Header` components (same directory, `Dialog.tsx` /
  `DialogHeader.tsx` or equivalent — read the directory) do not set ids.
- Check how `Dialog.Header` propagates props: if it forwards an `id` to the
  title element, the minimal fix is
  `<Dialog.Header id="discard-dialog">`. If it does not accept `id`, either
  extend it to forward `id` (preferred if trivial prop-spread) or drop the
  `aria-labelledby` and let MUI's default title wiring apply — choose based
  on what `Dialog.Header` renders (read it first).

## Commands you will need

Node `v22.14.0` / npm `10.9.2` pinned; STOP if not activatable. Windows:
`npm.cmd`.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix shared ci` | exit 0; lockfile unchanged |
| Focused test | `npm --prefix shared run test --workspace=@perses-dev/components -- --runInBand Dialog` | exit 0 |
| Typecheck | `npm --prefix shared run type-check -- --filter=@perses-dev/components` | exit 0 |
| Lint | `npm --prefix shared run lint --workspace=@perses-dev/components` | exit 0 |

## Scope

**In scope**:

- `shared/components/src/Dialog/DiscardChangesConfirmationDialog.tsx`
- `shared/components/src/Dialog/` Dialog/Header component files ONLY if
  forwarding `id` is required
- The Dialog test file in the same directory (extend)

**Out of scope** (do NOT touch):

- Other dialogs' aria wiring (audit as follow-up, not here).
- Visual styling.

## Git workflow

- Nested `shared` repository, branch `advisor/046-discard-dialog-aria`.
- One commit, e.g. `[BUGFIX] components: wire discard dialog aria-labelledby to its title`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Wire the id

Read the `Dialog.Header` implementation in
`shared/components/src/Dialog/`. Apply the minimal working option:

- If it spreads extra props onto the title element:
  `<Dialog.Header id="discard-dialog">Discard Changes</Dialog.Header>`.
- Otherwise add `id?: string` pass-through to the header's root/title
  element, then use it as above.

**Verify**: typecheck and lint exit 0.

### Step 2: Assert the association in a test

Extend the existing Dialog test (or create
`DiscardChangesConfirmationDialog.test.tsx` following sibling test files):
render the dialog open and assert
`screen.getByRole('dialog')` has an accessible name of `Discard Changes`
(RTL's `toHaveAccessibleName` — the `@testing-library/jest-dom` matcher used
across this workspace).

**Verify**: focused Dialog tests pass.

## Test plan

One accessible-name assertion as above; existing Dialog tests unchanged.

## Done criteria

- [ ] `rg -n "discard-dialog" shared/components/src` → at least two matches (the `aria-labelledby` and the element id), or zero if the chosen fix removed the attribute in favor of MUI defaults with the accessible-name test still passing.
- [ ] Focused tests, typecheck, lint exit 0.
- [ ] `git -C shared diff --name-only f8cd4b7..HEAD` lists only in-scope paths.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- `Dialog.Header` id-forwarding requires restructuring the compound
  component's API — report; do not redesign the Dialog.
- A verification command fails twice after a reasonable in-scope fix attempt.

## Maintenance notes

- Reviewers/follow-up: grep `aria-labelledby=` across `shared` and `perses`
  for other dangling references — this was found in one dialog; siblings may
  share the pattern.
