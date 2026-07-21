# Plan 011: Optimize the time-chart tooltip pointer path

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md`, unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**: `git -C shared diff --stat f8cd4b7..HEAD -- components/src/TimeSeriesTooltip/tooltip-model.ts components/src/TimeSeriesTooltip/tooltip-model.test.ts components/src/TimeSeriesTooltip/TimeChartTooltip.tsx components/src/TimeSeriesTooltip/nearby-series.ts components/src/TimeSeriesTooltip/nearby-series.test.ts components/src/utils/chart-actions.ts components/src/utils/chart-actions.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `f8cd4b7`, 2026-07-21

## Why this matters

Each tooltip installs a global `window.mousemove` listener and performs a React
state update for every pointer event, including events over unrelated charts and
the rest of the page. For an active chart, the nearby-series calculation then
scans every datapoint in every series even though only one selected timestamp
can match. Restricting events to the owning chart, coalescing updates to one per
animation frame, and binary-searching each sorted series reduces the hot path
from event-rate global work plus `O(series * points)` scanning to one
chart-local render and `O(series * log points)` candidate lookup per frame.

## Current state

- `components/src/TimeSeriesTooltip/tooltip-model.ts` owns
  `useMousePosition`; it currently listens on `window` and calls `setCoords`
  synchronously for every mousemove.
- `components/src/TimeSeriesTooltip/TimeChartTooltip.tsx` calls the hook without
  identifying its chart, then runs tooltip positioning and nearby-series work on
  every hook update.
- `components/src/utils/chart-actions.ts` contains the existing linear
  `getClosestTimestamp` helper and its Jest coverage.
- `components/src/TimeSeriesTooltip/nearby-series.ts` finds the closest timestamp
  from the first modern-path series, then nests a full datapoint loop inside the
  series loop.
- `components/src/TimeSeriesTooltip/nearby-series.test.ts` covers legacy output
  and y-buffer helpers but does not cover the modern sorted-series path.
- `components/src/TimeSeriesTooltip/tooltip-model.test.ts` does not exist; create
  it for the chart-local/frame-coalescing hook contract.

Current global listener (`components/src/TimeSeriesTooltip/tooltip-model.ts:91-127`):

```ts
export const useMousePosition = (): CursorData['coords'] => {
  const [coords, setCoords] = useState<CursorData['coords']>(null);

  useEffect(() => {
    const setFromEvent = (e: ZRRawMouseEvent): void => {
      return setCoords({
        page: { x: e.pageX, y: e.pageY },
        client: { x: e.clientX, y: e.clientY },
        plotCanvas: { x: e.zrX ?? e.offsetX, y: e.zrY ?? e.offsetY },
        target: e.target,
      });
    };
    window.addEventListener('mousemove', setFromEvent);
    return (): void => {
      window.removeEventListener('mousemove', setFromEvent);
    };
  }, []);

  return coords;
};
```

Current tooltip call site (`components/src/TimeSeriesTooltip/TimeChartTooltip.tsx:58-89`):

```tsx
const [showAllSeries, setShowAllSeries] = useState(false);
const transform = useRef<string | undefined>();

const mousePos = useMousePosition();
// ...
const nearbySeries = getNearbySeriesData({
  mousePos,
  data,
  seriesMapping,
  pinnedPos,
  chart,
  format,
  seriesFormatMap,
  showAllSeries,
});
```

Current modern-series scan (`components/src/TimeSeriesTooltip/nearby-series.ts:54-96`):

```ts
const firstTimeSeriesValues = data[0]?.values;
const closestTimestamp = getClosestTimestamp(firstTimeSeriesValues, cursorX);

// ...
for (let seriesIdx = 0; seriesIdx < totalSeries; seriesIdx++) {
  // ...
  const currentDatasetValues: TimeSeriesValueTuple[] = currentDataset.values;
  // ...
  for (let datumIdx = 0; datumIdx < currentDatasetValues.length; datumIdx++) {
    const nearbyTimeSeries = currentDatasetValues[datumIdx];
    // ...
    if (closestTimestamp === xValue) {
      // evaluate this series at the selected timestamp
    }
  }
}
```

Current nearest-timestamp helper (`components/src/utils/chart-actions.ts:164-180`):

```ts
export function getClosestTimestamp(timeSeriesValues?: TimeSeriesValueTuple[], cursorX?: number): number | null {
  if (timeSeriesValues === undefined || cursorX === undefined) {
    return null;
  }
  let currentClosestTimestamp: number | null = null;
  let currentClosestDistance = Infinity;
  for (const [timestamp] of timeSeriesValues) {
    const distance = Math.abs(timestamp - cursorX);
    if (distance < currentClosestDistance) {
      currentClosestTimestamp = timestamp;
      currentClosestDistance = distance;
    }
  }
  return currentClosestTimestamp;
}
```

Repository conventions and constraints to preserve:

- The chart instance is held in the stable mutable `chartRef` prop. The EChart
  sibling initializes that ref in a layout effect before passive effects run;
  the hook should accept the ref object and read `.current` inside its effect.
- ZRender coordinates take precedence, with `offsetX`/`offsetY` retained as the
  Edge/browser fallback. Preserve page, client, plot-canvas, and event target
  fields exactly.
- Modern-path timestamp arrays are ascending, but they are not guaranteed to
  be index-aligned. In particular, threshold series are generated at a fixed
  15-second interval in
  `plugins/timeserieschart/src/TimeSeriesChartPanel.tsx:343-355`, so a matching
  timestamp can occur at a different index from the first data series. Search
  each series independently and require exact timestamp equality.
- Pinned tooltips replace live coordinates with `pinnedPos` in
  `getNearbySeriesData:384-388`; do not move or weaken that behavior.
- The current window listener receives later non-chart moves and thereby hides
  an unpinned tooltip after the pointer exits. A chart-local listener loses that
  incidental invalidation, so this plan must replace it explicitly without
  nulling the live coordinate object that pinned rendering still gates on.
- Multi-axis mode compares candidates in pixel space and falls back to data
  space. Preserve both branches and all highlight/downplay/select actions.
- Hook tests use Testing Library's `renderHook`/`act`; utility tests use Jest
  table-style cases. Retain Apache headers.

## Commands you will need

Use Node `v22.14.0` from `shared/.nvmrc` and npm `10.9.2` from
`shared/package.json`; if those pinned versions cannot be activated, STOP
before installing or testing. On Windows PowerShell, use `npm.cmd` when
`npm.ps1` is policy-blocked.

Run these from the application checkout root that contains `shared/`.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix shared ci` | exit 0; lockfile is unchanged |
| Tooltip/model tests | `npm --prefix shared test --workspace @perses-dev/components -- --runInBand src/TimeSeriesTooltip/tooltip-model.test.ts src/TimeSeriesTooltip/TimeChartTooltip.test.tsx src/TimeSeriesTooltip/nearby-series.test.ts src/utils/chart-actions.test.ts` | all selected tests pass |
| Typecheck | `npm --prefix shared run type-check -- --filter=@perses-dev/components` | exit 0 after Turbo runs upstream builds, with no TypeScript errors |
| Lint | `npm --prefix shared run lint --workspace @perses-dev/components` | exit 0, no ESLint errors |
| Build | `npm --prefix shared run build -- --filter=@perses-dev/components` | Turbo builds the components package and upstream dependencies successfully |

## Suggested executor toolkit

- Use `vercel-react-best-practices` if available when changing the hook. Keep
  high-frequency external events chart-local, coalesce them before setting React
  state, and clean up both listeners and scheduled frames.

## Scope

**In scope** (the only source/test files you should modify):

- `shared/components/src/TimeSeriesTooltip/tooltip-model.ts`
- `shared/components/src/TimeSeriesTooltip/tooltip-model.test.ts` (create)
- `shared/components/src/TimeSeriesTooltip/TimeChartTooltip.tsx`
- `shared/components/src/TimeSeriesTooltip/TimeChartTooltip.test.tsx` (create)
- `shared/components/src/TimeSeriesTooltip/nearby-series.ts`
- `shared/components/src/TimeSeriesTooltip/nearby-series.test.ts`
- `shared/components/src/utils/chart-actions.ts`
- `shared/components/src/utils/chart-actions.test.ts`

The required status-only edit to `plans/README.md` is also allowed at the end.

**Out of scope** (do not touch):

- The deprecated `legacyCheckforNearbySeries` algorithm and legacy data shape.
- Tooltip visuals, portal placement, pin/unpin UX, crosshair behavior, series
  formatting, multi-axis semantics, y-buffer policy, or ECharts action payloads.
- Time-series normalization, common-time-scale generation, plugin code, public
  chart props, dependencies, Web Workers, and rate-limiting beyond one animation
  frame.

## Git workflow

- Work in the `shared` repository on branch
  `advisor/011-optimize-time-chart-tooltip-pointer-path`.
- Prefer two logical commits if intermediate tests stay green: timestamp lookup,
  then chart-local pointer scheduling. Match the observed style, for example:
  `[ENHANCEMENT] tooltip: optimize pointer processing`.
- Do not push or open a pull request unless the operator explicitly asks.

## Steps

### Step 0: Reinstall locked shared dependencies and prove tooltip utilities

Run `npm --prefix shared ci`, confirm
`git -C shared diff -- package-lock.json` prints nothing, and run the existing
nearby-series/chart-actions tests before editing. Do not rely on the incomplete
`node_modules` observed during planning.

**Verify**: the install and
`npm --prefix shared test --workspace @perses-dev/components -- --runInBand src/TimeSeriesTooltip/nearby-series.test.ts src/utils/chart-actions.test.ts`
both exit 0 before source changes. Otherwise STOP and report the baseline.

### Step 1: Add a sorted-path nearest-index helper without changing public scan semantics

In `chart-actions.ts`, add
`getClosestTimestampIndex(timeSeriesValues?, cursorX?): number | null`. Use binary
search over ascending timestamps. Return `null` for undefined inputs or an empty
array, return the exact index on an exact hit, clamp before/after-range cursors to
the first/last index, and compare the two neighboring timestamps after the
search. On an exact distance tie, choose the lower index to preserve the current
linear scan's first-match behavior.

Do **not** refactor the existing exported `getClosestTimestamp` to delegate to
the sorted helper. Its public linear scan is order-independent, and
`getClosestTimestampInFullDataset` relies on that behavior. The new helper is
for the normalized, ascending modern-tooltip path only.

Extend `chart-actions.test.ts` with exact-hit, before-first, after-last,
between-points, equal-distance tie, empty, and undefined cases. Keep the existing
tests as regression coverage. Add one deliberately unsorted fixture for
`getClosestTimestamp` and `getClosestTimestampInFullDataset` so their existing
order-independent public contract cannot be narrowed accidentally.

**Verify**: `npm --prefix shared test --workspace @perses-dev/components -- --runInBand src/utils/chart-actions.test.ts` -> all old and new nearest-timestamp cases pass.

### Step 2: Binary-search the selected timestamp independently in every series

In `checkforNearbyTimeSeries`, use `getClosestTimestampIndex` once on
`data[0]?.values` to select the cursor-nearest timestamp. If the index or tuple
is absent, return `EMPTY_TOOLTIP_DATA` as today.

For each series, call `getClosestTimestampIndex(currentDatasetValues,
closestTimestamp)` independently, read that series-local candidate index, and
require exact timestamp equality. Skip a series when the closest tuple is
absent or has a neighboring rather than exact timestamp. Use the series-local
index for the returned `datumIdx` and every ECharts `dataIndex` action payload.
Do not assume the index selected in the first series applies to any sibling,
and do not loop through every datapoint.

In the multi-axis branch, call `chart.convertToPixel` at most once for the
selected candidate and reuse the resulting pixel distance for both `isNearby`
and `isClosestToCursor`. Preserve the existing data-space fallback if conversion
does not produce a usable y coordinate. Leave the legacy nested loop untouched.

Expand `nearby-series.test.ts` with modern-path tests using a minimal mocked
ECharts instance and sorted but deliberately index-unaligned
`TimeSeries[]`/`TimeChartSeriesMapping` fixtures:

- cursor between timestamps selects the expected timestamp in every series;
- null y values remain excluded;
- a threshold-like series sampled at a different interval still contributes
  when the exact selected timestamp exists at a different array index;
- a series genuinely missing the selected timestamp is skipped;
- multi-axis conversion retains the same nearby/closest result and does not call
  `convertToPixel` twice for one candidate; and
- expected highlight/downplay/select dispatches still occur.

**Verify**: `npm --prefix shared test --workspace @perses-dev/components -- --runInBand src/TimeSeriesTooltip/nearby-series.test.ts src/utils/chart-actions.test.ts` -> all modern, legacy, and helper cases pass.

### Step 3: Make pointer updates chart-local and frame-coalesced

Change `useMousePosition` to accept the stable chart ref object used by
`TimeChartTooltip`. Inside the effect, read `chartRef.current`, obtain its root
DOM element with `chart.getDom()`, and attach the native `mousemove` listener to
that element rather than `window`. Mouse events from the chart's canvas bubble to
this element and retain the canvas as `target`.

On each `mousemove`, synchronously copy the coordinate values and target into a plain
`CursorCoordinates` object, store it as the latest pending value, and schedule a
single `requestAnimationFrame` if one is not already pending. The frame callback
publishes the latest coordinates with `setCoords`. Subsequent events in the same
frame replace the pending value but do not schedule another callback.

Also attach a native `mouseleave` listener to the chart root. It must enqueue a
leave sentinel whose target is the chart root (or another explicit non-canvas
target), replacing any pending move in the same frame. Do not publish `null` or
a null target: `TimeChartTooltip` currently checks live mouse state before
`getNearbySeriesData` substitutes `pinnedPos`, so null invalidation would hide a
pinned tooltip too. With a non-canvas target, the existing unpinned target guard
hides the tooltip, while a pinned tooltip can continue through to the pinned
coordinate override. This also makes unpinning outside the chart remain hidden.

Cleanup must remove both listeners, cancel a pending frame, clear pending refs,
and prevent a state update after unmount. Do not retain a native event object
for later reading. Keep `zrX`/`zrY` precedence and `offsetX`/`offsetY` fallback.

Update `TimeChartTooltip.tsx` to pass `chartRef` to the hook. Do not add event
props to `EChart` or to plugin components.

Create `tooltip-model.test.ts` using a fake chart root and a mutable chart ref.
Mock `requestAnimationFrame`/`cancelAnimationFrame`, dispatch native mousemoves,
and use `act` to flush callbacks. Assert:

- an event outside the chart root produces no state update;
- multiple chart events before a frame produce one update with the last event's
  coordinates and target;
- a chart `mouseleave` publishes the non-canvas/root sentinel, and a leave that
  follows a pending move wins that frame;
- ZRender coordinates win when supplied and offset coordinates remain the
  fallback; and
- unmount removes both listeners and cancels a pending frame.

Create `TimeChartTooltip.test.tsx` with narrow mocks for the mouse-position hook,
nearby-series calculation, resize observer, and tooltip children. Using the
same leave sentinel returned by the hook tests, assert that an unpinned tooltip
renders nothing and does not run nearby-series work after exit, while a tooltip
with `pinnedPos` remains rendered from the pinned coordinates. Then rerender the
pinned case as unpinned without another mouse event and assert it hides. These
are semantic tests; do not rely on browser timing.

**Verify**: `npm --prefix shared test --workspace @perses-dev/components -- --runInBand src/TimeSeriesTooltip/tooltip-model.test.ts` -> all chart-local, coalescing, coordinate, and cleanup assertions pass.

### Step 4: Run component validation

Run the combined focused tests, typecheck, lint, and build. Fix only problems
caused by the eight in-scope files.

**Verify**: `npm --prefix shared run build -- --filter=@perses-dev/components` -> the component workspace and upstream dependencies build successfully and exit 0.

## Test plan

- `chart-actions.test.ts`: binary-search boundaries, exact hit, nearest neighbor,
  deterministic tie, empty input, and existing public-helper behavior.
- `nearby-series.test.ts`: per-series binary lookup with an index-unaligned
  threshold fixture, exact-timestamp absence, null exclusion, multi-axis pixel
  behavior, bounded `convertToPixel` calls, and unchanged ECharts actions.
  Retain all legacy tests.
- `tooltip-model.test.ts`: chart scoping, latest-event-per-frame coalescing,
  mouseleave invalidation, coordinate precedence/fallback, and cleanup after
  unmount.
- `TimeChartTooltip.test.tsx`: unpinned leave hiding, pinned leave persistence,
  and hide-on-unpin while still outside the chart.
- Run the four focused suites together before typecheck/lint/build. Do not use
  wall-clock performance assertions.

## Done criteria

- [ ] All four focused Jest suites pass, including the new hook, leave/pinning,
  and modern nearby-series cases.
- [ ] The pinned toolchain, clean install, and pre-edit tooltip utility baseline pass.
- [ ] Components typecheck, lint, and build commands exit 0.
- [ ] `rg -n "window\.(addEventListener|removeEventListener)\('mousemove'" shared/components/src/TimeSeriesTooltip/tooltip-model.ts` returns no matches.
- [ ] `rg -n "getClosestTimestampIndex" shared/components/src/TimeSeriesTooltip/nearby-series.ts shared/components/src/utils/chart-actions.ts` reports the initial lookup plus a series-local lookup; no `currentDatasetValues[closestDatumIdx]` first-series index reuse remains.
- [ ] The modern nearby-series path contains no loop over every datum; the only remaining `for (let datumIdx...)` belongs to `legacyCheckforNearbySeries`.
- [ ] Pinning, target matching, null filtering, multi-axis fallback, formatting, and ECharts action tests remain green.
- [ ] Mouseleave replaces any pending move with a non-canvas target; unpinned
  tooltips hide after exit, pinned tooltips remain visible, and unpinning while
  outside hides without needing another pointer event.
- [ ] The threshold-like regression proves an exact timestamp at a different sibling-series index uses that sibling index for tooltip data and ECharts actions; the missing-timestamp regression is skipped safely.
- [ ] The public linear closest-timestamp helpers retain an unsorted-input regression.
- [ ] `git -C shared diff --name-only f8cd4b7..HEAD` lists exactly the eight in-scope shared files, and `git -C shared status --short` is empty after the plan's logical commits.
- [ ] The status row in `plans/README.md` is updated, unless the dispatcher owns the index.

## STOP conditions

Stop and report back; do not improvise if:

- Time-series timestamps reaching the modern path are not guaranteed to be
  ascending. Sibling series being intentionally unaligned by index is expected
  and must be handled by the per-series search above.
- The chart ref is still undefined when the hook's passive effect runs in an
  actual consumer, so chart-local listener attachment would require changing
  EChart/plugin lifecycle APIs.
- Canvas mousemove events do not bubble to `chart.getDom()` or lose required
  page/client/offset/target values in a supported browser.
- Correctness requires moving pinning state, changing ECharts action semantics,
  or touching the deprecated legacy algorithm.
- A verification fails twice after a reasonable in-scope correction, or the fix
  requires a file outside Scope.

## Maintenance notes

- The nearest-index helper assumes ascending timestamps. If irregular ordering
  becomes supported, enforce sorting at normalization time rather than silently
  falling back to a linear scan in this pointer path.
- Reviewers should verify that the hook stores copied coordinate data, not the
  native event object, and that cleanup cancels the scheduled frame.
- One render per animation frame is the intentional ceiling. Additional
  throttling can make the tooltip feel laggy and is deferred unless profiling on
  target hardware demonstrates a need.
- The per-series lookup deliberately validates exact timestamp equality. This
  preserves threshold and other differently sampled series while keeping the
  normal path `O(series * log points)`.
