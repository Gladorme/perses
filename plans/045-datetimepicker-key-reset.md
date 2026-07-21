# Plan 045: Reset DateTimeRangePicker state per initial range

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite workspace root)**:
> `git -C shared diff --stat f8cd4b7..HEAD -- components/src/TimeRangeSelector/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (hardening)
- **Planned at**: shared commit `f8cd4b7`, 2026-07-21

## Why this matters

`DateTimeRangePicker` seeds its editable start/end state from
`initialTimeRange` once and never resyncs. In the primary in-repo usage
(`TimeRangeSelector`'s MUI `Popover`, which unmounts its children when
closed) the component remounts per open, so the bug is masked. But the
component is **exported from the package's public API**
(`shared/components/src/TimeRangeSelector/index.ts`), and any consumer that
keeps it mounted (a `keepMounted` popover, an embedded settings panel, an
external app using `@perses-dev/components`) shows stale dates when the
surrounding time range changes. Honest classification: latent bug /
hardening, not a currently user-visible defect in the Perses app.

## Current state

- `shared/components/src/TimeRangeSelector/DateTimeRangePicker.tsx:40-50`:

```ts
export const DateTimeRangePicker = ({
  initialTimeRange,
  onChange,
  onCancel,
  timeZone,
}: AbsoluteTimeFormProps): ReactElement => {
  ...
  const [timeRange, setTimeRange] = useState<AbsoluteTimeRange>(initialTimeRange);
```

- In-repo mount site: `shared/components/src/TimeRangeSelector/TimeRangeSelector.tsx:129-146`
  — inside `<Popover open={showCustomDateSelector} ...>` with default
  `keepMounted` (false) → remount per open today.
- Existing tests: `shared/components/src/TimeRangeSelector/DateTimeRangePicker.test.tsx`
  (lines 29+, two render setups at 84 and 104) — the structural pattern to
  extend.

The idiomatic minimal fix, matching React guidance and avoiding effect-based
prop-mirroring: **have the parent remount the picker when the initial range
changes** via a `key`. That keeps the child component simple and covers all
consumers that pass a fresh `initialTimeRange`.

## Commands you will need

Node `v22.14.0` / npm `10.9.2` pinned; STOP if not activatable. Windows:
`npm.cmd`.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix shared ci` | exit 0; lockfile unchanged |
| Focused test | `npm --prefix shared run test --workspace=@perses-dev/components -- --runInBand DateTimeRangePicker TimeRangeSelector` | exit 0 |
| Typecheck | `npm --prefix shared run type-check -- --filter=@perses-dev/components` | exit 0 |
| Lint | `npm --prefix shared run lint --workspace=@perses-dev/components` | exit 0 |

## Scope

**In scope**:

- `shared/components/src/TimeRangeSelector/TimeRangeSelector.tsx` (add the
  `key`)
- `shared/components/src/TimeRangeSelector/DateTimeRangePicker.tsx` (JSDoc
  note only — document the initial-only contract)
- `shared/components/src/TimeRangeSelector/DateTimeRangePicker.test.tsx`
  (extend)

**Out of scope** (do NOT touch):

- Converting the picker to a controlled component (breaking API change).
- The validation and calendar internals.

## Git workflow

- Nested `shared` repository, branch `advisor/045-datetimepicker-key-reset`.
- One commit, e.g. `[BUGFIX] components: reset DateTimeRangePicker when initial range changes`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Key the picker in TimeRangeSelector

```tsx
<DateTimeRangePicker
  key={`${convertedTimeRange.start.valueOf()}-${convertedTimeRange.end.valueOf()}`}
  initialTimeRange={convertedTimeRange}
  ...
```

(Confirm the exact variable name in the file — the excerpt at lines 136–145
shows `initialTimeRange={convertedTimeRange}`.)

Add one JSDoc line on `DateTimeRangePicker`'s `initialTimeRange` prop:
"initial-only; remount (change `key`) to reset".

**Verify**: focused tests pass; typecheck and lint exit 0.

### Step 2: Regression test

Extend `DateTimeRangePicker.test.tsx` with a `TimeRangeSelector`-level test
(or, simpler, a direct test documenting the contract): rerender
`DateTimeRangePicker` with a different `key` and `initialTimeRange` → the
displayed start/end match the new range. Follow the existing render helpers
at lines 84/104.

**Verify**: focused tests all pass.

## Test plan

One added test as above; existing picker tests unchanged.

## Done criteria

- [ ] `rg -n "key=\{" shared/components/src/TimeRangeSelector/TimeRangeSelector.tsx` → includes the new picker key.
- [ ] Focused tests, typecheck, lint exit 0.
- [ ] `git -C shared diff --name-only f8cd4b7..HEAD` lists only in-scope paths.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- The picker has been made controlled or the Popover uses `keepMounted` —
  drift; re-evaluate which fix applies.
- A verification command fails twice after a reasonable in-scope fix attempt.

## Maintenance notes

- If a future consumer needs live-updating pickers (not initial-only), make
  the component controlled (`value`/`onChange`) as a deliberate API change —
  do not add a prop-mirroring effect.
