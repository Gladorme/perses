// Copyright 2023 The Perses Authors
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

import { useNavigate, useParams } from 'react-router-dom';
import { Box, Stack, Typography, Button } from '@mui/material';
import { ErrorAlert, ErrorBoundary } from '@perses-dev/components';
import FolderPound from 'mdi-material-ui/FolderPound';
import ViewDashboard from 'mdi-material-ui/ViewDashboard';
import HistoryIcon from 'mdi-material-ui/History';
import { useCallback, useState } from 'react';
import { useDashboardList } from '../model/dashboard-client';
import { DashboardList } from '../components/DashboardList';
import { DeleteProjectDialog } from '../components/DeleteProjectDialog/DeleteProjectDialog';
import { CreateDashboardDialog } from '../components/CreateDashboardDialog/CreateDashboardDialog';
import DashboardBreadcrumbs from '../components/DashboardBreadcrumbs';
import { useNavHistory } from '../context/DashboardNavHistory';

interface RenderDashboardInProjectProperties {
  projectName: string;
}

function DashboardPageInProject(props: RenderDashboardInProjectProperties) {
  const navigate = useNavigate();

  const [openCreateDashboardDialogState, setOpenCreateDashboardDialogState] = useState(false);

  const { data } = useDashboardList(props.projectName);
  if (data === undefined) {
    return null;
  }

  const handleDashboardCreation = function (name: string) {
    navigate(`/projects/${props.projectName}/dashboards/${name}/create`);
  };

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Stack direction="row" alignItems="center" gap={1} my={2}>
          <ViewDashboard />
          <Typography variant="h3">Dashboards</Typography>
        </Stack>
        <Button variant="contained" size="small" onClick={() => setOpenCreateDashboardDialogState(true)}>
          Add Dashboard
        </Button>
      </Stack>
      <ErrorBoundary FallbackComponent={ErrorAlert}>
        <DashboardList dashboardList={data} />
      </ErrorBoundary>
      <CreateDashboardDialog
        open={openCreateDashboardDialogState}
        onClose={() => setOpenCreateDashboardDialogState(false)}
        onSuccess={(name: string) => handleDashboardCreation(name)}
      />
    </Box>
  );
}

interface RecentVisitedDashboardsInProjectProperties {
  projectName: string;
}

function RecentVisitedDashboardsInProject(props: RecentVisitedDashboardsInProjectProperties) {
  const navigate = useNavigate();
  const history = useNavHistory();

  console.log(history);

  const [openCreateDashboardDialogState, setOpenCreateDashboardDialogState] = useState(false);

  const { data } = useDashboardList(props.projectName);
  if (data === undefined) {
    return null;
  }

  const handleDashboardCreation = function (name: string) {
    navigate(`/projects/${props.projectName}/dashboards/${name}/create`);
  };

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Stack direction="row" alignItems="center" gap={1} my={2}>
          <HistoryIcon />
          <Typography variant="h3">Recently Visited</Typography>
        </Stack>
      </Stack>
      <ErrorBoundary FallbackComponent={ErrorAlert}>
        <DashboardList dashboardList={data} />
      </ErrorBoundary>
      <CreateDashboardDialog
        open={openCreateDashboardDialogState}
        onClose={() => setOpenCreateDashboardDialogState(false)}
        onSuccess={(name: string) => handleDashboardCreation(name)}
      />
    </Box>
  );
}

function ViewProject() {
  const { projectName } = useParams();
  if (projectName === undefined) {
    throw new Error('Unable to get the project name');
  }

  // Navigate to the home page if the project has been successfully deleted
  const navigate = useNavigate();
  const handleDeleteProjectDialogSuccess = useCallback(() => navigate(`/`), [navigate]);

  // Open/Close management for the "Delete Project" dialog
  const [isDeleteProjectDialogOpen, setIsDeleteProjectDialogOpen] = useState<boolean>(false);
  const handleDeleteProjectDialogOpen = useCallback(
    () => setIsDeleteProjectDialogOpen(true),
    [setIsDeleteProjectDialogOpen]
  );
  const handleDeleteProjectDialogClose = useCallback(
    () => setIsDeleteProjectDialogOpen(false),
    [setIsDeleteProjectDialogOpen]
  );

  return (
    <Stack sx={{ width: '100%' }} m={2} gap={2}>
      <DashboardBreadcrumbs dashboardProject={projectName} />
      <Box sx={{ width: '100%' }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Stack direction="row" alignItems="center" gap={1}>
            <FolderPound fontSize={'large'} />
            <Typography variant="h1">{projectName}</Typography>
          </Stack>
          <Button
            variant="outlined"
            color="error"
            size="small"
            sx={{ textTransform: 'uppercase' }}
            onClick={handleDeleteProjectDialogOpen}
          >
            Delete Project
          </Button>
        </Stack>
        <DeleteProjectDialog
          name={projectName}
          open={isDeleteProjectDialogOpen}
          onClose={handleDeleteProjectDialogClose}
          onSuccess={handleDeleteProjectDialogSuccess}
        />
      </Box>
      <Box sx={{ display: 'flex' }} flexDirection={'row'} gap={8}>
        <Box flexGrow={4}>
          <DashboardPageInProject projectName={projectName} />
        </Box>
        <Box flexGrow={1}>
          <RecentVisitedDashboardsInProject projectName={projectName} />
        </Box>
      </Box>
    </Stack>
  );
}

export default ViewProject;
