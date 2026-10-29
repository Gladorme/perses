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

export type PerfPanelKind = 'TimeSeriesChart' | 'StatChart' | 'GaugeChart' | 'Markdown';

/**
 * A user action recorded in its own trace.
 * - load: navigate to the dashboard and wait until every visible panel has rendered its data.
 * - refresh: click the refresh button, which re-runs every enabled query.
 * - zoomOut: double the time range, which changes the query keys of every panel.
 * - scroll: scroll to the bottom of the dashboard, which mounts panels lazily and runs their queries.
 * - collapseExpand: collapse then expand the first panel group.
 * - hover: move the mouse over the visible panels, one after the other.
 */
export type PerfPhase = 'load' | 'refresh' | 'zoomOut' | 'scroll' | 'collapseExpand' | 'hover';

export interface PerfScenario {
  name: string;
  description: string;
  groups: number;
  panelsPerGroup: number;
  /** Panel kinds are assigned to panels in a round-robin way. */
  panelKinds: PerfPanelKind[];
  seriesPerQuery: number;
  pointsPerSeries: number;
  /** When true, every group except the first one is collapsed. */
  collapseGroups?: boolean;
  phases: PerfPhase[];
}

export const PERF_SCENARIOS: PerfScenario[] = [
  {
    name: 'small',
    description: '1 group, 6 time series panels, 5 series x 300 points',
    groups: 1,
    panelsPerGroup: 6,
    panelKinds: ['TimeSeriesChart'],
    seriesPerQuery: 5,
    pointsPerSeries: 300,
    phases: ['load', 'hover', 'refresh', 'zoomOut'],
  },
  {
    name: 'medium-mixed',
    description: '4 groups, 32 mixed panels, 10 series x 300 points',
    groups: 4,
    panelsPerGroup: 8,
    panelKinds: ['TimeSeriesChart', 'StatChart', 'TimeSeriesChart', 'GaugeChart', 'Markdown'],
    seriesPerQuery: 10,
    pointsPerSeries: 300,
    phases: ['load', 'hover', 'refresh', 'scroll', 'collapseExpand'],
  },
  {
    name: 'many-panels',
    description: '10 groups, 200 time series panels, 3 series x 100 points',
    groups: 10,
    panelsPerGroup: 20,
    panelKinds: ['TimeSeriesChart'],
    seriesPerQuery: 3,
    pointsPerSeries: 100,
    phases: ['load', 'hover', 'refresh', 'scroll'],
  },
  {
    name: 'many-groups-collapsed',
    description: '50 groups (49 collapsed), 200 time series panels, 3 series x 100 points',
    groups: 50,
    panelsPerGroup: 4,
    panelKinds: ['TimeSeriesChart'],
    seriesPerQuery: 3,
    pointsPerSeries: 100,
    collapseGroups: true,
    phases: ['load', 'refresh'],
  },
  {
    name: 'large-data',
    description: '1 group, 4 time series panels, 100 series x 1000 points',
    groups: 1,
    panelsPerGroup: 4,
    panelKinds: ['TimeSeriesChart'],
    seriesPerQuery: 100,
    pointsPerSeries: 1000,
    phases: ['load', 'refresh', 'zoomOut'],
  },
];

/**
 * Returns the scenarios selected with the comma separated PERF_SCENARIOS environment variable (all by default).
 */
export function getSelectedScenarios(): PerfScenario[] {
  const selected = process.env.PERF_SCENARIOS?.split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  if (!selected?.length) return PERF_SCENARIOS;

  const unknown = selected.filter((name) => !PERF_SCENARIOS.some((scenario) => scenario.name === name));
  if (unknown.length) {
    throw new Error(
      `Unknown PERF_SCENARIOS: ${unknown.join(', ')}. Available: ${PERF_SCENARIOS.map((s) => s.name).join(', ')}`,
    );
  }
  return PERF_SCENARIOS.filter((scenario) => selected.includes(scenario.name));
}
