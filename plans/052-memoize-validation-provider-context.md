# Plan 052: Memoize the ValidationProvider context value and setters

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite repository root)**:
> `git -C shared diff --stat 472a289..HEAD -- plugin-system/src/context/ValidationProvider.tsx`
> If the file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: `shared` repo commit `472a289`, 2026-07-20

## Why this matters

`ValidationProvider` passes a **new object literal** as its context `value` on
every render, and the four setter functions inside that object
(`setDatasourceEditorSchemaPlugin`, `setPanelEditorSchemaPlugin`,
`setVariableEditorSchemaPlugin`, `setAnnotationEditorSchemaPlugin`) are
re-declared each render. Every consumer of `useValidationSchemas()` — the
datasource, panel, variable, and annotation editor forms — re-renders whenever
`ValidationProvider` re-renders, even when none of the four schemas changed.
The provider re-renders both when one schema changes (expected) and when its
parent re-renders (unnecessary fan-out). Memoizing the value and stabilizing the
setters limits consumer re-renders to actual schema changes. This mirrors the
already-correct provider pattern used elsewhere (e.g.
`TimeRangeProvider`, and plan 034 for the Authorization context).

## Current state

Repo **`shared`**, package `@perses-dev/plugin-system`, file
`plugin-system/src/context/ValidationProvider.tsx`.

```tsx
// ValidationProvider.tsx (current, abridged)
export function ValidationProvider({ children }: ValidationProviderProps): ReactElement {
  const [datasourceEditorSchema, setDatasourceEditorSchema] = useState<...>(datasourceDefinitionSchema);
  const [panelEditorSchema, setPanelEditorSchema] = useState<...>(defaultPanelEditorSchema);
  const [variableEditorSchema, setVariableEditorSchema] = useState<...>(variableDefinitionSchema);
  const [annotationEditorSchema, setAnnotationEditorSchema] = useState<...>(annotationSpecSchema);

  function setDatasourceEditorSchemaPlugin(pluginSchema: PluginSchema): void {
    setDatasourceEditorSchema(buildDatasourceDefinitionSchema(pluginSchema));
  }
  function setPanelEditorSchemaPlugin(pluginSchema: PluginSchema): void {
    setPanelEditorSchema(buildPanelEditorSchema(pluginSchema));
  }
  function setVariableEditorSchemaPlugin(pluginSchema: PluginSchema): void {
    setVariableEditorSchema(buildVariableDefinitionSchema(pluginSchema));
  }
  function setAnnotationEditorSchemaPlugin(pluginSchema: PluginSchema): void {
    setAnnotationEditorSchema(buildAnnotationSpecSchema(pluginSchema));
  }

  return (
    <ValidationSchemasContext.Provider
      value={{
        datasourceEditorSchema, panelEditorSchema, variableEditorSchema, annotationEditorSchema,
        setDatasourceEditorSchemaPlugin, setPanelEditorSchemaPlugin, setVariableEditorSchemaPlugin, setAnnotationEditorSchemaPlugin,
      }}
    >
      {children}
    </ValidationSchemasContext.Provider>
  );
}
```

Neither `useMemo` nor `useCallback` is imported yet (only `useState`,
`useContext`, `createContext`). The four `useState` setters
(`setDatasourceEditorSchema` etc.) are already stable React state setters. The
`build*` helpers are stable module imports.

## Commands you will need

Use Node `v22.14.0` (`shared/.nvmrc`) and npm `10.9.2`; if those pinned
versions cannot be activated, STOP before installing or testing. Run from the
composite repository root.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix shared ci` | exit 0; lockfile unchanged |
| Focused test | `npm --prefix shared run test --workspace=@perses-dev/plugin-system -- ValidationProvider` | exit 0 (or "no tests found" if none yet — then rely on the new test) |
| Typecheck | `npm --prefix shared run type-check -- --filter=@perses-dev/plugin-system` | exit 0 |
| Lint | `npm --prefix shared run lint --workspace=@perses-dev/plugin-system` | exit 0, exhaustive-deps clean |
| Full package tests | `npm --prefix shared run test --workspace=@perses-dev/plugin-system` | exit 0 |

## Scope

**In scope** (the only implementation files you should modify):

- `shared/plugin-system/src/context/ValidationProvider.tsx`
- A colocated `ValidationProvider.test.tsx` (create)

`plans/README.md` is an administrative status-only exception after completion.

**Out of scope** (do NOT touch):

- The schema `build*` helpers and the imported default schemas.
- `useValidationSchemas` consumers (the editor forms).
- The `ValidationSchemas` interface shape (keep it identical).
- Any other provider in `plugin-system`.

## Git workflow

- Work in the nested `shared` repository on branch
  `advisor/052-memoize-validation-provider-context`.
- Commit as one logical unit after verification, e.g.:
  `[ENHANCEMENT] plugin-system: memoize ValidationProvider context value`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 0: Reinstall the locked shared workspace

`npm --prefix shared ci`. **Verify**: exits 0 and
`git -C shared diff -- package-lock.json` prints nothing.

### Step 1: Add a regression test proving context-value churn

Create `ValidationProvider.test.tsx`. Render `ValidationProvider` around a
consumer that reads `useValidationSchemas()` and records the context value
identity on each render. Force a parent re-render that changes no schema, and
assert the context value is reference-equal across renders. Also assert that
after calling one setter (e.g. `setVariableEditorSchemaPlugin`), the value
identity **does** change and `variableEditorSchema` is updated (so memoization
cannot pass by freezing the value).

**Verify**: before the production change, the "stable across unrelated
re-render" assertion fails. Do not commit this intermediate state.

### Step 2: Stabilize the setters with `useCallback`

Wrap each of the four `set*SchemaPlugin` functions in `useCallback` with an
empty dependency array — each only calls a stable React state setter and a
stable module helper:

```tsx
const setDatasourceEditorSchemaPlugin = useCallback((pluginSchema: PluginSchema): void => {
  setDatasourceEditorSchema(buildDatasourceDefinitionSchema(pluginSchema));
}, []);
// ...same shape for panel, variable, annotation
```

Import `useCallback` from `react`.

**Verify**:
`npm --prefix shared run type-check -- --filter=@perses-dev/plugin-system` →
exit 0.

### Step 3: Memoize the context value

Wrap the value object in `useMemo`, keyed on the four schema states plus the
four (now-stable) setters:

```tsx
const contextValue = useMemo<ValidationSchemas>(() => ({
  datasourceEditorSchema, panelEditorSchema, variableEditorSchema, annotationEditorSchema,
  setDatasourceEditorSchemaPlugin, setPanelEditorSchemaPlugin, setVariableEditorSchemaPlugin, setAnnotationEditorSchemaPlugin,
}), [
  datasourceEditorSchema, panelEditorSchema, variableEditorSchema, annotationEditorSchema,
  setDatasourceEditorSchemaPlugin, setPanelEditorSchemaPlugin, setVariableEditorSchemaPlugin, setAnnotationEditorSchemaPlugin,
]);
```

Pass `value={contextValue}`. Import `useMemo` from `react`.

**Verify**:
`npm --prefix shared run test --workspace=@perses-dev/plugin-system -- ValidationProvider`
→ exit 0 and the Step 1 assertions pass.

### Step 4: Lint and full package tests

**Verify**:
`npm --prefix shared run lint --workspace=@perses-dev/plugin-system` → exit 0
(exhaustive-deps clean); then
`npm --prefix shared run test --workspace=@perses-dev/plugin-system` → exit 0.

## Test plan

- One regression test with two assertions: (a) context value identity stable
  across an unrelated parent re-render; (b) identity changes and the relevant
  schema updates after a setter is invoked.
- Verification:
  `npm --prefix shared run test --workspace=@perses-dev/plugin-system -- ValidationProvider`
  → all pass.

## Done criteria

Machine-checkable; ALL must hold (run from composite root):

- [ ] `rg -n "value=\{contextValue\}" shared/plugin-system/src/context/ValidationProvider.tsx` returns one match.
- [ ] `rg -n "const contextValue = useMemo" shared/plugin-system/src/context/ValidationProvider.tsx` returns one match.
- [ ] `rg -n "useCallback" shared/plugin-system/src/context/ValidationProvider.tsx` shows all four `set*SchemaPlugin` wrapped.
- [ ] plugin-system typecheck, lint, and full tests exit 0.
- [ ] The regression test proves stable-value + correct-update behavior.
- [ ] `git -C shared diff --name-only 472a289..HEAD` lists only in-scope paths, and `git -C shared status --short` is empty after the logical commit.
- [ ] `plans/README.md` status row updated, unless the dispatcher maintains the index.

## STOP conditions

Stop and report back without improvising if:

- Live code already memoizes the value / setters (drift).
- A setter is found to depend on a prop or non-stable value (then its
  `useCallback` needs that dep — report it).
- The `ValidationSchemas` interface has changed shape (keep the plan's value
  object in sync only if it is a pure move; otherwise STOP).
- Any existing plugin-system test fails in a way that is not a pure identity
  assertion.

## Maintenance notes

- Reviewer: confirm identity-only; editor forms must still receive and apply
  updated schemas after a plugin sets one.
- If a fifth schema/setter is added later, it must go inside the memo and (if a
  function) be `useCallback`-wrapped, not added as a new inline literal.
- This is one of several provider-value-stability fixes across the codebase
  (see plans 027 and 034); keep the pattern consistent.
