# Plan 032: Replace JSON.stringify equality in the variable-state zustand selector

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: in `shared\`, run
> `git diff --stat f8cd4b7..HEAD -- dashboards/src/context/VariableProvider/VariableProvider.tsx`
> On any change, compare "Current state" excerpts to live code first;
> mismatch = STOP.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/027-stable-variable-contexts.md (same file — avoid merge conflicts)
- **Category**: perf
- **Planned at**: `shared` repo commit `f8cd4b7`, 2026-07-20

## Why this matters

`useVariableDefinitionStates` subscribes to the variable zustand store with
an equality function that `JSON.stringify`s both the previous and next
selected state on **every store update**. Variable state includes each
variable's full `options` list — for high-cardinality variables (thousands
of label values) that's two multi-hundred-KB serializations per store change
per subscriber. During variable loading cascades this shows up as main-thread
stalls. A per-entry shallow/structural comparison does the same job in a tiny
fraction of the cost.

## Current state

Repo **`shared`**, package `@perses-dev/dashboards`.

- `shared\dashboards\src\context\VariableProvider\VariableProvider.tsx`:

```ts
// VariableProvider.tsx:120-156 (current)
export function useVariableDefinitionStates(variableNames?: string[]): VariableStateMap {
  const store = useVariableDefinitionStoreCtx();
  return useStoreWithEqualityFn(
    store,
    (s) => {
      const varStates: VariableStateMap = {};
      const names = variableNames ?? s.variableDefinitions.map((value) => value.spec.name);
      names.forEach((name) => {
        const varState = s.variableState.get({ name });
        if (!varState || varState.overridden) { return; }
        varStates[name] = varState;
      });
      s.externalVariableDefinitions.forEach((d) => {
        const source = d.source;
        d.definitions.forEach((value) => {
          const name = value.spec.name;
          const varState = s.variableState.get({ name, source });
          if (!varState || varState.overridden) { return; }
          varStates[name] = varState;
        });
      });
      return varStates;
    },
    (left, right) => {
      return JSON.stringify(left) === JSON.stringify(right);
    }
  );
}
```

- Key insight that makes a cheap comparison correct: `s.variableState.get(...)`
  returns `VariableState` objects held in the store. The store is zustand +
  immer (immer produces **new object identities for changed entries and
  preserves identities for unchanged ones**). Therefore comparing the two
  selected maps by: same key set + reference-equal (`===`) values per key, is
  sufficient — a changed VariableState gets a new reference under immer.
  **You must verify this store uses immer before relying on it**: inspect the
  store creation further down in `VariableProvider.tsx` (search for
  `immer(` around the `createStore`/`createVariableDefinitionStore` code in
  the same file) and confirm `variableState` entries are only replaced via
  immer `set` mutations. If any code path mutates a `VariableState` in place
  without immer, reference equality would miss updates — STOP condition.
- `useStoreWithEqualityFn` comes from `zustand/traditional` (check the import
  at the top of the file).
- Existing tests: `.test.tsx` files under
  `shared\dashboards\src\context\VariableProvider\` — find them with
  `dir shared\dashboards\src\context\VariableProvider`.

## Commands you will need

Run from `C:\Users\Guillaume\Documents\Projets\perses\app\shared\dashboards`.

| Purpose   | Command                            | Expected |
|-----------|------------------------------------|----------|
| Typecheck | `npm run type-check`               | exit 0  |
| Tests     | `npm run test -- VariableProvider` | all pass |
| Lint      | `npm run lint`                     | exit 0  |

## Scope

**In scope**:
- `shared\dashboards\src\context\VariableProvider\VariableProvider.tsx`
  (ONLY the equality function of `useVariableDefinitionStates`, plus a small
  named helper you add in the same file or a sibling util)
- The VariableProvider test file (add tests)

**Out of scope**:
- The selector body itself (the map construction) — do not restructure it here.
- The store definition, immer usage, `PluginProvider` (plan 027 touches that).
- Other `useStoreWithEqualityFn` call sites in the file (e.g.
  `useVariableDefinitionAndState` at `:163+`) — audit only; change only the
  one at `:120-156`.

## Git workflow

- Repo `shared`. Branch: `advisor/032-variable-selector-equality`.
- Commit style: `[ENHANCEMENT] <description>`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Confirm the immer invariant

Read the store creation in `VariableProvider.tsx` (search `immer(`). Confirm
all writes to `variableState` go through immer-wrapped `set` calls. Record
the line numbers in your report. If any in-place mutation exists → STOP.

**Verify**: your report cites the `immer(` line number in the file.

### Step 2: Replace the equality function

Add a helper (top-level in the same file, exported for testing):

```ts
export function areVariableStateMapsEqual(left: VariableStateMap, right: VariableStateMap): boolean {
  if (left === right) return true;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!(key in right)) return false;
    if (left[key] !== right[key]) return false; // immer: changed entries get new references
  }
  return true;
}
```

and use it: `(left, right) => areVariableStateMapsEqual(left, right)`.

**Verify**: `npm run type-check` → exit 0.

### Step 3: Tests

Add unit tests for `areVariableStateMapsEqual` (same-file import in the
existing VariableProvider test file or a new `variable-state-equality.test.ts`):
equal maps (same refs) → true; different key counts → false; same keys, one
value re-referenced → false; empty vs empty → true.

Add one integration test using the store: render a hook consumer of
`useVariableDefinitionStates`, dispatch a store update that changes ONE
variable's value, assert the hook result updates; dispatch an unrelated
store update (e.g. `setVariableLoading` on a variable filtered out as
`overridden`, or an edit-mode flag if the store has one) and assert the hook
result identity is unchanged. Model store scaffolding on the existing
VariableProvider tests.

**Verify**: `npm run test -- VariableProvider` (and the new test file's
pattern) → all pass.

## Test plan

As Step 3. The integration test is the important one: it pins "updates are
not dropped", which is the risk of changing equality semantics.
Verification: `npm run test` (package) → all pass.

## Done criteria

ALL must hold (run in `shared\dashboards`):

- [ ] `npm run type-check` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm run test` exits 0, incl. new equality + integration tests
- [ ] `VariableProvider.tsx` contains no `JSON.stringify` inside `useVariableDefinitionStates` (grep)
- [ ] `git status` shows only in-scope files modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Step 1 finds any non-immer in-place mutation of `VariableState` objects.
- The excerpt at `:120-156` doesn't match the live code (drift — note plan
  002 legitimately touches OTHER parts of this file; only a change to this
  hook is drift).
- The integration test shows a dropped update that stringify-equality would
  have caught (i.e. some code replaces a VariableState with a deep-equal but
  differently-referenced object on unrelated updates — then reference
  equality would cause MORE re-renders, not fewer; report with evidence).

## Maintenance notes

- The correctness of `!==` here is coupled to immer usage in the store. If
  the store ever migrates off immer (or starts cloning states), this equality
  must be revisited — leave a comment on the helper saying exactly that.
- Reviewer: focus on the integration test and on `overridden` filtering —
  entries can drop in/out of the selected map, which the key-count check
  handles.
