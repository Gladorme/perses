# Plan 034: Memoize the Authorization context value in the app shell

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: in `perses\`, run
> `git diff --stat 06886ac1..HEAD -- ui/app/src/context/Authorization.tsx`
> On any change, compare "Current state" excerpts to live code first;
> mismatch = STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: `perses` repo commit `06886ac1`, 2026-07-20

## Why this matters

`AuthorizationProvider` wraps the whole Perses app and passes a fresh object
literal as its context value on every render. Any re-render of the provider
(auth refresh, permission refetch, parent state) re-renders every consumer of
`useAuthorizationContext` — permission checks are sprinkled across toolbars,
menus, and route guards. The fix is a one-line `useMemo`. Impact is modest
(the provider re-renders rarely), hence P3 — but it's nearly free and it
removes the last un-memoized app-shell context found in the audit.

## Current state

Repo **`perses`**, package `@perses-dev/app` at `perses\ui\app`.

- `perses\ui\app\src\context\Authorization.tsx`:

```tsx
// Authorization.tsx:34-56 (current)
export function AuthorizationProvider(props: { children: ReactNode }): ReactElement {
  const enabled = useIsAuthEnabled();
  const isdelegatedAuthnProviderEnabled = useIsDelegatedAuthnProviderEnabled();
  if (enabled && !isdelegatedAuthnProviderEnabled) {
    // Will refresh the access token if it has expired when fetching data
    enableRefreshFetch();
  }

  const username = useUsername();
  const { data } = useUserPermissions(username);
  const userPermissions: Record<string, Permission[]> = useMemo(() => {
    if (!data) { return {}; }
    return data;
  }, [data]);

  return (
    <AuthorizationContext.Provider value={{ enabled, username, userPermissions }}>
      {props.children}
    </AuthorizationContext.Provider>
  );
}
```

`useMemo` is already imported (used at line 44).

- Conventions: React 18, explicit return types. Note the `enableRefreshFetch()`
  call during render (lines 37–40) — pre-existing, leave it alone.

## Commands you will need

Run from `C:\Users\Guillaume\Documents\Projets\perses\app\perses\ui\app`.

| Purpose   | Command             | Expected |
|-----------|---------------------|----------|
| Install   | `npm install` (from `perses\ui` root, only if needed) | exit 0 |
| Typecheck | `npm run type-check` | exit 0  |
| Tests     | `npm run test`       | all pass |
| Lint      | `npm run lint`       | exit 0  |

## Scope

**In scope**:
- `perses\ui\app\src\context\Authorization.tsx`

**Out of scope**:
- The `enableRefreshFetch()` render side effect (a separate concern; do not
  move it into an effect in this plan).
- `useUserPermissions`, `useUsername`, and the permission-checking hooks
  below the provider in the same file (`useDashboardCreateAllowedProjects`,
  etc.) — read-only.

## Git workflow

- Repo `perses`. Branch: `advisor/034-authorization-context-memo`.
- Commit style from `git log`: `[ENHANCEMENT] <description> (#<PR>)` — use
  `[ENHANCEMENT]` prefix.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Memoize the value

```tsx
const ctxValue = useMemo(() => ({ enabled, username, userPermissions }), [enabled, username, userPermissions]);
return <AuthorizationContext.Provider value={ctxValue}>{props.children}</AuthorizationContext.Provider>;
```

**Verify**: `npm run type-check` → exit 0.

### Step 2: Lint and test

**Verify**: `npm run lint` → exit 0; `npm run test` → all pass.

## Test plan

No new test required (the app package has broad component tests; identity of
this context is exercised indirectly). Full package `npm run test` must pass.

## Done criteria

ALL must hold (run in `perses\ui\app`):

- [ ] `npm run type-check` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm run test` exits 0
- [ ] `Authorization.tsx` contains no inline `value={{` (grep the file)
- [ ] `git status` in `perses` shows only `ui/app/src/context/Authorization.tsx` modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The excerpt doesn't match the live code (drift).
- Type-check or tests fail in a way related to `username` being possibly
  undefined in the memo deps (would indicate the hook signatures changed).

## Maintenance notes

- Follow-up worth filing separately: `enableRefreshFetch()` is called during
  render (impure); it should likely be a `useEffect` or module-level init.
  Out of scope here because its call-count semantics are unclear.
- Reviewer: nothing subtle — identity-only change.
