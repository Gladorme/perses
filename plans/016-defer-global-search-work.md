# Plan 016: Defer global-search work and pre-index dashboard highlights

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git -C perses diff --stat 06886ac1..HEAD -- ui/app/src/components/Header/SearchBar/SearchBar.tsx ui/app/src/components/Header/SearchBar/SearchBar.test.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `06886ac1`, 2026-07-21

## Why this matters

Every search keystroke currently rerenders four resource-search branches,
rebuilds the dashboard highlight list with a nested scan, and synchronously runs
four `KVSearch.filter` operations before the input can settle. The dashboard
highlight pass is O(all dashboards × important dashboards), even though the
highlight membership changes only when fetched data changes. Deferring the query
sent to a memoized results subtree keeps the controlled input urgent, while a
pre-indexed highlight pass removes repeated nested work without changing search
results or routes. Availability reports must travel with the deferred query
they evaluated; otherwise the empty state can briefly describe the previous
result set just as deferral catches up.

## Current state

- `ui/app/src/components/Header/SearchBar/SearchBar.tsx` — owns the controlled
  query, fetched resource lists, result branches, and empty state.
- `ui/app/src/components/Header/SearchBar/SearchList.tsx` — synchronously filters
  and sorts the supplied list for each `query` prop; it remains out of scope
  because passing it a deferred query is sufficient.

Dashboard highlighting scans the important list for every dashboard and includes
`query` in the memo dependencies (`SearchBar.tsx:74-104`):

```tsx
const { query, isResources, onClick } = props;

const list: Array<Resource & { highlight: boolean }> = useMemo(() => {
  if (query.length && dashboardList) {
    return dashboardList.map((d) => {
      const highlight = !!importantDashboards.some(
        (importantDashboard) =>
          importantDashboard.metadata.name === d.metadata.name &&
          importantDashboard.metadata.project === d.metadata.project
      );
      return { ...d, highlight };
    });
  } else {
    return importantDashboards.map((imp) => ({ ...imp, highlight: true }));
  }
}, [importantDashboards, dashboardList, query]);
```

The parent updates its urgent state directly and passes it to all four result
branches (`SearchBar.tsx:159-174,222-260`):

```tsx
const [query, setQuery] = useState('');
const [hasResource, setHasResource] = useState<Record<ResourceType, boolean>>({
  dashboards: false,
  projects: false,
  globalDatasources: false,
  datasources: false,
});

function handleIsResourceAvailable(type: ResourceType, available: boolean): void {
  setHasResource((prev) => (prev[type] === available ? prev : { ...prev, [type]: available }));
}

<TextField
  value={query}
  onChange={(e) => setQuery(e.target.value)}
/>

{query.length > 0 && !hasAnyResource && <Typography>No records found for {query}</Typography>}
<SearchDashboardList query={query} onClick={handleClose} isResources={handleIsResourceAvailable} />
<SearchProjectList query={query} onClick={handleClose} isResources={handleIsResourceAvailable} />
<SearchGlobalDatasource query={query} onClick={handleClose} isResources={handleIsResourceAvailable} />
<SearchDatasourceList query={query} onClick={handleClose} isResources={handleIsResourceAvailable} />
```

Each `SearchList` synchronously filters before slicing the visible ten rows
(`SearchList.tsx:135-146,176`):

```tsx
const filteredList = useMemo(() => {
  if (!query && list?.[0]?.kind === 'Dashboard') {
    return list.map(/* ... */);
  }
  return kvSearch.filter(query, list);
}, [kvSearch, list, query]);

{filteredList.slice(0, currentSizeList).map(/* ... */)}
```

It reports only a boolean from a passive effect
(`SearchList.tsx:154-156`). The parent therefore cannot tell whether its four
stored booleans describe the current deferred query or the previous one:

```tsx
useEffect(() => {
  isResource?.(!!filteredList.length);
}, [filteredList.length, isResource]);
```

When `deferredQuery` catches up, `isSearchPending` becomes false during render,
before these effects publish the new result. Query-key the reports and require
all four current-query reports before showing an empty state.

Repository conventions to preserve:

- `ui/ui-guidelines.md` recommends state close to its consumer, smaller
  component responsibilities, named exports, and colocated Jest/React Testing
  Library coverage.
- Do not add a debounce timer: React 18 is installed and `useDeferredValue`
  expresses that the rendered results may lag while the controlled input stays
  immediate.
- Follow `ui/app/src/components/DashboardList/NameCell.test.tsx` for MUI/router
  wrappers and role/name selectors.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Node toolchain | `node --version` | exactly `v22.14.0`, matching `perses/ui/.nvmrc` |
| npm toolchain | `npm --version` | exactly `10.9.2`, matching `perses/ui/package.json` |
| Install | `npm --prefix perses/ui ci` | exit 0; `perses/ui/package-lock.json` is unchanged |
| Clean baseline | `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand src/model/querykey-builder.spec.ts` | exit 0 before any source edit; Jest config resolves correctly |
| Target test | `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand src/components/Header/SearchBar/SearchBar.test.tsx` | exit 0; highlighting and deferral tests pass |
| Typecheck | `npm --prefix perses/ui run type-check -- --filter=@perses-dev/app` | exit 0 after Turbo runs upstream builds, with no TypeScript errors |
| Lint | `npm --prefix perses/ui run lint --workspace=@perses-dev/app` | exit 0, no ESLint errors |
| App tests | `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand` | exit 0; all app tests pass |
| Production build | `npm --prefix perses/ui run build --workspace=@perses-dev/app` | exit 0; production bundle compiles |

## Suggested executor toolkit

- Use `vercel-react-best-practices` if available for its guidance on
  `useDeferredValue`, memoized expensive subtrees, and pre-indexing repeated
  lookups.
- Use React 18 primitives already installed. Do not add a debounce, worker,
  virtualization, or search dependency in this bounded change.

## Scope

**In scope** (the only files you should modify):

- `ui/app/src/components/Header/SearchBar/SearchBar.tsx`
- `ui/app/src/components/Header/SearchBar/SearchBar.test.tsx` (create)

**Out of scope** (do NOT touch):

- `SearchList.tsx`, `KVSearch` configuration, matching/ranking rules, result
  limits, tag rendering, and routing.
- Server APIs, React Query fetch behavior, or important-dashboard configuration.
- Search modal styling, keyboard shortcuts, and focus behavior.
- Debouncing, list virtualization, web workers, or new dependencies.

## Git workflow

- Branch: `advisor/016-defer-global-search-work`
- Commit one logical unit using the repository's observed style, for example:
  `[ENHANCEMENT] Defer global search result work`.
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

### Step 1: Add a linear dashboard-highlighting helper and tests

In `SearchBar.tsx`, add a small named export such as
`markImportantDashboards`. It must accept the complete dashboard list and the
important-dashboard list, build a `Set` of composite project/name identities
once, and return dashboards with a boolean `highlight` property.

Use an unambiguous identity encoding such as
`JSON.stringify([metadata.project, metadata.name])`; do not concatenate values
with a delimiter that a valid name could contain. The algorithm must be O(n+m)
and contain no `.some` inside the dashboard map.

Create `SearchBar.test.tsx` and unit-test the helper with:

- important and non-important dashboards;
- two dashboards with the same name in different projects, proving identity
  includes both fields;
- empty dashboard and important lists.

Use synthetic metadata only.

**Verify**: `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand src/components/Header/SearchBar/SearchBar.test.tsx` → exit 0 for the helper cases; `rg -n "importantDashboards\.some" perses/ui/app/src/components/Header/SearchBar/SearchBar.tsx` → no matches.

### Step 2: Stop rebuilding highlight arrays for every query string

Within `SearchDashboardList`:

1. Memoize the full highlighted dashboard array by `dashboardList` and
   `importantDashboards` using the new helper.
2. Memoize the important-only array with `highlight: true` by
   `importantDashboards`.
3. Select between the two prepared arrays with the boolean `query.length > 0`.
   The expensive map must not depend on the query text.

Preserve the current behavior: an empty query shows important dashboards only;
any non-empty query searches all dashboards and visually highlights important
ones.

**Verify**: `rg -n "markImportantDashboards|importantOnly|\[.*dashboardList.*importantDashboards.*\]" perses/ui/app/src/components/Header/SearchBar/SearchBar.tsx` → the two data-derived memos are shown and neither dependency list contains `query`.

### Step 3: Defer the results query and isolate result-branch rerenders

In `SearchBar.tsx`:

1. Import `memo` and `useDeferredValue` from React.
2. Wrap `SearchDashboardList`, `SearchProjectList`,
   `SearchGlobalDatasource`, and `SearchDatasourceList` in `memo`, retaining
   useful function names for React DevTools.
3. Extend the internal `isResources` callback to report
   `(type, evaluatedQuery, available)`. Each branch must pass the `query` prop it
   actually gave `SearchList`, not read the parent's urgent input. Convert the
   parent handler to `useCallback` with no dependencies so memoized branches do
   not receive a new callback on every input update.
4. Compute `const deferredQuery = useDeferredValue(query)` and
   `const isSearchPending = deferredQuery !== query` next to the query state.
5. Keep the `TextField` controlled by the immediate `query` state, but pass
   `deferredQuery` to all four memoized result branches.
6. Replace the unkeyed boolean record with query-keyed availability snapshots,
   preferably a `Map<string, Partial<Record<ResourceType, boolean>>>` updated
   immutably. Return the previous state object when the exact query/type already
   holds the reported boolean, preserving the current no-op optimization.
   Hoist the four resource types into a stable constant. For the
   current `deferredQuery`, derive both `hasAllResourceReports` (every type has
   explicitly reported true or false) and `hasAnyResource` (at least one true).
   Reports for an older query may remain in the modal-session snapshot map, but
   must never contribute to either current-query value. Clear the map when
   opening a new modal session so old results cannot flash on reopen.
7. Render the "No records found" state only when the deferred query is non-empty,
   `isSearchPending` is false, all four branches have reported for that exact
   deferred query, and none reports a match. Display the settled
   `deferredQuery` in that message. Until the current snapshot is complete,
   render neither a stale empty state nor a speculative empty state.

Do not wrap `setQuery` in `startTransition`: controlled input updates must remain
urgent. Do not duplicate the query in state and do not add a timeout.

Extend `SearchBar.test.tsx` with deterministic wiring and settle-transition
tests. Mock `useDeferredValue` so its returned value can be advanced explicitly,
mock the four data hooks, and replace `SearchList` with a controllable test
double that captures each branch's `query` and availability callback without
automatically reporting. Open the modal and assert that:

- the textbox immediately contains the new value;
- every rendered `SearchList` receives the mocked deferred value rather than the
  urgent value;
- the no-results message is not displayed while the two values differ;
- after the deferred value advances, the previous query's four reports are
  ignored and no empty state is shown until all four branches report for the
  new query;
- a prior query with matches followed by a current query with four negative
  reports shows the empty state only after the fourth current report; and
- a prior query with four negative reports followed by a current query with a
  match hides the old empty state throughout the pending and incomplete-report
  transition, then remains hidden when the current snapshot completes.

This test verifies the component boundary without relying on scheduler timing.

**Verify**: `rg -n "useDeferredValue|isSearchPending|hasAllResourceReports|query=\{deferredQuery\}|memo\(" perses/ui/app/src/components/Header/SearchBar/SearchBar.tsx` → one deferred value, one complete-current-snapshot gate, four deferred query props, and four memoized result branches are shown; the focused test command exits 0.

### Step 4: Run package checks and inspect scope

Run the target test, typecheck, lint, and full app suite. Confirm no search
ranking or result component file was changed.

**Verify**: `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand src/components/Header/SearchBar/SearchBar.test.tsx`, `npm --prefix perses/ui run type-check -- --filter=@perses-dev/app`, `npm --prefix perses/ui run lint --workspace=@perses-dev/app`, `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand`, and `npm --prefix perses/ui run build --workspace=@perses-dev/app` → each exits 0; `git -C perses status --short -- ui/app/src/components/Header/SearchBar` → only `SearchBar.tsx` and `SearchBar.test.tsx` are listed.

## Test plan

- New file: `ui/app/src/components/Header/SearchBar/SearchBar.test.tsx`.
- Pure helper cases: correct important flags, same name across projects, and
  empty inputs.
- Component wiring case: urgent textbox value differs from the mocked deferred
  result query, and pending search suppresses the empty state.
- Availability-transition cases: every report is tagged with its evaluated
  query; old reports are ignored after the deferred query advances; incomplete
  current snapshots suppress the empty state; matches-to-empty and
  empty-to-matches transitions settle without a stale message.
- Use `components/DashboardList/NameCell.test.tsx` for the MUI/MemoryRouter render
  wrapper and role-based selectors. Mock only data hooks and the expensive child
  boundary needed for deterministic assertions.
- Verification: run the focused test and then all app tests.

## Done criteria

- [ ] Dashboard highlight membership is built with one `Set` and no nested `importantDashboards.some` scan.
- [ ] Highlight arrays recompute only when dashboard/important data changes, not for each query string.
- [ ] The `TextField` remains controlled by `query`; all four result branches receive `deferredQuery`.
- [ ] All four resource-search branches are memoized and receive a stable
  availability callback; each report includes the branch's evaluated query.
- [ ] The empty state is hidden while `query !== deferredQuery` and until all
  four branches report for the exact current deferred query.
- [ ] Old-query availability cannot contribute to current `hasAnyResource` or
  completeness calculations, and snapshots reset on a new modal session.
- [ ] New tests cover composite dashboard identity, deterministic deferred-query
  wiring, and both availability settle directions.
- [ ] The pinned-version, clean install, and pre-edit baseline gates in Step 0 all pass.
- [ ] `npm --prefix perses/ui run type-check -- --filter=@perses-dev/app` exits 0.
- [ ] `npm --prefix perses/ui run lint --workspace=@perses-dev/app` exits 0.
- [ ] `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand` exits 0.
- [ ] `npm --prefix perses/ui run build --workspace=@perses-dev/app` exits 0.
- [ ] `git -C perses diff --name-only 06886ac1..HEAD` lists exactly the two in-scope files, and `git -C perses status --short` is empty after the logical commit.
- [ ] `plans/README.md` status row is updated, unless the dispatcher said it owns the index.

## STOP conditions

Stop and report back (do not improvise) if:

- Node `v22.14.0`/npm `10.9.2` cannot be activated, `npm ci` changes the
  lockfile, or the clean-baseline Jest test fails before any source edit.

- `SearchBar` or `SearchList` no longer matches the data flow shown in "Current
  state".
- A resource branch uses the immediate query for behavior other than result
  filtering/highlighting and cannot safely lag.
- Dashboard project/name values cannot be encoded into a stable composite key
  without changing resource semantics.
- Product requirements mandate that the no-results state update synchronously
  with every keystroke; that conflicts with deferred results and needs a product
  decision.
- Deterministic testing requires modifying `SearchList.tsx` or another
  out-of-scope file.
- A focused verification fails twice after one reasonable correction.

## Maintenance notes

- Deferred results may briefly display the prior query's matches while the input
  is ahead; that is the intended React 18 behavior. Keep pending empty-state
  suppression and exact-query availability completeness if the result UI
  evolves.
- Any new global-search resource branch should receive `deferredQuery` and stable
  callbacks, not the urgent input value.
- If important-dashboard identity rules change, update the composite-key helper
  and its same-name/different-project test together.
- Virtualization or server-side search may be warranted for much larger datasets,
  but should be driven by profiling and is explicitly deferred.
