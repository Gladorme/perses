# Plan 040: Fix the "Successfully login" success messages

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite workspace root)**:
> `git -C perses diff --stat 06886ac1..HEAD -- ui/app/src/views/auth/SignInView.tsx ui/app/src/views/auth/DelegatedAuthnErrorView.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (copy)
- **Planned at**: perses commit `06886ac1`, 2026-07-21

## Why this matters

The success toast after signing in reads **"Successfully login"** — a
grammar error in the very first interaction every user has with the product.
It appears in both the native sign-in flow and the delegated-auth recovery
flow.

## Current state

- `perses/ui/app/src/views/auth/SignInView.tsx:37-39`:

```ts
        onSuccess: () => {
          successSnackbar(`Successfully login`);
          navigate(redirectPath);
```

- `perses/ui/app/src/views/auth/DelegatedAuthnErrorView.tsx:34-38`:

```ts
  useEffect(() => {
    if (authnCheck?.data?.metadata?.name) {
      successSnackbar(`Successfully login`);
      navigate(redirectPath);
```

Copy conventions in this app: `"<Thing> ... has been successfully <verb>ed"`
or short imperative confirmations. Use **"Successfully logged in"** in both
places (keep it identical across the two files).

## Commands you will need

Node `v22.14.0` / npm `10.9.2` pinned; STOP if not activatable. Windows:
`npm.cmd`.

| Purpose | Command | Expected on success |
|---|---|---|
| Grep check | `rg -n "Successfully login" perses/ui/app/src` | no matches (after fix) |
| Typecheck | `npm --prefix perses/ui run type-check -- --filter=@perses-dev/app` | exit 0 |
| Lint | `npm --prefix perses/ui run lint --workspace=@perses-dev/app` | exit 0 |
| App tests | `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand auth` | exit 0 (or no matching suites) |

## Scope

**In scope**:

- `perses/ui/app/src/views/auth/SignInView.tsx`
- `perses/ui/app/src/views/auth/DelegatedAuthnErrorView.tsx`
- Any test file that asserts the exact old string (update the expectation):
  `rg -n "Successfully login" perses` to find them.

**Out of scope** (do NOT touch):

- Any other copy, the auth logic, translations infra (none exists).

## Git workflow

- Nested `perses` repository, branch `advisor/040-fix-login-success-copy`.
- One commit, e.g. `[BUGFIX] ui: fix sign-in success message grammar`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Replace the string in both files

Change `` `Successfully login` `` → `` `Successfully logged in` `` in both
locations. Update any test expectations found by the scope grep.

**Verify**: `rg -n "Successfully login" perses` → no matches;
typecheck, lint, and the auth-related test filter all exit 0.

## Test plan

No new tests — copy-only change; existing suites guard against regressions
in the surrounding logic.

## Done criteria

- [ ] `rg -n "Successfully login" perses` → no matches.
- [ ] `rg -n "Successfully logged in" perses/ui/app/src` → exactly two matches.
- [ ] Typecheck and lint exit 0.
- [ ] `git -C perses diff --name-only 06886ac1..HEAD` lists only in-scope paths.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- The strings have already been fixed or moved into an i18n layer (drift).

## Maintenance notes

- If more copy issues surface, prefer a single sweep with a glossary rather
  than one-string commits; this one is bundled alone because it sits on the
  primary auth path.
