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

import { Autocomplete, Box, Button, createFilterOptions, Stack, TextField, Typography } from '@mui/material';
import { getResourceDisplayName, useSnackbar } from '@perses-dev/components';
import type { FormEventHandler, ReactElement } from 'react';
import { useId, useMemo, useState } from 'react';

import { useUserPreferences } from '../../context/UserPreferences';
import { useProjectList } from '../../model/project-client';
import { useSearchDashboards } from '../../model/search-client';

interface ResourceOption {
  name: string;
  displayName: string;
}

const NO_OPTIONS: ResourceOption[] = [];

// Options can be found by their display name as well as by their name.
const filterOptions = createFilterOptions<ResourceOption>({
  stringify: (option) => `${option.displayName} ${option.name}`,
});

function compareOptions(a: ResourceOption, b: ResourceOption): number {
  return a.displayName.localeCompare(b.displayName);
}

/**
 * Returns the message to display under a field when its options can't be loaded, or when its selection is not part
 * of them anymore (e.g. the selected dashboard has been deleted).
 * @param options undefined as long as the options are not loaded.
 */
function getErrorText(
  resource: 'project' | 'dashboard',
  selection: string | null,
  options: ResourceOption[] | undefined,
  error: Error | null,
): string | undefined {
  if (error !== null) {
    return `Unable to load the ${resource}s: ${error.message}`;
  }
  if (selection !== null && options !== undefined && !options.some((option) => option.name === selection)) {
    return `This ${resource} can't be found`;
  }
  return undefined;
}

interface ResourceAutocompleteProps {
  label: string;
  options: ResourceOption[];
  value: string | null;
  onChange: (name: string | null) => void;
  noOptionsText: string;
  disabled?: boolean;
  loading?: boolean;
  errorText?: string;
}

function ResourceAutocomplete(props: ResourceAutocompleteProps): ReactElement {
  const { label, options, value, onChange, noOptionsText, disabled, loading, errorText } = props;

  // A selection missing from the loaded options (e.g. a deleted dashboard) is still displayed, which requires it to
  // be one of the options.
  const [selectedOption, selectableOptions] = useMemo((): [ResourceOption | null, ResourceOption[]] => {
    if (value === null) {
      return [null, options];
    }
    const option = options.find(({ name }) => name === value);
    if (option !== undefined) {
      return [option, options];
    }
    const missingOption = { name: value, displayName: value };
    return [missingOption, options.length > 0 ? [...options, missingOption] : options];
  }, [options, value]);

  return (
    <Autocomplete
      options={selectableOptions}
      value={selectedOption}
      onChange={(_, option) => onChange(option?.name ?? null)}
      getOptionLabel={(option) => option.displayName}
      getOptionKey={(option) => option.name}
      isOptionEqualToValue={(option, selected) => option.name === selected.name}
      filterOptions={filterOptions}
      noOptionsText={noOptionsText}
      disabled={disabled}
      loading={loading}
      renderOption={({ key, ...optionProps }, option) => (
        <li key={key} {...optionProps}>
          <div>
            {option.displayName}
            {option.name !== option.displayName && (
              <Typography component="div" variant="caption" color="text.secondary">
                {option.name}
              </Typography>
            )}
          </div>
        </li>
      )}
      renderInput={(params) => (
        <TextField {...params} label={label} error={errorText !== undefined} helperText={errorText} />
      )}
      sx={{ flex: '1 1 240px', maxWidth: 400 }}
    />
  );
}

/**
 * Lets the user display one of the dashboards as their home page, and go back to the default home page.
 */
export function HomeDashboardPreference(): ReactElement {
  const titleId = useId();
  const { successSnackbar } = useSnackbar();
  const { userPreferences, updateUserPreferences } = useUserPreferences();
  const { homeDashboard } = userPreferences;

  const [project, setProject] = useState<string | null>(homeDashboard?.project ?? null);
  const [dashboard, setDashboard] = useState<string | null>(homeDashboard?.dashboard ?? null);

  const projectList = useProjectList();
  const dashboardList = useSearchDashboards(project ?? undefined, undefined, { enabled: project !== null });
  // While the dashboards of a newly selected project are loading, the list still contains the ones of the previous
  // project: they must not be selectable.
  const dashboards = project === null || dashboardList.isPlaceholderData ? undefined : dashboardList.data;
  const dashboardListError = project === null ? null : dashboardList.error;

  const projectOptions = useMemo(
    () =>
      projectList.data
        ?.map((item) => ({ name: item.metadata.name, displayName: getResourceDisplayName(item) }))
        .toSorted(compareOptions),
    [projectList.data],
  );
  const dashboardOptions = useMemo(
    () =>
      dashboards?.map((item) => ({ name: item.metadata.name, displayName: item.displayName })).toSorted(compareOptions),
    [dashboards],
  );

  const isModified = project !== (homeDashboard?.project ?? null) || dashboard !== (homeDashboard?.dashboard ?? null);

  const handleProjectChange = (name: string | null): void => {
    if (name === project) {
      return;
    }
    setProject(name);
    setDashboard(null);
  };

  const handleSubmit: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (project === null || dashboard === null) {
      return;
    }
    updateUserPreferences({ homeDashboard: { project, dashboard } });
    const displayName = dashboardOptions?.find((option) => option.name === dashboard)?.displayName ?? dashboard;
    successSnackbar(`Home page set to the dashboard ${displayName}`);
  };

  const handleReset = (): void => {
    updateUserPreferences({ homeDashboard: undefined });
    setProject(null);
    setDashboard(null);
    successSnackbar('Home page reset to the default one');
  };

  return (
    <form aria-labelledby={titleId} onSubmit={handleSubmit}>
      <Stack direction="column" spacing={2}>
        <Stack spacing={0.5} sx={{ px: 2, pt: 2 }}>
          <Typography id={titleId} variant="h2">
            Home page
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Select a dashboard to display it as your home page, instead of the default one.
          </Typography>
        </Stack>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, px: 2 }}>
          <ResourceAutocomplete
            label="Project"
            options={projectOptions ?? NO_OPTIONS}
            value={project}
            onChange={handleProjectChange}
            noOptionsText="No project found"
            loading={projectList.isPending}
            errorText={getErrorText('project', project, projectOptions, projectList.error)}
          />
          <ResourceAutocomplete
            label="Dashboard"
            options={dashboardOptions ?? NO_OPTIONS}
            value={dashboard}
            onChange={setDashboard}
            noOptionsText="No dashboard found"
            disabled={project === null}
            loading={project !== null && dashboardOptions === undefined && dashboardListError === null}
            errorText={getErrorText('dashboard', dashboard, dashboardOptions, dashboardListError)}
          />
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 1 }}>
          <Button type="submit" variant="contained" disabled={project === null || dashboard === null || !isModified}>
            Save
          </Button>
          <Button variant="outlined" color="secondary" disabled={homeDashboard === undefined} onClick={handleReset}>
            Use default home page
          </Button>
        </Box>
      </Stack>
    </form>
  );
}
