# Plan 029: Split TimeSeriesChartPanel's monolithic memo so legend clicks don't re-transform all series

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: in `plugins\`, run
> `git diff --stat d7075da..HEAD -- timeserieschart/src/TimeSeriesChartPanel.tsx`
> If the file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it
> as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/026-memoize-usedataqueries.md
- **Category**: perf
- **Planned at**: `plugins` repo commit `d7075da`, 2026-07-20

## Why this matters

`TimeSeriesChartPanel` builds everything — chart data, series mapping, legend
items, per-format max values — in one big `useMemo` whose dependency list
includes `selectedLegendItems` (pure UI state). Clicking a legend item
re-runs the entire O(series × points) transformation for the panel, including
`getCalculations` over every series' values and color computation. On dense
panels (hundreds of series) legend interaction feels sluggish. Splitting the
memo so the expensive per-series extraction is computed once per data change,
with legend-selection filtering applied in a cheap downstream memo, makes
legend toggles O(series) instead of O(series × points).

## Current state

Repo **`plugins`**, package `@perses-dev/timeseries-chart-plugin`.

- `plugins\timeserieschart\src\TimeSeriesChartPanel.tsx` — the panel
  component. Key structure (read the whole file before editing):
  - `:154` — `const [selectedLegendItems, setSelectedLegendItems] = useState<SelectedLegendItemState>('ALL');`
  - `:167-174` — one `useMemo` returning `{ timeScale, timeChartData, timeSeriesMapping, legendItems, seriesFormatMap, maxValuesByFormat }`.
  - Inside the memo, per series (`:215-319`):
    - `getSeriesColor(...)` (`:225`), `seriesId = chartId + timeSeries.name + seriesIndex` (`:238`),
    - `legendCalculations = getCalculations(timeSeries.values, ...)` (`:240-242`) — expensive, O(points),
    - selection filtering (`:246-248`):
      ```ts
      const isSelectAll = selectedLegendItems === 'ALL';
      const isSelected = !isSelectAll && !!selectedLegendItems[seriesId];
      const showTimeSeries = isSelected || isSelectAll;
      ```
    - `if (showTimeSeries) { ... }` (`:250-306`) pushes into `timeSeriesMapping`
      (via `getTimeSeries(seriesId, datasetIndex, ...)`, where
      `datasetIndex = timeChartData.length` — **the dataset index depends on
      which series are selected**, `:254`), computes `seriesFormatMap`,
      `maxValuesByFormat` (`:276-288`), applies `negativeY` negation to values
      (`:294-300`), and pushes `{ name, values }` into `timeChartData` (`:302-305`).
    - Unconditionally pushes legend items (`:308-315`).
  - After the loop (`:323+`): thresholds are appended to
    `timeSeriesMapping`/`timeChartData` as extra synthetic series when
    `timeChartData.length > 0`.
  - The memo's dep array (around `:340-350`, after the closing brace —
    read it in the file) includes `selectedLegendItems` among data deps like
    `queryResults`, `querySettingsList`, `legend?.values`, `visual`, etc.
- Existing test: `plugins\timeserieschart\src\TimeSeriesChartPanel.test.tsx`.
- The panel gets `queryResults` from `useDataQueries('TimeSeriesQuery')`
  (`@perses-dev/plugin-system`). plan 026 makes that identity stable — this
  plan's split is only effective after 001 lands.

## Commands you will need

Run from `C:\Users\Guillaume\Documents\Projets\perses\app\plugins\timeserieschart`.

| Purpose   | Command                                | Expected |
|-----------|----------------------------------------|----------|
| Install   | `npm install` (from `plugins\` root, only if needed) | exit 0 |
| Typecheck | `npm run type-check`                   | exit 0   |
| Tests     | `npm run test`                         | all pass |
| Lint      | `npm run lint`                         | exit 0   |

## Suggested executor toolkit

- If the `vercel-react-best-practices` skill is available, invoke it before
  step 2 (memo boundary design).

## Scope

**In scope**:
- `plugins\timeserieschart\src\TimeSeriesChartPanel.tsx`
- `plugins\timeserieschart\src\TimeSeriesChartPanel.test.tsx`
- (optional) a new pure helper module `plugins\timeserieschart\src\utils\series-data.ts` + test

**Out of scope**:
- `TimeSeriesChartBase.tsx`, `utils\data-transform.ts`, `getSeriesColor` /
  palette code — call them, don't change them.
- Legend components (`@perses-dev/components`).
- Any change to the rendered ECharts option semantics: dataset indices,
  color assignment order (`seriesIndex` must keep counting across *all*
  series, selected or not — colors must not shift when selection changes),
  threshold series, `negativeY` handling.

## Git workflow

- Repo `plugins`. Branch: `advisor/029-split-timeseries-panel-memo`.
- Commit style: `[ENHANCEMENT] <description>`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Extract a selection-independent "prepared series" memo

Create a first `useMemo` (or pure exported helper in
`utils\series-data.ts` called from a `useMemo`) that iterates
`queryResults`/`querySettingsList` exactly as today but **without** the
`showTimeSeries` gate, producing an array of per-series records:

```ts
interface PreparedSeries {
  seriesId: string;
  seriesIndex: number;          // palette index — counted over ALL series
  formattedSeriesName: string;
  seriesColor: string;
  querySettings?: QuerySettingsOptions;
  queryFormat?: FormatOptions;
  legendCalculations?: ...;     // getCalculations result (O(points), computed once)
  renderedValues: TimeSeriesValueTuple[]; // negativeY already applied
  seriesMax?: number;           // per-format max candidate
  timeScale: TimeScale;
}
```

Dependencies: everything the current memo uses **except**
`selectedLegendItems`. Preserve: the `timeScale === undefined` early return
(return empty result), the seriesId formula, the last-match-wins
querySettings lookup (`:206-212`), and the empty-return when a series is
`undefined` (`:216-219`).

**Verify**: `npm run type-check` → exit 0.

### Step 2: Build selection-dependent outputs in a second, cheap memo

Second `useMemo`, deps `[preparedSeries, selectedLegendItems, thresholds, legend, ...]`,
that loops over `PreparedSeries` records and:
- applies the `isSelectAll / isSelected` filter to decide inclusion,
- computes `datasetIndex = timeChartData.length` at push time (this preserves
  the current selected-only dataset indexing, `:254`),
- calls `getTimeSeries(seriesId, datasetIndex, ...)` for included series —
  this is cheap (builds an options object, no per-point work),
- assembles `seriesFormatMap`, `maxValuesByFormat` (from precomputed
  `seriesMax`), `legendItems` (unconditional, from precomputed
  `legendCalculations`), and appends threshold series exactly as the current
  post-loop block does.

The component must end up destructuring the same six values with the same
names so the rest of the file compiles untouched.

**Verify**: `npm run type-check` → exit 0; `npm run test` → all pass.

### Step 3: Confirm no per-point work in the selection memo

Grep your second memo for `getCalculations(`, `.values.map(`, `Math.max(...` —
none may appear (they belong to Step 1's memo).

**Verify**: manual grep as above → no matches inside the second memo.

## Test plan

- Existing `TimeSeriesChartPanel.test.tsx` must pass unchanged — it pins
  rendered behavior.
- If Step 1 used a pure helper module, add
  `plugins\timeserieschart\src\utils\series-data.test.ts` (model on
  `utils\data-transform.test.ts`) covering: multi-query palette index
  continuity, `negativeY` negation, custom-all/undefined series early return,
  last-match-wins query settings.
- Add one test (in `TimeSeriesChartPanel.test.tsx` or the helper test):
  selection filtering — with a selection map containing one seriesId, only
  that series appears in `timeChartData`, but `legendItems` still lists all
  series, and the selected series keeps the same color it had under `'ALL'`.
- Verification: `npm run test` → all pass.

## Done criteria

ALL must hold (run in `plugins\timeserieschart`):

- [ ] `npm run type-check` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm run test` exits 0, including the new selection-filtering test
- [ ] The dep array of the memo that calls `getCalculations` does NOT contain `selectedLegendItems` (inspect the file)
- [ ] `git status` shows only in-scope files modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The live memo structure no longer matches the excerpts (drift).
- You cannot preserve the selected-only `datasetIndex` semantics (`:250-254`)
  without keeping per-point work in the selection memo.
- Any existing test fails and the fix would require changing expected
  rendered output (colors, dataset order, thresholds).
- plan 026 has not landed (check `shared\plugin-system\src\runtime\DataQueriesProvider\DataQueriesProvider.tsx`
  for `useMemo` inside `useDataQueries`) — the split still works but report
  that the priority ordering was violated and ask whether to proceed.

## Maintenance notes

- The invariant to protect in review: **palette/color assignment iterates all
  series; dataset indices iterate selected series only.** A reviewer should
  diff a rendered option JSON before/after with a fixed selection.
- Future: the TODO at `:199` ("moving parts of mapping to the lower level
  chart") remains open; this plan is a prerequisite step toward it.
- If legend pagination/virtualization is added later, the unconditional
  legendItems construction may also want lazy calculation of
  `legendCalculations` — deferred.
