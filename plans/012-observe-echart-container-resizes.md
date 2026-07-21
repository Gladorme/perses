# Plan 012: Observe EChart container resizes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md`, unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**: `git -C shared diff --stat f8cd4b7..HEAD -- components/src/EChart/EChart.tsx components/src/EChart/EChart.test.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `f8cd4b7`, 2026-07-21

## Why this matters

The chart currently resizes on global window events and on `sx`/`style` object
identity changes, not when its actual container dimensions change. Dashboard
grid changes, side panels, flex layout, or a stable style object can therefore
leave the ECharts canvas stale, while recreated style objects can schedule
unnecessary debounced resizes. Observing the container directly makes resize
work follow real layout changes, removes the prop-identity workaround, and
coalesces bursty observations to one chart resize per animation frame.

## Current state

- `components/src/EChart/EChart.tsx` initializes and disposes the ECharts
  instance in a `useLayoutEffect`.
- The same file has two independent resize mechanisms: a debounced global
  window listener and a second debounced effect keyed by `sx` and `style`.
- The second effect's comments already identify that its recreated debounce and
  prop-identity trigger are unreliable.
- `components/src/EChart/EChart.test.tsx` does not exist; create it using the
  package-wide ECharts mock configured by
  `components/src/test/setup-tests.ts`.
- `components/src/TimeSeriesTooltip/TimeChartTooltip.tsx:62` demonstrates the
  repository's existing use of resize observation for layout-derived UI. This
  plan uses the native observer directly so no package dependency changes are
  needed.

Current window resize effect (`components/src/EChart/EChart.tsx:210-221`):

```ts
useLayoutEffect(() => {
  const updateSize = debounce(() => {
    if (!chartElement.current) return;
    chartElement.current.resize();
  }, 200);
  window.addEventListener('resize', updateSize);
  updateSize();
  return (): void => {
    window.removeEventListener('resize', updateSize);
  };
}, []);
```

Current prop-identity workaround (`components/src/EChart/EChart.tsx:237-255`):

```ts
// TODO: re-evaluate how this is triggered. It's technically working right
// now because the sx prop is an object that gets re-created...
useEffect(() => {
  const updateSize = debounce(
    () => {
      if (!chartElement.current) return;
      chartElement.current.resize();
    },
    200,
    { leading: true }
  );
  updateSize();
}, [sx, style]);
```

Repository conventions and constraints to preserve:

- ECharts setup and teardown are layout-sensitive and currently use
  `useLayoutEffect`; keep observation in the same instance/container lifecycle.
- The component is generic and wrapped in `memo`; do not change its public
  props, event binding, option equality, sync group, theme, or renderer behavior.
- The test environment automatically mocks `echarts/core` in
  `components/src/test/setup-tests.ts`; configure the mocked `init` return value
  instead of trying to render a real canvas.
- Model the component-test structure on
  `components/src/Table/Table.test.tsx:85-119`: keep a small local render helper,
  use Testing Library's `render`/`rerender`/`unmount`, and assert observable calls
  rather than implementation snapshots.
- The component library does not declare `use-resize-observer` as a dependency.
  Use the native `ResizeObserver` API and a small built-in fallback rather than
  changing manifests or lockfiles.
- Retain Apache headers and the repository's Testing Library/Jest conventions.

## Commands you will need

Use Node `v22.14.0` from `shared/.nvmrc` and npm `10.9.2` from
`shared/package.json`; if those pinned versions cannot be activated, STOP
before installing or testing. On Windows PowerShell, use `npm.cmd` when
`npm.ps1` is policy-blocked.

Run these from the application checkout root that contains `shared/`.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix shared ci` | exit 0; lockfile is unchanged |
| Focused tests | `npm --prefix shared test --workspace @perses-dev/components -- --runInBand src/EChart/EChart.test.tsx` | all new EChart lifecycle/resize tests pass |
| Typecheck | `npm --prefix shared run type-check -- --filter=@perses-dev/components` | exit 0 after Turbo runs upstream builds, with no TypeScript errors |
| Lint | `npm --prefix shared run lint --workspace @perses-dev/components` | exit 0, no ESLint errors |
| Build | `npm --prefix shared run build -- --filter=@perses-dev/components` | Turbo builds the components package and its upstream dependencies successfully |

## Suggested executor toolkit

- Use `vercel-react-best-practices` if available to review effect ownership and
  cleanup. The observer, scheduled frame, and ECharts instance must share one
  predictable lifecycle.

## Scope

**In scope** (the only source/test files you should modify):

- `shared/components/src/EChart/EChart.tsx`
- `shared/components/src/EChart/EChart.test.tsx` (create)

The required status-only edit to `plans/README.md` is also allowed at the end.

**Out of scope** (do not touch):

- EChart public props, option updates, event binding, chart synchronization,
  renderer registration, themes, or callers.
- Package manifests, lockfiles, polyfills, new dependencies, and browser support
  policy changes.
- Canvas rendering tests, visual snapshots, or changes to other components that
  use resize observers.

## Git workflow

- Work in the `shared` repository on branch
  `advisor/012-observe-echart-container-resizes`.
- Keep this as one logical commit. Match the observed commit style, for example:
  `[ENHANCEMENT] EChart: observe container resize`.
- Do not push or open a pull request unless the operator explicitly asks.

## Steps

### Step 0: Reinstall locked shared dependencies and prove the package baseline

Run `npm --prefix shared ci`, confirm
`git -C shared diff -- package-lock.json` prints nothing, then run the filtered
components typecheck before editing. `EChart.test.tsx` does not exist at the
planned commit, so the typecheck is the clean-checkout baseline.

**Verify**: the install and
`npm --prefix shared run type-check -- --filter=@perses-dev/components` both
exit 0 before source changes. Otherwise STOP and report the baseline.

### Step 1: Add deterministic resize-observer tests

Create `EChart.test.tsx`. Configure the mocked `echarts/core` `init` function to
return a minimal instance with Jest mocks for `setOption`, `resize`, `dispose`,
`isDisposed`, `on`, and `off`. Install a controllable fake `ResizeObserver` on
the test global and capture its callback, observed element, and `disconnect`
calls. Also mock `requestAnimationFrame` and `cancelAnimationFrame` so tests can
flush or cancel scheduled work deterministically.

Write tests that will pass after the implementation:

- the component observes the exact DOM element passed to ECharts `init`;
- an initial resize is scheduled after initialization;
- a new observed width/height schedules one `chart.resize()`;
- repeated notifications with unchanged dimensions do not add another resize;
- multiple dimension changes before a frame are coalesced into one resize;
- rerendering with a new `sx`/`style` object but unchanged observed dimensions
  does not resize; and
- unmount disconnects the observer, cancels a pending frame, and disposes the
  chart without a post-unmount resize.

Restore all global mocks after each test so this suite cannot leak observer or
animation-frame behavior into other component tests.

**Verify**: `npm --prefix shared run type-check -- --filter=@perses-dev/components` -> upstream packages build and the new test compiles; before production code is changed, behavior assertions may fail only for the missing observer path.

### Step 2: Tie observation to ECharts instance lifecycle

In `EChart.tsx`, remove the `lodash/debounce` import and delete both existing
resize effects. Set up the replacement in the initialization layout effect after
the chart instance has been initialized and received its initial option. Keeping
the observer in that effect ensures it closes over the exact chart and container
that are disposed together.

Create a local `scheduleResize` function that permits at most one pending
`requestAnimationFrame`. Its frame callback must check that the chart is not
disposed before calling `resize()`. Schedule one initial resize to preserve the
old post-initialization behavior.

When native `ResizeObserver` is available:

- observe `containerRef.current`;
- track the last delivered `contentRect.width` and `contentRect.height`;
- ignore duplicate dimensions; and
- schedule, rather than immediately perform, a chart resize for a real dimension
  change.

When `ResizeObserver` is unavailable, retain a small compatibility fallback that
listens to `window.resize` and calls the same frame-coalesced `scheduleResize`.
The fallback is not the primary path and must not use debounce.

Cleanup must disconnect the observer (or remove the fallback listener), cancel a
pending frame, dispose the same captured chart instance, and null
`chartElement.current` only if it still points to that instance. Preserve the
existing external `_instance` behavior, initialization callbacks, and option
setup order.

**Verify**: `rg -n "lodash/debounce|\[sx, style\]" shared/components/src/EChart/EChart.tsx` -> no matches.

### Step 3: Validate observer behavior and existing lifecycle

Run the focused suite. Confirm it covers the observer path, not only the window
fallback. Add an explicit fallback test only if it can be done without weakening
the observer assertions: temporarily remove `global.ResizeObserver`, dispatch
multiple window resize events in one frame, and assert one resize plus listener
cleanup.

Ensure existing option, event, theme, renderer, and sync-group effects are not
rewritten as part of test setup. The implementation should change only resize
ownership and the initialization cleanup needed to own it safely.

**Verify**: `npm --prefix shared test --workspace @perses-dev/components -- --runInBand src/EChart/EChart.test.tsx` -> all initialization, dimension-change, coalescing, fallback (if added), and cleanup tests pass.

### Step 4: Run component validation

Run typecheck, lint, and build after the focused suite. Fix only failures caused
by the two in-scope files.

**Verify**: `npm --prefix shared run build -- --filter=@perses-dev/components` -> the component workspace and upstream dependencies build successfully and exit 0.

## Test plan

- Create `shared/components/src/EChart/EChart.test.tsx` with a mocked ECharts
  instance, native resize observer, and animation-frame scheduler.
- Cover exact observed element, initial sizing, real dimension changes, duplicate
  notifications, burst coalescing, stable dimensions across prop-object changes,
  and complete unmount cleanup.
- Cover the window fallback if doing so does not obscure the primary observer
  path.
- Use call counts and explicit frame flushing, not wall-clock timers or Jest
  snapshots.

## Done criteria

- [ ] The focused EChart Jest suite passes.
- [ ] The pinned toolchain, clean install, and pre-edit components typecheck pass.
- [ ] Components typecheck, lint, and build commands exit 0.
- [ ] `rg -n "lodash/debounce|\[sx, style\]" shared/components/src/EChart/EChart.tsx` returns no matches.
- [ ] `rg -n "new ResizeObserver|requestAnimationFrame|disconnect" shared/components/src/EChart/EChart.tsx` reports the observer, frame scheduling, and cleanup paths.
- [ ] Tests prove one resize per frame, no duplicate-dimension resize, and no post-unmount resize.
- [ ] No EChart public prop or option/event behavior changed.
- [ ] `git -C shared diff --name-only f8cd4b7..HEAD` lists exactly the two in-scope shared files, and `git -C shared status --short` is empty after the logical commit.
- [ ] The status row in `plans/README.md` is updated, unless the dispatcher owns the index.

## STOP conditions

Stop and report back; do not improvise if:

- Supported runtime policy forbids native `ResizeObserver` and the fallback is
  insufficient without adding a dependency or polyfill.
- Observing the EChart root causes a reproducible resize-observer feedback loop
  even after duplicate-dimension filtering and frame coalescing.
- The mocked ECharts lifecycle differs materially from the live instance API and
  cannot test cleanup without changing shared test setup.
- Correct cleanup requires changing EChart callers or public ref semantics.
- A verification fails twice after a reasonable in-scope correction, or the fix
  requires a file outside Scope.

## Maintenance notes

- Resize behavior should remain driven by measured container dimensions, not
  `sx`/`style` identity. Future layout props need no special effect dependency.
- Reviewers should inspect the fallback and cleanup carefully: there must be one
  observer/listener owner, at most one scheduled frame, and no callback against a
  disposed chart.
- If the minimum browser matrix later guarantees `ResizeObserver`, remove the
  window fallback in a separate compatibility change with browser-policy review.
- Do not reintroduce a 200 ms debounce without profiling; animation-frame
  coalescing is aligned with rendering and avoids visible resize lag.
