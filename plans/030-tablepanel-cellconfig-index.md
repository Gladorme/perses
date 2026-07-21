# Plan 030: Index TablePanel column settings so cell-config generation is O(rows × cols)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: in `plugins\`, run
> `git diff --stat d7075da..HEAD -- table/src/components/TablePanel.tsx`
> On any change, compare "Current state" excerpts to live code first;
> mismatch = STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: `plugins` repo commit `d7075da`, 2026-07-20

## Why this matters

The table panel's `cellConfigs` memo does, for **every cell**: a linear
`Array.find` over `spec.columnSettings` plus a per-row rebuild of a
`keysAsObj` scaffold from all keys. With big query results (thousands of
rows × dozens of columns × many column settings) this is
O(rows × cols × settings) per data/filter change and can dominate refresh
time. Pre-indexing settings by column name and hoisting the per-row scaffold
makes it O(rows × cols) with O(1) lookups, with zero behavior change.

## Current state

Repo **`plugins`**, package `@perses-dev/table-plugin`.

- `plugins\table\src\components\TablePanel.tsx` — the panel. Relevant memo:

```ts
// TablePanel.tsx:598-646 (current, abridged)
const cellConfigs: TableCellConfigs = useMemo(() => {
  if (spec.cellSettings === undefined && !spec.columnSettings?.some((col) => col.cellSettings !== undefined)) {
    return {};
  }
  const result: TableCellConfigs = {};
  let index = 0;
  for (const row of filteredData) {
    // Transforming key to object to extend the row with undefined values ...
    const keysAsObj = keys.reduce(
      (acc, key) => { acc[key] = undefined; return acc; },
      {} as Record<string, undefined>
    );
    const extendRow = { ...keysAsObj, ...row };
    for (const [key, value] of Object.entries(extendRow)) {
      let cellConfig = evaluateConditionalFormatting(value, spec.cellSettings ?? []);
      const columnSetting = spec.columnSettings?.find((col) => col.name === key);   // O(settings) per cell
      if (columnSetting?.cellSettings?.length) {
        const columnCellConfig = evaluateConditionalFormatting(value, columnSetting.cellSettings);
        if (columnCellConfig) { cellConfig = columnCellConfig; }
      }
      if (cellConfig) { result[`${index}_${key}`] = cellConfig; }
    }
    index++;
  }
  return result;
}, [filteredData, keys, spec.cellSettings, spec.columnSettings]);
```

- `filteredData` is itself a memo at `:580-595` (filtering by
  `columnFilters`) — leave it alone.
- `evaluateConditionalFormatting` is a pure helper imported in this file —
  don't change it.
- **Semantic detail to preserve**: `spec.columnSettings?.find(col => col.name === key)`
  returns the **first** matching setting for a column name (there can be
  duplicate names with different headers — see comment at `:623`). Your index
  must keep first-match-wins.
- Existing test: `plugins\table\src\components\TablePanel.test.tsx`.

## Commands you will need

Run from `C:\Users\Guillaume\Documents\Projets\perses\app\plugins\table`.

| Purpose   | Command             | Expected |
|-----------|---------------------|----------|
| Install   | `npm install` (from `plugins\` root, only if needed) | exit 0 |
| Typecheck | `npm run type-check` | exit 0  |
| Tests     | `npm run test`       | all pass |
| Lint      | `npm run lint`       | exit 0  |

## Scope

**In scope**:
- `plugins\table\src\components\TablePanel.tsx` (only the `cellConfigs` memo
  and, if needed, a small memo above it)
- `plugins\table\src\components\TablePanel.test.tsx` (add tests)

**Out of scope**:
- `filteredData` memo, sorting, pagination, column generation logic in the
  same file.
- `evaluateConditionalFormatting` and its module.
- `@perses-dev/components` Table internals (that is plan 033).

## Git workflow

- Repo `plugins`. Branch: `advisor/030-tablepanel-cellconfig-index`.
- Commit style: `[ENHANCEMENT] <description>`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a settings index and hoist the key scaffold

Inside the `cellConfigs` memo (before the row loop), build once:

```ts
// First-match-wins index of column settings that carry cellSettings
const columnCellSettings = new Map<string, NonNullable<ColumnSettings['cellSettings']>>();
for (const col of spec.columnSettings ?? []) {
  if (col.cellSettings?.length && !columnCellSettings.has(col.name)) {
    columnCellSettings.set(col.name, col.cellSettings);
  }
}
// Hoisted scaffold — same object reused; spread copies it per row
const keysAsObj = keys.reduce((acc, key) => { acc[key] = undefined; return acc; }, {} as Record<string, undefined>);
```

(Use the actual exported type name for column settings from the table model —
check the imports at the top of `TablePanel.tsx`; if the type is named
differently, e.g. `ColumnSettings` vs `ColumnDefinition`, use what the file
imports.)

### Step 2: Use the index in the cell loop

Replace the per-cell `find` with `columnCellSettings.get(key)`:

```ts
const cellSettingsForColumn = columnCellSettings.get(key);
if (cellSettingsForColumn) {
  const columnCellConfig = evaluateConditionalFormatting(value, cellSettingsForColumn);
  if (columnCellConfig) { cellConfig = columnCellConfig; }
}
```

Note the current code checks `columnSetting?.cellSettings?.length` — the
index already guarantees non-empty, so the `get` + truthy check is
equivalent. Keep the `extendRow` spread (`{ ...keysAsObj, ...row }`) — the
hoisted scaffold is shared but the spread copies it, so no cross-row
mutation is possible. Keep the memo deps unchanged.

**Verify**: `npm run type-check` → exit 0; `npm run test` → all pass.

### Step 3: Lint

**Verify**: `npm run lint` → exit 0.

## Test plan

Add to `TablePanel.test.tsx` (model on existing tests in that file), if not
already covered:
1. Global `cellSettings` apply to matching cells (happy path).
2. Column-specific `cellSettings` override global ones for that column.
3. **Duplicate column names**: two `columnSettings` entries with the same
   `name`, both with `cellSettings` — the FIRST one's config wins (pins the
   first-match-wins semantics the index must preserve).
4. A column present in `keys` but absent from a row gets the `undefined`
   (Misc/null) conditional treatment — pins the `keysAsObj` scaffolding.

Verification: `npm run test` → all pass including new tests.

## Done criteria

ALL must hold (run in `plugins\table`):

- [ ] `npm run type-check` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm run test` exits 0, incl. the duplicate-column-name test
- [ ] `TablePanel.tsx` cellConfigs memo contains no `.find(` call (grep the memo body)
- [ ] `git status` shows only in-scope files modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The memo body differs from the excerpt (drift).
- You discover `evaluateConditionalFormatting` mutates its inputs (would make
  sharing the settings arrays via the Map unsafe).
- The duplicate-column-name test reveals the current behavior is NOT
  first-match-wins (then the excerpt's assumption is wrong — report, don't guess).

## Maintenance notes

- If per-cell formatting grows (e.g. regex conditions), consider precompiling
  conditions in the same index pass.
- Reviewer: verify no behavior change by comparing rendered cell configs on a
  fixture with global + column + duplicate-name settings.
- Deferred: the O(rows) loop itself is irreducible while configs are per-row;
  virtualization-aware lazy config generation would be a bigger refactor.
