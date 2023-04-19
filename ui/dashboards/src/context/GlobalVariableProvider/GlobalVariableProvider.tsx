import React, { createContext, ReactNode, useMemo } from 'react';
import { TimeRangeValue } from '@perses-dev/core';
import { useTimeRange } from '@perses-dev/plugin-system';

interface GlobalVariable {
  $__dashboard: string;
  $__from: Date;
  $__to: Date;
  $__timeFilter: string;
}

const GlobalVariableContext = createContext<GlobalVariable | undefined>(undefined);

interface GlobalVariableProviderProps {
  dashboardName: string;
  children?: ReactNode;
}

export function GlobalVariableProvider(props: GlobalVariableProviderProps) {
  const { dashboardName, children } = props;

  const { absoluteTimeRange } = useTimeRange();

  const ctx = useMemo(() => {
    return {
      $__dashboard: dashboardName,
      $__from: absoluteTimeRange.start,
      $__to: absoluteTimeRange.end,
      $__timeFilter: getTimeFilter(absoluteTimeRange.start, absoluteTimeRange.end),
    };
  }, [absoluteTimeRange.end, absoluteTimeRange.start, dashboardName]);

  return <GlobalVariableContext.Provider value={ctx}>{children}</GlobalVariableContext.Provider>;
}

function getTimeFilter(start: Date, end: Date): string {
  return `time >= ${start} and time <= ${end}`;
}
