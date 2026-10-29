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

/**
 * Compares two perf harness result folders and prints a Markdown report.
 *   node ui/e2e/src/perf/compare.ts <baseline-dir> <candidate-dir> [--components=10]
 *
 * This file has no relative import so it can run directly with Node.js.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

interface Summary {
  lastCommitMs: number;
  react: Record<string, number>;
  mainThread: Record<string, number>;
  network: Record<string, number>;
  components: Array<{ name: string; renders: number; renderMs: number }>;
}

const METRICS: Array<[label: string, read: (summary: Summary) => number]> = [
  ['Last React commit (ms)', (s) => s.lastCommitMs],
  ['Render passes', (s) => s.react['renderPasses']!],
  ['Render time (ms)', (s) => s.react['renderMs']!],
  ['Commits', (s) => s.react['commits']!],
  ['Commit time (ms)', (s) => s.react['commitMs']!],
  ['Passive effects (ms)', (s) => s.react['effectsMs']!],
  ['Component renders', (s) => s.react['componentRenders']!],
  ['Cascading updates', (s) => s.react['cascadingUpdates']!],
  ['Main thread tasks (ms)', (s) => s.mainThread['taskMs']!],
  ['Scripting (ms)', (s) => s.mainThread['scriptingMs']!],
  ['Long tasks', (s) => s.mainThread['longTasks']!],
  ['Total blocking time (ms)', (s) => s.mainThread['totalBlockingTimeMs']!],
  ['Query requests', (s) => s.network['queryRequests']!],
];

function formatDelta(before: number, after: number): string {
  const delta = Math.round((after - before) * 10) / 10;
  if (delta === 0) return '=';
  const percent = before === 0 ? '' : ` (${delta > 0 ? '+' : ''}${Math.round((delta / before) * 100)}%)`;
  return `${delta > 0 ? '+' : ''}${delta}${percent}`;
}

function readScenarios(dir: string): Map<string, Record<string, Summary>> {
  const scenarios = new Map<string, Record<string, Summary>>();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json') || file === 'environment.json') continue;
    scenarios.set(file.replace(/\.json$/, ''), JSON.parse(readFileSync(join(dir, file), 'utf8')));
  }
  return scenarios;
}

export function compare(baselineDir: string, candidateDir: string, componentLimit = 10): string {
  const baseline = readScenarios(baselineDir);
  const candidate = readScenarios(candidateDir);
  const lines = [`# Perf comparison: \`${baselineDir}\` → \`${candidateDir}\``, ''];

  for (const [scenario, phases] of baseline) {
    const candidatePhases = candidate.get(scenario);
    if (!candidatePhases) continue;
    for (const [phase, before] of Object.entries(phases)) {
      const after = candidatePhases[phase];
      if (!after) continue;
      lines.push(`## ${scenario} / ${phase}`, '', '| Metric | Before | After | Delta |', '| --- | --- | --- | --- |');
      for (const [label, read] of METRICS) {
        lines.push(`| ${label} | ${read(before)} | ${read(after)} | ${formatDelta(read(before), read(after))} |`);
      }

      const names = new Set([...before.components, ...after.components].map((component) => component.name));
      const changes = [...names]
        .map((name) => ({
          name,
          before: before.components.find((component) => component.name === name)?.renders ?? 0,
          after: after.components.find((component) => component.name === name)?.renders ?? 0,
        }))
        .filter((change) => change.before !== change.after)
        .toSorted((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before))
        .slice(0, componentLimit);
      if (changes.length) {
        lines.push('', '| Component renders | Before | After | Delta |', '| --- | --- | --- | --- |');
        for (const change of changes) {
          lines.push(
            `| ${change.name} | ${change.before} | ${change.after} | ${formatDelta(change.before, change.after)} |`,
          );
        }
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const [baselineDir, candidateDir] = args.filter((arg) => !arg.startsWith('--'));
  if (!baselineDir || !candidateDir || !existsSync(baselineDir) || !existsSync(candidateDir)) {
    console.error('Usage: node compare.ts <baseline-dir> <candidate-dir> [--components=10]');
    process.exit(1);
  }
  const limit = Number(args.find((arg) => arg.startsWith('--components='))?.split('=')[1] ?? 10);
  console.log(compare(baselineDir, candidateDir, limit));
}
