# Plan 028: Stop per-pixel React renders from chart tooltips (throttle + lazy mount)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: this plan spans two repos.
> In `shared\`: `git diff --stat f8cd4b7..HEAD -- components/src/TimeSeriesTooltip/`
> In `plugins\`: `git diff --stat d7075da..HEAD -- timeserieschart/src/TimeSeriesChartBase.tsx`
> If any in-scope file changed, compare the "Current state" excerpts against
> the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: `shared` commit `f8cd4b7` + `plugins` commit `d7075da`, 2026-07-20

## Why this matters

Every timeseries panel mounts `TimeChartTooltip` from first render
(`showTooltip` defaults to `true`), and each tooltip's `useMousePosition`
hook registers a **global, unthrottled `window` `mousemove` listener** that
calls `setState` on every event. On a dashboard with N timeseries panels,
every mouse movement anywhere on the page triggers N React state updates per
pixel, each re-rendering the tooltip component and re-running
`getNearbySeriesData` (an O(series × points) proximity scan). This is the
single largest continuous main-thread cost in the app during normal use.
Two fixes: (a) requestAnimationFrame-throttle the listener, (b) don't mount
tooltips until the pointer actually enters a chart.

## Current state

**Repo `shared`, package `@perses-dev/components`:**

- `shared\components\src\TimeSeriesTooltip\tooltip-model.ts` — the hook:

```ts
// tooltip-model.ts:98-132 (current, abridged)
export const useMousePosition = (): CursorData['coords'] => {
  const [coords, setCoords] = useState<CursorData['coords']>(null);
  useEffect(() => {
    const setFromEvent = (e: ZRRawMouseEvent): void => {
      return setCoords({
        page: { x: e.pageX, y: e.pageY },
        client: { x: e.clientX, y: e.clientY },
        plotCanvas: { x: e.zrX ?? e.offsetX, y: e.zrY ?? e.offsetY },
        target: e.target,
      });
    };
    window.addEventListener('mousemove', setFromEvent);
    return (): void => { window.removeEventListener('mousemove', setFromEvent); };
  }, []);
  return coords;
};
```

- `shared\components\src\TimeSeriesTooltip\TimeChartTooltip.tsx:61` — calls
  `useMousePosition()`; at line 66–69 it bails out (returns null) when the
  cursor is not over a `CANVAS` element — but the setState per mousemove has
  already happened by then. At line 80 it calls `getNearbySeriesData(...)`
  on each render.
- `useMousePosition` is also consumed by
  `plugins\timeserieschart\src\annotations\AnnotationTooltip.tsx:50` — it
  benefits from the throttle automatically; do not modify that file.

**Repo `plugins`, package `@perses-dev/timeseries-chart-plugin`:**

- `plugins\timeserieschart\src\TimeSeriesChartBase.tsx`:

```tsx
// TimeSeriesChartBase.tsx:131 (current)
const [showTooltip, setShowTooltip] = useState<boolean>(true);
```

Mouse handling on the wrapping Box (lines 455–494): `onMouseEnter` sets
`setShowTooltip(true)`; `onMouseLeave` sets `setShowTooltip(false)` **only
when `tooltipPinnedCoords === null`**; `onMouseUp` sets it back to `true`
(after drag-to-zoom hides it). The tooltip is mounted at lines 509–530 when:

```tsx
{showTooltip === true &&
  (tooltipPinnedCoords !== null || hoveredAnnotation === null) &&
  (option.tooltip as TooltipComponentOption)?.showContent === false &&
  tooltipConfig.hidden !== true && (
    <TimeChartTooltip ... pinnedPos={tooltipPinnedCoords} ... />
  )}
```

Because the state starts `true`, all panels mount tooltips (and listeners)
before any hover.

- Existing tests near the tooltip:
  `shared\components\src\TimeSeriesTooltip\nearby-series.test.ts`,
  `TooltipHeader.test.tsx`, `TooltipContent.test.tsx` (jest + RTL patterns).
- Conventions: React 18, explicit return types, ESLint `react-hooks` rules.

## Commands you will need

| Purpose | Command (run in package dir) | Expected |
|---------|------------------------------|----------|
| Typecheck (components) | `cd shared\components; npm run type-check` | exit 0 |
| Tests (components) | `cd shared\components; npm run test -- TimeSeriesTooltip` | all pass |
| Lint (components) | `cd shared\components; npm run lint` | exit 0 |
| Typecheck (plugin) | `cd plugins\timeserieschart; npm run type-check` | exit 0 |
| Tests (plugin) | `cd plugins\timeserieschart; npm run test` | all pass |
| Lint (plugin) | `cd plugins\timeserieschart; npm run lint` | exit 0 |

(If `npm run test` fails with missing modules, run `npm install` at the repo
root of `shared\` / `plugins\` first.)

## Scope

**In scope** (the only files you should modify):
- `shared\components\src\TimeSeriesTooltip\tooltip-model.ts`
- `plugins\timeserieschart\src\TimeSeriesChartBase.tsx`
- New/updated test files next to each

**Out of scope** (do NOT touch):
- `TimeChartTooltip.tsx`, `nearby-series.ts` — the proximity-scan cost per
  event drops automatically once events are throttled; restructuring the scan
  is deferred.
- `AnnotationTooltip.tsx` (consumer only, benefits automatically).
- Pinning logic (`tooltipPinnedCoords`, `pinnedCrosshair`) — behavior must
  remain byte-identical.

## Git workflow

- Two branches, one per repo: `advisor/028-tooltip-mousemove` in `shared`
  and in `plugins`. Commit style: `[ENHANCEMENT] <description>`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1 (shared): rAF-throttle `useMousePosition`

In `tooltip-model.ts`, change the effect so the mousemove handler stores the
latest event in a ref and schedules a single `requestAnimationFrame` callback
that calls `setCoords` once per frame:

```ts
export const useMousePosition = (): CursorData['coords'] => {
  const [coords, setCoords] = useState<CursorData['coords']>(null);
  useEffect(() => {
    let frame = 0;
    const setFromEvent = (e: ZRRawMouseEvent): void => {
      if (frame !== 0) return; // one update per frame max
      frame = requestAnimationFrame(() => {
        frame = 0;
        setCoords({
          page: { x: e.pageX, y: e.pageY },
          client: { x: e.clientX, y: e.clientY },
          plotCanvas: { x: e.zrX ?? e.offsetX, y: e.zrY ?? e.offsetY },
          target: e.target,
        });
      });
    };
    window.addEventListener('mousemove', setFromEvent);
    return (): void => {
      window.removeEventListener('mousemove', setFromEvent);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, []);
  return coords;
};
```

Keep the existing comments about zrX/zrY browser inconsistencies (lines
112–119) attached to the `plotCanvas` fields.

**Verify**: `cd shared\components; npm run type-check` → exit 0; `npm run test -- TimeSeriesTooltip` → all pass.

### Step 2 (shared): test the throttle

Add `shared\components\src\TimeSeriesTooltip\tooltip-model.test.ts`:
- Use `renderHook` from `@testing-library/react` and jest fake timers /
  a mocked `requestAnimationFrame` (assign `window.requestAnimationFrame = cb => { cb(0); return 1; }`
  or use `jest.spyOn`).
- Dispatch 5 `mousemove` events synchronously before the rAF callback runs →
  assert `setCoords` result reflects only one state update (hook result
  changed once).
- Assert cleanup: unmount removes the listener (dispatch after unmount does
  not throw / no update).
Model jest setup on `nearby-series.test.ts` in the same folder.

**Verify**: `npm run test -- tooltip-model` → new tests pass.

### Step 3 (plugins): lazy-mount the tooltip

In `TimeSeriesChartBase.tsx` line 131, change the initial state:

```tsx
const [showTooltip, setShowTooltip] = useState<boolean>(false);
```

Behavior audit you must confirm by reading the file (do not skip):
- `onMouseEnter` (line ~489) already sets `true` → tooltip mounts on hover. ✔
- `onMouseLeave` (line ~479) sets `false` unless pinned. ✔
- `onMouseUp` (line ~474) sets `true` — fires only after a mousedown on the
  chart, which implies the pointer is over the chart. ✔
- Pinned tooltips: pinning can only be initiated while hovering (mouse click
  on chart), at which point `showTooltip` is already `true`, and
  `onMouseLeave` keeps it `true` while pinned. ✔ — confirm this logic chain
  holds in the live code; if you find any path where a tooltip should be
  visible without a prior `mouseenter`, STOP.

**Verify**: `cd plugins\timeserieschart; npm run type-check` → exit 0;
`npm run test` → all pass (notably `TimeSeriesChartPanel.test.tsx`).

### Step 4: full lint both repos

**Verify**: `npm run lint` in `shared\components` and
`plugins\timeserieschart` → exit 0.

## Test plan

- New: `tooltip-model.test.ts` (Step 2) — throttling and cleanup.
- Existing: `TimeSeriesChartPanel.test.tsx` must still pass; if it asserted a
  tooltip is present without simulating hover, update the test to fire
  `mouseEnter` first (that is a legitimate test adjustment, note it in the
  commit message).
- Manual (optional, if a dev server is available): `npm run start` in
  `perses\ui\app` against a dashboard with 2+ panels; verify tooltip appears
  on hover, pins on click, unpins on double-click.

## Done criteria

ALL must hold:

- [ ] `shared\components`: `npm run type-check`, `npm run lint`, `npm run test` all exit 0
- [ ] `plugins\timeserieschart`: `npm run type-check`, `npm run lint`, `npm run test` all exit 0
- [ ] `tooltip-model.ts` contains `requestAnimationFrame` and `cancelAnimationFrame`
- [ ] `TimeSeriesChartBase.tsx:131` initializes `showTooltip` to `false`
- [ ] `git status` in each repo shows only in-scope files modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The mouse-handler wiring in `TimeSeriesChartBase.tsx` (lines 455–494)
  differs from the behavior audit in Step 3 — especially if you find a code
  path where the tooltip must render before any `mouseenter` (e.g. keyboard
  navigation or programmatic pinning).
- Existing tooltip tests fail in a way that isn't the "mount on hover" test
  adjustment described above.
- `AnnotationTooltip` tests (if any) break — that would mean the throttle
  changed observable semantics beyond frequency.

## Maintenance notes

- Future work (deferred): replace the *global* window listener with a
  per-chart listener attached to the chart container, and/or move the
  proximity scan (`getNearbySeriesData`) into a `useMemo` keyed on throttled
  coords. Re-profile before doing so.
- Reviewer should scrutinize pinning UX: pin (click), unpin (double-click /
  header icon), and tooltip persistence when the mouse leaves a pinned chart.
- If ECharts' own `tooltip.showContent` option handling changes (line 511
  condition), the lazy-mount gate must be revisited.
