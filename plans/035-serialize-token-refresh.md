# Plan 035: Serialize the auth token refresh across concurrent 401s

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first from the composite workspace root)**:
> `git -C perses diff --stat 06886ac1..HEAD -- ui/app/src/model/fetch.ts`
> If the file changed since this plan was written, compare the "Current
> state" excerpt against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: perses commit `06886ac1`, 2026-07-21

## Why this matters

The app wraps `globalThis.fetch` in a proxy that, on any 401 response, calls
`refreshToken()` and retries. A dashboard fires many API requests in
parallel; when the access token expires they all get 401 at once and each
one triggers its own `refreshToken()` call. With refresh-token rotation, the
first refresh succeeds and rotates the token, and the losers get a 400 —
whose handler **deletes the JWT cookies**, logging the user out even though
a valid session was just established. Users experience random logouts on
busy dashboards at token-expiry boundaries.

## Current state

- `perses/ui/app/src/model/fetch.ts` — the whole file (52 lines). The proxy
  installed by `enableRefreshFetch()`:

```ts
export function enableRefreshFetch(): void {
  globalThis.fetch = new Proxy(globalThis.fetch, {
    apply: async function (target, that, args: Parameters<typeof globalThis.fetch>): Promise<Response> {
      return target
        .apply(that, args)
        .then((res) => {
          if (res.status === 401) {
            return refreshToken()
              .then(() => {
                return target.apply(that, args);
              })
              .catch((refreshError: StatusError) => {
                if (refreshError.status === 400) {
                  // If refresh token fails, remove jwt cookies
                  // This will force the user to be redirected to the login page
                  JWT_COOKIES.forEach(deleteCookie);
                }
                throw refreshError;
              });
          }
          return res;
        })
        .catch((error: StatusError) => {
          throw error;
        });
    },
  });
}
```

- `refreshToken()` is defined in
  `perses/ui/app/src/model/auth/auth-client.ts:40-46` — a plain POST to
  `auth/refresh` using the `@perses-dev/client` fetch (cookie-based; no
  arguments, no state).
- `JWT_COOKIES` and `deleteCookie` are at `fetch.ts:17-22`.
- `enableRefreshFetch()` is called once at app startup (grep its caller in
  `perses/ui/app/src` to confirm — currently `app.tsx`/`main` wiring).

Repo conventions: colocated Jest tests (`*.test.ts`); plain unit tests for
model helpers.

## Target design

Share one in-flight refresh among all concurrent 401 handlers:

```ts
let refreshInFlight: Promise<void> | null = null;

function refreshTokenOnce(): Promise<void> {
  if (!refreshInFlight) {
    refreshInFlight = refreshToken()
      .then(() => undefined)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}
```

The proxy's 401 branch calls `refreshTokenOnce()` instead of
`refreshToken()`. All queued requests retry after the same refresh resolves;
if it rejects, all of them see the same error, and the 400→delete-cookies
branch runs at most once per actual refresh failure (keep that logic in the
shared promise's catch or in each caller — either is fine as long as
`deleteCookie` still runs on a genuine 400).

Also remove the no-op trailing `.catch((error) => { throw error; })`.

## Commands you will need

Node `v22.14.0` / npm `10.9.2` pinned (`perses/ui/.nvmrc`, `packageManager`);
STOP if not activatable. Windows: `npm.cmd`.

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm --prefix perses/ui ci` | exit 0; lockfile unchanged |
| Focused test | `npm --prefix perses/ui run test --workspace=@perses-dev/app -- --runInBand fetch.test` | exit 0 |
| Typecheck | `npm --prefix perses/ui run type-check -- --filter=@perses-dev/app` | exit 0 |
| Lint | `npm --prefix perses/ui run lint --workspace=@perses-dev/app` | exit 0 |

## Scope

**In scope**:

- `perses/ui/app/src/model/fetch.ts`
- `perses/ui/app/src/model/fetch.test.ts` (create)

**Out of scope** (do NOT touch):

- `auth-client.ts` (`refreshToken` itself), the login/logout flows, cookies
  names, the `@perses-dev/client` fetch wrapper.
- Server-side refresh semantics.

## Git workflow

- Nested `perses` repository, branch `advisor/035-serialize-token-refresh`.
- One commit, e.g. `[BUGFIX] ui: serialize auth token refresh across concurrent 401s`.
- Do not push or open a PR unless the operator explicitly asks.

## Steps

### Step 1: Regression test with two concurrent 401s

Create `fetch.test.ts`. Mock `./auth/auth-client`'s `refreshToken` with a
`jest.fn()` returning a controllable promise. Save the original
`globalThis.fetch`, install a `jest.fn()` base fetch that returns a 401
`Response` on first call per URL and 200 on retry, call
`enableRefreshFetch()`, then issue two parallel `fetch('/a')` / `fetch('/b')`
calls. Assert:

1. `refreshToken` was called exactly ONCE (fails against current code —
   called twice);
2. both requests were retried and resolve with 200;
3. (separate test) when `refreshToken` rejects with `{status: 400}`, both
   callers reject and cookie deletion happened (assert on `document.cookie`
   in jsdom).

Restore `globalThis.fetch` in `afterEach` — the proxy mutates a global;
failing to restore will poison other suites.

**Verify**: focused test → assertion 1 FAILS (2 calls), others pass. Do not
commit this state.

### Step 2: Implement the shared in-flight promise

Apply the Target design in `fetch.ts`.

**Verify**: focused test → all pass.

### Step 3: Package checks

**Verify**: typecheck and lint exit 0.

## Test plan

Three tests from Step 1 in `fetch.test.ts` (plain Jest, jsdom). No existing
test file for this module — model the mock style on other
`perses/ui/app/src/model/*.test.ts` files if present, otherwise standard
Jest.

## Done criteria

- [ ] `rg -n "refreshInFlight|refreshTokenOnce" perses/ui/app/src/model/fetch.ts` → matches (shared-promise mechanism present).
- [ ] Focused tests pass, incl. the exactly-once assertion; typecheck and lint exit 0.
- [ ] `git -C perses diff --name-only 06886ac1..HEAD` lists only the two in-scope paths.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- `fetch.ts` has been rewritten to an axios/interceptor approach (drift).
- The refresh endpoint turns out to be non-idempotent in a way that requires
  request queuing beyond the shared promise (e.g. requests must replay with
  a NEW token passed explicitly) — report; broader design needed.
- A verification command fails twice after a reasonable in-scope fix attempt.

## Maintenance notes

- If a second retry layer is ever added (e.g. React Query retries), keep the
  single-flight guarantee here — it is the only place that dedupes.
- Reviewers: check the 400-cookie-deletion path still fires exactly once per
  failed refresh, and that no request can retry in an infinite 401 loop
  (retry happens at most once per request — preserved from current code).
