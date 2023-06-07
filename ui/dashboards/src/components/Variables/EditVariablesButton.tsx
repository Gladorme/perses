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

import { useState } from 'react';
import { Button, ButtonProps } from '@mui/material';
import PencilIcon from 'mdi-material-ui/PencilOutline';
import { Drawer, InfoTooltip } from '@perses-dev/components';
import { VariableDefinition } from '@perses-dev/core';
import { VariableBox } from 'mdi-material-ui';
import { TOOLTIP_TEXT } from '../../constants';
import {
  useDiscardChangesConfirmationDialog,
  useTemplateVariableActions,
  useTemplateVariableDefinitions,
} from '../../context';
import { VariableEditor } from './VariableEditor';

interface EditVariablesButtonProps extends Pick<ButtonProps, 'fullWidth' | 'startIcon' | 'variant' | 'color'> {
  label: string;
  variableDefinitions: VariableDefinition[];
  onChange: (variableDefinitions: VariableDefinition[]) => void;
  onCancel: () => void;
}

function EditVariablesButton({
  label,
  variableDefinitions,
  onChange,
  onCancel,
  variant,
  color,
  startIcon,
  fullWidth,
}: EditVariablesButtonProps) {
  const [isVariableEditorOpen, setIsVariableEditorOpen] = useState(false);

  const openVariableEditor = () => {
    setIsVariableEditorOpen(true);
  };

  const closeVariableEditor = () => {
    setIsVariableEditorOpen(false);
  };

  const handleCancel = () => {
    //  TODO: if (onCancel()) {
    onCancel();
    closeVariableEditor();
    // }
  };

  return (
    <>
      <InfoTooltip description={TOOLTIP_TEXT.editVariables}>
        <Button
          startIcon={startIcon}
          onClick={openVariableEditor}
          aria-label={TOOLTIP_TEXT.editVariables}
          variant={variant}
          color={color}
          fullWidth={fullWidth}
          sx={{ whiteSpace: 'nowrap', minWidth: 'auto' }}
        >
          {label}
        </Button>
      </InfoTooltip>
      <Drawer
        isOpen={isVariableEditorOpen}
        onClose={closeVariableEditor}
        PaperProps={{ sx: { width: '50%' } }}
        data-testid="variable-editor"
      >
        <VariableEditor variableDefinitions={variableDefinitions} onCancel={handleCancel} onChange={onChange} />
      </Drawer>
    </>
  );
}

interface EditDashboardVariablesButtonProps extends Pick<ButtonProps, 'fullWidth' | 'startIcon' | 'variant' | 'color'> {
  label?: string;
}

export function EditDashboardVariablesButton({
  variant = 'text',
  label = 'Variables',
  color = 'primary',
  startIcon = <PencilIcon />,
  fullWidth,
}: EditDashboardVariablesButtonProps) {
  const variableDefinitions: VariableDefinition[] = useTemplateVariableDefinitions();
  const [initialVariableDefinitions] = useState(variableDefinitions);
  const { setVariableDefinitions } = useTemplateVariableActions();
  const { openDiscardChangesConfirmationDialog, closeDiscardChangesConfirmationDialog } =
    useDiscardChangesConfirmationDialog();

  const handleCancel = () => {
    if (JSON.stringify(variableDefinitions) !== JSON.stringify(initialVariableDefinitions)) {
      openDiscardChangesConfirmationDialog({
        onDiscardChanges: () => {
          closeDiscardChangesConfirmationDialog();
          // TODO: close
        },
        onCancel: () => {
          closeDiscardChangesConfirmationDialog();
          // TODO: do not close
        },
        description:
          'You have unapplied changes. Are you sure you want to discard these changes? Changes cannot be recovered.',
      });
    } else {
      return false;
    }
  };

  return (
    <EditVariablesButton
      variableDefinitions={variableDefinitions}
      onChange={(variables: VariableDefinition[]) => {
        setVariableDefinitions(variables);
      }}
      onCancel={handleCancel}
      variant={variant}
      label={label}
      color={color}
      startIcon={startIcon}
      fullWidth={fullWidth}
    />
  );
}

interface EditProjectVariablesButtonProps extends Pick<ButtonProps, 'fullWidth' | 'startIcon' | 'variant' | 'color'> {
  label?: string;
}

export function EditProjectVariablesButton({
  variant = 'text',
  label = 'Variables',
  color = 'primary',
  startIcon = undefined,
  fullWidth,
}: EditProjectVariablesButtonProps) {
  // const variableDefinitions: VariableDefinition[] = useProjectVariableDefinitions();
  // const { setVariableDefinitions } = useProjectVariableActions();

  const handleChange = (variableDefinitions: VariableDefinition[]) => {
    console.log(variableDefinitions);
  };

  const handleCancel = () => {
    console.log('close');
  };

  return (
    <EditVariablesButton
      variableDefinitions={[]}
      onChange={handleChange}
      onCancel={handleCancel}
      variant={variant}
      label={label}
      color={color}
      startIcon={startIcon}
      fullWidth={fullWidth}
    />
  );
}
