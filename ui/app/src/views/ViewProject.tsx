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

import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import {
  Box,
  Stack,
  Grid,
  Typography,
  Button,
  Link,
  Breadcrumbs,
  TextField,
  OutlinedInput,
  SelectChangeEvent,
  MenuItem,
  Checkbox,
  ListItemText,
  Select,
  InputLabel,
  FormControl,
} from '@mui/material';
import { ErrorAlert, ErrorBoundary } from '@perses-dev/components';
import FolderPound from 'mdi-material-ui/FolderPound';
import ViewDashboard from 'mdi-material-ui/ViewDashboard';
import { useCallback, useState } from 'react';
import { useDashboardList } from '../model/dashboard-client';
import DashboardList from '../components/DashboardList';
import { DeleteProjectDialog } from '../components/DeleteProjectDialog/DeleteProjectDialog';
import { CreateDashboardDialog } from '../components/CreateDashboardDialog/CreateDashboardDialog';

const tags = ['Test1', 'Test2', 'Test3', 'Test4', 'Test5', 'Test6', 'Test7', 'Test8'];

interface RenderDashboardInProjectProperties {
  projectName: string;
}

function DashboardPageInProject(props: RenderDashboardInProjectProperties) {
  const navigate = useNavigate();

  const [openCreateDashboardDialogState, setOpenCreateDashboardDialogState] = useState(false);
  const [filterTags, setFilterTags] = useState<string[]>([]);

  const { data } = useDashboardList(props.projectName);
  if (data === undefined) {
    return null;
  }

  const handleDashboardCreation = function (name: string) {
    navigate(`/projects/${props.projectName}/dashboards/${name}/create`);
  };

  const handleChange = (event: SelectChangeEvent<string[]>) => {
    const {
      target: { value },
    } = event;
    setFilterTags(
      // On autofill we get a stringified value.
      typeof value === 'string' ? value.split(',') : value
    );
  };

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2} sx={{ width: '100%' }}>
        <Stack direction="row">
          <ViewDashboard />
          <Typography variant="h2">Dashboards</Typography>
        </Stack>
        <Stack sx={{ width: '100%' }}>
          <TextField
            margin="dense"
            id="search"
            label="Search"
            type="text"
            fullWidth
            placeholder="Start typing dashboard name..."
          ></TextField>
        </Stack>
        <Stack direction="row" gap={1}>
          <FormControl sx={{ width: 200 }}>
            <InputLabel id="demo-simple-select-autowidth-label">Filter</InputLabel>
            <Select
              multiple
              value={filterTags}
              onChange={handleChange}
              input={<OutlinedInput label="Tags" />}
              renderValue={(selected) => selected.join(', ')}
              label="Filter"
              placeholder="Start typing label..."
              fullWidth
            >
              {tags.map((tag) => (
                <MenuItem key={tag} value={tag}>
                  <Checkbox checked={filterTags.indexOf(tag) > -1} />
                  <ListItemText primary={tag} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button
            variant="contained"
            size="small"
            onClick={() => setOpenCreateDashboardDialogState(true)}
            sx={{ whiteSpace: 'nowrap' }}
          >
            Add Dashboard
          </Button>
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
      <Breadcrumbs sx={{ fontSize: 'large' }}>
        <Link underline={'hover'} variant={'h3'} component={RouterLink} to={'/'}>
          Home
        </Link>
        <Typography variant={'h3'}>{projectName}</Typography>
      </Breadcrumbs>
      <Box sx={{ width: '100%' }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Stack direction="row" alignItems="center" gap={1} mb={2}>
            <FolderPound fontSize={'large'} />
            <Typography variant="h1">{projectName}</Typography>
          </Stack>
          <Button variant="outlined" color="error" size="small" onClick={handleDeleteProjectDialogOpen}>
            Delete
          </Button>
        </Stack>
        <DeleteProjectDialog
          name={projectName}
          open={isDeleteProjectDialogOpen}
          onClose={handleDeleteProjectDialogClose}
          onSuccess={handleDeleteProjectDialogSuccess}
        />
      </Box>
      <Grid container spacing={8}>
        <Grid item xs={8}>
          <DashboardPageInProject projectName={projectName} />
        </Grid>
        <Grid item xs={4}>
          <Typography variant="h2">Recent</Typography>
        </Grid>
      </Grid>
    </Stack>
  );
}

export default ViewProject;
