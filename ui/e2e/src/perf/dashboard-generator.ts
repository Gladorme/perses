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

import type { PerfPanelKind, PerfScenario } from './scenarios';

export const PERF_PROJECT = 'perf';
export const PERF_DATASOURCE = 'PerfPrometheus';

const PANEL_WIDTH = 12; // Two panels per row on the 24 columns grid
const PANEL_HEIGHT = 8;

function buildPanelPlugin(kind: PerfPanelKind): { kind: string; spec: Record<string, unknown> } {
  switch (kind) {
    case 'TimeSeriesChart':
      return { kind, spec: { legend: { position: 'bottom', mode: 'list' } } };
    case 'StatChart':
      return { kind, spec: { calculation: 'last-number', sparkline: {} } };
    case 'GaugeChart':
      return { kind, spec: { calculation: 'last-number', format: { unit: 'percent-decimal' } } };
    case 'Markdown':
      return { kind, spec: { text: '## Perf panel\n\nStatic **markdown** content without any query.' } };
  }
}

/**
 * Builds a deterministic dashboard for a scenario. Every query is unique so React Query does not deduplicate them.
 */
export function buildPerfDashboard(scenario: PerfScenario): Record<string, unknown> {
  const panels: Record<string, unknown> = {};
  const layouts: unknown[] = [];

  for (let group = 0; group < scenario.groups; group++) {
    const items: unknown[] = [];
    for (let index = 0; index < scenario.panelsPerGroup; index++) {
      const panelNumber = group * scenario.panelsPerGroup + index;
      const panelId = `panel_${panelNumber}`;
      const kind = scenario.panelKinds[panelNumber % scenario.panelKinds.length]!;
      panels[panelId] = {
        kind: 'Panel',
        spec: {
          display: { name: `${kind} ${panelNumber}` },
          plugin: buildPanelPlugin(kind),
          queries:
            kind === 'Markdown'
              ? []
              : [
                  {
                    kind: 'TimeSeriesQuery',
                    spec: {
                      plugin: {
                        kind: 'PrometheusTimeSeriesQuery',
                        spec: { query: `perf_metric_${panelNumber}` },
                      },
                    },
                  },
                ],
        },
      };
      items.push({
        x: (index % 2) * PANEL_WIDTH,
        y: Math.floor(index / 2) * PANEL_HEIGHT,
        width: PANEL_WIDTH,
        height: PANEL_HEIGHT,
        content: { $ref: `#/spec/panels/${panelId}` },
      });
    }
    layouts.push({
      kind: 'Grid',
      spec: {
        display: {
          title: `Group ${group}`,
          collapse: { open: !scenario.collapseGroups || group === 0 },
        },
        items,
      },
    });
  }

  return {
    kind: 'Dashboard',
    metadata: { name: scenario.name, project: PERF_PROJECT },
    spec: {
      display: { name: `Perf ${scenario.name}`, description: scenario.description },
      duration: '6h',
      refreshInterval: '0s',
      datasources: {
        [PERF_DATASOURCE]: {
          default: true,
          plugin: {
            kind: 'PrometheusDatasource',
            // Never reached: the perf harness answers every Prometheus request with generated data.
            spec: { proxy: { kind: 'HTTPProxy', spec: { url: 'http://localhost:9090' } } },
          },
        },
      },
      variables: [],
      panels,
      layouts,
    },
  };
}

async function upsert(baseURL: string, path: string, name: string, body: unknown): Promise<void> {
  const headers = { 'Content-Type': 'application/json' };
  const existing = await fetch(`${baseURL}${path}/${name}`);
  const response = existing.ok
    ? await fetch(`${baseURL}${path}/${name}`, { method: 'PUT', headers, body: JSON.stringify(body) })
    : await fetch(baseURL + path, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!response.ok) {
    throw new Error(`Unable to save ${path}/${name}: ${response.status} ${await response.text()}`);
  }
}

/**
 * Creates (or updates) the perf project and the dashboard of the scenario through the Perses API.
 */
export async function provisionPerfDashboard(backendURL: string, scenario: PerfScenario): Promise<void> {
  await upsert(backendURL, '/api/v1/projects', PERF_PROJECT, {
    kind: 'Project',
    metadata: { name: PERF_PROJECT },
    spec: { display: { name: 'Performance profiling' } },
  });
  await upsert(backendURL, `/api/v1/projects/${PERF_PROJECT}/dashboards`, scenario.name, buildPerfDashboard(scenario));
}
