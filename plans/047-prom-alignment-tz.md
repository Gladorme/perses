# Plan 047: Investigate client-timezone dependence of Prometheus range alignment

> **Executor instructions**: This is an INVESTIGATE plan — the outcome is a
> written recommendation (and tests capturing current behavior), not
> necessarily a code change. Follow it step by step. If anything in the
> "STOP conditions" section occurs, stop and report — do not improvise. When
> done, update the status row for this plan in `plans/README.md` — unless a
> reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first from the composite workspace root)**:
> `git -C plugins diff --stat d7075da..HEAD -- Prometheus/src/plugins/prometheus-time-series-query/get-time-series-data.ts`
> (Note the capitalized `Prometheus` directory.) If the file changed since
> this plan was written, compare the "Current state" excerpt against the
> live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (changing alignment changes query results — hence
  investigate-first)
- **Depends on**: none
- **Category**: bug (investigate)
- **Planned at**: plugins commit `d7075da`, 2026-07-21

## Why this matters

The Prometheus time-series query aligns its start/end to step boundaries
**shifted by the browser's local timezone offset**. Two users viewing the
same dashboard from different timezones therefore issue range queries with
different start/end values, seeing (slightly) different data and defeating
any shared caching. Alignment also shifts for the same user across DST
changes. Grafana aligns purely in UTC epoch space. However, the offset may
be a deliberate choice to align day-scale steps to *local* midnight — that
is why this plan investigates and characterizes before changing behavior.

## Current state

- `plugins/Prometheus/src/plugins/prometheus-time-series-query/get-time-series-data.ts:83-91`:

```ts
  // Align the time range so that it's a multiple of the step
  let { start, end } = timeRange;

  const utcOffsetSec = new Date().getTimezoneOffset() * 60;

  const alignedEnd = Math.floor((end + utcOffsetSec) / step) * step - utcOffsetSec;
  const alignedStart = Math.floor((start + utcOffsetSec) / step) * step - utcOffsetSec;
  start = alignedStart;
  end = alignedEnd;
```

- `start`/`end` come from `getPrometheusTimeRange(context.timeRange)` (line
  80); `step` from `getRangeStep(...)` (line 81). Units: seconds (verify in
  the helpers, same package `utils` module).
- For steps that divide 86400 evenly, adding the local offset aligns
  boundaries to local-time-of-day; for typical dashboard steps (15s–5m) the
  offset is a whole multiple of the step for most timezones (offsets are
  minute-granular; a 15s step divides 60s, so alignment is identical) — the
  divergence appears for steps that don't divide the offset (e.g. 7m, 45s
  with :30 offsets, day-scale steps).
- Git context: run
  `git -C plugins log --oneline -5 -- Prometheus/src/plugins/prometheus-time-series-query/get-time-series-data.ts`
  and `git -C plugins log -S "getTimezoneOffset" --oneline -- Prometheus/`
  to find the commit/PR that introduced the offset — its message/linked
  issue is the best evidence of intent.

## Commands you will need

Node `v22.14.0` / npm `10.9.2` pinned; STOP if not activatable. Windows:
`npm.cmd`. Note the plugin's Jest runs with `TZ=UTC`
(`plugins/Prometheus/package.json` test script uses `cross-env TZ=UTC`),
which is exactly why this bug is invisible to the current suite — tests can
override per-case by mocking `Date.prototype.getTimezoneOffset`.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix plugins install` | exit 0 (only if node_modules missing) |
| Focused test | `npm --prefix plugins/Prometheus run test -- get-time-series-data` | exit 0 |
| Typecheck | `npm --prefix plugins/Prometheus run type-check` | exit 0 |
| Lint | `npm --prefix plugins/Prometheus run lint` | exit 0 |

## Scope

**In scope**:

- `plugins/Prometheus/src/plugins/prometheus-time-series-query/get-time-series-data.ts`
  (only if the recommendation is "change" AND the maintainer signal from
  Step 1 supports it — otherwise no code change)
- A colocated test file for the alignment behavior (create/extend)
- A written summary in this plan's status row / your report

**Out of scope** (do NOT touch):

- `getRangeStep`, min-step resolution, the query URL building.
- Other datasource plugins' alignment.

## Git workflow

- Nested `plugins` repository, branch `advisor/047-prom-alignment-tz`.
- Commit only if a code change is made; message e.g.
  `[BUGFIX] prometheus: align range queries timezone-independently`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Establish intent

Run the git archaeology commands above. Also search the upstream Perses
GitHub issues/PRs for the introducing commit hash or "getTimezoneOffset"
(read-only web search allowed). Record: was local-midnight alignment for
day-scale steps the stated goal?

**Verify**: your report cites the introducing commit hash and its message.

### Step 2: Characterization tests

Add tests that pin CURRENT behavior with a mocked timezone offset
(`jest.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-120)`
etc.):

1. step 60s, offset -120min → aligned start/end identical to offset 0
   (offset is a multiple of step — documents the no-op case);
2. step 24h (86400s), offset -120min → aligned boundary equals local
   midnight (documents the intent case);
3. step 7m (420s), offsets 0 vs -330min (IST) → different aligned starts
   (documents the divergence).

**Verify**: focused test → all pass against current code.

### Step 3: Recommend (and optionally implement)

Write the recommendation in your report:

- If Step 1 shows deliberate local-day alignment: recommend KEEP, but apply
  the offset **only when `step >= 86400`** (day-scale), making sub-day steps
  timezone-independent; implement only this narrowing, updating test 3 to
  assert equality.
- If no intent evidence: recommend full UTC alignment (drop the offset),
  implement it, and flip tests 2–3 accordingly.

Either way the dashboard's `tz` URL param / timeZone setting (not the
browser default) is the correct future source for "local" — note that as
follow-up, do not implement it.

**Verify**: focused tests, typecheck, lint exit 0; report written.

## Test plan

Three characterization tests (Step 2), adjusted per the Step 3 outcome.
Model file structure on existing tests in
`plugins/Prometheus/src/plugins/prometheus-time-series-query/` (check for an
existing `*.test.ts` beside the file; follow its mocking style for the
datasource client).

## Done criteria

- [ ] Report states the introducing commit + intent conclusion + KEEP/CHANGE recommendation.
- [ ] Characterization tests exist and pass under mocked timezone offsets.
- [ ] If code changed: `rg -n "getTimezoneOffset" plugins/Prometheus/src` shows the narrowed/removed usage; typecheck/lint/tests exit 0.
- [ ] `git -C plugins diff --name-only d7075da..HEAD` lists only in-scope paths.
- [ ] `plans/README.md` status row updated with the recommendation one-liner.

## STOP conditions

- The alignment code has moved into a shared util used by other datasources
  — report; the change surface is bigger than this plan.
- Step 1 finds an upstream issue explicitly REQUIRING browser-local
  alignment for all steps — mark the plan REJECTED (by-design) in the index
  with the citation; keep the characterization tests.
- A verification command fails twice after a reasonable in-scope fix attempt.

## Maintenance notes

- Whatever the outcome, the tests from Step 2 prevent silent behavior drift
  in future refactors of this hot query path.
- Follow-up candidate: respect the dashboard `tz` setting instead of
  `new Date().getTimezoneOffset()` wherever local alignment is kept.
