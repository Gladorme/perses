# Plan 039: Show an error when dashboard import input is invalid

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite workspace root)**:
> `git -C perses diff --stat 06886ac1..HEAD -- ui/app/src/views/import/ImportView.tsx`
> If the file changed since this plan was written, compare the "Current
> state" excerpt against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (UX)
- **Planned at**: perses commit `06886ac1`, 2026-07-21

## Why this matters

On the Import page, pasting or uploading invalid JSON is swallowed by an
empty-ish catch: the parse failure silently resets the detected dashboard to
`undefined`, so the "2." step of the flow just never appears. The user gets
zero feedback about what's wrong — the page looks broken. A one-line error
message turns a dead end into a fixable situation.

## Current state

- `perses/ui/app/src/views/import/ImportView.tsx:61-74`:

```ts
  const completeDashboard = (dashboard: string | undefined): void => {
    try {
      const json = JSON.parse(dashboard ?? '{}');
      const type = getDashboardType(json);
      if (type !== undefined) {
        setDashboard({
          kind: type,
          data: json,
        });
      }
    } catch (_) {
      setDashboard(undefined);
    }
  };
```

- `getDashboardType` (lines 42–48) returns `'perses'` when a `kind` field
  exists, else `'grafana'` — it never returns `undefined` in practice, so
  the only real silent-failure path is the catch. Note `JSON.parse` of a
  valid non-object (e.g. `5`) also throws inside `'kind' in dashboard`
  (TypeError) and lands in the same catch.
- The view renders `<JSONEditor ... onChange={completeDashboard}>` at line
  91 and file upload at lines 50–59.
- `dashboard` local state (line 39) drives which flow (`GrafanaFlow` /
  `PersesFlow`) renders below.
- Convention for inline error surfaces in this app: MUI `<Alert severity="error">`
  (used across views) — prefer an inline Alert over a snackbar here, since
  the error is tied to the editor content and should clear when the content
  becomes valid. Real-time `onChange` means a snackbar would fire on every
  keystroke of an incomplete document — an inline, live-updating message is
  the correct shape.

## Commands you will need

Node `v22.14.0` / npm `10.9.2` pinned; STOP if not activatable. Windows:
`npm.cmd`.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix perses/ui ci` | exit 0; lockfile unchanged |
| Focused test | `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand ImportView` | exit 0 |
| Typecheck | `npm --prefix perses/ui run type-check -- --filter=@perses-dev/app` | exit 0 |
| Lint | `npm --prefix perses/ui run lint --workspace=@perses-dev/app` | exit 0 |

## Scope

**In scope**:

- `perses/ui/app/src/views/import/ImportView.tsx`
- `perses/ui/app/src/views/import/ImportView.test.tsx` (create)

**Out of scope** (do NOT touch):

- `GrafanaFlow.tsx` / `PersesFlow.tsx` — downstream migration flows.
- `JSONEditor` (plan 038 owns it).
- Schema-level validation of the dashboard content (server does that later).

## Git workflow

- Nested `perses` repository, branch `advisor/039-import-parse-error-feedback`.
- One commit, e.g. `[BUGFIX] ui: surface JSON parse errors on the import page`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Track and render the parse error

Add `const [parseError, setParseError] = useState<string | undefined>();`.
In `completeDashboard`: on success, `setParseError(undefined)`; in the
catch, `setDashboard(undefined)` (keep) and set a user-actionable message,
e.g. `setParseError('The provided content is not valid JSON.')`. Treat an
empty/whitespace-only input as "no input", not an error (clear both states)
— check `if (!dashboard?.trim())` before parsing.

Render under the editor (after the upload button / editor stack, before the
flow sections):

```tsx
{parseError && <Alert severity="error">{parseError}</Alert>}
```

Import `Alert` from `@mui/material`.

**Verify**: typecheck exits 0.

### Step 2: Tests

Create `ImportView.test.tsx` (RTL; wrap with the app's snackbar/query
providers only if the tree requires them — this view is mostly standalone):

1. paste invalid JSON via the editor `onChange` (fire change on the
   CodeMirror textbox, or call the upload path with a `File` containing
   invalid JSON) → error Alert visible, no flow section rendered;
2. then provide valid JSON `{"kind":"Dashboard", ...minimal}` → Alert gone,
   Perses flow section appears;
3. clearing the input → no Alert.

**Verify**: focused test → all pass.

### Step 3: Package checks

**Verify**: lint exits 0.

## Test plan

Three tests above. If simulating CodeMirror input is unreliable in jsdom,
drive `completeDashboard` through the file-upload input instead
(`fireEvent.change(input, { target: { files: [file] } })` with a mocked
`File.text()`); note which path you used.

## Done criteria

- [ ] `rg -n "catch \(_\) \{\s*" perses/ui/app/src/views/import/ImportView.tsx` → the catch now sets a user-visible error state (manual read).
- [ ] `rg -n "severity=\"error\"" perses/ui/app/src/views/import/ImportView.tsx` → one match.
- [ ] Focused tests pass; typecheck and lint exit 0.
- [ ] `git -C perses diff --name-only 06886ac1..HEAD` lists only in-scope paths.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- The import flow has been redesigned (drift).
- Displaying per-keystroke errors proves too noisy in tests/UX (error flashes
  while typing valid JSON) — debouncing is allowed within this file; if that
  still fails, report.
- A verification command fails twice after a reasonable in-scope fix attempt.

## Maintenance notes

- The JSONEditor already shows CodeMirror lint gutters for syntax errors;
  the Alert complements it for pasted/uploaded content and non-object JSON.
- Deferred: verifying the document is structurally a Grafana or Perses
  dashboard (currently only `kind` presence is checked) — server-side
  migration errors already surface in the flows.
