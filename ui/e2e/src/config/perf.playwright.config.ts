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

import type { PlaywrightTestConfig } from '@playwright/test';
import { devices } from '@playwright/test';

/**
 * Playwright configuration recording the dashboard performance profiles. See src/perf/README.md.
 */
const config: PlaywrightTestConfig = {
  testDir: '../perf',
  testMatch: '**/*.perf.ts',
  timeout: 30 * 60 * 1000,
  // Profiles must not compete for the CPU.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  outputDir: '../../perf-results/.playwright',
  webServer: [],
  use: {
    baseURL: process.env.PERF_BASE_URL ?? 'http://localhost:3000',
    serviceWorkers: 'block',
    timezoneId: 'UTC',
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // New headless mode: same rendering pipeline as headed Chrome.
        channel: 'chromium',
        viewport: { width: 1600, height: 1000 },
      },
    },
  ],
};

export default config;
