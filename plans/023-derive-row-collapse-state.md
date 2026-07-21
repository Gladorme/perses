# Plan 023: Derive grid-row collapse state from the panel-group store

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite workspace root)**:
> `git -C shared diff --stat f8cd4b7..HEAD -- dashboards/src/components/GridLayout/Row.tsx dashboards/src/components/GridLayout/GridTitle.tsx dashboards/src/context/DashboardProvider/panel-group-slice.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: shared commit `f8cd4b7`, 2026-07-21

## Why this matters

Each grid row duplicates the store's `isCollapsed` fact into local `isOpen`
state, seeded once on mount. The two copies then diverge:

- If the store's collapse state changes while the row stays mounted — panel
  group edited via the panel-group dialog, dashboard JSON applied via
  `setDashboard` (Edit JSON dialog), discard-changes restore — the row keeps
  its stale local state and renders the wrong open/closed state.
- The user's expand/collapse toggle only writes local state, never the store,
  so the row's actual state is invisible to everything else (e.g. saving a
  dashboard in edit mode persists the *original* collapse state, not what the
  user sees). The file even carries `// TODO: handle it without useEffect`.

Deriving open-state from the store removes the duplicated fact.

## Current state

- `shared/dashboards/src/components/GridLayout/Row.tsx` — local state at line
  60, view-panel force-open effect at 72–77, toggle wiring at 111–116:

```ts
  const [isOpen, setIsOpen] = useState(!groupDefinition.isCollapsed);
  ...
  // TODO: handle it without useEffect
  useEffect(() => {
    if (hasViewPanel) {
      setIsOpen(true);
    }
  }, [hasViewPanel]);
  ...
          collapse={
            groupDefinition.isCollapsed === undefined
              ? undefined
              : { isOpen: isOpen, onToggleOpen: () => setIsOpen((current) => !current) }
          }
```

  and `<Collapse in={isOpen} ...>` at line 118.

- `groupDefinition` is a `PanelGroupDefinition` prop coming from the
  dashboard store; `isCollapsed` is defined in
  `shared/dashboards/src/context/DashboardProvider/panel-group-slice.ts`
  (`isCollapsed: layout.spec.display?.collapse?.open === false` at line 113;
  new groups default `isCollapsed: false` at line 134). The slice exposes
  panel-group update actions (read the file to find the exact updater used by
  the panel-group editor at `panel-group-editor-slice.ts:103-115`, which
  writes `group.isCollapsed = next.isCollapsed;`).
- `useDashboard.tsx:123-129` serializes `isCollapsed` back into dashboard JSON
  (`open: !isCollapsed`) — meaning the store value is what gets SAVED.
- `shared/dashboards/src/components/GridLayout/GridTitle.tsx` renders the
  toggle button (receives `collapse.{isOpen,onToggleOpen}` — check its props).
- Store access pattern: `useDashboardStore(selector)` from
  `context/DashboardProvider/DashboardProvider.tsx:70-76` (shallow equality)
  — but prefer the existing slice action hooks if `panel-group-slice.ts`
  exports one (grep for `useUpdatePanelGroup` / similar exported hooks in
  `dashboard-provider-api.ts`).

## Target design

Single source of truth in the store:

1. Row renders `open = !groupDefinition.isCollapsed || hasViewPanel` —
   computed, no `useState`, no `useEffect`.
2. `onToggleOpen` dispatches a store action that flips the group's
   `isCollapsed`. If `dashboard-provider-api.ts` /`panel-group-slice.ts`
   already exposes an action that can update a single group's `isCollapsed`,
   use it; otherwise add a minimal `setPanelGroupCollapsed(panelGroupId,
   isCollapsed)` action to `panel-group-slice.ts` following the slice's
   existing action style (immer `set`, devtools action name string).

Behavioral consequence (intended): expanding/collapsing a row in edit mode is
now part of dashboard state and will be persisted on save, and JSON edits to
`display.collapse.open` immediately reflect in the UI.

## Commands you will need

Node `v22.14.0` / npm `10.9.2` pinned; STOP if not activatable. Windows:
`npm.cmd`.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix shared ci` | exit 0; lockfile unchanged |
| Focused tests | `npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand GridLayout` | exit 0 |
| Panel-group slice tests | `npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand panelGroup` | exit 0 |
| Typecheck | `npm --prefix shared run type-check -- --filter=@perses-dev/dashboards` | exit 0 |
| Lint | `npm --prefix shared run lint --workspace=@perses-dev/dashboards` | exit 0 |
| Full package tests | `npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand` | exit 0 |

## Scope

**In scope**:

- `shared/dashboards/src/components/GridLayout/Row.tsx`
- `shared/dashboards/src/context/DashboardProvider/panel-group-slice.ts`
  (only if a new action is required)
- `shared/dashboards/src/context/DashboardProvider/dashboard-provider-api.ts`
  (only to export the new action hook, if required)
- Colocated test files for the above (extend or create)

**Out of scope** (do NOT touch):

- `GridTitle.tsx` — its `collapse` prop contract stays as is.
- `view-panel-slice.ts` and the view-panel force-open semantics (keep the
  `hasViewPanel` OR-condition in the derived value).
- `useDashboard.tsx` serialization.

## Git workflow

- Nested `shared` repository, branch `advisor/023-derive-row-collapse-state`.
- One commit, e.g. `[BUGFIX] dashboards: derive grid-row collapse state from store`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Locate or add the store action

Read `panel-group-slice.ts` and `dashboard-provider-api.ts`. If no existing
action can set a single group's `isCollapsed`, add
`setPanelGroupCollapsed(panelGroupId: number, isCollapsed: boolean)` to the
slice, matching the file's existing action pattern (immer mutation +
`'[Dashboard] setPanelGroupCollapsed'`-style devtools label), and export a
hook for it alongside the other panel-group hooks.

Add a slice unit test (follow the existing panel-group slice tests — grep
`panelGroup` under `shared/dashboards/src`): action flips only the targeted
group's flag.

**Verify**: panel-group slice tests pass.

### Step 2: Derive in Row

In `Row.tsx`: remove `const [isOpen, setIsOpen] = useState(...)` and the
`hasViewPanel` effect; compute
`const isOpen = !groupDefinition.isCollapsed || hasViewPanel;`
and wire `onToggleOpen` to the store action with the row's `panelGroupId`.
Keep the `groupDefinition.isCollapsed === undefined ? undefined : {...}`
guard (rows without a collapse config get no toggle — but note
`!undefined || ...` still computes `isOpen === true`, preserving today's
always-open behavior for those rows).

**Verify**: focused GridLayout tests pass.

### Step 3: Behavior test

Add/extend a GridLayout test: render a dashboard with a collapsed group,
toggle the row title, assert the store's `isCollapsed` flipped (read via the
test provider spy — `shared/dashboards/src/test/dashboard-provider.tsx` has
`createDashboardProviderSpy`), and assert an external store update
(`setDashboard` with flipped collapse) re-renders the row accordingly.

**Verify**: full dashboards suite, typecheck, lint all exit 0.

## Test plan

- Slice test: `setPanelGroupCollapsed` flips only the target group.
- Component test: toggle writes store; external store change reflects in row.
- Pattern: existing GridLayout tests and
  `shared/dashboards/src/test/dashboard-provider.tsx:28-49` spy helper.

## Done criteria

- [ ] `rg -n "useState\(!groupDefinition.isCollapsed\)" shared/dashboards/src/components/GridLayout/Row.tsx` → no matches.
- [ ] `rg -n "TODO: handle it without useEffect" shared/dashboards/src/components/GridLayout/Row.tsx` → no matches.
- [ ] Focused, slice, and full dashboards tests pass; typecheck and lint exit 0.
- [ ] `git -C shared diff --name-only f8cd4b7..HEAD` lists only in-scope paths.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- Rows are used outside a `DashboardProvider` (a store-less rendering path
  exists) — the derived design requires the store; report instead of adding a
  fallback local state.
- Collapse-on-save persistence is explicitly unwanted (a test asserts saves
  ignore runtime collapse changes) — report; product decision needed.
- The view-panel interaction (auto-open when a panel in the group is viewed)
  regresses in tests after the derivation — report if the OR-condition is
  insufficient.

## Maintenance notes

- Collapse toggles now mark the dashboard "modified" in edit mode — reviewers
  should confirm this is acceptable UX for view mode too (in view mode the
  store change is transient and discarded, same as time-range changes).
- Deferred: virtualizing collapsed rows (perf) — unrelated to this fix.
