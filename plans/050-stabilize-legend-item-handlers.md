# Plan 050: Restore ListLegendItem memo effectiveness (stabilize legend handlers + per-item sx)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite repository root)**:
> `git -C shared diff --stat 472a289..HEAD -- components/src/Legend/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: `shared` repo commit `472a289`, 2026-07-20

## Why this matters

`ListLegendItem` is deliberately `memo`-wrapped
(`export const ListLegendItem = memo(ListLegendItemBase)`), because a chart
legend can render up to `NEED_VIRTUALIZATION_LIMIT` (500) items and the list is
virtualized specifically to keep item render cost down. That memo is defeated
today by unstable props:

- `Legend` defines `onLegendItemClick` inline in the render body (not
  `useCallback`), so its identity changes every render.
- `Legend` builds `commonLegendProps` as a fresh object literal every render.
- `ListLegend`'s `itemContent` callback passes a **new inline `sx` object** to
  every `ListLegendItem`, plus the unstable `onClick`/`onMouseOver`/`onMouseOut`
  handlers.

When the legend's parent re-renders (e.g. `onItemMouseOver` toggling highlight
state on pointer move over the chart, or selection changes), every mounted
legend item re-renders — each resolving MUI `sx` styling — instead of only the
one or two items whose `isVisuallySelected` actually changed. Virtualization
bounds this to the viewport, but interaction (hover/selection) is exactly when
the parent re-renders most, so the memo should hold there. This completes the
intent of the existing `memo`; it does **not** add memoization to new
components.

## Current state

Repo **`shared`**, package `@perses-dev/components`.

**Legend.tsx** — `components/src/Legend/Legend.tsx`. The click handler is a
plain function in render:

```tsx
// Legend.tsx (current, abridged)
export function Legend({ width, height, options, data, selectedItems, onSelectedItemsChange, onItemMouseOver, onItemMouseOut, tableProps }: LegendProps): ReactElement {
  const onLegendItemClick = (e: React.MouseEvent<HTMLElement, MouseEvent>, seriesId: string): void => {
    ... produce(selectedItems, ...) ...
    onSelectedItemsChange(newSelected);
  };
  ...
  const commonLegendProps = {
    height, items: data, selectedItems, onLegendItemClick, onItemMouseOver, onItemMouseOut,
  };
  ...
  legendContent = <ListLegend {...commonLegendProps} width={width} onLegendItemClick={onLegendItemClick} />;
  // (also CompactLegend and TableLegend branches spread commonLegendProps)
}
```

Note: `Legend` itself is **not** memoized and does not need to be for this
plan — the target is the per-item props reaching the memoized
`ListLegendItem`. `useCallback`/`useMemo` are not yet imported in this file.

**ListLegend.tsx** — `components/src/Legend/ListLegend.tsx`. The Virtuoso
`itemContent` builds a fresh `sx` object per row:

```tsx
// ListLegend.tsx (current, abridged)
itemContent={(index, item) => {
  return (
    <ListLegendItem
      key={item.id}
      item={item}
      index={index}
      truncateLabel={truncateLabels}
      isVisuallySelected={isLegendItemVisuallySelected(item, selectedItems)}
      onClick={onLegendItemClick}
      onMouseOver={onItemMouseOver}
      onMouseOut={onItemMouseOut}
      sx={{ width: '100%', wordBreak: 'break-word', overflow: 'hidden' }}   // new object every render
    />
  );
}}
```

**ListLegendItem.tsx** — `components/src/Legend/ListLegendItem.tsx`. Already
`memo`-wrapped:

```tsx
export const ListLegendItem = memo(ListLegendItemBase);
```

Its `onClick`/`onMouseOver`/`onMouseOut` props are consumed via internal
closures (`handleClick` etc.) — the item does not require the handlers to be
stable to function, only to benefit from the memo.

**CompactLegend.tsx** — same folder, receives `commonLegendProps` +
`onLegendItemClick`; check whether it renders `ListLegendItem`s the same way
(it does for the compact list) and apply the same `sx` fix if it passes an
inline `sx`.

Exemplar for stable-callback style: any `useCallback` usage in
`components/src` with `exhaustive-deps` satisfied.

## Commands you will need

Use Node `v22.14.0` (`shared/.nvmrc`) and npm `10.9.2`; if those pinned
versions cannot be activated, STOP before installing or testing. Run from the
composite repository root.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix shared ci` | exit 0; lockfile unchanged |
| Focused test | `npm --prefix shared run test --workspace=@perses-dev/components -- Legend` | exit 0; Legend suites pass |
| Typecheck | `npm --prefix shared run type-check -- --filter=@perses-dev/components` | exit 0 |
| Lint | `npm --prefix shared run lint --workspace=@perses-dev/components` | exit 0, exhaustive-deps clean |
| Full package tests | `npm --prefix shared run test --workspace=@perses-dev/components` | exit 0 |

## Scope

**In scope** (the only implementation files you should modify):

- `shared/components/src/Legend/Legend.tsx`
- `shared/components/src/Legend/ListLegend.tsx`
- `shared/components/src/Legend/CompactLegend.tsx` (only if it passes an inline
  `sx`/handlers to `ListLegendItem`)
- Colocated `*.test.tsx` for the Legend components (add/extend)

`plans/README.md` is an administrative status-only exception after completion.

**Out of scope** (do NOT touch):

- `ListLegendItem.tsx` — it is already `memo`-wrapped; do not change its
  internals or props contract.
- `TableLegend.tsx` internals (its rows go through `@tanstack/react-table`, a
  different path).
- The tooltip throttle work (plan 028) and the `TimeSeriesChartPanel` legend
  memo split (plan 029) — related legend-interaction areas, but different
  files/concerns.
- The `produce`/selection semantics inside `onLegendItemClick`.

## Git workflow

- Work in the nested `shared` repository on branch
  `advisor/050-stabilize-legend-item-handlers`.
- Commit as one logical unit after verification, e.g.:
  `[ENHANCEMENT] components: stabilize legend item props for memo`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 0: Reinstall the locked shared workspace

`npm --prefix shared ci`. **Verify**: exits 0 and
`git -C shared diff -- package-lock.json` prints nothing.

### Step 1: Add a regression test proving item re-renders

In a colocated test, render a `ListLegend` (or `Legend` with `position: 'right'`
so it uses `ListLegend`) with a small set of items. Wrap the exported
`ListLegendItem` to count renders (spy via `jest.mock` on `./ListLegendItem`,
delegating to the real implementation, or use a render-counter through a mocked
child). Trigger a parent re-render that changes nothing an item depends on
(e.g. a no-op `onItemMouseOver` state toggle in a test harness) and assert the
item render count does **not** increase for items whose `isVisuallySelected`
is unchanged.

If a reliable render-count seam proves brittle, fall back to asserting prop
identity: capture the `sx` and `onClick` props passed to `ListLegendItem`
across a re-render and assert they are reference-equal.

**Verify**: before the production change, the assertion fails (items re-render
/ props differ). Do not commit this intermediate state.

### Step 2: Stabilize the click handler and common props in `Legend.tsx`

- Wrap `onLegendItemClick` in `useCallback` with deps
  `[selectedItems, onSelectedItemsChange]`.
- Wrap `commonLegendProps` in `useMemo` with deps
  `[height, data, selectedItems, onLegendItemClick, onItemMouseOver, onItemMouseOut]`.
- Import `useCallback`/`useMemo` from `react`.

Keep the three render branches (table/list/compact) as they are, just consuming
the memoized values. Note `onLegendItemClick` is passed both inside
`commonLegendProps` and again explicitly to `ListLegend`/`CompactLegend`; that
duplication is fine once the handler is stable.

**Verify**:
`npm --prefix shared run type-check -- --filter=@perses-dev/components` →
exit 0.

### Step 3: Hoist the per-item `sx` in `ListLegend.tsx` (and `CompactLegend` if applicable)

Move the static `sx` object to a module-level constant and pass that constant
to `ListLegendItem`:

```tsx
const LIST_LEGEND_ITEM_SX = { width: '100%', wordBreak: 'break-word', overflow: 'hidden' } as const;
```

The `sx` here is fully static (no theme callbacks, no per-item values), so a
module constant is correct. Apply the same treatment in `CompactLegend` only if
it passes an inline `sx` to `ListLegendItem`.

**Verify**:
`npm --prefix shared run test --workspace=@perses-dev/components -- Legend` →
exit 0 and the Step 1 assertion now passes.

### Step 4: Lint and full package tests

**Verify**:
`npm --prefix shared run lint --workspace=@perses-dev/components` → exit 0;
then `npm --prefix shared run test --workspace=@perses-dev/components` → exit 0.

## Test plan

- One regression test proving unchanged legend items do not re-render (or,
  fallback, that `sx`/`onClick` prop identities are stable) across a parent
  re-render.
- Preserve behavioral coverage: clicking an item still calls
  `onSelectedItemsChange` with the correct next state (single-select, modified
  click multi-select, and unselect-to-ALL). If the existing Legend suite
  already covers these, do not duplicate — just keep them green.
- Verification:
  `npm --prefix shared run test --workspace=@perses-dev/components -- Legend` →
  all pass.

## Done criteria

Machine-checkable; ALL must hold (run from composite root):

- [ ] `rg -n "const onLegendItemClick = useCallback" shared/components/src/Legend/Legend.tsx` returns one match.
- [ ] `rg -n "const commonLegendProps = useMemo" shared/components/src/Legend/Legend.tsx` returns one match.
- [ ] `rg -n "sx=\{\{ width: '100%'" shared/components/src/Legend/ListLegend.tsx` returns no matches (inline sx replaced by the module constant).
- [ ] Components typecheck, lint, and full tests exit 0.
- [ ] The regression test proves item render/prop stability and preserves click behavior.
- [ ] `git -C shared diff --name-only 472a289..HEAD` lists only in-scope paths, and `git -C shared status --short` is empty after the logical commit.
- [ ] `plans/README.md` status row updated, unless the dispatcher maintains the index.

## STOP conditions

Stop and report back without improvising if:

- Live code already memoizes these handlers/props (drift).
- The per-item `sx` turns out to depend on per-item or theme-callback values
  (then it cannot be a plain module constant — report what it depends on).
- A reliable render-count/identity seam cannot be built without changing a
  production export.
- Any existing Legend test fails in a way that is not a pure identity/render-
  count assertion.

## Maintenance notes

- Reviewer: confirm this is identity-only; legend appearance and click/hover
  behavior must be unchanged.
- If future work adds per-item styling, pass it via a stable prop or a
  memoized value keyed on the item, not a new inline literal in `itemContent`.
- Deferred and out of scope here: `TableLegend` row memoization — its rows go
  through react-table; profile before touching.
