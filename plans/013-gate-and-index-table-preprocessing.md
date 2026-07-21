# Plan 013: Gate and index table preprocessing

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md`, unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**: `git -C plugins diff --stat d7075da..HEAD -- table/src/components/TablePanel.tsx table/src/components/TablePanel.test.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `d7075da`, 2026-07-21

## Why this matters

`TablePanel` performs several full-table preprocessing passes regardless of
whether their features are enabled: it collects formatted filter values when
filtering is off and calculates numeric ranges for every column when no gauge is
rendered. Conditional formatting also rebuilds the same missing-key object per
row and linearly searches column settings per cell. Feature gates, a first-wins
settings index, and reusable per-calculation templates reduce render-time work
substantially on wide/large tables without changing column order, duplicate
setting semantics, filtering, gauges, or conditional formatting.

## Current state

- `table/src/components/TablePanel.tsx` converts query results, derives keys,
  formats, filter metadata, gauge ranges, columns, filtered rows, and cell
  configs inside one component.
- `table/src/components/TablePanel.test.tsx` is the established integration suite
  with `ChartsProvider`, selection/action providers, and `VirtuosoMockContext`.
  It already covers formatting and filtered conditional cells; extend it rather
  than creating implementation-only tests.
- `table/src/table-data-utils.ts` has a separate per-series column-setting
  lookup. It is deliberately outside this plan because changing raw query
  transformation would broaden risk beyond render preprocessing.

Current unconditional filter-value pass (`table/src/components/TablePanel.tsx:481-507`):

```ts
const columnUniqueValues = useMemo(() => {
  const uniqueValues: Record<string, FilterValuesType<string | number>> = {};

  for (const key of keys) {
    const formatOption = columnsFormat?.[key];
    uniqueValues[key] = [];
    const usedValues: Map<string, true> = new Map();
    for (const row of data) {
      const val = row[key];
      // deduplicate and format every filterable value
    }
  }
  return uniqueValues;
}, [data, keys, columnsFormat]);
```

Current all-column gauge pass (`table/src/components/TablePanel.tsx:509-531`):

```ts
const gaugeRangeByColumn = useMemo(() => {
  const result: Record<string, GaugeRange> = {};

  for (const key of keys) {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const row of data) {
      const numericValue = getGaugeNumericValue(row[key]);
      // update range
    }
  }
  return result;
}, [data, keys]);
```

Current repeated conditional-format setup (`table/src/components/TablePanel.tsx:597-646`):

```ts
for (const row of filteredData) {
  const keysAsObj = keys.reduce(
    (acc, key) => {
      acc[key] = undefined;
      return acc;
    },
    {} as Record<string, undefined>
  );
  const extendRow = { ...keysAsObj, ...row };

  for (const [key, value] of Object.entries(extendRow)) {
    let cellConfig = evaluateConditionalFormatting(value, spec.cellSettings ?? []);
    const columnSetting = spec.columnSettings?.find((col) => col.name === key);
    // column-specific override
  }
}
```

The column builder also linearly scans settings (`TablePanel.tsx:341-369`):

```ts
function generateColumnConfig(name: string, columnSettings: ColumnSettings[], /* ... */) {
  for (const column of columnSettings) {
    if (column.name === name) {
      // the first matching setting wins
    }
  }
  return { accessorKey: name, header: name };
}
```

Repository conventions and constraints to preserve:

- Derived collections use `useMemo`; event/state handlers use `useCallback` or
  local functions. Keep preprocessing declarative and dependency arrays narrow.
- Column generation and per-cell conditional lookup are first-wins for duplicate
  `columnSettings`: the outer builder tracks `customizedColumns`,
  `generateColumnConfig` returns its first match, and `.find` returns the first
  match. The separate `columnsFormat` reducer currently overwrites duplicates
  and is therefore last-wins for filter-label formatting. Preserve both existing
  consumer-specific behaviors rather than silently normalizing them in a perf
  change.
- Keys preserve first-seen order from table data, followed by configured columns
  that have no data. Missing configured keys are required for the `Misc/null`
  conditional-format rule; existing tests at
  `TablePanel.test.tsx:359-503` protect this behavior.
- Column-specific conditional formatting overrides global formatting only when
  it produces a config. Keep that precedence.
- `GaugeChart` is rendered inline by `generateCellContentConfig`; other embedded
  plugins and query modes are out of scope.
- Retain Apache headers and existing Testing Library/Jest patterns.

## Commands you will need

Use Node `v22.14.0` from `plugins/.nvmrc` and npm `10.9.2` from
`plugins/package.json`; if those pinned versions cannot be activated, STOP
before installing or testing. On Windows PowerShell, use `npm.cmd` when
`npm.ps1` is policy-blocked.

Run these from the application checkout root that contains `plugins/`.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix plugins ci` | exit 0; lockfile is unchanged |
| Focused tests | `npm --prefix plugins test --workspace @perses-dev/table-plugin -- --runInBand src/components/TablePanel.test.tsx` | all TablePanel tests pass |
| Typecheck | `npm --prefix plugins run type-check --workspace @perses-dev/table-plugin` | exit 0, no TypeScript errors |
| Lint | `npm --prefix plugins run lint --workspace @perses-dev/table-plugin` | exit 0, no ESLint errors |
| Build | `npm --prefix plugins run build --workspace @perses-dev/table-plugin` | table workspace builds successfully |

## Suggested executor toolkit

- Use `vercel-react-best-practices` if available to review memo boundaries and
  dependency arrays. Feature-disabled paths should return before scanning data,
  and memoized indexes should preserve reference stability until their inputs
  change.

## Scope

**In scope** (the only source/test files you should modify):

- `plugins/table/src/components/TablePanel.tsx`
- `plugins/table/src/components/TablePanel.test.tsx`

The required status-only edit to `plans/README.md` is also allowed at the end.

**Out of scope** (do not touch):

- `plugins/table/src/table-data-utils.ts`, export behavior, query modes, raw data
  construction, or transform algorithms.
- Shared table components, table models/schema, editors, embedded panels,
  selection/actions, sorting, pagination, and public configuration shape.
- Virtualization, filter UX redesign, conditional rule semantics, gauge visuals,
  dependencies, and worker/off-main-thread processing.

## Git workflow

- Work in the `plugins` repository on branch
  `advisor/013-gate-and-index-table-preprocessing`.
- Prefer one logical commit because all changes optimize the same derived-data
  pipeline. Match the observed style, for example:
  `[ENHANCEMENT] table: gate optional preprocessing`.
- Do not push or open a pull request unless the operator explicitly asks.

## Steps

### Step 0: Reinstall locked plugin dependencies and prove the table baseline

Run `npm --prefix plugins ci`, confirm
`git -C plugins diff -- package-lock.json` prints nothing, and run the existing
TablePanel suite before editing. The audited `node_modules` had mismatched
internal Perses packages, so do not diagnose product code against it.

**Verify**: the install and
`npm --prefix plugins test --workspace @perses-dev/table-plugin -- --runInBand src/components/TablePanel.test.tsx`
both exit 0 before source changes. Otherwise STOP and report the baseline.

### Step 1: Build first-wins key and settings indexes

Refactor the `keys` memo to use a local `Set<string>` for membership while
retaining the current ordered result array. Add keys in their first-seen row
order, then append configured names that are absent. This removes repeated
`result.includes` scans without changing output order.

Add a `columnSettingsByName` memo keyed only by `spec.columnSettings`. Insert a
setting only when its name is not already present so the hot-path consumers that
currently use first-match lookup remain first-wins. Keep `columnsFormat` as a
separate single pass over the ordered settings that assigns on every matching
format, preserving its current last-wins duplicate behavior; narrow its
dependency to `spec.columnSettings`, not the entire `spec` object.

Change `generateColumnConfig` to receive the already selected
`ColumnSettings | undefined` instead of scanning the full settings array. The
configured-column loop may still iterate the original array to preserve order,
but it must skip duplicate names before generation. Default columns should use
`columnSettingsByName.get(key)`.

Add a required regression test with duplicate settings for one numeric column
whose two entries use visibly different formats. Assert the rendered cell uses
the first setting (column generation remains first-wins), then open the filter
dropdown and assert its numeric label uses the second setting
(`columnsFormat` remains last-wins). This divergent compatibility behavior must
be executable coverage, not a source-review-only assertion.

**Verify**: `npm --prefix plugins test --workspace @perses-dev/table-plugin -- --runInBand src/components/TablePanel.test.tsx` -> existing column-setting tests and the new first-wins duplicate test pass.

### Step 2: Skip filter metadata when filtering is disabled

At the top of the `columnUniqueValues` memo, return an empty object when
`spec.enableFiltering` is false. Add that boolean to the dependency array. When
filtering is enabled, keep the current value eligibility, string-key
deduplication, numeric formatting, and per-column output unchanged.

Do not lazily calculate values only when a dropdown opens in this plan; that
would add state/cache invalidation complexity and alter interaction timing. The
required optimization is the feature-level gate.

Extend the integration suite to assert that the normal/default panel renders
without filter controls, then enable filtering and exercise an existing dropdown
value to prove the gated path still produces values. Reuse the existing filter
interaction pattern at `TablePanel.test.tsx:417-442`.

**Verify**: `npm --prefix plugins test --workspace @perses-dev/table-plugin -- --runInBand src/components/TablePanel.test.tsx` -> both filtering-disabled and filtering-enabled paths pass.

### Step 3: Calculate ranges only for gauge columns

Derive a memoized ordered list or `Set` of column names whose first-wins setting
has `plugin?.kind === 'GaugeChart'` **and** `hide !== true`. At the top of
`gaugeRangeByColumn`, return an empty object if there are no visible gauge
columns. Otherwise iterate only those column names, not every data key, and
retain the current numeric extraction for scalar and `PanelData` values.

Do not calculate ranges for other embedded panel kinds. Keep min/max behavior,
equal-value handling, conditional fill colors, and format fallback unchanged.

Add an integration test for an inline `GaugeChart` column using two numeric
series values. Assert both formatted gauge values render and the panel does not
load an external embedded plugin. Existing non-gauge table tests remain the
regression for the early-return path. Add a hidden-gauge case and prove it
follows the no-visible-gauge branch.

**Verify**: `npm --prefix plugins test --workspace @perses-dev/table-plugin -- --runInBand src/components/TablePanel.test.tsx` -> the inline gauge test and all non-gauge tests pass.

### Step 4: Reuse missing-key setup and indexed settings in cell configs

Inside the `cellConfigs` memo, replace the current undefined-only guard with
explicit length-aware flags:

- `hasGlobalRules` is true only when `(spec.cellSettings?.length ?? 0) > 0`;
- `hasColumnRules` examines the **first-wins** `columnSettingsByName` values and
  is true only when one effective setting has a non-empty `cellSettings` array;
- return `{}` before any row/key loop when both flags are false, including when
  `cellSettings: []` or effective per-column arrays are empty.

For the active path:

- build any missing-key template once per memo calculation, outside the row
  loop, or avoid the template entirely by iterating the ordered `keys` array and
  reading `row[key]` (which naturally yields `undefined` for a missing key);
- do not allocate/spread a full keys object for every row;
- use `columnSettingsByName.get(key)` instead of
  `spec.columnSettings?.find(...)` for every cell;
- call global `evaluateConditionalFormatting` only when `hasGlobalRules`, while
  still evaluating a column-specific non-empty rule when present;
  and
- preserve row-index keys (`${index}_${key}`) and column-over-global precedence.

Use the ordered `keys` list as the authoritative columns to evaluate. It already
includes configured no-data columns, so the existing N/A/null cases must remain
green after removing `extendRow`.

**Verify**: `npm --prefix plugins test --workspace @perses-dev/table-plugin -- --runInBand src/components/TablePanel.test.tsx` -> all filtered/unfiltered null, real zero, no-data configured column, and override cases pass.

### Step 5: Run table-package validation

Run typecheck, lint, and build after the focused suite. Fix only failures caused
by the two in-scope files.

**Verify**: `npm --prefix plugins run build --workspace @perses-dev/table-plugin` -> the table workspace builds successfully and exits 0.

## Test plan

- Extend `plugins/table/src/components/TablePanel.test.tsx`; use its existing
  provider-wrapped render helpers and `VirtuosoMockContext`.
- Add explicit coverage for first-wins duplicate column settings, filtering off
  versus on, and an inline gauge column.
- Keep and run the existing filtered conditional-format cases for missing values,
  real zero, and configured columns with no query data. They are the principal
  correctness guard for the cell-config optimization.
- Do not add wall-clock or large-fixture timing assertions. Source-shape gates
  plus functional integration tests are deterministic.

## Done criteria

- [ ] The focused TablePanel Jest suite passes, including the required first-wins-render/last-wins-filter duplicate-format case, filter gate, visible gauge, and hidden-gauge cases.
- [ ] The pinned toolchain, clean install, and pre-edit TablePanel baseline pass.
- [ ] The table workspace typecheck, lint, and build commands exit 0.
- [ ] `rg -n "spec\.columnSettings\?\.find|for \(const column of columnSettings\)" plugins/table/src/components/TablePanel.tsx` returns no matches.
- [ ] `rg -n "columnSettingsByName|gaugeColumn|hasGlobalRules|hasColumnRules" plugins/table/src/components/TablePanel.tsx` reports the first-wins settings index, visible-gauge-only path, and length-aware formatting gates.
- [ ] The `columnUniqueValues` memo has an explicit `!spec.enableFiltering` early return before any key/data loop.
- [ ] No missing-key object is built or spread inside the `for (const row of filteredData)` loop.
- [ ] Empty global/effective column rule arrays return before row iteration, and hidden gauge settings do not enter the gauge-column set.
- [ ] Existing missing/null/zero conditional formatting and first-wins column behavior remain green.
- [ ] `git -C plugins diff --name-only d7075da..HEAD` lists exactly the two in-scope plugin files, and `git -C plugins status --short` is empty after the logical commit.
- [ ] The status row in `plans/README.md` is updated, unless the dispatcher owns the index.

## STOP conditions

Stop and report back; do not improvise if:

- Live behavior differs from the documented split semantics for duplicates
  (first-wins for column/cell config, last-wins for `columnsFormat`), and
  preserving it cannot be done with the bounded indexes in this plan.
- Filter values are consumed while `spec.enableFiltering` is false by a caller
  outside the rendered filter controls.
- A non-`GaugeChart` plugin relies on `gaugeRangeByColumn`, or gauge range
  calculation must include hidden/unconfigured columns for correctness.
- Iterating `keys` does not cover a cell that conditional formatting intentionally
  evaluates today, including configured columns with no data.
- The optimization requires changing raw data construction in
  `table-data-utils.ts`, public models, or shared table components.
- A verification fails twice after a reasonable in-scope correction, or the fix
  requires a file outside Scope.

## Maintenance notes

- Preserve first-wins insertion whenever `columnSettingsByName` is reused.
  Replacing it with `new Map(settings.map(...))` would silently switch
  column/cell configuration to last-wins. Keep `columnsFormat` separate because
  that consumer already has last-wins behavior.
- Reviewers should compare the number of data scans by feature: zero filter scans
  when disabled, zero range scans without gauges, and only one settings lookup
  per cell through the map.
- If filter metadata later becomes expensive even when enabled, consider
  per-dropdown lazy computation in a separate UX-aware change with cache
  invalidation tests.
- `buildRawTableData` still performs its own plugin lookup per series. That path
  is explicitly deferred because it crosses render/export data construction and
  needs a separate plan.
