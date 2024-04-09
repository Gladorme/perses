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

import { GetVariableOptionsContext, OptionsEditorProps, VariablePlugin } from '@perses-dev/plugin-system';

function MyVariableEditor(props: OptionsEditorProps<string>) {
  console.log(props);
  return <h1>MY SUPER PLUGIN EDITOR</h1>;
}

export const MyVariable: VariablePlugin<string> = {
  getVariableOptions: async (spec: string, ctx: GetVariableOptionsContext) => {
    console.log(spec, ctx);
    return {
      data: [{ value: 'my-value', label: 'spec' }],
    };
  },
  dependsOn: (variables: string) => {
    console.log(variables);
    return { variables: [] };
  },
  OptionsEditorComponent: MyVariableEditor,
  createInitialOptions: () => '',
};
