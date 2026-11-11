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

import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * The Perses App profile page.
 */
export class AppProfilePage {
  readonly page: Page;

  readonly homePageForm: Locator;

  constructor(page: Page) {
    this.page = page;

    this.homePageForm = page.getByRole('form', { name: 'Home page' });
  }

  async gotoPreferences(): Promise<void> {
    await this.page.goto('/profile');
    await this.page.getByRole('button', { name: 'Preferences' }).click();
  }

  /**
   * Selects the dashboard displayed as home page, using the preferences.
   * @param projectName - Name of the project of the dashboard.
   * @param dashboardName - Name of the dashboard.
   */
  async selectHomeDashboard(projectName: string, dashboardName: string): Promise<void> {
    await this.selectHomePageOption('Project', projectName);
    await this.selectHomePageOption('Dashboard', dashboardName);

    const saveButton = this.homePageForm.getByRole('button', { name: 'Save' });
    await saveButton.click();
    // The button is disabled once the selection is saved.
    await expect(saveButton).toBeDisabled();
  }

  async useDefaultHomePage(): Promise<void> {
    const defaultButton = this.homePageForm.getByRole('button', { name: 'Use default home page' });
    await defaultButton.click();
    // The button is disabled once the default home page is used.
    await expect(defaultButton).toBeDisabled();
  }

  private async selectHomePageOption(field: 'Project' | 'Dashboard', option: string): Promise<void> {
    await this.homePageForm.getByRole('combobox', { name: field }).fill(option);
    await this.page.getByRole('option', { name: option }).click();
  }
}
