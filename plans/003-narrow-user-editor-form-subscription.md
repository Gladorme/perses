# Plan 003: Narrow the user editor's form subscription

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git -C perses diff --stat 06886ac1..HEAD -- ui/app/src/components/users/UserEditorForm.tsx ui/app/src/components/users/UserEditorForm.test.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `06886ac1`, 2026-07-21

## Why this matters

`UserEditorForm` subscribes its 381-line root component to every form value even
though the root reads only whether the native-provider password exists. Every
keystroke can therefore rerender the header, all general fields, the native
provider section, and every OAuth/OIDC provider row. Moving a field-level
subscription into a small native-provider child keeps add/remove behavior intact
while preventing native/general field changes from invalidating the root and its
OAuth/OIDC row map.

## Current state

- `ui/app/src/components/users/UserEditorForm.tsx` — owns the complete user form,
  including native-provider and OAuth/OIDC provider fields.

The root creates a form and then watches its complete value (`UserEditorForm.tsx:54-65`):

```tsx
const form = useForm<UserEditorSchemaType>({
  resolver: zodResolver(userSchema),
  mode: 'onBlur',
  defaultValues: initialUserClean,
});

const { spec } = form.watch();

const { fields, append, remove } = useFieldArray({
  control: form.control,
  name: 'spec.oauthProviders',
});
```

Only one root-level conditional consumes the watched object
(`UserEditorForm.tsx:181-195`):

```tsx
<Typography variant="h1" mb={2}>
  Native Provider
</Typography>
{spec.nativeProvider?.password === undefined ? (
  <IconButton
    disabled={isReadonly || action === 'read'}
    onClick={() => form.setValue('spec.nativeProvider', { password: '' })}
    title="Add native provider"
  >
```

The same root maps every OAuth/OIDC row (`UserEditorForm.tsx:243-258`):

```tsx
{fields && fields.length > 0 ? (
  fields.map((field, index) => (
    <Fragment key={field.id}>
      <Stack key={field.id} direction="row" gap={1} alignItems="end">
        <OAuthProvider control={form.control} index={index} action={action} />
```

Repository conventions to preserve:

- `ui/ui-guidelines.md` says application state should live as close as possible
  to where it is used and recommends smaller responsibilities over broad
  components.
- Component tests use Jest and React Testing Library, live beside the source,
  and prefer role/name selectors. Follow
  `ui/app/src/components/DashboardList/NameCell.test.tsx` for the local render
  helper and MUI theme wrapper pattern.
- Keep named exports and avoid adding a dependency; React Hook Form already
  provides `useWatch`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Node toolchain | `node --version` | exactly `v22.14.0`, matching `perses/ui/.nvmrc` |
| npm toolchain | `npm --version` | exactly `10.9.2`, matching `perses/ui/package.json` |
| Install | `npm --prefix perses/ui ci` | exit 0; `perses/ui/package-lock.json` is unchanged |
| Clean baseline | `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand src/model/querykey-builder.spec.ts` | exit 0 before any source edit; Jest config resolves correctly |
| Target test | `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand src/components/users/UserEditorForm.test.tsx` | exit 0; the new tests pass |
| Typecheck | `npm --prefix perses/ui run type-check -- --filter=@perses-dev/app` | exit 0 after Turbo runs upstream builds, with no TypeScript errors |
| Lint | `npm --prefix perses/ui run lint --workspace=@perses-dev/app` | exit 0, no ESLint errors |
| App tests | `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand` | exit 0; all app tests pass |
| Production build | `npm --prefix perses/ui run build --workspace=@perses-dev/app` | exit 0; production bundle compiles |

## Suggested executor toolkit

- Use `vercel-react-best-practices` if it is available, specifically its
  guidance on narrowing subscriptions and avoiding unnecessary parent renders.
- Use the installed `react-hook-form` types as the source of truth for
  `useWatch`; do not introduce a custom subscription abstraction.

## Scope

**In scope** (the only files you should modify):

- `ui/app/src/components/users/UserEditorForm.tsx`
- `ui/app/src/components/users/UserEditorForm.test.tsx` (create)

**Out of scope** (do NOT touch):

- Other editor forms or shared form-drawer components.
- Validation rules in `@perses-dev/client` and the shape of `UserResource`.
- Memoizing or restructuring `OAuthProvider`; the broad form subscription is
  the bounded problem in this plan.
- Visual styling, labels, add/remove semantics, and submit behavior.

## Git workflow

- Branch: `advisor/003-narrow-user-editor-form-subscription`
- Commit one logical unit with the repository's observed message style, for
  example: `[ENHANCEMENT] Narrow user editor form subscription`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 0: Activate the pinned UI toolchain and prove the baseline

From the composite root, verify Node `v22.14.0` and npm `10.9.2`; activate
`perses/ui/.nvmrc` with the operator's installed version manager if needed. On
Windows PowerShell, use `npm.cmd` when `npm.ps1` is policy-blocked. Run the
install and clean-baseline commands from the table before editing. Do not use
Node 24/npm 11: in the audited environment that mismatch failed while loading
`jest.config.ts` before any test could run.

**Verify**: both version commands match exactly, `npm --prefix perses/ui ci`
exits 0, `git -C perses diff -- ui/package-lock.json` prints nothing, and the
clean-baseline Jest command exits 0. Otherwise STOP and report the environment
failure without changing source.

### Step 1: Add behavioral coverage for the native-provider branch

Create `ui/app/src/components/users/UserEditorForm.test.tsx`. Use React Testing
Library and the MUI theme wrapper pattern from
`ui/app/src/components/DashboardList/NameCell.test.tsx`. Mock only application
contexts and large shared components that prevent a focused render; keep React
Hook Form real.

Cover these cases through accessible labels and button titles:

1. A user without `spec.nativeProvider.password` shows "Add native provider";
   clicking it renders the "Password" textbox.
2. A user with a native provider shows "Remove native provider"; clicking it
   returns to the add state.
3. Editing the unrelated "First Name" textbox leaves the native-provider branch
   unchanged. Include at least one OAuth provider in this fixture so the test
   exercises the larger form shape that was previously subscribed at the root.

Use valid, synthetic resource values only. Do not copy credentials or secret
values from any environment.

**Verify**: `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand src/components/users/UserEditorForm.test.tsx` → exit 0 and all three scenarios pass against the current behavior.

### Step 2: Replace the whole-form watch with a field-level subscription

In `UserEditorForm.tsx`:

1. Import `useFormContext` and `useWatch` from `react-hook-form`.
2. Remove `const { spec } = form.watch();` entirely. The root component must not
   replace it with another `useWatch` call.
3. Extract the existing native-provider block (`UserEditorForm.tsx:180-231`) into
   a file-local named component such as `NativeProviderSection`. Give it only
   the non-form props it needs: `action`, `isReadonly`, and
   `nativeAuthnProviderEnabled`.
4. Inside that child, use `useFormContext<UserEditorSchemaType>()` to obtain
   `control` and `setValue`, then add the one field subscription:

   ```tsx
   const nativeProviderPassword = useWatch({
     control,
     name: 'spec.nativeProvider.password',
   });
   ```

5. Change the extracted conditional to `nativeProviderPassword === undefined`
   and preserve its existing `Controller`, alerts, labels, button titles, and
   `setValue` add/remove behavior.
6. Render `NativeProviderSection` at the old block location. Keep it inside the
   existing `FormProvider` so `useFormContext` resolves the same form instance.

Do not call `watch()` without a field name, do not subscribe to all of `spec`,
and do not mirror the value in React state. React Hook Form must remain the single
owner of form data. The subscription must live in the extracted child: putting
`useWatch` in `UserEditorForm` would still rerender every OAuth row for each
password keystroke.

**Verify**: `rg -n "function NativeProviderSection|form\.watch\(|const \{ spec \}|useWatch|nativeProviderPassword" perses/ui/app/src/components/users/UserEditorForm.tsx` → no `form.watch(` or `const { spec }` match; exactly one field-level `useWatch` appears inside `NativeProviderSection`, not inside `UserEditorForm`.

### Step 3: Run the focused and package-level checks

Run the new tests first, then typecheck and lint. If formatting changes are
needed, use the repository formatter through the normal UI workspace workflow;
do not hand-reformat unrelated code.

**Verify**: `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand src/components/users/UserEditorForm.test.tsx` → exit 0, then `npm --prefix perses/ui run type-check -- --filter=@perses-dev/app`, `npm --prefix perses/ui run lint --workspace=@perses-dev/app`, and `npm --prefix perses/ui run build --workspace=@perses-dev/app` → all exit 0.

### Step 4: Run the complete app test suite and inspect scope

Run the app suite and confirm only the two in-scope files changed.

**Verify**: `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand` → exit 0; `git -C perses status --short -- ui/app/src/components/users/UserEditorForm.tsx ui/app/src/components/users/UserEditorForm.test.tsx` → only the expected source and test paths are listed.

## Test plan

- New file: `ui/app/src/components/users/UserEditorForm.test.tsx`.
- Cover add, remove, and an unrelated-field edit with a realistic OAuth row.
- Use `ui/app/src/components/DashboardList/NameCell.test.tsx` as the structural
  pattern for a MUI-wrapped component test and role-based queries.
- The performance regression is also guarded structurally: the done checks
  require the unscoped `form.watch()` call to be absent and the single exact
  `useWatch` path to live in the extracted native-provider child.
- Verification: the focused test command passes, followed by the complete app
  test command.

## Done criteria

- [ ] `UserEditorForm.tsx` contains one `useWatch` subscription whose `name` is exactly `spec.nativeProvider.password`, and it is inside `NativeProviderSection`, not `UserEditorForm`.
- [ ] `rg -n "form\.watch\(" perses/ui/app/src/components/users/UserEditorForm.tsx` exits with no matches.
- [ ] Add/remove native-provider behavior and unrelated-field editing are covered by passing tests.
- [ ] The pinned-version, clean install, and pre-edit baseline gates in Step 0 all pass.
- [ ] `npm --prefix perses/ui run type-check -- --filter=@perses-dev/app` exits 0.
- [ ] `npm --prefix perses/ui run lint --workspace=@perses-dev/app` exits 0.
- [ ] `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand` exits 0.
- [ ] `npm --prefix perses/ui run build --workspace=@perses-dev/app` exits 0.
- [ ] `git -C perses diff --name-only 06886ac1..HEAD` lists exactly the two in-scope files, and `git -C perses status --short` is empty after the logical commit.
- [ ] `plans/README.md` status row is updated, unless the dispatcher said it owns the index.

## STOP conditions

Stop and report back (do not improvise) if:

- Node `v22.14.0`/npm `10.9.2` cannot be activated, `npm ci` changes the
  lockfile, or the clean-baseline Jest test fails before any source edit.

- The live form no longer contains the unscoped `form.watch()` and conditional
  shown in "Current state".
- Another root-level render branch now depends on values from `spec`; widening
  the subscription or keeping it in the parent would change this plan's premise.
- `useWatch` does not update when the existing `form.setValue('spec.nativeProvider', …)`
  calls replace the parent object.
- Focused tests require changing the public form props, resource schema, or a
  shared component outside scope.
- A verification command fails twice after one reasonable correction.

## Maintenance notes

- If a future branch needs another form value, subscribe in the smallest child
  that consumes it; do not restore an unscoped `watch()` call at the form root.
- Reviewers should confirm that editing OAuth/general fields does not change the
  root subscription and that add/remove still updates immediately.
- Further component splitting or memoization may be useful later, but should be
  justified with profiling after this narrower fix lands.
