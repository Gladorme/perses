# Plan 015: Defer the federation runtime and enforce shared UI bundle boundaries

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report—do not improvise. When done, update this plan's row in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift checks (run first)**:
>
> - `git -C shared diff --stat f8cd4b7..HEAD -- plugin-system/src/remote components/package.json components/src/EChart`
> - `git -C perses diff --stat 06886ac1..HEAD -- ui/app/package.json ui/app/rspack.config.mjs ui/app/scripts`
>
> Compare any changed in-scope file against the excerpts below. A semantic
> mismatch, or incomplete dependencies 012/014, is a STOP condition.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/012-observe-echart-container-resizes.md`, `plans/014-load-remote-plugin-exposures-on-demand.md`
- **Category**: perf
- **Planned at**: shared commit `f8cd4b7` and perses commit `06886ac1`, 2026-07-21

## Why this matters

Constructing the remote loader statically reaches the Module Federation runtime and its share-provider graph, including ECharts, all Perses UI packages, MDI, Emotion, date libraries, and form/runtime dependencies. Separately, the components package root re-exports EChart, CodeMirror-backed JSONEditor, and test utilities without package side-effect metadata. This plan first makes the bundle topology measurable, then moves the federation graph behind the first actual remote request and makes the components package safely tree-shakeable while retaining root-import compatibility.

Exact byte savings are intentionally not promised. The checked-in gate is structural: heavyweight modules must not be reachable from the application's initial entrypoint, and initial JavaScript must not grow relative to a same-worktree baseline.

## Current state

- `shared/plugin-system/src/remote/remotePluginLoader.ts` has a static runtime edge:

  ```ts
  // remotePluginLoader.ts:14-16
  import { PluginLoader, PluginMetadata, PluginModuleResource } from '@perses-dev/plugin-system';
  import { RemotePluginModule } from './PersesPlugin.types';
  import { loadPlugin } from './PluginRuntime';
  ```

- `shared/plugin-system/src/remote/PluginLoaderComponent.tsx:30` also statically imports `usePluginRuntime` from `PluginRuntime`.
- `shared/plugin-system/src/remote/PluginRuntime.tsx:28-34` imports Module Federation, React Query, ReactDOM, React Hook Form, and React Router. Its `shared` table has synchronous provider edges such as:

  ```ts
  // PluginRuntime.tsx:85-103
  echarts: {
    version: '5.5.0',
    lib: () => require('echarts'),
    // ...
  },
  '@perses-dev/components': {
    version: '0.53.0-beta.3',
    lib: () => require('@perses-dev/components'),
    // ...
  },
  ```

- `shared/components/src/index.ts` re-exports heavyweight and test-only branches from the production root:

  ```ts
  // components/src/index.ts:22,28,47
  export * from './EChart';
  export * from './JSONEditor';
  export * from './test-utils';
  ```

- `shared/components/package.json` defines `module`, `main`, and `types`, but no `exports` map and no `sideEffects` declaration.
- `shared/components/src/EChart/EChart.tsx:47-67` runs `use([...])` at module evaluation time. Any `sideEffects: false` declaration would be inaccurate until this registration is moved behind actual EChart use.
- `perses/ui/app/rspack.config.mjs:17-20` only aliases the sibling shared source when both development mode and `SHARED_DEV=true` are active. `optimization` has no explicit bundle-boundary test.
- `perses/ui/app/package.json` offers `build` and `analyze`, but no deterministic JSON-stats assertion.
- Plan 012 should have created or expanded `shared/components/src/EChart/EChart.test.tsx`; extend that test rather than creating a competing EChart harness.
- Follow existing ESM named exports, Jest tests, Rspack configuration style, and the repository's environment-variable naming convention (`SHARED_PACKAGES_PATH`, `SHARED_DEV`).

## Commands you will need

Both workspaces pin Node `v22.14.0` in `.nvmrc` and npm `10.9.2` in
`packageManager`; if those versions cannot be activated, STOP before installing
or capturing bundle baselines.

Run these from the composite workspace root. In Windows PowerShell use `npm.cmd`; on Unix use `npm`.

| Purpose | Command | Expected on success |
|---|---|---|
| Install shared | `npm.cmd --prefix shared ci` | exit 0; `shared/package-lock.json` is unchanged |
| Install app | `npm.cmd --prefix perses/ui ci` | exit 0; `perses/ui/package-lock.json` is unchanged |
| Plugin runtime tests | `npm.cmd --prefix shared run test --workspace=@perses-dev/plugin-system -- --runInBand src/remote/remotePluginLoader.test.ts src/remote/PluginLoaderComponent.test.tsx src/remote/pluginRuntimeLoader.test.ts` | exit 0; runtime module is loaded once and only on demand |
| Components tests | `npm.cmd --prefix shared run test --workspace=@perses-dev/components -- --runInBand src/EChart/EChart.test.tsx` | exit 0; registration/resize tests pass |
| Full plugin-system tests | `npm.cmd --prefix shared run test --workspace=@perses-dev/plugin-system -- --runInBand` | exit 0; no package regression |
| Full components tests | `npm.cmd --prefix shared run test --workspace=@perses-dev/components -- --runInBand` | exit 0; no package regression |
| Shared typecheck | `npm.cmd --prefix shared run type-check` | exit 0, no TypeScript errors in any shared package |
| Shared lint | `npm.cmd --prefix shared run lint` | exit 0, no ESLint errors |
| Shared build | `npm.cmd --prefix shared run build` | exit 0; ESM, CJS, and declarations build |
| Legacy-resolver subpath typecheck | `npm.cmd --prefix shared run type-check:subpaths --workspace=@perses-dev/components` | exit 0; all four new package subpaths resolve declarations with `moduleResolution: "node"` |
| Bundle-script tests | `npm.cmd --prefix perses/ui/app run test:bundle-boundaries` | exit 0; good/bad synthetic stats fixtures behave as expected |
| Local-shared stats | `npm.cmd --prefix perses/ui/app run stats:shared -- --json ../../../plans/.plan-015-stats/stats.after.json` | exit 0; production build and JSON stats emitted outside Rspack's cleaned `dist` directory |
| Boundary assertion | `npm.cmd --prefix perses/ui/app run check:bundle-boundaries -- ../../../plans/.plan-015-stats/stats.after.json ../../../plans/.plan-015-stats/stats.before.json` | exit 0; forbidden modules absent from initial chunks and initial JS did not grow |
| Package subpath resolution | `node -e "const {createRequire}=require('node:module'); const {resolve}=require('node:path'); const req=createRequire(resolve('shared/package.json')); for (const id of ['@perses-dev/components','@perses-dev/components/context','@perses-dev/components/e-chart','@perses-dev/components/json-editor','@perses-dev/components/test-utils']) console.log(req.resolve(id));"` | exit 0; root and all four subpaths resolve to `dist/cjs` targets without executing browser modules or raw CSS requires |
| App typecheck | `npm.cmd --prefix perses/ui run type-check -- --filter=@perses-dev/app` | exit 0 after Turbo builds upstream UI workspaces, with no TypeScript errors |
| App lint | `npm.cmd --prefix perses/ui run lint -- --filter=@perses-dev/app` | exit 0, no ESLint errors |
| Normal app build | `npm.cmd --prefix perses/ui run build -- --filter=@perses-dev/app` | exit 0 using normal published-package resolution |

## Suggested executor toolkit

- Use `vercel-react-best-practices` for lazy/dynamic-import boundaries and bundle analysis guidance.
- Use the Rspack JSON stats generated by this plan; do not infer bundle membership from raw string search alone.

## Scope

**In scope** (the only source/config/test files you may modify or create):

- `shared/plugin-system/src/remote/pluginRuntimeLoader.ts` (create)
- `shared/plugin-system/src/remote/pluginRuntimeLoader.test.ts` (create)
- `shared/plugin-system/src/remote/remotePluginLoader.ts`
- `shared/plugin-system/src/remote/remotePluginLoader.test.ts`
- `shared/plugin-system/src/remote/PluginLoaderComponent.tsx`
- `shared/plugin-system/src/remote/PluginLoaderComponent.test.tsx`
- `shared/components/package.json`
- `shared/components/tsconfig.subpaths.json` (create)
- `shared/components/type-tests/subpath-imports.ts` (create)
- `shared/components/src/EChart/EChart.tsx`
- `shared/components/src/EChart/EChart.test.tsx`
- `perses/ui/app/package.json`
- `perses/ui/app/rspack.config.mjs`
- `perses/ui/app/scripts/check-bundle-boundaries.mjs` (create)
- `perses/ui/app/scripts/check-bundle-boundaries.test.mjs` (create)
- `perses/ui/app/scripts/fixtures/bundle-stats-clean.json` (create, minimal synthetic fixture)
- `perses/ui/app/scripts/fixtures/bundle-stats-heavy-initial.json` (create, minimal synthetic fixture)
- `plans/README.md` (status row only)

**Out of scope**:

- Changing any Module Federation singleton, version, `requiredVersion`, remote name, manifest URL, or share-provider value.
- Upgrading Rspack, Module Federation, React, ECharts, MUI, or Perses package versions.
- Removing existing exports from `@perses-dev/components`; new subpaths are additive in this plan.
- Migrating plugin repositories or external consumers to new subpaths.
- Reconfiguring route-level lazy imports or adding arbitrary vendor splitting.
- Editing generated `dist`, stats, or package tarball files into source control.
- Changing the name-aware loader/cache behavior delivered by Plan 014.

## Git workflow

- Repositories: `shared` and `perses`; create `advisor/015-defer-federation-runtime-and-enforce-bundle-boundaries` in both.
- Keep repository commits separate. Suggested messages: `[ENHANCEMENT] defer plugin federation runtime`, `[ENHANCEMENT] make components bundle boundaries explicit`, and `[ENHANCEMENT] add shared bundle boundary checks`.
- Do not commit generated `dist/stats.*.json`, build output, or dependency directories.
- Do not push or open a PR unless instructed.

## Steps

### Step 0: Reinstall both locked workspaces

Run both install commands from the table before capturing stats. Plans 012 and
014 may have run in a different checkout or left stale workspace links; this
plan must start from the lockfiles, not from whatever happens to be installed.
Neither install may rewrite its lockfile.

After the dependency and drift checks pass, record the output of
`git -C shared rev-parse HEAD` as `PLAN015_SHARED_BASE` and
`git -C perses rev-parse HEAD` as `PLAN015_PERSES_BASE`. Capture these values
after Plans 012/014 are present and before this plan makes or commits any
change; the original planned-at SHAs cannot isolate this plan from its
prerequisite commits.

Before editing, run the existing post-prerequisite baselines (the new
`pluginRuntimeLoader.test.ts` does not exist yet):

1. `npm.cmd --prefix shared run test --workspace=@perses-dev/plugin-system -- --runInBand src/remote/remotePluginLoader.test.ts src/remote/PluginLoaderComponent.test.tsx`
2. `npm.cmd --prefix shared run test --workspace=@perses-dev/components -- --runInBand src/EChart/EChart.test.tsx`

**Verify**: both install and both baseline-test commands exit 0;
`git -C shared diff -- package-lock.json` and
`git -C perses diff -- ui/package-lock.json` both print nothing, and both base
SHAs are recorded. Otherwise STOP before editing.

### Step 1: Add a reproducible local-shared production stats gate and capture the baseline

Do this before changing runtime/component imports.

1. In `rspack.config.mjs`, introduce
   `isLocalSharedBuild = process.env.LOCAL_SHARED_BUILD === 'true'`. Preserve
   the existing source aliases exactly for `SHARED_DEV`; do **not** use an
   ordinary directory alias in production local mode, because enhanced-resolve
   treats it as path substitution and bypasses package `exports` for subpaths.
   Instead, when `LOCAL_SHARED_BUILD` is true, set normal module search order to
   `[sharedNodeModulesPath, nodeModulesPath, 'node_modules']`. The first path
   contains npm's sibling-shared workspace symlinks, so bare
   `@perses-dev/components`, dashboards, plugin-system, and explore requests
   go through their package manifests and conditional exports. Retain
   `localAliases` and `singletonAliases` in this mode so React, ReactDOM,
   Router, React Query, Emotion, MUI, and Hook Form still resolve to the app's
   single instances. Do not enable development mode, source maps, React
   Refresh, or the dev server.
2. Make the bundle checker fail unless module identifiers prove the four local
   shared packages resolved from the sibling `shared` workspace rather than
   `perses/ui/node_modules`. Also fail if duplicate copies of the singleton
   families above appear. This prevents a green result from accidentally
   measuring the published packages or a split context graph.
3. When `LOCAL_SHARED_BUILD` is true, configure structured JSON stats
   explicitly. Rspack 2's empty/default stats object does not emit enough data
   for this checker. Use at least:

   ```js
   {
     all: false,
     assets: true,
     entrypoints: true,
     chunks: true,
     chunkModules: true,
     modules: true,
     nestedModules: true,
     ids: true,
     errors: true,
     warnings: true,
   }
   ```

   `ids: true` is load-bearing because module-to-chunk membership must be
   present. Keep normal builds' console stats unchanged.
4. Add `stats:shared` to the app package: a production Rspack build intended to receive `--json <path>` arguments while `LOCAL_SHARED_BUILD=true`.
5. Add a Node-only bundle checker that:
   - parses Rspack stats and recursively flattens nested/concatenated modules;
   - derives the initial chunk IDs from `entrypoints` rather than assuming a chunk name;
   - normalizes Windows and POSIX separators;
   - reports initial JavaScript bytes;
   - in assertion mode, fails if an initial module identifier contains
     `PluginRuntime`, `@module-federation/enhanced/runtime`, the transitive
     `@module-federation/runtime` family, `/echarts/`, `/EChart/`,
     `@codemirror`, `react-codemirror`, or `JSONEditor`;
   - requires both `PluginRuntime` and at least one Module Federation runtime
     module to exist in non-initial chunks after the optimization, so a
     missing stats/module-detail configuration or another eager runtime edge
     cannot pass vacuously;
   - requires the existing Lato 300/400/700/900 CSS modules to remain reachable
     from the initial app graph, proving that the narrowed `sideEffects`
     metadata did not discard the current theme's font-loading behavior;
   - when a baseline path is supplied, fails if total initial JavaScript bytes increased.
6. Support `--report-only` so the pre-change baseline can be generated even though it should still contain forbidden modules.
7. Add small synthetic stats fixtures and Node `--test` coverage for:
   initial-heavy failure (including a Module Federation runtime module),
   async-heavy success that proves both runtime families are present only in
   async chunks, nested module flattening, Windows path normalization, wrong
   shared-package root, duplicate singleton modules, missing Lato font module,
   missing entrypoint/module data failure, and byte-regression failure. After
   the first real baseline is emitted, run the checker against it before
   editing runtime code; non-empty
   assets, entrypoints, chunks, module identifiers, nested modules, and module
   `chunks` IDs are an integration assertion on the configured Rspack 2 shape.

Add package scripts:

```json
"stats:shared": "cross-env NODE_ENV=production LOCAL_SHARED_BUILD=true rspack build",
"test:bundle-boundaries": "node --test scripts/check-bundle-boundaries.test.mjs",
"check:bundle-boundaries": "node scripts/check-bundle-boundaries.mjs"
```

Build the shared packages so the workspace packages reached through those
normal-resolution symlinks have current `dist` outputs. Create the temporary
stats directory with
`node -e "require('node:fs').mkdirSync('plans/.plan-015-stats',{recursive:true})"`,
then capture, but do not commit, the pre-change baseline. The stats must live
outside `perses/ui/app/dist` because Rspack's `output.clean: true` would delete
the baseline during the post-change build:

1. `npm.cmd --prefix shared run build`
2. `npm.cmd --prefix perses/ui/app run stats:shared -- --json ../../../plans/.plan-015-stats/stats.before.json`
3. `npm.cmd --prefix perses/ui/app run check:bundle-boundaries -- ../../../plans/.plan-015-stats/stats.before.json --report-only`

Expected: all three exit 0; the report prints initial JS bytes and lists any currently initial heavyweight modules. If the current production stats already pass all structural boundaries, stop and report because the premise of this plan is no longer true.

**Verify**: run `npm.cmd --prefix perses/ui/app run test:bundle-boundaries`. Expected: all Node tests pass.

### Step 2: Put `PluginRuntime` behind a memoized dynamic import

Create `pluginRuntimeLoader.ts` as the only module allowed to contain
`import('./PluginRuntime')`. Implement the cache as a small factory that accepts
a runtime importer; the production singleton supplies the literal default
`() => import('./PluginRuntime')`, while tests instantiate the factory with a
deferred/rejectable spy importer. Do not rely on mocking `PluginRuntime` module
evaluation: the JavaScript module cache would hide how many import expressions
were invoked and cannot reliably model a retryable import rejection. The
factory's returned loader must memoize the module promise so simultaneous first
requests invoke its importer once. A rejected module import must clear that
specific cached promise to permit retry, matching the plugin request-cache
convention. Keep the factory module-internal to the remote implementation
surface; it is a test seam, not a new package-root API.

Update the two static consumers:

- `remotePluginLoader.ts`: inside Plan 014's single-exposure and legacy whole-module load functions, await `getPluginRuntimeModule()` and call its `loadPlugin`. Constructing `remotePluginLoader()` and calling `getInstalledPlugins()` must not trigger the runtime import.
- `PluginLoaderComponent.tsx`: replace the static `usePluginRuntime` import
  with an effect-driven call through `getPluginRuntimeModule()`. Key the effect
  and its dependency list by all three request inputs: `plugin.moduleName`,
  `plugin.name`, and `plugin.baseURL`. Build a collision-safe full request key,
  such as `JSON.stringify([moduleName, name, baseURL])`, and associate loaded
  module and error state with that key. Before throwing an error, looking up a
  named export, or rendering a plugin, verify the stored state's key equals the
  current request key; a prop-change render happens before the new effect can
  clear state, so an effect-only reset is insufficient. Update the existing
  remount guard and `PluginContainer` key to the same full identity, and place
  the guard before all module/export validation. At the start of every new
  request, also clear both the previous `pluginModule` and error so stale UI
  cannot remain visible while the replacement is pending. Add an effect-local cancellation flag
  whose cleanup runs on unmount and every request-identity change. Check it
  after the dynamic-module import, after `loadPlugin(moduleName, name,
  baseURL)`, and in the rejection path so neither continuation for stale
  plugin A calls `setPluginModule`/`setError` after the component moves to
  plugin B. Capture those three scalar inputs inside the effect; preserve the
  current error-boundary behavior, missing-export validation, and
  `previousPluginName` remount guard. Do not dynamically import inside render.

Tests must prove:

- importing/constructing the loader and listing metadata performs zero runtime-module loads;
- two simultaneous plugin loads share one module import;
- a failed module import can be retried;
- `PluginLoaderComponent` does not set state after unmount, ignores a late
  plugin-A completion after switching to plugin B, clears A while B is
  pending, and keeps its current error messages;
- rerendering with the same module/name but a different `baseURL` starts a new
  request, and every request passes the exact captured
  `loadPlugin(moduleName, name, baseURL)` arguments;
- deferred A-to-B rerenders cover both resolution orders, including A
  resolving after B, without stale A rendering or state writes;
- an A-to-B rerender where A's loaded module lacks B's export does not throw
  during the immediate transition render before B's effect settles, proving
  stale state is guarded before export/error validation;
- Plan 014's one-exposure behavior still issues only one remote exposure load.

**Verify**: run the plugin runtime test command. Expected: all three test files pass, including at least one retry and one simultaneous-first-load case.

### Step 3: Make the components package accurately tree-shakeable and add stable subpaths

1. Move the top-level ECharts `use([...])` call into an idempotent `ensureEChartsModulesRegistered()` helper. Call it immediately before the first `init(...)` in the EChart layout effect. Guard with module-local state so multiple chart mounts do not repeat registration. Integrate with the EChart lifecycle and mocks created by Plan 012.
2. Add
   `"sideEffects": ["**/*.css", "**/theme/typography.js", "**/test/setup-tests.*"]`
   to `shared/components/package.json`. The typography pattern is intentional:
   its emitted JavaScript imports external `@fontsource/lato/*.css`, so marking
   only CSS files would let a bundler discard the loader and silently change
   font behavior for root consumers. The final pattern preserves the existing
   bare `@testing-library/jest-dom/extend-expect` import in the unexported test
   setup emitted under `dist/test`; it must not become a public subpath. Before
   committing, run `rg -n "^import ['\"]" shared/components/src`. At the
   planned commit the only expected results are the Lato CSS imports in
   `theme/typography.ts` and that test setup import. Any additional non-CSS
   production result is a STOP condition until its owning feature is made
   explicit; do not broaden the side-effect glob to all JavaScript.
3. Add this `exports` shape so the existing root targets remain available and
   the new lowercase subpaths map to files already emitted by the three build
   scripts. Keep `types` first in each conditional object:

   ```json
   {
     ".": {
       "types": "./dist/index.d.ts",
       "module": "./dist/index.js",
       "default": "./dist/cjs/index.js"
     },
     "./context": {
       "types": "./dist/context/index.d.ts",
       "module": "./dist/context/index.js",
       "default": "./dist/cjs/context/index.js"
     },
     "./e-chart": {
       "types": "./dist/EChart/index.d.ts",
       "module": "./dist/EChart/index.js",
       "default": "./dist/cjs/EChart/index.js"
     },
     "./json-editor": {
       "types": "./dist/JSONEditor.d.ts",
       "module": "./dist/JSONEditor.js",
       "default": "./dist/cjs/JSONEditor.js"
     },
     "./test-utils": {
       "types": "./dist/test-utils/index.d.ts",
       "module": "./dist/test-utils/index.js",
       "default": "./dist/cjs/test-utils/index.js"
     },
     "./package.json": "./package.json"
   }
   ```
4. Add a matching `typesVersions` map for `context`, `e-chart`, `json-editor`,
   and `test-utils`, each pointing at the same declaration target as its
   `exports.types` entry. Both `shared/tsconfig.base.json` and
   `perses/ui/tsconfig.base.json` still use legacy `moduleResolution: "node"`,
   which does not consume the `exports` conditions; do not claim the subpaths
   are TypeScript-compatible without this fallback. Use the narrow map below;
   do not add a catch-all that makes undeclared deep imports appear supported:

   ```json
   {
     "typesVersions": {
       "*": {
         "context": ["dist/context/index.d.ts"],
         "e-chart": ["dist/EChart/index.d.ts"],
         "json-editor": ["dist/JSONEditor.d.ts"],
         "test-utils": ["dist/test-utils/index.d.ts"]
       }
     }
   }
   ```
5. Create `type-tests/subpath-imports.ts` that imports and references a public
   symbol from every new subpath, plus `tsconfig.subpaths.json` that explicitly
   extends the shared base while retaining `moduleResolution: "node"` and
   emits nothing. Add a `type-check:subpaths` package script. Run it only after
   the package build has emitted declarations; this must be a consumer-style
   resolution check through `@perses-dev/components/...`, not relative source
   imports, and the fixture config must not add a `paths` shortcut that bypasses
   the package manifest.
6. Do not remove the corresponding root re-exports. This plan creates an additive migration path; root removal requires separate compatibility/release approval.
7. Add tests around EChart registration: importing an unrelated components entry must not register ECharts, first EChart initialization registers once before `init`, a second mount does not register again, and Plan 012 resize cleanup remains intact.

Run the shared build and inspect `shared/components/dist` to confirm every
declared `exports` target exists in ESM, CJS, and declaration output. From the
installed workspace, run the `require.resolve` smoke test for the root and all
four code subpaths. Do not execute the CommonJS root in raw Node: its existing
theme branch imports CSS that only a browser bundler handles. Putting `module`
before `default` is intentional: Rspack's ESM resolver selects the tree-shakeable
ESM `.js`, while Node (which does not enable the `module` condition) resolves
the existing CJS-compatible default without requiring `"type": "module"` or a
`.mjs` migration. The local-shared Rspack build in Step 4 must prove its module
identifiers came through the sibling workspace package manifests. Do not
commit generated files.

**Verify**: run the components test, shared typecheck, shared lint, shared
build, legacy-resolver subpath typecheck, and package subpath resolution
commands. Expected: all exit 0; the CJS-condition resolution smoke test for
each declared subpath succeeds without `ERR_PACKAGE_PATH_NOT_EXPORTED`, the
Node10-style TypeScript fixture resolves every declaration, and every ESM/types
target exists for the Rspack/typecheck gates that follow.

### Step 4: Generate post-change stats and enforce the boundary

Generate `plans/.plan-015-stats/stats.after.json`, then run the boundary
assertion against the preserved sibling `stats.before.json` using the two
commands in the table.

The assertion must establish all of the following:

- `PluginRuntime` and the Module Federation runtime family exist only in
  non-initial chunks;
- ECharts, EChart registration, JSONEditor, CodeMirror, and React CodeMirror do not appear in initial chunks reached by the app entrypoint;
- the initial app graph still contains the Lato 300/400/700/900 CSS modules;
- total initial JavaScript bytes are no larger than the baseline;
- the checker inspected non-empty entrypoints, chunks, and module details.

Record before/after raw initial byte totals in the executor handoff, not in a
hard-coded source comment or generated artifact. If a PR already exists or is
created later under separate instruction, copy the totals there as well.

**Verify**: run the local-shared stats and boundary assertion commands. Expected: both exit 0 and the checker prints `PASS` with before/after initial-byte totals.

### Step 5: Run normal-resolution integration gates and inspect both repositories

Run both full shared package test suites, the full shared typecheck/lint/build,
the legacy-resolver subpath typecheck, app typecheck/lint, and the normal app
build. The normal app build intentionally does not set `LOCAL_SHARED_BUILD`; it
protects the published-package path from accidental alias leakage.

Then run:

- `git -C shared diff --check PLAN015_SHARED_BASE..HEAD`
- `git -C perses diff --check PLAN015_PERSES_BASE..HEAD`
- `git -C shared diff --name-status PLAN015_SHARED_BASE..HEAD`
- `git -C perses diff --name-status PLAN015_PERSES_BASE..HEAD`
- `git -C shared status --short`
- `git -C perses status --short`

Replace the symbolic base labels in those commands with the exact SHAs recorded
in Step 0. Expected: both `diff --check` calls are empty; the two committed-diff
lists contain only their repository's in-scope files; both status calls are
empty. Stats and `dist` files are absent from tracked changes. A clean status
alone is not a scope proof because an out-of-scope change may already have been
committed.

## Test plan

- `pluginRuntimeLoader.test.ts`: use the injected deferred importer factory to
  assert exact importer invocation counts for lazy load, concurrent
  deduplication, and rejection eviction/retry without relying on the native
  module cache.
- `remotePluginLoader.test.ts`: construction/listing does not load runtime; named exposure still loads once.
- `PluginLoaderComponent.test.tsx`: dynamic module loading, unmount safety,
  A-to-B and baseURL-only request identity changes, both deferred resolution
  orders, exact runtime call arguments, immediate pre-effect stale-state
  suppression, and current error cases.
- `EChart.test.tsx`: deferred one-time ECharts registration combined with Plan 012's resize lifecycle tests.
- `check-bundle-boundaries.test.mjs`: deterministic synthetic stats; never assert timings or content hashes.
- Integration: one pre-change report-only stats file, one post-change asserted stats file, and a normal app production build.
- Temporary stats live only in `plans/.plan-015-stats`, outside both source
  repositories and outside Rspack's cleaned output directory; remove that exact
  directory after recording the handoff totals.

## Done criteria

- [ ] No static import of `./PluginRuntime` remains outside tests; `rg -n "from './PluginRuntime'" shared/plugin-system/src/remote -g "*.ts" -g "*.tsx"` returns no production matches.
- [ ] `rg -n "import\('./PluginRuntime'\)" shared/plugin-system/src/remote/pluginRuntimeLoader.ts` returns exactly the one production importer expression; type declarations or tests do not duplicate it.
- [ ] An injected importer test seam proves exact runtime-import call counts;
  imports are memoized, retryable after rejection, and triggered only by an
  actual remote plugin request/component mount.
- [ ] PluginLoaderComponent state and its pre-validation render guard use the
  full `moduleName`/`name`/`baseURL` identity; tests prove unmount and changes
  to any field prevent late writes, immediate stale throws, or stale rendering.
- [ ] The components package marks only CSS, the typography font loader, and the unexported test setup as side-effectful and has additive root/context/e-chart/json-editor/test-utils exports.
- [ ] Every new subpath has an `exports.types` and matching `typesVersions` target, and the committed legacy-`node` resolution fixture typechecks after build.
- [ ] ECharts modules register once immediately before first chart initialization, not at module import.
- [ ] Bundle-script unit tests pass and reject both heavyweight initial modules and initial-byte regressions.
- [ ] Real Rspack JSON contains non-empty assets, entrypoints, chunks, modules, nested-module traversal data, and module chunk IDs; the checker cannot pass on an empty/default stats shape.
- [ ] `require.resolve` selects every declared CJS/default subpath, while post-change Rspack stats prove normal package resolution selected sibling-workspace ESM modules and no duplicate singleton family.
- [ ] Post-change local-shared stats place both `PluginRuntime` and the Module Federation runtime family outside initial chunks, retain all four Lato weights, pass every structural boundary, and do not exceed baseline initial JS bytes.
- [ ] Focused and full plugin-system/components tests, complete shared typecheck/lint/build, legacy-resolver subpath typecheck, app typecheck/lint, and normal app build all exit 0.
- [ ] `diff --check`, committed-diff whitelists from the two Step 0 base SHAs, and clean worktree checks pass in both repositories.
- [ ] Neither repository has tracked generated bundle/stat output or out-of-scope source changes.
- [ ] The temporary `plans/.plan-015-stats` directory is removed after its raw
  totals are copied to the executor handoff (and an existing PR, if any); no
  stats artifact is committed.
- [ ] `plans/README.md` marks Plan 015 `DONE`.

## STOP conditions

Stop and report instead of improvising if:

- Plan 012 or Plan 014 is not complete, or their excerpts/tests no longer match this plan;
- Rspack stats cannot reliably distinguish initial from async chunks with available structured fields;
- `PluginRuntime` is already absent from initial/synchronous loader chunks before optimization;
- Module Federation requires synchronous runtime/share initialization before the first remote request;
- any remote relies on ECharts registration occurring merely by importing `@perses-dev/components` without rendering/importing EChart;
- `rg -n "^import ['\"]" shared/components/src` reveals non-CSS import-for-side-effect behavior that cannot be safely moved behind its owning feature;
- package compatibility policy forbids adding an `exports` map without a major release, or an existing documented deep-import path cannot be represented additively;
- the legacy `moduleResolution: "node"` fixture cannot resolve every advertised
  subpath through a narrow `typesVersions` map without changing global
  TypeScript resolution behavior;
- the shared-first production module search introduces duplicate React, React Query, Router, Emotion, MUI, or Hook Form instances despite the exact singleton aliases;
- meeting the boundary requires changing Module Federation singleton/version configuration or removing public root exports;
- any verification fails twice after a reasonable in-scope correction.

## Maintenance notes

- Keep `PluginRuntime` imports routed through `pluginRuntimeLoader.ts`; a future static import silently defeats this boundary.
- New heavy components should receive explicit subpaths and must not add module-evaluation side effects to the root graph.
- The checked bundle test is structural rather than tied to content hashes, which change every build. Update forbidden module families only when entrypoint product requirements genuinely change.
- Root exports remain for compatibility. After at least one release with documented subpaths, a separate semver-aware plan may migrate consumers and remove test utilities/heavy features from the CJS root.
- If Module Federation later supports lazy asynchronous share providers, profile that separately; do not mix provider semantics into this plan.
