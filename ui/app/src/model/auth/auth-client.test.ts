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

import { renderHook } from '@testing-library/react';

import { isLocalRedirectPath, useRedirectQueryParam } from './auth-client';

const { mockUseQueryParam, mockApiPrefix } = vi.hoisted(() => ({
  mockUseQueryParam: vi.fn(),
  mockApiPrefix: { current: '' },
}));

vi.mock('use-query-params', async (importOriginal) => ({
  ...(await importOriginal()),
  useQueryParam: mockUseQueryParam,
}));

vi.mock('../../config', () => ({
  get PERSES_APP_CONFIG(): { api_prefix: string } {
    return { api_prefix: mockApiPrefix.current };
  },
}));

describe('useRedirectQueryParam', () => {
  afterEach(() => {
    mockApiPrefix.current = '';
  });

  it('returns the rd query param as-is by default, regardless of api_prefix', () => {
    mockApiPrefix.current = '/perses';
    mockUseQueryParam.mockReturnValue(['/explore?explorer=Prometheus-PrometheusExplorer']);

    const { result } = renderHook(() => useRedirectQueryParam());

    expect(result.current).toEqual('/explore?explorer=Prometheus-PrometheusExplorer');
  });

  it('prefixes the rd query param with api_prefix when absolute is true and api_prefix is set', () => {
    mockApiPrefix.current = '/perses';
    mockUseQueryParam.mockReturnValue(['/explore?explorer=Prometheus-PrometheusExplorer']);

    const { result } = renderHook(() => useRedirectQueryParam(true));

    expect(result.current).toEqual('/perses/explore?explorer=Prometheus-PrometheusExplorer');
  });

  it('returns the rd query param as-is when absolute is true and api_prefix is empty', () => {
    mockApiPrefix.current = '';
    mockUseQueryParam.mockReturnValue(['/dashboards/my-dashboard']);

    const { result } = renderHook(() => useRedirectQueryParam(true));

    expect(result.current).toEqual('/dashboards/my-dashboard');
  });

  it('does not append a trailing slash to api_prefix when absolute is true and the rd query param is "/"', () => {
    mockApiPrefix.current = '/perses';
    mockUseQueryParam.mockReturnValue(['/']);

    const { result } = renderHook(() => useRedirectQueryParam(true));

    expect(result.current).toEqual('/perses');
  });

  it('falls back to "/" by default when no rd query param is present, regardless of api_prefix', () => {
    mockApiPrefix.current = '/perses';
    mockUseQueryParam.mockReturnValue([undefined]);

    const { result } = renderHook(() => useRedirectQueryParam());

    expect(result.current).toEqual('/');
  });

  it('falls back to api_prefix when absolute is true, no rd query param is present, and api_prefix is set', () => {
    mockApiPrefix.current = '/perses';
    mockUseQueryParam.mockReturnValue([undefined]);

    const { result } = renderHook(() => useRedirectQueryParam(true));

    expect(result.current).toEqual('/perses');
  });

  it('falls back to "/" when absolute is true, no rd query param is present, and api_prefix is empty', () => {
    mockApiPrefix.current = '';
    mockUseQueryParam.mockReturnValue([undefined]);

    const { result } = renderHook(() => useRedirectQueryParam(true));

    expect(result.current).toEqual('/');
  });

  it.each([
    ['an absolute URL', 'https://example.com/'],
    ['a URL relative to the scheme', '//example.com/path'],
    ['a backslash after the leading slash', '/\\example.com'],
    ['a tab between two slashes', '/\t/example.com'],
    ['a relative path', 'projects/perses'],
    ['another scheme', 'mailto:someone@example.com'],
  ])('falls back to "/" when the rd query param is %s', (_title, rd) => {
    mockUseQueryParam.mockReturnValue([rd]);

    const { result } = renderHook(() => useRedirectQueryParam());

    expect(result.current).toEqual('/');
  });

  it('falls back to "/" when the rd query param is repeated', () => {
    mockUseQueryParam.mockReturnValue([['/projects/a', '/projects/b']]);

    const { result } = renderHook(() => useRedirectQueryParam());

    expect(result.current).toEqual('/');
  });

  it('falls back to api_prefix when absolute is true and the rd query param is not a path of the application', () => {
    mockApiPrefix.current = '/perses';
    mockUseQueryParam.mockReturnValue(['//example.com/path']);

    const { result } = renderHook(() => useRedirectQueryParam(true));

    expect(result.current).toEqual('/perses');
  });
});

describe('isLocalRedirectPath', () => {
  it.each([
    '/',
    '/projects/perses/dashboards/demo',
    '/explore?explorer=Prometheus-PrometheusExplorer',
    '/explore?link=https://example.com/',
    '/explore?filter=a\\.b',
    '/projects/a%2Fb',
    '/projects/perses#section',
  ])('accepts %j', (path) => {
    expect(isLocalRedirectPath(path)).toBe(true);
  });

  it.each([
    undefined,
    null,
    '',
    'https://example.com/',
    'http://example.com',
    '//example.com/path',
    '/\\example.com',
    '\\\\example.com',
    'projects/perses',
    'mailto:someone@example.com',
    '/\t/example.com',
    '/\n/example.com',
    ' /projects/perses',
  ])('rejects %j', (path) => {
    expect(isLocalRedirectPath(path)).toBe(false);
  });

  it('rejects a value that is not a string', () => {
    expect(isLocalRedirectPath(['/projects/a', '/projects/b'])).toBe(false);
  });
});
