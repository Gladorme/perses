# Plan 020: Move VariableEditorForm default backfill out of render

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite workspace root)**:
> `git -C shared diff --stat f8cd4b7..HEAD -- plugin-system/src/components/Variables/VariableEditorForm/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: shared commit `f8cd4b7`, 2026-07-21

## Why this matters

`ListVariableEditorForm` calls `form.setValue(...)` unconditionally **during
render** to backfill missing spec defaults. Writing external (react-hook-form)
state during the render phase violates React's purity rules: it can trigger
cascading re-renders, fires before the form is fully mounted, runs twice under
StrictMode, and makes form dirtiness/validation timing nondeterministic. The
code's own `TODO: check if react-hook-form has a better way to do this`
acknowledges the smell.

## Current state

- `shared/plugin-system/src/components/Variables/VariableEditorForm/VariableEditorForm.tsx`
  — `ListVariableEditorForm` (starts line 95) reads
  `const values = form.getValues() as ListVariableDefinition;` (line 99) and
  then, in the render body (lines 134–150):

```ts
  // When variable kind is selected we need to provide default values
  // TODO: check if react-hook-form has a better way to do this
  if (values.spec.allowAllValue === undefined) {
    form.setValue('spec.allowAllValue', false);
  }

  if (values.spec.allowMultiple === undefined) {
    form.setValue('spec.allowMultiple', false);
  }

  if (!values.spec.plugin) {
    form.setValue('spec.plugin', { kind: 'StaticListVariable', spec: {} });
  }

  if (!values.spec.sort) {
    form.setValue('spec.sort', 'none');
  }
```

- The form context comes from `useFormContext<VariableDefinition>()`; the
  variable-kind switch (Text ↔ List) is what makes these fields undefined:
  when the user switches kind to `ListVariable`, list-only fields have no
  values yet.
- The backfill's purpose: ensure `spec.allowAllValue`, `spec.allowMultiple`,
  `spec.plugin`, `spec.sort` are defined once the List editor is shown, so
  controlled inputs and preview queries receive concrete values.

## Commands you will need

Node `v22.14.0` / npm `10.9.2` pinned; STOP if not activatable. Windows:
`npm.cmd`.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix shared ci` | exit 0; lockfile unchanged |
| Focused test | `npm --prefix shared run test --workspace=@perses-dev/plugin-system -- --runInBand VariableEditorForm` | exit 0 |
| Typecheck | `npm --prefix shared run type-check -- --filter=@perses-dev/plugin-system` | exit 0 |
| Lint | `npm --prefix shared run lint --workspace=@perses-dev/plugin-system` | exit 0 |

## Suggested executor toolkit

- If available, use `vercel-react-best-practices` regarding render purity and
  effect-based external-store writes.

## Scope

**In scope**:

- `shared/plugin-system/src/components/Variables/VariableEditorForm/VariableEditorForm.tsx`
- The existing test file for this component if present in the same directory
  (extend it); otherwise create
  `shared/plugin-system/src/components/Variables/VariableEditorForm/VariableEditorForm.test.tsx`.

**Out of scope** (do NOT touch):

- The form schema/resolver and `VariableDefinition` types in `@perses-dev/core`.
- Other editor forms (`TextVariableEditorForm`, panel editors).
- Changing default values themselves (`false`, `StaticListVariable`, `'none'`).

## Git workflow

- Nested `shared` repository, branch
  `advisor/020-variable-editor-defaults-effect`.
- One commit, e.g. `[BUGFIX] plugin-system: backfill list-variable defaults outside render`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Characterize current behavior with a test

Add/extend a test that mounts the variable editor form with a
`TextVariable` definition, switches kind to List (or mounts directly with a
`ListVariable` whose spec omits `allowAllValue`, `allowMultiple`, `plugin`,
`sort`), and asserts the rendered List editor shows the defaults (e.g. the
"Allow All" switch is off, plugin kind selector shows Static List, sort is
none). Model the render harness after the existing tests in
`shared/plugin-system/src/components/Variables/` (grep for `*.test.tsx` there;
if none exists, follow `TimeRangeControls.test.tsx` in the same package for
provider wrapping).

**Verify**: focused test → passes against CURRENT code (this is a
characterization test pinning behavior before the refactor).

### Step 2: Move the backfill into an effect

Replace the four render-phase `if (...) form.setValue(...)` blocks with one
`useEffect` in `ListVariableEditorForm`:

```ts
useEffect(() => {
  const spec = form.getValues().spec as ListVariableDefinition['spec'];
  if (spec.allowAllValue === undefined) form.setValue('spec.allowAllValue', false);
  if (spec.allowMultiple === undefined) form.setValue('spec.allowMultiple', false);
  if (!spec.plugin) form.setValue('spec.plugin', { kind: 'StaticListVariable', spec: {} });
  if (!spec.sort) form.setValue('spec.sort', 'none');
  // Run when the list editor mounts; form identity is stable from useFormContext.
}, [form]);
```

Ensure controlled inputs tolerate one initial render with `undefined` values
(they already use `field.value ?? ''` / `!!field.value` patterns in this
file — verify the four affected fields do the same; if one renders
`undefined` into a controlled MUI input, give it the same `?? ''`/`?? false`
fallback in its `render` prop).

Remove the now-obsolete `TODO` comment. Keep `values`/`previewDefinition`
logic untouched.

**Verify**: focused test from Step 1 still passes.

### Step 3: Package checks

**Verify**: typecheck, lint, and the focused test command all exit 0.

## Test plan

- Characterization test (Step 1): defaults visible after mounting the List
  editor with a sparse spec.
- Optional negative test: an explicit `allowAllValue: true` is NOT overwritten
  by the backfill.
- Verification: focused test command → all pass.

## Done criteria

- [ ] `rg -n "^\s*if \(values.spec" shared/plugin-system/src/components/Variables/VariableEditorForm/VariableEditorForm.tsx` → no render-phase setValue guards remain.
- [ ] `rg -n "useEffect" shared/plugin-system/src/components/Variables/VariableEditorForm/VariableEditorForm.tsx` → includes the new backfill effect.
- [ ] Focused tests pass; typecheck and lint exit 0.
- [ ] `git -C shared diff --name-only f8cd4b7..HEAD` lists only in-scope paths.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- The render-phase `setValue` calls are gone (drift).
- Moving the backfill to an effect visibly changes form dirtiness semantics in
  a way that breaks an existing test (e.g. save button enabled state) — report
  with the failing test name; a fix may need `{ shouldDirty: false }` options,
  which you may add, but if that is insufficient, stop.
- The controlled inputs crash on first undefined render and fixing them
  requires touching files outside scope.

## Maintenance notes

- If react-hook-form is upgraded, consider `useForm` `defaultValues` with a
  kind-specific reset (`form.reset`) on kind switch — the cleaner long-term
  fix, deferred because it touches the parent form wiring.
- Reviewers: confirm `setValue` calls use `shouldDirty: false` if dirtiness
  regressions appear in QA.
