# Plan 018: Stop mutating the shared time-presets array during render

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite workspace root)**:
> `git -C shared diff --stat f8cd4b7..HEAD -- plugin-system/src/components/TimeRangeControls/TimeRangeControls.tsx plugin-system/src/components/TimeRangeControls/TimeRangeControls.test.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: shared commit `f8cd4b7`, 2026-07-21

## Why this matters

`TimeRangeControls` pushes into the time-presets array it receives from
`useTimeRangeOptionsSetting()` **during render**. When no `timePresets` prop
override is given, that array is the one owned by `TimeRangeSettingsContext` —
either the module-level `defaultTimeRangeSettings.options` singleton or the
provider's memoized `ctx.options`
(`shared/plugin-system/src/runtime/TimeRangeProvider/TimeRangeSettingsProvider.tsx:18-23,95-100`).
Render-phase mutation of shared state violates React's purity contract: every
time the current `pastDuration` is not in the preset list, a new entry is
appended to the *shared* array, so entries accumulate across time-range
changes and leak into every other consumer of the settings context (and, for
the module singleton, across independent provider trees). React 18 concurrent
re-renders and StrictMode double-rendering multiply the effect.

## Current state

- `shared/plugin-system/src/components/TimeRangeControls/TimeRangeControls.tsx`
  — the offending mutation at lines 83–89:

```ts
  const timePresetsValue = useTimeRangeOptionsSetting(timePresets);
  ...
  // add time preset if one does not match duration given in time range
  if (
    'pastDuration' in timeRange &&
    !timePresetsValue.some((option) => option.value.pastDuration === timeRange['pastDuration'])
  ) {
    timePresetsValue.push(buildRelativeTimeOption(timeRange['pastDuration']));
  }
```

- `timePresetsValue` is used further down as the option list passed to the
  time-range selector component in the JSX.
- `buildRelativeTimeOption` is already imported in this file.
- `shared/plugin-system/src/components/TimeRangeControls/TimeRangeControls.test.tsx`
  exists and is the structural pattern for tests of this component (it renders
  inside `TimeRangeProviderWithQueryParams` / `TimeRangeProviderBasic`).

## Commands you will need

Use Node `v22.14.0` (`shared/.nvmrc`) and npm `10.9.2`; if those pinned
versions cannot be activated, STOP before installing or testing. On Windows
PowerShell, use `npm.cmd` when `npm.ps1` is policy-blocked.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix shared ci` | exit 0; lockfile unchanged |
| Focused test | `npm --prefix shared run test --workspace=@perses-dev/plugin-system -- --runInBand TimeRangeControls.test.tsx` | exit 0 |
| Typecheck | `npm --prefix shared run type-check -- --filter=@perses-dev/plugin-system` | exit 0 |
| Lint | `npm --prefix shared run lint --workspace=@perses-dev/plugin-system` | exit 0 |

## Scope

**In scope**:

- `shared/plugin-system/src/components/TimeRangeControls/TimeRangeControls.tsx`
- `shared/plugin-system/src/components/TimeRangeControls/TimeRangeControls.test.tsx`

**Out of scope** (do NOT touch):

- `TimeRangeSettingsProvider.tsx` — freezing or restructuring the settings
  context is not needed for this fix.
- The dropdown/selector component consuming the options.
- `useTimeRangeOptionsSetting` and its siblings.

## Git workflow

- Nested `shared` repository, branch
  `advisor/018-immutable-time-presets`.
- One commit, e.g. `[BUGFIX] plugin-system: stop mutating shared time presets during render`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Add a regression test

In `TimeRangeControls.test.tsx`, add a test that:

1. renders `TimeRangeControls` with an explicit `timePresets` prop array that
   does NOT contain the provider's current relative time range (the existing
   tests show how to set the initial time range);
2. asserts after render that the array instance passed as the prop still has
   its original length (`expect(presets).toHaveLength(n)`) — i.e. the
   component did not mutate its input;
3. asserts the extra option IS offered in the rendered UI (open the
   selector and assert the current duration appears), proving the derived
   list still includes the synthesized preset.

**Verify**: focused test command → the length assertion FAILS against current
code (array grew by one). Do not commit this state.

### Step 2: Derive instead of mutate

Replace the render-phase `push` with a derived, memoized list:

```ts
const timePresetOptions = useMemo(() => {
  if (
    'pastDuration' in timeRange &&
    !timePresetsValue.some((option) => option.value.pastDuration === timeRange.pastDuration)
  ) {
    return [...timePresetsValue, buildRelativeTimeOption(timeRange.pastDuration)];
  }
  return timePresetsValue;
}, [timePresetsValue, timeRange]);
```

Use `timePresetOptions` everywhere `timePresetsValue` was used below in the
JSX. Add `useMemo` to the React import if absent.

**Verify**: focused test command → exit 0, both assertions pass.

### Step 3: Package checks

**Verify**: typecheck, lint, and
`npm --prefix shared run test --workspace=@perses-dev/plugin-system -- --runInBand TimeRangeControls.test.tsx`
all exit 0.

## Test plan

- New test in `TimeRangeControls.test.tsx` (pattern: the existing tests in the
  same file): input-array immutability + synthesized preset still rendered.
- Keep all existing tests passing unchanged.

## Done criteria

- [ ] `rg -n "timePresetsValue.push" shared/plugin-system/src/components/TimeRangeControls/TimeRangeControls.tsx` → no matches.
- [ ] Focused test suite passes; typecheck and lint exit 0.
- [ ] `git -C shared diff --name-only f8cd4b7..HEAD` lists only the two in-scope paths.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- The mutation block is no longer present (drift — someone fixed it).
- The selector consuming the options requires a stable array identity across
  renders in a way `useMemo` cannot satisfy (unexpected — report).
- A verification command fails twice after a reasonable in-scope fix attempt.

## Maintenance notes

- Reviewers: confirm no other render-phase mutation of hook-returned arrays
  exists in this component after the change.
- If a "custom preset" feature is added later, it belongs in provider state,
  not in this derived list.
