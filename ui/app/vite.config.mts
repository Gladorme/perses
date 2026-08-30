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
const nodeModulesPath = resolve(import.meta.dirname, '../node_modules');
const sharedNodeModulesPath = resolve(sharedPackagesPath, 'node_modules');

const localAliases = {
  '@perses-dev/internal-utils': resolve(nodeModulesPath, '@perses-dev/internal-utils/dist'),
};

const sharedAliases = {
  '@perses-dev/explore': resolve(sharedPackagesPath, 'explore/src'),
  '@perses-dev/components': resolve(sharedPackagesPath, 'components/src'),
  '@perses-dev/dashboards': resolve(sharedPackagesPath, 'dashboards/src'),
  '@perses-dev/plugin-system': resolve(sharedPackagesPath, 'plugin-system/src'),
  '@perses-dev/client': resolve(sharedPackagesPath, 'client/src'),

  // Packages only in shared node_modules.
  zustand: resolve(sharedNodeModulesPath, 'zustand'),
  immer: resolve(sharedNodeModulesPath, 'immer'),
  'use-immer': resolve(sharedNodeModulesPath, 'use-immer'),
};

// Ensure all packages use the same singleton/context-based library instances.
// This prevents "multiple instances" errors when developing with shared packages.
const singletonAliases = {
  react: resolve(nodeModulesPath, 'react'),
  'react-dom': resolve(nodeModulesPath, 'react-dom'),
  'react/jsx-runtime': resolve(nodeModulesPath, 'react/jsx-runtime'),
  'react/jsx-dev-runtime': resolve(nodeModulesPath, 'react/jsx-dev-runtime'),
  'react-router-dom': resolve(nodeModulesPath, 'react-router-dom'),
  'react-router': resolve(nodeModulesPath, 'react-router'),
  'use-query-params': resolve(nodeModulesPath, 'use-query-params'),
  '@tanstack/react-query': resolve(nodeModulesPath, '@tanstack/react-query'),
  '@mui/material': resolve(nodeModulesPath, '@mui/material'),
  '@mui/system': resolve(nodeModulesPath, '@mui/system'),
  '@mui/styles': resolve(nodeModulesPath, '@mui/styles'),
  '@emotion/react': resolve(nodeModulesPath, '@emotion/react'),
  '@emotion/styled': resolve(nodeModulesPath, '@emotion/styled'),
  'react-hook-form': resolve(nodeModulesPath, 'react-hook-form'),
};

export default defineConfig(({ command }) => {
  const isDev = command === 'serve';
  const isSharedDev = isDev && process.env.SHARED_DEV === 'true';

  return {
    base: isDev ? '/' : `/${prefixPathPlaceholder}/`,
    plugins: [react()],
    resolve: {
      alias: isSharedDev ? { ...sharedAliases, ...localAliases, ...singletonAliases } : {},
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: false,
      target: ['chrome87', 'edge88', 'firefox78', 'safari14'],
    },
    server: {
      allowedHosts: true,
      fs: {
        allow: [searchForWorkspaceRoot(import.meta.dirname), sharedPackagesPath],
      },
      hmr: {
        // The overlay is opt-in because it interferes with e2e tests and some development workflows.
        overlay: process.env.ERROR_OVERLAY === 'true',
      },
      port: Number.parseInt(process.env.PORT ?? '3000', 10),
      proxy: {
        '/api': 'http://localhost:8080',
        '/plugins': 'http://localhost:8080',
        '/proxy': 'http://localhost:8080',
      },
    },
  };
});
