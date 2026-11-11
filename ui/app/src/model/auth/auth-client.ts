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

import { fetch } from '@perses-dev/client';
import { useQueryParam } from 'use-query-params';

import { PERSES_APP_CONFIG } from '../../config';
import { HTTPHeader, HTTPMethodPOST } from '../http';
import buildURL from '../url-builder';
import { useCurrentUser } from '../user-client';

export const authResource = 'auth';
const redirectQueryParam = 'rd';

// Base URL only used to read a redirect path the way a browser does. It is never requested.
const REDIRECT_BASE_URL = 'http://perses.invalid';

/**
 * Whether the given value can be used to redirect the user after the login.
 *
 * The value comes from the `rd` query param, so it is chosen by whoever built the link to the login page. Only a path
 * of the application is accepted, never a URL leading to another website. The value is resolved with the URL parser of
 * the browser, as the browser accepts several ways to write the URL of another website that start with a slash.
 * @param path the value of the `rd` query param.
 */
export function isLocalRedirectPath(path: unknown): path is string {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    return false;
  }
  try {
    return new URL(path, REDIRECT_BASE_URL).origin === REDIRECT_BASE_URL;
  } catch {
    return false;
  }
}

/**
 * Get the redirect path from URL's query params.
 * This is used to retrieve the original path that a user desired before being redirected to the login page.
 *
 * The `rd` query param holds a path relative to the app's `api_prefix`, which is what React Router's
 * `navigate()`/`<Navigate>` expect since the router is created with `api_prefix` as its basename. The fallback path
 * (used when there is no `rd` query param) is `/` for the same reason. Pass `true` when the path is instead going to be
 * used outside of React Router (e.g. a raw `window.location.href` redirect to the backend), where the path must include
 * `api_prefix` itself.
 *
 * A `rd` query param that is not a path of the application is ignored, and the fallback path is used instead.
 * @param absolute whether the returned path must be absolute (include `api_prefix`) rather than router-relative.
 */
export function useRedirectQueryParam(absolute?: boolean): string {
  const [redirectPath] = useQueryParam<string | undefined>(redirectQueryParam);
  const path = isLocalRedirectPath(redirectPath) ? redirectPath : '/';
  const apiPrefix = PERSES_APP_CONFIG.api_prefix;
  if (!absolute || !apiPrefix) {
    return path;
  }
  return path === '/' ? apiPrefix : `${apiPrefix}${path}`;
}

/**
 * Build a query string with the redirect path. Related with {@link useRedirectQueryParam}
 * @param path original path desired by the user before being redirected to the login page.
 */
export function buildRedirectQueryString(path: string): string {
  return `${redirectQueryParam}=${encodeURIComponent(path)}`;
}

export function refreshToken(): Promise<Response> {
  const url = buildURL({ resource: `${authResource}/refresh`, apiURL: '/api' });
  return fetch(url, {
    method: HTTPMethodPOST,
    headers: HTTPHeader,
  });
}

// Retrieve the currently logged-in user's username. Returns an empty string if the user is not
// logged in
export function useUsername(): string {
  const me = useCurrentUser();
  return me.data?.metadata?.name ?? '';
}

export function useIsLoggedIn(): boolean {
  return !!useUsername();
}
