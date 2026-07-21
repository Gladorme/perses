# Plan 054: Restore Panel React.memo effectiveness (stabilize grid-item props)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite repository root)**:
> `git -C shared diff --stat 472a289..HEAD -- dashboards/src/components/GridLayout/GridItemContent.tsx dashboards/src/components/GridLayout/Row.tsx dashboards/src/components/Panel/Panel.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED
- **Depends on**: 027 (land first — see notes), complements 053
- **Category**: perf
- **Planned at**: `shared` repo commit `472a289`, 2026-07-20

## Why this matters

`Panel` is already `memo`-wrapped
(`export const Panel = memo(function Panel(props: PanelProps) { ... })`), a
clear signal that panels are meant to skip re-render when their props are
unchanged. That memo is currently defeated because the props reaching `Panel`
are **new object identities on every render** of its parents:

- `GridItemContent` builds `readHandlers` as a fresh object literal every
  render, and `editHandlers` as a fresh object when in edit mode.
- `Row` passes `panelGroupItemId={{ panelGroupId, panelGroupItemLayoutId: i, repeatVariable }}`
  — a fresh object per grid item on every render of the row.

So whenever a `Row`/`GridItemContent` re-renders for an unrelated reason (edit
mode toggle, a sibling panel change, layout change, a parent context update),
**every** `Panel` in that row re-renders even when its own definition and data
are unchanged. This plan stabilizes those props so the existing `memo` actually
holds. It is **completing the intent of an existing `memo`**, not adding new
memoization to unmemoized components.

**Important prior decision (do not ignore):** `plans/README.md` (and plan 027's
maintenance notes) deliberately **deferred** adding `React.memo` to
`Row`/`GridItemContent` and listed "blanket memo/useMemo/useCallback" changes
as considered-and-rejected "without evidence that a memoized child benefits."
The evidence here is specific: the child (`Panel`) is *already* memoized, and
these three inline props are what defeat it. This plan does **not** add
`React.memo` to `Row` or `GridItemContent`; it only stabilizes the props they
pass to the already-memoized `Panel`. It should land **after** plan 027 (which
stabilizes the variable contexts `Panel` also consumes) so that the memo can
actually pay off — before 027, `Panel` still re-renders via context regardless.

## Current state

Repo **`shared`**, package `@perses-dev/dashboards`.

**Panel.tsx** — `dashboards/src/components/Panel/Panel.tsx`:

```tsx
export const Panel = memo(function Panel(props: PanelProps) {
  const { definition, readHandlers, editHandlers, ..., panelGroupItemId, viewQueriesHandler, ...others } = props;
  ...
});
```

`memo` uses the default shallow prop comparison, so any prop whose identity
changes every render forces a re-render.

**GridItemContent.tsx** — `dashboards/src/components/GridLayout/GridItemContent.tsx`.
`viewQueriesHandler` is already memoized; `readHandlers`/`editHandlers` are not:

```tsx
// current
const readHandlers = {
  isPanelViewed: isPanelGroupItemIdEqual(viewPanelGroupItemId, panelGroupItemId),
  onViewPanelClick: function (): void {
    if (viewPanelGroupItemId === undefined) { viewPanel(panelGroupItemId); }
    else { viewPanel(undefined); }
  },
};

let editHandlers: PanelProps['editHandlers'] = undefined;
if (isEditMode) {
  editHandlers = {
    onEditPanelClick: openEditPanel,
    onDuplicatePanelClick: duplicatePanel,
    onDeletePanelClick: openDeletePanelDialog,
  };
}
...
<Panel
  definition={panelDefinition}
  readHandlers={readHandlers}
  editHandlers={editHandlers}
  viewQueriesHandler={viewQueriesHandler}
  panelOptions={props.panelOptions}
  panelGroupItemId={panelGroupItemId}
/>
```

`openEditPanel`, `duplicatePanel`, `openDeletePanelDialog`, `viewPanel` come
from `usePanelActions(panelGroupItemId)` — verify their identity stability at
that hook before assuming; if they are not stable, that is part of the fix
(see Step 3 STOP note). `panelGroupItemId` is the prop passed into
`GridItemContent` (already a stable-ish object from `Row`, addressed below).

**Row.tsx** — `dashboards/src/components/GridLayout/Row.tsx`. The item id object
is built inline in the map:

```tsx
{itemLayouts.map(({ i, w }) => (
  <div key={i} style={{ ... }}>
    <ErrorBoundary FallbackComponent={ErrorAlert}>
      <GridItemContent
        panelOptions={panelOptions}
        panelGroupItemId={{ panelGroupId, panelGroupItemLayoutId: i, repeatVariable }}   // new object per item per render
        width={calculateGridItemWidth(w, gridColWidth)}
      />
    </ErrorBoundary>
  </div>
))}
```

## Commands you will need

Use Node `v22.14.0` (`shared/.nvmrc`) and npm `10.9.2`; if those pinned
versions cannot be activated, STOP before installing or testing. Run from the
composite repository root.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix shared ci` | exit 0; lockfile unchanged |
| Focused test | `npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand GridLayout Panel Row GridItemContent` | exit 0; suites pass |
| Typecheck | `npm --prefix shared run type-check -- --filter=@perses-dev/dashboards` | exit 0 |
| Lint | `npm --prefix shared run lint --workspace=@perses-dev/dashboards` | exit 0, exhaustive-deps clean |
| Full package tests | `npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand` | exit 0 |

## Scope

**In scope** (the only implementation files you should modify):

- `shared/dashboards/src/components/GridLayout/GridItemContent.tsx`
- `shared/dashboards/src/components/GridLayout/Row.tsx`
- Colocated `*.test.tsx` for the above (add/extend)

`plans/README.md` is an administrative status-only exception after completion.

**Out of scope** (do NOT touch):

- `Panel.tsx` — do **not** change its `memo` (no custom comparator) or its
  internals (the plugin-action churn is plan 053).
- Do **not** add `React.memo` to `Row` or `GridItemContent` (explicitly
  deferred by the prior audit; this plan is only about prop identity).
- The variable-context stability (plan 027) — a dependency, not edited here.
- `usePanelActions`/`useEditMode`/`useViewPanelGroup` internals — read only; if
  a returned callback is unstable, report it (STOP) rather than refactoring the
  hook here.

## Git workflow

- Work in the nested `shared` repository on branch
  `advisor/054-restore-panel-memo-effectiveness`.
- Commit as one logical unit after verification, e.g.:
  `[ENHANCEMENT] dashboards: stabilize grid-item props for Panel memo`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 0: Reinstall the locked shared workspace

`npm --prefix shared ci`. **Verify**: exits 0 and
`git -C shared diff -- package-lock.json` prints nothing.

### Step 1: Confirm the dependency (plan 027) and callback stability

- Confirm plan 027 has landed (variable contexts memoized). If not, STOP and
  report: this plan's benefit is not observable until 027 lands, and landing it
  alone risks a "no measurable change" review.
- Inspect `usePanelActions` and confirm `openEditPanel`, `duplicatePanel`,
  `openDeletePanelDialog`, and `viewPanel` are referentially stable (e.g.
  `useCallback` inside the hook). Record the finding. If any are unstable, that
  instability must be handled at the hook (out of scope here) — STOP and report
  rather than wrapping around it.

**Verify**: documented confirmation of 027 status and callback stability.

### Step 2: Add a regression test proving Panel re-renders unnecessarily

In a colocated test, render a `Row` (or `GridItemContent`) with a mocked
`Panel` that counts renders (mock `../Panel` to a render-counter that still
receives props). Trigger a parent re-render that changes nothing a panel
depends on and assert the panel render count does not increase for unchanged
panels. Alternatively assert prop identity: capture `readHandlers`,
`editHandlers`, and `panelGroupItemId` passed to `Panel` across a re-render and
assert reference equality.

**Verify**: before the production change, the assertion fails. Do not commit
this intermediate state.

### Step 3: Memoize the handlers in `GridItemContent`

- Wrap `readHandlers` in `useMemo` keyed on
  `[viewPanelGroupItemId, panelGroupItemId, viewPanel]` (the values its fields
  read). Keep `isPanelGroupItemIdEqual(...)` and the `onViewPanelClick` body
  unchanged.
- Wrap `editHandlers` in `useMemo` keyed on
  `[isEditMode, openEditPanel, duplicatePanel, openDeletePanelDialog]`,
  returning `undefined` when `!isEditMode`.
- Import `useMemo` (already imported in this file).

Keep the `<Panel .../>` prop list identical otherwise.

**Verify**:
`npm --prefix shared run type-check -- --filter=@perses-dev/dashboards` →
exit 0.

### Step 4: Stabilize `panelGroupItemId` per item in `Row`

The map key is `i` and the object is derived from `panelGroupId`, `i`, and
`repeatVariable`. Precompute the item ids once per render in a `useMemo` so each
`GridItemContent` receives a stable object across renders where those inputs are
unchanged:

```tsx
const gridItems = useMemo(
  () => itemLayouts.map(({ i, w }) => ({
    key: i,
    panelGroupItemId: { panelGroupId, panelGroupItemLayoutId: i, repeatVariable },
    width: calculateGridItemWidth(w, gridColWidth),
  })),
  [itemLayouts, panelGroupId, repeatVariable, gridColWidth]
);
```

Then render from `gridItems`. Note `itemLayouts` is already a `useMemo` in this
file — good. `repeatVariable` is a tuple prop; if it is rebuilt upstream every
render, note it (its identity flows from `RepeatGridLayout`, which plan 027
touches) — the memo still helps for non-repeat rows.

**Verify**:
`npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand GridLayout Panel Row GridItemContent`
→ exit 0 and the Step 2 assertion now passes (for the non-repeat case at
minimum).

### Step 5: Lint and full package tests

**Verify**:
`npm --prefix shared run lint --workspace=@perses-dev/dashboards` → exit 0
(exhaustive-deps clean); then
`npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand`
→ exit 0.

## Test plan

- Regression test: unchanged panels do not re-render (or their `readHandlers`/
  `editHandlers`/`panelGroupItemId` props are reference-stable) across an
  unrelated parent re-render.
- Behavioral: view-panel toggle, edit/duplicate/delete actions, and normal grid
  rendering still work. Keep the existing GridLayout/Panel suites green.
- Verification:
  `npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand GridLayout Panel Row GridItemContent`
  → all pass.

## Done criteria

Machine-checkable; ALL must hold (run from composite root):

- [ ] `rg -n "const readHandlers = useMemo" shared/dashboards/src/components/GridLayout/GridItemContent.tsx` returns one match.
- [ ] `rg -n "editHandlers = useMemo|const editHandlers = useMemo" shared/dashboards/src/components/GridLayout/GridItemContent.tsx` shows `editHandlers` memoized.
- [ ] `rg -n "panelGroupItemId=\{\{ panelGroupId" shared/dashboards/src/components/GridLayout/Row.tsx` returns no matches (inline object replaced by a memoized value).
- [ ] No `React.memo` was added to `Row` or `GridItemContent`: `rg -n "memo\(" shared/dashboards/src/components/GridLayout/Row.tsx shared/dashboards/src/components/GridLayout/GridItemContent.tsx` returns no new matches.
- [ ] Dashboards typecheck, lint, and full tests exit 0.
- [ ] The regression test proves prop/render stability and preserves behavior.
- [ ] `git -C shared diff --name-only 472a289..HEAD` lists only in-scope paths, and `git -C shared status --short` is empty after the logical commit.
- [ ] `plans/README.md` status row updated, unless the dispatcher maintains the index.

## STOP conditions

Stop and report back without improvising if:

- Plan 027 has not landed (this plan depends on it for observable benefit).
- Any of `usePanelActions`' returned callbacks are not referentially stable —
  fixing that belongs in the hook, not here.
- Live code already memoizes these props (drift).
- A reliable render-count/identity seam cannot be built without changing a
  production export.
- Any existing GridLayout/Panel test fails in a way that reflects a behavior
  change rather than a pure identity/render-count assertion.
- A verification command fails twice after a reasonable in-scope fix attempt.

## Maintenance notes

- This plan is intentionally narrow: stabilize props to a component that is
  *already* `memo`-wrapped. It is **not** a mandate to memoize handlers broadly
  across the dashboard — the prior audit rejected that, and that decision
  stands everywhere except where an existing `memo` is being defeated.
- Reviewer: verify with the React DevTools profiler (or the render-count test)
  that unchanged panels stop re-rendering on an edit-mode toggle / sibling
  change *after* plan 027 has landed. If no measurable difference is observed,
  record that and consider marking the plan REJECTED rather than shipping churn.
- The repeat-row case (`repeatVariable` identity) is bounded by plan 027's
  `RepeatGridLayout` work; do not try to fully solve repeat-row stability here.
