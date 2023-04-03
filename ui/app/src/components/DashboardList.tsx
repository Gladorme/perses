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

import { DashboardResource } from '@perses-dev/core';
import { Box, Stack } from '@mui/material';
import {
  DataGrid,
  GridColDef,
  GridActionsCellItem,
  GridRowParams,
  GridValueGetterParams,
  GridToolbarContainer,
  GridToolbarColumnsButton,
  GridToolbarFilterButton,
  GridToolbarQuickFilter,
  GridRow,
  GridColumnHeaders,
} from '@mui/x-data-grid';
import DeleteIcon from 'mdi-material-ui/DeleteOutline';
import PencilIcon from 'mdi-material-ui/Pencil';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { dashboardDisplayName } from '@perses-dev/core/dist/utils/text';
import { useNavigate } from 'react-router-dom';
import { GridInitialStateCommunity } from '@mui/x-data-grid/models/gridStateCommunity';
import { DeleteDashboardDialog } from './DeleteDashboardDialog/DeleteDashboardDialog';
import { RenameDashboardDialog } from './RenameDashboardDialog/RenameDashboardDialog';

// https://mui.com/x/react-data-grid/performance/
const MemoizedRow = memo(GridRow);
const MemoizedColumnHeaders = memo(GridColumnHeaders);

interface Row {
  project: string;
  name: string;
  displayName: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface RowHistory extends Row {
  lastViewed: string;
}

function DashboardsGridToolbar() {
  return (
    <GridToolbarContainer>
      <Stack direction="row" width="100%" gap={4} m={2}>
        <Stack sx={{ flexShrink: 1 }} width="100%">
          <GridToolbarQuickFilter sx={{ width: '100%' }} />
        </Stack>
        <Stack direction="row" sx={{ flexShrink: 3 }} width="100%">
          <GridToolbarColumnsButton sx={{ width: '100%' }} />
          <GridToolbarFilterButton sx={{ width: '100%' }} />
        </Stack>
      </Stack>
    </GridToolbarContainer>
  );
}

interface DashboardDataGridProperties {
  columns: Array<GridColDef<Row | RowHistory>>;
  rows: Row[] | RowHistory[];
  initialState?: GridInitialStateCommunity;
}

function DashboardDataGrid(props: DashboardDataGridProperties) {
  const { columns, rows } = props;

  const navigate = useNavigate();

  return (
    <DataGrid
      onRowClick={(params) => navigate(`/projects/${params.row.project}/dashboards/${params.row.name}`)}
      rows={rows}
      columns={columns}
      getRowId={(row) => row.name}
      slots={{ toolbar: DashboardsGridToolbar, row: MemoizedRow, columnHeaders: MemoizedColumnHeaders }}
      pageSizeOptions={[10, 25, 50, 100]}
      initialState={{
        columns: {
          columnVisibilityModel: {
            project: false,
            id: false,
            version: false,
          },
        },
        sorting: {
          sortModel: [{ field: 'displayName', sort: 'asc' }],
        },
        pagination: {
          paginationModel: { pageSize: 10, page: 0 },
        },
      }}
    ></DataGrid>
  );
}

export interface DashboardListProperties {
  dashboardList: DashboardResource[];
}

export function DashboardList(props: DashboardListProperties) {
  const { dashboardList } = props;

  const getDashboard = useCallback(
    (project: string, name: string) => {
      return dashboardList.find(
        (dashboard) => dashboard.metadata.project === project && dashboard.metadata.name === name
      );
    },
    [dashboardList]
  );

  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    setRows(
      dashboardList.map(
        (dashboard) =>
          ({
            project: dashboard.metadata.project,
            name: dashboard.metadata.name,
            displayName: dashboardDisplayName(dashboard),
            version: dashboard.metadata.version,
            createdAt: dashboard.metadata.created_at,
            updatedAt: dashboard.metadata.updated_at,
          } as Row)
      )
    );
  }, [setRows, dashboardList]);

  const [targetedDashboard, setTargetedDashboard] = useState<DashboardResource>();
  const [isRenameDashboardDialogStateOpened, setRenameDashboardDialogStateOpened] = useState<boolean>(false);
  const [isDeleteDashboardDialogStateOpened, setDeleteDashboardDialogStateOpened] = useState<boolean>(false);

  const onRenameButtonClick = useCallback(
    (project: string, name: string) => () => {
      setTargetedDashboard(getDashboard(project, name));
      setRenameDashboardDialogStateOpened(true);
    },
    [getDashboard]
  );

  const onDeleteButtonClick = useCallback(
    (project: string, name: string) => () => {
      setTargetedDashboard(getDashboard(project, name));
      setDeleteDashboardDialogStateOpened(true);
    },
    [getDashboard]
  );

  const columns = useMemo<Array<GridColDef<Row>>>(
    () => [
      { field: 'project', headerName: 'Project', type: 'string', flex: 2, minWidth: 150 },
      { field: 'displayName', headerName: 'Display Name', type: 'string', flex: 3, minWidth: 150 },
      {
        field: 'version',
        headerName: 'Version',
        type: 'number',
        align: 'right',
        headerAlign: 'right',
        flex: 1,
        minWidth: 80,
      },
      {
        field: 'createdAt',
        headerName: 'Creation Date',
        type: 'dateTime',
        flex: 1,
        minWidth: 125,
        valueGetter: (params: GridValueGetterParams) => new Date(params.row.createdAt),
      },
      {
        field: 'updatedAt',
        headerName: 'Last Update',
        type: 'dateTime',
        flex: 1,
        minWidth: 125,
        valueGetter: (params: GridValueGetterParams) => new Date(params.row.updatedAt),
      },
      {
        field: 'actions',
        headerName: 'Actions',
        type: 'actions',
        flex: 0.5,
        minWidth: 100,
        getActions: (params: GridRowParams<Row>) => [
          <GridActionsCellItem
            key={params.id + '-edit'}
            icon={<PencilIcon />}
            label="Rename"
            onClick={onRenameButtonClick(params.row.project, params.row.name)}
          />,
          <GridActionsCellItem
            key={params.id + '-delete'}
            icon={<DeleteIcon />}
            label="Delete"
            onClick={onDeleteButtonClick(params.row.project, params.row.name)}
          />,
        ],
      },
    ],
    [onRenameButtonClick, onDeleteButtonClick]
  );

  return (
    <Stack width="100%" height={700}>
      <DashboardDataGrid
        rows={rows}
        columns={columns}
        initialState={{
          columns: {
            columnVisibilityModel: {
              project: false,
              id: false,
              version: false,
            },
          },
          sorting: {
            sortModel: [{ field: 'displayName', sort: 'asc' }],
          },
          pagination: {
            paginationModel: { pageSize: 10, page: 0 },
          },
        }}
      ></DashboardDataGrid>
      <Box>
        {targetedDashboard && (
          <Box>
            <RenameDashboardDialog
              open={isRenameDashboardDialogStateOpened}
              onClose={() => setRenameDashboardDialogStateOpened(false)}
              dashboard={targetedDashboard}
            />
            <DeleteDashboardDialog
              open={isDeleteDashboardDialogStateOpened}
              onClose={() => setDeleteDashboardDialogStateOpened(false)}
              dashboard={targetedDashboard}
            />
          </Box>
        )}
      </Box>
    </Stack>
  );
}
