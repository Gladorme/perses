# Plan 048: Memoize chart-plugin ECharts option objects (pie, scatter, heatmap, statchart)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite repository root)**:
> `git -C plugins diff --stat d7075da..HEAD -- piechart/src/PieChartBase.tsx scatterchart/src/Scatterplot.tsx heatmapchart/src/components/HeatMapChartPanel.tsx statchart/src/StatChartPanel.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: `plugins` repo commit `d7075da`, 2026-07-20

## Why this matters

The shared `EChart` component (`shared/components/src/EChart/EChart.tsx`)
already guards the expensive `chart.setOption(...)` call behind
`isEqual(prevOption.current, option)`. That guard is **load-bearing** and must
not be weakened (see `plans/README.md` — it was deliberately kept). But lodash
`isEqual` compares functions **by reference**: if an `option` object embeds a
freshly-created closure (an ECharts `formatter`, `renderItem`, etc.), the deep
compare returns `false` on every render, so `setOption` fires and the whole
chart re-renders **every time the parent renders** — on time-range ticks,
hover state, legend interaction, and unrelated sibling updates.

Four panel plugins build their `option` (or the props feeding a child's
`option` memo) inline in the render body, several with inline formatter
closures:

- **PieChartBase** and **Scatterplot** build the full `option` inline **with
  inline `formatter` closures** → the `isEqual` guard is defeated → a full
  `setOption` runs every render.
- **HeatMapChartPanel** rebuilds `yAxisFormat`/`countFormat` via
  `merge({}, ...)` (new object identity each render); these are dependencies
  of the memoized `option` inside `HeatMapChart`, so that memo is invalidated
  every render (and its `option` contains a `renderItem` closure).
- **StatChartPanel** calls `convertSparkline(...)` per series in the render
  map; the resulting object is a dependency of `StatChartBase`'s `option`
  memo, invalidating it every render.

`TimeSeriesChartPanel`/`TimeSeriesChartBase`, `BarChartBase`, and
`GaugeChartBase` (via `useDeepMemo`) already memoize their options correctly —
this plan brings the four laggards to that same standard. This is **not** a
change to `EChart`'s `isEqual` (that is intentionally out of scope); it stops
handing `EChart` a new object graph with new closures on every render.

## Current state

Repo **`plugins`** (turborepo; each chart is its own workspace package).

**1. PieChartBase** — `plugins/piechart/src/PieChartBase.tsx`
(`@perses-dev/pie-chart-plugin`). The `option` is a plain `const` in the render
body and includes two inline formatter closures:

```tsx
// PieChartBase.tsx (current, abridged)
export function PieChartBase(props: PieChartBaseProps): ReactElement {
  const { width, height, data, mode, formatOptions, showLabels } = props;
  const chartsTheme = useChartsTheme();
  const muiTheme = useTheme();

  const option = {
    tooltip: {
      trigger: 'item',
      formatter: getTooltipFormatter(formatOptions),   // new closure every render
      appendTo: document.body,
      confine: false,
    },
    series: [
      {
        type: 'pie',
        ...
        label: {
          ...
          formatter: getLabelFormatter(mode, formatOptions),  // new closure every render
          ...
        },
        ...
        data: data,
        ...
        itemStyle: { ..., borderColor: muiTheme.palette.background.default, ... },
      },
    ],
  };

  return ( <Box ...><EChart ... option={option} theme={chartsTheme.echartsTheme} /></Box> );
}
```

`useMemo` is **not** imported in this file yet.

**2. Scatterplot** — `plugins/scatterchart/src/Scatterplot.tsx`
(`@perses-dev/scatter-chart-plugin`). `eChartOptions` is a plain `const` in the
render body, with inline `xAxis.axisLabel.formatter`,
`yAxis.axisLabel.formatter`, and `tooltip.formatter` closures:

```tsx
// Scatterplot.tsx (current, abridged)
const rangeMs = absoluteTimeRange.end.valueOf() - absoluteTimeRange.start.valueOf();
const getAxisFormatter = useCallback(() => createTimezoneAwareAxisFormatter(rangeMs, timeZone), [rangeMs, timeZone]);

// Apache EChart Options Docs: https://echarts.apache.org/en/option.html
const eChartOptions: EChartsCoreOption = {
  dataset: options.dataset,
  series: options.series,
  dataZoom: options.dataZoom,
  grid: { ... },
  xAxis: { type: 'time', min: absoluteTimeRange.start, max: absoluteTimeRange.end,
    axisLabel: { hideOverlap: true, formatter: getAxisFormatter() } },
  yAxis: { ..., axisLabel: { formatter: (durationMs: number) => formatValue(durationMs, { unit: 'milliseconds' }) } },
  animation: false,
  tooltip: { ..., formatter: function (params: any) { ... } },
  legend: { ... },
};
```

`useMemo` and `useCallback` are already imported. `options` (the prop),
`options.dataset`, and `options.series` are already memoized upstream in
`ScatterChartPanel`; only the wrapper here is unstable.

**3. HeatMapChartPanel** — `plugins/heatmapchart/src/components/HeatMapChartPanel.tsx`
(`@perses-dev/heatmap-chart-plugin`). Two `merge` results are rebuilt each
render:

```tsx
// HeatMapChartPanel.tsx (current)
export function HeatMapChartPanel(props: HeatMapChartPanelProps): ReactElement | null {
  const { spec: pluginSpec, contentDimensions, queryResults } = props;

  // ensures all default format properties set if undef
  const yAxisFormat = merge({}, DEFAULT_FORMAT, pluginSpec.yAxisFormat);   // new object every render
  const countFormat = merge({}, DEFAULT_FORMAT, pluginSpec.countFormat);   // new object every render
```

These are passed to `HeatMapChart` (`plugins/heatmapchart/src/components/HeatMapChart.tsx`),
whose `option` `useMemo` lists `yAxisFormat` / `countFormat` in its dependency
array. `useMemo` is already imported in the panel file.

**4. StatChartPanel** — `plugins/statchart/src/StatChartPanel.tsx`
(`@perses-dev/stat-chart-plugin`). `convertSparkline` runs per series inside the
render map:

```tsx
// StatChartPanel.tsx (current, abridged)
{statChartData.map((series, index) => {
  const sparklineConfig = convertSparkline(chartsTheme, series.color, sparkline);  // recomputed every render
  return (
    <StatChartBase key={index} ... sparkline={sparklineConfig} ... />
  );
})}
```

`sparklineConfig` is a dependency of `StatChartBase`'s `option` memo. `spec`
destructures `sparkline`; `chartsTheme` comes from `useChartsTheme()`. (Note:
`key={index}` here is addressed separately by plan 044 — do **not** change
keying in this plan.)

Conventions: React 18, explicit return types, `useMemo`/`useCallback` with
`react-hooks/exhaustive-deps` enforced by ESLint. Exemplar to copy:
`plugins/barchart/src/BarChartBase.tsx` (its `option` is wrapped in `useMemo`).

## Commands you will need

Use Node `v22.14.0` (`plugins/.nvmrc`) and npm `10.9.2`
(`plugins/package.json` `packageManager`); if those pinned versions cannot be
activated, STOP before installing or testing. Run from the composite
repository root. On Windows PowerShell, use `npm.cmd` when `npm.ps1` is
policy-blocked.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix plugins ci` | exit 0; `plugins/package-lock.json` unchanged |
| Typecheck | `npm --prefix plugins run type-check -- --filter=@perses-dev/pie-chart-plugin --filter=@perses-dev/scatter-chart-plugin --filter=@perses-dev/heatmap-chart-plugin --filter=@perses-dev/stat-chart-plugin` | exit 0, no TS errors |
| Lint | `npm --prefix plugins run lint -- --filter=@perses-dev/pie-chart-plugin --filter=@perses-dev/scatter-chart-plugin --filter=@perses-dev/heatmap-chart-plugin --filter=@perses-dev/stat-chart-plugin` | exit 0, no ESLint errors (exhaustive-deps clean) |
| Tests | `npm --prefix plugins run test -- --filter=@perses-dev/pie-chart-plugin --filter=@perses-dev/scatter-chart-plugin --filter=@perses-dev/heatmap-chart-plugin --filter=@perses-dev/stat-chart-plugin` | exit 0; all suites pass |

If Turbo `--filter` fights you, fall back to per-package
`npm --prefix plugins run <script> --workspace=<package-name>`.

## Suggested executor toolkit

- If available, use `vercel-react-best-practices` to confirm the
  `useMemo`-for-option pattern. Keep changes local; no chart redesign.

## Scope

**In scope** (the only implementation files you should modify):

- `plugins/piechart/src/PieChartBase.tsx`
- `plugins/scatterchart/src/Scatterplot.tsx`
- `plugins/heatmapchart/src/components/HeatMapChartPanel.tsx`
- `plugins/statchart/src/StatChartPanel.tsx`
- Colocated `*.test.tsx` files for the above (add/extend tests)

`plans/README.md` is an administrative status-only exception after completion.

**Out of scope** (do NOT touch):

- `shared/components/src/EChart/EChart.tsx` — the `isEqual` guard stays as-is.
- The upstream data/series transforms in `ScatterChartPanel`, `PieChartPanel`,
  and the heatmap data `useMemo` (already memoized).
- `convertSparkline` internals, `getTooltipFormatter`/`getLabelFormatter`
  internals, `HeatMapChart`'s existing `option` memo body.
- `key={index}` in StatChartPanel (plan 044).
- Any other plugin.

## Git workflow

- Work in the nested `plugins` repository on branch
  `advisor/048-memoize-chart-plugin-echart-options`.
- Commit as one logical unit after verification. Match observed history tags,
  for example: `[ENHANCEMENT] charts: memoize ECharts option objects`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 0: Reinstall the locked plugins workspace

Run `npm --prefix plugins ci`. Do not rely on an existing `node_modules`; the
audited checkout had an incomplete install. The command must not rewrite the
lockfile.

**Verify**: `npm --prefix plugins ci` exits 0 and
`git -C plugins diff -- package-lock.json` prints nothing.

### Step 1: Memoize the pie-chart option

In `PieChartBase.tsx`, wrap the `option` object in `useMemo`, keyed on the
values it reads: `[data, mode, formatOptions, showLabels, muiTheme.palette.background.default]`.
Add `useMemo` to the `react` import. Do not change the option contents.

**Verify**:
`npm --prefix plugins run type-check -- --filter=@perses-dev/pie-chart-plugin`
→ exit 0.

### Step 2: Memoize the scatter option

In `Scatterplot.tsx`, wrap `eChartOptions` in `useMemo`. Dependencies:
`[options, absoluteTimeRange, getAxisFormatter, dateFormatter, chartsTheme]`
(these cover every value the object reads; `formatValue` is a stable import).
Keep the inline `tooltip.formatter`/`yAxis` formatter bodies — moving them into
the memo makes their identity stable across renders where the deps are equal,
which is the point.

**Verify**:
`npm --prefix plugins run type-check -- --filter=@perses-dev/scatter-chart-plugin`
→ exit 0.

### Step 3: Memoize the heatmap format objects

In `HeatMapChartPanel.tsx`, wrap each `merge(...)` in `useMemo`:

```tsx
const yAxisFormat = useMemo(() => merge({}, DEFAULT_FORMAT, pluginSpec.yAxisFormat), [pluginSpec.yAxisFormat]);
const countFormat = useMemo(() => merge({}, DEFAULT_FORMAT, pluginSpec.countFormat), [pluginSpec.countFormat]);
```

`DEFAULT_FORMAT` is a module constant; `merge` mutates its first arg only (the
fresh `{}`), so this is safe. Do not touch the data `useMemo` or the early
returns below it.

**Verify**:
`npm --prefix plugins run type-check -- --filter=@perses-dev/heatmap-chart-plugin`
→ exit 0.

### Step 4: Memoize the statchart sparkline configs

In `StatChartPanel.tsx`, compute all sparkline configs once before the map, so
`convertSparkline` is not re-invoked per series on every render:

```tsx
const sparklineConfigs = useMemo(
  () => statChartData.map((series) => convertSparkline(chartsTheme, series.color, sparkline)),
  [statChartData, chartsTheme, sparkline]
);
```

Then read `sparklineConfigs[index]` inside the existing `statChartData.map`.
`useMemo` is already imported. Because `statChartData` is itself memoized (via
`useStatChartData`), and `sparkline`/`chartsTheme` are stable when unchanged,
each `StatChartBase` now receives a stable `sparkline` prop across unrelated
renders.

**Verify**:
`npm --prefix plugins run type-check -- --filter=@perses-dev/stat-chart-plugin`
→ exit 0.

### Step 5: Lint, test, and add identity-stability coverage

Run lint (must be exhaustive-deps clean) and the four package test suites; fix
only in-scope fallout.

**Verify**: the Lint and Tests commands from the table above → exit 0; all
suites pass.

## Test plan

For each of the four panels, add or extend a colocated test that renders the
component twice (a parent re-render with **unchanged** inputs) and asserts the
option/format identity is stable:

- **Pie / Scatter**: render, capture the `option` prop passed to `EChart`
  (mock `@perses-dev/components`'s `EChart` to record its `option` arg, as the
  existing chart tests do — check `plugins/timeserieschart/src` tests for the
  mock pattern), force a re-render with the same props, assert
  `Object.is(firstOption, secondOption)` is `true`.
- **Heatmap**: assert `yAxisFormat`/`countFormat` passed to `HeatMapChart` are
  reference-equal across a re-render with unchanged `pluginSpec`.
- **Statchart**: assert the `sparkline` prop passed to each `StatChartBase` is
  reference-equal across a re-render with unchanged inputs.
- Also assert the rendered output is unchanged (a snapshot or a value/label
  assertion) so the memoization cannot pass by dropping content.

Follow the existing per-plugin Jest setup (`cross-env LC_ALL=C TZ=UTC jest`).
Verification: the Tests command above → all pass including the new assertions.

## Done criteria

Machine-checkable; ALL must hold (run from composite root):

- [ ] `rg -n "useMemo" plugins/piechart/src/PieChartBase.tsx` shows the option is wrapped in `useMemo`.
- [ ] `rg -n "const eChartOptions: EChartsCoreOption = useMemo\(" plugins/scatterchart/src/Scatterplot.tsx` returns one match.
- [ ] `rg -n "useMemo\(\(\) => merge" plugins/heatmapchart/src/components/HeatMapChartPanel.tsx` returns two matches.
- [ ] `rg -n "sparklineConfigs" plugins/statchart/src/StatChartPanel.tsx` shows a single memoized array; `convertSparkline` no longer appears inside the JSX map body.
- [ ] Typecheck, lint, and tests for the four packages exit 0.
- [ ] New identity-stability tests exist for all four panels and pass.
- [ ] `git -C plugins diff --name-only d7075da..HEAD` lists only in-scope paths, and `git -C plugins status --short` is empty after the logical commit.
- [ ] `plans/README.md` status row updated, unless the dispatcher maintains the index.

## STOP conditions

Stop and report back without improvising if:

- Live code already memoizes any of these four options (drift; excerpts do not
  match).
- Adding a dependency to a memo triggers `exhaustive-deps` warnings that cannot
  be resolved without changing behavior (e.g. a value legitimately unstable
  upstream) — report which value and where it originates.
- The `EChart` mock pattern needed for the identity tests requires changing a
  production export; report instead of adding a test seam.
- Any existing chart test fails in a way that is not a pure identity assertion.
- A verification command fails twice after a reasonable in-scope fix attempt.

## Maintenance notes

- This plan is complementary to — not a substitute for — the `EChart` `isEqual`
  guard. Do not remove or weaken that guard; the win here is that a stable
  option lets `isEqual` short-circuit cheaply (and, for pie/scatter, stops the
  guard being defeated by fresh closures entirely).
- Reviewer: confirm this is identity-only. Rendered DOM/canvas output before
  and after must be identical; only the number of `setOption` calls on
  unrelated re-renders changes.
- If a future edit adds a field to any of these options, it must go inside the
  memo, not as a new inline literal.
- Follow-up worth profiling after this lands: whether `ScatterChartPanel`'s
  `options` wrapper (already partly memoized) needs the same treatment at its
  own construction site.
