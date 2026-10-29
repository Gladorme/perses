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

import type { Page, Request, Route } from '@playwright/test';

export interface PrometheusMockOptions {
  seriesPerQuery: number;
  pointsPerSeries: number;
  /** Fixed delay applied to every response, so the request/response ordering is stable between runs. */
  latencyMs: number;
}

export interface PrometheusMock {
  /** Number of requests that have been received but not answered yet. */
  readonly inFlight: number;
  /** Total number of answered query requests (query and query_range). */
  readonly served: number;
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getParams(request: Request): URLSearchParams {
  const params = new URL(request.url()).searchParams;
  const body = request.postData();
  if (body) {
    new URLSearchParams(body).forEach((value, key) => params.set(key, value));
  }
  return params;
}

/**
 * Builds a deterministic Prometheus matrix response: the same query and time range always produce the same payload.
 */
export function buildMatrixResponse(
  query: string,
  startSeconds: number,
  endSeconds: number,
  seriesPerQuery: number,
  pointsPerSeries: number,
): string {
  const seed = hashString(query);
  const stepSeconds = pointsPerSeries > 1 ? (endSeconds - startSeconds) / (pointsPerSeries - 1) : 0;
  const result: string[] = [];
  for (let series = 0; series < seriesPerQuery; series++) {
    const values: string[] = [];
    for (let point = 0; point < pointsPerSeries; point++) {
      const timestamp = Math.round((startSeconds + point * stepSeconds) * 1000) / 1000;
      const value = (series + 1) * 10 + 5 * Math.sin((point + seed + series * 7) / 20);
      values.push(`[${timestamp},"${value.toFixed(3)}"]`);
    }
    result.push(
      `{"metric":{"__name__":"perf_metric","job":"perf","instance":"host-${series}:9100","query":${JSON.stringify(query)}},"values":[${values.join(',')}]}`,
    );
  }
  return `{"status":"success","data":{"resultType":"matrix","result":[${result.join(',')}]}}`;
}

function buildVectorResponse(query: string, timeSeconds: number, seriesPerQuery: number): string {
  const seed = hashString(query);
  const result: string[] = [];
  for (let series = 0; series < seriesPerQuery; series++) {
    const value = (series + 1) * 10 + 5 * Math.sin((seed + series * 7) / 20);
    result.push(
      `{"metric":{"__name__":"perf_metric","job":"perf","instance":"host-${series}:9100"},"value":[${timeSeconds},"${value.toFixed(3)}"]}`,
    );
  }
  return `{"status":"success","data":{"resultType":"vector","result":[${result.join(',')}]}}`;
}

/**
 * Answers every Prometheus request sent through the Perses datasource proxy with generated data.
 */
export async function mockPrometheus(page: Page, options: PrometheusMockOptions): Promise<PrometheusMock> {
  const state = { inFlight: 0, served: 0 };
  const cache = new Map<string, string>();

  const handle = async (route: Route): Promise<void> => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const params = getParams(request);
    const query = params.get('query') ?? '';

    let body: string;
    if (pathname.endsWith('/api/v1/query_range')) {
      const start = Number(params.get('start'));
      const end = Number(params.get('end'));
      const key = `${query}|${start}|${end}`;
      body = cache.get(key) ?? buildMatrixResponse(query, start, end, options.seriesPerQuery, options.pointsPerSeries);
      cache.set(key, body);
    } else if (pathname.endsWith('/api/v1/query')) {
      body = buildVectorResponse(query, Number(params.get('time')) || 0, options.seriesPerQuery);
    } else {
      // labels, label values, series, metadata, ...: nothing to discover.
      body = '{"status":"success","data":[]}';
    }

    state.inFlight++;
    await new Promise((resolve) => setTimeout(resolve, options.latencyMs));
    try {
      await route.fulfill({ status: 200, contentType: 'application/json', body });
    } finally {
      state.inFlight--;
      if (pathname.endsWith('/api/v1/query_range') || pathname.endsWith('/api/v1/query')) {
        state.served++;
      }
    }
  };

  await page.route((url) => url.pathname.startsWith('/proxy/') && url.pathname.includes('/api/v1/'), handle);

  return {
    get inFlight(): number {
      return state.inFlight;
    },
    get served(): number {
      return state.served;
    },
  };
}
