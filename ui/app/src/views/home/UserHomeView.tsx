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

import { Alert, AlertTitle, Button, CircularProgress, Link, Stack } from '@mui/material';
import type { StatusError } from '@perses-dev/client';
import type { ReactElement } from 'react';
import { Link as RouterLink, Navigate } from 'react-router-dom';

import { useUserPreferences } from '../../context/UserPreferences';
import { useDashboard } from '../../model/dashboard-client';
import { useProject } from '../../model/project-client';
import { ProfileRoute } from '../../model/route';
import type { HomeDashboard } from '../../model/userPreferences';
import HomeView from './HomeView';

interface HomeDashboardUnavailableProps {
  homeDashboard: HomeDashboard;
  error: StatusError;
}

/**
 * Explains why the default home page is displayed instead of the home dashboard, and how to fix it.
 */
function HomeDashboardUnavailable({ homeDashboard, error }: HomeDashboardUnavailableProps): ReactElement {
  const { updateUserPreferences } = useUserPreferences();

  return (
    <Alert
      severity="warning"
      action={
        <Button
          color="inherit"
          size="small"
          sx={{ whiteSpace: 'nowrap' }}
          onClick={() => updateUserPreferences({ homeDashboard: undefined })}
        >
          Use default home page
        </Button>
      }
    >
      <AlertTitle>Your home page can&apos;t be displayed</AlertTitle>
      The dashboard &quot;{homeDashboard.dashboard}&quot; of the project &quot;{homeDashboard.project}&quot; could not
      be loaded ({error.message}). You can select another dashboard in the preferences of your{' '}
      <Link component={RouterLink} to={ProfileRoute} color="inherit">
        profile
      </Link>
      .
    </Alert>
  );
}

interface HomeDashboardRedirectProps {
  homeDashboard: HomeDashboard;
}

function HomeDashboardRedirect({ homeDashboard }: HomeDashboardRedirectProps): ReactElement {
  const { project, dashboard } = homeDashboard;

  // The dashboard page sends the user back to the home page when its project can't be loaded. The project and the
  // dashboard are checked here first, so the user is never redirected to a page that would send them back.
  const { isPending: isProjectPending, error: projectError } = useProject(project);
  const { isPending: isDashboardPending, error: dashboardError } = useDashboard(project, dashboard);
  const error = projectError ?? dashboardError;

  if (error !== null) {
    return <HomeView notice={<HomeDashboardUnavailable homeDashboard={homeDashboard} error={error} />} />;
  }

  if (isProjectPending || isDashboardPending) {
    return (
      <Stack width="100%" sx={{ alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress aria-label="Loading your home page" />
      </Stack>
    );
  }

  return <Navigate to={`/projects/${project}/dashboards/${dashboard}`} replace />;
}

/**
 * The home page of the user: the dashboard they have selected in their preferences, otherwise the default home page.
 */
export function UserHomeView(): ReactElement {
  const { userPreferences } = useUserPreferences();
  const { homeDashboard } = userPreferences;

  if (homeDashboard === undefined) {
    return <HomeView />;
  }
  return <HomeDashboardRedirect homeDashboard={homeDashboard} />;
}
