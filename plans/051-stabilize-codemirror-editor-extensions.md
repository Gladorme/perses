# Plan 051: Stabilize CodeMirror query-editor extensions (PromQL, TraceQL)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite repository root)**:
> `git -C plugins diff --stat d7075da..HEAD -- prometheus/src/components/PromQLEditor.tsx tempo/src/components/TraceQLEditor.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW-MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: `plugins` repo commit `d7075da`, 2026-07-20

## Why this matters

`@uiw/react-codemirror` reconfigures the underlying editor whenever the
`extensions` or `basicSetup` prop **changes identity**. Both query editors pass
a **new `extensions` array literal every render**, and PromQL additionally
allocates a fresh `EditorView.theme(...)` extension and a fresh `basicSetup`
object literal inline each render. So any re-render of the surrounding query
editor form (typing in an adjacent field, a variable or time-range update, a
datasource selection change) forces a CodeMirror reconfiguration instead of a
no-op. PromQL is the flagship editor and re-renders frequently while the user
edits queries. Stabilizing these props makes the editor reconfigure only when
something it depends on actually changes.

## Current state

Repo **`plugins`** (turborepo). Two workspace packages.

**1. PromQLEditor** — `plugins/prometheus/src/components/PromQLEditor.tsx`
(`@perses-dev/prometheus-plugin`). `promQLExtension` is already memoized, but
the array wrapper, the theme extension, and `basicSetup` are inline:

```tsx
// PromQLEditor.tsx (current, abridged)
const promQLExtension = useMemo(() => {
  return new PromQLExtension().activateLinter(false).setComplete(completeConfig).asExtension();
}, [completeConfig]);
...
<CodeMirror
  data-testid="promql_expression_editor"
  {...rest}
  style={{ border: `1px solid ${theme.palette.divider}` }}
  theme={isDarkMode ? 'dark' : 'light'}
  readOnly={readOnly}
  basicSetup={{                                   // new object literal every render
    highlightActiveLine: false,
    highlightActiveLineGutter: false,
    foldGutter: false,
  }}
  extensions={[                                   // new array + new EditorView.theme() every render
    EditorView.lineWrapping,
    promQLExtension,
    EditorView.theme({
      '.cm-content': { paddingTop: '8px', paddingBottom: '8px', paddingRight: '40px' },
    }),
  ]}
  placeholder="Example: sum(rate(http_requests_total[5m]))"
/>
```

`useMemo` is already imported. `EditorView.lineWrapping` is a static extension;
the theme depends only on constant strings (no `theme`/props values here — the
padding values are literals), so the theme extension can be built once at module
scope or memoized with `[]`. `basicSetup` here is fully static.

**2. TraceQLEditor** — `plugins/tempo/src/components/TraceQLEditor.tsx`
(`@perses-dev/tempo-plugin`). `traceQLExtension` and `codemirrorTheme` are
already memoized; only the array wrapper is unstable, and `basicSetup` is inline
(and its `syntaxHighlighting` legitimately depends on `rest.value`):

```tsx
// TraceQLEditor.tsx (current, abridged)
const traceQLExtension = useMemo(() => { return TraceQLExtension({ client, timeRange: absoluteTimeRange }); }, [client, absoluteTimeRange]);
const codemirrorTheme = useMemo(() => { return EditorView.theme({ ... uses theme ... }); }, [theme]);
...
<CodeMirror
  {...rest}
  theme={isDarkMode ? 'dark' : 'light'}
  basicSetup={{                                   // new object literal every render
    lineNumbers: false,
    highlightActiveLine: false,
    highlightActiveLineGutter: false,
    foldGutter: false,
    syntaxHighlighting: !isValidTraceId(rest.value ?? ''),  // depends on rest.value
  }}
  extensions={[EditorView.lineWrapping, traceQLExtension, codemirrorTheme]}   // new array every render
  placeholder='Example: {span.http.method = "GET"}'
/>
```

Conventions: React 18, explicit return types, `exhaustive-deps` enforced.

## Commands you will need

Use Node `v22.14.0` (`plugins/.nvmrc`) and npm `10.9.2`; if those pinned
versions cannot be activated, STOP before installing or testing. Run from the
composite repository root. On Windows PowerShell, use `npm.cmd` when `npm.ps1`
is policy-blocked.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix plugins ci` | exit 0; lockfile unchanged |
| Typecheck | `npm --prefix plugins run type-check -- --filter=@perses-dev/prometheus-plugin --filter=@perses-dev/tempo-plugin` | exit 0 |
| Lint | `npm --prefix plugins run lint -- --filter=@perses-dev/prometheus-plugin --filter=@perses-dev/tempo-plugin` | exit 0, exhaustive-deps clean |
| Tests | `npm --prefix plugins run test -- --filter=@perses-dev/prometheus-plugin --filter=@perses-dev/tempo-plugin` | exit 0; all suites pass |

If Turbo `--filter` fights you, fall back to per-package
`npm --prefix plugins run <script> --workspace=<package-name>`.

## Scope

**In scope** (the only implementation files you should modify):

- `plugins/prometheus/src/components/PromQLEditor.tsx`
- `plugins/tempo/src/components/TraceQLEditor.tsx`
- Colocated `*.test.tsx` for the above (add/extend)

`plans/README.md` is an administrative status-only exception after completion.

**Out of scope** (do NOT touch):

- `PromQLExtension`/`TraceQLExtension` construction logic (already memoized).
- The tree-view button and `useParseQuery`/`isValidTraceId` behavior in
  PromQL/TraceQL.
- Autocompletion configuration (`completeConfig`) — only its identity handling
  is already correct.
- Any other datasource query editor (Loki, Splunk, etc.) — call those out as a
  follow-up in the maintenance notes, do not change them here.

## Git workflow

- Work in the nested `plugins` repository on branch
  `advisor/051-stabilize-codemirror-editor-extensions`.
- Commit as one logical unit after verification, e.g.:
  `[ENHANCEMENT] editors: stabilize CodeMirror extensions props`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 0: Reinstall the locked plugins workspace

`npm --prefix plugins ci`. **Verify**: exits 0 and
`git -C plugins diff -- package-lock.json` prints nothing.

### Step 1: Add regression tests proving reconfiguration churn

For each editor, add a colocated test that mocks `@uiw/react-codemirror`'s
`CodeMirror` (a default export) to capture the `extensions` and `basicSetup`
props. Render the editor, force a re-render with unchanged relevant inputs
(same `completeConfig`/`theme` for PromQL; same `client`/`absoluteTimeRange`/
`rest.value` for TraceQL), and assert `Object.is(firstExtensions, secondExtensions)`
is `true` (and for PromQL, the `basicSetup` identity is stable too).

**Verify**: before the production change, the assertions fail (new identity per
render). Do not commit this intermediate state.

### Step 2: Stabilize PromQLEditor

- Hoist the static theme extension and static `basicSetup` to module scope
  (both are fully static here):

  ```tsx
  const PROMQL_EDITOR_THEME = EditorView.theme({
    '.cm-content': { paddingTop: '8px', paddingBottom: '8px', paddingRight: '40px' },
  });
  const PROMQL_BASIC_SETUP = { highlightActiveLine: false, highlightActiveLineGutter: false, foldGutter: false };
  ```

- Memoize the extensions array:

  ```tsx
  const extensions = useMemo(() => [EditorView.lineWrapping, promQLExtension, PROMQL_EDITOR_THEME], [promQLExtension]);
  ```

- Pass `basicSetup={PROMQL_BASIC_SETUP}` and `extensions={extensions}`.

**Verify**:
`npm --prefix plugins run type-check -- --filter=@perses-dev/prometheus-plugin`
→ exit 0.

### Step 3: Stabilize TraceQLEditor

- Memoize the extensions array:

  ```tsx
  const extensions = useMemo(() => [EditorView.lineWrapping, traceQLExtension, codemirrorTheme], [traceQLExtension, codemirrorTheme]);
  ```

- Memoize `basicSetup`; its `syntaxHighlighting` depends on `rest.value`, so
  key the memo on that:

  ```tsx
  const basicSetup = useMemo(() => ({
    lineNumbers: false,
    highlightActiveLine: false,
    highlightActiveLineGutter: false,
    foldGutter: false,
    syntaxHighlighting: !isValidTraceId(rest.value ?? ''),
  }), [rest.value]);
  ```

  This keeps the correct behavior (recompute only when the value changes
  between a valid trace ID and a query) while giving a stable identity across
  unrelated renders.
- Pass `extensions={extensions}` and `basicSetup={basicSetup}`.

**Verify**:
`npm --prefix plugins run type-check -- --filter=@perses-dev/tempo-plugin`
→ exit 0.

### Step 4: Lint and tests

**Verify**: the Lint and Tests commands from the table → exit 0; the Step 1
assertions now pass.

## Test plan

- Per editor: one identity-stability assertion on `extensions` (and PromQL
  `basicSetup`) across an unrelated re-render, and — for TraceQL — an assertion
  that `basicSetup.syntaxHighlighting` still flips when `rest.value` changes
  between a valid trace ID and a non-trace-ID query.
- Preserve behavioral coverage: PromQL tree-view toggle still works; the editor
  still renders and accepts a value. Keep existing suites green.
- Verification: the Tests command → all pass.

## Done criteria

Machine-checkable; ALL must hold (run from composite root):

- [ ] `rg -n "const extensions = useMemo" plugins/prometheus/src/components/PromQLEditor.tsx` and `.../tempo/src/components/TraceQLEditor.tsx` each return one match.
- [ ] `rg -n "extensions=\{\[" plugins/prometheus/src/components/PromQLEditor.tsx plugins/tempo/src/components/TraceQLEditor.tsx` returns no matches (no inline array literal on the prop).
- [ ] PromQL `basicSetup` and the theme extension are module constants; `rg -n "basicSetup=\{\{" plugins/prometheus/src/components/PromQLEditor.tsx` returns no matches.
- [ ] Typecheck, lint, and tests for both packages exit 0.
- [ ] The regression tests prove stable identities and preserved behavior.
- [ ] `git -C plugins diff --name-only d7075da..HEAD` lists only in-scope paths, and `git -C plugins status --short` is empty after the logical commit.
- [ ] `plans/README.md` status row updated, unless the dispatcher maintains the index.

## STOP conditions

Stop and report back without improvising if:

- Live code already memoizes these props (drift).
- Mocking `CodeMirror` to capture props requires changing a production export.
- The PromQL theme extension turns out to reference a prop/`theme` value (then
  it must be memoized with the right deps, not module-hoisted) — report it.
- Any existing PromQL/TraceQL test fails in a way that is not a pure identity
  assertion, especially anything touching autocompletion, linting, or the tree
  view.
- A verification command fails twice after a reasonable in-scope fix attempt.

## Maintenance notes

- Reviewer: confirm autocompletion, linting, syntax highlighting, and the
  PromQL tree-view button still work — CodeMirror reconfiguration bugs surface
  as lost editor state or dropped autocompletion.
- Follow-up (not in this plan): the same inline-`extensions`-array pattern may
  exist in other datasource query editors (Loki, Splunk, ClickHouse, etc.).
  Audit and file a separate plan if confirmed; keep this plan scoped to the two
  flagship editors.
