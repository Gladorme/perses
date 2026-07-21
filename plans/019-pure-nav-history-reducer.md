# Plan 019: Make the dashboard nav-history reducer pure

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite workspace root)**:
> `git -C perses diff --stat 06886ac1..HEAD -- ui/app/src/context/DashboardNavHistory.tsx ui/app/src/context/DashboardNavHistory.test.tsx`
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

The reducer feeding the "Recent dashboards" section mutates the previous state
array in place (`splice`, `unshift`) and writes to `localStorage` inside the
reducer body. React requires reducers to be pure: under StrictMode's
double-invocation (dev) and under any concurrent replay, the add path runs
twice against the *same mutated array*, duplicating entries and persisting the
duplicate to `localStorage`. In-place mutation also corrupts the previous
state object that React may still hold.

## Current state

- `perses/ui/app/src/context/DashboardNavHistory.tsx` — the provider,
  reducer, and hooks. Dispatched from `DashboardView.tsx:40-44` and
  `EphemeralDashboardView.tsx:44-48` on view mount.

Reducer today (`DashboardNavHistory.tsx:48-77`):

```ts
function historyReducer(
  history: DashboardNavHistoryItem[],
  resource: { project: string; name: string } | { type: 'remove'; project: string; name: string }
): DashboardNavHistoryItem[] {
  // Handle remove action
  if ('type' in resource && resource.type === 'remove') {
    const newHistory = history.filter((item) => !(item.project === resource.project && item.name === resource.name));
    window.localStorage.setItem(PERSES_DASHBOARD_NAV_HISTORY_KEY, JSON.stringify(newHistory));
    return newHistory;
  }

  // Handle add/update action
  const index = history.findIndex((item) => item.project === resource.project && item.name === resource.name);
  if (index > -1) {
    // If the history already contains the dashboard, remove it
    history.splice(index, 1);
  }
  // Push dashboard to the beginning of the array ... with the current date
  history.unshift({
    project: resource.project,
    name: resource.name,
    date: new Date().toISOString(),
  });

  // Limiting history to 100 items only
  history = history.slice(0, 100);

  window.localStorage.setItem(PERSES_DASHBOARD_NAV_HISTORY_KEY, JSON.stringify(history));
  return history;
}
```

Provider (`DashboardNavHistory.tsx:31-46`) seeds `useReducer` from
`localStorage` via `useMemo` and exposes `NavHistoryContext` +
`NavHistoryDispatchContext`.

Note: `new Date()` inside a reducer is also impure, but relocating timestamp
creation to dispatch call sites would change the public dispatch shape used by
two views; keep `new Date()` where it is (acceptable pragmatism), fix the
mutation and the storage side effect only.

Repo conventions: colocated Jest + React Testing Library tests; exemplar for
a hook/provider-level test: `perses/ui/app/src/components/ShortcutHelpModal.test.tsx`
(component) — for pure-function tests, plain Jest `describe/it` files are used
throughout the workspace.

## Commands you will need

Node `v22.14.0` / npm `10.9.2` pinned (see `perses/ui/.nvmrc`,
`packageManager`); STOP if not activatable. Windows: `npm.cmd`.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix perses/ui ci` | exit 0; lockfile unchanged |
| Focused test | `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand DashboardNavHistory.test.tsx` | exit 0 |
| Typecheck | `npm --prefix perses/ui run type-check -- --filter=@perses-dev/app` | exit 0 |
| Lint | `npm --prefix perses/ui run lint --workspace=@perses-dev/app` | exit 0 |

## Scope

**In scope**:

- `perses/ui/app/src/context/DashboardNavHistory.tsx`
- `perses/ui/app/src/context/DashboardNavHistory.test.tsx` (create)

**Out of scope** (do NOT touch):

- `DashboardView.tsx` / `EphemeralDashboardView.tsx` dispatch call sites — the
  dispatch payload shape must not change.
- The "Recent dashboards" rendering components.
- The `localStorage` key name or stored JSON shape (persisted data must stay
  compatible).

## Git workflow

- Nested `perses` repository, branch `advisor/019-pure-nav-history-reducer`.
- One commit, e.g. `[BUGFIX] ui: make dashboard nav-history reducer pure`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Add reducer tests (export the reducer for testing)

Export `historyReducer` (named export) so it is directly testable. Create
`DashboardNavHistory.test.tsx` with plain unit tests:

1. add action returns a NEW array and leaves the input array untouched
   (assert `result).not.toBe(input)` and `input` deep-equals its snapshot
   taken before the call);
2. re-adding an existing project/name moves it to index 0 without duplicating
   (result length unchanged);
3. calling the reducer twice with the same input array (simulating StrictMode
   double-invoke) yields the same result as calling it once — no duplicate
   entry;
4. history is capped at 100 items;
5. remove action removes the matching entry and returns a new array.

**Verify**: focused test → tests 1 and 3 FAIL against current code (input
mutated / duplicate on double-invoke). Do not commit this state.

### Step 2: Rewrite the add path immutably and hoist the side effect

Target shape:

```ts
export function historyReducer(history, resource) {
  if ('type' in resource && resource.type === 'remove') {
    return history.filter((item) => !(item.project === resource.project && item.name === resource.name));
  }
  const withoutExisting = history.filter(
    (item) => !(item.project === resource.project && item.name === resource.name)
  );
  return [
    { project: resource.project, name: resource.name, date: new Date().toISOString() },
    ...withoutExisting,
  ].slice(0, 100);
}
```

Remove both `localStorage.setItem` calls from the reducer. In
`NavHistoryProvider`, persist in an effect instead:

```ts
useEffect(() => {
  window.localStorage.setItem(PERSES_DASHBOARD_NAV_HISTORY_KEY, JSON.stringify(history));
}, [history]);
```

Guard: skip the very first write if you want to avoid rewriting identical
initial data — optional, not required for correctness.

**Verify**: focused test → all reducer tests pass.

### Step 3: Package checks

**Verify**: typecheck and lint exit 0; run the app test suite for the context
folder:
`npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand DashboardNavHistory.test.tsx`
→ exit 0.

## Test plan

Covered in Step 1 — five reducer unit tests plus (optional, if cheap) one
provider-level test asserting `localStorage` contains the latest history after
a dispatch, using Jest's jsdom `localStorage`.

## Done criteria

- [ ] `rg -n "localStorage.setItem" perses/ui/app/src/context/DashboardNavHistory.tsx` → exactly one match, inside a `useEffect`.
- [ ] `rg -n "splice|unshift" perses/ui/app/src/context/DashboardNavHistory.tsx` → no matches.
- [ ] Focused tests pass; typecheck and lint exit 0.
- [ ] `git -C perses diff --name-only 06886ac1..HEAD` lists only the two in-scope paths.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- The reducer has already been rewritten or moved (drift).
- Persisting via effect breaks an existing consumer that relied on
  synchronous persistence ordering (unexpected — report).
- A verification command fails twice after a reasonable in-scope fix attempt.

## Maintenance notes

- If cross-tab sync is ever wanted, add a `storage` event listener in the
  provider — the effect-based persistence makes that straightforward.
- Reviewers: confirm the dispatch payload contract (`{project, name}` and
  `{type:'remove', ...}`) is unchanged.
