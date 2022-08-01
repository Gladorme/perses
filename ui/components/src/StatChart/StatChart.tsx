// Copyright 2022 The Perses Authors
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

import React, { useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import { merge } from 'lodash-es';
import { use, EChartsCoreOption } from 'echarts/core';
import { GaugeChart as EChartsGaugeChart, GaugeSeriesOption } from 'echarts/charts';
import { LineChart as EChartsLineChart, LineSeriesOption } from 'echarts/charts';
import { GridComponent, DatasetComponent, TitleComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useChartsTheme } from '../context/ChartsThemeProvider';
import { formatValue, UnitOptions } from '../model/units';
import { EChart } from '../EChart';
import { GraphSeries } from '../model/graph';

use([
  EChartsGaugeChart,
  EChartsLineChart,
  GridComponent,
  DatasetComponent,
  TitleComponent,
  TooltipComponent,
  CanvasRenderer,
]);

const PANEL_PADDING = 32;
const MIN_VALUE_SIZE = 12;
const MAX_VALUE_SIZE = 36;

export interface StatChartData {
  calculatedValue?: number;
  seriesData?: GraphSeries;
  name?: string;
}

interface StatChartProps {
  width: number;
  height: number;
  data: StatChartData;
  unit: UnitOptions;
  sparkline?: LineSeriesOption;
}

export function StatChart(props: StatChartProps) {
  const { width, height, data, unit, sparkline } = props;
  const chartsTheme = useChartsTheme();

  const formattedValue = data.calculatedValue === undefined ? 'No data' : formatValue(data.calculatedValue, unit);

  const option: EChartsCoreOption = useMemo(() => {
    if (data.seriesData === undefined) return chartsTheme.noDataOption;

    const series = data.seriesData;

    const statSeries: Array<GaugeSeriesOption | LineSeriesOption> = [];

    if (sparkline !== undefined) {
      const lineSeries: LineSeriesOption = {
        type: 'line',
        data: [...series.values],
        zlevel: 1,
        symbol: 'none',
        animation: false,
        silent: true,
      };
      const mergedSeries = merge(lineSeries, sparkline);
      statSeries.push(mergedSeries);
    }

    const option = {
      title: {
        show: false,
      },
      grid: {
        show: false,
        top: '35%', // adds space above sparkline
        right: 0,
        bottom: 0,
        left: 0,
        containLabel: false,
      },
      xAxis: {
        type: 'time',
        show: false,
        boundaryGap: false,
      },
      yAxis: {
        type: 'value',
        show: false,
      },
      tooltip: {
        show: false,
      },
      series: statSeries,
    };

    return option;
  }, [data, chartsTheme, sparkline]);

  const isLargePanel = width > 250 && height > 180;
  // adjusts fontSize depending on number of characters, clamp also used in fontSize attribute
  const charactersAdjust = formattedValue.length;
  const valueSize = isLargePanel === true ? MAX_VALUE_SIZE : Math.min(width, height) / charactersAdjust;

  return (
    <Box>
      <Typography
        variant="h3"
        sx={(theme) => ({
          color: theme.palette.text.primary,
          fontSize: `clamp(${MIN_VALUE_SIZE}px, ${valueSize}px, ${MAX_VALUE_SIZE}px)`,
        })}
      >
        {formattedValue}
      </Typography>
      {sparkline !== undefined && (
        <EChart
          sx={{
            width: width + PANEL_PADDING, // allows sparkline to extend to edge of panel
            height: height,
            position: 'absolute',
            bottom: 0,
            left: 0,
          }}
          option={option}
          theme={chartsTheme.themeName}
          renderer="svg"
        />
      )}
    </Box>
  );
}