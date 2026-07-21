# Plan 053: Load Panel plugin actions by plugin kind, not on every query result

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite repository root)**:
> `git -C shared diff --stat 472a289..HEAD -- dashboards/src/components/Panel/Panel.tsx dashboards/src/components/Panel/Panel.test.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S-M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: `shared` repo commit `472a289`, 2026-07-20

## Why this matters

`Panel` resolves its plugin's header actions in an **async effect** whose
dependency array includes `panelPropsForActions`, and `panelPropsForActions` is
memoized on `[definition, contentDimensions, queryResults]`. `queryResults`
changes identity on **every data refresh** (every poll/refetch), and
`contentDimensions` changes on every resize. So on each of those events the
effect:

1. re-invokes the async `getPlugin({ kind: 'Panel', name })` lookup, and
2. calls `setPluginActions([...])`, which triggers an extra render of the
   panel.

The set of plugin actions depends only on the **plugin kind**, not on the query
data — the query data only needs to be passed to the action components as props
at render time. Re-fetching the plugin and rebuilding the action element array
whenever data refreshes is wasted work plus an avoidable extra render per
refresh, multiplied across every panel on the dashboard. The fix separates
"which action components does this plugin expose" (keyed on kind) from "render
those components with current panel props" (done in render).

## Current state

Repo **`shared`**, package `@perses-dev/dashboards`, file
`dashboards/src/components/Panel/Panel.tsx`. `Panel` is `memo`-wrapped.

```tsx
// Panel.tsx (current, abridged)
const { queryResults } = useDataQueriesContext();
const { getPlugin } = usePluginRegistry();

const panelPropsForActions = useMemo(() => {
  return {
    spec: definition.spec.plugin.spec,
    queryResults: queryResults.map((query) => ({ definition: query.definition, data: query.data })),
    contentDimensions,
    definition,
  };
}, [definition, contentDimensions, queryResults]);

const [pluginActions, setPluginActions] = useState<ReactNode[]>([]);

useEffect(() => {
  const loadPluginActions = async (): Promise<void> => {
    const panelPluginKind = definition.spec.plugin.kind;
    if (!panelPluginKind || !panelPropsForActions || !getPlugin || typeof getPlugin !== 'function') {
      setPluginActions([]);
      return;
    }
    try {
      const plugin = await getPlugin({ kind: 'Panel', name: panelPluginKind });
      if (!plugin || typeof plugin !== 'object' || !plugin.actions || !Array.isArray(plugin.actions) || plugin.actions.length === 0) {
        setPluginActions([]);
        return;
      }
      const headerActions = plugin.actions
        .filter((action) => !action.location || action.location === 'header')
        .map((action, index): ReactNode | null => {
          const ActionComponent = action.component;
          try {
            return <ActionComponent key={`plugin-action-${index}`} {...(panelPropsForActions as any)} />;
          } catch (error) {
            console.warn(`Failed to render plugin action ${index}:`, error);
            return null;
          }
        })
        .filter((item): item is ReactNode => Boolean(item));
      setPluginActions(headerActions);
    } catch (error) {
      console.warn('Failed to load plugin actions:', error);
      setPluginActions([]);
    }
  };
  loadPluginActions();
}, [definition.spec.plugin.kind, panelPropsForActions, getPlugin]);
```

`pluginActions` is passed to `<PanelHeader pluginActions={pluginActions} .../>`.
The action components receive the full `panelPropsForActions` (spec,
queryResults, contentDimensions, definition), so they DO need current data —
but as render-time props, not as an effect trigger.

## Commands you will need

Use Node `v22.14.0` (`shared/.nvmrc`) and npm `10.9.2`; if those pinned
versions cannot be activated, STOP before installing or testing. Run from the
composite repository root.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix shared ci` | exit 0; lockfile unchanged |
| Focused test | `npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand Panel` | exit 0; Panel suites pass |
| Typecheck | `npm --prefix shared run type-check -- --filter=@perses-dev/dashboards` | exit 0 |
| Lint | `npm --prefix shared run lint --workspace=@perses-dev/dashboards` | exit 0, exhaustive-deps clean |
| Full package tests | `npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand` | exit 0 |

## Scope

**In scope** (the only implementation files you should modify):

- `shared/dashboards/src/components/Panel/Panel.tsx`
- `shared/dashboards/src/components/Panel/Panel.test.tsx` (create or extend)

`plans/README.md` is an administrative status-only exception after completion.

**Out of scope** (do NOT touch):

- `PanelHeader` and its rendering of `pluginActions`.
- The `usePluginRegistry`/`getPlugin` contract.
- The `SelectionProvider`/`ItemActionsProvider` wrapping.
- The grid-item prop stability work (plan 054) — different concern, same file
  cluster; if both are executed, run the second against a fresh drift check.

## Git workflow

- Work in the nested `shared` repository on branch
  `advisor/053-key-panel-actions-by-plugin-kind`.
- Commit as one logical unit after verification, e.g.:
  `[ENHANCEMENT] dashboards: load panel actions by plugin kind`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 0: Reinstall the locked shared workspace

`npm --prefix shared ci`. **Verify**: exits 0 and
`git -C shared diff -- package-lock.json` prints nothing.

### Step 1: Add a regression test counting plugin lookups per data refresh

In `Panel.test.tsx` (follow the existing dashboards test harness under
`shared/dashboards/src/test`), render a `Panel` whose plugin exposes one header
action. Mock the plugin registry so `getPlugin` is a `jest.fn` returning a
plugin with an `actions` array. Simulate a data refresh (re-render with a new
`queryResults` identity via the `DataQueriesProvider`/context mock) and assert
that `getPlugin` is **not** called again for the same plugin kind, while the
action component still renders and still receives the updated `queryResults`.

**Verify**: before the production change, the "getPlugin not called again"
assertion fails (it is called on every `queryResults` change). Do not commit
this intermediate state.

### Step 2: Resolve the action components keyed on plugin kind

Replace the current effect so it only resolves the plugin's **action
descriptors** (the components + their `location`), keyed on the plugin kind and
`getPlugin`. Store the resolved header action descriptors in state:

```tsx
// action descriptors only — no panel props baked in
const [headerActionComponents, setHeaderActionComponents] = useState<Array<ComponentType<any>>>([]);

useEffect(() => {
  let cancelled = false;
  const panelPluginKind = definition.spec.plugin.kind;
  if (!panelPluginKind || !getPlugin || typeof getPlugin !== 'function') {
    setHeaderActionComponents([]);
    return;
  }
  (async (): Promise<void> => {
    try {
      const plugin = await getPlugin({ kind: 'Panel', name: panelPluginKind });
      if (cancelled) return;
      const actions = plugin && typeof plugin === 'object' && Array.isArray(plugin.actions) ? plugin.actions : [];
      setHeaderActionComponents(
        actions.filter((a) => !a.location || a.location === 'header').map((a) => a.component)
      );
    } catch (error) {
      if (!cancelled) {
        console.warn('Failed to load plugin actions:', error);
        setHeaderActionComponents([]);
      }
    }
  })();
  return () => { cancelled = true; };
}, [definition.spec.plugin.kind, getPlugin]);
```

Note the added `cancelled` guard to avoid setting state after unmount / kind
change races. Import `ComponentType` from `react` if you type the array.

**Verify**:
`npm --prefix shared run type-check -- --filter=@perses-dev/dashboards` →
exit 0.

### Step 3: Build the action elements in render with current props

Compute the `pluginActions` elements during render from the resolved
components and the current `panelPropsForActions`, preserving the existing
per-action try/catch and keying:

```tsx
const pluginActions = useMemo<ReactNode[]>(() => {
  return headerActionComponents
    .map((ActionComponent, index): ReactNode | null => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return <ActionComponent key={`plugin-action-${index}`} {...(panelPropsForActions as any)} />;
      } catch (error) {
        console.warn(`Failed to render plugin action ${index}:`, error);
        return null;
      }
    })
    .filter((item): item is ReactNode => Boolean(item));
}, [headerActionComponents, panelPropsForActions]);
```

Keep passing `pluginActions` to `PanelHeader`. This preserves the exact prior
behavior (actions receive current data) but no longer re-fetches the plugin on
each data refresh, and the extra `setState`-per-refresh is gone (the elements
are derived in render).

**Verify**:
`npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand Panel`
→ exit 0 and the Step 1 assertions pass.

### Step 4: Lint and full package tests

**Verify**:
`npm --prefix shared run lint --workspace=@perses-dev/dashboards` → exit 0
(exhaustive-deps clean); then
`npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand`
→ exit 0.

## Test plan

- Regression test: `getPlugin` is called once per plugin kind, not per
  `queryResults` change; the action still renders and receives the latest
  `queryResults`/`contentDimensions`.
- Behavioral: a panel whose plugin has no actions renders no action buttons; a
  plugin whose `getPlugin` rejects logs a warning and renders none (keep the
  existing defensive behavior). If the Panel suite already covers header action
  rendering, keep it green rather than duplicating.
- Verification:
  `npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand Panel`
  → all pass.

## Done criteria

Machine-checkable; ALL must hold (run from composite root):

- [ ] The plugin-loading `useEffect` dependency array is `[definition.spec.plugin.kind, getPlugin]` (no `panelPropsForActions`): `rg -n "panelPropsForActions" shared/dashboards/src/components/Panel/Panel.tsx` shows it only inside the render-time `useMemo`, not in the effect deps.
- [ ] The effect includes a cancellation guard (`cancelled`) for the async resolve.
- [ ] `pluginActions` is derived via `useMemo` in render from resolved components + current props.
- [ ] Dashboards typecheck, lint, and full tests exit 0.
- [ ] The regression test proves one `getPlugin` call per kind and correct data pass-through.
- [ ] `git -C shared diff --name-only 472a289..HEAD` lists only in-scope paths, and `git -C shared status --short` is empty after the logical commit.
- [ ] `plans/README.md` status row updated, unless the dispatcher maintains the index.

## STOP conditions

Stop and report back without improvising if:

- Live code has already refactored this effect (drift).
- The plugin `actions` API turns out to depend on panel data to decide *which*
  actions exist (not just to render them) — then keying on kind alone is wrong;
  report the actual contract before changing anything.
- `getPlugin`'s return type does not expose a stable `component`/`location`
  shape that can be resolved without the panel props.
- Any existing Panel test fails in a way that reflects a behavior change (an
  action no longer rendering, or no longer receiving data) rather than a
  call-count assertion.
- A verification command fails twice after a reasonable in-scope fix attempt.

## Maintenance notes

- Reviewer: verify header action buttons still appear and still act on the
  latest query data after a refresh; the change should be invisible to users
  except for fewer renders.
- If a future action needs to re-resolve when the plugin *spec* (not just kind)
  changes, add that to the effect deps deliberately — do not re-add
  `queryResults`.
- Related: plan 054 stabilizes the props `Panel` receives from the grid so its
  `memo` holds; this plan reduces `Panel`'s own internal churn. They are
  complementary.
