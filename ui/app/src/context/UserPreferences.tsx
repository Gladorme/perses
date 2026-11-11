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

import { useLocalStorage } from '@perses-dev/components';
import type { ReactElement } from 'react';
import React, { createContext, useCallback, useContext, useMemo } from 'react';

import type { UserPreferences } from '../model/userPreferences';
import { parseHomeDashboard } from '../model/userPreferences';

interface UserPreferencesContextType {
  userPreferences: UserPreferences;
  updateUserPreferences: (preferences: Partial<UserPreferences>) => void;
}

const USER_PREFERENCES_KEY = 'PERSES_USER_PREFERENCES';

/**
 * Reads the preferences from the browser storage, as another tab may have changed them since they have been loaded.
 */
function readStoredPreferences(): UserPreferences {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(USER_PREFERENCES_KEY) ?? 'null');
    return typeof stored === 'object' && stored !== null ? stored : {};
  } catch {
    return {};
  }
}

const UserPreferencesContext = createContext<UserPreferencesContextType>({
  userPreferences: {},
  updateUserPreferences: () => undefined,
});

export function UserPreferencesContextProvider(props: {
  children: React.ReactNode;
  defaultPreferences: UserPreferences;
}): ReactElement {
  const [storedPreferences, setStoredPreferences] = useLocalStorage<UserPreferences | null>(USER_PREFERENCES_KEY, null);
  const userPreferences = useMemo((): UserPreferences => {
    const preferences = { ...props.defaultPreferences, ...storedPreferences };
    return { ...preferences, homeDashboard: parseHomeDashboard(preferences.homeDashboard) };
  }, [props.defaultPreferences, storedPreferences]);
  const updateUserPreferences = useCallback(
    (preferences: Partial<UserPreferences>): void => {
      // Merging with what is stored, and not with what has been loaded, keeps the other preferences as they are when
      // another tab has changed them in the meantime.
      setStoredPreferences({ ...readStoredPreferences(), ...preferences });
    },
    [setStoredPreferences],
  );
  const contextValue = useMemo(
    () => ({
      userPreferences,
      updateUserPreferences,
    }),
    [updateUserPreferences, userPreferences],
  );

  return <UserPreferencesContext.Provider value={contextValue}>{props.children}</UserPreferencesContext.Provider>;
}

export function useUserPreferences(): UserPreferencesContextType {
  return useContext(UserPreferencesContext);
}
