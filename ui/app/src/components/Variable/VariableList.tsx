import { VariableDefinition } from '@perses-dev/core';
import { VariableEditor } from '@perses-dev/dashboards';

interface VariableListProps {
  variableDefinitions: VariableDefinition[];
  onChange: (variableDefinitions: VariableDefinition[]) => void;
  onCancel: () => void;
}

export function VariableList(props: VariableListProps) {
  const { variableDefinitions, onChange, onCancel } = props;
  return <VariableEditor variableDefinitions={variableDefinitions} onCancel={onCancel} onChange={onChange} />;
}
