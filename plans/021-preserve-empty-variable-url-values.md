# Plan 021: Preserve explicit empty variable values through URL hydration

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite workspace root)**:
> `git -C shared diff --stat f8cd4b7..HEAD -- dashboards/src/context/VariableProvider/query-params.ts dashboards/src/context/VariableProvider/query-params.test.ts dashboards/src/context/VariableProvider/hydrationUtils.ts dashboards/src/context/VariableProvider/hydrationUtils.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: shared commit `f8cd4b7`, 2026-07-21

## Why this matters

Dashboard URLs encode variable values as `var-<name>` query params so a URL
fully reproduces a dashboard state. The decode/hydration pipeline drops falsy
values at three points, so an explicitly empty value (e.g. a TextVariable
deliberately set to `""`) cannot round-trip: sharing such a URL hydrates the
dashboard to the variable's *default* instead of the empty value the sender
saw. The URL is silently not a faithful representation of state.

## Current state

All in `shared/dashboards/src/context/VariableProvider/`:

- `query-params.ts:30-33` — decode collapses empty string to `null`:

```ts
export function decodeVariableValue(value: string): VariableValue {
  if (!value) {
    return null;
  }
```

- `query-params.ts:60-72` — initial-value extraction drops all falsy params:

```ts
export function getInitalValuesFromQueryParameters(
  queryParamValues: Record<string, VariableValue>
): Record<string, VariableValue> {
  const values: Record<string, VariableValue> = {};
  Object.keys(queryParamValues).forEach((key) => {
    const value = queryParamValues[key];
    if (!value) {
      return;
    }
    ...
```

- `hydrationUtils.ts:86-87` and `hydrationUtils.ts:106-108` — hydration maps
  falsy params to `null` (twice, external and local):

```ts
const param = initialValues[name];
const initialValue = param ? param : null;
```

and `hydrateVariableState` (`hydrationUtils.ts:27,31`) then falls back to the
definition default via `initialValue ?? variable.spec.value` /
`?? variable.spec.defaultValue ?? null`, so a dropped empty string becomes the
default value.

Distinguishing rule to implement: **absent param** (`undefined`/`null` from
use-query-params) means "not specified — use defaults"; **present but empty**
(`""`) is a legitimate explicit value and must be preserved.

Existing tests: `query-params.test.ts` and `hydrationUtils.test.ts` colocated
in the same directory — extend them; they are the structural pattern (plain
Jest unit tests).

## Commands you will need

Node `v22.14.0` / npm `10.9.2` pinned; STOP if not activatable. Windows:
`npm.cmd`.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix shared ci` | exit 0; lockfile unchanged |
| Focused tests | `npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand query-params.test.ts hydrationUtils.test.ts` | exit 0 |
| Typecheck | `npm --prefix shared run type-check -- --filter=@perses-dev/dashboards` | exit 0 |
| Lint | `npm --prefix shared run lint --workspace=@perses-dev/dashboards` | exit 0 |
| Full package tests | `npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand` | exit 0 |

## Scope

**In scope**:

- `shared/dashboards/src/context/VariableProvider/query-params.ts`
- `shared/dashboards/src/context/VariableProvider/query-params.test.ts`
- `shared/dashboards/src/context/VariableProvider/hydrationUtils.ts`
- `shared/dashboards/src/context/VariableProvider/hydrationUtils.test.ts`

**Out of scope** (do NOT touch):

- `VariableProvider.tsx` — plan 022 restructures the store/URL coupling; do
  not modify it here (both `getInitalValuesFromQueryParameters` call sites
  live there and keep their signatures).
- `encodeVariableValue` list encoding (`join(',')`) — changing the wire format
  breaks existing URLs.
- The `ALL_VALUE` handling.

## Git workflow

- Nested `shared` repository, branch
  `advisor/021-preserve-empty-variable-url-values`.
- One commit, e.g. `[BUGFIX] dashboards: preserve explicit empty variable values from URL`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Add failing round-trip tests

In `query-params.test.ts`:

1. `decodeVariableValue('')` returns `''` (currently returns `null`);
2. `getInitalValuesFromQueryParameters({ 'var-foo': '' })` returns
   `{ foo: '' }` (currently `{}`);
3. absent/`undefined`/`null` params are still skipped.

In `hydrationUtils.test.ts`:

4. hydrating a `TextVariable` with default `'abc'` and initial value `''`
   yields state value `''`, not `'abc'`;
5. hydrating with NO initial value still yields the default.

**Verify**: focused tests → new tests FAIL. Do not commit this state.

### Step 2: Preserve explicit empties

- `decodeVariableValue`: return `null` only for `null`/`undefined` input;
  return `''` for empty string (keep the `split(',')` path intact — note
  `''.split(',')` would give `['']`, so handle the empty string *before*
  splitting by returning it directly).
- `getInitalValuesFromQueryParameters`: replace `if (!value) return;` with
  `if (value === undefined || value === null) return;`.
- `hydrationUtils.ts` (both sites): replace
  `const initialValue = param ? param : null;` with
  `const initialValue = param ?? null;` and in `hydrateVariableState` keep
  `initialValue ?? <default>` semantics (already `??`-based, so `''` now
  survives).

**Verify**: focused tests → all pass, including pre-existing ones.

### Step 3: Package checks

**Verify**: typecheck, lint, full dashboards test suite all exit 0.

## Test plan

Five unit tests from Step 1, colocated in the two existing test files,
following their existing `describe/it` structure.

## Done criteria

- [ ] `rg -n "param \? param : null" shared/dashboards/src/context/VariableProvider/hydrationUtils.ts` → no matches.
- [ ] `rg -n "if \(!value\)" shared/dashboards/src/context/VariableProvider/query-params.ts` → no matches in the two fixed functions.
- [ ] Focused and full dashboards tests pass; typecheck and lint exit 0.
- [ ] `git -C shared diff --name-only f8cd4b7..HEAD` lists only the four in-scope paths.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- The decode/hydration code has been restructured (drift — check whether plan
  022 or plan 027 landed first and touched these paths).
- Preserving `''` breaks an existing test that asserts empty→default
  behavior *by design* — report the test; the team may have intended
  empty-means-default (then this plan should be REJECTED in the index, not
  worked around).
- A verification command fails twice after a reasonable in-scope fix attempt.

## Maintenance notes

- The wire format still cannot distinguish an empty LIST from an empty STRING
  (`var-foo=` decodes to `''`). That ambiguity predates this plan and is
  accepted; document it in a code comment at `decodeVariableValue`.
- Reviewers: check dashboards that rely on "empty param falls back to
  default" URLs in the wild — behavior change is intentional but user-visible.
