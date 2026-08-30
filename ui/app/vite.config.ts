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

import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

const prefixPathPlaceholder = 'PREFIX_PATH_PLACEHOLDER';
const sharedPackagesPath = process.env.SHARED_PACKAGES_PATH ?? resolve(import.meta.dirname, '../../../shared');
const sharedPackagePattern = /^@perses-dev\/(client|components|dashboards|explore|plugin-system)$/;
const mdiMaterialUiEsmPath = resolve(import.meta.dirname, '../node_modules/mdi-material-ui/esm/$1');

// Keep context and state libraries single-instanced when loading shared package source.
const dedupe = [
  '@emotion/react',
  '@emotion/styled',
  '@mui/material',
  '@mui/system',
  '@tanstack/react-query',
  'react',
  'react-dom',
  'react-hook-form',
  'react-router',
  'react-router-dom',
  'use-query-params',
];

export default defineConfig(({ command }) => {
  const isDev = command === 'serve';
  const isSharedDev = isDev && process.env.SHARED_DEV === 'true';

  return {
    base: isDev ? '/' : `/${prefixPathPlaceholder}/`,
    plugins: [react()],
    resolve: {
      alias: [
        // Deep imports resolve to CommonJS by default, which Vite exposes as a module object instead of a component.
        { find: /^mdi-material-ui\/(.+)$/, replacement: mdiMaterialUiEsmPath },
        ...(isSharedDev ? [{ find: sharedPackagePattern, replacement: resolve(sharedPackagesPath, '$1/src') }] : []),
      ],
      dedupe: isSharedDev ? dedupe : undefined,
    },
    build: {
      target: ['chrome87', 'edge88', 'firefox78', 'safari14'],
    },
    server: {
      allowedHosts: true,
      fs: isSharedDev ? { allow: [searchForWorkspaceRoot(import.meta.dirname), sharedPackagesPath] } : undefined,
      hmr: {
        // The overlay is opt-in because it interferes with e2e tests and some development workflows.
        overlay: process.env.ERROR_OVERLAY === 'true',
      },
      port: Number.parseInt(process.env.PORT ?? '3000', 10),
      proxy: {
        '^/(api|plugins|proxy)(/|$)': 'http://localhost:8080',
      },
    },
  };
});
