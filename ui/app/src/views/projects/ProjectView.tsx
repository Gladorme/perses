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
import { Box, Stack, Typography, Grid } from '@mui/material';
import FolderPound from 'mdi-material-ui/FolderPound';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DatasourceStoreProvider, EditProjectVariablesButton } from '@perses-dev/dashboards';
import { VariableDefinition, VariableResource } from '@perses-dev/core';
import { ErrorAlert, ErrorBoundary, useSnackbar } from '@perses-dev/components';
import { PluginRegistry } from '@perses-dev/plugin-system';
import { DeleteProjectDialog } from '../../components/DeleteProjectDialog/DeleteProjectDialog';
import DashboardBreadcrumbs from '../../components/DashboardBreadcrumbs';
import { CRUDButton } from '../../components/CRUDButton/CRUDButton';
import { bundledPluginLoader } from '../../model/bundled-plugins';
import { CachedDatasourceAPI, HTTPDatasourceAPI } from '../../model/datasource-api';
import { useSaveVariablesMutation, useVariableList } from '../../model/project-client';
import { RecentlyViewedDashboards } from './RecentlyViewedDashboards';
import { ProjectDashboards } from './ProjectDashboards';

function ProjectView() {
  const { projectName } = useParams();
  if (projectName === undefined) {
    throw new Error('Unable to get the project name');
  }

  // Navigate to the home page if the project has been successfully deleted
  const navigate = useNavigate();
  const { successSnackbar, exceptionSnackbar } = useSnackbar();

  const handleDeleteProjectDialogSuccess = useCallback(() => navigate(`/`), [navigate]);

  const [datasourceApi] = useState(() => new CachedDatasourceAPI(new HTTPDatasourceAPI()));
  useEffect(() => {
    // warm up the caching of the datasources
    datasourceApi.listDatasources(projectName);
    datasourceApi.listGlobalDatasources();
  }, [datasourceApi, projectName]);

  // Open/Close management for the "Delete Project" dialog
  const [isDeleteProjectDialogOpen, setIsDeleteProjectDialogOpen] = useState<boolean>(false);

  const { data } = useVariableList(projectName);
  const saveVariablesMutation = useSaveVariablesMutation(projectName, data ?? []);

  const variableDefinitions = useMemo(() => {
    const result: VariableDefinition[] = [];

    for (const variable of data ?? []) {
      result.push({
        ...variable.spec,
        ...{
          spec: { name: variable.metadata.name },
        },
      } as VariableDefinition);
    }

    return result;
  }, [data]);

  const handleVariablesSave = (variableDefinitions: VariableDefinition[]) => {
    console.log('handleVariablesSave - variableDefinitions');
    console.log(variableDefinitions);
    // TODO: transform definition in resource
    const variableResources: VariableResource[] = [];

    for (const variableDef of variableDefinitions) {
      variableResources.push({
        kind: 'Variable',
        metadata: {
          name: variableDef.spec.name,
          project: projectName,
        },
        spec: variableDef,
      });
    }

    console.log('handleVariablesSave - variableResources');
    console.log(variableResources);

    saveVariablesMutation.mutate(variableResources, {
      onSuccess: (updatedVariables: VariableResource[]) => {
        successSnackbar(`Variables have been successfully updated`);
        console.log('handleVariablesSave - updatedVariables');
        console.log(updatedVariables);
      },
      onError: (err) => {
        exceptionSnackbar(err);
        throw err;
      },
    });
  };

  return (
    <Stack sx={{ width: '100%' }} m={2} gap={2}>
      <DashboardBreadcrumbs dashboardProject={projectName} />
      <Box>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Stack direction="row" alignItems="center" gap={1}>
            <FolderPound fontSize={'large'} />
            <Typography variant="h1">{projectName}</Typography>
          </Stack>
          <Stack flexDirection="row" gap={2}>
            <ErrorBoundary FallbackComponent={ErrorAlert}>
              <PluginRegistry
                pluginLoader={bundledPluginLoader}
                defaultPluginKinds={{
                  Panel: 'TimeSeriesChart',
                  TimeSeriesQuery: 'PrometheusTimeSeriesQuery',
                }}
              >
                <DatasourceStoreProvider datasourceApi={datasourceApi} projectName={projectName}>
                  <EditProjectVariablesButton
                    variant="contained"
                    variableDefinitions={variableDefinitions}
                    onSave={handleVariablesSave}
                  />
                </DatasourceStoreProvider>
              </PluginRegistry>
            </ErrorBoundary>

            <CRUDButton
              text="Delete Project"
              variant="outlined"
              color="error"
              onClick={() => setIsDeleteProjectDialogOpen(true)}
            />
          </Stack>
          <DeleteProjectDialog
            name={projectName}
            open={isDeleteProjectDialogOpen}
            onClose={() => setIsDeleteProjectDialogOpen(false)}
            onSuccess={handleDeleteProjectDialogSuccess}
          />
        </Stack>
      </Box>
      <Grid container columnSpacing={8}>
        <Grid item xs={12} lg={8}>
          <ProjectDashboards projectName={projectName} id="main-dashboard-list" />
        </Grid>
        <Grid item xs={12} lg={4}>
          <RecentlyViewedDashboards projectName={projectName} id="recent-dashboard-list" />
        </Grid>
      </Grid>
    </Stack>
  );
}

export default ProjectView;
