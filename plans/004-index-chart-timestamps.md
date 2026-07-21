# Plan 004: Index chart timestamps before transforming points

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md`, unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**: `git -C plugins diff --stat d7075da..HEAD -- statushistorychart/src/utils/data-transform.ts statushistorychart/src/utils/data-transform.test.ts heatmapchart/src/components/HeatMapChartPanel.tsx heatmapchart/src/components/HeatMapChartPanel.test.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `d7075da`, 2026-07-21

## Why this matters

Both chart transforms generate an ordered timestamp axis and then run a linear
`findIndex` over that axis for every input point or histogram. With `T` axis
timestamps and `P` input points, this makes timestamp placement `O(P * T)` on a
React render-time path. Building one `Map<number, number>` per transform changes
placement to `O(T + P)` without changing chart data, missing-timestamp behavior,
or the seconds-to-milliseconds conversion used by native histograms.

## Current state

- `statushistorychart/src/utils/data-transform.ts` builds the complete axis in
  `useStatusHistoryDataModel`, then scans it once for every series value.
- `statushistorychart/src/utils/data-transform.test.ts` is the existing
  `renderHook` test for the status-history model; extend this test rather than
  introducing a second test style.
- `heatmapchart/src/components/HeatMapChartPanel.tsx` performs the same scan for
  every histogram timestamp while building `HeatMapDataItem[]`.
- `heatmapchart/src/components/HeatMapChartPanel.test.tsx` does not exist; create
  it as the focused regression test for the heatmap transform.

Current status-history hot path (`statushistorychart/src/utils/data-transform.ts:85-99`):

```ts
const xAxisCategories = generateCompleteTimestamps(timeScale);

allSeries.forEach((item) => {
  const instance = item.formattedName || '';
  yAxisCategories.push(instance);
  const yIndex = yAxisCategories.length - 1;
  item.values.forEach(([time, value]) => {
    const itemIndexOnXaxis = xAxisCategories.findIndex((v) => v === time);
    if (value !== null && itemIndexOnXaxis !== -1) {
      // build StatusHistoryDataItem
    }
  });
});
```

Current heatmap hot path (`heatmapchart/src/components/HeatMapChartPanel.tsx:135-160`):

```ts
const data: HeatMapDataItem[] = [];
// Each bucket becomes a rectangle spanning [lowerBound, upperBound] at the given x index
for (const [time, histogram] of series?.histograms ?? []) {
  const itemIndexOnXaxis = xAxisCategories.findIndex((v) => v === time * 1000);

  for (const bucket of histogram?.buckets ?? []) {
    // build HeatMapDataItem
  }
}
```

Repository conventions to preserve:

- Expensive derived chart data stays inside `useMemo`; see
  `statushistorychart/src/utils/data-transform.ts:49-150` and
  `heatmapchart/src/components/HeatMapChartPanel.tsx:61-170`.
- Status-history model tests use `renderHook` and compare the complete returned
  model; follow `statushistorychart/src/utils/data-transform.test.ts:18-75`.
- Package tests use Jest via each workspace's `test` script, and source files
  retain the Apache license header.
- Timestamp units are intentionally different at the input boundary:
  status-history values are already milliseconds, while heatmap histogram
  timestamps are multiplied by `1000`. Do not normalize or remove that
  conversion in this plan.

## Commands you will need

Use Node `v22.14.0` from `plugins/.nvmrc` and npm `10.9.2` from
`plugins/package.json`; if those pinned versions cannot be activated, STOP
before installing or testing. On Windows PowerShell, use `npm.cmd` when
`npm.ps1` is policy-blocked.

Run these from the application checkout root that contains `plugins/`.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix plugins ci` | exit 0; lockfile is unchanged |
| Status-history tests | `npm --prefix plugins test --workspace @perses-dev/status-history-chart-plugin -- --runInBand src/utils/data-transform.test.ts` | all selected tests pass |
| Heatmap tests | `npm --prefix plugins test --workspace @perses-dev/heatmap-chart-plugin -- --runInBand src/components/HeatMapChartPanel.test.tsx` | all selected tests pass |
| Status-history typecheck | `npm --prefix plugins run type-check --workspace @perses-dev/status-history-chart-plugin` | exit 0, no TypeScript errors |
| Heatmap typecheck | `npm --prefix plugins run type-check --workspace @perses-dev/heatmap-chart-plugin` | exit 0, no TypeScript errors |
| Status-history lint | `npm --prefix plugins run lint --workspace @perses-dev/status-history-chart-plugin` | exit 0, no ESLint errors |
| Heatmap lint | `npm --prefix plugins run lint --workspace @perses-dev/heatmap-chart-plugin` | exit 0, no ESLint errors |
| Build | `npm --prefix plugins run build --workspace @perses-dev/status-history-chart-plugin --workspace @perses-dev/heatmap-chart-plugin` | both workspaces build successfully |

## Suggested executor toolkit

- Use `vercel-react-best-practices` if available to review the render-time
  derivation and dependency arrays. The index must be created inside the
  existing memoized calculation, not recreated during each point lookup.

## Scope

**In scope** (the only source/test files you should modify):

- `plugins/statushistorychart/src/utils/data-transform.ts`
- `plugins/statushistorychart/src/utils/data-transform.test.ts`
- `plugins/heatmapchart/src/components/HeatMapChartPanel.tsx`
- `plugins/heatmapchart/src/components/HeatMapChartPanel.test.tsx` (create)

The required status-only edit to `plans/README.md` is also allowed at the end.

**Out of scope** (do not touch):

- `plugins/heatmapchart/src/utils/data-transform.ts`; its timestamp generator is
  already linear and does not need a public indexing helper.
- Axis generation, query time-scale reconciliation, sorting, color/value
  mapping, bounds calculation, log-scale behavior, or chart rendering.
- Timestamp unit changes, data shape changes, dependencies, benchmarks, and
  unrelated chart plugins.

## Git workflow

- Work in the `plugins` repository on branch
  `advisor/004-index-chart-timestamps`.
- Keep this as one logical commit. Match the observed commit style, for example:
  `[ENHANCEMENT] chart transforms: index timestamps before point placement`.
- Do not push or open a pull request unless the operator explicitly asks.

## Steps

### Step 0: Reinstall locked plugin dependencies and prove the existing model test

Run `npm --prefix plugins ci`, confirm `git -C plugins diff -- package-lock.json`
prints nothing, then run the existing status-history focused test before any
edit. The audited `node_modules` had mismatched internal Perses package
versions, so do not diagnose product code against it.

**Verify**: the install exits 0 and
`npm --prefix plugins test --workspace @perses-dev/status-history-chart-plugin -- --runInBand src/utils/data-transform.test.ts`
passes before source changes. If not, STOP and report the baseline failure.

### Step 1: Index status-history timestamps once

In `useStatusHistoryDataModel`, immediately after
`generateCompleteTimestamps(timeScale)`, create a local
`Map<number, number>` whose keys are timestamps and whose values are their axis
indexes. Construct it with one loop or `xAxisCategories.map`; do not call
`findIndex` while processing points.

Replace the per-value lookup with `timestampIndex.get(time)`. Because axis index
`0` is valid, test absence with `itemIndexOnXaxis !== undefined`, never with a
truthiness check. Preserve the existing behavior that drops null values and
timestamps that are not present on the generated axis.

Extend `data-transform.test.ts` so the fixture includes:

- a value at the first timestamp (index `0`);
- a value at a later timestamp; and
- a non-null value whose timestamp is off the generated time scale, which must
  not appear in `statusHistoryData` or its legend.

**Verify**: `npm --prefix plugins test --workspace @perses-dev/status-history-chart-plugin -- --runInBand src/utils/data-transform.test.ts` -> the complete model assertions pass, including index `0` and the skipped off-axis point.

### Step 2: Index heatmap timestamps once

In the heatmap panel's existing `useMemo`, build a timestamp-to-index map once,
immediately after `xAxisCategories` is generated. Replace the histogram-loop
`findIndex` with a map lookup using `time * 1000` as the key. Preserve the
current sentinel for an off-axis histogram (`-1`) by using an explicit
undefined check or `?? -1`; do not accidentally map index `0` to `-1`.

Create `HeatMapChartPanel.test.tsx`. Mock only `./HeatMapChart` so the test can
inspect the props passed by `HeatMapChartPanel` without initializing ECharts.
Render a valid single-series native-histogram result with a two-timestamp time
scale and assert that:

- the first histogram's bucket receives x index `0`;
- the second receives x index `1`;
- bounds, counts, and labels remain unchanged; and
- an off-axis histogram retains x index `-1`, matching current behavior.

Use bucket tuples in the repository's `[bucket, lowerBound, upperBound, count]`
shape expected by the panel, and keep the input histogram timestamps in seconds.

**Verify**: `npm --prefix plugins test --workspace @perses-dev/heatmap-chart-plugin -- --runInBand src/components/HeatMapChartPanel.test.tsx` -> all new heatmap transformation assertions pass.

### Step 3: Run package-level validation

Run the two typechecks, two lints, and the combined build from the commands
table. Fix only problems caused by the four in-scope files.

**Verify**: `npm --prefix plugins run build --workspace @perses-dev/status-history-chart-plugin --workspace @perses-dev/heatmap-chart-plugin` -> both workspaces build and the command exits 0.

## Test plan

- Extend `plugins/statushistorychart/src/utils/data-transform.test.ts` using its
  existing `renderHook` pattern. Cover axis index `0`, a later index, null/off-axis
  exclusion, and unchanged legend/model output.
- Create `plugins/heatmapchart/src/components/HeatMapChartPanel.test.tsx` with a
  mocked `HeatMapChart`. Cover seconds-to-milliseconds lookup, index `0`, a later
  index, off-axis `-1`, and unchanged bucket metadata.
- Run both focused Jest commands before the full typecheck/lint/build gate.
- Do not add timing assertions; the structural removal of `findIndex` is the
  deterministic performance regression guard.

## Done criteria

- [ ] Both focused Jest commands pass.
- [ ] The pinned toolchain, clean install, and pre-edit status-history baseline pass.
- [ ] Both workspace typechecks and lints exit 0.
- [ ] The combined workspace build exits 0.
- [ ] `rg -n "xAxisCategories\.findIndex" plugins/statushistorychart/src/utils/data-transform.ts plugins/heatmapchart/src/components/HeatMapChartPanel.tsx` returns no matches.
- [ ] Index `0`, missing timestamps, and the heatmap `time * 1000` conversion are covered by tests.
- [ ] `git -C plugins diff --name-only d7075da..HEAD` lists exactly the four in-scope plugin files, and `git -C plugins status --short` is empty after the logical commit.
- [ ] The status row in `plans/README.md` is updated, unless the dispatcher owns the index.

## STOP conditions

Stop and report back; do not improvise if:

- The drift check shows either transform no longer uses the excerpted
  `xAxisCategories.findIndex` path.
- Generated axis timestamps are not unique, or input timestamps are intentionally
  matched approximately rather than by exact numeric equality.
- Preserving heatmap behavior requires removing the `time * 1000` conversion or
  changing the off-axis `-1` sentinel.
- The heatmap transform cannot be exercised by mocking only `HeatMapChart` and
  would require changing production exports or unrelated providers.
- A verification fails twice after a reasonable in-scope correction, or the fix
  requires a file outside Scope.

## Maintenance notes

- Keep the timestamp map local to each memoized transform. A cross-package
  shared helper would add API surface for a three-line operation and is not part
  of this plan.
- Reviewers should scrutinize index `0` handling and timestamp units; those are
  the two easiest ways for a map refactor to alter output silently.
- If future data accepts irregular or approximate timestamps, replace exact map
  lookup with a documented sorted nearest-neighbor strategy rather than adding
  a fallback linear scan.
