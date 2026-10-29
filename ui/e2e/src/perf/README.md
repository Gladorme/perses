# Dashboard performance profiles

This folder records reproducible Chrome performance profiles of dashboards, including the
[React Performance Tracks](https://react.dev/reference/dev-tools/react-performance-tracks), and turns them into
comparable metrics: render passes, component renders, cascading updates, passive effects, long tasks, and more.

Every run uses the same generated dashboards, the same Prometheus data, and the same absolute time range:

- The dashboards are generated from [scenarios.ts](./scenarios.ts) and saved in the `perf` project through the Perses
  API. They cover a few or many panels and panel groups, collapsed groups, mixed panel kinds, and small or large
  query results.
- Prometheus requests sent through the datasource proxy are answered by [prometheus-mock.ts](./prometheus-mock.ts)
  with deterministic data and a fixed latency, so no Prometheus server is needed.
- Each scenario records one trace per phase: `load`, `hover`, `refresh`, `zoomOut`, `scroll`, and `collapseExpand`.
  The trace stops when no request is pending, no panel is loading, and the DOM has not changed for one second.
- Each phase runs several times in a new browser context. The reported metrics come from the run with the median
  "last React commit" duration.

## Record profiles

1. Start the backend with authentication disabled, as for the end-to-end tests: `./scripts/api_backend_dev.sh --e2e`
   from the repository root.
2. Start the UI with one of the following commands from the `ui/app` directory:
   - `npm run start:profiling`: production build using React's profiling renderer. Use it to measure durations. The
     Components track only lists components rendered under a `<Profiler>`, so the app is wrapped in one in this mode.
   - `npm run start`: development build. Durations are inflated, but the Components track lists every component and
     React reports the props that changed for each render, which explains unnecessary renders.

   Add `SHARED_DEV=true` (and `SHARED_PACKAGES_PATH` when the `perses/shared` checkout is not next to this
   repository) to profile local changes of the `perses/shared` packages.
3. Record the profiles from the `ui/e2e` directory:

   ```sh
   PERF_LABEL=baseline npm run perf
   ```

The results are written to `ui/e2e/perf-results/<label>/`:

- `<scenario>.md` and `<scenario>.json`: the metrics of every phase.
- `summaries/`: the metrics of every run.
- `traces/*.json.gz`: Chrome traces. Load them in the Chrome DevTools Performance panel to explore the React
  Performance Tracks next to the network requests and the main thread activity.

| Environment variable  | Default                 | Description                                                          |
| --------------------- | ----------------------- | -------------------------------------------------------------------- |
| `PERF_LABEL`          | current date            | Name of the result folder.                                           |
| `PERF_SCENARIOS`      | all                     | Comma separated scenario names, e.g. `small,large-data`.             |
| `PERF_RUNS`           | `3`                     | Number of runs per scenario.                                         |
| `PERF_BASE_URL`       | `http://localhost:3000` | URL of the Perses UI.                                                |
| `PERF_BACKEND_URL`    | `http://localhost:8080` | URL of the Perses API, used to save the dashboards.                  |
| `PERF_LATENCY_MS`     | `100`                   | Latency of the Prometheus responses.                                 |
| `PERF_CPU_THROTTLING` | `1`                     | CPU slowdown factor, e.g. `4` to emulate a slower device.            |
| `PERF_SAVE_TRACES`    | `first`                 | Traces to keep: `first` run, `all` runs, or `none`.                  |

## Compare profiles

Record a profile before and after a change with the same build mode, then compare them:

```sh
npm run perf:compare -- perf-results/baseline perf-results/candidate
```

To compare two `perses/shared` revisions side by side, serve each one on its own port, for example
`PORT=3002 SHARED_DEV=true SHARED_PACKAGES_PATH=<checkout> npm run start:profiling`, and record each with
`PERF_BASE_URL`.

## Analyze a trace saved from Chrome DevTools

The analyzer also works with a trace recorded manually and saved from the Performance panel:

```sh
npm run perf:analyze -- ~/Downloads/Trace-20260101T120000.json.gz --top=40
```

Add `--json` to print every metric. In a development build, the component table lists the props that changed most
often, and the props that changed by reference while being deeply equal: they usually point to a missing memoization
in the parent component. "Cascading updates scheduled by" and "Updates scheduled by" list the components and methods
that triggered the renders.
