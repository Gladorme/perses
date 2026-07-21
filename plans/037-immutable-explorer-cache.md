# Plan 037: Update the explorer state cache immutably

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite workspace root)**:
> `git -C shared diff --stat f8cd4b7..HEAD -- explore/src/components/ExploreManager/ExplorerManagerProvider.tsx`
> If the file changed since this plan was written, compare the "Current
> state" excerpt against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: shared commit `f8cd4b7`, 2026-07-21

## Why this matters

When the user switches explorer tabs (Metrics/Traces/Logs/Profiles…), the
provider saves the outgoing explorer's state into a cache. It does this by
**mutating the state object in place and calling the setter with the same
reference** — React bails out on `Object.is` equality, so no re-render is
scheduled and the "update" only works by accident of shared mutable state.
Under StrictMode or any future memoization of the provider, save/restore of
per-explorer state (current queries, etc.) silently breaks; consumers can
also observe the cache changing between renders without a render.

## Current state

- `shared/explore/src/components/ExploreManager/ExplorerManagerProvider.tsx:50-60`:

```ts
  function setExplorer(newExplorer: string): void {
    if (explorer) {
      // store current explorer state
      explorerStateCache[explorer] = { data };
      setExplorerStateCache(explorerStateCache);
    }

    // restore previous explorer state (if any)
    const state = explorerStateCache[newExplorer] ?? { data: {} };
    setExplorerState({ explorer: newExplorer, data: state.data });
  }
```

- `explorerStateCache` is `useState<Record<string, Omit<ExplorerState<unknown>, 'explorer'>>>({})`
  (lines 41–43). `explorerState`/`setExplorerState` may come from an external
  `store` prop or local state (lines 44–47).
- Consumers: `ExploreManager.tsx:31` (`setExplorer` from context) and
  explorer plugins via `useExplorerManagerContext` (e.g.
  `plugins/Prometheus/src/explore/PrometheusExplorer.tsx:80`).

Note the restore line reads from the same `explorerStateCache` object it
just mutated — after the fix, restore must read from the NEW cache snapshot
(or equivalently compute it before setting), preserving the behavior that
switching A→B saves A and restores B in one call.

## Commands you will need

Node `v22.14.0` / npm `10.9.2` pinned (`shared/.nvmrc`); STOP if not
activatable. Windows: `npm.cmd`.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix shared ci` | exit 0; lockfile unchanged |
| Focused test | `npm --prefix shared run test --workspace=@perses-dev/explore -- --runInBand ExplorerManagerProvider` | exit 0 |
| Typecheck | `npm --prefix shared run type-check -- --filter=@perses-dev/explore` | exit 0 |
| Lint | `npm --prefix shared run lint --workspace=@perses-dev/explore` | exit 0 |

## Scope

**In scope**:

- `shared/explore/src/components/ExploreManager/ExplorerManagerProvider.tsx`
- `shared/explore/src/components/ExploreManager/ExplorerManagerProvider.test.tsx` (create)

**Out of scope** (do NOT touch):

- `ExploreManager.tsx`, explorer plugin components, the `store` prop
  contract, `setData`.

## Git workflow

- Nested `shared` repository, branch `advisor/037-immutable-explorer-cache`.
- One commit, e.g. `[BUGFIX] explore: update explorer state cache immutably`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Regression test

Create the test file. Render a probe component under
`ExplorerManagerProvider` that reads `{ explorer, data, setExplorer, setData }`
from `useExplorerManagerContext()`. Script:

1. `setExplorer('a')`; `setData({ q: 1 })`;
2. `setExplorer('b')`; `setData({ q: 2 })`;
3. `setExplorer('a')` → assert `data` equals `{ q: 1 }` (restore works);
4. wrap the tree in `<StrictMode>` for the whole test — StrictMode's
   double-invocation is what exposes the illegal mutation.

**Verify**: focused test → restore assertion behaves incorrectly or a
mutation-dependent flake appears under StrictMode against current code
(if it happens to pass, keep the test — it pins the contract; note this in
your report). Do not commit yet.

### Step 2: Fix the update

```ts
function setExplorer(newExplorer: string): void {
  let cache = explorerStateCache;
  if (explorer) {
    cache = { ...explorerStateCache, [explorer]: { data } };
    setExplorerStateCache(cache);
  }
  const state = cache[newExplorer] ?? { data: {} };
  setExplorerState({ explorer: newExplorer, data: state.data });
}
```

**Verify**: focused test → all assertions pass, StrictMode included.

### Step 3: Package checks

**Verify**: typecheck and lint exit 0.

## Test plan

One test file, two tests: (a) save/restore round-trip across three switches
under StrictMode; (b) switching to a never-visited explorer yields
`data: {}`. Plain RTL, no plugin registry needed.

## Done criteria

- [ ] `rg -n "explorerStateCache\[explorer\] =" shared/explore/src` → no matches.
- [ ] Focused tests pass under StrictMode; typecheck and lint exit 0.
- [ ] `git -C shared diff --name-only f8cd4b7..HEAD` lists only in-scope paths.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- The provider has been rewritten (e.g. to useReducer/zustand) — drift.
- The external `store` prop path behaves differently in a way the test
  cannot cover without app context — test the local-store path only and note
  it; do not modify the prop contract.
- A verification command fails twice after a reasonable in-scope fix attempt.

## Maintenance notes

- `setData` writes only the live explorer state; cache entries are written
  on switch — a reviewer should confirm no code relies on the old
  mutate-in-place visibility.
- If explorer state grows large, consider capping cache entries; out of
  scope today.
