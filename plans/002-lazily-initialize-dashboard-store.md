# Plan 002: Lazily create the dashboard store once per provider mount

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite repository root)**:
> `git -C shared diff --stat f8cd4b7..HEAD -- dashboards/src/context/DashboardProvider/DashboardProvider.tsx dashboards/src/context/DashboardProvider/DashboardProvider.test.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `f8cd4b7`, 2026-07-21

## Why this matters

`DashboardProvider` currently executes the complete Zustand store factory on
every React render and passes the discarded result to `useState`. Store
creation hydrates every dashboard slice, layout, panel, and middleware, so a
parent rerender pays that initialization cost even though React retains only
the first store. A lazy state initializer makes the comment and behavior agree:
one store is created per mounted provider.

## Current state

- `shared/dashboards/src/context/DashboardProvider/DashboardProvider.tsx`
  defines the provider and its `initStore` factory.
- `shared/dashboards/src/test/dashboard-provider.tsx:28-49` provides
  `createDashboardProviderSpy`, the existing convention for capturing a
  provider store in tests.
- `shared/dashboards/src/test/render.tsx:54-85` is the package's provider-aware
  render exemplar. This focused test may use Testing Library's plain `render`
  with narrow plugin hooks mocked, because only store creation is under test.

Current provider initialization (`DashboardProvider.tsx:90-94`):

```ts
export function DashboardProvider(props: DashboardProviderProps): ReactElement {
  // Prevent calling createDashboardStore every time it rerenders
  const createDashboardStore = useCallback(initStore, [props]);
  const [store] = useState(createDashboardStore(props));
```

The argument to `useState` is evaluated before `useState` runs. `useCallback`
stabilizes a function identity only for the current props; it does not defer
`createDashboardStore(props)`.

The store factory begins at `DashboardProvider.tsx:118` and performs all slice
initialization inside `createStore` at lines 131–183. `initialState` is already
an initial-only contract: later prop objects do not replace the retained store.
Preserve that semantic.

## Commands you will need

Use Node `v22.14.0` from `shared/.nvmrc` and npm `10.9.2` from
`shared/package.json`; if those pinned versions cannot be activated, STOP
before installing or testing. On Windows PowerShell, use `npm.cmd` when
`npm.ps1` is policy-blocked.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix shared ci` | exit 0; `shared/package-lock.json` is unchanged |
| Focused test | `npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand DashboardProvider.test.tsx` | exit 0; lazy-initialization suite passes |
| Typecheck | `npm --prefix shared run type-check -- --filter=@perses-dev/dashboards` | exit 0 after Turbo runs upstream builds, with no TypeScript errors |
| Lint | `npm --prefix shared run lint --workspace=@perses-dev/dashboards` | exit 0, no ESLint errors |
| Build | `npm --prefix shared run build -- --filter=@perses-dev/dashboards` | exit 0; dashboards and upstream packages emit cleanly |
| Full package tests | `npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand` | exit 0; all dashboard suites pass |

## Suggested executor toolkit

- If available, use `vercel-react-best-practices` to confirm the lazy
  initializer pattern. Keep the change local; no provider redesign is needed.

## Scope

**In scope** (the only implementation files you should modify):

- `shared/dashboards/src/context/DashboardProvider/DashboardProvider.tsx`
- `shared/dashboards/src/context/DashboardProvider/DashboardProvider.test.tsx`
  (create)

`plans/README.md` is an administrative status-only exception after completion.

**Out of scope** (do NOT touch):

- Any dashboard slice or `initStore` state shape.
- Synchronizing a mounted store when `initialState` props change; callers use
  `setDashboard` for that behavior.
- Variable-provider initialization or the dashboard-root subscription.
- React StrictMode policy or application-level provider mounting.

## Git workflow

- Work in the nested `shared` repository on branch
  `advisor/002-lazily-initialize-dashboard-store`.
- Commit as one logical unit after verification. Match the observed style, for
  example: `[ENHANCEMENT] dashboards: lazily initialize dashboard store`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 0: Reinstall the locked shared workspace

Run `npm --prefix shared ci` before collecting the focused-test baseline. Do
not rely on an existing `node_modules`; the audited checkout had an incomplete
install. The command must not rewrite the lockfile.

**Verify**: `npm --prefix shared ci` exits 0 and
`git -C shared diff -- package-lock.json` prints nothing.

### Step 1: Add a regression test that counts store creation across rerenders

Create `DashboardProvider.test.tsx`. Follow the repository's Jest mock style:

1. wrap the actual `zustand` module and replace only `createStore` with
   `jest.fn(actual.createStore)`;
2. mock `usePluginRegistry` and `usePlugin` from
   `@perses-dev/plugin-system` narrowly so the provider can render without an
   application plugin registry; return no default panel plugin;
3. render `DashboardProvider` with `getTestDashboard()` and a simple child;
4. record the `createStore` call count after the initial mount, rerender the
   same mounted provider with a newly allocated props object, and assert the
   call count did not increase;
5. capture the context store with `createDashboardProviderSpy` and assert the
   store object is referentially identical before and after rerender.

Do not wrap this focused assertion in StrictMode: StrictMode is allowed to
probe initializers more than once during a development mount, while this bug is
about ordinary rerenders of one mounted provider.

**Verify**: Before changing production code, run
`npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand DashboardProvider.test.tsx`
→ the new call-count assertion fails by showing an additional `createStore`
call on rerender, while the retained context-store identity assertion passes.
This expected failure confirms the test exercises the bug; do not commit this
intermediate state.

### Step 2: Use a true lazy state initializer

In `DashboardProvider.tsx`, replace the callback/eager expression with exactly
the lazy shape:

```ts
const [store] = useState(() => initStore(props));
```

Remove `useCallback` from the React import if it has no other use. Keep
`initStore` private, preserve all middleware and slices, and update the nearby
comment to say that the lazy initializer runs once per provider mount.

**Verify**:
`npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand DashboardProvider.test.tsx`
→ exit 0; `createStore` does not receive another call on rerender and the
context store retains its identity.

### Step 3: Run dashboard package checks

Run typecheck, lint, and the full dashboard suite. Fix only in-scope fallout.

**Verify**:
`npm --prefix shared run type-check -- --filter=@perses-dev/dashboards`
→ exit 0 after Turbo's upstream builds; then
`npm --prefix shared run lint --workspace=@perses-dev/dashboards`
→ exit 0; then
`npm --prefix shared run build -- --filter=@perses-dev/dashboards`
→ exit 0; then
`npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand`
→ exit 0 and all suites pass.

## Test plan

- Create `DashboardProvider.test.tsx` with one regression test covering a
  normal provider rerender and two assertions: no additional store factory
  invocation and stable context-store identity.
- Use `createDashboardProviderSpy` from
  `shared/dashboards/src/test/dashboard-provider.tsx:28-49` for store capture.
- Also assert that the initial dashboard metadata is present, so a test that
  accidentally bypasses initialization cannot pass.
- Verification:
  `npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand DashboardProvider.test.tsx`
  → the complete focused suite passes.

## Done criteria

Machine-checkable; ALL must hold:

- [ ] `rg -n "useState\(\(\) => initStore\(props\)\)" shared/dashboards/src/context/DashboardProvider/DashboardProvider.tsx` returns exactly one match.
- [ ] `rg -n "useCallback\(initStore|useState\(createDashboardStore" shared/dashboards/src/context/DashboardProvider/DashboardProvider.tsx` returns no matches.
- [ ] The focused test proves no extra `createStore` call on rerender and stable
  store identity.
- [ ] Dashboard typecheck, lint, and full tests exit 0.
- [ ] The filtered dashboards build exits 0.
- [ ] `git -C shared diff --name-only f8cd4b7..HEAD` lists exactly the two in-scope paths, and `git -C shared status --short` is empty after the logical commit.
- [ ] `plans/README.md` status row is updated, unless the dispatcher said it maintains the index.

## STOP conditions

Stop and report back without improvising if:

- Live code has introduced documented synchronization from changing
  `initialState` props into the mounted store.
- `DashboardProvider` has moved to `useRef`, a provider factory, or another
  already-lazy initialization mechanism.
- Counting `createStore` requires changing production exports or adding a test
  seam; use the narrow module mock described above instead.
- A fix appears to require touching any slice, middleware, or caller.
- A verification command fails twice after a reasonable in-scope fix attempt.

## Maintenance notes

- A provider remount still creates a new store; that is correct and should not
  be weakened by this test.
- Reviewers should verify that the initializer is a function passed to
  `useState`, not a function invocation wrapped in `useCallback`.
- If future requirements need prop-to-store synchronization, implement it as
  an explicit effect/action with separate tests rather than making creation
  eager again.
