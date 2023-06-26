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

import { DashboardResource, VariableResource } from '../model';

export function dashboardDisplayName(dashboard: DashboardResource) {
  return dashboard.spec.display?.name ?? dashboard.metadata.name;
}

export function variableDisplayName(variable: VariableResource) {
  return variable.spec.spec.display?.name ?? variable.metadata.name;
}

export function dashboardExtendedDisplayName(dashboard: DashboardResource) {
  if (dashboard.spec.display?.name) {
    return `${dashboard.spec.display.name} (ID: ${dashboard.metadata.name})`;
  }
  return dashboard.metadata.name;
}

export function variableExtendedDisplayName(variable: VariableResource) {
  if (variable.spec.spec.display?.name) {
    return `${variable.spec.spec.display.name} (ID: ${variable.metadata.name})`;
  }
  return variable.metadata.name;
}
