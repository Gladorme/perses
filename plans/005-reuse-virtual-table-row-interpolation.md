# Plan 005: Reuse virtual-table row interpolation across cells

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md`, unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**: `git -C shared diff --stat f8cd4b7..HEAD -- components/src/Table/VirtualizedTable.tsx components/src/Table/Table.test.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `f8cd4b7`, 2026-07-21

## Why this matters

Every visible virtual-table cell currently enumerates and filters the entire row
to build the same data-link interpolation object. For a visible row with `C`
columns, that repeats row-wide work `C` times and the reducer's object spread
copies an increasingly large accumulator. Building one map per rendered row and
passing the same object to each cell removes that multiplicative allocation while
preserving data-link interpolation and virtualization behavior.

## Current state

- `components/src/Table/VirtualizedTable.tsx` renders visible rows through
  `TableVirtuoso`'s `itemContent` callback.
- `components/src/Table/TableCell.tsx:130-138` memoizes replacement of
  `${__data.fields[...]}` patterns from the supplied
  `adjacentCellsValuesMap`; this consumer contract must not change.
- `components/src/Table/Table.test.tsx` is the integration suite for virtualized
  rendering and uses `VirtuosoMockContext`; add the regression there.
- `components/src/Table/TableCell.test.tsx:17-33` is an existing lower-level
  interpolation example. Use its URL syntax, but do not modify that file.

Current per-cell work (`components/src/Table/VirtualizedTable.tsx:228-304`):

```tsx
itemContent={(index) => {
  const row = rows[index];
  if (!row) {
    return null;
  }

  return (
    <>
      {row.getVisibleCells().map((cell, i, cells) => {
        // ...render metadata...
        const adjacentCellsValuesMap = Object.entries(row.original as Record<string, unknown>)
          ?.filter(([_, value]) => ['string', 'number'].includes(typeof value))
          .reduce(
            (acc, [key, value]) => ({
              ...acc,
              [key]: String(value),
            }),
            {}
          );

        return (
          <TableCell adjacentCellsValuesMap={adjacentCellsValuesMap}>
            {/* cell content */}
          </TableCell>
        );
      })}
    </>
  );
}}
```

The data-link consumer (`components/src/Table/TableCell.tsx:130-138`):

```ts
const modifiedDataLink = useMemo((): DataLink | undefined => {
  if (!dataLink) return undefined;

  if (adjacentCellsValuesMap && hasDataFieldPatterns(dataLink.url)) {
    const { text } = replaceDataFields(dataLink.url, adjacentCellsValuesMap, { urlEncode: true });
    return { ...dataLink, url: text };
  }
  return dataLink;
}, [dataLink, adjacentCellsValuesMap]);
```

Repository conventions to preserve:

- Virtualized table tests render through `renderTable` and
  `VirtuosoMockContext`; see `components/src/Table/Table.test.tsx:81-129`.
- Table data links use the literal field syntax shown in
  `components/src/Table/TableCell.test.tsx:25-31` and URL-encode replacements.
- Keep the row-derived object ephemeral. Virtualized rows can be recycled, so do
  not introduce a module cache, `WeakMap`, or state keyed only by virtual index.
- Source and new test code retain the Apache license header and existing
  formatting conventions.

## Commands you will need

Use Node `v22.14.0` from `shared/.nvmrc` and npm `10.9.2` from
`shared/package.json`; if those pinned versions cannot be activated, STOP
before installing or testing. On Windows PowerShell, use `npm.cmd` when
`npm.ps1` is policy-blocked.

Run these from the application checkout root that contains `shared/`.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix shared ci` | exit 0; lockfile is unchanged |
| Focused tests | `npm --prefix shared test --workspace @perses-dev/components -- --runInBand src/Table/Table.test.tsx src/Table/TableCell.test.tsx` | both selected suites pass |
| Typecheck | `npm --prefix shared run type-check -- --filter=@perses-dev/components` | exit 0 after Turbo runs upstream builds, with no TypeScript errors |
| Lint | `npm --prefix shared run lint --workspace @perses-dev/components` | exit 0, no ESLint errors |
| Build | `npm --prefix shared run build -- --filter=@perses-dev/components` | Turbo builds the components package and its upstream dependencies successfully |

## Suggested executor toolkit

- Use `vercel-react-best-practices` if available to review allocation placement
  in the render callback. This is a row-local calculation, not a candidate for
  component state or a long-lived cache.

## Scope

**In scope** (the only source/test files you should modify):

- `shared/components/src/Table/VirtualizedTable.tsx`
- `shared/components/src/Table/Table.test.tsx`

The required status-only edit to `plans/README.md` is also allowed at the end.

**Out of scope** (do not touch):

- `shared/components/src/Table/TableCell.tsx` and its public props.
- `shared/components/src/Table/TableCell.test.tsx`; it is an exemplar and is
  already covered by the focused command.
- Virtualization, keyboard navigation, pagination, selection, cell rendering,
  data-link pattern syntax, URL encoding, or table model types.
- Cross-row caching, new dependencies, or changes to non-scalar interpolation
  policy.

## Git workflow

- Work in the `shared` repository on branch
  `advisor/005-reuse-virtual-table-row-interpolation`.
- Keep this as one logical commit. Match the observed commit style, for example:
  `[ENHANCEMENT] table: reuse row data-link interpolation values`.
- Do not push or open a pull request unless the operator explicitly asks.

## Steps

### Step 0: Reinstall locked shared dependencies and prove the table baseline

Run `npm --prefix shared ci`, confirm
`git -C shared diff -- package-lock.json` prints nothing, and run the existing
Table/TableCell focused tests before editing. Do not rely on the incomplete
`node_modules` observed during planning.

**Verify**: the install and
`npm --prefix shared test --workspace @perses-dev/components -- --runInBand src/Table/Table.test.tsx src/Table/TableCell.test.tsx`
both exit 0 before source changes. Otherwise STOP and report the baseline.

### Step 1: Add a row-level interpolation builder

In `VirtualizedTable.tsx`, add a small module-local function named
`buildAdjacentCellsValuesMap` above `VirtualizedTable`. It should accept
`Record<string, unknown>`, return `Record<string, string>`, enumerate the row
once, retain only primitive strings and numbers, and convert retained values
with `String(value)`.

Use a mutable local result plus a `for...of` loop, or `Object.fromEntries` with
one filtering pass. Do not retain the current reducer object spread, which makes
construction itself quadratic in the number of retained fields. Preserve the
current exclusion of booleans, objects, null, and undefined.

**Verify**: `npm --prefix shared run type-check -- --filter=@perses-dev/components` -> Turbo builds upstream dependencies and the helper compiles with no errors.

### Step 2: Build once per rendered row and reuse the reference

Inside `itemContent`, after the missing-row guard and before
`row.getVisibleCells().map`, call
`buildAdjacentCellsValuesMap(row.original as Record<string, unknown>)` exactly
once. Pass that one object to every `TableCell` in the row. Do not calculate it
inside the cell callback, and do not memoize it beyond the current `itemContent`
invocation.

Optionally store `row.getVisibleCells()` in a local `visibleCells` variable so
the same array supplies both `.map` and the first/last-column checks. Do not
change cell keys, positions, focus callbacks, descriptions, or configuration
lookup.

**Verify**: `rg -n "buildAdjacentCellsValuesMap\(row\.original" shared/components/src/Table/VirtualizedTable.tsx` -> exactly one call is reported, located before the visible-cell `.map` body.

### Step 3: Cover row-to-cell interpolation through the virtual table

Extend `Table.test.tsx` with an integration test that renders one row containing
at least one string field and one number field, and two visible columns whose
`dataLink` values reference adjacent fields. Assert the rendered anchors' exact
`href` values, including URL encoding for a string containing a space or slash.
This proves the row-level map reaches every cell and preserves both numeric and
string interpolation.

Keep using the existing `renderTable` helper and `VirtuosoMockContext`. Do not
test implementation call counts by spying on `Object.entries`; such a test would
be global and brittle. The source-shape gate in Step 2 provides the deterministic
one-call check.

**Verify**: `npm --prefix shared test --workspace @perses-dev/components -- --runInBand src/Table/Table.test.tsx src/Table/TableCell.test.tsx` -> the new integration assertion and existing `TableCell` interpolation test pass.

### Step 4: Run component validation

Run lint and build after the focused test and typecheck. Fix only failures caused
by the two in-scope files.

**Verify**: `npm --prefix shared run build -- --filter=@perses-dev/components` -> the component workspace and upstream dependencies build successfully and exit 0.

## Test plan

- Add one integration test to `shared/components/src/Table/Table.test.tsx` using
  the existing virtualized `renderTable` fixture.
- Cover one numeric adjacent field, one string adjacent field, multiple cells in
  the same row, and exact URL-encoded `href` output.
- Continue running `TableCell.test.tsx` as the lower-level contract test even
  though it is not modified.
- Avoid timing or global `Object.entries` spy assertions; use the exact source
  call-site check plus functional output.

## Done criteria

- [ ] Focused table tests pass, including the new row-level interpolation case.
- [ ] The pinned toolchain, clean install, and pre-edit table baseline pass.
- [ ] Components typecheck, lint, and build commands exit 0.
- [ ] `rg -n "buildAdjacentCellsValuesMap\(row\.original" shared/components/src/Table/VirtualizedTable.tsx` returns exactly one match.
- [ ] `rg -n "\.reduce\(" shared/components/src/Table/VirtualizedTable.tsx` does not report the old adjacent-cell reducer.
- [ ] The interpolation map is created before the visible-cell `.map` and the same reference is passed to all cells in that row.
- [ ] `git -C shared diff --name-only f8cd4b7..HEAD` lists exactly the two in-scope shared files, and `git -C shared status --short` is empty after the logical commit.
- [ ] The status row in `plans/README.md` is updated, unless the dispatcher owns the index.

## STOP conditions

Stop and report back; do not improvise if:

- `itemContent` no longer owns both `row.original` and all visible cells, or the
  current excerpt has otherwise drifted.
- `TableCell` no longer accepts `adjacentCellsValuesMap`, or data-link replacement
  no longer uses primitive string values.
- Correctness appears to require caching maps between virtual-row renders or
  changing the public `TableCell` API.
- Existing behavior intentionally includes booleans, objects, null, or undefined
  in interpolation; this plan assumes the current string/number-only contract.
- A verification fails twice after a reasonable in-scope correction, or the fix
  requires a file outside Scope.

## Maintenance notes

- The map should remain row-local so recycled virtual rows cannot reuse stale
  values. If profiling later shows construction across rerenders is still
  material, first establish a stable row identity and invalidation contract.
- Reviewers should confirm the helper is called outside the cell `.map` and that
  no object-spread reducer remains.
- This plan deliberately does not change `TableCell` memoization. Its dependency
  on the row map remains correct even though all cells in a row now share the
  same map reference.
