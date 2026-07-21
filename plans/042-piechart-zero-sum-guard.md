# Plan 042: Guard pie-chart percentage math against zero-sum data

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite workspace root)**:
> `git -C plugins diff --stat d7075da..HEAD -- piechart/src/utils.ts piechart/src/utils.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpt against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: plugins commit `d7075da`, 2026-07-21

## Why this matters

`calculatePercentages` divides each slice value by the total sum without a
zero check. A pie panel whose query returns all zeros (or all nulls, coerced
to 0) computes `0/0 → NaN` (or `x/0 → Infinity`), which propagates into
legend "relative" values and labels as `NaN%`, visibly broken.

## Current state

- `plugins/piechart/src/utils.ts:152-161`:

```ts
function calculatePercentages<T extends PieChartData>(data: T[]): T[] {
  const sum = data.reduce((accumulator, { value }) => accumulator + (value ?? 0), 0);
  return data.map((seriesData) => {
    const percentage = ((seriesData.value ?? 0) / sum) * 100;
    return {
      ...seriesData,
      value: Number(percentage.toFixed(4)),
    };
  });
}
```

- Caller: `PieChartTableLegendMapper.mapToLegendItems`
  (`plugins/piechart/src/utils.ts:96-114`) uses the result for the legend's
  `relative` column. `calculatePercentages` is module-private.
- Test conventions: sibling plugin has `plugins/barchart/src/utils.test.ts`
  with a `describe('calculatePercentages', ...)` suite (the barchart has its
  own similar helper) — mirror that structure. Note the barchart variant at
  `plugins/barchart/src/utils.ts:18` has the same division; it is OUT of
  scope here but mention it in your report if it also lacks a guard.

## Commands you will need

Node `v22.14.0` / npm `10.9.2` pinned (plugins repo `.nvmrc`); STOP if not
activatable. Windows: `npm.cmd`. Run from the workspace root.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix plugins install` | exit 0 (only if node_modules missing) |
| Focused test | `npm --prefix plugins/piechart run test -- utils` | exit 0 |
| Typecheck | `npm --prefix plugins/piechart run type-check` | exit 0 |
| Lint | `npm --prefix plugins/piechart run lint` | exit 0 |

## Scope

**In scope**:

- `plugins/piechart/src/utils.ts`
- `plugins/piechart/src/utils.test.ts` (create or extend)

**Out of scope** (do NOT touch):

- `plugins/barchart/src/utils.ts` (same bug family — separate follow-up).
- The ECharts `percent` formatter path (`percentageLabelFormatter` uses
  ECharts' own percent, not this helper).
- `PieChartPanel.tsx`.

## Git workflow

- Nested `plugins` repository, branch `advisor/042-piechart-zero-sum-guard`.
- One commit, e.g. `[BUGFIX] piechart: guard percentage calculation against zero sum`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Failing tests

`calculatePercentages` is not exported — export it (named export) to test
it directly, matching how barchart exports its version. Add tests:

1. all-zero values → every result value is `0` (FAILS today: `NaN`);
2. empty array → empty array;
3. mixed `[25, 75]` → `[25, 75]` (sanity, passes today);
4. null values treated as 0 (e.g. `[null, 50]` → `[0, 100]`).

**Verify**: focused test → test 1 fails with NaN. Do not commit.

### Step 2: Guard

```ts
const sum = data.reduce((accumulator, { value }) => accumulator + (value ?? 0), 0);
return data.map((seriesData) => {
  const percentage = sum === 0 ? 0 : ((seriesData.value ?? 0) / sum) * 100;
  ...
```

**Verify**: focused tests all pass; typecheck and lint exit 0.

## Test plan

Four unit tests above in `utils.test.ts`, modeled on
`plugins/barchart/src/utils.test.ts:40-...`.

## Done criteria

- [ ] `rg -n "sum === 0" plugins/piechart/src/utils.ts` → one match.
- [ ] Focused tests pass; typecheck and lint exit 0.
- [ ] `git -C plugins diff --name-only d7075da..HEAD` lists only the two in-scope paths.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- The helper was moved/rewritten (drift).
- Exporting the helper conflicts with an existing export — rename to
  `calculatePiePercentages` and note it.
- A verification command fails twice after a reasonable in-scope fix attempt.

## Maintenance notes

- `plugins/barchart/src/utils.ts:18` has the same division — flagged as
  follow-up, deliberately out of scope to keep this change reviewable.
- Negative values still produce percentages summing over/under 100; that is
  pre-existing behavior, unchanged here.
