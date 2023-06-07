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
import { TOOLTIP_TEXT } from '../../constants';
import {
  DiscardChangesConfirmationDialogState,
  useDiscardChangesConfirmationDialog,
  useTemplateVariableActions,
  useTemplateVariableDefinitions,
} from '../../context';
import { VariableEditor } from './VariableEditor';

interface EditVariablesButtonProps extends Pick<ButtonProps, 'fullWidth' | 'startIcon' | 'variant' | 'color'> {
  label: string;
  variableDefinitions: VariableDefinition[];
  onChange: (variableDefinitions: VariableDefinition[]) => void;
  onSubmit: (variableDefinitions: VariableDefinition[]) => void;
  onCancel: () => Promise<boolean>;
}

function EditVariablesButton({
  label,
  variableDefinitions,
  onChange,
  onSubmit,
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
    onCancel().then((confirm) => {
      if (confirm) {
        closeVariableEditor();
        onChange(variableDefinitions);
      }
    });
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
        <VariableEditor
          variableDefinitions={variableDefinitions}
          onCancel={handleCancel}
          onChange={onChange}
          onSubmit={onSubmit}
        />
      </Drawer>
    </>
  );
}

/**
 * Open a confirmation modal, promise returns true if the discard is validated else returns false
 * @param openDiscardChangesConfirmationDialog
 * @param closeDiscardChangesConfirmationDialog
 */
function getDiscardConfirmation(
  openDiscardChangesConfirmationDialog: (
    discardChangesConfirmationDialog: DiscardChangesConfirmationDialogState
  ) => void,
  closeDiscardChangesConfirmationDialog: () => void
): Promise<boolean> {
  return new Promise((resolve) => {
    openDiscardChangesConfirmationDialog({
      onDiscardChanges: () => {
        closeDiscardChangesConfirmationDialog();
        resolve(true);
      },
      onCancel: () => {
        closeDiscardChangesConfirmationDialog();
        resolve(false);
      },
      description:
        'You have unapplied changes. Are you sure you want to discard these changes? Changes cannot be recovered.',
    });
  });
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
  const [transientVariableDefinitions, setTransientVariableDefinitions] = useState(variableDefinitions);
  const { setVariableDefinitions } = useTemplateVariableActions();
  const { openDiscardChangesConfirmationDialog, closeDiscardChangesConfirmationDialog } =
    useDiscardChangesConfirmationDialog();

  const handleCancel = () => {
    if (JSON.stringify(variableDefinitions) !== JSON.stringify(transientVariableDefinitions)) {
      return getDiscardConfirmation(openDiscardChangesConfirmationDialog, closeDiscardChangesConfirmationDialog);
    }
    return Promise.resolve(true);
  };

  return (
    <EditVariablesButton
      variableDefinitions={variableDefinitions}
      onChange={(variables: VariableDefinition[]) => {
        setTransientVariableDefinitions(variables);
      }}
      onSubmit={(variables: VariableDefinition[]) => {
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
  variableDefinitions: VariableDefinition[];
  onSave: (variablesDefinitions: VariableDefinition[]) => void; // TODO: maybe promise in order to revert to old var?
}

export function EditProjectVariablesButton({
  variant = 'text',
  label = 'Variables',
  color = 'primary',
  startIcon = undefined,
  fullWidth,
  variableDefinitions,
  onSave,
}: EditProjectVariablesButtonProps) {
  const [transientVariableDefinitions, setTransientVariableDefinitions] = useState(variableDefinitions);

  const handleCancel = () => {
    if (JSON.stringify(variableDefinitions) !== JSON.stringify(transientVariableDefinitions)) {
      // TODO: return getDiscardConfirmation(openDiscardChangesConfirmationDialog, closeDiscardChangesConfirmationDialog);
      return Promise.resolve(true);
    }
    return Promise.resolve(true);
  };

  return (
    <EditVariablesButton
      variableDefinitions={variableDefinitions}
      onChange={(variables: VariableDefinition[]) => {
        setTransientVariableDefinitions(variables);
      }}
      onSubmit={onSave}
      onCancel={handleCancel}
      variant={variant}
      label={label}
      color={color}
      startIcon={startIcon}
      fullWidth={fullWidth}
    />
  );
}
