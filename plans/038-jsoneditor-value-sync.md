# Plan 038: Resync JSONEditor when its value prop changes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite workspace root)**:
> `git -C shared diff --stat f8cd4b7..HEAD -- components/src/JSONEditor.tsx`
> If the file changed since this plan was written, compare the "Current
> state" excerpt against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: shared commit `f8cd4b7`, 2026-07-21

## Why this matters

`JSONEditor` stringifies `props.value` into local state **once** and never
resyncs. Any consumer that keeps the editor mounted while the underlying
document changes shows stale JSON — and, worse, its `onBlur` can push the
stale buffer back through `onChange`, overwriting the fresh data. Consumers
include the dashboard Edit-JSON dialog, the panel spec editor
(`PanelSpecEditor.tsx:121` — panel definition changes while the JSON tab is
mounted), the config view, and the import view.

## Current state

- `shared/components/src/JSONEditor.tsx` (60 lines):

```ts
export function JSONEditor<T>(props: JSONEditorProps<T>): ReactElement {
  ...
  const [value, setValue] = useState(() => JSON.stringify(props.value, null, 2));
  const [lastProcessedValue, setLastProcessedValue] = useState<string>(value);

  return (
    <CodeMirror
      {...props}
      ...
      value={value}
      onChange={(newValue) => {
        setValue(newValue);
        // Trigger the provided onChange callback in real-time
        if (props.onChange) {
          props.onChange(newValue);
        }
      }}
      onBlur={() => {
        // Don't trigger the provided onChange if the last processed value is equal to the current value.
        ...
        if (lastProcessedValue !== value && props.onChange !== undefined) {
          props.onChange(value);
          setLastProcessedValue(value);
        }
      }}
```

- Consumers (from a workspace grep):
  `shared/dashboards/src/components/EditJsonDialog/EditJsonDialog.tsx:79`,
  `shared/plugin-system/src/components/PanelSpecEditor/PanelSpecEditor.tsx:121`,
  `shared/plugin-system/src/components/ItemSelectionActionsOptionsEditor/ItemSelectionActionsOptionsEditor.tsx:402,665`,
  `perses/ui/app/src/views/config/ConfigView.tsx:96` (readOnly),
  `perses/ui/app/src/views/import/GrafanaFlow.tsx:152` (readOnly),
  `perses/ui/app/src/views/import/ImportView.tsx:91`.

The subtlety: the component is deliberately "semi-controlled" — the local
buffer must NOT be clobbered on every parent re-render while the user types
(parents echo `onChange` back as a new `value` object, and re-stringifying
would fight the cursor). The resync must apply only when the incoming value
*semantically* differs from what the editor last knew.

## Target design

Track the last prop-derived serialization and resync only on real external
changes:

```ts
const incoming = JSON.stringify(props.value, null, 2);
const [value, setValue] = useState(incoming);
const [lastIncoming, setLastIncoming] = useState(incoming);
const [lastProcessedValue, setLastProcessedValue] = useState<string>(incoming);

// External value change (not an echo of our own edits): adopt it.
if (incoming !== lastIncoming) {
  setLastIncoming(incoming);
  if (incoming !== value) {
    setValue(incoming);
    setLastProcessedValue(incoming);
  }
}
```

This is the documented React "derive state from props during render"
adjustment pattern (setState during render of the SAME component is legal
and re-runs render before committing — unlike setting OTHER components'
state). Echo case: parent re-renders with the exact text the user typed →
`incoming === value` → only `lastIncoming` updates, cursor untouched.
Formatting-echo case: parent parses and re-serializes to a different string
→ the editor adopts the canonical form only when the user is not mid-edit —
if that proves disruptive for `EditJsonDialog` (which echoes on every
keystroke via real-time `onChange`), guard the adoption with "editor not
focused": track focus via CodeMirror's `onFocus`/`onBlur` (the component
already handles `onBlur`) and skip `setValue` while focused. Implement the
focus guard from the start; it is required for the ImportView/EditJsonDialog
typing flow.

## Commands you will need

Node `v22.14.0` / npm `10.9.2` pinned; STOP if not activatable. Windows:
`npm.cmd`.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix shared ci` | exit 0; lockfile unchanged |
| Focused test | `npm --prefix shared run test --workspace=@perses-dev/components -- --runInBand JSONEditor` | exit 0 |
| Typecheck | `npm --prefix shared run type-check -- --filter=@perses-dev/components` | exit 0 |
| Lint | `npm --prefix shared run lint --workspace=@perses-dev/components` | exit 0 |
| Dependent suites | `npm --prefix shared run test --workspace=@perses-dev/dashboards -- --runInBand EditJsonDialog` | exit 0 |

## Scope

**In scope**:

- `shared/components/src/JSONEditor.tsx`
- `shared/components/src/JSONEditor.test.tsx` (create)

**Out of scope** (do NOT touch):

- All consumer components (their behavior must improve without edits).
- CodeMirror extensions/linting config.

## Git workflow

- Nested `shared` repository, branch `advisor/038-jsoneditor-value-sync`.
- One commit, e.g. `[BUGFIX] components: resync JSONEditor on external value changes`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Regression tests

Create `JSONEditor.test.tsx` (RTL; CodeMirror renders a contenteditable —
query the document text via `screen.getByRole('textbox')` or the
`.cm-content` element as existing component tests in this package do; grep
`shared/components/src` for an existing CodeMirror-based test to copy
setup from — if none exists, use plain DOM queries):

1. rerender with a NEW `value` object (different content), editor not
   focused → displayed text updates (FAILS against current code);
2. rerender with a new object of IDENTICAL content → buffer/cursor state
   object unchanged (no `setValue` — assert no text reset, e.g. after
   simulating a user edit the edit survives);
3. user types → parent echoes the same string back as `value` → user's text
   preserved.

**Verify**: focused test → test 1 fails against current code. Do not commit.

### Step 2: Implement the adjustment + focus guard

Apply the Target design.

**Verify**: focused tests all pass.

### Step 3: Dependent suites

**Verify**: components typecheck + lint exit 0; the dashboards
`EditJsonDialog` suite passes unchanged.

## Test plan

Three tests from Step 1. If simulating CodeMirror typing in jsdom proves
unreliable, test the component's exported behavior through its props by
extracting the adjustment into a small exported pure helper
(`computeNextEditorState(incoming, current)`) and unit-testing that —
acceptable fallback, note it in the report.

## Done criteria

- [ ] `rg -n "lastIncoming|onFocus" shared/components/src/JSONEditor.tsx` → matches (resync mechanism + focus guard present).
- [ ] Focused tests pass; components typecheck/lint exit 0; dashboards `EditJsonDialog` suite passes.
- [ ] `git -C shared diff --name-only f8cd4b7..HEAD` lists only in-scope paths.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- `JSONEditor` has been converted to fully-controlled (value passed straight
  through) — drift; the bug may already be fixed differently.
- The focus guard is insufficient: EditJsonDialog tests show the editor
  fighting the user's cursor — report with the failing interaction instead
  of adding consumer-specific hacks.
- A verification command fails twice after a reasonable in-scope fix attempt.

## Maintenance notes

- Long-term, a `key`-based reset at consumer level (remount per document
  identity) would let this component stay dumb; deferred because consumers
  are in three packages.
- Reviewers: scrutinize the interplay with the existing `lastProcessedValue`
  blur logic — the CTRL+F comment at lines 48–50 documents why blur must not
  fire `onChange` redundantly; that behavior must survive.
