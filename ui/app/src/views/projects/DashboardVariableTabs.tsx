import { Box, Card, Stack, Tab, Tabs, Typography } from '@mui/material';
import { ReactNode, SyntheticEvent, useState } from 'react';
import ViewDashboardIcon from 'mdi-material-ui/ViewDashboard';
import VariableBoxIcon from 'mdi-material-ui/VariableBox';
import BroadcastIcon from 'mdi-material-ui/Broadcast';
import { DashboardSelector, VariableDefinition } from '@perses-dev/core';
import { useNavigate } from 'react-router-dom';
import { CRUDButton } from '../../components/CRUDButton/CRUDButton';
import { CreateDashboardDialog } from '../../components/CreateDashboardDialog/CreateDashboardDialog';
import { VariableList } from '../../components/Variable/VariableList';
import { ProjectDashboards } from './ProjectDashboards';

interface TabButtonProps {
  index: number;
  projectName: string;
}

function TabButton(props: TabButtonProps) {
  const navigate = useNavigate();
  const [openCreateDashboardDialogState, setOpenCreateDashboardDialogState] = useState(false);

  const handleDashboardCreation = (dashboardSelector: DashboardSelector) => {
    navigate(`/projects/${dashboardSelector.project}/dashboards/${dashboardSelector.dashboard}/create`);
  };

  switch (props.index) {
    case 0:
      return (
        <>
          <CRUDButton
            text="Add Dashboard"
            variant="contained"
            onClick={() => setOpenCreateDashboardDialogState(true)}
          />
          <CreateDashboardDialog
            open={openCreateDashboardDialogState}
            projectOptions={[props.projectName]}
            onClose={() => setOpenCreateDashboardDialogState(false)}
            onSuccess={handleDashboardCreation}
          />
        </>
      );
    case 1:
      return (
        <CRUDButton text="Add Variable" variant="contained" onClick={() => setOpenCreateDashboardDialogState(true)} />
      );
    case 2:
      return (
        <CRUDButton text="Add Datasource" variant="contained" onClick={() => setOpenCreateDashboardDialogState(true)} />
      );
    default:
      return <></>;
  }
}

interface TabPanelProps {
  children?: ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`simple-tabpanel-${index}`}
      aria-labelledby={`simple-tab-${index}`}
      {...other}
    >
      {value === index && (
        <Box sx={{ p: 3 }}>
          <Typography>{children}</Typography>
        </Box>
      )}
    </div>
  );
}

function a11yProps(index: number) {
  return {
    id: `simple-tab-${index}`,
    'aria-controls': `simple-tabpanel-${index}`,
  };
}

interface DashboardVariableTabsProps {
  projectName: string;
}

export function DashboardVariableTabs(props: DashboardVariableTabsProps) {
  const { projectName } = props;

  const [value, setValue] = useState(0);

  const handleChange = (event: SyntheticEvent, newValue: number) => {
    setValue(newValue);
  };

  const handleVariablesChange = (variableDefinitions: VariableDefinition[]) => {
    console.log(variableDefinitions);
    return;
  };

  const handleVariablesCancel = () => {
    return;
  };

  return (
    <Box sx={{ width: '100%' }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ marginLeft: 2.5, marginRight: 2.5 }}
      >
        <Tabs value={value} onChange={handleChange} aria-label="basic tabs example">
          <Tab label="Dashboards" icon={<ViewDashboardIcon />} iconPosition="start" {...a11yProps(0)} />
          <Tab label="Variables" icon={<VariableBoxIcon />} iconPosition="start" {...a11yProps(1)} />
          <Tab label="Datasources" icon={<BroadcastIcon />} iconPosition="start" {...a11yProps(1)} />
        </Tabs>
        <TabButton index={value} projectName={projectName} />
      </Stack>
      <TabPanel value={value} index={0}>
        <ProjectDashboards projectName={projectName} id="main-dashboard-list" />
      </TabPanel>
      <TabPanel value={value} index={1}>
        <Card>
          <VariableList variableDefinitions={[]} onChange={handleVariablesChange} onCancel={handleVariablesCancel} />
        </Card>
      </TabPanel>
      <TabPanel value={value} index={2}></TabPanel>
    </Box>
  );
}
