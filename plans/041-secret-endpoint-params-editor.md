# Plan 041: Prevent data loss in the secret OAuth endpoint-params editor

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite workspace root)**:
> `git -C perses diff --stat 06886ac1..HEAD -- ui/app/src/components/secrets/SecretEditorForm.tsx`
> If the file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: perses commit `06886ac1`, 2026-07-21

## Why this matters

The OAuth section of the secret editor stores endpoint params as a
`Record<string, string[]>` and edits it directly by object key. Two silent
data-loss bugs follow:

1. **Rename collision**: typing a parameter name that (even momentarily)
   equals another existing parameter's name merges the two entries — the
   reduce keyed by name overwrites one row's values with the other's, and a
   row disappears from the UI with no warning.
2. **Double add is a no-op**: "Add Parameter" inserts key `''`; clicking it
   again while an unnamed row exists overwrites the same `''` entry, so
   nothing visibly happens.

Editing secrets is a sensitive admin flow; silently dropping auth parameters
is the kind of bug users only discover when authentication breaks later.

## Current state

All in `perses/ui/app/src/components/secrets/SecretEditorForm.tsx`, inside
the `Controller` for `spec.oauth.endpointParams` (lines ~526–660). The
value type is `EndpointParams` (`Record<string, string[]>`).

`addParam` (532–538):

```ts
const addParam = (): void => {
  const newParams: EndpointParams = {
    ...params,
    '': [''],
  };
  field.onChange(newParams);
};
```

`updateParamKey` (553–562) — the collision:

```ts
const updateParamKey = (oldKey: string, newKey: string): void => {
  const newParams: EndpointParams = Object.entries(params).reduce(
    (acc, [key, val]) => ({
      ...acc,
      [key === oldKey ? newKey : key]: val,
    }),
    {}
  );
  field.onChange(newParams);
};
```

Rows are rendered from `Object.entries(params)` keyed by `paramIndex`
(593–594); the name `TextField` calls `updateParamKey(key, e.target.value)`
on every keystroke (603).

There is also a scopes editor above (`spec.oauth.scopes`, lines ~467–522)
using index keys over a string array — it is NOT part of this fix (arrays
tolerate duplicates).

## Target design

Change the editor's **local representation** from a keyed record to an
ordered list of pairs, converting at the field boundary:

- Derive `const entries = Object.entries(params)` once per render (as now),
  but perform edits positionally:
  - `updateParamKey(index, newKey)` — rebuild the record from the entries
    array with entry `index` renamed. When the new name duplicates another
    entry's name, keep BOTH rows in the UI by still rebuilding from the
    array (last-write-wins only at save time) — the simplest correct fix
    that avoids mid-typing merges is to store the editor state as
    `Array<[string, string[]]>` in a local `useState` synced to the field:
    edits update the array; every change also writes
    `Object.fromEntries(array)` to `field.onChange` (so the persisted value
    stays a record). Show an inline `helperText` error on rows whose name
    duplicates an earlier row ("Duplicate parameter name") so the user knows
    the last one wins.
  - `addParam()` — append `['', ['']]` to the array; two unnamed rows can
    now coexist visibly (both flagged as duplicates until named).
- Key each row by its array index — stable under this positional model
  because rows are only appended/removed, never re-sorted.

This keeps the react-hook-form field type unchanged (no schema changes) and
fixes both bugs: renames never merge rows in the UI, and add always appends
a visible row.

## Commands you will need

Node `v22.14.0` / npm `10.9.2` pinned; STOP if not activatable. Windows:
`npm.cmd`.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix perses/ui ci` | exit 0; lockfile unchanged |
| Focused test | `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand SecretEditorForm` | exit 0 |
| Typecheck | `npm --prefix perses/ui run type-check -- --filter=@perses-dev/app` | exit 0 |
| Lint | `npm --prefix perses/ui run lint --workspace=@perses-dev/app` | exit 0 |

## Scope

**In scope**:

- `perses/ui/app/src/components/secrets/SecretEditorForm.tsx` (only the
  endpoint-params `Controller` block and any small helpers you extract
  from it)
- `perses/ui/app/src/components/secrets/SecretEditorForm.test.tsx`
  (create or extend)

**Out of scope** (do NOT touch):

- The scopes editor, TLS/basic-auth/authorization sections of the same form.
- The `EndpointParams` type and the persisted secret schema.
- Server-side validation.

## Git workflow

- Nested `perses` repository, branch `advisor/041-secret-endpoint-params-editor`.
- One commit, e.g. `[BUGFIX] ui: prevent data loss in secret OAuth endpoint-params editor`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Regression tests

Create/extend `SecretEditorForm.test.tsx` rendering the form in `create`
mode with the OAuth auth kind selected (read the component's props/state
wiring at the top of the file to construct minimal props; follow the app's
existing form-test patterns, e.g. other `*EditorForm.test.tsx` under
`perses/ui/app/src/components` if present):

1. click "Add Parameter" twice → TWO parameter-name inputs exist (FAILS
   against current code — only one);
2. create params `a` and `b`, then rename `b` to `a` → both rows still
   visible, duplicate indicator shown (FAILS — row vanishes today);
3. rename resolves (`a`→`c`) → indicator gone, `field` value contains both
   `a` (or `c`) keys as expected.

**Verify**: focused test → tests 1–2 fail as described. Do not commit.

### Step 2: Implement the positional editor state

Apply the Target design inside the endpoint-params `Controller`. Keep the
JSX structure (Stacks, TextFields, IconButtons, Add buttons) so styling and
read-only behavior are unchanged; only the state model and handlers change.
Preserve `action === 'read'` read-only handling on new/changed inputs.

**Verify**: focused tests all pass.

### Step 3: Package checks

**Verify**: typecheck and lint exit 0.

## Test plan

Three tests from Step 1. Assert on `field` output by submitting the form or
by asserting input values — whichever the existing form tests do.

## Done criteria

- [ ] Focused tests pass, including double-add and rename-collision cases.
- [ ] `rg -n "updateParamKey" perses/ui/app/src/components/secrets/SecretEditorForm.tsx` → the record-reduce rename is gone (positional model in place).
- [ ] Typecheck and lint exit 0.
- [ ] `git -C perses diff --name-only 06886ac1..HEAD` lists only in-scope paths.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- The endpoint-params editor was already refactored (e.g. to
  `useFieldArray`) — drift.
- Duplicate names must be REJECTED (not last-write-wins) per a validation
  rule you find elsewhere (e.g. backend 400) — implement the inline error as
  blocking (disable save) only if the form already has a validation
  mechanism for it; otherwise report.
- A verification command fails twice after a reasonable in-scope fix attempt.

## Maintenance notes

- The same record-keyed editing pattern may exist in other editors (native
  auth headers, datasource forms) — reviewers should grep for
  `updateParamKey`-like reduces as follow-up.
- Consider `useFieldArray` with `{name, values}` objects if this form is
  ever migrated; that removes the record/array conversion entirely.
