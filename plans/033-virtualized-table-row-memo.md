# Plan 033: Memoize VirtualizedTable rows and stabilize per-row handlers

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: in `shared\`, run
> `git diff --stat f8cd4b7..HEAD -- components/src/Table/`
> On any change, compare "Current state" excerpts to live code first;
> mismatch = STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: `shared` repo commit `f8cd4b7`, 2026-07-20

## Why this matters

The shared virtualized table (used by the table panel, trace/log views)
rebuilds its `TableRow` wrapper component and per-row event closures whenever
its memo inputs change — and `rows` changes identity on every sort/filter/
selection change. `TableRow` itself is not memoized, so every visible row
re-renders (each with MUI `sx` style resolution) even when only one row's
hover/selection state changed. Memoizing the row shell trims wide-table
re-render cost. Impact is moderate (virtualization already bounds row count),
which is why this is P3.

## Current state

Repo **`shared`**, package `@perses-dev/components`.

- `shared\components\src\Table\VirtualizedTable.tsx` — builds
  `VirtuosoTableComponents` (react-virtuoso `TableComponents`) in a `useMemo`:

```tsx
// VirtualizedTable.tsx:96-147 (current, abridged)
const VirtuosoTableComponents: TableComponents<TableData> = useMemo(() => {
  return {
    Scroller: VirtualizedTableContainer,
    Table: (props): ReactElement => { return (<InnerTable {...props} width={width} density={density} onKeyDown={keyboardNav.onTableKeyDown} onBlur={keyboardNav.onTableBlur} />); },
    TableHead,
    TableFoot,
    TableRow: ({ item, ...props }): ReactElement | null => {
      const index = props['data-index'];
      const row = rows[index];
      if (!row) { return null; }
      const rowEventOpts: TableRowEventOpts = { id: row.id, index: row.index };
      return (
        <TableRow
          {...props}
          onClick={(e) => onRowClick(e, row.id)}
          density={density}
          onMouseOver={(e) => { onRowMouseOver?.(e, rowEventOpts); }}
          onMouseOut={(e) => { onRowMouseOut?.(e, rowEventOpts); }}
        />
      );
    },
    TableBody,
  };
}, [density, keyboardNav.onTableKeyDown, keyboardNav.onTableBlur, onRowClick, onRowMouseOut, onRowMouseOver, rows, width]);
```

- `shared\components\src\Table\TableRow.tsx` — thin `forwardRef` wrapper
  around MUI `TableRow` with hover styling; NOT wrapped in `React.memo`:

```tsx
// TableRow.tsx:22-35 (current)
export const TableRow = forwardRef<HTMLTableRowElement, TableRowProps>(function TableRow(props, ref) {
  return (
    <MuiTableRow {...props} ref={ref} sx={{ ... }} />
  );
});
```

- Callers of `onRowClick` / `onRowMouseOver` etc.: `Table.tsx` in the same
  folder passes them down — check whether they're `useCallback`-stable there
  before assuming memo effectiveness.
- Existing tests: `shared\components\src\Table\Table.test.tsx`,
  `TableCell.test.tsx` — use as patterns.

## Commands you will need

Run from `C:\Users\Guillaume\Documents\Projets\perses\app\shared\components`.

| Purpose   | Command                  | Expected |
|-----------|--------------------------|----------|
| Typecheck | `npm run type-check`     | exit 0  |
| Tests     | `npm run test -- Table`  | all pass |
| Lint      | `npm run lint`           | exit 0  |

## Scope

**In scope**:
- `shared\components\src\Table\TableRow.tsx`
- `shared\components\src\Table\VirtualizedTable.tsx`
- `shared\components\src\Table\Table.tsx` — ONLY to wrap existing handler
  definitions in `useCallback` if they are currently inline (verify first)
- Test files in the same folder

**Out of scope**:
- `TableCell.tsx`, `InnerTable`, keyboard-navigation hook internals.
- react-virtuoso configuration/props other than the components map.
- The table panel plugin (`plugins\table`) — plan 030 covers it.

## Git workflow

- Repo `shared`. Branch: `advisor/033-virtualized-table-row-memo`.
- Commit style: `[ENHANCEMENT] <description>`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Memoize `TableRow`

In `TableRow.tsx`, wrap the exported component: `export const TableRow =
memo(forwardRef<...>(function TableRow(props, ref) { ... }));` (import `memo`
from react). Hoist the `sx` object to a module-level constant so it isn't a
new identity per render (the current `sx` uses theme callbacks, which are
valid in a static object — verify by type-check).

**Verify**: `npm run type-check` → exit 0.

### Step 2: Stabilize per-row props in `VirtualizedTable.tsx`

The inline `TableRow:` component in the `useMemo` recreates `onClick`/
`onMouseOver`/`onMouseOut` closures per row per render, defeating Step 1's
memo for rows whose data didn't change. Refactor the row component so its
handlers derive from stable references:

- Extract the row renderer into a named component (module level) that
  receives `rows`, `density`, `onRowClick`, `onRowMouseOver`, `onRowMouseOut`
  via react-virtuoso's `context` prop (react-virtuoso `TableComponents`
  receive `context` — pass `context={{ rows, density, onRowClick, ... }}` to
  the `TableVirtuoso` element and type it via `TableComponents<TableData,
  YourContextType>`). This removes `rows` and the handlers from the
  `VirtuosoTableComponents` memo deps entirely, so the components map is
  created once.
- Inside the extracted row component, the per-row closures remain (they carry
  `row.id`), which is fine — the win is that the components map and the row
  component type are stable, so React reconciles rows in place instead of
  remounting the tree when `rows` changes identity.

If react-virtuoso's `context` typing fights you after two attempts, fall back
to the smaller win: keep the current structure but move `rows` access behind
a ref (`rowsRef.current[index]`) updated via `useEffect`, and drop `rows`
from the memo deps. Note which path you took in the commit message.

**Verify**: `npm run type-check` → exit 0; `npm run test -- Table` → all pass.

### Step 3: Verify handler stability upstream

In `Table.tsx`, check how `onRowClick`/`onRowMouseOver`/`onRowMouseOut` are
created. If they are inline arrows recreated per render, wrap them in
`useCallback` with correct deps.

**Verify**: `npm run lint` → exit 0 (exhaustive-deps clean).

## Test plan

- Existing `Table.test.tsx` suite must pass unchanged (it pins row click /
  hover / keyboard behavior — if it fails, your refactor changed behavior).
- Add a test asserting row interaction still works after the refactor: click
  a row → `onRowClick` called with the row id (may already exist — check
  first; if present, no new test needed for that case).
- Verification: `npm run test -- Table` → all pass.

## Done criteria

ALL must hold (run in `shared\components`):

- [ ] `npm run type-check` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm run test` exits 0
- [ ] `TableRow.tsx` exports a `memo(...)`-wrapped component (grep `memo(` in the file)
- [ ] `git status` shows only in-scope files modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Excerpts don't match live code (drift).
- react-virtuoso's `context` approach AND the ref fallback both fail
  type-check/tests after two attempts each.
- Any visible behavior change in the Table test suite (selection column,
  keyboard nav) that isn't a pure identity assertion.

## Maintenance notes

- Reviewer: verify sticky header, checkbox-selection column, and keyboard
  navigation still work (these flow through the components map you touched).
- Deferred: memoizing `TableCell` and cell-level rendering — profile first;
  virtuoso already bounds the visible set, so gains may be small.
