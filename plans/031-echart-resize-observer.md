# Plan 031: Drive EChart resizing with a ResizeObserver instead of sx/style identity churn

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: in `shared\`, run
> `git diff --stat f8cd4b7..HEAD -- components/src/EChart/`
> On any change, compare "Current state" excerpts to live code first;
> mismatch = STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: `shared` repo commit `f8cd4b7`, 2026-07-20

## Why this matters

The shared `EChart` wrapper (used by every chart in Perses) triggers a chart
`resize()` from a `useEffect` keyed on the `sx`/`style` props. Those props are
typically inline objects re-created by parents on every render, so the effect
fires constantly; worse, the debounce inside it is re-created per effect run
(leading edge always fires), so `chart.resize()` runs on effectively every
parent render — an expensive canvas relayout. The file's own TODO comments
(lines 237–243) acknowledge both problems. A `ResizeObserver` on the
container resizes exactly when the element's size actually changes, no matter
why, and also covers cases the current code misses (panel drag-resize that
doesn't change `sx` identity, CSS-driven changes).

## Current state

Repo **`shared`**, package `@perses-dev/components`.

- `shared\components\src\EChart\EChart.tsx` — the wrapper component
  (exported as `EChart`, wrapped in `memo`). Relevant parts:

```tsx
// EChart.tsx:210-221 (current) — window resize listener
useLayoutEffect(() => {
  const updateSize = debounce(() => {
    if (!chartElement.current) return;
    chartElement.current.resize();
  }, 200);
  window.addEventListener('resize', updateSize);
  updateSize();
  return (): void => { window.removeEventListener('resize', updateSize); };
}, []);
```

```tsx
// EChart.tsx:237-255 (current) — the problematic effect
// TODO: re-evaluate how this is triggered. It's technically working right
// now because the sx prop is an object that gets re-created, but that also
// means it runs unnecessarily some of the time and theoretically might
// not run in some other cases. Maybe it should use a resize observer?
useEffect(() => {
  // TODO: fix this debouncing. This likely isn't working as intended because
  // the debounced function is re-created every time this useEffect is called.
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

- Container: `return <Box ref={containerRef} sx={sx} style={style}></Box>;`
  (`:257`); chart instance lives in `chartElement` ref, initialized in a
  `useLayoutEffect` at `:179-193`.
- `debounce` is lodash (check the import at the top of the file).
- The repo already depends on `use-resize-observer` elsewhere
  (`shared\components\src\TimeSeriesTooltip\TimeChartTooltip.tsx:18` uses
  `import useResizeObserver from 'use-resize-observer';`) — but for this
  change use the **native `ResizeObserver`** inside the existing
  `useLayoutEffect` to observe the same element the chart is mounted in;
  no new dependency and no extra render per resize.
- Tests for EChart: check `shared\components\src\EChart\` for `*.test.*`
  files; jsdom does not implement `ResizeObserver` — the shared jest setup
  may already polyfill it (grep `jest.setup` files for `ResizeObserver`);
  if not, mock it in the new test.

## Commands you will need

Run from `C:\Users\Guillaume\Documents\Projets\perses\app\shared\components`.

| Purpose   | Command             | Expected |
|-----------|---------------------|----------|
| Typecheck | `npm run type-check` | exit 0  |
| Tests     | `npm run test -- EChart` | all pass |
| Lint      | `npm run lint`       | exit 0  |

## Scope

**In scope**:
- `shared\components\src\EChart\EChart.tsx`
- A new `shared\components\src\EChart\EChart.test.tsx` (if none exists; else extend)

**Out of scope**:
- The `option` deep-equality `setOption` effect (`:202-208`) — unrelated.
- Chart init/dispose lifecycle (`:179-193`) — only append the observer to it
  if that's where you wire it; do not change init parameters.
- Any consumer of `EChart` (panels, plugins).
- The `window` resize listener (`:210-221`) — it becomes redundant once the
  observer works, but REMOVE IT ONLY if the new test proves observer-driven
  resize covers window resizes in jsdom; otherwise leave it and note it in
  Maintenance. Prefer leaving it in this plan (safe), removal is deferred.

## Git workflow

- Repo `shared`. Branch: `advisor/031-echart-resize-observer`.
- Commit style: `[ENHANCEMENT] <description>`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Replace the sx/style effect with a ResizeObserver

Delete the `useEffect` at `:237-255` (including its two TODO comments) and
add, after the chart-init `useLayoutEffect`:

```tsx
// Resize the chart whenever its container element actually changes size
// (covers parent re-layout, panel drag-resize, CSS changes).
useLayoutEffect(() => {
  const container = containerRef.current;
  if (container === null || typeof ResizeObserver === 'undefined') return;
  const updateSize = debounce(
    () => {
      if (!chartElement.current) return;
      chartElement.current.resize();
    },
    200,
    { leading: true }
  );
  const observer = new ResizeObserver(() => updateSize());
  observer.observe(container);
  return (): void => {
    observer.disconnect();
    updateSize.cancel();
  };
}, []);
```

Notes: `debounce(...).cancel()` is lodash API — keep it so a pending trailing
call can't fire after dispose. Deps `[]` are correct: `containerRef` and
`chartElement` are refs.

**Verify**: `npm run type-check` → exit 0.

### Step 2: Test

In `EChart.test.tsx` (create next to `EChart.tsx` if absent; model provider/
render scaffolding on `shared\components\src\Table\Table.test.tsx`):
- Mock `ResizeObserver` if the jest setup doesn't provide one:
  ```ts
  const observed: Element[] = [];
  let trigger: () => void;
  class MockRO {
    constructor(cb: ResizeObserverCallback) { trigger = () => cb([], this as unknown as ResizeObserver); }
    observe(el: Element): void { observed.push(el); }
    disconnect(): void {}
    unobserve(): void {}
  }
  (global as any).ResizeObserver = MockRO;
  ```
- Mock `echarts/core` `init` to return a stub with `setOption`, `resize`,
  `dispose`, `isDisposed` jest.fn()s (check how/if existing chart tests mock
  echarts — grep `jest.mock('echarts` in `shared\components`).
- Use jest fake timers. Assert:
  1. re-rendering the component with a NEW `sx` object does NOT call
     `resize` again (beyond mount);
  2. firing the observer callback calls `resize` (after advancing timers past
     the debounce);
  3. unmount then firing timers does not call `resize` (cancel works).

**Verify**: `npm run test -- EChart` → all pass.

### Step 3: Lint

**Verify**: `npm run lint` → exit 0.

## Test plan

Covered in Step 2: no-resize-on-prop-churn (the regression this plan fixes),
resize-on-container-change, cancel-on-unmount. Existing chart-dependent tests
in the package must still pass: `npm run test` (full package) → all pass.

## Done criteria

ALL must hold (run in `shared\components`):

- [ ] `npm run type-check` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm run test` exits 0 (full package), incl. new EChart tests
- [ ] `EChart.tsx` contains `ResizeObserver` and does NOT contain an effect with deps `[sx, style]` (grep)
- [ ] `git status` shows only in-scope files modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The effect at `:237-255` doesn't match the excerpt (drift).
- You find a consumer that relies on resize firing when `sx` changes without
  an actual size change (search callers if a test fails in a panel package).
- jsdom/test setup makes the ResizeObserver path untestable even with the
  mock above after two attempts.

## Maintenance notes

- Deferred: removing the now-mostly-redundant `window` resize listener
  (`:210-221`) — remove in a follow-up once the observer has soaked in real
  dashboards (embedded-view consumers may rely on it in browsers where the
  container doesn't resize with the window, which shouldn't happen, but be
  conservative).
- Reviewer: check charts still resize correctly when (a) browser window
  resizes, (b) a panel is drag-resized in edit mode, (c) the side drawer
  opens/closes.
