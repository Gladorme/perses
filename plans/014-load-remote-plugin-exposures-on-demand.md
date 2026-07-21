# Plan 014: Load only requested remote-plugin exposures

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report—do not improvise. When done, update this plan's status row in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
> `git -C shared diff --stat f8cd4b7..HEAD -- plugin-system/src/model/plugin-loading.ts plugin-system/src/components/PluginRegistry/PluginRegistry.tsx plugin-system/src/components/PluginRegistry/PluginRegistry.test.tsx plugin-system/src/remote/remotePluginLoader.ts plugin-system/src/remote/remotePluginLoader.test.ts plugin-system/src/runtime/plugin-registry.ts plugin-system/src/runtime/plugin-registry.test.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding. A semantic
> mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: shared commit `f8cd4b7`, 2026-07-21

## Why this matters

The registry asks for one plugin by type and name, but the remote loader imports every exposure declared by that plugin module, one after another. A module with `K` exposures therefore makes first use of one plugin wait for all `K` remote loads and initialize unused code. Dashboard startup adds another serial loop while discovering datasource builtin variables. This plan adds an optional name-aware loader path without breaking existing custom `PluginLoader` implementations, caches it per module and exposure, and starts independent datasource imports concurrently.

## Current state

- `shared/plugin-system/src/model/plugin-loading.ts` defines the public loader contract. It says plugins load on demand, but only exposes whole-module import:

  ```ts
  // plugin-loading.ts:20-22
  export interface PluginLoader {
    getInstalledPlugins: () => Promise<PluginModuleResource[]>;
    importPluginModule: (resource: PluginModuleResource) => Promise<unknown>;
  }
  ```

- `shared/plugin-system/src/components/PluginRegistry/PluginRegistry.tsx` caches by `PluginModuleResource`, loads the entire module, and then selects `pluginModule[name]`:

  ```ts
  // PluginRegistry.tsx:38-48
  const importCache = useRef(new Map<PluginModuleResource, Promise<unknown>>());
  const loadPluginModule = useEvent((resource: PluginModuleResource) => {
    let request = importCache.current.get(resource);
    if (request === undefined) {
      request = importPluginModule(resource);
      importCache.current.set(resource, request);
      request.catch(() => importCache.current.delete(resource));
    }
    return request;
  });
  ```

- `shared/plugin-system/src/remote/remotePluginLoader.ts` serially awaits every exposure:

  ```ts
  // remotePluginLoader.ts:111-120
  for (const plugin of resource.spec.plugins) {
    const remotePluginModule = await loadPlugin(pluginModuleName, plugin.spec.name, pluginsAssetsPath);
    const remotePlugin = remotePluginModule?.[plugin.spec.name];
    if (remotePlugin) pluginModule[plugin.spec.name] = remotePlugin;
    else console.error(`RemotePluginLoader: Error loading plugin ${plugin.spec.name}`);
  }
  ```

- `shared/plugin-system/src/runtime/plugin-registry.ts` similarly waits for datasource plugins one at a time:

  ```ts
  // plugin-registry.ts:121-129
  const datasources = await listPluginMetadata(['Datasource']);
  const datasourceNames = new Set(datasources.map((datasource) => datasource.spec.name));
  const result: BuiltinVariableDefinition[] = [];
  for (const name of datasourceNames) {
    const plugin = await getPlugin('Datasource', name);
    if (plugin.getBuiltinVariableDefinitions) {
      plugin.getBuiltinVariableDefinitions().forEach((definition) => result.push(definition));
    }
  }
  ```

- Existing loader behavior and failure handling are tested in `shared/plugin-system/src/remote/remotePluginLoader.test.ts:124-237`. Registry behavior is tested through public hooks in `shared/plugin-system/src/components/PluginRegistry/PluginRegistry.test.tsx`; follow those render helpers and assertion style.
- Keep the repository's named exports, React Query keys, `useEvent` stable-callback convention, and failed-request eviction behavior. Do not replace React Query's plugin cache with another state library.

## Commands you will need

Use Node `v22.14.0` from `shared/.nvmrc` and npm `10.9.2` from
`shared/package.json`; if those pinned versions cannot be activated, STOP
before installing or testing.

Run commands from the composite workspace root (`.../perses/app`). In Windows PowerShell use `npm.cmd`; on Unix the equivalent executable is `npm`.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm.cmd --prefix shared ci` | exit 0; `shared/package-lock.json` is unchanged |
| Targeted tests | `npm.cmd --prefix shared run test --workspace=@perses-dev/plugin-system -- --runInBand src/remote/remotePluginLoader.test.ts src/components/PluginRegistry/PluginRegistry.test.tsx src/runtime/plugin-registry.test.tsx` | exit 0; all named-loader, cache, and concurrency tests pass |
| Typecheck | `npm.cmd --prefix shared run type-check -- --filter=@perses-dev/plugin-system` | exit 0, including Turbo's upstream dependency builds, with no TypeScript errors |
| Lint | `npm.cmd --prefix shared run lint --workspace=@perses-dev/plugin-system` | exit 0, no ESLint errors |
| Package build | `npm.cmd --prefix shared run build -- --filter=@perses-dev/plugin-system` | exit 0; Turbo builds upstream packages plus plugin-system ESM, CJS, and declarations |
| Full package tests | `npm.cmd --prefix shared run test --workspace=@perses-dev/plugin-system -- --runInBand` | exit 0; all plugin-system tests pass |

## Suggested executor toolkit

- Use `vercel-react-best-practices` if available when preserving stable provider callbacks and React Query observer behavior.

## Scope

**In scope** (the only source/test files you may modify):

- `shared/plugin-system/src/model/plugin-loading.ts`
- `shared/plugin-system/src/components/PluginRegistry/PluginRegistry.tsx`
- `shared/plugin-system/src/components/PluginRegistry/PluginRegistry.test.tsx`
- `shared/plugin-system/src/remote/remotePluginLoader.ts`
- `shared/plugin-system/src/remote/remotePluginLoader.test.ts`
- `shared/plugin-system/src/runtime/plugin-registry.ts`
- `shared/plugin-system/src/runtime/plugin-registry.test.tsx` (create)
- `plans/README.md` (status row only)

**Out of scope**:

- `shared/plugin-system/src/remote/PluginRuntime.tsx` and bundle splitting; Plan 015 owns that work.
- Module Federation versions, singleton/share configuration, manifest format, remote URL construction, and plugin metadata API response shapes.
- Changes to React Query keys used by `usePlugin` or `usePluginBuiltinVariableDefinitions`.
- Removing `importPluginModule`; it is the compatibility path for third-party/custom loaders.
- Any source outside `shared/plugin-system`.

## Git workflow

- Repository: `shared`.
- Branch: `advisor/014-load-remote-plugin-exposures-on-demand`.
- Keep commits logical; use the observed style, e.g. `[ENHANCEMENT] load remote plugin exposures on demand` and `[ENHANCEMENT] parallelize datasource builtin discovery`.
- Do not push or open a PR unless instructed.

## Steps

### Step 0: Reinstall the locked workspace dependencies

Run the install command from the command table before collecting a baseline or
editing code. This repository's existing `node_modules` may be incomplete; do
not treat failures caused by a missing `cross-env` or stale workspace links as
product regressions. Confirm `git -C shared diff -- package-lock.json` is empty
after installation.

Then run the two existing loader/registry suites before editing. The new runtime
test file does not exist yet, so it is intentionally absent from this baseline.

**Verify**: `npm.cmd --prefix shared ci` exits 0,
`git -C shared diff -- package-lock.json` prints nothing, and
`npm.cmd --prefix shared run test --workspace=@perses-dev/plugin-system -- --runInBand src/remote/remotePluginLoader.test.ts src/components/PluginRegistry/PluginRegistry.test.tsx`
exits 0 before source changes. Otherwise STOP and report the baseline failure.

### Step 1: Add an optional name-aware loader contract and per-exposure cache

Extend `PluginLoader` additively with an optional method whose contract is explicit:

```ts
importPlugin?: (resource: PluginModuleResource, pluginName: string) => Promise<unknown>;
```

`importPlugin` returns the implementation for that one named exposure, not a module object. Keep `importPluginModule` required and unchanged so existing loaders remain source-compatible.

In `PluginRegistry.tsx`:

1. Destructure the optional `importPlugin` method.
2. Retain the existing whole-module cache for fallback loaders.
3. Add a name-aware cache keyed by the `PluginModuleResource` identity and `pluginName` (a nested `Map` is preferable to concatenated strings).
4. When `importPlugin` exists, call it and return/validate the resulting implementation directly. When absent, use the current module import and named-export lookup.
5. Evict only the failed exposure request after rejection so it can be retried; do not evict successful sibling exposures or the fallback module promise.
6. Preserve the current “not installed” and “missing from module” error messages. For a name-aware loader returning `undefined`, use the existing “missing” error semantics.

Add focused registry tests with a purpose-built `PluginLoader`. Render a tiny
consumer of `usePluginRegistry()`, capture its `getPlugin` function, and invoke
that function directly with deferred loader promises. Do **not** drive the
cache-concurrency assertions through `usePlugin`: identical hooks share the
React Query key `['getPlugin', type, kind]`, so such a test could pass without
exercising the new registry cache at all. Cover:

- requesting `plugin1` calls `importPlugin(resource, 'plugin1')` and does not call `importPluginModule`;
- two simultaneous requests for the same exposure share one promise;
- two different names in the same module start two separate named imports;
- a failed named request is evicted and can succeed on retry;
- a named loader returning `undefined` and a named loader rejection preserve
  the fallback path's missing-export and error behavior;
- a loader without `importPlugin` still imports one module and selects named exports exactly as before.

**Verify**: run the targeted test command. Expected: all `PluginRegistry` tests pass, including at least five new named-loader/cache cases.

### Step 2: Implement one-exposure remote loading and parallelize the legacy fallback

In `remotePluginLoader.ts`, implement `importPlugin(resource, pluginName)`:

1. Confirm `pluginName` exists by evaluating
   `resource.spec.plugins.some((plugin) => plugin.spec.name === pluginName)`;
   the array contains metadata objects, not strings. If it does not exist,
   return `undefined` and log the same missing-plugin form used today. Do not
   issue a remote request.
2. Call `loadPlugin(resource.metadata.name, pluginName, pluginsAssetsPath)` exactly once.
3. Return `remotePluginModule?.[pluginName]`; retain the current error logging when the named export is absent.

Keep `importPluginModule` for compatibility, but replace the serial loop with
`Promise.all` over declared exposures. All requests must start concurrently;
assemble the returned object in declaration order only after every request
fulfills. Preserve current failure semantics: the aggregate rejects on the
first rejection while already-started sibling requests may still finish; a
resolved module missing one export logs that exposure and returns the other
valid exports.

Update `remotePluginLoader.test.ts`:

- a named request loads only the requested exposure from a multi-exposure resource;
- an unknown name performs zero `loadPlugin` calls;
- two named requests can start independently;
- legacy whole-module import starts all exposure promises before either is resolved (use deferred promises, not elapsed-time assertions);
- a deferred legacy request rejects while proving every sibling exposure was
  already started and no partial module object is returned;
- existing partial/missing/rejected behavior remains covered.

Do not assert `NthCalledWith` ordering for concurrently started legacy loads; assert the exact unordered call set instead.

**Verify**: run the targeted test command. Expected: all remote-loader and registry tests pass; the deferred-promise test proves concurrent starts without timers.

### Step 3: Start datasource builtin discovery concurrently

In `usePluginBuiltinVariableDefinitions`, preserve `Set` insertion order but replace the sequential `for...of await` with:

1. `Array.from(datasourceNames)` for a deterministic name list;
2. `Promise.all(names.map((name) => getPlugin('Datasource', name)))`;
3. an ordered `flatMap` that returns each plugin's builtin definitions or an empty array.

Create `runtime/plugin-registry.test.tsx` using a real `QueryClient` configured
with query `retry: false`, `PluginRegistryContext.Provider`, and Testing
Library's `renderHook`/`waitFor` style used elsewhere in
`plugin-system/src/runtime` tests. Cover:

- all `getPlugin` calls begin before deferred plugin promises resolve;
- output order follows metadata/first-seen datasource name order even if promises resolve out of order;
- duplicate datasource metadata names trigger one import;
- plugins without `getBuiltinVariableDefinitions` contribute no definitions;
- a rejection still rejects the React Query result rather than silently dropping a datasource.

**Verify**: run the targeted test command. Expected: all tests pass, including the concurrency and deterministic-order cases.

### Step 4: Run package gates and inspect scope

Run typecheck, lint, the full package test suite, and package build from the command table. Then run:

`git -C shared status --short`

Expected: only the seven in-scope source/test files are modified or created (plus `../plans/README.md` if the executor owns status updates); generated `dist` output must remain untracked/ignored.

## Test plan

- Extend `remotePluginLoader.test.ts` using its existing mocked `loadPlugin` and resource fixtures.
- Extend `PluginRegistry.test.tsx` with an injected loader fixture that records
  calls and exposes deferred promises. Capture `usePluginRegistry().getPlugin`
  from a test consumer and call it directly for cache assertions; React Query
  hook deduplication must not be part of those tests.
- Create `runtime/plugin-registry.test.tsx` for builtin discovery concurrency and ordering.
- Avoid performance tests based on milliseconds; promise-start ordering is deterministic and CI-safe.
- Verification: targeted tests first, then the complete plugin-system package tests.

## Done criteria

- [ ] `PluginLoader` has an optional, documented single-exposure import method; existing whole-module loaders still typecheck.
- [ ] A registry request for one remote exposure issues exactly one remote `loadPlugin` call.
- [ ] Same-exposure concurrent requests are deduplicated; different exposures are independently cached; failed requests are retryable.
- [ ] Legacy `importPluginModule` loads all exposures concurrently and preserves current partial/missing/rejection semantics.
- [ ] Datasource builtin plugin requests start concurrently and results remain deterministic.
- [ ] The pinned toolchain, clean install, and pre-edit loader/registry baseline pass.
- [ ] Targeted tests, full plugin-system tests, typecheck, lint, and build all exit 0.
- [ ] `git -C shared diff --name-only f8cd4b7..HEAD` lists exactly the seven in-scope source/test files, and `git -C shared status --short` is empty after the plan's logical commits.
- [ ] `plans/README.md` marks Plan 014 `DONE`.

## STOP conditions

Stop and report instead of improvising if:

- the `PluginLoader` contract or registry import cache has changed semantically since `f8cd4b7`;
- adding an optional method is rejected by the package's compatibility policy and would require a breaking replacement of `importPluginModule`;
- a remote exposure name is not guaranteed to equal `plugin.spec.name` under the current manifest contract;
- tests reveal consumers depend on eager initialization or sequential side effects between exposures;
- deterministic builtin-definition ordering cannot be preserved with `Promise.all`;
- completing the work requires editing `PluginRuntime.tsx`, Module Federation config, plugin manifests, or files outside the stated scope;
- any verification command fails twice after a reasonable in-scope correction.

## Maintenance notes

- New `PluginLoader` implementations should implement the optional named method when their storage/runtime can load exposures independently; the whole-module method remains the fallback.
- Reviewers should scrutinize cache eviction and error parity. A rejected promise must not poison future retries, while successful requests must remain deduplicated.
- Plan 015 may change how `remotePluginLoader` obtains the `loadPlugin` function, but it must preserve the name-aware API and tests introduced here.
- If the manifest later supports aliases where metadata name and exposed export differ, centralize that mapping before changing this cache key.
