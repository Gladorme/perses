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

import type { ProjectResource } from '@perses-dev/client';
import { SnackbarProvider } from '@perses-dev/components';
import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import { UserPreferencesContextProvider } from '../../context/UserPreferences';
import { useProjectList } from '../../model/project-client';
import type { SearchProjectResource } from '../../model/search-client';
import { useSearchDashboards } from '../../model/search-client';
import type { UserPreferences } from '../../model/userPreferences';
import { HomeDashboardPreference } from './HomeDashboardPreference';

vi.mock('../../model/project-client', () => ({ useProjectList: vi.fn() }));
vi.mock('../../model/search-client', () => ({ useSearchDashboards: vi.fn() }));

const PREFERENCES_KEY = 'PERSES_USER_PREFERENCES';
const noPreferences: UserPreferences = {};

const projects: ProjectResource[] = [
  { kind: 'Project', metadata: { name: 'testing' }, spec: {} },
  { kind: 'Project', metadata: { name: 'perses' }, spec: { display: { name: 'Perses project' } } },
];

function buildDashboard(project: string, name: string, displayName: string): SearchProjectResource {
  return { metadata: { project, name }, displayName };
}

const dashboards: Record<string, SearchProjectResource[]> = {
  perses: [buildDashboard('perses', 'node-exporter', 'Node Exporter'), buildDashboard('perses', 'demo', 'demo')],
  testing: [buildDashboard('testing', 'panels', 'Panels')],
};

function mockDashboardLists(isPlaceholderData: (project: string) => boolean = () => false): void {
  vi.mocked(useSearchDashboards).mockImplementation(
    (project) =>
      ({
        data: project ? dashboards[project] : undefined,
        isPending: !project,
        isPlaceholderData: project !== undefined && isPlaceholderData(project),
        error: null,
      }) as ReturnType<typeof useSearchDashboards>,
  );
}

function renderPreference(preferences?: UserPreferences): void {
  if (preferences) {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  }
  render(
    <SnackbarProvider>
      <UserPreferencesContextProvider defaultPreferences={noPreferences}>
        <HomeDashboardPreference />
      </UserPreferencesContextProvider>
    </SnackbarProvider>,
  );
}

function getStoredPreferences(): unknown {
  return JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) ?? '');
}

function getField(name: 'Project' | 'Dashboard'): HTMLElement {
  return screen.getByRole('combobox', { name });
}

function getOptions(name: 'Project' | 'Dashboard'): HTMLElement[] {
  const field = getField(name);
  if (field.getAttribute('aria-expanded') !== 'true') {
    fireEvent.mouseDown(field);
  }
  return screen.queryAllByRole('option');
}

function select(name: 'Project' | 'Dashboard', option: string): void {
  getOptions(name);
  fireEvent.click(screen.getByRole('option', { name: option }));
}

function getButton(name: 'Save' | 'Use default home page'): HTMLElement {
  return screen.getByRole('button', { name });
}

describe('HomeDashboardPreference', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(useProjectList).mockReturnValue({ data: projects, isPending: false, error: null } as ReturnType<
      typeof useProjectList
    >);
    mockDashboardLists();
  });

  it('saves the selected dashboard as home page', () => {
    renderPreference({ timezone: 'UTC' });

    expect(getField('Dashboard')).toBeDisabled();
    expect(getButton('Save')).toBeDisabled();
    expect(getButton('Use default home page')).toBeDisabled();

    select('Project', 'Perses project perses');
    expect(getButton('Save')).toBeDisabled();
    select('Dashboard', 'Node Exporter node-exporter');
    fireEvent.click(getButton('Save'));

    expect(getStoredPreferences()).toEqual({
      timezone: 'UTC',
      homeDashboard: { project: 'perses', dashboard: 'node-exporter' },
    });
    expect(screen.getByText('Home page set to the dashboard Node Exporter')).toBeInTheDocument();
    expect(getButton('Save')).toBeDisabled();
    expect(getButton('Use default home page')).toBeEnabled();
  });

  it('displays the saved home dashboard and lets the user go back to the default home page', () => {
    renderPreference({ timezone: 'UTC', homeDashboard: { project: 'perses', dashboard: 'node-exporter' } });

    expect(getField('Project')).toHaveValue('Perses project');
    expect(getField('Dashboard')).toHaveValue('Node Exporter');

    fireEvent.click(getButton('Use default home page'));

    expect(getStoredPreferences()).toEqual({ timezone: 'UTC' });
    expect(getField('Project')).toHaveValue('');
    expect(getField('Dashboard')).toHaveValue('');
    expect(getButton('Use default home page')).toBeDisabled();
  });

  it('lists the projects and the dashboards of the selected project by display name', () => {
    renderPreference();

    const [firstProject, secondProject, ...otherProjects] = getOptions('Project');
    expect(firstProject).toHaveAccessibleName('Perses project perses');
    expect(secondProject).toHaveAccessibleName('testing');
    expect(otherProjects).toEqual([]);

    select('Project', 'testing');

    const [firstDashboard, ...otherDashboards] = getOptions('Dashboard');
    expect(firstDashboard).toHaveAccessibleName('Panels panels');
    expect(otherDashboards).toEqual([]);
  });

  it('requires a dashboard of the newly selected project', () => {
    renderPreference({ homeDashboard: { project: 'perses', dashboard: 'node-exporter' } });

    select('Project', 'testing');

    expect(getField('Dashboard')).toHaveValue('');
    expect(getButton('Save')).toBeDisabled();

    select('Dashboard', 'Panels panels');
    fireEvent.click(getButton('Save'));

    expect(getStoredPreferences()).toEqual({ homeDashboard: { project: 'testing', dashboard: 'panels' } });
  });

  it('does not offer the dashboards of the previous project while the ones of the selected project are loading', () => {
    mockDashboardLists((project) => project === 'testing');
    renderPreference({ homeDashboard: { project: 'perses', dashboard: 'node-exporter' } });

    select('Project', 'testing');

    expect(getOptions('Dashboard')).toEqual([]);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('reports a saved home dashboard that can not be found anymore', () => {
    renderPreference({ homeDashboard: { project: 'perses', dashboard: 'deleted' } });

    expect(getField('Project')).toBeValid();
    expect(getField('Dashboard')).toHaveValue('deleted');
    expect(getField('Dashboard')).toHaveAccessibleDescription("This dashboard can't be found");
    expect(getButton('Save')).toBeDisabled();
  });
});
