// Copyright The Perses Authors
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

import type { Browser, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { PERF_PROJECT, provisionPerfDashboard } from './dashboard-generator';
import type { PrometheusMock } from './prometheus-mock';
import { mockPrometheus } from './prometheus-mock';
import type { PerfPhase, PerfScenario } from './scenarios';
import { getSelectedScenarios } from './scenarios';
import type { TraceSummary } from './trace-analyzer';
import { ACTION_MARK, IDLE_MARK, analyzeTrace, formatSummary } from './trace-analyzer';

const BACKEND_URL = process.env.PERF_BACKEND_URL ?? 'http://localhost:8080';
const RUNS = Number(process.env.PERF_RUNS ?? 3);
const LATENCY_MS = Number(process.env.PERF_LATENCY_MS ?? 100);
const CPU_THROTTLING = Number(process.env.PERF_CPU_THROTTLING ?? 1);
const SAVE_TRACES = process.env.PERF_SAVE_TRACES ?? 'first'; // first | all | none
const LABEL = process.env.PERF_LABEL ?? new Date().toISOString().replace(/[:.]/g, '-');
const OUTPUT_DIR = resolve(import.meta.dirname, '../../perf-results', LABEL);

// Absolute time range so every run queries (and renders) exactly the same data.
const END_MS = 1_700_000_000_000;
const START_MS = END_MS - 6 * 60 * 60 * 1000;

const QUIET_MS = 1000;
const IDLE_TIMEOUT_MS = 120_000;

const TRACE_CATEGORIES = [
  '-*',
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'disabled-by-default-devtools.timeline.stack',
  'disabled-by-default-v8.cpu_profiler',
  'blink.user_timing',
  'blink.console',
  'loading',
  'latencyInfo',
  'toplevel',
  'v8.execute',
];

declare global {
  interface Window {
    perfLastMutation?: number;
  }
}

/**
 * Runs the tasks one after the other: profiles must not overlap.
 */
function runInSequence<T>(items: T[], task: (item: T, index: number) => Promise<void>): Promise<void> {
  return items.reduce<Promise<void>>(
    (previous, item, index) => previous.then(() => task(item, index)),
    Promise.resolve(),
  );
}

/**
 * Waits until no Prometheus request is pending, no panel displays a loader and the DOM has not changed for QUIET_MS.
 */
async function waitForIdle(page: Page, mock: PrometheusMock): Promise<void> {
  let lastServed = -1;
  let quietSince = Date.now();
  await expect
    .poll(
      async () => {
        const state = await page.evaluate(() => ({
          sinceLastMutation: performance.now() - (window.perfLastMutation ?? 0),
          loaders: document.querySelectorAll('[data-testid="panel"] [aria-label*="Loading" i], [role="progressbar"]')
            .length,
        }));
        if (mock.served !== lastServed || mock.inFlight > 0) {
          lastServed = mock.served;
          quietSince = Date.now();
        }
        return (
          mock.inFlight === 0 &&
          state.loaders === 0 &&
          state.sinceLastMutation > QUIET_MS &&
          Date.now() - quietSince > QUIET_MS
        );
      },
      { message: 'The dashboard did not become idle in time', timeout: IDLE_TIMEOUT_MS, intervals: [100] },
    )
    .toBe(true);
  await page.evaluate((mark) => performance.mark(mark), IDLE_MARK);
}

/**
 * Scrolls the dashboard to the bottom, 600px every 100ms, like a user scrolling with the mouse wheel.
 */
async function scrollToBottom(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        const container = [document.scrollingElement, ...document.querySelectorAll('main, main *, #root *')]
          .filter(
            (element): element is Element =>
              !!element &&
              element.scrollHeight - element.clientHeight > 1 &&
              (element === document.scrollingElement || /(auto|scroll)/.test(getComputedStyle(element).overflowY)),
          )
          .toSorted((a, b) => b.scrollHeight - a.scrollHeight)[0];
        const step = (): void => {
          const before = container?.scrollTop ?? 0;
          if (container) container.scrollTop = before + 600;
          if (!container || container.scrollTop === before) {
            done();
          } else {
            setTimeout(step, 100);
          }
        };
        step();
      }),
  );
}

/**
 * Enters every visible panel through its header, which has no tooltip, and leaves it after 100ms.
 */
async function hoverPanels(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  const boxes = await Promise.all((await page.getByTestId('panel').all()).map((panel) => panel.boundingBox()));
  const visibleBoxes = boxes.filter(
    (box): box is NonNullable<typeof box> => !!box && !!viewport && box.y >= 0 && box.y + 40 <= viewport.height,
  );
  await runInSequence(visibleBoxes, async (box) => {
    await page.mouse.move(box.x + box.width * 0.75, box.y + 15, { steps: 5 });
    // Longer than the debounce of the panel focus.
    await page.evaluate(() => new Promise((done) => setTimeout(done, 100)));
  });
  await page.mouse.move(0, 0);
}

async function runAction(page: Page, phase: Exclude<PerfPhase, 'load'>, mock: PrometheusMock): Promise<void> {
  // Clicks are dispatched without moving the mouse: hovering a button would open its tooltip after a delay and add
  // unrelated renders at the end of the profile.
  switch (phase) {
    case 'refresh':
      await page.getByRole('button', { name: 'Refresh', exact: true }).dispatchEvent('click');
      break;
    case 'zoomOut':
      await page.getByRole('button', { name: 'Zoom out', exact: true }).dispatchEvent('click');
      break;
    case 'scroll':
      await scrollToBottom(page);
      break;
    case 'hover':
      await hoverPanels(page);
      break;
    case 'collapseExpand': {
      await page
        .getByRole('button', { name: /^collapse group/ })
        .first()
        .dispatchEvent('click');
      await waitForIdle(page, mock);
      await page
        .getByRole('button', { name: /^expand group/ })
        .first()
        .dispatchEvent('click');
      break;
    }
  }
}

async function startTracing(browser: Browser, page: Page): Promise<void> {
  await browser.startTracing(page, { categories: TRACE_CATEGORIES, screenshots: false });
}

async function stopTracing(browser: Browser, name: string, run: number): Promise<TraceSummary> {
  const buffer = await browser.stopTracing();
  if (SAVE_TRACES === 'all' || (SAVE_TRACES === 'first' && run === 0)) {
    // Load the file in the Chrome DevTools Performance panel to inspect the React Performance Tracks.
    writeFileSync(join(OUTPUT_DIR, 'traces', `${name}.run${run}.json.gz`), gzipSync(buffer));
  }
  const summary = analyzeTrace(JSON.parse(buffer.toString('utf8')).traceEvents);
  writeFileSync(join(OUTPUT_DIR, 'summaries', `${name}.run${run}.json`), JSON.stringify(summary, null, 2));
  return summary;
}

function median(values: number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : Math.round(((sorted[middle - 1]! + sorted[middle]!) / 2) * 10) / 10;
}

/**
 * Keeps the run with the median "last commit" duration as the representative run of a phase.
 */
function pickMedianRun(summaries: TraceSummary[]): TraceSummary {
  const target = median(summaries.map((summary) => summary.lastCommitMs));
  return summaries.reduce((best, summary) =>
    Math.abs(summary.lastCommitMs - target) < Math.abs(best.lastCommitMs - target) ? summary : best,
  );
}

/**
 * Writes the metrics of the representative run of every phase, and the page errors if any.
 */
function writeScenarioReport(
  scenario: PerfScenario,
  results: Map<PerfPhase, TraceSummary[]>,
  pageErrors: string[],
): void {
  const report: string[] = [`# ${scenario.name}`, '', scenario.description, ''];
  const medians: Record<string, TraceSummary> = {};
  for (const [phase, summaries] of results) {
    const representative = pickMedianRun(summaries);
    medians[phase] = representative;
    report.push(
      `## ${phase}`,
      '',
      `last commit (ms) per run: ${summaries.map((summary) => summary.lastCommitMs).join(', ')}`,
      '',
      formatSummary(representative),
      '',
    );
  }
  writeFileSync(join(OUTPUT_DIR, `${scenario.name}.md`), report.join('\n'));
  writeFileSync(join(OUTPUT_DIR, `${scenario.name}.json`), JSON.stringify(medians, null, 2));
  if (pageErrors.length) {
    writeFileSync(join(OUTPUT_DIR, `${scenario.name}.errors.txt`), pageErrors.join('\n\n'));
  }
}

const scenarios = getSelectedScenarios();

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  mkdirSync(join(OUTPUT_DIR, 'traces'), { recursive: true });
  mkdirSync(join(OUTPUT_DIR, 'summaries'), { recursive: true });
  writeFileSync(
    join(OUTPUT_DIR, 'environment.json'),
    JSON.stringify(
      {
        label: LABEL,
        baseURL: test.info().project.use.baseURL,
        runs: RUNS,
        latencyMs: LATENCY_MS,
        cpuThrottling: CPU_THROTTLING,
        scenarios: scenarios.map((scenario) => scenario.name),
        date: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
});

for (const scenario of scenarios) {
  test(`profile ${scenario.name}`, async ({ browser }) => {
    test.setTimeout(RUNS * scenario.phases.length * IDLE_TIMEOUT_MS);
    await provisionPerfDashboard(BACKEND_URL, scenario);
    await warmUp(browser, scenario);

    const results = new Map<PerfPhase, TraceSummary[]>();
    const pageErrors: string[] = [];
    await runInSequence(
      Array.from({ length: RUNS }, (_, run) => run),
      (run) => profileRun(browser, scenario, run, results, pageErrors),
    );
    writeScenarioReport(scenario, results, pageErrors);
    // A profile of a broken page is meaningless.
    expect(pageErrors, 'uncaught errors in the page').toEqual([]);
  });
}

/**
 * Opens the dashboard once without recording, so the first recorded run does not include the warm-up of the servers.
 */
async function warmUp(browser: Browser, scenario: PerfScenario): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await mockPrometheus(page, { seriesPerQuery: 1, pointsPerSeries: 2, latencyMs: 0 });
    await page.goto(dashboardURL(scenario));
    await expect(page.getByTestId('panel-group').first()).toBeVisible({ timeout: IDLE_TIMEOUT_MS });
  } finally {
    await context.close();
  }
}

function dashboardURL(scenario: PerfScenario): string {
  return `/projects/${PERF_PROJECT}/dashboards/${scenario.name}?start=${START_MS}&end=${END_MS}`;
}

async function profilePhase(
  browser: Browser,
  page: Page,
  mock: PrometheusMock,
  scenario: PerfScenario,
  phase: PerfPhase,
): Promise<void> {
  if (phase === 'load') {
    await page.goto('about:blank');
    await startTracing(browser, page);
    await page.goto(dashboardURL(scenario));
    await expect(page.getByTestId('panel-group').first()).toBeVisible({ timeout: 60_000 });
  } else {
    await startTracing(browser, page);
    await page.evaluate((mark) => performance.mark(mark), ACTION_MARK);
    await runAction(page, phase, mock);
  }
  await waitForIdle(page, mock);
}

async function profileRun(
  browser: Browser,
  scenario: PerfScenario,
  run: number,
  results: Map<PerfPhase, TraceSummary[]>,
  pageErrors: string[],
): Promise<void> {
  // A new context per run starts with empty caches, like a first visit.
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(`${error.message}\n${error.stack ?? ''}`));
  // Render loops are caught by error boundaries, so they are only reported in the console.
  page.on('console', (message) => {
    if (message.type() === 'error' && /Too many re-renders|Maximum update depth/.test(message.text())) {
      pageErrors.push(message.text());
    }
  });
  try {
    await page.addInitScript(() => {
      window.perfLastMutation = performance.now();
      new MutationObserver(() => {
        window.perfLastMutation = performance.now();
      }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    });
    if (CPU_THROTTLING > 1) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLING });
    }
    const mock = await mockPrometheus(page, {
      seriesPerQuery: scenario.seriesPerQuery,
      pointsPerSeries: scenario.pointsPerSeries,
      latencyMs: LATENCY_MS,
    });

    await runInSequence(scenario.phases, async (phase) => {
      await profilePhase(browser, page, mock, scenario, phase);
      const summary = await stopTracing(browser, `${scenario.name}.${phase}`, run);
      results.set(phase, [...(results.get(phase) ?? []), summary]);
    });
  } finally {
    await context.close();
  }
}
