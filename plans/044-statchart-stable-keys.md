# Plan 044: Key StatChart cards by series identity, not array index

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite workspace root)**:
> `git -C plugins diff --stat d7075da..HEAD -- statchart/src/StatChartPanel.tsx`
> If the file changed since this plan was written, compare the "Current
> state" excerpt against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED (key changes remount cards; verify no visual regression)
- **Depends on**: none
- **Category**: bug
- **Planned at**: plugins commit `d7075da`, 2026-07-21

## Why this matters

Multi-series stat panels render one card per series keyed by **array
index**. Series order from a query is not stable across refreshes (label
ordering, topk churn); when order changes, React reconciles by index and
reuses card/sparkline component state for a *different* series — values and
sparklines can transiently display against the wrong series name.

## Current state

- `plugins/statchart/src/StatChartPanel.tsx:73-90`:

```tsx
      {statChartData.length ? (
        statChartData.map((series, index) => {
          const sparklineConfig = convertSparkline(chartsTheme, series.color, sparkline);

          return (
            <StatChartBase
              key={index}
              width={chartWidth}
              ...
```

- `statChartData` comes from `useStatChartData(queryResults, spec, chartsTheme)`
  in the same file; each entry is a `StatChartData`
  (`plugins/statchart/src/StatChartBase.tsx` defines the type) — inspect it
  for identity fields: it is built per time series and (check the
  `useStatChartData` implementation lower in `StatChartPanel.tsx`) carries a
  series name (`seriesData.name` / formatted name) used for the legend.

Use the series' formatted name (plus query index if needed for uniqueness
across multiple queries) as the key. If two series in one panel can share a
formatted name, compose the key from the query index and the name.

## Commands you will need

Node `v22.14.0` / npm `10.9.2` pinned; STOP if not activatable. Windows:
`npm.cmd`.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix plugins install` | exit 0 (only if node_modules missing) |
| Focused test | `npm --prefix plugins/statchart run test` | exit 0 |
| Typecheck | `npm --prefix plugins/statchart run type-check` | exit 0 |
| Lint | `npm --prefix plugins/statchart run lint` | exit 0 |

## Scope

**In scope**:

- `plugins/statchart/src/StatChartPanel.tsx` (the `key` and, if the mapping
  loses access to identity, minimal threading of a name/id through
  `useStatChartData`'s returned items)
- Existing statchart tests (extend if a render test exists)

**Out of scope** (do NOT touch):

- `StatChartBase.tsx` rendering, `convertSparkline`, value calculation.
- Other panels with index keys (bar/gauge etc.) — separate sweeps.

## Git workflow

- Nested `plugins` repository, branch `advisor/044-statchart-stable-keys`.
- One commit, e.g. `[BUGFIX] statchart: key series cards by series identity`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Identify the stable identity

Read `useStatChartData` in `StatChartPanel.tsx` and the `StatChartData`
type. Determine the per-card identity available (series name / labels /
query index). If no unique identity exists on the mapped items, extend the
mapped item with one derived from the source series (labels string) inside
`useStatChartData`.

**Verify**: `npm --prefix plugins/statchart run type-check` → exit 0.

### Step 2: Replace the key

`key={index}` → `key={<stable identity>}` (e.g.
`` key={`${series.name}`} `` or a composed string). Keep everything else
unchanged.

**Verify**: statchart tests, typecheck, lint all exit 0.

## Test plan

If the package has a panel render test, extend it: render two series A/B,
rerender with order B/A, assert the card displaying series A's name shows
series A's value (would catch index-key reuse). If no render test exists,
add a minimal one following a sibling plugin's panel test (grep
`plugins/*/src/*Panel.test.tsx` for the nearest pattern); if none exists
anywhere, note it and rely on type/lint gates — do NOT build a new test
harness for this plan.

## Done criteria

- [ ] `rg -n "key=\{index\}" plugins/statchart/src/StatChartPanel.tsx` → no matches.
- [ ] Statchart tests, typecheck, and lint exit 0.
- [ ] `git -C plugins diff --name-only d7075da..HEAD` lists only in-scope paths.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- Series identity is genuinely unavailable and threading it requires
  touching shared packages — report instead of modifying `@perses-dev/*`.
- Existing tests assert on mount/remount behavior that the key change
  breaks — report with the failing test.

## Maintenance notes

- Same index-key pattern may exist in other multi-instance panels
  (bar gauge cards, etc.) — reviewers: grep `key={index}` across `plugins/`
  as follow-up.
