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

import type { StatusError } from '@perses-dev/client';
import { UserFriendlyError } from '@perses-dev/client';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { vi } from 'vitest';

import { UserPreferencesContextProvider } from '../../context/UserPreferences';
import { useDashboard } from '../../model/dashboard-client';
import { useProject } from '../../model/project-client';
import type { UserPreferences } from '../../model/userPreferences';
import { UserHomeView } from './UserHomeView';

vi.mock('../../model/dashboard-client', () => ({ useDashboard: vi.fn() }));
vi.mock('../../model/project-client', () => ({ useProject: vi.fn() }));

// The default home page loads many resources, which are not needed to check when it is displayed.
vi.mock('./HomeView', () => ({
  default: ({ notice }: { notice?: ReactNode }): ReactElement => (
    <>
      <h1>Default home page</h1>
      {notice}
    </>
  ),
}));

const PREFERENCES_KEY = 'PERSES_USER_PREFERENCES';
const noPreferences: UserPreferences = {};

interface QueryState {
  isPending: boolean;
  error: StatusError | null;
}

const loaded: QueryState = { isPending: false, error: null };
const loading: QueryState = { isPending: true, error: null };
const notFound: QueryState = { isPending: false, error: new UserFriendlyError('document not found', 404) };

function mockQueries(project: QueryState, dashboard: QueryState): void {
  vi.mocked(useProject).mockReturnValue(project as ReturnType<typeof useProject>);
  vi.mocked(useDashboard).mockReturnValue(dashboard as ReturnType<typeof useDashboard>);
}

function DashboardPage(): ReactElement {
  const { projectName, dashboardName } = useParams();
  return (
    <h1>
      Dashboard {dashboardName} of the project {projectName}
    </h1>
  );
}

function renderHomePage(preferences?: UserPreferences): void {
  if (preferences) {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  }
  render(
    <MemoryRouter>
      <UserPreferencesContextProvider defaultPreferences={noPreferences}>
        <Routes>
          <Route path="/" element={<UserHomeView />} />
          <Route path="/projects/:projectName/dashboards/:dashboardName" element={<DashboardPage />} />
        </Routes>
      </UserPreferencesContextProvider>
    </MemoryRouter>,
  );
}

describe('UserHomeView', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    mockQueries(loaded, loaded);
  });

  it('displays the default home page when no home dashboard is selected', () => {
    renderHomePage();

    expect(screen.getByRole('heading', { name: 'Default home page' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(useDashboard).not.toHaveBeenCalled();
  });

  it('redirects to the selected home dashboard', () => {
    renderHomePage({ homeDashboard: { project: 'perses', dashboard: 'demo' } });

    expect(screen.getByRole('heading', { name: 'Dashboard demo of the project perses' })).toBeInTheDocument();
    expect(useProject).toHaveBeenCalledWith('perses');
    expect(useDashboard).toHaveBeenCalledWith('perses', 'demo');
  });

  it.each([
    ['project', loading, loaded],
    ['dashboard', loaded, loading],
  ])('waits for the %s of the home dashboard to be loaded', (_, project, dashboard) => {
    mockQueries(project, dashboard);
    renderHomePage({ homeDashboard: { project: 'perses', dashboard: 'demo' } });

    expect(screen.getByRole('progressbar', { name: 'Loading your home page' })).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it.each([
    ['project', notFound, loading],
    ['dashboard', loaded, notFound],
  ])('displays the default home page when the %s of the home dashboard can not be loaded', (_, project, dashboard) => {
    mockQueries(project, dashboard);
    renderHomePage({ homeDashboard: { project: 'perses', dashboard: 'demo' } });

    expect(screen.getByRole('heading', { name: 'Default home page' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The dashboard "demo" of the project "perses" could not be loaded (document not found).',
    );
    expect(screen.getByRole('link', { name: 'profile' })).toHaveAttribute('href', '/profile');
  });

  it('lets the user go back to the default home page when the home dashboard can not be loaded', () => {
    mockQueries(loaded, notFound);
    renderHomePage({ timezone: 'UTC', homeDashboard: { project: 'perses', dashboard: 'demo' } });

    fireEvent.click(screen.getByRole('button', { name: 'Use default home page' }));

    expect(screen.getByRole('heading', { name: 'Default home page' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) ?? '')).toEqual({ timezone: 'UTC' });
  });
});
