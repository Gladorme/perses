# Plan 010: Replace eager tab-badge list queries with cache-only counts

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git -C perses diff --stat 06886ac1..HEAD -- ui/app/src/components/tabs.tsx ui/app/src/components/tabs.test.tsx ui/app/src/views/projects/ProjectTabs.tsx ui/app/src/views/admin/AdminTabs.tsx ui/app/src/model/global-variable-client.ts ui/app/src/model/global-secret-client.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `06886ac1`, 2026-07-21

## Why this matters

The project and admin tab bars fetch complete resource collections only to show
small numeric badges. On a cold project page this mounts six badge list
observers in addition to the active dashboard/folder data, while the admin page
mounts six; feature-disabled and permission-disabled tabs are included. The
active `TabPanel` already owns the request needed to render its content, so badge
observers should read that query's cache without initiating requests. Counts
will appear after a tab's list has actually been loaded and remain available
while its query data is cached.

## Current state

- `ui/app/src/views/projects/ProjectTabs.tsx` — project tab navigation and panels.
- `ui/app/src/views/admin/AdminTabs.tsx` — global/admin tab navigation and panels.
- `ui/app/src/components/tabs.tsx` — shared tab panel and count-label rendering.
- `ui/app/src/model/global-variable-client.ts` and
  `ui/app/src/model/global-secret-client.ts` — two list-query resource constants
  that are currently private.

`ProjectTabs` mounts one visibility query and six full-list count queries before
permissions are evaluated (`ProjectTabs.tsx:416-445`):

```tsx
const isEphemeralDashboardEnabled = useIsEphemeralDashboardEnabled();
const { data } = useEphemeralDashboardList(projectName);
const hasEphemeralDashboards = (data ?? []).length > 0;

// Fetch counts for tab badges
const { data: dashboards } = useDashboardList({ project: projectName, metadataOnly: true });
const { data: variables } = useVariableList(projectName);
const { data: datasources } = useDatasourceList({ project: projectName });
const { data: secrets } = useSecretList(projectName);
const { data: roles } = useRoleList(projectName);
const { data: roleBindings } = useRoleBindingList(projectName);

const hasDashboardReadPermission = useHasPermission('read', projectName, 'Dashboard');
```

Those arrays are consumed only as label lengths in this component
(`ProjectTabs.tsx:475-539`), for example:

```tsx
<MenuTab
  label={<TabLabel label="Dashboards" count={dashboards?.length} />}
  value={dashboardsTabIndex}
  disabled={!hasDashboardReadPermission}
/>
```

The active panel is the only panel whose child mounts
(`components/tabs.tsx:33-55`):

```tsx
<Box role="tabpanel" hidden={value !== index}>
  {value === index && children}
</Box>
```

For the default project tab, that child already fetches the full dashboard list
(`views/projects/tabs/ProjectDashboards.tsx:24-26`):

```tsx
const { data, isLoading } = useDashboardList({ project: projectName });
const { data: folderList, isLoading: isLoadingFolderList } = useFolderList({ project: projectName });
```

`AdminTabs` repeats the eager badge pattern (`AdminTabs.tsx:364-379`):

```tsx
// Fetch counts for tab badges
const { data: globalVariables } = useGlobalVariableList();
const { data: globalDatasources } = useGlobalDatasourceList();
const { data: globalSecrets } = useGlobalSecretList();
const { data: globalRoles } = useGlobalRoleList();
const { data: globalRoleBindings } = useGlobalRoleBindingList();
const { data: users } = useUserList();
```

`TabLabel` hides absent and zero values and renders only positive counts
(`components/tabs.tsx:59-76`):

```tsx
export function TabLabel({ label, count }: { label: string; count?: number }): ReactElement {
  return (
    <Stack direction="row" alignItems="center" gap={0.75}>
      <span>{label}</span>
      {count !== undefined && count > 0 && <Chip label={count} size="small" />}
    </Stack>
  );
}
```

Important distinctions:

- Keep `useEphemeralDashboardList(projectName)`; it decides whether the
  ephemeral-dashboard tab exists and is not a badge-only query.
- `TabButton` separately uses `useRoleList(projectName)` and
  `useGlobalRoleList()` to build role suggestions for role-binding creation.
  Those legitimate observers remain; only the duplicate badge observers go.
- Project list keys use `buildQueryKey({ resource, parent: projectName })`.
  Global keys use `buildQueryKey({ resource })`. The full dashboard panel key is
  `[dashboardResource, projectName, undefined]`, matching
  `useDashboardList({ project: projectName })`; do not subscribe to the current
  metadata-only badge key.

Repository conventions to preserve:

- `ui/ui-guidelines.md` names React Query as the fetched-state owner and asks
  tests to live beside components.
- Reuse the existing `TabLabel` visuals; this plan changes when data is fetched,
  not badge styling.
- Follow `ui/app/src/components/DashboardList/NameCell.test.tsx` for a colocated
  React Testing Library test and provider wrapper.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Node toolchain | `node --version` | exactly `v22.14.0`, matching `perses/ui/.nvmrc` |
| npm toolchain | `npm --version` | exactly `10.9.2`, matching `perses/ui/package.json` |
| Install | `npm --prefix perses/ui ci` | exit 0; `perses/ui/package-lock.json` is unchanged |
| Clean baseline | `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand src/model/querykey-builder.spec.ts` | exit 0 before any source edit; Jest config resolves correctly |
| Target test | `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand src/components/tabs.test.tsx` | exit 0; cache-only badge tests pass |
| Typecheck | `npm --prefix perses/ui run type-check -- --filter=@perses-dev/app` | exit 0 after Turbo runs upstream builds, with no TypeScript errors |
| Lint | `npm --prefix perses/ui run lint --workspace=@perses-dev/app` | exit 0, no ESLint errors |
| App tests | `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand` | exit 0; all app tests pass |
| Production build | `npm --prefix perses/ui run build --workspace=@perses-dev/app` | exit 0; production bundle compiles |

## Suggested executor toolkit

- Use `vercel-react-best-practices` if available for the guidance on avoiding
  duplicate client fetches and isolating server-state subscriptions.
- Use the installed TanStack Query v4 API; the cache-only observer must be
  implemented with `enabled: false`, not a new state store or effect-based cache
  polling.

## Scope

**In scope** (the only files you should modify):

- `ui/app/src/components/tabs.tsx`
- `ui/app/src/components/tabs.test.tsx` (create)
- `ui/app/src/views/projects/ProjectTabs.tsx`
- `ui/app/src/views/admin/AdminTabs.tsx`
- `ui/app/src/model/global-variable-client.ts`
- `ui/app/src/model/global-secret-client.ts`

**Out of scope** (do NOT touch):

- Any backend endpoint or response shape; no count endpoint exists in scope.
- Tab panel list components or their actual list queries.
- The ephemeral-dashboard visibility query and role-suggestion queries described
  above.
- Query keys, invalidation behavior, pagination, or global React Query defaults.
- Tab styling, permission semantics, feature flags, and navigation routes.

## Git workflow

- Branch: `advisor/010-replace-tab-list-badge-queries`
- Commit one logical unit with the observed message style, for example:
  `[ENHANCEMENT] Read tab badge counts from query cache`.
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

### Step 1: Expose the two private global resource keys

Change only the declarations in `global-variable-client.ts` and
`global-secret-client.ts` from private `const resource = ...` declarations to
named exported constants. Do not rename their string values and do not change
any query or mutation logic.

The other required constants are already exported by their client modules:
project dashboard, variable, datasource, secret, role, role binding; global
datasource, role, role binding; and `userResource`.

**Verify**: `rg -n "export const resource = '(globalvariables|globalsecrets)'" perses/ui/app/src/model/global-variable-client.ts perses/ui/app/src/model/global-secret-client.ts` → exactly one matching declaration in each file.

### Step 2: Add a cache-only list-count label

In `components/tabs.tsx`, keep `TabLabel` as the visual primitive and add a named
`CachedListTabLabel` component with props `{ label: string; queryKey: QueryKey }`.
It must:

1. Call `useQuery<unknown[], Error, number>` with the supplied key,
   `enabled: false`, and `select: (resources) => resources.length`.
2. Omit `queryFn`; this observer is not allowed to initiate a request.
3. Render `<TabLabel label={label} count={count} />`.

Create `components/tabs.test.tsx` with a new `QueryClient` per test and a
`QueryClientProvider`. Cover:

- Rendering an uncached `CachedListTabLabel` does not call a default query
  function and shows no badge.
- Calling `queryClient.setQueryData(queryKey, [itemA, itemB])` updates the mounted
  label to show `2` without remounting it.
- Cached empty data keeps the existing zero-count-hidden behavior.

Use synthetic objects; the helper needs only array length.

**Verify**: `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand src/components/tabs.test.tsx` → exit 0; all three cache-only behaviors pass and the request mock has zero calls.

### Step 3: Rewire project badges to their panel query keys

In `ProjectTabs.tsx`:

1. Replace `TabLabel` imports/usages for counts with `CachedListTabLabel`.
2. Remove the six badge-only list-hook calls and the "Fetch counts" comment.
3. Remove only now-unused list-hook imports; retain create-mutation imports,
   `useRoleList` for `TabButton`, and `useEphemeralDashboardList`.
4. Import each model's exported `resource` with an unambiguous alias and import
   `buildQueryKey`.
5. Supply these exact keys:
   - Dashboards: `[dashboardResource, projectName, undefined]` (the full-list
     query owned by `ProjectDashboards`, not the old metadata-only query).
   - Variables, datasources, secrets, roles, and role bindings:
     `buildQueryKey({ resource: <alias>, parent: projectName })`.

Feature-disabled or permission-disabled tabs may still render a cache-only label,
but that label must never fetch. When a tab panel loads its list, the shared key
updates the isolated badge component.

**Verify**: `rg -n "use(DashboardList|VariableList|DatasourceList|SecretList|RoleBindingList)\(" perses/ui/app/src/views/projects/ProjectTabs.tsx` → no matches; `rg -n "useRoleList\(|useEphemeralDashboardList\(|CachedListTabLabel" perses/ui/app/src/views/projects/ProjectTabs.tsx` → the two legitimate hooks and all six cache-backed labels are present.

### Step 4: Rewire admin badges to their panel query keys

Apply the same pattern in `AdminTabs.tsx`:

1. Remove the six badge-only list-hook calls and now-unused imports.
2. Keep `useGlobalRoleList()` inside `TabButton` for role suggestions.
3. Import the resource aliases and `userResource`.
4. Pass `buildQueryKey({ resource: <alias> })` to `CachedListTabLabel` for global
   variables, datasources, secrets, roles, role bindings, and users.

Do not gate requests manually with permission booleans; there should be no
request to gate because every badge observer is disabled.

**Verify**: `rg -n "use(GlobalVariableList|GlobalDatasourceList|GlobalSecretList|GlobalRoleBindingList|UserList)\(" perses/ui/app/src/views/admin/AdminTabs.tsx` → no matches; `rg -n "useGlobalRoleList\(|CachedListTabLabel" perses/ui/app/src/views/admin/AdminTabs.tsx` → the role-suggestion hook and all six cache-backed labels are present.

### Step 5: Run package checks and inspect scope

Run the focused tests, typecheck, lint, and full app suite. Inspect the final diff
to ensure no model logic changed beyond exporting two constants.

**Verify**: `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand src/components/tabs.test.tsx`, `npm --prefix perses/ui run type-check -- --filter=@perses-dev/app`, `npm --prefix perses/ui run lint --workspace=@perses-dev/app`, `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand`, and `npm --prefix perses/ui run build --workspace=@perses-dev/app` → each exits 0.

## Test plan

- New file: `ui/app/src/components/tabs.test.tsx`.
- Assert disabled query behavior (zero request calls), reactive cache updates, and
  zero-count hiding.
- Use `components/DashboardList/NameCell.test.tsx` for the local component-test
  structure; add `QueryClientProvider` around the component under test.
- The two parent rewires are guarded by exact `rg` checks for removal of their
  badge-only hooks and by typechecking every imported resource key.
- Verification: run the target test, then all app tests.

## Done criteria

- [ ] `CachedListTabLabel` uses the supplied query key with `enabled: false`, a length selector, and no `queryFn`.
- [ ] Its test proves mounting an uncached badge performs zero requests and cached data updates the count.
- [ ] `rg -n "Fetch counts for tab badges|count=\{[^}]*\?\.length\}" perses/ui/app/src/views/projects/ProjectTabs.tsx perses/ui/app/src/views/admin/AdminTabs.tsx` returns no matches.
- [ ] Project and admin labels use the exact same keys as their active list panels.
- [ ] The ephemeral visibility and role-suggestion hooks remain present.
- [ ] The pinned-version, clean install, and pre-edit baseline gates in Step 0 all pass.
- [ ] `npm --prefix perses/ui run type-check -- --filter=@perses-dev/app` exits 0.
- [ ] `npm --prefix perses/ui run lint --workspace=@perses-dev/app` exits 0.
- [ ] `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand` exits 0.
- [ ] `npm --prefix perses/ui run build --workspace=@perses-dev/app` exits 0.
- [ ] `git -C perses diff --name-only 06886ac1..HEAD` lists exactly the six in-scope files, and `git -C perses status --short` is empty after the logical commit.
- [ ] `plans/README.md` status row is updated, unless the dispatcher said it owns the index.

## STOP conditions

Stop and report back (do not improvise) if:

- Node `v22.14.0`/npm `10.9.2` cannot be activated, `npm ci` changes the
  lockfile, or the clean-baseline Jest test fails before any source edit.

- The count-hook blocks or list query keys no longer match "Current state".
- TanStack Query v4 invokes a query function for the `enabled: false` observer in
  the focused test.
- A required resource key cannot be obtained without hard-coding a second string
  or changing query-key construction outside scope.
- Product requirements demand every badge count before its tab is visited; that
  requires a cheap server summary/count API and is not authorized by this plan.
- Removing a badge-only hook also removes data used by `TabButton` or a panel;
  preserve the legitimate use and report the overlap.
- A focused verification fails twice after one reasonable correction.

## Maintenance notes

- A cache-only badge deliberately has no value before its corresponding list is
  fetched. Do not "fix" the empty state by enabling the observer.
- If a list query key changes, update its `CachedListTabLabel` key in the same PR;
  mismatched keys fail silently by leaving the badge empty.
- Reviewers should inspect the browser network panel on cold project/admin pages:
  inactive tabs must not issue list requests for their badges.
- A future batched count endpoint could populate all badges eagerly at much lower
  cost; that backend/API design is explicitly deferred.
